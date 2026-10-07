// ============================================================================
//  IMAGE WORLDS  ·  main.js — gallery, local loader, panel, dock, saver
// ────────────────────────────────────────────────────────────────────────────
//  BOOT  make the viewer (viewer.js), read worlds/manifest.json (the hosted
//    gallery), build each hosted world with worlds.js, and open the world
//    named in the URL hash, else the first one.
//  LOCAL  "Choose a world folder" (webkitdirectory), "Choose files" and a
//    drop on the page all give File objects. They become ENTRY records
//    (worlds.js entryFromFile) and go through the same loadWorlds() as the
//    hosted files. Nothing leaves the browser: no fetch, no storage. A
//    local world shows in the gallery with a "local" tag until reload.
//  PHONE  the dock (panel, camera mode, sound) and the bottom sheet, as
//    wave-membrane. While the sheet is open, viewer.setInsets() moves the
//    view up so the world centres in the clear part of the canvas.
//  STORAGE  one localStorage key, image-worlds-quality, for the quality
//    preset (wrapped in try/catch). No URL writes in saver mode.
//  window.__iw exposes the viewer and the worlds for the headless checks.
//
//  SAVER  window.snSaver (lib/screensaver.js). A seeded shuffle of shots
//    through the hosted worlds (the CC0 sample until real worlds are in the
//    manifest): orbit, push, pull, crane, pan and truck, 5-12 s each, with
//    a dip to black at each cut and a longer fade when the world changes.
//    A world's manifest entry may give saver: { target: [x, y, z],
//    radius: [r0, r1] } for shots round an object group. Without it the
//    shots stay within about 1.5 m of the spawn (World Labs worlds are
//    made round that point). The view centres in the plate's clear band
//    (plateBand, lib/saver-clear.js). The plate names the world, its
//    source and the splat count, and shows a short extract of viewer.js.
//
//  GREP MAP  "function renderGallery", "function openWorld", "function loadLocal",
//    "function walkDrop", "function setOpen", "function syncInsets", "window.snSaver"
// ============================================================================
import { createViewer, QUALITY } from './viewer.js';
import { parseManifest, loadWorlds, entryFromFile } from './worlds.js';
import { plateBand } from '../../lib/saver-clear.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const COARSE = matchMedia('(pointer:coarse)').matches;
const QKEY = 'image-worlds-quality';
const HINTS = {
  orbit: 'Drag to turn · right-drag or two fingers to pan · scroll or pinch to zoom · tap an object',
  fly: COARSE ? 'Joystick moves · drag to look · tap an object' : 'WASD or arrows move · Q / E down / up · Shift faster · drag to look · click an object',
  walk: COARSE ? 'Joystick walks · drag to look · tap an object' : 'WASD or arrows walk · Space jumps · Shift runs · drag to look · click an object',
};
const fmtN = n => n == null ? '?' : n >= 1e6 ? (n / 1e6).toFixed(2) + ' M' : n >= 1e3 ? Math.round(n / 1e3) + ' k' : String(n);
const fmtB = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' kB';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const G = { hosted: [], local: [], cur: null, errors: [], booted: false, failed: '', sound: false, saver: false };
let viewer = null;

function initialQuality() {
  try { const q = localStorage.getItem(QKEY); if (QUALITY[q]) return q; } catch (e) {}
  return COARSE || PHONE_Q.matches ? 'low' : 'mid';
}

// ── status and loading ─────────────────────────────────────────────────────
function onStatus(s) {
  if (s.kind === 'load') {
    $('loading').hidden = G.saver;
    $('loadLbl').textContent = s.what === 'splat' ? 'Splat · ' + s.name.split('/').pop() : 'Meshes';
    $('loadBar').style.width = Math.round((s.p || 0) * 100) + '%';
  } else if (s.kind === 'ready') {
    $('loading').hidden = true; renderCard(); renderStatus();
  } else if (s.kind === 'error') {
    $('loading').hidden = true;
    showMsg('Could not open ' + s.world.name + ': ' + s.error, true);
    renderStatus();
  } else if (s.kind === 'poke') { $('stMain').textContent = s.name + (G.sound ? '' : ' · sound is off'); }
  else if (s.kind === 'user') hideHint();
}
function renderStatus() {
  const w = G.cur, st = viewer.state(), i = st.splat;
  $('stMain').textContent = w ? w.name + (i ? ' · ' + fmtN(i.count) + ' splats' : '') + ' · ' + st.mode : 'No world open';
  $('stRight').textContent = i ? i.file.split('/').pop() + ' · ' + i.format + (i.version ? ' v' + i.version : '') + ' · ' + fmtB(i.bytes) : '';
}
let hintT = 0;
function showHint() { $('hint').textContent = HINTS[viewer.controls.mode]; $('hint').classList.remove('gone'); clearTimeout(hintT); hintT = setTimeout(hideHint, 9000); }
function hideHint() { $('hint').classList.add('gone'); }
function showMsg(text, bad) { const m = $('localMsg'); m.hidden = !text; m.textContent = text || ''; m.classList.toggle('bad', !!bad); }

