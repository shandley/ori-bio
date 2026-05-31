#!/usr/bin/env python3
"""
Seed the plasmid_library table from the SnapGene public collection on HTCF.

Run on HTCF:
  conda activate confphylo
  SUPABASE_URL=https://mexubhrfyfeacpnygpig.supabase.co \
  SUPABASE_SERVICE_KEY=<service_role_key> \
  python3 seed-plasmid-library.py

Requires: biopython, requests
"""

import json
import os
import re
import sys
import time
from pathlib import Path

import requests
from Bio import SeqIO

# ── Config ────────────────────────────────────────────────────────────────────

SNAPGENE_DIR = Path("/scratch/sahlab/shandley/helix-feature-db/raw/snapgene")
SUPABASE_URL = os.environ["SUPABASE_URL"]
# Accept either the new sb_secret_* key (preferred) or the legacy JWT service role key
SERVICE_KEY  = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
BUCKET       = "plasmid-library"

# ── Must-include plasmids ─────────────────────────────────────────────────────

MUST_INCLUDE = {
    # Core cloning vectors
    "pUC19.gb", "pUC18.gb", "pBR322.gb", "pACYC184.gb", "pACYC177.gb", "pSC101.gb",
    "pUC57.gb",
    "pBluescript SK(-).gb", "pBluescript KS(-).gb", "pBluescript II KS(-).gb",
    # Bacterial expression — pET series
    "pET-3a.gb", "pET-11a.gb", "pET-15b.gb", "pET-19b.gb",
    "pET-9a.gb", "pET-9b.gb", "pET-9c.gb", "pET-9d.gb",
    "pET-41 Ek_LIC.gb", "pET-43.1 Ek_LIC.gb", "pET-46 Ek_LIC.gb",
    "pET-53-DEST.gb", "pET-57-DEST.gb",
    # Bacterial expression — dual expression / other
    "pETDuet-1.gb", "pRSFDuet-1.gb", "pACYCDuet-1.gb", "pCDFDuet-1.gb",
    "pRSF-1b.gb", "pCDF-1b.gb",
    "pGEX-4T-1.gb", "pGEX-6P-1.gb", "pGEX-2T.gb",
    "pMAL-c5X.gb", "pMAL-p5X.gb",
    "pTrcHis A.gb", "pTrcHis B.gb",
    "pRSET A.gb", "pRSET B.gb", "pRSET C.gb",
    # Mammalian expression
    "pcDNA3.1(-).gb", "pcDNA3.gb", "pcDNA4 TO.gb",
    "pcDNA3.1 V5-His A.gb", "pcDNA3.1 myc-His A.gb", "pcDNA3.1 His A.gb",
    "pcDNA3.1 Hygro(-).gb", "pcDNA3.1 Zeo(-).gb",
    "pcDNA5 FRT.gb", "pcDNA5 FRT TO.gb", "pcDNA5 TO.gb",
    "pcDNA6 V5-His A.gb", "pcDNA6 myc-His A.gb",
    "pCMV-Script.gb", "pCMV-LacZ.gb", "pCMV-MIR.gb",
    # Fluorescent proteins (full vectors)
    "pEGFP-N1.gb", "pEGFP-C1.gb", "pEGFP-N3.gb",
    "DsRed2.gb", "DsRed-Express2.gb", "mCherry.gb",
    # Lentiviral — transfer vectors
    "lentiCRISPR v2.gb", "lentiCas9-EGFP.gb", "lentiCas9-Blast.gb",
    "lentiGuide-Puro.gb", "lentiGuide-Hygro.gb",
    "pLKO.1.gb", "pLKO.1 puro.gb",
    # Lentiviral — packaging / envelope
    "psPAX2.gb", "pMD2.G.gb",
    # CRISPR
    "pX330.gb",
    "pSpCas9(BB)-2A-GFP (PX458).gb",
    "pSpCas9(BB)-2A-Puro (PX459) V2.0.gb",
    "pSpCas9n(BB)-2A-GFP (PX461).gb",
    "pCas-Guide-CRISPRa.gb", "pCas-Guide-CRISPRi.gb",
    # AAV
    "pAAV2-EF1a-tGFP-WPRE.gb", "pAAVS1-Puro-DNR.gb",
    # Reporter
    "pGL3-Basic.gb", "pGL3-Control.gb", "pGL3-Enhancer.gb",
    "pGL4.10[luc2].gb", "pGL4.13[luc2 SV40].gb", "pGL4.23[luc2 minP].gb",
    "pRL-TK.gb", "pRL-CMV.gb", "pRL-null.gb",
    # Gateway
    "pDONR221.gb", "pDONR201.gb", "pDONR207.gb",
    "pDEST14.gb", "pDEST15.gb", "pDEST17.gb",
    # Plant
    "pBI121.gb", "pBI221.gb",
    "pCAMBIA1301.gb", "pCAMBIA1302.gb", "pCAMBIA2300.gb", "pCAMBIA3300.gb",
    # Baculovirus/insect
    "BaculoDirect N-Term Linear DNA.gb",
    "pBiEx-1.gb", "pBiEx-2.gb",
    # TA cloning (extremely common for PCR product cloning)
    "pGEM-T Easy.gb", "pGEM-T.gb", "pGEM-3Z.gb", "pGEM-4Z.gb",
    "pCR2.1-TOPO.gb", "pCR4-TOPO.gb",          # Invitrogen TOPO TA cloning
    "pJET1.2.gb", "pJET1.2 blunt.gb",           # Thermo blunt-end TA cloning
    # Retroviral stable expression — pBABE (Morgenstern & Land 1990)
    "pBABE-Puro.gb", "pBABE-Hygro.gb", "pBABE-Neo.gb", "pBABE-Zeo.gb",
    # Retroviral — MSCV backbone (common for hematopoietic cells)
    "pMSCVpuro.gb", "pMSCVneo.gb", "pMSCVhyg.gb",
    # Tet-inducible expression (Clontech/Takara)
    "pRetroX-Tet3G.gb",         # Tet-On 3G transactivator (retroviral delivery)
    "pRetroX-TRE3G.gb",         # TRE3G response element (retroviral delivery)
    "pRetroX-TetOne-Puro.gb",   # All-in-one dox-inducible + PuroR
    "pTRE3G.gb",                # TRE3G element for non-retroviral delivery
    "pRetroX-Tight-Pur.gb",     # TRE-Tight for low basal expression
    # Baculovirus — Bac-to-Bac system (Invitrogen)
    "pFastBac1.gb", "pFastBac Dual.gb",
    "pFastBacHT A.gb", "pFastBacHT B.gb", "pFastBacHT C.gb",
    # QIAGEN His-tag bacterial expression (pQE series)
    "pQE-30.gb", "pQE-31.gb", "pQE-32.gb",     # N-terminal His, 3 reading frames
    "pQE-60.gb",                                 # C-terminal His
    "pQE-80L.gb", "pQE-80L-Kan.gb",             # Larger cloning capacity
    # Episomal mammalian expression (EBV oriP — replicates without integration)
    "pCEP4.gb",
    # Drosophila S2 cell expression (Invitrogen)
    "pAc5.1 V5-His A.gb", "pAc5.1 V5-His B.gb", "pAc5.1 V5-His C.gb",
    # Yeast two-hybrid — GAL4 system (Clontech/Takara)
    "pGADT7 AD.gb",
    # Human codon-optimized Cas9 (distinct from pX/lentiCas9 plasmids)
    "hCas9.gb", "hCas9_D10A.gb",
    # Retroviral shRNA (pSIREN-RetroQ backbone)
    "pSIREN-RetroQ.gb",
    # ── Yeast vectors ──────────────────────────────────────────────────────────
    # pRS series — the standard S. cerevisiae shuttle vectors (Sikorski & Hieter)
    # Centromeric (low copy, ~1-2 copies/cell):
    "pRS313.gb", "pRS314.gb", "pRS315.gb", "pRS316.gb",  # HIS3, TRP1, LEU2, URA3
    # 2µ-based (high copy, ~20 copies/cell):
    "pRS423.gb", "pRS424.gb", "pRS425.gb", "pRS426.gb",  # HIS3, TRP1, LEU2, URA3
    # Integrating:
    "pRS303.gb", "pRS304.gb", "pRS305.gb", "pRS306.gb",  # HIS3, TRP1, LEU2, URA3
    "pRS403.gb", "pRS404.gb", "pRS405.gb", "pRS406.gb",  # HIS3, TRP1, LEU2, URA3
    # pESC — dual-expression galactose-inducible (Stratagene/Agilent)
    "pESC-HIS.gb", "pESC-LEU.gb", "pESC-TRP.gb", "pESC-URA.gb",
    # pYES — GAL1-promoter expression (Invitrogen)
    "pYES2.gb", "pYES2 CT.gb", "pYES2 NT A.gb",
    "pYES3 CT.gb", "pYES-DEST52.gb",
    # YCplac — classic centromeric vectors (Gietz & Sugino)
    "YCplac111.gb", "YCplac22.gb", "YCplac33.gb",
    # YEplac — classic 2µ episomal vectors
    "YEplac112.gb", "YEplac181.gb", "YEplac195.gb",
    "YCp50.gb",
    # pAG — yeast integration marker cassettes (Goldstein & McCusker)
    "pAG25.gb", "pAG29.gb", "pAG32.gb",
    # pAUR — Aureobasidin A selection (TaKaRa, common in fission yeast)
    "pAUR101.gb", "pAUR123.gb", "pAUR316.gb",
    # Yeast CRISPR (DiCarlo et al. 2013)
    "p414-TEF1p-Cas9-CYC1t.gb", "p415-GalL-Cas9-CYC1t.gb",
    "p426-SNR52p-gRNA.CAN1.Y-SUP4t.gb",
    # Pichia pastoris — methanol-inducible (pPICZ) and constitutive (pGAPZ)
    "pPICZ A.gb", "pPICZ B.gb", "pPICZ C.gb",
    "pPICZ(alpha) A.gb", "pPICZ(alpha) B.gb",
    "pPIC9.gb", "pPIC9K.gb",
    "pGAPZ A.gb", "pGAPZ B.gb", "pGAPZ(alpha) A.gb",
}

