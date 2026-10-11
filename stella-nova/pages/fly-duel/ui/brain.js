// ============================================================================
//  FLY DUEL  ·  brain view  (2D canvas, no DOM access of its own)
// ----------------------------------------------------------------------------
//  Draws one mushroom body as a turning point cloud. The positions come from
//  data/connectome.json (package B), in micrometres. The view uses "cen"
//  (the cable centroid of each neuron, where its wiring is) when the file
//  has it, else "pos" (the soma). It projects them with a small
//  perspective onto a 2D canvas. Points far from the KC cloud are pulled
//  in toward it (radial compression past the KC radius), so the view is
//  a schematic of positions, not to scale at the edges.
//
//  What lights up, per decision of the fly (trace from brain/fly.js):
//    PN    projection neurons, coloured by their rate (the board "smell")
//    KC    Kenyon cells: dim when silent, bright when in the active set
//    MBON  output neurons, as bars under the cloud: height = rate,
//          colour = valence (+1 approach, -1 avoid, 0 not known)
//  A DAN burst comes from the TD error delta of the decision:
//    delta > 0  PAM cluster flashes (reward signal)
//    delta < 0  PPL1 cluster flashes (punishment signal)
//  The burst also rings the MBONs in the compartments of those DANs.
//
//  The trace shape belongs to package C. normTrace() accepts the likely
//  field names: pn | pnRates, kc | activeKc | kcActive, mbon | mbonRates.
//
//  GREP MAP
//      grep -n 'export function normTrace'   trace adapter
//      grep -n 'export function project'     3D -> 2D with perspective
//      grep -n 'export class BrainView'      the view
//      grep -n 'setTrace'                    a new decision arrives
//      grep -n 'burst('                      a DAN burst
//      grep -n 'draw(g'                      one frame
// ============================================================================

import { TOKENS, KC_TYPE, FLY, rgb, font } from './tokens.js';

// Colours as [r, g, b], all from ui/tokens.js (DESIGN.md 1.1).
export const COL = {
  pn: rgb(TOKENS.pn), kcab: rgb(KC_TYPE.ab), kcapbp: rgb(KC_TYPE.apbp), kcg: rgb(KC_TYPE.g), kc: rgb(TOKENS['kc-off']),
  on: rgb(TOKENS['kc-on']), app: rgb(TOKENS.app), avoid: rgb(TOKENS.avoid), neu: rgb(TOKENS.none), pam: rgb(TOKENS.app), ppl1: rgb(TOKENS.avoid), dan: rgb(TOKENS.faint),
  flyA: rgb(FLY[0]), flyB: rgb(FLY[1]), ink: rgb(TOKENS.ink), dim: rgb(TOKENS.dim),
};
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// Trace adapter. Gives { pn: Float32Array|null, kc: number[]|Uint16Array|null,
// mbon: Float32Array|null }.
export function normTrace(t) {
  if (!t) return { pn: null, kc: null, mbon: null };
  return {
    pn: t.pn ?? t.pnRates ?? t.PN ?? null,
    kc: t.kc ?? t.activeKc ?? t.kcActive ?? t.KC ?? null,
    mbon: t.mbon ?? t.mbonRates ?? t.mbonOut ?? t.MBON ?? null,
  };
}

// Rotate points about their centre (yaw about the vertical axis, then
// pitch) and project. out holds x, y, depth per point. Returns out.
export function project(pos, centre, scale, yaw, pitch, cx, cy, out) {
  const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const n = pos.length;
  if (!out || out.length < n * 3) out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const p = pos[i];
    const x = (p[0] - centre[0]) * scale, y = (p[1] - centre[1]) * scale, z = (p[2] - centre[2]) * scale;
    const x1 = x * cyw + z * syw, z1 = -x * syw + z * cyw;
    const y1 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
    const k = 1 / (1 + z2 * PERSP);
    out[i * 3] = cx + x1 * k; out[i * 3 + 1] = cy + y1 * k; out[i * 3 + 2] = z2;
  }
  return out;
}

// perspective strength and the cloud radius as a share of the view size
export const PERSP = 0.22, FILL = 0.5;
const validPos = a => Array.isArray(a) && a.length > 0 && Array.isArray(a[0]) && a[0].length >= 3;

