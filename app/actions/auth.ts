"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export async function signInWithGoogle() {
	const supabase = await createClient();
	const headersList = await headers();
	const origin = headersList.get("origin") ?? "";

	// Use the request origin when it's a trusted domain so that OAuth works
	// from Vercel preview/alias URLs (e.g. ori-bio-scott-handleys-projects.vercel.app)
	// as well as the production domain. Fall back to NEXT_PUBLIC_SITE_URL otherwise.
	const canonicalUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ori-bio.app";
	const isTrustedOrigin =
		origin === canonicalUrl ||
		origin.endsWith(".vercel.app") ||
		origin.startsWith("http://localhost");
	const redirectBase = isTrustedOrigin ? origin : canonicalUrl;

	const { data, error } = await supabase.auth.signInWithOAuth({
		provider: "google",
		options: { redirectTo: `${redirectBase}/auth/callback` },
	});

	if (error || !data.url) redirect("/login?error=oauth_failed");
	redirect(data.url);
}

export async function login(formData: FormData) {
	const supabase = await createClient();

	const { error } = await supabase.auth.signInWithPassword({
		email: formData.get("email") as string,
		password: formData.get("password") as string,
	});

	if (error) {
		if (
			error.message.toLowerCase().includes("invalid login") ||
			error.message.toLowerCase().includes("invalid credentials")
		) {
			return { error: "Incorrect email or password." };
		}
		if (error.message.toLowerCase().includes("email not confirmed")) {
			return { error: "Incorrect email or password. If you recently signed up, check your inbox to confirm your account." };
		}
		return { error: error.message };
	}

	redirect("/dashboard");
}

export async function signup(formData: FormData) {
	const supabase = await createClient();

	// Derive origin from the incoming request so this works on preview deployments too
	const headersList = await headers();
	const origin =
		headersList.get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "https://ori-bio.app";

	const password = formData.get("password") as string;
	if (password.length < 8) return { error: "Password must be at least 8 characters." };

	const { data, error } = await supabase.auth.signUp({
		email: formData.get("email") as string,
		password,
		options: {
			emailRedirectTo: `${origin}/auth/callback`,
		},
	});

	if (error) {
		if (
			error.message.toLowerCase().includes("15 seconds") ||
			error.message.toLowerCase().includes("security")
		) {
			return { error: "Please wait a moment before trying again." };
		}
		if (error.message.toLowerCase().includes("already registered")) {
			// Don't reveal whether the address is registered — show the same
			// "check your email" state. Supabase sends the existing user a
			// "someone tried to sign up with your address" notification.
			return { requiresConfirmation: true, email: formData.get("email") as string };
		}
		return { error: error.message };
	}

	// Session is null when email confirmation is required
	if (!data.session) {
		return { requiresConfirmation: true, email: data.user?.email ?? "" };
	}

	redirect("/dashboard");
}

export async function logout() {
	const supabase = await createClient();
	await supabase.auth.signOut();
	redirect("/login");
}

export async function deleteAccount(): Promise<{ error: string } | never> {
	const supabase = await createClient();

	const { data: { user } } = await supabase.auth.getUser();
	if (!user) return { error: "Not authenticated." };

	// 1. Fail fast — verify service key before touching any data
	const adminUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
	const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!serviceKey) return { error: "Server configuration error. Contact support." };

	const admin = createAdminClient(adminUrl, serviceKey, {
		auth: { autoRefreshToken: false, persistSession: false },
	});

	// 2. Collect storage file paths while the user session is still valid.
	//    Paginate so users with >1000 files get full cleanup.
	const storagePaths: string[] = [];
	const pageSize = 1000;
	let offset = 0;
	while (true) {
		const { data: page } = await supabase.storage
			.from("sequences")
			.list(user.id, { limit: pageSize, offset });
		if (!page || page.length === 0) break;
		for (const f of page) storagePaths.push(`${user.id}/${f.name}`);
		if (page.length < pageSize) break;
		offset += pageSize;
	}

	// 3. Delete the auth user. The sequences table has ON DELETE CASCADE on
	//    user_id, so all sequence rows are removed automatically.
	const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
	if (deleteError) return { error: deleteError.message };

	// 4. Remove storage files using the admin client — the user no longer
	//    exists so the anon client would fail RLS on storage.objects.
	if (storagePaths.length > 0) {
		await admin.storage.from("sequences").remove(storagePaths);
	}

	// 5. Clear the local session and redirect home
	await supabase.auth.signOut();
	redirect("/");
}

export async function requestPasswordReset(formData: FormData) {
	const supabase = await createClient();
	const headersList = await headers();
	const origin =
		headersList.get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "https://ori-bio.app";
	const email = formData.get("email") as string;

	const { error } = await supabase.auth.resetPasswordForEmail(email, {
		redirectTo: `${origin}/auth/callback?next=/reset-password`,
	});

	if (error) return { error: "Could not send the reset email. Please try again." };
	return { success: true };
}

export async function updatePassword(formData: FormData) {
	const supabase = await createClient();
	const password = formData.get("password") as string;

	if (password.length < 8) return { error: "Password must be at least 8 characters." };

	const { error } = await supabase.auth.updateUser({ password });
	if (error) return { error: error.message };

	redirect("/dashboard");
}

export async function changeEmail(formData: FormData): Promise<{ error: string } | { success: true }> {
	const supabase = await createClient();
	const { data: { user } } = await supabase.auth.getUser();
	if (!user) return { error: "Not authenticated." };

	const newEmail = (formData.get("email") as string).trim();
	const { error } = await supabase.auth.updateUser({ email: newEmail });
	if (error) return { error: error.message };
	return { success: true };
}

export async function changePassword(formData: FormData): Promise<{ error: string } | { success: true }> {
	const supabase = await createClient();
	const { data: { user } } = await supabase.auth.getUser();
	if (!user) return { error: "Not authenticated." };

	const newPassword = formData.get("password") as string;
	if (newPassword.length < 8) return { error: "Password must be at least 8 characters." };

	const { error: authError } = await supabase.auth.signInWithPassword({
		email: user.email!,
		password: formData.get("currentPassword") as string,
	});
	if (authError) return { error: "Current password is incorrect." };

	const { error } = await supabase.auth.updateUser({ password: newPassword });
	if (error) return { error: error.message };
	return { success: true };
}

export async function signOutAllDevices(): Promise<{ error: string } | { success: true }> {
	const supabase = await createClient();
	const { error } = await supabase.auth.signOut({ scope: "others" });
	if (error) return { error: error.message };
	return { success: true };
}
