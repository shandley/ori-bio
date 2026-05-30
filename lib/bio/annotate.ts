/**
 * In-browser sequence annotation using a two-tier approach.
 *
 * Strand model
 * ------------
 * features.json stores each feature in its canonical coding orientation
 * (5'→3' sense sequence).  Both strands of the query are searched by running
 * the same feature sequence against two k-mer maps:
 *
 *   fwdMap  built from upper    → detects features on the + strand (dir = 1)
 *   rcMap   built from RC(upper)→ detects features on the − strand (dir = −1)
 *
 * When RC(feature.seq) sits at position p in upper, RC(upper) has feature.seq
 * at position len−p−flen.  The rcMap search finds it there; the coordinate
 * transform (start = len−rawEnd, end = len−rawStart) maps it back to [p, p+flen)
 * with direction −1.
 *
 * Tier A — k-mer vote (features ≥ 50 bp):
 *   1. Build k-mer position maps for both strands of the query (O(queryLen))
 *   2. For each feature, sample 12 evenly-spaced seed k-mers and vote on
 *      expected start position
 *   3. Candidates with ≥ 3 agreeing votes are verified by identity calculation
 *   4. Best-scoring offset per feature per strand is kept
 *
 * Tier B — sliding-window exact match (features 10–49 bp):
 *   Short features have too few k-mers for reliable voting.  A window of
 *   exactly feature.length is slid across both strands of the query.
 *   Threshold: at most 2 mismatches (≈ 93% for a 30 bp feature).
 *   All hits above threshold are returned; the dedup step handles overlaps.
 *
 * Coverage: virtually all standard lab features including short regulatory
 * elements, epitope tags, recombination sites, and protease recognition sites.
 */

export interface CanonicalFeature {
	name: string;
	type: string;
	seq: string;
}

