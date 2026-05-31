# Ori — SnapGene Alternative

Open-source, web-based, LLM-powered molecular biology platform.

## Project structure
- `app/` — Next.js 16 App Router (TypeScript strict), Turbopack bundler
- `components/` — React UI components (shadcn/ui using @base-ui/react, NOT Radix)
- `components/sequence/` — Sequence viewer, primer panel, accessibility heat map, enzyme/ORF/digest/search panels
- `components/construct-designer/` — AI Construct Designer modal + Design button
- `components/primer-viz/` — Primer diagnostic plots (melt curve, amplicon heatmap, pair scatter) — pure canvas components, reusable in primd web app
- `lib/bio/` — GenBank parser, restriction enzymes, ORF finder, cloning simulations (Gibson, Gateway, RE), verify-clone, assemble-construct, parts-catalog, codon-optimize
- `app/actions/` — Next.js server actions (auth, sequences, seed)
- `supabase/migrations/` — Database schema
- `data/parts-sequences.json` — Generated part sequences for the Construct Designer (run `scripts/update-parts-catalog.py` to refresh from features.json)
- `scripts/update-parts-catalog.py` — Fetches real sequences from features.json for the parts catalog; re-run after Addgene expansion

## primd — primer design library
Published on npm as **`@shandley/primd`** v0.3.6. Lives at `../primd` (sibling). Ori uses `^0.3.6` from npm.
- After changing primd source: `npx tsc --project tsconfig.build.json` → bump version → `npm publish --access public` → update `package.json` version → `pnpm install`
- Exports: `designPCR`, `designLAMP`, `designQPCR`, `designAssembly` (Gibson + Golden Gate), thermodynamic utilities
- Web Worker: `components/sequence/primer-design.worker.ts` runs all design modes off the main thread

### primd algorithm notes (v0.3.3+)
- **Temperature**: secondary structure (hairpin, self-dimer, heterodimer ΔG) evaluated at annealing temperature, not hardcoded 37°C. `runDesign` accepts optional `overrides` parameter for quick-fix buttons.
- **Assembly**: `AssemblyPrimerPair.fwd/rev` include `fullPrimerTm` (tail + annealing region Tm) — use this for ordering, not `annealingTm`
- **LAMP**: `LAMPPrimerSet` includes `fipBipDimerDG` (bidirectional, at reaction temperature)
- **Graduated GC clamp**: 3-level penalty (strong/single/none) via `calcClampPenalty(seq, maxPenalty)` in utils
- **Input validation**: all `design*` functions validate inputs and return `{ pairs: [], warning }` on invalid input (never throw)
- **`offTarget: 0`** on `PrimerCandidate` is hardcoded — not implemented; use external BLAST for specificity

## abif-ts — ABIF parser
Published on npm as **`@shandley/abif-ts`** v0.1.0. Lives at `../abif-ts` (sibling). Same publish workflow as primd.
- Parses `.ab1` Sanger files: sequence, quality scores, peak positions, all 4 fluorescence trace channels, metadata

## Critical Next.js / shadcn gotchas
- **No `asChild` prop** — shadcn here uses `@base-ui/react`, not Radix UI. Never use `<Button asChild>`. Use `<Link className={buttonVariants({...})}>` instead.
- **`proxy.ts` not `middleware.ts`** — Next.js 16 renamed the file; export is `proxy` not `middleware`.
- **Supabase types**: Use `{ [_ in never]: never }` (NOT `Record<string, never>`) for Views/Functions/Enums or queries return `never`.
- **SeqViz**: Pass `seq` + `annotations` props directly — do NOT use `file` prop (crashes on NCBI GenBank). Topology is controlled via `viewer` prop ("linear"/"circular"/"both"), not a `topology` prop.
- **SeqViz `onSelection`**: When an annotation is clicked, the selection object has `type: "ANNOTATION"` and `name: "AmpR"` (etc). The `ref` field is stripped by SeqViz before reaching `onSelection` — use `name` not `ref`.
- **Turbopack + symlinks**: Do not set `turbopack.root` to expand the filesystem root — it breaks tailwind CSS resolution. Use `file:` protocol for local packages instead.

