"use client";

import type { PrimerPair } from "@shandley/primd";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	loadAnnotationOverrides,
	saveAnnotationOverrides,
} from "@/app/actions/annotation-overrides";
import type { SequenceContext } from "@/app/api/chat/route";
import { CloningModal } from "@/components/cloning/cloning-modal";
import type { Annotation } from "@/lib/bio/annotate";
import { DEFAULT_ENZYMES } from "@/lib/bio/enzymes";
import { type ParsedSequence, parseGenBank } from "@/lib/bio/parse-genbank";
import type { SearchMatch } from "@/lib/bio/search";
import { downloadGenBank, serializeGenBank } from "@/lib/bio/serialize-genbank";
import { AIPanel } from "./ai-panel";
import type { AlignRead } from "./align-panel";
import { AlignPanel } from "./align-panel";
import {
	AnnotationEditor,
	type AnnotationLike,
	type AnnotationOverride,
	annKey,
	applyOverrides,
	loadOverrides,
	type OverrideMap,
	saveOverrides,
} from "./annotation-editor";
import { Chromatogram } from "./chromatogram";
import type { PrimerPlotsData } from "@/components/primer-viz/primer-plots-drawer";
import { PrimerPlotsDrawer } from "@/components/primer-viz/primer-plots-drawer";
import { DigestPanel } from "./digest-panel";
import { EnzymePanel } from "./enzyme-panel";
import { GCPanel } from "./gc-panel";
import { ORFPanel } from "./orf-panel";
import { PrimerPanel } from "./primer-panel";
import { SearchPanel } from "./search-panel";
import { SequenceViewer, type SeqVizSelection } from "./sequence-viewer";
import { type TranslationTarget, TranslationView } from "./translation-view";

interface SequenceViewerWithPanelProps {
	fileUrl: string;
	name: string;
	topology: "circular" | "linear";
	fileFormat: string;
	gcContent: number | null;
	/** When provided, annotation overrides are persisted to Supabase instead of localStorage. */
	sequenceId?: string | null;
}

type PanelTab = "enzymes" | "primers" | "digest" | "orfs" | "search" | "ai" | "align" | "gc";

const TAB_LABELS: Record<PanelTab, string> = {
	enzymes: "Enzymes",
	primers: "Primers",
	digest: "Digest",
	orfs: "ORFs",
	search: "Search",
	ai: "AI",
	align: "Align",
	gc: "GC",
};

