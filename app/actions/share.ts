"use server";

import { createClient } from "@/lib/supabase/server";

/** 8-char URL-safe token, avoids ambiguous characters (0/O, I/l/1) */
function generateToken(): string {
	const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export interface ShareResult {
	token: string;
	url: string;
}

/**
 * Create a share link for a sequence, or return the existing one if already shared.
 * Returns the share token and the full shareable URL.
 */
export async function createOrGetShare(sequenceId: string): Promise<ShareResult> {
	const supabase = await createClient();

	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (!user) throw new Error("Not authenticated");

	// Return existing share if one already exists
	const { data: existing } = await supabase
		.from("sequence_shares")
		.select("token")
		.eq("sequence_id", sequenceId)
		.eq("created_by", user.id)
		.maybeSingle();

	if (existing?.token) {
		const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ori-bio.app";
		return { token: existing.token, url: `${siteUrl}/s/${existing.token}` };
	}

	// Create new share with a unique token
	let token = generateToken();
	let attempts = 0;

	while (attempts < 5) {
		const { error } = await supabase.from("sequence_shares").insert({
			token,
			sequence_id: sequenceId,
			created_by: user.id,
		});
		if (!error) break;
		// Token collision — try a new one
		token = generateToken();
		attempts++;
	}

	const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ori-bio.app";
	return { token, url: `${siteUrl}/s/${token}` };
}
