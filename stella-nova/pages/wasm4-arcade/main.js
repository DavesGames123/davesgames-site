// ============================================================================
//  WASM-4 ARCADE  ·  main.js — the page: 3D room, carts, controls, loop
// ----------------------------------------------------------------------------
//  Boot: read carts.json, build the cart list and the credits, make the 3D
//  room (view3d.js, three r160; loaded with a dynamic import), seat the
//  first cart and run it with no input (its title screen) until a person
//  plays. With no WebGL, or when the import fails, the flat CRT of crt.js
//  (WebGPU, or the SSTV 2D tube) shows in #flat instead. Both expose the
//  same tube interface, so the loop is one: run the console at a fixed
//  60 Hz with the input of input.js, map the framebuffer through the
//  palette and draw (S.tube.setFrame, S.tube.render).
//
//  A cart change is physical in the room: requestCart() asks the room to
//  swap (swap.js: the old cart pops out, the new one flies in and seats)
//  and insert() boots the cart when it seats. In the flat view the cart
//  boots at once.
//
//  STATE (window.__w4 for a console look; tests read it)
//    S.host     the Wasm4 console of runtime/host.js (one at a time)
//    S.cart     the manifest entry, or { own: true, title } for a file
//    S.room     the 3D room, or null in the flat view; S.tube = the room
//               or the flat tube
//    S.power    on or off; S.fx the CRT strength (0 = CRT off)
//    S.stat     static of a channel change, falls to 0 in 0.4 s
//  Sound: the APU is made on the first gesture (unlock) and plays only
//  when the Sound button is on. Saves: one localStorage key per cart
//  ("sn-wasm4:" + the first 16 hex of its sha256), base64, in try/catch.
//  The loop stops while the saver runs (window.__w4Saver) or the tab is
//  hidden. pagehide releases the WebGL context (or the WebGPU device).
//
//  grep -n targets
//    "async function boot"   "function buildShelf"   "async function insert"
//    "function requestCart"  "function loop"         "function localDisk"
//    "function bindControls" "function paintLabels"  "function showInfo"
//    "function goFull"       "function insets"       "async function makeView"
//    "function openSheet"    "function release"
// ============================================================================
import { Wasm4, memoryDisk } from './runtime/host.js';
import { APU } from './runtime/apu.js';
import { Input } from './input.js';
import { createCRT } from './crt.js';
import './saver.js';

const $ = id => document.getElementById(id);
const STEP = 1000 / 60;
const S = { host: null, cart: null, carts: [], power: true, fx: 0.8, crtOn: true, stat: 0, powerT: 1, sound: false, tube: null, room: null, rgba: new Uint8Array(160 * 160 * 4), acc: 0, last: 0, t0: performance.now(), loading: 0 };
window.__w4 = S;
const apu = new APU();
const input = new Input();
S.input = input;

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
  S.stat = 1; S.ejected = false;
  try {
    bytes = bytes || cart.data;
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

// A cart change: in the room the carts swap physically and the new cart
// boots when it seats. o.drag: the person dropped the cart on the console.
function requestCart(cart, o = {}) {
  unlock(); input.armed = true;
  if (S.room && !cart.own && S.room.carts.has(cart.id)) {
    const done = S.room.swapTo(cart.id, { drag: !!o.drag, onSeat: () => { S.ejected = false; if (S.power) insert(cart); else { S.cart = cart; showInfo(cart, null); } } });
    // the old cart leaves the slot: the console stops and the TV shows
    // static (after swapTo, which may finish an older swap and its boot)
    S.host = null; S.ejected = true; S.loading++;
    return done;
  }
  if (S.room) S.room.seatNow(null);
  return insert(cart);
}

function showInfo(c, crashed) {
  $('mqTitle').textContent = c.title.toUpperCase();
  $('ciTitle').textContent = c.title;
  if (c.own) {
    $('hudBy').textContent = 'your own cart · ' + c.bytes + ' bytes';
    $('ciBy').textContent = 'Your own cart, ' + c.bytes + ' bytes. It runs in this browser and goes nowhere.';
    $('ciBlurb').textContent = crashed ? 'The cart stopped: see the blue screen.' : 'Saves made by this cart stay in this browser.';
    $('ciCtl').textContent = 'Arrows, X and Z, or the pad.';
    $('ciLinks').replaceChildren();
  } else {
    $('hudBy').textContent = 'by ' + c.author + ' · ' + c.licence;
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
    b.addEventListener('click', () => { requestCart(c); if (narrow()) closeSheet(); });
    shelf.append(b);
    c.labelCanvas = lab;
  }
}

// Label art: run each cart silently to its label frame, in idle slices.
// The same canvas paints the list button and the 3D cart label.
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
      if (S.room) S.room.setLabel(c.id, c.labelCanvas);
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
  const el = document.documentElement, d = document;
  const inFs = d.fullscreenElement || d.webkitFullscreenElement || el.classList.contains('pseudo-fs');
  if (inFs) {
    if (d.fullscreenElement && d.exitFullscreen) d.exitFullscreen();
    else if (d.webkitFullscreenElement && d.webkitExitFullscreen) d.webkitExitFullscreen();
    el.classList.remove('pseudo-fs');
    return;
  }
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (req) Promise.resolve(req.call(el)).catch(() => el.classList.add('pseudo-fs'));
  else el.classList.add('pseudo-fs');
}

