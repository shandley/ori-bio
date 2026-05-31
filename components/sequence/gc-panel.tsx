"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { computeGCContent, computeGCProfile, computeGCStats } from "@/lib/bio/gc";

const WINDOW_OPTIONS = [20, 50, 100, 200, 500] as const;
type WindowSize = (typeof WINDOW_OPTIONS)[number];

const CHART_H = 160; // px, logical
const AXIS_W  = 36;  // left axis width
const PAD_R   = 12;  // right padding

// GC% thresholds
const LOW  = 0.3;
const HIGH = 0.7;

function pct(v: number) {
	return `${(v * 100).toFixed(1)}%`;
}

function renderChart(
	canvas: HTMLCanvasElement,
	profile: Float32Array,
	seqLen: number,
) {
	const dpr = window.devicePixelRatio ?? 1;
	const logW = canvas.offsetWidth;
	const logH = CHART_H;
	if (logW === 0 || profile.length === 0) return;

	canvas.width  = Math.round(logW * dpr);
	canvas.height = Math.round(logH * dpr);
	const ctx = canvas.getContext("2d");
	if (!ctx) return;
	ctx.scale(dpr, dpr);

	const drawW = logW - AXIS_W - PAD_R;
	const originX = AXIS_W;
	const originY = logH - 20; // leave room for x axis labels

	function yOf(gc: number) {
		return originY - gc * (originY - 10);
	}
	function xOf(i: number) {
		return originX + (i / Math.max(profile.length - 1, 1)) * drawW;
	}

	// Background
	ctx.fillStyle = "#faf8f4";
	ctx.fillRect(0, 0, logW, logH);

	// Danger zone fills (< 30% and > 70%)
	ctx.fillStyle = "rgba(220,38,38,0.06)";
	ctx.fillRect(originX, yOf(1.0),  drawW, yOf(HIGH) - yOf(1.0));  // > 70%
	ctx.fillRect(originX, yOf(LOW),  drawW, originY   - yOf(LOW));   // < 30%

	// Reference lines
	for (const [level, label, color] of [
		[HIGH, "70%", "#dc2626"],
		[0.5,  "50%", "#b8b0a4"],
		[LOW,  "30%", "#0891b2"],
	] as [number, string, string][]) {
		ctx.strokeStyle = color;
		ctx.lineWidth   = 0.75;
		ctx.setLineDash([3, 3]);
		ctx.beginPath();
		ctx.moveTo(originX, yOf(level));
		ctx.lineTo(originX + drawW, yOf(level));
		ctx.stroke();
		ctx.setLineDash([]);

		ctx.fillStyle  = color;
		ctx.font       = `${8 * dpr / dpr}px monospace`;
		ctx.textAlign  = "right";
		ctx.textBaseline = "middle";
		ctx.fillText(label, originX - 4, yOf(level));
	}

	// Gradient fill under curve
	const grad = ctx.createLinearGradient(0, yOf(1.0), 0, originY);
	grad.addColorStop(0,   "rgba(26,71,49,0.25)");
	grad.addColorStop(0.5, "rgba(26,71,49,0.12)");
	grad.addColorStop(1,   "rgba(26,71,49,0.02)");

	ctx.beginPath();
	ctx.moveTo(xOf(0), originY);
	for (let i = 0; i < profile.length; i++) {
		ctx.lineTo(xOf(i), yOf(profile[i]!));
	}
	ctx.lineTo(xOf(profile.length - 1), originY);
	ctx.closePath();
	ctx.fillStyle = grad;
	ctx.fill();

	// GC line
	ctx.beginPath();
	ctx.strokeStyle = "#1a4731";
	ctx.lineWidth   = 1.5;
	ctx.lineJoin    = "round";
	for (let i = 0; i < profile.length; i++) {
		if (i === 0) ctx.moveTo(xOf(i), yOf(profile[i]!));
		else ctx.lineTo(xOf(i), yOf(profile[i]!));
	}
	ctx.stroke();

	// X axis ticks (5 evenly spaced)
	ctx.fillStyle    = "#9a9284";
	ctx.font         = "8px monospace";
	ctx.textAlign    = "center";
	ctx.textBaseline = "top";
	for (let t = 0; t <= 4; t++) {
		const frac = t / 4;
		const pos  = Math.round(frac * seqLen);
		const x    = originX + frac * drawW;
		ctx.fillText(pos >= 1000 ? `${(pos / 1000).toFixed(1)}k` : `${pos}`, x, originY + 3);
	}

	// Y axis label
	ctx.save();
	ctx.translate(9, originY / 2);
	ctx.rotate(-Math.PI / 2);
	ctx.textAlign    = "center";
	ctx.textBaseline = "middle";
	ctx.fillStyle    = "#9a9284";
	ctx.font         = "8px monospace";
	ctx.fillText("GC %", 0, 0);
	ctx.restore();
}

