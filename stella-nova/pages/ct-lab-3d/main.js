// ============================================================================
//  CT LAB 3D  ·  main.js — the page: objects, scan, reconstruction, explore
// ----------------------------------------------------------------------------
//  Flow: pick an object (data/objects.json, lib/objects.js) -> build its
//  volume at the chosen voxel count -> SCAN (lib/session.js projects views
//  on the CPU with the chosen physics, a few per frame, into view3d's
//  projections so the gantry and detector move) -> RECONSTRUCT (FDK on the
//  GPU through view3d.reconstructStep, or FDK on the CPU without WebGPU, or
//  SIRT in worker.js) -> LOOK (3D view of the reconstruction, linked slices).
//
//  The 3D view is ../ct-lab/view3d (README.md); without WebGPU the page draws
//  slice previews with drawSlices2D and still scans and reconstructs on the
//  CPU at 64^3. The slice explorer (lib/slices.js) works in both cases.
//
//  State that a link can carry: #obj=<id>&views=&det=&dose=&kvp=&poly=&n=&alg=
//  window.__ct3d exposes the page for the screensaver (saver.js) and tests.
//
//  grep handles: function boot, function selectObject, function startScan,
//    function frame, function finishRecon, function drawSlices, function bindSlices,
//    function exportSlices, function exportVolume, function readHash, window.__ct3d
// ============================================================================
import * as CM from '../ct-lab/colormaps/maps.js';
import { createPicker } from '../ct-lab/colormaps/picker.js';
import { loadManifest, loadCodes, toVolume, presetsFor, huOf, resample } from './lib/objects.js';
import { createSession, makeGeometry } from './lib/session.js';
import { VIEWS, sliceOf, cursorFromPixel, crosshair, obliqueOf, diffOf, distanceCm, valueAt } from './lib/slices.js';
import { drawSlices2D } from '../ct-lab/view3d/fallback.js';
import './saver.js';

const $ = (id) => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:760px), (max-height:520px) and (pointer:coarse)');
const phone = () => PHONE_Q.matches;
const DATA = new URL('data/', import.meta.url);
const DOSES = [[1e3, '1k photons'], [4e3, '4k photons'], [1.6e4, '16k photons'], [6.4e4, '64k photons'], [2.6e5, '256k photons'], [Infinity, 'no noise']];
const WINDOWS = [['auto', 'Auto'], ['soft', 'Soft'], ['dense', 'Dense'], ['full', 'Full']];

const S = {
  objects: [], entry: null, codes: new Map(), truth: null, recon: null, session: null,
  device: null, view: null, gpu: false, phase: 'idle', playing: true, gen: 0,
  settings: { nViews: 180, detector: 1, doseIdx: 5, kVp: 120, poly: false, n: 128, alg: 'fdk', filter: 'shepp-logan' },
  cursor: { ix: 64, iy: 64, iz: 64 }, source: 'recon', win: 'auto', slab: 0, measure: null, measuring: false,
  cmap: { id: 'bone', reverse: false, gamma: 1 }, cdiff: { id: 'berlin', reverse: false, gamma: 1 },
  presets: null, preset: 'everything', mode: 'dvr', show: 'auto', cut: true, obl: { yaw: 30, pitch: 20 },
  worker: null, sirtIter: 0, metrics: null, saver: false,
};

// ── boot ────────────────────────────────────────────────────────────────────
async function boot() {
  readHash();
  if (phone() && S.settings.n > 96) S.settings.n = 96;
  bindPanel(); bindLook(); bindSlices(); bindDock(); bindKeys();
  try { S.objects = await loadManifest(DATA); } catch (e) { phaseText('The object list did not load: ' + e.message); return; }
  drawGallery();
  await initGpu();
  const want = S.objects.find((o) => o.id === S.wantObj) || S.objects[0];
  await selectObject(want.id);
  requestAnimationFrame(frame);
}

