#!/usr/bin/env python3
"""
Compute co-occurrence and synteny statistics from pLannotate-annotated Addgene plasmids.

Input:  pLannotate_csv/ directory containing real_*.csv files
        (optional) vector_type_labels.txt -- one integer per line, row i = plasmid i's type
Output: public/data/cooccurrence.json

Usage:
    python scripts/compute_cooccurrence.py \
        --csv-dir ~/Downloads/plasmidgpt_data/pLannotate_csv \
        --vector-types ~/Downloads/plasmidgpt_data/addgene_vector_type_cleaned.txt \
        --output public/data/cooccurrence.json
"""

import argparse
import csv
import json
import os
from collections import defaultdict
from datetime import date
from itertools import combinations

VECTOR_TYPE_NAMES = [
    "unknown", "Mammalian Expression", "Bacterial Expression", "Yeast Expression",
    "Synthetic Biology", "Lentiviral", "Insect Expression", "Plant Expression",
    "CRISPR", "Gateway Donor Vector", "AAV", "Worm Expression",
    "Gateway Entry vector", "Retroviral", "Bacterial Cloning",
    "Luciferase", "TALEN", "Zebrafish plasmids", "Mouse Targeting",
]

TOP_K_COOCCURRENCE = 20   # top co-occurring neighbors per feature
MIN_COOCCURRENCE_N = 5    # minimum raw count to include a pair
MIN_FEATURE_COUNT = 3     # minimum plasmids a feature must appear in


def load_vector_types(path: str) -> dict[int, str]:
    """Load per-plasmid vector type labels (1-indexed plasmid number → type name)."""
    if not path or not os.path.exists(path):
        return {}
    labels = {}
    with open(path) as fh:
        for i, line in enumerate(fh, start=1):
            idx = int(float(line.strip()))
            labels[i] = VECTOR_TYPE_NAMES[idx] if idx < len(VECTOR_TYPE_NAMES) else "unknown"
    return labels


def parse_csv(path: str) -> list[dict]:
    """Return non-fragment features from one pLannotate CSV, sorted by start position."""
    rows = []
    with open(path) as fh:
        for row in csv.DictReader(fh):
            if row.get("fragment", "").strip().lower() == "true":
                continue
            rows.append({
                "feature": row["Feature"].strip(),
                "type": row["Type"].strip(),
                "start": int(float(row["start location"])),
            })
    rows.sort(key=lambda r: r["start"])
    return rows


def plasmid_number(filename: str) -> int | None:
    """Extract integer from real_42.csv → 42."""
    stem = os.path.splitext(os.path.basename(filename))[0]
    parts = stem.split("_")
    try:
        return int(parts[-1])
    except ValueError:
        return None