## Design system
- **Files**: `PRODUCT.md` (strategic: users, brand, anti-references, principles) + `DESIGN.md` (visual: tokens, typography, components, do's/don'ts). Both committed to repo root.
- **Sidecar**: `.impeccable/design.json` — component HTML/CSS snippets, tonal ramps, narrative for the live panel
- **Critique history**: `.impeccable/critique/` — Nielsen heuristic snapshots (started 19/40, improved to ~26-29/40 over 8 passes)
- **North Star**: "The Annotated Manuscript" — parchment palette, Courier Prime for data, Karla for prose, Playfair Display for nav wordmark only (never inside app shell), 4px corners, no box-shadows
- **Color rule**: `#1a4731` (Deep Forest) = interactive affordances ONLY. `#2d7a54` (Forest Mid) = positive-state indicators. Never swap these.

## Sequence viewer — key architecture decisions
- **Annotation editor**: triggered by explicit ✎ button on the annotation badge in the Primers panel. Never auto-opens. Lives inside the panel content area below the tab bar (not above it).
- **Mode-result cache**: switching PCR/qPCR/Assembly modes saves current results and restores the new mode's last results. Amber stale banner identifies which mode's results are showing.
- **Keyboard shortcuts**: Enter (in coord inputs) = design, ↑/↓ = navigate pairs, Esc = cancel/clear, Alt+1-8 = switch tabs (1=Enzymes, 2=Primers, 3=Digest, 4=Align, 5=ORFs, 6=Search, 7=AI, 8=GC)
- **Cancel button**: Design button transforms to amber "× Cancel" while worker runs; also cancellable via Esc
- **Error messages**: primd validation messages passed through directly; fallback is "[mode] design failed for region [s]–[e]. [mode-specific hint]"; worker crash distinguished
- **Assembly options**: Overlap/Enzyme/Search ± live inside the collapsible Options section (not always-visible); Assembly mode auto-opens Options

## Supabase CLI

Linked project: `mexubhrfyfeacpnygpig` (supabase-ori-bio)
URL: `https://mexubhrfyfeacpnygpig.supabase.co`
Docker is NOT running locally — all operations target the remote project.

### Key commands
```bash
# Query remote DB (use --linked flag)
supabase db query --linked "SELECT * FROM public.sequences LIMIT 5;"

# Query auth schema
supabase db query --linked "SELECT id, email FROM auth.users;"

# Push migrations to remote
supabase db push --linked

# Get API keys (anon + service_role)
supabase --workdir . projects api-keys
```

### Gotchas
- `supabase db query` defaults to local Docker — always pass `--linked` for remote
- `supabase secrets` and `supabase auth` subcommands do NOT exist in this CLI version
- No `--project-ref` flag on `db` commands — use `--linked` instead
- Storage uploads and auth user creation require the service role key (in Vercel env as `SUPABASE_SERVICE_ROLE_KEY`)

### Demo account
- **Email**: `demo@ori.bio` | **Password**: `plasmids2025`
- Pre-seeded with pUC19, pBR322, pACYC184, pGEX-4T-1, pEGFP-N1
- Re-seed: `SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/seed-demo.ts`

### Google OAuth
- Provider enabled in Supabase dashboard
- Client ID: `647892611155-m1sip2fi0vhded9aige08i9bj9vrhntn.apps.googleusercontent.com`
- Google Cloud project: `ori-bio` — currently in Testing mode (no 100-user cap with basic scopes)
- To publish: Google Cloud Console → Google Auth Platform → Audience → Publish App (instant)

## HPC (HTCF @ WashU)
Login: `ssh shandley@login.htcf.wustl.edu`
Scheduler: SLURM — default partition `general` (96 nodes × 24 CPU × 750GB RAM, unlimited time)
GPU partition: `gpu` (5 nodes, A100 + V100)

### Key paths
- User scratch: `/scratch/sahlab/shandley/` (2TB quota)
- Software/conda: `/ref/sahlab/software/scott_conda/miniconda/`
- Databases: `/ref/sahlab/data/` (has `nt`, `nr`, bakta, GTDB, etc.)
- Feature DB project: `/scratch/sahlab/shandley/helix-feature-db/`

