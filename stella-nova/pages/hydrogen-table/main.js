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
     grid      one CSS grid. Shells 1 … nb are aligned: row n, column
               (l, m), the same column in each row, as in the classic plot.
               nb is the largest n whose row fits at 120px tiles or more.
               A shell above nb gets a head row, then wraps at the same
               tile size in K columns. It is not aligned to the l headers.
     bands     phone. One band for each n, three columns (two below 330px).
   ROTATION. The play button turns every orbital in 3D at three rates, about
   x, y and z. The tile planes stay fixed. See the animation section.
   SCROLL. The page starts with 4 shells, or fewer if G.nMax is lower. When
   the foot comes within 900px of the view, the next shell is added and only
   its tiles fill. This stops at G.nMax (the "n max" stepper, 10 at most).

   GREP MAP
     grep -n 'function layout'      grid or bands, tile size, a full build
     grep -n 'function addShell'    one shell: aligned row, wrapped, or band
     grep -n 'function maybeExtend' add shells as the page scrolls
     grep -n 'function render'      the job list and the worker pool
     grep -n 'function onTiles'     draw the bitmaps that come back
     grep -n 'function openDetail'  the large tile and its readout
     grep -n 'function drawRadial'  the r^2 R^2 plot
     grep -n 'function drawColorbar'  the header colorbar
     grep -n 'function buildUI'     the controls, the phone sheet and dock
     grep -n 'function startPool'   workers, or the page-thread fallback
     grep -n 'function setAnim'     start or pause the rotation
     grep -n 'function sendFrame'   one animation frame: tiles in view
     grep -n 'function animDone'    frame time and the adaptive size
     grep -n 'window.snSaver'       screensaver hook (lib/screensaver.js)
     grep -n 'function saverPlate'  screensaver label plate: n l m, R_nl, E_n, nodes
   ========================================================================== */
import { shellTiles, colIndex, tileSpec, radialR, legendre, energyEV, meanR, L_LETTER, fillPose, poseMatrix } from './physics.js';
import { MAPS, lut, colorize, outerGain } from './colormaps.js';

const PHONE_Q = window.matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const $ = id => document.getElementById(id);
const table = $('table');

const G = { nMax: 10, kind: 'complex', cmap: 'inferno', gamma: 0.75, expo: 0.3, log: false, decades: 4, outerLobe: true };
const N_MIN = 1, N_MAX = 10;
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
          fillPose(S, j.size, f, j.rot || null);
          const lk = d.look.outerLobe && !d.look.log ? { ...d.look, exposure: d.look.exposure * outerGain(S.outer) } : d.look;
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
// shown is the count of shells in the DOM. It grows as the page scrolls, up
// to G.nMax. geo holds the geometry of the current build.
let TILES = [], gen = 0, layoutKey = '', mode = 'grid', shown = 0, geo = null;
const LAB_W = 62, MIN_T = 120, MAX_T = 178, N_START = 4;
const GAP = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gap')) || 7;
const colsFor = n => G.kind === 'complex' ? n * (n + 1) / 2 : n * n;

// Pick the geometry. grid: the tile size is the largest that still lets
// shells 1 … nb sit aligned at MIN_T or more. K columns fit at that size.
// bands (phone): one band for each n with K = 3 (2 below 330px).
function layout(force) {
  const W = table.clientWidth || document.documentElement.clientWidth - 32;
  const phone = PHONE_Q.matches, gap = GAP();
  const fit = C => Math.floor((W - LAB_W - gap * C) / C);
  let m = 'bands', T = 0, K = 0, nb = 0;
  if (!phone) {
    for (let n = G.nMax; n >= 1; n--) if (fit(colsFor(n)) >= MIN_T) { nb = n; break; }
    if (nb) { m = 'grid'; T = Math.min(MAX_T, fit(colsFor(nb))); K = Math.floor((W - LAB_W) / (T + gap)); }
  }
  if (m === 'bands') {
    K = phone ? (W < 330 ? 2 : 3) : Math.max(2, Math.floor((W + gap) / (150 + gap)));
    T = Math.min(phone ? 200 : MAX_T, Math.floor((W - gap * (K - 1)) / K));
  }
  const dpr = window.devicePixelRatio || 1;
  const key = [m, K, T, nb, dpr, G.nMax, G.kind].join('|');
  if (key === layoutKey && !force) return false;
  layoutKey = key; gen++; mode = m;
  geo = { K, T, nb, gap, size: Math.max(16, Math.round((T - 2) * dpr)), row: 2 };
  table.style.setProperty('--tile', T + 'px');
  table.style.setProperty('--cols', K);
  table.className = m;
  table.textContent = '';
  if (m === 'grid') table.appendChild(Object.assign(document.createElement('div'), { className: 'corner' }));
  TILES = [];
  const target = Math.min(G.nMax, Math.max(shown, N_START));
  shown = 0;
  addShells(target);
  return true;
}

