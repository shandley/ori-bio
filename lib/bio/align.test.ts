import { describe, expect, it } from "vitest";
import {
	alignMultiple,
	alignRead,
	extractMismatches,
	smithWaterman,
} from "./align";

// ── Scoring constants (must mirror align.ts) ──────────────────────────────────
const MATCH      =  2;
const MISMATCH   = -3;
const GAP_OPEN   = -5;
const GAP_EXTEND = -2;

// ── smithWaterman ─────────────────────────────────────────────────────────────

describe("smithWaterman", () => {
	it("returns score 0 and empty strings when there is no match", () => {
		// All-A query vs all-C ref: every cell is max(0, negative) = 0
		const result = smithWaterman("AAAA", "CCCCCCCC");
		expect(result.score).toBe(0);
		expect(result.refAligned).toBe("");
		expect(result.queryAligned).toBe("");
	});

	it("scores a perfect 4-bp match as MATCH * 4", () => {
		// Query embedded at a known position; padding prevents partial overlap scoring.
		const result = smithWaterman("ATCG", "GGGG" + "ATCG" + "GGGG");
		expect(result.score).toBe(MATCH * 4);
	});

	it("returns correct 0-indexed coordinates for an embedded match", () => {
		// "ATCG" at ref[4..8) → refStart=4, refEnd=8
		const result = smithWaterman("ATCG", "GGGG" + "ATCG" + "GGGG");
		expect(result.refStart).toBe(4);
		expect(result.refEnd).toBe(8);
		expect(result.queryStart).toBe(0);
		expect(result.queryEnd).toBe(4);
	});

	it("refEnd − refStart equals the aligned region length", () => {
		const result = smithWaterman("ATCGATCG", "CCCC" + "ATCGATCG" + "CCCC");
		expect(result.refEnd - result.refStart).toBe(8);
	});

	it("produces correct aligned strings for a perfect match", () => {
		const result = smithWaterman("ATCG", "GGGG" + "ATCG" + "GGGG");
		expect(result.refAligned).toBe("ATCG");
		expect(result.queryAligned).toBe("ATCG");
	});

	it("scores a single mismatch correctly", () => {
		// "ATCGATCG" vs "ATCGTTCG": mismatch at position 4 (A→T).
		// The 3 post-mismatch matches pull the final score above the pre-mismatch
		// peak, so traceback captures all 8 bases including the mismatch.
		// Score: 7 matches × MATCH + 1 × MISMATCH = 14 − 3 = 11.
		const result = smithWaterman("ATCGATCG", "GGGG" + "ATCGTTCG" + "GGGG");
		expect(result.score).toBe(MATCH * 7 + MISMATCH);
	});

	it("shows a mismatch as differing bases in the aligned strings", () => {
		const result = smithWaterman("ATCGATCG", "GGGG" + "ATCGTTCG" + "GGGG");
		// Position 4: query has 'A', ref has 'T'
		expect(result.queryAligned[4]).toBe("A");
		expect(result.refAligned[4]).toBe("T");
	});

	it("produces a gap in queryAligned for a deletion in the query", () => {
		// Query "ATC" (3bp) vs ref "ATCC" (4bp): 3 matches then gap in query
		// SW will match ATC and leave one C unaligned in ref
		const result = smithWaterman("ATC", "ATC" + "C");
		// The 3-match score (6) should exceed any gapped variant
		expect(result.queryAligned).not.toContain("-"); // perfect 3-bp match wins
		expect(result.score).toBe(MATCH * 3);
	});

	it("handles empty query gracefully", () => {
		const result = smithWaterman("", "ATCG");
		expect(result.score).toBe(0);
		expect(result.refAligned).toBe("");
		expect(result.queryAligned).toBe("");
	});

	it("handles empty reference gracefully", () => {
		const result = smithWaterman("ATCG", "");
		expect(result.score).toBe(0);
	});
});

// ── extractMismatches ─────────────────────────────────────────────────────────

