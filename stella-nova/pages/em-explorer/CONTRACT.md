# Electron Microscopy Explorer contract

Binding spec for the em-explorer swarm. Read all of it first, then
`stella-nova/PAGES.md` "How to add a page".

## What the user asked for (verbatim, 2026-10-25)

> i want a new page for the website which allows me to view and zoom in
> on open-source electron microscopy data

> dispatch the swarm

## Page

Key and folder `em-explorer`, label "Electron Microscopy Explorer",
nav Science > Life Sciences (the coordinator registers it, with the
saver catalog line, home blurb and thumbnail). Nobody else edits
`lib/nav-data.js`, `lib/screensaver-catalog.js`, `pages/home/**`,
`PAGES.md` or other pages' files.

The page streams real volume-EM data from public buckets and lets the
reader pan and zoom smoothly from the whole specimen down to single
synapses, membranes and organelles, like a map. Nothing is copied into
the repo except small metadata and bookmarks.

## Data sources (probed by the coordinator on 2026-10-25)

| id | Dataset | Format | URL root | CORS | Licence |
|---|---|---|---|---|---|
| hemibrain | Janelia FlyEM hemibrain, fly central brain, 8 nm FIB-SEM | neuroglancer precomputed, JPEG chunks 64^3, sharded v1 | `https://storage.googleapis.com/neuroglancer-janelia-flyem-hemibrain/emdata/clahe_yz/jpeg/` | `*` | CC BY 4.0 |
| minnie65 | MICrONS mouse visual cortex, 8x8x40 nm TEM | precomputed, raw chunks 128x128x16, sharded v1, gzip data encoding | `https://bossdb-open-data.s3.amazonaws.com/iarpa_microns/minnie/minnie65/em/` | `*` | CC BY 4.0 |
| openorganelle | Janelia COSEM / OpenOrganelle cells (for example jrc_hela-2), FIB-SEM | OME-Zarr v2, chunks 128^3, zstd, "/" separator | `https://janelia-cosem-datasets.s3.amazonaws.com/<id>/<id>.zarr/recon-1/em/fibsem-uint8/` | `*` | CC BY 4.0 |
| h01 | Google H01 human cortex | precomputed JPEG, sharded | `https://storage.googleapis.com/h01-release/data/20210601/4nm_raw/` | NOT seen on the info file; verify, else leave out | CC BY 4.0 |

Verify each licence and the exact credit line from the dataset's own
page; quote them in `CREDITS.md`. Range requests are needed for sharded
reads (Range is exposed on GCS). Add more datasets only with CORS `*`
and an open licence (for example more OpenOrganelle cells, other
FlyEM or BossDB volumes). Never put the user's email in a request or a
User-Agent.

Tests may fetch a handful of real chunks to prove the decoders. No bulk
downloads: keep scratch under 500 MB and delete it after (the disk
filled twice in two days; check `df -h /` first).

## Packages

| Package | Owns |
|---|---|
| DATA | `data/**`: format readers and decoders, the chunk cache, the fetch worker, `data/tests.mjs` |
| VIEW | `view/**`: the WebGL2 tiled slice renderer and interaction, `view/tests.mjs` |
| CATALOG | `catalog/**`: dataset records, bookmarks, scale facts, `CREDITS.md`, `catalog/tests.mjs` |
| CORE | `index.html`, `style.css`, `main.js`, `ui/**`, top-level `tests.mjs` |
| SAVER (phase 2) | `saver/**` |

Requests between packages go in `NOTES.md` as dated lines. Work
against a local stub until the other side lands. Commit your public
API header in your first commit.

### DATA API (`data/index.js`)
- `openVolume(record) -> Volume` with `{ id, scales: [{ key, size
  [x,y,z], resolution [nm], chunk [x,y,z], encoding }], dtype, bounds }`.
- `volume.getChunk(scaleIndex, [cx, cy, cz], { signal }) -> { data:
  Uint8Array, shape }` for precomputed (sharded v1: shard index,
  minishard index, gzip or raw minishard, identity and murmurhash3
  hashes, the chunk id bit layout) and unsharded; OME-Zarr v2.
- Decoders: JPEG (createImageBitmap / OffscreenCanvas in a worker;
  a JPEG chunk stacks z slices vertically), raw, gzip
  (DecompressionStream, with a pako-free fallback only if needed),
  zstd (vendor a small MIT decoder such as fzstd at an exact version
  into `stella-nova/vendor/`, licence kept).
- `getSlice(scale, axis, index, rect)`: assembles a 2D tile for VIEW
  from chunks. LRU cache by bytes (cap 256 MB desktop, 96 MB phone),
  request priority by distance to view centre, cancel off-screen
  requests, max 8 in flight.
- All fetching and decoding in a module worker.

### VIEW API (`view/index.js`)
`createViewer(canvas, { source, onState }) -> { setVolume(vol),
setPlane('xy'|'xz'|'yz'), setSlice(nm), goTo({ x, y, z, zoom }),
setContrast(lo, hi, gamma), setInvert(b), state(), resize(), dispose(),
saverShots }`.
- Map-like pan and zoom (wheel, pinch, double tap, keyboard), zoom
  picks the scale level so one screen pixel shows about one voxel, and
  draws coarser tiles under finer ones while they load (no black
  holes). Slice scrolling through z (wheel with shift, a slider, two
  finger drag on phones).
- Scale bar in nm/um, coordinates readout, minimap of the whole
  volume, optional three-plane view.
- WebGL2 textures for tiles; contrast and gamma in the shader.

### CATALOG
Dataset records (name, organism, tissue, method, voxel size, size,
licence, credit, links) and at least 30 curated bookmarks across the
datasets with short plain captions written from reliable sources:
synapses with vesicles, mitochondria cristae, nuclei and nuclear pores,
myelin, blood vessels and red cells, the ER, Golgi, centrioles, and so
on. Each bookmark: dataset, x y z in voxels of scale 0, zoom, plane, a
one-line caption and a source link. Verify each location by fetching
its tile and looking at it (write a small PNG to the scratchpad, Read
it, delete it). Facts about EM methods (FIB-SEM, serial section TEM)
in a short "about the data" text.

### CORE
Full-screen viewer, dataset picker, bookmarks list, contrast controls,
plane switch, share link of the view (lib/share-url.js if it fits),
"about the data" sheet, credits. Phone first: the wave-membrane dock and
bottom sheet pattern, pinch zoom, 44 px targets. STIX Two Text and Inter
from lib/sci.css; sentence-case labels; no Playfair, Cormorant or
JetBrains Mono; never KaTeX. Head order gpu-guard, wishlist,
stats-beacon. `[hidden]{display:none!important}`. A clear message when
WebGL2 or the network is not there.

### SAVER (phase 2)
`window.snSaver`: slow flights between bookmarks with smooth zooms,
5-12 s each, plateBand framing at 16:9 and 9:16, the caption and the
dataset credit on the plate. Prefetch the next shot.

## Validation

No headless Chrome, Playwright, CDP or screenshots. Node tests,
`node --check`, node ESM import of main.js (only a browser
ReferenceError is fine), jsdom boot with `jsdom@24.1.3` from the
scratchpad on NODE_PATH. Decoder tests run on a few real chunks.

## Commits

Branch main. Stage and commit by pathspec in one Bash command; check
`git diff --cached --name-only` first. No `add -A`, amend, rebase,
stash or push. Subject `em-explorer: ...` under 72 characters,
ASD-STE100 body with real validation output and "No browser ran.",
ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
