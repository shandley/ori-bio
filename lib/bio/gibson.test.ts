import { describe, expect, it } from "vitest";
import { simulateGibson, simulateGibsonMulti } from "./gibson";

// ── Fixture helpers ───────────────────────────────────────────────────────────
// Build test sequences where overlaps are predictable.
//
// A vector whose left and right arms are made of distinct repeating characters
// so the overlap is unambiguous and no accidental partial matches occur.

const LEFT_ARM  = "A".repeat(20);  // 20 A's
const RIGHT_ARM = "C".repeat(20);  // 20 C's
// Vector: 40 bp. Cut at 20 splits it into LEFT_ARM and RIGHT_ARM.
const VECTOR    = LEFT_ARM + RIGHT_ARM;
const CUT_POS   = 20;

// Insert that carries 20bp homology on each side:
const INSERT_CORE = "GCTAGCTAGCTAGC";                       // 14 bp unique core
const INSERT_WITH_OVERLAPS = LEFT_ARM + INSERT_CORE + RIGHT_ARM; // 54 bp total

// Insert with NO homology arms:
const INSERT_NO_ARMS = "GCTAGCTAGCTAGCGCTAGC"; // pure new sequence

// ── simulateGibson ────────────────────────────────────────────────────────────

describe("simulateGibson — errors", () => {
	it("returns error for empty insert", () => {
		const r = simulateGibson(VECTOR, CUT_POS, "");
		expect(r.error).toBeDefined();
		expect(r.error).toMatch(/empty/i);
	});

	it("returns error for cut position below 0", () => {
		const r = simulateGibson(VECTOR, -1, INSERT_NO_ARMS);
		expect(r.error).toBeDefined();
		expect(r.error).toMatch(/out of range/i);
	});

	it("returns error for cut position beyond vector length", () => {
		const r = simulateGibson(VECTOR, VECTOR.length + 1, INSERT_NO_ARMS);
		expect(r.error).toBeDefined();
	});

	it("strips invalid characters from insert without error", () => {
		const r = simulateGibson(VECTOR, CUT_POS, "ATCG-XY!ATCG");
		expect(r.error).toBeUndefined();
		// Only ATCG characters remain; result should be defined
		expect(r.resultSeq).toBeDefined();
	});
});

describe("simulateGibson — overlaps present", () => {
	it("assembles correctly when both overlaps are present", () => {
		const r = simulateGibson(VECTOR, CUT_POS, INSERT_WITH_OVERLAPS);
		expect(r.error).toBeUndefined();
		// resultSeq = LEFT_ARM + INSERT_CORE + RIGHT_ARM
		expect(r.resultSeq).toBe(VECTOR.slice(0, CUT_POS) + INSERT_CORE + VECTOR.slice(CUT_POS));
	});

	it("productSize equals resultSeq.length", () => {
		const r = simulateGibson(VECTOR, CUT_POS, INSERT_WITH_OVERLAPS);
		expect(r.productSize).toBe(r.resultSeq.length);
	});

	it("reports leftOverlapLen and rightOverlapLen for the insert fragment", () => {
		const r = simulateGibson(VECTOR, CUT_POS, INSERT_WITH_OVERLAPS);
		const insertFrag = r.fragments.find((f) => f.name === "insert")!;
		expect(insertFrag.leftOverlapLen).toBe(20);
		expect(insertFrag.rightOverlapLen).toBe(20);
	});

	it("produces no warnings when both overlaps are ≥ 15 bp", () => {
		const r = simulateGibson(VECTOR, CUT_POS, INSERT_WITH_OVERLAPS);
		expect(r.warnings).toHaveLength(0);
		expect(r.missingOverlaps).toHaveLength(0);
	});

	it("does not duplicate the overlap region in the result", () => {
		const r = simulateGibson(VECTOR, CUT_POS, INSERT_WITH_OVERLAPS);
		// LEFT_ARM should appear exactly once at the start, not duplicated
		expect(r.resultSeq.startsWith(LEFT_ARM)).toBe(true);
		expect(r.resultSeq.indexOf(LEFT_ARM, 1)).toBe(-1);
	});
});

