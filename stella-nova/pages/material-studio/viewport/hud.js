// ============================================================================
//  MATERIAL STUDIO  ·  viewport/hud.js — the viewport HUD: bar, settings panel, stats
// ────────────────────────────────────────────────────────────────────────────
//  Builds the HUD markup in #vp-hud and binds its events. A control with
//  data-k writes state.view through store.setView, and a "key.i" data-k
//  writes one item of an array. syncHud() writes state.view back into the
//  controls. The HUD also holds the compare divider, the .obj drop target
//  and the stats line.
//
//  GREP TARGETS
//      SUBDIV_OPTIONS ......... mesh density choices
//      hudEls ................. the HUD elements that other code changes
//      buildHud ............... markup, input / click events, drop, divider
//      fmtOut ................. the text of a slider value
//      syncHud ................ state.view into the controls
//      placeDivider ........... divider and A/B label position
//      updateStats ............ the stats line (tris, maps, env, fps, ms)
// ============================================================================
import * as C from '../contract.js';
import { MESH_LABELS } from '../mesh.js';
import { VIEWPORT_DEBUG_VIEWS, DEBUG_LABELS, TONEMAP_LABELS, store, state, canvas, wrap, hud, cam, R, clamp } from './state.js';
import { pinA, useTestMaps } from './material.js';
import { loadOBJFile } from './preview-mesh.js';
import { saveScreenshot } from './offscreen.js';

const SUBDIV_OPTIONS = [32, 64, 96, 128, 192, 256, 384, 512];

let hudEls = {};
function opt(v, l) { return `<option value="${v}">${l}</option>`; }

