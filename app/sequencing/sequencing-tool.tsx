"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { SiteNav } from "@/components/nav/site-nav";
import { parseGenBank } from "@/lib/bio/parse-genbank";
import type { BioAnnotation } from "@/lib/bio/parse-genbank";
import { planSequencing } from "@/lib/bio/sequencing-planner";
import type { PlannedPrimer, SequencingPlan } from "@/lib/bio/sequencing-planner";

// ── Example: real pUC19 (NCBI L09137, 2686 bp) ──────────────────────────────
// Universal primers present: M13/pUC Forward (−20 at 378, −47 at 351) and
// Reverse (−24 at 460, −48 at 476). pUC19 does NOT have T7/T3/SP6 sites —
// those are in pET/pBluescript vectors.

const EXAMPLE_GENBANK = `LOCUS       pUC19                2686 bp    DNA     circular SYN 22-MAY-2002
FEATURES             Location/Qualifiers
     rep_origin      complement(2522..2686)
                     /label="pMB1 ori"
     CDS             complement(1629..2489)
                     /label="AmpR"
     promoter        complement(2490..2593)
                     /label="AmpR promoter"
     CDS             complement(149..816)
                     /label="lacZ-alpha"
     promoter        complement(817..931)
                     /label="lac promoter"
     misc_feature    complement(396..452)
                     /label="MCS"
ORIGIN
           1 tcgcgcgttt cggtgatgac ggtgaaaacc tctgacacat gcagctcccg gagacggtca
          61 cagcttgtct gtaagcggat gccgggagca gacaagcccg tcagggcgcg tcagcgggtg
         121 ttggcgggtg tcggggctgg cttaactatg cggcatcaga gcagattgta ctgagagtgc
         181 accatatgcg gtgtgaaata ccgcacagat gcgtaaggag aaaataccgc atcaggcgcc
         241 attcgccatt caggctgcgc aactgttggg aagggcgatc ggtgcgggcc tcttcgctat
         301 tacgccagct ggcgaaaggg ggatgtgctg caaggcgatt aagttgggta acgccagggt
         361 tttcccagtc acgacgttgt aaaacgacgg ccagtgaatt cgagctcggt acccggggat
         421 cctctagagt cgacctgcag gcatgcaagc ttggcgtaat catggtcata gctgtttcct
         481 gtgtgaaatt gttatccgct cacaattcca cacaacatac gagccggaag cataaagtgt
         541 aaagcctggg gtgcctaatg agtgagctaa ctcacattaa ttgcgttgcg ctcactgccc
         601 gctttccagt cgggaaacct gtcgtgccag ctgcattaat gaatcggcca acgcgcgggg
         661 agaggcggtt tgcgtattgg gcgctcttcc gcttcctcgc tcactgactc gctgcgctcg
         721 gtcgttcggc tgcggcgagc ggtatcagct cactcaaagg cggtaatacg gttatccaca
         781 gaatcagggg ataacgcagg aaagaacatg tgagcaaaag gccagcaaaa ggccaggaac
         841 cgtaaaaagg ccgcgttgct ggcgtttttc cataggctcc gcccccctga cgagcatcac
         901 aaaaatcgac gctcaagtca gaggtggcga aacccgacag gactataaag ataccaggcg
         961 tttccccctg gaagctccct cgtgcgctct cctgttccga ccctgccgct taccggatac
        1021 ctgtccgcct ttctcccttc gggaagcgtg gcgctttctc atagctcacg ctgtaggtat
        1081 ctcagttcgg tgtaggtcgt tcgctccaag ctgggctgtg tgcacgaacc ccccgttcag
        1141 cccgaccgct gcgccttatc cggtaactat cgtcttgagt ccaacccggt aagacacgac
        1201 ttatcgccac tggcagcagc cactggtaac aggattagca gagcgaggta tgtaggcggt
        1261 gctacagagt tcttgaagtg gtggcctaac tacggctaca ctagaagaac agtatttggt
        1321 atctgcgctc tgctgaagcc agttaccttc ggaaaaagag ttggtagctc ttgatccggc
        1381 aaacaaacca ccgctggtag cggtggtttt tttgtttgca agcagcagat tacgcgcaga
        1441 aaaaaaggat ctcaagaaga tcctttgatc ttttctacgg ggtctgacgc tcagtggaac
        1501 gaaaactcac gttaagggat tttggtcatg agattatcaa aaaggatctt cacctagatc
        1561 cttttaaatt aaaaatgaag ttttaaatca atctaaagta tatatgagta aacttggtct
        1621 gacagttacc aatgcttaat cagtgaggca cctatctcag cgatctgtct atttcgttca
        1681 tccatagttg cctgactccc cgtcgtgtag ataactacga tacgggaggg cttaccatct
        1741 ggccccagtg ctgcaatgat accgcgagac ccacgctcac cggctccaga tttatcagca
        1801 ataaaccagc cagccggaag ggccgagcgc agaagtggtc ctgcaacttt atccgcctcc
        1861 atccagtcta ttaattgttg ccgggaagct agagtaagta gttcgccagt taatagtttg
        1921 cgcaacgttg ttgccattgc tacaggcatc gtggtgtcac gctcgtcgtt tggtatggct
        1981 tcattcagct ccggttccca acgatcaagg cgagttacat gatcccccat gttgtgcaaa
        2041 aaagcggtta gctccttcgg tcctccgatc gttgtcagaa gtaagttggc cgcagtgtta
        2101 tcactcatgg ttatggcagc actgcataat tctcttactg tcatgccatc cgtaagatgc
        2161 ttttctgtga ctggtgagta ctcaaccaag tcattctgag aatagtgtat gcggcgaccg
        2221 agttgctctt gcccggcgtc aatacgggat aataccgcgc cacatagcag aactttaaaa
        2281 gtgctcatca ttggaaaacg ttcttcgggg cgaaaactct caaggatctt accgctgttg
        2341 agatccagtt cgatgtaacc cactcgtgca cccaactgat cttcagcatc ttttactttc
        2401 accagcgttt ctgggtgagc aaaaacagga aggcaaaatg ccgcaaaaaa gggaataagg
        2461 gcgacacgga aatgttgaat actcatactc ttcctttttc aatattattg aagcatttat
        2521 cagggttatt gtctcatgag cggatacata tttgaatgta tttagaaaaa taaacaaata
        2581 ggggttccgc gcacatttcc ccgaaaagtg ccacctgacg tctaagaaac cattattatc
        2641 atgacattaa cctataaaaa taggcgtatc acgaggccct ttcgtc
     2161 tgggccatcg ccctgataga cggtttttcg ccctttgacg ttggagtcca cgttctttaa
     2221 tagtggactc ttgttccaaa ctggaacaac actcaacccg ctctcggggc tttgtttatt
     2281 gcagcttata atggttacaa ataaagcaat agcatcacaa atttcacaaa taaagcattt
     2341 ttttcactgc attctagttg tggtttgtcc aaactcatca atgtatctta tcatgtctgg
     2401 atcaactgga taactggctt tatccaccca ctcatacttt agcagatacg aacaatgaaa
     2461 tggttttttt tgtcttttaa ggaaacacca tgagtaaagg agaagaactt ttcactggag
     2521 ttgtcccaat tcttgttgaa ttagatggtg atgttaatgg gcacaaattt tctgtcagtg
     2581 gaaggtgaag gtgatgcaac ataccgaaag ctaagttacg gtaagtttat gcaagcagat
     2641 ggcaattttt attagttgtg gtcttgttgg cagttattgt gaagcat
//`;