function mkTile(t, wrap) {
  const i = TILES.length;
  t.spec = tileSpec(t.n, t.l, t.m, G.kind);
  const b = document.createElement('button');
  b.className = wrap ? 'tile wrap' : 'tile'; b.dataset.i = i;
  const name = t.spec.name.split(' ');
  b.title = `${t.spec.name} · n=${t.n}, l=${t.l}, m=${fmtM(t.m)} · tap for details`;
  b.setAttribute('aria-label', `Orbital ${t.spec.name}, n ${t.n}, l ${t.l}, m ${t.m}`);
  const cv = document.createElement('canvas'); cv.width = geo.size; cv.height = geo.size;
  const lb = document.createElement('span'); lb.className = 'lbl'; lb.textContent = `(${t.n},${t.l},${fmtM(t.m)})`;
  const nm = document.createElement('span'); nm.className = 'nm';
  nm.textContent = name[0];
  const extra = [name.slice(1).join(' '), G.kind === 'real' && t.l > 0 ? '· ' + t.spec.planeLabel : ''].filter(Boolean).join(' ');
  if (extra) { const s = document.createElement('small'); s.textContent = extra; nm.appendChild(s); }
  b.append(cv, lb, nm);
  t.el = b; t.cv = cv; t.ctx = cv.getContext('2d', { alpha: false }); t.size = geo.size; t.drawn = -1;
  TILES.push(t);
  return b;
}

const shellNames = n => Array.from({ length: n }, (_, l) => n + L_LETTER[l]).join(' ');

// Append shell n to the table.
//   grid, n <= nb   one row. Tile (l, m) goes to its fixed column, under the
//                   l header. The l = n - 1 header is added with the shell.
//   grid, n > nb    a head row, then the tiles in K columns. An l group
//                   starts a new row when it does not fit the rest of the
//                   row, if it fits in a full row.
//   bands           a band with its head and a K-column grid.
function addShell(n) {
  const list = shellTiles(n, G.kind), frag = document.createDocumentFragment();
  const nlab = (cls, extra) => {
    const d = document.createElement('div'); d.className = cls;
    d.innerHTML = `<span class="nn"><i>n</i> = ${n}</span><span class="ne">${energyEV(n).toFixed(2)} eV${extra || ''}</span>`;
    return d;
  };
  if (mode === 'grid' && n <= geo.nb) {
    const l = n - 1, h = document.createElement('div'); h.className = 'lhead';
    h.style.gridColumn = `${colIndex(l, 0, G.kind) + 2} / span ${G.kind === 'complex' ? l + 1 : 2 * l + 1}`; h.style.gridRow = '1';
    h.innerHTML = `<i>${L_LETTER[l]}</i>ℓ = ${l}`;
    const lab = nlab('nlab'); lab.style.gridColumn = '1'; lab.style.gridRow = String(geo.row);
    frag.append(h, lab);
    for (const t of list) { const b = mkTile(t, false); b.style.gridColumn = String(t.col + 2); b.style.gridRow = String(geo.row); frag.appendChild(b); }
    geo.row++;
  } else if (mode === 'grid') {
    const K = geo.K, r0 = geo.row;
    let c = 0, r = 0, lPrev = -1;
    const place = [];
    for (const t of list) {
      if (t.l !== lPrev) {
        const g = G.kind === 'complex' ? t.l + 1 : 2 * t.l + 1;
        if (c > 0 && c + g > K && g <= K) { r++; c = 0; }
        lPrev = t.l;
      }
      if (c === K) { r++; c = 0; }
      place.push([t, r, c]); c++;
    }
    const head = document.createElement('div'); head.className = 'shead';
    head.style.gridColumn = `2 / span ${K}`; head.style.gridRow = String(r0);
    head.textContent = shellNames(n);
    const lab = nlab('nlab top'); lab.style.gridColumn = '1'; lab.style.gridRow = `${r0} / span ${r + 2}`;
    frag.append(head, lab);
    for (const [t, rr, cc] of place) { const b = mkTile(t, true); b.style.gridColumn = String(cc + 2); b.style.gridRow = String(r0 + 1 + rr); frag.appendChild(b); }
    geo.row = r0 + r + 2;
  } else {
    const band = document.createElement('section'); band.className = 'band';
    band.style.width = (geo.K * geo.T + (geo.K - 1) * geo.gap) + 'px';
    band.appendChild(nlab('band-head', ' · ' + shellNames(n)));
    const grid = document.createElement('div'); grid.className = 'band-grid';
    for (const t of list) grid.appendChild(mkTile(t, false));
    band.appendChild(grid); frag.appendChild(band);
  }
  table.appendChild(frag);
}

