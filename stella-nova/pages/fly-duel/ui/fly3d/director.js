// ============================================================================
//  FLY DUEL 3D  ·  the camera director  (pure ES module, no DOM, no three.js)
// ----------------------------------------------------------------------------
//  The director picks the shot for each moment of the duel. It reads the
//  choreography steps (ui/fly3d/choreo.js) as they play, so every camera
//  move has a reason on the table. The scene (ui/fly3d/scene.js shotPose)
//  turns the shot into a camera place and look point each frame.
//
//  SHOTS (move: 'cut' is a hard cut, 'ease' is an eased move)
//      wide    the whole table, a slow drift            ease
//      over    over the shoulder of the fly that
//              decides (land, cast, block)              cut
//      close   the card that the fly holds up           cut
//      follow  the camera follows a card from the
//              hand to the mat (land, creature)         ease
//      dolly   a slow push onto the attackers           ease
//      combat  side view of attackers and blockers      cut
//      crane   a rise over the board after combat       ease
//      low     a low angle on the lethal attack         cut
//      crowd   the crowd reacts (big hit, deaths)       cut
//      win     the winner, a slow orbit                 ease
//      seat    first person at a seat (play mode)       cut
//
//  RULES
//    - Each shot holds at least SHOTS[shot].hold seconds (scene time).
//      A shot of higher PRIORITY or a forced request cuts in earlier.
//    - No repeats: a request for the shot that plays now does nothing,
//      and a weak shot (wide, crane, over, close, crowd) that played in
//      the last two shots changes to its ALT shot.
//    - The turn-change pause (choreo op 'beat') eases to the wide shot
//      and locks the camera for the pause. Only a forced request (the
//      win) cuts into the lock.
//    - A change from the crowd shot is a cut (it looks away from the
//      table, and an eased turn back is too slow).
//    - Reduced motion: every change is a cut and the scene stops the
//      drift of the wide and win shots.
//    - A lethal record (record.after has a winner by damage) gets the low
//      shot on its first strike or spark at a player.
//
//  API
//      createDirector({ reduced }) -> { state, request(shot, p, t, o),
//        onStep(step, t, info), lock(until), reset(t) }
//      state: { shot, p, since, cut, target, lockUntil, hist, n }
//      o: { force, target }. target: { kind: 'held', p } | { kind:
//        'perm', uid } | { kind: 'uids', uids } (what the shot looks at)
//      info (per record): { action, lethal, loser }
//
//  ORBIT (play mode). The player can turn the seat camera about the look
//  point of the seat: a drag turns it, a pinch or the wheel zooms. The
//  orbit is { az, el, dist } about the look point (az about +y, from +z;
//  el above the table plane). ORBIT holds the clamps: the camera stays
//  above the table top (minEl) and below the top of the frame (maxEl),
//  and between minDist and maxDist from the look point. The functions
//  are pure (plain {x, y, z}), so node tests check the clamps.
//
//  GREP MAP
//      grep -n 'export const ORBIT'        orbit clamps and rates
//      grep -n 'export function orbitFrom' camera place -> orbit
//      grep -n 'export function orbitPos'  orbit -> camera place
//      grep -n 'export function orbitDrag' drag px -> turn (clamped)
//      grep -n 'export function orbitZoom' zoom factor (clamped)
//      grep -n 'export const SHOTS'        shot table (move, hold, rate)
//      grep -n 'export const PRIORITY'     which shot cuts into which
//      grep -n 'export const ALT'          the no-repeat change
//      grep -n 'export function recordInfo' record -> info
//      grep -n 'export function createDirector'
//      grep -n 'onStep('                   choreo op -> shot
// ============================================================================

export const SHOTS = {
  wide: { move: 'ease', hold: 2.6, rate: 1.6 },
  over: { move: 'cut', hold: 1.6, rate: 3.5 },
  close: { move: 'cut', hold: 1.0, rate: 4 },
  follow: { move: 'ease', hold: 0.9, rate: 3.2 },
  dolly: { move: 'ease', hold: 1.4, rate: 1.5 },
  combat: { move: 'cut', hold: 1.4, rate: 2.6 },
  crane: { move: 'ease', hold: 2.0, rate: 1.1 },
  low: { move: 'cut', hold: 1.8, rate: 3 },
  crowd: { move: 'cut', hold: 1.2, rate: 4 },
  win: { move: 'ease', hold: 99, rate: 1.2 },
  seat: { move: 'cut', hold: 0, rate: 6 },
};
export const PRIORITY = { wide: 0, crane: 1, over: 2, close: 2, follow: 2, combat: 3, dolly: 3, crowd: 3, low: 4, win: 5, seat: 6 };
export const ALT = { wide: 'crane', crane: 'wide', over: 'close', close: 'over', crowd: 'wide' };
const WEAK = new Set(['wide', 'crane', 'over', 'close', 'crowd']);

// What the director needs to know about one record.
export function recordInfo(rec) {
  const r = rec?.after?.result;
  const lethal = !!r && r.winner >= 0 && r.reason !== 'decked' && r.reason !== 'turn cap';
  return { action: rec?.action || { type: 'pass' }, lethal, loser: lethal ? 1 - r.winner : -1, who: rec?.who ?? 0 };
}

