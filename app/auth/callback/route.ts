import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
	const { searchParams, origin } = new URL(request.url);
	const code = searchParams.get("code");
	const rawNext = searchParams.get("next") ?? "/dashboard";
	const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/dashboard";

	// Supabase puts error details in query params when the link is invalid/expired
	const errorCode = searchParams.get("error_code");
	if (errorCode) {
		return NextResponse.redirect(`${origin}/login?error_code=${errorCode}`);
	}

	if (code) {
		const supabase = await createClient();
		const { error } = await supabase.auth.exchangeCodeForSession(code);
		if (!error) {
			return NextResponse.redirect(`${origin}${next}`);
		}
		console.error("[auth/callback] exchangeCodeForSession failed:", error.message, error.code ?? "");
		// Use a distinct error key so the login page can show a targeted message
		// rather than the generic "confirmation link expired" text.
		return NextResponse.redirect(`${origin}/login?error=oauth_exchange_failed`);
	}

	return NextResponse.redirect(`${origin}/login?error=confirmation_failed`);
}