function addShells(upTo) {
  while (shown < upTo) addShell(++shown);
  const px = TILES.length * geo.size * geo.size;
  $('rdTiles').textContent = `${TILES.length} · ${mode}${mode === 'bands' ? ' ×' + geo.K : ''}`;
  $('rdPx').textContent = `${geo.size}² each · ${(px / 1e6).toFixed(2)} Mpx`;
  $('nHint').textContent = `${TILES.length} tiles, n = 1 … ${shown}` + (shown < G.nMax ? ' · scroll for more' : '');
}

// Add the next shell while the foot is less than one screen below the view.
const EXTEND_MARGIN = 900;
function maybeExtend() {
  if (!geo || shown >= G.nMax) return;
  if ($('foot').getBoundingClientRect().top > window.innerHeight + EXTEND_MARGIN) return;
  addShells(shown + 1);
  render(true);
  requestAnimationFrame(maybeExtend);
}

// ------------------------------------------------------------ render
let seq = 0, busy = false, pending = false, outstanding = 0, t0 = 0, curSeq = 0, stats = null;
const history = [];
window.__hyd = { G, history, get engine() { return engine; }, get tiles() { return TILES.length; }, render: () => render() };

// onlyNew: fill only the tiles that were never drawn (a shell just added).
function render(onlyNew) {
  if (!pool.length || !TILES.length || A.on) return;
  if (busy) { pending = true; return; }
  busy = true; pending = false;
  curSeq = ++seq; t0 = performance.now();
  stats = { fillMs: 0, colorMs: 0, fills: 0 };
  // Tiles in view go first.
  const vh = window.innerHeight;
  const order = TILES.map((t, i) => {
    const r = t.el.getBoundingClientRect();
    return { i, d: r.bottom < 0 ? -r.bottom + vh : r.top > vh ? r.top : 0 };
  }).filter(o => !onlyNew || TILES[o.i].drawn < 0).sort((a, b) => a.d - b.d);
  const jobs = pool.map(() => []), rot = poseRot();
  for (const { i } of order) {
    const t = TILES[i];
    jobs[i % pool.length].push({ id: gen * 100000 + i, n: t.n, l: t.l, m: t.m, kind: G.kind, size: t.size, rot });
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
  if (typeof d.seq === 'string') { if (d.seq[0] === 'a') animDone(d); return; }   // animation or detail
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
    if (typeof d.seq === 'string') { if (d.seq[0] === 'a') drawAnim(d.seq, it); else drawDetail(d.seq, it); continue; }
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
  pool[0].postMessage({ type: 'render', seq: tag, jobs: [{ id: -1, n: t.n, l: t.l, m: t.m, kind: G.kind, size: detailSize, rot: poseRot() }], look: look() });

  $('dName').textContent = S.name;
  $('dKet').textContent = `|${t.n}, ${t.l}, ${fmtM(t.m)}⟩`;
  $('dQN').textContent = `n = ${t.n}, l = ${t.l}, m = ${fmtM(t.m)}`;
  $('dOrb').textContent = `${S.name}${G.kind === 'complex' ? ' (complex, e^imφ)' : ' (real)'}`;
  const planeTxt = { xz: 'x–z plane (φ = 0 and 180°)', yz: 'y–z plane (φ = 90°)', xy: 'x–y plane (θ = 90°)', vert: `vertical plane at φ = ${Math.round(S.phi0 * 180 / Math.PI)}°` }[S.plane];
  $('dPlane').textContent = planeTxt + (poseRot() ? ' · orbital turned' : '');
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
  const cv = $('dCanvas');
  blit(cv.getContext('2d', { alpha: false }), it, cv.width);
}

// Draw a returned tile into a W x W canvas. An animation frame is smaller
// than the canvas, so it is scaled up.
let scratch = null;
function blit(ctx, it, W) {
  if (it.bmp) { ctx.drawImage(it.bmp, 0, 0, W, W); it.bmp.close(); return; }
  const img = new ImageData(new Uint8ClampedArray(it.buf), it.size, it.size);
  if (it.size === W) { ctx.putImageData(img, 0, 0); return; }
  scratch = scratch || document.createElement('canvas');
  scratch.width = scratch.height = it.size;
  scratch.getContext('2d').putImageData(img, 0, 0);
  ctx.drawImage(scratch, 0, 0, W, W);
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
  ctx.font = '10px Inter, system-ui, sans-serif'; ctx.fillStyle = '#8f8499'; ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
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

// ------------------------------------------------------------ animation
// The orbitals turn in 3D, and the tile planes stay fixed on the screen.
// The pose is R = Rz(az) Ry(ay) Rx(ax). Each angle grows at its own rate
// in deg/s, so two or three rates give a tumble, not one fixed axis.
// While it runs, only the tiles in view are filled, at A.scale times the
// tile CSS size. A.scale adapts so that a frame takes about FRAME_MS. A new
// frame goes out only when the last one is back, so no queue forms. If the
// detail view is open, only the large tile turns. On pause, render() fills
// every tile at full size in the current pose.
const A = { on: false, rate: [24, 0, 36], ang: [0, 0, 0], scale: 0.6, seq: 0, inflight: 0, sent: 0, last: 0, ms: 0 };
let FRAME_MS = 33;   // the screensaver hook raises it: fewer, sharper frames
function poseRot() { return A.ang.every(v => v === 0) ? null : poseMatrix(A.ang[0], A.ang[1], A.ang[2]); }

function setAnim(on) {
  if (A.on === on) return;
  A.on = on; A.last = 0; A.inflight = 0;
  if (on) requestAnimationFrame(animLoop);
  else { render(); if (detailIndex >= 0) openDetail(detailIndex); }
  syncAnim();
}

function animLoop(now) {
  if (!A.on) return;
  const dt = A.last ? Math.min(0.1, (now - A.last) / 1000) : 0;
  A.last = now;
  for (let k = 0; k < 3; k++) A.ang[k] = (A.ang[k] + A.rate[k] * dt) % 360;
  if (!A.inflight && pool.length && geo) sendFrame();
  requestAnimationFrame(animLoop);
}

function sendFrame() {
  const rot = poseMatrix(A.ang[0], A.ang[1], A.ang[2]), tag = 'a' + (++A.seq), lk = look(), K = pool.length;
  const jobs = pool.map(() => []);
  if (!$('detail').hidden && detailIndex >= 0) {
    const t = TILES[detailIndex], css = $('dCanvas').clientWidth || 400;
    jobs[0].push({ id: -1, n: t.n, l: t.l, m: t.m, kind: G.kind, size: Math.max(64, Math.min(detailSize, Math.round(css * A.scale))), rot, nocache: true });
  } else {
    const vh = window.innerHeight, size = Math.max(24, Math.round(geo.T * A.scale));
    let k = 0;
    TILES.forEach((t, i) => {
      const r = t.el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh) return;
      jobs[k++ % K].push({ id: gen * 100000 + i, n: t.n, l: t.l, m: t.m, kind: G.kind, size: Math.min(size, t.size), rot, nocache: true });
    });
  }
  A.inflight = 0; A.sent = performance.now();
  jobs.forEach((js, k) => { if (js.length) { A.inflight++; pool[k].postMessage({ type: 'render', seq: tag, jobs: js, look: lk }); } });
}

function drawAnim(tag, it) {
  if (!A.on || tag !== 'a' + A.seq) { if (it.bmp) it.bmp.close(); return; }
  if (it.id === -1) {
    if ($('detail').hidden) { if (it.bmp) it.bmp.close(); return; }
    const cv = $('dCanvas'); blit(cv.getContext('2d', { alpha: false }), it, cv.width); return;
  }
  const g = Math.floor(it.id / 100000), i = it.id % 100000, t = TILES[i];
  if (g !== gen || !t) { if (it.bmp) it.bmp.close(); return; }
  t.drawn = Math.max(t.drawn, 0);
  blit(t.ctx, it, t.size);
}

function animDone(d) {
  if (d.seq !== 'a' + A.seq || --A.inflight > 0) return;
  const ms = performance.now() - A.sent;
  A.ms = A.ms ? A.ms * 0.8 + ms * 0.2 : ms;
  if (ms > FRAME_MS * 1.3) A.scale = Math.max(0.25, A.scale * 0.88);
  else if (ms < FRAME_MS * 0.6) A.scale = Math.min(window.devicePixelRatio || 1, A.scale * 1.06);
  syncAnim();
}

function syncAnim() {
  const f = v => Math.round(((v % 360) + 360) % 360) + '°';
  $('rdPose').textContent = `x ${f(A.ang[0])} · y ${f(A.ang[1])} · z ${f(A.ang[2])}`;
  $('rdFrame').textContent = A.on ? `${A.ms.toFixed(0)} ms · ${Math.round(A.scale * 100)}% size` : 'paused';
  $('playBtn').textContent = A.on ? '❚❚ PAUSE' : '▶ ROTATE';
  $('playBtn').classList.toggle('on', A.on);
  $('dockPlay').textContent = A.on ? '❚❚' : '▶';
  $('dockPlay').classList.toggle('on', A.on);
  $('dockPlay').setAttribute('aria-label', A.on ? 'Pause rotation' : 'Rotate');
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
    ['rx', 'ry', 'rz'].forEach((id, k) => { $(id + 'V').textContent = `${A.rate[k]}°/s`; });
    syncAnim();
    $('kindHint').textContent = G.kind === 'complex'
      ? 'm = 0 … l. The density of −m is the same as of +m.'
      : 'm = 0, +1, −1 … Each tile is cut through its lobes. Its plane shows at the top left.';
    document.body.classList.toggle('real', G.kind === 'real');
    window.HydEq && window.HydEq.setKind(G.kind);
    drawColorbar();
  };
  const relayout = () => { sync(); layout(true); render(); maybeExtend(); };
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

  // rotation
  ['rx', 'ry', 'rz'].forEach((id, k) => {
    $(id).value = A.rate[k];
    $(id).addEventListener('input', e => { A.rate[k] = +e.target.value; sync(); });
  });
  $('playBtn').addEventListener('click', () => setAnim(!A.on));
  $('dockPlay').addEventListener('click', () => setAnim(!A.on));
  $('poseReset').addEventListener('click', () => {
    A.ang = [0, 0, 0];
    if (!A.on) { render(); if (detailIndex >= 0) openDetail(detailIndex); }
    syncAnim();
  });

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

// ------------------------------------------------------------ start
buildUI();
layout(true);
let rsTimer = 0;
new ResizeObserver(() => { clearTimeout(rsTimer); rsTimer = setTimeout(() => { if (layout(false)) { render(); maybeExtend(); } }, 90); }).observe(table);
new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) maybeExtend(); }, { rootMargin: `0px 0px ${EXTEND_MARGIN}px 0px` }).observe($('foot'));
requestAnimationFrame(maybeExtend);
startPool().then(() => { $('rdEngine').textContent = engine; render(); });

