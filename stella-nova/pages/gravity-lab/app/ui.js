// ============================================================================
//  GRAVITY LAB  ·  app/ui.js — the controls, panels, HUD and labels
// ----------------------------------------------------------------------------
//  buildUI() binds every control of index.html once. applyChoice(choice)
//  starts a run (app/run.js startRun), writes the link (?seed=, ?exp=) and
//  refreshes the story strip, the tray and the details. refreshHUD() runs
//  four times a second (clock, selection card, live numbers); placeLabels()
//  each frame (body names on screen).
//
//  LINKS   ?seed=<int> a random run (roll.js), &scene=<sandbox key> a
//          generated scene of that kind; ?exp=<key>&v=<variant>&s=<seed>
//          one experiment of the library
//  KEYS    Space pause · . step · [ ] speed · R restart · N randomize ·
//          T trails · F follow the selection · 1-8 arm a tray item ·
//          Esc disarm and close panels
//
//  grep -n targets: "export function buildUI", "export function applyChoice",
//  "function choiceFromURL", "function buildTray", "function buildGallery",
//  "function cardArt", "export function refreshHUD", "function refreshDetails",
//  "export function placeLabels", "function toast", "export function resizeNow",
//  "export function closePanels", "function keys"
// ============================================================================
import { S, UI, $, SPEEDS, PHONE_Q, COARSE, bus } from './state.js';
import { startRun, throwItem, fmtTime, fmtLen, fmtSpeed, budget } from './run.js';
import { cam, resetCam } from './camera.js';
import { bindPointer } from './pointer.js';
import { EXPERIMENTS, GROUPS, build } from '../experiments/index.js';
import { SANDBOX } from '../roll.js';
import { ITEMS, ITEM, NOTES, dominant } from '../items.js';
import { SOURCES } from '../data.js';
import { toFrame } from '../frame.js';
import { stateToElements, v3 } from '../nbody.js';
import { pixelRatio } from '../budget.js';
import { typeset } from '../../../lib/sci-math.js';

export const SCENES = { cluster: 'A knot of suns', rumble: 'Packed planets', ringDive: 'Rubble moon dive', binaryDisk: 'Two suns and a disk', bhSwarm: 'Stars and a black hole',
  cometStorm: 'Comet storm', galaxyGroup: 'Three galaxies', triple: 'Triple star', trojanFire: 'Trojans under fire', moonCrowd: 'Crowded moons', probes: 'Probes at Jupiter' };
const EVENT_TOAST = { merge: 1, breakup: 1, hit: 1, capture: 1, release: 1, ejection: 1, burn: 1 };

// ── runs ────────────────────────────────────────────────────────────────────
export function applyChoice(choice, { url = true } = {}) {
  let spec;
  try { spec = startRun(choice); }
  catch (e) { console.error(e); toast('That run failed to start: ' + e.message); return; }
  const cv = $('gpu');
  resetCam(spec, cv.clientWidth, cv.clientHeight);
  S.E0 = S.lab.sys ? S.lab.sys.energy() + S.lab.sys.Eloss : 0;
  if (url && !S.saverOn) writeURL(choice);
  refreshStory();
  refreshTray();
  refreshDetails();
  buildLabels();
  for (const b of document.querySelectorAll('#groups .scard')) b.classList.toggle('on', choice.type === 'library' && b.dataset.key === spec.key);
}
function writeURL(c) {
  const q = new URLSearchParams();
  if (c.type === 'roll') { q.set('seed', String(c.seed)); if (c.sandbox) q.set('scene', c.sandbox); }
  else { q.set('exp', c.key); if (c.variant) q.set('v', c.variant); if (c.seed && c.seed !== 1) q.set('s', String(c.seed)); }
  try { history.replaceState(null, '', location.pathname + '?' + q.toString() + location.hash); } catch (e) { /* file:// */ }
}
function choiceFromURL() {
  const q = new URLSearchParams(location.search);
  if (q.has('seed')) { const c = { type: 'roll', seed: (parseInt(q.get('seed'), 10) >>> 0) || 1 }; const sc = q.get('scene'); if (sc && SANDBOX[sc]) { c.sandbox = sc; c.family = 'sandbox'; } return c; }
  const k = q.get('exp');
  if (k && EXPERIMENTS[k]) { const v = q.get('v'); return { type: 'library', key: k, variant: EXPERIMENTS[k].variants.includes(v) ? v : EXPERIMENTS[k].variants[0], seed: (parseInt(q.get('s'), 10) >>> 0) || 1 }; }
  return null;
}
export function firstChoice() { return choiceFromURL() || { type: 'library', key: 'galaxies', variant: 'mice', seed: 1 }; }
export function randomize(sandbox) {
  const seed = (Math.random() * 1e9) >>> 0;
  applyChoice(sandbox ? { type: 'roll', seed, family: 'sandbox', sandbox } : { type: 'roll', seed });
}

