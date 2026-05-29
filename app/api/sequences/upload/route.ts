import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function detectFormat(filename: string): "genbank" | "fasta" | "dna" | "embl" {
	const ext = filename.split(".").pop()?.toLowerCase() ?? "";
	if (ext === "gb" || ext === "gbk" || ext === "genbank") return "genbank";
	if (ext === "fa" || ext === "fasta" || ext === "fna" || ext === "ffn") return "fasta";
	if (ext === "dna") return "dna";
	if (ext === "embl" || ext === "em") return "embl";
	return "genbank";
}

function detectTopology(content: string): "circular" | "linear" {
	if (content.includes("CIRCULAR") || content.includes("circular")) return "circular";
	if (content.includes("topology=circular")) return "circular";
	return "linear";
}

function extractLength(content: string, format: string): number | null {
	if (format === "genbank") {
		const match = content.match(/LOCUS\s+\S+\s+(\d+)\s+bp/);
		return match ? parseInt(match[1], 10) : null;
	}
	if (format === "fasta") {
		const seq = content.replace(/>.*\n/g, "").replace(/\s/g, "");
		return seq.length || null;
	}
	return null;
}

function extractName(content: string, filename: string, format: string): string {
	if (format === "genbank") {
		const match = content.match(/LOCUS\s+(\S+)/);
		if (match) return match[1];
	}
	if (format === "fasta") {
		const match = content.match(/^>(\S+)/);
		if (match) return match[1];
	}
	return filename.replace(/\.[^.]+$/, "");
}

function computeGC(content: string, format: string): number | null {
	let seq = "";
	if (format === "fasta") {
		seq = content.replace(/>.*\n/g, "").replace(/\s/g, "").toUpperCase();
	} else if (format === "genbank") {
		const originMatch = content.match(/ORIGIN([\s\S]*?)\/\//);
		if (originMatch) {
			seq = originMatch[1].replace(/[\d\s]/g, "").toUpperCase();
		}
	}
	if (!seq) return null;
	const gc = (seq.split("").filter((b) => b === "G" || b === "C").length / seq.length) * 100;
	return Math.round(gc * 100) / 100;
}

export async function POST(request: Request) {
	const supabase = await createClient();

	const {
		data: { user },
	} = await supabase.auth.getUser();

	if (!user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const formData = await request.formData();
	const file = formData.get("file") as File | null;

	if (!file) {
		return NextResponse.json({ error: "No file provided" }, { status: 400 });
	}

	const content = await file.text();
	const format = detectFormat(file.name);
	const name = extractName(content, file.name, format);
	const topology = detectTopology(content);
	const length = extractLength(content, format);
	const gcContent = computeGC(content, format);

	const safeFilename = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
	const filePath = `${user.id}/${Date.now()}_${safeFilename}`;
	const { error: storageError } = await supabase.storage
		.from("sequences")
		.upload(filePath, file, { contentType: "text/plain" });

	if (storageError) {
		return NextResponse.json({ error: storageError.message }, { status: 500 });
	}

	const { data: seq, error: dbError } = await supabase
		.from("sequences")
		.insert({
			user_id: user.id,
			name,
			description: "",
			topology,
			length,
			gc_content: gcContent,
			file_path: filePath,
			file_format: format,
		})
		.select()
		.single();

	if (dbError) {
		await supabase.storage.from("sequences").remove([filePath]);
		return NextResponse.json({ error: dbError.message }, { status: 500 });
	}

	return NextResponse.json({ sequence: seq });
}