# ── Category heuristics ───────────────────────────────────────────────────────

def infer_categories(name: str, features: list[str]) -> list[str]:
    n = name.lower()
    cats = []
    # Application
    if any(x in n for x in ["pet", "pgex", "pmal", "ptrc", "prsf", "pacyc", "puc", "pbr", "psc"]):
        cats.append("bacterial")
    if any(x in n for x in ["pcdna", "pcmv", "plenti", "pgfp", "phcmv", "pcdh"]):
        cats.append("mammalian")
    if any(x in n for x in ["prs3", "prs4", "pesc", "pyes", "ycplac", "yeplac", "ycp", "yep",
                              "ppicz", "ppic", "pgapz", "paur", "p414", "p415", "p426", "pag2", "pag3"]):
        cats.append("yeast")
    if any(x in n for x in ["lenti", "paav", "pspax", "pvsvg", "pmd2", "plp-vsv", "plko",
                              "pbabe", "pmscv", "pretro", "pfastbac", "msiren"]):
        cats.append("viral")
    if any(x in n for x in ["pgl", "pglow", "luc"]):
        cats.append("reporter")
    if any(x in n for x in ["crispr", "cas9", "px33", "px45", "px46", "sgrna", "cpf1"]):
        cats.append("CRISPR")
    if any(x in n for x in ["pdonr", "pdest", "gateway"]):
        cats.append("gateway")
    if any(x in n for x in ["pcambia", "pbi1", "pbi2", "pbin", "ptig"]):
        cats.append("plant")
    if any(x in n for x in ["baculodirect", "pbiex", "pbfr", "transfer"]):
        cats.append("insect")
    if any(x in n for x in ["gfp", "rfp", "yfp", "cfp", "mcherry", "dsred", "egfp", "eyfp"]):
        cats.append("fluorescent")
    # Expression type
    if any(x in features for x in ["T7 promoter", "T7 terminator"]):
        cats.append("expression")
    if any(x in n for x in ["plko", "shrna", "psilencer", "pgipz", "pshag"]):
        if "shRNA" not in cats:
            cats.append("shRNA")
    if not cats:
        cats.append("cloning")
    return list(dict.fromkeys(cats))  # deduplicate, preserve order