// The sheet: a bottom sheet on phones, a right drawer when wide.
const narrow = () => !(typeof matchMedia === 'function' && matchMedia('(min-width:900px) and (min-aspect-ratio:1/1)').matches);
function openSheet(tab) {
  const sh = $('sheet');
  for (const b of sh.querySelectorAll('.tabs [data-tab]')) b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false');
  for (const p of sh.querySelectorAll('.panel')) p.hidden = p.dataset.tab !== tab;
  sh.hidden = false; sh.dataset.tab = tab;
  document.documentElement.classList.add('sheet-open');
  $('cartsBtn').setAttribute('aria-expanded', tab === 'carts' ? 'true' : 'false');
  $('infoBtn').setAttribute('aria-expanded', tab !== 'carts' ? 'true' : 'false');
}
function closeSheet() {
  $('sheet').hidden = true;
  document.documentElement.classList.remove('sheet-open');
  $('cartsBtn').setAttribute('aria-expanded', 'false'); $('infoBtn').setAttribute('aria-expanded', 'false');
}
function toggleSheet(tab) {
  const sh = $('sheet');
  if (!sh.hidden && (sh.dataset.tab === tab || (tab === 'info' && sh.dataset.tab !== 'carts'))) closeSheet(); else openSheet(tab);
}

// The UI over the canvas, in CSS px, so the camera frames the TV in the
// clear rect: top bar, HUD row; dock, touch pad or bottom sheet; drawer.
function insets() {
  const H = window.innerHeight, W = window.innerWidth;
  const box = id => { const e = $(id); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return r.height ? r : null; };
  let top = document.documentElement.classList.contains('in-frame') || document.documentElement.classList.contains('pseudo-fs') ? 0 : 52;
  const hb = box('hud'); if (hb && W < 700) top = Math.max(top, hb.bottom);
  let bottom = 0, right = 0;
  const dk = box('dock'); if (dk) bottom = Math.max(bottom, H - dk.top);
  const pd = box('pad'); if (pd && getComputedStyle($('pad')).display !== 'none') bottom = Math.max(bottom, H - pd.top);
  const sh = box('sheet');
  if (sh) { if (sh.left > W * 0.3) right = W - sh.left; else bottom = Math.max(bottom, H - sh.top); }
  return { top: top + 8, bottom: bottom + 6, left: 0, right };
}

function bindControls() {
  try { const p = JSON.parse(localStorage.getItem('sn-wasm4-crt') || 'null'); if (p) { S.crtOn = !!p.on; $('crtStr').value = Math.round(p.v * 100); } } catch (e) { /* ok */ }
  setFx();
  $('crtStr').addEventListener('input', setFx);
  $('crtBtn').addEventListener('click', () => { S.crtOn = !S.crtOn; setFx(); });
  $('power').addEventListener('click', () => {
    S.power = !S.power; $('power').setAttribute('aria-pressed', S.power ? 'true' : 'false');
    if (S.room) S.room.setPower(S.power);
    if (S.power && S.cart) insert(S.cart);
    if (!S.power) apu.pause();
  });
  $('sound').addEventListener('click', async () => {
    S.sound = !S.sound; apu.setMuted(!S.sound);
    if (S.sound) await unlock(); else { apu.pause(); $('sound').setAttribute('aria-pressed', 'false'); }
  });
  $('reset').addEventListener('click', () => { if (S.cart) requestCart(S.cart); });
  $('fs').addEventListener('click', goFull);
  $('viewBtn').addEventListener('click', () => {
    if (!S.room) return;
    const to = S.room.userMode === 'tv' ? 'desk' : 'tv';
    S.room.setMode(to);
    $('viewBtn').querySelector('span').textContent = to === 'tv' ? 'Desk' : 'TV';
  });
  $('cartsBtn').addEventListener('click', () => toggleSheet('carts'));
  $('infoBtn').addEventListener('click', () => toggleSheet('info'));
  $('hud').addEventListener('click', () => openSheet('info'));
  $('sheetClose').addEventListener('click', closeSheet);
  for (const b of document.querySelectorAll('#sheet .tabs [data-tab]')) b.addEventListener('click', () => openSheet(b.dataset.tab));
  $('play').addEventListener('click', () => { input.armed = true; $('play').hidden = true; unlock(); const c = S.room ? S.room.canvas : S.tube && S.tube.canvas; if (c) c.focus({ preventScroll: true }); });
  $('own').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (bytes.length > 65536) { $('status').textContent = `${f.name} is ${bytes.length} bytes. A WASM-4 cart is 65536 bytes at most.`; return; }
    requestCart({ id: 'own', own: true, title: f.name.replace(/\.wasm$/i, ''), bytes: bytes.length, data: bytes });
    if (narrow()) closeSheet();
  });
  input.bindKeys(window);
  input.bindPad($('dpad'), document.querySelectorAll('#pad [data-btn]'));
  input.onActivity = () => { if (!$('play').hidden) $('play').hidden = true; if (S.sound) unlock(); };
  document.addEventListener('keydown', e => {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (S.room && !e.repeat) S.room.press(e.code, true);
    if (e.code === 'Escape' && !$('sheet').hidden) closeSheet();
    if (e.code === 'KeyR' && input.armed && S.cart && !e.repeat) requestCart(S.cart);
  });
  document.addEventListener('keyup', e => { if (S.room) S.room.press(e.code, false); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) apu.pause(); else if (S.sound) unlock(); });
  if (typeof matchMedia === 'function' && matchMedia('(pointer:coarse)').matches) document.documentElement.classList.add('coarse');
}

