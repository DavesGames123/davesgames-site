// ============================================================================
//  WASM-4 ARCADE  ·  node tests  (node tests.mjs [--frames 600])
// ----------------------------------------------------------------------------
//  Checks, with no browser (headless browsers are not used on this site):
//    manifest.   every cart in carts.json: sha256 and size of the file,
//                 at most 65536 bytes, a permitted licence, the licence
//                 text on disk matches the licence, a row in CREDITS.md
//    fb.          framebuffer.js: rect fill and stroke, line ends, hline
//                 clip, text, a 2bpp blit with flip, composite to RGBA
//    host.        runtime/host.js: default palette and DRAW_COLORS, disk
//                 round trip and the 1024-byte cap, tracef, a cart that
//                 traps paints the blue screen, an oversized cart is
//                 refused
//    carts.       each cart runs start + N update frames under the
//                 attract autopilot: no trap, the framebuffer changes,
//                 the label frame is not one flat colour
//    apu.         apu-worklet.js in a polyfill: 440 Hz pulse, MIDI note 69,
//                 pan right is silent on the left, envelope ends
//    attract.     planReel: every cart before a repeat, no cart twice in
//                 a row, 6..12 s, seeds differ; the autopilot presses X
//    input.       dirBits 8-way and dead zone; padBits standard mapping
//    crt.         persist(); crt.wgsl through ~/.cargo/bin/naga (when it
//                 is there); no mixed * ^ or && || without parentheses
//    page.        head order (gpu-guard, then wishlist), [hidden] rule,
//                 overflow-x on html only, every $('id') of main.js is in
//                 index.html, main.js links (a ReferenceError on a browser
//                 global is correct, a SyntaxError is a bug)
//    boot.        main.js and saver.js in a linkedom DOM with a stub 2D
//                 canvas (the no-WebGPU path): the shelf and credits fill,
//                 the first cart runs, the CRT button and slider work, the
//                 saver enters, sends a plate with no code, runs a cart and
//                 exits. Skipped when linkedom is not found (set LINKEDOM).
//    scene.       the 3D room in node (three r160 from ../../vendor through a
//                 resolve hook, a stub canvas): the room builds with finite
//                 geometry, the TV glass, console slot, 20 rack slots and
//                 64 keys exist, the cans carry no brand name, frameFor
//                 fits the TV and the desk at four aspects, every cart
//                 builds with a label, the swap tracks start, seat and end
//                 where they must; screen.js GLSL, turned into Vulkan
//                 GLSL 450, through ~/.cargo/bin/naga
//    room.        main.js in a fresh linkedom DOM with three resolved and a
//                 stand-in renderer (window.__w4TestRenderer): the 3D room
//                 boots with the first cart seated; a click on a rack cart
//                 swaps it physically (static while the slot is empty, the
//                 cart boots when it seats, the old cart goes home); a drag
//                 onto the console swaps, a drag elsewhere goes home; a tap
//                 on the glass arms the keys and sets the mouse; the reset
//                 button pushes and reboots; a key press moves a 3D key;
//                 the view button; the saver runs in the room and exits;
//                 pagehide releases the renderer
//  Exit code 1 on any failure.
// ============================================================================
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as K from './runtime/constants.js';
import { Framebuffer } from './runtime/framebuffer.js';
import { Wasm4, memoryDisk } from './runtime/host.js';
import { planReel, Autopilot } from './attract.js';
import { dirBits, padBits } from './input.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const argFrames = process.argv.indexOf('--frames');
const FRAMES = argFrames > 0 ? +process.argv[argFrames + 1] : 600;
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };
const group = (name, n0) => console.log(`${name.padEnd(10)} ${pass - n0.p} pass, ${fail - n0.f} fail`);
const mark = () => ({ p: pass, f: fail });
const read = p => readFileSync(join(HERE, p));
const manifest = JSON.parse(read('carts.json'));

// ------------------------------------------------------------------ manifest
{
  const m0 = mark();
  const ALLOW = { MIT: /Permission is hereby granted, free of charge/, ISC: /Permission to use, copy, modify, and\/or distribute/, 'BSD-2-Clause': /Redistribution and use in source and binary forms/, 'BSD-3-Clause': /Redistribution and use in source and binary forms/, 'Apache-2.0': /Apache License/, 'CC0-1.0': /CC0/, 'CC-BY-4.0': /Attribution 4\.0/, Zlib: /zlib/i, Unlicense: /unlicense/i };
  const credits = read('CREDITS.md').toString();
  const ids = new Set();
  ok(manifest.carts.length >= 10 && manifest.carts.length <= 20, 'manifest: 10 to 20 carts');
  for (const c of manifest.carts) {
    ok(!ids.has(c.id), `manifest: unique id ${c.id}`); ids.add(c.id);
    const b = read(c.file);
    ok(createHash('sha256').update(b).digest('hex') === c.sha256, `manifest: sha256 of ${c.id}`);
    ok(b.length === c.bytes && b.length <= K.CART_LIMIT, `manifest: size of ${c.id}`);
    ok(Object.hasOwn(ALLOW, c.licence), `manifest: permitted licence for ${c.id} (${c.licence})`);
    ok(existsSync(join(HERE, c.licenceFile || '')) && ALLOW[c.licence] && ALLOW[c.licence].test(read(c.licenceFile).toString()), `manifest: licence text of ${c.id}`);
    ok(/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(c.repo) && c.licenceUrl && c.licenceUrl.toLowerCase().startsWith(c.repo.toLowerCase() + '/'), `manifest: repo and licence URL of ${c.id}`);
    ok(credits.includes(c.repo) && credits.includes(c.title), `manifest: CREDITS.md row for ${c.id}`);
    ok(c.author && c.blurb && c.controls && c.licenceCopyright, `manifest: text fields of ${c.id}`);
  }
  group('manifest.', m0);
}

