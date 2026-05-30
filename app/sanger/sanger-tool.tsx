"use client";

import { parseAbif } from "@shandley/abif-ts";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { SiteNav } from "@/components/nav/site-nav";
import type { AlignWorkerRequest, AlignWorkerResponse } from "@/components/sequence/align.worker";
import type { TraceData } from "@/components/sequence/chromatogram";
import { Chromatogram } from "@/components/sequence/chromatogram";
import type { AlignmentResult } from "@/lib/bio/align";
import { parseGenBank } from "@/lib/bio/parse-genbank";
import type { AnnotationSummary, Verdict, VerificationResult } from "@/lib/bio/verify-clone";
import { verifyClone } from "@/lib/bio/verify-clone";

// ── Types ─────────────────────────────────────────────────────────────────────

interface RefState {
	name: string;
	seq: string;
	topology: "circular" | "linear";
	annotations: AnnotationSummary[];
}

interface AlignRead {
	id: string;
	name: string;
	sequence: string;
	quality?: number[];
	traces?: TraceData;
	peakPositions?: number[];
	traceLength?: number;
	result?: AlignmentResult;
	color: string;
}

type VerifyState =
	| { status: "idle" }
	| { status: "running"; result?: VerificationResult; explanation: string }
	| { status: "done"; result: VerificationResult; explanation: string }
	| { status: "error"; message: string }
	| { status: "needsLogin"; result: VerificationResult };

// ── Constants ─────────────────────────────────────────────────────────────────

const READ_COLORS = [
	"#0891b2",
	"#7c3aed",
	"#b45309",
	"#15803d",
	"#be185d",
	"#1d4ed8",
	"#92400e",
	"#166534",
];

const VERDICT_CONFIG: Record<
	Verdict,
	{ label: string; color: string; bg: string; border: string; icon: string }
> = {
	CONFIRMED: {
		label: "Confirmed",
		color: "#1a4731",
		bg: "rgba(26,71,49,0.08)",
		border: "rgba(26,71,49,0.25)",
		icon: "✓",
	},
	MUTATION_DETECTED: {
		label: "Mutation Detected",
		color: "#b8933a",
		bg: "rgba(184,147,58,0.08)",
		border: "rgba(184,147,58,0.3)",
		icon: "⚠",
	},
	FAILED: {
		label: "Failed",
		color: "#a02828",
		bg: "rgba(160,40,40,0.08)",
		border: "rgba(160,40,40,0.25)",
		icon: "✗",
	},
	INCOMPLETE: {
		label: "Incomplete",
		color: "#7a7060",
		bg: "rgba(90,86,72,0.06)",
		border: "rgba(90,86,72,0.2)",
		icon: "◑",
	},
};

// ── Demo data ─────────────────────────────────────────────────────────────────
// Loaded by the "Load example" affordance on the Reference panel.
// Reference: EGFP CDS (720 bp). Reads: a forward read of positions 1–450
// and a reverse-strand read covering positions 280–720 (reverse-complement).
// Realistic two-primer Sanger setup; together the reads achieve full coverage
// and produce a CONFIRMED verdict if the user runs clone verification.

const EXAMPLE_REF_FASTA = `>EGFP enhanced green fluorescent protein (720 bp)
ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGAC
GGCGACGTAAACGGCCACAAGTTCAGCGTGTCCGGCGAGGGCGAGGGCGATGCCACCTAC
GGCAAGCTGACCCTGAAGTTCATCTGCACCACCGGCAAGCTGCCCGTGCCCTGGCCCACC
CTCGTGACCACCCTGACCTACGGCGTGCAGTGCTTCAGCCGCTACCCCGACCACATGAAG
CAGCACGACTTCTTCAAGTCCGCCATGCCCGAAGGCTACGTCCAGGAGCGCACCATCTTC
TTCAAGGACGACGGCAACTACAAGACCCGCGCCGAGGTGAAGTTCGAGGGCGACACCCTG
GTGAACCGCATCGAGCTGAAGGGCATCGACTTCAAGGAGGACGGCAACATCCTGGGGCAC
AAGCTGGAGTACAACTACAACAGCCACAACGTCTATATCATGGCCGACAAGCAGAAGAAC
GGCATCAAGGTGAACTTCAAGATCCGCCACAACATCGAGGACGGCAGCGTGCAGCTCGCC
GACCACTACCAGCAGAACACCCCCATCGGCGACGGCCCCGTGCTGCTGCCCGACAACCAC
TACCTGAGCACCCAGTCCGCCCTGAGCAAAGACCCCAACGAGAAGCGCGATCACATGGTC
CTGCTGGAGTTCGTGACCGCCGCCGGGATCACTCTCGGCATGGACGAGCTGTACAAGTAA
`;

