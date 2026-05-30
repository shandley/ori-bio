"use client";

import { useEffect, useRef } from "react";
import {
	type Codon,
	computeExtinctionCoefficient,
	computeGRAVY,
	computePI,
	estimateMW,
	extractCDS,
	translate,
	translateCodons,
} from "@/lib/bio/translate";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TranslationTarget {
	name: string;
	start: number;
	end: number;
	direction: 1 | -1;
	type: string;
}

interface TranslationViewProps {
	seq: string;
	target: TranslationTarget;
	onClose: () => void;
	onDesignPrimers?: () => void;
}

// ── Colors by AA category ─────────────────────────────────────────────────────

const CAT_COLORS = {
	start: { bg: "#1a4731", fg: "#ffffff" },
	stop: { bg: "#dc2626", fg: "#ffffff" },
	hydrophobic: { bg: "rgba(184,147,58,0.15)", fg: "#7a6020" },
	polar: { bg: "rgba(26,107,138,0.12)", fg: "#1a5a75" },
	positive: { bg: "rgba(34,68,187,0.12)", fg: "#1a3a99" },
	negative: { bg: "rgba(204,51,51,0.12)", fg: "#9a2020" },
	special: { bg: "rgba(154,146,132,0.12)", fg: "#5a5648" },
};

// ── Codon cell component ──────────────────────────────────────────────────────

function CodonCell({ codon, index }: { codon: Codon; index: number }) {
	const colors = CAT_COLORS[codon.cat];
	const showTick = index > 0 && index % 10 === 0;

	return (
		<div
			style={{
				position: "relative",
				display: "inline-flex",
				flexDirection: "column",
				alignItems: "center",
			}}
		>
			{showTick && (
				<div
					style={{
						position: "absolute",
						top: "-14px",
						left: 0,
						fontFamily: "var(--font-courier)",
						fontSize: "7px",
						color: "#9a9284",
						letterSpacing: 0,
						whiteSpace: "nowrap",
					}}
				>
					{index + 1}
				</div>
			)}
			{/* Nucleotide triplet */}
			<div
				style={{
					fontFamily: "var(--font-courier)",
					fontSize: "8px",
					color: "#5a5648",
					letterSpacing: "0.05em",
					lineHeight: 1.4,
					padding: "1px 2px",
				}}
			>
				{codon.nt}
			</div>
			{/* Amino acid */}
			<div
				style={{
					fontFamily: "var(--font-courier)",
					fontSize: "11px",
					fontWeight: "bold",
					lineHeight: 1.3,
					minWidth: "18px",
					textAlign: "center",
					padding: "2px 2px 2px",
					background: colors.bg,
					color: colors.fg,
					borderRadius: "2px",
					letterSpacing: 0,
				}}
			>
				{codon.aa}
			</div>
		</div>
	);
}

// ── Main component ────────────────────────────────────────────────────────────

