// ============================================================================
//  RETRO SHELF  ·  saver-plan.js — the shot plan of the desk tour (pure)
// ----------------------------------------------------------------------------
//  No DOM and no three.js. saver.js and tests.mjs import it.
//
//  A tour is a seeded shuffle of the shelf. Each round plays every game
//  once, and no game plays twice in a row across a round edge. Each game
//  is one shot sequence of six beats, in this order:
//    pick      the camera glides to the rack and the box slides out
//    plugin    the disk (or the CD) goes into the drive, the joystick
//              plug goes into the game port, a click, the power LED on
//    poweron   the CRT warms up (dot, line, full screen), a DOS boot
//              line, then the attract screen of the game
//    tour      a camera move round the screen: push, orbit, crane, graze
//    poweroff  the picture falls to a line, then to a dot
//    eject     the media comes out, goes back into the box, and the box
//              goes back into the rack
//  Each beat holds 8 to 15 s (more when calm is high).
//
//  Framing. frameFit puts a subject of radius R in the clear band of the
//  label plate (plateBand of lib/saver-clear.js) for any aspect, 16:9 or
//  9:16. The camera view offset moves the band centre to the subject.
//
//  grep -n targets
//    "export const BEATS"        "export function planTour"
//    "export function licenceKind"  "export function mediaOf"
//    "export function shotLabel"    "export function frameFit"
//    "export function crtPower"     "export function beatPose"
//    "export function blendPose"    "export function poseEye"
//    "export function sameOrigin"  "export function locate"
//    "export function crtState"
// ============================================================================

export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const ease = u => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
export const lerp = (a, b, k) => a + (b - a) * k;
/** 0 before a, 1 after b, smooth between. */
export const span = (u, a, b) => ease((u - a) / (b - a));

/** The six beats of one game, in order, with the hold range in seconds. */
export const BEATS = [
  { kind: 'pick', lo: 8, hi: 11 },
  { kind: 'plugin', lo: 10, hi: 13 },
  { kind: 'poweron', lo: 10, hi: 13 },
  { kind: 'tour', lo: 11, hi: 15 },
  { kind: 'poweroff', lo: 8, hi: 10 },
  { kind: 'eject', lo: 9, hi: 12 },
];
export const TOUR_MOVES = ['push', 'orbit', 'crane', 'graze'];

/**
 * The seeded tour. ids: the game ids. Returns a list of shots:
 * { id, beats: [{ kind, secs, move? }] }. rounds rounds, every game once
 * a round, no game twice in a row. calm 0..1 moves the holds to the top
 * of their ranges.
 */
export function planTour(ids, seed, opts = {}) {
  const rounds = opts.rounds || 3, calm = clamp(opts.calm == null ? 0.5 : opts.calm, 0, 1);
  const r = rng(seed), out = [];
  let lastMove = '';
  for (let k = 0; k < rounds; k++) {
    const a = ids.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    if (out.length && a.length > 1 && a[0] === out[out.length - 1].id) [a[0], a[1]] = [a[1], a[0]];
    for (const id of a) {
      const beats = BEATS.map(b => {
        const secs = clamp(b.lo + (b.hi - b.lo) * (0.55 * calm + 0.45 * r()), 8, 15);
        const o = { kind: b.kind, secs };
        if (b.kind === 'tour') {
          const pool = TOUR_MOVES.filter(m => m !== lastMove);
          o.move = pool[Math.floor(r() * pool.length)];
          lastMove = o.move;
        }
        if (b.kind === 'pick') o.side = r() < 0.5 ? -1 : 1;
        return o;
      });
      out.push({ id, beats });
    }
  }
  return out;
}

/** 'Shareware' or 'Freeware', from the licence line of games.json. */
export function licenceKind(g) { return /shareware/i.test(g.licence || '') ? 'Shareware' : 'Freeware'; }

/** 'floppy' or 'cd': the medium that the game came on (games.json saver.media). */
export function mediaOf(g) { return (g.saver && g.saver.media) === 'cd' ? 'cd' : 'floppy'; }

const NOTE = {
  pick: g => 'From the rack: the ' + (mediaOf(g) === 'cd' ? 'CD-ROM' : 'floppy') + ' box of ' + g.title + '.',
  plugin: g => (mediaOf(g) === 'cd' ? 'The CD goes into the tray' : 'The disk goes into drive A:') + ', the joystick into the game port.',
  poweron: () => 'The CRT warms up: a dot, a line, then the full picture.',
  tour: g => short(firstSentence(g.blurb), 100),
  poweroff: () => 'Power off: the picture falls to a line, then to a dot.',
  eject: () => 'Eject, and back to the rack.',
};
function short(s, n) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1), sp = cut.lastIndexOf(' ');
  return cut.slice(0, sp > n * 0.6 ? sp : n - 1).replace(/[,;:]$/, '') + '…';
}
function firstSentence(s) {
  const m = /^(.+?[.!?])(\s|$)/.exec(String(s || ''));
  return m ? m[1] : String(s || '');
}