// -------------------------------------------------------------- framebuffer
const fbHash = bytes => { let s = 2166136261; for (const x of bytes) s = Math.imul(s ^ x, 16777619) >>> 0; return s; };
{
  const m0 = mark();
  const mem = new ArrayBuffer(65536), dv = new DataView(mem), fb = new Framebuffer(mem);
  const px = (x, y) => (fb.bytes[(y * 160 + x) >> 2] >> ((x & 3) << 1)) & 3;
  ok(K.FONT.length === 224 * 8, 'fb: the font has 224 glyphs of 8 bytes');
  dv.setUint16(K.ADDR_DRAW_COLORS, 0x0042, true); // fill colour 2 -> index 1, stroke 4 -> index 3
  fb.drawRect(10, 10, 8, 6);
  ok(px(10, 10) === 3 && px(17, 15) === 3 && px(12, 12) === 1 && px(18, 10) === 0 && px(10, 16) === 0, 'fb: rect fill and stroke');
  fb.clear(); dv.setUint16(K.ADDR_DRAW_COLORS, 0x0003, true);
  fb.drawLine(0, 0, 159, 159);
  ok(px(0, 0) === 2 && px(159, 159) === 2 && px(80, 80) === 2 && px(1, 0) === 0, 'fb: line ends and middle');
  fb.clear(); fb.drawHLine(-20, 5, 40);
  let n = 0; for (let x = 0; x < 160; x++) n += px(x, 5) ? 1 : 0;
  ok(n === 20, 'fb: hline clips at x = 0');
  fb.clear(); dv.setUint16(K.ADDR_DRAW_COLORS, 0x0004, true);
  fb.drawText([65, 0], 0, 0);
  let lit = 0; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) lit += px(x, y) === 3 ? 1 : 0;
  ok(lit > 10 && lit < 40, 'fb: text "A" lights part of an 8 x 8 cell');
  fb.clear(); dv.setUint16(K.ADDR_DRAW_COLORS, 0x4321, true);
  const spr = Uint8Array.of(0b00011011, 0b00011011); // 2bpp, 4 px per byte: 0 1 2 3
  fb.blit(spr, 0, 0, 4, 2, 0, 0, 4, true);
  ok(px(0, 0) === 0 && px(1, 0) === 1 && px(2, 0) === 2 && px(3, 0) === 3, 'fb: 2bpp blit maps through DRAW_COLORS');
  fb.clear(); fb.blit(spr, 0, 0, 4, 2, 0, 0, 4, true, true);
  ok(px(0, 0) === 3 && px(3, 0) === 0, 'fb: blit flipX');
  const h = new Wasm4();
  h.fb.drawRect(0, 0, 160, 160);
  const rgba = h.composite(new Uint8Array(160 * 160 * 4));
  // DRAW_COLORS 0x1203: fill = draw colour 3 = palette index 2 (0x306850)
  ok(rgba[0] === 0x30 && rgba[1] === 0x68 && rgba[2] === 0x50 && rgba[3] === 255, 'fb: composite maps index 2 through the palette');
  group('fb.', m0);
}

// --------------------------------------------------------------------- host
// A hand-assembled cart: imports env.memory, exports update = unreachable.
const TRAP = Uint8Array.of(0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 1, 4, 1, 0x60, 0, 0,
  2, 16, 1, 3, 0x65, 0x6e, 0x76, 6, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 2, 1, 1, 1,
  3, 2, 1, 0, 7, 10, 1, 6, 0x75, 0x70, 0x64, 0x61, 0x74, 0x65, 0, 0, 10, 5, 1, 3, 0, 0, 0x0b);
{
  const m0 = mark();
  const h = new Wasm4();
  ok(h.data.getUint32(K.ADDR_PALETTE, true) === 0xe0f8cf && h.data.getUint32(K.ADDR_PALETTE + 12, true) === 0x071821, 'host: default palette');
  ok(h.data.getUint16(K.ADDR_DRAW_COLORS, true) === 0x1203, 'host: default DRAW_COLORS');
  ok(h.data.getInt16(K.ADDR_MOUSE_X, true) === 0x7fff, 'host: mouse starts off screen');
  const saved = [];
  const disk = { read: () => saved.at(-1) || null, write: b => saved.push(b) };
  const d = new Wasm4({ disk });
  const mem = new Uint8Array(d.memory.buffer);
  mem.set([1, 2, 3, 4, 5], 0x2000);
  ok(d.diskw(0x2000, 5) === 5 && saved.length === 1 && saved[0][4] === 5, 'host: diskw writes through the disk object');
  const d2 = new Wasm4({ disk });
  ok(d2.diskr(0x3000, 100) === 5 && new Uint8Array(d2.memory.buffer)[0x3004] === 5, 'host: diskr reads a saved disk back');
  ok(d.diskw(0x2000, 5000) === 1024, 'host: diskw caps at 1024 bytes');
  const blocked = new Wasm4({ disk: { read() { throw new Error('blocked'); }, write() { throw new Error('blocked'); } } });
  ok(blocked.diskw(0x2000, 4) === 4 && blocked.diskr(0x2100, 4) === 4, 'host: a blocked storage keeps the save in memory');
  let traced = '';
  const t = new Wasm4({ onTrace: s => { traced = s; } });
  const tm = new Uint8Array(t.memory.buffer), dv = new DataView(t.memory.buffer);
  const fmt = 'n=%d h=%x s=%s %%'; for (let i = 0; i < fmt.length; i++) tm[0x4000 + i] = fmt.charCodeAt(i); tm[0x4000 + fmt.length] = 0;
  tm.set([111, 107, 0], 0x4100); dv.setInt32(0x4200, -7, true); dv.setInt32(0x4204, 255, true); dv.setUint32(0x4208, 0x4100, true);
  t.tracef(0x4000, 0x4200);
  ok(traced === 'n=-7 h=ff s=ok %', `host: tracef formats %d %x %s %% (${traced})`);
  const tr = new Wasm4();
  await tr.load(TRAP);
  ok(tr.update() === false && tr.crashed instanceof WebAssembly.RuntimeError, 'host: a trap stops the console');
  ok(tr.data.getUint32(K.ADDR_PALETTE, true) === 0x1111ee && tr.fb.bytes.some(b => b), 'host: a trap paints the blue screen');
  let refused = false;
  try { await new Wasm4().load(new Uint8Array(70000)); } catch (e) { refused = e.name === 'CartError'; }
  ok(refused, 'host: a cart over 65536 bytes is refused');
  group('host.', m0);
}

