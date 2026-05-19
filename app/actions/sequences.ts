"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** Soft-delete: sets deleted_at, does NOT remove storage or the row. */
export async function deleteSequence(id: string) {
	const supabase = await createClient();
	const { data: { user } } = await supabase.auth.getUser();
	if (!user) return { error: "Not authenticated" };
	const { error } = await supabase
		.from("sequences")
		.update({ deleted_at: new Date().toISOString() })
		.eq("id", id);
	if (error) return { error: error.message };
	revalidatePath("/dashboard");
	revalidatePath("/trash");
	return { success: true };
}

/** Restore a soft-deleted sequence back to the library. */
export async function restoreSequence(id: string) {
	const supabase = await createClient();
	const { data: { user } } = await supabase.auth.getUser();
	if (!user) return { error: "Not authenticated" };
	const { error } = await supabase.from("sequences").update({ deleted_at: null }).eq("id", id);
	if (error) return { error: error.message };
	revalidatePath("/dashboard");
	revalidatePath("/trash");
	return { success: true };
}

/** Permanently delete: removes storage file and the DB row. */
export async function permanentlyDeleteSequence(id: string) {
	const supabase = await createClient();
	const { data: { user } } = await supabase.auth.getUser();
	if (!user) return { error: "Not authenticated" };

	const { data: rawSeq } = await supabase
		.from("sequences")
		.select("file_path")
		.eq("id", id)
		.single();
	const seq = rawSeq as { file_path: string | null } | null;

	if (seq?.file_path) {
		await supabase.storage.from("sequences").remove([seq.file_path]);
	}

	const { error } = await supabase.from("sequences").delete().eq("id", id);
	if (error) return { error: error.message };

	revalidatePath("/trash");
	return { success: true };
}

export async function updateSequenceName(id: string, name: string) {
	const supabase = await createClient();
	const { data: { user } } = await supabase.auth.getUser();
	if (!user) return { error: "Not authenticated" };
	const { error } = await supabase.from("sequences").update({ name }).eq("id", id);
	if (error) return { error: error.message };
	revalidatePath("/dashboard");
	revalidatePath(`/sequence/${id}`);
	return { success: true };
}

export async function updateSequenceMetadata(
	id: string,
	updates: { description?: string; topology?: "circular" | "linear" },
) {
	const supabase = await createClient();
	const { data: { user } } = await supabase.auth.getUser();
	if (!user) return { error: "Not authenticated" };
	const { error } = await supabase.from("sequences").update(updates).eq("id", id);
	if (error) return { error: error.message };
	revalidatePath("/dashboard");
	revalidatePath(`/sequence/${id}`);
	return { success: true };
}

export async function saveClonedSequence(
	resultSeq: string,
	productName: string,
	topology: "circular" | "linear",
): Promise<{ id?: string; error?: string }> {
	const supabase = await createClient();
	const {
		data: { user },
		error: authError,
	} = await supabase.auth.getUser();
	if (authError || !user) return { error: "Not authenticated" };

	const fasta = `>${productName}\n${resultSeq}\n`;
	const blob = new Blob([fasta], { type: "text/plain" });
	const fileName = `${user.id}/${randomUUID()}.fasta`;

	const { error: uploadError } = await supabase.storage.from("sequences").upload(fileName, blob);
	if (uploadError) return { error: uploadError.message };

	const upper = resultSeq.toUpperCase();
	const gcCount = upper.split("").filter((c) => c === "G" || c === "C").length;
	const gc = Math.round((gcCount / upper.length) * 1000) / 10;

	const { data, error: insertError } = await supabase
		.from("sequences")
		.insert({
			user_id: user.id,
			name: productName,
			description: "RE cloning product",
			topology,
			length: resultSeq.length,
			gc_content: gc,
			file_path: fileName,
			file_format: "fasta",
		})
		.select("id")
		.single();

	if (insertError) return { error: insertError.message };

	revalidatePath("/dashboard");
	return { id: (data as { id: string }).id };
}

/** Save an AI-designed construct as a GenBank file so annotations are preserved. */
export async function saveDesignedConstruct(
	gbContent: string,
	name: string,
	seqLength: number,
	gcContent: number,
): Promise<{ id?: string; error?: string }> {
	const supabase = await createClient();
	const {
		data: { user },
		error: authError,
	} = await supabase.auth.getUser();
	if (authError || !user) return { error: "Not authenticated" };

	const blob = new Blob([gbContent], { type: "text/plain" });
	const fileName = `${user.id}/${randomUUID()}.gb`;

	const { error: uploadError } = await supabase.storage.from("sequences").upload(fileName, blob);
	if (uploadError) return { error: uploadError.message };

	const { data, error: insertError } = await supabase
		.from("sequences")
		.insert({
			user_id: user.id,
			name,
			description: "Designed with Ori AI Construct Designer",
			topology: "circular",
			length: seqLength,
			gc_content: Math.round(gcContent * 10) / 10,
			file_path: fileName,
			file_format: "genbank",
		})
		.select("id")
		.single();

	if (insertError) return { error: insertError.message };

	revalidatePath("/dashboard");
	return { id: (data as { id: string }).id };
}
