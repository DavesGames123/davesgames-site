// ============================================================================
//  HUMAN SKELETON  ·  main.js — entry: module tree, debug object, boot
// ────────────────────────────────────────────────────────────────────────────
//  The manifest arrives first: it builds the list, the camera frame and the
//  bone state texture. The eight body groups then load at the same time
//  (spine and thorax first) and each one dissolves in when it arrives.
//
//  STATE    per bone: cur / from / to (offset + rotation), a stagger delay,
//           a drag offset with a spring, an appear factor, a flag (shown,
//           hidden, ghost). Every frame that changes, they go into the
//           BoneState texture (render.js) and the GPU moves the bones.
//  MODES    radial, regional (layout.js), catalogue (the tray). An amount
//           per region scales radial and regional, so one hand can open
//           while the rest stays put. Reconstruct plays the stagger back.
//  PICK     the bones render their row as a colour into a small target
//           round the tap (view offset of the main camera); the nearest
//           coloured pixel wins. Radius 4 px (mouse) or 22 px (touch).
//  SELECT   the bone glows, the card opens, the list marks it, and the
//           camera pans if the bone sits under the card or the panel.
//  ISOLATE  the other bones become fresnel ghosts; the camera flies to
//           the bone and orbits it.
//  FRAME    occlusion() measures the panel and the card;
//           camera.setViewOffset centres the view in the clear part.
//
//  MODULE TREE (app/, one concern per file; each file has its own map)
//    env.js         constants, device queries, helpers, THEMES
//    stage.js       renderer, scene, lights, floor, pool, trays, controls
//    state.js       S, dirty, T, toast, hideHint, regionOf
//    load.js        loadAll / addGroup / ensureCartilage
//    visibility.js  refreshVisibility: S.vis and the bone flags
//    layouts.js     setMode / explode / reconstruct / retarget
//    tray.js        buildTrays / placeLabels
//    pick.js        pickAt
//    select.js      select / clearSelection / step / boneCentre
//    card.js        showCard / hideCard and the card buttons
//    inspect.js     isolate / exitIsolate / focusBone / focusRegion
//    list.js        buildList / syncList / setRegionHidden, search
//    pointer.js     tap, double tap, hover, drag out
//    camera.js      occlusion / resize / flyTo / fitView / fitShadow
//    panel.js       setOpen, the phone sheet, the dock list button
//    controls.js    setTheme / setShow / syncUI / syncRead / buildUI
//    loop.js        frame, and the pagehide teardown
//
//  ORDER    env.js and stage.js evaluate first. If WebGL 2 is missing,
//           stage.js throws and no other module runs. The other modules
//           call each other only inside functions, so the import cycles
//           do not read a binding before it is set.
//
//  GREP MAP
//    window.__hs                                     debug and headless checks
//    window.snSaver                                  screensaver tour (lib/screensaver.js)
//    const SHOTS                                     screensaver shots: region, move, explode
//    function saverTour                              screensaver order: full view, bones, region
//    function boneView                               screensaver: the camera side for one bone
//    function plateClear                             screensaver: the clear part beside the plate
//    function saverPlate                             screensaver plate: layout, region, bone in focus
//    function boneAnchor                             the bone in focus (landmarks) or the skeleton on screen
//    // ── boot                                     start the page
// ============================================================================
import * as THREE from 'three';
import { $, TYPE_NAME, SIDE_NAME, MODE_NAME } from './app/env.js';
import { canvas, camera, controls, scene } from './app/stage.js';
import { T, S, toast } from './app/state.js';
import { fitView, saverOcc } from './app/camera.js';
import { loopHook } from './app/loop.js';
import { pickAt } from './app/pick.js';
import { loadAll } from './app/load.js';
import { setMode, explode, reconstruct, setAmount, toggleRegionExplode, retarget } from './app/layouts.js';
import { boneCentre, select, clearSelection, step, setHi } from './app/select.js';
import { isolate, exitIsolate, focusBone, focusRegion } from './app/inspect.js';
import { setRegionHidden } from './app/list.js';
import { setOpen } from './app/panel.js';
import { setTheme, setShow, buildUI } from './app/controls.js';
import { frame } from './app/loop.js';
import * as L from './layout.js';

