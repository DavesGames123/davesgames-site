#!/usr/bin/env node
// ============================================================================
//  MANIM LIVE  ·  tools/render.mjs  (render a scene in Node, write PNGs)
// ----------------------------------------------------------------------------
//  The same engine as the page (engine-core.js + py/ + the PyPI manim wheel)
//  in Node, with @napi-rs/canvas for the cairo shim. See tools/node-env.mjs
//  for the MANIM_LIVE_CACHE set-up.
//
//  Usage:
//    node tools/render.mjs <file.py> [--scene X] [--quality low|medium|high]
//         [--fps N] [--frames 0,10,last] --out <dir> [--json]
//
//  Prints one summary line (or JSON with --json): frames, size, timings.
//  --frames picks frame indices to save as <out>/<scene>-<index>.png
//  ("last" = final frame). Without --frames only the last frame is saved.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';

import { createNodeRuntime, writePng } from './node-env.mjs';

function parseArgs(argv) {
  const a = { file: null, scene: null, quality: 'low', fps: null, frames: ['last'], out: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--scene') a.scene = argv[++i];
    else if (v === '--quality') a.quality = argv[++i];
    else if (v === '--fps') a.fps = Number(argv[++i]);
    else if (v === '--frames') a.frames = argv[++i].split(',').map((s) => s.trim());
    else if (v === '--out') a.out = argv[++i];
    else if (v === '--json') a.json = true;
    else if (!a.file) a.file = v;
    else throw new Error('unknown argument ' + v);
  }
  if (!a.file || !a.out) throw new Error('usage: node tools/render.mjs <file.py> [--scene X] [--quality low] [--frames 0,10,last] --out <dir>');
  return a;
}

export async function renderFile(opts, runtimeIn = null) {
  const code = fs.readFileSync(opts.file, 'utf8');
  const wanted = new Set(opts.frames.filter((f) => f !== 'last').map(Number));
  const kept = new Map();
  let last = null;
  let firstFrameAt = null;
  const tBoot = Date.now();
  const runtime = runtimeIn || await createNodeRuntime();
  runtime.frameSink = (u8, w, h, index, t, repeat) => {
    if (firstFrameAt === null) firstFrameAt = Date.now();
    for (let k = index; k < index + repeat; k++) if (wanted.has(k)) kept.set(k, { u8, w, h });
    last = { u8, w, h, index: index + repeat - 1 };
  };
  const bootSeconds = (Date.now() - tBoot) / 1000;
  const events = [];
  const t0 = Date.now();
  const summary = runtime.run(code, { scene: opts.scene, quality: opts.quality, fps: opts.fps }, (name, data) => events.push([name, data]));
  const renderSeconds = (Date.now() - t0) / 1000;
  fs.mkdirSync(opts.out, { recursive: true });
  const written = [];
  const sceneName = summary.scene || opts.scene || 'scene';
  for (const [k, f] of kept) {
    const file = path.join(opts.out, `${sceneName}-${k}.png`);
    writePng(runtime, f.u8, f.w, f.h, file); written.push(file);
  }
  if (opts.frames.includes('last') && last) {
    const file = path.join(opts.out, `${sceneName}-last.png`);
    writePng(runtime, last.u8, last.w, last.h, file); written.push(file);
  }
  return {
    summary, events, written, bootSeconds, renderSeconds,
    firstFrameSeconds: firstFrameAt ? (firstFrameAt - t0) / 1000 : null,
    info: runtime.info, runtime,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const r = await renderFile(opts);
    const err = r.events.find(([n]) => n === 'error');
    if (opts.json) {
      console.log(JSON.stringify({ summary: r.summary, written: r.written, bootSeconds: r.bootSeconds, renderSeconds: r.renderSeconds, firstFrameSeconds: r.firstFrameSeconds, events: r.events.filter(([n]) => n !== 'log') }, null, 1));
    } else {
      const s = r.summary;
      console.log(s.ok
        ? `${s.scene}: ${s.frames} frames ${s.width}x${s.height}@${s.fps} (${s.duration.toFixed(2)} s of video) boot ${r.bootSeconds.toFixed(1)} s, render ${r.renderSeconds.toFixed(2)} s, first frame after ${r.firstFrameSeconds?.toFixed(2)} s`
        : `ERROR ${err ? err[1].type + ': ' + err[1].message + ' (line ' + err[1].line + ')\n' + err[1].traceback : JSON.stringify(s)}`);
      for (const f of r.written) console.log('  wrote ' + f);
    }
    process.exit(r.summary.ok ? 0 : 1);
  } catch (e) {
    console.error(e.stack || String(e));
    process.exit(2);
  }
}
