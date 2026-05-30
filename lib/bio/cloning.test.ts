import { describe, expect, it } from "vitest";
import {
	ENZYME_MAP,
	areCompatible,
	findSites,
	junctionIsCuttable,
	junctionSequence,
	simulateRECloning,
} from "./cloning";

// Convenience: grab named enzymes from the map
const EcoRI   = ENZYME_MAP.get("EcoRI")!;
const BamHI   = ENZYME_MAP.get("BamHI")!;
const BglII   = ENZYME_MAP.get("BglII")!;
const NheI    = ENZYME_MAP.get("NheI")!;
const XbaI    = ENZYME_MAP.get("XbaI")!;
const EcoRV   = ENZYME_MAP.get("EcoRV")!;
const HindIII = ENZYME_MAP.get("HindIII")!;

// ── findSites ─────────────────────────────────────────────────────────────────

describe("findSites", () => {
	it("finds a single recognition site at the correct 0-indexed position", () => {
		expect(findSites("AAAAGAATTCCCC", "GAATTC")).toEqual([4]);
	});

	it("finds all occurrences when there are multiple sites", () => {
		expect(findSites("GAATTCNNNNGAATTC", "GAATTC")).toEqual([0, 10]);
	});

	it("returns an empty array when the site is absent", () => {
		expect(findSites("ATCGATCGATCG", "GAATTC")).toEqual([]);
	});

	it("is case-insensitive on the vector sequence", () => {
		expect(findSites("aaagaattcaaa", "GAATTC")).toEqual([3]);
	});
});

// ── areCompatible ─────────────────────────────────────────────────────────────

describe("areCompatible", () => {
	it("blunt + blunt are compatible", () => {
		expect(areCompatible(EcoRV, EcoRV)).toBe(true);
	});

	it("blunt + sticky end are not compatible", () => {
		expect(areCompatible(EcoRV, EcoRI)).toBe(false);
		expect(areCompatible(EcoRI, EcoRV)).toBe(false);
	});

	it("same enzyme is compatible with itself", () => {
		expect(areCompatible(EcoRI, EcoRI)).toBe(true);
	});

	it("different enzymes with the same overhang are compatible", () => {
		// BamHI (GATC) and BglII (GATC) share the same overhang
		expect(areCompatible(BamHI, BglII)).toBe(true);
	});

	it("enzymes with different overhangs are not compatible", () => {
		expect(areCompatible(EcoRI, BamHI)).toBe(false);  // AATT vs GATC
		expect(areCompatible(EcoRI, HindIII)).toBe(false); // AATT vs AGCT
	});
});

// ── junctionIsCuttable ────────────────────────────────────────────────────────

describe("junctionIsCuttable", () => {
	it("returns true for the same enzyme on both sides", () => {
		expect(junctionIsCuttable(EcoRI, EcoRI)).toBe(true);
	});

	it("returns false for different enzymes even if compatible", () => {
		expect(junctionIsCuttable(BamHI, BglII)).toBe(false);
	});
});

// ── junctionSequence ──────────────────────────────────────────────────────────

describe("junctionSequence", () => {
	it("returns the recognition sequence when the same enzyme is on both sides", () => {
		expect(junctionSequence(EcoRI, EcoRI)).toBe("GAATTC");
		expect(junctionSequence(BamHI, BamHI)).toBe("GGATCC");
	});

	it("returns the correct hybrid scar for NheI + XbaI (GCTAGA)", () => {
		// NheI (G^CTAGC) + XbaI (T^CTAGA) → GCTAGA hybrid scar
		expect(junctionSequence(NheI, XbaI)).toBe("GCTAGA");
	});

	it("hybrid scar has same length as a recognition site", () => {
		const scar = junctionSequence(NheI, XbaI);
		expect(scar.length).toBe(NheI.recognition.length);
	});
});

// ── simulateRECloning ─────────────────────────────────────────────────────────