async function initGpu() {
  if (!navigator.gpu) { noGpu('This browser has no WebGPU, so the 3D view is off. The scan and the slices run on the CPU at 64³.'); return; }
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('no adapter');
    S.device = await adapter.requestDevice();
    S.device.lost.then((i) => { if (i.reason !== 'destroyed') { S.view = null; S.device = null; S.gpu = false; noGpu('The GPU device was lost. Reload the page to get the 3D view back.'); } });
    S.gpu = true;
    $('backend').textContent = 'WebGPU'; $('backend').classList.add('gpu');
  } catch (e) { noGpu('WebGPU did not give a device here, so the 3D view is off. The scan and the slices run on the CPU at 64³.'); }
}
function noGpu(msg) {
  S.gpu = false; S.settings.n = 64;
  $('v3Note').hidden = false; $('v3Note').textContent = msg;
  $('cv3d').hidden = true; $('look3d').hidden = true;
  $('backend').textContent = 'CPU'; $('backend').classList.remove('gpu');
  markSeg('segN', 'n', 64);
  document.querySelectorAll('#segN button').forEach((b) => { b.disabled = +b.dataset.n > 64; });
}

addEventListener('pagehide', () => {
  stopWorker();
  try { S.view && S.view.destroy(); } catch (e) { /* gone */ }
  try { S.device && S.device.destroy(); } catch (e) { /* gone */ }
  S.view = null; S.device = null;
});

// ── gallery ─────────────────────────────────────────────────────────────────
function drawGallery() {
  const host = $('objList'); host.innerHTML = '';
  for (const o of S.objects) {
    const b = document.createElement('button');
    b.className = 'ocard'; b.dataset.id = o.id;
    const real = o.kind === 'volume';
    b.innerHTML = `<img alt="" loading="lazy" src="${new URL(o.id + '.jpg', DATA)}"><span><b>${esc(o.name)}</b><small>${real ? 'real CT scan' : 'model, voxelized'}<span class="tag ${real ? 'real' : ''}">${esc(o.credit.licence)}</span></small></span>`;
    b.onclick = () => { selectObject(o.id); closeSheets(); };
    host.appendChild(b);
  }
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── object + scan ───────────────────────────────────────────────────────────
async function selectObject(id) {
  const entry = S.objects.find((o) => o.id === id); if (!entry) return;
  const gen = ++S.gen;
  stopWorker();
  S.entry = entry; S.recon = null; S.metrics = null;
  document.querySelectorAll('.ocard').forEach((c) => c.classList.toggle('on', c.dataset.id === id));
  $('objName').textContent = entry.name; $('objBlurb').textContent = entry.blurb;
  const c = entry.credit;
  $('objCredit').innerHTML = `${esc(c.author)}. Licence ${esc(c.licence)}. <a href="${esc(c.source)}" target="_blank" rel="noopener">Source</a>. ${esc(c.changes)}`;
  phaseText(`Loading ${entry.name}…`); prog(0);
  let codes = S.codes.get(id);
  if (!codes) {
    try { codes = await loadCodes(entry, DATA); } catch (e) { phaseText('The object did not load: ' + e.message); return; }
    if (gen !== S.gen) return;
    S.codes.set(id, codes);
  }
  S.presets = presetsFor(entry);
  if (!S.presets[S.preset]) S.preset = 'everything';
  drawPresetSeg(); drawWinSeg();
  writeHash();
  startScan();
}

function startScan() {
  const entry = S.entry; if (!entry) return;
  stopWorker();
  const st = S.settings, n = S.gpu ? st.n : 64;
  S.truth = toVolume(entry, S.codes.get(entry.id), n);
  S.recon = null; S.metrics = null; S.sirtIter = 0;
  const geom = makeGeometry(S.truth, st.nViews, st.detector);
  if (S.gpu && S.device) {
    const preset = S.presets[S.preset];
    if (!S.view) {
      return import('../ct-lab/view3d/index.js').then((m) => {
        try {
          S.view = m.createView3D($('cv3d'), S.device, {
            volume: S.truth, preset, geom, nAngles: st.nViews, n, mode: S.mode, interactive: true,
            dprCap: phone() ? 1.5 : 2, steps: phone() ? 160 : 256, colormap: S.cmap.id,
            colormapOpts: { reverse: S.cmap.reverse, gamma: S.cmap.gamma }, tfFromMap: false,
          });
        } catch (e) { noGpu('The 3D view failed to start: ' + (e && e.message) + '. The slices still work.'); }
        startScan();
      });
    }
    S.view.setPreset(preset);
    S.view.setVolume(S.truth, { geom, window: preset.window });
    S.view.setShow({ gantry: true, rays: true, table: true, detector: true, volume: 'phantom' });
    S.view.setMode(S.mode); S.view.setCutaway(S.cut);
    S.view.setCamera({ dist: 9.5, pitch: 0.28, autoRotate: 0.1 });
  }
  S.session = createSession(entry, S.truth, {
    nViews: st.nViews, detector: st.detector, dose: DOSES[st.doseIdx][0], kVp: st.kVp, poly: st.poly,
    seed: 7, filter: st.filter, geom, out: S.view && S.gpu ? S.view.projections : undefined,
  });
  S.cursor = { ix: S.truth.nx >> 1, iy: S.truth.ny >> 1, iz: S.truth.nz >> 1 };
  setDepthRanges();
  S.phase = 'scan'; S.playing = true; $('btnPlay').textContent = 'Pause';
  scanNote();
  drawSlices(); drawFallback(S.truth);
}
// Without WebGPU: a Canvas 2D preview in the 3D frame (three slices and a MIP).
function drawFallback(vol) {
  if (S.gpu || !vol) return;
  const fb = $('fb3d'); fb.hidden = false;
  fb.width = 4 * 200 + 18; fb.height = 200;
  try { drawSlices2D(fb.getContext('2d'), vol, { colormap: S.cmap.id }); } catch (e) { /* the preview is optional */ }
}

// ── frame loop ──────────────────────────────────────────────────────────────
let last = 0, reconBusy = false;
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, last ? (t - last) / 1000 : 1 / 60); last = t;
  if (S.saver) return;   // saver.js draws its own frames
  const s = S.session;
  if (s && S.playing) {
    if (S.phase === 'scan') {
      const t0 = performance.now(), budget = phone() ? 8 : 12;
      while (s.scanned < s.total && performance.now() - t0 < budget) s.scan(1);
      if (S.view) S.view.setScanned(s.scanned);
      phaseText(`Cone-beam scan · view ${s.scanned} of ${s.total}${S.settings.poly ? ` · ${S.settings.kVp} kVp spectrum` : ''}${Number.isFinite(DOSES[S.settings.doseIdx][0]) ? ' · ' + DOSES[S.settings.doseIdx][1] : ''}`);
      prog(s.scanned / s.total * 0.5);
      if (s.scanned >= s.total) beginRecon();
    } else if (S.phase === 'recon' && S.settings.alg === 'fdk' && !reconBusy) {
      reconStep();
    }
  }
  if (S.view) { try { S.view.render({ dt }); } catch (e) { noGpu('The 3D view stopped: ' + (e && e.message)); S.view = null; } }
}

