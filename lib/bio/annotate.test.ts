import { describe, expect, it } from "vitest";
import {
	type Annotation,
	type CanonicalFeature,
	annotate,
	computeIdentity,
	dedup,
	reverseComplement,
} from "./annotate";

// ── Test fixtures ──────────────────────────────────────────────────────────────
//
// Background: polyA padding. Has zero GC content, so it cannot generate
// k-mer votes for any GC-containing feature and won't match short features
// at 92%+ identity. Guarantees clean isolation between feature and noise.
//
// Features: real biological sequences with known entropy.
//   EGFP_100  — first 100bp of EGFP coding sequence (~60% GC, no repeated 15-mers)
//   SV40_NLS  — 18bp monopartite nuclear localisation signal

const EGFP_100 =
	"ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGG" +
	"TCGAGCTGGACGGCGACGTAAACGGCCACAAGTTCAGCGTGTCCGGCGAG";

const SV40_NLS = "CCCAAGAAGAAGAGAAAG"; // 18 bp

const LONG_FEAT: CanonicalFeature = { name: "EGFP", type: "CDS", seq: EGFP_100 };
const SHORT_FEAT: CanonicalFeature = { name: "SV40 NLS", type: "protein_bind", seq: SV40_NLS };

const A = (n: number) => "A".repeat(n); // polyA padding helper

// ── computeIdentity ───────────────────────────────────────────────────────────

describe("computeIdentity", () => {
	it("returns 1.0 for identical strings", () => {
		expect(computeIdentity("ATCG", "ATCG")).toBe(1);
	});

	it("returns 0.9 for one mismatch in 10 bp", () => {
		expect(computeIdentity("ATCGATCGAT", "ATCGATCGTT")).toBeCloseTo(0.9);
	});

	it("returns 0 for empty inputs", () => {
		expect(computeIdentity("", "")).toBe(0);
		expect(computeIdentity("ATCG", "")).toBe(0);
	});

	it("penalises length difference — uses max(a.len, b.len) as denominator", () => {
		// 5 matches out of max(5, 6) = 6
		expect(computeIdentity("ATCGA", "ATCGAT")).toBeCloseTo(5 / 6);
	});
});

// ── reverseComplement ─────────────────────────────────────────────────────────

describe("reverseComplement", () => {
	it("complements and reverses a simple sequence", () => {
		expect(reverseComplement("ATCG")).toBe("CGAT");
	});

	it("is its own inverse", () => {
		expect(reverseComplement(reverseComplement(EGFP_100))).toBe(EGFP_100);
	});

	it("passes N through unchanged", () => {
		expect(reverseComplement("ATCGN")).toBe("NCGAT");
	});

	it("returns empty string for empty input", () => {
		expect(reverseComplement("")).toBe("");
	});
});

// ── dedup ─────────────────────────────────────────────────────────────────────

function ann(
	overrides: Partial<Annotation> & { start: number; end: number },
): Annotation {
	return {
		id: "t",
		name: "feat",
		type: "CDS",
		direction: 1,
		identity: 1.0,
		color: "#000",
		...overrides,
	};
}

describe("dedup", () => {
	it("returns empty array unchanged", () => {
		expect(dedup([])).toEqual([]);
	});

	it("keeps non-overlapping annotations", () => {
		const a = ann({ start: 0, end: 50 });
		const b = ann({ start: 100, end: 150 });
		expect(dedup([a, b])).toHaveLength(2);
	});

	it("keeps the higher-identity hit when two annotations overlap >70%", () => {
		const high = ann({ start: 0, end: 100, identity: 0.95, name: "high" });
		const low = ann({ start: 10, end: 90, identity: 0.83, name: "low" });
		const result = dedup([high, low]);
		expect(result).toHaveLength(1);
		expect(result[0]!.name).toBe("high");
	});

	it("retains both when overlap is ≤70% of the shorter annotation", () => {
		// a=[0,100], b=[70,170]: overlap=30bp, shorter=100bp → 30% ≤ 70% → both kept
		const a = ann({ start: 0, end: 100, identity: 0.95 });
		const b = ann({ start: 70, end: 170, identity: 0.95 });
		expect(dedup([a, b])).toHaveLength(2);
	});

	it("short high-identity hit displaces long low-identity overlapping hit", () => {
		// Dedup sorts by identity desc: short/high processed first (kept),
		// then long/low compared — overlap = 30/30 = 100% of shorter → dropped.
		const short = ann({ start: 10, end: 40, identity: 0.98, name: "short" });
		const long  = ann({ start: 0,  end: 100, identity: 0.83, name: "long" });
		const result = dedup([long, short]);
		expect(result).toHaveLength(1);
		expect(result[0]!.name).toBe("short");
	});
});

