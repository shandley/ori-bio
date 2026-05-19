import { createClient } from "@supabase/supabase-js";
import type { Metadata } from "next";
import { LibraryClient } from "./library-client";

export const metadata: Metadata = {
	title: "Plasmid Library — Ori",
	description:
		"Browse 200+ common research plasmids with consistent canonical annotations. Open any plasmid directly in Ori.",
};

export interface LibraryPlasmid {
	id: string;
	slug: string;
	name: string;
	description: string;
	source: string;
	accession: string | null;
	topology: "circular" | "linear";
	length: number;
	gc_content: number | null;
	file_path: string;
	categories: string[];
	key_features: string[];
	is_featured: boolean;
}

export default async function LibraryPage() {
	// biome-ignore lint/style/noNonNullAssertion: guaranteed by Vercel env
	const supabase = createClient(
		process.env.NEXT_PUBLIC_SUPABASE_URL!,
		(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
	);

	const { data } = await supabase
		.from("plasmid_library")
		.select(
			"id,slug,name,description,source,accession,topology,length,gc_content,file_path,categories,key_features,is_featured",
		)
		.order("is_featured", { ascending: false })
		.order("name");

	return <LibraryClient initialPlasmids={(data ?? []) as LibraryPlasmid[]} />;
}