describe("simulateGibson — missing overlaps", () => {
	it("warns and reports missingOverlaps when left overlap is absent", () => {
		// Use an insert that only overlaps the right arm, not the left
		const insertRightOnly = INSERT_CORE + RIGHT_ARM; // overlaps right only
		const r = simulateGibson(VECTOR, CUT_POS, insertRightOnly);
		const hasLeftMissing = r.missingOverlaps.some((m) => m.side === "left");
		expect(hasLeftMissing).toBe(true);
		expect(r.warnings.some((w) => w.includes("Forward primer"))).toBe(true);
	});

	it("warns and reports missingOverlaps when right overlap is absent", () => {
		const insertLeftOnly = LEFT_ARM + INSERT_CORE; // overlaps left only
		const r = simulateGibson(VECTOR, CUT_POS, insertLeftOnly);
		const hasRightMissing = r.missingOverlaps.some((m) => m.side === "right");
		expect(hasRightMissing).toBe(true);
		expect(r.warnings.some((w) => w.includes("Reverse primer"))).toBe(true);
	});

	it("reports tails for both sides when neither overlap is present", () => {
		const r = simulateGibson(VECTOR, CUT_POS, INSERT_NO_ARMS);
		expect(r.missingOverlaps).toHaveLength(2);
		expect(r.missingOverlaps.every((m) => m.tail.length > 0)).toBe(true);
	});

	it("assembles left_arm + full_insert + right_arm when no overlaps exist", () => {
		const r = simulateGibson(VECTOR, CUT_POS, INSERT_NO_ARMS);
		expect(r.resultSeq).toBe(LEFT_ARM + INSERT_NO_ARMS + RIGHT_ARM);
	});
});

// ── simulateGibsonMulti ───────────────────────────────────────────────────────

describe("simulateGibsonMulti", () => {
	it("returns error for empty fragments array", () => {
		const r = simulateGibsonMulti(VECTOR, CUT_POS, []);
		expect(r.error).toBeDefined();
	});

	it("delegates to simulateGibson for a single fragment", () => {
		const single = simulateGibsonMulti(VECTOR, CUT_POS, [
			{ name: "ins", seq: INSERT_WITH_OVERLAPS },
		]);
		const direct = simulateGibson(VECTOR, CUT_POS, INSERT_WITH_OVERLAPS);
		expect(single.resultSeq).toBe(direct.resultSeq);
	});

	it("assembles two fragments in order when overlaps are present", () => {
		// frag1: LEFT_ARM + CORE1 + JUNCTION, frag2: JUNCTION + CORE2 + RIGHT_ARM
		const JUNCTION = "T".repeat(20);
		const CORE1 = "GCTAGC";
		const CORE2 = "ATCGAT";
		const frag1 = LEFT_ARM + CORE1 + JUNCTION;
		const frag2 = JUNCTION + CORE2 + RIGHT_ARM;

		const r = simulateGibsonMulti(VECTOR, CUT_POS, [
			{ name: "frag1", seq: frag1 },
			{ name: "frag2", seq: frag2 },
		]);
		expect(r.error).toBeUndefined();
		// Expected: LEFT_ARM + CORE1 + JUNCTION + CORE2 + RIGHT_ARM
		const expected = LEFT_ARM + CORE1 + JUNCTION + CORE2 + RIGHT_ARM;
		expect(r.resultSeq).toBe(expected);
	});

	it("reports a warning for missing overlap between adjacent fragments", () => {
		// Two fragments with no homology between them
		const frag1 = LEFT_ARM + "GCTAGC";       // only left overlap with vector
		const frag2 = "ATCGAT" + RIGHT_ARM;      // only right overlap with vector

		const r = simulateGibsonMulti(VECTOR, CUT_POS, [
			{ name: "frag1", seq: frag1 },
			{ name: "frag2", seq: frag2 },
		]);
		expect(r.warnings.length).toBeGreaterThan(0);
		expect(r.missingOverlaps.length).toBeGreaterThan(0);
	});

	it("productSize equals resultSeq.length", () => {
		const JUNCTION = "T".repeat(20);
		const r = simulateGibsonMulti(VECTOR, CUT_POS, [
			{ name: "a", seq: LEFT_ARM + "GCTAGC" + JUNCTION },
			{ name: "b", seq: JUNCTION + "ATCGAT" + RIGHT_ARM },
		]);
		expect(r.productSize).toBe(r.resultSeq.length);
	});
});
