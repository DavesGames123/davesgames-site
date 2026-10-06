// ============================================================================
//  FRACTAL FLAMES  ·  build-palettes.mjs — convert flam3-palettes.xml
// ----------------------------------------------------------------------------
//  A port of flam3 by Scott Draves and the flam3 authors,
//  https://github.com/scottdraves/flam3. The palette data comes from
//  flam3-palettes.xml in that repository; the parse follows parse_palettes
//  in palettes.c (each colour is "00RRGGBB", 256 per palette).
//
//  SPDX-License-Identifier: GPL-3.0-or-later
//  This program is free software: you can redistribute it and/or modify it
//  under the terms of the GNU General Public License as published by the
//  Free Software Foundation, either version 3 of the License, or (at your
//  option) any later version. It is distributed WITHOUT ANY WARRANTY. See
//  the file LICENSE in this directory.
//
//  Usage (from the repo root):
//    node stella-nova/pages/fractal-flames/build-palettes.mjs <flam3-palettes.xml>
//  Writes palettes.bin (count x 256 x RGB bytes, in file order) and
//  palettes.json ({ count, numbers, names }) next to this script.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';

const src = process.argv[2];
if (!src) { console.error('usage: node build-palettes.mjs <flam3-palettes.xml>'); process.exit(2); }
const xml = fs.readFileSync(src, 'utf8');
const here = path.dirname(new URL(import.meta.url).pathname);
const numbers = [], names = [], chunks = [];
const re = /<palette\b([^>]*)\/?>/g;
let m;
while ((m = re.exec(xml))) {
  const a = {};
  for (const q of m[1].matchAll(/(\w+)="([^"]*)"/g)) a[q[1]] = q[2];
  const hex = (a.data || '').replace(/\s+/g, '');
  const buf = Buffer.alloc(768);
  let ok = true;
  for (let i = 0; i < 256; i++) {
    const h = hex.substr(i * 8, 8);
    if (!/^00[0-9a-fA-F]{6}$/.test(h)) { ok = false; break; }
    buf[i * 3] = parseInt(h.substr(2, 2), 16); buf[i * 3 + 1] = parseInt(h.substr(4, 2), 16); buf[i * 3 + 2] = parseInt(h.substr(6, 2), 16);
  }
  if (!ok) { console.error('skip palette', a.number, '(bad hex data)'); continue; }
  numbers.push(+a.number); names.push(a.name || ''); chunks.push(buf);
}
fs.writeFileSync(path.join(here, 'palettes.bin'), Buffer.concat(chunks));
fs.writeFileSync(path.join(here, 'palettes.json'), JSON.stringify({
  license: 'GPL-3.0-or-later. Palette data from flam3-palettes.xml, flam3 by Scott Draves and the flam3 authors, https://github.com/scottdraves/flam3',
  format: 'palettes.bin holds count palettes x 256 colours x 3 bytes (R, G, B), in this order',
  count: numbers.length, numbers, names,
}) + '\n');
console.log('palettes:', numbers.length, 'bytes:', numbers.length * 768);