export function buildHud() {
  hud.innerHTML = `
<div class="vp-bar">
  <select data-k="mesh" title="Preview mesh" aria-label="Preview mesh">${C.MESHES.map(m => opt(m, MESH_LABELS[m] || m)).join('')}${opt('custom', MESH_LABELS.custom)}</select>
  <select data-k="debug" title="View: lit or one channel" aria-label="Debug view">${VIEWPORT_DEBUG_VIEWS.map(v => opt(v, DEBUG_LABELS[v] || v)).join('')}</select>
  <select data-k="tonemap" class="vp-hide-s" title="Tonemapper" aria-label="Tonemapper">${C.TONEMAPPERS.map(t => opt(t, TONEMAP_LABELS[t] || t)).join('')}</select>
  <label class="vp-ev" title="Exposure (EV)"><span>EV</span><input type="range" data-k="exposure" min="-6" max="6" step="0.1"><output data-out="exposure"></output></label>
  <button type="button" data-act="frame" title="Frame the mesh (F, double-click)">Frame</button>
  <button type="button" data-tog="autoRotate" title="Turntable">Turn</button>
  <button type="button" data-tog="wireframe" class="vp-hide-s" title="Wireframe overlay">Wire</button>
  <button type="button" data-act="more" aria-expanded="false" title="All viewport settings">View</button>
</div>
<div class="vp-more" hidden>
  <div class="vp-sec">Camera &amp; display</div>
  <label>FOV<input type="range" data-k="fov" min="10" max="100" step="1"><output data-out="fov"></output></label>
  <label>Tonemap<select data-k="tonemap">${C.TONEMAPPERS.map(t => opt(t, TONEMAP_LABELS[t] || t)).join('')}</select></label>
  <label>Background<select data-k="background">${opt('env', 'Environment')}${opt('solid', 'Solid color')}${opt('checker', 'Checker')}${opt('gradient', 'Gradient')}</select></label>
  <label>Anti-alias<select data-k="aa">${opt('msaa', 'MSAA 4x')}${opt('fxaa', 'FXAA')}${opt('both', 'MSAA + FXAA')}${opt('off', 'Off')}</select></label>
  <label>Compare<select data-k="compare">${opt('off', 'Off')}${opt('prev', 'A = previous bake')}${opt('pinned', 'A = pinned')}</select></label>
  <div class="vp-row"><button type="button" data-act="pin" title="Copy the current maps into side A">Pin A</button><button type="button" data-act="testmaps" title="Show synthetic test maps until the next bake">Test maps</button></div>
  <div class="vp-sec">Surface</div>
  <label>UV scale<input type="range" data-k="uvScale" min="0.25" max="16" step="0.25"><output data-out="uvScale"></output></label>
  <label>UV offset U<input type="range" data-k="uvOffset.0" min="-1" max="1" step="0.01"><output data-out="uvOffset.0"></output></label>
  <label>UV offset V<input type="range" data-k="uvOffset.1" min="-1" max="1" step="0.01"><output data-out="uvOffset.1"></output></label>
  <label>Normal str.<input type="range" data-k="normalStrength" min="0" max="3" step="0.05"><output data-out="normalStrength"></output></label>
  <label class="vp-chk"><input type="checkbox" data-k="flipGreen">Flip green (DirectX map)</label>
  <label>Aniso rot.<input type="range" data-k="anisoRotation" min="-180" max="180" step="1"><output data-out="anisoRotation"></output></label>
  <label>Sheen rough.<input type="range" data-k="sheenRoughness" min="0.07" max="1" step="0.01"><output data-out="sheenRoughness"></output></label>
  <label>Spec. occl.<input type="range" data-k="specOcclusion" min="0" max="1" step="0.05"><output data-out="specOcclusion"></output></label>
  <div class="vp-sec">Height</div>
  <label class="vp-chk"><input type="checkbox" data-k="parallax">Parallax occlusion</label>
  <label>POM depth ×<input type="range" data-k="parallaxScale" min="0" max="4" step="0.05"><output data-out="parallaxScale"></output></label>
  <label>POM steps<input type="range" data-k="pomSteps" min="4" max="64" step="1"><output data-out="pomSteps"></output></label>
  <label class="vp-chk"><input type="checkbox" data-k="displacement">Displace vertices</label>
  <label>Mesh density<select data-k="subdiv" data-num>${SUBDIV_OPTIONS.map(n => opt(n, n)).join('')}</select></label>
  <div class="vp-sec">Stage</div>
  <label class="vp-chk"><input type="checkbox" data-k="ground">Ground shadow</label>
  <label class="vp-chk"><input type="checkbox" data-k="grid">Grid</label>
  <label class="vp-chk"><input type="checkbox" data-k="shadows">Key light shadows</label>
  <label>Shadow str.<input type="range" data-k="shadowStrength" min="0" max="1" step="0.05"><output data-out="shadowStrength"></output></label>
  <label class="vp-chk"><input type="checkbox" data-k="wireframe">Wireframe</label>
  <div class="vp-row">
    <button type="button" data-act="obj" title="Load a Wavefront .obj mesh (or drop it on the viewport)">Load .obj</button>
    <button type="button" data-act="shot" title="Save a PNG of the viewport">PNG</button>
    <button type="button" data-act="reset" title="Reset the camera (R)">Reset cam</button>
  </div>
  <div class="vp-help">Drag orbit · right/Ctrl drag pan · wheel/pinch zoom · Shift drag turns the environment · double-click frames</div>
  <input type="file" accept=".obj,text/plain" data-file hidden>
</div>
<div class="vp-ab" hidden><span class="vp-a">A</span><span class="vp-b">B · current</span></div>
<div class="vp-divider" hidden role="separator" aria-label="Compare split" tabindex="0"></div>
<div class="vp-stats" aria-live="off"></div>
<div class="vp-drop" hidden>Drop an .obj file to preview it</div>
<div class="vp-nogpu-msg">WebGPU is not available: the 3D preview is off.</div>`;
  hudEls = {
    more: hud.querySelector('.vp-more'), moreBtn: hud.querySelector('[data-act=more]'), stats: hud.querySelector('.vp-stats'),
    divider: hud.querySelector('.vp-divider'), ab: hud.querySelector('.vp-ab'), drop: hud.querySelector('.vp-drop'),
    file: hud.querySelector('[data-file]'),
  };

  const readVal = el => {
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'range' || el.dataset.num !== undefined) return +el.value;
    return el.value;
  };
  const apply = (el, merge) => {
    const k = el.dataset.k;
    const val = readVal(el);
    if (k.includes('.')) {
      const [a, i] = k.split('.');
      const arr = Array.isArray(state.view[a]) ? [...state.view[a]] : [0, 0];
      arr[+i] = val;
      store.setView({ [a]: arr });
    } else store.setView({ [k]: val });
  };
  hud.addEventListener('input', e => { const el = e.target.closest('[data-k]'); if (el && el.type === 'range') apply(el); });
  hud.addEventListener('change', e => { const el = e.target.closest('[data-k]'); if (el) apply(el); });
  hud.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tog) { store.setView({ [b.dataset.tog]: !state.view[b.dataset.tog] }); return; }
    switch (b.dataset.act) {
      case 'frame': cam && cam.frame(); break;
      case 'reset': cam && cam.reset(); break;
      case 'more': {
        const open = hudEls.more.hidden;
        hudEls.more.hidden = !open; b.setAttribute('aria-expanded', String(open)); b.classList.toggle('on', open);
        break;
      }
      case 'pin': pinA(); break;
      case 'testmaps': useTestMaps(); break;
      case 'obj': hudEls.file.click(); break;
      case 'shot': saveScreenshot(); break;
      default: break;
    }
  });
  hudEls.file.addEventListener('change', () => { const f = hudEls.file.files[0]; if (f) loadOBJFile(f); hudEls.file.value = ''; });
  // a click on the canvas closes the settings panel
  canvas.addEventListener('pointerdown', () => { if (!hudEls.more.hidden) { hudEls.more.hidden = true; hudEls.moreBtn.classList.remove('on'); hudEls.moreBtn.setAttribute('aria-expanded', 'false'); } });

  // drag and drop .obj
  let dragDepth = 0;
  wrap.addEventListener('dragenter', e => { if (hasFiles(e)) { dragDepth++; hudEls.drop.hidden = false; e.preventDefault(); } });
  wrap.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  wrap.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) hudEls.drop.hidden = true; });
  wrap.addEventListener('drop', e => {
    dragDepth = 0; hudEls.drop.hidden = true;
    const f = [...(e.dataTransfer?.files || [])].find(x => /\.obj$/i.test(x.name));
    if (!f) return;
    e.preventDefault(); e.stopPropagation();
    loadOBJFile(f);
  });

  // compare divider
  const dv = hudEls.divider;
  let dragging = false;
  dv.addEventListener('pointerdown', e => { dragging = true; dv.setPointerCapture(e.pointerId); e.preventDefault(); });
  dv.addEventListener('pointermove', e => {
    if (!dragging) return;
    const r = wrap.getBoundingClientRect();
    store.setView({ compareSplit: clamp((e.clientX - r.left) / r.width, 0.02, 0.98) });
  });
  const end = () => { dragging = false; };
  dv.addEventListener('pointerup', end); dv.addEventListener('pointercancel', end);
  dv.addEventListener('keydown', e => {
    const s = +state.view.compareSplit || 0.5;
    if (e.key === 'ArrowLeft') store.setView({ compareSplit: clamp(s - 0.02, 0.02, 0.98) });
    else if (e.key === 'ArrowRight') store.setView({ compareSplit: clamp(s + 0.02, 0.02, 0.98) });
  });
}
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');