function beginRecon() {
  S.phase = 'recon';
  if (S.view) S.view.setShow({ rays: false, volume: S.show === 'phantom' ? 'phantom' : 'auto' });
  if (S.settings.alg === 'sirt') startSirt();
}

async function reconStep() {
  const s = S.session, gen = S.gen;
  reconBusy = true;
  try {
    if (S.view && S.gpu) {
      const r = await S.view.reconstructStep({ views: 12, filter: S.settings.filter });
      if (gen !== S.gen || s !== S.session) return;
      phaseText(`FDK reconstruction on the GPU · ${r.done} of ${r.total} views back-projected`);
      prog(0.5 + 0.5 * r.done / r.total);
      if (r.done >= r.total) {
        const rec = S.view.recon, out = new Float32Array(rec.data.length), k = rec.scale || 1;
        for (let i = 0; i < out.length; i++) out[i] = rec.data[i] * k;
        finishRecon({ ...dimsOf(S.truth), data: out });
      }
    } else {
      const r = s.fdkStep(phone() ? 4 : 8);
      phaseText(`FDK reconstruction on the CPU · ${r.done} of ${r.total} views`);
      prog(0.5 + 0.5 * r.done / r.total);
      if (r.done % 24 === 0 || r.done >= r.total) { S.recon = r.volume; drawSlices(); }
      if (r.done >= r.total) finishRecon(r.volume);
    }
  } catch (e) {
    console.warn('ct3d: recon', e); phaseText('The reconstruction stopped: ' + (e && e.message));
  } finally { reconBusy = false; }
}
const dimsOf = (v) => ({ nx: v.nx, ny: v.ny, nz: v.nz, width: v.width });