/** The plate payload of one beat: title, sub, lines. No code. */
export function shotLabel(g, kind) {
  const genre = (g.saver && g.saver.genre) || '';
  return {
    title: g.title,
    sub: g.year + ' · ' + g.maker,
    lines: [
      licenceKind(g) + (genre ? ' · ' + genre : '') + ' · free from its owner',
      (NOTE[kind] || NOTE.tour)(g),
    ],
  };
}

/**
 * Framing in the clear band. w, h: the canvas in CSS px. band: { t, b }
 * from plateBand, or null. fov: the vertical field of view in degrees.
 * R: the subject radius. fill: the part of the band that the subject
 * fills. Returns { dist, offY, cy, ch, tanV, tanH }: the camera distance,
 * the y of setViewOffset(w, h, 0, offY, w, h), the band centre and height,
 * and the half-angle tangents that the subject can use.
 */
export function frameFit(w, h, band, fov, R, fill = 0.82) {
  const t = band ? band.t : 0, b = band ? band.b : 0;
  const ch = Math.max(1, h - t - b), cy = t + ch / 2;
  const tv = Math.tan((fov * Math.PI / 180) / 2);
  const tanV = tv * (ch / h) * fill, tanH = tv * (w / h) * fill;
  const use = Math.min(tanV, tanH);
  return { dist: R / use, offY: h / 2 - cy, cy, ch, tanV, tanH };
}

/** The vertical field of view for the aspect: wider in a tall frame. */
export function fovFor(w, h) { return w / h < 1 ? 44 : 34; }

/**
 * The CRT power curve. kind 'on' or 'off', u = seconds since the switch.
 * Returns { sx, sy, bright }: the picture scale in x and y (0..1) and its
 * brightness (can go over 1 at the flash). On: a dot (0..0.25 s), the
 * dot opens to a line (0.25..0.6 s), the line opens to the full picture
 * (0.6..1.3 s). Off: the picture falls to a line (0..0.18 s), the line
 * to a dot (0.18..0.4 s), the dot fades (0.4..2.4 s).
 */
export function crtPower(kind, u) {
  if (kind === 'on') {
    if (u <= 0) return { sx: 0, sy: 0, bright: 0 };
    if (u < 0.25) return { sx: 0.012, sy: 0.016, bright: 2.2 * ease(u / 0.25) };
    if (u < 0.6) { const k = ease((u - 0.25) / 0.35); return { sx: lerp(0.012, 1, k), sy: 0.012, bright: lerp(2.2, 1.8, k) }; }
    if (u < 1.3) { const k = ease((u - 0.6) / 0.7); return { sx: 1, sy: lerp(0.012, 1, k), bright: lerp(1.8, 1, k) }; }
    return { sx: 1, sy: 1, bright: 1 };
  }
  if (u <= 0) return { sx: 1, sy: 1, bright: 1 };
  if (u < 0.18) { const k = ease(u / 0.18); return { sx: 1, sy: lerp(1, 0.01, k), bright: lerp(1, 1.9, k) }; }
  if (u < 0.4) { const k = ease((u - 0.18) / 0.22); return { sx: lerp(1, 0.012, k), sy: 0.01, bright: 1.9 }; }
  if (u < 2.4) return { sx: 0.012, sy: 0.014, bright: 1.9 * (1 - ease((u - 0.4) / 2)) };
  return { sx: 0, sy: 0, bright: 0 };
}

// ---------------------------------------------------------------- camera
// A pose is { target: [x, y, z], R, yaw, pitch } in the desk frame (metres,
// y up, the desk top at y = 0, the camera in front at +z). yaw and pitch in
// degrees: yaw 0 looks along -z, a + yaw puts the camera to the right
// (+x). R is the radius of the subject: frameFit gives the distance.
// P holds the live points of the scene: box, media, drive, port, screen,
// rack, desk (each [x, y, z]).
const D2R = Math.PI / 180;
const mix3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];

