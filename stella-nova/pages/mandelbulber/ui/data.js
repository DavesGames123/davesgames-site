// ui/data.js — Mandelbulber page: the catalogs from gen/ and the loader that fills them.
//
// loadData fetches gen/params.json, catalog.json, examples.json and thumbs.json (all
// required), then collections.json, originals.json and preset-thumbs.json (optional).
// It sets the bindings below once, before the panel is built. The other modules only
// read them.
//
// grep: let P  let COLLECTIONS  let byEnum  const fnum  const groupName  const mainSpec  const isNone
//       function loadJson  function loadData

import { specFor } from '../fract.js';
import { fail } from './hud.js';
import { prepareExamples } from '../main.js';

export let P, CAT, EXAMPLES, THUMBS, PTHUMBS = null;
export let COLLECTIONS = [];             // gen/collections.json: author and licence per collection folder
export let byEnum = new Map();           // formula number as stored in .fract -> catalog entry

export const fnum = (f) => f.enumId ?? f.enum ?? f.id;
export const groupName = (f) => (typeof f.group === 'number' ? CAT.groups?.[f.group]?.name : f.group) ?? 'Formulas';
export const mainSpec = (name) => specFor(P, 'main', name);
export const isNone = (f) => !f || f.id === 'none' || fnum(f) === 0;

export async function loadJson(name) {
  const r = await fetch(new URL(`../gen/${name}`, import.meta.url));
  if (!r.ok) throw new Error(`gen/${name}: HTTP ${r.status}`);
  return r.json();
}

// Load the page data. On a failed required file, show the reason on the page and throw.
export async function loadData() {
  let raw, colRaw, origRaw;
  try {
    [P, CAT, raw, THUMBS] = await Promise.all(['params.json', 'catalog.json', 'examples.json', 'thumbs.json'].map(loadJson));
    // The extra presets and their thumbnails are optional: the page works with the upstream examples only.
    [colRaw, origRaw, PTHUMBS] = await Promise.all(['collections.json', 'originals.json', 'preset-thumbs.json']
      .map((n) => loadJson(n).catch((e) => { console.warn(`[mandelbulber] ${e.message}`); return null; })));
  } catch (e) {
    fail(`The page data did not load: ${e.message}`);
    throw e;
  }
  const size = THUMBS.size ?? THUMBS.tile ?? 64;
  const cols = THUMBS.cols ?? THUMBS.columns ?? Math.floor((THUMBS.width ?? 64 * 16) / size);
  const count = THUMBS.count ?? CAT.formulas.length;
  THUMBS = { cols, rows: Math.ceil((THUMBS.height ?? Math.ceil(count / cols) * size) / size),
    url: new URL(`../gen/${THUMBS.file ?? 'thumbs.jpg'}`, import.meta.url).href };
  byEnum = new Map(CAT.formulas.map((f) => [fnum(f), f]));
  if (PTHUMBS) {
    PTHUMBS = { ...PTHUMBS, rows: Math.ceil(PTHUMBS.count / PTHUMBS.cols), url: new URL(`../gen/${PTHUMBS.file ?? 'preset-thumbs.jpg'}`, import.meta.url).href };
  }
  COLLECTIONS = colRaw?.collections || [];
  EXAMPLES = prepareExamples(raw, colRaw, origRaw);
}
