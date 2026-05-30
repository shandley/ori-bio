"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { SiteNav } from "@/components/nav/site-nav";
import type { LibraryPlasmid } from "./page";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AIRecommendation {
	slug: string;
	name: string;
	reason: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_CATEGORIES = [
	"bacterial",
	"mammalian",
	"viral",
	"CRISPR",
	"reporter",
	"gateway",
	"plant",
	"insect",
	"fluorescent",
	"cloning",
	"expression",
];
const ALL_RESISTANCE = ["AmpR", "KanR", "CmR", "TetR", "HygR", "PuroR", "NeoR", "BlastR", "ZeoR"];
const ALL_PROMOTERS = [
	"T7 promoter",
	"CMV promoter",
	"EF1a promoter",
	"SV40 promoter",
	"CAG promoter",
];

const s = {
	mono: { fontFamily: "var(--font-courier)" } as React.CSSProperties,
	karla: { fontFamily: "var(--font-karla)" } as React.CSSProperties,
	play: { fontFamily: "var(--font-playfair)" } as React.CSSProperties,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatLen(bp: number) {
	return bp >= 1000 ? `${(bp / 1000).toFixed(1)} kb` : `${bp} bp`;
}

function matchesSearch(p: LibraryPlasmid, q: string): boolean {
	if (!q) return true;
	const lower = q.toLowerCase();
	return (
		p.name.toLowerCase().includes(lower) ||
		p.description.toLowerCase().includes(lower) ||
		p.key_features.some((f) => f.toLowerCase().includes(lower)) ||
		p.categories.some((c) => c.toLowerCase().includes(lower))
	);
}

// ── Sidebar checkbox ──────────────────────────────────────────────────────────

function FilterCheck({
	label,
	checked,
	onChange,
}: {
	label: string;
	checked: boolean;
	onChange: () => void;
}) {
	return (
		<label
			style={{
				display: "flex",
				alignItems: "center",
				gap: "6px",
				cursor: "pointer",
				padding: "2px 0",
			}}
		>
			<input
				type="checkbox"
				checked={checked}
				onChange={onChange}
				style={{ accentColor: "#1a4731", cursor: "pointer" }}
			/>
			<span style={{ ...s.mono, fontSize: "8.5px", color: "#5a5648", letterSpacing: "0.03em" }}>
				{label}
			</span>
		</label>
	);
}

// ── Plasmid card ──────────────────────────────────────────────────────────────

function PlasmidCard({ p, highlighted }: { p: LibraryPlasmid; highlighted?: boolean }) {
	return (
		<Link href={`/library/${p.slug}`} style={{ textDecoration: "none", display: "block" }}>
			<div
				style={{
					background: highlighted ? "rgba(26,71,49,0.04)" : "#faf7f2",
					border: `1px solid ${highlighted ? "#1a4731" : "#ddd8ce"}`,
					borderRadius: "3px",
					padding: "14px 16px",
					cursor: "pointer",
					transition: "border-color 0.12s, background 0.12s",
					height: "100%",
					boxSizing: "border-box",
					display: "flex",
					flexDirection: "column",
					gap: "8px",
				}}
			>
				{/* Header */}
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "flex-start",
						gap: "8px",
					}}
				>
					<div
						style={{
							...s.play,
							fontSize: "15px",
							color: "#1c1a16",
							lineHeight: 1.2,
							fontWeight: 600,
						}}
					>
						{p.name}
					</div>
					{p.is_featured && (
						<span
							style={{
								...s.mono,
								fontSize: "7px",
								color: "#1a4731",
								background: "rgba(26,71,49,0.08)",
								padding: "2px 6px",
								borderRadius: "2px",
								letterSpacing: "0.08em",
								textTransform: "uppercase",
								flexShrink: 0,
							}}
						>
							Featured
						</span>
					)}
				</div>

				{/* Meta */}
				<div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
					<span style={{ ...s.mono, fontSize: "8px", color: "#9a9284" }}>
						{formatLen(p.length)}
					</span>
					<span style={{ ...s.mono, fontSize: "8px", color: "#9a9284" }}>
						{p.topology === "circular" ? "○ Circular" : "— Linear"}
					</span>
					{p.gc_content && (
						<span style={{ ...s.mono, fontSize: "8px", color: "#9a9284" }}>
							{p.gc_content.toFixed(1)}% GC
						</span>
					)}
				</div>

				{/* Feature tags */}
				{p.key_features.length > 0 && (
					<div style={{ display: "flex", flexWrap: "wrap", gap: "3px" }}>
						{p.key_features.slice(0, 5).map((f) => (
							<span
								key={f}
								style={{
									...s.mono,
									fontSize: "7.5px",
									color: "#5a5648",
									background: "#f0ebe0",
									border: "1px solid #ddd8ce",
									padding: "1px 5px",
									borderRadius: "2px",
									letterSpacing: "0.03em",
								}}
							>
								{f}
							</span>
						))}
						{p.key_features.length > 5 && (
							<span style={{ ...s.mono, fontSize: "7.5px", color: "#9a9284", padding: "1px 3px" }}>
								+{p.key_features.length - 5}
							</span>
						)}
					</div>
				)}

				{/* Description */}
				{p.description && (
					<p
						style={{
							...s.karla,
							fontSize: "11px",
							color: "#5a5648",
							lineHeight: 1.5,
							margin: 0,
							flex: 1,
							display: "-webkit-box",
							WebkitLineClamp: 2,
							WebkitBoxOrient: "vertical",
							overflow: "hidden",
						}}
					>
						{p.description}
					</p>
				)}

				{/* Footer */}
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						marginTop: "auto",
					}}
				>
					<div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
						{p.categories.slice(0, 2).map((c) => (
							<span
								key={c}
								style={{
									...s.mono,
									fontSize: "7px",
									color: "#9a9284",
									letterSpacing: "0.06em",
									textTransform: "uppercase",
								}}
							>
								{c}
							</span>
						))}
					</div>
					<span style={{ ...s.mono, fontSize: "8px", color: "#1a4731", letterSpacing: "0.04em" }}>
						Open →
					</span>
				</div>
			</div>
		</Link>
	);
}

