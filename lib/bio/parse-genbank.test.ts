import { describe, expect, it } from "vitest";
import { parseGenBank, parseLocation } from "./parse-genbank";

// ── Fixture builder ────────────────────────────────────────────────────────────
// Constructs a minimal valid GenBank string. Callers only override the fields
// they care about, keeping each test focused on one behaviour.

function gbk({
	name = "TestSeq",
	topology = "linear" as "linear" | "circular",
	features = "",
	seq = "atcgatcg",
}: {
	name?: string;
	topology?: "linear" | "circular";
	features?: string;
	seq?: string;
} = {}): string {
	return (
		`LOCUS       ${name}               ${seq.length} bp    DNA     ${topology}\n` +
		`FEATURES             Location/Qualifiers\n${features}\n` +
		`ORIGIN\n        1 ${seq}\n//`
	);
}

// ── parseLocation ─────────────────────────────────────────────────────────────

describe("parseLocation", () => {
	it("parses a simple forward range", () => {
		const loc = parseLocation("100..200");
		expect(loc).toEqual({ start: 99, end: 200, direction: 1 });
	});

	it("feature length equals end − start (0-indexed, end exclusive)", () => {
		// GenBank 100..200 = 101 bases (1-indexed, both ends inclusive)
		const loc = parseLocation("100..200")!;
		expect(loc.end - loc.start).toBe(101);
	});

	it("parses a complement (minus-strand) range", () => {
		const loc = parseLocation("complement(100..200)");
		expect(loc).toEqual({ start: 99, end: 200, direction: -1 });
	});

	it("parses a multi-segment join as min/max span", () => {
		// join(100..200,300..400) → not origin-spanning → min/max
		const loc = parseLocation("join(100..200,300..400)");
		expect(loc).toEqual({ start: 99, end: 400, direction: 1 });
	});

	it("parses a complement join correctly", () => {
		const loc = parseLocation("complement(join(100..200,300..400))");
		expect(loc).toEqual({ start: 99, end: 400, direction: -1 });
	});

	it("detects origin-spanning join: first segment end > second segment start", () => {
		// join(2480..2686,1..150) on a 2686 bp plasmid
		const loc = parseLocation("join(2480..2686,1..150)");
		expect(loc).toEqual({ start: 2479, end: 150, direction: 1 });
	});

	it("treats overlapping segments as origin-spanning (documents heuristic)", () => {
		// join(100..200,50..150): seg1End=200 > seg2Start=50 → triggers wrap logic
		// This is probably malformed input, but the heuristic fires the same way.
		const loc = parseLocation("join(100..200,50..150)");
		expect(loc).toEqual({ start: 99, end: 150, direction: 1 });
	});

	it("handles partial-open features (<1..200 and 100..>200)", () => {
		expect(parseLocation("<1..200")).toEqual({ start: 0, end: 200, direction: 1 });
		expect(parseLocation("100..>200")).toEqual({ start: 99, end: 200, direction: 1 });
	});

	it("returns null for empty or non-numeric input", () => {
		expect(parseLocation("")).toBeNull();
		expect(parseLocation("complement()")).toBeNull();
	});

	it("split produces correct nums despite empty tokens from '..' separator", () => {
		// The regex [,..] splits "100..200" into ["100","","200"]; parseInt("") = NaN
		// is filtered. This test pins that the middle empty token does not corrupt coords.
		const loc = parseLocation("100..200");
		expect(loc?.start).toBe(99);
		expect(loc?.end).toBe(200);
	});
});

// ── parseGenBank — LOCUS line ─────────────────────────────────────────────────

describe("parseGenBank — LOCUS line", () => {
	it("extracts the sequence name", () => {
		expect(parseGenBank(gbk({ name: "pUC19" })).name).toBe("pUC19");
	});

	it("detects circular topology", () => {
		expect(parseGenBank(gbk({ topology: "circular" })).topology).toBe("circular");
	});

	it("defaults to linear when circular is absent", () => {
		expect(parseGenBank(gbk({ topology: "linear" })).topology).toBe("linear");
	});

	it("uses the first word of the first line as name when LOCUS is absent", () => {
		// No LOCUS keyword — parser treats first word of line 0 as the name.
		const minimal = `ORIGIN\n        1 atcg\n//`;
		expect(parseGenBank(minimal).name).toBe("ORIGIN");
	});

	it("returns linear topology for empty input", () => {
		expect(parseGenBank("").topology).toBe("linear");
	});
});

