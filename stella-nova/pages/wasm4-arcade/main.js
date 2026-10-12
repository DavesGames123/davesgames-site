// ============================================================================
//  WASM-4 ARCADE  ·  main.js — the page: cabinet, shelf, controls, loop
// ----------------------------------------------------------------------------
//  Boot: read carts.json, build the shelf, make the tube (crt.js), load the
//  first cart and run it with no input (its title screen) until a person
//  plays. The loop runs the console at a fixed 60 Hz with the input of
//  input.js, maps the framebuffer through the palette and draws the tube.
//
//  STATE (window.__w4 for a console look; tests read nothing from it)
//    S.host     the Wasm4 console of runtime/host.js (one at a time)
//    S.cart     the manifest entry, or { own: true, title } for a file
//    S.power    on or off; S.fx the CRT strength (0 = CRT off)
//    S.stat     static of a channel change, falls to 0 in 0.4 s
//  Sound: the APU is made on the first gesture (unlock) and plays only
//  when the Sound button is on. Saves: one localStorage key per cart
//  ("sn-wasm4:" + the first 16 hex of its sha256), base64, in try/catch.
//  The loop stops while the saver runs (window.__w4Saver) or the tab is
//  hidden.
//
//  grep -n targets
//    "async function boot"   "function buildShelf"   "async function insert"
//    "function loop"         "function localDisk"    "function bindControls"
//    "function paintLabels"  "function showInfo"     "function goFull"
// ============================================================================
import { Wasm4, memoryDisk } from './runtime/host.js';
import { APU } from './runtime/apu.js';
import { Input } from './input.js';
import { createCRT } from './crt.js';
import './saver.js';

const $ = id => document.getElementById(id);
const STEP = 1000 / 60;
const S = { host: null, cart: null, carts: [], power: true, fx: 0.8, crtOn: true, stat: 0, powerT: 1, sound: false, tube: null, rgba: new Uint8Array(160 * 160 * 4), acc: 0, last: 0, t0: performance.now(), loading: 0 };
window.__w4 = S;
const apu = new APU();
const input = new Input();

// ----------------------------------------------------------------- storage
function b64(bytes) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); }
function unb64(str) { const s = atob(str), o = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i); return o; }
function localDisk(key) {
  return {
    read() { try { const v = localStorage.getItem(key); return v ? unb64(v) : null; } catch (e) { return null; } },
    write(bytes) { try { localStorage.setItem(key, b64(bytes)); } catch (e) { /* private mode or full: the save stays in memory */ } },
  };
}
async function sha256hex(bytes) {
  try { const d = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join(''); } catch (e) { return 'nohash' + bytes.length; }
}

// ------------------------------------------------------------------- carts
async function insert(cart, bytes) {
  const my = ++S.loading;
  S.stat = 1;
  try {
    if (!bytes) {
      const r = await fetch(new URL(cart.file, import.meta.url));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      bytes = new Uint8Array(await r.arrayBuffer());
    }
    if (my !== S.loading) return;
    const sha = cart.sha256 || await sha256hex(bytes);
    const host = new Wasm4({ disk: localDisk('sn-wasm4:' + sha.slice(0, 16)), apu, onTrace: s => console.log('[' + cart.title + ']', s) });
    S.host = host; S.cart = cart; input.clear();
    try { await host.load(bytes); } catch (e) { console.warn('wasm4-arcade: cart failed', e); }
    showInfo(cart, host.crashed);
  } catch (e) {
    console.warn('wasm4-arcade: could not load', cart.title, e);
    $('status').textContent = 'Could not load ' + cart.title + '.';
  }
  for (const b of document.querySelectorAll('#shelf .cart')) b.classList.toggle('on', b.dataset.id === cart.id);
}

function showInfo(c, crashed) {
  $('mqTitle').textContent = c.title.toUpperCase();
  $('ciTitle').textContent = c.title;
  if (c.own) {
    $('ciBy').textContent = 'Your own cart, ' + c.bytes + ' bytes. It runs in this browser and goes nowhere.';
    $('ciBlurb').textContent = crashed ? 'The cart stopped: see the blue screen.' : 'Saves made by this cart stay in this browser.';
    $('ciCtl').textContent = 'Arrows, X and Z, or the pad.';
    $('ciLinks').replaceChildren();
  } else {
    $('ciBy').textContent = 'by ' + c.author;
    $('ciBlurb').textContent = c.blurb;
    $('ciCtl').textContent = c.controls;
    const L = $('ciLinks'); L.replaceChildren();
    const a = (href, t) => { const e = document.createElement('a'); e.href = href; e.target = '_blank'; e.rel = 'noopener'; e.textContent = t; return e; };
    L.append(a(c.repo, 'Source'), document.createTextNode(' · '), a(c.licenceUrl, c.licence + ' licence'), document.createTextNode(' · '), a(c.showcase, 'wasm4.org'));
  }
  $('status').textContent = crashed ? 'The cart stopped. Press Reset.' : '';
}

