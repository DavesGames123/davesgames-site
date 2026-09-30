/* ============================================================================
   HYDROGEN TABLE  ·  main script  (ES module)
   ----------------------------------------------------------------------------
   Builds the table of tiles, binds the controls, and drives a pool of tile
   workers (worker.js). Each tile canvas has one pixel for each device pixel.
   A worker fills the tile, colors it, and sends back an ImageBitmap. This
   script only draws the bitmaps.

   RENDER MODEL. A change starts render(). If a render is still running, the
   change sets a flag, and one more render starts when the first one ends. So
   a fast slider drag never makes a queue. Tile i always goes to worker
   i mod K, so the field cache in that worker stays useful. A change of color,
   gamma, exposure or log scale only colors the cached fields again.

   LAYOUT. Two forms, picked by width:
     aligned   one grid. Row n, column (l, m), the same column in each row,
               as in the classic plot. Used when a tile can be 88px or more.
     bands     one band for each n, with a fixed column count: three on a
               phone (two below 330px), else as many 150px tiles as fit.

   GREP MAP
     grep -n 'function layout'      aligned table or n-bands, tile size
     grep -n 'function render'      the job list and the worker pool
     grep -n 'function onTiles'     draw the bitmaps that come back
     grep -n 'function openDetail'  the large tile and its readout
     grep -n 'function drawRadial'  the r^2 R^2 plot
     grep -n 'function drawColorbar'  the header colorbar
     grep -n 'function buildUI'     the controls, the phone sheet and dock
     grep -n 'function startPool'   workers, or the page-thread fallback
     grep -n 'function fitFormulas' shrink the KaTeX lines to fit a phone
   ========================================================================== */
import { tileList, tileSpec, radialR, legendre, energyEV, meanR, L_LETTER, fillTile } from './physics.js';
import { MAPS, lut, colorize } from './colormaps.js';

const PHONE_Q = window.matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const $ = id => document.getElementById(id);
const table = $('table');

const G = { nMax: 4, kind: 'complex', cmap: 'inferno', gamma: 0.75, expo: 0.3, log: false, decades: 4, outerLobe: true };
const N_MIN = 1, N_MAX = 7;
const look = () => ({ cmap: G.cmap, gamma: G.gamma, exposure: Math.pow(2, G.expo), log: G.log, decades: G.decades, outerLobe: G.outerLobe });
const fmtM = m => (m < 0 ? '−' + (-m) : String(m));

// ------------------------------------------------------------ worker pool
let pool = [], engine = '';
function startPool() {
  const K = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
  return new Promise(resolve => {
    let ready = 0, failed = false;
    const fail = () => {
      if (failed) return; failed = true;
      pool.forEach(w => w.terminate && w.terminate());
      pool = [mainThreadWorker()]; engine = 'page thread (no module worker)';
      resolve();
    };
    const timer = setTimeout(fail, 4000);
    try {
      for (let i = 0; i < K; i++) {
        const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
        w.onmessage = e => {
          if (e.data.type === 'ready') { if (++ready === K && !failed) { clearTimeout(timer); engine = `${K} Web Worker${K > 1 ? 's' : ''} · CPU · ImageBitmap`; resolve(); } return; }
          onWorker(e.data);
        };
        w.onerror = ev => { console.warn('[hydrogen-table] worker error', ev.message || ev); if (ready < K) { clearTimeout(timer); fail(); } };
        pool.push(w);
      }
    } catch (err) { clearTimeout(timer); fail(); }
  });
}

// The fallback: the same fill and colorize, on the page thread.
function mainThreadWorker() {
  return {
    postMessage(d) {
      setTimeout(() => {
        let fillMs = 0, colorMs = 0;
        const items = [];
        for (const j of d.jobs) {
          const t0 = performance.now(), f = new Float32Array(j.size * j.size);
          const S = tileSpec(j.n, j.l, j.m, j.kind);
          fillTile(S, j.size, f);
          const lk = d.look.outerLobe && !d.look.log ? { ...d.look, exposure: d.look.exposure / (S.outer * S.outer) } : d.look;
          const t1 = performance.now(), px = colorize(f, j.size, lk);
          fillMs += t1 - t0; colorMs += performance.now() - t1;
          items.push({ id: j.id, size: j.size, buf: px.buffer });
        }
        onWorker({ type: 'tiles', seq: d.seq, items });
        onWorker({ type: 'done', seq: d.seq, fillMs, colorMs, fills: d.jobs.length });
      }, 0);
    },
  };
}

