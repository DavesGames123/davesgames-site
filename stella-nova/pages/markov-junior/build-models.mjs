// build-models.mjs — bundle MarkovJunior models into models.json.
//
// usage: node build-models.mjs <path to a MarkovJunior checkout>
//
// Reads models.xml, models/<name>.xml and resources/palette.xml from the
// checkout. Keeps the first entry of each 2D model, and only a model that
// interpreter.js can load: no map, wfc, convchain, search or file rules.
// Writes models.json: { palette: {symbol: hex}, models: [{ name, size,
// steps, xml, colors }] }. The models are MIT, (C) 2022 Maxim Gumin; see
// LICENSE-MarkovJunior.txt.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseXML, Interpreter } from './interpreter.js';

const src = process.argv[2];
if (!src) { console.error('usage: node build-models.mjs <MarkovJunior checkout>'); process.exit(1); }
const here = dirname(fileURLToPath(import.meta.url));
const palette = {};
for (const c of parseXML(readFileSync(join(src, 'resources/palette.xml'), 'utf8')).children) palette[c.attrs.symbol] = c.attrs.value.toLowerCase();

const index = parseXML(readFileSync(join(src, 'models.xml'), 'utf8'));
const seen = new Set(), models = [], skipped = [];
for (const m of index.children.filter((c) => c.tag === 'model')) {
  const a = m.attrs;
  if (seen.has(a.name)) continue;
  seen.add(a.name);
  if (a.d === '3' || a.length || a.height) { skipped.push(`${a.name} (3D)`); continue; }
  const xml = readFileSync(join(src, 'models', `${a.name}.xml`), 'utf8').replace(/^﻿/, '').trim();
  const size = Number(a.size);
  try { Interpreter.load(xml, Math.min(size, 64), Math.min(size, 64)); }
  catch (e) { skipped.push(`${a.name} (${e.message})`); continue; }
  const colors = {};
  for (const c of m.children.filter((x) => x.tag === 'color')) colors[c.attrs.symbol] = c.attrs.value.toLowerCase();
  models.push({ name: a.name, size, steps: a.steps ? Number(a.steps) : 50000, xml, ...(Object.keys(colors).length ? { colors } : {}) });
}
writeFileSync(join(here, 'models.json'), JSON.stringify({ palette, models }));
console.log(`models.json: ${models.length} models, ${skipped.length} skipped`);
for (const s of skipped) console.log('  skip', s);
