// preset-thumbs.mjs - renders one thumbnail per preset in headless Chrome and packs the sprite.
//
// Part of the Mandelbulber port (GPL-3.0, see ../COPYING).
//
// The presets are the scenes in gen/examples.json (key "e:<file>"), gen/collections.json
// ("c:<folder>/<file>") and gen/originals.json ("o:<id>"). For each preset the tool loads the
// page, renders the scene at 2 x size px with spp samples, takes a CDP screenshot of the canvas
// and scales it down. It also records a check per preset: samples done, compile status,
// console errors, and the mean and spread of the image luma.
//
// Writes:
//   gen/preset-thumbs.jpg   all thumbnails as one sprite, cols per row, in preset order
//   gen/preset-thumbs.json  { cols, size, count, index: { <key>: i } }
//   <report>                one record per preset (default $TMPDIR/mandelbulber-presets.json)
// Each thumbnail and its check are also kept in <cache>/<hash>.png and <hash>.json, so a later
// run renders only the presets that changed (the hash covers the scene data and the settings).
//
// Needs: a static server for the site and Chrome with WebGPU and a CDP port, for example
//   python3 -m http.server 47444 --bind 127.0.0.1                 (from the site root)
//   "Google Chrome" --headless=new --enable-unsafe-webgpu --remote-debugging-port=9444 ...
//   node tools/preset-thumbs.mjs --url http://127.0.0.1:47444/stella-nova/pages/mandelbulber/index.html
// Options: --port N (CDP, default 9444)  --size N (default 96)  --spp N (default 16)
//   --quality N (JPEG, default 72)  --only e,c,o  --match <regex on key>  --force
//   --cache <dir>  --report <file>  --no-sprite
//
// grep: presetList presetKey renderAll packSprite openPage PASS_MEAN PASS_SD

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GEN = path.join(HERE, '..', 'gen');
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const flag = (name) => process.argv.includes(`--${name}`);

const PASS_MEAN = 0.02;   // a mean luma under this is a black frame
const PASS_SD = 0.012;    // a luma spread under this is a flat frame (no surface in view)

export function presetKey(src, e) { return src === 'o' ? `o:${e.id}` : `${src}:${e.file}`; }

// every preset in browser order: upstream examples, collections, site originals
export function presetList(gen = GEN) {
  const load = (f) => (fs.existsSync(path.join(gen, f)) ? JSON.parse(fs.readFileSync(path.join(gen, f), 'utf8')) : null);
  const out = [];
  for (const e of load('examples.json')?.examples ?? []) out.push({ key: presetKey('e', e), e });
  for (const e of load('collections.json')?.examples ?? []) out.push({ key: presetKey('c', e), e });
  for (const e of load('originals.json')?.presets ?? []) out.push({ key: presetKey('o', e), e });
  return out;
}

// formula set of a preset, so that presets with the same shader render one after another
function formulaSet(e) {
  const m = e.main || {};
  const f = [];
  for (let k = 1; k <= 9; k++) if (m[`formula_${k}`]) f.push(m[`formula_${k}`]);
  return f.sort((a, b) => a - b).join(',') || '0';
}

