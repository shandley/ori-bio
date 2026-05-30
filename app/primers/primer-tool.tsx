"use client";

import type { AssemblyPrimerPair, PrimerCandidate, PrimerPair } from "@shandley/primd";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { SiteNav } from "@/components/nav/site-nav";
import { AmpliconHeatmap } from "@/components/primer-viz/amplicon-heatmap";
import { MeltCurve } from "@/components/primer-viz/melt-curve";
import { PairScatter } from "@/components/primer-viz/pair-scatter";
import type {
	PrimerWorkerRequest,
	PrimerWorkerResponse,
} from "@/components/sequence/primer-design.worker";
import type {
	ConsensusPrimer,
	ConservationRequest,
	ConservationResponse,
	ConservationResult,
} from "./conservation.worker";
import { ConservationTrack } from "./conservation-track";
import { CoverageMap } from "./coverage-map";
import type {
	ExonJunctionPair,
	ExonJunctionRequest,
	ExonJunctionResponse,
	ExonJunctionResult,
	JunctionPrimer,
} from "./exon-junction.worker";
import type { MultiplexRequest, MultiplexResponse, MultiplexResult } from "./multiplex.worker";
import { MultiplexMatrix } from "./multiplex-matrix";
import type { SpecHit, SpecRequest, SpecResponse } from "./specificity.worker";
import type { WalkingRequest, WalkingResponse, WalkingResult } from "./walking.worker";

// ── Types ─────────────────────────────────────────────────────────────────────

type Mode = "pcr" | "qpcr" | "assembly" | "walking" | "consensus" | "multiplex";
type SpecCheckState = "idle" | "loading" | "done";
type AssemblyMethod = "gibson" | "golden_gate";
type PlotTab = "heatmap" | "scatter" | "melt";

type DesignPair = PrimerPair & {
	ampliconTm?: number;
	ampliconDG?: number;
	efficiencyScore?: number;
};

// ── Sequence validation ───────────────────────────────────────────────────────

function cleanSeq(raw: string): string {
	// Strip FASTA header lines before removing non-sequence characters
	const noHeaders = raw.replace(/^>.*$/gm, "");
	return noHeaders.replace(/\s|\d/g, "").toUpperCase();
}

function validateSeq(seq: string): string | null {
	if (seq.length === 0) return null;
	const invalid = seq.match(/[^ACGTRYMKSWHBVDN]/gi);
	if (invalid) return `Non-DNA characters: ${[...new Set(invalid)].slice(0, 5).join(", ")}`;
	if (seq.length < 50) return "Sequence too short (need ≥ 50 bp)";
	return null;
}

// ── Polymerase annealing temperature ─────────────────────────────────────────

type Polymerase = "Q5" | "Phusion" | "KAPA HiFi" | "Taq" | "Custom";

const POLYMERASES: Polymerase[] = ["Q5", "Phusion", "KAPA HiFi", "Taq", "Custom"];

// Ta offset from the lower-Tm primer in the pair (empirical, from NEB/manufacturer guidelines)
const POLYMERASE_OFFSET: Record<Polymerase, number> = {
	Q5: 1, // NEB: Ta = Tm(lower) + 1°C
	Phusion: 3, // NEB/Thermo: Ta = Tm(lower) + 3°C
	"KAPA HiFi": 1,
	Taq: -5, // conservative standard; many labs use Tm(lower) - 5
	Custom: 0,
};

function computeTa(lowerTm: number, poly: Polymerase): number {
	return lowerTm + POLYMERASE_OFFSET[poly];
}

// ── CSV export ────────────────────────────────────────────────────────────────

function downloadCsv(
	pairs: (PrimerPair & { ampliconTm?: number; efficiencyScore?: number })[],
	assemblyPairs: AssemblyPrimerPair[],
	mode: Mode,
	polymerase: Polymerase,
) {
	const rows: string[] = ["Name,Sequence,Scale,Purification,Notes"];

	if (mode === "assembly" && assemblyPairs.length > 0) {
		for (const [i, pair] of assemblyPairs.entries()) {
			const base = `Pair${i + 1}`;
			const method = pair.fwd.tail.includes("GGTCTC") ? "Golden Gate" : "Gibson";
			rows.push(
				`${base}-Fwd,${pair.fwd.fullSeq},25nm,STD,"${pair.productSize}bp | ann ${pair.annealingTm.toFixed(1)}°C | full ${pair.fwd.fullPrimerTm.toFixed(1)}°C | ${method}"`,
			);
			rows.push(
				`${base}-Rev,${pair.rev.fullSeq},25nm,STD,"${pair.productSize}bp | ann ${pair.annealingTm.toFixed(1)}°C | full ${pair.rev.fullPrimerTm.toFixed(1)}°C | ${method}"`,
			);
		}
	} else {
		for (const [i, pair] of pairs.entries()) {
			const base = `Pair${i + 1}`;
			const ta = computeTa(Math.min(pair.fwd.tm, pair.rev.tm), polymerase);
			const modeLabel = mode === "qpcr" ? "qPCR" : "PCR";
			const effNote =
				pair.efficiencyScore != null ? ` | eff ${(pair.efficiencyScore * 100).toFixed(0)}%` : "";
			const note = `Tm_fwd=${pair.fwd.tm.toFixed(1)} Tm_rev=${pair.rev.tm.toFixed(1)} Ta=${ta.toFixed(0)}°C(${polymerase}) ${pair.productSize}bp ${modeLabel}${effNote}`;
			rows.push(`${base}-Fwd,${pair.fwd.seq},25nm,STD,"${note}"`);
			rows.push(`${base}-Rev,${pair.rev.seq},25nm,STD,"${note}"`);
		}
	}

	const blob = new Blob([rows.join("\n")], { type: "text/csv" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = "primers.csv";
	a.click();
	URL.revokeObjectURL(url);
}

// ── Color helpers ─────────────────────────────────────────────────────────────

function effColor(eff: number) {
	if (eff >= 0.8) return "#1a4731";
	if (eff >= 0.6) return "#b8933a";
	return "#a02828";
}

// ── Small shared sub-components ───────────────────────────────────────────────

function Badge({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
	const color = warn ? "#b8933a" : "#1a4731";
	const bg = warn ? "rgba(184,147,58,0.08)" : "rgba(26,71,49,0.06)";
	const border = warn ? "rgba(184,147,58,0.25)" : "rgba(26,71,49,0.2)";
	return (
		<span
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: "3px",
				fontFamily: "var(--font-courier)",
				fontSize: "9px",
				letterSpacing: "0.04em",
				color,
				background: bg,
				border: `1px solid ${border}`,
				borderRadius: "2px",
				padding: "1px 5px",
			}}
		>
			<span style={{ opacity: 0.6 }}>{label}</span>
			{value && <span style={{ fontWeight: 700 }}>{value}</span>}
		</span>
	);
}

function SeqLine({
	dir,
	primer,
	tmTarget,
}: {
	dir: "→" | "←";
	primer: PrimerCandidate;
	tmTarget: number;
}) {
	const [copied, setCopied] = useState(false);
	function copy() {
		void navigator.clipboard.writeText(primer.seq).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1200);
		});
	}
	const tmWarn = Math.abs(primer.tm - tmTarget) > 4;
	const accessBad = primer.templateAccessibility < 0.4;
	const accessWarn = !accessBad && primer.templateAccessibility < 0.75;
	return (
		<div
			onClick={copy}
			title={`Click to copy · ${primer.seq}`}
			style={{
				display: "flex",
				alignItems: "center",
				gap: "5px",
				cursor: "pointer",
				padding: "2px 0",
			}}
		>
			<span
				style={{
					fontFamily: "var(--font-courier)",
					fontSize: "8px",
					color: "#9a9284",
					width: "9px",
					flexShrink: 0,
				}}
			>
				{dir}
			</span>
			<span
				style={{
					fontFamily: "var(--font-courier)",
					fontSize: "10px",
					letterSpacing: "0.04em",
					color: copied ? "#1a4731" : "#1c1a16",
					flex: 1,
					overflow: "hidden",
					whiteSpace: "nowrap",
					textOverflow: "ellipsis",
					transition: "color 0.15s",
				}}
			>
				{primer.seq}
			</span>
			<span
				style={{
					fontFamily: "var(--font-courier)",
					fontSize: "8px",
					color: tmWarn ? "#b8933a" : "#9a9284",
					flexShrink: 0,
				}}
			>
				{primer.tm.toFixed(1)}°
			</span>
			{accessBad && (
				<span
					title="Binding site in secondary structure"
					style={{ fontSize: "9px", color: "#a02828", lineHeight: 1 }}
				>
					⚠
				</span>
			)}
			{accessWarn && (
				<span
					title="Binding site partially structured"
					style={{ fontSize: "9px", color: "#b8933a", lineHeight: 1 }}
				>
					~
				</span>
			)}
		</div>
	);
}

// ── Multiplex melt curve (all amplicons overlaid) ────────────────────────────

function MultiplexMeltCurve({
	pairs,
}: {
	pairs: import("./multiplex.worker").MultiplexPairResult[];
}) {
	const SPACER = 100;
	let compositeSeq = "";
	const meltPairs: {
		fwd: { start: number; end: number };
		rev: { start: number; end: number };
		productSize: number;
		ampliconTm: number;
	}[] = [];
	for (const p of pairs) {
		if (!p.pair || p.ampliconTm === undefined) continue;
		const offset = compositeSeq.length;
		const ampSeq = p.ampliconSeq ?? "A".repeat(p.pair.productSize);
		compositeSeq += ampSeq + "N".repeat(SPACER);
		meltPairs.push({
			fwd: { start: offset, end: offset + p.pair.fwd.len },
			rev: { start: offset + ampSeq.length - p.pair.rev.len, end: offset + ampSeq.length },
			productSize: p.pair.productSize,
			ampliconTm: p.ampliconTm,
		});
	}
	if (meltPairs.length === 0) return null;
	return (
		<div style={{ padding: "12px 20px 16px", borderTop: "1px solid #ddd8ce" }}>
			<div
				style={{
					fontFamily: "var(--font-courier)",
					fontSize: "9px",
					letterSpacing: "0.12em",
					color: "#9a9284",
					textTransform: "uppercase",
					marginBottom: "10px",
				}}
			>
				Amplicon melt curves
			</div>
			<div
				style={{
					background: "#faf7f2",
					borderRadius: "3px",
					border: "1px solid #ddd8ce",
					padding: "12px",
					display: "inline-block",
				}}
			>
				<MeltCurve pairs={meltPairs} seq={compositeSeq} highlightIndex={0} />
			</div>
			<p
				style={{
					fontFamily: "var(--font-courier)",
					fontSize: "8px",
					color: "#b8b0a4",
					margin: "6px 0 0",
					lineHeight: 1.6,
				}}
			>
				Peaks overlaid — similar Tm means the panel works at one annealing temperature.
			</p>
		</div>
	);
}

// ── Assembly plots (amplicon heatmap + pair scatter) ──────────────────────────

function AssemblyPlots({
	pair,
	allPairs,
	seq,
	tmTarget,
	activePlot,
	onTabChange,
}: {
	pair: AssemblyPrimerPair;
	allPairs: AssemblyPrimerPair[];
	seq: string;
	tmTarget: number;
	activePlot: "heatmap" | "scatter";
	onTabChange: (tab: "heatmap" | "scatter") => void;
}) {
	const heatmapPair = {
		fwd: { start: pair.fwd.start, end: pair.fwd.end, len: pair.fwd.len },
		rev: { start: pair.rev.start, end: pair.rev.end, len: pair.rev.len },
		productSize: pair.productSize,
	};
	const scatterPairs = allPairs.map((p) => ({
		fwd: { tm: p.fwd.tm },
		rev: { tm: p.rev.tm },
		productSize: p.productSize,
		tmDiff: Math.abs(p.fwd.tm - p.rev.tm),
	}));
	return (
		<div style={{ padding: "16px 20px" }}>
			<div
				style={{
					fontFamily: "var(--font-courier)",
					fontSize: "9px",
					letterSpacing: "0.12em",
					color: "#9a9284",
					textTransform: "uppercase",
					marginBottom: "10px",
				}}
			>
				Plots
			</div>
			<div
				style={{
					display: "flex",
					gap: "0",
					marginBottom: "12px",
					borderBottom: "1px solid #ddd8ce",
				}}
			>
				{(["heatmap", "scatter"] as const).map((tab) => (
					<button
						key={tab}
						type="button"
						onClick={() => onTabChange(tab)}
						style={{
							fontFamily: "var(--font-courier)",
							fontSize: "9px",
							letterSpacing: "0.08em",
							textTransform: "uppercase",
							padding: "7px 14px",
							background: "none",
							border: "none",
							borderBottom: activePlot === tab ? "2px solid #1a4731" : "2px solid transparent",
							color: activePlot === tab ? "#1a4731" : "#9a9284",
							cursor: "pointer",
							marginBottom: "-1px",
						}}
					>
						{tab === "heatmap" ? "Amplicon Structure" : "Pair Overview"}
					</button>
				))}
			</div>
			<div
				style={{
					background: "#faf7f2",
					borderRadius: "3px",
					border: "1px solid #ddd8ce",
					padding: "12px",
					display: "inline-block",
				}}
			>
				{activePlot === "heatmap" && (
					<AmpliconHeatmap pair={heatmapPair} seq={seq} temperature={tmTarget - 5} />
				)}
				{activePlot === "scatter" && <PairScatter pairs={scatterPairs} mode="pcr" />}
			</div>
		</div>
	);
}

// ── Specificity badge ─────────────────────────────────────────────────────────

function SpecBadge({
	label,
	hits,
	loading,
}: {
	label: string;
	hits: SpecHit[] | undefined;
	loading: boolean;
}) {
	if (loading) {
		return (
			<span
				style={{
					fontFamily: "var(--font-courier)",
					fontSize: "8px",
					color: "#b8b0a4",
					letterSpacing: "0.04em",
				}}
			>
				{label} ···
			</span>
		);
	}

	if (!hits) return null;

	if (hits.length === 0) {
		return (
			<span
				style={{
					display: "inline-flex",
					alignItems: "center",
					gap: "3px",
					fontFamily: "var(--font-courier)",
					fontSize: "8px",
					color: "#1a4731",
					letterSpacing: "0.04em",
				}}
			>
				{label} ✓
			</span>
		);
	}

	// Sort hits: CDS and promoter first
	const sorted = [...hits].sort((a, b) => {
		const rank = (t: string) =>
			t === "CDS" ? 0 : t === "promoter" ? 1 : t === "rep_origin" ? 2 : 3;
		return rank(a.featureType) - rank(b.featureType);
	});

	const shown = sorted.slice(0, 2);
	const extra = sorted.length - shown.length;
	const tooltip = sorted.map((h) => `${h.featureName} (${h.featureType})`).join(", ");

	return (
		<span
			title={tooltip}
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: "3px",
				fontFamily: "var(--font-courier)",
				fontSize: "8px",
				color: "#b8933a",
				letterSpacing: "0.04em",
				cursor: "help",
			}}
		>
			{label} ⚠ {shown.map((h) => h.featureName).join(", ")}
			{extra > 0 && ` +${extra}`}
		</span>
	);
}

