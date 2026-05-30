/**
 * Pairwise local alignment of Sanger sequencing reads against a plasmid.
 *
 * Algorithm: Smith-Waterman with affine gap penalties.
 * Both strands are searched; circular sequences are handled by doubling
 * the reference before alignment.
 *
 * Typical input: Sanger read 600–900 bp against plasmid 2–10 kb.
 * Runtime: ~100–300 ms per read in a Web Worker.
 */

// ── Scoring ───────────────────────────────────────────────────────────────────

const MATCH      =  2;
const MISMATCH   = -3;
const GAP_OPEN   = -5;
const GAP_EXTEND = -2;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Mismatch {
	/** 0-indexed position on reference */
	refPos: number;
	/** 0-indexed position on query */
	queryPos: number;
	refBase: string;
	queryBase: string;
	/** Phred quality score at this query position (if available) */
	qualityScore?: number;
}

export interface AlignmentResult {
	/** 0-indexed start on reference (inclusive) */
	refStart: number;
	/** 0-indexed end on reference (exclusive) */
	refEnd: number;
	/** 0-indexed start on query */
	queryStart: number;
	/** 0-indexed end on query */
	queryEnd: number;
	strand: "+" | "-";
	/** Smith-Waterman alignment score */
	score: number;
	/** Fraction of aligned positions that are identical [0, 1] */
	identity: number;
	/** Coverage as fraction of query length [0, 1] */
	coverage: number;
	mismatches: Mismatch[];
	/** Aligned reference string (with gaps as "-") */
	refAligned: string;
	/** Aligned query string (with gaps as "-") */
	queryAligned: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const RC_TABLE: Record<string, string> = {
	A: "T", T: "A", G: "C", C: "G", N: "N",
	a: "t", t: "a", g: "c", c: "g", n: "n",
};

function reverseComplement(seq: string): string {
	let rc = "";
	for (let i = seq.length - 1; i >= 0; i--) {
		rc += RC_TABLE[seq[i]!] ?? "N";
	}
	return rc;
}

function sub(a: string, b: string): number {
	return a.toUpperCase() === b.toUpperCase() ? MATCH : MISMATCH;
}

// ── Core Smith-Waterman ───────────────────────────────────────────────────────

/**
 * Compute the Smith-Waterman local alignment matrix and return the traceback
 * starting from the maximum-score cell.
 */
export function smithWaterman(
	query: string,
	ref: string,
): { refStart: number; refEnd: number; queryStart: number; queryEnd: number;
    score: number; refAligned: string; queryAligned: string } {
	const m = query.length;
	const n = ref.length;
	const stride = n + 1;

	// H[i][j]: best score ending at query[i-1], ref[j-1]
	const H = new Float32Array((m + 1) * stride);
	// E[j]: best score with gap in query ending at ref[j-1]
	const E = new Float32Array(n + 1);
	// Traceback: 0=none, 1=diag, 2=up, 3=left
	const T = new Uint8Array((m + 1) * stride);

	let maxScore = 0;
	let maxI = 0;
	let maxJ = 0;

	for (let i = 1; i <= m; i++) {
		let F = 0; // gap in ref ending at query[i-1]
		for (let j = 1; j <= n; j++) {
			const idx = i * stride + j;
			const diag = H[(i - 1) * stride + (j - 1)]! + sub(query[i - 1]!, ref[j - 1]!);

			// Affine gap: E[j] = max(H[i][j-1] + GAP_OPEN, E[j] + GAP_EXTEND) — gap in query
			//             F    = max(H[i-1][j] + GAP_OPEN, F    + GAP_EXTEND) — gap in ref
			const eOpen = H[i * stride + (j - 1)]! + GAP_OPEN;
			const eExt  = E[j]! + GAP_EXTEND;
			E[j] = Math.max(eOpen, eExt);

			const fOpen = H[(i - 1) * stride + j]! + GAP_OPEN;
			F = Math.max(fOpen, F + GAP_EXTEND);

			const best = Math.max(0, diag, E[j]!, F);
			H[idx] = best;

			// Traceback priority: diagonal > gap-in-query > gap-in-ref
			if (best === 0)    T[idx] = 0;
			else if (best === diag) T[idx] = 1;
			else if (best === E[j]) T[idx] = 3;  // gap in query
			else                    T[idx] = 2;  // gap in ref

			if (best > maxScore) {
				maxScore = best;
				maxI = i; maxJ = j;
			}
		}
	}

	if (maxScore === 0) {
		return { refStart: 0, refEnd: 0, queryStart: 0, queryEnd: 0, score: 0, refAligned: "", queryAligned: "" };
	}

	// ── Traceback ─────────────────────────────────────────────────────────────
	let refAligned   = "";
	let queryAligned = "";
	let i = maxI;
	let j = maxJ;

	while (i > 0 && j > 0 && H[i * stride + j]! > 0) {
		const dir = T[i * stride + j]!;
		if (dir === 1) {
			refAligned   = ref[j - 1]!   + refAligned;
			queryAligned = query[i - 1]! + queryAligned;
			i--; j--;
		} else if (dir === 3) {
			refAligned   = ref[j - 1]! + refAligned;
			queryAligned = "-"          + queryAligned;
			j--;
		} else if (dir === 2) {
			refAligned   = "-"           + refAligned;
			queryAligned = query[i - 1]! + queryAligned;
			i--;
		} else break;
	}

	return {
		refStart:    j,           // 0-indexed (after decrement in loop)
		refEnd:      maxJ,
		queryStart:  i,
		queryEnd:    maxI,
		score:       maxScore,
		refAligned,
		queryAligned,
	};
}

// ── Mismatch extraction ───────────────────────────────────────────────────────

export function extractMismatches(
	refAligned:   string,
	queryAligned: string,
	refStart:     number,
	queryStart:   number,
	quality?:     number[],
): Mismatch[] {
	const mismatches: Mismatch[] = [];
	let refPos   = refStart;
	let queryPos = queryStart;

	for (let k = 0; k < refAligned.length; k++) {
		const r = refAligned[k]!;
		const q = queryAligned[k]!;

		if (r === "-") {
			queryPos++; // gap in ref = insertion in query
		} else if (q === "-") {
			refPos++;   // gap in query = deletion from ref
		} else {
			if (r.toUpperCase() !== q.toUpperCase() && q.toUpperCase() !== "N") {
				mismatches.push({
					refPos,
					queryPos,
					refBase:   r.toUpperCase(),
					queryBase: q.toUpperCase(),
					qualityScore: quality?.[queryPos],
				});
			}
			refPos++;
			queryPos++;
		}
	}
	return mismatches;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Align a single Sanger read to a reference sequence.
 * Searches both strands; for circular sequences the reference is doubled
 * to allow alignments that span the origin.
 */
export function alignRead(
	query: string,
	reference: string,
	topology: "circular" | "linear",
	quality?: number[],
): AlignmentResult {
	const refLen = reference.length;

	// For circular: double the reference so alignments spanning the origin work
	const searchRef = topology === "circular" ? reference + reference : reference;

	// Forward strand
	const fwd = smithWaterman(query.toUpperCase(), searchRef.toUpperCase());

	// Reverse complement
	const rcQuery = reverseComplement(query);
	const rev     = smithWaterman(rcQuery.toUpperCase(), searchRef.toUpperCase());

	// Pick the better alignment
	const best   = fwd.score >= rev.score ? fwd : rev;
	const strand = fwd.score >= rev.score ? "+" as const : "-" as const;
	const usedQuery = fwd.score >= rev.score ? query : rcQuery;
	const usedQuality = strand === "+" ? quality : undefined; // quality is for fwd read

	// Wrap circular coordinates
	let refStart = best.refStart % refLen;
	let refEnd   = best.refEnd   % refLen;
	if (refEnd === 0 && best.refEnd > 0) refEnd = refLen;
	// For alignments spanning the origin, refEnd < refStart; normalize
	if (refEnd <= refStart && topology === "circular" && best.refEnd > refLen) {
		refEnd = best.refEnd > refLen ? best.refEnd - refLen : refEnd;
	}

	const mismatches = extractMismatches(
		best.refAligned, best.queryAligned,
		refStart, best.queryStart,
		usedQuality,
	);

	const alignedLen = best.refAligned.replace(/-/g, "").length;
	const matches    = alignedLen - mismatches.length;
	const identity   = alignedLen > 0 ? matches / alignedLen : 0;
	const coverage   = query.length > 0 ? (best.queryEnd - best.queryStart) / query.length : 0;

	return {
		refStart,
		refEnd,
		queryStart: best.queryStart,
		queryEnd:   best.queryEnd,
		strand,
		score:      best.score,
		identity,
		coverage,
		mismatches,
		refAligned:   best.refAligned,
		queryAligned: best.queryAligned,
	};
}

/**
 * Align multiple reads against the same reference.
 * Each read is aligned independently; results are returned in input order.
 */
export function alignMultiple(
	reads: { name: string; sequence: string; quality?: number[] }[],
	reference: string,
	topology: "circular" | "linear",
): (AlignmentResult & { name: string })[] {
	return reads.map((r) => ({
		name: r.name,
		...alignRead(r.sequence, reference, topology, r.quality),
	}));
}
