"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { login } from "@/app/actions/auth";

function GoogleIcon() {
	return (
		<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
			<path
				fill="#4285F4"
				d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"
			/>
			<path
				fill="#34A853"
				d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
			/>
			<path
				fill="#FBBC05"
				d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"
			/>
			<path
				fill="#EA4335"
				d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58Z"
			/>
		</svg>
	);
}

const URL_ERROR_MESSAGES: Record<string, string> = {
	confirmation_failed:
		"That confirmation link is invalid or has expired. Please sign up again to get a new one.",
	otp_expired: "That confirmation link has expired. Please sign up again to get a new one.",
	access_denied: "That confirmation link is no longer valid. Please sign up again.",
	oauth_failed:
		"Google sign-in could not start. If you're on a university VPN, try disconnecting first.",
	oauth_exchange_failed:
		"Google sign-in was interrupted. Please try again — if the problem persists, use email/password login.",
};

const inputStyle: React.CSSProperties = {
	width: "100%",
	padding: "10px 14px",
	fontFamily: "var(--font-karla)",
	fontSize: "14px",
	color: "#1c1a16",
	background: "#faf7f2",
	border: "1px solid #ddd8ce",
	borderRadius: "4px",
	outline: "none",
	transition: "border-color 0.15s",
};

const labelStyle: React.CSSProperties = {
	display: "block",
	fontFamily: "var(--font-courier)",
	fontSize: "9px",
	letterSpacing: "0.12em",
	textTransform: "uppercase",
	color: "#5a5648",
	marginBottom: "6px",
};