// -------------------------------------------------------------------- carts
{
  const m0 = mark();
  const rgba = new Uint8Array(160 * 160 * 4);
  for (const c of manifest.carts) {
    const h = new Wasm4({ disk: memoryDisk() });
    let loaded = true;
    try { await h.load(read(c.file)); } catch (e) { loaded = false; }
    ok(loaded, `carts: ${c.id} instantiates`);
    if (!loaded) continue;
    const ap = new Autopilot(1234, 'play', c.input);
    const hashes = new Set(); let labelFlat = true, worst = 0;
    for (let f = 0; f < FRAMES && !h.crashed; f++) {
      const o = ap.step(h.frame); h.setGamepad(0, o.pad); h.setMouse(o.mx, o.my, o.mb);
      const t0 = performance.now(); h.update(); worst = Math.max(worst, performance.now() - t0);
      if (f % 20 === 0) hashes.add(fbHash(h.fb.bytes));
      if (f === Math.min(c.labelFrame, FRAMES - 1) - 1) {
        h.composite(rgba);
        for (let i = 4; i < rgba.length; i += 4) if (rgba[i] !== rgba[0] || rgba[i + 1] !== rgba[1] || rgba[i + 2] !== rgba[2]) { labelFlat = false; break; }
      }
    }
    ok(!h.crashed, `carts: ${c.id} runs ${FRAMES} frames with no trap${h.crashed ? ' (' + h.crashed.message + ')' : ''}`);
    ok(hashes.size >= 2, `carts: ${c.id} framebuffer changes (${hashes.size} distinct)`);
    ok(!labelFlat, `carts: ${c.id} label frame ${c.labelFrame} is not one flat colour`);
    console.log(`  ${c.id.padEnd(16)} frames ${h.frame}  distinct ${String(hashes.size).padStart(2)}  worst ${worst.toFixed(1)} ms  tones ${h.tones || 0}`);
  }
  group('carts.', m0);
}

// ---------------------------------------------------------------------- apu
{
  const m0 = mark();
  let Proc = null;
  new Function('registerProcessor', 'AudioWorkletProcessor', read('runtime/apu-worklet.js').toString())((n, p) => { Proc = p; }, class {});
  const crossings = (f, d, v, flags, frames = 4410) => {
    const a = new Proc(); a.tone(f, d, v, flags);
    const L = new Float32Array(frames), R = new Float32Array(frames); a.process(null, [[L, R]]);
    let z = 0, pk = 0, pr = 0; for (let i = 1; i < frames; i++) { if (L[i - 1] < 0 && L[i] >= 0) z++; pk = Math.max(pk, Math.abs(L[i])); pr = Math.max(pr, Math.abs(R[i])); }
    return { z, pk, pr, a };
  };
  const p = crossings(440, 60, 100, 0);
  ok(Math.abs(p.z - 44) <= 1 && Math.abs(p.pk - 0.15) < 0.01, `apu: 440 Hz pulse (${p.z} crossings in 0.1 s, peak ${p.pk.toFixed(3)})`);
  const n = crossings(69, 60, 100, 0x40 | 2);
  ok(Math.abs(n.z - 44) <= 1, `apu: MIDI note 69 on the triangle is 440 Hz (${n.z})`);
  const r = crossings(440, 60, 100, 0x20);
  ok(r.pk === 0 && r.pr > 0.1, 'apu: pan right is silent on the left');
  const e = crossings(440, 6, 100, 0, 44100 * 0.3);
  const a = e.a, L = new Float32Array(512), R = new Float32Array(512); a.process(null, [[L, R]]);
  ok(L.every(x => x === 0), 'apu: a 6-frame note has ended after 0.3 s');
  group('apu.', m0);
}

// ------------------------------------------------------------------ attract
{
  const m0 = mark();
  const C = manifest.carts, reel = planReel(C, 99, C.length * 2);
  const first = new Set(reel.slice(0, C.length).map(s => s.id));
  ok(first.size === C.length, 'attract: every cart plays before one comes back');
  ok(reel.every((s, i) => i === 0 || s.id !== reel[i - 1].id), 'attract: no cart twice in a row');
  ok(reel.every(s => s.dur >= 6 && s.dur <= 12), 'attract: shots are 6 to 12 s');
  ok(planReel(C, 1, 6).map(s => s.id).join() !== planReel(C, 2, 6).map(s => s.id).join(), 'attract: seeds give different reels');
  const ap = new Autopilot(5, 'play', 'mouse'); let x = 0, mb = 0;
  for (let f = 0; f < 400; f++) { const o = ap.step(f); if (o.pad & K.BUTTON_X) x++; if (o.mb) mb++; }
  ok(x >= 8 && mb > 50, `attract: the autopilot taps X (${x} frames) and drags the mouse (${mb})`);
  const tp = new Autopilot(5, 'title'); ok([0, 100, 300].every(f => tp.step(f).pad === 0), 'attract: title shots press nothing');
  group('attract.', m0);
}

// -------------------------------------------------------------------- input
{
  const m0 = mark();
  ok(dirBits(0, 0, 50) === 0 && dirBits(5, 0, 50) === 0, 'input: dead zone');
  ok(dirBits(40, 0, 50) === K.BUTTON_RIGHT && dirBits(-40, 0, 50) === K.BUTTON_LEFT && dirBits(0, -40, 50) === K.BUTTON_UP && dirBits(0, 40, 50) === K.BUTTON_DOWN, 'input: four directions');
  ok(dirBits(30, 30, 50) === (K.BUTTON_RIGHT | K.BUTTON_DOWN) && dirBits(-30, -30, 50) === (K.BUTTON_LEFT | K.BUTTON_UP), 'input: diagonals');
  const btn = i => Array.from({ length: 17 }, (_, k) => ({ pressed: k === i }));
  ok(padBits(btn(0), [0, 0]) === K.BUTTON_X && padBits(btn(1), [0, 0]) === K.BUTTON_Z && padBits(btn(12), [0, 0]) === K.BUTTON_UP, 'input: standard gamepad buttons');
  ok(padBits(btn(-1), [-0.9, 0.9]) === (K.BUTTON_LEFT | K.BUTTON_DOWN), 'input: left stick');
  group('input.', m0);
}