// ── world card and gallery ─────────────────────────────────────────────────
const imgOf = w => w.source || w.thumbnail || w.plate || null;
function renderCard() {
  const w = G.cur; if (!w) return;
  const im = imgOf(w), img = $('cardImg');
  img.hidden = !im; $('cardNoImg').hidden = !!im;
  if (im) { img.src = im.href(); img.alt = 'Source image of ' + w.name; }
  $('cardName').textContent = w.name;
  const i = viewer.state().splat;
  const parts = [];
  if (i) parts.push(fmtN(i.count) + ' splats · ' + i.key + ' · ' + fmtB(i.bytes));
  parts.push(w.objects.length + ' mesh' + (w.objects.length === 1 ? '' : 'es') + ' · ' + w.ambient.length + ' loop' + (w.ambient.length === 1 ? '' : 's'));
  if (w.local) parts.push('local · ' + w.files + ' files');
  $('cardMeta').textContent = parts.join('\n');
  $('cardCap').textContent = [w.credit, w.caption && !w.credit ? w.caption : '', w.warnings.length && w.local ? w.warnings[0] : ''].filter(Boolean).join(' · ');
}
function renderGallery() {
  const box = $('gallery'); box.textContent = '';
  const all = [...G.local, ...G.hosted];
  for (const w of all) {
    const b = document.createElement('button');
    b.className = 'wcard' + (w === G.cur ? ' on' : '');
    const im = imgOf(w);
    b.innerHTML = (im ? '<img class="th" alt="" loading="lazy">' : '<span class="th none">no image</span>') +
      '<span class="lb">' + esc(w.name) + '</span>' + (w.local ? '<span class="tag local">local</span>' : w.sample ? '<span class="tag">sample</span>' : '');
    if (im) b.querySelector('img').src = im.href();
    b.addEventListener('click', () => openWorld(w));
    box.appendChild(b);
  }
  const generated = all.filter(w => !w.sample);
  const e = $('galleryEmpty');
  e.hidden = generated.length > 0;
  e.textContent = 'No generated worlds are on the site yet. The sample above is a CC0 still life, so you can try the viewer. Load a world that you made below.';
}

async function openWorld(w, { keepCamera = false } = {}) {
  if (!w) return;
  G.cur = w; renderGallery(); renderCard();
  if (!G.saver && !w.local) try { history.replaceState(null, '', '#' + w.slug); } catch (e) { /* file: */ }
  try { await viewer.open(w, { keepCamera }); }
  catch (e) { console.warn('image-worlds: ' + (e.message || e)); }
  renderGallery();
}

// ── local worlds ───────────────────────────────────────────────────────────
async function loadLocal(entries) {
  if (!entries.length) return;
  showMsg('Reading ' + entries.length + ' files…');
  try {
    const found = await loadWorlds(entries);
    const usable = found.filter(w => Object.keys(w.splats).length || w.objects.length);
    if (!usable.length) { showMsg('No world found in ' + entries.length + ' files. Choose a folder that holds output/world/ (an image-blaster world), or a .spz / .ply file.', true); return; }
    for (const w of usable) { w.local = true; w.slug = 'local-' + w.slug; }
    G.local = usable.concat(G.local);
    const warn = usable.flatMap(w => w.warnings.map(x => w.name + ': ' + x));
    showMsg('Opened ' + usable.map(w => w.name).join(', ') + ' from this device.' + (warn.length ? '\n' + warn.slice(0, 3).join('\n') : ''));
    await openWorld(usable[0]);
  } catch (e) { showMsg('Could not read the files: ' + (e.message || e), true); }
}
const filesToEntries = files => [...files].map(f => entryFromFile(f.webkitRelativePath || f.name, f));

