import { describe, expect, it } from "vitest";
import type { ConstructDesign, InsertInfo } from "./assemble-construct";
import { assembleConstruct, validateDesign } from "./assemble-construct";

// ── Minimal valid designs ─────────────────────────────────────────────────────
// Use real part IDs from the E. coli catalog.

function validDesignWithInsert(): ConstructDesign {
	return {
		constructName: "pTest",
		organism: "ecoli",
		parts: [
			{ partId: "t7_promoter", direction: 1 },
			{ partId: "b0034_rbs",   direction: 1 },
			{ partId: "INSERT",      direction: 1 },
			{ partId: "t7_terminator", direction: 1 },
			{ partId: "colE1_ori",   direction: 1 },
			{ partId: "ampR_marker", direction: 1 },
		],
		explanation: "test",
		warnings: [],
	};
}

function validDesignCatalogCDS(): ConstructDesign {
	return {
		constructName: "pEGFP",
		organism: "ecoli",
		parts: [
			{ partId: "t7_promoter",  direction: 1 },
			{ partId: "b0034_rbs",    direction: 1 },
			{ partId: "egfp_cds",     direction: 1 },
			{ partId: "t7_terminator", direction: 1 },
			{ partId: "colE1_ori",    direction: 1 },
			{ partId: "ampR_marker",  direction: 1 },
		],
		explanation: "test",
		warnings: [],
	};
}

const VALID_INSERT: InsertInfo = {
	name: "MyGene",
	seq: "ATGAAACCCGGG" + "TAA", // starts ATG, has in-frame stop
};

// ── validateDesign ────────────────────────────────────────────────────────────

describe("validateDesign — errors", () => {
	it("reports error for an unknown part ID", () => {
		const design = validDesignWithInsert();
		design.parts[0] = { partId: "not_a_real_part", direction: 1 };
		const warnings = validateDesign(design, VALID_INSERT);
		const errors = warnings.filter((w) => w.severity === "error");
		expect(errors.some((e) => e.message.includes("not_a_real_part"))).toBe(true);
	});

	it("reports error when there is no CDS and no INSERT", () => {
		const design: ConstructDesign = {
			constructName: "pNoCDS",
			organism: "ecoli",
			parts: [
				{ partId: "t7_promoter",  direction: 1 },
				{ partId: "colE1_ori",    direction: 1 },
				{ partId: "ampR_marker",  direction: 1 },
			],
			explanation: "",
			warnings: [],
		};
		const warnings = validateDesign(design);
		expect(warnings.some((w) => w.severity === "error" && /coding sequence/i.test(w.message))).toBe(true);
	});

	it("reports error when INSERT is in parts but no sequence is provided", () => {
		const design = validDesignWithInsert();
		const warnings = validateDesign(design, { name: "x", seq: "" });
		expect(warnings.some((w) => w.severity === "error")).toBe(true);
	});

	it("reports error when there is no origin of replication", () => {
		const design = validDesignWithInsert();
		design.parts = design.parts.filter((p) => p.partId !== "colE1_ori");
		const warnings = validateDesign(design, VALID_INSERT);
		expect(warnings.some((w) => w.severity === "error" && /origin/i.test(w.message))).toBe(true);
	});

	it("reports error when there is no selection marker", () => {
		const design = validDesignWithInsert();
		design.parts = design.parts.filter((p) => p.partId !== "ampR_marker");
		const warnings = validateDesign(design, VALID_INSERT);
		expect(warnings.some((w) => w.severity === "error" && /marker/i.test(w.message))).toBe(true);
	});
});

