import { createClient } from "@supabase/supabase-js";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SaveToLibraryButton } from "@/components/library/save-to-library-button";
import { SequenceViewerWithPanel } from "@/components/sequence/sequence-viewer-with-panel";
import { createClient as createServerClient } from "@/lib/supabase/server";

export async function generateMetadata({
	params,
}: {
	params: Promise<{ slug: string }>;
}): Promise<Metadata> {
	const { slug } = await params;
	// biome-ignore lint/style/noNonNullAssertion: guaranteed by Vercel env
	const supabase = createClient(
		process.env.NEXT_PUBLIC_SUPABASE_URL!,
		(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
	);
	const { data } = await supabase
		.from("plasmid_library")
		.select("name,description")
		.eq("slug", slug)
		.maybeSingle();
	if (!data) return { title: "Plasmid — Ori" };
	return { title: `${data.name} — Ori Library`, description: data.description };
}

function formatLen(bp: number) {
	return bp >= 1000 ? `${(bp / 1000).toFixed(1)} kb` : `${bp} bp`;
}

export default async function LibraryPlasmidPage({
	params,
}: {
	params: Promise<{ slug: string }>;
}) {
	const { slug } = await params;

	// biome-ignore lint/style/noNonNullAssertion: guaranteed by Vercel env
	const supabase = createClient(
		process.env.NEXT_PUBLIC_SUPABASE_URL!,
		(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
	);

	// Check auth in parallel with plasmid fetch
	const [{ data: plasmid }, authClient] = await Promise.all([
		supabase.from("plasmid_library").select("*").eq("slug", slug).maybeSingle(),
		createServerClient(),
	]);

	if (!plasmid) notFound();

	const {
		data: { user },
	} = await authClient.auth.getUser();
	const isLoggedIn = !!user;

	// Public bucket URL — no signing needed
	const fileUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/plasmid-library/${plasmid.file_path}`;

	return (
		<div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
			{/* Header */}
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
					minHeight: "52px",
				}}
			>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: "12px",
						overflow: "hidden",
						flex: 1,
					}}
				>
					<Link
						href="/library"
						style={{
							fontFamily: "var(--font-courier)",
							fontSize: "8.5px",
							color: "#9a9284",
							textDecoration: "none",
							letterSpacing: "0.06em",
							textTransform: "uppercase",
							flexShrink: 0,
						}}
					>
						← Library
					</Link>
					<span style={{ color: "#ddd8ce" }}>·</span>
					<span
						style={{
							fontFamily: "var(--font-playfair)",
							fontSize: "15px",
							color: "#1c1a16",
							fontWeight: 600,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
						}}
					>
						{plasmid.name}
					</span>
					<span
						style={{
							fontFamily: "var(--font-courier)",
							fontSize: "9px",
							color: "#9a9284",
							flexShrink: 0,
						}}
					>
						{formatLen(plasmid.length)}
					</span>
					{plasmid.source && (
						<span
							style={{
								fontFamily: "var(--font-courier)",
								fontSize: "8px",
								color: "#b8b0a4",
								flexShrink: 0,
							}}
						>
							{plasmid.source}
						</span>
					)}
				</div>

				<div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
					<a
						href={fileUrl}
						download={`${plasmid.name}.gb`}
						style={{
							fontFamily: "var(--font-courier)",
							fontSize: "9px",
							letterSpacing: "0.08em",
							textTransform: "uppercase",
							color: "#5a5648",
							textDecoration: "none",
							border: "1px solid #ddd8ce",
							padding: "4px 10px",
							borderRadius: "2px",
						}}
					>
						Download
					</a>
					<SaveToLibraryButton slug={plasmid.slug} isLoggedIn={isLoggedIn} />
				</div>
			</div>

			{/* Viewer */}
			<div style={{ flex: 1, overflow: "hidden" }}>
				<SequenceViewerWithPanel
					fileUrl={fileUrl}
					name={plasmid.name}
					topology={plasmid.topology as "circular" | "linear"}
					fileFormat="genbank"
					gcContent={plasmid.gc_content ?? null}
				/>
			</div>
		</div>
	);
}
