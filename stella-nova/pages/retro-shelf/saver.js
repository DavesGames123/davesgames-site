// ============================================================================
//  RETRO SHELF  ·  saver.js — screensaver hook: a tour of the desk
// ----------------------------------------------------------------------------
//  Installs window.snSaver (protocol: lib/screensaver.js and PAGES.md):
//    enter({ calm, seconds, caption, seed, label }) -> { canvas, warmupMs }
//    exit()
//  enter() closes a running game (the saver plays no game and no sound)
//  and puts one full-window canvas into the document. three r160 loads
//  only then (a relative import, no importmap). The canvas shows a 3D desk
//  (saver-desk.js): a CRT on a beige PC, a joystick, a keyboard and a rack
//  of the shelf games. For each game in a seeded shuffle (saver-plan.js
//  planTour) the camera runs one shot sequence of six beats: pick the box,
//  plug in (media into the drive, the plug into the game port, a click,
//  the power LED), power on (the CRT warm-up, a DOS boot line, our own
//  attract screen from saver-card.js), tour the screen, power off (line,
//  dot) and eject (the media back into the box, the box into the rack).
//
//  The plate (opts.label): title, year and maker, the licence kind
//  (freeware or shareware) and genre, and a one-line note of the beat.
//  No code on the plate: the subject is the games, not the program.
//  The subject sits in the clear band of the plate (plateBand of
//  lib/saver-clear.js): the camera distance comes from frameFit and the
//  view offset moves the band centre onto the subject, for 16:9 and 9:16.
//
//  Phone budget: pixel ratio at most 1.25 on a touch screen (1.5 else),
//  no shadows on a touch screen, the CRT texture drawn at 30 fps, the
//  room reflection baked once. When WebGL fails, a 2D attract screen of
//  the same plan shows instead.
//
//  The only fetch is games.json, same origin, when the page has not got it.
//
//  grep -n targets  "async function start"  "function frame"
//    "function drawScreen"  "function cameraFor"  "window.snSaver ="
// ============================================================================
import { plateBand } from '../../lib/saver-clear.js';
import { planTour, locate, crtState, shotLabel, beatPose, blendPose, poseEye, frameFit, fovFor, span, sameOrigin } from './saver-plan.js';
import { drawAttract, makeCrtAssets, composeCrt, W0, H0 } from './saver-card.js';

export const THREE_URL = '../../vendor/three@0.160.0/build/three.module.js';
let run = null;

async function gamesList() {
  const s = typeof window !== 'undefined' && window.__retro && window.__retro.S;
  if (s && s.data) return s.data.games;
  const u = new URL('games.json', import.meta.url);
  if (!sameOrigin(u.href, import.meta.url)) throw new Error('games.json is not same origin');
  const r = await fetch(u);
  return (await r.json()).games;
}

const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

