import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

export async function proxy(request: NextRequest) {
	const supabaseKey =
		process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

	// Skip auth check in dev when Supabase env vars aren't available (e.g. no vercel env pull)
	if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !supabaseKey) {
		return NextResponse.next({ request });
	}

	let supabaseResponse = NextResponse.next({ request });

	const supabase = createServerClient(
		// biome-ignore lint/style/noNonNullAssertion: env vars guaranteed by Vercel
		process.env.NEXT_PUBLIC_SUPABASE_URL!,
		supabaseKey,
		{
			cookies: {
				getAll() {
					return request.cookies.getAll();
				},
				setAll(cookiesToSet) {
					for (const { name, value } of cookiesToSet) {
						request.cookies.set(name, value);
					}
					supabaseResponse = NextResponse.next({ request });
					for (const { name, value, options } of cookiesToSet) {
						supabaseResponse.cookies.set(name, value, options);
					}
				},
			},
		},
	);

	const {
		data: { user },
	} = await supabase.auth.getUser();

	const { pathname } = request.nextUrl;
	const isAuthRoute = pathname.startsWith("/login") || pathname.startsWith("/signup");
	const isDashboardRoute =
		pathname.startsWith("/dashboard") ||
		pathname.startsWith("/sequence") ||
		pathname.startsWith("/account") ||
		pathname.startsWith("/trash");

	if (!user && isDashboardRoute) {
		const url = request.nextUrl.clone();
		url.pathname = "/login";
		return NextResponse.redirect(url);
	}

	if (user && isAuthRoute) {
		const url = request.nextUrl.clone();
		url.pathname = "/dashboard";
		return NextResponse.redirect(url);
	}

	return supabaseResponse;
}

export const config = {
	matcher: [
		// Skip static assets AND the auth callback route.
		// /auth/callback must be excluded so the proxy's getUser() call
		// does not consume or invalidate the PKCE code verifier cookie
		// before the route handler can exchange it for a session.
		"/((?!_next/static|_next/image|favicon.ico|auth/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
	],
};