// ------------------------------------------------------------ screensaver
// The plate for opts.label (the shell draws it at the lower right). It names
// the orbital in the detail view and copies the node, energy and <r> text
// that openDetail wrote. The radial factor is written out from physics.js:
// ρ = 2r/n, R ∝ ρ^l e^(−ρ/2) L_k^(2l+1)(ρ) with k = n − l − 1. Each term of
// k!·L_k^a(ρ) = Σ (−1)^i C(k+a, k−i) (k!/i!) ρ^i is an integer.
const SUP_D = '⁰¹²³⁴⁵⁶⁷⁸⁹', SUB_D = '₀₁₂₃₄₅₆₇₈₉';
const sup = v => String(v).replace(/\d/g, c => SUP_D[c]);
const sub = v => String(v).replace(/\d/g, c => SUB_D[c]).replace('-', '₋');
const fact = k => { let f = 1; for (let i = 2; i <= k; i++) f *= i; return f; };
const binom = (a, b) => (b < 0 || b > a ? 0 : fact(a) / (fact(b) * fact(a - b)));
function laguerreText(k, a) {
  if (k === 0) return '';
  let s = '';
  for (let i = 0; i <= k; i++) {
    const c = binom(k + a, k - i) * fact(k) / fact(i), pw = i === 0 ? '' : i === 1 ? 'ρ' : 'ρ' + sup(i);
    s += (i % 2 ? ' − ' : i ? ' + ' : '') + (c === 1 && i ? pw : c + pw);
  }
  return ' · (' + s + ')' + (k > 1 ? '/' + fact(k) : '');
}
function saverPlate(t) {
  const { n, l, m } = t, am = Math.abs(m), k = n - l - 1, real = G.kind === 'real';
  const rho = (l === 0 ? '' : l === 1 ? 'ρ' : 'ρ' + sup(l)) + 'e^(−ρ/2)';
  const P = 'P' + sub(l) + (am ? sup(am) : '') + '(cos θ)';
  const ang = m === 0 ? 'Y' + sub(l) + '₀ = N' + sub(l) + '₀ ' + P
    : real ? 'Y = √2 N' + sub(l) + sub(am) + ' ' + P + ' · ' + (m > 0 ? 'cos ' : 'sin ') + (am === 1 ? '' : am) + 'φ'
    : 'Y' + sub(l) + sub(m) + ' = N' + sub(l) + sub(am) + ' ' + P + ' · e^(' + (m < 0 ? '−' : '') + 'i' + (am === 1 ? '' : am) + 'φ)';
  const txt = id => ($(id) && $(id).textContent) || '';
  return {
    title: 'Hydrogen ' + t.spec.name + ' orbital',
    sub: real ? 'real orbital' : 'complex orbital, e^imφ',
    lines: [
      '|' + n + ', ' + l + ', ' + fmtM(m) + '⟩ · n = ' + n + ' (shell) · l = ' + l + ' (' + L_LETTER[l] + ') · m = ' + fmtM(m),
      'E' + sub(n) + ' = ' + txt('dE').replace(/-/g, '−'),
      'Radial nodes: ' + txt('dRad'),
      'Angular nodes: ' + txt('dAng'),
      '⟨r⟩ = (3n² − l(l+1))/2 = ' + txt('dR'),
      'Cut: ' + txt('dPlane'),
    ],
    eq: [
      'ψ' + sub(n) + sub(l) + sub(m) + '(r,θ,φ) = R' + sub(n) + sub(l) + '(r) · Y(θ,φ)',
      'R' + sub(n) + sub(l) + '(r) ∝ ' + rho + laguerreText(k, 2 * l + 1),
      'ρ = 2r / ' + n + 'a₀',
      ang,
      'Eₙ = −13.6057 eV / n²',
    ],
  };
}

