// ============================================================================
//  GROWTH GRADIENTS  ·  heatmap gradients and the "choose a gradient" picker
// ----------------------------------------------------------------------------
//  The colour ramps of the growth pages (dlaf, plant-growth, coral-reef).
//  A page maps one value of each particle or branch to t in 0..1 (age,
//  depth, distance, flow) and colours it with a gradient. The picker is a
//  row of swatch buttons, like the colormap swatches of reaction-diffusion
//  and fluidlab, with a reverse toggle.
//
//  The data part is DOM-free (node tests import it). mountGradientPicker()
//  needs a document. Styles: lib/growth-gradients.css.
//
//  USE
//    import { GRADIENTS, sample, lut, cssGradient, mountGradientPicker } from '../../lib/growth-gradients.js';
//    sample('inferno', 0.4)            -> [r, g, b] in 0..1
//    lut('inferno', 256, rev)          -> Uint8Array(256 * 4) RGBA, a texture row
//    cssGradient('inferno')            -> 'linear-gradient(90deg, ...)'
//    const pick = mountGradientPicker(el, { value: 'inferno', ids, onChange(id, reversed) {} });
//    pick.set('viridis'); pick.value; pick.reversed
//
//  grep -n targets
//    the gradient table ... "export const GRADIENTS"
//    one colour ........... "export function sample"
//    texture row .......... "export function lut"
//    picker ............... "export function mountGradientPicker"
// ============================================================================

// Stops are [pos, [r, g, b]] with pos in 0..1 and r g b in 0..255. The
// matplotlib maps (inferno, magma, plasma, viridis, cividis) and turbo are
// sampled at 9 points from their published tables.
export const GRADIENTS = {
  inferno: { label: 'Inferno', stops: [
    [0, [0, 0, 4]], [0.125, [31, 12, 72]], [0.25, [85, 15, 109]], [0.375, [136, 34, 106]],
    [0.5, [186, 54, 85]], [0.625, [227, 89, 51]], [0.75, [249, 140, 10]], [0.875, [249, 201, 50]], [1, [252, 255, 164]]] },
  magma: { label: 'Magma', stops: [
    [0, [0, 0, 4]], [0.125, [28, 16, 68]], [0.25, [79, 18, 123]], [0.375, [129, 37, 129]],
    [0.5, [181, 54, 122]], [0.625, [229, 80, 100]], [0.75, [251, 135, 97]], [0.875, [254, 194, 135]], [1, [252, 253, 191]]] },
  plasma: { label: 'Plasma', stops: [
    [0, [13, 8, 135]], [0.125, [65, 4, 157]], [0.25, [106, 0, 168]], [0.375, [143, 13, 164]],
    [0.5, [177, 42, 144]], [0.625, [204, 71, 120]], [0.75, [225, 100, 98]], [0.875, [242, 132, 75]], [1, [240, 249, 33]]] },
  viridis: { label: 'Viridis', stops: [
    [0, [68, 1, 84]], [0.125, [72, 36, 117]], [0.25, [59, 82, 139]], [0.375, [44, 114, 142]],
    [0.5, [33, 145, 140]], [0.625, [40, 174, 128]], [0.75, [94, 201, 98]], [0.875, [173, 220, 48]], [1, [253, 231, 37]]] },
  cividis: { label: 'Cividis', stops: [
    [0, [0, 34, 78]], [0.25, [54, 70, 107]], [0.5, [124, 123, 120]], [0.75, [192, 178, 100]], [1, [254, 232, 56]]] },
  turbo: { label: 'Turbo', stops: [
    [0, [48, 18, 59]], [0.125, [70, 107, 227]], [0.25, [40, 187, 236]], [0.375, [49, 242, 153]],
    [0.5, [162, 252, 60]], [0.625, [237, 208, 58]], [0.75, [251, 128, 34]], [0.875, [209, 49, 6]], [1, [122, 4, 3]]] },
  ember: { label: 'Ember', stops: [
    [0, [12, 4, 2]], [0.25, [96, 14, 6]], [0.5, [200, 52, 10]], [0.72, [255, 140, 30]], [0.9, [255, 214, 120]], [1, [255, 250, 230]]] },
  ice: { label: 'Ice', stops: [
    [0, [4, 6, 19]], [0.22, [30, 40, 92]], [0.45, [55, 100, 164]], [0.7, [118, 178, 212]], [0.88, [190, 232, 240]], [1, [246, 255, 255]]] },
  reef: { label: 'Reef', stops: [
    [0, [10, 30, 70]], [0.25, [18, 110, 130]], [0.5, [120, 210, 180]], [0.7, [250, 160, 150]], [0.85, [255, 110, 90]], [1, [255, 220, 120]]] },
  forest: { label: 'Forest', stops: [
    [0, [52, 34, 20]], [0.25, [104, 72, 36]], [0.45, [70, 110, 40]], [0.7, [110, 170, 60]], [0.88, [190, 220, 90]], [1, [255, 214, 230]]] },
  aurora: { label: 'Aurora', stops: [
    [0, [8, 10, 40]], [0.3, [30, 90, 160]], [0.55, [40, 220, 150]], [0.78, [190, 120, 230]], [1, [255, 240, 250]]] },
  spectral: { label: 'Spectral', stops: [
    [0, [94, 79, 162]], [0.14, [50, 136, 189]], [0.28, [102, 194, 165]], [0.42, [171, 221, 164]],
    [0.57, [230, 245, 152]], [0.71, [254, 224, 139]], [0.85, [244, 109, 67]], [1, [158, 1, 66]]] },
  mono: { label: 'Mono', stops: [[0, [30, 32, 38]], [1, [245, 245, 240]]] },
};

