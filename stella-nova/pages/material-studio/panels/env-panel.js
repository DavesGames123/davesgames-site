// ============================================================================
//  MATERIAL STUDIO  ·  panels/env-panel.js — the #env-panel environment and view controls
// ────────────────────────────────────────────────────────────────────────────
//  When env.js has mountPanel, env.js owns the environment part and this
//  module adds only the View section. Otherwise it draws the fallback:
//  presets, .hdr load, lighting and the analytic light editor. envSelf
//  is above zero while this panel writes, so its own edits do not
//  re-render it.
//
//  GREP TARGETS
//      FALLBACK_ENVS envPresets envThumb hashColors setEnvPreset envSelf
//      setEnvSelf setViewSelf envSlider viewSlider renderEnv envHost viewHost
//      envFallback viewSection MESH_LABEL VIEW_LABEL TM_LABEL azElToDir
//      dirToAzEl lightRow envSoftRaf renderEnvSoft envDragging
// ============================================================================
import { MESHES, DEBUG_VIEWS, TONEMAPPERS } from '../contract.js';
import { store, state, M, $ } from './ctx.js';
import { clamp, clone } from './util.js';
import { h, icon, ibtn, pickFiles } from './dom.js';
import { wSlider } from './widgets/slider.js';
import { closePicker } from './widgets/picker.js';
import { wColor } from './widgets/color.js';
import { wEnum, wBool } from './widgets/basic.js';
import { section, envRow } from './rows.js';

const FALLBACK_ENVS = [
  { id: 'studio', label: 'Studio', c: ['#d8dde6', '#3a3f4a'] },
];
export function envPresets() {
  const e = M.env || {};
  let list = e.ENV_PRESETS || e.PRESETS || (typeof e.listPresets === 'function' ? e.listPresets() : null);
  if (list && !Array.isArray(list)) list = Object.entries(list).map(([id, v]) => ({ id, ...(typeof v === 'object' ? v : { label: String(v) }) }));
  return (list && list.length ? list : FALLBACK_ENVS).map(p => typeof p === 'string' ? { id: p, label: p } : p);
}
function envThumb(p) {
  const el = h('i', { class: 'pe-th' });
  const fill = src => { if (src) { el.style.backgroundImage = `url("${src}")`; el.classList.add('img'); } };
  if (p.thumb) fill(p.thumb);
  else if (typeof M.env?.presetThumbnail === 'function') {
    Promise.resolve().then(() => M.env.presetThumbnail(p.id)).then(r => {
      if (!r) return;
      if (typeof r === 'string') fill(r);
      else if (r instanceof HTMLCanvasElement) fill(r.toDataURL());
    }).catch(() => {});
  }
  const c = p.colors || p.c || hashColors(p.id);
  el.style.background = `linear-gradient(180deg, ${c[0]} 0%, ${c[0]} 42%, ${c[1] || c[0]} 58%, ${c[2] || '#0b0d12'} 100%)`;
  return el;
}
export function hashColors(id) {
  let x = 0; for (const ch of String(id)) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  const hu = x % 360;
  return [`hsl(${hu} 40% 72%)`, `hsl(${(hu + 30) % 360} 25% 32%)`, `hsl(${(hu + 50) % 360} 20% 10%)`];
}
function setEnvPreset(id) {
  if (typeof M.env?.setPreset === 'function') {
    Promise.resolve(M.env.setPreset(id)).catch(e => store.toast('Environment failed: ' + (e.message || e), 'error'));
    if (state.env.preset !== id) store.setEnv({ preset: id });
  } else store.setEnv({ preset: id });
}
export let envSelf = 0;
/** Env and view edits from this panel do not re-render it (the widget already shows the value). */
const setEnvSelf = patch => { envSelf++; try { store.setEnv(patch); } finally { envSelf--; } };
const setViewSelf = patch => { envSelf++; try { store.setView(patch); } finally { envSelf--; } };

