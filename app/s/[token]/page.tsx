import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { SequenceViewerWithPanel } from "@/components/sequence/sequence-viewer-with-panel";

export async function generateMetadata({
	params,
}: {
	params: Promise<{ token: string }>;
}): Promise<Metadata> {
	const { token } = await params;
	try {
		const res = await fetch(
			`${process.env.NEXT_PUBLIC_SITE_URL ?? "https://ori-bio.app"}/api/share/${token}`,
			{ next: { revalidate: 60 } },
		);
		if (res.ok) {
			const { sequence } = await res.json();
			return { title: `${sequence.name} — Ori (shared)` };
		}
	} catch {}
	return { title: "Shared sequence — Ori" };
}

function formatLength(bp: number | null) {
	if (!bp) return "—";
	if (bp >= 1000) return `${(bp / 1000).toFixed(1)} kb`;
	return `${bp} bp`;
}

export default async function SharedSequencePage({
	params,
}: {
	params: Promise<{ token: string }>;
}) {
	const { token } = await params;

	const supabase = createAdminClient(
		// biome-ignore lint/style/noNonNullAssertion: guaranteed by Vercel env
		process.env.NEXT_PUBLIC_SUPABASE_URL!,
		// biome-ignore lint/style/noNonNullAssertion: guaranteed by Vercel env
		(process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)!,
		{ auth: { autoRefreshToken: false, persistSession: false } },
	);

	const { data: share } = await supabase
		.from("sequence_shares")
		.select("sequence_id")
		.eq("token", token)
		.maybeSingle();

	if (!share) notFound();

	const { data: seq } = await supabase
		.from("sequences")
		.select("id, name, description, topology, file_format, gc_content, length, file_path")
		.eq("id", share.sequence_id)
		.is("deleted_at", null)
		.maybeSingle();

	if (!seq) notFound();

	let fileUrl: string | null = null;
	if (seq.file_path) {
		const { data } = await supabase.storage
			.from("sequences")
			.createSignedUrl(seq.file_path as string, 3600);
		fileUrl = data?.signedUrl ?? null;
	}

	return (
		<div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
			{/* Shared-page header */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					borderBottom: "1px solid #ddd8ce",
					background: "rgba(245,240,232,0.97)",
					padding: "0 20px",
					flexShrink: 0,
					gap: "16px",
					minHeight: "56px",
				}}
			>
				{/* Left: Ori wordmark + sequence name */}
				<div style={{ display: "flex", alignItems: "center", gap: "16px", overflow: "hidden" }}>
					<Link
						href="/"
						style={{
							fontFamily: "var(--font-playfair)",
							fontSize: "17px",
							color: "#1a4731",
							textDecoration: "none",
							letterSpacing: "-0.01em",
							flexShrink: 0,
						}}
					>
						Ori
					</Link>
					<span style={{ color: "#ddd8ce" }}>·</span>
					<span
						style={{
							fontFamily: "var(--font-karla)",
							fontSize: "14px",
							color: "#1c1a16",
							fontWeight: 500,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
						}}
					>
						{seq.name}
					</span>
					{seq.length && (
						<span
							style={{
								fontFamily: "var(--font-courier)",
								fontSize: "9px",
								color: "#9a9284",
								flexShrink: 0,
							}}
						>
							{formatLength(seq.length)}
						</span>
					)}
				</div>

				{/* Right: download + sign-up CTA */}
				<div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
					{fileUrl && (
						<a
							href={fileUrl}
							download={`${seq.name}.gb`}
							style={{
								fontFamily: "var(--font-courier)",
								fontSize: "9px",
								letterSpacing: "0.08em",
								textTransform: "uppercase",
								color: "#5a5648",
								textDecoration: "none",
								border: "1px solid #ddd8ce",
								padding: "3px 9px",
								borderRadius: "2px",
							}}
						>
							Download
						</a>
					)}
					<Link
						href="/signup"
						style={{
							fontFamily: "var(--font-courier)",
							fontSize: "9px",
							letterSpacing: "0.08em",
							textTransform: "uppercase",
							color: "white",
							background: "#1a4731",
							textDecoration: "none",
							border: "1px solid #1a4731",
							padding: "3px 9px",
							borderRadius: "2px",
						}}
					>
						Open in Ori →
					</Link>
				</div>
			</div>

			{/* Viewer — same component as the authenticated view */}
			<div style={{ flex: 1, overflow: "hidden" }}>
				{fileUrl ? (
					<SequenceViewerWithPanel
						fileUrl={fileUrl}
						name={seq.name}
						topology={seq.topology as "circular" | "linear"}
						fileFormat={seq.file_format as string}
						gcContent={seq.gc_content as number | null}
					/>
				) : (
					<div
						style={{
							display: "flex",
							height: "100%",
							alignItems: "center",
							justifyContent: "center",
							fontFamily: "var(--font-courier)",
							fontSize: "11px",
							color: "#9a9284",
						}}
					>
						Sequence file unavailable
					</div>
				)}
			</div>
		</div>
	);
}
