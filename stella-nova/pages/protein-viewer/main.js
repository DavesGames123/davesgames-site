// ============================================================================
//  PROTEIN VIEWER  ·  main.js — boot
// ────────────────────────────────────────────────────────────────────────────
//  One structure at a time. Loading (preset, ID, file or paste) gives a
//  parse.js model. setStructure() centres it, turns its principal axes to
//  the screen (the long axis across, or up on a portrait screen), and
//  builds the layers in the `mol` group. A colour or highlight change only
//  repaints the layers. A rep, filter or chain change rebuilds them.
//
//  This file only boots the page. stage.js must stay the first app import:
//  it throws when WebGL 2 is missing, before any listener is installed.
//  The other modules are in app/, one concern per file:
//    env.js       DOM lookup, device queries, text helpers
//    state.js     the state S, dirty(), residue helpers
//    stage.js     renderer, scene, camera, materials, orbit controls
//    feedback.js  toast, loading veil, hint
//    structure.js setStructure, principal-axis frame
//    load.js      presets, IDs, files, paste, drop
//    layers.js    the mesh layers of the rep, the stick overlay
//    paint.js     colours and surface opacity
//    pick.js      ray picking, 5 Å neighbours
//    select.js    the selection
//    card.js      the residue card
//    measure.js   distance, angle, dihedral
//    labels.js    HTML labels on the 3D view
//    strip.js     the sequence strip
//    pointer.js   canvas tap, double tap, hover
//    camera.js    clear area, framing, fly-to
//    panel.js     panel and phone sheet
//    ui.js        panel controls, dock, keys
//    loop.js      render loop, teardown
//    xr.js        VR and AR view (lib/xr-view.js); index.html loads it
//
//  GREP MAP
//    window.__pv                           debug and headless hooks
//    boot                                  buildUI, syncUI, first preset, loop
//    window.snSaver                        screensaver hook (lib/screensaver.js)
//    function saverPlate                   screensaver plate: name, PDB id, counts, formula, ss
//    function moleculeAnchor               the shown residues on screen, for the plate leader
//    function saverFeatures                helices, strands, pockets, disulfides, low-pLDDT tails
//    function shotAnchor                   one feature on screen, for the plate leader
// ============================================================================
import * as THREE from 'three';
import { PRESETS, byId } from './presets.js';
import { camera, canvas, controls, post } from './app/stage.js';
import { S } from './app/state.js';
import { resolveSel } from './app/structure.js';
import { fetchId, loadPreset } from './app/load.js';
import { pickAt } from './app/pick.js';
import { clearSelection, select } from './app/select.js';
import { addMeasureAtom, setMeasure } from './app/measure.js';
import { focusSelection, resetView } from './app/camera.js';
import { setOpen } from './app/panel.js';
import { buildUI, setColor, setRep, syncUI } from './app/ui.js';
import { isPolymer, ADDITIVES } from './app/state.js';
import { paint } from './app/paint.js';
import { frame } from './app/loop.js';
import { ease } from './app/env.js';

// debug and headless checks
window.__pv = { S, loadPreset, select, clearSelection, setRep, setColor, setMeasure, addMeasureAtom, pickAt, resolveSel, camera, controls, PRESETS, setOpen, focusSelection, resetView, fetchId };

// ── boot ──────────────────────────────────────────────────────────────────
buildUI();
syncUI();
const start = decodeURIComponent((location.hash || '').slice(1));
loadPreset(byId(start) ? start : 'rhodopsin');
requestAnimationFrame(frame);