// Hook for the shell screensaver (lib/screensaver.js). The table has no one
// canvas to record, so the hook opens the detail view of one orbital, turns
// it slowly with the rotation, and copies #dCanvas each frame into a new
// window-size canvas (#svCanvas) on the darkest colour of the map. The name
// and ket of the orbital go at the lower left of that canvas. Each orbital
// shows for seconds / 3, and the copy fades to the background across each
// change. opts.calm (1 = slowest) sets the turn rates; opts.seed picks the
// orbitals (n = 2 to 4, l > 0) and the real or complex form. FRAME_MS is raised
// so that the adaptive size stays high. The fonts are the page's own.
// No exit(): the shell reloads the page on stop.
window.snSaver = {
  enter(o = {}) {
    const calm = Math.max(0, Math.min(1, o.calm ?? 0.7)), secs = Math.max(20, +o.seconds || 60);
    let r = (o.seed >>> 0) || 1;
    const rnd = () => (r = (r * 1664525 + 1013904223) >>> 0) / 4294967296;
    const dpr = window.devicePixelRatio || 1;
    const sv = document.createElement('canvas'); sv.id = 'svCanvas';
    document.body.appendChild(sv);
    const st = document.createElement('style');
    st.textContent = 'body *{visibility:hidden!important}#svCanvas{visibility:visible!important;position:fixed;inset:0;width:100vw;height:100vh;z-index:9999;cursor:none}html,body{overflow:hidden!important}';
    document.head.appendChild(st);
    const size = () => { sv.width = Math.round(innerWidth * dpr); sv.height = Math.round(innerHeight * dpr); };
    size(); window.addEventListener('resize', size);
    const ctx = sv.getContext('2d', { alpha: false });
    const k = 1 - 0.6 * calm;
    A.rate = [6 * k, 2 * k, 9 * k]; FRAME_MS = 120;
    const plate = typeof o.label === 'function' ? o.label : null;
    const css = getComputedStyle(document.documentElement);
    const serif = css.getPropertyValue('--serif').trim() || 'serif', sans = css.getPropertyValue('--sans').trim() || 'sans-serif';
    let alpha = 0, label = null;
    const fadeMs = (0.8 + 1.2 * calm) * 1000, hold = Math.max(8, secs / 3) * 1000;
    (function draw() {
      requestAnimationFrame(draw);
      const L = lut(G.cmap === 'signed' ? 'inferno' : G.cmap), W = sv.width, H = sv.height;
      ctx.globalAlpha = 1; ctx.fillStyle = `rgb(${L[0]},${L[1]},${L[2]})`; ctx.fillRect(0, 0, W, H);
      if (alpha <= 0 || detailIndex < 0) return;
      const d = $('dCanvas'), side = Math.round(Math.min(W, H) * 0.96);
      ctx.globalAlpha = alpha; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(d, (W - side) / 2, (H - side) / 2, side, side);
      if (label) {
        const f = Math.round(H / 34);
        ctx.fillStyle = 'rgba(238,232,240,0.78)'; ctx.font = `italic 600 ${Math.round(f * 1.5)}px ${serif}`;
        ctx.fillText(label[0], f * 1.6, H - f * 2.9);
        ctx.fillStyle = 'rgba(200,190,205,0.6)'; ctx.font = `${f}px ${sans}`;
        ctx.fillText(label[1], f * 1.6, H - f * 1.5);
      }
    })();
    const wait = ms => new Promise(res => setTimeout(res, ms));
    const fadeTo = to => new Promise(res => {
      const from = alpha, t0 = performance.now();
      const step = now => { const q = Math.min(1, (now - t0) / fadeMs); alpha = from + (to - from) * q * q * (3 - 2 * q); if (q < 1) requestAnimationFrame(step); else res(); };
      requestAnimationFrame(step);
    });
    const show = () => {
      const kind = rnd() < 0.65 ? 'real' : 'complex';
      if (G.kind !== kind) document.querySelector(`[data-kind="${kind}"]`).click();
      const pick = TILES.map((t, i) => i).filter(i => TILES[i].n >= 2 && TILES[i].n <= 4 && TILES[i].l > 0);
      const i = pick[Math.floor(rnd() * pick.length)];
      openDetail(i);
      const t = TILES[i], side = Math.round(Math.min(innerWidth, innerHeight) * 0.96), cv = $('dCanvas');
      cv.style.setProperty('--dsize', side + 'px');
      detailSize = Math.min(1800, Math.round(side * dpr));
      if (cv.width !== detailSize) { cv.width = detailSize; cv.height = detailSize; }
      label = [t.spec.name, `|${t.n}, ${t.l}, ${fmtM(t.m)}⟩  ·  ${G.kind === 'real' ? 'real orbital' : 'complex, e^imφ'}`];
      if (plate) plate(saverPlate(t));
    };
    (async () => {
      while (!pool.length || !TILES.length) await wait(100);
      A.ang = [rnd() * 360, 0, rnd() * 360];
      setAnim(true);
      for (;;) {
        show();
        await wait(600);
        await fadeTo(1);
        await wait(hold);
        await fadeTo(0);
      }
    })();
    return { canvas: sv, warmupMs: 2500 };
  },
};