def extract_key_features(record) -> list[str]:
    """Extract canonical feature names from a GenBank record."""
    features = []
    feature_map = {
        "AmpR": ["ampr", "amp", "ampicillin", "beta-lactamase", "bla"],
        "KanR": ["kanr", "kan", "kanamycin", "nptii", "aph(3"],
        "CmR": ["cmr", "cat", "chloramphenicol"],
        "TetR": ["tetr", "tet", "tetracycline"],
        "HygR": ["hygr", "hyg", "hygromycin", "hph"],
        "PuroR": ["puror", "puro", "puromycin"],
        "BlastR": ["blastr", "blast", "blasticidin", "bsr"],
        "NeoR": ["neor", "neo", "neomycin", "g418"],
        "ZeoR": ["zeor", "zeo", "zeocin"],
        "T7 promoter": ["t7 promoter", "t7 pro"],
        "T7 terminator": ["t7 terminator"],
        "CMV promoter": ["cmv promoter", "hcmv", "cytomegalovirus"],
        "EF1a promoter": ["ef1a", "ef-1a", "elongation factor"],
        "SV40 promoter": ["sv40 promoter", "sv40 early"],
        "SV40 polyA": ["sv40 poly", "sv40 late poly"],
        "BGH polyA": ["bgh poly", "bovine growth"],
        "lacZ": ["lacz", "beta-galactosidase"],
        "lacI": ["laci", "lac repressor"],
        "ColE1 ori": ["cole1", "col e1", "puc ori", "pbr ori"],
        "f1 ori": ["f1 ori", "f1 origin"],
        "pMB1 ori": ["pmb1"],
        "p15A ori": ["p15a"],
        "EGFP": ["egfp", "enhanced gfp"],
        "GFP": [" gfp", "green fluorescent"],
        "mCherry": ["mcherry"],
        "DsRed": ["dsred"],
        "luciferase": ["luc+", "luciferase", "luc2"],
        "MCS": ["multiple cloning site", "mcs", "polylinker"],
        "His-tag": ["6xhis", "his-tag", "polyhistidine", "6his"],
        "GST-tag": ["gst", "glutathione s-transferase"],
        "MBP-tag": ["mbp", "maltose binding"],
        "T7 tag": ["t7 tag"],
        "VSV-G": ["vsv-g", "vesicular stomatitis"],
        "shRNA": ["shrna", "short hairpin"],
        "U6 promoter": ["u6 promoter", "rnu6", "h1 promoter"],
        "araBAD promoter": ["arabad", "pbad", "l-arabinose"],
        "pUC ori": ["puc ori", "puc origin"],
        "2µ ori": ["2 micron", "2µ", "2-micron", "flp recombinase"],
        "CEN/ARS": ["cen", "ars", "centromere", "autonomously replicating"],
        "GAL1 promoter": ["gal1 promoter", "gal1p", "gal1-10"],
        "GAL10 promoter": ["gal10 promoter", "gal10p"],
        "TEF1 promoter": ["tef1 promoter", "tef1p", "elongation factor"],
        "URA3": ["ura3", "orotidine", "ura-3"],
        "LEU2": ["leu2", "beta-isopropylmalate", "leu-2"],
        "HIS3": ["his3", "imidazoleglycerol", "his-3"],
        "TRP1": ["trp1", "n-(5-phosphoribosyl)", "trp-1"],
        "AOX1 promoter": ["aox1", "alcohol oxidase", "methanol-inducible"],
        "GAP promoter": ["gap promoter", "glyceraldehyde-3-phosphate dehydrogenase"],
        "TRE3G promoter": ["tre3g", "tet-responsive", "tetracycline response"],
        "Tet-On 3G": ["tet-on 3g", "tet3g", "m2rtTA"],
        "LTR": ["long terminal repeat", "ltr"],
        "polyhedrin promoter": ["polyhedrin", "polh"],
        "EBV oriP": ["ebv orip", "epstein-barr", "ori p"],
        "GAL4 AD": ["gal4 activation", "gal4 ad", "gadc"],
    }
    seen = set()
    for feat in record.features:
        label = ""
        for q in ["label", "gene", "product", "note"]:
            if q in feat.qualifiers:
                label = feat.qualifiers[q][0].lower()
                break
        for canonical, synonyms in feature_map.items():
            if canonical not in seen and any(s in label for s in synonyms):
                features.append(canonical)
                seen.add(canonical)
    return features