// ── screensaver ───────────────────────────────────────────────────────────
// Hook for the shell screensaver (lib/screensaver.js). It closes the panel,
// hides all DOM but canvas#view and plays a seeded order of the local
// presets (one per PDB entry, the three large assemblies left out). Each
// structure gets a calm inspection tour. The overview holds 6 to 9 s and
// a feature 4.5 to 6.5 s (calm 0 to 1). Moves ease over 2.5 to 3.5 s, and
// the spin is about 2 deg/s (half of that on a feature):
//   1 overview ... the whole fold from a seeded direction, slow spin
//   2 feature .... a push-in to a feature that saverFeatures finds in the
//                  data: a ligand pocket, a disulfide, a low-pLDDT tail, a
//                  beta sheet or a helix bundle. S.hl dims the rest. No
//                  feature, no push-in: the overview holds longer.
//   3 fly-along .. on half the structures (seeded): the camera turns to
//                  the side of one helix or strand from its current
//                  direction, then moves slowly along the run axis
//   4 pull-back .. a fade, a change of representation, and the overview
// The seed also picks the colour scheme and the first representation. Each
// change of structure fades the molecule into the background in the
// composite pass (post.fade). The presets come from data/; fetchId
// (network) is never called. S.saver stops the URL hash write in
// loadPreset. No exit(): the shell reloads the page.
// The screensaver plate (opts.label) for the loaded structure. All counts
// come from S.s and the chains that the preset shows (S.chainOn): chains
// with a polymer, polymer residues, atoms, the element counts of the
// polymer atoms as a formula, and the helix / strand / coil share of the
// protein residues (ss from the file records, or from ss.js when computed).
const SUB = n => String(n).replace(/[0-9]/g, d => '₀₁₂₃₄₅₆₇₈₉'[d]);
function saverPlate() {
  const s = S.s, p = S.preset;
  if (!s) return null;
  const on = ci => !S.chainOn || S.chainOn[ci];
  let chains = 0, chainsAll = 0;
  s.chains.forEach((c, ci) => {
    if (!c.residues.some(ri => isPolymer(s.residues[ri]))) return;
    chainsAll++; if (on(ci)) chains++;
  });
  let nRes = 0, nProt = 0, helix = 0, strand = 0, nAtom = 0;
  const el = {};
  for (const r of s.residues) {
    if (!isPolymer(r) || !on(r.chain)) continue;
    nRes++;
    if (r.kind === 'protein') { nProt++; if (r.ss === 'H' || r.ss === 'G') helix++; else if (r.ss === 'E') strand++; }
    for (const ai of r.atoms) { const e = s.atoms[ai].el; el[e] = (el[e] || 0) + 1; nAtom++; }
  }
  const order = ['C', 'H', 'N', 'O', 'P', 'S', 'SE'];
  const nm = e => e === 'SE' ? 'Se' : e;
  const formula = order.filter(e => el[e]).map(e => nm(e) + SUB(el[e])).join(' ');
  const other = Object.keys(el).filter(e => !order.includes(e)).reduce((k, e) => k + el[e], 0);
  const fmt = n => n.toLocaleString('en-US');
  const id = p ? p.code : (s.meta.id || s.meta.name || '');
  const meth = (s.meta.method || '').toLowerCase().replace(/^x-ray diffraction$/, 'X-ray').replace(/^solution nmr$/, 'NMR').replace(/^electron microscopy$/, 'cryo-EM');
  const src = s.meta.af ? 'AlphaFold model' : [meth, s.meta.resolution ? s.meta.resolution.toFixed(1) + ' Å' : ''].filter(Boolean).join(' ');
  // Parameters: the counts and the secondary structure. The page has no
  // equation colours, so the plate has no rules. The TeX is the H-bond
  // energy of ss.js (Kabsch and Sander), which assigns the helix and strand
  // share when the file has no records.
  const params = [
    { sym: 'N_{\\mathrm{res}}', name: `${chains} ${chains === 1 ? 'chain' : 'chains'}` + (chainsAll > chains ? ` of ${chainsAll}` : ''), value: fmt(nRes) },
    { sym: 'N_{\\mathrm{atom}}', name: el.H ? 'atoms' : 'heavy atoms, no H', value: fmt(nAtom) },
  ];
  if (nProt) {
    const pc = k => Math.round(100 * k / nProt);
    params.push({ sym: '\\alpha', name: 'helix' + (s.ssSource === 'computed' ? ', from H-bonds' : ''), value: pc(helix) + '%' },
      { sym: '\\beta', name: 'strand', value: pc(strand) + '%' });
  }
  const lines = [formula + (other ? ` + ${other} other` : '')];
  if (p && p.why) lines.push(p.why);
  return { title: p ? p.title : (s.meta.name || 'Structure'), sub: [id ? 'PDB ' + id : '', src].filter(Boolean).join(' · '), params, lines,
    tex: [String.raw`E=0.084\cdot 332\,\Bigl(\frac{1}{r_{ON}}+\frac{1}{r_{CH}}-\frac{1}{r_{OH}}-\frac{1}{r_{CN}}\Bigr)\ \text{kcal/mol}`,
      String.raw`E<-0.5\ \text{kcal/mol}\ \Longrightarrow\ \text{H-bond}\ \ \mathrm{C{=}O}_i\cdots\mathrm{H{-}N}_j`],
    rules: [], anchor: moleculeAnchor };
}
// The molecule on screen, for the plate leader: one atom per shown polymer
// residue (S.wpos, the turned positions) through the camera to page px.
// The centre is their mean; the radius holds all of them plus 12 px for the
// cartoon width (a 90% radius let the plate cover a helix end). The key
// points are the two chain ends of the first chain and the residue nearest
// the centre.
function moleculeAnchor() {
  const s = S.s; if (!s || !S.wpos) return null;
  const b = canvas.getBoundingClientRect(), v = new THREE.Vector3(), q = [];
  for (const r of s.residues) {
    if (!isPolymer(r) || (S.chainOn && !S.chainOn[r.chain]) || !r.atoms.length) continue;
    const i = r.atoms[Math.min(1, r.atoms.length - 1)];
    v.set(S.wpos[3 * i], S.wpos[3 * i + 1], S.wpos[3 * i + 2]).project(camera);
    if (v.z < 1) q.push({ x: b.left + (v.x + 1) / 2 * b.width, y: b.top + (1 - v.y) / 2 * b.height, c: r.chain });
  }
  if (!q.length) return null;
  let x = 0, y = 0; for (const p of q) { x += p.x; y += p.y; } x /= q.length; y /= q.length;
  const d = q.map(p => Math.hypot(p.x - x, p.y - y)), ds = d.slice().sort((m, n) => m - n);
  let c = 0; for (let k = 1; k < q.length; k++) if (d[k] < d[c]) c = k;
  const first = q.filter(p => p.c === q[0].c);
  return { x, y, r: ds[ds.length - 1] + 12, pts: [first[0], first[first.length - 1], q[c]].map(p => ({ x: p.x, y: p.y })) };
}

