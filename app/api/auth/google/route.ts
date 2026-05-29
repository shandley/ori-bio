import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

// GET /api/auth/google — initiates Google OAuth with PKCE.
//
// Using a route handler instead of a Server Action guarantees the PKCE code
// verifier cookie is set on the outgoing 302 redirect response, not via the
// Server Action response mechanism which can drop Set-Cookie headers on
// external redirects in some Next.js versions.
export async function GET(request: NextRequest) {
	const origin = request.nextUrl.origin;
	const canonicalUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ori-bio.app";

	const isTrustedOrigin =
		origin === canonicalUrl ||
		origin.endsWith(".vercel.app") ||
		origin.startsWith("http://localhost");
	const redirectBase = isTrustedOrigin ? origin : canonicalUrl;

	const cookieStore = await cookies();

	// Capture cookies Supabase SSR needs to set (the PKCE code verifier).
	// We apply them explicitly to the redirect response so they're guaranteed
	// to be in the 302 headers before the browser navigates to Google.
	const pendingCookies: Array<{ name: string; value: string; options: object }> = [];

	const supabase = createServerClient(
		// biome-ignore lint/style/noNonNullAssertion: env vars guaranteed by Vercel
		process.env.NEXT_PUBLIC_SUPABASE_URL!,
		// biome-ignore lint/style/noNonNullAssertion: env vars guaranteed by Vercel
		(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
		{
			cookies: {
				getAll: () => cookieStore.getAll(),
				setAll: (cookiesToSet) => {
					for (const c of cookiesToSet) pendingCookies.push(c);
				},
			},
		},
	);

	const { data, error } = await supabase.auth.signInWithOAuth({
		provider: "google",
		options: { redirectTo: `${redirectBase}/auth/callback` },
	});

	if (error || !data.url) {
		console.error("[api/auth/google] signInWithOAuth failed:", error?.message);
		return NextResponse.redirect(new URL("/login?error=oauth_failed", origin));
	}

	// 302 to Google — PKCE verifier cookies explicitly applied to this response.
	const response = NextResponse.redirect(data.url);
	for (const { name, value, options } of pendingCookies) {
		response.cookies.set({ name, value, ...(options as object) });
	}
	return response;
}