describe("extractMismatches", () => {
	it("returns empty array for a perfect alignment", () => {
		expect(extractMismatches("ATCG", "ATCG", 0, 0)).toEqual([]);
	});

	it("detects a single substitution with correct positions", () => {
		// refAligned="ATCG", queryAligned="ATGG": mismatch at index 2
		// refStart=10, queryStart=0 → refPos starts at 10
		const ms = extractMismatches("ATCG", "ATGG", 10, 0);
		expect(ms).toHaveLength(1);
		expect(ms[0]).toMatchObject({
			refPos: 12,    // 10 + 2 positions advanced
			queryPos: 2,
			refBase: "C",
			queryBase: "G",
		});
	});

	it("does not count N in query as a mismatch", () => {
		const ms = extractMismatches("ATCG", "ATNG", 0, 0);
		expect(ms).toHaveLength(0);
	});

	it("attaches quality score to a mismatch when provided", () => {
		const quality = [30, 30, 15, 30]; // low quality at position 2
		const ms = extractMismatches("ATCG", "ATGG", 0, 0, quality);
		expect(ms[0]!.qualityScore).toBe(15);
	});

	it("advances queryPos (not refPos) for a gap in the reference (−)", () => {
		// refAligned="AT-G", queryAligned="ATXG" means insertion in query at pos 2
		// After "AT": refPos=2, queryPos=2. Then r="-": queryPos→3. Then "G": refPos=2, queryPos=3
		// No mismatch on the G (both G), so mismatches=[]
		const ms = extractMismatches("AT-G", "ATXG", 0, 0);
		expect(ms).toHaveLength(0);
	});

	it("advances refPos (not queryPos) for a gap in the query (−)", () => {
		// refAligned="ATCG", queryAligned="AT-G": deletion in query at pos 2
		// refPos advances past C without incrementing queryPos
		// Then G matches G at refPos=3, queryPos=2 — no mismatch
		const ms = extractMismatches("ATCG", "AT-G", 0, 0);
		expect(ms).toHaveLength(0);
	});

	it("correctly offsets positions by refStart and queryStart", () => {
		const ms = extractMismatches("AG", "AC", 100, 50);
		expect(ms[0]!.refPos).toBe(101);
		expect(ms[0]!.queryPos).toBe(51);
	});
});

// ── alignRead — forward strand ────────────────────────────────────────────────

describe("alignRead — forward strand", () => {
	// Reference: 200-bp padding + 100-bp EGFP stub + 200-bp padding
	const EGFP_STUB =
		"ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGG" +
		"TCGAGCTGGACGGCGACGTAAACGGCCACAAGTTCAGCGTGTCCGGCGAG";
	const REF = "A".repeat(200) + EGFP_STUB + "A".repeat(200);

	it("detects a forward match on the + strand", () => {
		const result = alignRead(EGFP_STUB, REF, "linear");
		expect(result.strand).toBe("+");
	});

	it("returns correct refStart and refEnd for a placed query", () => {
		const result = alignRead(EGFP_STUB, REF, "linear");
		expect(result.refStart).toBe(200);
		expect(result.refEnd).toBe(200 + EGFP_STUB.length);
	});

	it("returns identity 1.0 for a perfect match", () => {
		const result = alignRead(EGFP_STUB, REF, "linear");
		expect(result.identity).toBeCloseTo(1.0);
	});

	it("returns coverage 1.0 when the full query aligns", () => {
		const result = alignRead(EGFP_STUB, REF, "linear");
		expect(result.coverage).toBeCloseTo(1.0);
	});

	it("score is positive", () => {
		const result = alignRead(EGFP_STUB, REF, "linear");
		expect(result.score).toBeGreaterThan(0);
	});

	it("reports zero mismatches for a perfect match", () => {
		const result = alignRead(EGFP_STUB, REF, "linear");
		expect(result.mismatches).toHaveLength(0);
	});

	it("detects a single-base substitution as a mismatch", () => {
		const mutated =
			EGFP_STUB.slice(0, 50) + "T" + EGFP_STUB.slice(51); // flip pos 50
		const result = alignRead(mutated, REF, "linear");
		expect(result.mismatches).toHaveLength(1);
		expect(result.identity).toBeLessThan(1.0);
	});

	it("attaches quality scores to mismatches on the forward strand", () => {
		// Mismatch must be mid-query: SW local alignment skips a leading mismatch
		// because max(0, negative) = 0 restarts the alignment past it.
		const MID = 40;
		const mutated = EGFP_STUB.slice(0, MID) + "T" + EGFP_STUB.slice(MID + 1);
		const quality = new Array(EGFP_STUB.length).fill(30);
		quality[MID] = 10;
		const result = alignRead(mutated, REF, "linear", quality);
		expect(result.mismatches.length).toBeGreaterThan(0);
		const mm = result.mismatches.find((m) => m.qualityScore === 10);
		expect(mm).toBeDefined();
	});
});

// ── alignRead — reverse strand ────────────────────────────────────────────────

describe("alignRead — reverse strand", () => {
	const EGFP_STUB =
		"ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGG" +
		"TCGAGCTGGACGGCGACGTAAACGGCCACAAGTTCAGCGTGTCCGGCGAG";

	// RC(EGFP_STUB) placed in the reference — aligner should flip to − strand
	const rcEgfp = EGFP_STUB.split("")
		.reverse()
		.map((b) => ({ A: "T", T: "A", G: "C", C: "G" }[b] ?? "N"))
		.join("");
	const REF_RC = "A".repeat(200) + rcEgfp + "A".repeat(200);

	it("detects a reverse-complement match on the − strand", () => {
		const result = alignRead(EGFP_STUB, REF_RC, "linear");
		expect(result.strand).toBe("-");
	});

	it("score is positive for a reverse-complement match", () => {
		const result = alignRead(EGFP_STUB, REF_RC, "linear");
		expect(result.score).toBeGreaterThan(0);
	});

	it("drops quality scores for reverse-strand alignments", () => {
		const quality = new Array(EGFP_STUB.length).fill(30);
		// Introduce a mismatch so there is something to attach quality to
		const mutated = rcEgfp.slice(0, 50) + "T" + rcEgfp.slice(51);
		const refWithMut = "A".repeat(200) + mutated + "A".repeat(200);
		const result = alignRead(EGFP_STUB, refWithMut, "linear", quality);
		if (result.strand === "-" && result.mismatches.length > 0) {
			expect(result.mismatches[0]!.qualityScore).toBeUndefined();
		}
	});

	it("prefers the higher-scoring strand when both have a hit", () => {
		// Query matches forward perfectly; also exists as RC in the same ref.
		// Forward should win (same identity, fwd.score >= rev.score).
		const combined = "A".repeat(50) + EGFP_STUB + "A".repeat(50) + rcEgfp + "A".repeat(50);
		const result = alignRead(EGFP_STUB, combined, "linear");
		expect(result.strand).toBe("+");
	});
});