// ── Types ─────────────────────────────────────────────────────────────────────

interface ParsedRef {
	name: string;
	seq: string;
	topology: "circular" | "linear";
	annotations: BioAnnotation[];
}

// ── Coverage track component ───────────────────────────────────────────────────

function CoverageTrack({
	plan,
}: {
	plan: SequencingPlan;
}) {
	const W = 700;
	const H = 160;
	const TRACK_Y = 30;
	const TRACK_H = 12;
	const READ_H = 8;
	const READ_GAP = 2;

	const scale = (pos: number) => (pos / plan.seqLength) * W;

	// Assign lanes so reads don't overlap
	const lanes: PlannedPrimer[][] = [];
	for (const primer of plan.primers) {
		const cs = Math.max(0, primer.coverageStart % plan.seqLength);
		const ce = Math.min(plan.seqLength, primer.coverageEnd % plan.seqLength || plan.seqLength);
		let placed = false;
		for (const lane of lanes) {
			const last = lane[lane.length - 1]!;
			const lce = Math.min(plan.seqLength, last.coverageEnd % plan.seqLength || plan.seqLength);
			if (lce <= cs) {
				lane.push(primer);
				placed = true;
				break;
			}
		}
		if (!placed) lanes.push([primer]);
	}

	const totalH = TRACK_Y + TRACK_H + READ_GAP + lanes.length * (READ_H + READ_GAP) + 20;

	return (
		<svg
			width="100%"
			viewBox={`0 0 ${W} ${Math.max(H, totalH)}`}
			style={{ overflow: "visible" }}
			aria-label="Sequencing coverage map"
		>
			{/* Sequence backbone */}
			<rect x={0} y={TRACK_Y} width={W} height={TRACK_H} fill="#ece6d8" rx={2} />

			{/* Gap indicators */}
			{plan.gaps.map((g, i) => (
				<rect
					key={i}
					x={scale(g.start)}
					y={TRACK_Y}
					width={Math.max(1, scale(g.end - g.start))}
					height={TRACK_H}
					fill="#ef4444"
					rx={1}
				/>
			))}

			{/* Annotation labels on backbone */}
			{/* Coverage reads */}
			{lanes.map((lane, laneIdx) =>
				lane.map((primer) => {
					const cs = Math.max(0, primer.coverageStart % plan.seqLength);
					const ce = Math.min(
						plan.seqLength,
						primer.coverageEnd % plan.seqLength || plan.seqLength,
					);
					const x = scale(cs);
					const w = Math.max(2, scale(ce - cs));
					const y = TRACK_Y + TRACK_H + READ_GAP + laneIdx * (READ_H + READ_GAP);
					const color = primer.direction === 1 ? "#0891b2" : "#7c3aed";
					const arrow = primer.direction === 1 ? "►" : "◄";
					return (
						<g key={primer.id}>
							<rect x={x} y={y} width={w} height={READ_H} fill={color} rx={2} opacity={0.8} />
							{w > 16 && (
								<text
									x={x + w / 2}
									y={y + READ_H - 1}
									textAnchor="middle"
									fontSize={6}
									fill="white"
									fontFamily="monospace"
								>
									{arrow} {primer.index}
								</text>
							)}
						</g>
					);
				}),
			)}

			{/* Axis ticks */}
			{[0, 0.25, 0.5, 0.75, 1].map((frac) => {
				const x = frac * W;
				const label = Math.round(frac * plan.seqLength).toLocaleString();
				return (
					<g key={frac}>
						<line x1={x} y1={TRACK_Y - 4} x2={x} y2={TRACK_Y} stroke="#9a9284" strokeWidth={0.5} />
						<text x={x} y={TRACK_Y - 6} textAnchor="middle" fontSize={7} fill="#9a9284" fontFamily="monospace">
							{label}
						</text>
					</g>
				);
			})}
		</svg>
	);
}

