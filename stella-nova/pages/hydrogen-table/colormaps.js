/* ============================================================================
   HYDROGEN TABLE  ·  color maps  (pure ES module, no DOM)
   ----------------------------------------------------------------------------
   Each map is a list of 17 stops. inferno and magma are the matplotlib maps,
   sampled at 0, 1/16 ... 1. viridis is the matplotlib map with a black
   lead-in, so the tiles fade into the black page. ice is a cold ramp for this
   page. lut(name) spreads the stops over 256 RGB entries.
   worker.js colors the tiles with these tables. main.js draws the colorbar
   with the same tables, so the bar and the tiles agree.

   The SIGNED map uses two ramps: POS (inferno) for psi > 0 and NEG (a cold
   ramp) for psi < 0. The brightness still follows |psi|^2.

   COLOR. colorize takes the field s = psi / max|psi| of one tile. The
   density is d = s^2.
     linear   t = min(1, d * exposure) ^ gamma
     log      t = clamp(1 + log10(d * exposure) / decades) ^ gamma
   The ramp maps t to RGB. The linear path reads t from a table over |s|, so
   it needs no pow per pixel. The signed map takes the ramp from the sign of s.
   worker.js calls colorize. main.js calls it too when no worker can start.

   GREP MAP
     grep -n 'const STOPS'             the stop lists
     grep -n 'export function lut'     256-entry RGB table of one ramp
     grep -n 'export function colorize'  field to RGBA pixels
   ========================================================================== */
export const STOPS = {
  inferno: '000004,0b0724,210c4a,3d0965,57106e,71196e,8a226a,a32c61,bc3754,d24644,e45a31,f1731d,f98e09,fcac11,f9cb35,f2ea69,fcffa4',
  magma:   '000004,0a0822,1d1147,36106b,51127c,6a1c81,832681,9c2e7f,b73779,d0416f,e75263,f56b5c,fc8961,fea772,fec488,fde2a3,fcfdbf',
  viridis: '000000,1d0a2e,3a1554,48186a,472d7b,424086,3b528b,2c728e,21918c,1fa088,28ae80,3fbc73,5ec962,84d44b,addc30,d8e219,fde725',
  ice:     '000000,05070f,0a1024,0f1a3c,132554,173170,1b3e8a,1f4ea2,2562b5,2f77c3,3f8dce,55a3d8,70b8e0,90cce8,b2dff0,d6eff8,ffffff',
};

export const MAPS = [
  { id: 'inferno', label: 'INFERNO' },
  { id: 'magma',   label: 'MAGMA' },
  { id: 'viridis', label: 'VIRIDIS' },
  { id: 'ice',     label: 'ICE' },
  { id: 'signed',  label: '± ψ SIGN' },
];

function parse(s) { return s.split(',').map(h => [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))); }

const cache = new Map();
export function lut(name) {
  if (cache.has(name)) return cache.get(name);
  const st = parse(STOPS[name] || STOPS.inferno), out = new Uint8Array(256 * 3), k = st.length - 1;
  for (let i = 0; i < 256; i++) {
    const x = i / 255 * k, a = Math.min(Math.floor(x), k - 1), f = x - a;
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(st[a][c] + (st[a + 1][c] - st[a][c]) * f);
  }
  cache.set(name, out);
  return out;
}

// The transfer for the linear path: color index as a function of |s|.
const TN = 8192;
let tKey = '', tLin = null, tPow = null;
function transfer(look) {
  const key = `${look.gamma}|${look.exposure}`;
  if (key === tKey) return;
  tKey = key; tLin = new Uint8Array(TN + 1); tPow = new Uint8Array(4097);
  for (let i = 0; i <= TN; i++) { const s = i / TN, t = Math.min(1, s * s * look.exposure); tLin[i] = Math.round(Math.pow(t, look.gamma) * 255); }
  for (let i = 0; i <= 4096; i++) tPow[i] = Math.round(Math.pow(i / 4096, look.gamma) * 255);
}

export function colorize(f, size, look) {
  transfer(look);
  const px = new Uint8ClampedArray(size * size * 4);
  const signed = look.cmap === 'signed';
  const P = lut(signed ? 'inferno' : look.cmap), Nn = lut('ice');
  const lg = look.log, k10 = 1 / (Math.LN10 * look.decades), lexp = Math.log10(look.exposure) / look.decades;
  for (let i = 0, o = 0; i < f.length; i++, o += 4) {
    const s = f[i], a = s < 0 ? -s : s;
    let c;
    if (lg) {
      let t = a > 0 ? 1 + 2 * Math.log(a) * k10 + lexp : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      c = tPow[(t * 4096) | 0];
    } else c = tLin[(a * TN) | 0];
    const L = signed && s < 0 ? Nn : P, q = c * 3;
    px[o] = L[q]; px[o + 1] = L[q + 1]; px[o + 2] = L[q + 2]; px[o + 3] = 255;
  }
  return px;
}

