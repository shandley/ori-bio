import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

// Public endpoint — no auth cookie required.
// Uses service role key to look up the share and generate a signed file URL.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
	const { token } = await params;

	const supabase = createAdminClient(
		// biome-ignore lint/style/noNonNullAssertion: guaranteed by Vercel env
		process.env.NEXT_PUBLIC_SUPABASE_URL!,
		// biome-ignore lint/style/noNonNullAssertion: guaranteed by Vercel env
		(process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)!,
		{ auth: { autoRefreshToken: false, persistSession: false } },
	);

	// Resolve token → sequence
	const { data: share } = await supabase
		.from("sequence_shares")
		.select("sequence_id")
		.eq("token", token)
		.maybeSingle();

	if (!share) {
		return NextResponse.json({ error: "Share not found" }, { status: 404 });
	}

	const { data: seq } = await supabase
		.from("sequences")
		.select("id, name, description, topology, file_format, gc_content, length, file_path")
		.eq("id", share.sequence_id)
		.is("deleted_at", null)
		.maybeSingle();

	if (!seq) {
		return NextResponse.json({ error: "Sequence not found" }, { status: 404 });
	}

	// Generate a 1-hour signed URL for the file
	let fileUrl: string | null = null;
	if (seq.file_path) {
		const { data } = await supabase.storage
			.from("sequences")
			.createSignedUrl(seq.file_path, 3600);
		fileUrl = data?.signedUrl ?? null;
	}

	// Note: view_count increment deferred — needs a Postgres function to avoid race conditions

	return NextResponse.json({ sequence: { ...seq, fileUrl }, token });
}