### Conda activation in scripts
```bash
source /ref/sahlab/software/scott_conda/miniconda/etc/profile.d/conda.sh
conda activate confphylo   # has HMMER3 + MAFFT + MUSCLE + BLAST + Diamond
```

### Pre-installed bioinformatics tools
All in `confphylo` conda env (or separate envs):
- MMseqs2 12.113e3 — sequence clustering
- HMMER3 3.4 — `hmmbuild`, `hmmscan`, `hmmsearch`, `hmmpress`
- MAFFT 7.525 — multiple sequence alignment
- MUSCLE 3.8 — MSA alternative
- BLAST 2.17.0 — `blastn`, `blastp`
- Diamond 2.1.24 — fast protein search
- Container runtime: Podman 4.9.4 (NO Singularity)

### SLURM job script template
```bash
#!/bin/bash
#SBATCH --job-name=jobname
#SBATCH --output=/scratch/sahlab/shandley/helix-feature-db/logs/job_%j.out
#SBATCH --error=/scratch/sahlab/shandley/helix-feature-db/logs/job_%j.err
#SBATCH --time=24:00:00
#SBATCH --mem=64G
#SBATCH --cpus-per-task=16
#SBATCH --partition=general

set -eo pipefail
source /ref/sahlab/software/scott_conda/miniconda/etc/profile.d/conda.sh
conda activate confphylo
```

## Testing

```bash
pnpm test          # vitest — tests in lib/bio/verify-clone.test.ts + lib/bio/codon-optimize.test.ts
pnpm exec tsc --noEmit   # type check
pnpm exec biome check .  # lint
```

## AI features — architecture pattern

Two-layer pattern used for all AI analysis features:
1. **Deterministic layer** (lib/bio/): classifies/scores data with pure functions, emits structured output. Unit-testable. Never calls Claude.
2. **Claude explanation layer** (app/api/): receives deterministic output as structured text context, streams plain-English explanation. Uses `claude-haiku-4-5` for speed/cost. Same auth guard as all routes.

### Clone verification (`lib/bio/verify-clone.ts` + `/api/verify-clone`)
Triggered from the ALIGN tab after Sanger reads are aligned. Two layers:
- Deterministic: walks SW-aligned strings for variants (substitutions, indels), classifies CDS codon changes (silent/missense/nonsense/frameshift, both strands, origin-spanning), computes per-feature coverage via interval union, emits `Verdict`: `CONFIRMED | MUTATION_DETECTED | INCOMPLETE | FAILED`
- Thresholds: `CONFIRMED_MIN_IDENTITY = 0.98`, `CONFIRMED_NO_CDS_IDENTITY = 0.95`, `LOW_QUALITY_THRESHOLD = 20` (Phred), `FULL_COVERAGE_THRESHOLD = 0.98`
- Claude explains the verdict (120-200 words), never decides it
- UI: Verify button appears after alignment; verdict badge appears instantly from deterministic layer; explanation streams in; Coverage table shows per-feature %

### PCR failure diagnosis (`/api/diagnose-pcr`)
Triggered from the PRIMERS tab after primer design runs. Single Claude layer (no separate deterministic verdict — thermodynamic values already computed by primd):
- Sends: primer sequences, Tm, GC%, hairpin ΔG, self-dimer ΔG, hetero-dimer ΔG, template accessibility, product size, ΔTm between primers
- Severity ranking used in prompt: template structure > hetero-dimer > hairpin > ΔTm > GC
- Model: `claude-haiku-4-5`, 512 tokens
- UI: Diagnose button appears after design; explanation streams in; Back to primers returns to normal view

