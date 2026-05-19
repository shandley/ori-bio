"use server";

import type { OverrideMap } from "@/components/sequence/annotation-editor";
import { createClient } from "@/lib/supabase/server";

export async function loadAnnotationOverrides(sequenceId: string): Promise<OverrideMap> {
	const supabase = await createClient();
	const { data: { user } } = await supabase.auth.getUser();
	if (!user) return {};
	const { data } = await supabase
		.from("sequences")
		.select("annotation_overrides")
		.eq("id", sequenceId)
		.maybeSingle();
	return (data?.annotation_overrides as OverrideMap | null) ?? {};
}

export async function saveAnnotationOverrides(
	sequenceId: string,
	overrides: OverrideMap,
): Promise<{ error?: string }> {
	const supabase = await createClient();
	const { data: { user } } = await supabase.auth.getUser();
	if (!user) return { error: "Not authenticated" };
	const { error } = await supabase
		.from("sequences")
		// biome-ignore lint/suspicious/noExplicitAny: OverrideMap is a valid JSON object; Supabase Json type is too narrow
		.update({ annotation_overrides: overrides as any })
		.eq("id", sequenceId);
	if (error) return { error: error.message };
	return {};
}