function buildShelf() {
  const shelf = $('shelf');
  for (const c of S.carts) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'cart'; b.dataset.id = c.id; b.setAttribute('role', 'listitem');
    b.setAttribute('aria-label', `${c.title} by ${c.author}, ${c.licence}`);
    const lab = document.createElement('canvas'); lab.width = 160; lab.height = 160; lab.className = 'label';
    const t = document.createElement('span'); t.className = 'ct'; t.textContent = c.title;
    const by = document.createElement('span'); by.className = 'cb'; by.textContent = c.author + ' · ' + c.licence;
    b.append(lab, t, by);
    b.addEventListener('click', () => { unlock(); input.armed = true; insert(c); scrollToStage(); });
    shelf.append(b);
    c.labelCanvas = lab;
  }
}

function scrollToStage() {
  const r = $('cabinet').getBoundingClientRect();
  if (r.top < 0 || r.bottom > innerHeight) $('cabinet').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Label art: run each cart silently to its label frame, in idle slices.
async function paintLabels() {
  const idle = cb => (window.requestIdleCallback ? requestIdleCallback(cb, { timeout: 400 }) : setTimeout(() => cb({ timeRemaining: () => 8 }), 30));
  const rgba = new Uint8Array(160 * 160 * 4);
  for (const c of S.carts) {
    try {
      const bytes = new Uint8Array(await (await fetch(new URL(c.file, import.meta.url))).arrayBuffer());
      const h = new Wasm4({ disk: memoryDisk() });
      await h.load(bytes);
      const target = Math.min(c.labelFrame || 60, 600);
      await new Promise(done => {
        const work = dl => {
          const t0 = performance.now();
          while (h.frame < target && !h.crashed && performance.now() - t0 < Math.max(4, Math.min(12, dl.timeRemaining()))) h.update();
          if (h.frame >= target || h.crashed) done(); else idle(work);
        };
        idle(work);
      });
      h.composite(rgba);
      const g = c.labelCanvas.getContext('2d'), id = g.createImageData(160, 160);
      id.data.set(rgba); g.putImageData(id, 0, 0);
    } catch (e) { /* a label stays blank */ }
  }
}

// --------------------------------------------------------------- controls
async function unlock() {
  if (!S.sound) return;
  const ok = await apu.unlock();
  $('sound').setAttribute('aria-pressed', ok ? 'true' : 'false');
}

function setFx() {
  const v = +$('crtStr').value / 100;
  S.fx = S.crtOn ? v : 0;
  $('crtOut').textContent = Math.round(v * 100) + ' %';
  $('crtBtn').setAttribute('aria-pressed', S.crtOn ? 'true' : 'false');
  $('crtStr').disabled = !S.crtOn;
  try { localStorage.setItem('sn-wasm4-crt', JSON.stringify({ on: S.crtOn, v })); } catch (e) { /* ok */ }
}

function goFull() {
  const el = $('cabinet'), d = document;
  const inFs = d.fullscreenElement || d.webkitFullscreenElement || document.documentElement.classList.contains('pseudo-fs');
  if (inFs) {
    if (d.fullscreenElement && d.exitFullscreen) d.exitFullscreen();
    else if (d.webkitFullscreenElement && d.webkitExitFullscreen) d.webkitExitFullscreen();
    document.documentElement.classList.remove('pseudo-fs');
    return;
  }
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (req) {
    Promise.resolve(req.call(el)).catch(() => document.documentElement.classList.add('pseudo-fs'));
  } else document.documentElement.classList.add('pseudo-fs');
}

function bindControls() {
  try { const p = JSON.parse(localStorage.getItem('sn-wasm4-crt') || 'null'); if (p) { S.crtOn = !!p.on; $('crtStr').value = Math.round(p.v * 100); } } catch (e) { /* ok */ }
  setFx();
  $('crtStr').addEventListener('input', setFx);
  $('crtBtn').addEventListener('click', () => { S.crtOn = !S.crtOn; setFx(); });
  $('power').addEventListener('click', () => {
    S.power = !S.power; $('power').setAttribute('aria-pressed', S.power ? 'true' : 'false');
    if (S.power && S.cart) insert(S.cart);
    if (!S.power) apu.pause();
  });
  $('sound').addEventListener('click', async () => {
    S.sound = !S.sound; apu.setMuted(!S.sound);
    if (S.sound) await unlock(); else { apu.pause(); $('sound').setAttribute('aria-pressed', 'false'); }
  });
  $('reset').addEventListener('click', () => { if (S.cart) { input.armed = true; insert(S.cart); } });
  $('fs').addEventListener('click', goFull);
  $('play').addEventListener('click', () => { input.armed = true; $('play').hidden = true; unlock(); if (S.tube) S.tube.canvas.focus({ preventScroll: true }); });
  $('own').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (bytes.length > 65536) { $('status').textContent = `${f.name} is ${bytes.length} bytes. A WASM-4 cart is 65536 bytes at most.`; return; }
    input.armed = true; unlock();
    insert({ id: 'own', own: true, title: f.name.replace(/\.wasm$/i, ''), bytes: bytes.length }, bytes);
    scrollToStage();
  });
  input.bindKeys(window);
  input.bindPad($('dpad'), document.querySelectorAll('#pad [data-btn]'));
  input.onActivity = () => { if (!$('play').hidden) $('play').hidden = true; if (S.sound) unlock(); };
  document.addEventListener('keydown', e => {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (e.code === 'KeyR' && input.armed && S.cart) insert(S.cart);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) apu.pause(); else if (S.sound) unlock(); });
}

