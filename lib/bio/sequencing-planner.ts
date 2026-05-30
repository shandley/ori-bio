/**
 * Sequencing strategy planner.
 *
 * Given a plasmid sequence and its annotations, recommends the minimum set of
 * Sanger sequencing reactions to achieve complete coverage. Universal primers
 * (T7, SP6, M13/pUC, T3) are detected by searching for their known sequences
 * in the top strand; custom primer positions are filled in algorithmically.
 *
 * Coverage model: a primer at position `p` reading in direction `d` covers
 * approximately [p, p + readLength) bases (for d=+1) or
 * [p - readLength, p) (for d=−1), on a 0-indexed basis. The first ~30bp of a
 * Sanger read are often noisy; this is not modelled explicitly here — the
 * caller may want to add extra overlap to account for it.
 *
 * Bidirectional CDS rule: for every CDS/gene annotation, at least one +
 * primer must cover its 5' half AND at least one − primer must cover its
 * 3' half. A single read from one direction rarely spans an entire CDS.
 */

import type { BioAnnotation } from "./parse-genbank";

// ── Universal primer library ───────────────────────────────────────────────────

export interface UniversalPrimerDef {
	name: string;
	/** Sequence to search for in the top strand (5'→3'). */
	sequence: string;
	description: string;
}

export const UNIVERSAL_PRIMERS: UniversalPrimerDef[] = [
	{
		name: "T7 promoter primer",
		sequence: "TAATACGACTCACTATAGGG",
		description: "Standard T7 promoter primer — reads into downstream insert",
	},
	{
		name: "T3 promoter primer",
		sequence: "AATTAACCCTCACTAAAGGG",
		description: "T3 promoter primer — reads into downstream insert",
	},
	{
		name: "SP6 promoter primer",
		sequence: "ATTTAGGTGACACTATAG",
		description: "SP6 promoter primer — reads into downstream insert",
	},
	{
		name: "M13/pUC Forward (-20)",
		sequence: "GTAAAACGACGGCCAG",
		description: "M13/pUC Forward primer (-20) — standard pUC MCS primer",
	},
	{
		name: "M13/pUC Forward (-47)",
		sequence: "CGCCAGGGTTTTCCCAGTCACGAC",
		description: "M13/pUC Forward primer (-47) — longer, higher-specificity variant",
	},
	{
		name: "M13/pUC Reverse (-24)",
		sequence: "AACAGCTATGACCATG",
		description: "M13/pUC Reverse primer (-24) — reads opposite direction through MCS",
	},
	{
		name: "M13/pUC Reverse (-48)",
		sequence: "AGCGGATAACAATTTCACACAGGA",
		description: "M13/pUC Reverse primer (-48) — longer reverse variant",
	},
];

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SequencingOptions {
	/** Usable read length in bp (default 700). */
	readLength?: number;
	/** Minimum overlap between adjacent reads (default 100). */
	minOverlap?: number;
	/** Add reverse primers to ensure CDS/gene features are read bidirectionally (default true). */
	bidirectionalCDS?: boolean;
}

export interface PlannedPrimer {
	id: string;
	index: number;
	/** Display name. */
	name: string;
	/** Oligonucleotide sequence to order (5'→3'). Universal primers are exact; custom primers are 20bp drafts. */
	sequence: string;
	/** 0-indexed position in the plasmid where the primer 5' end binds. */
	bindPosition: number;
	/** +1 reads forward (top strand), −1 reads backward (bottom strand). */
	direction: 1 | -1;
	/** First base of estimated coverage (0-indexed, inclusive). May exceed seqLength for circular wrapping. */
	coverageStart: number;
	/** Last base of estimated coverage (0-indexed, exclusive). May exceed seqLength for circular wrapping. */
	coverageEnd: number;
	/** True if this is a catalogued universal primer. */
	isUniversal: boolean;
	/** True for algorithmically placed primers — sequence is a 20bp draft, not thermodynamically verified. */
	isDraft: boolean;
	/** Annotation names this primer's read is expected to sequence. */
	annotationsCovered: string[];
}