export const GRADIENT_IDS = Object.keys(GRADIENTS);

// [r, g, b] in 0..1, linear between stops. rev reads the gradient from the end.
export function sample(id, t, rev = false, out = [0, 0, 0]) {
  const g = (GRADIENTS[id] || GRADIENTS.inferno).stops;
  t = Math.min(1, Math.max(0, +t || 0)); if (rev) t = 1 - t;
  let i = 1; while (i < g.length - 1 && g[i][0] < t) i++;
  const a = g[i - 1], b = g[i], f = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 0;
  const f2 = Math.min(1, Math.max(0, f));
  out[0] = (a[1][0] + (b[1][0] - a[1][0]) * f2) / 255;
  out[1] = (a[1][1] + (b[1][1] - a[1][1]) * f2) / 255;
  out[2] = (a[1][2] + (b[1][2] - a[1][2]) * f2) / 255;
  return out;
}

// RGBA bytes of n samples: one texture row, or a lookup table on the CPU.
export function lut(id, n = 256, rev = false) {
  const o = new Uint8Array(n * 4), c = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    sample(id, n === 1 ? 0 : i / (n - 1), rev, c);
    o[i * 4] = Math.round(c[0] * 255); o[i * 4 + 1] = Math.round(c[1] * 255); o[i * 4 + 2] = Math.round(c[2] * 255); o[i * 4 + 3] = 255;
  }
  return o;
}

export function cssGradient(id, rev = false, dir = '90deg') {
  const g = (GRADIENTS[id] || GRADIENTS.inferno).stops;
  const parts = g.map(([p, [r, gg, b]]) => `rgb(${r},${gg},${b}) ${((rev ? 1 - p : p) * 100).toFixed(1)}%`);
  if (rev) parts.reverse();
  return `linear-gradient(${dir},${parts.join(',')})`;
}

// A row of gradient swatches and a reverse toggle in el. Returns a handle.
// opts: value, reversed, ids (subset and order), label (heading text or
// null), onChange(id, reversed).
export function mountGradientPicker(el, opts = {}) {
  const ids = (opts.ids || GRADIENT_IDS).filter(id => GRADIENTS[id]);
  const st = { value: ids.includes(opts.value) ? opts.value : ids[0], reversed: !!opts.reversed };
  el.classList.add('gg-picker');
  el.innerHTML = '';
  if (opts.label !== null) {
    const h = document.createElement('div'); h.className = 'gg-head';
    h.innerHTML = `<span>${opts.label || 'Choose a gradient'}</span><span class="gg-name"></span>`;
    el.appendChild(h);
  }
  const row = document.createElement('div'); row.className = 'gg-row'; row.setAttribute('role', 'radiogroup');
  row.setAttribute('aria-label', opts.label || 'Choose a gradient');
  el.appendChild(row);
  const btns = ids.map(id => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'gg-sw'; b.dataset.id = id; b.title = GRADIENTS[id].label;
    b.setAttribute('role', 'radio'); b.setAttribute('aria-label', GRADIENTS[id].label);
    b.addEventListener('click', () => { set(id); });
    row.appendChild(b);
    return b;
  });
  const rv = document.createElement('label'); rv.className = 'gg-rev';
  rv.innerHTML = '<input type="checkbox"><span>Reverse</span>';
  const cb = rv.querySelector('input'); cb.checked = st.reversed;
  cb.addEventListener('change', () => { st.reversed = cb.checked; paint(); fire(); });
  el.appendChild(rv);
  function paint() {
    btns.forEach(b => {
      const on = b.dataset.id === st.value;
      b.style.background = cssGradient(b.dataset.id, st.reversed);
      b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    const n = el.querySelector('.gg-name'); if (n) n.textContent = GRADIENTS[st.value].label;
  }
  function fire() { if (opts.onChange) opts.onChange(st.value, st.reversed); }
  function set(id, rev) {
    if (!GRADIENTS[id]) return;
    const changed = id !== st.value || (rev !== undefined && !!rev !== st.reversed);
    st.value = id; if (rev !== undefined) { st.reversed = !!rev; cb.checked = st.reversed; }
    paint(); if (changed) fire();
  }
  paint();
  return { set, get value() { return st.value; }, get reversed() { return st.reversed; }, el };
}