// Vector with BamHI + BglII — compatible pair (both GATC overhang)
const VECTOR_BB =
	"AAAAAAAAAA" +   // 10 bp backbone
	"GGATCC" +       // BamHI at pos 10
	"NNNNNNNNNN" +   // 10 bp stuffer
	"AGATCT" +       // BglII at pos 26
	"AAAAAAAAAA";    // 10 bp backbone

// Vector with EcoRI + BamHI — incompatible pair
const VECTOR_EB =
	"AAAAAAAAAA" +
	"GAATTC" +       // EcoRI at pos 10
	"NNNNNNNNNN" +
	"GGATCC" +       // BamHI at pos 26
	"AAAAAAAAAA";

// Vector with two EcoRI sites for same-enzyme cloning
const VECTOR_EE =
	"AAAAAAAAAA" +
	"GAATTC" +
	"NNNNNNNNN" +
	"GAATTC" +
	"AAAAAAAAAA";

describe("simulateRECloning — errors", () => {
	it("returns error for empty insert", () => {
		const result = simulateRECloning(VECTOR_BB, BamHI, BglII, "");
		expect(result.error).toBeDefined();
		expect(result.error).toMatch(/empty/i);
	});

	it("returns error when e1 has no site in the vector", () => {
		const result = simulateRECloning("AAAAAAAAAA", EcoRI, HindIII, "ATGCCC");
		expect(result.error).toBeDefined();
		expect(result.error).toMatch(/EcoRI/);
	});

	it("returns error when e2 has no site in the vector", () => {
		const vectorWithOnlyEcoRI = "AAAAGAATTCAAAA";
		const result = simulateRECloning(vectorWithOnlyEcoRI, EcoRI, HindIII, "ATGCCC");
		expect(result.error).toBeDefined();
		expect(result.error).toMatch(/HindIII/);
	});

	it("returns error for incompatible enzymes", () => {
		// VECTOR_EB has both EcoRI and BamHI sites; the enzymes have different
		// overhangs (AATT vs GATC) so compatibility check fires.
		const result = simulateRECloning(VECTOR_EB, EcoRI, BamHI, "ATGCCC");
		expect(result.error).toBeDefined();
		expect(result.error).toMatch(/incompatible/i);
	});
});

describe("simulateRECloning — success", () => {
	const INSERT = "ATGTTTGGG";

	it("produces a result sequence containing both recognition sites", () => {
		const result = simulateRECloning(VECTOR_BB, BamHI, BglII, INSERT);
		expect(result.error).toBeUndefined();
		expect(result.resultSeq).toContain("GGATCC"); // BamHI
		expect(result.resultSeq).toContain("AGATCT"); // BglII
	});

	it("inserts the exact insert sequence between the enzyme sites", () => {
		const result = simulateRECloning(VECTOR_BB, BamHI, BglII, INSERT);
		expect(result.resultSeq).toContain("GGATCC" + INSERT + "AGATCT");
	});

	it("reports correct insertSize", () => {
		const result = simulateRECloning(VECTOR_BB, BamHI, BglII, INSERT);
		expect(result.insertSize).toBe(INSERT.length);
	});

	it("reports productSize == resultSeq.length", () => {
		const result = simulateRECloning(VECTOR_BB, BamHI, BglII, INSERT);
		expect(result.productSize).toBe(result.resultSeq.length);
	});

	it("leftJunctionCuttable is true (same enzyme reconstituted on each side)", () => {
		const result = simulateRECloning(VECTOR_BB, BamHI, BglII, INSERT);
		expect(result.leftJunctionCuttable).toBe(true);
		expect(result.rightJunctionCuttable).toBe(true);
	});

	it("warns when insert contains an internal BamHI site", () => {
		const insertWithSite = "ATG" + "GGATCC" + "TTTGGG";
		const result = simulateRECloning(VECTOR_BB, BamHI, BglII, insertWithSite);
		expect(result.warnings.some((w) => w.includes("BamHI"))).toBe(true);
	});

	it("handles same-enzyme cloning with two EcoRI sites", () => {
		const result = simulateRECloning(VECTOR_EE, EcoRI, EcoRI, INSERT);
		expect(result.error).toBeUndefined();
		expect(result.resultSeq).toContain(INSERT);
	});
});