async function start(my, o) {
  const games = await gamesList();
  if (run !== my) return;
  my.games = games;
  my.byId = new Map(games.map(g => [g.id, g]));
  my.plan = planTour(games.map(g => g.id), my.seed, { calm: my.calm, rounds: 3 });
  my.label = typeof o.label === 'function' ? o.label : () => {};
  my.src = mkCanvas(W0, H0);
  my.srcCtx = my.src.getContext('2d');
  my.crt = makeCrtAssets(mkCanvas, 512, 400);
  my.avg = mkCanvas(4, 4);
  my.states = new Map();
  try {
    const THREE = await import(new URL(THREE_URL, import.meta.url).href);
    if (run !== my) return;
    const { buildDesk } = await import('./saver-desk.js');
    if (run !== my) return;
    const renderer = new THREE.WebGLRenderer({ canvas: my.canvas, antialias: !my.coarse, powerPreference: 'low-power', alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, my.coarse ? 1.25 : 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = !my.coarse;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const desk = buildDesk(THREE, games, { mk: mkCanvas, coarse: my.coarse, anisotropy: Math.min(4, renderer.capabilities.getMaxAnisotropy()) });
    desk.bakeEnv(renderer);
    my.THREE = THREE; my.renderer = renderer; my.desk = desk;
    my.camera = new THREE.PerspectiveCamera(34, 1, 0.02, 20);
  } catch (e) {
    // no WebGL: the 2D attract screen of the same plan
    console.warn('retro-shelf saver: 2D fallback', e);
    my.flat = true;
    let c2d = null;
    try { c2d = my.canvas.getContext('2d'); } catch (e2) { c2d = null; }
    if (!c2d) {
      // the canvas holds a broken WebGL context: a fresh 2D canvas in its place
      const c2 = mkCanvas(1, 1);
      c2.style.cssText = my.canvas.style.cssText;
      my.canvas.replaceWith(c2); my.canvas = c2;
    }
  }
  my.t0 = performance.now();
  my.raf = requestAnimationFrame(frame);
}

function stateFor(my, id) {
  if (!my.states.has(id)) my.states.set(id, {});
  return my.states.get(id);
}

/** Draws the CRT picture of shot s at beat bi into the screen canvas; returns { bright, rgb }. */
function drawScreen(my, g, shot, bi, tb, now) {
  const cs = crtState(shot, bi, tb);
  const scv = my.flat ? null : my.desk.screen.canvas;
  if (!cs.pw) {
    if (scv && my.lastPw !== 'off') { const c = scv.getContext('2d'); c.fillStyle = '#000'; c.fillRect(0, 0, scv.width, scv.height); my.desk.screen.tex.needsUpdate = true; }
    my.lastPw = 'off';
    return { bright: 0, rgb: [0.6, 0.7, 1], cs };
  }
  my.lastPw = 'on';
  // the picture at 30 fps
  if (!my.lastDraw || now - my.lastDraw > 32) {
    my.lastDraw = now;
    drawAttract(my.srcCtx, g, cs.at, stateFor(my, g.id), mkCanvas);
    if (scv) { composeCrt(scv.getContext('2d'), scv.width, scv.height, my.src, cs.pw, my.crt); my.desk.screen.tex.needsUpdate = true; }
    if (!my.lastAvg || now - my.lastAvg > 250) {
      my.lastAvg = now;
      try {
        const a = my.avg.getContext('2d'); a.drawImage(my.src, 0, 0, W0, H0, 0, 0, 4, 4);
        const d = a.getImageData(0, 0, 4, 4).data; let r = 0, gg = 0, b = 0;
        for (let i = 0; i < 64; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
        const m = Math.max(r, gg, b, 1);
        my.rgb = [0.35 + 0.65 * r / m, 0.35 + 0.65 * gg / m, 0.35 + 0.65 * b / m];
      } catch (e) { my.rgb = [0.8, 0.85, 1]; }
    }
  }
  const area = cs.pw.sx * cs.pw.sy;
  const dot = area < 0.01;
  return { bright: cs.pw.bright * (dot ? 0.35 : 0.3 + 0.7 * area), rgb: dot ? [0.8, 0.88, 1] : (my.rgb || [0.8, 0.85, 1]), cs };
}

/** The camera pose for the beat, flowing from where the last beat ended. */
function cameraFor(my, shot, bi, u, P) {
  const beat = shot.beats[bi];
  const key = my.loc.si + ':' + bi;
  if (my.poseKey !== key) { my.poseKey = key; my.fromPose = my.lastPose || beatPose(beat, 0, P); }
  const target = beatPose(beat, u, P);
  const pose = blendPose(my.fromPose, target, span(u, 0, 0.32));
  my.lastPose = pose;
  return pose;
}

function frame(now) {
  const my = run;
  if (!my) return;
  my.raf = requestAnimationFrame(frame);
  const w = innerWidth, h = innerHeight;
  const t = (now - my.t0) / 1000;
  const L = locate(my.plan, t);
  my.loc = L;
  const shot = my.plan[L.si], beat = shot.beats[L.bi], g = my.byId.get(shot.id) || my.games[0];
  // the plate: a new title per game, new lines per beat
  const lk = shot.id + ':' + beat.kind;
  if (lk !== my.labelKey) {
    my.labelKey = lk;
    try { my.label(Object.assign(shotLabel(g, beat.kind), { anchor: () => my.anchor })); } catch (e) { /* the shell is gone */ }
  }
  if (!my.bandT || now - my.bandT > 500) { my.bandT = now; try { my.band = plateBand(h); } catch (e) { my.band = null; } }
  if (my.flat) { flatFrame(my, g, shot, L, now, w, h); return; }
  const { desk, renderer, camera } = my;
  const ev = desk.pose(g, beat.kind, L.u, L.secs);
  const scr = drawScreen(my, g, shot, L.bi, L.tb, now);
  desk.setScreen(scr.bright, scr.rgb);
  // camera
  const P = desk.points(g);
  const pose = cameraFor(my, shot, L.bi, L.u, P);
  const fov = fovFor(w, h), fit = frameFit(w, h, my.band, fov, pose.R);
  const eye = poseEye(pose, fit.dist);
  const sh = ev.click * 0.0012;
  camera.fov = fov; camera.aspect = w / h; camera.near = Math.max(0.01, fit.dist * 0.05);
  camera.position.set(eye[0] + sh * Math.sin(now * 0.09), eye[1] + sh * Math.cos(now * 0.11), eye[2]);
  camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);
  camera.setViewOffset(w, h, 0, fit.offY, w, h);
  camera.updateProjectionMatrix();
  const cw = my.canvas.clientWidth || w, chh = my.canvas.clientHeight || h;
  if (my.sizeW !== cw || my.sizeH !== chh) { my.sizeW = cw; my.sizeH = chh; renderer.setSize(cw, chh, false); }
  renderer.render(desk.scene, camera);
  // the anchor for the plate: the subject centre on screen
  my.anchor = { x: w / 2, y: fit.cy, r: Math.min(w, fit.ch) * 0.4 };
}

function flatFrame(my, g, shot, L, now, w, h) {
  const cv = my.canvas, dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const c = cv.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = '#07080b'; c.fillRect(0, 0, cv.width, cv.height);
  const scr = drawScreen(my, g, shot, L.bi, L.tb, now);
  const band = my.band, top = (band ? band.t : 0) * dpr, bot = (band ? band.b : 0) * dpr;
  const bh = cv.height - top - bot, sw = Math.min(cv.width * 0.9, bh * 0.9 * 1.6), shh = sw / 1.6;
  if (!my.flatScr) my.flatScr = mkCanvas(512, 400);
  const fc = my.flatScr.getContext('2d');
  if (scr.cs.pw) composeCrt(fc, 512, 400, my.src, scr.cs.pw, my.crt); else { fc.fillStyle = '#000'; fc.fillRect(0, 0, 512, 400); }
  c.imageSmoothingEnabled = true;
  c.drawImage(my.flatScr, (cv.width - sw) / 2, top + (bh - shh) / 2, sw, shh);
  my.anchor = { x: w / 2, y: (top + bh / 2) / dpr, r: sw / dpr / 2 };
}

if (typeof window !== 'undefined') {
  window.snSaver = {
    enter(o = {}) {
      if (window.__retro) window.__retro.closePlayer();
      window.snSaver.exit();
      window.snSaverActive = true;
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:200;background:#0b0a0d;display:block';
      document.body.append(canvas);
      const coarse = !!(window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches);
      run = { canvas, calm: o.calm == null ? 0.6 : Math.max(0, Math.min(1, o.calm)), seed: (o.seed >>> 0) || (Date.now() >>> 0), coarse, games: [], plan: [], raf: 0, t0: performance.now(), label: () => {} };
      const my = run;
      start(my, o).catch(e => console.warn('retro-shelf saver', e));
      return { canvas, warmupMs: 1500 };
    },
    exit() {
      const my = run;
      if (!my) return;
      run = null;
      cancelAnimationFrame(my.raf);
      try { if (my.desk) my.desk.dispose(); } catch (e) { /* ignore */ }
      try { if (my.renderer) { my.renderer.dispose(); my.renderer.forceContextLoss(); } } catch (e) { /* ignore */ }
      my.canvas.remove();
      window.snSaverActive = false;
    },
    debug() { const my = run; return my && my.loc ? { loc: my.loc, shot: my.plan[my.loc.si], flat: !!my.flat } : null; },
  };
}