export class BrainView {
  // connectome: the JSON of data/connectome.json. side: 'A' | 'B' (only for
  // the label and a small yaw offset, so two views do not look identical).
  constructor(connectome, { side = 'A', label = '' } = {}) {
    this.side = side; this.label = label;
    this.yaw = side === 'B' ? 0.9 : 0.3; this.pitch = -0.35; this.spin = 0.12; this.drag = false;
    this.ok = !!(connectome && validPos(connectome.kc?.pos));
    // pts[k] = the positions this view draws for class k
    this.pts = {};
    if (this.ok) for (const k of ['pn', 'kc', 'mbon', 'dan']) {
      const o = connectome[k];
      this.pts[k] = validPos(o?.cen) && o.cen.length === o.pos?.length ? o.cen : validPos(o?.pos) ? o.pos : null;
    }
    this.c = connectome;
    this.trace = normTrace(null);
    this.kcOn = null; this.pulse = 0; this.dan = 0; this.danSign = 0; this.value = null;
    this.mbonMax = 1e-6;
    if (!this.ok) return;
    // Centre on the KC cloud. KCs sit within about 50 um of their centre,
    // PN and DAN centroids reach more than twice as far. So points past the
    // KC radius R0 are pulled in: r' = R0 + (r - R0) * k, with the farthest
    // point at 1.6 R0. The KC cloud then fills most of the view.
    const kp = this.pts.kc;
    let cx = 0, cy = 0, cz = 0;
    for (const p of kp) { cx += p[0]; cy += p[1]; cz += p[2]; }
    cx /= kp.length; cy /= kp.length; cz /= kp.length;
    const kd = kp.map(p => Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz)).sort((a, b) => a - b);
    const R0 = Math.max(1e-6, kd[Math.floor(0.99 * (kd.length - 1))]);
    let rmax = R0;
    for (const k of ['pn', 'mbon', 'dan']) for (const p of this.pts[k] || []) rmax = Math.max(rmax, Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz));
    const kk = rmax > R0 ? (0.6 * R0) / (rmax - R0) : 1;
    for (const k of ['pn', 'kc', 'mbon', 'dan']) {
      if (!this.pts[k]) continue;
      this.pts[k] = this.pts[k].map(p => {
        const dx = p[0] - cx, dy = p[1] - cy, dz = p[2] - cz, r = Math.hypot(dx, dy, dz);
        const f = r > R0 ? (R0 + (r - R0) * kk) / r : 1;
        return [cx + dx * f, cy + dy * f, cz + dz * f];
      });
    }
    this.centre = [cx, cy, cz]; this.unit = 1 / (1.6 * R0);
    this.kcCol = (connectome.kc.types || []).map(t => {
      const s = String(t);
      if (/g/i.test(s) && !/a/i.test(s)) return COL.kcg;
      if (/'|p/.test(s)) return COL.kcapbp;
      if (/ab/i.test(s)) return COL.kcab;
      return COL.kc;
    });
    this.buf = {};
    // MBON order for the bars: approach first, then neutral, then avoid
    const nm = this.pts.mbon ? this.pts.mbon.length : 0;
    const val = connectome.mbon?.valence || [];
    this.mbonOrder = [...Array(nm).keys()].sort((a, b) => (val[b] ?? 0) - (val[a] ?? 0));
    // DAN cluster and the MBONs each DAN gates, for the burst ring
    this.danCluster = (connectome.dan?.cluster || []).map(s => /PAM/i.test(s) ? 1 : /PPL1/i.test(s) ? -1 : 0);
    this.danToMbon = new Map();
    for (const e of connectome.edges?.dan_mbon_compartment || []) {
      if (!this.danToMbon.has(e[0])) this.danToMbon.set(e[0], []);
      this.danToMbon.get(e[0]).push(e[1]);
    }
    this.pnKc = null; // built on first use: kc -> pn list, for the claw lines
  }

  // A new decision: trace from fly.choose, value of the chosen afterstate.
  setTrace(trace, value = null) {
    this.trace = normTrace(trace);
    this.value = value;
    if (this.ok) {
      const n = this.pts.kc.length;
      if (!this.kcOn || this.kcOn.length !== n) this.kcOn = new Uint8Array(n);
      this.kcOn.fill(0);
      for (const i of this.trace.kc || []) if (i >= 0 && i < n) this.kcOn[i] = 1;
      const mb = this.trace.mbon;
      if (mb) { let m = 1e-6; for (const v of mb) m = Math.max(m, Math.abs(v)); this.mbonMax = Math.max(m, this.mbonMax * 0.8); }
    }
    this.pulse = 1;
  }

  // A DAN burst for TD error delta. The size of the flash follows |delta|.
  burst(delta) {
    if (!Number.isFinite(delta) || Math.abs(delta) < 1e-4) return;
    this.danSign = Math.sign(delta);
    this.dan = Math.min(1, 0.35 + Math.abs(delta) * 2);
    this.lastDelta = delta;
  }

  claws() {
    if (this.pnKc) return this.pnKc;
    const m = new Map();
    for (const e of this.c.edges?.pn_kc || []) { if (!m.has(e[1])) m.set(e[1], []); m.get(e[1]).push(e[0]); }
    return (this.pnKc = m);
  }

  draw(g, w, h, dt = 0.016) {
    g.clearRect(0, 0, w, h);
    if (!this.ok) {
      g.fillStyle = TOKENS.dim; g.font = font(13); g.textAlign = 'center';
      g.fillText(this.label ? `${this.label}: waiting for data/connectome.json` : 'waiting for data/connectome.json', w / 2, h / 2);
      g.textAlign = 'left';
      return;
    }
    if (!this.drag) this.yaw += this.spin * dt;
    this.pulse = Math.max(0, this.pulse - dt * 1.2);
    this.dan = Math.max(0, this.dan - dt * 1.4);
    const barsH = Math.max(34, Math.min(76, h * 0.24));
    const ch = h - barsH - 6;
    const s = Math.min(w, ch) * FILL;
    const cx = w / 2, cy = ch / 2 + 4;
    const B = this.buf, C = this.c, PT = this.pts;
    const P = (k) => (B[k] = project(PT[k], this.centre, this.unit, this.yaw, this.pitch, 0, 0, B[k]));
    const tx = (a, i) => cx + a[i * 3] * s, ty = (a, i) => cy + a[i * 3 + 1] * s;
    const kc = P('kc'), nk = PT.kc.length;
    const pn = PT.pn ? P('pn') : null;
    const mb = PT.mbon ? P('mbon') : null;
    const dn = PT.dan ? P('dan') : null;
    const dot = Math.max(1, Math.min(2.2, s / 120));

    // silent KCs: one fill per lobe colour
    const groups = new Map();
    for (let i = 0; i < nk; i++) {
      if (this.kcOn && this.kcOn[i]) continue;
      const col = this.kcCol[i] || COL.kc;
      if (!groups.has(col)) groups.set(col, []);
      groups.get(col).push(i);
    }
    for (const [col, ids] of groups) {
      g.fillStyle = rgba(col, 0.22);
      for (const i of ids) g.fillRect(tx(kc, i) - dot / 2, ty(kc, i) - dot / 2, dot, dot);
    }
    // PNs coloured by rate
    if (pn) {
      const r = this.trace.pn;
      for (let i = 0; i < PT.pn.length; i++) {
        const v = r ? Math.min(1, Math.max(0, r[i] || 0)) : 0;
        g.fillStyle = rgba(COL.pn, 0.18 + 0.8 * v);
        const d = dot * (1.2 + v * 1.6);
        g.fillRect(tx(pn, i) - d / 2, ty(pn, i) - d / 2, d, d);
      }
    }
    // claw lines and active KCs, additive
    g.save(); g.globalCompositeOperation = 'lighter';
    if (this.kcOn && pn && this.pulse > 0) {
      const claws = this.claws(); let lines = 0;
      g.strokeStyle = rgba(COL.pn, 0.10 * this.pulse); g.lineWidth = 0.6; g.beginPath();
      for (const i of this.trace.kc || []) {
        const ps = claws.get(i); if (!ps) continue;
        for (const p of ps) { g.moveTo(tx(pn, p), ty(pn, p)); g.lineTo(tx(kc, i), ty(kc, i)); if (++lines > 900) break; }
        if (lines > 900) break;
      }
      g.stroke();
    }
    if (this.kcOn) {
      const a = 0.55 + 0.45 * this.pulse, d = dot * (1.8 + this.pulse * 1.6);
      g.fillStyle = rgba(COL.on, a);
      for (const i of this.trace.kc || []) if (i < nk) g.fillRect(tx(kc, i) - d / 2, ty(kc, i) - d / 2, d, d);
    }
    // DANs and the burst
    if (dn) {
      for (let i = 0; i < PT.dan.length; i++) {
        const cl = this.danCluster[i];
        const hit = this.dan > 0 && cl === this.danSign;
        const col = cl > 0 ? COL.pam : cl < 0 ? COL.ppl1 : COL.dan;
        const d = dot * (2 + (hit ? this.dan * 5 : 0));
        g.fillStyle = rgba(col, hit ? 0.35 + 0.65 * this.dan : 0.35);
        g.beginPath(); g.arc(tx(dn, i), ty(dn, i), d, 0, Math.PI * 2); g.fill();
        if (hit && mb) {
          g.strokeStyle = rgba(col, 0.5 * this.dan); g.lineWidth = 1;
          for (const m of this.danToMbon.get(i) || []) {
            g.beginPath(); g.arc(tx(mb, m), ty(mb, m), 6 + (1 - this.dan) * 14, 0, Math.PI * 2); g.stroke();
          }
        }
      }
    }
    g.restore();
    // MBONs
    if (mb) {
      const val = C.mbon.valence || [], r = this.trace.mbon;
      for (let i = 0; i < PT.mbon.length; i++) {
        const v = val[i] ?? 0, col = v > 0 ? COL.app : v < 0 ? COL.avoid : COL.neu;
        const rate = r ? Math.min(1, Math.abs(r[i] || 0) / this.mbonMax) : 0;
        g.fillStyle = rgba(col, 0.45 + 0.55 * rate);
        g.beginPath(); g.arc(tx(mb, i), ty(mb, i), dot * (1.6 + rate * 2.4), 0, Math.PI * 2); g.fill();
      }
    }
    // MBON bars
    const by = h - barsH, order = this.mbonOrder, nb = order.length;
    g.fillStyle = 'rgba(255,255,255,0.04)'; g.fillRect(0, by, w, barsH);
    if (nb) {
      const bw = (w - 8) / nb, r = this.trace.mbon, val = C.mbon.valence || [];
      for (let j = 0; j < nb; j++) {
        const i = order[j], v = val[i] ?? 0, col = v > 0 ? COL.app : v < 0 ? COL.avoid : COL.neu;
        const rate = r ? Math.min(1, Math.abs(r[i] || 0) / this.mbonMax) : 0;
        const bh = Math.max(1, rate * (barsH - 16));
        g.fillStyle = rgba(col, 0.85);
        g.fillRect(4 + j * bw + bw * 0.12, h - 3 - bh, Math.max(1, bw * 0.76), bh);
      }
    }
    // labels
    g.font = font(11); g.fillStyle = TOKENS.ink2; g.textAlign = 'left';
    const nOn = this.trace.kc ? this.trace.kc.length : 0;
    g.fillText(`${this.label}  KC ${nOn}/${nk} on (${((100 * nOn) / Math.max(1, nk)).toFixed(1)}%)`, 6, 14);
    if (this.value != null && Number.isFinite(this.value)) { g.textAlign = 'right'; g.fillText(`value ${this.value.toFixed(3)}`, w - 6, 14); }
    g.textAlign = 'left'; g.fillStyle = TOKENS.dim;
    g.fillText('MBON  approach … avoid', 6, by + 11);
    if (this.dan > 0.05) {
      g.textAlign = 'right'; g.fillStyle = rgba(this.danSign > 0 ? COL.pam : COL.ppl1, Math.min(1, this.dan + 0.2));
      g.fillText(`${this.danSign > 0 ? 'PAM' : 'PPL1'} burst  δ=${(this.lastDelta ?? 0).toFixed(3)}`, w - 6, by + 11);
    }
    g.textAlign = 'left';
  }
}