const EXAMPLE_FWD_READ_FASTA = `>EGFP_fwd_M13F EGFP forward read (450 bp)
ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGAC
GGCGACGTAAACGGCCACAAGTTCAGCGTGTCCGGCGAGGGCGAGGGCGATGCCACCTAC
GGCAAGCTGACCCTGAAGTTCATCTGCACCACCGGCAAGCTGCCCGTGCCCTGGCCCACC
CTCGTGACCACCCTGACCTACGGCGTGCAGTGCTTCAGCCGCTACCCCGACCACATGAAG
CAGCACGACTTCTTCAAGTCCGCCATGCCCGAAGGCTACGTCCAGGAGCGCACCATCTTC
TTCAAGGACGACGGCAACTACAAGACCCGCGCCGAGGTGAAGTTCGAGGGCGACACCCTG
GTGAACCGCATCGAGCTGAAGGGCATCGACTTCAAGGAGGACGGCAACATCCTGGGGCAC
AAGCTGGAGTACAACTACAACAGCCACAAC
`;

const EXAMPLE_REV_READ_FASTA = `>EGFP_rev_M13R EGFP reverse read (440 bp, reverse-complement)
TTACTTGTACAGCTCGTCCATGCCGAGAGTGATCCCGGCGGCGGTCACGAACTCCAGCAG
GACCATGTGATCGCGCTTCTCGTTGGGGTCTTTGCTCAGGGCGGACTGGGTGCTCAGGTA
GTGGTTGTCGGGCAGCAGCACGGGGCCGTCGCCGATGGGGGTGTTCTGCTGGTAGTGGTC
GGCGAGCTGCACGCTGCCGTCCTCGATGTTGTGGCGGATCTTGAAGTTCACCTTGATGCC
GTTCTTCTGCTTGTCGGCCATGATATAGACGTTGTGGCTGTTGTAGTTGTACTCCAGCTT
GTGCCCCAGGATGTTGCCGTCCTCCTTGAAGTCGATGCCCTTCAGCTCGATGCGGTTCAC
CAGGGTGTCGCCCTCGAACTTCACCTCGGCGCGGGTCTTGTAGTTGCCGTCGTCCTTGAA
GAAGATGGTGCGCTCCTGGA
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseFasta(text: string): { name: string; sequence: string }[] {
	const results: { name: string; sequence: string }[] = [];
	let name = "";
	let seqParts: string[] = [];
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.startsWith(">")) {
			if (name) results.push({ name, sequence: seqParts.join("") });
			name = trimmed.slice(1).split(/\s+/)[0] ?? "read";
			seqParts = [];
		} else if (trimmed && name) {
			seqParts.push(trimmed.replace(/[^ACGTNacgtn]/g, ""));
		}
	}
	if (name) results.push({ name, sequence: seqParts.join("") });
	if (results.length === 0 && text.trim()) {
		const seq = text.trim().replace(/[^ACGTNacgtn]/g, "");
		if (seq.length > 0) results.push({ name: "pasted_read", sequence: seq });
	}
	return results;
}

async function processFile(file: File, colorIdx: number): Promise<AlignRead[]> {
	const name = file.name.replace(/\.(ab1|abi|fasta?|fa)$/i, "");

	if (/\.(ab1|abi)$/i.test(file.name)) {
		const buffer = await file.arrayBuffer();
		const abif = parseAbif(buffer);
		if (!abif.sequence) throw new Error(`No sequence in ${file.name}`);
		return [
			{
				id: `${Date.now()}-${name}`,
				name,
				sequence: abif.sequence,
				quality: abif.qualityScores.length > 0 ? abif.qualityScores : undefined,
				traces: abif.traces.A.length > 0 ? abif.traces : undefined,
				peakPositions: abif.peakPositions.length > 0 ? abif.peakPositions : undefined,
				traceLength: abif.traceLength,
				color: READ_COLORS[colorIdx % READ_COLORS.length] ?? READ_COLORS[0] ?? "#0891b2",
			},
		];
	}

	const text = await file.text();
	const reads = parseFasta(text);
	return reads.map((r, i) => ({
		id: `${Date.now()}-${name}-${i}`,
		name: reads.length > 1 ? r.name : name,
		sequence: r.sequence,
		color: READ_COLORS[(colorIdx + i) % READ_COLORS.length] ?? READ_COLORS[0] ?? "#0891b2",
	}));
}

function parseReference(text: string): RefState | { error: string } {
	const trimmed = text.trim();
	if (!trimmed) return { error: "Empty input" };

	if (trimmed.includes("LOCUS") && trimmed.includes("ORIGIN")) {
		try {
			const parsed = parseGenBank(trimmed);
			if (parsed.seq.length === 0) return { error: "No sequence found in GenBank file" };
			return {
				name: parsed.name,
				seq: parsed.seq,
				topology: parsed.topology,
				annotations: parsed.annotations.map((a) => ({
					name: a.name,
					type: a.type,
					start: a.start,
					end: a.end,
					direction: a.direction,
				})),
			};
		} catch {
			// fall through
		}
	}

	if (trimmed.startsWith(">")) {
		const lines = trimmed.split("\n");
		const name = lines[0]?.slice(1).split(/\s+/)[0] ?? "reference";
		const seq = lines
			.slice(1)
			.join("")
			.replace(/[^ACGTNacgtn\s]/g, "")
			.replace(/\s/g, "")
			.toUpperCase();
		if (seq.length === 0) return { error: "No sequence found in FASTA" };
		if (seq.length < 10) return { error: "Reference too short" };
		return { name, seq, topology: "linear", annotations: [] };
	}

	const seq = trimmed
		.replace(/[^ACGTNacgtn\s]/g, "")
		.replace(/\s/g, "")
		.toUpperCase();
	if (seq.length < 10) return { error: "Input too short or contains invalid characters" };
	return { name: "reference", seq, topology: "linear", annotations: [] };
}

async function parseRefFile(file: File): Promise<RefState | { error: string }> {
	const text = await file.text();
	return parseReference(text);
}

function exportFasta(reads: AlignRead[]) {
	const content = reads.map((r) => `>${r.name}\n${r.sequence}`).join("\n");
	const blob = new Blob([content], { type: "text/plain" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = reads.length === 1 ? `${reads[0]?.name ?? "read"}.fasta` : "sanger_reads.fasta";
	a.click();
	URL.revokeObjectURL(url);
}

function qualityStats(reads: AlignRead[]): { meanQ: number; count: number } | null {
	const all: number[] = reads.flatMap((r) => r.quality ?? []);
	if (all.length === 0) return null;
	return {
		meanQ: Math.round(all.reduce((a, b) => a + b, 0) / all.length),
		count: all.length,
	};
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ReadCard({
	read,
	isTraceActive,
	onTrace,
	onRemove,
}: {
	read: AlignRead;
	isTraceActive: boolean;
	onTrace: () => void;
	onRemove: () => void;
}) {
	const r = read.result;
	return (
		<div
			style={{
				display: "flex",
				alignItems: "flex-start",
				gap: "10px",
				padding: "10px 14px",
				borderBottom: "1px solid rgba(221,216,206,0.5)",
			}}
		>
			<div
				style={{
					width: "8px",
					height: "8px",
					borderRadius: "50%",
					background: read.color,
					flexShrink: 0,
					marginTop: "4px",
				}}
			/>
			<div style={{ flex: 1, minWidth: 0 }}>
				<div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
					<span
						style={{
							fontFamily: "var(--font-courier)",
							fontSize: "11px",
							color: "#1c1a16",
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
							maxWidth: "220px",
						}}
					>
						{read.name}
					</span>
					<span
						style={{
							fontFamily: "var(--font-courier)",
							fontSize: "10px",
							color: "#9a9284",
						}}
					>
						{read.sequence.length} bp
					</span>
					{r && (
						<>
							<span
								style={{
									fontFamily: "var(--font-courier)",
									fontSize: "10px",
									color: r.strand === "+" ? "#1a4731" : "#7c3aed",
								}}
							>
								{r.strand} {r.refStart + 1}–{r.refEnd}
							</span>
							<span
								style={{
									fontFamily: "var(--font-courier)",
									fontSize: "10px",
									color:
										r.identity >= 0.99 ? "#1a4731" : r.identity >= 0.95 ? "#b8933a" : "#a02828",
								}}
							>
								{(r.identity * 100).toFixed(1)}%
							</span>
							{r.mismatches.length > 0 && (
								<span
									style={{
										fontFamily: "var(--font-courier)",
										fontSize: "10px",
										color: "#a02828",
									}}
								>
									{r.mismatches.length} mismatch{r.mismatches.length !== 1 ? "es" : ""}
								</span>
							)}
						</>
					)}
				</div>
				{r && r.mismatches.length > 0 && r.mismatches.length <= 6 && (
					<div style={{ marginTop: "3px", paddingLeft: "0" }}>
						{r.mismatches.map((m) => (
							<span
								key={`${m.refPos}-${m.refBase}-${m.queryBase}`}
								style={{
									fontFamily: "var(--font-courier)",
									fontSize: "9px",
									color: "#a02828",
									marginRight: "8px",
								}}
							>
								pos {m.refPos + 1}: {m.refBase}→{m.queryBase}
								{m.qualityScore !== undefined ? ` Q${m.qualityScore}` : ""}
							</span>
						))}
					</div>
				)}
			</div>
			<div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
				{read.traces && (
					<button
						type="button"
						onClick={onTrace}
						style={{
							fontFamily: "var(--font-courier)",
							fontSize: "9px",
							letterSpacing: "0.06em",
							color: isTraceActive ? "#1a4731" : "#9a9284",
							background: isTraceActive ? "rgba(26,71,49,0.08)" : "none",
							border: `1px solid ${isTraceActive ? "#1a4731" : "#c8c0b8"}`,
							borderRadius: "2px",
							cursor: "pointer",
							padding: "2px 6px",
						}}
					>
						TRACE
					</button>
				)}
				<button
					type="button"
					onClick={onRemove}
					style={{
						fontFamily: "var(--font-courier)",
						fontSize: "13px",
						color: "#9a9284",
						background: "none",
						border: "none",
						cursor: "pointer",
						padding: "0 2px",
						lineHeight: 1,
					}}
				>
					×
				</button>
			</div>
		</div>
	);
}

function VerdictCard({
	verifyState,
	onBack,
}: {
	verifyState: Extract<VerifyState, { status: "running" | "done" | "needsLogin" }>;
	onBack: () => void;
}) {
	const result = verifyState.status === "needsLogin" ? verifyState.result : verifyState.result;
	const cfg = result ? VERDICT_CONFIG[result.verdict] : null;
	const isStreaming = verifyState.status === "running";

	return (
		<div
			style={{
				background: "#faf7f2",
				border: "1px solid #ddd8ce",
				borderRadius: "4px",
				overflow: "hidden",
			}}
		>
			{cfg && result && (
				<div
					style={{
						display: "flex",
						alignItems: "flex-start",
						gap: "10px",
						padding: "12px 16px",
						background: cfg.bg,
						borderBottom: `1px solid ${cfg.border}`,
					}}
				>
					<span style={{ fontSize: "16px", color: cfg.color, lineHeight: 1.2, flexShrink: 0 }}>
						{cfg.icon}
					</span>
					<div style={{ flex: 1 }}>
						<div
							style={{
								fontFamily: "var(--font-courier)",
								fontSize: "10px",
								letterSpacing: "0.1em",
								textTransform: "uppercase",
								color: cfg.color,
								fontWeight: "bold",
								marginBottom: "4px",
							}}
						>
							{cfg.label}
						</div>
						<div
							style={{
								fontFamily: "var(--font-karla)",
								fontSize: "13px",
								color: "#5a5648",
								lineHeight: 1.5,
							}}
						>
							{result.verdictReason}
						</div>
					</div>
				</div>
			)}

			{/* Feature coverage table */}
			{result && result.featureCoverage.length > 0 && (
				<div style={{ padding: "12px 16px", borderBottom: "1px solid #ddd8ce" }}>
					<div
						style={{
							fontFamily: "var(--font-courier)",
							fontSize: "9px",
							letterSpacing: "0.08em",
							textTransform: "uppercase",
							color: "#9a9284",
							marginBottom: "8px",
						}}
					>
						Coverage
					</div>
					<div style={{ display: "flex", flexWrap: "wrap", gap: "6px 24px" }}>
						{result.featureCoverage.map((fc) => (
							<div
								key={`${fc.name}-${fc.start}`}
								style={{ display: "flex", alignItems: "baseline", gap: "6px" }}
							>
								<span
									style={{
										fontFamily: "var(--font-courier)",
										fontSize: "10px",
										color: "#5a5648",
									}}
								>
									{fc.name}
								</span>
								<span
									style={{
										fontFamily: "var(--font-courier)",
										fontSize: "10px",
										color: fc.fullySequenced
											? "#1a4731"
											: fc.coveredFraction > 0
												? "#b8933a"
												: "#a02828",
									}}
								>
									{fc.fullySequenced
										? "✓ full"
										: fc.coveredFraction > 0
											? `${(fc.coveredFraction * 100).toFixed(0)}%`
											: "✗ none"}
								</span>
							</div>
						))}
					</div>
				</div>
			)}

			{/* AI explanation or sign-in CTA */}
			<div style={{ padding: "14px 16px" }}>
				{verifyState.status === "needsLogin" ? (
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: "12px",
							padding: "10px 14px",
							background: "rgba(26,71,49,0.05)",
							border: "1px solid rgba(26,71,49,0.15)",
							borderRadius: "3px",
						}}
					>
						<span
							style={{
								fontFamily: "var(--font-karla)",
								fontSize: "13px",
								color: "#5a5648",
								flex: 1,
							}}
						>
							Sign in to get an AI explanation of this result.
						</span>
						<Link
							href="/login?next=/sanger"
							style={{
								fontFamily: "var(--font-courier)",
								fontSize: "10px",
								letterSpacing: "0.06em",
								textTransform: "uppercase",
								color: "#ffffff",
								background: "#1a4731",
								padding: "6px 14px",
								borderRadius: "3px",
								textDecoration: "none",
								flexShrink: 0,
							}}
						>
							Sign in
						</Link>
					</div>
				) : isStreaming && !("explanation" in verifyState && verifyState.explanation) ? (
					<span
						style={{
							display: "inline-flex",
							gap: "3px",
							alignItems: "center",
						}}
					>
						{[0, 1, 2].map((i) => (
							<span
								key={i}
								style={{
									width: "4px",
									height: "4px",
									borderRadius: "50%",
									background: "#9a9284",
									display: "inline-block",
									animation: `sangerPulse 1.2s ease-in-out ${i * 0.2}s infinite`,
								}}
							/>
						))}
					</span>
				) : "explanation" in verifyState && verifyState.explanation ? (
					<p
						style={{
							fontFamily: "var(--font-karla)",
							fontSize: "13px",
							color: "#1c1a16",
							lineHeight: 1.65,
							margin: 0,
						}}
					>
						{verifyState.explanation}
					</p>
				) : null}
			</div>

			<div
				style={{
					padding: "8px 16px",
					borderTop: "1px solid #ddd8ce",
					display: "flex",
					justifyContent: "flex-end",
				}}
			>
				<button
					type="button"
					onClick={onBack}
					style={{
						fontFamily: "var(--font-courier)",
						fontSize: "9px",
						letterSpacing: "0.06em",
						textTransform: "uppercase",
						color: "#5a5648",
						background: "none",
						border: "1px solid #ddd8ce",
						borderRadius: "2px",
						cursor: "pointer",
						padding: "4px 10px",
					}}
				>
					← Back
				</button>
			</div>
		</div>
	);
}

// ── Main component ────────────────────────────────────────────────────────────

export function SangerTool() {
	const [ref, setRef] = useState<RefState | null>(null);
	const [refInput, setRefInput] = useState("");
	const [refError, setRefError] = useState<string | null>(null);
	const [reads, setReads] = useState<AlignRead[]>([]);
	const [running, setRunning] = useState(false);
	const [alignError, setAlignError] = useState<string | null>(null);
	const [isDragging, setIsDragging] = useState(false);
	const [activeReadId, setActiveReadId] = useState<string | null>(null);
	const [verifyState, setVerifyState] = useState<VerifyState>({ status: "idle" });

	const workerRef = useRef<Worker | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const refFileInputRef = useRef<HTMLInputElement>(null);
	const abortVerifyRef = useRef<AbortController | null>(null);
	const mountedRef = useRef(true);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			workerRef.current?.terminate();
			abortVerifyRef.current?.abort();
		};
	}, []);

	// ── Reference handling ────────────────────────────────────────────────────

	const applyRefText = useCallback((text: string) => {
		const result = parseReference(text);
		if ("error" in result) {
			setRefError(result.error);
		} else {
			setRef(result);
			setRefError(null);
			setRefInput("");
			setVerifyState({ status: "idle" });
		}
	}, []);

	const handleRefFile = useCallback(async (file: File) => {
		const result = await parseRefFile(file);
		if ("error" in result) {
			setRefError(result.error);
		} else {
			setRef(result);
			setRefError(null);
			setRefInput("");
			setVerifyState({ status: "idle" });
		}
	}, []);

	const clearRef = useCallback(() => {
		setRef(null);
		setRefInput("");
		setRefError(null);
		setVerifyState({ status: "idle" });
		// Clear alignment results since reference is gone
		setReads((prev) => prev.map((r) => ({ ...r, result: undefined })));
	}, []);

	// ── Reads handling ────────────────────────────────────────────────────────

	const addFiles = useCallback(
		async (files: FileList | File[]) => {
			setAlignError(null);
			const incoming: AlignRead[] = [];
			for (const file of Array.from(files)) {
				try {
					const newReads = await processFile(file, reads.length + incoming.length);
					incoming.push(...newReads);
				} catch (e) {
					setAlignError(`Error reading ${file.name}: ${(e as Error).message}`);
				}
			}
			if (incoming.length > 0) {
				setReads((prev) => [...prev, ...incoming]);
				setVerifyState({ status: "idle" });
			}
		},
		[reads.length],
	);

	const removeRead = useCallback(
		(id: string) => {
			if (activeReadId === id) setActiveReadId(null);
			setReads((prev) => prev.filter((r) => r.id !== id));
			setVerifyState({ status: "idle" });
		},
		[activeReadId],
	);

	const loadExample = useCallback(() => {
		applyRefText(EXAMPLE_REF_FASTA);
		setReads([]);
		setActiveReadId(null);
		setVerifyState({ status: "idle" });
		const fwd = new File([EXAMPLE_FWD_READ_FASTA], "EGFP_fwd_M13F.fasta", {
			type: "text/plain",
		});
		const rev = new File([EXAMPLE_REV_READ_FASTA], "EGFP_rev_M13R.fasta", {
			type: "text/plain",
		});
		void addFiles([fwd, rev]);
	}, [applyRefText, addFiles]);

	const toggleTrace = useCallback((id: string) => {
		setActiveReadId((prev) => (prev === id ? null : id));
	}, []);

	// ── Drag and drop ─────────────────────────────────────────────────────────

	const onDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			setIsDragging(false);
			if (e.dataTransfer.files.length > 0) void addFiles(e.dataTransfer.files);
		},
		[addFiles],
	);

	// ── Alignment ─────────────────────────────────────────────────────────────

	const runAlignment = useCallback(() => {
		if (reads.length === 0 || !ref) return;
		setRunning(true);
		setAlignError(null);
		setVerifyState({ status: "idle" });
		workerRef.current?.terminate();

		const worker = new Worker(
			new URL("../../components/sequence/align.worker.ts", import.meta.url),
		);
		workerRef.current = worker;

		const request: AlignWorkerRequest = {
			reads: reads.map((r) => ({ name: r.name, sequence: r.sequence, quality: r.quality })),
			reference: ref.seq,
			topology: ref.topology,
		};
		worker.postMessage(request);

		worker.onmessage = (e: MessageEvent<AlignWorkerResponse>) => {
			worker.terminate();
			workerRef.current = null;
			if (e.data.type === "success") {
				const { results } = e.data;
				setReads((prev) => prev.map((r, i) => ({ ...r, result: results[i] })));
			} else {
				setAlignError(e.data.message);
			}
			setRunning(false);
		};
		worker.onerror = () => {
			worker.terminate();
			workerRef.current = null;
			setAlignError("Alignment failed");
			setRunning(false);
		};
	}, [reads, ref]);

	// ── Clone verification ────────────────────────────────────────────────────

	const runVerification = useCallback(async () => {
		if (!ref || !reads.some((r) => r.result)) return;

		abortVerifyRef.current?.abort();
		setVerifyState({ status: "running", result: undefined, explanation: "" });

		const verResult = verifyClone(ref.seq, ref.topology, ref.name, ref.annotations, reads);

		setVerifyState({ status: "running", result: verResult, explanation: "" });

		const ac = new AbortController();
		abortVerifyRef.current = ac;

		try {
			const res = await fetch("/api/verify-clone", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					result: verResult,
					context: {
						name: ref.name,
						seqLen: ref.seq.length,
						topology: ref.topology,
						annotations: ref.annotations,
					},
				}),
				signal: ac.signal,
			});

			if (res.status === 401) {
				if (mountedRef.current) {
					setVerifyState({ status: "needsLogin", result: verResult });
				}
				return;
			}

			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			if (!res.body) throw new Error("No response body");

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let text = "";

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				text += decoder.decode(value, { stream: true });
				if (mountedRef.current) {
					setVerifyState({ status: "running", result: verResult, explanation: text });
				}
			}

			if (mountedRef.current) {
				setVerifyState({ status: "done", result: verResult, explanation: text });
			}
		} catch (e) {
			if ((e as Error).name === "AbortError") return;
			if (mountedRef.current) {
				setVerifyState({ status: "error", message: (e as Error).message });
			}
		}
	}, [ref, reads]);

	// ── Derived state ─────────────────────────────────────────────────────────

	const activeRead = reads.find((r) => r.id === activeReadId) ?? null;
	const hasAlignment = reads.some((r) => r.result);
	const stats = qualityStats(reads);

	// ── Render ────────────────────────────────────────────────────────────────

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

			{/* Page content */}
			<main
				style={{ flex: 1, padding: "32px", maxWidth: "1200px", margin: "0 auto", width: "100%" }}
			>
				{/* Description */}
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
						View .ab1 chromatograms and quality traces. Optionally provide a reference sequence to
						align reads and check coverage.
					</p>
				</div>

				{/* Input grid */}
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "1fr 1fr",
						gap: "20px",
						marginBottom: "24px",
					}}
				>
					{/* Reference section */}
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
								Reference Sequence
							</span>
							<span
								style={{
									fontFamily: "var(--font-courier)",
									fontSize: "8px",
									color: "#b8b0a4",
									letterSpacing: "0.04em",
								}}
							>
								optional
							</span>
							{ref && (
								<button
									type="button"
									onClick={clearRef}
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
							{ref ? (
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
										{ref.name}
									</span>
									<span
										style={{
											fontFamily: "var(--font-courier)",
											fontSize: "10px",
											color: "#9a9284",
											flexShrink: 0,
										}}
									>
										{ref.seq.length.toLocaleString()} bp
									</span>
									<span
										style={{
											fontFamily: "var(--font-courier)",
											fontSize: "9px",
											color: ref.topology === "circular" ? "#1a4731" : "#5a5648",
											border: `1px solid ${ref.topology === "circular" ? "rgba(26,71,49,0.3)" : "#ddd8ce"}`,
											padding: "1px 5px",
											borderRadius: "2px",
											flexShrink: 0,
										}}
									>
										{ref.topology === "circular" ? "○ circular" : "— linear"}
									</span>
									{ref.annotations.length > 0 && (
										<span
											style={{
												fontFamily: "var(--font-courier)",
												fontSize: "9px",
												color: "#9a9284",
												flexShrink: 0,
											}}
										>
											{ref.annotations.length} features
										</span>
									)}
								</div>
							) : (
								<>
									<textarea
										value={refInput}
										onChange={(e) => setRefInput(e.target.value)}
										placeholder="Paste GenBank, FASTA, or raw DNA sequence..."
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
											disabled={!refInput.trim()}
											onClick={() => applyRefText(refInput)}
											style={{
												...btnStyle,
												background: refInput.trim() ? "#1a4731" : "#c8c0b8",
												color: "white",
												cursor: refInput.trim() ? "pointer" : "default",
											}}
										>
											Use as reference
										</button>
										<button
											type="button"
											onClick={() => refFileInputRef.current?.click()}
											style={{
												...btnStyle,
												background: "none",
												border: "1px solid #ddd8ce",
												color: "#5a5648",
											}}
										>
											Upload file
										</button>
										<button
											type="button"
											onClick={loadExample}
											style={{
												...btnStyle,
												background: "none",
												border: "1px solid #ddd8ce",
												color: "#1a4731",
											}}
											title="Load EGFP CDS + two demo Sanger reads (forward + reverse)"
										>
											Load example
										</button>
										<input
											ref={refFileInputRef}
											type="file"
											accept=".gb,.gbk,.genbank,.fa,.fasta,.fna,.txt"
											style={{ display: "none" }}
											onChange={(e) => {
												const file = e.target.files?.[0];
												if (file) void handleRefFile(file);
												e.target.value = "";
											}}
										/>
									</div>
								</>
							)}

							{refError && (
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
									{refError}
								</div>
							)}
						</div>
					</div>

					{/* Reads section */}
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
								Sequencing Reads
							</span>
							{reads.length > 0 && (
								<span
									style={{
										fontFamily: "var(--font-courier)",
										fontSize: "9px",
										color: "#b8b0a4",
									}}
								>
									{reads.length}
								</span>
							)}
							{stats && (
								<span
									style={{
										fontFamily: "var(--font-courier)",
										fontSize: "9px",
										color:
											stats.meanQ >= 30 ? "#1a4731" : stats.meanQ >= 20 ? "#b8933a" : "#a02828",
										marginLeft: "4px",
									}}
								>
									mean Q{stats.meanQ}
								</span>
							)}
						</div>

						<div style={{ padding: "14px 16px" }}>
							{/* Drop zone */}
							<button
								type="button"
								onClick={() => fileInputRef.current?.click()}
								onDragOver={(e) => {
									e.preventDefault();
									setIsDragging(true);
								}}
								onDragLeave={() => setIsDragging(false)}
								onDrop={onDrop}
								style={{
									width: "100%",
									textAlign: "center",
									border: `1px dashed ${isDragging ? "#1a4731" : "#c8c0b8"}`,
									borderRadius: "3px",
									padding: "14px 10px",
									cursor: "pointer",
									background: isDragging ? "rgba(26,71,49,0.04)" : "transparent",
									marginBottom: reads.length > 0 ? "12px" : "0",
									transition: "all 0.15s",
								}}
							>
								<span
									style={{
										fontFamily: "var(--font-courier)",
										fontSize: "10px",
										color: "#9a9284",
										letterSpacing: "0.04em",
									}}
								>
									Drop .ab1 or .fasta files here
								</span>
								<br />
								<span
									style={{ fontFamily: "var(--font-courier)", fontSize: "9px", color: "#b8b0a4" }}
								>
									or click to browse — .ab1 files include chromatogram traces
								</span>
							</button>
							<input
								ref={fileInputRef}
								type="file"
								multiple
								style={{ display: "none" }}
								onChange={(e) => e.target.files && void addFiles(e.target.files)}
							/>

							{/* Read list */}
							{reads.length > 0 && (
								<div
									style={{
										border: "1px solid #ddd8ce",
										borderRadius: "3px",
										overflow: "hidden",
										marginBottom: "10px",
									}}
								>
									{reads.map((r) => (
										<ReadCard
											key={r.id}
											read={r}
											isTraceActive={activeReadId === r.id}
											onTrace={() => toggleTrace(r.id)}
											onRemove={() => removeRead(r.id)}
										/>
									))}
								</div>
							)}

							{alignError && (
								<div
									style={{
										marginBottom: "10px",
										fontFamily: "var(--font-courier)",
										fontSize: "10px",
										color: "#a02828",
										background: "rgba(160,40,40,0.06)",
										border: "1px solid rgba(160,40,40,0.2)",
										borderRadius: "2px",
										padding: "6px 10px",
									}}
								>
									{alignError}
								</div>
							)}

							{reads.length > 0 && (
								<div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
									{ref && (
										<button
											type="button"
											disabled={running}
											onClick={runAlignment}
											style={{
												...btnStyle,
												background: running ? "#2d7a54" : "#1a4731",
												color: "white",
												opacity: running ? 0.75 : 1,
											}}
										>
											{running
												? "Aligning…"
												: `Align ${reads.length} read${reads.length !== 1 ? "s" : ""}`}
										</button>
									)}
									<button
										type="button"
										onClick={() => exportFasta(reads)}
										style={{
											...btnStyle,
											background: "none",
											border: "1px solid #ddd8ce",
											color: "#5a5648",
										}}
									>
										Export FASTA
									</button>
									<button
										type="button"
										onClick={() => {
											setReads([]);
											setActiveReadId(null);
											setVerifyState({ status: "idle" });
										}}
										style={{
											...btnStyle,
											background: "none",
											border: "1px solid #ddd8ce",
											color: "#9a9284",
										}}
									>
										Clear all
									</button>
								</div>
							)}
						</div>
					</div>
				</div>

				{/* Chromatogram */}
				{activeRead?.traces && (
					<div style={{ marginBottom: "24px" }}>
						<Chromatogram
							name={activeRead.name}
							sequence={activeRead.sequence}
							quality={activeRead.quality}
							peakPositions={activeRead.peakPositions ?? []}
							traceLength={activeRead.traceLength ?? 0}
							traces={activeRead.traces}
							result={activeRead.result}
							onClose={() => setActiveReadId(null)}
						/>
					</div>
				)}

				{/* Verify section */}
				{hasAlignment && ref && (
					<div>
						{verifyState.status === "idle" ? (
							<button
								type="button"
								onClick={() => void runVerification()}
								style={{
									...btnStyle,
									background: "#f5f0e8",
									border: "1px solid #ddd8ce",
									color: "#5a5648",
								}}
							>
								Verify Clone
							</button>
						) : verifyState.status === "error" ? (
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: "12px",
									padding: "10px 14px",
									background: "rgba(160,40,40,0.06)",
									border: "1px solid rgba(160,40,40,0.2)",
									borderRadius: "3px",
								}}
							>
								<span
									style={{
										fontFamily: "var(--font-courier)",
										fontSize: "10px",
										color: "#a02828",
										flex: 1,
									}}
								>
									{verifyState.message}
								</span>
								<button
									type="button"
									onClick={() => setVerifyState({ status: "idle" })}
									style={{
										...btnStyle,
										background: "none",
										border: "1px solid rgba(160,40,40,0.3)",
										color: "#a02828",
									}}
								>
									Retry
								</button>
							</div>
						) : (
							<VerdictCard
								verifyState={verifyState}
								onBack={() => setVerifyState({ status: "idle" })}
							/>
						)}
					</div>
				)}
			</main>

			<style>{`
				@keyframes sangerPulse {
					0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
					40% { opacity: 1; transform: scale(1); }
				}
			`}</style>
		</div>
	);
}
