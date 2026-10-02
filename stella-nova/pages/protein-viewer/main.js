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
import { isPolymer } from './app/state.js';
import { frame } from './app/loop.js';

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
// hides all DOM but canvas#view, spins the camera slowly and plays a seeded
// order of local presets that show the whole molecule (no focus, so no fly
// to a pocket). Each change fades the molecule into the background in the
// composite pass (post.fade), so the recorded canvas has no hard cut. The
// presets come from data/; fetchId (network) is never called. S.saver stops
// the URL hash write in loadPreset. No exit(): the shell reloads the page.
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

const SAVER_LIST = ['rhodopsin', 'ubiquitin', 'tim', 'deoxyhb', 'gb1', 'adkopen', 'bdna', 'afp53', 'crambin', 'villin'];
window.snSaver = {
  enter(o = {}) {
    const calm = Math.max(0, Math.min(1, o.calm ?? 0.7));
    const secs = Math.max(20, +o.seconds || 60);
    S.saver = true;
    setOpen(false);
    const st = document.createElement('style');
    st.textContent = 'body>*:not(#stage),#stage>*:not(#view){display:none!important}' +
      '#stage{top:0!important;bottom:0!important;right:0!important;left:0!important}#view{cursor:none!important}';
    document.head.appendChild(st);
    window.dispatchEvent(new Event('resize'));
    controls.autoRotateSpeed = 1.1 * (0.25 + 0.35 * (1 - calm));
    S.spin = true;
    // seeded order of the list (an LCG and a shuffle)
    let r = (o.seed >>> 0) || 1;
    const rnd = () => (r = (r * 1664525 + 1013904223) >>> 0) / 4294967296;
    const order = SAVER_LIST.slice();
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const hold = Math.max(10, secs / 3) * 1000, fadeS = 0.8 + 1.2 * calm;
    const fadeTo = to => new Promise(res => {
      const from = post.fade, t0 = performance.now();
      const step = now => {
        const k = Math.min(1, (now - t0) / (fadeS * 1000));
        post.fade = from + (to - from) * (k * k * (3 - 2 * k));
        S.dirty = true;
        if (k < 1) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
    const plate = () => { if (typeof o.label === 'function') { try { o.label(saverPlate()); } catch (e) { /* the plate is optional */ } } };
    let n = 0;
    const next = async () => {
      await fadeTo(1);
      await loadPreset(order[n++ % order.length]);
      plate();
      await new Promise(res => setTimeout(res, 300));
      await fadeTo(0);
      setTimeout(next, hold);
    };
    // start on a fresh molecule from the faded state
    post.fade = 1; S.dirty = true;
    (async () => { await loadPreset(order[n++ % order.length]); plate(); await new Promise(res => setTimeout(res, 300)); await fadeTo(0); setTimeout(next, hold); })();
    return { canvas, warmupMs: 2500 };
  },
};
