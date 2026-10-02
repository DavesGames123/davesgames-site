// ============================================================================
//  PIN TUMBLER LOCK  ·  lock.js — the mechanism: key, stacks, shear line, cam
// ────────────────────────────────────────────────────────────────────────────
//  No DOM and no THREE: scene.js builds the parts from these numbers and
//  tests.mjs checks them with node. Units are millimetres. The plug axis is
//  the x axis, the key goes in along -x, y is up, the section face is z = 0.
//
//  THE KEY. keyTop() is the height of the bitting edge at a distance u from
//  the shoulder (u < 0 along the blade). Each cut is a flat of width `flat`
//  with two flanks at the cut angle. The tip is a ramp.
//
//  PIN TUMBLER. Each chamber holds a key pin (domed tip of radius domeR), a
//  driver pin and a spring. The key pin rests on the key: its tip centre is
//  the highest point of h(x + ξ) + √(ρ² − ξ²) over the pin face. With no
//  key under it, the pin hangs on the keyway ledge (rest). The right key
//  puts each key pin's top on the shear line y = R, so each stack splits
//  there and the plug can turn. The key pin lengths come from the right
//  key, so the alignment is exact, not tuned.
//
//  WAFER. Each wafer is a plate with a window. A spring pushes it down; the
//  key lifts it by the top edge of its window. The right key centres every
//  wafer, so no wafer end stands out of the plug into a housing groove.
//
//  GREP MAP
//    const PIN / const WAFER ...... the two variants, every size
//    export function keyTop ....... the bitting edge h(u)
//    export function contact ...... where the key holds pin or wafer i
//    export function makeLock ..... derived sizes and state(key, s, θ)
//    export function keyspace ..... codes allowed by the MACS rule
// ============================================================================
export const D = Math.PI / 180;
export const TAU = Math.PI * 2;
const row = (n, first, pitch) => Array.from({ length: n }, (_, i) => -(first + i * pitch));

const PIN = {
  id: 'pin', type: 'pin', name: 'Pin tumbler', kind: 'Five-pin rim cylinder',
  blurb: 'Five stacks of pins lock the plug to the housing. Only the right key lifts every stack until its split sits on the shear line.',
  Rp: 6.25, Rh: 8.5, yTop: 17, capH: 0.9, x0: -26, x1: 0,
  n: 5, X: row(5, 4.6, 3.97), pitch: 3.97,
  pinR: 1.5, holeR: 1.55, domeR: 2.0, driverLen: 5.0,
  // the keyway: a wide channel for the pins over a narrow, warded slot
  chanW: 1.6, slotW: 1.15, ledgeY: -1.2, wayTop: 3.4, wayBot: -4.6,
  wards: [{ side: 1, y0: -4.0, y1: -3.2, z: 0.55 }, { side: -1, y0: -2.9, y1: -2.0, z: 0.55 }],
  key: {
    shoulder: 1.4, len: 27.0, travel: 34, thick: 2.0, yTop: 3.15, yBot: -4.45, tipLen: 3.4, tipY: -1.9,
    flat: 0.8, slope: Math.tan(40 * D), angle: 100, step: 0.381, cut: d => 2.75 - 0.381 * d, depths: 10, macs: 7,
    grooves: [{ side: 1, y0: -4.1, y1: -3.1, z: 0.45 }, { side: -1, y0: -3.0, y1: -1.9, z: 0.45 }],
  },
  bitting: { right: [3, 7, 1, 5, 2], wrong: [3, 2, 6, 5, 0] },
  spring: { free: 13.0, rate: 0.12, wire: 0.22, coilR: 1.12, turns: 9 },
  cam: { Rc: 8, pinR: 0.7 }, clearance: 1.2 * D, tol: 0.03,
};

const WAFER = {
  id: 'wafer', type: 'wafer', name: 'Wafer lock', kind: 'Five-wafer cam lock',
  blurb: 'Flat wafers ride in slots through the plug. Each one stands out into a groove in the housing until the right key centres it.',
  Rp: 6.25, Rh: 10.5, grooveW: 3.75, grooveY: 8.7, x0: -23, x1: 0,
  n: 5, X: row(5, 3.6, 3.4), pitch: 3.4,
  waferT: 0.7, slotT: 0.8, waferW: 3.5, slotW: 3.6, winW: 1.2, winBot: -5.4, rest: -1.8,
  tab: { z0: -4.4, z1: -3.5, y0: -0.6, y1: 0.2 }, pocket: { z0: -4.5, z1: -3.6, y0: -2.6, y1: 4.0 },
  slot: 1.15, wayTop: 2.65, wayBot: -3.35,
  wards: [{ side: 1, y0: -2.4, y1: -1.6, z: 0.6 }],
  key: {
    shoulder: 1.4, len: 22.5, travel: 28, thick: 2.0, yTop: 2.4, yBot: -3.2, tipLen: 3.0, tipY: -2.1,
    flat: 0.8, slope: 1, angle: 90, step: 0.45, cut: d => 2.1 - 0.45 * d, depths: 5, macs: 4,
    grooves: [{ side: 1, y0: -2.5, y1: -1.5, z: 0.45 }],
  },
  bitting: { right: [1, 3, 0, 4, 2], wrong: [1, 0, 2, 4, 4] },
  spring: { free: 6.0, rate: 0.05, wire: 0.12, coilR: 0.3, turns: 7 },
  cam: { len: 21, w: 7 }, clearance: 1.5 * D, tol: 0.03,
};
export const VARIANTS = [PIN, WAFER];
export const KEYS = [
  { id: 'right', name: 'Right key', note: 'cut to this lock' },
  { id: 'wrong', name: 'Wrong key', note: 'same blank, other cuts' },
  { id: 'none', name: 'No key', note: 'springs push every stack down' },
];