export function createDirector({ reduced = false } = {}) {
  const s = { shot: 'wide', p: 0, since: -99, cut: true, target: null, lockUntil: -1, hist: ['wide:0'], n: 0, lowDone: false };

  function request(shotIn, p = 0, t = 0, { force = false, target = null } = {}) {
    let shot = shotIn;
    if (!SHOTS[shot]) return false;
    if (shot === s.shot && p === s.p && !target) return false;
    if (t < s.lockUntil && !force) return false;
    if (s.shot === 'seat' && shot !== 'seat' && !force) return false;
    const cur = SHOTS[s.shot];
    if (!force && t - s.since < cur.hold && PRIORITY[shot] <= PRIORITY[s.shot]) return false;
    if (!force && WEAK.has(shot) && s.hist.slice(-2).some(k => k.startsWith(shot + ':')) && ALT[shot]) {
      const alt = ALT[shot];
      if (!s.hist.slice(-1).some(k => k.startsWith(alt + ':'))) shot = alt;
    }
    if (shot === s.shot && p === s.p && !target) return false;
    // The crowd shot looks away from the table: the next shot is a cut,
    // because an eased turn back takes too long to show its subject.
    const fromCrowd = s.shot === 'crowd';
    s.shot = shot; s.p = p; s.since = t; s.target = target;
    s.cut = reduced || SHOTS[shot].move === 'cut' || fromCrowd;
    s.hist.push(`${shot}:${p}`); if (s.hist.length > 8) s.hist.shift();
    s.n++;
    return true;
  }

  // One choreo step -> a shot request (or nothing).
  function onStep(step, t, info = {}) {
    const a = info.action || {};
    switch (step.op) {
      case 'think':
        s.lowDone = false;
        if (a.type === 'land' || a.type === 'cast' || (a.type === 'block' && step.p != null)) request('over', step.p, t);
        break;
      case 'lift':
        if (a.type === 'land') request('follow', step.p, t, { target: { kind: 'held', p: step.p } });
        else request('close', step.p, t, { force: true, target: { kind: 'held', p: step.p } });
        break;
      case 'land':
        if (s.shot === 'follow') s.target = { kind: 'perm', uid: step.uid };
        else request('follow', step.p, t, { target: { kind: 'perm', uid: step.uid } });
        break;
      case 'cast':
        request('follow', step.p, t, { force: true, target: { kind: 'perm', uid: step.uid } });
        break;
      case 'attack':
        if (info.lethal) request('low', step.p, t, { force: true, target: { kind: 'uids', uids: step.uids } });
        else request('dolly', step.p, t, { force: true, target: { kind: 'uids', uids: step.uids } });
        if (info.lethal) s.lowDone = true;
        break;
      case 'block':
        if (!info.lethal) request('combat', step.p, t, { force: true });
        break;
      case 'strike': case 'spark':
        if (info.lethal && !s.lowDone && typeof step.to === 'string') { s.lowDone = true; request('low', step.p, t, { force: true }); }
        break;
      case 'hold':
        if (step.reason === 'hit' || step.reason === 'deaths') request('crowd', step.p, t, { force: true });
        break;
      case 'settle':
        if (!info.lethal) request('crane', 0, t);
        break;
      case 'beat':
        request('wide', step.to ?? 0, t, { force: true });
        s.lockUntil = Math.max(s.lockUntil, t + (step.dur || 0));
        break;
      case 'win':
        request('win', Math.max(0, step.winner), t, { force: true });
        break;
      default: break;
    }
  }

  return {
    state: s, request, onStep,
    lock(until) { s.lockUntil = Math.max(s.lockUntil, until); },
    reset(t = 0) { s.shot = 'wide'; s.p = 0; s.since = t; s.cut = true; s.target = null; s.lockUntil = -1; s.hist = ['wide:0']; s.lowDone = false; },
  };
}

// ---------------------------------------------------------------- orbit
export const ORBIT = { minDist: 2.6, maxDist: 14, minEl: 0.1, maxEl: 1.4, perPx: 0.0065 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = a => { const t = Math.PI * 2; return ((a + Math.PI) % t + t) % t - Math.PI; };
export function clampOrbit(o) {
  return {
    az: wrap(Number.isFinite(o.az) ? o.az : 0),
    el: clamp(Number.isFinite(o.el) ? o.el : 0.5, ORBIT.minEl, ORBIT.maxEl),
    dist: clamp(Number.isFinite(o.dist) ? o.dist : 6, ORBIT.minDist, ORBIT.maxDist),
  };
}
export function orbitFrom(pos, look) {
  const dx = pos.x - look.x, dy = pos.y - look.y, dz = pos.z - look.z;
  const dist = Math.hypot(dx, dy, dz) || 1;
  return clampOrbit({ az: Math.atan2(dx, dz), el: Math.asin(clamp(dy / dist, -1, 1)), dist });
}
export function orbitPos(o, look, out = { x: 0, y: 0, z: 0 }) {
  const c = Math.cos(o.el);
  out.x = look.x + Math.sin(o.az) * c * o.dist;
  out.y = look.y + Math.sin(o.el) * o.dist;
  out.z = look.z + Math.cos(o.az) * c * o.dist;
  return out;
}
// A drag of (dx, dy) px: right turns the camera to the left about the
// look point, down lifts it (the OrbitControls sense).
export function orbitDrag(o, dx, dy) {
  return clampOrbit({ az: o.az - dx * ORBIT.perPx, el: o.el + dy * ORBIT.perPx, dist: o.dist });
}
// k < 1 comes nearer, k > 1 goes back.
export function orbitZoom(o, k) {
  return clampOrbit({ az: o.az, el: o.el, dist: o.dist * (Number.isFinite(k) && k > 0 ? k : 1) });
}
