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
//    function saverPlate                             screensaver plate: layout, region, bone in focus
//    // ── boot                                     start the page
// ============================================================================
import * as THREE from 'three';
import { $, TYPE_NAME, SIDE_NAME, MODE_NAME } from './app/env.js';
import { canvas, camera, controls, scene } from './app/stage.js';
import { T, S, toast } from './app/state.js';
import { fitView } from './app/camera.js';
import { pickAt } from './app/pick.js';
import { loadAll } from './app/load.js';
import { setMode, explode, reconstruct, setAmount, toggleRegionExplode } from './app/layouts.js';
import { boneCentre, select, clearSelection, step, setHi } from './app/select.js';
import { isolate, exitIsolate, focusBone, focusRegion } from './app/inspect.js';
import { setRegionHidden } from './app/list.js';
import { setOpen } from './app/panel.js';
import { setTheme, setShow, buildUI } from './app/controls.js';
import { frame } from './app/loop.js';

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
// DOM but the canvas, paints the gallery backdrop into the scene (the canvas
// is transparent), and turns the spin on at 0.38 to 0.86 of its speed (calm
// 1 to 0). The tour has one beat per seconds/4 (8 s or more), in a loop of
// three beats: explode (radial and regional in turn), fly to one seeded
// region and glow its bones, reconstruct. The fits keep the spin angle. Moves and flights take 1.5 to 2.5
// times longer. Nothing goes to localStorage or the URL.
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
// The screensaver plate (opts.label), from the manifest (S.M). beat is
// 'open', 'region' or 'closed'. In a region beat, lit holds the glowing
// bones and focus is the one that the plate names (name, Latin name,
// type, side, length and the fact of the card). Else the plate counts the
// bones in each body group.
function saverPlate(beat, rid, lit, focus) {
  if (!S.M) return null;
  const counted = S.bones.filter(b => b.counted).length;
  const teeth = S.bones.filter(b => b.type === 'tooth').length, cart = S.bones.filter(b => b.type === 'cartilage').length;
  const ear = S.regions.find(r => r.id === 'ear');
  const total = `${counted} counted bones · ${teeth} teeth · ${cart} costal cartilages` + (ear && ear.count < ear.expected ? ` (the ${ear.expected} ear ossicles are not in the set)` : '');
  if (beat === 'region') {
    const reg = S.regions.find(r => r.id === rid) || { label: rid };
    const grp = S.M.groups.find(g => g.id === reg.group);
    const types = {};
    for (const i of lit) { const t = S.bones[i].type; types[t] = (types[t] || 0) + 1; }
    const lines = [`${lit.length} pieces: ` + Object.keys(types).map(t => `${TYPE_NAME[t]} ${types[t]}`).join(' · ')];
    const b = S.bones[focus];
    if (b) {
      lines.push(`In focus: ${b.side ? SIDE_NAME[b.side].toLowerCase() + ' ' + b.name.toLowerCase() : b.name} (${b.latin})`);
      lines.push(`${TYPE_NAME[b.type]} · ${b.len >= 100 ? Math.round(b.len) : b.len.toFixed(1)} mm` + (b.fma ? ` · FMA ${b.fma}` : ''));
      if (b.fact) lines.push(b.fact);
    }
    return { title: reg.label, sub: `Human skeleton · ${grp ? grp.label : ''}`, lines };
  }
  const per = S.M.groups.filter(g => g.id !== 'cartilage').map(g => `${g.label} ${S.bones.filter(b => b.group === g.id && b.counted).length}`);
  return { title: beat === 'open' ? `Human skeleton · ${MODE_NAME[S.mode] || 'Exploded'}` : 'Human skeleton', sub: beat === 'open' ? 'Exploded view' : 'Assembled',
    lines: [total, per.slice(0, 4).join(' · '), per.slice(4).join(' · ')] };
}
window.snSaver = {
  enter(o = {}) {
    const calm = Math.max(0, Math.min(1, o.calm == null ? 0.7 : +o.calm));
    const beat = Math.max(8, (+o.seconds || 60) / 4), pace = 1.5 + calm;
    let seed = (o.seed >>> 0) || 1;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const css = document.createElement('style');
    css.textContent = '#stage{top:0!important}#stage>*:not(#view),body>*:not(#stage){display:none!important}#view{cursor:none!important}';
    document.head.appendChild(css);
    setOpen(false);
    scene.background = saverBackdrop();
    controls.autoRotateSpeed = 0.8 * (0.38 + 0.48 * (1 - calm));
    setShow('spin', true);
    const regions = ['skull', 'thorax', 'hand-r', 'foot-l', 'pelvis', 'spine', 'hand-l', 'foot-r'];
    for (let i = regions.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [regions[i], regions[j]] = [regions[j], regions[i]]; }
    let k = 0, lit = [];
    const glow = v => { for (const i of lit) setHi(i, 0, v); };
    // stretch the transition and the flight that the last call started; a
    // fit (keepDir) keeps the spin angle and does not swing back to the front
    const slow = keepDir => {
      if (S.tr && S.tr.t === 0) { S.tr.dur *= pace; S.tr.end *= pace; for (let i = 0; i < S.n; i++) S.delay[i] *= pace; }
      if (S.fly && S.fly.t === 0) { S.fly.dur *= pace; if (keepDir) S.fly.u1 = null; }
    };
    // the plate: one per beat; in a region beat the bone in focus steps
    // through the lit bones, largest first, every 3 s with the same title
    let pBeat = '', pRid = '', order = [], fk = 0;
    const plate = () => {
      if (typeof o.label !== 'function') return;
      try { o.label(saverPlate(pBeat, pRid, lit, order.length ? order[fk % order.length] : -1)); } catch (e) { /* the plate is optional */ }
    };
    setInterval(() => { if (pBeat === 'region' && order.length > 1) { fk++; plate(); } }, 3000);
    const stepBeat = () => {
      if (!S.ready || !T.allBones) return;
      const phase = k % 3;
      if (phase === 0) { setMode(k % 6 === 0 ? 'radial' : 'regional'); pBeat = 'open'; }
      else if (phase === 1) {
        const rid = regions[(k / 3 | 0) % regions.length];
        const want = rid === 'skull' ? new Set(['skull', 'teeth', 'hyoid', 'ear']) : new Set([rid]);
        lit = S.bones.filter(b => want.has(b.region) && S.vis[b.i]).map(b => b.i);
        glow(1);
        focusRegion(rid);
        pBeat = 'region'; pRid = rid; order = lit.slice().sort((a, b) => S.bones[b].len - S.bones[a].len); fk = 0;
      } else { glow(0); lit = []; reconstruct(); pBeat = 'closed'; order = []; }
      slow(phase !== 1); k++;
      plate();
    };
    setTimeout(() => { stepBeat(); setInterval(stepBeat, beat * 1000); }, 4000);
    return { canvas, warmupMs: 3000 };
  },
};

// ── boot ────────────────────────────────────────────────────────────────────
buildUI();
setTheme(S.theme);
requestAnimationFrame(frame);
loadAll().catch(e => { console.error(e); $('loadingText').textContent = 'The skeleton failed to load'; toast(String(e.message || e)); });