function envSlider(key, label, min, max, step, scale = 1, title) {
  return envRow(label, wSlider({ id: key, label, kind: 'slider', min, max, step, default: min }, state.env[key] * scale, v => setEnvSelf({ [key]: v / scale })), title);
}
function viewSlider(key, label, min, max, step, title) {
  return envRow(label, wSlider({ id: key, label, kind: 'slider', min, max, step, default: min }, state.view[key], v => setViewSelf({ [key]: v })), title);
}
export function renderEnv() {
  const root = $('env-panel'); if (!root) return;
  closePicker();
  const scroll = root.scrollTop;
  const env = state.env;
  const frag = document.createDocumentFragment();
  // env.js owns the environment controls (probe, presets, Poly Haven, lights)
  // through mountPanel(el). This panel then adds only the View section.
  if (typeof M.env?.mountPanel === 'function' && !envFallback) {
    if (!envHost || !root.contains(envHost)) {
      envHost = h('div', { class: 'pe-env' }); viewHost = h('div', { class: 'pe-view' });
      root.replaceChildren(envHost, viewHost);
      try { M.env.mountPanel(envHost); } catch (e) { console.warn('[panels] env.mountPanel', e); envFallback = true; return renderEnv(); }
    }
    viewHost.replaceChildren(viewSection());
    root.scrollTop = scroll;
    return;
  }
  // presets
  const grid = h('div', { class: 'pe-grid' }, envPresets().map(p => h('button', {
    type: 'button', class: 'pe-p' + (env.preset === p.id ? ' on' : ''), title: p.description || p.label || p.id, onclick: () => setEnvPreset(p.id),
  }, envThumb(p), h('span', null, p.label || p.id))));
  const hdr = h('button', { type: 'button', class: 'pn-btn', onclick: async () => {
    const [f] = await pickFiles('.hdr,.rgbe,image/vnd.radiance');
    if (!f) return;
    if (typeof M.env?.loadHDR !== 'function') { store.toast('HDR loading is not available yet', 'warn'); return; }
    try { await M.env.loadHDR(f); store.toast(`Loaded ${f.name}`, 'ok'); } catch (e) { store.toast('HDR failed: ' + (e.message || e), 'error'); }
  } }, icon('file'), 'Load .hdr…');
  frag.append(section('env-presets', 'Environment', [grid, h('div', { class: 'pn-head-a' }, hdr, h('span', { class: 'pn-sub' }, env.preset && !envPresets().some(p => p.id === env.preset) ? `custom: ${env.preset}` : ''))]));
  frag.append(section('env-light', 'Lighting', [
    envSlider('rotation', 'Rotation', 0, 360, 1, 1, 'HDRI rotation around the up axis, degrees'),
    envSlider('intensity', 'Intensity', 0, 4, 0.01, 1, 'Multiplier on the image-based light'),
    envRow('Background', wEnum({ id: 'background', label: 'Background', kind: 'enum', options: [{ value: 'hdri', label: 'HDRI' }, { value: 'blur', label: 'Blur' }, { value: 'color', label: 'Color' }] }, env.background, v => { store.setEnv({ background: v }); renderEnv(); })),
    env.background === 'blur' ? envSlider('blur', 'Blur', 0, 1, 0.01) : null,
    env.background === 'color' ? envRow('Color', wColor({ id: 'bgColor', label: 'Background' }, env.bgColor, v => setEnvSelf({ bgColor: v }))) : null,
  ]));
  // lights
  const lights = env.lights || [];
  const lrows = lights.map((L, i) => lightRow(L, i));
  const add = type => {
    const L = type === 'dir' ? { type: 'dir', color: '#fff4e0', intensity: 2, az: 45, el: 35, on: true } : { type: 'point', color: '#ffffff', intensity: 4, pos: [1.5, 1.5, 1.5], on: true };
    if (L.type === 'dir') L.dir = azElToDir(L.az, L.el);
    store.setEnv({ lights: [...lights, L] }); renderEnv();
  };
  frag.append(section('env-lights', 'Analytic lights', [
    lrows.length ? lrows : h('div', { class: 'pn-empty' }, 'No analytic lights. The HDRI lights the material alone.'),
    h('div', { class: 'pn-head-a' },
      h('button', { type: 'button', class: 'pn-btn', onclick: () => add('dir') }, icon('sun'), 'Directional'),
      h('button', { type: 'button', class: 'pn-btn', onclick: () => add('point') }, icon('bulb'), 'Point')),
  ], { extra: h('span', { class: 'pn-count' }, String(lights.length)) }));
  frag.append(viewSection());
  root.replaceChildren(frag);
  root.scrollTop = scroll;
}
let envHost = null, viewHost = null, envFallback = false;
/** Viewport controls: mesh, debug view, tonemapper, exposure, toggles. */
function viewSection() {
  const view = state.view;
  const meshGrid = h('div', { class: 'pn-seg wrap' }, MESHES.map(m => h('button', { type: 'button', class: 'pn-seg-b' + (view.mesh === m ? ' on' : ''), onclick: () => { store.setView({ mesh: m }); renderEnv(); } }, MESH_LABEL[m] || m)));
  const dbg = wEnum({ id: 'debug', label: 'Debug view', kind: 'enum', options: DEBUG_VIEWS.map(v => ({ value: v, label: VIEW_LABEL[v] || v })) }, view.debug, v => setViewSelf({ debug: v }));
  const tm = wEnum({ id: 'tonemap', label: 'Tonemapper', kind: 'enum', options: TONEMAPPERS.map(v => ({ value: v, label: TM_LABEL[v] || v })) }, view.tonemap, v => setViewSelf({ tonemap: v }));
  const tog = (key, label, title) => envRow(label, wBool({ label }, view[key], v => setViewSelf({ [key]: v })), title);
  return section('env-view', 'View', [
    h('div', { class: 'pn-prm wide' }, h('label', { class: 'pn-lbl' }, 'Mesh'), h('div', { class: 'pn-ctl' }, meshGrid)),
    envRow('Debug view', dbg), envRow('Tonemapper', tm),
    viewSlider('exposure', 'Exposure (EV)', -6, 6, 0.05),
    viewSlider('uvScale', 'UV scale', 0.25, 8, 0.05, 'Repeat the baked maps on the mesh'),
    tog('parallax', 'Parallax', 'Parallax occlusion from the height map'),
    tog('displacement', 'Displacement', 'Move vertices by the height map'),
    view.displacement ? envRow('Subdivision', wSlider({ id: 'subdiv', label: 'Subdivision', kind: 'int', min: 16, max: 512, step: 16, default: 128 }, view.subdiv, v => setViewSelf({ subdiv: v }))) : null,
    tog('wireframe', 'Wireframe'), tog('autoRotate', 'Auto rotate'),
  ]);
}
const MESH_LABEL = { sphere: 'Sphere', cube: 'Cube', roundedCube: 'Rounded', plane: 'Plane', cylinder: 'Cylinder', torus: 'Torus', shaderBall: 'Shader ball' };
const VIEW_LABEL = { lit: 'Lit', albedo: 'Base color', opacity: 'Opacity', normal: 'Normal (tangent)', worldNormal: 'Normal (world)', ao: 'AO', roughness: 'Roughness', metallic: 'Metallic', height: 'Height', emissive: 'Emissive', clearcoat: 'Clearcoat', sheen: 'Sheen', anisotropy: 'Anisotropy', uv: 'UV', diffuseOnly: 'Diffuse only', specularOnly: 'Specular only' };
const TM_LABEL = { aces: 'ACES', agx: 'AgX', khronosNeutral: 'Khronos PBR Neutral', reinhard: 'Reinhard', filmic: 'Filmic', linear: 'Linear (clip)' };
export function azElToDir(az, el) {
  const a = az * Math.PI / 180, e = el * Math.PI / 180;
  return [+(Math.cos(e) * Math.sin(a)).toFixed(4), +Math.sin(e).toFixed(4), +(Math.cos(e) * Math.cos(a)).toFixed(4)];
}
export function dirToAzEl(d) {
  const [x, y, z] = d || [0, 1, 0]; const l = Math.hypot(x, y, z) || 1;
  return [((Math.atan2(x, z) * 180 / Math.PI) + 360) % 360, Math.asin(clamp(y / l, -1, 1)) * 180 / Math.PI];
}
function lightRow(L, i) {
  const upd = (patch, rerender) => {
    const lights = state.env.lights.map((x, j) => j === i ? { ...x, ...patch } : x);
    const n = lights[i];
    if (n.type === 'dir' && ('az' in patch || 'el' in patch)) n.dir = azElToDir(n.az ?? 0, n.el ?? 45);
    setEnvSelf({ lights });
    if (rerender) renderEnv();
  };
  if (L.type === 'dir' && (L.az == null || L.el == null)) { const [a, e] = dirToAzEl(L.dir); L.az = Math.round(a); L.el = Math.round(e); }
  const on = L.on !== false;
  const head = h('div', { class: 'lt-h' },
    wBool({ label: 'Light on' }, on, v => upd({ on: v })).el,
    h('b', null, `${L.type === 'dir' ? 'Directional' : 'Point'} ${i + 1}`),
    h('span', { class: 'pn-sp' }),
    ibtn('copy', 'Duplicate the light', () => { store.setEnv({ lights: [...state.env.lights, clone(L)] }); renderEnv(); }),
    ibtn('trash', 'Remove the light', () => { store.setEnv({ lights: state.env.lights.filter((_, j) => j !== i) }); renderEnv(); }));
  const rows = [
    envRow('Color', wColor({ label: 'Light' }, L.color || '#ffffff', v => upd({ color: v }))),
    envRow('Intensity', wSlider({ label: 'Intensity', kind: 'slider', min: 0, max: 20, step: 0.05, default: 1 }, L.intensity ?? 1, v => upd({ intensity: v }))),
  ];
  if (L.type === 'dir') {
    rows.push(envRow('Azimuth', wSlider({ label: 'Azimuth', kind: 'slider', min: 0, max: 360, step: 1, default: 0 }, L.az, v => upd({ az: v }))));
    rows.push(envRow('Elevation', wSlider({ label: 'Elevation', kind: 'slider', min: -90, max: 90, step: 1, default: 45 }, L.el, v => upd({ el: v }))));
  } else {
    const pos = L.pos || [1, 1, 1];
    ['X', 'Y', 'Z'].forEach((ax, k) => rows.push(envRow('Pos ' + ax, wSlider({ label: ax, kind: 'slider', min: -5, max: 5, step: 0.01, default: 0 }, pos[k], v => { const p = [...(state.env.lights[i].pos || pos)]; p[k] = v; upd({ pos: p }); }))));
    rows.push(envRow('Range', wSlider({ label: 'Range', kind: 'slider', min: 0, max: 20, step: 0.1, default: 0 }, L.range ?? 0, v => upd({ range: v }), 'Zero: inverse-square falloff with no cutoff')));
  }
  return h('div', { class: 'lt' + (on ? '' : ' off') }, head, rows);
}

let envSoftRaf = 0;
export function renderEnvSoft() { if (envSoftRaf) return; envSoftRaf = requestAnimationFrame(() => { envSoftRaf = 0; renderEnv(); }); }
export const envDragging = () => document.body.classList.contains('pn-scrubbing') || !!document.querySelector('#env-panel .pn-bar:active');