function PairCard({
	pair,
	rank,
	tmTarget,
	mode,
	polymerase,
	specResults,
	specState,
	selected,
	onClick,
}: {
	pair: DesignPair;
	rank: number;
	tmTarget: number;
	mode: Mode;
	polymerase: Polymerase;
	specResults: Map<string, SpecHit[]> | null;
	specState: SpecCheckState;
	selected: boolean;
	onClick: () => void;
}) {
	const [copiedPair, setCopiedPair] = useState(false);
	const ta = computeTa(Math.min(pair.fwd.tm, pair.rev.tm), polymerase);
	function copyPair(e: React.MouseEvent) {
		e.stopPropagation();
		const text = `Fwd (${pair.fwd.len}bp, Tm ${pair.fwd.tm.toFixed(1)}°C): ${pair.fwd.seq}\nRev (${pair.rev.len}bp, Tm ${pair.rev.tm.toFixed(1)}°C): ${pair.rev.seq}`;
		void navigator.clipboard.writeText(text).then(() => {
			setCopiedPair(true);
			setTimeout(() => setCopiedPair(false), 1500);
		});
	}
	const dimerWarn = pair.heteroDimerDG < -3.0;
	const tmDiffWarn = pair.tmDiff > 2;
	const isBest = rank === 1;
	const eff = pair.efficiencyScore;

	return (
		<div
			onClick={onClick}
			style={{
				padding: "12px 14px",
				borderBottom: "1px solid rgba(221,216,206,0.5)",
				background: selected
					? "rgba(26,71,49,0.08)"
					: isBest
						? "rgba(26,71,49,0.03)"
						: "transparent",
				cursor: "pointer",
				transition: "background 0.1s",
				borderLeft: selected ? "3px solid #1a4731" : "3px solid transparent",
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					marginBottom: "6px",
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
					<span
						style={{
							fontFamily: "var(--font-courier)",
							fontSize: "9px",
							letterSpacing: "0.1em",
							color: isBest ? "#1a4731" : "#9a9284",
							fontWeight: isBest ? 700 : 400,
						}}
					>
						#{rank}
					</span>
					<span style={{ fontFamily: "var(--font-courier)", fontSize: "9px", color: "#5a5648" }}>
						{pair.productSize} bp
					</span>
					<span style={{ color: "#ddd8ce" }}>·</span>
					<span
						style={{
							fontFamily: "var(--font-courier)",
							fontSize: "9px",
							color: tmDiffWarn ? "#b8933a" : "#9a9284",
						}}
					>
						ΔTm {pair.tmDiff.toFixed(1)}°
					</span>
					<span style={{ color: "#ddd8ce" }}>·</span>
					<span
						style={{
							fontFamily: "var(--font-courier)",
							fontSize: "9px",
							color: "#1a4731",
							fontWeight: 600,
						}}
						title={`Recommended annealing temperature for ${polymerase}`}
					>
						Ta {ta.toFixed(0)}°C
					</span>
					{dimerWarn && <Badge label="dimer" value={pair.heteroDimerDG.toFixed(1)} warn />}
					{pair.ampliconTm !== undefined && (
						<span
							style={{ fontFamily: "var(--font-courier)", fontSize: "9px", color: "#9a9284" }}
							title="Predicted amplicon Tm"
						>
							amp {pair.ampliconTm.toFixed(0)}°
						</span>
					)}
					{mode !== "qpcr" && eff !== undefined && (
						<span
							style={{
								fontFamily: "var(--font-courier)",
								fontSize: "9px",
								color: effColor(eff),
								fontWeight: 700,
							}}
						>
							{(eff * 100).toFixed(0)}%
						</span>
					)}
				</div>
				<button
					type="button"
					onClick={copyPair}
					style={{
						background: "none",
						border: "none",
						cursor: "pointer",
						padding: "0 2px",
						fontFamily: "var(--font-courier)",
						fontSize: "9px",
						color: copiedPair ? "#1a4731" : "#9a9284",
						transition: "color 0.15s",
						flexShrink: 0,
					}}
				>
					{copiedPair ? "copied" : "copy"}
				</button>
			</div>
			<SeqLine dir="→" primer={pair.fwd} tmTarget={tmTarget} />
			<SeqLine dir="←" primer={pair.rev} tmTarget={tmTarget} />

			{/* Specificity row */}
			{specState !== "idle" && (
				<div
					style={{
						display: "flex",
						gap: "12px",
						marginTop: "5px",
						paddingTop: "5px",
						borderTop: "1px solid rgba(221,216,206,0.4)",
						flexWrap: "wrap",
					}}
				>
					<SpecBadge
						label="Fwd"
						hits={specResults?.get(pair.fwd.seq)}
						loading={specState === "loading"}
					/>
					<SpecBadge
						label="Rev"
						hits={specResults?.get(pair.rev.seq)}
						loading={specState === "loading"}
					/>
				</div>
			)}

			{mode === "qpcr" && eff !== undefined && (
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: "8px",
						marginTop: "7px",
						paddingTop: "6px",
						borderTop: "1px solid rgba(221,216,206,0.5)",
					}}
				>
					<span
						style={{
							fontFamily: "var(--font-courier)",
							fontSize: "8px",
							color: "#9a9284",
							flexShrink: 0,
						}}
					>
						Efficiency
					</span>
					<div
						style={{
							flex: 1,
							height: "5px",
							background: "#ede9e0",
							borderRadius: "3px",
							overflow: "hidden",
						}}
					>
						<div
							style={{
								width: `${eff * 100}%`,
								height: "100%",
								background: effColor(eff),
								borderRadius: "3px",
								transition: "width 0.3s ease",
							}}
						/>
					</div>
					<span
						style={{
							fontFamily: "var(--font-courier)",
							fontSize: "9px",
							fontWeight: 700,
							color: effColor(eff),
							flexShrink: 0,
						}}
					>
						{(eff * 100).toFixed(0)}%
					</span>
				</div>
			)}
		</div>
	);
}

function AssemblySeqLine({
	dir,
	tail,
	annealing,
	tm,
	fullPrimerTm,
	onCopy,
	copied,
}: {
	dir: "→" | "←";
	tail: string;
	annealing: string;
	tm: number;
	fullPrimerTm: number;
	onCopy: () => void;
	copied: boolean;
}) {
	return (
		<div
			onClick={onCopy}
			title={`Click to copy · ann ${tm.toFixed(1)}° · full ${fullPrimerTm.toFixed(1)}°`}
			style={{
				display: "flex",
				alignItems: "center",
				gap: "5px",
				cursor: "pointer",
				padding: "2px 0",
			}}
		>
			<span
				style={{
					fontFamily: "var(--font-courier)",
					fontSize: "8px",
					color: "#9a9284",
					width: "9px",
					flexShrink: 0,
				}}
			>
				{dir}
			</span>
			<span
				style={{
					fontFamily: "var(--font-courier)",
					fontSize: "10px",
					letterSpacing: "0.04em",
					flex: 1,
					overflow: "hidden",
					whiteSpace: "nowrap",
					textOverflow: "ellipsis",
				}}
			>
				<span style={{ color: "#2d7a54", opacity: 0.75 }}>{tail}</span>
				<span style={{ color: copied ? "#1a4731" : "#1c1a16", transition: "color 0.15s" }}>
					{annealing}
				</span>
			</span>
			<span
				style={{
					fontFamily: "var(--font-courier)",
					fontSize: "8px",
					color: "#9a9284",
					flexShrink: 0,
				}}
			>
				{fullPrimerTm.toFixed(1)}°
			</span>
		</div>
	);
}