// ── annotate — empty / edge inputs ───────────────────────────────────────────

describe("annotate — empty and edge inputs", () => {
	it("returns [] for empty sequence and empty features", () => {
		expect(annotate("", [])).toEqual([]);
	});

	it("returns [] for empty features list", () => {
		expect(annotate(A(300) + EGFP_100 + A(300), [])).toEqual([]);
	});

	it("returns [] when query is too short to contain the feature", () => {
		expect(annotate("ATCG", [LONG_FEAT])).toEqual([]);
	});

	it("normalises lowercase input — feature is still detected", () => {
		const query = A(200) + EGFP_100 + A(200);
		const result = annotate(query.toLowerCase(), [LONG_FEAT]);
		expect(result).toHaveLength(1);
	});

	it("replaces non-ACGT characters with N without throwing", () => {
		const dirty = "X-?!" + A(196) + EGFP_100 + A(200);
		expect(() => annotate(dirty, [LONG_FEAT])).not.toThrow();
	});
});

// ── Tier A — long feature (≥50 bp) forward strand ────────────────────────────

describe("annotate — Tier A forward strand", () => {
	const QUERY = A(200) + EGFP_100 + A(200); // feature at [200, 300)

	it("detects the feature", () => {
		const results = annotate(QUERY, [LONG_FEAT]);
		expect(results).toHaveLength(1);
		const ann = results[0]!;
		expect(ann.name).toBe("EGFP");
		expect(ann.type).toBe("CDS");
		expect(ann.direction).toBe(1);
	});

	it("returns correct coordinates [200, 200+len)", () => {
		const ann = annotate(QUERY, [LONG_FEAT])[0]!;
		expect(ann.start).toBe(200);
		expect(ann.end).toBe(200 + EGFP_100.length);
	});

	it("returns identity ≥ 0.82 (MIN_IDENTITY)", () => {
		const ann = annotate(QUERY, [LONG_FEAT])[0]!;
		expect(ann.identity).toBeGreaterThanOrEqual(0.82);
	});

	it("detects a feature spanning the full query", () => {
		const results = annotate(EGFP_100, [LONG_FEAT]);
		expect(results).toHaveLength(1);
		expect(results[0]!.start).toBe(0);
		expect(results[0]!.end).toBe(EGFP_100.length);
	});

	it("does not detect the feature when it is absent", () => {
		expect(annotate(A(400), [LONG_FEAT])).toHaveLength(0);
	});

	it("does not detect a feature mutated below identity threshold (82%)", () => {
		// Mutate every 5th base → 20% mutated → identity ~0.80, below threshold
		const mutated = EGFP_100.split("").map((b, i) =>
			i % 5 === 0 ? (b === "A" ? "C" : "A") : b
		).join("");
		const query = A(200) + mutated + A(200);
		expect(annotate(query, [LONG_FEAT])).toHaveLength(0);
	});

	it("keeps at most one hit per feature per strand when feature appears twice", () => {
		// Tier A's `best` variable keeps only the highest-identity candidate per
		// feature per strand. With two identical copies, each strand search emits
		// one result. Those two may be at different positions (non-overlapping) so
		// both can survive dedup — the total is ≤2, not O(copies²).
		const query = A(50) + EGFP_100 + A(50) + EGFP_100 + A(50);
		const results = annotate(query, [LONG_FEAT]);
		const hits = results.filter((a) => a.name === "EGFP");
		expect(hits.length).toBeLessThanOrEqual(2);
		expect(hits.length).toBeGreaterThanOrEqual(1);
	});
});

// ── Strand direction ──────────────────────────────────────────────────────────
//
// The algorithm runs two searches: one on `upper` (dir=1) and one on
// `RC(upper)` looking for `RC(feature)` (dir=-1).  For a feature present in
// the forward strand both searches find the same position; dedup keeps the
// dir=1 hit.  Features present *only* as RC(feature) in the forward strand
// are not detected — the algorithm relies on features.json storing sequences
// in the orientation that appears in the forward strand.

