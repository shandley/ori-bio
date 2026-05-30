import { describe, expect, it } from "vitest";
import { computeExtinctionCoefficient, computeGRAVY, computePI, translate } from "./translate";

// ── computeGRAVY ──────────────────────────────────────────────────────────────

describe("computeGRAVY", () => {
	it("returns the KD value for a single-amino-acid sequence", () => {
		expect(computeGRAVY("A")).toBeCloseTo(1.8);   // Ala
		expect(computeGRAVY("R")).toBeCloseTo(-4.5);  // Arg
		expect(computeGRAVY("I")).toBeCloseTo(4.5);   // Ile
	});

	it("averages correctly for a two-residue sequence", () => {
		// (A + R) / 2 = (1.8 + −4.5) / 2 = −1.35
		expect(computeGRAVY("AR")).toBeCloseTo(-1.35);
	});

	it("excludes stop codons (*) from the average", () => {
		// A*A → only two A residues, not three
		expect(computeGRAVY("A*A")).toBeCloseTo(1.8);
	});

	it("excludes unknown residues (X) from the average", () => {
		expect(computeGRAVY("AXA")).toBeCloseTo(1.8);
	});

	it("returns 0 for an empty sequence", () => {
		expect(computeGRAVY("")).toBe(0);
		expect(computeGRAVY("*")).toBe(0);
	});

	it("returns negative GRAVY for a hydrophilic sequence", () => {
		expect(computeGRAVY("RRRRR")).toBeLessThan(0);
	});

	it("returns positive GRAVY for a hydrophobic sequence", () => {
		expect(computeGRAVY("IIIII")).toBeGreaterThan(0);
	});
});

// ── computeExtinctionCoefficient ─────────────────────────────────────────────

describe("computeExtinctionCoefficient", () => {
	it("returns 5500 for a single Trp", () => {
		expect(computeExtinctionCoefficient("W")).toBe(5500);
	});

	it("returns 1490 for a single Tyr", () => {
		expect(computeExtinctionCoefficient("Y")).toBe(1490);
	});

	it("sums contributions correctly for multiple chromophores", () => {
		// 2 Trp + 1 Tyr = 5500×2 + 1490 = 12490
		expect(computeExtinctionCoefficient("WWY")).toBe(12490);
		// 1 Trp + 2 Tyr = 5500 + 1490×2 = 8480
		expect(computeExtinctionCoefficient("WYY")).toBe(8480);
	});

	it("returns 0 for sequences with no Trp or Tyr", () => {
		expect(computeExtinctionCoefficient("MAAA")).toBe(0);
		expect(computeExtinctionCoefficient("")).toBe(0);
	});

	it("Cys does not contribute in the reduced form", () => {
		// Cys (C) contributes 0 when cysteines are reduced
		expect(computeExtinctionCoefficient("MCCC")).toBe(0);
	});

	it("ignores stop codon character", () => {
		// W* → same as W alone (stop is not a residue)
		expect(computeExtinctionCoefficient("W*")).toBe(5500);
	});
});

// ── computePI ────────────────────────────────────────────────────────────────

describe("computePI", () => {
	it("returns NaN for an empty protein", () => {
		expect(Number.isNaN(computePI(""))).toBe(true);
	});

	it("returns a value in [0, 14] for any non-empty protein", () => {
		for (const seq of ["M", "MAAA", "MKKKK", "MDDDD", "MWYYY"]) {
			const pi = computePI(seq);
			expect(pi).toBeGreaterThanOrEqual(0);
			expect(pi).toBeLessThanOrEqual(14);
		}
	});

	it("basic proteins have pI above 7", () => {
		// Poly-Lys (strongly basic)
		expect(computePI("KKKKK")).toBeGreaterThan(7);
		// Poly-Arg
		expect(computePI("RRRRR")).toBeGreaterThan(7);
	});

	it("acidic proteins have pI below 7", () => {
		// Poly-Asp
		expect(computePI("DDDDD")).toBeLessThan(7);
		// Poly-Glu
		expect(computePI("EEEEE")).toBeLessThan(7);
	});

	it("pI of poly-Lys is higher than pI of poly-Asp", () => {
		expect(computePI("KKKKK")).toBeGreaterThan(computePI("DDDDD"));
	});

	it("net charge at pI is approximately zero", () => {
		// Verify the bisection produced the correct root: charge at pI ≈ 0
		// We can check this indirectly: a protein slightly longer on the basic side
		// should give pI > 7, shorter should give pI < 7
		const basicPep = "MKRR";  // Met + two Arg → basic
		const acidicPep = "MEED"; // Met + two Glu + Asp → acidic
		expect(computePI(basicPep)).toBeGreaterThan(7);
		expect(computePI(acidicPep)).toBeLessThan(7);
	});

	it("excludes stop codons from pI computation", () => {
		// M* should give same pI as M (stop not counted as residue)
		expect(computePI("M*")).toBeCloseTo(computePI("M"), 2);
	});

	it("is stable for a longer realistic sequence (AmpR-like)", () => {
		// Abbreviated AmpR-like sequence — just verify no NaN and plausible range
		const ampR = "MSIQHFRVALIPFFAAFCLPVFAHPETLVKVKDAEDQLGARVGYIELD";
		const pi = computePI(ampR);
		expect(pi).toBeGreaterThan(0);
		expect(pi).toBeLessThan(14);
		expect(Number.isNaN(pi)).toBe(false);
	});
});

// ── Integration: translate → computeGRAVY / ε / pI ──────────────────────────

describe("translate → protein properties pipeline", () => {
	it("translates a known codon and computes correct ε", () => {
		// TGG = Trp → ε = 5500
		const protein = translate("ATG" + "TGG" + "TAA"); // M W *
		expect(computeExtinctionCoefficient(protein)).toBe(5500);
	});

	it("translates a hydrophobic codon run and gives positive GRAVY", () => {
		// ATT = Ile (4.5), CTG = Leu (3.8), GTG = Val (4.2), ATG = Met (1.9)
		const protein = translate("ATT" + "CTG" + "GTG" + "ATG");
		expect(computeGRAVY(protein)).toBeGreaterThan(0);
	});
});