function startSirt() {
  stopWorker();
  const st = S.settings, nS = Math.min(S.truth.nx, phone() ? 48 : 72), it = 10;
  let w;
  try { w = new Worker(new URL('worker.js', import.meta.url), { type: 'module' }); } catch (e) { S.settings.alg = 'fdk'; markSeg('segAlg', 'alg', 'fdk'); return; }
  S.worker = w;
  const codes = S.codes.get(S.entry.id).slice();
  w.postMessage({ entry: S.entry, codes, n: nS, iterations: it, settings: { nViews: Math.min(st.nViews, 120), detector: st.detector, dose: DOSES[st.doseIdx][0], kVp: st.kVp, poly: st.poly, seed: 7 } }, [codes.buffer]);
  phaseText(`SIRT on the CPU at ${nS}³ · scanning in the worker`);
  w.onmessage = (e) => {
    const m = e.data; if (w !== S.worker) return;
    if (m.error) { phaseText('SIRT stopped: ' + m.error); return; }
    if (m.done) { finishRecon(S.recon); stopWorker(); return; }
    S.sirtIter = m.iter;
    const [sx, sy, sz] = m.dims, up = resample(m.data, sx, sy, sz, S.truth.nx);
    S.recon = { ...dimsOf(S.truth), data: up };
    if (S.view) { try { S.view.setVolume(S.recon, { as: 'recon' }); } catch (err) { /* size mismatch: keep the phantom */ } }
    phaseText(`SIRT iteration ${m.iter} of ${it} · residual ${m.residual.toFixed(2)} · ${sx}³ upsampled`);
    prog(0.5 + 0.5 * m.iter / it);
    drawSlices();
  };
}
function stopWorker() { if (S.worker) { try { S.worker.postMessage('stop'); S.worker.terminate(); } catch (e) { /* gone */ } S.worker = null; } }

function finishRecon(vol) {
  if (!vol) return;
  S.recon = vol; S.phase = 'look';
  S.metrics = S.session.metrics(vol);
  if (S.view) {
    S.view.setShow({ gantry: false, rays: false, table: false, detector: false, volume: S.show === 'phantom' ? 'phantom' : 'auto' });
    S.view.setCamera({ dist: 2.7, autoRotate: 0.16 });
  }
  phaseText(`${S.settings.alg === 'sirt' ? `SIRT, ${S.sirtIter} iterations` : 'FDK done'} · ${S.truth.nx}³ voxels · PSNR ${S.metrics.psnr.toFixed(1)} dB against the object · drag to turn, scroll the slices`);
  prog(1);
  drawFallback(vol);
  $('metrics').textContent = `Reconstruction against the object: RMSE ${S.metrics.rmse.toFixed(4)} /cm, PSNR ${S.metrics.psnr.toFixed(1)} dB. Voxel ${(S.truth.width / S.truth.nx * 10).toFixed(2)} mm.`;
  drawSlices();
}