// Features of the loaded structure, from secondary structure, het groups,
// SG-SG distance and pLDDT. Each is { kind, res (residue indices), sub }.
// Runs: helices of 7 or more residues, strands of 4 or more, numbered from
// the N-terminus of the shown chains.
function saverFeatures() {
  const s = S.s, on = r => !S.chainOn || S.chainOn[r.chain];
  const runs = [], F = [];
  let cur = null;
  for (const r of s.residues) {
    const k = r.kind === 'protein' && on(r) ? (r.ss === 'H' || r.ss === 'G' ? 'H' : r.ss === 'E' ? 'E' : '') : '';
    if (cur && (k !== cur.k || r.chain !== cur.chain)) { runs.push(cur); cur = null; }
    if (k && !cur) cur = { k, chain: r.chain, res: [] };
    if (cur) cur.res.push(r.index);
  }
  if (cur) runs.push(cur);
  const label = r => `${s.chains[r.chain].id || ''}${r.seq}`;
  const span = res => `residues ${label(s.residues[res[0]])}–${label(s.residues[res[res.length - 1]])}`;
  let hn = 0, en = 0;
  const helices = [], strands = [];
  for (const u of runs) {
    if (u.k === 'H' && u.res.length >= 7) helices.push({ kind: 'helix', res: u.res, sub: `Helix ${++hn}, ${span(u.res)}` });
    if (u.k === 'E' && u.res.length >= 4) strands.push({ kind: 'strand', res: u.res, sub: `Strand ${++en}, ${span(u.res)}` });
  }
  const P = i => [S.wpos[3 * i], S.wpos[3 * i + 1], S.wpos[3 * i + 2]];
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  // a ligand pocket: the het group and the polymer residues within 5 Å
  const ligs = s.residues.filter(r => r.kind === 'ligand' && on(r) && !ADDITIVES.has(r.name) && r.atoms.length >= 6);
  for (const L of ligs.slice(0, 3)) {
    const la = L.atoms.map(P), res = [L.index];
    for (const r of s.residues) if (isPolymer(r) && on(r) && r.atoms.some(i => { const q = P(i); return la.some(a => d2(a, q) < 25); })) res.push(r.index);
    F.push({ kind: 'pocket', res, sub: `${L.name} pocket, ${res.length - 1} residues within 5 Å` });
  }
  // disulfides: SG to SG under 2.5 Å
  const sg = s.residues.filter(r => r.name === 'CYS' && on(r) && r.map.SG != null);
  const ss = [];
  for (let a = 0; a < sg.length; a++) for (let b = a + 1; b < sg.length; b++) if (d2(P(sg[a].map.SG), P(sg[b].map.SG)) < 6.25) ss.push([sg[a].index, sg[b].index]);
  if (ss.length) F.push({ kind: 'disulfide', res: ss.flat(), sub: `${ss.length} disulfide ${ss.length === 1 ? 'bond' : 'bonds'}, Cys ${ss.map(p => p.map(i => label(s.residues[i])).join('–')).join(', ')}` });
  // a low-confidence run in an AlphaFold model: pLDDT < 50, 6 or more residues
  if (s.meta.af) {
    let run = [];
    const flush = () => { if (run.length >= 6) F.push({ kind: 'tail', res: run, sub: `Low-confidence region, pLDDT < 50, ${span(run)}` }); run = []; };
    for (const r of s.residues) { if (r.kind === 'protein' && on(r) && r.ca >= 0 && s.atoms[r.ca].b < 50) run.push(r.index); else flush(); }
    flush();
  }
  if (strands.length >= 3) F.push({ kind: 'sheet', res: strands.flatMap(u => u.res), sub: `β-sheet, ${strands.length} strands` });
  if (helices.length >= 3) {
    const top = helices.slice().sort((a, b) => b.res.length - a.res.length).slice(0, 3);
    F.push({ kind: 'bundle', res: top.flatMap(u => u.res), sub: `Helix bundle: ${top.map(u => u.sub.split(',')[0]).join(', ')}` });
  }
  if (!F.length && helices.length) F.push(helices.slice().sort((a, b) => b.res.length - a.res.length)[0]);
  return { features: F, runs: helices.concat(strands) };
}
// One feature on screen for the plate leader: the anchor atoms of its
// residues through the camera, as moleculeAnchor does for the molecule.
function shotAnchor(res) {
  const s = S.s; if (!s || !S.wpos) return null;
  const b = canvas.getBoundingClientRect(), v = new THREE.Vector3(), q = [];
  for (const ri of res) {
    const r = s.residues[ri], i = r.ca >= 0 ? r.ca : r.atoms[0];
    if (i == null) continue;
    v.set(S.wpos[3 * i], S.wpos[3 * i + 1], S.wpos[3 * i + 2]).project(camera);
    if (v.z < 1) q.push({ x: b.left + (v.x + 1) / 2 * b.width, y: b.top + (1 - v.y) / 2 * b.height });
  }
  if (!q.length) return null;
  let x = 0, y = 0; for (const p of q) { x += p.x; y += p.y; } x /= q.length; y /= q.length;
  const r = Math.max(...q.map(p => Math.hypot(p.x - x, p.y - y))) + 12;
  return { x, y, r, pts: [q[0], q[q.length - 1]] };
}
const centreOf = res => {
  const c = new THREE.Vector3(); let n = 0;
  for (const ri of res) for (const i of S.s.residues[ri].atoms) { c.x += S.wpos[3 * i]; c.y += S.wpos[3 * i + 1]; c.z += S.wpos[3 * i + 2]; n++; }
  return n ? c.multiplyScalar(1 / n) : S.bound.c.clone();
};
const radiusOf = (res, c) => {
  let r = 0;
  for (const ri of res) for (const i of S.s.residues[ri].atoms) r = Math.max(r, Math.hypot(S.wpos[3 * i] - c.x, S.wpos[3 * i + 1] - c.y, S.wpos[3 * i + 2] - c.z));
  return r;
};