// ── parseGenBank — sequence extraction ───────────────────────────────────────

describe("parseGenBank — sequence extraction", () => {
	it("strips line numbers and whitespace from ORIGIN", () => {
		const result = parseGenBank(gbk({ seq: "atcgatcg" }));
		expect(result.seq).toBe("ATCGATCG");
	});

	it("uppercases the sequence", () => {
		const result = parseGenBank(gbk({ seq: "aattccgg" }));
		expect(result.seq).toBe("AATTCCGG");
	});

	it("handles multi-line ORIGIN blocks", () => {
		const content =
			`LOCUS       Test    70 bp    DNA     linear\n` +
			`FEATURES             Location/Qualifiers\n\n` +
			`ORIGIN\n` +
			`        1 atcgatcgat cgatcgatcg atcgatcgat cgatcgatcg atcgatcgat\n` +
			`       51 cgatcgatcg atcgatcgat\n` +
			`//`;
		const result = parseGenBank(content);
		expect(result.seq.length).toBe(70);
		expect(result.seq).toMatch(/^[ACGT]+$/);
	});

	it("returns empty string when ORIGIN section is absent", () => {
		const noOrigin = `LOCUS       Test    0 bp    DNA     linear\nFEATURES             Location/Qualifiers\n\n//`;
		expect(parseGenBank(noOrigin).seq).toBe("");
	});

	it("strips digits that appear within the sequence block", () => {
		const result = parseGenBank(gbk({ seq: "atcg" }));
		expect(result.seq).not.toMatch(/\d/);
	});
});

// ── parseGenBank — feature parsing ───────────────────────────────────────────

describe("parseGenBank — feature parsing", () => {
	const feat = (type: string, loc: string, qualifiers = "") =>
		`     ${type.padEnd(16)}${loc}\n${qualifiers}`;

	it("parses a simple forward CDS", () => {
		const input = gbk({
			features: feat("CDS", "100..200", `                     /label="AmpR"\n`),
		});
		const [ann] = parseGenBank(input).annotations;
		expect(ann).toMatchObject({ name: "AmpR", type: "CDS", start: 99, end: 200, direction: 1 });
	});

	it("parses a complement (minus-strand) feature", () => {
		const input = gbk({
			features: feat("promoter", "complement(50..80)", `                     /label="T7"\n`),
		});
		const [ann] = parseGenBank(input).annotations;
		expect(ann).toMatchObject({ direction: -1, start: 49, end: 80 });
	});

	it("parses an origin-spanning join feature", () => {
		const input = gbk({
			seq: "a".repeat(2686),
			features: feat("rep_origin", "join(2480..2686,1..150)", `                     /label="ori"\n`),
		});
		const [ann] = parseGenBank(input).annotations;
		expect(ann).toMatchObject({ start: 2479, end: 150, name: "ori" });
	});

	it("skips 'source' features", () => {
		const input = gbk({
			features: feat("source", "1..100", `                     /organism="E. coli"\n`),
		});
		expect(parseGenBank(input).annotations).toHaveLength(0);
	});

	it("skips 'gene' features (they duplicate adjacent CDS)", () => {
		const input = gbk({
			features:
				feat("gene", "100..200", `                     /gene="bla"\n`) +
				feat("CDS", "100..200", `                     /label="AmpR"\n`),
		});
		const anns = parseGenBank(input).annotations;
		expect(anns).toHaveLength(1);
		expect(anns[0]!.type).toBe("CDS");
	});

	it("uses type name as label when no qualifier is present", () => {
		const input = gbk({ features: feat("terminator", "300..350") });
		const [ann] = parseGenBank(input).annotations;
		expect(ann?.name).toBe("terminator");
	});

	it("truncates labels longer than 60 characters", () => {
		const longLabel = "A".repeat(80);
		const input = gbk({
			features: feat("CDS", "10..50", `                     /label="${longLabel}"\n`),
		});
		const [ann] = parseGenBank(input).annotations;
		expect(ann!.name.length).toBe(60);
	});

	it("assigns a known hex color to CDS features", () => {
		const input = gbk({
			features: feat("CDS", "1..10", `                     /label="X"\n`),
		});
		const [ann] = parseGenBank(input).annotations;
		expect(ann!.color).toBe("#85DAE9");
	});

	it("assigns fallback color to unknown feature types", () => {
		const input = gbk({
			features: feat("novel_type", "1..10", `                     /label="X"\n`),
		});
		const [ann] = parseGenBank(input).annotations;
		expect(ann!.color).toBe("#ABD9FF");
	});
});