function fmtOut(k, v) {
  if (k === 'exposure') return (v >= 0 ? '+' : '') + (+v).toFixed(1);
  if (k === 'fov' || k === 'anisoRotation' || k === 'pomSteps') return Math.round(v) + (k === 'pomSteps' ? '' : '°');
  return (+v).toFixed(2);
}

export function syncHud() {
  if (!hud) return;
  const v = state.view;
  for (const el of hud.querySelectorAll('[data-k]')) {
    const k = el.dataset.k;
    let val;
    if (k.includes('.')) { const [a, i] = k.split('.'); val = Array.isArray(v[a]) ? v[a][+i] : 0; }
    else val = v[k];
    if (el.type === 'checkbox') el.checked = !!val;
    else if (document.activeElement !== el || el.tagName === 'SELECT') el.value = String(val ?? '');
  }
  for (const o of hud.querySelectorAll('[data-out]')) {
    const k = o.dataset.out;
    const val = k.includes('.') ? (v[k.split('.')[0]] || [])[+k.split('.')[1]] : v[k];
    o.textContent = fmtOut(k, +val || 0);
  }
  for (const b of hud.querySelectorAll('[data-tog]')) b.classList.toggle('on', !!v[b.dataset.tog]);
  const cmp = v.compare !== 'off';
  hudEls.divider.hidden = !cmp; hudEls.ab.hidden = !cmp;
  if (cmp) {
    hudEls.ab.querySelector('.vp-a').textContent = v.compare === 'prev' ? 'A · previous bake' : 'A · pinned';
    placeDivider();
  }
  const meshSel = hud.querySelector('select[data-k=mesh]');
  if (meshSel) meshSel.querySelector('option[value=custom]').disabled = !R.custom;
}

export function placeDivider() {
  if (!hudEls.divider) return;
  const s = clamp(+state.view.compareSplit || 0.5, 0, 1);
  hudEls.divider.style.left = (s * 100).toFixed(3) + '%';
  hudEls.ab.style.setProperty('--split', (s * 100).toFixed(3) + '%');
}

export function updateStats() {
  if (!hudEls.stats) return;
  const m = R.mesh, cur = R.cur;
  const parts = [];
  if (m) parts.push(`${m.triangles.toLocaleString()} tris`);
  if (cur) parts.push(cur === R.def ? 'no bake yet' : cur === R.test ? `test maps ${cur.res}²` : `maps ${cur.res}²`);
  if (R.baking) parts.push('baking…');
  parts.push(R.env ? (R.env.kind === 'lib' ? 'env ' + ((R.env.b.source && R.env.b.source.label) || 'IBL') : R.env.kind === 'tex' ? 'IBL' : 'studio sky') : 'studio sky');
  if (R.fps) parts.push(`${R.fps.toFixed(0)} fps`);
  parts.push(`${R.frameMs.toFixed(1)} ms cpu`);
  const txt = parts.join(' · ');
  if (hudEls.stats.textContent !== txt) hudEls.stats.textContent = txt;
}