export interface SequencingPlan {
	primers: PlannedPrimer[];
	seqLength: number;
	topology: "circular" | "linear";
	/** Fraction of the sequence covered by at least one read [0, 1]. */
	coveredFraction: number;
	/** Uncovered gaps (0-indexed, exclusive-end). Empty when coveredFraction === 1. */
	gaps: { start: number; end: number }[];
	totalReactions: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function reverseComplement(seq: string): string {
	const RC: Record<string, string> = { A: "T", T: "A", G: "C", C: "G", N: "N" };
	let rc = "";
	for (let i = seq.length - 1; i >= 0; i--) rc += RC[seq[i]!.toUpperCase()] ?? "N";
	return rc;
}

function findAll(haystack: string, needle: string): number[] {
	const positions: number[] = [];
	let pos = haystack.indexOf(needle, 0);
	while (pos !== -1) {
		positions.push(pos);
		pos = haystack.indexOf(needle, pos + 1);
	}
	return positions;
}

/**
 * Compute which bp positions in [0, seqLen) are covered, given a list of
 * [start, end) intervals (end may exceed seqLen for circular wraps).
 * Returns a boolean array of length seqLen.
 */
function computeCoverageArray(
	intervals: { start: number; end: number }[],
	seqLen: number,
): boolean[] {
	const covered = new Array<boolean>(seqLen).fill(false);
	for (const { start, end } of intervals) {
		const s = ((start % seqLen) + seqLen) % seqLen;
		const e = end > seqLen ? seqLen : Math.min(end, seqLen);
		for (let i = s; i < e; i++) covered[i] = true;
		if (end > seqLen) {
			// Wrap-around portion
			const wrap = end - seqLen;
			for (let i = 0; i < wrap && i < seqLen; i++) covered[i] = true;
		}
	}
	return covered;
}

/** Find uncovered gaps in a coverage array. */
function findGaps(covered: boolean[]): { start: number; end: number }[] {
	const gaps: { start: number; end: number }[] = [];
	let inGap = false;
	let gapStart = 0;
	for (let i = 0; i < covered.length; i++) {
		if (!covered[i] && !inGap) {
			inGap = true;
			gapStart = i;
		} else if (covered[i] && inGap) {
			gaps.push({ start: gapStart, end: i });
			inGap = false;
		}
	}
	if (inGap) gaps.push({ start: gapStart, end: covered.length });
	return gaps;
}

/** Names of annotations whose start..end interval overlaps a read's coverage. */
function annotationsCoveredBy(
	coverageStart: number,
	coverageEnd: number,
	annotations: BioAnnotation[],
	seqLen: number,
	direction: 1 | -1,
): string[] {
	const names: string[] = [];
	const cs = ((coverageStart % seqLen) + seqLen) % seqLen;
	const ce = coverageEnd > seqLen ? seqLen : Math.min(coverageEnd, seqLen);
	for (const ann of annotations) {
		const overlaps =
			ann.start < ce && ann.end > cs &&
			(direction === 1 ? ann.direction === 1 : true);
		if (overlaps) names.push(ann.name);
	}
	return names;
}

// ── Main algorithm ─────────────────────────────────────────────────────────────

export function planSequencing(
	seq: string,
	annotations: BioAnnotation[],
	topology: "circular" | "linear",
	options: SequencingOptions = {},
): SequencingPlan {
	const readLength = options.readLength ?? 700;
	const minOverlap = options.minOverlap ?? 100;
	const bidirectionalCDS = options.bidirectionalCDS ?? true;
	const step = readLength - minOverlap;

	const upper = seq.toUpperCase();
	const seqLen = upper.length;
	const primers: PlannedPrimer[] = [];
	let nextIndex = 1;

	const addPrimer = (p: Omit<PlannedPrimer, "id" | "index" | "annotationsCovered">) => {
		const cs = p.coverageStart;
		const ce = p.coverageEnd;
		primers.push({
			...p,
			id: `primer-${nextIndex}`,
			index: nextIndex++,
			annotationsCovered: annotationsCoveredBy(cs, ce, annotations, seqLen, p.direction),
		});
	};

	// ── Step 1: Place universal primers ─────────────────────────────────────────

	for (const def of UNIVERSAL_PRIMERS) {
		const primerSeq = def.sequence.toUpperCase();
		const primerLen = primerSeq.length;

		// Forward hits: primer sequence found in top strand → reads forward from end of primer
		for (const p of findAll(upper, primerSeq)) {
			const coverageStart = p + primerLen;
			const coverageEnd = coverageStart + readLength;
			addPrimer({
				name: def.name,
				sequence: def.sequence,
				bindPosition: p,
				direction: 1,
				coverageStart,
				coverageEnd,
				isUniversal: true,
				isDraft: false,
			});
		}

		// Reverse hits: RC of primer sequence in top strand → primer binds top strand, reads backward
		const rcSeq = reverseComplement(primerSeq);
		if (rcSeq !== primerSeq) { // skip palindromes
			for (const p of findAll(upper, rcSeq)) {
				// Primer binds [p, p+primerLen) on the top strand, reads from p backward
				const coverageEnd = p;
				const coverageStart = Math.max(0, coverageEnd - readLength);
				addPrimer({
					name: `${def.name} (reverse)`,
					sequence: rcSeq,
					bindPosition: p,
					direction: -1,
					coverageStart,
					coverageEnd,
					isUniversal: true,
					isDraft: false,
				});
			}
		}
	}

	// ── Step 2: Fill coverage gaps with custom primers ────────────────────────

	const universalIntervals = primers.map((p) => ({ start: p.coverageStart, end: p.coverageEnd }));
	let covered = computeCoverageArray(universalIntervals, seqLen);

	// Place forward primers until the full sequence (or as much as practical) is covered.
	// For circular: we need to also check that positions near the end wrap around.
	const maxPos = topology === "circular" ? seqLen : seqLen - readLength;

	for (let pos = 0; pos < Math.max(seqLen, maxPos + readLength); pos += step) {
		const wrappedPos = pos % seqLen;
		// If this position and its read window overlap an uncovered region, place a primer
		const windowEnd = pos + readLength;
		const windowCovered = computeCoverageArray(
			[{ start: pos, end: windowEnd }],
			seqLen,
		);

		const addsNewCoverage = covered.some(
			(c, i) => !c && windowCovered[i],
		);

		if (!addsNewCoverage) continue;
		if (pos > seqLen * 2) break; // safety valve

		const primerSeq = upper.slice(wrappedPos, Math.min(wrappedPos + 20, seqLen));
		if (primerSeq.length < 10) break;

		addPrimer({
			name: `Custom primer ${nextIndex} (fwd)`,
			sequence: primerSeq,
			bindPosition: wrappedPos,
			direction: 1,
			coverageStart: pos,
			coverageEnd: pos + readLength,
			isUniversal: false,
			isDraft: true,
		});

		// Recompute coverage including new primer
		covered = computeCoverageArray(
			primers.map((p) => ({ start: p.coverageStart, end: p.coverageEnd })),
			seqLen,
		);

		// Stop if fully covered
		if (covered.every(Boolean)) break;
	}

	// ── Step 3: Bidirectional coverage for CDS/gene annotations ─────────────

	if (bidirectionalCDS) {
		const cdsAnnotations = annotations.filter(
			(a) => a.type === "CDS" || a.type === "gene",
		);

		for (const ann of cdsAnnotations) {
			const midpoint = Math.floor((ann.start + ann.end) / 2);

			// Does at least one + primer cover the first half of this CDS?
			const fwdCoversStart = primers.some(
				(p) =>
					p.direction === 1 &&
					p.coverageStart <= ann.start &&
					p.coverageEnd >= midpoint,
			);
			// Does at least one − primer cover the second half?
			const revCoversEnd = primers.some(
				(p) =>
					p.direction === -1 &&
					p.coverageEnd >= midpoint &&
					p.coverageStart <= ann.end,
			);

			if (!fwdCoversStart) {
				// Add a forward primer near the start of the CDS (offset back by readLength/4
				// so the read enters the CDS with good quality)
				const bindPos = Math.max(0, ann.start - Math.floor(readLength / 4));
				const seq20 = upper.slice(bindPos, bindPos + 20);
				if (seq20.length >= 10) {
					addPrimer({
						name: `${ann.name} fwd primer`,
						sequence: seq20,
						bindPosition: bindPos,
						direction: 1,
						coverageStart: bindPos,
						coverageEnd: bindPos + readLength,
						isUniversal: false,
						isDraft: true,
					});
				}
			}

			if (!revCoversEnd) {
				// Add a reverse primer reading into the end of the CDS
				const bindPos = Math.min(seqLen, ann.end + Math.floor(readLength / 4));
				const seq20 = reverseComplement(
					upper.slice(Math.max(0, bindPos - 20), bindPos),
				);
				if (seq20.length >= 10) {
					addPrimer({
						name: `${ann.name} rev primer`,
						sequence: seq20,
						bindPosition: bindPos,
						direction: -1,
						coverageStart: Math.max(0, bindPos - readLength),
						coverageEnd: bindPos,
						isUniversal: false,
						isDraft: true,
					});
				}
			}
		}
	}

	// ── Step 4: Compute final coverage statistics ─────────────────────────────

	const finalCovered = computeCoverageArray(
		primers.map((p) => ({ start: p.coverageStart, end: p.coverageEnd })),
		seqLen,
	);
	const coveredBases = finalCovered.filter(Boolean).length;
	const coveredFraction = seqLen > 0 ? coveredBases / seqLen : 0;
	const gaps = findGaps(finalCovered);

	// Sort primers by position for display, then re-index and rename custom primers
	// so display index matches name (avoids "Custom primer 3" appearing as #1).
	primers.sort((a, b) => a.bindPosition - b.bindPosition || a.direction - b.direction);
	let customFwdCount = 0;
	let customRevCount = 0;
	primers.forEach((p, i) => {
		p.index = i + 1;
		p.id = `primer-${i + 1}`;
		if (p.isDraft && p.name.startsWith("Custom primer")) {
			if (p.direction === 1) {
				customFwdCount++;
				p.name = `Custom fwd primer ${customFwdCount}`;
			} else {
				customRevCount++;
				p.name = `Custom rev primer ${customRevCount}`;
			}
		}
	});

	return {
		primers,
		seqLength: seqLen,
		topology,
		coveredFraction,
		gaps,
		totalReactions: primers.length,
	};
}