// ── parseGenBank — qualifier priority and multi-line ─────────────────────────

describe("parseGenBank — qualifier handling", () => {
	const feat = (qualifiers: string) =>
		`     CDS             100..200\n${qualifiers}`;

	it("prefers /label over /gene", () => {
		const input = gbk({
			features: feat(
				`                     /label="AmpR"\n                     /gene="bla"\n`,
			),
		});
		expect(parseGenBank(input).annotations[0]!.name).toBe("AmpR");
	});

	it("falls back to /gene when /label is absent", () => {
		const input = gbk({
			features: feat(`                     /gene="bla"\n`),
		});
		expect(parseGenBank(input).annotations[0]!.name).toBe("bla");
	});

	it("falls back to /product when /label and /gene are absent", () => {
		const input = gbk({
			features: feat(`                     /product="beta-lactamase"\n`),
		});
		expect(parseGenBank(input).annotations[0]!.name).toBe("beta-lactamase");
	});

	it("falls back to /note as last resort", () => {
		const input = gbk({
			features: feat(`                     /note="resistance marker"\n`),
		});
		expect(parseGenBank(input).annotations[0]!.name).toBe("resistance marker");
	});

	it("handles a multi-line qualifier value", () => {
		const input = gbk({
			features: feat(
				`                     /note="this is a long note that\n` +
				`                     continues on the next line"\n`,
			),
		});
		const name = parseGenBank(input).annotations[0]!.name;
		expect(name).toContain("this is a long note");
	});
});

// ── parseGenBank — full integration ──────────────────────────────────────────

describe("parseGenBank — integration", () => {
	it("parses a realistic multi-feature circular plasmid", () => {
		const content =
			`LOCUS       pUC19                2686 bp    DNA     circular SYN\n` +
			`FEATURES             Location/Qualifiers\n` +
			`     source          1..2686\n` +
			`                     /organism="synthetic"\n` +
			`     gene            149..1207\n` +
			`                     /gene="bla"\n` +
			`     CDS             149..1207\n` +
			`                     /label="AmpR"\n` +
			`                     /product="beta-lactamase"\n` +
			`     promoter        complement(2044..2173)\n` +
			`                     /label="lac promoter"\n` +
			`     rep_origin      complement(1629..2217)\n` +
			`                     /label="pMB1 ori"\n` +
			`ORIGIN\n` +
			`        1 tcgcgcgttt cggtgatgac ggtgaaaacc tctgacacat gcagctcccg gagacggtca\n` +
			`//`;

		const result = parseGenBank(content);

		expect(result.name).toBe("pUC19");
		expect(result.topology).toBe("circular");
		expect(result.seq.length).toBeGreaterThan(0);
		expect(result.seq).toMatch(/^[ACGT]+$/);

		// source and gene should be filtered; CDS, promoter, rep_origin kept
		expect(result.annotations).toHaveLength(3);

		const ampR = result.annotations.find((a) => a.name === "AmpR");
		expect(ampR).toBeDefined();
		expect(ampR!.type).toBe("CDS");
		expect(ampR!.start).toBe(148);
		expect(ampR!.end).toBe(1207);
		expect(ampR!.direction).toBe(1);

		const lac = result.annotations.find((a) => a.name === "lac promoter");
		expect(lac!.direction).toBe(-1);
	});

	it("returns safe empty result for empty input", () => {
		// name is "" not "Sequence": lociParts[0] is "" (not undefined) so
		// the ?? fallback doesn't fire. Seq, annotations, topology are clean.
		const result = parseGenBank("");
		expect(result.seq).toBe("");
		expect(result.annotations).toEqual([]);
		expect(result.topology).toBe("linear");
	});
});