export function TranslationView({ seq, target, onClose, onDesignPrimers }: TranslationViewProps) {
	const containerRef = useRef<HTMLDivElement>(null);

	const { nt, spansOrigin } = extractCDS(seq, target.start, target.end, target.direction);
	const codons = translateCodons(nt);
	const residues = codons.filter((c) => c.aa !== "*");
	const mw = estimateMW(codons);
	const hasStop = codons.at(-1)?.aa === "*";

	// Protein properties — only meaningful at ≥ 5 residues
	const protein = translate(nt);
	const showProps = residues.length >= 5;
	const pI  = showProps ? computePI(protein) : null;
	const eps = showProps ? computeExtinctionCoefficient(protein) : null;
	const gravy = showProps ? computeGRAVY(protein) : null;

	// Scroll to start on open
	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll on target identity change, not deep equality
	useEffect(() => {
		if (containerRef.current) containerRef.current.scrollLeft = 0;
	}, [target]);

	const strandLabel = target.direction === 1 ? "+" : "−";
	const posLabel = `${target.start + 1}–${target.end}`;

	return (
		<div
			style={{
				flexShrink: 0,
				borderTop: "2px solid #c8c0b8",
				background: "#faf7f2",
				height: showProps ? "158px" : "136px",
				display: "flex",
				flexDirection: "column",
				overflow: "hidden",
			}}
		>
			{/* Header */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					padding: "5px 14px",
					borderBottom: "1px solid #ddd8ce",
					flexShrink: 0,
					background: "#f5f0e8",
					gap: "10px",
				}}
			>
				<span
					style={{
						fontFamily: "var(--font-courier)",
						fontSize: "9px",
						color: "#1c1a16",
						fontWeight: "bold",
						maxWidth: "200px",
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
				>
					{target.name}
				</span>
				<span style={{ fontFamily: "var(--font-courier)", fontSize: "8px", color: "#9a9284" }}>
					{strandLabel} {posLabel}
				</span>
				<span style={{ fontFamily: "var(--font-courier)", fontSize: "8px", color: "#5a5648" }}>
					{residues.length} aa
				</span>
				<span style={{ fontFamily: "var(--font-courier)", fontSize: "8px", color: "#5a5648" }}>
					{mw.toFixed(1)} kDa
				</span>
				{!hasStop && (
					<span style={{ fontFamily: "var(--font-courier)", fontSize: "8px", color: "#b8933a" }}>
						no stop codon
					</span>
				)}
				{spansOrigin && (
					<span style={{ fontFamily: "var(--font-courier)", fontSize: "8px", color: "#b8933a" }}>
						multi-segment — may be incomplete
					</span>
				)}

				<div style={{ flex: 1 }} />

				{/* AA category legend */}
				{(["start", "hydrophobic", "polar", "positive", "negative", "stop"] as const).map((cat) => (
					<span
						key={cat}
						style={{
							fontFamily: "var(--font-courier)",
							fontSize: "7px",
							color: CAT_COLORS[cat].fg,
							background: CAT_COLORS[cat].bg,
							borderRadius: "2px",
							padding: "1px 4px",
							letterSpacing: "0.04em",
						}}
					>
						{cat === "start" ? "start" : cat === "stop" ? "stop" : cat.slice(0, 4)}
					</span>
				))}

				{onDesignPrimers && (
					<button
						type="button"
						onClick={onDesignPrimers}
						style={{
							fontFamily: "var(--font-courier)",
							fontSize: "7.5px",
							letterSpacing: "0.06em",
							color: "#1a4731",
							background: "none",
							border: "1px solid #1a4731",
							borderRadius: "2px",
							cursor: "pointer",
							padding: "1px 6px",
							marginLeft: "4px",
						}}
					>
						PRIMERS
					</button>
				)}

				<button
					type="button"
					onClick={onClose}
					style={{
						fontFamily: "var(--font-courier)",
						fontSize: "13px",
						lineHeight: 1,
						color: "#9a9284",
						background: "none",
						border: "none",
						cursor: "pointer",
						padding: "0 2px",
						marginLeft: "4px",
					}}
					aria-label="Close translation"
				>
					×
				</button>
			</div>

			{/* Protein properties row — pI · ε280 · GRAVY (order: alphabetical by symbol) */}
			{showProps && pI !== null && eps !== null && gravy !== null && (
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: "16px",
						padding: "3px 14px",
						borderBottom: "1px solid #ece6d8",
						background: "#f5f0e8",
						flexShrink: 0,
					}}
				>
					<span
						style={{ fontFamily: "var(--font-courier)", fontSize: "8px", color: "#9a9284", letterSpacing: "0.04em" }}
					>
						PROPERTIES
					</span>
					{[
						{ label: "pI", value: pI.toFixed(1) },
						{ label: "ε280", value: `${eps.toLocaleString()} M⁻¹cm⁻¹`, title: "Extinction coefficient at 280 nm (reduced Cys; Pace et al. 1995)" },
						{ label: "GRAVY", value: gravy.toFixed(2), title: "Grand Average of Hydropathicity (Kyte & Doolittle, 1982)" },
					].map(({ label, value, title }) => (
						<span key={label} title={title} style={{ display: "flex", gap: "4px", alignItems: "baseline" }}>
							<span style={{ fontFamily: "var(--font-courier)", fontSize: "7.5px", color: "#9a9284" }}>{label}</span>
							<span style={{ fontFamily: "var(--font-courier)", fontSize: "9px", color: "#1c1a16", fontWeight: 600 }}>{value}</span>
						</span>
					))}
					{eps === 0 && (
						<span style={{ fontFamily: "var(--font-courier)", fontSize: "7.5px", color: "#b8933a" }}>
							ε280 = 0: no Trp or Tyr
						</span>
					)}
				</div>
			)}

			{/* Codon scroll area */}
			<div
				ref={containerRef}
				style={{ flex: 1, overflowX: "auto", overflowY: "hidden", padding: "16px 14px 8px" }}
			>
				<div style={{ display: "inline-flex", gap: "2px", alignItems: "flex-end", height: "100%" }}>
					{codons.map((codon, i) => (
						<CodonCell key={i} codon={codon} index={i} />
					))}
					{codons.length === 0 && (
						<span style={{ fontFamily: "var(--font-courier)", fontSize: "9px", color: "#9a9284" }}>
							No codons found in this feature.
						</span>
					)}
				</div>
			</div>
		</div>
	);
}