// ---------------------------------------------------------------------- crt
{
  const m0 = mark();
  const { persist, glassRect } = await import('./crt.js').catch(() => ({}));
  if (persist) {
    const prev = new Float32Array(8), out = new Uint8Array(8);
    persist(prev, Uint8Array.of(200, 0, 0, 255, 0, 0, 0, 255), out, 0.5);
    persist(prev, Uint8Array.of(0, 0, 0, 255, 0, 0, 0, 255), out, 0.5);
    ok(out[0] === 100 && out[3] === 255, 'crt: persistence halves a dark pixel per frame');
    const g = glassRect(400, 300);
    ok(g.w === g.h && g.x > 0 && g.y > 0 && g.x + g.w < 400, 'crt: glass is a centred square');
  } else ok(false, 'crt: crt.js imports in node');
  const wgsl = read('shaders/crt.wgsl').toString().split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  ok(!/\*[^;\n]*\^|\^[^;\n]*\*/.test(wgsl), 'crt: no mixed * and ^ in a line');
  ok(!wgsl.split('\n').some(l => /&&/.test(l) && /\|\|/.test(l)), 'crt: no && and || in one line');
  const naga = join(homedir(), '.cargo/bin/naga');
  if (existsSync(naga)) {
    let out = '';
    try { out = execFileSync(naga, [join(HERE, 'shaders/crt.wgsl')]).toString(); } catch (e) { out = String(e.stdout || e.message); }
    ok(/Validation successful/.test(out), 'crt: naga validates crt.wgsl');
  } else console.log('  naga not found: WGSL validation skipped');
  group('crt.', m0);
}

// --------------------------------------------------------------------- page
const html = read('index.html').toString(), css = read('style.css').toString(), mainSrc = read('main.js').toString();
{
  const m0 = mark();
  const heads = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  ok(heads[0] === '../../lib/gpu-guard.js' && heads[1] === '../../lib/wishlist.js', 'page: gpu-guard first, wishlist second');
  ok(/\[hidden\]\{display:none!important\}/.test(css), 'page: [hidden] rule');
  ok(/html\{[^}]*overflow-x:hidden/.test(css) && !/body\{[^}]*overflow-x/.test(css), 'page: overflow-x on html only');
  ok(/name="viewport"/.test(html) && /name="description"/.test(html), 'page: viewport and description');
  const ids = new Set([...mainSrc.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)].map(m => m[1]));
  const missing = [...ids].filter(id => !html.includes(`id="${id}"`));
  ok(!missing.length, `page: every $('id') of main.js is in index.html ${missing.join(' ')}`);
  ok(/href="https:\/\/wasm4\.org"/.test(html), 'page: link to wasm4.org');
  // In a child node, so a failed evaluation does not stay in this module cache.
  const code = `try { await import(${JSON.stringify(pathToFileURL(join(HERE, 'main.js')).href)}); console.log('none') } catch (e) { console.log(e.name + ': ' + e.message) }`;
  const res = execFileSync(process.execPath, ['--input-type=module', '-e', code]).toString().trim();
  ok(res === 'none' || res.startsWith('ReferenceError'), `page: main.js links (${res})`);
  group('page.', m0);
}