// ------------------------------------------------------------ layout
let TILES = [], gen = 0, layoutKey = '', mode = 'aligned';
const GAP = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gap')) || 7;

function layout(force) {
  const W = table.clientWidth || document.documentElement.clientWidth - 32;
  const phone = PHONE_Q.matches, gap = GAP();
  const list = tileList(G.nMax, G.kind);
  const C = G.kind === 'complex' ? G.nMax * (G.nMax + 1) / 2 : G.nMax * G.nMax;
  const labW = 62;
  let tile = Math.floor((W - labW - gap * C) / C), K = C;
  if (!phone && tile >= 88 && C > 1) { mode = 'aligned'; tile = Math.min(tile, 178); }
  else {
    mode = 'bands';
    K = phone ? (W < 330 ? 2 : 3) : Math.max(3, Math.min(C, Math.floor((W + gap) / (150 + gap))));
    tile = Math.min(phone ? 200 : 178, Math.floor((W - gap * (K - 1)) / K));
    if (C === 1) { K = 1; tile = Math.min(tile, 178); }
  }
  const dpr = window.devicePixelRatio || 1;
  const key = [mode, K, tile, dpr, G.nMax, G.kind].join('|');
  if (key === layoutKey && !force) return false;
  layoutKey = key; gen++;
  table.style.setProperty('--tile', tile + 'px');
  table.style.setProperty('--cols', K);
  table.className = mode;
  table.textContent = '';
  const inner = tile - 2, size = Math.max(16, Math.round(inner * dpr));
  const mkTile = (t, i) => {
    const b = document.createElement('button');
    b.className = 'tile'; b.dataset.i = i;
    const name = t.spec.name.split(' ');
    b.title = `${t.spec.name} · n=${t.n}, l=${t.l}, m=${fmtM(t.m)} · tap for details`;
    b.setAttribute('aria-label', `Orbital ${t.spec.name}, n ${t.n}, l ${t.l}, m ${t.m}`);
    const cv = document.createElement('canvas'); cv.width = size; cv.height = size;
    const lb = document.createElement('span'); lb.className = 'lbl'; lb.textContent = `(${t.n},${t.l},${fmtM(t.m)})`;
    const nm = document.createElement('span'); nm.className = 'nm';
    nm.textContent = name[0];
    const extra = [name.slice(1).join(' '), G.kind === 'real' && t.l > 0 ? '· ' + t.spec.planeLabel : ''].filter(Boolean).join(' ');
    if (extra) { const s = document.createElement('small'); s.textContent = extra; nm.appendChild(s); }
    b.append(cv, lb, nm);
    t.el = b; t.cv = cv; t.ctx = cv.getContext('2d', { alpha: false }); t.size = size; t.drawn = -1;
    return b;
  };
  TILES = list.map(t => ({ ...t, spec: tileSpec(t.n, t.l, t.m, G.kind) }));
  const frag = document.createDocumentFragment();
  if (mode === 'aligned') {
    frag.appendChild(Object.assign(document.createElement('div'), { className: 'corner' }));
    for (let l = 0; l < G.nMax; l++) {
      const h = document.createElement('div'); h.className = 'lhead';
      const span = G.kind === 'complex' ? l + 1 : 2 * l + 1;
      const start = (G.kind === 'complex' ? l * (l + 1) / 2 : l * l) + 2;
      h.style.gridColumn = `${start} / span ${span}`; h.style.gridRow = '1';
      h.innerHTML = `<i>${L_LETTER[l]}</i>ℓ = ${l}`;
      frag.appendChild(h);
    }
    for (let n = 1; n <= G.nMax; n++) {
      const lab = document.createElement('div'); lab.className = 'nlab';
      lab.style.gridColumn = '1'; lab.style.gridRow = String(n + 1);
      lab.innerHTML = `<span class="nn"><i>n</i> = ${n}</span><span class="ne">${energyEV(n).toFixed(2)} eV</span>`;
      frag.appendChild(lab);
    }
    TILES.forEach((t, i) => { const b = mkTile(t, i); b.style.gridColumn = String(t.col + 2); b.style.gridRow = String(t.n + 1); frag.appendChild(b); });
  } else {
    for (let n = 1; n <= G.nMax; n++) {
      const band = document.createElement('section'); band.className = 'band';
      band.style.width = (K * tile + (K - 1) * gap) + 'px';
      const shells = Array.from({ length: n }, (_, l) => n + L_LETTER[l]).join(' ');
      band.innerHTML = `<div class="band-head"><span class="nn"><i>n</i> = ${n}</span><span class="ne">${energyEV(n).toFixed(2)} eV · ${shells}</span></div>`;
      const grid = document.createElement('div'); grid.className = 'band-grid';
      TILES.forEach((t, i) => { if (t.n === n) grid.appendChild(mkTile(t, i)); });
      band.appendChild(grid); frag.appendChild(band);
    }
  }
  table.appendChild(frag);
  const px = TILES.length * size * size;
  $('rdTiles').textContent = `${TILES.length} · ${mode}${mode === 'bands' ? ' ×' + K : ''}`;
  $('rdPx').textContent = `${size}² each · ${(px / 1e6).toFixed(2)} Mpx`;
  $('nHint').textContent = `${TILES.length} tiles, n = 1 … ${G.nMax}`;
  return true;
}