// ── story strip, tray, details ──────────────────────────────────────────────
// After the saver: the panels show the run it left on screen.
export function refreshRun() { if (!S.spec) return; refreshStory(); refreshTray(); refreshDetails(); buildLabels(); S.E0 = S.lab.sys ? S.lab.sys.energy() + S.lab.sys.Eloss : 0; }
function refreshStory() {
  const sp = S.spec;
  $('expName').textContent = sp.title;
  $('title').textContent = sp.title;
  $('blurb').textContent = sp.blurb || '';
  $('feed').textContent = '';
  const c = S.choice, ri = $('rollInfo');
  if (c.type === 'roll') {
    ri.hidden = false;
    const fam = sp.rollInfo ? sp.rollInfo.family : 'roll';
    $('rollCap').textContent = `Random run · seed ${c.seed}${c.sandbox ? ' · ' + SCENES[c.sandbox] : ''} · ${fam === 'library' ? 'from the library' : fam === 'intruder' ? 'library + intruder' : 'generated scene'}`;
  } else ri.hidden = true;
}
function refreshTray() {
  const off = !S.lab || !S.lab.sys || !!S.spec.self;
  $('tray').classList.toggle('dis', off);
  $('trayHint').textContent = off ? 'This run has no bodies to throw things at: every particle pulls on every other.' : UI.item ? (COARSE ? 'Touch and drag in the scene to throw. Tap for a circular orbit.' : 'Press and drag in the scene to throw. Click for a circular orbit.') : 'Pick something, then throw it into the scene.';
  for (const b of document.querySelectorAll('#trayItems button')) { b.classList.toggle('on', b.dataset.item === UI.item); b.disabled = off; }
  $('dockTray').classList.toggle('on', !!UI.item || !$('tray').classList.contains('shut'));
  document.body.classList.toggle('tray-open', PHONE_Q.matches && !$('tray').classList.contains('shut'));
}
function refreshDetails() {
  const sp = S.spec;
  const rows = (sp.facts || []).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('');
  $('facts').innerHTML = rows;
  const eqs = $('eqs'); eqs.replaceChildren();
  for (const t of sp.tex || []) { const d = document.createElement('div'); d.className = 'sci-eq'; eqs.appendChild(d); typeset(d, t).catch(() => {}); }
  const notes = (sp.notes || []).concat(S.lab && S.lab.sys ? NOTES : []);
  $('notes').innerHTML = notes.map(n => `<li>${esc(n)}</li>`).join('');
  $('sources').textContent = (sp.sources || []).map(k => SOURCES[k]).filter(Boolean).join(' · ');
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── HUD (4 Hz) ──────────────────────────────────────────────────────────────
export function refreshHUD() {
  if (!S.lab || !S.spec) return;
  const sp = S.spec, U = sp.scale || { L: 1, M: 1, T: 1, V: 1 }, sys = S.lab.sys;
  const sim = S.lab.t * U.T;
  $('clock').textContent = fmtTime(sim);
  const rate = sp.rate * SPEEDS[UI.speedI] * S.slow * U.T;
  const sv = `1 s = ${fmtTime(rate)}`;
  $('speedV').textContent = sv; $('dockSpeedV').textContent = '×' + fmtMul(SPEEDS[UI.speedI]);
  $('slowChip').hidden = !(S.slow < 0.7);
  // selection
  const card = $('selCard'), i = S.sel;
  if (sys && i >= 0 && i < sys.n && sys.alive[i]) {
    card.hidden = false;
    const m = S.meta[i], dom = dominant(sys);
    $('selName').textContent = m.name;
    $('selName').style.setProperty('--c', `rgb(${m.color.map(x => Math.round(x * 255)).join(',')})`);
    const r = [];
    r.push(['mass', massText(sys.m[i] * U.M)]);
    if (dom && dom.i !== i) {
      const dx = v3.sub(sys.pos(i), dom.x), dv = v3.sub(sys.vel(i), dom.v);
      r.push(['distance from ' + S.meta[dom.i].name, fmtLen(v3.len(dx) * U.L)]);
      r.push(['speed relative to it', fmtSpeed(v3.len(dv) * U.V)]);
      const el = stateToElements(sys.m[i] + dom.m, dx, dv);
      if (el.e < 1 && el.a > 0) { r.push(['orbit', `a = ${fmtLen(el.a * U.L)}, e = ${el.e.toFixed(3)}`]); r.push(['period', fmtTime(2 * Math.PI * Math.sqrt(el.a ** 3 / (sys.m[i] + dom.m)) * U.T)]); }
      else r.push(['orbit', `unbound (e = ${el.e.toFixed(2)})`]);
    } else r.push(['speed', fmtSpeed(v3.len(v3.sub(sys.vel(i), S.frame.v)) * U.V)]);
    $('selRows').innerHTML = r.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('');
    $('followBtn').textContent = S.follow === i ? 'Stop following' : 'Follow';
  } else card.hidden = true;
  if (!$('details').classList.contains('off')) {
    const L = [];
    L.push(['time', fmtTime(sim)]);
    L.push(['speed', sv]);
    if (sys) {
      L.push(['bodies', String(Array.from(sys.alive).filter(Boolean).length)]);
      const E = sys.energy() + sys.Eloss;
      if (S.E0) L.push(['energy books |ΔE/E|', Math.abs((E - S.E0) / S.E0).toExponential(1)]);
      L.push(['body substeps per particle step', (sys.subTotal / Math.max(1, S.lab.frames)).toFixed(1)]);
    }
    L.push(['particle rows', ((sp.self || sp.particles || { n: 0 }).n + (S.lab.pool || 0)).toLocaleString('en-US')]);
    L.push(['particle step', fmtTime(sp.dt * U.T)]);
    L.push(['CPU per frame', S.cpuMs.toFixed(1) + ' ms']);
    $('live').innerHTML = L.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('');
  }
}
const fmtMul = x => x >= 1 ? String(x) : '1/' + Math.round(1 / x);
function massText(kg) {
  if (!(kg > 0)) return 'massless';
  if (kg > 1e29) return sig(kg / 1.98847e30) + ' M☉';
  if (kg > 1e26) return sig(kg / 1.89813e27) + ' Jupiter masses';
  if (kg > 1e22) return sig(kg / 5.9722e24) + ' Earth masses';
  return kg.toExponential(2) + ' kg';
}
const sig = x => Number(x.toPrecision(3)).toLocaleString('en-US');

// ── labels ──────────────────────────────────────────────────────────────────
let labelEls = [];
function buildLabels() {
  const host = $('labels'); host.replaceChildren(); labelEls = [];
}
export function placeLabels() {
  const host = $('labels'), sys = S.lab && S.lab.sys;
  if (!sys || !UI.labels || S.saverOn) { host.hidden = true; return; }
  host.hidden = false;
  const R = S.ren, k = R.W / $('gpu').clientWidth, phone = PHONE_Q.matches;
  const dom = dominant(sys);
  while (labelEls.length < sys.n) { const d = document.createElement('div'); d.className = 'lbl'; host.appendChild(d); labelEls.push(d); }
  for (let i = 0; i < labelEls.length; i++) {
    const el = labelEls[i];
    const show = i < sys.n && sys.alive[i] && S.meta[i] && (!phone || i === S.sel || (dom && i === dom.i)) && (sys.n <= 14 || i === S.sel || S.meta[i].item || (dom && i === dom.i));
    if (!show) { el.hidden = true; continue; }
    const q = R.project(toFrame(S.frame, sys.pos(i)));
    if (!q || q.x < 0 || q.y < 0 || q.x > R.W || q.y > R.H) { el.hidden = true; continue; }
    el.hidden = false;
    if (el.textContent !== S.meta[i].name) el.textContent = S.meta[i].name;
    el.classList.toggle('sel', i === S.sel);
    el.style.transform = `translate(${(q.x / k + 9).toFixed(1)}px, ${(q.y / k - 8).toFixed(1)}px)`;
  }
}

// ── toasts ──────────────────────────────────────────────────────────────────
function toast(text) {
  const host = $('toasts'), d = document.createElement('div');
  d.className = 'toast'; d.textContent = text; host.appendChild(d);
  while (host.children.length > 3) host.firstChild.remove();
  setTimeout(() => d.classList.add('out'), 3600);
  setTimeout(() => d.remove(), 4300);
}
bus('event', d => {
  if (S.saverOn) return;
  const close = d.t === 'periapsis' && d.e.d < 0.06 * S.spec.view.extent;
  if (EVENT_TOAST[d.t] || close) { toast(d.text); $('feed').textContent = d.text; }
});

// ── panels ──────────────────────────────────────────────────────────────────
const PANELS = ['gallery', 'display', 'details', 'explain', 'moreMenu'];
export function closePanels() { for (const p of PANELS) $(p).classList.add('off'); for (const b of ['dispBtn', 'detBtn', 'helpBtn']) $(b).classList.remove('on'); document.body.classList.remove('drawer-open'); }
function openPanel(id) {
  const was = !$(id).classList.contains('off');
  closePanels();
  if (was) return;
  $(id).classList.remove('off');
  if (id === 'gallery') buildGalleryArt();
  if (id === 'details') { document.body.classList.add('drawer-open'); refreshHUD(); }
  const btn = { display: 'dispBtn', details: 'detBtn', explain: 'helpBtn' }[id]; if (btn) $(btn).classList.add('on');
}

// ── tray ────────────────────────────────────────────────────────────────────
function buildTray() {
  const host = $('trayItems');
  ITEMS.forEach((it, k) => {
    const b = document.createElement('button');
    b.dataset.item = it.key; b.title = `${it.desc} (${k + 1})`;
    const c = it.color.map(x => Math.round(Math.min(1, x) * 255)).join(',');
    b.innerHTML = `<i class="ic ${it.key}" style="--c:rgb(${c})"></i><span>${it.name}</span>`;
    b.addEventListener('click', () => arm(UI.item === it.key ? null : it.key));
    host.appendChild(b);
  });
}
function arm(key) {
  UI.item = key; S.aim = null;
  $('gpu').classList.toggle('aiming', !!key);
  refreshTray();
}

// ── gallery ─────────────────────────────────────────────────────────────────
function buildGallery() {
  const host = $('groups');
  const sc = $('scenes');
  for (const [k, name] of Object.entries(SCENES)) {
    const b = document.createElement('button'); b.textContent = name;
    b.addEventListener('click', () => { closePanels(); randomize(k); });
    sc.appendChild(b);
  }
  for (const [g, gname] of Object.entries(GROUPS)) {
    const list = Object.values(EXPERIMENTS).filter(x => x.group === g);
    if (!list.length) continue;
    const h = document.createElement('h3'); h.className = 'gal-h'; h.textContent = gname; host.appendChild(h);
    const grid = document.createElement('div'); grid.className = 'cards'; host.appendChild(grid);
    for (const X of list) {
      const card = document.createElement('div'); card.className = 'scard'; card.dataset.key = X.key;
      card.innerHTML = `<canvas width="300" height="170" aria-hidden="true"></canvas><b>${esc(X.title)}</b><div class="vars"></div>`;
      card.querySelector('canvas').addEventListener('click', () => { closePanels(); applyChoice({ type: 'library', key: X.key, variant: X.variants[0], seed: 1 }); });
      card.querySelector('b').addEventListener('click', () => { closePanels(); applyChoice({ type: 'library', key: X.key, variant: X.variants[0], seed: 1 }); });
      const vars = card.querySelector('.vars');
      for (const v of X.variants) {
        const c = document.createElement('button'); c.textContent = v.replace(/-/g, ' ');
        c.addEventListener('click', () => { closePanels(); applyChoice({ type: 'library', key: X.key, variant: v, seed: v === 'random' ? (Math.random() * 1e9) >>> 0 : 1 }); });
        vars.appendChild(c);
      }
      grid.appendChild(card);
    }
  }
}
let artDone = false;
function buildGalleryArt() {
  if (artDone) return; artDone = true;
  const cards = [...document.querySelectorAll('#groups .scard')];
  let k = 0;
  const next = () => {
    if (k >= cards.length) return;
    const card = cards[k++];
    try { cardArt(card.querySelector('canvas'), build(card.dataset.key, 1, { n: 1400, variant: EXPERIMENTS[card.dataset.key].variants[0] })); } catch (e) { /* art is optional */ }
    setTimeout(next, 16);
  };
  next();
}
// A still of the start of a spec: particles as dots, bodies as discs, seen
// from the spec's tilt.
function cardArt(cv, spec) {
  const g = cv.getContext('2d'), W = cv.width, H = cv.height;
  g.fillStyle = '#05070c'; g.fillRect(0, 0, W, H);
  const ext = spec.view.extent, tilt = (spec.view.tilt ?? 35) * Math.PI / 180, s = 0.48 * H / ext;
  const P = spec.self || spec.particles;
  const proj = p => [W / 2 + p[0] * s, H / 2 - (p[1] * Math.sin(tilt) + p[2] * Math.cos(tilt)) * s];
  const B = spec.bodies || [];
  let c0 = [0, 0, 0];
  if (Number.isInteger(spec.view.center) && B[spec.view.center]) c0 = B[spec.view.center].x;
  if (P) {
    const cols = (P.groups || []).map(q => `rgba(${q.color.map(x => Math.round(x * 255)).join(',')},0.55)`);
    for (let i = 0; i < P.n; i++) {
      const q = proj([P.pos[3 * i] - c0[0], P.pos[3 * i + 1] - c0[1], P.pos[3 * i + 2] - c0[2]]);
      g.fillStyle = cols[P.group ? P.group[i] : 0] || 'rgba(220,200,170,0.5)';
      g.fillRect(q[0], q[1], 1.2, 1.2);
    }
  }
  for (const b of B) {
    const q = proj(v3.sub(b.x, c0)), r = Math.max(2, Math.min(14, b.rDraw * s));
    g.fillStyle = b.kind === 'bh' ? '#000' : `rgb(${b.color.map(x => Math.round(x * 255)).join(',')})`;
    g.beginPath(); g.arc(q[0], q[1], r, 0, 7); g.fill();
    if (b.kind === 'bh') { g.strokeStyle = 'rgba(255,220,170,0.9)'; g.lineWidth = 1; g.stroke(); }
  }
}

// ── size ────────────────────────────────────────────────────────────────────
export function resizeNow() {
  const cv = $('gpu'); if (!S.ren) return;
  const w = cv.clientWidth, h = cv.clientHeight;
  const pr = pixelRatio(UI.quality, PHONE_Q.matches || COARSE, w, h, window.devicePixelRatio || 1);
  const W = Math.max(1, Math.round(w * pr)), H = Math.max(1, Math.round(h * pr));
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  S.ren.resize(W, H);
  S.dpr = pr;
}

// ── controls ────────────────────────────────────────────────────────────────
function setSpeed(i) { UI.speedI = Math.max(0, Math.min(SPEEDS.length - 1, i)); for (const b of document.querySelectorAll('#speeds button')) b.classList.toggle('on', +b.dataset.i === UI.speedI); refreshHUD(); }
function setPaused(p) {
  UI.paused = p;
  for (const id of ['playBtn', 'dockPlay']) { $(id).textContent = p ? '▶' : '❚❚'; $(id).setAttribute('aria-label', p ? 'Play' : 'Pause'); $(id).classList.toggle('on', p); }
}
// pause, then run six frames of the speed (main.js loop reads S.stepFrames)
function stepOnce() { setPaused(true); S.stepFrames = 6; }
function copyLink() {
  const u = location.href;
  (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(() => toast('Link copied'), () => toast(u));
}
function keys(e) {
  if (S.saverOn || e.metaKey || e.ctrlKey || e.altKey) return;
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
  const k = e.key;
  if (k === ' ') { e.preventDefault(); setPaused(!UI.paused); }
  else if (k === '.') stepOnce();
  else if (k === '[') setSpeed(UI.speedI - 1);
  else if (k === ']') setSpeed(UI.speedI + 1);
  else if (k === 'r' || k === 'R') applyChoice(S.choice);
  else if (k === 'n' || k === 'N') randomize();
  else if (k === 't' || k === 'T') { UI.trails = !UI.trails; $('tTrails').checked = UI.trails; }
  else if ((k === 'f' || k === 'F') && S.sel >= 0) S.follow = S.follow === S.sel ? -1 : S.sel;
  else if (k === 'Escape') { arm(null); closePanels(); }
  else if (/^[1-8]$/.test(k)) { const it = ITEMS[+k - 1]; if (it) arm(UI.item === it.key ? null : it.key); }
}

export function buildUI() {
  buildTray(); buildGallery();
  const sp = $('speeds');
  SPEEDS.forEach((x, i) => { const b = document.createElement('button'); b.dataset.i = i; b.textContent = '×' + fmtMul(x); b.addEventListener('click', () => setSpeed(i)); sp.appendChild(b); });
  setSpeed(UI.speedI);
  $('expBtn').addEventListener('click', () => openPanel('gallery'));
  $('rollBtn').addEventListener('click', () => randomize());
  $('galRoll').addEventListener('click', () => { closePanels(); randomize(); });
  $('resetBtn').addEventListener('click', () => applyChoice(S.choice));
  $('playBtn').addEventListener('click', () => setPaused(!UI.paused));
  $('stepBtn').addEventListener('click', stepOnce);
  $('dispBtn').addEventListener('click', () => openPanel('display'));
  $('detBtn').addEventListener('click', () => openPanel('details'));
  $('helpBtn').addEventListener('click', () => openPanel('explain'));
  $('seedBtn').addEventListener('click', copyLink);
  $('followBtn').addEventListener('click', () => { if (S.sel >= 0) S.follow = S.follow === S.sel ? -1 : S.sel; refreshHUD(); });
  $('selClose').addEventListener('click', () => { S.sel = -1; refreshHUD(); });
  for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => closePanels());
  $('gallery').addEventListener('click', e => { if (e.target === $('gallery')) closePanels(); });
  for (const b of document.querySelectorAll('#colors button')) b.addEventListener('click', () => { UI.colorMode = +b.dataset.c; for (const x of document.querySelectorAll('#colors button')) x.classList.toggle('on', x === b); });
  document.querySelector(`#colors button[data-c="${UI.colorMode}"]`).classList.add('on');
  const tog = (id, key) => { $(id).checked = UI[key]; $(id).addEventListener('change', () => { UI[key] = $(id).checked; }); };
  tog('tTrails', 'trails'); tog('tLabels', 'labels'); tog('tPredict', 'predict'); tog('tCalm', 'calm');
  for (const b of document.querySelectorAll('#quals button')) b.addEventListener('click', () => {
    UI.quality = b.dataset.q; for (const x of document.querySelectorAll('#quals button')) x.classList.toggle('on', x === b);
    resizeNow(); applyChoice(S.choice, { url: false });
  });
  document.querySelector('#quals button[data-q="auto"]').classList.add('on');
  // dock (phone)
  $('dockPlay').addEventListener('click', () => setPaused(!UI.paused));
  $('dockStep').addEventListener('click', stepOnce);
  for (const b of document.querySelectorAll('#dockSpeed button')) b.addEventListener('click', () => setSpeed(UI.speedI + (+b.dataset.d)));
  $('dockTray').addEventListener('click', () => { $('tray').classList.toggle('shut'); if ($('tray').classList.contains('shut')) arm(null); refreshTray(); });
  $('dockDisp').addEventListener('click', () => openPanel('display'));
  $('dockMore').addEventListener('click', () => openPanel('moreMenu'));
  $('moreRoll').addEventListener('click', () => { closePanels(); randomize(); });
  $('moreGal').addEventListener('click', () => openPanel('gallery'));
  $('moreLink').addEventListener('click', () => { closePanels(); copyLink(); });
  for (const b of document.querySelectorAll('[data-open]')) b.addEventListener('click', () => openPanel(b.dataset.open));
  if (PHONE_Q.matches) $('tray').classList.add('shut');
  // the call to action: a tagged store link (lib/wishlist.js)
  const W = window.snWishlist;
  for (const id of ['cta', 'ctaExplain']) { const a = $(id); if (W && W.url) a.href = W.url('gravity-lab', 'cta'); else a.hidden = true; }
  window.addEventListener('keydown', keys);
  bindPointer(i => refreshHUD(), (key, name) => {
    if (name) toast(`${name} thrown in`); else toast('No room for another body (at most 32)');
    // the energy books start again from the new total
    if (S.lab.sys) S.E0 = S.lab.sys.energy() + S.lab.sys.Eloss;
    refreshTray();
  });
  bus('run', () => { arm(UI.item); });
}