// ── Primer row ─────────────────────────────────────────────────────────────────

function PrimerRow({ primer }: { primer: PlannedPrimer }) {
	const [copied, setCopied] = useState(false);

	const copy = () => {
		navigator.clipboard.writeText(primer.sequence).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		});
	};

	const dirColor = primer.direction === 1 ? "#0891b2" : "#7c3aed";
	const dirLabel = primer.direction === 1 ? "+ strand" : "− strand";

	return (
		<div
			style={{
				display: "grid",
				gridTemplateColumns: "32px 1fr 1fr auto",
				gap: "12px",
				alignItems: "start",
				padding: "10px 0",
				borderBottom: "1px solid #ece6d8",
				fontFamily: "var(--font-karla)",
				fontSize: "13px",
			}}
		>
			{/* Index */}
			<div
				style={{
					width: 28,
					height: 28,
					borderRadius: "50%",
					background: primer.isUniversal ? "#1a4731" : "#ece6d8",
					color: primer.isUniversal ? "white" : "#5a5648",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					fontFamily: "var(--font-courier)",
					fontSize: "11px",
					fontWeight: 600,
					flexShrink: 0,
				}}
			>
				{primer.index}
			</div>

			{/* Name + metadata */}
			<div>
				<div style={{ fontWeight: 500, color: "#1c1a16", marginBottom: 2 }}>
					{primer.name}
					{primer.isDraft && (
						<span
							style={{
								marginLeft: 6,
								fontSize: 10,
								color: "#b8933a",
								fontFamily: "var(--font-courier)",
								letterSpacing: "0.04em",
							}}
						>
							draft
						</span>
					)}
				</div>
				<div style={{ color: "#9a9284", fontSize: 11, fontFamily: "var(--font-courier)" }}>
					<span style={{ color: dirColor }}>{dirLabel}</span>
					{" · "}
					pos {primer.bindPosition.toLocaleString()}
					{" · "}
					reads{" "}
					{(primer.coverageStart % (primer.coverageStart > 1e8 ? 1 : Infinity)).toLocaleString()}–
					{(primer.coverageEnd).toLocaleString()} bp
				</div>
				{primer.annotationsCovered.length > 0 && (
					<div style={{ marginTop: 3, color: "#5a5648", fontSize: 11 }}>
						Reads through:{" "}
						{primer.annotationsCovered.slice(0, 3).join(", ")}
						{primer.annotationsCovered.length > 3 && ` +${primer.annotationsCovered.length - 3} more`}
					</div>
				)}
			</div>

			{/* Sequence */}
			<div
				style={{
					fontFamily: "var(--font-courier)",
					fontSize: "12px",
					color: "#1c1a16",
					wordBreak: "break-all",
					lineHeight: 1.5,
				}}
			>
				{primer.sequence}
			</div>

			{/* Copy button */}
			<button
				type="button"
				onClick={copy}
				style={{
					padding: "4px 10px",
					fontSize: 11,
					fontFamily: "var(--font-karla)",
					background: copied ? "#1a4731" : "transparent",
					color: copied ? "white" : "#5a5648",
					border: "1px solid #b8b0a4",
					borderRadius: 3,
					cursor: "pointer",
					whiteSpace: "nowrap",
					transition: "all 0.15s",
				}}
			>
				{copied ? "✓" : "Copy"}
			</button>
		</div>
	);
}