### AI Construct Designer (`/api/design-construct`)
Dashboard → + Design button opens a modal. Two modes:
- **Mode A**: user pastes a DNA gene OR protein sequence (codon-optimized client-side via `lib/bio/codon-optimize.ts`) → Claude selects regulatory parts
- **Mode C**: user describes goal only → Claude selects both CDS (from catalog) and regulatory parts
- Uses `generateObject` with zod schema + `structuredOutputMode: "outputFormat"` (native Anthropic structured outputs, constrained sampling)
- Parts catalog: `lib/bio/parts-catalog.ts` — E. coli (5 promoters, 2 RBS, 2 terminators, 2 ori, 2 markers), Mammalian (CMV/SV40 promoters, Kozak, bGH/SV40 polyA, NeoR/PuroR cassettes, SV40 ori), Yeast (GAL1/TEF1/ADH1 promoters, CYC1/ADH1 terminators, 2μ/CEN-ARS ori, LEU2/TRP1 markers), CDS library (EGFP, mVenus, tdTomato, Firefly luc, Renilla luc, GST tag, CjCas9, SpCas9)
- All parts use real sequences from `public/data/features.json`. Update with `scripts/update-parts-catalog.py`
- Assembly: `lib/bio/assemble-construct.ts` — deterministic assembly + validation (requires ori, marker, ATG, stop codon, strand consistency). Supports E. coli (Mode A/C), Mammalian (auto-includes ColE1+AmpR backbone, requires Kozak before CDS), Yeast (no prokaryotic RBS)
- Save: `app/actions/sequences.ts → saveDesignedConstruct` — saves as GenBank to preserve annotations
- Result navigates to sequence viewer showing fully annotated circular construct

### Codon optimization (`lib/bio/codon-optimize.ts`)
Client-side, no API call. Integrated into Construct Designer modal as a "Protein → codon-optimize" toggle.
- CAI-based: picks highest-frequency synonymous codon per amino acid for target organism
- Organisms: E. coli K-12, Homo sapiens, S. cerevisiae (CoCoPUTs-sourced tables)
- Functions: `optimizeCodon`, `computeCAI`, `computeGC`, `parseProteinSeq`, `validateProtein`
- 23 unit tests in `lib/bio/codon-optimize.test.ts`
- Live preview in modal: shows predicted length, CAI, GC% as user types protein sequence

## Feature annotation database

**Architecture**: The HTCF pipeline is an OFFLINE CURATION TOOL, not a runtime service.
Users never send sequences to HTCF. All annotation runs client-side in a Web Worker.
The pipeline produces a static feature library that ships with the app.

**Do not suggest wiring hmmscan or any HPC tool into the user-facing Ori pipeline.**

### Status: COMPLETE
- `public/data/features.json` deployed with 5,623 high-confidence features
- Sources: SnapGene (2,550 plasmids) + iGEM Registry (15,673 with sequences), clustered at 80% identity
- Canonical names enforced: 11 alias groups normalized (e.g. NeoR-KanR→NeoR/KanR, CMV immediate-early promoter→CMV promoter), 895 exact-sequence duplicates removed
- These features also power the Construct Designer parts catalog — `scripts/update-parts-catalog.py` extracts sequences for any named part from features.json

### Future expansion
- Addgene: licensing incompatible with MIT open-source license (noncommercial only). Explored and closed — see co-occurrence pipeline notes.
- NCBI GenBank SYN division: public domain, but annotation quality too inconsistent for co-occurrence without full re-annotation pass.

## Reference library

**Status: COMPLETE at 311 plasmids**
Seeded from SnapGene public collection on HTCF (`/scratch/sahlab/shandley/helix-feature-db/raw/snapgene/`, 2,550 .gb files).
Covers all major systems: bacterial (pET, pGEX, pMAL, pQE, pRSET, Duet series), mammalian (pcDNA3/4/5/6, pCMV, pCEP4), inducible (Tet-On, pBAD), lentiviral (lentiCRISPR, lentiCas9, psPAX2, pMD2.G, pLKO.1), retroviral (pBABE, pMSCV, pSIREN-RetroQ), baculovirus (pFastBac Bac-to-Bac), yeast S. cerevisiae (full pRS series, pESC, pYES, pAG, pAUR, yeast CRISPR), Pichia (pPICZ, pGAPZ), insect (pAc5.1), plant (pCAMBIA, pBI), CRISPR (pX330/458/459/461, hCas9), AAV, reporter (pGL3/4, pRL), Gateway (pDONR/pDEST), TA cloning (pGEM-T Easy, pCR2.1-TOPO, pJET1.2), two-hybrid (pGADT7, pGBKT7), Sleeping Beauty transposon (pSB1C3, pSB11).

**Seed script**: `scripts/seed-plasmid-library.py` — run on HTCF with `SUPABASE_SECRET_KEY=sb_secret_*` (legacy JWT keys disabled). confphylo conda env has biopython + requests.
