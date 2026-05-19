import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

interface LibraryEntry {
	slug: string;
	name: string;
	description: string;
	categories: string[];
	key_features: string[];
	length: number;
	topology: string;
}

interface Recommendation {
	slug: string;
	name: string;
	reason: string;
}

export async function POST(req: NextRequest) {
	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (!user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { query, library } = (await req.json()) as {
		query: string;
		library: LibraryEntry[];
	};

	if (!query?.trim() || !library?.length) {
		return Response.json({ recommendations: [] });
	}

	// Compact library representation for the prompt
	const libraryText = library
		.map(
			(p) =>
				`${p.slug} | ${p.name} | ${p.topology} ${p.length}bp | ${p.categories.join(",")} | features: ${p.key_features.join(",")}`,
		)
		.join("\n");

	const systemPrompt = `You are a molecular biology assistant helping researchers find plasmids.
You will receive a list of available plasmids and a user's query.
Return the 3-5 most relevant plasmids as a JSON object with this exact format:
{"recommendations": [{"slug": "puc19", "name": "pUC19", "reason": "one sentence explanation"}]}

Rules:
- Only return plasmids from the provided list (use the exact slug)
- Reason should be one concrete sentence explaining the match
- If nothing matches well, return fewer recommendations — never force a bad match
- Return only valid JSON, no other text`;

	const { text } = await generateText({
		model: anthropic("claude-haiku-4-5-20251001"),
		system: systemPrompt,
		prompt: `Available plasmids:\n${libraryText}\n\nUser query: ${query}`,
		maxOutputTokens: 1024,
	});

	let recommendations: Recommendation[] = [];
	try {
		// Extract JSON from the response (handle markdown code blocks if present)
		const jsonMatch = text.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			const parsed = JSON.parse(jsonMatch[0]) as { recommendations: Recommendation[] };
			recommendations = parsed.recommendations ?? [];
		}
	} catch {
		recommendations = [];
	}

	return Response.json({ recommendations });
}