// -------------------------------------------------------------------- loop
function loop(now) {
  requestAnimationFrame(loop);
  if (window.__w4Saver || document.hidden || !S.tube) { S.last = now; return; }
  const dt = Math.min(250, now - (S.last || now)); S.last = now;
  S.stat = Math.max(0, S.stat - dt / 400);
  S.powerT = Math.max(0, Math.min(1, S.powerT + (S.power ? dt / 450 : -dt / 250)));
  const h = S.host;
  if (h && S.power) {
    input.pollPads();
    S.acc += dt;
    let n = 0;
    while (S.acc >= STEP && n++ < 4) {
      S.acc -= STEP;
      for (let i = 0; i < 4; i++) h.setGamepad(i, input.gamepad(i));
      h.setMouse(input.mouse.x, input.mouse.y, input.mouse.b);
      h.update();
    }
    if (S.acc > STEP * 4) S.acc = 0;
    h.composite(S.rgba);
    S.tube.setFrame(S.rgba, S.fx);
  }
  S.tube.render({ time: (now - S.t0) / 1000, fx: S.fx, stat: S.stat, power: S.powerT });
}

// ------------------------------------------------------------------ boot
function creditsTable() {
  const tb = $('creditRows');
  for (const c of S.carts) {
    const tr = document.createElement('tr');
    const td = (t, href) => { const e = document.createElement('td'); if (href) { const a = document.createElement('a'); a.href = href; a.target = '_blank'; a.rel = 'noopener'; a.textContent = t; e.append(a); } else e.textContent = t; return e; };
    tr.append(td(c.title, c.showcase), td(c.author), td(c.licence, c.licenceUrl), td(c.repo.replace('https://github.com/', ''), c.repo));
    tb.append(tr);
  }
}

async function boot() {
  bindControls();
  try {
    const m = await (await fetch(new URL('./carts.json', import.meta.url))).json();
    S.carts = m.carts;
  } catch (e) { $('status').textContent = 'The cart list did not load.'; }
  buildShelf(); creditsTable();
  try { S.tube = await createCRT($('tube')); } catch (e) { console.warn(e); }
  if (S.tube) {
    document.documentElement.dataset.tube = S.tube.kind;
    input.bindScreen(S.tube.canvas, () => S.tube.layout());
  }
  $('tubeKind').textContent = S.tube && S.tube.kind === 'webgpu' ? 'WebGPU tube (WGSL)' : '2D canvas tube';
  const first = S.carts.find(c => c.id === 'kittygame') || S.carts[0];
  if (first) await insert(first);
  requestAnimationFrame(loop);
  setTimeout(paintLabels, 600);
}

if (typeof document !== 'undefined' && document.getElementById('tube')) boot();