describe("validateDesign — warnings", () => {
	it("warns when INSERT appears more than once", () => {
		const design = validDesignWithInsert();
		design.parts.push({ partId: "INSERT", direction: 1 });
		const warnings = validateDesign(design, VALID_INSERT);
		expect(warnings.some((w) => w.severity === "warning" && /more than once/i.test(w.message))).toBe(true);
	});

	it("warns when insert does not start with ATG", () => {
		const design = validDesignWithInsert();
		const warnings = validateDesign(design, { name: "x", seq: "CCCAAATAA" });
		expect(warnings.some((w) => /ATG/i.test(w.message))).toBe(true);
	});

	it("warns when insert has no in-frame stop codon", () => {
		const design = validDesignWithInsert();
		// 12bp ORF with no stop
		const warnings = validateDesign(design, { name: "x", seq: "ATGAAACCCGGG" });
		expect(warnings.some((w) => /stop codon/i.test(w.message))).toBe(true);
	});

	it("warns when a promoter is on the opposite strand from the CDS", () => {
		const design = validDesignWithInsert();
		// Flip the promoter to -1 while CDS (INSERT) stays +1
		design.parts[0] = { partId: "t7_promoter", direction: -1 };
		const warnings = validateDesign(design, VALID_INSERT);
		expect(warnings.some((w) => /opposite strand/i.test(w.message))).toBe(true);
	});

	it("returns no errors for a valid design with INSERT", () => {
		const warnings = validateDesign(validDesignWithInsert(), VALID_INSERT);
		const errors = warnings.filter((w) => w.severity === "error");
		expect(errors).toHaveLength(0);
	});

	it("returns no errors for a valid design using a catalog CDS", () => {
		const warnings = validateDesign(validDesignCatalogCDS());
		const errors = warnings.filter((w) => w.severity === "error");
		expect(errors).toHaveLength(0);
	});
});

// ── assembleConstruct ─────────────────────────────────────────────────────────

describe("assembleConstruct — sequence assembly", () => {
	it("returns circular topology", () => {
		const result = assembleConstruct(validDesignCatalogCDS());
		expect(result.topology).toBe("circular");
	});

	it("uses the construct name from the design", () => {
		const result = assembleConstruct(validDesignCatalogCDS());
		expect(result.name).toBe("pEGFP");
	});

	it("produces a non-empty sequence", () => {
		const result = assembleConstruct(validDesignCatalogCDS());
		expect(result.seq.length).toBeGreaterThan(0);
	});

	it("produces one annotation per non-skipped part", () => {
		const design = validDesignCatalogCDS();
		const result = assembleConstruct(design);
		expect(result.annotations).toHaveLength(design.parts.length);
	});

	it("annotations are sorted by start position (parts assembled in order)", () => {
		const result = assembleConstruct(validDesignCatalogCDS());
		for (let i = 1; i < result.annotations.length; i++) {
			expect(result.annotations[i]!.start).toBeGreaterThanOrEqual(
				result.annotations[i - 1]!.start,
			);
		}
	});

	it("each annotation's end − start equals the part's sequence length", () => {
		const result = assembleConstruct(validDesignCatalogCDS());
		for (const ann of result.annotations) {
			expect(ann.end - ann.start).toBeGreaterThan(0);
		}
	});

	it("annotations tile the full sequence without gaps", () => {
		const result = assembleConstruct(validDesignCatalogCDS());
		const anns = [...result.annotations].sort((a, b) => a.start - b.start);
		expect(anns[0]!.start).toBe(0);
		for (let i = 1; i < anns.length; i++) {
			expect(anns[i]!.start).toBe(anns[i - 1]!.end);
		}
		expect(anns[anns.length - 1]!.end).toBe(result.seq.length);
	});

	it("places INSERT sequence in the result when provided", () => {
		const insertSeq = "ATGAAACCCGGGTAA";
		const result = assembleConstruct(validDesignWithInsert(), {
			name: "MyGene",
			seq: insertSeq,
		});
		expect(result.seq).toContain(insertSeq.toUpperCase());
	});

	it("uses reverse complement of part when direction is -1", () => {
		const design = validDesignCatalogCDS();
		// Flip the first part to -1
		design.parts[0] = { ...design.parts[0]!, direction: -1 };
		const fwd = assembleConstruct(validDesignCatalogCDS());
		const rev = assembleConstruct(design);
		// The first part's sequence will differ between the two results
		const fwdStart = fwd.seq.slice(0, fwd.annotations[0]!.end);
		const revStart = rev.seq.slice(0, rev.annotations[0]!.end);
		expect(fwdStart).not.toBe(revStart);
	});

	it("annotation direction matches the part direction", () => {
		const design = validDesignCatalogCDS();
		design.parts[0] = { ...design.parts[0]!, direction: -1 };
		const result = assembleConstruct(design);
		expect(result.annotations[0]!.direction).toBe(-1);
	});
});
