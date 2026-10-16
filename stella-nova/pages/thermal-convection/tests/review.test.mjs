// THERMAL CONVECTION · tests/review.test.mjs — checks for the bugs that the
// phase 3 review found (package REVIEW). No DOM, no GPU.
//   occlusion   the status bar between the two side columns (1280 px wide)
//   landscape   the LANDSCAPE css block is a subset of the PHONE query
//   refitCam    the block camera fits again when Lz or the aspect changes
//   tracers     a tracer shot turns the sim tracers on
//   colours     the saver plate uses the class of each term of the page key
import { readFileSync } from 'node:fs';
import { occlusionOf } from '../ui.js';
import { fitBlock, orbitCam, refitCam, project, boxCorners } from '../render/orbit.js';
import { layoutRects } from '../render/layout.js';
import { createDirector, RULES as SAVER_RULES, labelParams } from '../director.js';
import { TERMS, DEFINITIONS } from '../explainer.js';

const here = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, here), 'utf8');

const inside = (cam, dims, m = 1) => boxCorners(dims).every(p => {
  const q = project(orbitCam(cam).viewProj, p);
  return q.w > 0 && Math.abs(q.x) <= m && Math.abs(q.y) <= m;
});

export default function run(ok) {
  // ── occlusion: 1280 x 720, panel 300 px left, physics 380 px right, the
  // status bar 38 px between them (600 px = 47 % of the width), the topbar.
  const occ = occlusionOf([
    { left: 0, top: 0, right: 300, bottom: 720 },
    { left: 900, top: 0, right: 1280, bottom: 720 },
    { left: 300, top: 682, right: 900, bottom: 720 },
    { left: 0, top: 0, right: 1280, bottom: 52 },
  ], 1280, 720);
  ok('review: the status bar between two columns counts as the base', occ.b === 38 && occ.l === 300 && occ.r === 380 && occ.t === 52, JSON.stringify(occ));
  const occ2 = occlusionOf([{ left: 500, top: 300, right: 900, bottom: 360 }], 1280, 720);
  ok('review: a box in the middle of the frame still does not count', occ2.b === 0 && occ2.t === 0, JSON.stringify(occ2));

  // ── landscape: every part of the LANDSCAPE media query needs a coarse
  // pointer or a narrow window (PHONE_Q). Else a short desktop window gets
  // the phone drawer on top of the #physics column.
  const css = read('style.css');
  const q = (css.match(/@media ([^{]*orientation:landscape[^{]*)\{/) || [])[1] || '';
  const parts = q.split(',').map(s => s.trim()).filter(Boolean);
  ok('review: the landscape phone block only matches phones', parts.length > 0 && parts.every(s => /pointer:coarse/.test(s) || /max-width:768px/.test(s)), q);

  // ── refitCam: fit at 16:10, the user zooms out 10 %, then the phone turns
  // to 9:16 and the vertical scale goes to 2.5.
  const d0 = { Lx: 4, Ly: 4, Lz: 1.5 }, d1 = { Lx: 4, Ly: 4, Lz: 2.5 };
  let cam = refitCam(null, d0, 1.6);
  ok('review: refitCam(null) is the fitted camera', Math.abs(cam.dist - fitBlock(d0, 1.6).dist) < 1e-9 && inside(cam, d0));
  ok('review: refitCam keeps the object when nothing changed', refitCam(cam, d0, 1.6) === cam);
  cam = { ...cam, dist: cam.dist * 1.1 };
  const stale = { ...cam, aspect: 0.5625 };
  ok('review: the stale camera clips the turned block (the bug)', !inside(stale, d1));
  const re = refitCam(cam, d1, 0.5625);
  ok('review: refitCam frames the block again after the turn', inside({ ...re, dist: re.fitDist }, d1, 0.9) && inside(re, d1));
  ok('review: refitCam keeps the user zoom', Math.abs(re.dist / re.fitDist - 1.1) < 1e-9 && re.target[2] === 1.25, `${re.dist / re.fitDist} ${re.target}`);

  // ── tracers: the user turned tracers off; the soup shot turns them on.
  const calls = [];
  const app = {
    params: { Lx: 4, Ly: 4, burner: { x: 0.5, y: 0.5 } }, preset: 'benard', toggles: { tracers: false },
    sim: { dims: { Lx: 4, Ly: 4 }, tracerCount: 0, stats: () => null, set() {} },
    views: { set() {} },
    applyPreset() { return true; }, setView() {}, setSlice() {}, reset() {},
    setToggle(k, on) { calls.push([k, on]); app.toggles[k] = on; },
  };
  const dir = createDirector(app, { seed: 7, layout: layoutRects, frame: () => ({ W: 1280, H: 720, band: null }) });
  dir.cut('soup-pot');
  ok('review: a tracer shot turns the sim tracers on', calls.some(([k, on]) => k === 'tracers' && on === true), JSON.stringify(calls));

  // ── colours: each saver rule term has the class of the same term on the page
  const cls = key => TERMS.find(t => t.key === key).cls;
  const want = [[/cdot\\nabla/, cls('advection')], [/\\nabla p/, cls('pressure')], [/nabla\^2\\mathbf\{u\}/, cls('viscosity')], [/hat\{\\mathbf\{z\}\}/, cls('buoyancy')], [/nabla\^2 T/, cls('diffusion')]];
  const bad = SAVER_RULES.filter(([tex, c]) => { const w = want.find(([re]) => re.test(tex)); return !w || w[1] !== c; });
  ok('review: the saver plate colours match the page key', bad.length === 0, JSON.stringify(bad));
  const ra = labelParams({ params: { Ra: 1e5, Pr: 1 } }).find(p => p.sym === '\\mathrm{Ra}');
  ok('review: the plate Ra has the panel class', ra.cls === DEFINITIONS.find(x => x.sym === '\\mathrm{Ra}').cls, ra.cls);
}