const SAVER_SKIP = new Set(['spike', 'groel', 'nucleosome']);
const SAVER_COLORS = ['rainbow', 'ss', 'chain', 'hydro', 'residue'];
window.snSaver = {
  enter(o = {}) {
    const calm = Math.max(0, Math.min(1, o.calm ?? 0.7));
    S.saver = true;
    setOpen(false);
    const st = document.createElement('style');
    st.textContent = 'body>*:not(#stage),#stage>*:not(#view){display:none!important}' +
      '#stage{top:0!important;bottom:0!important;right:0!important;left:0!important}#view{cursor:none!important}';
    document.head.appendChild(st);
    window.dispatchEvent(new Event('resize'));
    const spinK = 1.1 * (0.25 + 0.35 * (1 - calm));
    controls.autoRotateSpeed = spinK;
    // seeded order of one preset per PDB entry (an LCG and a shuffle)
    let r = (o.seed >>> 0) || 1;
    const rnd = () => (r = (r * 1664525 + 1013904223) >>> 0) / 4294967296;
    const pick = a => a[Math.floor(rnd() * a.length)];
    const seen = new Set(), order = [];
    for (const p of PRESETS) if (!SAVER_SKIP.has(p.id) && !seen.has(p.code)) { seen.add(p.code); order.push(p.id); }
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const HOLD_ALL = (6 + 3 * calm) * 1000, HOLD = (4.5 + 2 * calm) * 1000, MOVE = 2.5 + calm, fadeS = 0.6 + 0.6 * calm;
    const wait = ms => new Promise(res => setTimeout(res, ms));
    const fadeTo = (to, sec = fadeS) => new Promise(res => {
      const from = post.fade, t0 = performance.now();
      const step = now => {
        const k = Math.min(1, (now - t0) / (sec * 1000));
        post.fade = from + (to - from) * (k * k * (3 - 2 * k));
        S.dirty = true;
        if (k < 1) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
    // the move of app/camera.js flyTo: target and distance ease, the view
    // direction stays (loop.js runs S.fly)
    const fly = (t1, d1, dur = MOVE) => { S.fly = { t: 0, dur, t0: controls.target.clone(), t1: t1.clone(), d0: camera.position.distanceTo(controls.target), d1 }; S.dirty = true; return wait(dur * 1000); };
    const fit = rad => rad / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * 1.08;
    // a seeded view direction round the target, at distance d
    const aim = d => {
      const az = 6.2832 * rnd(), el = -0.4 + 0.9 * rnd();
      camera.position.copy(controls.target).add(new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).multiplyScalar(d));
      camera.lookAt(controls.target); controls.update(); S.dirty = true;
    };
    let shot = { sub: '', res: null };
    const plate = () => {
      if (typeof o.label !== 'function') return;
      try {
        const info = saverPlate(); if (!info) return;
        if (shot.sub) { info.sub = shot.sub; info.lines = [shot.line || info.sub].concat(info.lines.slice(0, 1)); }
        if (shot.res) { const res = shot.res; info.anchor = () => shotAnchor(res); }
        o.label(info);
      } catch (e) { /* the plate is optional */ }
    };
    const setShot = (sub, res, line) => { shot = { sub, res, line }; S.hl = res ? new Set(res) : null; paint(); plate(); };
    // The camera turns from its current direction to the side of one helix
    // or strand (MOVE seconds for each 30 deg), then moves along the run axis over dur
    // seconds. The axis is a line from the mean of the first 4 CA to the
    // mean of the last 4 CA: the CA of a helix go round its axis at 2.3 A,
    // and a target on the CA makes the camera wobble at each residue.
    const flyAlong = (res, dur) => new Promise(done => {
      const s = S.s, pts = res.map(ri => s.residues[ri]).filter(q => q.ca >= 0).map(q => new THREE.Vector3(S.wpos[3 * q.ca], S.wpos[3 * q.ca + 1], S.wpos[3 * q.ca + 2]));
      if (pts.length < 4) { done(); return; }
      const mean = a => a.reduce((m, p) => m.add(p), new THREE.Vector3()).multiplyScalar(1 / a.length);
      const a0 = mean(pts.slice(0, 4)), a1 = mean(pts.slice(-4)), len = a0.distanceTo(a1);
      const axis = a1.clone().sub(a0).normalize();
      // the side direction nearest to the current view direction
      const dir0 = camera.position.clone().sub(controls.target).normalize();
      let side = dir0.clone().addScaledVector(axis, -dir0.dot(axis));
      if (side.lengthSq() < 1e-3) side = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(0, 1, 0));
      if (side.lengthSq() < 1e-3) side = new THREE.Vector3(1, 0, 0);
      side.normalize();
      // the entry takes MOVE s for each 30 deg of turn, so a smoothstep
      // peak stays near 15 deg/s
      const enter = MOVE * Math.max(1, Math.acos(Math.min(1, dir0.dot(side))) * 180 / Math.PI / 30);
      // side on at 1.4 run lengths (30 A or more), so the run and its
      // neighbours stay in view; the walk covers the middle 60 % of the run
      const d = Math.max(30, 1.4 * len), d0 = camera.position.distanceTo(controls.target), tg0 = controls.target.clone();
      const p0 = a0.clone().lerp(a1, 0.2), p1 = a0.clone().lerp(a1, 0.8);
      S.spin = false; S.fly = null;
      const t0 = performance.now(), dir = new THREE.Vector3();
      const step = now => {
        const t = (now - t0) / 1000;
        if (t < enter) {
          const k = ease(t / enter);
          controls.target.lerpVectors(tg0, p0, k);
          dir.copy(dir0).lerp(side, k).normalize();
          camera.position.copy(controls.target).addScaledVector(dir, d0 + (d - d0) * k);
        } else {
          const k = ease(Math.min(1, (t - enter) / dur));
          controls.target.lerpVectors(p0, p1, k);
          camera.position.copy(controls.target).addScaledVector(side, d);
        }
        camera.lookAt(controls.target); S.dirty = true;
        if (t < enter + dur) requestAnimationFrame(step); else done();
      };
      requestAnimationFrame(step);
    });
    let n = 0;
    const tour = async () => {
      const id = order[n++ % order.length];
      await loadPreset(id);
      const s = S.s; if (!s) return;
      const atoms = s.atoms.length, small = atoms < 3000;
      const reps = small ? ['cartoon', 'cartoon', 'ballstick', 'licorice', 'trace'] : ['cartoon', 'cartoon', 'trace'];
      const rep0 = s.residues.some(q => q.kind === 'protein') ? pick(reps) : S.rep;
      const cols = s.meta.af ? ['plddt', 'plddt', ...SAVER_COLORS] : SAVER_COLORS;
      if (rep0 !== S.rep) setRep(rep0);
      setColor(pick(cols));
      const { features, runs } = saverFeatures();
      // 1 overview
      S.fly = null; controls.target.copy(S.bound.c);
      const dAll = fit(S.bound.r);
      aim(dAll * 1.12);
      S.spin = true;
      setShot('', null);
      await wait(250); await fadeTo(0);
      await fly(S.bound.c, dAll, MOVE);
      await wait(HOLD_ALL);
      // 2 feature
      const f = features.length ? pick(features) : null;
      if (f) {
        const c = centreOf(f.res), rad = Math.max(8, radiusOf(f.res, c));
        setShot(f.sub, f.res);
        controls.autoRotateSpeed = spinK * 0.5;
        await fly(c, fit(rad) * 1.15);
        await wait(HOLD);
        controls.autoRotateSpeed = spinK;
      } else await wait(HOLD);
      // 3 fly-along
      const along = runs.filter(u => !f || u !== f);
      const u = along.length && rnd() < 0.5 ? pick(along) : null;
      if (u) {
        setShot(`Along ${u.sub[0].toLowerCase()}${u.sub.slice(1)}`, u.res);
        await flyAlong(u.res, HOLD / 1000);
      }
      // 4 pull-back with a change of representation
      const other = (small ? ['surface', 'ballstick', 'cartoon', 'spacefill'] : atoms < 6000 ? ['surface', 'cartoon', 'trace'] : ['cartoon', 'trace']).filter(q => q !== S.rep);
      const rep1 = s.residues.some(q => q.kind === 'protein') ? pick(other) : S.rep;
      await fadeTo(0.85, 0.35);
      if (rep1 !== S.rep) setRep(rep1);
      setShot('', null);
      S.spin = true;
      fadeTo(0, 0.6);
      await fly(S.bound.c, dAll * 1.05);
      await wait(HOLD_ALL);
      await fadeTo(1);
    };
    // start on a fresh molecule from the faded state
    post.fade = 1; S.dirty = true;
    (async () => { for (;;) { try { await tour(); } catch (e) { await fadeTo(1); } } })();
    return { canvas, warmupMs: 2500 };
  },
};