// ── slices ──────────────────────────────────────────────────────────────────
const CANVAS = { axial: 'slAxial', coronal: 'slCoronal', sagittal: 'slSagittal', oblique: 'slOblique' };
function sourceVol() {
  if (S.source === 'truth' || !S.recon) return S.truth;
  if (S.source === 'diff') return diffOf(S.recon, S.truth);
  return S.recon;
}
function windowOf() {
  const P = S.presets || {}, top = P.everything ? P.everything.window[1] : S.entry.muMax;
  if (S.source === 'diff') { const m = Math.max(0.02, top * 0.25); return [-m, m]; }
  if (S.win === 'soft' && P.soft) return P.soft.window;
  if (S.win === 'dense') return (P.metal || P.bone || P.everything).window;
  if (S.win === 'full') return [0, S.entry.muMax];
  return [0, top];
}
// a slab: the max over +-k slices along the view's depth axis (MIP slab)
function slabSlice(vol, view, c) {
  const k = S.slab, base = sliceOf(vol, view, c);
  if (!k) return base;
  const key = view === 'axial' ? 'iz' : view === 'coronal' ? 'iy' : 'ix';
  for (let d = -k; d <= k; d++) {
    if (!d) continue;
    const s = sliceOf(vol, view, { ...c, [key]: c[key] + d }).data;
    for (let i = 0; i < s.length; i++) if (s[i] > base.data[i]) base.data[i] = s[i];
  }
  return base;
}
function drawSlices() {
  if (!S.truth) return;
  const vol = sourceVol(), [lo, hi] = windowOf();
  const map = S.source === 'diff' ? S.cdiff : S.cmap;
  for (const v of [...VIEWS, 'oblique']) {
    const cv = $(CANVAS[v]);
    const img = v === 'oblique' ? obliqueOf(vol, S.cursor, S.obl.yaw * Math.PI / 180, S.obl.pitch * Math.PI / 180, phone() ? 128 : 192) : slabSlice(vol, v, S.cursor);
    if (cv.width !== img.w || cv.height !== img.h) { cv.width = img.w; cv.height = img.h; }
    const g = cv.getContext('2d'), id = g.createImageData(img.w, img.h);
    CM.apply(map.id, img.data, lo, hi, id.data, { reverse: map.reverse, gamma: map.gamma, nan: [6, 9, 15, 255] });
    g.putImageData(id, 0, 0);
    // crosshair (orthogonal views), measure line
    g.save(); g.lineWidth = Math.max(0.6, img.w / 260);
    if (v !== 'oblique') {
      const ch = crosshair(vol, v, S.cursor);
      g.strokeStyle = 'rgba(124,196,255,0.55)';
      g.beginPath(); g.moveTo(ch.x, 0); g.lineTo(ch.x, img.h); g.moveTo(0, ch.y); g.lineTo(img.w, ch.y); g.stroke();
    }
    const m = S.measure;
    if (m && m.view === v && m.a) {
      g.strokeStyle = '#ffb86b'; g.fillStyle = '#ffb86b';
      g.beginPath(); g.arc(m.a.x, m.a.y, img.w / 90, 0, 7); g.fill();
      if (m.b) {
        g.beginPath(); g.moveTo(m.a.x, m.a.y); g.lineTo(m.b.x, m.b.y); g.stroke();
        g.beginPath(); g.arc(m.b.x, m.b.y, img.w / 90, 0, 7); g.fill();
      }
    }
    g.restore();
    const cap = cv.parentElement.querySelector('figcaption span');
    const idx = v === 'axial' ? `z ${S.cursor.iz + 1}/${vol.nz}` : v === 'coronal' ? `y ${S.cursor.iy + 1}/${vol.ny}` : v === 'sagittal' ? `x ${S.cursor.ix + 1}/${vol.nx}` : `turn ${S.obl.yaw}°, tilt ${S.obl.pitch}°`;
    cap.textContent = `${idx}${S.slab && v !== 'oblique' ? ` · slab ${2 * S.slab + 1}` : ''}${m && m.view === v && m.b ? ` · ${m.cm.toFixed(2)} cm` : ''}`;
  }
  readout();
}
function readout() {
  if (!S.truth) return;
  const c = S.cursor, t = valueAt(S.truth, c), r = S.recon ? valueAt(S.recon, c) : null;
  $('readout').textContent = `x ${c.ix} y ${c.iy} z ${c.iz} · object ${Math.round(huOf(t))} HU${r !== null ? ` · scan ${Math.round(huOf(r))} HU` : ''}`;
}
function setDepthRanges() {
  const v = S.truth;
  document.querySelectorAll('.slp').forEach((f) => {
    const r = f.querySelector('.depth'); if (!r) return;
    const view = f.dataset.view, n = view === 'axial' ? v.nz : view === 'coronal' ? v.ny : v.nx;
    r.min = 0; r.max = n - 1; r.step = 1;
    r.value = view === 'axial' ? S.cursor.iz : view === 'coronal' ? S.cursor.iy : S.cursor.ix;
  });
}
function bindSlices() {
  document.querySelectorAll('.slp').forEach((f) => {
    const view = f.dataset.view, cv = f.querySelector('canvas'), r = f.querySelector('.depth');
    if (r) r.oninput = () => {
      const k = +r.value;
      if (view === 'axial') S.cursor.iz = k; else if (view === 'coronal') S.cursor.iy = k; else S.cursor.ix = k;
      syncDepth(); drawSlices();
    };
    if (view === 'oblique') return;
    const at = (e) => { const b = cv.getBoundingClientRect(); return { x: (e.clientX - b.left) / b.width * cv.width, y: (e.clientY - b.top) / b.height * cv.height }; };
    let down = false;
    cv.addEventListener('pointerdown', (e) => {
      if (!S.truth) return;
      const p = at(e);
      if (S.measuring) {
        if (!S.measure || S.measure.view !== view || S.measure.b) S.measure = { view, a: p, b: null, cm: 0 };
        else { S.measure.b = p; S.measure.cm = distanceCm(S.truth, S.measure.a, p); }
        drawSlices(); return;
      }
      down = true; cv.setPointerCapture(e.pointerId);
      S.cursor = cursorFromPixel(S.truth, view, p.x, p.y, S.cursor); syncDepth(); drawSlices();
    });
    cv.addEventListener('pointermove', (e) => {
      if (!down) return;
      const p = at(e); S.cursor = cursorFromPixel(S.truth, view, p.x, p.y, S.cursor); syncDepth(); drawSlices();
    });
    const up = () => { down = false; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => {
      if (!S.truth) return;
      e.preventDefault();
      const d = e.deltaY > 0 ? 1 : -1, key = view === 'axial' ? 'iz' : view === 'coronal' ? 'iy' : 'ix', n = key === 'iz' ? S.truth.nz : key === 'iy' ? S.truth.ny : S.truth.nx;
      S.cursor[key] = Math.max(0, Math.min(n - 1, S.cursor[key] + d)); syncDepth(); drawSlices();
    }, { passive: false });
  });
  $('oblYaw').oninput = (e) => { S.obl.yaw = +e.target.value; drawSlices(); };
  $('oblPitch').oninput = (e) => { S.obl.pitch = +e.target.value; drawSlices(); };
  document.querySelectorAll('#segSource button').forEach((b) => b.onclick = () => { S.source = b.dataset.src; markSeg('segSource', 'src', S.source); drawSlices(); });
  $('slab').oninput = (e) => { S.slab = +e.target.value; $('slabOut').textContent = 2 * S.slab + 1; drawSlices(); };
  $('btnMeasure').onclick = () => toggleMeasure();
}
function toggleMeasure() { S.measuring = !S.measuring; S.measure = null; $('btnMeasure').classList.toggle('on', S.measuring); drawSlices(); }
function syncDepth() {
  document.querySelectorAll('.slp').forEach((f) => {
    const r = f.querySelector('.depth'), v = f.dataset.view; if (!r) return;
    r.value = v === 'axial' ? S.cursor.iz : v === 'coronal' ? S.cursor.iy : S.cursor.ix;
  });
}
function drawWinSeg() {
  const host = $('segWin'); host.innerHTML = '';
  for (const [k, label] of WINDOWS) {
    if (k === 'soft' && !S.presets.soft) continue;
    const b = document.createElement('button'); b.textContent = label; b.dataset.win = k; b.classList.toggle('on', S.win === k);
    b.onclick = () => { S.win = k; markSeg('segWin', 'win', k); drawSlices(); };
    host.appendChild(b);
  }
}

