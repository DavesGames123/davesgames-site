// ============================================================================
//  WASM-4 ARCADE  ·  swap.js — the cart swap as timed tracks (pure, no DOM)
// ----------------------------------------------------------------------------
//  A swap moves two carts: the old cart pops out of the console slot and
//  flies back to its rack slot; the new cart lifts from the rack (or from
//  where the person dropped it), flies over the slot, drops in and seats
//  with a small push. The new cart boots when it seats (plan.seatAt).
//
//  A plan is { tracks: { id: [seg, ...] }, seatAt, end }. A segment is
//    { t0, t1, a, b, h, zb, ease, rx: [from, to], rz }
//  a and b are [x, y, z]; h lifts the path in an arc (negative h = a dip);
//  zb bows the path toward the camera; rz is a wobble about z.
//
//    planSwap({ incoming, from, fromRx, slot, outgoing, home, homeRx, drag })
//    planReturn(id, from, home, homeRx)     a dropped cart goes back
//    planPush(id, slot)                     the seated cart is pushed (reset)
//    sample(plan, t) -> Map id -> { p: [x, y, z], rx, rz }
//
//  grep -n targets  "export const DUR"  "export function planSwap"
//                   "export function sample"  "export function planReturn"
// ============================================================================

export const DUR = { eject: 0.36, back: 0.7, lift: 0.3, fly: 0.66, drop: 0.24, push: 0.2 };

export const ease = {
  linear: u => u,
  inOut: u => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2),
  out: u => 1 - Math.pow(1 - u, 3),
  in: u => u * u * u,
  back: u => { const c = 1.9; return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); },
};

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const seg = (t0, dur, a, b, o = {}) => ({ t0, t1: t0 + dur, a, b, h: 0, zb: 0, ease: 'inOut', rx: [0, 0], rz: 0, ...o });

export function planSwap({ incoming, from, fromRx = 0, slot, outgoing = null, home = null, homeRx = 0, drag = false }) {
  const tracks = {};
  const above = add(slot, [0, 11, 0]);
  let t = 0;
  if (outgoing && home) {
    const pop = add(slot, [0, 10, 0]);
    tracks[outgoing] = [
      seg(0, DUR.eject, slot, pop, { ease: 'back' }),
      seg(DUR.eject, DUR.back, pop, home, { h: 4, zb: 7, rx: [0, homeRx], rz: -0.25 }),
    ];
    t = 0.12;
  }
  const inc = [];
  let start = from, rx0 = fromRx;
  if (!drag) {
    const lifted = add(from, [0, 5, 3]);
    inc.push(seg(t, DUR.lift, from, lifted, { ease: 'out', rx: [fromRx, fromRx * 0.3] }));
    t += DUR.lift; start = lifted; rx0 = fromRx * 0.3;
  }
  // the slot must be clear: arrive after the old cart has popped and left
  const fly = Math.max(DUR.fly, outgoing ? DUR.eject + 0.3 - t : 0);
  inc.push(seg(t, fly, start, above, { h: 9, zb: -3, rx: [rx0, 0], rz: 0.32 }));
  t += fly;
  inc.push(seg(t, DUR.drop, above, slot, { ease: 'in' }));
  t += DUR.drop;
  inc.push(seg(t, DUR.push, slot, slot, { h: -0.9, ease: 'linear' }));
  t += DUR.push;
  tracks[incoming] = inc;
  const ends = Object.values(tracks).map(s => s[s.length - 1].t1);
  return { tracks, seatAt: t, end: Math.max(...ends) };
}

export function planReturn(id, from, home, homeRx = 0) {
  const s = seg(0, 0.55, from, home, { h: 3, ease: 'inOut', rx: [0, homeRx], rz: 0.15 });
  return { tracks: { [id]: [s] }, seatAt: -1, end: s.t1 };
}

export function planPush(id, slot) {
  const s = seg(0, DUR.push + 0.1, slot, slot, { h: -1.1, ease: 'linear' });
  return { tracks: { [id]: [s] }, seatAt: s.t1, end: s.t1 };
}

function at(s, t) {
  const u = Math.max(0, Math.min(1, (t - s.t0) / Math.max(1e-6, s.t1 - s.t0)));
  const e = ease[s.ease](u), bump = 4 * u * (1 - u);
  return {
    p: [s.a[0] + (s.b[0] - s.a[0]) * e, s.a[1] + (s.b[1] - s.a[1]) * e + s.h * bump, s.a[2] + (s.b[2] - s.a[2]) * e + s.zb * bump],
    rx: s.rx[0] + (s.rx[1] - s.rx[0]) * e,
    rz: s.rz * Math.sin(Math.PI * u) * Math.sin(Math.PI * 2 * u + 0.6),
  };
}

export function sample(plan, t) {
  const out = new Map();
  for (const id in plan.tracks) {
    const segs = plan.tracks[id];
    let s = segs[0];
    for (const x of segs) if (t >= x.t0) s = x;
    out.set(id, at(s, t));
  }
  return out;
}