// --------------------------------------------------------------------- boot
await bootTest();
async function bootTest() {
  const m0 = mark();
  const cands = [process.env.LINKEDOM, '/usr/local/lib/node_modules/openclaw/node_modules/linkedom/esm/index.js'].filter(Boolean);
  const lp = cands.find(p => existsSync(p));
  if (!lp) { console.log('boot.      skipped: linkedom not found (set LINKEDOM)'); return; }
  const { parseHTML } = await import(pathToFileURL(lp).href);
  const { window, document } = parseHTML(html);
  const raf = [];
  const ctx2d = () => {
    const grad = { addColorStop() {} };
    const base = { canvas: null, createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }), getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      createLinearGradient: () => grad, createRadialGradient: () => grad, measureText: t => ({ width: String(t).length * 6 }) };
    return new Proxy(base, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  };
  const store = new Map();
  Object.assign(globalThis, {
    window, document, localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    requestAnimationFrame: f => { raf.push(f); return raf.length; }, cancelAnimationFrame: () => {}, innerWidth: 390, innerHeight: 800, devicePixelRatio: 2,
    getComputedStyle: () => ({}), btoa: s => Buffer.from(s, 'binary').toString('base64'), atob: s => Buffer.from(s, 'base64').toString('binary'),
  });
  Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => [] }, configurable: true });
  window.devicePixelRatio = 2; window.innerWidth = 390; window.innerHeight = 800;
  const proto = Object.getPrototypeOf(document.createElement('canvas'));
  proto.getContext = function (t) { return t === '2d' ? (this.__c ||= ctx2d()) : null; };
  const El = Object.getPrototypeOf(Object.getPrototypeOf(proto));
  for (const P of [proto, El]) P.getBoundingClientRect = function () { return { left: 0, top: 0, x: 0, y: 0, width: 360, height: 360, right: 360, bottom: 360 }; };
  globalThis.fetch = async u => { const p = fileURLToPath(String(u)); const b = readFileSync(p); return { ok: true, status: 200, json: async () => JSON.parse(b), text: async () => b.toString(), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; };
  const errors = [];
  const origWarn = console.warn; console.warn = (...a) => { errors.push(a.map(String).join(' ')); };
  let clock = 1000;
  const tick = async (n, dtMs = 17) => { for (let i = 0; i < n; i++) { const fs = raf.splice(0); clock += dtMs; const t = clock; for (const f of fs) { try { f(t); } catch (e) { errors.push('raf: ' + e.message); } } await new Promise(r => setTimeout(r, 0)); } };
  try {
    await import(pathToFileURL(join(HERE, 'main.js')).href + '?boot');
    for (let i = 0; i < 40 && !(window.__w4 && window.__w4.host && window.__w4.host.frame > 0); i++) await tick(1);
    await tick(20);
    const S = window.__w4;
    ok(document.querySelectorAll('#shelf .cart').length === manifest.carts.length, 'boot: the shelf has every cart');
    ok(document.querySelectorAll('#creditRows tr').length === manifest.carts.length, 'boot: the credits table has every cart');
    ok(S && S.tube && S.tube.kind === '2d', 'boot: no WebGPU -> the 2D SSTV tube');
    ok(S && S.host && S.host.frame > 5 && !S.host.crashed, `boot: the first cart runs (${S && S.host ? S.host.frame : 0} frames)`);
    ok(document.getElementById('ciTitle').textContent === S.cart.title && document.getElementById('ciLinks').querySelectorAll('a').length === 3, 'boot: info card shows the cart, source and licence');
    document.getElementById('crtBtn').dispatchEvent(new window.Event('click'));
    ok(S.fx === 0 && document.getElementById('crtBtn').getAttribute('aria-pressed') === 'false', 'boot: CRT button turns the CRT off');
    document.getElementById('crtBtn').dispatchEvent(new window.Event('click'));
    const sl = document.getElementById('crtStr'); sl.value = '40'; sl.dispatchEvent(new window.Event('input'));
    ok(Math.abs(S.fx - 0.4) < 1e-9, 'boot: the strength slider sets the CRT strength');
    ok(store.has('sn-wasm4-crt'), 'boot: CRT setting kept in localStorage');
    const cartBtn = document.querySelectorAll('#shelf .cart')[3];
    cartBtn.dispatchEvent(new window.Event('click'));
    for (let i = 0; i < 20 && S.cart.id !== cartBtn.dataset.id; i++) await tick(1);
    await tick(10);
    ok(S.cart.id === cartBtn.dataset.id && S.host.frame > 2, 'boot: a shelf click changes the cart');
    // saver
    let plate = null, plates = 0;
    const res = window.snSaver.enter({ seed: 42, calm: 0.5, label: p => { if (p) { plate = p; plates++; } } });
    ok(res && res.canvas && document.body.contains(res.canvas) && res.warmupMs > 0, 'boot: saver returns a canvas in the document');
    for (let i = 0; i < 60 && !(window.snSaver.debug() && window.snSaver.debug().frame > 10); i++) await tick(1);
    const dbg = window.snSaver.debug();
    ok(window.__w4Saver === true && dbg && dbg.frame > 10, `boot: saver runs a cart (${JSON.stringify(dbg)})`);
    ok(plate && plate.title && !('code' in plate) && plate.lines.join(' ').includes('ISC'), 'boot: saver plate names the cart, no code');
    const f0 = S.host.frame; await tick(5);
    ok(S.host.frame === f0, 'boot: the page loop stops while the saver runs');
    window.snSaver.cut(); for (let i = 0; i < 60 && (window.snSaver.debug().cart === dbg.cart || plates < 2); i++) await tick(1);
    ok(window.snSaver.debug().cart !== dbg.cart && plates >= 2, `boot: saver cuts to another cart with a new plate (${dbg.cart} -> ${window.snSaver.debug().cart}, ${plates} plates)`);
    window.snSaver.exit();
    ok(!document.getElementById('snSaverCv') && window.__w4Saver === false, 'boot: saver exits and removes its canvas');
    ok(!errors.length, `boot: no warnings or loop errors ${errors.slice(0, 3).join(' | ')}`);
  } catch (e) { ok(false, 'boot: ' + (e && e.stack || e)); }
  console.warn = origWarn;
  group('boot.', m0);
}

