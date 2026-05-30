"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { SiteNav } from "@/components/nav/site-nav";
import type {
	CasVariant,
	CRISPRDesignOptions,
	GuideFlag,
	GuideRNA,
	ScoreMethod,
} from "@/lib/bio/crispr";
import { parseGenBank } from "@/lib/bio/parse-genbank";
import type { GuideDesignRequest, GuideDesignResponse } from "./guide-design.worker";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TargetState {
	name: string;
	seq: string;
}

type DesignState =
	| { status: "idle" }
	| { status: "running" }
	| { status: "done"; guides: GuideRNA[]; casVariant: CasVariant }
	| { status: "error"; message: string };

// ── Constants ─────────────────────────────────────────────────────────────────

const CAS_VARIANTS: CasVariant[] = ["SpCas9", "SaCas9", "Cas12a"];

const SCORE_METHOD_LABEL: Record<ScoreMethod, string> = {
	"Doench2014-RS1": "Doench 2014 RS1",
	heuristic: "heuristic",
};

const FLAG_LABELS: Record<GuideFlag, string> = {
	polyT: "T⁴",
	homopolymer: "homo",
	lowGC: "↓GC",
	highGC: "↑GC",
	missingContext: "ctx?",
};

const FLAG_TITLES: Record<GuideFlag, string> = {
	polyT: "TTTT run — may disrupt Pol III transcription",
	homopolymer: "5+ identical bases — reduced efficiency",
	lowGC: "GC < 25% — reduced efficiency",
	highGC: "GC > 75% — reduced efficiency",
	missingContext: "Guide near sequence edge — RS1 score uses N-padded context",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseFasta(text: string): { name: string; sequence: string } | null {
	const trimmed = text.trim();
	if (trimmed.startsWith(">")) {
		const lines = trimmed.split("\n");
		const name = lines[0]?.slice(1).split(/\s+/)[0] ?? "target";
		const seq = lines
			.slice(1)
			.join("")
			.replace(/[^ACGTNacgtn\s]/g, "")
			.replace(/\s/g, "")
			.toUpperCase();
		return seq.length > 0 ? { name, sequence: seq } : null;
	}
	const seq = trimmed
		.replace(/[^ACGTNacgtn\s]/g, "")
		.replace(/\s/g, "")
		.toUpperCase();
	return seq.length >= 10 ? { name: "target", sequence: seq } : null;
}

function parseTarget(text: string): TargetState | { error: string } {
	const trimmed = text.trim();
	if (!trimmed) return { error: "Empty input" };

	if (trimmed.includes("LOCUS") && trimmed.includes("ORIGIN")) {
		try {
			const parsed = parseGenBank(trimmed);
			if (parsed.seq.length === 0) return { error: "No sequence found in GenBank file" };
			return { name: parsed.name, seq: parsed.seq };
		} catch {
			// fall through
		}
	}

	const fasta = parseFasta(trimmed);
	if (fasta) return { name: fasta.name, seq: fasta.sequence };

	return { error: "Input too short or contains invalid characters (need ≥ 10 bp)" };
}

async function parseTargetFile(file: File): Promise<TargetState | { error: string }> {
	return parseTarget(await file.text());
}

function exportCsv(guides: GuideRNA[], targetName: string) {
	const header = "rank,sequence,pam,position,strand,score,gc_pct,flags,score_method";
	const rows = guides.map((g, i) =>
		[
			i + 1,
			g.sequence,
			g.pam,
			g.position + 1, // 1-indexed for biologists
			g.strand,
			g.onTargetScore,
			Math.round(g.gcContent * 100),
			g.flags.join(";"),
			g.scoreMethod,
		].join(","),
	);
	const content = [header, ...rows].join("\n");
	const blob = new Blob([content], { type: "text/csv" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `${targetName || "crispr"}_guides.csv`;
	a.click();
	URL.revokeObjectURL(url);
}

// ── Position map (canvas) ─────────────────────────────────────────────────────

function GuidePositionMap({
	guides,
	seqLen,
	selectedId,
	onSelect,
}: {
	guides: GuideRNA[];
	seqLen: number;
	selectedId: string | null;
	onSelect: (id: string) => void;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		const container = containerRef.current;
		if (!canvas || !container || seqLen === 0) return;

		const dpr = window.devicePixelRatio || 1;
		const W = container.clientWidth;
		const H = 48;
		canvas.width = W * dpr;
		canvas.height = H * dpr;
		canvas.style.width = `${W}px`;
		canvas.style.height = `${H}px`;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.scale(dpr, dpr);

		ctx.fillStyle = "#faf7f2";
		ctx.fillRect(0, 0, W, H);

		// Ruler line
		ctx.strokeStyle = "#ddd8ce";
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(0, 24);
		ctx.lineTo(W, 24);
		ctx.stroke();

		// Guide bars
		const MIN_W = 3;
		for (const g of guides) {
			const x = Math.floor((g.position / seqLen) * W);
			const barW = Math.max(MIN_W, Math.ceil((20 / seqLen) * W));
			const isSelected = g.id === selectedId;

			let color: string;
			if (g.onTargetScore >= 70) color = "#1a4731";
			else if (g.onTargetScore >= 40) color = "#b8933a";
			else color = "#a02828";

			const alpha = isSelected ? 1.0 : 0.55;
			ctx.globalAlpha = alpha;

			if (g.strand === "+") {
				ctx.fillStyle = color;
				ctx.fillRect(x, 10, barW, 12);
			} else {
				ctx.fillStyle = color;
				ctx.fillRect(x, 26, barW, 12);
			}
			ctx.globalAlpha = 1;

			if (isSelected) {
				ctx.strokeStyle = color;
				ctx.lineWidth = 1.5;
				ctx.strokeRect(x, g.strand === "+" ? 9 : 25, barW + 1, 14);
			}
		}

		// Strand labels
		ctx.fillStyle = "#b8b0a4";
		ctx.font = `7px "Courier Prime", monospace`;
		ctx.fillText("+", 4, 19);
		ctx.fillText("−", 4, 35);
	}, [guides, seqLen, selectedId]);

	// Click to select guide
	const handleClick = useCallback(
		(e: React.MouseEvent<HTMLCanvasElement>) => {
			const canvas = canvasRef.current;
			const container = containerRef.current;
			if (!canvas || !container || seqLen === 0) return;
			const rect = canvas.getBoundingClientRect();
			const x = e.clientX - rect.left;
			const y = e.clientY - rect.top;
			const W = container.clientWidth;
			const strandClicked: "+" | "-" = y < 24 ? "+" : "-";

			// Find closest guide bar
			let closest: GuideRNA | null = null;
			let closestDist = 999;
			for (const g of guides) {
				if (g.strand !== strandClicked) continue;
				const gx = (g.position / seqLen) * W;
				const dist = Math.abs(x - gx);
				if (dist < closestDist && dist < 20) {
					closestDist = dist;
					closest = g;
				}
			}
			if (closest) onSelect(closest.id);
		},
		[guides, seqLen, onSelect],
	);

	return (
		<div ref={containerRef} style={{ width: "100%" }}>
			<canvas
				ref={canvasRef}
				onClick={handleClick}
				style={{ display: "block", cursor: "pointer" }}
			/>
		</div>
	);
}

// ── Guide row ─────────────────────────────────────────────────────────────────

function GuideRow({
	guide,
	rank,
	isSelected,
	onClick,
}: {
	guide: GuideRNA;
	rank: number;
	isSelected: boolean;
	onClick: () => void;
}) {
	const scoreColor =
		guide.onTargetScore >= 70 ? "#1a4731" : guide.onTargetScore >= 40 ? "#b8933a" : "#a02828";

	return (
		<button
			type="button"
			onClick={onClick}
			style={{
				display: "grid",
				gridTemplateColumns: "28px 1fr 52px 60px 20px 42px 38px auto",
				alignItems: "center",
				gap: "0 8px",
				padding: "7px 14px",
				borderBottom: "1px solid rgba(221,216,206,0.5)",
				background: isSelected ? "rgba(26,71,49,0.04)" : "transparent",
				border: "none",
				borderLeft: isSelected ? "2px solid #1a4731" : "2px solid transparent",
				cursor: "pointer",
				width: "100%",
				textAlign: "left",
			}}
		>
			{/* Rank */}
			<span style={{ fontFamily: "var(--font-courier)", fontSize: "9px", color: "#b8b0a4" }}>
				{rank}
			</span>
			{/* Sequence */}
			<span
				style={{
					fontFamily: "var(--font-courier)",
					fontSize: "9.5px",
					color: "#1c1a16",
					letterSpacing: "0.02em",
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
				}}
			>
				{guide.sequence}
			</span>
			{/* PAM */}
			<span style={{ fontFamily: "var(--font-courier)", fontSize: "9px", color: "#2d7a54" }}>
				{guide.pam}
			</span>
			{/* Position */}
			<span style={{ fontFamily: "var(--font-courier)", fontSize: "9px", color: "#9a9284" }}>
				{guide.position + 1}
			</span>
			{/* Strand */}
			<span
				style={{
					fontFamily: "var(--font-courier)",
					fontSize: "9px",
					color: guide.strand === "+" ? "#1a4731" : "#7c3aed",
				}}
			>
				{guide.strand}
			</span>
			{/* Score */}
			<span
				style={{
					fontFamily: "var(--font-courier)",
					fontSize: "10px",
					color: scoreColor,
					fontWeight: "bold",
				}}
			>
				{guide.onTargetScore}
			</span>
			{/* GC% */}
			<span style={{ fontFamily: "var(--font-courier)", fontSize: "9px", color: "#5a5648" }}>
				{Math.round(guide.gcContent * 100)}%
			</span>
			{/* Flags */}
			<span style={{ display: "flex", gap: "3px" }}>
				{guide.flags.map((f) => (
					<span
						key={f}
						title={FLAG_TITLES[f]}
						style={{
							fontFamily: "var(--font-courier)",
							fontSize: "7.5px",
							color: "#b8933a",
							border: "1px solid rgba(184,147,58,0.35)",
							borderRadius: "2px",
							padding: "0 3px",
						}}
					>
						{FLAG_LABELS[f]}
					</span>
				))}
			</span>
		</button>
	);
}

// ── Guide detail card ─────────────────────────────────────────────────────────

function GuideDetail({
	guide,
	onCopy,
	copied,
}: {
	guide: GuideRNA;
	onCopy: () => void;
	copied: boolean;
}) {
	const scoreColor =
		guide.onTargetScore >= 70 ? "#1a4731" : guide.onTargetScore >= 40 ? "#b8933a" : "#a02828";

	// Color-coded context display
	const ctx = guide.context;
	const hasContext = ctx.length === 30;
	const upstream = hasContext ? ctx.slice(0, 4) : "";
	const guideSeq = hasContext ? ctx.slice(4, 4 + guide.sequence.length) : guide.sequence;
	const pam = hasContext
		? ctx.slice(4 + guide.sequence.length, 4 + guide.sequence.length + guide.pam.length)
		: guide.pam;
	const downstream = hasContext ? ctx.slice(4 + guide.sequence.length + guide.pam.length) : "";

	return (
		<div
			style={{
				padding: "12px 14px",
				background: "rgba(26,71,49,0.03)",
				borderBottom: "2px solid #ddd8ce",
			}}
		>
			{/* Context display */}
			<div
				style={{
					fontFamily: "var(--font-courier)",
					fontSize: "10px",
					letterSpacing: "0.04em",
					marginBottom: "10px",
					display: "flex",
					alignItems: "center",
					gap: "0",
					flexWrap: "wrap",
				}}
			>
				<span style={{ color: "#b8b0a4" }}>{upstream}</span>
				<span
					style={{
						color: "#1c1a16",
						background: "rgba(26,71,49,0.08)",
						padding: "1px 2px",
						borderRadius: "2px",
					}}
				>
					{guideSeq}
				</span>
				<span style={{ color: "#2d7a54", fontWeight: "bold" }}>{pam}</span>
				<span style={{ color: "#b8b0a4" }}>{downstream}</span>
			</div>

			{/* Stats row */}
			<div
				style={{
					display: "flex",
					gap: "16px",
					alignItems: "center",
					flexWrap: "wrap",
					marginBottom: "8px",
				}}
			>
				<span style={{ fontFamily: "var(--font-courier)", fontSize: "9px", color: scoreColor }}>
					{guide.onTargetScore}/100 · {SCORE_METHOD_LABEL[guide.scoreMethod]}
				</span>
				<span style={{ fontFamily: "var(--font-courier)", fontSize: "9px", color: "#5a5648" }}>
					GC {Math.round(guide.gcContent * 100)}%
				</span>
				<span
					style={{
						fontFamily: "var(--font-courier)",
						fontSize: "9px",
						color: guide.strand === "+" ? "#1a4731" : "#7c3aed",
					}}
				>
					{guide.strand === "+" ? "+" : "−"} strand · pos {guide.position + 1}
				</span>
			</div>

			{/* Flags */}
			{guide.flags.length > 0 && (
				<div style={{ marginBottom: "8px" }}>
					{guide.flags.map((f) => (
						<div
							key={f}
							style={{
								fontFamily: "var(--font-courier)",
								fontSize: "9px",
								color: "#b8933a",
								marginBottom: "2px",
							}}
						>
							▲ {FLAG_TITLES[f]}
						</div>
					))}
				</div>
			)}

			{/* Copy button */}
			<button
				type="button"
				onClick={onCopy}
				style={{
					fontFamily: "var(--font-courier)",
					fontSize: "8.5px",
					letterSpacing: "0.06em",
					textTransform: "uppercase",
					color: copied ? "#1a4731" : "#5a5648",
					background: copied ? "rgba(26,71,49,0.08)" : "none",
					border: `1px solid ${copied ? "rgba(26,71,49,0.25)" : "#ddd8ce"}`,
					borderRadius: "2px",
					cursor: "pointer",
					padding: "3px 10px",
					transition: "all 0.15s",
				}}
			>
				{copied ? "✓ Copied" : "Copy guide"}
			</button>
		</div>
	);
}

// ── Main component ────────────────────────────────────────────────────────────

export function CrisprTool() {
	const searchParams = useSearchParams();

	const [target, setTarget] = useState<TargetState | null>(null);
	const [targetInput, setTargetInput] = useState("");
	const [targetError, setTargetError] = useState<string | null>(null);
	const [casVariant, setCasVariant] = useState<CasVariant>("SpCas9");
	const [strand, setStrand] = useState<"both" | "+" | "-">("both");
	const [minScore, setMinScore] = useState(30);
	const [designState, setDesignState] = useState<DesignState>({ status: "idle" });
	const [selectedGuideId, setSelectedGuideId] = useState<string | null>(null);
	const [copiedId, setCopiedId] = useState<string | null>(null);

	const workerRef = useRef<Worker | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const mountedRef = useRef(true);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			workerRef.current?.terminate();
		};
	}, []);

	// Pre-load from URL params (deep-link from sequence viewer)
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional — run once on mount
	useEffect(() => {
		const seq = searchParams.get("seq");
		const name = searchParams.get("name");
		if (seq) {
			setTarget({ name: name ?? "region", seq: seq.toUpperCase() });
		}
	}, []);

	// ── Target handling ───────────────────────────────────────────────────────

	const applyTargetText = useCallback((text: string) => {
		const result = parseTarget(text);
		if ("error" in result) {
			setTargetError(result.error);
		} else {
			setTarget(result);
			setTargetError(null);
			setTargetInput("");
			setDesignState({ status: "idle" });
			setSelectedGuideId(null);
		}
	}, []);

	const handleTargetFile = useCallback(async (file: File) => {
		const result = await parseTargetFile(file);
		if ("error" in result) {
			setTargetError(result.error);
		} else {
			setTarget(result);
			setTargetError(null);
			setTargetInput("");
			setDesignState({ status: "idle" });
			setSelectedGuideId(null);
		}
	}, []);

	const clearTarget = useCallback(() => {
		setTarget(null);
		setTargetInput("");
		setTargetError(null);
		setDesignState({ status: "idle" });
		setSelectedGuideId(null);
	}, []);

	// ── Design ────────────────────────────────────────────────────────────────

	const runDesign = useCallback(() => {
		if (!target) return;
		workerRef.current?.terminate();
		setDesignState({ status: "running" });
		setSelectedGuideId(null);

		const worker = new Worker(new URL("./guide-design.worker.ts", import.meta.url));
		workerRef.current = worker;

		const opts: CRISPRDesignOptions = {
			casVariant,
			strand,
			minScore,
			maxGuides: 300,
		};
		const req: GuideDesignRequest = { seq: target.seq, opts };
		worker.postMessage(req);

		worker.onmessage = (e: MessageEvent<GuideDesignResponse>) => {
			worker.terminate();
			workerRef.current = null;
			if (!mountedRef.current) return;
			if (e.data.type === "success") {
				setDesignState({ status: "done", guides: e.data.guides, casVariant: e.data.casVariant });
				if (e.data.guides[0]) setSelectedGuideId(e.data.guides[0].id);
			} else {
				setDesignState({ status: "error", message: e.data.message });
			}
		};
		worker.onerror = () => {
			worker.terminate();
			workerRef.current = null;
			if (mountedRef.current) {
				setDesignState({ status: "error", message: "Worker crashed during guide design" });
			}
		};
	}, [target, casVariant, strand, minScore]);

	const cancelDesign = useCallback(() => {
		workerRef.current?.terminate();
		workerRef.current = null;
		setDesignState({ status: "idle" });
	}, []);

	const copyGuide = useCallback((guide: GuideRNA) => {
		void navigator.clipboard.writeText(guide.sequence).then(() => {
			setCopiedId(guide.id);
			setTimeout(() => setCopiedId(null), 1800);
		});
	}, []);

	// ── Derived ───────────────────────────────────────────────────────────────

	const guides = designState.status === "done" ? designState.guides : [];
	const selectedGuide = guides.find((g) => g.id === selectedGuideId) ?? null;
	const isRunning = designState.status === "running";

	const methodLabel =
		designState.status === "done"
			? designState.casVariant === "SpCas9"
				? "Doench 2014 RS1"
				: "heuristic score"
			: "";

	// ── Shared styles ─────────────────────────────────────────────────────────

	const btnStyle: React.CSSProperties = {
		fontFamily: "var(--font-courier)",
		fontSize: "9px",
		letterSpacing: "0.08em",
		textTransform: "uppercase",
		borderRadius: "3px",
		cursor: "pointer",
		padding: "6px 14px",
		border: "none",
	};

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

			<main
				style={{ flex: 1, padding: "32px", maxWidth: "1200px", margin: "0 auto", width: "100%" }}
			>
				<div style={{ marginBottom: "28px" }}>
					<p
						style={{
							fontFamily: "var(--font-karla)",
							fontSize: "14px",
							color: "#5a5648",
							lineHeight: 1.6,
							margin: 0,
						}}
					>
						Find and score guide RNAs for SpCas9, SaCas9, and Cas12a. SpCas9 scored with Doench 2014
						Rule Set 1.
					</p>
				</div>

				{/* Input grid */}
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "1fr 280px",
						gap: "20px",
						marginBottom: "24px",
					}}
				>
					{/* Target sequence */}
					<div
						style={{
							background: "#faf7f2",
							border: "1px solid #ddd8ce",
							borderRadius: "4px",
							overflow: "hidden",
						}}
					>
						<div
							style={{
								padding: "10px 16px",
								borderBottom: "1px solid #ddd8ce",
								display: "flex",
								alignItems: "center",
								gap: "8px",
							}}
						>
							<span
								style={{
									fontFamily: "var(--font-courier)",
									fontSize: "9px",
									letterSpacing: "0.10em",
									textTransform: "uppercase",
									color: "#9a9284",
								}}
							>
								Target Sequence
							</span>
							{target && (
								<button
									type="button"
									onClick={clearTarget}
									style={{
										marginLeft: "auto",
										fontFamily: "var(--font-courier)",
										fontSize: "9px",
										color: "#9a9284",
										background: "none",
										border: "none",
										cursor: "pointer",
										padding: "2px 4px",
									}}
								>
									× clear
								</button>
							)}
						</div>
						<div style={{ padding: "14px 16px" }}>
							{target ? (
								<div
									style={{
										display: "flex",
										alignItems: "center",
										gap: "10px",
										padding: "10px 14px",
										background: "rgba(26,71,49,0.05)",
										border: "1px solid rgba(26,71,49,0.15)",
										borderRadius: "3px",
									}}
								>
									<span
										style={{
											width: "6px",
											height: "6px",
											borderRadius: "50%",
											background: "#1a4731",
											flexShrink: 0,
										}}
									/>
									<span
										style={{
											fontFamily: "var(--font-courier)",
											fontSize: "11px",
											color: "#1c1a16",
											flex: 1,
											overflow: "hidden",
											textOverflow: "ellipsis",
											whiteSpace: "nowrap",
										}}
									>
										{target.name}
									</span>
									<span
										style={{
											fontFamily: "var(--font-courier)",
											fontSize: "10px",
											color: "#9a9284",
											flexShrink: 0,
										}}
									>
										{target.seq.length.toLocaleString()} bp
									</span>
								</div>
							) : (
								<>
									<textarea
										value={targetInput}
										onChange={(e) => setTargetInput(e.target.value)}
										placeholder="Paste GenBank, FASTA, or raw DNA sequence…"
										rows={5}
										style={{
											width: "100%",
											boxSizing: "border-box",
											fontFamily: "var(--font-courier)",
											fontSize: "10px",
											color: "#1c1a16",
											background: "#f5f0e8",
											border: "1px solid #ddd8ce",
											borderRadius: "3px",
											padding: "8px 10px",
											resize: "vertical",
											letterSpacing: "0.02em",
											marginBottom: "8px",
											outline: "none",
										}}
									/>
									<div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
										<button
											type="button"
											disabled={!targetInput.trim()}
											onClick={() => applyTargetText(targetInput)}
											style={{
												...btnStyle,
												background: targetInput.trim() ? "#1a4731" : "#c8c0b8",
												color: "white",
												cursor: targetInput.trim() ? "pointer" : "default",
											}}
										>
											Use as target
										</button>
										<button
											type="button"
											onClick={() => fileInputRef.current?.click()}
											style={{
												...btnStyle,
												background: "none",
												border: "1px solid #ddd8ce",
												color: "#5a5648",
											}}
										>
											Upload file
										</button>
										<input
											ref={fileInputRef}
											type="file"
											style={{ display: "none" }}
											onChange={(e) => {
												const f = e.target.files?.[0];
												if (f) void handleTargetFile(f);
												e.target.value = "";
											}}
										/>
									</div>
								</>
							)}
							{targetError && (
								<div
									style={{
										marginTop: "8px",
										fontFamily: "var(--font-courier)",
										fontSize: "10px",
										color: "#a02828",
										background: "rgba(160,40,40,0.06)",
										border: "1px solid rgba(160,40,40,0.2)",
										borderRadius: "2px",
										padding: "6px 10px",
									}}
								>
									{targetError}
								</div>
							)}
						</div>
					</div>

					{/* Options */}
					<div
						style={{
							background: "#faf7f2",
							border: "1px solid #ddd8ce",
							borderRadius: "4px",
							overflow: "hidden",
						}}
					>
						<div style={{ padding: "10px 16px", borderBottom: "1px solid #ddd8ce" }}>
							<span
								style={{
									fontFamily: "var(--font-courier)",
									fontSize: "9px",
									letterSpacing: "0.10em",
									textTransform: "uppercase",
									color: "#9a9284",
								}}
							>
								Options
							</span>
						</div>
						<div
							style={{
								padding: "14px 16px",
								display: "flex",
								flexDirection: "column",
								gap: "14px",
							}}
						>
							{/* Cas variant */}
							<div>
								<div
									style={{
										fontFamily: "var(--font-courier)",
										fontSize: "8px",
										letterSpacing: "0.08em",
										textTransform: "uppercase",
										color: "#9a9284",
										marginBottom: "6px",
									}}
								>
									Cas Variant
								</div>
								<div style={{ display: "flex", gap: "5px" }}>
									{CAS_VARIANTS.map((v) => (
										<button
											key={v}
											type="button"
											onClick={() => setCasVariant(v)}
											style={{
												fontFamily: "var(--font-courier)",
												fontSize: "9px",
												letterSpacing: "0.04em",
												padding: "4px 8px",
												borderRadius: "2px",
												border: `1px solid ${casVariant === v ? "#1a4731" : "#ddd8ce"}`,
												background: casVariant === v ? "rgba(26,71,49,0.08)" : "none",
												color: casVariant === v ? "#1a4731" : "#5a5648",
												cursor: "pointer",
											}}
										>
											{v}
										</button>
									))}
								</div>
							</div>

							{/* Strand */}
							<div>
								<div
									style={{
										fontFamily: "var(--font-courier)",
										fontSize: "8px",
										letterSpacing: "0.08em",
										textTransform: "uppercase",
										color: "#9a9284",
										marginBottom: "6px",
									}}
								>
									Strand
								</div>
								<div style={{ display: "flex", gap: "5px" }}>
									{(["both", "+", "-"] as const).map((s) => (
										<button
											key={s}
											type="button"
											onClick={() => setStrand(s)}
											style={{
												fontFamily: "var(--font-courier)",
												fontSize: "9px",
												letterSpacing: "0.04em",
												padding: "4px 8px",
												borderRadius: "2px",
												border: `1px solid ${strand === s ? "#1a4731" : "#ddd8ce"}`,
												background: strand === s ? "rgba(26,71,49,0.08)" : "none",
												color: strand === s ? "#1a4731" : "#5a5648",
												cursor: "pointer",
											}}
										>
											{s === "both" ? "Both" : `${s} strand`}
										</button>
									))}
								</div>
							</div>

							{/* Min score */}
							<div>
								<div
									style={{
										fontFamily: "var(--font-courier)",
										fontSize: "8px",
										letterSpacing: "0.08em",
										textTransform: "uppercase",
										color: "#9a9284",
										marginBottom: "6px",
									}}
								>
									Min score: <span style={{ color: "#1c1a16" }}>{minScore}</span>
								</div>
								<input
									type="range"
									min={0}
									max={80}
									step={5}
									value={minScore}
									onChange={(e) => setMinScore(Number(e.target.value))}
									style={{ width: "100%", accentColor: "#1a4731" }}
								/>
								<div
									style={{
										display: "flex",
										justifyContent: "space-between",
										fontFamily: "var(--font-courier)",
										fontSize: "7.5px",
										color: "#b8b0a4",
									}}
								>
									<span>0</span>
									<span>80</span>
								</div>
							</div>
						</div>
					</div>
				</div>

				{/* Design button */}
				<div style={{ marginBottom: "24px" }}>
					{isRunning ? (
						<button
							type="button"
							onClick={cancelDesign}
							style={{ ...btnStyle, background: "#b8933a", color: "white" }}
						>
							× Cancel
						</button>
					) : (
						<button
							type="button"
							disabled={!target}
							onClick={runDesign}
							style={{
								...btnStyle,
								background: target ? "#1a4731" : "#c8c0b8",
								color: "white",
								cursor: target ? "pointer" : "default",
							}}
						>
							Design guides
						</button>
					)}
					{isRunning && (
						<span
							style={{
								fontFamily: "var(--font-courier)",
								fontSize: "9px",
								color: "#9a9284",
								marginLeft: "12px",
								letterSpacing: "0.04em",
							}}
						>
							Scanning…
						</span>
					)}
				</div>

				{/* Error */}
				{designState.status === "error" && (
					<div
						style={{
							marginBottom: "24px",
							padding: "10px 14px",
							background: "rgba(160,40,40,0.06)",
							border: "1px solid rgba(160,40,40,0.2)",
							borderRadius: "3px",
							fontFamily: "var(--font-courier)",
							fontSize: "10px",
							color: "#a02828",
						}}
					>
						{designState.message}
					</div>
				)}

				{/* Results */}
				{designState.status === "done" && (
					<div
						style={{
							background: "#faf7f2",
							border: "1px solid #ddd8ce",
							borderRadius: "4px",
							overflow: "hidden",
						}}
					>
						{/* Results header */}
						<div
							style={{
								padding: "10px 16px",
								borderBottom: "1px solid #ddd8ce",
								display: "flex",
								alignItems: "center",
								gap: "10px",
							}}
						>
							<span
								style={{ fontFamily: "var(--font-courier)", fontSize: "9px", color: "#1c1a16" }}
							>
								{guides.length} guide{guides.length !== 1 ? "s" : ""}
							</span>
							<span
								style={{ fontFamily: "var(--font-courier)", fontSize: "9px", color: "#9a9284" }}
							>
								· {designState.casVariant} · {methodLabel}
							</span>
							<div style={{ flex: 1 }} />
							{guides.length > 0 && target && (
								<button
									type="button"
									onClick={() => exportCsv(guides, target.name)}
									style={{
										...btnStyle,
										background: "none",
										border: "1px solid #ddd8ce",
										color: "#5a5648",
										padding: "4px 10px",
									}}
								>
									Export CSV
								</button>
							)}
						</div>

						{guides.length === 0 ? (
							<div
								style={{
									padding: "24px 16px",
									fontFamily: "var(--font-courier)",
									fontSize: "10px",
									color: "#9a9284",
									textAlign: "center",
								}}
							>
								No guides found above score {minScore}. Try lowering the minimum score.
							</div>
						) : (
							<>
								{/* Position map */}
								{target && (
									<div style={{ padding: "10px 16px", borderBottom: "1px solid #ddd8ce" }}>
										<div
											style={{
												display: "flex",
												justifyContent: "space-between",
												fontFamily: "var(--font-courier)",
												fontSize: "7.5px",
												color: "#b8b0a4",
												marginBottom: "4px",
											}}
										>
											<span>1</span>
											<span style={{ textAlign: "center" }}>
												guide positions · green ≥70 · amber 40–69 · red &lt;40
											</span>
											<span>{target.seq.length}</span>
										</div>
										<GuidePositionMap
											guides={guides}
											seqLen={target.seq.length}
											selectedId={selectedGuideId}
											onSelect={setSelectedGuideId}
										/>
									</div>
								)}

								{/* Selected guide detail */}
								{selectedGuide && (
									<GuideDetail
										guide={selectedGuide}
										onCopy={() => copyGuide(selectedGuide)}
										copied={copiedId === selectedGuide.id}
									/>
								)}

								{/* Table header */}
								<div
									style={{
										display: "grid",
										gridTemplateColumns: "28px 1fr 52px 60px 20px 42px 38px auto",
										gap: "0 8px",
										padding: "5px 14px",
										borderBottom: "1px solid #ddd8ce",
										background: "#f5f0e8",
									}}
								>
									{["#", "Sequence", "PAM", "Pos", "±", "Score", "GC%", "Flags"].map((h) => (
										<span
											key={h}
											style={{
												fontFamily: "var(--font-courier)",
												fontSize: "7.5px",
												letterSpacing: "0.08em",
												textTransform: "uppercase",
												color: "#9a9284",
											}}
										>
											{h}
										</span>
									))}
								</div>

								{/* Guide rows (cap at 100 for rendering) */}
								<div style={{ maxHeight: "480px", overflowY: "auto" }}>
									{guides.slice(0, 100).map((g, i) => (
										<GuideRow
											key={g.id}
											guide={g}
											rank={i + 1}
											isSelected={selectedGuideId === g.id}
											onClick={() => setSelectedGuideId(g.id)}
										/>
									))}
									{guides.length > 100 && (
										<div
											style={{
												padding: "8px 14px",
												fontFamily: "var(--font-courier)",
												fontSize: "9px",
												color: "#9a9284",
												textAlign: "center",
											}}
										>
											Showing top 100 of {guides.length} — export CSV for full list
										</div>
									)}
								</div>
							</>
						)}
					</div>
				)}
			</main>
		</div>
	);
}
