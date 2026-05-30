import { reverseComplement } from "@shandley/primd";

export interface CloneableEnzyme {
	name: string;
	recognition: string;
	overhang: string; // exposed single-stranded sequence (empty for blunt)
	endType: "5p" | "3p" | "blunt";
}

// Common restriction enzymes with pre-computed overhang sequences.
// overhang = the single-stranded sequence exposed after cutting.
// Compatible pairs share the same overhang sequence.
export const CLONEABLE_ENZYMES: CloneableEnzyme[] = [
	// ── 5′ overhangs ─────────────────────────────────────────────────────────
	{ name: "EcoRI", recognition: "GAATTC", overhang: "AATT", endType: "5p" },
	{ name: "BamHI", recognition: "GGATCC", overhang: "GATC", endType: "5p" },
	{ name: "BglII", recognition: "AGATCT", overhang: "GATC", endType: "5p" }, // compat BamHI
	{ name: "HindIII", recognition: "AAGCTT", overhang: "AGCT", endType: "5p" },
	{ name: "XhoI", recognition: "CTCGAG", overhang: "TCGA", endType: "5p" },
	{ name: "SalI", recognition: "GTCGAC", overhang: "TCGA", endType: "5p" }, // compat XhoI
	{ name: "NheI", recognition: "GCTAGC", overhang: "CTAG", endType: "5p" },
	{ name: "XbaI", recognition: "TCTAGA", overhang: "CTAG", endType: "5p" }, // compat NheI, SpeI, AvrII
	{ name: "SpeI", recognition: "ACTAGT", overhang: "CTAG", endType: "5p" }, // compat NheI, XbaI
	{ name: "AvrII", recognition: "CCTAGG", overhang: "CTAG", endType: "5p" }, // compat NheI, XbaI, SpeI
	{ name: "NcoI", recognition: "CCATGG", overhang: "CATG", endType: "5p" },
	{ name: "SphI", recognition: "GCATGC", overhang: "CATG", endType: "3p" }, // compat NcoI? No — different type
	{ name: "AgeI", recognition: "ACCGGT", overhang: "CCGG", endType: "5p" },
	{ name: "MluI", recognition: "ACGCGT", overhang: "CGCG", endType: "5p" },
	{ name: "ClaI", recognition: "ATCGAT", overhang: "CG", endType: "5p" },
	{ name: "BsrGI", recognition: "TGTACA", overhang: "GTAC", endType: "5p" },
	{ name: "NotI", recognition: "GCGGCCGC", overhang: "GGCC", endType: "5p" },
	{ name: "AscI", recognition: "GGCGCGCC", overhang: "CGCG", endType: "5p" },
	// ── 3′ overhangs ─────────────────────────────────────────────────────────
	{ name: "KpnI", recognition: "GGTACC", overhang: "GTAC", endType: "3p" },
	{ name: "SacI", recognition: "GAGCTC", overhang: "AGCT", endType: "3p" },
	{ name: "PstI", recognition: "CTGCAG", overhang: "TGCA", endType: "3p" },
	{ name: "SphI", recognition: "GCATGC", overhang: "CATG", endType: "3p" },
	{ name: "PacI", recognition: "TTAATTAA", overhang: "TAAT", endType: "3p" },
	{ name: "FseI", recognition: "GGCCGGCC", overhang: "GGCC", endType: "3p" },
	// ── Blunt ─────────────────────────────────────────────────────────────────
	{ name: "EcoRV", recognition: "GATATC", overhang: "", endType: "blunt" },
	{ name: "SmaI", recognition: "CCCGGG", overhang: "", endType: "blunt" },
	{ name: "PvuII", recognition: "CAGCTG", overhang: "", endType: "blunt" },
	{ name: "ScaI", recognition: "AGTACT", overhang: "", endType: "blunt" },
	{ name: "NruI", recognition: "TCGCGA", overhang: "", endType: "blunt" },
	{ name: "PmeI", recognition: "GTTTAAAC", overhang: "", endType: "blunt" },
];

// Remove duplicates (SphI appears twice above for demonstration — deduplicate)
const _seen = new Set<string>();
export const CLONEABLE_ENZYMES_UNIQUE = CLONEABLE_ENZYMES.filter((e) => {
	const key = e.name + e.endType;
	if (_seen.has(key)) return false;
	_seen.add(key);
	return true;
});

export const ENZYME_MAP = new Map(CLONEABLE_ENZYMES_UNIQUE.map((e) => [e.name, e]));

/** Find all occurrence positions (0-indexed start) of a recognition sequence in seq (+ strand only). */
export function findSites(seq: string, recognition: string): number[] {
	const positions: number[] = [];
	const upper = seq.toUpperCase();
	const rec = recognition.toUpperCase();
	for (let pos = upper.indexOf(rec, 0); pos !== -1; pos = upper.indexOf(rec, pos + 1)) {
		positions.push(pos);
	}
	return positions;
}

/** True if two enzyme ends will ligate (same or complementary overhang). */
export function areCompatible(e1: CloneableEnzyme, e2: CloneableEnzyme): boolean {
	if (e1.endType === "blunt" && e2.endType === "blunt") return true;
	if (e1.endType === "blunt" || e2.endType === "blunt") return false;
	// Compatible if same overhang sequence (palindromic overhangs are self-complementary)
	if (e1.overhang === e2.overhang) return true;
	// Also compatible if one overhang is the reverse complement of the other
	if (reverseComplement(e1.overhang) === e2.overhang) return true;
	return false;
}

/** True if the junction reconstitutes a known enzyme site (same enzyme on both ends). */
export function junctionIsCuttable(e1: CloneableEnzyme, e2: CloneableEnzyme): boolean {
	return e1.name === e2.name;
}

