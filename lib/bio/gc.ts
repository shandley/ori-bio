/**
 * GC content analysis utilities.
 *
 * computeGCProfile uses a sliding window with a running sum — O(n) regardless
 * of window size. Returns a Float32Array of GC fractions [0, 1] at each
 * window position; index i covers seq[i .. i+windowSize).
 */

/** Overall GC fraction [0, 1] for a sequence. Non-ACGT characters are ignored. */
export function computeGCContent(seq: string): number {
	const upper = seq.toUpperCase().replace(/[^ACGT]/g, "");
	if (upper.length === 0) return 0;
	let gc = 0;
	for (const ch of upper) if (ch === "G" || ch === "C") gc++;
	return gc / upper.length;
}

/**
 * Sliding-window GC fractions. Each value represents the GC content of the
 * window starting at that position. Returns an empty array when the sequence
 * is shorter than the window.
 */
export function computeGCProfile(seq: string, windowSize: number): Float32Array {
	const upper = seq.toUpperCase();
	const n = Math.max(0, upper.length - windowSize + 1);
	const profile = new Float32Array(n);
	if (n === 0) return profile;

	// Seed the first window
	let gc = 0;
	for (let i = 0; i < windowSize; i++) {
		const ch = upper[i]!;
		if (ch === "G" || ch === "C") gc++;
	}
	profile[0] = gc / windowSize;

	// Slide: add incoming base, remove outgoing base
	for (let i = 1; i < n; i++) {
		const out = upper[i - 1]!;
		const inn = upper[i + windowSize - 1]!;
		if (out === "G" || out === "C") gc--;
		if (inn === "G" || inn === "C") gc++;
		profile[i] = gc / windowSize;
	}

	return profile;
}

export interface GCStats {
	/** Overall GC fraction [0, 1] */
	gcContent: number;
	/** Minimum window GC fraction */
	minGC: number;
	/** Maximum window GC fraction */
	maxGC: number;
	/** Number of windows with GC < 0.30 */
	lowGCWindows: number;
	/** Number of windows with GC > 0.70 */
	highGCWindows: number;
}

export function computeGCStats(seq: string, profile: Float32Array): GCStats {
	const gcContent = computeGCContent(seq);
	if (profile.length === 0) {
		return { gcContent, minGC: gcContent, maxGC: gcContent, lowGCWindows: 0, highGCWindows: 0 };
	}

	let minGC = 1;
	let maxGC = 0;
	let lowGCWindows = 0;
	let highGCWindows = 0;

	for (const v of profile) {
		if (v < minGC) minGC = v;
		if (v > maxGC) maxGC = v;
		if (v < 0.3) lowGCWindows++;
		if (v > 0.7) highGCWindows++;
	}

	return { gcContent, minGC, maxGC, lowGCWindows, highGCWindows };
}
