// ============================================================================
//  LENIA  ·  app/creature.js — load, place and seed a creature
// ----------------------------------------------------------------------------
//  selectCreature() loads a catalog record into the UI and the engine.
//  placeCreature() clears the world and stamps the creature in the middle.
//  soup() fills the world with random blobs at the creature scale.
//
//  GREP MAP
//    grep -n 'function selectCreature'  load a creature into the engine and UI
//    grep -n 'function engineRule'      S.rule -> the engine rule
//    grep -n 'function placeCreature'   clear the world and stamp the creature
//    grep -n 'function soup'            random blobs at detail 1
// ============================================================================
import { resample } from '../engine.js';
import { wrap } from './torus.js';
import { familyOf, familyColor, cellsOf } from './catalog.js';
import { $, LS_KEY, S, setText, lsSet, det } from './state.js';
import { buildRule } from './rule.js';
import { drawPlots } from './plots.js';
import { renderEquations } from './equations.js';
import { markBrowser } from './browser.js';
import { sizeWorld } from './world.js';

export function selectCreature(i) {
  const n = S.creatures.length;
  if (!n) return;
  i = wrap(i, n);
  const c = S.creatures[i];
  S.idx = i; S.c = c;
  S.rule = { m: c.m, s: c.s, T: c.T, scale: c.scale };
  if (!S.saver) lsSet(LS_KEY, c.code);   // the screensaver writes no storage

  const fam = familyOf(c);
  const chip = $('curFamily');
  chip.textContent = fam;
  chip.style.setProperty('--c', familyColor(fam));
  setText('curIdx', `${i + 1} / ${n}`);
  setText('curName', c.name);
  const sub = $('curSub');
  sub.textContent = '';
  const cn = document.createElement('span'); cn.className = 'cn'; cn.textContent = c.cname;
  sub.append(c.code);
  if (c.cname) sub.append(' · ', cn);
  if (c.rank[3] && !c.rank[3].startsWith('(')) sub.append(` · ${c.rank[3]}`);
  if (c.cls === 'grow') sub.append(' · grows without limit');
  if (c.fixed) sub.append(' · detail 1× only');
  setText('dockName', c.name);
  $('dockDot').style.setProperty('--c', familyColor(fam));
  markBrowser();

  buildRule();
  renderEquations();
  drawPlots();
  if (S.engine) {
    sizeWorld();
    S.engine.setRule(engineRule());
    placeCreature();
  }
}

export function engineRule() {
  const c = S.c;
  return { R: c.R * S.rule.scale * det(), T: S.rule.T, m: S.rule.m, s: S.rule.s, b: c.b, kn: c.kn, gn: c.gn };
}

// Clear the world and stamp the creature in the middle at the current scale.
export function placeCreature() {
  if (!S.engine || !S.c) return;
  S.engine.clear();
  const { W, H } = S.engine.info;
  S.engine.stamp(resample(cellsOf(S.c), S.rule.scale * det()), W / 2, H / 2);
  S.engine.setView({ cx: W / 2, cy: H / 2 });
  S.time = 0; S.acc = 0;
  S.stats = null; S.vel = { x: 0, y: 0 };
}

export function soup() {
  if (!S.engine || !S.c) return;
  const { W, H } = S.engine.info;
  // The noise is made at detail 1 and scaled up. Cell-size white noise at a
  // high detail averages out over the larger kernel, and nothing grows.
  const R = S.c.R * S.rule.scale;
  const pw = Math.round(W * 0.7 / det()), ph = Math.round(H * 0.7 / det());
  const data = new Float32Array(pw * ph);
  const blobs = Math.max(4, Math.round(pw * ph / (R * R * 9)));
  for (let k = 0; k < blobs; k++) {
    const bx = Math.random() * pw, by = Math.random() * ph, br = R * (0.8 + Math.random() * 1.2);
    const x0 = Math.max(0, Math.floor(bx - br)), x1 = Math.min(pw - 1, Math.ceil(bx + br));
    const y0 = Math.max(0, Math.floor(by - br)), y1 = Math.min(ph - 1, Math.ceil(by + br));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (Math.hypot(x - bx, y - by) < br) data[y * pw + x] = Math.random();
    }
  }
  S.engine.clear();
  S.engine.stamp(resample({ w: pw, h: ph, data }, det()), W / 2, H / 2);
  S.time = 0;
}