// A dropped folder: walk it with the FileSystemEntry API (readEntries gives
// at most 100 entries per call, so call it until it returns none).
async function walkDrop(dt) {
  const out = [], roots = [];
  for (const it of dt.items || []) { const e = it.webkitGetAsEntry && it.webkitGetAsEntry(); if (e) roots.push(e); }
  if (!roots.length) return filesToEntries(dt.files || []);
  const walk = async (e, pre) => {
    if (e.isFile) { const f = await new Promise((res, rej) => e.file(res, rej)); out.push(entryFromFile(pre + e.name, f)); return; }
    const rd = e.createReader();
    for (;;) {
      const batch = await new Promise((res, rej) => rd.readEntries(res, rej));
      if (!batch.length) break;
      for (const c of batch) await walk(c, pre + e.name + '/');
    }
  };
  for (const r of roots) await walk(r, '');
  return out;
}

function wireLocal() {
  $('pickDir').addEventListener('click', () => $('dirInput').click());
  $('pickFiles').addEventListener('click', () => $('fileInput').click());
  $('dirInput').addEventListener('change', e => { loadLocal(filesToEntries(e.target.files)); e.target.value = ''; });
  $('fileInput').addEventListener('change', e => { loadLocal(filesToEntries(e.target.files)); e.target.value = ''; });
  let depth = 0;
  const hasFiles = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  addEventListener('dragenter', e => { if (!hasFiles(e) || G.saver) return; e.preventDefault(); depth++; $('drop').hidden = false; });
  addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) $('drop').hidden = true; });
  addEventListener('drop', async e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); depth = 0; $('drop').hidden = true;
    try { loadLocal(await walkDrop(e.dataTransfer)); } catch (err) { showMsg('Could not read the drop: ' + (err.message || err), true); }
  });
}