function AssemblyPairCard({
	pair,
	rank,
	selected,
	onClick,
}: {
	pair: AssemblyPrimerPair;
	rank: number;
	selected?: boolean;
	onClick?: () => void;
}) {
	const [copiedFwd, setCopiedFwd] = useState(false);
	const [copiedRev, setCopiedRev] = useState(false);
	const [copiedAll, setCopiedAll] = useState(false);
	const isBest = rank === 1;

	function copyFwd() {
		void navigator.clipboard.writeText(pair.fwd.fullSeq).then(() => {
			setCopiedFwd(true);
			setTimeout(() => setCopiedFwd(false), 1200);
		});
	}
	function copyRev() {
		void navigator.clipboard.writeText(pair.rev.fullSeq).then(() => {
			setCopiedRev(true);
			setTimeout(() => setCopiedRev(false), 1200);
		});
	}
	function copyBoth(e: React.MouseEvent) {
		e.stopPropagation();
		const text = `Fwd: ${pair.fwd.fullSeq}\nRev: ${pair.rev.fullSeq}`;
		void navigator.clipboard.writeText(text).then(() => {
			setCopiedAll(true);
			setTimeout(() => setCopiedAll(false), 1500);
		});
	}

	return (
		<div
			onClick={onClick}
			style={{
				padding: "12px 14px",
				borderBottom: "1px solid rgba(221,216,206,0.5)",
				background: selected
					? "rgba(26,71,49,0.07)"
					: isBest
						? "rgba(26,71,49,0.03)"
						: "transparent",
				borderLeft: selected ? "3px solid #1a4731" : "3px solid transparent",
				cursor: onClick ? "pointer" : "default",
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					marginBottom: "6px",
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
					<span
						style={{
							fontFamily: "var(--font-courier)",
							fontSize: "9px",
							color: isBest ? "#1a4731" : "#9a9284",
							fontWeight: isBest ? 700 : 400,
						}}
					>
						#{rank}
					</span>
					<span style={{ fontFamily: "var(--font-courier)", fontSize: "9px", color: "#5a5648" }}>
						{pair.productSize} bp
					</span>
					<span style={{ color: "#ddd8ce" }}>·</span>
					<span style={{ fontFamily: "var(--font-courier)", fontSize: "9px", color: "#9a9284" }}>
						ann {pair.annealingTm.toFixed(1)}°
					</span>
					<span style={{ fontFamily: "var(--font-courier)", fontSize: "8px", color: "#b8b0a4" }}>
						{pair.fwd.tail.length}bp overlap
					</span>
				</div>
				<button
					type="button"
					onClick={copyBoth}
					style={{
						background: "none",
						border: "none",
						cursor: "pointer",
						padding: "0 2px",
						fontFamily: "var(--font-courier)",
						fontSize: "9px",
						color: copiedAll ? "#1a4731" : "#9a9284",
						transition: "color 0.15s",
						flexShrink: 0,
					}}
				>
					{copiedAll ? "copied" : "copy"}
				</button>
			</div>
			<AssemblySeqLine
				dir="→"
				tail={pair.fwd.tail}
				annealing={pair.fwd.seq}
				tm={pair.fwd.tm}
				fullPrimerTm={pair.fwd.fullPrimerTm}
				onCopy={copyFwd}
				copied={copiedFwd}
			/>
			<AssemblySeqLine
				dir="←"
				tail={pair.rev.tail}
				annealing={pair.rev.seq}
				tm={pair.rev.tm}
				fullPrimerTm={pair.rev.fullPrimerTm}
				onCopy={copyRev}
				copied={copiedRev}
			/>
		</div>
	);
}

// ── Input section styles ──────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
	fontFamily: "var(--font-courier)",
	fontSize: "9px",
	letterSpacing: "0.1em",
	textTransform: "uppercase",
	color: "#9a9284",
	display: "block",
	marginBottom: "5px",
};

const inputStyle: React.CSSProperties = {
	fontFamily: "var(--font-courier)",
	fontSize: "11px",
	color: "#1c1a16",
	background: "#faf7f2",
	border: "1px solid #ddd8ce",
	borderRadius: "3px",
	padding: "6px 8px",
	outline: "none",
	width: "100%",
	boxSizing: "border-box",
};

// ── Main component ─────────────────────────────────────────────────────────────

export function PrimerTool() {
	// Sequence
	const [rawSeq, setRawSeq] = useState("");
	const seq = cleanSeq(rawSeq);
	const seqError = validateSeq(seq);

	// Region
	const [useFullSeq, setUseFullSeq] = useState(true);
	const [regionStart, setRegionStart] = useState("1");
	const [regionEnd, setRegionEnd] = useState("");

	// Mode
	const [mode, setMode] = useState<Mode>("pcr");
	const [assemblyMethod, setAssemblyMethod] = useState<AssemblyMethod>("gibson");
	const [gibsonOverlap, setGibsonOverlap] = useState(20);
	const [ggEnzyme, setGgEnzyme] = useState<"BsaI" | "BbsI" | "BsmBI">("BsaI");

	// Polymerase
	const [polymerase, setPolymerase] = useState<Polymerase>("Q5");

	// Options
	const [optionsOpen, setOptionsOpen] = useState(false);
	const [tmTarget, setTmTarget] = useState(60);
	const [minLen, setMinLen] = useState(18);
	const [maxLen, setMaxLen] = useState(27);
	const [gcMin, setGcMin] = useState(40);
	const [gcMax, setGcMax] = useState(65);
	const [maxTmDiff, setMaxTmDiff] = useState(3);
	const [qpcrAmpliconMin, setQpcrAmpliconMin] = useState(70);
	const [qpcrAmpliconMax, setQpcrAmpliconMax] = useState(200);

	// Results
	const [pairs, setPairs] = useState<DesignPair[] | null>(null);
	const [assemblyPairs, setAssemblyPairs] = useState<AssemblyPrimerPair[] | null>(null);
	const [warning, setWarning] = useState<string | null>(null);
	const [running, setRunning] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Plot state
	const [selectedPair, setSelectedPair] = useState(0);
	const [activePlot, setActivePlot] = useState<PlotTab>("heatmap");

	// Specificity check
	const [specState, setSpecState] = useState<SpecCheckState>("idle");
	const [specResults, setSpecResults] = useState<Map<string, SpecHit[]> | null>(null);

	// Assembly plot state
	const [assemblySelectedPair, setAssemblySelectedPair] = useState(0);
	const [assemblyActivePlot, setAssemblyActivePlot] = useState<"heatmap" | "scatter">("heatmap");

	// Multiplex PCR
	const [multiplexTargets, setMultiplexTargets] = useState("");
	const [maxCrossTmDiff, setMaxCrossTmDiff] = useState(3);
	const [multiplexResult, setMultiplexResult] = useState<MultiplexResult | null>(null);
	const [multiplexRunning, setMultiplexRunning] = useState(false);
	const [multiplexError, setMultiplexError] = useState<string | null>(null);
	const multiplexWorkerRef = useRef<Worker | null>(null);

	// Exon-junction qPCR
	const [useExonSpanning, setUseExonSpanning] = useState(false);
	const [junctionPositionsRaw, setJunctionPositionsRaw] = useState("");
	const [exonJunctionResult, setExonJunctionResult] = useState<ExonJunctionResult | null>(null);
	const [exonJunctionRunning, setExonJunctionRunning] = useState(false);
	const [exonJunctionError, setExonJunctionError] = useState<string | null>(null);
	const exonJunctionWorkerRef = useRef<Worker | null>(null);

	// Conservation primer design
	const [alignmentRaw, setAlignmentRaw] = useState("");
	const [consThreshold, setConsThreshold] = useState(0.85);
	const [maxDegeneracy, setMaxDegeneracy] = useState(2);
	const [consResult, setConsResult] = useState<ConservationResult | null>(null);
	const [consRunning, setConsRunning] = useState(false);
	const [consError, setConsError] = useState<string | null>(null);
	const [consSelectedIdx, setConsSelectedIdx] = useState<number | null>(null);
	const consWorkerRef = useRef<Worker | null>(null);

	// Walking / Sanger coverage
	const [walkReadLen, setWalkReadLen] = useState(700);
	const [walkOverlap, setWalkOverlap] = useState(100);
	const [walkDirection, setWalkDirection] = useState<"fwd" | "both">("fwd");
	const [walkingResult, setWalkingResult] = useState<WalkingResult | null>(null);
	const [walkingRunning, setWalkingRunning] = useState(false);
	const [walkingError, setWalkingError] = useState<string | null>(null);
	const [walkSelectedIdx, setWalkSelectedIdx] = useState<number | null>(null);
	const walkWorkerRef = useRef<Worker | null>(null);

	// Incremented by quick-fix buttons to trigger a re-run after state settles
	const [retryTrigger, setRetryTrigger] = useState(0);

	const workerRef = useRef<Worker | null>(null);
	const specWorkerRef = useRef<Worker | null>(null);

	useEffect(
		() => () => {
			workerRef.current?.terminate();
			specWorkerRef.current?.terminate();
			walkWorkerRef.current?.terminate();
			consWorkerRef.current?.terminate();
			exonJunctionWorkerRef.current?.terminate();
			multiplexWorkerRef.current?.terminate();
		},
		[],
	);

	// Re-run design when a quick-fix button triggers a retry
	useEffect(() => {
		if (retryTrigger === 0) return;
		design();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [retryTrigger]);

	// Auto-run specificity check when PCR/qPCR pairs arrive
	useEffect(() => {
		if (!pairs || pairs.length === 0) return;

		// Deduplicate primer sequences across all pairs
		const unique = new Map<string, string>(); // seq → id
		for (const [i, pair] of pairs.entries()) {
			unique.set(pair.fwd.seq, `pair${i}_fwd`);
			unique.set(pair.rev.seq, `pair${i}_rev`);
		}

		setSpecState("loading");
		setSpecResults(null);

		// Reuse the spec worker across checks (features.json is cached inside it)
		if (!specWorkerRef.current) {
			specWorkerRef.current = new Worker(new URL("./specificity.worker.ts", import.meta.url));
		}
		const worker = specWorkerRef.current;

		worker.onmessage = (e: MessageEvent<SpecResponse>) => {
			if (e.data.type === "error") {
				setSpecState("idle"); // silently fail — specificity is bonus info
				return;
			}
			const map = new Map<string, SpecHit[]>();
			for (const { id, hits } of e.data.results) {
				// Recover seq from id: find it in unique map
				for (const [seq, uid] of unique) {
					if (uid === id) {
						map.set(seq, hits);
						break;
					}
				}
			}
			setSpecResults(map);
			setSpecState("done");
		};
		worker.onerror = () => setSpecState("idle");

		const req: SpecRequest = {
			primers: [...unique.entries()].map(([seq, id]) => ({ seq, id })),
		};
		worker.postMessage(req);
	}, [pairs]);

	// Specificity check for Walking primers
	useEffect(() => {
		if (!walkingResult || walkingResult.primers.length === 0) return;
		const unique = new Map<string, string>();
		for (const [i, p] of walkingResult.primers.entries()) {
			unique.set(p.seq, `walk${i}`);
		}
		setSpecState("loading");
		setSpecResults(null);
		if (!specWorkerRef.current) {
			specWorkerRef.current = new Worker(new URL("./specificity.worker.ts", import.meta.url));
		}
		const worker = specWorkerRef.current;
		worker.onmessage = (e: MessageEvent<SpecResponse>) => {
			if (e.data.type === "error") {
				setSpecState("idle");
				return;
			}
			const map = new Map<string, SpecHit[]>();
			for (const { id, hits } of e.data.results) {
				for (const [seq2, uid] of unique) {
					if (uid === id) {
						map.set(seq2, hits);
						break;
					}
				}
			}
			setSpecResults(map);
			setSpecState("done");
		};
		worker.onerror = () => setSpecState("idle");
		worker.postMessage({
			primers: [...unique.entries()].map(([seq2, id]) => ({ seq: seq2, id })),
		} satisfies SpecRequest);
	}, [walkingResult]);

	// Specificity check for Exon-junction primers
	useEffect(() => {
		if (!exonJunctionResult || exonJunctionResult.pairs.length === 0) return;
		const unique = new Map<string, string>();
		for (const [i, pair] of exonJunctionResult.pairs.entries()) {
			unique.set(pair.fwd.seq, `ej${i}_fwd`);
			unique.set(pair.rev.seq, `ej${i}_rev`);
		}
		setSpecState("loading");
		setSpecResults(null);
		if (!specWorkerRef.current) {
			specWorkerRef.current = new Worker(new URL("./specificity.worker.ts", import.meta.url));
		}
		const worker = specWorkerRef.current;
		worker.onmessage = (e: MessageEvent<SpecResponse>) => {
			if (e.data.type === "error") {
				setSpecState("idle");
				return;
			}
			const map = new Map<string, SpecHit[]>();
			for (const { id, hits } of e.data.results) {
				for (const [seq2, uid] of unique) {
					if (uid === id) {
						map.set(seq2, hits);
						break;
					}
				}
			}
			setSpecResults(map);
			setSpecState("done");
		};
		worker.onerror = () => setSpecState("idle");
		worker.postMessage({
			primers: [...unique.entries()].map(([seq2, id]) => ({ seq: seq2, id })),
		} satisfies SpecRequest);
	}, [exonJunctionResult]);

	// Specificity check for Multiplex primers
	useEffect(() => {
		if (!multiplexResult) return;
		const unique = new Map<string, string>();
		for (const [i, p] of multiplexResult.pairs.entries()) {
			if (!p.pair) continue;
			unique.set(p.pair.fwd.seq, `mx${i}_fwd`);
			unique.set(p.pair.rev.seq, `mx${i}_rev`);
		}
		if (unique.size === 0) return;
		setSpecState("loading");
		setSpecResults(null);
		if (!specWorkerRef.current) {
			specWorkerRef.current = new Worker(new URL("./specificity.worker.ts", import.meta.url));
		}
		const worker = specWorkerRef.current;
		worker.onmessage = (e: MessageEvent<SpecResponse>) => {
			if (e.data.type === "error") {
				setSpecState("idle");
				return;
			}
			const map = new Map<string, SpecHit[]>();
			for (const { id, hits } of e.data.results) {
				for (const [seq2, uid] of unique) {
					if (uid === id) {
						map.set(seq2, hits);
						break;
					}
				}
			}
			setSpecResults(map);
			setSpecState("done");
		};
		worker.onerror = () => setSpecState("idle");
		worker.postMessage({
			primers: [...unique.entries()].map(([seq2, id]) => ({ seq: seq2, id })),
		} satisfies SpecRequest);
	}, [multiplexResult]);

	// When seq changes, reset region end
	useEffect(() => {
		if (seq.length > 0) setRegionEnd(String(seq.length));
	}, [seq.length]);

	// ── Live region / amplicon estimate (shown below region inputs) ──────────────
	const regionInfo = (() => {
		if (!seq || seq.length === 0) return null;
		const FULL_INSET = Math.min(200, Math.max(80, Math.floor(seq.length * 0.1)));
		const s = useFullSeq ? FULL_INSET : Math.max(0, Number(regionStart) - 1);
		const e = useFullSeq ? seq.length - FULL_INSET : Math.min(seq.length, Number(regionEnd));
		const len = e - s;
		if (len <= 0) return null;
		// Estimated amplicon range: region + both primers at min/max length
		const ampMin = len + 2 * minLen;
		const ampMax = len + 2 * maxLen;
		if (mode === "qpcr") {
			const fits = ampMin <= qpcrAmpliconMax && ampMax >= qpcrAmpliconMin;
			const label = fits ? "✓" : "✗ too large";
			const color = fits ? "#1a4731" : "#b8933a";
			return { len, ampMin, ampMax, color, label, mode: "qpcr" as const };
		}
		return { len, ampMin, ampMax, color: "#9a9284", label: "", mode: "pcr" as const };
	})();

	const design = useCallback(() => {
		if (!seq || seqError || mode === "walking") return;
		// When amplifying the full sequence, inset by ~10% so primers have a
		// substantial search window at each end. Minimum 80 bp, maximum 200 bp.
		const FULL_INSET = Math.min(200, Math.max(80, Math.floor(seq.length * 0.1)));
		// Guard: full-seq mode requires at least 2× the inset to leave a non-empty region
		if (useFullSeq && seq.length < FULL_INSET * 2 + 20) {
			setPairs(null);
			setAssemblyPairs(null);
			setWarning(null);
			setError(
				`Sequence is too short for full-sequence mode (${seq.length} bp). Need ≥ ${FULL_INSET * 2 + 20} bp, or uncheck "Full sequence" and specify a region manually.`,
			);
			return;
		}
		const s0 = useFullSeq ? FULL_INSET : Math.max(0, Number(regionStart) - 1);
		const e0 = useFullSeq ? seq.length - FULL_INSET : Math.min(seq.length, Number(regionEnd));
		if (s0 >= e0) {
			setPairs(null);
			setAssemblyPairs(null);
			setWarning(null);
			setError("Start must be less than end.");
			return;
		}
		// qPCR: the region PLUS two primers must fit within the amplicon size range.
		// Primers are at least minLen bp each, so the effective region ceiling is
		// qpcrAmpliconMax − 2×minLen.
		const regionLen = e0 - s0;
		const qpcrRegionMax = qpcrAmpliconMax - 2 * minLen;
		if (mode === "qpcr" && regionLen > qpcrRegionMax) {
			setPairs(null);
			setAssemblyPairs(null);
			setWarning(null);
			setError(
				`Target region is ${regionLen} bp — too large for qPCR. With ${minLen}–${maxLen} bp primers the amplicon would exceed ${qpcrAmpliconMax} bp. Narrow the region to ≤ ${qpcrRegionMax} bp.`,
			);
			return;
		}

		workerRef.current?.terminate();
		setRunning(true);
		setPairs(null);
		setAssemblyPairs(null);
		setWarning(null);
		setError(null);
		setSelectedPair(0);
		setSpecState("idle");
		setSpecResults(null);

		const worker = new Worker(
			new URL("../../components/sequence/primer-design.worker.ts", import.meta.url),
		);
		workerRef.current = worker;

		const opts = {
			tmTarget,
			primerLenRange: [minLen, maxLen] as [number, number],
			gcRange: [gcMin / 100, gcMax / 100] as [number, number],
			maxTmDiff,
			numReturn: 5,
			...(mode === "qpcr"
				? { productSizeRange: [qpcrAmpliconMin, qpcrAmpliconMax] as [number, number] }
				: useFullSeq
					? {
							productSizeRange: [Math.floor(seq.length * 0.9), Math.ceil(seq.length * 1.1)] as [
								number,
								number,
							],
						}
					: {}),
		};

		const assemblyOpts =
			mode === "assembly"
				? {
						method: assemblyMethod,
						gibsonOverlap,
						ggEnzymeSite:
							assemblyMethod === "golden_gate"
								? ({ BsaI: "GGTCTC", BbsI: "GAAGAC", BsmBI: "CGTCTC" } as Record<string, string>)[
										ggEnzyme
									]
								: undefined,
					}
				: undefined;

		const req: PrimerWorkerRequest = {
			seq,
			regionStart: s0,
			regionEnd: e0,
			opts,
			assemblyOpts,
			mode: mode as "pcr" | "qpcr" | "assembly",
		};

		worker.onmessage = (e: MessageEvent<PrimerWorkerResponse>) => {
			setRunning(false);
			if (e.data.type === "error") {
				setError(e.data.message);
				return;
			}
			const { result, mode: resultMode } = e.data;
			if (resultMode === "assembly") {
				const ar = result as import("@shandley/primd").AssemblyResult;
				setAssemblyPairs(ar.pairs ?? []);
				setWarning(ar.warning ?? null);
			} else {
				const pr = result as
					| import("@shandley/primd").PCRResult
					| import("@shandley/primd").QPCRResult;
				setPairs((pr.pairs ?? []) as DesignPair[]);
				setWarning(pr.warning ?? null);
			}
		};
		worker.onerror = (e) => {
			setRunning(false);
			setError(e.message || "Worker error");
		};
		worker.postMessage(req);
	}, [
		seq,
		seqError,
		useFullSeq,
		regionStart,
		regionEnd,
		mode,
		assemblyMethod,
		gibsonOverlap,
		ggEnzyme,
		tmTarget,
		minLen,
		maxLen,
		gcMin,
		gcMax,
		maxTmDiff,
		qpcrAmpliconMin,
		qpcrAmpliconMax,
	]);

	const designWalking = useCallback(() => {
		if (!seq || seqError) return;
		if (seq.length < walkReadLen) {
			setWalkingError(
				`Sequence (${seq.length} bp) is shorter than one read length (${walkReadLen} bp).`,
			);
			return;
		}
		walkWorkerRef.current?.terminate();
		setWalkingRunning(true);
		setWalkingResult(null);
		setWalkingError(null);
		setWalkSelectedIdx(null);

		const worker = new Worker(new URL("./walking.worker.ts", import.meta.url));
		walkWorkerRef.current = worker;

		const req: WalkingRequest = {
			seq,
			readLen: walkReadLen,
			overlap: walkOverlap,
			direction: walkDirection,
			primerLenRange: [minLen, maxLen],
			tmTarget,
			gcRange: [gcMin / 100, gcMax / 100],
			searchWindow: 35,
		};

		worker.onmessage = (e: MessageEvent<WalkingResponse>) => {
			setWalkingRunning(false);
			if (e.data.type === "error") {
				setWalkingError(e.data.message);
			} else {
				setWalkingResult(e.data.result);
			}
		};
		worker.onerror = (e) => {
			setWalkingRunning(false);
			setWalkingError(e.message || "Walking design failed");
		};
		worker.postMessage(req);
	}, [
		seq,
		seqError,
		walkReadLen,
		walkOverlap,
		walkDirection,
		minLen,
		maxLen,
		tmTarget,
		gcMin,
		gcMax,
	]);

	const designMultiplex = useCallback(() => {
		if (!multiplexTargets.trim()) return;
		multiplexWorkerRef.current?.terminate();
		setMultiplexRunning(true);
		setMultiplexResult(null);
		setMultiplexError(null);

		const worker = new Worker(new URL("./multiplex.worker.ts", import.meta.url));
		multiplexWorkerRef.current = worker;

		const req: MultiplexRequest = {
			targets: multiplexTargets,
			primerLenRange: [minLen, maxLen],
			tmTarget,
			gcRange: [gcMin / 100, gcMax / 100],
			maxTmDiff,
			productSizeRange: [100, 1000],
			maxCrossTmDiff,
			warnDimerDG: -3.0,
			failDimerDG: -5.0,
		};

		worker.onmessage = (e: MessageEvent<MultiplexResponse>) => {
			setMultiplexRunning(false);
			if (e.data.type === "error") setMultiplexError(e.data.message);
			else setMultiplexResult(e.data.result);
		};
		worker.onerror = (ev) => {
			setMultiplexRunning(false);
			setMultiplexError(ev.message || "Multiplex design failed");
		};
		worker.postMessage(req);
	}, [multiplexTargets, minLen, maxLen, tmTarget, gcMin, gcMax, maxTmDiff, maxCrossTmDiff]);

	const designExonJunction = useCallback(() => {
		if (!seq || seqError) return;

		// Parse junction positions (1-indexed from UI → 0-indexed in worker)
		const junctions = junctionPositionsRaw
			.split(/[,\s]+/)
			.map((s) => Number(s.trim()))
			.filter((n) => !isNaN(n) && n > 0)
			.map((n) => n - 1); // convert to 0-indexed

		if (junctions.length === 0) {
			setExonJunctionError("Enter at least one exon junction position (e.g. '150, 300').");
			return;
		}

		exonJunctionWorkerRef.current?.terminate();
		setExonJunctionRunning(true);
		setExonJunctionResult(null);
		setExonJunctionError(null);

		const worker = new Worker(new URL("./exon-junction.worker.ts", import.meta.url));
		exonJunctionWorkerRef.current = worker;

		const req: ExonJunctionRequest = {
			seq,
			junctions,
			primerLenRange: [minLen, maxLen],
			tmTarget,
			gcRange: [gcMin / 100, gcMax / 100],
			maxTmDiff,
			productSizeRange: [qpcrAmpliconMin, qpcrAmpliconMax],
			numReturn: 5,
			minUpstreamBases: 5,
			minDownstreamBases: 8,
		};

		worker.onmessage = (e: MessageEvent<ExonJunctionResponse>) => {
			setExonJunctionRunning(false);
			if (e.data.type === "error") {
				setExonJunctionError(e.data.message);
			} else {
				setExonJunctionResult(e.data.result);
			}
		};
		worker.onerror = (ev) => {
			setExonJunctionRunning(false);
			setExonJunctionError(ev.message || "Exon-junction design failed");
		};
		worker.postMessage(req);
	}, [
		seq,
		seqError,
		junctionPositionsRaw,
		minLen,
		maxLen,
		tmTarget,
		gcMin,
		gcMax,
		maxTmDiff,
		qpcrAmpliconMin,
		qpcrAmpliconMax,
	]);

	const designConservation = useCallback(() => {
		if (!alignmentRaw.trim()) return;
		consWorkerRef.current?.terminate();
		setConsRunning(true);
		setConsResult(null);
		setConsError(null);
		setConsSelectedIdx(null);

		const worker = new Worker(new URL("./conservation.worker.ts", import.meta.url));
		consWorkerRef.current = worker;

		const req: ConservationRequest = {
			alignment: alignmentRaw,
			conservationThreshold: consThreshold,
			maxDegeneracy,
			primerLenRange: [minLen, maxLen],
			tmTarget,
			gcRange: [gcMin / 100, gcMax / 100],
			numReturn: 5,
		};

		worker.onmessage = (e: MessageEvent<ConservationResponse>) => {
			setConsRunning(false);
			if (e.data.type === "error") {
				setConsError(e.data.message);
			} else {
				setConsResult(e.data.result);
			}
		};
		worker.onerror = (ev) => {
			setConsRunning(false);
			setConsError(ev.message || "Conservation design failed");
		};
		worker.postMessage(req);
	}, [alignmentRaw, consThreshold, maxDegeneracy, minLen, maxLen, tmTarget, gcMin, gcMax]);

	const hasPairs = (pairs && pairs.length > 0) || (assemblyPairs && assemblyPairs.length > 0);
	const currentPair = pairs?.[selectedPair] ?? null;

	return (
		<div
			style={{
				minHeight: "100vh",
				background: "#f5f0e8",
				display: "flex",
				flexDirection: "column",
			}}
		>
			<SiteNav />

			{/* Body */}
			<div style={{ flex: 1, display: "grid", gridTemplateColumns: "380px 1fr", minHeight: 0 }}>
				{/* Left: input panel */}
				<div
					style={{
						borderRight: "1px solid #ddd8ce",
						display: "flex",
						flexDirection: "column",
						background: "#faf7f2",
						height: "calc(100vh - 60px)",
						overflowY: "auto",
						position: "sticky",
						top: "60px",
					}}
				>
					{/* Panel header */}
					<div
						style={{
							padding: "18px 20px 14px",
							borderBottom: "1px solid #ddd8ce",
						}}
					>
						<span
							style={{
								fontFamily: "var(--font-courier)",
								fontSize: "9px",
								letterSpacing: "0.16em",
								textTransform: "uppercase",
								color: "#1a4731",
							}}
						>
							Primer Design
						</span>
						<p
							style={{
								fontFamily: "var(--font-karla)",
								fontSize: "12px",
								color: "#9a9284",
								margin: "5px 0 0",
								lineHeight: 1.5,
							}}
						>
							SantaLucia 1998 nearest-neighbor · Owczarzy 2008 Mg²⁺ correction
						</p>
					</div>

					<div
						style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "16px" }}
					>
						{/* Sequence input — hidden in consensus and multiplex modes */}
						{mode !== "consensus" && mode !== "multiplex" && (
							<div>
								<label style={labelStyle}>Sequence</label>
								<textarea
									value={rawSeq}
									onChange={(e) => setRawSeq(e.target.value)}
									placeholder="Paste DNA sequence (FASTA or plain)..."
									rows={7}
									style={{
										...inputStyle,
										resize: "vertical",
										lineHeight: 1.5,
										fontSize: "10px",
										letterSpacing: "0.04em",
										fontFamily: "var(--font-courier)",
									}}
								/>
								{seq.length > 0 && (
									<div
										style={{
											marginTop: "4px",
											fontFamily: "var(--font-courier)",
											fontSize: "9px",
											color: seqError ? "#a02828" : "#9a9284",
										}}
									>
										{seqError ?? `${seq.length.toLocaleString()} bp`}
									</div>
								)}
							</div>
						)}

						{/* Multiplex targets input */}
						{mode === "multiplex" && (
							<div>
								<label style={labelStyle}>Target sequences (multi-FASTA)</label>
								<textarea
									value={multiplexTargets}
									onChange={(e) => setMultiplexTargets(e.target.value)}
									placeholder={">Target1\nATCGATCG...\n>Target2\nGCGATCGA..."}
									rows={8}
									style={{
										...inputStyle,
										resize: "vertical",
										lineHeight: 1.5,
										fontSize: "10px",
										letterSpacing: "0.04em",
										fontFamily: "var(--font-courier)",
									}}
								/>
								{multiplexTargets.trim() &&
									(() => {
										const n = (multiplexTargets.match(/^>/gm) ?? []).length;
										return (
											<div
												style={{
													marginTop: "4px",
													fontFamily: "var(--font-courier)",
													fontSize: "9px",
													color: n >= 2 ? "#9a9284" : "#b8933a",
												}}
											>
												{n >= 2 ? `${n} targets` : `Need ≥ 2 targets (found ${n})`}
											</div>
										);
									})()}
							</div>
						)}

						{/* Alignment input — consensus mode only */}
						{mode === "consensus" && (
							<div>
								<label style={labelStyle}>Alignment (multi-FASTA)</label>
								<textarea
									value={alignmentRaw}
									onChange={(e) => setAlignmentRaw(e.target.value)}
									placeholder={">Seq1\nATCGATCG...\n>Seq2\nATCGATCG..."}
									rows={8}
									style={{
										...inputStyle,
										resize: "vertical",
										lineHeight: 1.5,
										fontSize: "10px",
										letterSpacing: "0.04em",
										fontFamily: "var(--font-courier)",
									}}
								/>
								{alignmentRaw.trim() &&
									(() => {
										const nSeqs = (alignmentRaw.match(/^>/gm) ?? []).length;
										return (
											<div
												style={{
													marginTop: "4px",
													fontFamily: "var(--font-courier)",
													fontSize: "9px",
													color: nSeqs >= 2 ? "#9a9284" : "#b8933a",
												}}
											>
												{nSeqs >= 2 ? `${nSeqs} sequences` : `Need ≥ 2 sequences (found ${nSeqs})`}
											</div>
										);
									})()}
							</div>
						)}

						{/* Region — not applicable in consensus or multiplex modes */}
						{mode !== "consensus" && mode !== "multiplex" && (
							<div>
								<label style={labelStyle}>Target Region</label>
								<label
									style={{
										display: "flex",
										alignItems: "center",
										gap: "7px",
										cursor: "pointer",
										marginBottom: "8px",
									}}
								>
									<input
										type="checkbox"
										checked={useFullSeq}
										onChange={(e) => setUseFullSeq(e.target.checked)}
										style={{ accentColor: "#1a4731" }}
									/>
									<span
										style={{
											fontFamily: "var(--font-courier)",
											fontSize: "10px",
											color: "#5a5648",
										}}
									>
										Full sequence
									</span>
								</label>
								{mode === "qpcr" && !useExonSpanning && (
									<p
										style={{
											fontFamily: "var(--font-courier)",
											fontSize: "9px",
											color: "#b8933a",
											margin: "0 0 4px",
											lineHeight: 1.5,
										}}
									>
										Select an 80–150 bp region — primers add ~36 bp, keeping the amplicon within
										70–200 bp.
									</p>
								)}
								{mode === "qpcr" && useExonSpanning && (
									<p
										style={{
											fontFamily: "var(--font-courier)",
											fontSize: "9px",
											color: "#1a4731",
											margin: "0 0 4px",
											lineHeight: 1.5,
										}}
									>
										Exon-spanning mode: forward primer straddles the junction — won't amplify gDNA.
									</p>
								)}
								{!useFullSeq && (
									<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
										<div>
											<span style={{ ...labelStyle, marginBottom: "3px" }}>Start</span>
											<input
												type="number"
												value={regionStart}
												min={1}
												max={seq.length}
												onChange={(e) => setRegionStart(e.target.value)}
												style={inputStyle}
											/>
										</div>
										<div>
											<span style={{ ...labelStyle, marginBottom: "3px" }}>End</span>
											<input
												type="number"
												value={regionEnd}
												min={1}
												max={seq.length}
												onChange={(e) => setRegionEnd(e.target.value)}
												style={inputStyle}
											/>
										</div>
									</div>
								)}

								{/* Live region / amplicon readout */}
								{regionInfo &&
									((mode === "qpcr" && !useExonSpanning) || (mode === "pcr" && !useFullSeq)) && (
										<div
											style={{
												fontFamily: "var(--font-courier)",
												fontSize: "9px",
												color: regionInfo.color,
												lineHeight: 1.6,
												paddingTop: "5px",
											}}
										>
											{mode === "qpcr"
												? `Region: ${regionInfo.len} bp · amplicon ~${regionInfo.ampMin}–${regionInfo.ampMax} bp ${regionInfo.label}`
												: `Region: ${regionInfo.len} bp`}
										</div>
									)}
							</div>
						)}

						{/* Mode tabs */}
						<div>
							<label style={labelStyle}>Mode</label>
							<div
								style={{
									display: "grid",
									gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr 1fr",
									border: "1px solid #ddd8ce",
									borderRadius: "3px",
									overflow: "hidden",
								}}
							>
								{(["pcr", "qpcr", "assembly", "walking", "consensus", "multiplex"] as const).map(
									(m, i) => (
										<button
											key={m}
											type="button"
											onClick={() => {
												setMode(m);
												if (m === "qpcr") {
													setUseFullSeq(false);
													// Auto-center a 100 bp target region so the amplicon (~140 bp
													// with primers) lands comfortably within the 70-200 bp range
													if (seq.length >= 100) {
														const mid = Math.floor(seq.length / 2);
														setRegionStart(String(Math.max(1, mid - 50)));
														setRegionEnd(String(Math.min(seq.length, mid + 50)));
													}
												}
											}}
											style={{
												fontFamily: "var(--font-courier)",
												fontSize: "9px",
												letterSpacing: "0.08em",
												textTransform: "uppercase",
												padding: "8px 4px",
												background: mode === m ? "#1a4731" : "transparent",
												color: mode === m ? "white" : "#5a5648",
												border: "none",
												borderLeft: i > 0 ? "1px solid #ddd8ce" : "none",
												cursor: "pointer",
												transition: "background 0.15s, color 0.15s",
											}}
										>
											{m === "pcr"
												? "PCR"
												: m === "qpcr"
													? "qPCR"
													: m === "assembly"
														? "Assembly"
														: m === "walking"
															? "Walking"
															: m === "consensus"
																? "Consensus"
																: "Multiplex"}
										</button>
									),
								)}
							</div>

							{/* Assembly sub-options */}
							{mode === "assembly" && (
								<div
									style={{
										marginTop: "10px",
										display: "flex",
										flexDirection: "column",
										gap: "8px",
									}}
								>
									<div
										style={{
											display: "grid",
											gridTemplateColumns: "1fr 1fr",
											border: "1px solid #ddd8ce",
											borderRadius: "3px",
											overflow: "hidden",
										}}
									>
										{(["gibson", "golden_gate"] as const).map((m, i) => (
											<button
												key={m}
												type="button"
												onClick={() => setAssemblyMethod(m)}
												style={{
													fontFamily: "var(--font-courier)",
													fontSize: "9px",
													letterSpacing: "0.06em",
													padding: "6px 4px",
													background: assemblyMethod === m ? "#2d7a54" : "transparent",
													color: assemblyMethod === m ? "white" : "#5a5648",
													border: "none",
													borderLeft: i > 0 ? "1px solid #ddd8ce" : "none",
													cursor: "pointer",
													transition: "background 0.15s",
												}}
											>
												{m === "gibson" ? "Gibson" : "Golden Gate"}
											</button>
										))}
									</div>
									{assemblyMethod === "gibson" ? (
										<div>
											<span style={labelStyle}>Overlap length (bp)</span>
											<input
												type="number"
												value={gibsonOverlap}
												min={10}
												max={40}
												onChange={(e) => setGibsonOverlap(Number(e.target.value))}
												style={inputStyle}
											/>
										</div>
									) : (
										<div>
											<span style={labelStyle}>Restriction enzyme</span>
											<select
												value={ggEnzyme}
												onChange={(e) => setGgEnzyme(e.target.value as "BsaI" | "BbsI" | "BsmBI")}
												style={inputStyle}
											>
												{["BsaI", "BbsI", "BsmBI"].map((e) => (
													<option key={e} value={e}>
														{e}
													</option>
												))}
											</select>
										</div>
									)}
								</div>
							)}
						</div>

						{/* Walking sub-options */}
						{mode === "walking" && (
							<div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
								<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
									<div>
										<span style={labelStyle}>Read length (bp)</span>
										<input
											type="number"
											value={walkReadLen}
											min={300}
											max={1200}
											step={50}
											onChange={(e) => setWalkReadLen(Number(e.target.value))}
											style={inputStyle}
										/>
									</div>
									<div>
										<span style={labelStyle}>Overlap (bp)</span>
										<input
											type="number"
											value={walkOverlap}
											min={50}
											max={300}
											step={25}
											onChange={(e) => setWalkOverlap(Number(e.target.value))}
											style={inputStyle}
										/>
									</div>
								</div>
								<div>
									<span style={labelStyle}>Direction</span>
									<div
										style={{
											display: "grid",
											gridTemplateColumns: "1fr 1fr",
											border: "1px solid #ddd8ce",
											borderRadius: "3px",
											overflow: "hidden",
										}}
									>
										{(["fwd", "both"] as const).map((d, i) => (
											<button
												key={d}
												type="button"
												onClick={() => setWalkDirection(d)}
												style={{
													fontFamily: "var(--font-courier)",
													fontSize: "9px",
													letterSpacing: "0.06em",
													padding: "6px 4px",
													background: walkDirection === d ? "#1a4731" : "transparent",
													color: walkDirection === d ? "white" : "#5a5648",
													border: "none",
													borderLeft: i > 0 ? "1px solid #ddd8ce" : "none",
													cursor: "pointer",
												}}
											>
												{d === "fwd" ? "Forward only" : "Both strands"}
											</button>
										))}
									</div>
								</div>
								<p
									style={{
										fontFamily: "var(--font-courier)",
										fontSize: "9px",
										color: "#9a9284",
										margin: 0,
										lineHeight: 1.6,
									}}
								>
									Step: {walkReadLen - walkOverlap} bp · ~
									{Math.ceil((seq.length || 1000) / (walkReadLen - walkOverlap))} primers for{" "}
									{seq.length > 0 ? `${seq.length} bp` : "this sequence"}
								</p>
							</div>
						)}

						{/* Exon-junction sub-options (qPCR only) */}
						{mode === "qpcr" && (
							<div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
								<label
									style={{ display: "flex", alignItems: "center", gap: "7px", cursor: "pointer" }}
								>
									<input
										type="checkbox"
										checked={useExonSpanning}
										onChange={(e) => {
											setUseExonSpanning(e.target.checked);
											if (e.target.checked) setUseFullSeq(true);
										}}
										style={{ accentColor: "#1a4731" }}
									/>
									<span
										style={{
											fontFamily: "var(--font-courier)",
											fontSize: "10px",
											color: "#1a4731",
											fontWeight: 600,
										}}
									>
										Exon-spanning (gDNA-free)
									</span>
								</label>
								{useExonSpanning && (
									<div>
										<span style={labelStyle}>
											Exon junction positions (1-indexed, comma-separated)
										</span>
										<input
											type="text"
											value={junctionPositionsRaw}
											onChange={(e) => setJunctionPositionsRaw(e.target.value)}
											placeholder="e.g. 150, 300, 450"
											style={inputStyle}
										/>
										<p
											style={{
												fontFamily: "var(--font-courier)",
												fontSize: "8px",
												color: "#9a9284",
												margin: "4px 0 0",
												lineHeight: 1.6,
											}}
										>
											Position in mRNA where each new exon begins. From NCBI/Ensembl gene page.
										</p>
									</div>
								)}
							</div>
						)}

						{/* Consensus sub-options */}
						{mode === "consensus" && (
							<div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
								<div>
									<label style={labelStyle}>
										Conservation threshold — {Math.round(consThreshold * 100)}%
									</label>
									<input
										type="range"
										min={60}
										max={100}
										value={Math.round(consThreshold * 100)}
										onChange={(e) => setConsThreshold(Number(e.target.value) / 100)}
										style={{ width: "100%", accentColor: "#1a4731" }}
									/>
									<div
										style={{
											display: "flex",
											justifyContent: "space-between",
											fontFamily: "var(--font-courier)",
											fontSize: "8px",
											color: "#b8b0a4",
										}}
									>
										<span>60% (permissive)</span>
										<span>100% (identical)</span>
									</div>
								</div>
								<div>
									<span style={labelStyle}>Max degenerate positions</span>
									<input
										type="number"
										value={maxDegeneracy}
										min={0}
										max={6}
										onChange={(e) => setMaxDegeneracy(Number(e.target.value))}
										style={inputStyle}
									/>
								</div>
								<p
									style={{
										fontFamily: "var(--font-courier)",
										fontSize: "9px",
										color: "#9a9284",
										margin: 0,
										lineHeight: 1.6,
									}}
								>
									Degenerate bases (R, Y, S, W…) cover polymorphic positions. Set to 0 for fully
									conserved primers only.
								</p>
							</div>
						)}

						{/* Multiplex sub-options */}
						{mode === "multiplex" && (
							<div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
								<div>
									<span style={labelStyle}>Max cross-pair ΔTm (°C)</span>
									<input
										type="number"
										value={maxCrossTmDiff}
										min={1}
										max={8}
										step={0.5}
										onChange={(e) => setMaxCrossTmDiff(Number(e.target.value))}
										style={inputStyle}
									/>
								</div>
								<p
									style={{
										fontFamily: "var(--font-courier)",
										fontSize: "9px",
										color: "#9a9284",
										margin: 0,
										lineHeight: 1.6,
									}}
								>
									Pairs whose annealing temps differ by more than this are flagged. Cross-dimer ΔG
									&gt; −3 kcal/mol = compatible.
								</p>
							</div>
						)}

						{/* Options accordion */}
						<div>
							<button
								type="button"
								onClick={() => setOptionsOpen((o) => !o)}
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
									width: "100%",
									background: "none",
									border: "none",
									padding: "0",
									cursor: "pointer",
								}}
							>
								<span style={labelStyle}>Options</span>
								<span
									style={{ fontFamily: "var(--font-courier)", fontSize: "10px", color: "#9a9284" }}
								>
									{optionsOpen ? "▲" : "▼"}
								</span>
							</button>

							{optionsOpen && (
								<div
									style={{
										display: "flex",
										flexDirection: "column",
										gap: "10px",
										marginTop: "8px",
									}}
								>
									<div>
										<span style={labelStyle}>Target Tm (°C)</span>
										<input
											type="number"
											value={tmTarget}
											min={45}
											max={75}
											onChange={(e) => setTmTarget(Number(e.target.value))}
											style={inputStyle}
										/>
									</div>
									<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
										<div>
											<span style={labelStyle}>Min len (bp)</span>
											<input
												type="number"
												value={minLen}
												min={15}
												max={30}
												onChange={(e) => setMinLen(Number(e.target.value))}
												style={inputStyle}
											/>
										</div>
										<div>
											<span style={labelStyle}>Max len (bp)</span>
											<input
												type="number"
												value={maxLen}
												min={18}
												max={35}
												onChange={(e) => setMaxLen(Number(e.target.value))}
												style={inputStyle}
											/>
										</div>
									</div>
									<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
										<div>
											<span style={labelStyle}>GC min (%)</span>
											<input
												type="number"
												value={gcMin}
												min={20}
												max={60}
												onChange={(e) => setGcMin(Number(e.target.value))}
												style={inputStyle}
											/>
										</div>
										<div>
											<span style={labelStyle}>GC max (%)</span>
											<input
												type="number"
												value={gcMax}
												min={40}
												max={80}
												onChange={(e) => setGcMax(Number(e.target.value))}
												style={inputStyle}
											/>
										</div>
									</div>
									<div>
										<span style={labelStyle}>Max ΔTm (°C)</span>
										<input
											type="number"
											value={maxTmDiff}
											min={1}
											max={8}
											step={0.5}
											onChange={(e) => setMaxTmDiff(Number(e.target.value))}
											style={inputStyle}
										/>
									</div>
									{mode === "qpcr" && (
										<div>
											<span style={labelStyle}>Amplicon range (bp)</span>
											<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
												<input
													type="number"
													value={qpcrAmpliconMin}
													min={50}
													max={150}
													onChange={(e) => setQpcrAmpliconMin(Number(e.target.value))}
													style={inputStyle}
													placeholder="Min"
												/>
												<input
													type="number"
													value={qpcrAmpliconMax}
													min={100}
													max={500}
													onChange={(e) => setQpcrAmpliconMax(Number(e.target.value))}
													style={inputStyle}
													placeholder="Max"
												/>
											</div>
										</div>
									)}
								</div>
							)}
						</div>

						{/* Polymerase selector */}
						<div>
							<label style={labelStyle}>Polymerase</label>
							<select
								value={polymerase}
								onChange={(e) => setPolymerase(e.target.value as Polymerase)}
								style={inputStyle}
							>
								{POLYMERASES.map((p) => (
									<option key={p} value={p}>
										{p}
										{p !== "Custom"
											? ` (Ta = Tm${POLYMERASE_OFFSET[p] >= 0 ? "+" : ""}${POLYMERASE_OFFSET[p]}°C)`
											: " (no offset)"}
									</option>
								))}
							</select>
						</div>

						{/* Design button */}
						<button
							type="button"
							onClick={
								mode === "walking"
									? designWalking
									: mode === "consensus"
										? designConservation
										: mode === "multiplex"
											? designMultiplex
											: mode === "qpcr" && useExonSpanning
												? designExonJunction
												: design
							}
							disabled={
								mode === "consensus"
									? !alignmentRaw.trim() || consRunning
									: mode === "multiplex"
										? !multiplexTargets.trim() || multiplexRunning
										: mode === "walking"
											? !seq || !!seqError || walkingRunning
											: mode === "qpcr" && useExonSpanning
												? !seq || !!seqError || exonJunctionRunning
												: !seq || !!seqError || running
							}
							style={{
								fontFamily: "var(--font-karla)",
								fontSize: "13px",
								fontWeight: 500,
								padding: "11px 20px",
								background: (
									mode === "consensus"
										? !alignmentRaw.trim() || consRunning
										: mode === "multiplex"
											? !multiplexTargets.trim() || multiplexRunning
											: mode === "walking"
												? !seq || !!seqError || walkingRunning
												: mode === "qpcr" && useExonSpanning
													? !seq || !!seqError || exonJunctionRunning
													: !seq || !!seqError || running
								)
									? "#9a9284"
									: "#1a4731",
								color: "white",
								border: "none",
								borderRadius: "3px",
								cursor: (
									mode === "consensus"
										? !alignmentRaw.trim() || consRunning
										: mode === "multiplex"
											? !multiplexTargets.trim() || multiplexRunning
											: mode === "walking"
												? !seq || !!seqError || walkingRunning
												: mode === "qpcr" && useExonSpanning
													? !seq || !!seqError || exonJunctionRunning
													: !seq || !!seqError || running
								)
									? "not-allowed"
									: "pointer",
								transition: "background 0.15s",
								letterSpacing: "0.02em",
							}}
						>
							{mode === "consensus"
								? consRunning
									? "Designing…"
									: "Design Consensus Primers"
								: mode === "multiplex"
									? multiplexRunning
										? "Designing…"
										: "Design Multiplex Panel"
									: mode === "walking"
										? walkingRunning
											? "Designing…"
											: "Design Walking Primers"
										: mode === "qpcr" && useExonSpanning
											? exonJunctionRunning
												? "Designing…"
												: "Design Exon-Spanning Primers"
											: running
												? "Designing…"
												: "Design Primers"}
						</button>

						{/* Info note */}
						<p
							style={{
								fontFamily: "var(--font-courier)",
								fontSize: "9px",
								color: "#b8b0a4",
								lineHeight: 1.6,
								margin: 0,
							}}
						>
							Runs entirely in your browser — no sequence data is sent to a server.
						</p>
					</div>
				</div>

				{/* Right: results */}
				<div style={{ overflowY: "auto", background: "#f5f0e8" }}>
					{/* Empty state */}
					{!running &&
						!hasPairs &&
						!warning &&
						!error &&
						!walkingRunning &&
						!walkingResult &&
						!walkingError &&
						!consRunning &&
						!consResult &&
						!consError &&
						!exonJunctionRunning &&
						!exonJunctionResult &&
						!exonJunctionError &&
						!multiplexRunning &&
						!multiplexResult &&
						!multiplexError && (
							<div
								style={{
									display: "flex",
									flexDirection: "column",
									alignItems: "center",
									justifyContent: "center",
									height: "100%",
									minHeight: "400px",
									gap: "14px",
									padding: "40px",
								}}
							>
								<div
									style={{
										fontFamily: "var(--font-playfair)",
										fontSize: "52px",
										color: "#ddd8ce",
										lineHeight: 1,
										userSelect: "none",
									}}
								>
									→←
								</div>
								<p
									style={{
										fontFamily: "var(--font-karla)",
										fontSize: "14px",
										color: "#9a9284",
										textAlign: "center",
										maxWidth: "320px",
										lineHeight: 1.6,
									}}
								>
									Paste a DNA sequence and click Design Primers to get started.
								</p>
								<p
									style={{
										fontFamily: "var(--font-courier)",
										fontSize: "9px",
										color: "#b8b0a4",
										textAlign: "center",
										letterSpacing: "0.06em",
									}}
								>
									PCR · qPCR · Gibson · Golden Gate
								</p>
							</div>
						)}

					{/* Running spinner */}
					{running && (
						<div
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								height: "200px",
								gap: "10px",
							}}
						>
							<span
								style={{
									width: "16px",
									height: "16px",
									border: "2px solid #ddd8ce",
									borderTopColor: "#1a4731",
									borderRadius: "50%",
									display: "inline-block",
									animation: "spin 0.7s linear infinite",
								}}
							/>
							<span
								style={{ fontFamily: "var(--font-courier)", fontSize: "10px", color: "#9a9284" }}
							>
								Evaluating candidates…
							</span>
							<style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
						</div>
					)}

					{/* Error */}
					{error && (
						<div
							style={{
								margin: "24px",
								padding: "14px 16px",
								background: "rgba(160,40,40,0.06)",
								border: "1px solid rgba(160,40,40,0.2)",
								borderRadius: "3px",
								fontFamily: "var(--font-karla)",
								fontSize: "13px",
								color: "#a02828",
							}}
						>
							{error}
						</div>
					)}

					{/* Warning (no pairs found) */}
					{warning && !running && (
						<div
							style={{
								margin: "24px",
								padding: "14px 16px",
								background: "rgba(184,147,58,0.07)",
								border: "1px solid rgba(184,147,58,0.25)",
								borderRadius: "3px",
							}}
						>
							<div
								style={{
									fontFamily: "var(--font-courier)",
									fontSize: "9px",
									letterSpacing: "0.1em",
									color: "#b8933a",
									marginBottom: "5px",
								}}
							>
								NO PAIRS FOUND
							</div>
							<div
								style={{
									fontFamily: "var(--font-karla)",
									fontSize: "13px",
									color: "#5a5648",
									lineHeight: 1.6,
									marginBottom: "12px",
								}}
							>
								{warning}
							</div>
							{/* Quick-fix buttons for the most common failure mode */}
							{warning.includes("no compatible pairs") && (
								<div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
									<button
										type="button"
										onClick={() => {
											setMaxTmDiff((prev) => Math.min(prev + 1, 8));
											setRetryTrigger((n) => n + 1);
										}}
										style={{
											fontFamily: "var(--font-courier)",
											fontSize: "9px",
											letterSpacing: "0.06em",
											padding: "5px 10px",
											background: "rgba(184,147,58,0.12)",
											border: "1px solid rgba(184,147,58,0.35)",
											borderRadius: "3px",
											color: "#b8933a",
											cursor: "pointer",
										}}
									>
										Relax ΔTm (+1°)
									</button>
									{mode === "qpcr" && (
										<button
											type="button"
											onClick={() => {
												setQpcrAmpliconMax((prev) => Math.min(prev + 30, 500));
												setRetryTrigger((n) => n + 1);
											}}
											style={{
												fontFamily: "var(--font-courier)",
												fontSize: "9px",
												letterSpacing: "0.06em",
												padding: "5px 10px",
												background: "rgba(184,147,58,0.12)",
												border: "1px solid rgba(184,147,58,0.35)",
												borderRadius: "3px",
												color: "#b8933a",
												cursor: "pointer",
											}}
										>
											Widen amplicon (+30 bp)
										</button>
									)}
								</div>
							)}
						</div>
					)}

					{/* PCR / qPCR results */}
					{pairs && pairs.length > 0 && (
						<div>
							{/* Results header */}
							<div
								style={{
									padding: "14px 20px 10px",
									borderBottom: "1px solid #ddd8ce",
									display: "flex",
									alignItems: "center",
									gap: "10px",
								}}
							>
								<span
									style={{
										fontFamily: "var(--font-courier)",
										fontSize: "9px",
										letterSpacing: "0.12em",
										color: "#1a4731",
										textTransform: "uppercase",
									}}
								>
									{pairs.length} pair{pairs.length !== 1 ? "s" : ""}
								</span>
								<span
									style={{ fontFamily: "var(--font-courier)", fontSize: "9px", color: "#b8b0a4" }}
								>
									· click a pair to highlight in plots
								</span>
								<button
									type="button"
									onClick={() => downloadCsv(pairs, [], mode, polymerase)}
									style={{
										marginLeft: "auto",
										fontFamily: "var(--font-courier)",
										fontSize: "9px",
										letterSpacing: "0.06em",
										padding: "4px 10px",
										background: "none",
										border: "1px solid #ddd8ce",
										borderRadius: "3px",
										color: "#5a5648",
										cursor: "pointer",
									}}
								>
									↓ CSV
								</button>
							</div>

							{/* Pair cards */}
							<div style={{ borderBottom: "1px solid #ddd8ce" }}>
								{pairs.map((pair, i) => (
									<PairCard
										key={i}
										pair={pair}
										rank={i + 1}
										tmTarget={tmTarget}
										mode={mode}
										polymerase={polymerase}
										specResults={specResults}
										specState={specState}
										selected={selectedPair === i}
										onClick={() => setSelectedPair(i)}
									/>
								))}
							</div>

							{/* Plots section */}
							<div style={{ padding: "20px" }}>
								<div
									style={{
										fontFamily: "var(--font-courier)",
										fontSize: "9px",
										letterSpacing: "0.12em",
										color: "#9a9284",
										textTransform: "uppercase",
										marginBottom: "12px",
									}}
								>
									Plots
								</div>

								{/* Plot tabs */}
								<div
									style={{
										display: "flex",
										gap: "0",
										marginBottom: "16px",
										borderBottom: "1px solid #ddd8ce",
									}}
								>
									{(
										[
											["heatmap", "Amplicon Structure"],
											["scatter", "Pair Overview"],
											...(mode === "qpcr" ? [["melt", "Melt Curve"] as const] : []),
										] as [PlotTab, string][]
									).map(([tab, label]) => (
										<button
											key={tab}
											type="button"
											onClick={() => setActivePlot(tab)}
											style={{
												fontFamily: "var(--font-courier)",
												fontSize: "9px",
												letterSpacing: "0.08em",
												textTransform: "uppercase",
												padding: "7px 14px",
												background: "none",
												border: "none",
												borderBottom:
													activePlot === tab ? "2px solid #1a4731" : "2px solid transparent",
												color: activePlot === tab ? "#1a4731" : "#9a9284",
												cursor: "pointer",
												marginBottom: "-1px",
												transition: "color 0.15s",
											}}
										>
											{label}
										</button>
									))}
								</div>

								{/* Plot canvases */}
								<div
									style={{
										background: "#faf7f2",
										borderRadius: "3px",
										border: "1px solid #ddd8ce",
										padding: "12px",
										display: "inline-block",
									}}
								>
									{activePlot === "heatmap" && currentPair && (
										<AmpliconHeatmap pair={currentPair} seq={seq} temperature={tmTarget - 5} />
									)}
									{activePlot === "scatter" && (
										<PairScatter pairs={pairs} mode={mode === "qpcr" ? "qpcr" : "pcr"} />
									)}
									{activePlot === "melt" && mode === "qpcr" && (
										<MeltCurve pairs={pairs} seq={seq} highlightIndex={selectedPair} />
									)}
								</div>
							</div>
						</div>
					)}

					{/* Assembly results */}
					{assemblyPairs && assemblyPairs.length > 0 && (
						<div>
							<div
								style={{
									padding: "14px 20px 10px",
									borderBottom: "1px solid #ddd8ce",
									display: "flex",
									alignItems: "center",
									gap: "10px",
								}}
							>
								<span
									style={{
										fontFamily: "var(--font-courier)",
										fontSize: "9px",
										letterSpacing: "0.12em",
										color: "#1a4731",
										textTransform: "uppercase",
									}}
								>
									{assemblyPairs.length} pair{assemblyPairs.length !== 1 ? "s" : ""}
								</span>
								<span
									style={{ fontFamily: "var(--font-courier)", fontSize: "9px", color: "#b8b0a4" }}
								>
									·{" "}
									{assemblyMethod === "gibson"
										? `${gibsonOverlap}bp Gibson overlap`
										: `${ggEnzyme} Golden Gate`}
								</span>
								<button
									type="button"
									onClick={() => downloadCsv([], assemblyPairs, mode, polymerase)}
									style={{
										marginLeft: "auto",
										fontFamily: "var(--font-courier)",
										fontSize: "9px",
										letterSpacing: "0.06em",
										padding: "4px 10px",
										background: "none",
										border: "1px solid #ddd8ce",
										borderRadius: "3px",
										color: "#5a5648",
										cursor: "pointer",
									}}
								>
									↓ CSV
								</button>
							</div>
							{assemblyPairs.map((pair, i) => (
								<AssemblyPairCard
									key={i}
									pair={pair}
									rank={i + 1}
									selected={assemblySelectedPair === i}
									onClick={() => setAssemblySelectedPair(i)}
								/>
							))}

							{/* Assembly plots — inside the outer div */}
							{assemblyPairs[assemblySelectedPair] && (
								<AssemblyPlots
									pair={assemblyPairs[assemblySelectedPair]!}
									allPairs={assemblyPairs}
									seq={seq}
									tmTarget={tmTarget}
									activePlot={assemblyActivePlot}
									onTabChange={setAssemblyActivePlot}
								/>
							)}
						</div>
					)}

					{/* Walking / Sanger coverage results */}
					{walkingRunning && (
						<div
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								height: "200px",
								gap: "10px",
							}}
						>
							<span
								style={{
									width: "16px",
									height: "16px",
									border: "2px solid #ddd8ce",
									borderTopColor: "#1a4731",
									borderRadius: "50%",
									display: "inline-block",
									animation: "spin 0.7s linear infinite",
								}}
							/>
							<span
								style={{ fontFamily: "var(--font-courier)", fontSize: "10px", color: "#9a9284" }}
							>
								Designing walking primers…
							</span>
						</div>
					)}
					{walkingError && (
						<div
							style={{
								margin: "24px",
								padding: "14px 16px",
								background: "rgba(160,40,40,0.06)",
								border: "1px solid rgba(160,40,40,0.2)",
								borderRadius: "3px",
								fontFamily: "var(--font-karla)",
								fontSize: "13px",
								color: "#a02828",
							}}
						>
							{walkingError}
						</div>
					)}
					{walkingResult && (
						<div>
							{/* Header */}
							<div
								style={{
									padding: "14px 20px 10px",
									borderBottom: "1px solid #ddd8ce",
									display: "flex",
									alignItems: "center",
									gap: "10px",
								}}
							>
								<span
									style={{
										fontFamily: "var(--font-courier)",
										fontSize: "9px",
										letterSpacing: "0.12em",
										color: "#1a4731",
										textTransform: "uppercase",
									}}
								>
									{walkingResult.primers.length} primers
								</span>
								<span
									style={{ fontFamily: "var(--font-courier)", fontSize: "9px", color: "#b8b0a4" }}
								>
									·{" "}
									{walkingResult.gaps.length === 0
										? "✓ complete coverage"
										: `${walkingResult.gaps.length} gap${walkingResult.gaps.length > 1 ? "s" : ""} — increase overlap`}
								</span>
								<button
									type="button"
									onClick={() => {
										const rows = ["Name,Sequence,Position,Direction,Tm,Ta,Notes"];
										for (const [i, p] of walkingResult.primers.entries()) {
											const ta = computeTa(p.tm, polymerase).toFixed(0);
											rows.push(
												`Walk${i + 1}_${p.direction === "fwd" ? "Fwd" : "Rev"},${p.seq},${p.position + 1},${p.direction},${p.tm.toFixed(1)},${ta},"read ${p.position + 1}-${p.readEnd}"`,
											);
										}
										const blob = new Blob([rows.join("\n")], { type: "text/csv" });
										const url = URL.createObjectURL(blob);
										const a = document.createElement("a");
										a.href = url;
										a.download = "walking-primers.csv";
										a.click();
										URL.revokeObjectURL(url);
									}}
									style={{
										marginLeft: "auto",
										fontFamily: "var(--font-courier)",
										fontSize: "9px",
										letterSpacing: "0.06em",
										padding: "4px 10px",
										background: "none",
										border: "1px solid #ddd8ce",
										borderRadius: "3px",
										color: "#5a5648",
										cursor: "pointer",
									}}
								>
									↓ CSV
								</button>
							</div>

							{/* Coverage map */}
							<div style={{ padding: "16px 20px" }}>
								<div
									style={{
										fontFamily: "var(--font-courier)",
										fontSize: "9px",
										letterSpacing: "0.12em",
										color: "#9a9284",
										textTransform: "uppercase",
										marginBottom: "10px",
									}}
								>
									Coverage map
								</div>
								<CoverageMap
									result={walkingResult}
									selectedIdx={walkSelectedIdx}
									onSelectPrimer={setWalkSelectedIdx}
								/>
							</div>

							{/* Primer table */}
							<div style={{ borderTop: "1px solid #ddd8ce" }}>
								{walkingResult.primers.map((primer, i) => {
									const isSelected = walkSelectedIdx === i;
									const ta = computeTa(primer.tm, polymerase);
									const [copied, setCopied] = [false, () => {}]; // handled inline
									return (
										<div
											key={i}
											onClick={() => setWalkSelectedIdx(i)}
											style={{
												padding: "10px 14px",
												borderBottom: "1px solid rgba(221,216,206,0.5)",
												background: isSelected ? "rgba(26,71,49,0.07)" : "transparent",
												borderLeft: isSelected ? "3px solid #1a4731" : "3px solid transparent",
												cursor: "pointer",
											}}
										>
											<div
												style={{
													display: "flex",
													alignItems: "center",
													gap: "6px",
													marginBottom: "5px",
													flexWrap: "wrap",
												}}
											>
												<span
													style={{
														fontFamily: "var(--font-courier)",
														fontSize: "9px",
														color: isSelected ? "#1a4731" : "#9a9284",
														fontWeight: isSelected ? 700 : 400,
													}}
												>
													#{i + 1}
												</span>
												<span
													style={{
														fontFamily: "var(--font-courier)",
														fontSize: "9px",
														color: "#5a5648",
													}}
												>
													pos {primer.position + 1}
												</span>
												<span style={{ color: "#ddd8ce" }}>·</span>
												<span
													style={{
														fontFamily: "var(--font-courier)",
														fontSize: "9px",
														color: "#5a5648",
													}}
												>
													Tm {primer.tm.toFixed(1)}°
												</span>
												<span style={{ color: "#ddd8ce" }}>·</span>
												<span
													style={{
														fontFamily: "var(--font-courier)",
														fontSize: "9px",
														color: "#1a4731",
														fontWeight: 600,
													}}
												>
													Ta {ta.toFixed(0)}°C
												</span>
												<span
													style={{
														fontFamily: "var(--font-courier)",
														fontSize: "8px",
														color: "#b8b0a4",
													}}
												>
													read → {primer.readEnd}
												</span>
												<button
													type="button"
													onClick={(e) => {
														e.stopPropagation();
														void navigator.clipboard.writeText(primer.seq);
													}}
													style={{
														marginLeft: "auto",
														background: "none",
														border: "none",
														cursor: "pointer",
														fontFamily: "var(--font-courier)",
														fontSize: "9px",
														color: "#9a9284",
													}}
												>
													copy
												</button>
											</div>
											<div
												style={{
													fontFamily: "var(--font-courier)",
													fontSize: "10px",
													color: "#1c1a16",
													letterSpacing: "0.04em",
													overflow: "hidden",
													whiteSpace: "nowrap",
													textOverflow: "ellipsis",
												}}
											>
												{primer.direction === "fwd" ? "→ " : "← "}
												{primer.seq}
											</div>
											{specState !== "idle" && (
												<div style={{ display: "flex", gap: "10px", marginTop: "4px" }}>
													<SpecBadge
														label={primer.direction === "fwd" ? "Fwd" : "Rev"}
														hits={specResults?.get(primer.seq)}
														loading={specState === "loading"}
													/>
												</div>
											)}
										</div>
									);
								})}
							</div>
						</div>
					)}

					{/* Conservation / consensus results */}
					{consRunning && (
						<div
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								height: "200px",
								gap: "10px",
							}}
						>
							<span
								style={{
									width: "16px",
									height: "16px",
									border: "2px solid #ddd8ce",
									borderTopColor: "#1a4731",
									borderRadius: "50%",
									display: "inline-block",
									animation: "spin 0.7s linear infinite",
								}}
							/>
							<span
								style={{ fontFamily: "var(--font-courier)", fontSize: "10px", color: "#9a9284" }}
							>
								Scanning alignment…
							</span>
						</div>
					)}
					{consError && (
						<div
							style={{
								margin: "24px",
								padding: "14px 16px",
								background: "rgba(160,40,40,0.06)",
								border: "1px solid rgba(160,40,40,0.2)",
								borderRadius: "3px",
								fontFamily: "var(--font-karla)",
								fontSize: "13px",
								color: "#a02828",
							}}
						>
							{consError}
						</div>
					)}
					{consResult && (
						<div>
							{/* Header */}
							<div
								style={{
									padding: "14px 20px 10px",
									borderBottom: "1px solid #ddd8ce",
									display: "flex",
									alignItems: "center",
									gap: "10px",
								}}
							>
								<span
									style={{
										fontFamily: "var(--font-courier)",
										fontSize: "9px",
										letterSpacing: "0.12em",
										color: "#1a4731",
										textTransform: "uppercase",
									}}
								>
									{consResult.primers.length} primers
								</span>
								<span
									style={{ fontFamily: "var(--font-courier)", fontSize: "9px", color: "#b8b0a4" }}
								>
									· {consResult.sequences.length} sequences · {consResult.alignmentLen} bp alignment
								</span>
								{consResult.warning && (
									<span
										style={{ fontFamily: "var(--font-courier)", fontSize: "9px", color: "#b8933a" }}
									>
										⚠ {consResult.warning}
									</span>
								)}
								<button
									type="button"
									onClick={() => {
										const rows = [
											"Name,Sequence,Position,Direction,Tm,Ta,Conservation,Degenerate,Notes",
										];
										for (const [i, p] of consResult.primers.entries()) {
											const ta = computeTa(p.tm, polymerase).toFixed(0);
											const mmNote = p.mismatches
												.map((m) => `${m.count}mm:${m.nSeqs}seqs`)
												.join(" ");
											rows.push(
												`Cons${i + 1}_${p.direction === "fwd" ? "Fwd" : "Rev"},${p.seq},${p.alignPos + 1},${p.direction},${p.tm.toFixed(1)},${ta},${(p.conservation * 100).toFixed(0)}%,${p.numDegenerate},"${mmNote}"`,
											);
										}
										const blob = new Blob([rows.join("\n")], { type: "text/csv" });
										const url = URL.createObjectURL(blob);
										const a = document.createElement("a");
										a.href = url;
										a.download = "consensus-primers.csv";
										a.click();
										URL.revokeObjectURL(url);
									}}
									style={{
										marginLeft: "auto",
										fontFamily: "var(--font-courier)",
										fontSize: "9px",
										letterSpacing: "0.06em",
										padding: "4px 10px",
										background: "none",
										border: "1px solid #ddd8ce",
										borderRadius: "3px",
										color: "#5a5648",
										cursor: "pointer",
									}}
								>
									↓ CSV
								</button>
							</div>

							{/* Conservation track */}
							<div style={{ padding: "16px 20px" }}>
								<div
									style={{
										fontFamily: "var(--font-courier)",
										fontSize: "9px",
										letterSpacing: "0.12em",
										color: "#9a9284",
										textTransform: "uppercase",
										marginBottom: "10px",
									}}
								>
									Conservation track
								</div>
								<ConservationTrack
									result={consResult}
									selectedIdx={consSelectedIdx}
									threshold={consThreshold}
								/>
							</div>

							{/* Primer cards */}
							<div style={{ borderTop: "1px solid #ddd8ce" }}>
								{consResult.primers.map((primer, i) => {
									const isSelected = consSelectedIdx === i;
									const ta = computeTa(primer.tm, polymerase);
									const color = primer.direction === "fwd" ? "#0891b2" : "#b45309";
									const mm0 = primer.mismatches.find((m) => m.count === 0);
									const mmNote = mm0
										? `${mm0.nSeqs}/${consResult.sequences.length} seqs: perfect match`
										: `best: ${primer.mismatches[0]?.count ?? "?"} mm in ${primer.mismatches[0]?.nSeqs ?? "?"} seqs`;
									return (
										<div
											key={i}
											onClick={() => setConsSelectedIdx(i)}
											style={{
												padding: "10px 14px",
												borderBottom: "1px solid rgba(221,216,206,0.5)",
												background: isSelected ? "rgba(26,71,49,0.07)" : "transparent",
												borderLeft: isSelected ? "3px solid #1a4731" : "3px solid transparent",
												cursor: "pointer",
											}}
										>
											<div
												style={{
													display: "flex",
													alignItems: "center",
													gap: "6px",
													marginBottom: "5px",
													flexWrap: "wrap",
												}}
											>
												<span
													style={{
														fontFamily: "var(--font-courier)",
														fontSize: "9px",
														color: isSelected ? "#1a4731" : "#9a9284",
														fontWeight: isSelected ? 700 : 400,
													}}
												>
													#{i + 1}
												</span>
												<span
													style={{
														fontFamily: "var(--font-courier)",
														fontSize: "9px",
														color: "#5a5648",
													}}
												>
													pos {primer.alignPos + 1}
												</span>
												<span style={{ color: "#ddd8ce" }}>·</span>
												<span
													style={{
														fontFamily: "var(--font-courier)",
														fontSize: "9px",
														color: "#1a4731",
														fontWeight: 600,
													}}
												>
													{(primer.conservation * 100).toFixed(0)}% conserved
												</span>
												<span style={{ color: "#ddd8ce" }}>·</span>
												<span
													style={{
														fontFamily: "var(--font-courier)",
														fontSize: "9px",
														color: "#9a9284",
													}}
												>
													Tm {primer.tm.toFixed(1)}°
												</span>
												<span style={{ color: "#ddd8ce" }}>·</span>
												<span
													style={{
														fontFamily: "var(--font-courier)",
														fontSize: "9px",
														color: "#1a4731",
														fontWeight: 600,
													}}
												>
													Ta {ta.toFixed(0)}°C
												</span>
												{primer.numDegenerate > 0 && (
													<span
														style={{
															fontFamily: "var(--font-courier)",
															fontSize: "8px",
															color: "#b8933a",
														}}
													>
														{primer.numDegenerate} deg
													</span>
												)}
												<span
													style={{
														fontFamily: "var(--font-courier)",
														fontSize: "8px",
														color: "#b8b0a4",
													}}
												>
													{mmNote}
												</span>
												<button
													type="button"
													onClick={(ev) => {
														ev.stopPropagation();
														void navigator.clipboard.writeText(primer.seq);
													}}
													style={{
														marginLeft: "auto",
														background: "none",
														border: "none",
														cursor: "pointer",
														fontFamily: "var(--font-courier)",
														fontSize: "9px",
														color: "#9a9284",
													}}
												>
													copy
												</button>
											</div>
											<div
												style={{
													fontFamily: "var(--font-courier)",
													fontSize: "10px",
													color,
													letterSpacing: "0.04em",
													overflow: "hidden",
													whiteSpace: "nowrap",
													textOverflow: "ellipsis",
												}}
											>
												{primer.direction === "fwd" ? "→ " : "← "}
												{primer.seq}
											</div>
										</div>
									);
								})}
							</div>
						</div>
					)}

					{/* Exon-junction qPCR results */}
					{exonJunctionRunning && (
						<div
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								height: "200px",
								gap: "10px",
							}}
						>
							<span
								style={{
									width: "16px",
									height: "16px",
									border: "2px solid #ddd8ce",
									borderTopColor: "#1a4731",
									borderRadius: "50%",
									display: "inline-block",
									animation: "spin 0.7s linear infinite",
								}}
							/>
							<span
								style={{ fontFamily: "var(--font-courier)", fontSize: "10px", color: "#9a9284" }}
							>
								Designing exon-spanning primers…
							</span>
						</div>
					)}
					{exonJunctionError && (
						<div
							style={{
								margin: "24px",
								padding: "14px 16px",
								background: "rgba(160,40,40,0.06)",
								border: "1px solid rgba(160,40,40,0.2)",
								borderRadius: "3px",
								fontFamily: "var(--font-karla)",
								fontSize: "13px",
								color: "#a02828",
							}}
						>
							{exonJunctionError}
						</div>
					)}
					{exonJunctionResult && (
						<div>
							<div
								style={{
									padding: "14px 20px 10px",
									borderBottom: "1px solid #ddd8ce",
									display: "flex",
									alignItems: "center",
									gap: "10px",
								}}
							>
								<span
									style={{
										fontFamily: "var(--font-courier)",
										fontSize: "9px",
										letterSpacing: "0.12em",
										color: "#1a4731",
										textTransform: "uppercase",
									}}
								>
									{exonJunctionResult.pairs.length} exon-spanning pairs
								</span>
								<span
									style={{ fontFamily: "var(--font-courier)", fontSize: "9px", color: "#b8b0a4" }}
								>
									· gDNA-specific
								</span>
								<button
									type="button"
									onClick={() => {
										const rows = [
											"Name,Sequence,Type,Position,Tm,Ta,Junction,Upstream,Downstream,ProductSize",
										];
										for (const [i, pair] of exonJunctionResult.pairs.entries()) {
											const ta = computeTa(pair.fwd.tm, polymerase).toFixed(0);
											const taRev = computeTa(pair.rev.tm, polymerase).toFixed(0);
											rows.push(
												`Pair${i + 1}_Fwd,${pair.fwd.seq},spanning,${pair.fwd.start + 1},${pair.fwd.tm.toFixed(1)},${ta},${pair.fwd.junctionPos + 1},${pair.fwd.upstreamBases}bp,${pair.fwd.downstreamBases}bp,${pair.productSize}`,
											);
											rows.push(
												`Pair${i + 1}_Rev,${pair.rev.seq},normal,${pair.rev.start + 1},${pair.rev.tm.toFixed(1)},${taRev},,,, ${pair.productSize}bp amplicon`,
											);
										}
										const blob = new Blob([rows.join("\n")], { type: "text/csv" });
										const url = URL.createObjectURL(blob);
										const a = document.createElement("a");
										a.href = url;
										a.download = "exon-junction-primers.csv";
										a.click();
										URL.revokeObjectURL(url);
									}}
									style={{
										marginLeft: "auto",
										fontFamily: "var(--font-courier)",
										fontSize: "9px",
										letterSpacing: "0.06em",
										padding: "4px 10px",
										background: "none",
										border: "1px solid #ddd8ce",
										borderRadius: "3px",
										color: "#5a5648",
										cursor: "pointer",
									}}
								>
									↓ CSV
								</button>
							</div>
							{exonJunctionResult.warning && (
								<div
									style={{
										margin: "24px",
										padding: "14px 16px",
										background: "rgba(184,147,58,0.07)",
										border: "1px solid rgba(184,147,58,0.25)",
										borderRadius: "3px",
									}}
								>
									<div
										style={{
											fontFamily: "var(--font-courier)",
											fontSize: "9px",
											letterSpacing: "0.1em",
											color: "#b8933a",
											marginBottom: "5px",
										}}
									>
										NO PAIRS FOUND
									</div>
									<div
										style={{
											fontFamily: "var(--font-karla)",
											fontSize: "13px",
											color: "#5a5648",
											lineHeight: 1.6,
										}}
									>
										{exonJunctionResult.warning}
									</div>
								</div>
							)}
							{exonJunctionResult.pairs.map((pair, i) => {
								const ta = computeTa(pair.fwd.tm, polymerase);
								const taRev = computeTa(pair.rev.tm, polymerase);
								return (
									<div
										key={i}
										style={{
											padding: "14px 20px",
											borderBottom: "1px solid rgba(221,216,206,0.5)",
											background: i === 0 ? "rgba(26,71,49,0.03)" : "transparent",
										}}
									>
										<div
											style={{
												display: "flex",
												alignItems: "center",
												gap: "6px",
												marginBottom: "10px",
												flexWrap: "wrap",
											}}
										>
											<span
												style={{
													fontFamily: "var(--font-courier)",
													fontSize: "9px",
													color: i === 0 ? "#1a4731" : "#9a9284",
													fontWeight: i === 0 ? 700 : 400,
												}}
											>
												#{i + 1}
											</span>
											<span
												style={{
													fontFamily: "var(--font-courier)",
													fontSize: "9px",
													color: "#5a5648",
												}}
											>
												{pair.productSize} bp amplicon
											</span>
											<span style={{ color: "#ddd8ce" }}>·</span>
											<span
												style={{
													fontFamily: "var(--font-courier)",
													fontSize: "9px",
													color: pair.tmDiff > 2 ? "#b8933a" : "#9a9284",
												}}
											>
												ΔTm {pair.tmDiff.toFixed(1)}°
											</span>
											<button
												type="button"
												onClick={() =>
													void navigator.clipboard.writeText(
														`Fwd: ${pair.fwd.seq}\nRev: ${pair.rev.seq}`,
													)
												}
												style={{
													marginLeft: "auto",
													background: "none",
													border: "none",
													cursor: "pointer",
													fontFamily: "var(--font-courier)",
													fontSize: "9px",
													color: "#9a9284",
												}}
											>
												copy pair
											</button>
										</div>
										{/* Forward spanning primer */}
										<div
											style={{
												marginBottom: "8px",
												padding: "8px 10px",
												background: "rgba(8,145,178,0.05)",
												border: "1px solid rgba(8,145,178,0.2)",
												borderRadius: "3px",
											}}
										>
											<div
												style={{
													display: "flex",
													alignItems: "center",
													gap: "6px",
													marginBottom: "5px",
													flexWrap: "wrap",
												}}
											>
												<span
													style={{
														fontFamily: "var(--font-courier)",
														fontSize: "8px",
														color: "#0891b2",
														fontWeight: 700,
														letterSpacing: "0.06em",
													}}
												>
													FWD · SPANS JUNCTION
												</span>
												<span
													style={{
														fontFamily: "var(--font-courier)",
														fontSize: "8px",
														color: "#5a5648",
													}}
												>
													junction pos {pair.fwd.junctionPos + 1}
												</span>
												<span
													style={{
														fontFamily: "var(--font-courier)",
														fontSize: "8px",
														color: "#9a9284",
													}}
												>
													{pair.fwd.upstreamBases}bp ← | → {pair.fwd.downstreamBases}bp
												</span>
												<span
													style={{
														fontFamily: "var(--font-courier)",
														fontSize: "8px",
														color: "#1a4731",
														fontWeight: 600,
													}}
												>
													Tm {pair.fwd.tm.toFixed(1)}° · Ta {ta.toFixed(0)}°C
												</span>
											</div>
											{/* Junction visualisation: color-coded upstream|downstream split */}
											<div
												style={{
													fontFamily: "var(--font-courier)",
													fontSize: "10px",
													letterSpacing: "0.04em",
													cursor: "pointer",
												}}
												onClick={() => void navigator.clipboard.writeText(pair.fwd.seq)}
												title="Click to copy"
											>
												<span style={{ color: "#5a5648" }}>
													{pair.fwd.seq.slice(0, pair.fwd.upstreamBases)}
												</span>
												<span style={{ color: "#b8b0a4", fontSize: "9px" }}>┃</span>
												<span style={{ color: "#0891b2", fontWeight: 600 }}>
													{pair.fwd.seq.slice(pair.fwd.upstreamBases)}
												</span>
											</div>
											<div
												style={{
													fontFamily: "var(--font-courier)",
													fontSize: "8px",
													color: "#9a9284",
													marginTop: "3px",
												}}
											>
												gray = exon N · blue = exon N+1 (3′ end) · click to copy
											</div>
											{specState !== "idle" && (
												<div style={{ marginTop: "4px" }}>
													<SpecBadge
														label="Fwd"
														hits={specResults?.get(pair.fwd.seq)}
														loading={specState === "loading"}
													/>
												</div>
											)}
										</div>
										{/* Reverse primer */}
										<div
											style={{
												padding: "8px 10px",
												background: "rgba(180,83,9,0.04)",
												border: "1px solid rgba(180,83,9,0.15)",
												borderRadius: "3px",
											}}
										>
											<div
												style={{
													display: "flex",
													alignItems: "center",
													gap: "6px",
													marginBottom: "4px",
													flexWrap: "wrap",
												}}
											>
												<span
													style={{
														fontFamily: "var(--font-courier)",
														fontSize: "8px",
														color: "#b45309",
														fontWeight: 700,
														letterSpacing: "0.06em",
													}}
												>
													REV
												</span>
												<span
													style={{
														fontFamily: "var(--font-courier)",
														fontSize: "8px",
														color: "#9a9284",
													}}
												>
													pos {pair.rev.start + 1} · Tm {pair.rev.tm.toFixed(1)}° · Ta{" "}
													{taRev.toFixed(0)}°C
												</span>
											</div>
											<div
												style={{
													fontFamily: "var(--font-courier)",
													fontSize: "10px",
													color: "#b45309",
													letterSpacing: "0.04em",
													cursor: "pointer",
												}}
												onClick={() => void navigator.clipboard.writeText(pair.rev.seq)}
												title="Click to copy"
											>
												{pair.rev.seq}
											</div>
											{specState !== "idle" && (
												<div style={{ marginTop: "4px" }}>
													<SpecBadge
														label="Rev"
														hits={specResults?.get(pair.rev.seq)}
														loading={specState === "loading"}
													/>
												</div>
											)}
										</div>
									</div>
								);
							})}
						</div>
					)}

					{/* Multiplex results */}
					{multiplexRunning && (
						<div
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								height: "200px",
								gap: "10px",
							}}
						>
							<span
								style={{
									width: "16px",
									height: "16px",
									border: "2px solid #ddd8ce",
									borderTopColor: "#1a4731",
									borderRadius: "50%",
									display: "inline-block",
									animation: "spin 0.7s linear infinite",
								}}
							/>
							<span
								style={{ fontFamily: "var(--font-courier)", fontSize: "10px", color: "#9a9284" }}
							>
								Designing multiplex panel…
							</span>
						</div>
					)}
					{multiplexError && (
						<div
							style={{
								margin: "24px",
								padding: "14px 16px",
								background: "rgba(160,40,40,0.06)",
								border: "1px solid rgba(160,40,40,0.2)",
								borderRadius: "3px",
								fontFamily: "var(--font-karla)",
								fontSize: "13px",
								color: "#a02828",
							}}
						>
							{multiplexError}
						</div>
					)}
					{multiplexResult && (
						<div>
							<div
								style={{
									padding: "14px 20px 10px",
									borderBottom: "1px solid #ddd8ce",
									display: "flex",
									alignItems: "center",
									gap: "10px",
									flexWrap: "wrap",
								}}
							>
								<span
									style={{
										fontFamily: "var(--font-courier)",
										fontSize: "9px",
										letterSpacing: "0.12em",
										color: "#1a4731",
										textTransform: "uppercase",
									}}
								>
									{multiplexResult.pairs.filter((p) => p.pair).length}/
									{multiplexResult.pairs.length} targets designed
								</span>
								{multiplexResult.compatibleSet.length >= 2 && (
									<span
										style={{ fontFamily: "var(--font-courier)", fontSize: "9px", color: "#1a4731" }}
									>
										· compatible set:{" "}
										{multiplexResult.compatibleSet
											.map((i) => multiplexResult.pairs[i]?.targetName)
											.join(", ")}
									</span>
								)}
								<button
									type="button"
									onClick={() => {
										const rows = [
											"Target,Fwd,Tm_fwd,Rev,Tm_rev,Ta,ProductSize,AvgTm,Compatible_with",
										];
										for (const p of multiplexResult.pairs) {
											if (!p.pair) continue;
											const ta = computeTa(p.avgTm, polymerase).toFixed(0);
											const compatWith = multiplexResult.compatibleSet.includes(p.targetIdx)
												? multiplexResult.compatibleSet
														.filter((j) => j !== p.targetIdx)
														.map((j) => multiplexResult.pairs[j]?.targetName)
														.join("|")
												: "";
											rows.push(
												`${p.targetName},${p.pair.fwd.seq},${p.pair.fwd.tm.toFixed(1)},${p.pair.rev.seq},${p.pair.rev.tm.toFixed(1)},${ta},${p.pair.productSize},${p.avgTm.toFixed(1)},${compatWith}`,
											);
										}
										const blob = new Blob([rows.join("\n")], { type: "text/csv" });
										const url = URL.createObjectURL(blob);
										const a = document.createElement("a");
										a.href = url;
										a.download = "multiplex-panel.csv";
										a.click();
										URL.revokeObjectURL(url);
									}}
									style={{
										marginLeft: "auto",
										fontFamily: "var(--font-courier)",
										fontSize: "9px",
										letterSpacing: "0.06em",
										padding: "4px 10px",
										background: "none",
										border: "1px solid #ddd8ce",
										borderRadius: "3px",
										color: "#5a5648",
										cursor: "pointer",
									}}
								>
									↓ CSV
								</button>
							</div>
							<div style={{ padding: "16px 20px" }}>
								<div
									style={{
										fontFamily: "var(--font-courier)",
										fontSize: "9px",
										letterSpacing: "0.12em",
										color: "#9a9284",
										textTransform: "uppercase",
										marginBottom: "10px",
									}}
								>
									Compatibility matrix
								</div>
								<div
									style={{
										fontFamily: "var(--font-courier)",
										fontSize: "8px",
										color: "#9a9284",
										marginBottom: "8px",
										display: "flex",
										gap: "14px",
									}}
								>
									<span>
										<span style={{ color: "#1a4731" }}>✓</span> compatible
									</span>
									<span>
										<span style={{ color: "#b8933a" }}>~</span> borderline
									</span>
									<span>
										<span style={{ color: "#a02828" }}>✗</span> incompatible
									</span>
								</div>
								<MultiplexMatrix result={multiplexResult} />
							</div>
							<div style={{ borderTop: "1px solid #ddd8ce" }}>
								{multiplexResult.pairs.map((p, i) => {
									if (!p.pair) {
										return (
											<div
												key={i}
												style={{
													padding: "10px 20px",
													borderBottom: "1px solid rgba(221,216,206,0.5)",
													opacity: 0.5,
												}}
											>
												<span
													style={{
														fontFamily: "var(--font-courier)",
														fontSize: "9px",
														color: "#9a9284",
													}}
												>
													{p.targetName} — {p.warning ?? "no pair"}
												</span>
											</div>
										);
									}
									const ta = computeTa(p.avgTm, polymerase);
									const inSet = multiplexResult.compatibleSet.includes(i);
									return (
										<div
											key={i}
											style={{
												padding: "10px 14px",
												borderBottom: "1px solid rgba(221,216,206,0.5)",
												borderLeft: inSet ? "3px solid #1a4731" : "3px solid transparent",
												background: inSet ? "rgba(26,71,49,0.03)" : "transparent",
											}}
										>
											<div
												style={{
													display: "flex",
													alignItems: "center",
													gap: "6px",
													marginBottom: "5px",
													flexWrap: "wrap",
												}}
											>
												<span
													style={{
														fontFamily: "var(--font-courier)",
														fontSize: "9px",
														color: inSet ? "#1a4731" : "#9a9284",
														fontWeight: inSet ? 700 : 400,
													}}
												>
													{p.targetName}
												</span>
												{inSet && (
													<span
														style={{
															fontFamily: "var(--font-courier)",
															fontSize: "8px",
															color: "#1a4731",
															border: "1px solid rgba(26,71,49,0.3)",
															borderRadius: "2px",
															padding: "1px 5px",
														}}
													>
														panel
													</span>
												)}
												<span
													style={{
														fontFamily: "var(--font-courier)",
														fontSize: "9px",
														color: "#5a5648",
													}}
												>
													{p.pair.productSize} bp
												</span>
												<span style={{ color: "#ddd8ce" }}>·</span>
												<span
													style={{
														fontFamily: "var(--font-courier)",
														fontSize: "9px",
														color: "#9a9284",
													}}
												>
													avg Tm {p.avgTm.toFixed(1)}°
												</span>
												<span style={{ color: "#ddd8ce" }}>·</span>
												<span
													style={{
														fontFamily: "var(--font-courier)",
														fontSize: "9px",
														color: "#1a4731",
														fontWeight: 600,
													}}
												>
													Ta {ta.toFixed(0)}°C
												</span>
												<button
													type="button"
													onClick={() =>
														void navigator.clipboard.writeText(
															`Fwd: ${p.pair!.fwd.seq}\nRev: ${p.pair!.rev.seq}`,
														)
													}
													style={{
														marginLeft: "auto",
														background: "none",
														border: "none",
														cursor: "pointer",
														fontFamily: "var(--font-courier)",
														fontSize: "9px",
														color: "#9a9284",
													}}
												>
													copy
												</button>
											</div>
											<div
												style={{
													fontFamily: "var(--font-courier)",
													fontSize: "10px",
													color: "#1c1a16",
													letterSpacing: "0.04em",
													overflow: "hidden",
													whiteSpace: "nowrap",
													textOverflow: "ellipsis",
													cursor: "pointer",
												}}
												onClick={() => void navigator.clipboard.writeText(p.pair!.fwd.seq)}
											>
												→ {p.pair.fwd.seq}
											</div>
											<div
												style={{
													fontFamily: "var(--font-courier)",
													fontSize: "10px",
													color: "#1c1a16",
													letterSpacing: "0.04em",
													overflow: "hidden",
													whiteSpace: "nowrap",
													textOverflow: "ellipsis",
													cursor: "pointer",
													marginTop: "2px",
												}}
												onClick={() => void navigator.clipboard.writeText(p.pair!.rev.seq)}
											>
												← {p.pair.rev.seq}
											</div>
											{specState !== "idle" && (
												<div style={{ display: "flex", gap: "10px", marginTop: "5px" }}>
													<SpecBadge
														label="Fwd"
														hits={specResults?.get(p.pair.fwd.seq)}
														loading={specState === "loading"}
													/>
													<SpecBadge
														label="Rev"
														hits={specResults?.get(p.pair.rev.seq)}
														loading={specState === "loading"}
													/>
												</div>
											)}
										</div>
									);
								})}
							</div>

							{/* Multiplex melt curve — all amplicons overlaid */}
							{multiplexResult.pairs.some((p) => p.ampliconTm !== undefined) && (
								<MultiplexMeltCurve pairs={multiplexResult.pairs} />
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