describe("annotate — strand direction", () => {
	it("annotates a forward-strand feature with direction 1", () => {
		const ann = annotate(A(200) + EGFP_100 + A(200), [LONG_FEAT])[0]!;
		expect(ann.direction).toBe(1);
	});

	it("deduplicates same-position forward/reverse hits to a single annotation", () => {
		// Both strand searches find the feature at [200, 299); dedup keeps one.
		const results = annotate(A(200) + EGFP_100 + A(200), [LONG_FEAT]);
		expect(results).toHaveLength(1);
	});

	it("returns identity ≥ 0.82 regardless of which strand hit survives dedup", () => {
		const ann = annotate(A(200) + EGFP_100 + A(200), [LONG_FEAT])[0]!;
		expect(ann.identity).toBeGreaterThanOrEqual(0.82);
	});
});

// ── Tier B — short feature (10–49 bp) ────────────────────────────────────────

describe("annotate — Tier B (short features 10–49 bp)", () => {
	it("detects an 18bp feature", () => {
		const query = A(100) + SV40_NLS + A(100);
		const results = annotate(query, [SHORT_FEAT]);
		expect(results).toHaveLength(1);
		expect(results[0]!.name).toBe("SV40 NLS");
	});

	it("returns correct coordinates [100, 118) for an 18bp feature", () => {
		const query = A(100) + SV40_NLS + A(100);
		const ann = annotate(query, [SHORT_FEAT])[0]!;
		expect(ann.start).toBe(100);
		expect(ann.end).toBe(118);
	});

	it("detects multiple non-overlapping instances of a short feature (Tier B emits all hits)", () => {
		// Two copies separated by 50bp polyA — non-overlapping, both survive dedup
		const query = A(50) + SV40_NLS + A(50) + SV40_NLS + A(50);
		const results = annotate(query, [SHORT_FEAT]);
		const hits = results.filter((a) => a.name === "SV40 NLS");
		expect(hits).toHaveLength(2);
	});

	it("skips features shorter than 10 bp", () => {
		const tiny: CanonicalFeature = {
			name: "Tiny",
			type: "misc_feature",
			seq: "ATCGATCG", // 8 bp
		};
		const query = A(50) + "ATCGATCG" + A(50);
		expect(annotate(query, [tiny]).filter((a) => a.name === "Tiny")).toHaveLength(0);
	});

	it("routes a 49bp feature through Tier B and a 50bp feature through Tier A", () => {
		const seq49 = EGFP_100.slice(0, 49);
		const seq50 = EGFP_100.slice(0, 50);
		const feat49: CanonicalFeature = { name: "F49", type: "misc_feature", seq: seq49 };
		const feat50: CanonicalFeature = { name: "F50", type: "misc_feature", seq: seq50 };
		// Embed both, non-overlapping
		const query = A(100) + seq49 + A(10) + seq50 + A(100);
		const results = annotate(query, [feat49, feat50]);
		expect(results.find((a) => a.name === "F49")).toBeDefined();
		expect(results.find((a) => a.name === "F50")).toBeDefined();
	});
});

// ── Output shape invariants ───────────────────────────────────────────────────

describe("annotate — output shape", () => {
	const QUERY = A(100) + SV40_NLS + A(50) + EGFP_100 + A(100);

	it("always has start < end for every annotation", () => {
		const results = annotate(QUERY, [LONG_FEAT, SHORT_FEAT]);
		expect(results.length).toBeGreaterThan(0);
		for (const a of results) {
			expect(a.start).toBeLessThan(a.end);
		}
	});

	it("returns results sorted by start position", () => {
		const results = annotate(QUERY, [LONG_FEAT, SHORT_FEAT]);
		for (let i = 1; i < results.length; i++) {
			expect(results[i]!.start).toBeGreaterThanOrEqual(results[i - 1]!.start);
		}
	});

	it("assigns a valid hex color to every annotation", () => {
		const results = annotate(QUERY, [LONG_FEAT, SHORT_FEAT]);
		for (const a of results) {
			expect(a.color).toMatch(/^#[0-9a-fA-F]{6}$/);
		}
	});

	it("assigns identity within [0, 1] for every annotation", () => {
		const results = annotate(QUERY, [LONG_FEAT, SHORT_FEAT]);
		for (const a of results) {
			expect(a.identity).toBeGreaterThanOrEqual(0);
			expect(a.identity).toBeLessThanOrEqual(1);
		}
	});

	it("returns a fallback color for an unknown feature type", () => {
		const unknown: CanonicalFeature = {
			name: "X",
			type: "not_a_real_type",
			seq: SV40_NLS,
		};
		const results = annotate(A(50) + SV40_NLS + A(50), [unknown]);
		expect(results[0]!.color).toBe("#9a9284");
	});
});