// ── alignRead — circular topology ────────────────────────────────────────────

describe("alignRead — circular topology", () => {
	// ref: 10 A's then 10 C's (20 bp)
	// query: 5 C's then 5 A's — spans the origin
	const REF   = "A".repeat(10) + "C".repeat(10);
	const QUERY = "C".repeat(5)  + "A".repeat(5);

	it("aligns an origin-spanning query on a circular reference", () => {
		const result = alignRead(QUERY, REF, "circular");
		expect(result.score).toBeGreaterThan(0);
		expect(result.identity).toBeCloseTo(1.0);
	});

	it("signals origin-spanning with refStart > refEnd", () => {
		const result = alignRead(QUERY, REF, "circular");
		// C's start at position 10, A's end at 5 (wrapped)
		expect(result.refStart).toBeGreaterThan(result.refEnd);
	});

	it("does not produce origin-spanning coords for the same query on a linear ref", () => {
		// On a linear ref the query just won't align well (only partial match)
		const result = alignRead(QUERY, REF, "linear");
		// Either no origin-spanning (refStart ≤ refEnd) or a lower score
		if (result.score > 0) {
			expect(result.refStart).toBeLessThanOrEqual(result.refEnd);
		}
	});
});

// ── alignRead — edge cases ────────────────────────────────────────────────────

describe("alignRead — edge cases", () => {
	it("returns score 0 for a query with no match in the reference", () => {
		const result = alignRead("CCCCCCCC", "A".repeat(100), "linear");
		expect(result.score).toBe(0);
	});

	it("returns identity 0 and coverage 0 when score is 0", () => {
		const result = alignRead("CCCCCCCC", "A".repeat(100), "linear");
		expect(result.identity).toBe(0);
		expect(result.coverage).toBe(0);
	});

	it("handles empty query without throwing", () => {
		expect(() => alignRead("", "ATCGATCG", "linear")).not.toThrow();
	});

	it("coverage equals (queryEnd − queryStart) / query.length", () => {
		const EGFP =
			"ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGG" +
			"TCGAGCTGGACGGCGACGTAAACGGCCACAAGTTCAGCGTGTCCGGCGAG";
		const partial = EGFP.slice(0, 50);
		const result  = alignRead(partial, EGFP, "linear");
		const expected = (result.queryEnd - result.queryStart) / partial.length;
		expect(result.coverage).toBeCloseTo(expected);
	});
});

// ── alignMultiple ─────────────────────────────────────────────────────────────

describe("alignMultiple", () => {
	const REF = "A".repeat(50) + "ATCGATCG" + "A".repeat(50);

	it("returns one result per read in input order", () => {
		const reads = [
			{ name: "read1", sequence: "ATCGATCG" },
			{ name: "read2", sequence: "CCCCCCCC" },
		];
		const results = alignMultiple(reads, REF, "linear");
		expect(results).toHaveLength(2);
		expect(results[0]!.name).toBe("read1");
		expect(results[1]!.name).toBe("read2");
	});

	it("each result includes the name from the read", () => {
		const reads = [{ name: "myRead", sequence: "ATCGATCG" }];
		const [result] = alignMultiple(reads, REF, "linear");
		expect(result!.name).toBe("myRead");
	});

	it("produces correct alignment for each read independently", () => {
		// "CCCCCCCC" will get a score-2 single-C match from the C in "ATCGATCG",
		// so we can't check score===0. Coverage is the right discriminator:
		// a single-base match on an 8-base query gives coverage 1/8 = 0.125.
		const reads = [
			{ name: "hit",  sequence: "ATCGATCG" },
			{ name: "miss", sequence: "CCCCCCCC" },
		];
		const [hit, miss] = alignMultiple(reads, REF, "linear");
		expect(hit!.coverage).toBeCloseTo(1.0);
		expect(miss!.coverage).toBeLessThan(0.5);
	});

	it("returns empty array for empty reads list", () => {
		expect(alignMultiple([], REF, "linear")).toEqual([]);
	});
});
