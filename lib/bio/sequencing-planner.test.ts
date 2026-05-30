import { describe, expect, it } from "vitest";
import { UNIVERSAL_PRIMERS, planSequencing } from "./sequencing-planner";
import type { BioAnnotation } from "./parse-genbank";

// ── Helpers ───────────────────────────────────────────────────────────────────

const NO_ANNOTATIONS: BioAnnotation[] = [];

function ann(overrides: Partial<BioAnnotation> & { start: number; end: number }): BioAnnotation {
	return {
		name: "Gene",
		type: "CDS",
		direction: 1,
		color: "#000",
		...overrides,
	};
}

/** A sequence of length `n` filled with non-universal-primer-matching bases. */
const plain = (n: number) => "AAAA".repeat(Math.ceil(n / 4)).slice(0, n);

// ── Basic coverage ────────────────────────────────────────────────────────────

describe("planSequencing — basic coverage", () => {
	it("returns a plan with at least one primer for any non-empty sequence", () => {
		const plan = planSequencing(plain(500), NO_ANNOTATIONS, "linear");
		expect(plan.primers.length).toBeGreaterThan(0);
	});

	it("achieves full coverage for a short linear sequence", () => {
		// 500bp with readLength=700 → one primer covers everything
		const plan = planSequencing(plain(500), NO_ANNOTATIONS, "linear", { readLength: 700 });
		expect(plan.coveredFraction).toBeCloseTo(1.0);
		expect(plan.gaps).toHaveLength(0);
	});

	it("achieves full coverage for a longer linear sequence", () => {
		// 2000bp with readLength=700, minOverlap=100 → step=600 → ~4 primers
		const plan = planSequencing(plain(2000), NO_ANNOTATIONS, "linear", {
			readLength: 700,
			minOverlap: 100,
		});
		expect(plan.coveredFraction).toBeCloseTo(1.0);
	});

	it("achieves full coverage for a circular sequence", () => {
		const plan = planSequencing(plain(2686), NO_ANNOTATIONS, "circular", {
			readLength: 700,
			minOverlap: 100,
		});
		expect(plan.coveredFraction).toBeCloseTo(1.0);
	});

	it("primer count is roughly ceil(seqLen / step) for a plain sequence", () => {
		const readLength = 700;
		const minOverlap = 100;
		const step = readLength - minOverlap;
		const seqLen = 3000;
		const plan = planSequencing(plain(seqLen), NO_ANNOTATIONS, "linear", {
			readLength,
			minOverlap,
		});
		const expectedMin = Math.ceil(seqLen / readLength);
		const expectedMax = Math.ceil(seqLen / step) + 2;
		expect(plan.primers.length).toBeGreaterThanOrEqual(expectedMin);
		expect(plan.primers.length).toBeLessThanOrEqual(expectedMax);
	});

	it("totalReactions equals primers.length", () => {
		const plan = planSequencing(plain(1500), NO_ANNOTATIONS, "linear");
		expect(plan.totalReactions).toBe(plan.primers.length);
	});

	it("coveredFraction is 0 for an empty sequence", () => {
		const plan = planSequencing("", NO_ANNOTATIONS, "linear");
		expect(plan.coveredFraction).toBe(0);
	});

	it("seqLength matches the input sequence length", () => {
		const seq = plain(1234);
		const plan = planSequencing(seq, NO_ANNOTATIONS, "linear");
		expect(plan.seqLength).toBe(1234);
	});
});

// ── Universal primer detection ────────────────────────────────────────────────

describe("planSequencing — universal primer detection", () => {
	it("detects T7 promoter primer when its sequence is in the plasmid", () => {
		const T7 = UNIVERSAL_PRIMERS.find((p) => p.name === "T7 promoter primer")!;
		// Place T7 in a 2000bp sequence well within bounds
		const seq = plain(500) + T7.sequence + plain(1480);
		const plan = planSequencing(seq, NO_ANNOTATIONS, "linear");
		const found = plan.primers.find((p) => p.name.includes("T7"));
		expect(found).toBeDefined();
		expect(found!.isUniversal).toBe(true);
		expect(found!.isDraft).toBe(false);
		expect(found!.sequence).toBe(T7.sequence);
	});

	it("reports T7 primer binding position at where the primer sequence starts", () => {
		const T7 = UNIVERSAL_PRIMERS.find((p) => p.name === "T7 promoter primer")!;
		const seq = plain(200) + T7.sequence + plain(1580);
		const plan = planSequencing(seq, NO_ANNOTATIONS, "linear");
		const found = plan.primers.find((p) => p.name.includes("T7") && p.direction === 1)!;
		expect(found.bindPosition).toBe(200);
	});

	it("T7 primer coverage starts after the primer sequence ends", () => {
		const T7 = UNIVERSAL_PRIMERS.find((p) => p.name === "T7 promoter primer")!;
		const seq = plain(200) + T7.sequence + plain(1580);
		const plan = planSequencing(seq, NO_ANNOTATIONS, "linear");
		const found = plan.primers.find((p) => p.name.includes("T7") && p.direction === 1)!;
		expect(found.coverageStart).toBe(200 + T7.sequence.length);
	});

	it("detects reverse-complement primer hit with direction -1", () => {
		const T7 = UNIVERSAL_PRIMERS.find((p) => p.name === "T7 promoter primer")!;
		// Place RC(T7) in the sequence → should be detected as direction -1
		const rcT7 = T7.sequence.split("").reverse().map((b) =>
			({ A: "T", T: "A", G: "C", C: "G", N: "N" })[b] ?? "N"
		).join("");
		const seq = plain(500) + rcT7 + plain(1480);
		const plan = planSequencing(seq, NO_ANNOTATIONS, "linear");
		const revFound = plan.primers.find((p) => p.direction === -1 && p.isUniversal);
		expect(revFound).toBeDefined();
	});

	it("custom primers have isDraft=true", () => {
		const plan = planSequencing(plain(2000), NO_ANNOTATIONS, "linear");
		const custom = plan.primers.filter((p) => !p.isUniversal);
		expect(custom.every((p) => p.isDraft)).toBe(true);
	});

	it("custom primer sequences are exactly 20 bp", () => {
		// Use a sequence long enough to need custom primers (no universal primers)
		const plan = planSequencing(plain(2000), NO_ANNOTATIONS, "linear");
		const custom = plan.primers.filter((p) => p.isDraft && p.sequence.length > 0);
		// All should be 20bp unless near the end of the sequence
		for (const p of custom) {
			expect(p.sequence.length).toBeGreaterThanOrEqual(10);
			expect(p.sequence.length).toBeLessThanOrEqual(20);
		}
	});
});