async function openPage(port, width, height) {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pend = new Map(), waits = [], logs = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pend.has(d.id)) { const p = pend.get(d.id); pend.delete(d.id); if (d.error) p.j(new Error(d.error.message)); else p.r(d.result); return; }
    if (d.method === 'Runtime.consoleAPICalled' && /error|warn/.test(d.params.type)) logs.push(d.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    if (d.method === 'Runtime.exceptionThrown') logs.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    for (const w of waits.splice(0)) w(d);
  };
  const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; pend.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  return {
    send, evaluate, logs,
    async goto(url) {
      await send('Page.navigate', { url });
      for (let i = 0; i < 150; i++) {
        await new Promise((r) => setTimeout(r, 200));
        if (await evaluate('!!(window.__mb && __mb.engine)').catch(() => false)) return;
      }
      throw new Error('the page did not start the engine');
    },
    async close() { ws.close(); await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`).catch(() => {}); },
  };
}

// thumbnail mode: no panel or HUD, a fixed square canvas at pixel ratio 1
const SETUP = (px) => `(() => {
  const st = document.createElement('style');
  st.textContent = '#hud,#toggle,#flyBtn,#panel,.tip,.flash{display:none!important}'
    + '.stage{inset:0 auto auto 0!important;width:${px}px!important;height:${px}px!important}'
    + '#gl{width:${px}px!important;height:${px}px!important}';
  document.head.append(st);
  __mb.renderScale.value = 1;
  window.__thumb = async (part, spp, timeout) => {
    __mb.targetSamples.value = spp;
    __mb.loadPartial(part, '');
    const t0 = performance.now();
    await new Promise((r) => setTimeout(r, 50));
    while (performance.now() - t0 < timeout) {
      const i = __mb.info;
      if (i && !i.compiling && i.samples >= spp) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    const i = __mb.info;
    return { ms: Math.round(performance.now() - t0), samples: i?.samples ?? 0, stale: !!i?.stale, status: String(__mb.status || '') };
  };
  return true;
})()`;

const luma = (file) => execFileSync('magick', [file, '-colorspace', 'gray', '-format', '%[fx:mean] %[fx:standard_deviation]', 'info:'])
  .toString().trim().split(' ').map(Number);

export async function renderAll(list, { url, port = 9444, size = 96, spp = 16, cache, force = false, timeout = 90000, log = console.log }) {
  const px = size * 2;
  fs.mkdirSync(cache, { recursive: true });
  const todo = [], report = {};
  for (const p of list) {
    p.hash = crypto.createHash('sha1').update(JSON.stringify([p.e.main, p.e.fractal, size, spp])).digest('hex').slice(0, 16);
    p.file = path.join(cache, `${p.hash}.png`);
    const rec = `${p.file.slice(0, -4)}.json`;
    if (!force && fs.existsSync(rec)) report[p.key] = JSON.parse(fs.readFileSync(rec, 'utf8'));
    else todo.push(p);
  }
  todo.sort((a, b) => formulaSet(a.e).localeCompare(formulaSet(b.e)));
  log(`presets: ${list.length}, cached: ${list.length - todo.length}, to render: ${todo.length}`);
  let page = null, done = 0;
  const t0 = Date.now();
  for (const p of todo) {
    // a fresh page every 60 presets keeps the shader cache of the engine small
    if (!page || done % 60 === 0) {
      for (let k = 0; ; k++) {
        try {
          if (page) await page.close();
          page = await openPage(port, 900, 700);
          await page.goto(url);
          await page.evaluate(SETUP(px));
          break;
        } catch (e) { if (k >= 2) throw e; log(`page start failed (${e.message}), retry`); }
      }
    }
    const n0 = page.logs.length;
    const part = { main: p.e.main, fractal: p.e.fractal };
    let r;
    try {
      r = await page.evaluate(`__thumb(${JSON.stringify(part)}, ${spp}, ${timeout})`);
      const shot = await page.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: px, height: px, scale: 1 } });
      const big = `${p.file}.big.png`;
      fs.writeFileSync(big, Buffer.from(shot.data, 'base64'));
      [r.mean, r.sd] = luma(big);
      execFileSync('magick', [big, '-filter', 'Lanczos', '-resize', `${size}x${size}`, p.file]);
      fs.unlinkSync(big);
    } catch (e) {
      r = { error: String(e.message || e) };
    }
    r.errors = page.logs.slice(n0).map((t) => t.slice(0, 300));
    const fail = [];
    if (r.error) fail.push(r.error);
    if (!r.error && r.samples < spp) fail.push(`timeout at ${r.samples} spp`);
    if (r.stale || /fail|error|not available/i.test(r.status || '')) fail.push(`status: ${r.status}`);
    if (r.errors.length) fail.push(`console: ${r.errors[0]}`);
    if (!r.error && r.mean < PASS_MEAN) fail.push(`black frame (mean ${r.mean})`);
    if (!r.error && r.mean >= PASS_MEAN && r.sd < PASS_SD) fail.push(`flat frame (sd ${r.sd})`);
    r.pass = fail.length === 0;
    if (fail.length) r.fail = fail;
    report[p.key] = r;
    fs.writeFileSync(`${p.file.slice(0, -4)}.json`, JSON.stringify(r));   // the cached check, for a later run
    done++;
    if (!r.pass || done % 25 === 0) log(`${done}/${todo.length} ${((Date.now() - t0) / 1000).toFixed(0)} s  ${r.pass ? 'ok  ' : 'FAIL'} ${p.key}${r.pass ? '' : `  ${fail.join('; ')}`}`);
    if (!r.pass && fs.existsSync(p.file) && !r.mean) fs.unlinkSync(p.file);
  }
  if (page) await page.close();
  return report;
}

export function packSprite(list, { size, cols = 32, quality = 72, out = GEN }) {
  const have = list.filter((p) => fs.existsSync(p.file));
  const rows = Math.ceil(have.length / cols);
  const args = [];
  for (let r = 0; r < rows; r++) {
    args.push('(', ...have.slice(r * cols, r * cols + cols).map((p) => p.file), '+append', '-background', 'black',
      '-gravity', 'west', '-extent', `${cols * size}x${size}`, ')');
  }
  const jpg = path.join(out, 'preset-thumbs.jpg');
  execFileSync('magick', [...args, '-append', '-strip', '-sampling-factor', '4:2:0', '-interlace', 'JPEG', '-quality', String(quality), jpg]);
  const index = {};
  have.forEach((p, i) => { index[p.key] = i; });
  fs.writeFileSync(path.join(out, 'preset-thumbs.json'), JSON.stringify({ cols, size, count: have.length, index }));
  return { count: have.length, missing: list.length - have.length, bytes: fs.statSync(jpg).size, width: cols * size, height: rows * size };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = arg('url');
  if (!url) { console.error('usage: node tools/preset-thumbs.mjs --url <page url> [--port 9444] [--size 96] [--spp 16] [--only e,c,o] [--match re] [--force]'); process.exit(2); }
  const size = Number(arg('size', 96)), spp = Number(arg('spp', 16));
  const cache = arg('cache', path.join(os.tmpdir(), 'mandelbulber-thumbs'));
  const only = arg('only', 'e,c,o').split(',');
  const match = arg('match') ? new RegExp(arg('match')) : null;
  const all = presetList();
  const pick = all.filter((p) => only.includes(p.key[0]) && (!match || match.test(p.key)));
  const report = await renderAll(pick, { url, port: Number(arg('port', 9444)), size, spp, cache, force: flag('force') });
  const repFile = arg('report', path.join(os.tmpdir(), 'mandelbulber-presets.json'));
  fs.writeFileSync(repFile, JSON.stringify(report, null, 1));
  const recs = Object.values(report);
  console.log(`rendered ${recs.length}: pass ${recs.filter((r) => r.pass).length}, fail ${recs.filter((r) => !r.pass).length}; report ${repFile}`);
  if (!flag('no-sprite')) {
    for (const p of all) {
      p.hash = crypto.createHash('sha1').update(JSON.stringify([p.e.main, p.e.fractal, size, spp])).digest('hex').slice(0, 16);
      p.file = path.join(cache, `${p.hash}.png`);
    }
    const s = packSprite(all, { size, quality: Number(arg('quality', 72)) });
    console.log(`sprite: ${s.count} thumbnails, ${s.missing} missing, ${s.width}x${s.height} px, ${s.bytes} bytes`);
  }
}