// ------------------------------------------------------------ render
let seq = 0, busy = false, pending = false, outstanding = 0, t0 = 0, curSeq = 0, stats = null;
const history = [];
window.__hyd = { G, history, get engine() { return engine; }, get tiles() { return TILES.length; }, render: () => render() };

function render() {
  if (!pool.length || !TILES.length) return;
  if (busy) { pending = true; return; }
  busy = true; pending = false;
  curSeq = ++seq; t0 = performance.now();
  stats = { fillMs: 0, colorMs: 0, fills: 0 };
  // Tiles in view go first.
  const vh = window.innerHeight;
  const order = TILES.map((t, i) => {
    const r = t.el.getBoundingClientRect();
    return { i, d: r.bottom < 0 ? -r.bottom + vh : r.top > vh ? r.top : 0 };
  }).sort((a, b) => a.d - b.d);
  const jobs = pool.map(() => []);
  for (const { i } of order) {
    const t = TILES[i];
    jobs[i % pool.length].push({ id: gen * 100000 + i, n: t.n, l: t.l, m: t.m, kind: G.kind, size: t.size });
  }
  const lk = look();
  outstanding = 0;
  jobs.forEach((js, k) => { if (js.length) { outstanding++; pool[k].postMessage({ type: 'render', seq: curSeq, jobs: js, look: lk }); } });
  if (!outstanding) busy = false;
}

let detailSeq = 0;
function onWorker(d) {
  if (d.type === 'tiles') return onTiles(d);
  if (d.type !== 'done') return;
  if (typeof d.seq === 'string') return;            // a detail job
  if (d.seq !== curSeq) return;
  stats.fillMs += d.fillMs; stats.colorMs += d.colorMs; stats.fills += d.fills;
  if (--outstanding > 0) return;
  const ms = performance.now() - t0;
  busy = false;
  const rec = { ms: +ms.toFixed(1), tiles: TILES.length, px: TILES[0] ? TILES[0].size : 0, fills: stats.fills, fillMs: +stats.fillMs.toFixed(1), colorMs: +stats.colorMs.toFixed(1), nMax: G.nMax, kind: G.kind, workers: pool.length };
  history.push(rec); if (history.length > 50) history.shift();
  const txt = `${rec.ms.toFixed(0)} ms · ${rec.fills} filled, ${rec.tiles - rec.fills} from cache`;
  $('rdMs').textContent = txt;
  $('foot').textContent = `${rec.tiles} tiles · ${rec.px}×${rec.px} px each · rendered in ${rec.ms.toFixed(0)} ms on ${engine}`;
  console.log(`[hydrogen-table] render nMax=${rec.nMax} ${rec.kind} tiles=${rec.tiles} size=${rec.px}px fills=${rec.fills} ${rec.ms} ms (worker fill ${rec.fillMs} ms, color ${rec.colorMs} ms, summed over ${rec.workers} workers)`);
  if (pending) render();
}