// debug and headless checks
window.__hs = {
  S, T, select, clearSelection, isolate, exitIsolate, setMode, explode, reconstruct, setAmount, toggleRegionExplode, focusRegion, focusBone,
  setTheme, setShow, setRegionHidden, pickAt, step, camera, controls, setOpen, fitView,
  screenOf(id) {
    const b = typeof id === 'number' ? S.bones[id] : S.P.byId.get(id);
    const p = boneCentre(b.i).project(camera);
    const cr = canvas.getBoundingClientRect();
    return { x: cr.left + (p.x + 1) / 2 * cr.width, y: cr.top + (1 - p.y) / 2 * cr.height, i: b.i };
  },
  busy: () => !!(S.tr || S.fly || S.springing.size || S.bones.some(b => S.loaded[b.i] && S.appear[b.i] < 1)),
};

// ── screensaver ─────────────────────────────────────────────────────────────
// Hook for the shell screensaver (lib/screensaver.js). enter() hides all the
// DOM but the canvas and paints the gallery backdrop into the scene (the
// canvas is transparent). The tour (saverTour) always opens on the full
// view: the assembled skeleton from the front, with a slow turn. Then come
// push-ins on single bones (a seeded shuffle, one region at a time): the
// bone glows, the other bones turn to glass, and the camera comes in from
// the side that shows the bone (boneView) at a new angle each time. After
// three bones there is a region shot (SHOTS: a set of regions, maybe
// exploded, with an orbit, a push in, a pan up the spine or a look down),
// then the full view again from a new angle. Shots last 5 to 9 s (calm 0
// to 1). loopHook.tick drives the camera every frame, so the page's own
// flights do not run.
//
// FRAMING. The shell's label plate covers a band at the top (title, logo)
// and one at the bottom (equations, values). plateClear() reads the text
// boxes of the plate in the shell document and offers three clear parts:
// the middle band, and the columns left and right of the text. The shot
// takes the part where its box fits largest, and saverOcc moves the view
// offset to the centre of that part. Before the first plate, or with no
// shell, the clear part is the whole canvas. Nothing goes to storage or
// the URL.
function saverBackdrop() {
  const c = document.createElement('canvas'); c.width = 768; c.height = 512;
  const g = c.getContext('2d'), light = S.theme === 'light';
  const gr = g.createRadialGradient(384, 195, 0, 384, 195, 560);
  const st = light ? ['#f7f3eb', '#efe9de', '#d9d1c3'] : ['#262119', '#1b1815', '#0c0b0a'];
  gr.addColorStop(0, st[0]); gr.addColorStop(0.42, st[1]); gr.addColorStop(1, st[2]);
  g.fillStyle = gr; g.fillRect(0, 0, 768, 512);
  const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
  return tx;
}
// The screensaver plate (opts.label), from the manifest (S.M). shot is a
// SHOTS entry, or null for a whole-body shot (mode: the explode mode). In a region shot, lit holds the bones of the shot and focus is
// the one that the plate names (name, Latin name, type, side, length and
// the fact of the card). Else the plate counts the bones in each group.
function saverPlate(shot, mode, lit, focus) {
  if (!S.M) return null;
  const counted = S.bones.filter(b => b.counted).length;
  const teeth = S.bones.filter(b => b.type === 'tooth').length, cart = S.bones.filter(b => b.type === 'cartilage').length;
  const ear = S.regions.find(r => r.id === 'ear');
  // The page has no equations, so the plate has no TeX. The parameters
  // carry the counts and the bone in focus.
  if (shot) {
    const types = {};
    for (const i of lit) { const t = S.bones[i].type; types[t] = (types[t] || 0) + 1; }
    const nb = lit.filter(i => S.bones[i].counted).length, b = S.bones[focus];
    const params = [{ name: 'bones', value: String(nb) }];
    const lines = [Object.keys(types).map(t => `${TYPE_NAME[t]} ${types[t]}`).join(', ') + '.'];
    if (b) {
      params.push({ name: 'in focus', value: b.side ? SIDE_NAME[b.side].toLowerCase() + ' ' + b.name.toLowerCase() : b.name },
        { name: 'type, length', value: `${TYPE_NAME[b.type]}, ${b.len >= 100 ? Math.round(b.len) : b.len.toFixed(1)} mm` });
      if (b.fma) params.push({ name: 'FMA', value: String(b.fma) });
      lines[0] = b.latin + '. ' + lines[0];
      if (b.fact) lines.push(b.fact);
    }
    return { title: shot.title, sub: `${nb} bone${nb === 1 ? '' : 's'} ${shot.noun} · ${shot.move}`, params, lines,
      anchor: () => boneAnchor(b ? focus : -1, lit) };
  }
  const params = [{ name: 'counted bones', value: String(counted) }, { name: 'teeth', value: String(teeth) }, { name: 'costal cartilages', value: String(cart) }];
  const per = S.M.groups.filter(g => g.id !== 'cartilage').map(g => `${g.label} ${S.bones.filter(b => b.group === g.id && b.counted).length}`);
  const full = mode === 'full';
  return { title: full ? 'Human skeleton' : `Human skeleton · ${MODE_NAME[mode] || 'Exploded'}`, sub: full ? 'Assembled · front view' : 'Exploded view',
    params, lines: [per.join(', ') + '.'].concat(ear && ear.count < ear.expected ? [`The ${ear.expected} ear ossicles are not in the set.`] : []),
    anchor: () => boneAnchor(-1, null) };
}
// The subject on screen, for the plate leader: a box anchor (the shell's
// w, h form) round the bones of the set (the lit region, or every shown
// bone), each centre plus its radius b.r, through the camera to page px.
// A standing skeleton is tall and thin, so a box fits it better than a
// circle. The key points are the landmarks of bone i (the bone in focus):
// its centre (boneCentre), its joint to the parent bone and the two ends of
// its longest box axis (qmin, qsize), moved by the same offset as the
// centre. On the catalogue tray the bone turns, so there only the centre is
// used. With no bone in focus, the key points are the eight longest bones.
// A first version took the focus bone alone as the subject, and the plate
// covered the rest of the lit foot.
const av = new THREE.Vector3();
function boneAnchor(i, set) {
  if (!S.M || !S.cur) return null;
  const b0 = canvas.getBoundingClientRect();
  const P = v => { av.copy(v).project(camera); return av.z < 1 ? { x: b0.left + (av.x + 1) / 2 * b0.width, y: b0.top + (1 - av.y) / 2 * b0.height } : null; };
  const ext = (c, r) => { const q = P(c), e = P(c.clone().addScaledVector(camera.up, r)); return q && e ? Math.hypot(e.x - q.x, e.y - q.y) : 0; };
  const cs = [];
  for (const b of (set && set.length ? set.map(k => S.bones[k]) : S.bones)) {
    if (S.vis && !S.vis[b.i]) continue;
    const c3 = boneCentre(b.i), q = P(c3); if (q) cs.push({ q, h: ext(c3, b.r), len: b.len });
  }
  if (!cs.length) return null;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const o of cs) { x0 = Math.min(x0, o.q.x - o.h); x1 = Math.max(x1, o.q.x + o.h); y0 = Math.min(y0, o.q.y - o.h); y1 = Math.max(y1, o.q.y + o.h); }
  let pts = cs.slice().sort((m, n) => n.len - m.len).slice(0, 8).map(o => o.q);
  if (i >= 0) {
    const b = S.bones[i], c3 = boneCentre(i), c = P(c3);
    if (c) {
      const d = c3.clone().sub(new THREE.Vector3(...b.c));
      pts = [c];
      if (!(S.mode === 'catalogue' && S.cat)) {
        if (b.joint) { const q = P(new THREE.Vector3(...b.joint).add(d)); if (q) pts.push(q); }
        if (b.qmin && b.qsize) {
          const k = b.qsize.indexOf(Math.max(...b.qsize)), lo = b.qmin.map((m, j) => m + b.qsize[j] / 2), hi = lo.slice();
          lo[k] = b.qmin[k]; hi[k] = b.qmin[k] + b.qsize[k];
          for (const e of [lo, hi]) { const q = P(new THREE.Vector3(...e).add(d)); if (q) pts.push(q); }
        }
      }
    }
  }
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, pts };
}
// The shots. regions: the bones of the shot. explode: explode those
// regions. az, el: the camera direction in degrees (az 0 is the front, 90
// the subject's left side), with daz, del over the shot. zoom: the fit
// distance at the start and the end (1 fills the clear part). pan: the
// share of the box height that the camera shows, moving from the bottom
// to the top. box(lo, hi): a smaller box round a joint.
const SHOTS = [
  { id: 'skull', title: 'Skull', noun: 'in the skull and jaw', move: 'orbit', regions: ['skull', 'teeth', 'hyoid'], az: -40, daz: 80, el: 8, zoom: [1.1, 0.96] },
  { id: 'spine', title: 'Spine', noun: 'in the column', move: 'pan from the sacrum to the atlas', regions: ['spine'], az: 75, daz: 20, el: 4, pan: 0.42, zoom: [1, 1] },
  { id: 'thorax', title: 'Rib cage', noun: 'in the thorax', move: 'exploded, orbit', regions: ['thorax'], explode: true, az: 35, daz: -70, el: 14, zoom: [1.05, 0.98] },
  { id: 'pelvis', title: 'Pelvis', noun: 'in the pelvic girdle', move: 'from above', regions: ['pelvis'], az: 0, daz: 45, el: 68, del: -18, zoom: [1.1, 0.95] },
  { id: 'hand-r', title: 'Right hand', noun: 'in the hand', move: 'exploded, push in', regions: ['hand-r'], explode: true, az: -15, daz: 25, el: 12, zoom: [1.25, 0.92] },
  { id: 'hand-l', title: 'Left hand', noun: 'in the hand', move: 'exploded, push in', regions: ['hand-l'], explode: true, az: 15, daz: -25, el: 12, zoom: [1.25, 0.92] },
  { id: 'foot-l', title: 'Left foot', noun: 'in the foot', move: 'exploded, from above', regions: ['foot-l'], explode: true, az: 30, daz: 30, el: 52, del: -12, zoom: [1.2, 0.95] },
  { id: 'foot-r', title: 'Right foot', noun: 'in the foot', move: 'exploded, from above', regions: ['foot-r'], explode: true, az: -30, daz: -30, el: 52, del: -12, zoom: [1.2, 0.95] },
  { id: 'shoulders', title: 'Shoulder girdle', noun: 'in the two shoulders', move: 'from behind', regions: ['shoulder-l', 'shoulder-r'], az: 160, daz: 40, el: 22, zoom: [1.1, 0.97] },
  { id: 'knee', title: 'Knee', noun: 'at the left knee', move: 'orbit of the joint', regions: ['leg-l'], joint: /patella/i, half: 0.13, az: 70, daz: -90, el: 6, zoom: [1.15, 0.95] },
  { id: 'hip', title: 'Hip joints', noun: 'in the pelvis and thighs', move: 'push in', regions: ['pelvis', 'leg-l', 'leg-r'], hip: true, az: 0, daz: 20, el: 10, zoom: [1.2, 0.95] },
];
const WHOLE = [{ mode: 'radial', az: -30, daz: 60, el: 8 }, { mode: 'regional', az: 30, daz: -60, el: 10 }];
// The text boxes of the shell plate in this page's CSS px, and the three
// clear parts round them as insets {l, r, t, b}. Null with no plate on.
function plateClear(w, h) {
  let doc, fr;
  try { doc = window.parent && window.parent !== window ? window.parent.document : null; fr = window.frameElement; } catch (e) { return null; }
  const p = doc && doc.getElementById('sn-saver-label');
  if (!p || !fr || !p.classList.contains('on')) return null;
  const o = fr.getBoundingClientRect(), rg = doc.createRange();
  const box = { x0: Infinity, x1: -Infinity };
  const band = sel => {
    let y0 = Infinity, y1 = -Infinity;
    const host = p.querySelector(sel); if (!host) return null;
    const add = q => { if (q.width < 1 || q.height < 1) return; y0 = Math.min(y0, q.top - o.top); y1 = Math.max(y1, q.bottom - o.top); box.x0 = Math.min(box.x0, q.left - o.left); box.x1 = Math.max(box.x1, q.right - o.left); };
    const walk = n => {
      if (n.nodeType === 3) { if (n.textContent.trim()) { rg.selectNodeContents(n); add(rg.getBoundingClientRect()); } return; }
      if (n.nodeType !== 1 || n.classList.contains('rule') || n.classList.contains('ln')) return;
      if (n.tagName.toLowerCase() === 'svg' || n.classList.contains('logo')) { add(n.getBoundingClientRect()); return; }
      for (const c of n.childNodes) walk(c);
    };
    walk(host);
    return y1 > y0 ? { y0, y1 } : null;
  };
  const top = band('.top'), bot = band('.bot'), m = 14;
  if (!top && !bot) return null;
  const parts = [{ l: 0, r: 0, t: top ? Math.max(0, top.y1 + m) : 0, b: bot ? Math.max(0, h - bot.y0 + m) : 0 }];
  if (box.x0 > 0.18 * w) parts.push({ l: 0, r: Math.max(0, w - box.x0 + m), t: 0, b: 0 });
  if (box.x1 < 0.82 * w) parts.push({ l: Math.max(0, box.x1 + m), r: 0, t: 0, b: 0 });
  return parts;
}
// The half width, half height and depth of a box seen along dir.
const _p = new THREE.Vector3();
function extentOf(lo, hi, dir) {
  const right = new THREE.Vector3(0, 1, 0).cross(dir).normalize(), up = dir.clone().cross(right).normalize();
  const mid = new THREE.Vector3((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
  let hw = 0, hh = 0, hd = 0;
  for (let k = 0; k < 8; k++) {
    _p.set(k & 1 ? hi[0] : lo[0], k & 2 ? hi[1] : lo[1], k & 4 ? hi[2] : lo[2]).sub(mid);
    hw = Math.max(hw, Math.abs(_p.dot(right))); hh = Math.max(hh, Math.abs(_p.dot(up))); hd = Math.max(hd, _p.dot(dir));
  }
  return { mid, hw, hh, hd };
}
// The bones that get a push-in: counted bones of 20 mm or more, no teeth
// or cartilage. The tour takes them a region at a time, so two bones in a
// row are never from the same region.
function saverBones(rnd) {
  const by = new Map();
  for (const b of S.bones) {
    if (!b.counted || b.len < 20 || b.type === 'tooth' || b.type === 'cartilage' || !S.vis[b.i]) continue;
    if (!by.has(b.region)) by.set(b.region, []);
    by.get(b.region).push(b.i);
  }
  const shuf = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  for (const a of by.values()) shuf(a);
  const regs = shuf([...by.keys()]), out = [];
  for (let k = 0, more = true; more; k++) {
    more = false;
    for (const r of regs) { const a = by.get(r); if (k < a.length) { out.push(a[k]); more = true; } }
  }
  return out;
}
// The tour: the full view first, then three bones, a region shot, the full
// view from a new angle, and so on. Every second round also has an
// exploded whole-body shot (WHOLE) after the region shot. az 0 is the front.
function saverTour(rnd) {
  const bones = saverBones(rnd), regs = SHOTS.slice();
  for (let i = regs.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [regs[i], regs[j]] = [regs[j], regs[i]]; }
  const tour = [], turn = rnd() < 0.5 ? 1 : -1;
  const fulls = [{ az: -12 * turn, daz: 24 * turn, el: 6 }, { az: 35, daz: -30, el: 12 }, { az: -35, daz: 30, el: 10 }, { az: 160, daz: 40, el: 14 }];
  let bi = 0, ri = 0, fi = 0;
  while (bi < bones.length) {
    tour.push({ full: fulls[fi++ % fulls.length] });
    for (let k = 0; k < 3 && bi < bones.length; k++) tour.push({ bone: bones[bi++] });
    tour.push({ shot: regs[ri++ % regs.length] });
    if (fi % 2 === 0) tour.push({ whole: WHOLE[(fi / 2 - 1) % WHOLE.length] });
  }
  return tour;
}
// The camera side for bone i, in degrees: outward from the body axis for a
// bone off the midline, from the side for a vertebra, from the front or the
// back for the other midline bones. A seeded turn of up to 35 deg is added,
// and the angle moves by 40 deg when it is near the last one. The feet are
// seen from above. Below the knee the camera stays over the floor.
// A bone shot fits the larger side of the bone box to BONE_FIT of the short
// side of the band. The full view takes the band if the body is FULL_MIN px
// tall or more there.
const BONE_FIT = 0.6, FULL_MIN = 260;
function boneView(i, rnd, last) {
  const b = S.bones[i], [x, , z] = b.c, side = rnd() < 0.5 ? 1 : -1;
  let az;
  if (Math.abs(x) > 0.03) az = Math.atan2(x, Math.max(0.05, z + 0.08)) * 180 / Math.PI;
  else if (b.region === 'spine') az = side * (70 + 40 * rnd());
  else if (b.region === 'skull' || b.region === 'hyoid') az = side * 50 * rnd();
  else az = z >= 0 ? 0 : 180;
  az += (rnd() * 2 - 1) * 35;
  let el = /foot/.test(b.region) ? 35 + 20 * rnd() : /hand/.test(b.region) ? 10 + 25 * rnd() : -4 + 26 * rnd();
  if (/leg|foot|pelvis/.test(b.region)) el = Math.max(6, el);
  if (last) {
    let da = az - last.az; da -= Math.round(da / 360) * 360;
    if (Math.abs(da) < 25 && Math.abs(el - last.el) < 12) az += da >= 0 ? 40 : -40;
  }
  return { az, daz: (rnd() < 0.5 ? 1 : -1) * (18 + 14 * rnd()), el, del: 0, zoom: [1.15, 0.92], glide: 1.5 };
}
window.snSaver = {
  enter(o = {}) {
    const calm = Math.max(0, Math.min(1, o.calm == null ? 0.7 : +o.calm));
    const hold = 5 + 2 * calm, holdLong = 6.5 + 2.5 * calm;
    let seed = (o.seed >>> 0) || 1;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const css = document.createElement('style');
    css.textContent = '#stage{top:0!important}#stage>*:not(#view),body>*:not(#stage){display:none!important}#view{cursor:none!important}';
    document.head.appendChild(css);
    setOpen(false);
    scene.background = saverBackdrop();
    setShow('spin', false);
    // the tour is made when the bones are in (saverTour needs S.vis)
    let tour = null, lastView = null, dur = hold;
    let ti = -1, t = 0, cur = null, lit = [], focusK = 0, focusT = 0, prevFocus = -1, clearT = 0, parts = null;
    const cam = { c: null, d: 0, az: 0, el: 0 };
    const fy = () => Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const label = l => { if (typeof o.label === 'function') try { o.label(l); } catch (e) { /* the plate is optional */ } };
    const setFocus = i => { if (prevFocus >= 0) setHi(prevFocus, 0, 0); prevFocus = i; if (i >= 0) setHi(i, 0, 0.85); };
    // the bone flags: 0 shown, 1 hidden, 2 ghost (see refreshVisibility)
    const ghost = keep => {
      let any = false;
      for (const b of S.bones) { const f = !S.vis[b.i] ? 1 : keep(b) ? 0 : 2; if (f === 2) any = true; S.state.setK(2, b.i, 3, f); }
      for (const g of S.groups.values()) g.ghost.visible = any;
      S.state.dirty(); S.dirty = true;
    };
    const start = () => {
      if (!tour) tour = saverTour(rnd);
      ti = (ti + 1) % tour.length; t = 0; cur = tour[ti];
      dur = cur.shot ? hold : holdLong;
      setFocus(-1);
      if (cur.full) {
        // the primary view: the assembled skeleton, nothing ghosted
        S.mode = S.lastMode = 'radial';
        S.amt.fill(0);
        retargetSaver();
        ghost(() => true);
        lit = []; label(saverPlate(null, 'full', lit, -1));
      } else if (cur.bone != null) {
        const i = cur.bone, b = S.bones[i], reg = S.regions.find(r => r.id === b.region);
        cur.view = boneView(i, rnd, lastView); lastView = cur.view;
        S.mode = S.lastMode = 'radial';
        S.amt.fill(0);
        retargetSaver();
        ghost(q => q.i === i);
        lit = [i]; setFocus(i);
        const name = b.side ? SIDE_NAME[b.side] + ' ' + b.name.toLowerCase() : b.name;
        label(saverPlate({ title: name, noun: `in focus, ${reg ? reg.label.toLowerCase() : b.region}`, move: 'push in' }, null, lit, i));
      } else if (cur.whole) {
        const m = cur.whole.mode;
        S.mode = S.lastMode = m;
        S.amt.fill(1);
        retargetSaver();
        ghost(() => true);
        lit = []; label(saverPlate(null, m, lit, -1));
      } else {
        const sh = cur.shot, want = new Set(sh.regions);
        S.mode = S.lastMode = 'radial';
        S.amt.fill(0);
        if (sh.explode) for (const r of sh.regions) S.amt[S.regionIx.get(r)] = 1;
        retargetSaver();
        ghost(b => want.has(b.region));
        lit = S.bones.filter(b => want.has(b.region) && S.vis[b.i]).map(b => b.i).sort((a, b) => S.bones[b].len - S.bones[a].len);
        // the knee and the hip name the bones at the joint first
        if (sh.joint) lit.sort((a, b) => (sh.joint.test(S.bones[b].name) ? 1 : 0) - (sh.joint.test(S.bones[a].name) ? 1 : 0));
        focusK = 0; focusT = 0; setFocus(lit[0] ?? -1);
        label(saverPlate(sh, null, lit, lit[0] ?? -1));
      }
    };
    // retarget to S.amt without the page's fit flight (the tick frames)
    const retargetSaver = () => { retarget(true, false, false); S.fly = null; };
    // the box that the camera frames now (u = 0..1 through the shot)
    const goal = u => {
      const sh = cur.shot, wh = cur.whole || cur.full, spec = sh || wh || cur.view;
      const az = THREE.MathUtils.degToRad(spec.az + (spec.daz || 0) * u), el = THREE.MathUtils.degToRad(spec.el + (spec.del || 0) * u);
      const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
      const want = sh ? new Set(sh.regions) : null;
      const one = cur.bone != null ? cur.bone : -1;
      const bd = L.bounds(S.P, S.to.off, S.vis, want ? b => want.has(b.region) : one >= 0 ? b => b.i === one : null, true);
      let lo = bd.lo.slice(), hi = bd.hi.slice();
      if (sh && sh.joint) {
        const k = S.bones.find(b => want.has(b.region) && sh.joint.test(b.name));
        if (k) { const c = [0, 1, 2].map(a => k.c[a] + S.to.off[k.i * 3 + a]); lo = c.map(v => v - sh.half); hi = c.map(v => v + sh.half); }
      }
      if (sh && sh.hip) { const pb = L.bounds(S.P, S.to.off, S.vis, b => b.region === 'pelvis', true); lo[1] = pb.lo[1] - 0.12; hi[1] = pb.hi[1]; }
      if (sh && sh.pan) { const H = hi[1] - lo[1], wnd = H * sh.pan, y0 = lo[1] + (H - wnd) * smooth(u); lo[1] = y0; hi[1] = y0 + wnd; }
      const e = extentOf(lo, hi, dir);
      cur.box = { lo, hi };
      const W = canvas.clientWidth || 1, Hc = canvas.clientHeight || 1;
      const z = spec.zoom ? spec.zoom[0] + (spec.zoom[1] - spec.zoom[0]) * smooth(u) : 1.05;
      const all = parts || [{ l: 0, r: 0, t: 0, b: 0 }], band = all[0];
      const size = q => [Math.max(40, W - q.l - q.r), Math.max(40, Hc - q.t - q.b)];
      // A bone: the middle band, with the larger side of the box at 60% of
      // the short side of the band (BONE_FIT), over the near face of the
      // box. The zoom moves it from about 52% to 65% in the hold.
      if (one >= 0) {
        const [cw, ch] = size(band), px = BONE_FIT * Math.min(cw, ch) / 2;
        return { c: e.mid, d: e.hd + Math.max(e.hw, e.hh) * Hc / (2 * fy() * px) * z, az, el, occ: band };
      }
      // The full view: the middle band, the hero shot, when the body fits
      // there at FULL_MIN px tall or more. Else the larger side column.
      let best = band;
      if (cur.full) {
        const [cw, ch] = size(band), tall = Math.min(ch, cw * e.hh / Math.max(1e-6, e.hw)) / 1.08;
        if (tall < FULL_MIN) { let bs = -1; for (const q of all.slice(1)) { const [w2, h2] = size(q), sc = Math.min(w2 / e.hw, h2 / e.hh); if (sc > bs) { bs = sc; best = q; } } }
      } else {
        // a region or whole-body shot: the clear part where the box fits largest
        let bs = -1;
        for (const q of all) { const [w2, h2] = size(q), sc = Math.min(w2 / e.hw, h2 / e.hh); if (sc > bs) { bs = sc; best = q; } }
      }
      const fh = Math.max(0.15, (Hc - best.t - best.b) / Hc), fw = Math.max(0.15, (W - best.l - best.r) / Hc);
      return { c: e.mid, d: (Math.max(e.hh / (fy() * fh), e.hw / (fy() * fw)) * 1.08 * z) + e.hd, az, el, occ: best };
    };
    const smooth = x => x * x * (3 - 2 * x);
    loopHook.tick = dt => {
      if (!S.ready || !T.allBones) return;
      if (!cur) start();
      t += dt; clearT += dt;
      if (clearT > 0.25) { clearT = 0; parts = plateClear(canvas.clientWidth, canvas.clientHeight); }
      if (t >= dur) start();
      // the plate names the next bone of the shot every 2 s
      if (cur.shot && lit.length > 1 && (focusT += dt) > 2) { focusT = 0; focusK++; const f = lit[focusK % lit.length]; setFocus(f); label(saverPlate(cur.shot, null, lit, f)); }
      const g = goal(Math.min(1, t / dur));
      saverOcc.o = g.occ;
      // ease toward the goal: a new shot glides in about 1.2 s, a push-in
      // on a bone in about 2 s
      const k = Math.min(1, dt * (cur.view ? cur.view.glide : 2.6));
      if (!cam.c) { cam.c = g.c.clone(); cam.d = g.d; cam.az = g.az; cam.el = g.el; }
      cam.c.lerp(g.c, k); cam.d += (g.d - cam.d) * k;
      let da = g.az - cam.az; da -= Math.round(da / (2 * Math.PI)) * 2 * Math.PI;
      cam.az += da * k; cam.el += (g.el - cam.el) * k;
      S.fly = null;
      controls.target.copy(cam.c);
      camera.position.set(Math.sin(cam.az) * Math.cos(cam.el), Math.sin(cam.el), Math.cos(cam.az) * Math.cos(cam.el)).multiplyScalar(cam.d).add(cam.c);
      camera.lookAt(cam.c);
      S.dirty = true;
    };
    // the tour state, for the headless probe
    window.snSaver.debug = () => cur && { k: ti, kind: cur.full ? 'full' : cur.bone != null ? 'bone' : cur.shot ? 'region' : 'whole',
      what: cur.bone != null ? S.bones[cur.bone].name : cur.shot ? cur.shot.id : cur.whole ? cur.whole.mode : 'full', t: +t.toFixed(1), dur: +dur.toFixed(1),
      ...frameStats() };
    // the subject box on the screen and the clear part, in canvas CSS px
    const frameStats = () => {
      if (!cur.box) return {};
      const W = canvas.clientWidth, Hc = canvas.clientHeight, { lo, hi } = cur.box, q = new THREE.Vector3();
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let k = 0; k < 8; k++) {
        q.set(k & 1 ? hi[0] : lo[0], k & 2 ? hi[1] : lo[1], k & 4 ? hi[2] : lo[2]).project(camera);
        const x = (q.x + 1) / 2 * W, y = (1 - q.y) / 2 * Hc;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      const o = saverOcc.o || { l: 0, r: 0, t: 0, b: 0 };
      return { box: [x0, y0, x1, y1].map(Math.round), clear: [o.l, o.t, W - o.r, Hc - o.b].map(Math.round), W, H: Hc };
    };
    return { canvas, warmupMs: 3000 };
  },
};

// ── boot ────────────────────────────────────────────────────────────────────
buildUI();
setTheme(S.theme);
requestAnimationFrame(frame);
loadAll().catch(e => { console.error(e); $('loadingText').textContent = 'The skeleton failed to load'; toast(String(e.message || e)); });