def compute(csv_dir: str, vector_type_labels: dict[int, str]) -> dict:
    files = sorted(
        f for f in os.listdir(csv_dir) if f.startswith("real_") and f.endswith(".csv")
    )

    # Per-plasmid feature sets and ordered type sequences
    feature_presence: dict[str, int] = defaultdict(int)   # feature → count of plasmids
    type_presence: dict[str, int] = defaultdict(int)
    cooccur: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    transitions: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    transition_totals: dict[str, int] = defaultdict(int)

    # Per-vector-type: feature presence counts
    vt_feature_presence: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    vt_counts: dict[str, int] = defaultdict(int)

    n_plasmids = 0

    for fname in files:
        num = plasmid_number(fname)
        rows = parse_csv(os.path.join(csv_dir, fname))
        if not rows:
            continue

        n_plasmids += 1
        vector_type = vector_type_labels.get(num, "unknown") if num else "unknown"
        vt_counts[vector_type] += 1

        features_this = {r["feature"] for r in rows}
        types_this = [r["type"] for r in rows]  # ordered by position

        for feat in features_this:
            feature_presence[feat] += 1
            vt_feature_presence[vector_type][feat] += 1

        for typ in set(types_this):
            type_presence[typ] += 1

        # Pairwise co-occurrence (unordered pairs)
        for a, b in combinations(sorted(features_this), 2):
            cooccur[a][b] += 1
            cooccur[b][a] += 1

        # Ordered type transitions (sequential)
        for i in range(len(types_this) - 1):
            src = types_this[i]
            dst = types_this[i + 1]
            transitions[src][dst] += 1
            transition_totals[src] += 1

    # --- Build output ---

    # Feature frequencies
    feature_freq = {
        f: round(n / n_plasmids, 4)
        for f, n in sorted(feature_presence.items(), key=lambda x: -x[1])
        if n >= MIN_FEATURE_COUNT
    }

    # Type frequencies
    type_freq = {
        t: round(n / n_plasmids, 4)
        for t, n in sorted(type_presence.items(), key=lambda x: -x[1])
    }

    # Co-occurrence: top-K neighbors per feature, as conditional probability P(B|A)
    cooccurrence: dict[str, list] = {}
    for feat_a, neighbors in cooccur.items():
        if feature_presence[feat_a] < MIN_FEATURE_COUNT:
            continue
        count_a = feature_presence[feat_a]
        ranked = [
            {"feature": feat_b, "p": round(n_ab / count_a, 3), "n": n_ab}
            for feat_b, n_ab in neighbors.items()
            if n_ab >= MIN_COOCCURRENCE_N and feature_presence[feat_b] >= MIN_FEATURE_COUNT
        ]
        ranked.sort(key=lambda x: -x["p"])
        if ranked:
            cooccurrence[feat_a] = ranked[:TOP_K_COOCCURRENCE]

    # Type transitions: P(next type | current type)
    type_transitions: dict[str, list] = {}
    for src, dsts in transitions.items():
        total = transition_totals[src]
        ranked = [
            {"next": dst, "p": round(n / total, 3), "n": n}
            for dst, n in sorted(dsts.items(), key=lambda x: -x[1])
        ]
        type_transitions[src] = ranked

    # Per-vector-type: top features by frequency within that type
    by_vector_type: dict[str, dict] = {}
    for vt, feat_counts in vt_feature_presence.items():
        n_vt = vt_counts[vt]
        if n_vt < 5:
            continue
        top = sorted(feat_counts.items(), key=lambda x: -x[1])[:30]
        by_vector_type[vt] = {
            "n_plasmids": n_vt,
            "feature_freq": {
                f: round(n / n_vt, 3) for f, n in top if n >= 2
            },
        }

    return {
        "metadata": {
            "n_plasmids": n_plasmids,
            "generated": str(date.today()),
            "source": "PlasmidGPT reproducibility archive — pLannotate annotations of Addgene plasmids",
            "filters": {
                "exclude_fragments": True,
                "min_feature_count": MIN_FEATURE_COUNT,
                "min_cooccurrence_n": MIN_COOCCURRENCE_N,
                "top_k_cooccurrence": TOP_K_COOCCURRENCE,
            },
        },
        "feature_freq": feature_freq,
        "type_freq": type_freq,
        "cooccurrence": cooccurrence,
        "type_transitions": type_transitions,
        "by_vector_type": by_vector_type,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Compute plasmid part co-occurrence statistics")
    parser.add_argument("--csv-dir", required=True, help="Directory containing real_*.csv pLannotate outputs")
    parser.add_argument("--vector-types", default="", help="addgene_vector_type_cleaned.txt (optional)")
    parser.add_argument("--output", required=True, help="Output JSON path")
    args = parser.parse_args()

    print(f"Loading vector type labels...")
    vt_labels = load_vector_types(args.vector_types)
    print(f"  {len(vt_labels)} plasmid labels loaded")

    print(f"Processing pLannotate CSVs in {args.csv_dir}...")
    result = compute(args.csv_dir, vt_labels)
    print(f"  {result['metadata']['n_plasmids']} plasmids processed")
    print(f"  {len(result['feature_freq'])} features")
    print(f"  {len(result['cooccurrence'])} features with co-occurrence data")

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    with open(args.output, "w") as fh:
        json.dump(result, fh, indent=2)

    size_kb = os.path.getsize(args.output) / 1024
    print(f"\nWrote {args.output} ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