// ── 3D look bar ─────────────────────────────────────────────────────────────
function drawPresetSeg() {
  const host = $('segPreset'); host.innerHTML = '';
  for (const [k, p] of Object.entries(S.presets)) {
    const b = document.createElement('button'); b.textContent = p.label.split(' ')[0]; b.title = p.label; b.dataset.preset = k;
    b.classList.toggle('on', k === S.preset);
    b.onclick = () => { S.preset = k; markSeg('segPreset', 'preset', k); if (S.view) S.view.setPreset(S.presets[k]); };
    host.appendChild(b);
  }
}
function bindLook() {
  document.querySelectorAll('#segMode button').forEach((b) => b.onclick = () => { S.mode = b.dataset.mode; markSeg('segMode', 'mode', S.mode); if (S.view) S.view.setMode(S.mode); });
  document.querySelectorAll('#segShow button').forEach((b) => b.onclick = () => {
    S.show = b.dataset.show; markSeg('segShow', 'show', S.show);
    if (S.view) S.view.setShow({ volume: S.show === 'phantom' ? 'phantom' : 'auto' });
  });
  $('btnCut').onclick = () => { S.cut = !S.cut; $('btnCut').classList.toggle('on', S.cut); if (S.view) S.view.setCutaway(S.cut); };
}
function markSeg(id, key, val) { document.querySelectorAll(`#${id} button`).forEach((b) => b.classList.toggle('on', String(b.dataset[key]) === String(val))); }