// the bitting edge at u = x − x_shoulder (u < 0 on the blade)
export function keyTop(g, bit, u) {
  const k = g.key;
  if (u > 0) return k.yTop;
  if (u < -k.len) return -Infinity;
  let y = k.yTop;
  for (let i = 0; i < g.n; i++) {
    const ui = g.X[i] - k.shoulder, v = k.cut(bit[i]) + Math.max(0, Math.abs(u - ui) - k.flat / 2) * k.slope;
    if (v < y) y = v;
  }
  const tu = u + k.len;
  if (tu < k.tipLen) y = Math.min(y, k.tipY + tu / k.tipLen * (k.yTop - k.tipY));
  return y;
}
// the shoulder x for insertion s (0 out, 1 home)
export const keyX = (g, s) => g.key.shoulder + (1 - s) * g.key.travel;

// pin: the lowest point of key pin i (no rest applied). wafer: the highest
// key point under wafer i. -Infinity when the key is not under it.
export function contact(g, bit, s, i) {
  if (!bit) return -Infinity;
  const xs = keyX(g, s), x = g.X[i];
  let best = -Infinity;
  if (g.type === 'pin') {
    const R = g.domeR, r = g.pinR, N = 120;
    for (let j = 0; j <= N; j++) {
      const xi = -r + 2 * r * j / N, h = keyTop(g, bit, x + xi - xs);
      if (h === -Infinity) continue;
      const c = h + Math.sqrt(R * R - xi * xi);
      if (c > best) best = c;
    }
    return best === -Infinity ? best : best - R;
  }
  const t = g.waferT / 2, N = 14;
  for (let j = 0; j <= N; j++) { const h = keyTop(g, bit, x - t + 2 * t * j / N - xs); if (h > best) best = h; }
  return best;
}

// codes of n cuts from `depths` depths whose neighbours differ by <= macs
export function keyspace(n, depths, macs) {
  let w = new Array(depths).fill(1);
  for (let i = 1; i < n; i++) w = w.map((_, d) => w.reduce((a, c, e) => a + (Math.abs(d - e) <= macs ? c : 0), 0));
  return w.reduce((a, b) => a + b, 0);
}

export function makeLock(id) {
  const g = VARIANTS.find(v => v.id === id) || PIN;
  const L = { id: g.id, g, pin: g.type === 'pin' };
  const right = g.bitting.right;
  if (L.pin) {
    // the domed tip hangs on the ledge at y = ledgeY where |z| = slotW
    g.rest = g.ledgeY + Math.sqrt(g.domeR ** 2 - g.slotW ** 2) - g.domeR;
    g.kLen = g.X.map((_, i) => g.Rp - contact(g, right, 1, i));
  } else {
    g.winTop = g.X.map((_, i) => contact(g, right, 1, i));
  }
  L.bits = { right, wrong: g.bitting.wrong, none: null };
  L.keyspace = keyspace(g.n, g.key.depths, g.key.macs);
  L.keyspaceRaw = g.key.depths ** g.n;

  // state(key, s, θ): every stack, the gaps, and how far the plug may turn
  L.state = (keyId, s, theta = 0) => {
    const bit = L.bits[keyId] || null, sp = g.spring;
    const ch = [];
    let ok = 0;
    for (let i = 0; i < g.n; i++) {
      const c = contact(g, bit, s, i);
      if (L.pin) {
        const kb = Math.max(g.rest, c), kt = kb + g.kLen[i], gap = kt - g.Rp;
        const good = Math.abs(gap) < g.tol;
        ch.push({ i, depth: bit ? bit[i] : null, kb, kt, gap, ok: good, cross: good ? null : gap > 0 ? 'key' : 'driver', onKey: c >= g.rest });
      } else {
        const off = Math.max(g.rest, c - g.winTop[i]), good = Math.abs(off) < g.tol;
        ch.push({ i, depth: bit ? bit[i] : null, off, gap: off, ok: good, cross: good ? null : off > 0 ? 'up' : 'down', onKey: c - g.winTop[i] >= g.rest });
      }
      if (ch[i].ok) ok++;
    }
    const home = !!bit && s >= 1 - 1e-6, open = home && ok === g.n;
    const maxTurn = open ? 90 * D : home ? g.clearance : 0;
    const th = Math.max(0, Math.min(theta, maxTurn));
    for (const q of ch) {
      if (L.pin) {
        // turned: the driver rides on the plug skin at the shear line
        q.db = th > 1e-4 && open ? g.Rp : q.kt;
        q.dt = q.db + g.driverLen;
        q.spring = g.yTop - q.dt;
      } else {
        q.spring = g.pocket.y1 - (g.tab.y1 + q.off);
      }
      q.force = sp.rate * (sp.free - q.spring);
    }
    return { keyId, s, xs: keyX(g, s), theta: th, maxTurn, home, open, ok, blocked: g.n - ok, ch,
      bolt: L.pin ? g.cam.Rc * Math.sin(th) : 0 };
  };
  return L;
}