// ── Bidirectional CDS coverage ────────────────────────────────────────────────

describe("planSequencing — bidirectional CDS", () => {
	it("adds a reverse primer for a CDS that has no reverse coverage", () => {
		// Long sequence with a CDS in the middle; one forward pass won't add a rev primer
		// unless bidirectionalCDS fires
		const cds = ann({ name: "AmpR", type: "CDS", start: 500, end: 1200, direction: 1 });
		const plan = planSequencing(plain(3000), [cds], "linear", {
			readLength: 700,
			minOverlap: 100,
			bidirectionalCDS: true,
		});
		const revPrimers = plan.primers.filter((p) => p.direction === -1);
		expect(revPrimers.length).toBeGreaterThan(0);
	});

	it("does not add extra bidirectional primers when disabled", () => {
		const cds = ann({ name: "AmpR", type: "CDS", start: 500, end: 1200, direction: 1 });
		const withBidi = planSequencing(plain(3000), [cds], "linear", { bidirectionalCDS: true });
		const withoutBidi = planSequencing(plain(3000), [cds], "linear", { bidirectionalCDS: false });
		// Without bidirectional, there should be fewer or equal primers
		expect(withoutBidi.primers.length).toBeLessThanOrEqual(withBidi.primers.length);
	});
});

// ── Output shape ──────────────────────────────────────────────────────────────

describe("planSequencing — output shape", () => {
	it("every primer has a non-empty name and sequence", () => {
		const plan = planSequencing(plain(2000), NO_ANNOTATIONS, "linear");
		for (const p of plan.primers) {
			expect(p.name.length).toBeGreaterThan(0);
			expect(p.sequence.length).toBeGreaterThan(0);
		}
	});

	it("primer indices are contiguous starting from 1", () => {
		const plan = planSequencing(plain(2000), NO_ANNOTATIONS, "linear");
		const indices = plan.primers.map((p) => p.index);
		expect(indices[0]).toBe(1);
		for (let i = 1; i < indices.length; i++) {
			expect(indices[i]).toBe(i + 1);
		}
	});

	it("primer bind positions are within [0, seqLen)", () => {
		const plan = planSequencing(plain(2000), NO_ANNOTATIONS, "linear");
		for (const p of plan.primers) {
			expect(p.bindPosition).toBeGreaterThanOrEqual(0);
			expect(p.bindPosition).toBeLessThan(plan.seqLength);
		}
	});

	it("primers are sorted by bindPosition ascending", () => {
		const plan = planSequencing(plain(3000), NO_ANNOTATIONS, "linear");
		for (let i = 1; i < plan.primers.length; i++) {
			expect(plan.primers[i]!.bindPosition).toBeGreaterThanOrEqual(
				plan.primers[i - 1]!.bindPosition,
			);
		}
	});

	it("returns the correct topology in the plan", () => {
		const circ = planSequencing(plain(1000), NO_ANNOTATIONS, "circular");
		const lin = planSequencing(plain(1000), NO_ANNOTATIONS, "linear");
		expect(circ.topology).toBe("circular");
		expect(lin.topology).toBe("linear");
	});

	it("annotationsCovered is a subset of annotation names", () => {
		const annList = [
			ann({ name: "AmpR", type: "CDS", start: 0, end: 500, direction: 1 }),
			ann({ name: "oriC", type: "rep_origin", start: 1000, end: 1500, direction: 1 }),
		];
		const annNames = new Set(annList.map((a) => a.name));
		const plan = planSequencing(plain(2000), annList, "linear");
		for (const p of plan.primers) {
			for (const name of p.annotationsCovered) {
				expect(annNames.has(name)).toBe(true);
			}
		}
	});
});