// ------------------------------------------------------------------- view
async function makeView() {
  try {
    const { createRoom3D } = await import('./view3d.js');
    const tip = $('tip');
    const room = await createRoom3D($('view'), {
      carts: S.carts, insets, renderer: window.__w4TestRenderer,
      onScreen(type, x, y, e) {
        if (type === 'down') {
          input.armed = true;
          if (input.onActivity) input.onActivity(e);
        }
        input.mouse.x = x < 0 ? 0x7fff : x; input.mouse.y = y < 0 ? 0x7fff : y;
        const bits = e.pointerType === 'mouse' ? ((e.buttons & 1 ? 1 : 0) | (e.buttons & 2 ? 2 : 0) | (e.buttons & 4 ? 4 : 0)) : (type === 'up' ? 0 : 1);
        input.mouse.b = type === 'up' && e.pointerType !== 'mouse' ? 0 : bits;
      },
      onPick(id, o) { const c = S.carts.find(x => x.id === id); if (c) requestCart(c, o); },
      onButton(kind) { if (kind === 'power') $('power').click(); else if (S.cart) requestCart(S.cart); },
      onHover(id, e) {
        if (!id) { tip.hidden = true; return; }
        const c = S.carts.find(x => x.id === id); if (!c) return;
        if (tip.dataset.id !== id) { tip.dataset.id = id; tip.replaceChildren(Object.assign(document.createElement('b'), { textContent: c.title }), document.createTextNode(`by ${c.author} · ${c.licence}`)); }
        tip.style.left = e.clientX + 'px'; tip.style.top = e.clientY + 'px'; tip.hidden = false;
      },
    });
    S.room = room; S.tube = room;
    document.documentElement.dataset.tube = 'webgl3d';
    return true;
  } catch (e) {
    console.info('wasm4-arcade: no 3D room, flat CRT used:', e && e.message);
    return false;
  }
}

function release() {
  try { if (S.tube && S.tube.destroy) S.tube.destroy(); } catch (e) { /* ok */ }
  S.tube = null; S.room = null;
  apu.pause();
}

// -------------------------------------------------------------------- loop
function loop(now) {
  requestAnimationFrame(loop);
  if (window.__w4Saver || document.hidden || !S.tube) { S.last = now; return; }
  const dt = Math.min(250, now - (S.last || now)); S.last = now;
  S.stat = S.ejected ? 1 : Math.max(0, S.stat - dt / 400);
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
  if (!(await makeView())) {
    document.documentElement.classList.add('flat');
    $('flat').hidden = false; $('viewBtn').hidden = true;
    try { S.tube = await createCRT($('tube')); } catch (e) { console.warn(e); }
    if (S.tube) {
      document.documentElement.dataset.tube = S.tube.kind;
      input.bindScreen(S.tube.canvas, () => S.tube.layout());
    }
  }
  $('tubeKind').textContent = !S.tube ? '' : S.tube.kind === 'webgl3d' ? '3D room (WebGL, three.js r160), CRT glass in GLSL' : S.tube.kind === 'webgpu' ? 'Flat WebGPU tube (WGSL)' : 'Flat 2D canvas tube';
  const first = S.carts.find(c => c.id === 'kittygame') || S.carts[0];
  if (first) { if (S.room) S.room.seatNow(first.id); await insert(first); }
  requestAnimationFrame(loop);
  setTimeout(paintLabels, 600);
  window.__w4Resume = () => { if (S.room && S.cart && !S.cart.own) S.room.seatNow(S.cart.id); };
  window.addEventListener('pagehide', e => { if (!e.persisted) release(); else { release(); S.released = true; } });
  window.addEventListener('pageshow', e => { if (e.persisted && S.released) location.reload(); });
}

if (typeof document !== 'undefined' && document.getElementById('view')) boot();