// -------------------------------------------------------------------- scene
await sceneTest();
async function sceneTest() {
  const m0 = mark();
  const { register } = await import('node:module');
  const V = pathToFileURL(join(HERE, '../../vendor/three@0.160.0/')).href;
  register('data:text/javascript,' + encodeURIComponent(`
    export async function resolve(s, c, next) {
      if (s === 'three') return next(${JSON.stringify(V + 'build/three.module.js')}, c);
      if (s.startsWith('three/addons/')) return next(${JSON.stringify(V + 'examples/jsm/')} + s.slice(13), c);
      return next(s, c);
    }`));
  // a canvas whose 2D context accepts every call (also when boot. ran first)
  const noop = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'width' ? 10 : noop), apply: () => noop, set: () => true });
  const stubCanvas = () => ({ width: 1, height: 1, style: {}, getContext: () => noop, addEventListener() {}, toDataURL: () => '' });
  globalThis.document = { createElement: t => (t === 'canvas' ? stubCanvas() : { style: {} }), createElementNS: () => stubCanvas() };
  let THREE, room, props, carts3d, swap;
  try {
    THREE = await import('three');
    room = await import('./room.js'); props = await import('./props.js'); carts3d = await import('./carts3d.js'); swap = await import('./swap.js');
  } catch (e) { ok(false, 'scene: modules import in node: ' + (e && e.stack || e)); group('scene.', m0); return; }
  const R = room.buildRoom();
  let meshes = 0, bad = [];
  R.scene.traverse(o => {
    if (!o.isMesh) return; meshes++;
    const a = o.geometry.attributes.position.array;
    for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) { bad.push(o.name || o.geometry.type); break; }
  });
  ok(meshes > 120 && !bad.length, `scene: the room builds, ${meshes} meshes, finite geometry ${bad.slice(0, 3).join(' ')}`);
  ok(R.tv.glass && R.tv.glass.userData.pick.type === 'screen', 'scene: the TV glass is a pick target');
  ok(R.rack.slots.length === 20 && R.rack.slots.length >= manifest.carts.length, `scene: the rack has a slot for every cart (${R.rack.slots.length})`);
  const sl = R.rack.slots; let minD = 1e9;
  for (let i = 0; i < sl.length; i++) for (let j = i + 1; j < sl.length; j++) minD = Math.min(minD, sl[i].distanceTo(sl[j]));
  ok(minD >= room.DIM.cart.w * 0.9, `scene: rack slots do not overlap (min ${minD.toFixed(1)} cm)`);
  ok(Number.isFinite(R.con.slot.y) && R.con.slot.y - room.DIM.cart.h / 2 < room.DIM.console.h + 1.4, 'scene: a seated cart sits down in the console slot');
  ok(R.props.keyboard.keys.size === 64 && R.props.keyboard.keys.has('ArrowUp') && R.props.keyboard.keys.has('Escape'), `scene: the keyboard has 64 keys (${R.props.keyboard.keys.size})`);
  R.props.keyboard.press('KeyX', true); R.props.keyboard.update(0.2);
  const kx = R.props.keyboard.keys.get('KeyX');
  ok(kx.position.y < kx.userData.rest - 0.4, 'scene: a pressed key goes down');
  ok(props.capStyle('ArrowLeft').bg !== props.capStyle('KeyQ').bg && props.capStyle('KeyX').bg === props.capStyle('KeyZ').bg, 'scene: game keys have their own colours');
  const src = read('props.js').toString() + read('room.js').toString();
  ok(!/coca|pepsi|sprite|fanta|dr\.? ?pepper|mountain dew|red ?bull|monster/i.test(src), 'scene: no drink brand names');
  for (const aspect of [16 / 9, 4 / 3, 1, 9 / 19.5]) {
    for (const mode of ['tv', 'desk']) {
      const f = room.frameFor(mode, aspect);
      const cam = new THREE.PerspectiveCamera(f.fov, aspect, 1, 5000);
      cam.position.copy(f.pos); cam.lookAt(f.target); cam.updateMatrixWorld();
      const q = room.KEYPOINTS[mode].map(p => new THREE.Vector3(...p).project(cam));
      const inside = q.every(v => Math.abs(v.x) <= 0.95 && Math.abs(v.y) <= 0.95);
      const span = Math.max(Math.max(...q.map(v => v.x)) - Math.min(...q.map(v => v.x)), Math.max(...q.map(v => v.y)) - Math.min(...q.map(v => v.y)));
      ok(inside && span > 1.7, `scene: frameFor ${mode} at aspect ${aspect.toFixed(2)} fits and fills (span ${span.toFixed(2)} of 2)`);
    }
  }
  const made = manifest.carts.map((c, i) => carts3d.makeCart(c, i));
  ok(made.every(m => m.group.children.length >= 5 && m.canvas.width === carts3d.LABEL.w), 'scene: every cart builds with a label canvas');
  let picks = 0; made[0].group.traverse(o => { if (o.isMesh && o.userData.pick && o.userData.pick.id === made[0].id) picks++; });
  ok(picks >= 5, 'scene: every part of a cart is a pick target');
  made[0].paint({ width: 160, height: 160 });
  ok(made[0].tex.version > 0, 'scene: painting a label marks its texture for upload');
  // swap tracks
  const from = [52, 10, 25], slot = [-54, 8.9, 14], home = [43.6, 10, 20.6];
  const p = swap.planSwap({ incoming: 'a', from, fromRx: -0.1, slot, outgoing: 'b', home, homeRx: -0.1 });
  const near = (u, v, e = 1e-6) => u.every((x, i) => Math.abs(x - v[i]) < e);
  ok(near(swap.sample(p, 0).get('a').p, from) && near(swap.sample(p, p.end + 1).get('a').p, slot), 'swap: the new cart starts on the rack and ends in the slot');
  ok(near(swap.sample(p, p.end + 1).get('b').p, home) && Math.abs(swap.sample(p, p.end + 1).get('b').rx + 0.1) < 1e-9, 'swap: the old cart ends in its rack slot at the rack lean');
  ok(swap.sample(p, swap.DUR.eject).get('b').p[1] > slot[1] + 8, 'swap: the old cart pops out of the slot first');
  ok(Math.abs(p.seatAt - p.tracks.a.at(-1).t1) < 1e-9 && p.seatAt > 1, `swap: the cart seats at the end of its push (${p.seatAt.toFixed(2)} s)`);
  const mid = p.tracks.a.at(-1), dip = swap.sample(p, (mid.t0 + mid.t1) / 2).get('a').p[1];
  ok(dip < slot[1] - 0.8, 'swap: the push dips the cart into the slot and back');
  const arrive = p.tracks.a.at(-3).t1;
  ok(arrive >= swap.DUR.eject + 0.3, 'swap: the new cart reaches the slot after the old one has left');
  let maxY = 0; for (let t = 0; t < p.end; t += 0.02) maxY = Math.max(maxY, swap.sample(p, t).get('a').p[1]);
  ok(maxY > slot[1] + 11, 'swap: the new cart flies over the slot in an arc');
  const d = swap.planSwap({ incoming: 'a', from: [0, 20, 10], slot, drag: true });
  ok(d.tracks.a.length === 3 && near(swap.sample(d, 0).get('a').p, [0, 20, 10]), 'swap: a dropped cart flies from where it was dropped');
  const r = swap.planReturn('a', [0, 20, 10], home, -0.1);
  ok(near(swap.sample(r, r.end).get('a').p, home), 'swap: a cart dropped away from the slot goes home');
  // GLSL of screen.js through naga (as Vulkan GLSL 450)
  const nagaBin = join(homedir(), '.cargo/bin/naga');
  if (existsSync(nagaBin)) {
    const { FRAG } = await import('./screen.js');
    const f = '#version 450\n' + FRAG.replace(/precision highp \w+;\n/g, '')
      .replace('uniform sampler2D tex;', 'layout(set = 0, binding = 1) uniform texture2D tex_t;\nlayout(set = 0, binding = 2) uniform sampler tex_s;')
      .replace(/uniform float (\w+);\n/g, '')
      .replace('varying vec2 vUv;', 'layout(set = 0, binding = 0) uniform U { float time; float fx; float stat; float power; };\nlayout(location = 0) in vec2 vUv;\nlayout(location = 0) out vec4 o_color;')
      .replace(/texelFetch\(tex,/g, 'texelFetch(sampler2D(tex_t, tex_s),').replace(/textureLod\(tex,/g, 'textureLod(sampler2D(tex_t, tex_s),')
      .replace(/gl_FragColor/g, 'o_color');
    let out = '';
    try { out = execFileSync(nagaBin, ['--input-kind', 'glsl', '--shader-stage', 'frag', '--stdin-file-path', 'crt.frag'], { input: f }).toString(); } catch (e) { out = String(e.stderr || e.stdout || e.message); }
    ok(/Validation successful/.test(out), 'scene: naga validates the screen GLSL ' + out.slice(0, 200));
  } else console.log('  naga not found: GLSL validation skipped');
  group('scene.', m0);
}

// --------------------------------------------------------------------- room
await roomTest();
async function roomTest() {
  const m0 = mark();
  const cands = [process.env.LINKEDOM, '/usr/local/lib/node_modules/openclaw/node_modules/linkedom/esm/index.js'].filter(Boolean);
  const lp = cands.find(p => existsSync(p));
  if (!lp) { console.log('room.      skipped: linkedom not found (set LINKEDOM)'); return; }
  const THREE = await import('three');
  const { parseHTML } = await import(pathToFileURL(lp).href);
  const { window, document } = parseHTML(html);
  const W = 390, H = 800, raf = [];
  const ctx2d = () => {
    const grad = { addColorStop() {} };
    const base = { canvas: null, createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }), getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      createLinearGradient: () => grad, createRadialGradient: () => grad, measureText: t => ({ width: String(t).length * 6 }) };
    return new Proxy(base, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  };
  const store = new Map();
  let clock = 5000;
  Object.assign(globalThis, {
    window, document, localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    requestAnimationFrame: f => { raf.push(f); return raf.length; }, cancelAnimationFrame: () => {}, innerWidth: W, innerHeight: H, devicePixelRatio: 1,
    getComputedStyle: () => ({ display: 'flex' }), matchMedia: () => ({ matches: false, addEventListener() {} }),
  });
  window.innerWidth = W; window.innerHeight = H; window.devicePixelRatio = 1;
  window.matchMedia = globalThis.matchMedia;
  const realNow = performance.now.bind(performance);
  performance.now = () => clock;
  const proto = Object.getPrototypeOf(document.createElement('canvas'));
  proto.getContext = function (t) { return t === '2d' ? (this.__c ||= ctx2d()) : null; };
  const El = Object.getPrototypeOf(Object.getPrototypeOf(proto));
  El.getBoundingClientRect = function () {
    if (this.id === 'hud') return { left: 12, top: 62, x: 12, y: 62, width: 200, height: 50, right: 212, bottom: 112 };
    return { left: 0, top: H - 60, x: 0, y: H - 60, width: W, height: 60, right: W, bottom: H };
  };
  proto.getBoundingClientRect = function () { return { left: 0, top: 0, x: 0, y: 0, width: W, height: H, right: W, bottom: H }; };
  let renders = 0, disposed = false;
  window.__w4TestRenderer = { setPixelRatio() {}, getPixelRatio: () => 1, setSize() {}, render(sc, cam) { renders++; sc.updateMatrixWorld(); cam.updateMatrixWorld(); }, dispose() { disposed = true; }, forceContextLoss() {}, shadowMap: {} };
  const errors = [];
  const origWarn = console.warn; console.warn = (...a) => { errors.push(a.map(String).join(' ')); };
  const tick = async (n, dtMs = 17) => { for (let i = 0; i < n; i++) { const fs = raf.splice(0); clock += dtMs; for (const f of fs) { try { f(clock); } catch (e) { errors.push('raf: ' + e.message); } } await new Promise(r => setTimeout(r, 0)); } };
  const view = document.getElementById('view');
  const ptr = (type, x, y, o = {}) => { const e = new window.Event(type); Object.assign(e, { clientX: x, clientY: y, pointerId: o.id || 1, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerType: o.type || 'mouse' }); view.dispatchEvent(e); };
  const toScreen = (S, v) => { const q = v.clone().project(S.room.camera); return [(q.x + 1) / 2 * W, (1 - q.y) / 2 * H]; };
  try {
    await import(pathToFileURL(join(HERE, 'main.js')).href + '?room');
    const S = window.__w4;
    for (let i = 0; i < 60 && !(S.host && S.host.frame > 0); i++) await tick(1);
    await tick(10);
    ok(S.room && S.tube === S.room && S.tube.kind === 'webgl3d' && renders > 5, `room: the 3D room boots and renders (${renders} frames)`);
    ok(S.room.carts.size === manifest.carts.length && S.room.seated === 'kittygame' && S.cart.id === 'kittygame' && S.host.frame > 3, 'room: the first cart is seated and runs');
    // click a rack cart: it flies to the slot, the old one goes home
    const id = manifest.carts[4].id, m = S.room.carts.get(id), old = S.room.carts.get('kittygame');
    const lab = new THREE.Vector3(); m.group.children[1].getWorldPosition(lab);
    const [cx, cy] = toScreen(S, lab);
    ptr('pointerdown', cx, cy); ptr('pointerup', cx, cy);
    ok(S.room.busy && S.host === null, 'room: a click on a rack cart starts the swap and empties the slot');
    await tick(25);
    ok(S.stat === 1 && S.host === null, 'room: the TV shows static while the slot is empty');
    await tick(140);
    ok(S.cart.id === id && S.room.seated === id && S.host && S.host.frame > 2, `room: the new cart seats and boots (${S.cart.id})`);
    ok(old.group.position.distanceTo(old.home) < 0.05 && m.group.position.distanceTo(S.room.slot) < 0.05, 'room: the old cart is home and the new one is in the slot');
    // drag a cart onto the console
    const id2 = manifest.carts[9].id, m2 = S.room.carts.get(id2);
    m2.group.children[1].getWorldPosition(lab);
    const [dx, dy] = toScreen(S, lab);
    const above = () => toScreen(S, S.room.slot.clone().add(new THREE.Vector3(0, 12, 0)));
    ptr('pointerdown', dx, dy, { id: 2 });
    for (let k = 1; k <= 12; k++) { const [ax, ay] = above(); ptr('pointermove', dx + (ax - dx) * k / 12, dy + (ay - dy) * k / 12, { id: 2 }); await tick(2); }
    await tick(60);
    let [sx, sy] = above(); ptr('pointermove', sx, sy, { id: 2 }); await tick(30);
    [sx, sy] = above(); ptr('pointermove', sx, sy, { id: 2 }); await tick(10);
    ok(m2.state === 'drag' && m2.group.position.distanceTo(S.room.slot) < 20, `room: the dragged cart follows the pointer (${m2.group.position.distanceTo(S.room.slot).toFixed(1)} cm from the slot)`);
    ptr('pointerup', sx, sy, { id: 2 });
    await tick(140);
    ok(S.cart.id === id2 && S.room.seated === id2 && S.room.carts.get(id).group.position.distanceTo(S.room.carts.get(id).home) < 0.05, 'room: a cart dropped on the console swaps in');
    // drag a cart and drop it away from the console: it goes home
    const id3 = manifest.carts[12].id, m3 = S.room.carts.get(id3);
    m3.group.children[1].getWorldPosition(lab);
    const [ex, ey] = toScreen(S, lab);
    ptr('pointerdown', ex, ey, { id: 3 });
    for (let k = 1; k <= 6; k++) { ptr('pointermove', ex - 12 * k, ey - 4 * k, { id: 3 }); await tick(2); }
    ptr('pointerup', ex - 72, ey - 24, { id: 3 });
    await tick(80);
    ok(S.cart.id === id2 && m3.group.position.distanceTo(m3.home) < 0.05 && m3.state === 'rack', 'room: a cart dropped away from the console goes home');
    // tap the glass: keys armed, mouse on the console screen
    const g = new THREE.Vector3(); S.room.parts.tv.glass.getWorldPosition(g);
    const [gx, gy] = toScreen(S, g.add(new THREE.Vector3(0, 0, 1.2)));
    ptr('pointerdown', gx, gy, { id: 4 });
    const mx = S.input.mouse.x, my = S.input.mouse.y;
    await tick(2);
    ptr('pointerup', gx, gy, { id: 4 });
    ok(document.getElementById('play').hidden === true, 'room: a tap on the glass arms the keys (Play hides)');
    ok(S.input.armed && Math.abs(mx - 80) < 6 && Math.abs(my - 80) < 6, `room: the glass maps to the middle of the console screen (${mx}, ${my})`);
    // view button: the desk view shows the console
    await tick(80);
    const m0v = S.room.mode; document.getElementById('viewBtn').dispatchEvent(new window.Event('click'));
    ok(m0v === 'tv' && S.room.userMode === 'desk' && S.room.mode === 'desk', `room: the view button changes the view (${m0v} -> ${S.room.mode})`);
    await tick(90);
    // the reset button on the console
    const rb = new THREE.Vector3(); S.room.parts.con.buttons.reset.getWorldPosition(rb);
    const [rx, ry] = toScreen(S, rb.add(new THREE.Vector3(0, 0, 0.7)));
    ok(rx > 0 && rx < W && ry > 0 && ry < H, `room: the desk view shows the console buttons (${rx.toFixed(0)}, ${ry.toFixed(0)})`);
    const f0 = S.host.frame;
    ptr('pointerdown', rx, ry, { id: 5 }); ptr('pointerup', rx, ry, { id: 5 });
    await tick(40);
    ok(S.cart.id === id2 && S.host && S.host.frame < f0, `room: the console reset button reboots the cart (${f0} -> ${S.host && S.host.frame})`);
    // a key press moves a 3D key
    const ke = new window.Event('keydown'); Object.assign(ke, { code: 'ArrowLeft', key: 'ArrowLeft' }); document.dispatchEvent(ke);
    await tick(10);
    const key = S.room.parts.props.keyboard.keys.get('ArrowLeft');
    ok(key.position.y < key.userData.rest - 0.3, 'room: a key press moves the 3D key');
    // the shelf list swaps too
    document.querySelectorAll('#shelf .cart')[2].dispatchEvent(new window.Event('click'));
    await tick(150);
    ok(S.cart.id === manifest.carts[2].id && S.room.seated === manifest.carts[2].id, 'room: a click in the cart list swaps the cart in the room');
    // saver in the room
    let plate = null;
    const res = window.snSaver.enter({ seed: 7, calm: 0.5, label: p => { if (p) plate = p; } });
    ok(res && res.canvas === view, 'room: the saver uses the room canvas');
    for (let i = 0; i < 200 && !(window.snSaver.debug() && window.snSaver.debug().frame > 10); i++) await tick(1);
    const dbg = window.snSaver.debug();
    ok(dbg && dbg.frame > 10 && dbg.tube === 'webgl3d' && S.room.seated === dbg.cart, `room: the saver swaps a cart in and plays it (${JSON.stringify(dbg)})`);
    ok(plate && plate.title && !('code' in plate), 'room: the saver plate names the cart, no code');
    window.snSaver.cut();
    for (let i = 0; i < 300 && !(window.snSaver.debug().cart !== dbg.cart && window.snSaver.debug().frame > 5); i++) await tick(1);
    const d2 = window.snSaver.debug();
    ok(d2.cart !== dbg.cart && S.room.seated === d2.cart && d2.frame > 5, `room: the saver cut swaps the next cart in (${dbg.cart} -> ${d2.cart})`);
    window.snSaver.exit();
    await tick(5);
    ok(window.__w4Saver === false && S.room.seated === S.cart.id && document.body.contains(view), 'room: the saver exits and the page cart is back in the slot');
    window.dispatchEvent(Object.assign(new window.Event('pagehide'), { persisted: false }));
    ok(disposed && S.room === null, 'room: pagehide releases the renderer');
    ok(!errors.length, `room: no warnings or loop errors ${errors.slice(0, 3).join(' | ')}`);
  } catch (e) { ok(false, 'room: ' + (e && e.stack || e)); }
  console.warn = origWarn; performance.now = realNow;
  group('room.', m0);
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