// ── Main tool component ────────────────────────────────────────────────────────

export function SequencingTool() {
	const [inputText, setInputText] = useState("");
	const [readLength, setReadLength] = useState(700);
	const [minOverlap, setMinOverlap] = useState(100);
	const [bidirectional, setBidirectional] = useState(true);
	const [parsedRef, setParsedRef] = useState<ParsedRef | null>(null);
	const [plan, setPlan] = useState<SequencingPlan | null>(null);
	const [error, setError] = useState<string | null>(null);

	const runPlanner = useCallback(
		(ref: ParsedRef) => {
			const result = planSequencing(ref.seq, ref.annotations, ref.topology, {
				readLength,
				minOverlap,
				bidirectionalCDS: bidirectional,
			});
			setPlan(result);
		},
		[readLength, minOverlap, bidirectional],
	);

	const handleParse = useCallback(
		(text: string) => {
			setError(null);
			const trimmed = text.trim();
			if (!trimmed) {
				setParsedRef(null);
				setPlan(null);
				return;
			}

			try {
				let seq = "";
				let name = "Sequence";
				let topology: "circular" | "linear" = "linear";
				let annotations: BioAnnotation[] = [];

				if (trimmed.startsWith("LOCUS") || trimmed.includes("ORIGIN")) {
					const parsed = parseGenBank(trimmed);
					seq = parsed.seq;
					name = parsed.name;
					topology = parsed.topology;
					annotations = parsed.annotations;
				} else {
					// FASTA or raw DNA
					const lines = trimmed.split("\n");
					if (lines[0]?.startsWith(">")) {
						name = lines[0].slice(1).trim() || "Sequence";
						seq = lines.slice(1).join("").replace(/[^ATGCNatgcn]/g, "").toUpperCase();
					} else {
						seq = trimmed.replace(/[^ATGCNatgcn\s]/g, "").replace(/\s/g, "").toUpperCase();
					}
				}

				if (!seq) {
					setError("No DNA sequence found. Paste GenBank or FASTA format.");
					return;
				}

				const ref: ParsedRef = { name, seq, topology, annotations };
				setParsedRef(ref);
				runPlanner(ref);
			} catch {
				setError("Could not parse input. Paste a valid GenBank or FASTA sequence.");
			}
		},
		[runPlanner],
	);

	const loadExample = () => {
		setInputText(EXAMPLE_GENBANK);
		handleParse(EXAMPLE_GENBANK);
	};

	const replan = () => {
		if (parsedRef) runPlanner(parsedRef);
	};

	const downloadCSV = () => {
		if (!plan) return;
		const rows = [
			["#", "Name", "Sequence (5'→3')", "Position", "Direction", "Coverage start", "Coverage end", "Type", "Reads through"],
			...plan.primers.map((p) => [
				p.index,
				p.name,
				p.sequence,
				p.bindPosition,
				p.direction === 1 ? "+" : "−",
				p.coverageStart,
				Math.min(p.coverageEnd, plan.seqLength),
				p.isUniversal ? "universal" : "custom (draft)",
				p.annotationsCovered.join("; "),
			]),
		];
		const csv = rows.map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
		const blob = new Blob([csv], { type: "text/csv" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `${parsedRef?.name ?? "sequencing"}_plan.csv`;
		a.click();
		URL.revokeObjectURL(url);
	};

	return (
		<div className="flex min-h-full flex-col">
			<SiteNav />

			<div
				style={{
					display: "grid",
					gridTemplateColumns: "360px 1fr",
					flex: 1,
					minHeight: 0,
				}}
			>
				{/* ── Left input panel ── */}
				<div
					style={{
						borderRight: "1px solid #ddd8ce",
						padding: "28px 24px",
						overflowY: "auto",
						display: "flex",
						flexDirection: "column",
						gap: "20px",
					}}
				>
					{/* Header */}
					<div>
						<h1
							style={{
								fontFamily: "var(--font-playfair)",
								fontSize: "22px",
								fontWeight: 400,
								color: "#1c1a16",
								marginBottom: 4,
							}}
						>
							Sequencing Planner
						</h1>
						<p
							style={{
								fontFamily: "var(--font-karla)",
								fontSize: "13px",
								color: "#5a5648",
								lineHeight: 1.6,
							}}
						>
							Plan complete Sanger sequencing coverage. Detects universal primers automatically; fills
							remaining gaps with custom primer positions.
						</p>
					</div>

					{/* Sequence input */}
					<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
						<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
							<label
								htmlFor="seq-input"
								style={{
									fontFamily: "var(--font-courier)",
									fontSize: "10px",
									letterSpacing: "0.1em",
									textTransform: "uppercase",
									color: "#5a5648",
								}}
							>
								Sequence (GenBank or FASTA)
							</label>
							<button
								type="button"
								onClick={loadExample}
								style={{
									fontFamily: "var(--font-courier)",
									fontSize: "10px",
									color: "#1a4731",
									background: "none",
									border: "none",
									cursor: "pointer",
									letterSpacing: "0.04em",
								}}
							>
								Load example →
							</button>
						</div>
						<textarea
							id="seq-input"
							rows={10}
							value={inputText}
							onChange={(e) => {
								setInputText(e.target.value);
								handleParse(e.target.value);
							}}
							placeholder="Paste GenBank, FASTA, or raw DNA sequence..."
							style={{
								width: "100%",
								fontFamily: "var(--font-courier)",
								fontSize: "11px",
								padding: "10px",
								border: "1px solid #ddd8ce",
								borderRadius: 4,
								background: "#faf8f4",
								color: "#1c1a16",
								resize: "vertical",
								lineHeight: 1.5,
							}}
						/>
					</div>

					{/* Options */}
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							gap: 12,
							padding: "16px",
							background: "#faf8f4",
							borderRadius: 4,
							border: "1px solid #ece6d8",
						}}
					>
						<div
							style={{
								fontFamily: "var(--font-courier)",
								fontSize: "10px",
								letterSpacing: "0.1em",
								textTransform: "uppercase",
								color: "#9a9284",
								marginBottom: 4,
							}}
						>
							Options
						</div>

						{[
							{ label: "Read length (bp)", value: readLength, set: setReadLength, min: 400, max: 1200, step: 50 },
							{ label: "Minimum overlap (bp)", value: minOverlap, set: setMinOverlap, min: 50, max: 300, step: 25 },
						].map(({ label, value, set, min, max, step }) => (
							<div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
								<label
									style={{
										fontFamily: "var(--font-karla)",
										fontSize: "13px",
										color: "#5a5648",
									}}
								>
									{label}
								</label>
								<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
									<input
										type="range"
										min={min}
										max={max}
										step={step}
										value={value}
										onChange={(e) => set(Number(e.target.value))}
										style={{ width: 80 }}
									/>
									<span
										style={{
											fontFamily: "var(--font-courier)",
											fontSize: "11px",
											color: "#1c1a16",
											width: 36,
											textAlign: "right",
										}}
									>
										{value}
									</span>
								</div>
							</div>
						))}

						<label
							style={{
								display: "flex",
								alignItems: "center",
								gap: 8,
								cursor: "pointer",
								fontFamily: "var(--font-karla)",
								fontSize: "13px",
								color: "#5a5648",
							}}
						>
							<input
								type="checkbox"
								checked={bidirectional}
								onChange={(e) => setBidirectional(e.target.checked)}
								style={{ accentColor: "#1a4731" }}
							/>
							Bidirectional CDS coverage
						</label>

						{parsedRef && (
							<button
								type="button"
								onClick={replan}
								style={{
									padding: "8px 0",
									background: "#1a4731",
									color: "white",
									border: "none",
									borderRadius: 3,
									fontFamily: "var(--font-karla)",
									fontSize: "13px",
									cursor: "pointer",
									marginTop: 4,
								}}
							>
								Re-plan
							</button>
						)}
					</div>

					{error && (
						<div
							style={{
								padding: "10px 12px",
								background: "#fef2f2",
								border: "1px solid #fca5a5",
								borderRadius: 4,
								fontFamily: "var(--font-karla)",
								fontSize: "13px",
								color: "#dc2626",
							}}
						>
							{error}
						</div>
					)}
				</div>

				{/* ── Right results panel ── */}
				<div style={{ overflowY: "auto", padding: "28px 32px" }}>
					{!plan ? (
						<div
							style={{
								height: "100%",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								flexDirection: "column",
								gap: 12,
								color: "#9a9284",
							}}
						>
							<div style={{ fontSize: 32 }}>🧬</div>
							<p style={{ fontFamily: "var(--font-karla)", fontSize: "14px" }}>
								Paste a sequence to generate a sequencing plan
							</p>
							<button
								type="button"
								onClick={loadExample}
								style={{
									padding: "8px 20px",
									background: "#1a4731",
									color: "white",
									border: "none",
									borderRadius: 3,
									fontFamily: "var(--font-karla)",
									fontSize: "13px",
									cursor: "pointer",
								}}
							>
								Load pUC19 example
							</button>
						</div>
					) : (
						<div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 860 }}>
							{/* Summary header */}
							<div
								style={{
									display: "flex",
									alignItems: "flex-start",
									justifyContent: "space-between",
									gap: 16,
								}}
							>
								<div>
									<h2
										style={{
											fontFamily: "var(--font-playfair)",
											fontSize: "20px",
											fontWeight: 400,
											color: "#1c1a16",
											marginBottom: 4,
										}}
									>
										{parsedRef?.name ?? "Sequence"}
									</h2>
									<div
										style={{
											fontFamily: "var(--font-courier)",
											fontSize: "11px",
											color: "#9a9284",
											letterSpacing: "0.04em",
										}}
									>
										{plan.seqLength.toLocaleString()} bp · {plan.topology} ·{" "}
										<span style={{ color: "#1a4731", fontWeight: 600 }}>
											{plan.totalReactions} reactions
										</span>
										{" · "}
										<span
											style={{
												color: plan.coveredFraction >= 0.99 ? "#1a4731" : "#b8933a",
											}}
										>
											{(plan.coveredFraction * 100).toFixed(1)}% covered
										</span>
									</div>
								</div>
								<button
									type="button"
									onClick={downloadCSV}
									style={{
										padding: "7px 14px",
										border: "1px solid #b8b0a4",
										borderRadius: 3,
										fontFamily: "var(--font-karla)",
										fontSize: "12px",
										color: "#5a5648",
										background: "transparent",
										cursor: "pointer",
										whiteSpace: "nowrap",
									}}
								>
									↓ Download CSV
								</button>
							</div>

							{/* Gap warning */}
							{plan.gaps.length > 0 && (
								<div
									style={{
										padding: "10px 14px",
										background: "#fff7ed",
										border: "1px solid #fdba74",
										borderRadius: 4,
										fontFamily: "var(--font-karla)",
										fontSize: "13px",
										color: "#c2410c",
									}}
								>
									⚠ {plan.gaps.length} uncovered region{plan.gaps.length > 1 ? "s" : ""} —{" "}
									{plan.gaps.map((g) => `${g.start.toLocaleString()}–${g.end.toLocaleString()} bp`).join(", ")}
								</div>
							)}

							{/* Coverage map */}
							<div
								style={{
									padding: "16px",
									background: "#faf8f4",
									border: "1px solid #ece6d8",
									borderRadius: 4,
								}}
							>
								<div
									style={{
										fontFamily: "var(--font-courier)",
										fontSize: "10px",
										letterSpacing: "0.1em",
										textTransform: "uppercase",
										color: "#9a9284",
										marginBottom: 12,
									}}
								>
									Coverage map
								</div>
								<CoverageTrack plan={plan} />
								<div
									style={{
										display: "flex",
										gap: 16,
										marginTop: 10,
										fontFamily: "var(--font-courier)",
										fontSize: "10px",
										color: "#9a9284",
									}}
								>
									<span>
										<span style={{ color: "#0891b2" }}>■</span> + strand
									</span>
									<span>
										<span style={{ color: "#7c3aed" }}>■</span> − strand
									</span>
									{plan.gaps.length > 0 && (
										<span>
											<span style={{ color: "#ef4444" }}>■</span> gap
										</span>
									)}
								</div>
							</div>

							{/* Primer legend */}
							<div
								style={{
									display: "flex",
									gap: 16,
									fontFamily: "var(--font-courier)",
									fontSize: "10px",
									color: "#9a9284",
									letterSpacing: "0.04em",
								}}
							>
								<span>
									<span
										style={{
											display: "inline-block",
											width: 10,
											height: 10,
											background: "#1a4731",
											borderRadius: "50%",
											marginRight: 4,
											verticalAlign: "middle",
										}}
									/>
									Universal primer
								</span>
								<span>
									<span
										style={{
											display: "inline-block",
											width: 10,
											height: 10,
											background: "#ece6d8",
											border: "1px solid #b8b0a4",
											borderRadius: "50%",
											marginRight: 4,
											verticalAlign: "middle",
										}}
									/>
									Custom (draft sequence — verify Tm before ordering)
								</span>
							</div>

							{/* Primer list */}
							<div>
								<div
									style={{
										fontFamily: "var(--font-courier)",
										fontSize: "10px",
										letterSpacing: "0.1em",
										textTransform: "uppercase",
										color: "#9a9284",
										marginBottom: 8,
										display: "grid",
										gridTemplateColumns: "32px 1fr 1fr auto",
										gap: "12px",
										paddingBottom: 8,
										borderBottom: "1px solid #ddd8ce",
									}}
								>
									<span>#</span>
									<span>Primer</span>
									<span>Sequence 5'→3'</span>
									<span />
								</div>
								{plan.primers.map((p) => (
									<PrimerRow key={p.id} primer={p} />
								))}
							</div>

							{/* Footer note */}
							<p
								style={{
									fontFamily: "var(--font-karla)",
									fontSize: "12px",
									color: "#9a9284",
									lineHeight: 1.6,
									borderTop: "1px solid #ece6d8",
									paddingTop: 16,
								}}
							>
								Draft primers are 20bp windows extracted from the template. Verify Tm (ideally 58–62°C) and
								GC content (40–60%) using the{" "}
								<Link href="/primers" style={{ color: "#1a4731" }}>
									Primer Designer
								</Link>{" "}
								before ordering. Universal primers are exact catalogue sequences; no verification needed.
							</p>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
