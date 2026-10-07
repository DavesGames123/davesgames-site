#!/usr/bin/env node
// ============================================================================
//  STORM GLOBE  ·  tools/snapshot.mjs  ·  write the data snapshot
// ----------------------------------------------------------------------------
//  The pages workflow runs this at deploy time, every 2 h. It writes
//  snapshot.json and winds.bin into --out (default data/live/ next to the
//  page; not in git). The page loads data/live/ first and data/sample/
//  when data/live/ is missing.
//
//    node stella-nova/pages/storm-globe/tools/snapshot.mjs
//        [--out dir] [--deg 1.5] [--past 48] [--ahead 120] [--sample]
//
//  Sources (all public domain): NHC CurrentStorms.json and GIS zips, JTWC
//  RSS and .tcw warnings, NASA EONET v3, NOAA GFS 1.0 deg on AWS open
//  data. One run makes about 120 requests (most are GFS range requests).
//  NHC sends no CORS header, so this deploy step is the only way the page
//  gets the NHC storms (Atlantic, East and Central Pacific).
//
//  Exit 1 when the winds fail. Nothing is written then, so the deploy
//  keeps the committed sample. Storm or event feeds that fail are noted
//  in snapshot.json "notes" and do not stop the run.
//
//  The tests never run this tool (they use fixtures/), so no test hits a
//  live source.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSnapshot } from '../data.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };
const OUT = path.resolve(opt('out', path.join(HERE, '..', 'data', 'live')));
const DEG = +opt('deg', 1.5), PAST = +opt('past', 48), AHEAD = +opt('ahead', 120);
const SAMPLE = argv.includes('--sample');
const grid = { nx: Math.round(360 / DEG), ny: Math.round(180 / DEG) + 1 };

// every request times out after 40 s; a User-Agent names the site
const f = (url, init = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(40000), headers: { 'User-Agent': 'davesgames.io storm-globe snapshot (GitHub Pages deploy)', ...(init.headers || {}) } });

const t0 = Date.now();
let lastPct = -1;
try {
  const { json, bin } = await buildSnapshot({
    fetch: f, grid, past: PAST, ahead: AHEAD, sample: SAMPLE,
    log: m => console.error('  ' + m),
    onProgress: p => { const q = Math.floor(p * 10); if (q !== lastPct) { lastPct = q; console.error(`  gfs ${q * 10}%`); } },
  });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'winds.bin'), Buffer.from(bin.buffer, bin.byteOffset, bin.byteLength));
  fs.writeFileSync(path.join(OUT, 'snapshot.json'), JSON.stringify(json));
  console.log(`storm-globe snapshot: ${json.storms.length} storms, ${json.events.length} events, ${json.winds.times.length} wind frames (${grid.nx}x${grid.ny}), cycle ${json.winds.cycle}, ${(bin.length / 1024).toFixed(0)} KB, ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${OUT}`);
  if (json.notes.length) console.log('notes: ' + json.notes.join(' | '));
} catch (e) {
  console.error('storm-globe snapshot failed: ' + (e && e.stack || e));
  process.exit(1);
}