def make_slug(name: str) -> str:
    """Convert display name to URL-safe slug."""
    s = name.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = s.strip("-")
    return s

# ── Plasmid selection ─────────────────────────────────────────────────────────

def select_plasmids(target: int = 400) -> list[Path]:
    all_files = list(SNAPGENE_DIR.glob("*.gb"))
    must = [SNAPGENE_DIR / m for m in MUST_INCLUDE if (SNAPGENE_DIR / m).exists()]
    must_names = {m.name for m in must}
    selected = list(must)

    # Fill remaining slots by category diversity
    category_groups: dict[str, list[Path]] = {
        "expression": [], "lenti_aav": [], "crispr": [],
        "reporter": [], "gateway": [], "plant": [],
        "fluorescent": [], "insect": [], "yeast": [], "other": [],
    }

    for f in all_files:
        if f.name in must_names:
            continue
        n = f.name.lower()
        if any(x in n for x in ["pet-", "pgex", "pmal", "ptrc", "prsf", "pduet"]):
            category_groups["expression"].append(f)
        elif any(x in n for x in ["lenti", "paav"]):
            category_groups["lenti_aav"].append(f)
        elif any(x in n for x in ["crispr", "cas9", "sgrna"]):
            category_groups["crispr"].append(f)
        elif any(x in n for x in ["pgl3", "pgl4", "pluc", "renilla"]):
            category_groups["reporter"].append(f)
        elif any(x in n for x in ["pdonr", "pdest"]):
            category_groups["gateway"].append(f)
        elif any(x in n for x in ["pcambia", "pbi1", "pbi2"]):
            category_groups["plant"].append(f)
        elif any(x in n for x in ["gfp", "rfp", "yfp", "cfp", "mcherry", "dsred", "venus", "tdtomato", "irf", "pet", "cyan", "orange"]):
            category_groups["fluorescent"].append(f)
        elif any(x in n for x in ["baculodirect", "pbiex"]):
            category_groups["insect"].append(f)
        elif any(x in n for x in ["prs", "pesc", "pyes", "ycplac", "yeplac", "ycp", "yep",
                                    "ppicz", "ppic", "pgapz", "paur", "p414", "p415", "p426"]):
            category_groups["yeast"].append(f)
        else:
            category_groups["other"].append(f)

    # Distribute remaining slots proportionally
    remaining = target - len(selected)
    per_group = max(1, remaining // len(category_groups))
    for grp_files in category_groups.values():
        grp_files.sort(key=lambda f: f.name)
        selected.extend(grp_files[:per_group])

    return selected[:target]

# ── Supabase helpers ──────────────────────────────────────────────────────────

HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
}