export interface Annotation {
	id: string;
	name: string;
	type: string;
	start: number; // 0-indexed, inclusive
	end: number; // 0-indexed, exclusive
	direction: 1 | -1; // 1 = forward (+), -1 = reverse (−)
	identity: number; // [0, 1]
	color: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const K = 15;
const MIN_VOTES = 3;
const MIN_IDENTITY = 0.82;
const SEEDS_PER_FEATURE = 12;       // evenly spaced k-mer seeds
const SHORT_THRESHOLD = 50;          // features below this use exact-match tier
const SHORT_MIN_LENGTH = 10;         // features shorter than this are skipped
const SHORT_MAX_MISMATCHES = 2;      // at most 2 mismatches for any short feature

const TYPE_COLORS: Record<string, string> = {
	CDS: "#3b82f6",
	promoter: "#16a34a",
	terminator: "#dc2626",
	rep_origin: "#d97706",
	enhancer: "#7c3aed",
	protein_bind: "#db2777",
	LTR: "#0891b2",
	misc_RNA: "#65a30d",
	intron: "#9ca3af",
	exon: "#6366f1",
	polyA_signal: "#f59e0b",
	misc_recomb: "#be185d",
	misc_feature: "#6b7280",
};

function featureColor(type: string): string {
	return TYPE_COLORS[type] ?? "#9a9284";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const RC_MAP: Record<string, string> = { A: "T", T: "A", G: "C", C: "G", N: "N" };

export function reverseComplement(seq: string): string {
	let rc = "";
	for (let i = seq.length - 1; i >= 0; i--) {
		rc += RC_MAP[seq[i]!] ?? "N";
	}
	return rc;
}

function buildKmerMap(seq: string, k: number): Map<string, number[]> {
	const map = new Map<string, number[]>();
	for (let i = 0; i <= seq.length - k; i++) {
		const kmer = seq.slice(i, i + k);
		if (!kmer.includes("N")) {
			const arr = map.get(kmer);
			if (arr) arr.push(i);
			else map.set(kmer, [i]);
		}
	}
	return map;
}

export function computeIdentity(a: string, b: string): number {
	if (a.length === 0 || b.length === 0) return 0;
	const len = Math.min(a.length, b.length);
	let matches = 0;
	for (let i = 0; i < len; i++) {
		if (a[i] === b[i]) matches++;
	}
	return matches / Math.max(a.length, b.length);
}

function seedPositions(featureLen: number, seeds: number, k: number): number[] {
	if (featureLen <= k) return [0];
	const step = Math.max(1, Math.floor((featureLen - k) / (seeds - 1)));
	const positions: number[] = [];
	for (let i = 0; i < seeds; i++) {
		const pos = Math.min(i * step, featureLen - k);
		if (positions.length === 0 || pos !== positions[positions.length - 1]) {
			positions.push(pos);
		}
	}
	return positions;
}

// ── Tier B: short-feature exact-match search ──────────────────────────────────

// Max sequence variants to search per short feature name.
// The clustering step keeps up to 30 representatives per feature, but for
// short sequences (20-48 bp) many are identical copies. Capping at 10 unique
// sequences per name eliminates redundant work while preserving variant coverage.
const SHORT_MAX_VARIANTS = 10;

/**
 * Sliding-window identity search for features shorter than SHORT_THRESHOLD.
 * Scans both forward and reverse-complement strands.
 *
 * Deduplication: sequences are grouped by canonical name; identical sequences
 * within a name are collapsed and at most SHORT_MAX_VARIANTS are searched.
 * This reduces 456 raw short-feature entries to ~100 unique sequences,
 * keeping the sliding-window cost well under 50 ms for typical plasmids.
 *
 * Adaptive threshold: allow at most SHORT_MAX_MISMATCHES mismatches, giving
 * a minimum identity of (flen − SHORT_MAX_MISMATCHES) / flen per feature.
 */
function searchShortFeatures(
	querySeq: string,
	rcSeq: string,
	features: CanonicalFeature[],
): Annotation[] {
	// Build deduplicated variant map: name → unique sequences (capped)
	type Variant = { seq: string; type: string; color: string };
	const byName = new Map<string, Variant[]>();

	for (const f of features) {
		const flen = f.seq.length;
		if (flen < SHORT_MIN_LENGTH || flen >= SHORT_THRESHOLD) continue;
		const existing = byName.get(f.name) ?? [];
		if (existing.length < SHORT_MAX_VARIANTS && !existing.some((e) => e.seq === f.seq)) {
			existing.push({
				seq: f.seq,
				type: f.type,
				color: featureColor(f.type),
			});
			byName.set(f.name, existing);
		}
	}

	const results: Annotation[] = [];
	const qLen = querySeq.length;

	for (const [name, variants] of byName) {
		for (const v of variants) {
			const flen = v.seq.length;
			// Adaptive threshold: at most SHORT_MAX_MISMATCHES mismatches
			const minId = (flen - SHORT_MAX_MISMATCHES) / flen;

			for (const [queryStrand, fseq, dir] of [
				[querySeq, v.seq, 1]  as [string, string, 1],
				[rcSeq,    v.seq, -1] as [string, string, -1],
			]) {
				for (let i = 0; i <= qLen - flen; i++) {
					const id = computeIdentity(queryStrand.slice(i, i + flen), fseq);
					if (id < minId) continue;
					const start = dir === 1 ? i : qLen - (i + flen);
					const end   = dir === 1 ? i + flen : qLen - i;
					results.push({
						id: `short-${name}-${dir}-${i}`,
						name,
						type: v.type,
						start,
						end,
						direction: dir,
						identity: id,
						color: v.color,
					});
				}
			}
		}
	}

	return results;
}

// ── Tier A: k-mer vote search (long features) ─────────────────────────────────

function searchStrand(
	querySeq: string,
	queryKmers: Map<string, number[]>,
	features: CanonicalFeature[],
	strand: 1 | -1,
): Annotation[] {
	const results: Annotation[] = [];
	const queryLen = querySeq.length;

	for (let fi = 0; fi < features.length; fi++) {
		const feature = features[fi]!;
		const fseq = feature.seq; // same on both strands: reverse search runs on rcSeq
		const flen = fseq.length;
		// Short features are handled by searchShortFeatures — skip here
		if (flen < SHORT_THRESHOLD) continue;

		// Vote on expected start position in query
		const votes = new Map<number, number>();
		const seeds = seedPositions(flen, SEEDS_PER_FEATURE, K);

		for (const posInFeature of seeds) {
			const kmer = fseq.slice(posInFeature, posInFeature + K);
			if (kmer.includes("N")) continue;
			const hits = queryKmers.get(kmer);
			if (!hits) continue;
			for (const posInQuery of hits) {
				const expectedStart = posInQuery - posInFeature;
				votes.set(expectedStart, (votes.get(expectedStart) ?? 0) + 1);
			}
		}

		// Evaluate candidates — keep only the best-scoring offset per feature.
		// Multiple offsets of the same feature can all pass the vote threshold
		// when the feature sits at the start/end of a linearized circular sequence;
		// emitting every offset produces cascading duplicate bars in the viewer.
		let best: Annotation | null = null;

		for (const [expectedStart, voteCount] of votes) {
			if (voteCount < MIN_VOTES) continue;

			const qStart = Math.max(0, expectedStart);
			const qEnd = Math.min(queryLen, expectedStart + flen);
			// Require at least 60% of the feature to align (Math.max, not Math.min —
			// the old Math.min allowed 20-bp hits from 450-bp features).
			if (qEnd - qStart < Math.max(20, flen * 0.6)) continue;

			const fOffset = qStart - expectedStart;
			const queryWindow = querySeq.slice(qStart, qEnd);
			const featureWindow = fseq.slice(fOffset, fOffset + (qEnd - qStart));
			const identity = computeIdentity(queryWindow, featureWindow);
			if (identity < MIN_IDENTITY) continue;

			const candidate: Annotation = {
				id: `${fi}-${strand}-${qStart}`,
				name: feature.name,
				type: feature.type,
				start: qStart,
				end: qEnd,
				direction: strand,
				identity,
				color: featureColor(feature.type),
			};
			if (!best || identity > best.identity) best = candidate;
		}

		if (best) results.push(best);
	}
	return results;
}

// ── Deduplication ─────────────────────────────────────────────────────────────

function overlapFraction(a: Annotation, b: Annotation): number {
	const lo = Math.max(a.start, b.start);
	const hi = Math.min(a.end, b.end);
	if (hi <= lo) return 0;
	const minLen = Math.min(a.end - a.start, b.end - b.start);
	return minLen > 0 ? (hi - lo) / minLen : 0;
}

export function dedup(annotations: Annotation[]): Annotation[] {
	// Sort by identity descending so higher-confidence hits are kept first.
	// Collapse any pair overlapping >70% of the shorter annotation regardless
	// of name or strand — prevents f1-ori / pMB1-ori stacking and eliminates
	// duplicate hits where the same feature matches both + and − strands.
	annotations.sort((a, b) => b.identity - a.identity);
	const kept: Annotation[] = [];
	for (const ann of annotations) {
		if (!kept.some((k) => overlapFraction(k, ann) > 0.7)) {
			kept.push(ann);
		}
	}
	return kept;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Annotate a DNA sequence against the canonical feature library.
 *
 * Tier A (k-mer vote) handles features ≥ 50 bp.
 * Tier B (exact-match scan) handles features 10–49 bp.
 * Results from both tiers are merged, deduplicated, and sorted by position.
 */
export function annotate(seq: string, features: CanonicalFeature[]): Annotation[] {
	const upper = seq.toUpperCase().replace(/[^ACGTN]/g, "N");
	const rcSeq = reverseComplement(upper);

	// Tier A — k-mer vote for long features
	const fwdMap = buildKmerMap(upper, K);
	const rcMap  = buildKmerMap(rcSeq, K);

	const fwd = searchStrand(upper, fwdMap, features, 1);
	const revRaw = searchStrand(rcSeq, rcMap, features, -1);
	const rev = revRaw.map((a) => ({
		...a,
		start: upper.length - a.end,
		end: upper.length - a.start,
	}));

	// Tier B — exact-match sliding window for short features
	const short = searchShortFeatures(upper, rcSeq, features);

	const all = dedup([...fwd, ...rev, ...short]);
	all.sort((a, b) => a.start - b.start);
	return all;
}