/** Sequence at the ligation junction (reconstituted from both enzyme halves). */
export function junctionSequence(e1: CloneableEnzyme, e2: CloneableEnzyme): string {
	if (e1.name === e2.name) return e1.recognition;
	// Hybrid scar (e.g. NheI + XbaI → GCTAGA)
	// For palindromic enzymes the cut is symmetric: (recognition.length − overhang.length) / 2
	// bases flank each side of the overhang in the recognition sequence.
	const flank = (e1.recognition.length - e1.overhang.length) / 2;
	const e1Left  = e1.recognition.slice(0, flank);
	const e2Right = e2.recognition.slice(flank + e2.overhang.length);
	return e1Left + e1.overhang + e2Right;
}

export interface RECloningResult {
	resultSeq: string;
	productSize: number;
	insertSize: number;
	leftJunction: string;
	rightJunction: string;
	leftJunctionCuttable: boolean;
	rightJunctionCuttable: boolean;
	e1Sites: number[];
	e2Sites: number[];
	warnings: string[];
	error?: string;
}

/**
 * Simulate dual-enzyme RE cloning.
 *
 * The vector is cut at its first enzyme1 site (left enzyme) and its first enzyme2
 * site after that. The insert sequence (provided WITHOUT enzyme recognition sequences)
 * is ligated between them. Returns the circular product sequence.
 *
 * For same-enzyme cloning, set sameEnzymeOrientation to "fwd" or "rev".
 */
export function simulateRECloning(
	vector: string,
	e1: CloneableEnzyme,
	e2: CloneableEnzyme,
	insert: string,
	sameEnzymeOrientation: "fwd" | "rev" = "fwd",
): RECloningResult {
	const warnings: string[] = [];
	const upper = vector.toUpperCase();
	const ins = insert.toUpperCase().replace(/[^ATGCN]/g, "");

	if (!ins)
		return {
			error: "Insert sequence is empty or contains only invalid characters.",
		} as RECloningResult;

	// Find enzyme sites
	const e1Sites = findSites(upper, e1.recognition);
	const e2Sites = findSites(upper, e2.recognition);

	if (e1Sites.length === 0)
		return {
			error: `${e1.name} (${e1.recognition}) has no recognition site in this vector.`,
		} as RECloningResult;

	const sameEnzyme = e1.name === e2.name;

	if (!sameEnzyme && e2Sites.length === 0)
		return {
			error: `${e2.name} (${e2.recognition}) has no recognition site in this vector.`,
		} as RECloningResult;

	if (!areCompatible(e1, e2))
		return {
			error: `${e1.name} and ${e2.name} produce incompatible sticky ends and cannot be ligated directly.`,
		} as RECloningResult;

	// Warn about internal enzyme sites in insert
	if (findSites(ins, e1.recognition).length > 0)
		warnings.push(
			`Insert contains an internal ${e1.name} site — partial digestion will occur during prep.`,
		);
	if (!sameEnzyme && findSites(ins, e2.recognition).length > 0)
		warnings.push(
			`Insert contains an internal ${e2.name} site — partial digestion will occur during prep.`,
		);

	// Choose cut positions
	let e1Pos = e1Sites[0];
	let e2Pos: number;

	if (sameEnzyme) {
		if (e1Sites.length === 1) {
			warnings.push(
				"Single-enzyme cloning with one cut site: insert may ligate in either orientation. Showing the selected orientation.",
			);
		}
		if (e1Sites.length > 1) {
			warnings.push(`${e1.name} has ${e1Sites.length} sites; using the first two.`);
		}
		e2Pos = e1Sites.length > 1 ? e1Sites[1] : e1Pos;
	} else {
		// Find e2 after e1 (or wrap around for circular plasmid)
		const e2After = e2Sites.find((p) => p > e1Pos);
		if (e2After !== undefined) {
			e2Pos = e2After;
		} else {
			// Wrap: e2 site comes before e1 in linear reading — swap orientation
			e2Pos = e2Sites[0];
			// Swap: e2 is actually the left enzyme
			const tmp = e1Pos;
			e1Pos = e2Pos;
			e2Pos = tmp;
			warnings.push(
				`${e1.name} site found after ${e2.name} in sequence; swapped to maintain left→right orientation.`,
			);
		}
	}

	if (e1Sites.length > 1)
		warnings.push(`${e1.name} has ${e1Sites.length} sites in vector; using position ${e1Pos + 1}.`);
	if (!sameEnzyme && e2Sites.length > 1)
		warnings.push(`${e2.name} has ${e2Sites.length} sites in vector; using position ${e2Pos + 1}.`);

	// Backbone = sequence excluding both recognition sites and the stuffer fragment
	// (everything from after e2 recognition site, wrapping to before e1 recognition site)
	const backbone = upper.slice(e2Pos + e2.recognition.length) + upper.slice(0, e1Pos);

	// Insert sequence (fwd or rev for same-enzyme)
	const insertSeq = sameEnzyme && sameEnzymeOrientation === "rev" ? reverseComplement(ins) : ins;

	// Reconstituted junction sequences and cuttability
	const leftJunction = junctionSequence(e1, e1);
	const rightJunction = junctionSequence(e2, e2);

	// Result: left_junction + insert + right_junction + backbone (circular)
	const resultSeq = e1.recognition + insertSeq + e2.recognition + backbone;

	return {
		resultSeq,
		productSize: resultSeq.length,
		insertSize: ins.length,
		leftJunction,
		rightJunction,
		leftJunctionCuttable: junctionIsCuttable(e1, e1),
		rightJunctionCuttable: junctionIsCuttable(e2, e2),
		e1Sites,
		e2Sites,
		warnings,
	};
}