def upload_file(local_path: Path, storage_path: str) -> bool:
    url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{storage_path}"
    with open(local_path, "rb") as f:
        data = f.read()
    r = requests.post(url, headers={**HEADERS, "Content-Type": "application/octet-stream"}, data=data)
    if r.status_code in (200, 201):
        return True
    # Try PUT if already exists
    r = requests.put(url, headers={**HEADERS, "Content-Type": "application/octet-stream"}, data=data)
    return r.status_code in (200, 201)

def upsert_row(row: dict) -> bool:
    url = f"{SUPABASE_URL}/rest/v1/plasmid_library"
    headers = {
        **HEADERS,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }
    r = requests.post(url, headers=headers, data=json.dumps(row))
    return r.status_code in (200, 201, 204)  # 204 = upsert matched existing row

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    if not SUPABASE_URL or not SERVICE_KEY:
        print("ERROR: set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars", file=sys.stderr)
        sys.exit(1)

    files = select_plasmids(200)
    print(f"Selected {len(files)} plasmids")

    ok = 0
    skip = 0
    for i, gb_path in enumerate(files):
        print(f"[{i+1}/{len(files)}] {gb_path.name}", end=" ... ", flush=True)
        try:
            records = list(SeqIO.parse(gb_path, "genbank"))
            if not records:
                print("SKIP (empty)")
                skip += 1
                continue
            rec = records[0]
            seq = str(rec.seq)
            if not seq or "N" * len(seq) == seq:
                print("SKIP (no sequence)")
                skip += 1
                continue

            if len(seq) > 50000:
                print(f"SKIP (too large: {len(seq):,} bp — not a typical cloning vector)")
                skip += 1
                continue

            name = rec.name or gb_path.stem
            slug = make_slug(gb_path.stem)
            key_features = extract_key_features(rec)
            categories = infer_categories(gb_path.stem, key_features)
            gc = round(100 * (seq.count("G") + seq.count("C")) / max(len(seq), 1), 2)
            topology = "circular" if rec.annotations.get("topology", "").lower() == "circular" else "linear"
            desc = rec.description or f"{name} — {', '.join(key_features[:3])}"
            storage_path = f"{slug}.gb"

            # Upload file
            uploaded = upload_file(gb_path, storage_path)
            if not uploaded:
                print("SKIP (upload failed)")
                skip += 1
                continue

            # Insert/update row
            is_featured = gb_path.name in {
                "pUC19.gb", "pET-3a.gb", "pET-11a.gb", "pEGFP-N1.gb",
                "lentiCRISPR v2.gb", "pGL3-Basic.gb", "pspCas9(BB)-2A-Puro (PX459) V2.0.gb",
                "pcDNA3.1(-).gb", "pDONR221.gb", "pGEX-4T-1.gb",
            }
            row = {
                "slug": slug,
                "name": gb_path.stem,
                "description": desc[:500],
                "source": "SnapGene public library",
                "topology": topology,
                "length": len(seq),
                "gc_content": gc,
                "file_path": storage_path,
                "categories": categories,
                "key_features": key_features,
                "is_featured": is_featured,
            }
            inserted = upsert_row(row)
            if inserted:
                print(f"OK ({len(seq):,} bp, {len(key_features)} features)")
                ok += 1
            else:
                print("SKIP (insert failed)")
                skip += 1

        except Exception as e:
            print(f"ERROR: {e}")
            skip += 1

        time.sleep(0.1)  # rate limit

    print(f"\nDone: {ok} inserted, {skip} skipped")

if __name__ == "__main__":
    main()