function LoginForm() {
	const searchParams = useSearchParams();
	const urlError = searchParams.get("error_code") ?? searchParams.get("error") ?? null;
	const urlErrorMessage = urlError
		? (URL_ERROR_MESSAGES[urlError] ?? "Something went wrong. Please try again.")
		: null;

	const [error, setError] = useState<string | null>(urlErrorMessage);
	const [loading, setLoading] = useState(false);

	async function handleSubmit(formData: FormData) {
		setLoading(true);
		setError(null);
		const result = await login(formData);
		if (result?.error) {
			setError(result.error);
			setLoading(false);
		}
	}

	return (
		<div
			style={{
				width: "100%",
				maxWidth: "380px",
				background: "#faf7f2",
				border: "1px solid #ddd8ce",
				borderRadius: "4px",
				padding: "40px 36px",
			}}
		>
			{/* Header */}
			<div
				style={{ marginBottom: "28px", paddingBottom: "20px", borderBottom: "1px solid #ddd8ce" }}
			>
				<h1
					style={{
						fontFamily: "var(--font-playfair)",
						fontSize: "26px",
						fontWeight: 400,
						color: "#1c1a16",
						letterSpacing: "-0.01em",
						marginBottom: "6px",
					}}
				>
					Sign in
				</h1>
				<p
					style={{
						fontFamily: "var(--font-karla)",
						fontSize: "13px",
						fontWeight: 300,
						color: "#5a5648",
					}}
				>
					Enter your email and password to continue.
				</p>
			</div>

			{/* Google OAuth — link to route handler so PKCE cookie is set on the 302 */}
			<a
				href="/api/auth/google"
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					gap: "10px",
					padding: "11px 16px",
					marginBottom: "20px",
					background: "#ffffff",
					border: "1px solid #ddd8ce",
					borderRadius: "4px",
					cursor: "pointer",
					fontFamily: "var(--font-karla)",
					fontSize: "14px",
					fontWeight: 500,
					color: "#1c1a16",
					letterSpacing: "0.01em",
					textDecoration: "none",
					transition: "border-color 0.15s, background 0.15s",
				}}
				onMouseEnter={(e) => {
					(e.currentTarget as HTMLAnchorElement).style.borderColor = "#9a9284";
					(e.currentTarget as HTMLAnchorElement).style.background = "#f5f0e8";
				}}
				onMouseLeave={(e) => {
					(e.currentTarget as HTMLAnchorElement).style.borderColor = "#ddd8ce";
					(e.currentTarget as HTMLAnchorElement).style.background = "#ffffff";
				}}
			>
				<GoogleIcon />
				Continue with Google
			</a>

			{/* Divider */}
			<div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
				<div style={{ flex: 1, height: "1px", background: "#ddd8ce" }} />
				<span
					style={{
						fontFamily: "var(--font-courier)",
						fontSize: "8.5px",
						letterSpacing: "0.1em",
						textTransform: "uppercase",
						color: "#b8b0a4",
					}}
				>
					or
				</span>
				<div style={{ flex: 1, height: "1px", background: "#ddd8ce" }} />
			</div>

			<form action={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
				<div>
					<label htmlFor="email" style={labelStyle}>
						Email
					</label>
					<input
						id="email"
						name="email"
						type="email"
						placeholder="you@lab.edu"
						required
						style={inputStyle}
						onFocus={(e) => {
							e.target.style.borderColor = "#1a4731";
						}}
						onBlur={(e) => {
							e.target.style.borderColor = "#ddd8ce";
						}}
					/>
				</div>
				<div>
					<label htmlFor="password" style={labelStyle}>
						Password
					</label>
					<input
						id="password"
						name="password"
						type="password"
						required
						style={inputStyle}
						onFocus={(e) => {
							e.target.style.borderColor = "#1a4731";
						}}
						onBlur={(e) => {
							e.target.style.borderColor = "#ddd8ce";
						}}
					/>
				</div>

				{error && (
					<p
						style={{
							fontFamily: "var(--font-karla)",
							fontSize: "13px",
							color: "#8b3a2a",
							padding: "10px 14px",
							background: "rgba(139,58,42,0.06)",
							border: "1px solid rgba(139,58,42,0.2)",
							borderRadius: "4px",
						}}
					>
						{error}
					</p>
				)}

				<button
					type="submit"
					disabled={loading}
					style={{
						width: "100%",
						padding: "12px",
						background: loading ? "#2d7a54" : "#1a4731",
						color: "white",
						fontFamily: "var(--font-karla)",
						fontSize: "14px",
						fontWeight: 500,
						border: "none",
						borderRadius: "4px",
						cursor: loading ? "not-allowed" : "pointer",
						letterSpacing: "0.02em",
						transition: "opacity 0.15s",
						opacity: loading ? 0.75 : 1,
					}}
				>
					{loading ? "Signing in…" : "Sign in"}
				</button>
			</form>

			<div
				style={{
					marginTop: "24px",
					display: "flex",
					justifyContent: "space-between",
					fontFamily: "var(--font-karla)",
					fontSize: "13px",
					color: "#5a5648",
				}}
			>
				<Link
					href="/forgot-password"
					style={{ color: "#9a9284", textDecoration: "none", borderBottom: "1px solid #ddd8ce" }}
				>
					Forgot password?
				</Link>
				<span>
					No account?{" "}
					<Link
						href="/signup"
						style={{ color: "#1a4731", textDecoration: "none", borderBottom: "1px solid #1a4731" }}
					>
						Sign up
					</Link>
				</span>
			</div>

			{/* VPN hint */}
			<p
				style={{
					marginTop: "20px",
					paddingTop: "16px",
					borderTop: "1px solid #ece6d8",
					fontFamily: "var(--font-karla)",
					fontSize: "11px",
					color: "#b8b0a4",
					lineHeight: 1.6,
					textAlign: "center",
				}}
			>
				On a university VPN and seeing connection errors? <br />
				Try disconnecting your VPN, or ask IT to whitelist{" "}
				<span style={{ fontFamily: "var(--font-courier)", fontSize: "10px" }}>ori-bio.app</span>.
			</p>
		</div>
	);
}

export default function LoginPage() {
	return (
		<Suspense>
			<LoginForm />
		</Suspense>
	);
}
