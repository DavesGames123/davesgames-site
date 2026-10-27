// ============================================================================
//  LENIA  ·  app/frame.js — the render loop and the follow camera
// ----------------------------------------------------------------------------
//  frame() steps the engine by the clock, mixes the last two states, moves
//  the follow camera and the view offset, and writes the status line.
//  shownTime() is the time of the picture on the screen.
//
//  GREP MAP
//    grep -n 'function shownTime'  time of the picture on the screen
//    grep -n 'function frame'      the render loop
//    grep -n 'S.view.follow'       the follow camera
//    grep -n 'engine.stats'        the stats read, every 6th frame
// ============================================================================
import { wrap, wrapDelta } from './torus.js';
import { S, setText } from './state.js';
import { occlusion } from './world.js';

// The time of the picture on the screen: the render mix (frame()) shows the
// world between one step back and now.
export function shownTime() {
  const b = S.engine ? S.engine.view.blend : 1;
  return S.time - (1 - (b == null ? 1 : b)) / S.rule.T;
}
let frames = 0, lastT = 0, lastStat = 0, fps = 0, stepsWin = 0, sps = 0, statBusy = false;
export function frame(now) {
  requestAnimationFrame(frame);
  if (!S.engine) return;
  const dt = lastT ? Math.min(0.1, (now - lastT) / 1000) : 1 / 60;
  lastT = now;
  if (S.playing && S.c) {
    S.acc += S.speed * S.rule.T * dt;
    // A slow frame means the GPU is behind: take fewer steps per frame, so
    // the world runs slower and the picture stays smooth.
    if (dt > 1 / 45) S.stepCap = Math.max(1, Math.floor(S.stepCap * 0.75));
    else if (dt < 1 / 55) S.stepCap = Math.min(S.maxSteps, S.stepCap + 1);
    const n = Math.min(S.stepCap, Math.floor(S.acc));
    S.acc -= n;
    if (S.acc > S.stepCap) S.acc = 0;   // do not build a backlog
    if (n > 0) { S.engine.step(n); S.time += n / S.rule.T; stepsWin += n; }
  }
  // The picture is the state one step back mixed with the current state by
  // the part of the next step that the clock has used. A step comes every
  // 3 to 5 frames at the default speed, and with no mix the creature moves
  // in jumps at each step.
  S.engine.setView({ blend: S.playing ? Math.min(1, S.acc) : 1 });
  if (S.view.follow && S.stats && S.stats.mass > 1e-3 && S.stats.focus > 0.2) {
    // The centroid is a few frames old. Move it forward by the velocity.
    const { W, H } = S.engine.info, v = S.engine.view, age = shownTime() - S.statT;
    const tx = S.stats.cx + S.vel.x * age, ty = S.stats.cy + S.vel.y * age;
    const dx = wrapDelta(tx - v.cx, W), dy = wrapDelta(ty - v.cy, H);
    S.engine.setView({ cx: wrap(v.cx + dx * 0.12, W), cy: wrap(v.cy + dy * 0.12, H) });
  }
  const occ = S.saverOcc || occlusion(), v = S.engine.view;
  if (Math.abs(occ.x - v.ox) > 0.5 || Math.abs(occ.y - v.oy) > 0.5) {
    S.engine.setView({ ox: v.ox + (occ.x - v.ox) * 0.2, oy: v.oy + (occ.y - v.oy) * 0.2 });
  }
  S.engine.render();
  frames++;
  if (frames % 6 === 0 && !statBusy) {
    statBusy = true;
    const t = S.time;
    S.engine.stats().then(st => {
      if (!st) return;
      const prev = S.stats, dt = t - S.statT;
      if (prev && dt > 1e-6) {
        const { W, H } = S.engine.info;
        const vx = wrapDelta(st.cx - prev.cx, W) / dt, vy = wrapDelta(st.cy - prev.cy, H) / dt;
        S.vel = { x: S.vel.x * 0.7 + vx * 0.3, y: S.vel.y * 0.7 + vy * 0.3 };
      }
      S.stats = st; S.statT = t;
    }).catch(() => {}).finally(() => { statBusy = false; });
  }
  if (now - lastStat > 500) {
    const span = (now - lastStat) / 1000;
    fps = lastStat ? frames / span : 0; sps = lastStat ? stepsWin / span : 0;
    frames = 0; stepsWin = 0; lastStat = now;
    const c = S.c, info = S.engine.info, st = S.stats;
    setText('stMain', c ? c.name : '');
    const R = info.R;
    const mass = st ? (st.mass / (R * R)).toFixed(2) : '–';
    setText('stRight', [
      `${info.W}×${info.H}`, `R ${Math.round(R * 10) / 10}`, `t ${S.time.toFixed(1)}`, `mass ${mass}`,
      `${Math.round(sps)} steps/s`, `${Math.round(fps)} fps`, S.playing ? '' : 'paused',
    ].filter(Boolean).join(' · '));
  }
}