function onTiles(d) {
  for (const it of d.items) {
    if (typeof d.seq === 'string') { drawDetail(d.seq, it); continue; }
    const g = Math.floor(it.id / 100000), i = it.id % 100000, t = TILES[i];
    if (g !== gen || !t || t.size !== it.size || d.seq < t.drawn) { if (it.bmp) it.bmp.close(); continue; }
    t.drawn = d.seq;
    if (it.bmp) { t.ctx.drawImage(it.bmp, 0, 0); it.bmp.close(); }
    else t.ctx.putImageData(new ImageData(new Uint8ClampedArray(it.buf), it.size, it.size), 0, 0);
  }
}

// ------------------------------------------------------------ colorbar
function drawColorbar() {
  const cv = $('cbar'), ctx = cv.getContext('2d');
  const img = ctx.createImageData(256, 1);
  const P = lut(G.cmap === 'signed' ? 'inferno' : G.cmap), N = lut('ice');
  for (let i = 0; i < 256; i++) {
    let L = P, k = i;
    if (G.cmap === 'signed') { const s = (i - 127.5) / 127.5; L = s < 0 ? N : P; k = Math.round(Math.abs(s) * 255); }
    img.data.set([L[k * 3], L[k * 3 + 1], L[k * 3 + 2], 255], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  const sg = G.cmap === 'signed';
  $('cbLo').textContent = '−'; $('cbHi').textContent = '+';
  $('cbCap').textContent = sg ? 'sign of ψ: cold where ψ < 0, warm where ψ > 0 · brightness is |ψ|²'
    : `${G.log ? 'log₁₀ ' : ''}|ψ|² in the cut plane · each tile scaled to ${G.outerLobe && !G.log ? 'its outer lobe' : 'its own peak'}`;
}

// ------------------------------------------------------------ detail
let detailIndex = -1, detailSpec = null, detailSize = 0;
function openDetail(i) {
  if (i < 0 || i >= TILES.length) return;
  detailIndex = i;
  const t = TILES[i], S = t.spec;
  const box = $('detail'); box.hidden = false;
  document.body.classList.add('detail-open');
  const phone = PHONE_Q.matches, vw = window.innerWidth, vh = window.innerHeight;
  const css = phone ? Math.floor(Math.min(vw - 32, vh * 0.48, 560)) : Math.floor(Math.min(540, vh - 150, vw - 32 - 360));
  const dcss = Math.max(200, css);
  $('dCanvas').style.setProperty('--dsize', dcss + 'px');
  const dpr = window.devicePixelRatio || 1;
  detailSize = Math.min(1800, Math.round(dcss * dpr));
  const cv = $('dCanvas'); if (cv.width !== detailSize) { cv.width = detailSize; cv.height = detailSize; }
  detailSpec = S;
  const tag = 'd' + (++detailSeq);
  pool[0].postMessage({ type: 'render', seq: tag, jobs: [{ id: -1, n: t.n, l: t.l, m: t.m, kind: G.kind, size: detailSize }], look: look() });

  $('dName').textContent = S.name;
  $('dKet').textContent = `|${t.n}, ${t.l}, ${fmtM(t.m)}⟩`;
  $('dQN').textContent = `n = ${t.n}, l = ${t.l}, m = ${fmtM(t.m)}`;
  $('dOrb').textContent = `${S.name}${G.kind === 'complex' ? ' (complex, e^imφ)' : ' (real)'}`;
  const planeTxt = { xz: 'x–z plane (φ = 0 and 180°)', yz: 'y–z plane (φ = 90°)', xy: 'x–y plane (θ = 90°)', vert: `vertical plane at φ = ${Math.round(S.phi0 * 180 / Math.PI)}°` }[S.plane];
  $('dPlane').textContent = planeTxt;
  const rNodes = radialNodes(t.n, t.l);
  $('dRad').textContent = `${S.radialNodes}` + (rNodes.length ? ` · r = ${rNodes.map(r => r.toFixed(2)).join(', ')} a₀` : '');
  const cones = polarNodes(t.l, Math.abs(t.m));
  // A polar node at theta = 90 deg is the x-y plane, not a cone.
  const polarTxt = S.polarNodes ? `${S.polarNodes} polar (θ = ${cones.map(a => Math.abs(a - 90) < 0.1 ? '90° plane' : a.toFixed(1) + '°').join(', ')})` : '0 polar';
  $('dAng').textContent = G.kind === 'real'
    ? `${t.l} = ${polarTxt} + ${S.azimNodes} vertical plane${S.azimNodes === 1 ? '' : 's'}`
    : `${t.l} = ${polarTxt}${S.azimNodes ? ` + ${S.azimNodes} at the z axis` : ''}`;
  $('dE').textContent = `${energyEV(t.n).toFixed(3)} eV  (−13.6 eV / ${t.n}²)`;
  $('dR').textContent = `${meanR(t.n, t.l).toFixed(1)} a₀`;
  $('dAxV').textContent = S.plane === 'xy' ? 'y' : 'z';
  $('dAxH').textContent = S.plane === 'xy' ? 'x' : S.plane === 'yz' ? 'y' : S.plane === 'vert' ? 'ρ' : 'x';
  $('dScale').textContent = `view ±${S.hw.toFixed(1)} a₀`;
  $('dNote').textContent = G.kind === 'complex'
    ? `|ψ|² does not change with φ, so this cut shows the whole shape. Turn it about the z axis to get the 3D cloud.${t.m ? ` The ${Math.abs(t.m)} node${Math.abs(t.m) > 1 ? 's' : ''} of e^(imφ) meet on the z axis, so the axis stays dark.` : ''}`
    : `A real orbital: ${t.m === 0 ? 'm = 0 is already real' : t.m > 0 ? `cos ${t.m}φ` : `sin ${-t.m}φ`}. The cut goes through its lobes. Its ${Math.abs(t.m)} nodal plane${Math.abs(t.m) === 1 ? '' : 's'} contain${Math.abs(t.m) === 1 ? 's' : ''} the z axis.`;
  drawRadial(t.n, t.l, S.hw, rNodes);
  $('dClose').focus({ preventScroll: true });
}

function drawDetail(tag, it) {
  if (tag !== 'd' + detailSeq || $('detail').hidden) { if (it.bmp) it.bmp.close(); return; }
  const ctx = $('dCanvas').getContext('2d', { alpha: false });
  if (it.bmp) { ctx.drawImage(it.bmp, 0, 0); it.bmp.close(); }
  else ctx.putImageData(new ImageData(new Uint8ClampedArray(it.buf), it.size, it.size), 0, 0);
}

function closeDetail() {
  $('detail').hidden = true; document.body.classList.remove('detail-open');
  const t = TILES[detailIndex]; if (t && t.el) t.el.focus({ preventScroll: true });
  detailIndex = -1;
}

function radialNodes(n, l) {
  const out = [], rEnd = 4 * n * n + 20, N = 20000;
  let p = radialR(n, l, 1e-6);
  for (let i = 1; i <= N; i++) {
    const r = i * rEnd / N, v = radialR(n, l, r);
    if (v * p < 0) { let a = r - rEnd / N, b = r; for (let k = 0; k < 50; k++) { const c = (a + b) / 2; if (radialR(n, l, a) * radialR(n, l, c) <= 0) b = c; else a = c; } out.push((a + b) / 2); }
    p = v;
  }
  return out;
}
function polarNodes(l, am) {
  const out = [], N = 4000;
  let p = legendre(l, am, Math.cos(1e-6));
  for (let i = 1; i <= N; i++) { const th = i * Math.PI / N, v = legendre(l, am, Math.cos(th)); if (v * p < 0) out.push((th - Math.PI / N / 2) * 180 / Math.PI); if (v !== 0) p = v; }
  return out;
}

function drawRadial(n, l, hw, nodes) {
  const cv = $('dRadial'), dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth || 300, h = cv.clientHeight || 170;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  const rMax = hw * 1.25, N = 600, pad = { l: 8, r: 10, t: 12, b: 22 };
  const ys = []; let yMax = 0;
  for (let i = 0; i <= N; i++) { const r = i / N * rMax, v = r * r * radialR(n, l, r) ** 2; ys.push(v); if (v > yMax) yMax = v; }
  const X = r => pad.l + r / rMax * (w - pad.l - pad.r), Y = v => h - pad.b - v / yMax * (h - pad.t - pad.b) * 0.92;
  // grid ticks in a0
  const stepT = [1, 2, 5, 10, 20, 25, 50, 100].find(s => rMax / s <= 7) || 100;
  ctx.font = '10px JetBrains Mono, monospace'; ctx.fillStyle = '#8f8499'; ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
  for (let r = 0; r <= rMax; r += stepT) { const x = Math.round(X(r)) + 0.5; ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke(); ctx.fillText(String(r), x - (r ? 6 : 0), h - 7); }
  ctx.fillText('r / a₀', w - 44, h - 7);
  // tile edge
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.setLineDash([2, 3]);
  ctx.beginPath(); ctx.moveTo(X(hw), pad.t); ctx.lineTo(X(hw), h - pad.b); ctx.stroke();
  // fill under the curve, with the inferno ramp from left to right
  const L = lut('inferno'), grad = ctx.createLinearGradient(0, h - pad.b, 0, pad.t);
  for (let k = 0; k <= 8; k++) { const c = Math.round(60 + k / 8 * 195); grad.addColorStop(k / 8, `rgba(${L[c * 3]},${L[c * 3 + 1]},${L[c * 3 + 2]},0.85)`); }
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(X(0), Y(0));
  ys.forEach((v, i) => ctx.lineTo(X(i / N * rMax), Y(v)));
  ctx.lineTo(X(rMax), Y(0)); ctx.closePath(); ctx.fillStyle = grad; ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1;
  ctx.beginPath(); ys.forEach((v, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, X(i / N * rMax), Y(v)));
  ctx.strokeStyle = '#fcd57a'; ctx.lineWidth = 1.6; ctx.stroke();
  // nodes and <r>
  ctx.fillStyle = '#7fc8ff';
  for (const r of nodes) { ctx.beginPath(); ctx.arc(X(r), Y(0), 3, 0, Math.PI * 2); ctx.fill(); }
  const mr = meanR(n, l);
  if (mr < rMax) { ctx.strokeStyle = '#d24644'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(X(mr), pad.t); ctx.lineTo(X(mr), h - pad.b); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#e08070'; ctx.fillText('⟨r⟩', X(mr) + 3, pad.t + 9); }
  ctx.fillStyle = '#8f8499'; if (nodes.length) ctx.fillText('● node', w - 60, pad.t + 9);
}

// ------------------------------------------------------------ controls
function buildUI() {
  const cm = $('cmapBtns');
  for (const m of MAPS) { const b = document.createElement('button'); b.dataset.cmap = m.id; b.textContent = m.label; cm.appendChild(b); }
  const sync = () => {
    $('numN').textContent = G.nMax;
    const [dn, up] = $('stepN').querySelectorAll('button');
    dn.disabled = G.nMax <= N_MIN; up.disabled = G.nMax >= N_MAX;
    document.querySelectorAll('[data-kind]').forEach(b => b.classList.toggle('on', b.dataset.kind === G.kind));
    document.querySelectorAll('[data-cmap]').forEach(b => b.classList.toggle('on', b.dataset.cmap === G.cmap));
    document.querySelectorAll('[data-norm]').forEach(b => b.classList.toggle('on', (b.dataset.norm === 'outer') === G.outerLobe));
    $('logBtn').textContent = `LOG DENSITY · ${G.log ? 'ON' : 'OFF'}`; $('logBtn').classList.toggle('on', G.log);
    $('dockLog').classList.toggle('on', G.log);
    $('decRow').classList.toggle('off', !G.log);
    $('gammaV').textContent = G.gamma.toFixed(2);
    $('expoV').textContent = '×' + Math.pow(2, G.expo).toFixed(G.expo < 2 ? 2 : 1);
    $('decV').textContent = G.decades.toFixed(1);
    $('kindHint').textContent = G.kind === 'complex'
      ? 'm = 0 … l. The density of −m is the same as of +m.'
      : 'm = 0, +1, −1 … Each tile is cut through its lobes. Its plane shows at the top left.';
    document.body.classList.toggle('real', G.kind === 'real');
    window.HydEq && window.HydEq.setKind(G.kind);
    if (typeof fitFormulas === 'function') fitFormulas();
    drawColorbar();
  };
  const relayout = () => { sync(); layout(true); render(); };
  const recolor = () => { sync(); render(); if (detailIndex >= 0) openDetail(detailIndex); };

  $('stepN').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    G.nMax = Math.max(N_MIN, Math.min(N_MAX, G.nMax + +b.dataset.d)); relayout();
  });
  document.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => { if (G.kind !== b.dataset.kind) { G.kind = b.dataset.kind; relayout(); } }));
  cm.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; G.cmap = b.dataset.cmap; recolor(); });
  const slider = (id, keyName) => $(id).addEventListener('input', e => { G[keyName] = +e.target.value; sync(); render(); });
  $('gamma').value = G.gamma; $('expo').value = G.expo; $('dec').value = G.decades;
  slider('gamma', 'gamma'); slider('expo', 'expo'); slider('dec', 'decades');
  ['gamma', 'expo', 'dec'].forEach(id => $(id).addEventListener('change', () => { if (detailIndex >= 0) openDetail(detailIndex); }));
  const toggleLog = () => { G.log = !G.log; if (G.log && G.gamma < 0.8) { G.gamma = 1; $('gamma').value = 1; } else if (!G.log) { G.gamma = 0.75; $("gamma").value = 0.75; } recolor(); };
  $('logBtn').addEventListener('click', toggleLog);
  document.querySelectorAll('[data-norm]').forEach(b => b.addEventListener('click', () => { G.outerLobe = b.dataset.norm === 'outer'; recolor(); }));
  $('dockLog').addEventListener('click', toggleLog);

  // panel, phone sheet, dock
  const panel = $('panel'), dockPanel = $('dockPanel');
  function setOpen(open) {
    panel.classList.toggle('open', open);
    if (!open) panel.classList.remove('full');
    document.body.classList.toggle('panel-closed', !open);
    dockPanel.classList.toggle('on', open);
    dockPanel.setAttribute('aria-expanded', String(open));
  }
  const toggle = () => setOpen(!panel.classList.contains('open'));
  $('gear').addEventListener('click', toggle);
  dockPanel.addEventListener('click', toggle);
  $('panelClose').addEventListener('click', () => setOpen(false));
  setOpen(!PHONE_Q.matches);
  PHONE_Q.addEventListener('change', e => setOpen(!e.matches));
  const grip = $('sheetGrip'); let gripY = null;
  grip.addEventListener('pointerdown', e => { gripY = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) {} });
  grip.addEventListener('pointerup', e => {
    if (gripY === null) return;
    const dy = e.clientY - gripY; gripY = null;
    if (Math.abs(dy) < 8) panel.classList.toggle('full');
    else if (dy < -40) panel.classList.add('full');
    else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
  });
  grip.addEventListener('pointercancel', () => { gripY = null; });

  // tiles and detail
  table.addEventListener('click', e => { const b = e.target.closest('.tile'); if (b) openDetail(+b.dataset.i); });
  $('dClose').addEventListener('click', closeDetail);
  $('scrim').addEventListener('click', closeDetail);
  $('dPrev').addEventListener('click', () => openDetail((detailIndex - 1 + TILES.length) % TILES.length));
  $('dNext').addEventListener('click', () => openDetail((detailIndex + 1) % TILES.length));
  window.addEventListener('keydown', e => {
    if ($('detail').hidden) return;
    if (e.key === 'Escape') closeDetail();
    else if (e.key === 'ArrowLeft') $('dPrev').click();
    else if (e.key === 'ArrowRight') $('dNext').click();
  });
  sync();
}

// Shrink a KaTeX formula until it fits its box, so a phone shows all of it.
function fitFormulas() {
  for (const el of document.querySelectorAll('.formula')) {
    const k = el.querySelector('.katex'); if (!k) continue;
    k.style.fontSize = '';
    const base = parseFloat(getComputedStyle(k).fontSize);
    let fs = base;
    while (el.scrollWidth > el.clientWidth + 1 && fs > base * 0.5) { fs *= 0.94; k.style.fontSize = fs + 'px'; }
  }
}

// ------------------------------------------------------------ start
buildUI();
fitFormulas();
if (document.fonts) document.fonts.ready.then(fitFormulas);
window.addEventListener('resize', fitFormulas);
layout(true);
let rsTimer = 0;
new ResizeObserver(() => { clearTimeout(rsTimer); rsTimer = setTimeout(() => { if (layout(false)) render(); }, 90); }).observe(table);
startPool().then(() => { $('rdEngine').textContent = engine; render(); });