/** The pose of the camera at u (0..1) of a beat. */
export function beatPose(beat, u, P) {
  const kind = beat.kind, side = beat.side || 1;
  switch (kind) {
    case 'pick': {
      // a glide along the rack, then on to the box as it comes out
      const k = span(u, 0.05, 0.75);
      return { target: mix3(P.rack, P.box, k), R: lerp(0.3, 0.23, k), yaw: lerp(32 * side, 14 * side, u), pitch: lerp(18, 9, u) };
    }
    case 'plugin': {
      const k1 = span(u, 0.0, 0.45), k2 = span(u, 0.42, 0.7);
      const front = mix3(P.drive, P.port, 0.5);
      const tgt = mix3(mix3(P.media, P.drive, k1), front, k2);
      return { target: tgt, R: lerp(0.17, 0.24, k2), yaw: lerp(-18, 24, ease(u)), pitch: lerp(14, 20, u) };
    }
    case 'poweron':
      return { target: P.screen, R: lerp(0.3, 0.24, ease(u)), yaw: lerp(14, 4, ease(u)), pitch: lerp(10, 4, u) };
    case 'tour': {
      const m = beat.move || 'push', e = ease(u);
      if (m === 'push') return { target: P.screen, R: lerp(0.24, 0.12, e), yaw: lerp(-6, 14, e), pitch: lerp(4, 1, e) };
      if (m === 'orbit') return { target: [P.screen[0], P.screen[1] - 0.06, P.screen[2]], R: 0.3, yaw: lerp(-42, 42, e), pitch: lerp(12, 16, e) };
      if (m === 'crane') return { target: [P.screen[0], P.screen[1] - lerp(0.12, 0.02, e), P.screen[2]], R: lerp(0.36, 0.26, e), yaw: lerp(26, 18, e), pitch: lerp(30, 4, e) };
      return { target: P.screen, R: lerp(0.2, 0.17, e), yaw: lerp(58, 34, e), pitch: lerp(3, 8, e) };
    }
    case 'poweroff':
      return { target: P.screen, R: lerp(0.24, 0.3, ease(u)), yaw: lerp(-8, -16, u), pitch: lerp(5, 9, u) };
    case 'eject': {
      const k1 = span(u, 0.05, 0.35), k2 = span(u, 0.35, 0.65), k3 = span(u, 0.7, 1);
      const tgt = mix3(mix3(mix3(P.drive, P.media, k1), P.box, k2), P.desk, k3);
      return { target: tgt, R: lerp(lerp(0.2, 0.24, k2), 0.42, k3), yaw: lerp(-10, 12, ease(u)), pitch: lerp(12, 20, ease(u)) };
    }
    default:
      return { target: P.desk, R: 0.6, yaw: 0, pitch: 16 };
  }
}

/** Blend two poses: k = 0 gives a, 1 gives b. */
export function blendPose(a, b, k) {
  return { target: mix3(a.target, b.target, k), R: lerp(a.R, b.R, k), yaw: lerp(a.yaw, b.yaw, k), pitch: lerp(a.pitch, b.pitch, k) };
}

/** The eye point of a pose at distance dist. */
export function poseEye(p, dist) {
  const y = p.yaw * D2R, x = p.pitch * D2R;
  return [p.target[0] + dist * Math.cos(x) * Math.sin(y), p.target[1] + dist * Math.sin(x), p.target[2] + dist * Math.cos(x) * Math.cos(y)];
}

/** True when url resolves to the origin of base (the saver fetches only these). */
export function sameOrigin(url, base) {
  try { return new URL(url, base).origin === new URL(base).origin; } catch (e) { return false; }
}

/** Where time t (s) falls in the plan: { si, bi, u, tb, secs } (shot, beat, 0..1, s into the beat). Loops. */
export function locate(plan, t) {
  let total = 0;
  for (const s of plan) for (const b of s.beats) total += b.secs;
  let r = total > 0 ? ((t % total) + total) % total : 0;
  for (let si = 0; si < plan.length; si++) {
    const bs = plan[si].beats;
    for (let bi = 0; bi < bs.length; bi++) {
      if (r < bs[bi].secs) return { si, bi, u: r / bs[bi].secs, tb: r, secs: bs[bi].secs };
      r -= bs[bi].secs;
    }
  }
  return { si: 0, bi: 0, u: 0, tb: 0, secs: plan[0] ? plan[0].beats[0].secs : 1 };
}

export const POWER_ON_AT = 0.8, POWER_OFF_AT = 1.0, BOOT_AFTER = 0.9;

/**
 * The CRT of a shot at beat bi, tb s into it: { pw, at }. pw is the power
 * curve (null: off), at the time of the attract screen (s since the
 * picture opened). The CRT is off in pick, plugin and eject.
 */
export function crtState(shot, bi, tb) {
  const kind = shot.beats[bi].kind;
  const onSecs = (shot.beats.find(b => b.kind === 'poweron') || { secs: 0 }).secs;
  const tourSecs = (shot.beats.find(b => b.kind === 'tour') || { secs: 0 }).secs;
  if (kind === 'poweron') { const u = tb - POWER_ON_AT; return { pw: crtPower('on', u), at: Math.max(0, u - BOOT_AFTER) }; }
  if (kind === 'tour') return { pw: crtPower('on', 99), at: onSecs - POWER_ON_AT - BOOT_AFTER + tb };
  if (kind === 'poweroff') {
    const at = onSecs - POWER_ON_AT - BOOT_AFTER + tourSecs + tb;
    return { pw: tb < POWER_OFF_AT ? crtPower('on', 99) : crtPower('off', tb - POWER_OFF_AT), at };
  }
  return { pw: null, at: 0 };
}