// ── AI panel ──────────────────────────────────────────────────────────────────

function AIPanel({ library, onClose }: { library: LibraryPlasmid[]; onClose: () => void }) {
	const [query, setQuery] = useState("");
	const [loading, setLoading] = useState(false);
	const [recs, setRecs] = useState<AIRecommendation[]>([]);
	const [error, setError] = useState<string | null>(null);

	const ask = async () => {
		if (!query.trim() || loading) return;
		setLoading(true);
		setError(null);
		setRecs([]);
		try {
			const res = await fetch("/api/library-search", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query }),
			});
			if (!res.ok) throw new Error(`${res.status}`);
			const data = (await res.json()) as { recommendations: AIRecommendation[] };
			setRecs(data.recommendations ?? []);
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setLoading(false);
		}
	};

	return (
		<div
			style={{
				position: "fixed",
				right: 0,
				top: 0,
				bottom: 0,
				width: "320px",
				background: "#faf7f2",
				borderLeft: "1px solid #ddd8ce",
				display: "flex",
				flexDirection: "column",
				zIndex: 100,
				boxShadow: "-4px 0 20px rgba(0,0,0,0.08)",
			}}
		>
			{/* Header */}
			<div
				style={{
					padding: "16px 20px",
					borderBottom: "1px solid #ddd8ce",
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					flexShrink: 0,
				}}
			>
				<div>
					<div style={{ ...s.play, fontSize: "15px", color: "#1c1a16" }}>Ask Ori</div>
					<div style={{ ...s.mono, fontSize: "8px", color: "#9a9284", marginTop: "2px" }}>
						Find plasmids by description
					</div>
				</div>
				<button
					type="button"
					onClick={onClose}
					style={{
						...s.mono,
						fontSize: "16px",
						color: "#9a9284",
						background: "none",
						border: "none",
						cursor: "pointer",
						lineHeight: 1,
					}}
				>
					×
				</button>
			</div>

			{/* Example queries */}
			<div style={{ padding: "12px 20px", borderBottom: "1px solid #ddd8ce", flexShrink: 0 }}>
				{[
					"Bacterial expression with His-tag",
					"Lentiviral delivery of Cas9",
					"GFP reporter under CMV promoter",
				].map((ex) => (
					<button
						key={ex}
						type="button"
						onClick={() => setQuery(ex)}
						style={{
							display: "block",
							width: "100%",
							textAlign: "left",
							marginBottom: "4px",
							...s.mono,
							fontSize: "8px",
							color: "#5a5648",
							background: "none",
							border: "1px solid #ddd8ce",
							borderRadius: "2px",
							padding: "4px 8px",
							cursor: "pointer",
							letterSpacing: "0.02em",
						}}
					>
						{ex}
					</button>
				))}
			</div>

			{/* Query input */}
			<div style={{ padding: "14px 20px", borderBottom: "1px solid #ddd8ce", flexShrink: 0 }}>
				<textarea
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							void ask();
						}
					}}
					placeholder="Describe what you need..."
					rows={3}
					style={{
						width: "100%",
						...s.mono,
						fontSize: "9px",
						color: "#1c1a16",
						background: "#f5f0e8",
						border: "1px solid #ddd8ce",
						borderRadius: "2px",
						padding: "8px 10px",
						resize: "none",
						boxSizing: "border-box",
						outline: "none",
					}}
				/>
				<button
					type="button"
					onClick={() => void ask()}
					disabled={loading || !query.trim()}
					style={{
						marginTop: "8px",
						width: "100%",
						...s.mono,
						fontSize: "9px",
						letterSpacing: "0.08em",
						textTransform: "uppercase",
						color: "white",
						background: loading ? "#2d7a54" : "#1a4731",
						border: "none",
						borderRadius: "2px",
						padding: "7px",
						cursor: "pointer",
						opacity: !query.trim() ? 0.5 : 1,
					}}
				>
					{loading ? "Searching…" : "Find plasmids"}
				</button>
			</div>

			{/* Results */}
			<div style={{ flex: 1, overflowY: "auto", padding: "14px 20px" }}>
				{error && (
					<div
						style={{
							...s.mono,
							fontSize: "9px",
							color: "#a02828",
							padding: "8px",
							background: "rgba(160,40,40,0.06)",
							borderRadius: "2px",
							marginBottom: "12px",
						}}
					>
						{error}
					</div>
				)}
				{recs.length > 0 && (
					<div
						style={{
							...s.mono,
							fontSize: "8px",
							color: "#9a9284",
							marginBottom: "10px",
							letterSpacing: "0.06em",
							textTransform: "uppercase",
						}}
					>
						{recs.length} recommendation{recs.length !== 1 ? "s" : ""}
					</div>
				)}
				{recs.map((r) => (
					<Link
						key={r.slug}
						href={`/library/${r.slug}`}
						style={{ textDecoration: "none", display: "block", marginBottom: "10px" }}
					>
						<div
							style={{
								background: "#f5f0e8",
								border: "1px solid #ddd8ce",
								borderRadius: "3px",
								padding: "10px 12px",
							}}
						>
							<div style={{ ...s.play, fontSize: "13px", color: "#1c1a16", marginBottom: "4px" }}>
								{r.name}
							</div>
							<div style={{ ...s.karla, fontSize: "11px", color: "#5a5648", lineHeight: 1.4 }}>
								{r.reason}
							</div>
							<div
								style={{
									...s.mono,
									fontSize: "8px",
									color: "#1a4731",
									marginTop: "6px",
									letterSpacing: "0.04em",
								}}
							>
								Open →
							</div>
						</div>
					</Link>
				))}
				{recs.length === 0 && !loading && !error && (
					<div
						style={{
							...s.karla,
							fontSize: "12px",
							color: "#9a9284",
							lineHeight: 1.6,
							marginTop: "8px",
						}}
					>
						Describe the plasmid you need — host organism, application, selection marker, promoter,
						or any combination.
					</div>
				)}
			</div>
		</div>
	);
}

