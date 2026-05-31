import { describe, expect, it } from "vitest";
import { computeGCContent, computeGCProfile, computeGCStats } from "./gc";

describe("computeGCContent", () => {
	it("returns 1.0 for all-GC sequence", () => {
		expect(computeGCContent("GCGCGC")).toBeCloseTo(1.0);
	});

	it("returns 0.0 for all-AT sequence", () => {
		expect(computeGCContent("ATATAT")).toBeCloseTo(0.0);
	});

	it("returns 0.5 for equal GC and AT", () => {
		expect(computeGCContent("ATAT" + "GCGC")).toBeCloseTo(0.5);
	});

	it("ignores non-ACGT characters", () => {
		// N and - are not counted — GC/total over ACGT only
		expect(computeGCContent("GCN-AT")).toBeCloseTo(0.5); // 2 GC, 2 AT, 2 ignored
	});

	it("returns 0 for empty sequence", () => {
		expect(computeGCContent("")).toBe(0);
	});

	it("is case-insensitive", () => {
		expect(computeGCContent("gcgc")).toBeCloseTo(1.0);
	});
});

describe("computeGCProfile", () => {
	it("returns empty array when sequence is shorter than window", () => {
		expect(computeGCProfile("ATCG", 10)).toHaveLength(0);
	});

	it("returns one value when sequence equals window", () => {
		const p = computeGCProfile("GCGC", 4);
		expect(p).toHaveLength(1);
		expect(p[0]).toBeCloseTo(1.0);
	});

	it("profile length equals seq.length - windowSize + 1", () => {
		const seq = "A".repeat(100);
		const p = computeGCProfile(seq, 20);
		expect(p).toHaveLength(81);
	});

	it("all-AT sequence gives profile of all zeros", () => {
		const p = computeGCProfile("ATATATATAT", 4);
		for (const v of p) expect(v).toBeCloseTo(0);
	});

	it("all-GC sequence gives profile of all ones", () => {
		const p = computeGCProfile("GCGCGCGCGC", 4);
		for (const v of p) expect(v).toBeCloseTo(1.0);
	});

	it("correctly computes GC at each window position", () => {
		// AAGG: window 2 → positions [0, 2]
		// pos 0: AA → 0.0
		// pos 1: AG → 0.5
		// pos 2: GG → 1.0
		const p = computeGCProfile("AAGG", 2);
		expect(p[0]).toBeCloseTo(0.0);
		expect(p[1]).toBeCloseTo(0.5);
		expect(p[2]).toBeCloseTo(1.0);
	});

	it("sliding window is O(n) — large sequence, large window", () => {
		// Just verify it runs and gives correct overall mean
		const seq = "GC".repeat(5000) + "AT".repeat(5000); // 20000 bp, 50% GC
		const p = computeGCProfile(seq, 100);
		const mean = Array.from(p).reduce((s, v) => s + v, 0) / p.length;
		expect(mean).toBeCloseTo(0.5, 1);
	});

	it("all values are in [0, 1]", () => {
		const seq = "ATGCATGCATGC";
		const p = computeGCProfile(seq, 4);
		for (const v of p) {
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThanOrEqual(1);
		}
	});
});

describe("computeGCStats", () => {
	it("correctly counts low and high GC windows", () => {
		// 4 windows: 0.0, 0.25, 0.75, 1.0
		const profile = new Float32Array([0.0, 0.25, 0.75, 1.0]);
		const stats = computeGCStats("AAATGCGC", profile);
		expect(stats.lowGCWindows).toBe(2);  // 0.0 and 0.25 < 0.30
		expect(stats.highGCWindows).toBe(2); // 0.75 and 1.0 > 0.70
	});

	it("reports correct min and max", () => {
		const profile = new Float32Array([0.2, 0.5, 0.8]);
		const stats = computeGCStats("GCGCAT", profile);
		expect(stats.minGC).toBeCloseTo(0.2);
		expect(stats.maxGC).toBeCloseTo(0.8);
	});

	it("handles empty profile gracefully", () => {
		const stats = computeGCStats("AT", new Float32Array([]));
		expect(stats.lowGCWindows).toBe(0);
		expect(stats.highGCWindows).toBe(0);
	});
});