// ── Component ─────────────────────────────────────────────────────────────────

export function GCPanel({ seq }: { seq: string }) {
	const [windowSize, setWindowSize] = useState<WindowSize>(100);
	const canvasRef = useRef<HTMLCanvasElement>(null);

	const profile = useMemo(
		() => computeGCProfile(seq, windowSize),
		[seq, windowSize],
	);

	const stats = useMemo(
		() => computeGCStats(seq, profile),
		[seq, profile],
	);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		renderChart(canvas, profile, seq.length);

		const ro = new ResizeObserver(() => renderChart(canvas, profile, seq.length));
		ro.observe(canvas);
		return () => ro.disconnect();
	}, [profile, seq.length]);

	const overallGC = computeGCContent(seq);
	const gcColor =
		overallGC > HIGH ? "#dc2626" : overallGC < LOW ? "#0891b2" : "#1a4731";

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				height: "100%",
				overflow: "hidden",
				fontFamily: "var(--font-courier)",
			}}
		>
			{/* Stats bar */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 16,
					padding: "8px 14px",
					borderBottom: "1px solid #ece6d8",
					flexShrink: 0,
					flexWrap: "wrap",
				}}
			>
				{/* Overall GC */}
				<div style={{ display: "flex", gap: 4, alignItems: "baseline" }}>
					<span style={{ fontSize: 9, color: "#9a9284", letterSpacing: "0.06em" }}>GC</span>
					<span style={{ fontSize: 14, fontWeight: 700, color: gcColor }}>
						{pct(overallGC)}
					</span>
				</div>

				<span style={{ color: "#ddd8ce" }}>·</span>

				{/* Length */}
				<span style={{ fontSize: 9, color: "#9a9284" }}>
					{seq.length.toLocaleString()} bp
				</span>

				{stats.lowGCWindows > 0 && (
					<>
						<span style={{ color: "#ddd8ce" }}>·</span>
						<span style={{ fontSize: 9, color: "#0891b2" }}>
							{stats.lowGCWindows} low-GC window{stats.lowGCWindows > 1 ? "s" : ""} (&lt;30%)
						</span>
					</>
				)}
				{stats.highGCWindows > 0 && (
					<>
						<span style={{ color: "#ddd8ce" }}>·</span>
						<span style={{ fontSize: 9, color: "#dc2626" }}>
							{stats.highGCWindows} high-GC window{stats.highGCWindows > 1 ? "s" : ""} (&gt;70%)
						</span>
					</>
				)}

				<div style={{ flex: 1 }} />

				{/* Window size */}
				<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
					<span style={{ fontSize: 9, color: "#9a9284" }}>window</span>
					<div style={{ display: "flex", gap: 2 }}>
						{WINDOW_OPTIONS.map((w) => (
							<button
								key={w}
								type="button"
								onClick={() => setWindowSize(w)}
								style={{
									fontFamily: "var(--font-courier)",
									fontSize: 9,
									padding: "1px 5px",
									border: "1px solid",
									borderColor: windowSize === w ? "#1a4731" : "#ddd8ce",
									borderRadius: 2,
									background: windowSize === w ? "#1a4731" : "transparent",
									color: windowSize === w ? "white" : "#9a9284",
									cursor: "pointer",
								}}
							>
								{w}
							</button>
						))}
					</div>
				</div>
			</div>

			{/* Chart */}
			<div style={{ flex: 1, padding: "8px 14px 4px", minHeight: 0 }}>
				{seq.length < windowSize ? (
					<div
						style={{
							height: "100%",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							fontSize: 11,
							color: "#9a9284",
						}}
					>
						Sequence is shorter than the {windowSize} bp window. Select a smaller window.
					</div>
				) : (
					<canvas
						ref={canvasRef}
						style={{ width: "100%", height: `${CHART_H}px`, display: "block" }}
					/>
				)}
			</div>

			{/* Legend */}
			<div
				style={{
					display: "flex",
					gap: 14,
					padding: "4px 14px 8px",
					fontSize: 8,
					color: "#9a9284",
					flexShrink: 0,
					flexWrap: "wrap",
				}}
			>
				<span>
					<span style={{ color: "#dc2626" }}>▬</span> &gt;70% (high)
				</span>
				<span>
					<span style={{ color: "#1a4731" }}>▬</span> 30–70% (normal)
				</span>
				<span>
					<span style={{ color: "#0891b2" }}>▬</span> &lt;30% (low)
				</span>
				<span style={{ marginLeft: "auto" }}>
					min {pct(stats.minGC)} · max {pct(stats.maxGC)}
				</span>
			</div>
		</div>
	);
}