export function SequenceViewerWithPanel({
	fileUrl,
	name,
	topology,
	fileFormat,
	gcContent,
	sequenceId = null,
}: SequenceViewerWithPanelProps) {
	const [parsed, setParsed] = useState<ParsedSequence | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [selectedEnzymes, setSelectedEnzymes] = useState<string[]>(DEFAULT_ENZYMES);
	const [activeTab, setActiveTab] = useState<PanelTab>("enzymes");
	const [selection, setSelection] = useState<SeqVizSelection | null>(null);
	const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
	const [bestPair, setBestPair] = useState<PrimerPair | null>(null);
	const [annotationName, setAnnotationName] = useState<string | null>(null);
	const [alignedReads, setAlignedReads] = useState<AlignRead[]>([]);
	const [selectedAlignRead, setSelectedAlignRead] = useState<AlignRead | null>(null);
	const [translationTarget, setTranslationTarget] = useState<TranslationTarget | null>(null);
	const [primerPlotsData, setPrimerPlotsData] = useState<PrimerPlotsData | null>(null);
	const [selectedAnnotation, setSelectedAnnotation] = useState<AnnotationLike | null>(null);
	const [showAnnotationEditor, setShowAnnotationEditor] = useState(false);
	const [overrides, setOverrides] = useState<OverrideMap>({});
	const [autoAnnotations, setAutoAnnotations] = useState<Annotation[]>([]);
	const [annotating, setAnnotating] = useState(false);
	const annotationWorkerRef = useRef<Worker | null>(null);

	// Alt+1–8: switch panel tabs
	useEffect(() => {
		const TABS: PanelTab[] = ["enzymes", "primers", "digest", "align", "orfs", "search", "ai", "gc"];
		const handler = (e: KeyboardEvent) => {
			if (!e.altKey) return;
			const n = parseInt(e.key, 10);
			if (n >= 1 && n <= TABS.length) {
				e.preventDefault();
				setActiveTab(TABS[n - 1]!);
				setShowAnnotationEditor(false);
			}
		};
		document.addEventListener("keydown", handler);
		return () => document.removeEventListener("keydown", handler);
	}, []);

	// Load persisted overrides on mount — Supabase when sequenceId available, else localStorage
	useEffect(() => {
		if (sequenceId) {
			loadAnnotationOverrides(sequenceId)
				.then(setOverrides)
				.catch(() => {
					setOverrides(loadOverrides(fileUrl));
				});
		} else {
			setOverrides(loadOverrides(fileUrl));
		}
	}, [sequenceId, fileUrl]);

	const handleSearchMatches = useCallback((matches: SearchMatch[]) => {
		setSearchMatches(matches);
	}, []);

	// Feature types that should show translation instead of primer design
	const CDS_TYPES = new Set(["CDS", "mat_peptide", "sig_peptide", "transit_peptide"]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: CDS_TYPES is stable
	const handleSelection = useCallback(
		(sel: SeqVizSelection | null) => {
			setSelection(sel);
			if (sel?.type === "ANNOTATION" && sel.name) {
				// Search post-override annotations so renamed annotations are found correctly
				const displayed = applyOverrides(
					[...(parsed?.annotations ?? []), ...autoAnnotations],
					overrides,
				);
				const matches = displayed.filter((a) => a.name === sel.name);
				const ann = matches.find((a) => CDS_TYPES.has(a.type)) ?? matches[0];

				setSelectedAnnotation(ann ?? null);
				setShowAnnotationEditor(false);

				if (ann && CDS_TYPES.has(ann.type)) {
					setTranslationTarget({
						name: ann.name,
						start: ann.start,
						end: ann.end,
						direction: ann.direction,
						type: ann.type,
					});
					setSelectedAlignRead(null);
				} else {
					setTranslationTarget(null);
					setActiveTab("primers");
					setAnnotationName(sel.name);
				}
			} else {
				setAnnotationName(null);
				setSelectedAnnotation(null);
				setShowAnnotationEditor(false);
			}
		},
		[parsed, autoAnnotations, overrides],
	);

	useEffect(() => {
		fetch(fileUrl)
			.then((r) => {
				if (!r.ok) throw new Error(`Failed to fetch sequence (${r.status})`);
				return r.text();
			})
			.then((text) => {
				if (fileFormat === "genbank") {
					const p = parseGenBank(text);
					setParsed({ ...p, name });
				} else if (fileFormat === "fasta") {
					const lines = text.split("\n");
					const seqName = lines[0]?.replace(/^>/, "").split(" ")[0] ?? name;
					const seq = lines.slice(1).join("").replace(/\s/g, "").toUpperCase();
					setParsed({ name: seqName, seq, annotations: [], topology });
				} else {
					throw new Error(`Unsupported format: ${fileFormat}`);
				}
			})
			.catch((e: Error) => setError(e.message));
	}, [fileUrl, name, fileFormat, topology]);

	// Launch annotation worker whenever the sequence changes
	useEffect(() => {
		if (!parsed?.seq) return;
		setAutoAnnotations([]);
		setAnnotating(true);
		annotationWorkerRef.current?.terminate();
		const worker = new Worker(new URL("./annotation.worker.ts", import.meta.url));
		annotationWorkerRef.current = worker;
		worker.postMessage({ seq: parsed.seq });
		worker.onmessage = (e: MessageEvent<{ type: string; annotations?: Annotation[] }>) => {
			if (e.data.type === "success" && e.data.annotations) {
				setAutoAnnotations(e.data.annotations);
			}
			setAnnotating(false);
			worker.terminate();
			annotationWorkerRef.current = null;
		};
		worker.onerror = () => {
			setAnnotating(false);
			worker.terminate();
			annotationWorkerRef.current = null;
		};
		return () => {
			worker.terminate();
			annotationWorkerRef.current = null;
		};
	}, [parsed?.seq]);

	if (error) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-3">
				<span className="text-sm text-destructive">{error}</span>
				<a
					href="/dashboard"
					style={{
						fontFamily: "var(--font-courier)",
						fontSize: "9px",
						letterSpacing: "0.08em",
						textTransform: "uppercase",
						color: "#5a5648",
						textDecoration: "none",
						border: "1px solid #ddd8ce",
						padding: "3px 10px",
						borderRadius: "2px",
					}}
				>
					← Back to library
				</a>
			</div>
		);
	}

	if (!parsed) {
		return (
			<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
				Loading sequence…
			</div>
		);
	}

	const aiContext: SequenceContext = {
		name,
		seqLen: parsed.seq.length,
		topology,
		gc: gcContent,
		fileFormat,
		annotations: parsed.annotations.map((a) => ({
			name: a.name,
			start: a.start,
			end: a.end,
			direction: a.direction,
		})),
		seq: parsed.seq,
	};

	// Deduplicate auto-annotations against GenBank annotations already in the file.
	// Two rules:
	//   1. Same name (case-insensitive) + any positional overlap → suppress.
	//      Prevents luc+/luc+ and AmpR/AmpR doubles when GenBank already labels it.
	//   2. Different name + >60% positional overlap → suppress.
	//      Prevents pMB1-ori shadowing a pBR322-ori already in the file.
	// Suppress any auto-annotation that substantially overlaps an existing
	// GenBank annotation — regardless of name. This handles three cases:
	//   1. Exact match: GenBank "luc+" overlaps auto "luc+" (same gene, same coords)
	//   2. Name mismatch: GenBank "luc+" overlaps auto "luciferase" (same gene, different alias)
	//   3. RC false positive: reverse-complement hit lands at a different position
	//      with no overlap → NOT suppressed (correctly shown as a new find)
	// Threshold 0.5: at least half of the shorter annotation must overlap.
	// Override save/delete — Supabase when sequenceId present, localStorage fallback
	const persistOverrides = (next: OverrideMap) => {
		if (sequenceId) {
			void saveAnnotationOverrides(sequenceId, next);
		} else {
			saveOverrides(fileUrl, next);
		}
	};

	const handleOverrideSave = (key: string, override: AnnotationOverride) => {
		const next = { ...overrides, [key]: { ...overrides[key], ...override } };
		setOverrides(next);
		persistOverrides(next);
		if (selectedAnnotation && annKey(selectedAnnotation) === key) {
			setSelectedAnnotation({ ...selectedAnnotation, ...override });
		}
	};

	const handleOverrideDelete = (key: string) => {
		const next = { ...overrides, [key]: { ...overrides[key], deleted: true } };
		setOverrides(next);
		persistOverrides(next);
		setSelectedAnnotation(null);
	};

	// Apply user overrides to GenBank and auto-annotations
	const baseAnnotations = applyOverrides(parsed.annotations, overrides);

	const dedupedAuto = applyOverrides(autoAnnotations, overrides).filter((auto) => {
		return !parsed.annotations.some((existing) => {
			const overlapStart = Math.max(existing.start, auto.start);
			const overlapEnd = Math.min(existing.end, auto.end);
			if (overlapEnd <= overlapStart) return false;
			const overlapLen = overlapEnd - overlapStart;
			const minLen = Math.min(existing.end - existing.start, auto.end - auto.start);
			return minLen > 0 && overlapLen / minLen > 0.5;
		});
	});

	// Merge search hit annotations into the parsed sequence for highlighting
	// Aligned reads as annotations (coverage region + mismatch markers)
	const alignAnnotations = alignedReads.flatMap((r) => {
		if (!r.visible || !r.result) return [];
		const { refStart, refEnd, strand, identity, mismatches } = r.result;
		const anns = [
			{
				start: refStart,
				end: refEnd,
				name: `${r.name} (${(identity * 100).toFixed(1)}%)`,
				color: r.color,
				direction: (strand === "+" ? 1 : -1) as 1 | -1,
				type: "alignment",
			},
		];
		// Mismatch markers as 1-bp red annotations
		for (const m of mismatches) {
			anns.push({
				start: m.refPos,
				end: m.refPos + 1,
				name: `${m.refBase}→${m.queryBase}`,
				color: "#dc2626",
				direction: 1 as const,
				type: "mismatch",
			});
		}
		return anns;
	});

	// Primer pair as annotations on the map (set from the PRIMERS tab best pair)
	const primerAnnotations = bestPair
		? [
				{
					start: bestPair.fwd.start,
					end: bestPair.fwd.end,
					name: `Fwd primer`,
					color: "#0891b2",
					direction: 1 as const,
					type: "primer",
				},
				{
					start: bestPair.rev.start,
					end: bestPair.rev.end,
					name: `Rev primer`,
					color: "#b45309",
					direction: -1 as const,
					type: "primer",
				},
			]
		: [];

	// Build the annotation-merged parsed object (GenBank overridden + auto + search hits)
	const parsedWithAll = {
		...parsed,
		annotations: [
			...baseAnnotations,
			...alignAnnotations,
			...dedupedAuto.map((a) => ({
				start: a.start,
				end: a.end,
				name: a.name,
				color: a.color,
				direction: a.direction,
				type: a.type,
			})),
			...searchMatches.map((m, i) => ({
				start: m.start,
				end: m.end,
				name: `Hit ${i + 1}`,
				color: "#f5a623",
				direction: (m.strand === "+" ? 1 : -1) as 1 | -1,
				type: "search_hit",
			})),
			...primerAnnotations,
		],
	};

	const parsedWithSearch = parsedWithAll;

	return (
		<div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
			<div style={{ display: "flex", flex: 1, overflow: "hidden", minHeight: 0 }}>
				{/* Sequence viewer */}
				<div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
					<SequenceViewer
						parsed={parsedWithSearch}
						topology={topology}
						enzymes={selectedEnzymes}
						selection={selection}
						onSelection={handleSelection}
						primerPair={bestPair}
					/>
					{/* Annotation status badge */}
					{(annotating || dedupedAuto.length > 0) && (
						<div
							style={{
								position: "absolute",
								top: "10px",
								right: "12px",
								display: "flex",
								alignItems: "center",
								gap: "5px",
								background: "rgba(245,240,232,0.92)",
								border: "1px solid #ddd8ce",
								borderRadius: "3px",
								padding: "3px 8px",
								fontFamily: "var(--font-courier)",
								fontSize: "8px",
								letterSpacing: "0.06em",
								color: annotating ? "#9a9284" : "#2d7a54",
								backdropFilter: "blur(4px)",
								pointerEvents: "none",
							}}
						>
							{annotating ? (
								<>
									<span
										style={{
											display: "inline-block",
											width: "6px",
											height: "6px",
											borderRadius: "50%",
											border: "1.5px solid #9a9284",
											borderTopColor: "transparent",
											animation: "spin 0.8s linear infinite",
										}}
									/>
									detecting features
								</>
							) : (
								<>
									<span style={{ color: "#2d7a54" }}>●</span>
									{dedupedAuto.length} auto-detected feature{dedupedAuto.length !== 1 ? "s" : ""}
								</>
							)}
						</div>
					)}
				</div>

				{/* Right panel */}
				<aside
					style={{
						width: "244px",
						flexShrink: 0,
						borderLeft: "1px solid #ddd8ce",
						background: "#faf7f2",
						display: "flex",
						flexDirection: "column",
						overflow: "hidden",
					}}
				>
					{/* Clone + Download annotated */}
					<div
						style={{
							padding: "8px 12px",
							borderBottom: "1px solid #ddd8ce",
							flexShrink: 0,
							background: "#f5f0e8",
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							gap: "8px",
						}}
					>
						<button
							type="button"
							title="Download GenBank with all detected and edited annotations"
							onClick={() => {
								const gb = serializeGenBank({
									name,
									seq: parsed.seq,
									topology,
									description: parsed.name,
									annotations: baseAnnotations,
									autoAnnotations: dedupedAuto,
								});
								downloadGenBank(gb, `${name}_annotated`);
							}}
							style={{
								fontFamily: "var(--font-courier)",
								fontSize: "8px",
								letterSpacing: "0.08em",
								textTransform: "uppercase",
								color: "#5a5648",
								background: "none",
								border: "1px solid #ddd8ce",
								borderRadius: "2px",
								cursor: "pointer",
								padding: "4px 8px",
							}}
						>
							↓ Export .gb
						</button>
						<CloningModal seq={parsed.seq} seqName={name} topology={topology} />
					</div>

					{/* Tab bar — two rows of 3 tabs each */}
					<div style={{ flexShrink: 0, background: "#f5f0e8", borderBottom: "1px solid #ddd8ce" }}>
						{[
							["enzymes", "primers", "digest"] as PanelTab[],
							["align", "orfs", "search", "ai", "gc"] as PanelTab[],
						].map((row, rowIdx) => (
							<div
								key={rowIdx}
								style={{
									display: "flex",
									borderBottom: rowIdx === 0 ? "1px solid rgba(221,216,206,0.4)" : undefined,
								}}
							>
								{row.map((tab, tabIdx) => {
									const TABS: PanelTab[] = ["enzymes", "primers", "digest", "align", "orfs", "search", "ai", "gc"];
									const globalIdx = TABS.indexOf(tab) + 1;
									return (
									<button
										type="button"
										key={tab}
										title={`${TAB_LABELS[tab]} (Alt+${globalIdx})`}
										onClick={() => { setActiveTab(tab); setShowAnnotationEditor(false); }}
										style={{
											flex: 1,
											padding: "8px 0",
											fontFamily: "var(--font-courier)",
											fontSize: "7.5px",
											letterSpacing: "0.08em",
											textTransform: "uppercase",
											color: activeTab === tab ? "#1a4731" : "#9a9284",
											background: activeTab === tab ? "rgba(26,71,49,0.05)" : "none",
											border: "none",
											borderBottom:
												activeTab === tab ? "2px solid #1a4731" : "2px solid transparent",
											cursor: "pointer",
											transition: "color 0.1s",
											marginBottom: "-1px",
											position: "relative",
										}}
									>
										{TAB_LABELS[tab]}
										{tab === "primers" && selection !== null && (
											<span
												aria-hidden="true"
												style={{
													display: "inline-block",
													width: "4px",
													height: "4px",
													borderRadius: "50%",
													background: "#b8933a",
													marginLeft: "4px",
													verticalAlign: "middle",
													marginBottom: "1px",
												}}
											/>
										)}
										{tab === "search" && searchMatches.length > 0 && (
											<span
												aria-hidden="true"
												style={{
													display: "inline-block",
													width: "4px",
													height: "4px",
													borderRadius: "50%",
													background: "#f5a623",
													marginLeft: "4px",
													verticalAlign: "middle",
													marginBottom: "1px",
												}}
											/>
										)}
									</button>
								);
								})}
							</div>
						))}
					</div>

					{/* Global keyboard hint — persists across all panels */}
					<div
						style={{
							padding: "3px 12px",
							borderBottom: "1px solid rgba(221,216,206,0.4)",
							fontFamily: "var(--font-courier)",
							fontSize: "7px",
							color: "#9a9284",
							letterSpacing: "0.04em",
							flexShrink: 0,
							textAlign: "right",
						}}
					>
						Alt+1–8 · switch panels
					</div>

					{/* Panel content */}
					<div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
						{/* Annotation editor — inside content area, below the tab bar.
						    Triggered explicitly via the ✎ button in the Primers panel,
						    never auto-opened on annotation click. Tab bar stays stable. */}
						{showAnnotationEditor && selectedAnnotation && (
							<AnnotationEditor
								annotation={selectedAnnotation}
								onSave={handleOverrideSave}
								onDelete={handleOverrideDelete}
								onClose={() => setShowAnnotationEditor(false)}
							/>
						)}
						{activeTab === "enzymes" && (
							<EnzymePanel
								seq={parsed.seq}
								circular={topology === "circular"}
								selected={selectedEnzymes}
								onChange={setSelectedEnzymes}
							/>
						)}
						{activeTab === "primers" && (
							<PrimerPanel
								seq={parsed.seq}
								seqLen={parsed.seq.length}
								topology={topology}
								sequenceName={name}
								selectionStart={selection?.start}
								selectionEnd={selection?.end}
								onPrimersDesigned={setBestPair}
								annotationName={annotationName}
								onShowPlots={setPrimerPlotsData}
								onEditAnnotation={selectedAnnotation ? () => setShowAnnotationEditor(true) : undefined}
								crisprUrl={
									selectedAnnotation && parsed.seq.length > 0 &&
									selectedAnnotation.end - selectedAnnotation.start <= 8000
										? `/crispr?seq=${encodeURIComponent(
												parsed.seq.slice(selectedAnnotation.start, selectedAnnotation.end),
											)}&name=${encodeURIComponent(selectedAnnotation.name)}`
										: undefined
								}
							/>
						)}
						{activeTab === "digest" && (
							<DigestPanel seq={parsed.seq} topology={topology} primerPair={bestPair} />
						)}
						{activeTab === "align" && (
							<AlignPanel
								seq={parsed.seq}
								topology={topology}
								sequenceName={name}
								annotations={[...baseAnnotations, ...dedupedAuto]}
								onAlignmentResults={setAlignedReads}
								onReadSelect={setSelectedAlignRead}
							/>
						)}
						{activeTab === "orfs" && <ORFPanel seq={parsed.seq} topology={topology} />}
						{activeTab === "search" && (
							<SearchPanel seq={parsed.seq} topology={topology} onMatches={handleSearchMatches} />
						)}
						{activeTab === "ai" && <AIPanel context={aiContext} />}
					{activeTab === "gc" && <GCPanel seq={parsed.seq} />}
					</div>
				</aside>
			</div>

			{/* Translation drawer — shown when a CDS annotation is clicked */}
			{translationTarget && (
				<TranslationView
					seq={parsed.seq}
					target={translationTarget}
					onClose={() => setTranslationTarget(null)}
					onDesignPrimers={() => {
						setAnnotationName(translationTarget.name);
						setActiveTab("primers");
						setTranslationTarget(null);
					}}
				/>
			)}

			{/* Chromatogram drawer — full width, slides in at bottom */}
			{selectedAlignRead?.traces &&
				selectedAlignRead.peakPositions &&
				selectedAlignRead.traceLength != null && (
					<Chromatogram
						name={selectedAlignRead.name}
						sequence={selectedAlignRead.sequence}
						quality={selectedAlignRead.quality}
						peakPositions={selectedAlignRead.peakPositions}
						traceLength={selectedAlignRead.traceLength}
						traces={selectedAlignRead.traces}
						result={selectedAlignRead.result}
						onClose={() => setSelectedAlignRead(null)}
					/>
				)}

			{/* Primer plots drawer — melt curve, amplicon structure, pair overview */}
			{primerPlotsData && (
				<PrimerPlotsDrawer
					data={primerPlotsData}
					onClose={() => setPrimerPlotsData(null)}
				/>
			)}
		</div>
	);
}