// ── Main client component ─────────────────────────────────────────────────────

export function LibraryClient({ initialPlasmids }: { initialPlasmids: LibraryPlasmid[] }) {
	const [search, setSearch] = useState("");
	const [selCategories, setSelCats] = useState<Set<string>>(new Set());
	const [selResistance, setSelRes] = useState<Set<string>>(new Set());
	const [selPromoters, setSelProm] = useState<Set<string>>(new Set());
	const [aiOpen, setAiOpen] = useState(false);
	const searchRef = useRef<HTMLInputElement>(null);

	const toggleSet = (set: Set<string>, val: string, setter: (s: Set<string>) => void) => {
		const next = new Set(set);
		if (next.has(val)) next.delete(val);
		else next.add(val);
		setter(next);
	};

	const filtered = useMemo(() => {
		return initialPlasmids.filter((p) => {
			if (!matchesSearch(p, search)) return false;
			if (selCategories.size > 0 && !p.categories.some((c) => selCategories.has(c))) return false;
			if (selResistance.size > 0 && !p.key_features.some((f) => selResistance.has(f))) return false;
			if (selPromoters.size > 0 && !p.key_features.some((f) => selPromoters.has(f))) return false;
			return true;
		});
	}, [initialPlasmids, search, selCategories, selResistance, selPromoters]);

	const clearFilters = useCallback(() => {
		setSearch("");
		setSelCats(new Set());
		setSelRes(new Set());
		setSelProm(new Set());
	}, []);

	const hasFilters =
		search || selCategories.size > 0 || selResistance.size > 0 || selPromoters.size > 0;

	return (
		<div
			style={{
				minHeight: "100vh",
				background: "#f5f0e8",
				paddingRight: aiOpen ? "320px" : 0,
				transition: "padding-right 0.2s",
			}}
		>
			<SiteNav />

			{/* Hero + search */}
			<div style={{ padding: "40px 32px 24px", borderBottom: "1px solid #ddd8ce" }}>
				<h1
					style={{
						...s.play,
						fontSize: "32px",
						color: "#1c1a16",
						margin: "0 0 8px",
						fontWeight: 600,
						letterSpacing: "-0.02em",
					}}
				>
					Plasmid Library
				</h1>
				<p
					style={{
						...s.karla,
						fontSize: "14px",
						color: "#5a5648",
						margin: "0 0 20px",
						lineHeight: 1.5,
					}}
				>
					{initialPlasmids.length} reference plasmids with consistent canonical annotations. Open
					any plasmid directly in the viewer.
				</p>
				<div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
					<div style={{ flex: 1, position: "relative" }}>
						<input
							ref={searchRef}
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder="Search by name, feature, or category..."
							style={{
								width: "100%",
								...s.mono,
								fontSize: "11px",
								color: "#1c1a16",
								background: "#faf7f2",
								border: "1px solid #c8c0b8",
								borderRadius: "3px",
								padding: "10px 14px",
								outline: "none",
								boxSizing: "border-box",
								letterSpacing: "0.02em",
							}}
						/>
						{search && (
							<button
								type="button"
								onClick={() => setSearch("")}
								style={{
									position: "absolute",
									right: "10px",
									top: "50%",
									transform: "translateY(-50%)",
									...s.mono,
									fontSize: "14px",
									color: "#9a9284",
									background: "none",
									border: "none",
									cursor: "pointer",
									lineHeight: 1,
								}}
							>
								×
							</button>
						)}
					</div>
					<button
						type="button"
						onClick={() => setAiOpen((v) => !v)}
						style={{
							...s.mono,
							fontSize: "9px",
							letterSpacing: "0.08em",
							textTransform: "uppercase",
							color: aiOpen ? "white" : "#1a4731",
							background: aiOpen ? "#1a4731" : "none",
							border: "1px solid #1a4731",
							borderRadius: "2px",
							padding: "10px 16px",
							cursor: "pointer",
							flexShrink: 0,
							display: "flex",
							alignItems: "center",
							gap: "5px",
						}}
					>
						<span>✦</span> Ask Ori
					</button>
				</div>
			</div>

			<div style={{ display: "flex" }}>
				{/* Sidebar */}
				<aside
					style={{
						width: "200px",
						flexShrink: 0,
						borderRight: "1px solid #ddd8ce",
						padding: "20px 20px",
						alignSelf: "flex-start",
						position: "sticky",
						top: "52px",
					}}
				>
					{hasFilters && (
						<button
							type="button"
							onClick={clearFilters}
							style={{
								...s.mono,
								fontSize: "8px",
								color: "#a02828",
								background: "none",
								border: "1px solid rgba(160,40,40,0.3)",
								borderRadius: "2px",
								padding: "3px 8px",
								cursor: "pointer",
								marginBottom: "12px",
								letterSpacing: "0.06em",
								textTransform: "uppercase",
							}}
						>
							Clear filters
						</button>
					)}

					<div
						style={{
							...s.mono,
							fontSize: "8px",
							color: "#9a9284",
							letterSpacing: "0.1em",
							textTransform: "uppercase",
							marginBottom: "8px",
						}}
					>
						Category
					</div>
					{ALL_CATEGORIES.map((c) => (
						<FilterCheck
							key={c}
							label={c}
							checked={selCategories.has(c)}
							onChange={() => toggleSet(selCategories, c, setSelCats)}
						/>
					))}

					<div
						style={{
							...s.mono,
							fontSize: "8px",
							color: "#9a9284",
							letterSpacing: "0.1em",
							textTransform: "uppercase",
							marginTop: "16px",
							marginBottom: "8px",
						}}
					>
						Resistance
					</div>
					{ALL_RESISTANCE.map((r) => (
						<FilterCheck
							key={r}
							label={r}
							checked={selResistance.has(r)}
							onChange={() => toggleSet(selResistance, r, setSelRes)}
						/>
					))}

					<div
						style={{
							...s.mono,
							fontSize: "8px",
							color: "#9a9284",
							letterSpacing: "0.1em",
							textTransform: "uppercase",
							marginTop: "16px",
							marginBottom: "8px",
						}}
					>
						Promoter
					</div>
					{ALL_PROMOTERS.map((p) => (
						<FilterCheck
							key={p}
							label={p}
							checked={selPromoters.has(p)}
							onChange={() => toggleSet(selPromoters, p, setSelProm)}
						/>
					))}
				</aside>

				{/* Grid */}
				<main style={{ flex: 1, padding: "24px 28px" }}>
					<div
						style={{
							...s.mono,
							fontSize: "8.5px",
							color: "#9a9284",
							marginBottom: "16px",
							letterSpacing: "0.04em",
						}}
					>
						{filtered.length === initialPlasmids.length
							? `${initialPlasmids.length} plasmids`
							: `${filtered.length} of ${initialPlasmids.length} plasmids`}
					</div>

					{filtered.length === 0 ? (
						<div
							style={{
								...s.karla,
								fontSize: "13px",
								color: "#9a9284",
								padding: "48px 0",
								textAlign: "center",
							}}
						>
							No plasmids match your filters.{" "}
							<button
								type="button"
								onClick={clearFilters}
								style={{
									...s.mono,
									fontSize: "13px",
									color: "#1a4731",
									background: "none",
									border: "none",
									cursor: "pointer",
									textDecoration: "underline",
								}}
							>
								Clear
							</button>
						</div>
					) : (
						<div
							style={{
								display: "grid",
								gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
								gap: "12px",
							}}
						>
							{filtered.map((p) => (
								<PlasmidCard key={p.id} p={p} />
							))}
						</div>
					)}
				</main>
			</div>

			{/* AI panel */}
			{aiOpen && <AIPanel library={initialPlasmids} onClose={() => setAiOpen(false)} />}
		</div>
	);
}