// ── settings panel ──────────────────────────────────────────────────────────
function bindPanel() {
  const st = S.settings;
  const rescanSoon = (() => { let t = 0; return () => { clearTimeout(t); t = setTimeout(() => { writeHash(); startScan(); }, 350); }; })();
  const views = $('sViews'); views.value = st.nViews; $('oViews').textContent = st.nViews;
  views.oninput = () => { st.nViews = +views.value; $('oViews').textContent = st.nViews; rescanSoon(); };
  const dose = $('sDose'); dose.value = st.doseIdx; $('oDose').textContent = DOSES[st.doseIdx][1];
  dose.oninput = () => { st.doseIdx = +dose.value; $('oDose').textContent = DOSES[st.doseIdx][1]; rescanSoon(); };
  const kvp = $('sKvp'); kvp.value = st.kVp; $('oKvp').textContent = st.kVp + ' kVp';
  kvp.oninput = () => { st.kVp = +kvp.value; $('oKvp').textContent = st.kVp + ' kVp'; if (st.poly) rescanSoon(); };
  $('tPoly').checked = st.poly; $('tPoly').onchange = (e) => { st.poly = e.target.checked; rescanSoon(); };
  markSeg('segDet', 'det', st.detector);
  document.querySelectorAll('#segDet button').forEach((b) => b.onclick = () => { st.detector = +b.dataset.det; markSeg('segDet', 'det', st.detector); rescanSoon(); });
  markSeg('segN', 'n', st.n);
  document.querySelectorAll('#segN button').forEach((b) => b.onclick = () => { if (b.disabled) return; st.n = +b.dataset.n; markSeg('segN', 'n', st.n); rescanSoon(); });
  markSeg('segAlg', 'alg', st.alg);
  document.querySelectorAll('#segAlg button').forEach((b) => b.onclick = () => { st.alg = b.dataset.alg; markSeg('segAlg', 'alg', st.alg); rescanSoon(); });
  $('selFilter').value = st.filter; $('selFilter').onchange = (e) => { st.filter = e.target.value; rescanSoon(); };
  $('btnScan').onclick = () => startScan();
  $('btnPlay').onclick = () => { S.playing = !S.playing; $('btnPlay').textContent = S.playing ? 'Pause' : 'Play'; };
  const main = createPicker($('cmapMain'), { value: S.cmap.id, groups: ['grey', 'medical', 'perceptual', 'artistic'], compact: phone() });
  main.addEventListener('change', (e) => {
    S.cmap = { id: e.detail.id, reverse: e.detail.reverse, gamma: e.detail.gamma };
    if (S.view) S.view.setColormap(S.cmap.id, { reverse: S.cmap.reverse, gamma: S.cmap.gamma });
    drawSlices();
  });
  const diff = createPicker($('cmapDiff'), { value: S.cdiff.id, groups: ['diverging'], compact: true });
  diff.addEventListener('change', (e) => { S.cdiff = { id: e.detail.id, reverse: e.detail.reverse, gamma: e.detail.gamma }; drawSlices(); });
  $('exSlices').onclick = exportSlices; $('exVolume').onclick = exportVolume;
}
function scanNote() {
  const st = S.settings, g = S.session.geom;
  $('scanNote').textContent = `${g.nAngles} views over 360°, detector ${g.nu} × ${g.nv}, source ${g.sod.toFixed(1)} cm from the axis. ` +
    (st.alg === 'sirt' ? 'SIRT runs on the CPU in a worker at a lower voxel count, then the result is upsampled.' : S.gpu ? 'FDK back-projects on the GPU.' : 'FDK runs on the CPU.');
}

