#!/usr/bin/env node
// ============================================================================
//  MANIM LIVE  ·  tools/reference-compare.mjs  (manim-live vs native manim)
// ----------------------------------------------------------------------------
//  Renders tests/reference/scenes.py with manim-live in Node and compares
//  each frame of FRAMES with tests/reference/native/<Scene>-<i>.png, which
//  tools/reference-native.py wrote with native manim 0.22.0 (pycairo, Pango).
//
//  Metrics per frame:
//    mad      mean absolute difference per channel (R, G, B), 0..255
//    over32   share of pixels where any channel differs by more than 32
//
//  Usage:  node tools/reference-compare.mjs [--json]
//  Module: compareReference(runtime) -> [{scene, frame, mad:[r,g,b], madAll, over32}]
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createNodeRuntime, cacheDir, PAGE_DIR } from './node-env.mjs';

const REF = path.join(PAGE_DIR, 'tests', 'reference');

export function referenceFrames() {
  const src = fs.readFileSync(path.join(REF, 'scenes.py'), 'utf8');
  const m = /FRAMES = (\{[\s\S]*?\n\})/.exec(src);
  return JSON.parse(m[1].replace(/,\s*\}/, '}'));
}

async function decodePng(file) {
  const { loadImage, createCanvas } = await import(pathToFileURL(path.join(cacheDir(), 'node_modules', '@napi-rs', 'canvas', 'index.js')).href);
  const img = await loadImage(fs.readFileSync(file));
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return { w: img.width, h: img.height, data: ctx.getImageData(0, 0, img.width, img.height).data };
}

export function diff(a, b) {
  const n = a.length / 4;
  const sum = [0, 0, 0];
  let over = 0;
  for (let i = 0; i < a.length; i += 4) {
    let big = false;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a[i + c] - b[i + c]);
      sum[c] += d;
      if (d > 32) big = true;
    }
    if (big) over++;
  }
  const mad = sum.map((s) => s / n);
  return { mad, madAll: (mad[0] + mad[1] + mad[2]) / 3, over32: over / n };
}

export async function compareReference(runtime) {
  const code = fs.readFileSync(path.join(REF, 'scenes.py'), 'utf8');
  const frames = referenceFrames();
  const out = [];
  for (const [scene, idxs] of Object.entries(frames)) {
    const kept = new Map();
    const want = new Set(idxs);
    runtime.frameSink = (u8, w, h, index, t, repeat) => {
      for (let k = index; k < index + repeat; k++) if (want.has(k)) kept.set(k, { u8: new Uint8Array(u8), w, h });
    };
    const summary = runtime.run(code, { scene, quality: 'low' }, () => {});
    runtime.frameSink = null;
    if (!summary.ok) throw new Error(`${scene}: ${JSON.stringify(summary.error)}`);
    for (const i of idxs) {
      const live = kept.get(i);
      const nat = await decodePng(path.join(REF, 'native', `${scene}-${i}.png`));
      if (!live) throw new Error(`${scene}: frame ${i} not rendered (${summary.frames} frames)`);
      if (live.w !== nat.w || live.h !== nat.h) throw new Error(`${scene}-${i}: size ${live.w}x${live.h} vs native ${nat.w}x${nat.h}`);
      out.push({ scene, frame: i, frames: summary.frames, ...diff(live.u8, nat.data) });
    }
  }
  return out;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const runtime = await createNodeRuntime();
  const rows = await compareReference(runtime);
  if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 1));
  else {
    console.log('frame                 MAD R   MAD G   MAD B   px >32');
    for (const r of rows) {
      console.log(`${(r.scene + '-' + r.frame).padEnd(20)} ${r.mad.map((v) => v.toFixed(3).padStart(7)).join(' ')}  ${(100 * r.over32).toFixed(2).padStart(6)} %`);
    }
  }
}