// ── controls ───────────────────────────────────────────────────────────────
function setMode(m) {
  viewer.controls.setMode(m);
  document.querySelectorAll('#modeSeg button, #dockMode button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  $('modeHint').textContent = HINTS[m];
  $('joy').hidden = m === 'orbit' || !COARSE;
  showHint(); renderStatus();
}
async function setSound(on) {
  G.sound = await viewer.audio.enable(on);
  for (const id of ['tSound', 'dockSound']) { const b = $(id); b.classList.toggle('on', G.sound); b.setAttribute('aria-pressed', String(G.sound)); }
  $('dockSound').setAttribute('aria-label', G.sound ? 'Sound on' : 'Sound off');
}
function setQuality(q) {
  try { localStorage.setItem(QKEY, q); } catch (e) {}
  document.querySelectorAll('#qualSeg button').forEach(b => b.classList.toggle('on', b.dataset.q === q));
  $('qualHint').textContent = { low: 'The smallest splat file (100k when the world has one), pixel ratio 1, a short splat cut-off. For phones.', mid: 'The 500k splat file when there is one, pixel ratio up to 1.5.', high: 'The full-resolution splat, pixel ratio up to 2, sun shadows on the collider mesh.' }[q];
  viewer.setQuality(q).then(renderCard);
}
function wireControls() {
  document.querySelectorAll('#modeSeg button, #dockMode button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  document.querySelectorAll('#qualSeg button').forEach(b => b.addEventListener('click', () => setQuality(b.dataset.q)));
  const tog = (id, k) => $(id).addEventListener('click', () => { const on = !$(id).classList.contains('on'); $(id).classList.toggle('on', on); $(id).setAttribute('aria-pressed', String(on)); viewer.setShow(k, on); });
  tog('tSplat', 'splat'); tog('tMeshes', 'meshes');
  $('tSound').addEventListener('click', () => setSound(!G.sound));
  $('dockSound').addEventListener('click', () => setSound(!G.sound));
  $('resetView').addEventListener('click', () => viewer.toStart());
  $('resetObjs').addEventListener('click', () => viewer.objects.reset());
}

// ── panel and phone sheet ──────────────────────────────────────────────────
function setOpen(open) {
  const p = $('panel');
  p.classList.toggle('open', open);
  if (!open) p.classList.remove('full');
  document.body.classList.toggle('panel-closed', !open);
  $('dockPanel').classList.toggle('on', open);
  $('dockPanel').setAttribute('aria-expanded', String(open));
}
function wirePanel() {
  const toggle = () => setOpen(!$('panel').classList.contains('open'));
  $('gear').addEventListener('click', toggle);
  $('dockPanel').addEventListener('click', toggle);
  $('panelClose').addEventListener('click', () => setOpen(false));
  setOpen(!PHONE_Q.matches);
  PHONE_Q.addEventListener('change', e => setOpen(!e.matches));
  const grip = $('sheetGrip'); let gy = null;
  grip.addEventListener('pointerdown', e => { gy = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) {} });
  grip.addEventListener('pointerup', e => {
    if (gy === null) return;
    const dy = e.clientY - gy; gy = null; const p = $('panel');
    if (Math.abs(dy) < 8) p.classList.toggle('full');
    else if (dy < -40) p.classList.add('full');
    else if (dy > 40) { if (p.classList.contains('full')) p.classList.remove('full'); else setOpen(false); }
  });
  grip.addEventListener('pointercancel', () => { gy = null; });
}
// The view centres in the canvas part that the panel, the sheet and the
// dock leave clear: the drawer on a desktop (left), the sheet and the dock
// on a phone (bottom).
function syncInsets() {
  if (G.saver) return;
  let b = 0, l = 0;
  const pr0 = $('panel').getBoundingClientRect();
  if (!PHONE_Q.matches && $('panel').classList.contains('open')) l = Math.max(0, Math.min(innerWidth * 0.5, pr0.right));
  if (PHONE_Q.matches) {
    const H = innerHeight, dock = $('dock').getBoundingClientRect(), p = $('panel');
    const pr = p.getBoundingClientRect();
    const sideDrawer = pr.top < 10;
    b = H - (p.classList.contains('open') && !sideDrawer ? pr.top : dock.top);
    b = Math.max(0, Math.min(H * 0.7, b));
  }
  viewer.setInsets(0, b, l);
}

// ── boot ───────────────────────────────────────────────────────────────────
async function boot() {
  try { viewer = createViewer({ canvas: $('view'), onStatus, quality: initialQuality() }); }
  catch (e) { $('nogl').hidden = false; G.failed = 'webgl: ' + (e.message || e); return; }
  window.__iw = { viewer, G, state: () => ({ ...viewer.state(), booted: G.booted, failed: G.failed, hosted: G.hosted.length, local: G.local.length, errors: G.errors, cur: G.cur && G.cur.slug }) };
  wirePanel(); wireControls(); wireLocal();
  document.querySelectorAll('#qualSeg button').forEach(b => b.classList.toggle('on', b.dataset.q === viewer.quality));
  setQuality(viewer.quality);
  setMode('orbit');
  const tick = () => { syncInsets(); requestAnimationFrame(tick); }; tick();
  try {
    const r = await fetch('worlds/manifest.json', { cache: 'no-cache' });
    const man = parseManifest(await r.json(), 'worlds/');
    G.errors.push(...man.errors);
    for (const m of man.worlds) {
      const [w] = await loadWorlds(m.entries, m);
      if (!w) { G.errors.push(m.slug + ': no world in its files'); continue; }
      w.sample = /(^|-)sample(-|$)/.test(m.slug);
      w.saver = m.saver; w.start = m.start; w.background = m.background;
      G.hosted.push(w);
    }
  } catch (e) { G.errors.push('manifest: ' + (e.message || e)); }
  if (G.errors.length) console.warn('image-worlds: ' + G.errors.join('; '));
  renderGallery();
  G.booted = true;
  const want = decodeURIComponent(location.hash.slice(1));
  if (!G.saver) await openWorld(G.hosted.find(w => w.slug === want) || G.hosted[0]);
}

// ── screensaver ────────────────────────────────────────────────────────────
// SHOTS. Each shot is a camera path p(u), u 0..1 over its hold, looking at
// a point. Subject worlds (saver.target) use orbit, push, pull, crane and
// truck round the target. Spawn worlds use pan (the camera turns on the
// spot), drift (a slow move forward), rise, and a short arc round a point
// 2.5 m ahead. An ease-in-out on u; calm scales the arc and the travel.
const SHOTS_SUBJECT = ['orbit', 'push', 'pull', 'crane', 'truck', 'orbit'];
const SHOTS_SPAWN = ['pan', 'drift', 'rise', 'arc', 'pan'];
const ease = u => u < 0 ? 0 : u > 1 ? 1 : u * u * (3 - 2 * u);
function shotPath(kind, w, rnd, calm) {
  const V = viewer.THREE.Vector3, k = 1 - 0.45 * calm;
  const sv = w.saver || null;
  if (sv && sv.target) {
    const T = new V(...sv.target), [r0, r1] = sv.radius || [2, 3];
    const a0 = (rnd() - 0.5) * 1.1, dir = rnd() < 0.5 ? -1 : 1, r = r0 + (r1 - r0) * rnd(), h = 0.35 + 1.1 * rnd();
    const at = (a, rr, hh) => new V(T.x + Math.sin(a) * rr, T.y + hh, T.z + Math.cos(a) * rr);
    const P = {
      orbit: u => at(a0 + dir * 0.9 * k * u, r, h),
      push: u => at(a0, r * (1.25 - 0.55 * k * u), h * (1 - 0.3 * u)),
      pull: u => at(a0, r * (0.7 + 0.55 * k * u), h * (0.7 + 0.3 * u)),
      crane: u => at(a0 + dir * 0.25 * u, r, 0.15 + 1.8 * k * u),
      truck: u => { const p = at(a0, r, h * 0.8); const s = new V(Math.cos(a0), 0, -Math.sin(a0)); return p.addScaledVector(s, (u - 0.5) * 1.6 * k * dir); },
    }[kind];
    const lookY = kind === 'crane' ? u => T.y - 0.1 * u : () => T.y;
    return { pos: P, look: u => new V(T.x, lookY(u), T.z), fov: 42 + 16 * rnd() };
  }
  // Spawn worlds: stay near the spawn, look outward.
  const yaw0 = (rnd() - 0.5) * 2.4, dir = rnd() < 0.5 ? -1 : 1, eye = 1.45 + 0.4 * rnd();
  const fwd = a => new V(-Math.sin(a), 0, -Math.cos(a));
  const P = {
    pan: { pos: () => new V(0, eye, -0.5), look: u => new V(0, eye - 0.15, -0.5).addScaledVector(fwd(yaw0 + dir * 0.9 * k * u), 4) },
    drift: { pos: u => new V(0, eye, -0.5).addScaledVector(fwd(yaw0), 1.4 * k * u), look: u => new V(0, eye - 0.25, -0.5).addScaledVector(fwd(yaw0 + dir * 0.15 * u), 5) },
    rise: { pos: u => new V(0, 0.7 + 1.3 * k * u, -0.5), look: u => new V(0, 0.9 + 0.5 * u, -0.5).addScaledVector(fwd(yaw0), 4) },
    arc: (() => { const C = new V(0, eye - 0.3, -0.5).addScaledVector(fwd(yaw0), 2.5); return { pos: u => { const a = yaw0 + dir * 0.45 * k * (u - 0.5); return C.clone().addScaledVector(fwd(a), -2.5).setY(eye); }, look: () => C }; })(),
  }[kind];
  return { ...P, fov: 55 + 15 * rnd() };
}

async function codeExtract() {
  try {
    const src = await (await fetch('viewer.js')).text();
    const lines = src.split('\n'), i = lines.findIndex(l => l.includes('const sm = world.semantics;'));
    if (i >= 0) return { lang: 'js', name: 'viewer.js · world transform', text: lines.slice(i, i + 5).map(l => l.replace(/^ {4}/, '')).join('\n') };
  } catch (e) {}
  return { lang: 'js', name: 'viewer.js · world transform', text: "worldGroup.rotation.set(sm.flipY ? Math.PI : 0, 0, 0);\nworldGroup.scale.setScalar(sm.metricScale || 1);" };
}

window.snSaver = {
  async enter(o = {}) {
    G.saver = true;
    document.documentElement.classList.add('sn-saver');
    const calm = Math.max(0, Math.min(1, o.calm ?? 0.7));
    let seed = (o.seed >>> 0) || 1;
    const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const label = typeof o.label === 'function' ? o.label : () => {};
    const canvas = $('view');
    canvas.style.transition = 'opacity 0.6s ease';
    setOpen(false); $('loading').hidden = true;
    if (G.sound) await setSound(false);
    const waitBoot = async () => { for (let i = 0; i < 300 && !G.booted && !G.failed; i++) await new Promise(r => setTimeout(r, 100)); };
    await waitBoot();
    if (viewer && viewer.quality === 'low' && !COARSE) await viewer.setQuality('mid');
    const pool = G.hosted.filter(w => Object.keys(w.splats).length);
    const code = await codeExtract();
    // The plan: a seeded shuffle of (world, shot) pairs; worlds rotate, so
    // no world plays twice in a row when there are two or more.
    const plan = [];
    const deal = () => {
      const ws = pool.slice(); for (let i = ws.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ws[i], ws[j]] = [ws[j], ws[i]]; }
      for (const w of ws) {
        const kinds = (w.saver && w.saver.target ? SHOTS_SUBJECT : SHOTS_SPAWN).slice();
        for (let i = kinds.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [kinds[i], kinds[j]] = [kinds[j], kinds[i]]; }
        for (const kd of kinds.slice(0, ws.length > 1 ? 3 : kinds.length)) plan.push({ w, kind: kd });
      }
    };
    const holdFor = () => (5 + 7 * rnd()) * 1000 * (0.85 + 0.3 * calm);
    let shot = null, t0 = 0, hold = 6000, going = false, band = null, bandAt = -1e9;
    const plate = () => {
      const w = G.cur; if (!w) { label(null); return; }
      const i = viewer.state().splat;
      label({
        title: 'Image worlds · ' + w.name,
        sub: w.sample ? 'Gaussian splat still life from CC0 parts: DX.GL splats, Poly Haven meshes' : (w.credit || 'Made with image-blaster: World Labs splat, FAL meshes and sound'),
        params: [
          { sym: 'N', name: 'splats', value: i ? fmtN(i.count) : '?', cls: 'm1' },
          { sym: 's', name: 'metric scale', value: (w.semantics.metricScale || 1).toFixed(2), cls: 'm2' },
          { sym: 'M', name: 'meshes', value: String(w.objects.length), cls: 'm3' },
        ],
        lines: [shot ? 'Shot: ' + shot.kind + (w.saver && w.saver.target ? ' round the group' : ' from the spawn') : '', 'Spark 2.3.1 on three.js r185'],
        eq: ['p_world = R_x(π·flipY) · s · p_spz + (0, h, 0)'],
        code,
      });
    };
    const dip = (ms, fn) => new Promise(res => { canvas.style.transitionDuration = ms + 'ms'; canvas.style.opacity = '0'; setTimeout(async () => { await fn(); canvas.style.opacity = '1'; res(); }, ms); });
    const start = async () => {
      if (!plan.length) deal();
      const next = plan.shift(); if (!next) return;
      const change = next.w !== G.cur;
      going = true;
      await dip(change ? 900 : 350, async () => {
        if (change) { await openWorld(next.w); }
        shot = { ...next, path: shotPath(next.kind, next.w, rnd, calm) };
        viewer.camera.fov = shot.path.fov; viewer.camera.updateProjectionMatrix();
        t0 = performance.now(); hold = holdFor();
        if (next.w.objects.length && rnd() < 0.45) setTimeout(() => { const L = viewer.objects.list; if (L.length && G.saver) viewer.objects.poke(L[Math.floor(rnd() * L.length)]); }, 1500 + 2000 * rnd());
        plate();
      });
      going = false;
    };
    // The director replaces the user controls while the saver runs.
    viewer.setDirector((dt, now) => {
      if (now - bandAt > 250) { bandAt = now; band = plateBand(innerHeight); viewer.setInsets(band ? band.t : 0, band ? band.b : 0); }
      if (!shot) return;
      const u = ease((now - t0) / hold);
      viewer.camera.position.copy(shot.path.pos(u));
      viewer.camera.lookAt(shot.path.look(u));
      if (!going && now - t0 > hold) start();
    });
    if (!pool.length) {
      // No world at all (a broken manifest): a slow turn over the empty
      // scene, so the plate still has a subject.
      label({ title: 'Image worlds', sub: 'No world in the gallery', lines: ['Load a world folder on the page to see it here.'], code });
      return { canvas, warmupMs: 1000 };
    }
    await start();
    this.debug = () => ({ world: G.cur && G.cur.slug, kind: shot && shot.kind, held: +((performance.now() - t0) / 1000).toFixed(1), hold: +(hold / 1000).toFixed(1), plan: plan.length, state: viewer.state() });
    return { canvas, warmupMs: 2500 };
  },
  exit() {
    G.saver = false;
    viewer.setDirector(null);
    viewer.resize();
    document.documentElement.classList.remove('sn-saver');
    $('view').style.opacity = '1';
    setOpen(!PHONE_Q.matches);
  },
};

boot();
