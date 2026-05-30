"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
	href: string;
	label: string;
	activeOn: string | null;
	external?: boolean;
};

const NAV: ReadonlyArray<NavItem> = [
	{ href: "/#features", label: "Features", activeOn: null },
	{ href: "/library", label: "Library", activeOn: "/library" },
	{ href: "/primers", label: "Primers", activeOn: "/primers" },
	{ href: "/sanger", label: "Sanger", activeOn: "/sanger" },
	{ href: "/crispr", label: "CRISPR", activeOn: "/crispr" },
	{ href: "https://github.com/shandley/ori-bio", label: "GitHub", activeOn: null, external: true },
];

export function SiteNav() {
	const pathname = usePathname() ?? "";

	return (
		<header
			style={{
				height: "60px",
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				borderBottom: "1px solid #ddd8ce",
				background: "rgba(245,240,232,0.97)",
				backdropFilter: "blur(8px)",
				padding: "0 56px",
				flexShrink: 0,
				position: "sticky",
				top: 0,
				zIndex: 50,
			}}
		>
			<Link
				href="/"
				style={{
					textDecoration: "none",
					display: "flex",
					alignItems: "baseline",
					gap: "12px",
				}}
			>
				<span
					style={{
						fontFamily: "var(--font-playfair)",
						fontSize: "26px",
						fontWeight: 400,
						letterSpacing: "-0.01em",
						color: "#1c1a16",
					}}
				>
					Ori
				</span>
				<span
					style={{
						fontFamily: "var(--font-courier)",
						fontSize: "10px",
						fontStyle: "italic",
						color: "#9a9284",
						letterSpacing: "0.04em",
					}}
				>
					molecular workbench
				</span>
			</Link>

			<nav style={{ display: "flex", alignItems: "center", gap: "32px" }}>
				{NAV.map((item) => {
					const isActive =
						item.activeOn !== null &&
						(pathname === item.activeOn || pathname.startsWith(`${item.activeOn}/`));
					return (
						<Link
							key={item.label}
							href={item.href}
							{...(item.external ? { target: "_blank", rel: "noreferrer" } : {})}
							className="landing-nav-link"
							style={{
								fontFamily: "var(--font-karla)",
								fontSize: "13px",
								color: isActive ? "#1a4731" : "#5a5648",
								fontWeight: isActive ? 500 : 400,
								textDecoration: "none",
								borderBottom: isActive ? "1px solid #1a4731" : "none",
								paddingBottom: isActive ? "1px" : "0",
							}}
						>
							{item.label}
						</Link>
					);
				})}
			</nav>

			<div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
				<Link
					href="/login"
					style={{
						fontFamily: "var(--font-karla)",
						fontSize: "13px",
						color: "#5a5648",
						textDecoration: "none",
					}}
				>
					Sign in
				</Link>
				<Link
					href="/signup"
					style={{
						fontFamily: "var(--font-karla)",
						fontSize: "13px",
						fontWeight: 500,
						background: "#1a4731",
						color: "white",
						textDecoration: "none",
						padding: "8px 22px",
						borderRadius: "4px",
						letterSpacing: "0.02em",
					}}
				>
					Get started
				</Link>
			</div>
		</header>
	);
}