// ── export ──────────────────────────────────────────────────────────────────
function save(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
function exportSlices() {
  for (const v of [...VIEWS, 'oblique']) {
    const cv = $(CANVAS[v]);
    cv.toBlob((b) => b && save(b, `${S.entry.id}-${S.source}-${v}.png`), 'image/png');
  }
}
function exportVolume() {
  const vol = sourceVol();
  const head = { object: S.entry.id, source: S.source, dims: [vol.nx, vol.ny, vol.nz], widthCm: vol.width, voxelCm: vol.width / vol.nx,
    units: '1/cm at 70 keV (mu); HU = 1000 (mu - mu_water) / mu_water', layout: 'float32 little-endian, data[(iz*ny + iy)*nx + ix], iz = 0 lowest, iy = 0 top',
    settings: { ...S.settings, dose: DOSES[S.settings.doseIdx][1] }, credit: S.entry.credit };
  save(new Blob([new Float32Array(vol.data).buffer], { type: 'application/octet-stream' }), `${S.entry.id}-${S.source}-${vol.nx}.raw`);
  save(new Blob([JSON.stringify(head, null, 1)], { type: 'application/json' }), `${S.entry.id}-${S.source}-${vol.nx}.json`);
}

// ── dock, sheets, keys, hash ────────────────────────────────────────────────
function closeSheets() { $('gallery').classList.remove('open'); $('panel').classList.remove('open'); document.querySelectorAll('#dock button').forEach((b) => b.classList.remove('on')); }
function bindDock() {
  const sheet = (id, btn) => { const open = !$(id).classList.contains('open'); closeSheets(); if (open) { $(id).classList.add('open'); $(btn).classList.add('on'); } };
  $('dockObjects').onclick = () => sheet('gallery', 'dockObjects');
  $('dockPanel').onclick = () => sheet('panel', 'dockPanel');
  $('dockScan').onclick = () => { closeSheets(); startScan(); };
  $('dockSlices').onclick = () => { closeSheets(); $('explore').scrollIntoView({ behavior: 'smooth' }); };
  document.querySelectorAll('.sheet-grip').forEach((g) => g.onclick = closeSheets);
}
function bindKeys() {
  addEventListener('keydown', (e) => {
    if (e.target.closest('input,select,textarea') || e.metaKey || e.ctrlKey) return;
    if (e.key === ' ') { e.preventDefault(); $('btnPlay').click(); }
    else if (e.key === 'r' || e.key === 'R') startScan();
    else if (e.key === 'm' || e.key === 'M') toggleMeasure();
  });
}
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1)), st = S.settings;
  S.wantObj = h.get('obj');
  const num = (k, lo, hi) => { const v = +h.get(k); return h.has(k) && Number.isFinite(v) && v >= lo && v <= hi ? v : null; };
  st.nViews = num('views', 30, 360) ?? st.nViews; st.detector = num('det', 0.5, 2) ?? st.detector;
  st.doseIdx = num('dose', 0, DOSES.length - 1) ?? st.doseIdx; st.kVp = num('kvp', 60, 150) ?? st.kVp;
  if (h.has('poly')) st.poly = h.get('poly') === '1';
  const n = num('n', 64, 128); if (n && [64, 96, 128].includes(n)) st.n = n;
  if (h.get('alg') === 'sirt' || h.get('alg') === 'fdk') st.alg = h.get('alg');
}
function writeHash() {
  if (S.saver || !S.entry) return;
  const st = S.settings;
  const h = `obj=${S.entry.id}&views=${st.nViews}&det=${st.detector}&dose=${st.doseIdx}&kvp=${st.kVp}&poly=${st.poly ? 1 : 0}&n=${st.n}&alg=${st.alg}`;
  try { history.replaceState(null, '', '#' + h); } catch (e) { /* sandboxed */ }
  try { if (window.parent !== window && typeof window.parent.snNav === 'function') window.parent.snNav(h, 'replace'); } catch (e) { /* other origin */ }
}

function phaseText(t) { $('phaseText').textContent = t; }
function prog(f) { $('prog').style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + '%'; }

window.__ct3d = {
  S, selectObject, startScan, drawSlices, finishRecon, DOSES,
  get view() { return S.view; }, get device() { return S.device; },
  // the saver plays with its own GPU device: the page frees its view and device while the
  // saver runs, and builds them again (and scans again) when it ends
  pause(p) {
    S.saver = !!p;
    if (p) {
      stopWorker();
      try { S.view && S.view.destroy(); } catch (e) { /* gone */ }
      try { S.device && S.device.destroy(); } catch (e) { /* gone */ }
      S.view = null; S.device = null;
    } else if (S.entry) {
      (S.gpu ? initGpu() : Promise.resolve()).then(() => startScan());
    }
  },
};
boot();
