// ============================================================================
//  BIOME PARTS  ·  saver.js — window.snSaver: Taiga-S1 building parts, live
// ----------------------------------------------------------------------------
//  The shell screensaver (lib/screensaver.js) calls snSaver.enter(opts). The
//  page hides its panels, and director.js starts the live loop: a fresh goal
//  per part, a real forward pass per step in the worker, paced so a viewer
//  can follow. This module turns the director's events into camera springs
//  (scene.js), a score-bar column (#saverHud) and the shell's label plate.
//
//  SHOTS (director.SHOTS + the finish): overview, pushin (to the newest
//  feature), low, top, side, orbit; exploded (additive features lift apart)
//  or gallery (a fast orbit) when a part ends. The subject is centred in the
//  plate's clear band (lib/saver-clear.js plateBand).
//  PLATE: title, part name, step, the command and its softmax score, the
//  tally (parts built, share right), and one TeX line. No code.
//
//  GREP MAP
//    installSaver ...... defines window.snSaver
//    hud ............... the bars and the done ticks
//    plate ............. opts.label payload
//    shot .............. camera goals per shot kind
// ============================================================================
import { createDirector } from './director.js';
import { actionLabel } from './ui.js';
import { opWorldCentre } from './view.js';

export function installSaver({ app, $, prepare }) {
  let D = null, hud = null, label = () => {}, cur = null, bandFn = null, timers = new Set();
  const sleep = ms => new Promise(r => { const t = setTimeout(() => { timers.delete(t); r(); }, ms); timers.add(t); });

  function band() {
    const h = window.innerHeight;
    let b = null;
    try { b = bandFn ? bandFn(h) : null; } catch (e) { b = null; }
    if (!b) return { fill: 1.3, dy: 0 };
    const clear = Math.max(0.3 * h, h - b.t - b.b);
    const mid = (b.t + (h - b.b)) / 2 - h / 2;
    return { fill: 1.25 * h / clear, dy: mid / h };
  }
  function shot(kind, info) {
    const sc = app.scene; if (!sc || !cur) return;
    const bb = cur.target.bbox, B = band();
    const yaw = sc.yaw;
    sc.setExplode(0);
    const f = (o) => { sc.frame(bb, { fill: B.fill * (o.fill || 1), ...o }); sc.shiftTarget(B.dy); };
    if (kind === 'overview') { f({ yaw: yaw + 40, pitch: 28 }); sc.setSpin(6); }
    else if (kind === 'pushin') {
      f({ pitch: 34, fill: 0.62 });
      const op = sc.newestOp();
      if (op && op.F) sc.aimAt(opWorldCentre(op), 1);
      sc.setSpin(4);
    } else if (kind === 'low') { f({ yaw: yaw + 70, pitch: 7, fill: 0.95 }); sc.setSpin(-7); }
    else if (kind === 'top') { f({ yaw: yaw + 30, pitch: 70 }); sc.setSpin(5); }
    else if (kind === 'side') { f({ yaw: yaw + 90, pitch: 16 }); sc.setSpin(-5); }
    else if (kind === 'orbit') { f({ pitch: 24 }); sc.setSpin(24); }
    else if (kind === 'exploded') {
      const h = bb[1][2] - bb[0][2];
      f({ pitch: 22, fill: 1.25 }); sc.setExplode(Math.max(6, h * 0.9)); sc.setSpin(14);
    } else if (kind === 'gallery') { f({ pitch: 26 }); sc.setSpin(40); }
  }
  function drawHud(v, info) {
    if (!hud) return;
    const d = v.decision;
    hud.textContent = '';
    if (d) {
      for (const [i, r] of d.rows.slice(0, 6).entries()) {
        const row = document.createElement('div'); row.className = 'r' + (i === 0 ? ' top' : '');
        const bar = document.createElement('i'); bar.style.width = (100 * r.p).toFixed(1) + '%';
        const t = document.createElement('span'); t.textContent = `${r.p.toFixed(2)}  ${actionLabel(r.a)}`;
        row.append(bar, t); hud.append(row);
      }
    } else if (info && info.action) {
      const row = document.createElement('div'); row.className = 'r' + (info.noise ? ' noise' : ' top');
      const t = document.createElement('span'); t.textContent = (info.noise ? 'gremlin: ' : 'took: ') + actionLabel(info.action);
      row.append(t); hud.append(row);
    }
    const ck = document.createElement('div'); ck.className = 'ck';
    v.goal.features.forEach((f, i) => {
      const b = document.createElement('b');
      const z = d ? d.done[i] : null;
      if ((z != null && z >= 0) || (!d && i < v.progress)) b.className = 'y';
      else if (d && d.active === i) b.className = 'a';
      ck.append(b);
    });
    hud.append(ck);
  }
  function plate(v, info, tally) {
    const d = v.decision, top = d ? d.rows[0] : null;
    const pct = tally.built ? Math.round(100 * tally.ok / tally.built) : null;
    const item = d ? d.active : v.progress;
    const n = v.goal.features.length;
    label({
      title: 'Taiga-S1, live',
      sub: `${info.name} · part ${info.n} · step ${v.step} of at most ${v.budget}`,
      params: [
        { sym: 'a', name: 'next command', value: top ? actionLabel(top.a) : info.action ? actionLabel(info.action) : '…', cls: 'm1' },
        { sym: 'p', name: 'softmax score', value: top ? top.p.toFixed(3) : '–', cls: 'm5' },
        { sym: 'k', name: 'goal item', value: item < n ? `${item + 1} of ${n}` : `all ${n} built`, cls: 'm2' },
        { sym: 'N', name: 'parts built', value: `${tally.built}, ${tally.ok} right${pct == null ? '' : ` (${pct}%)`}`, cls: 'm3' },
      ],
      tex: [String.raw`p(a \mid s, g) = \frac{e^{z_a/T}}{\sum_{b} e^{z_b/T}}` + (top ? ` = ${top.p.toFixed(3)}` : '')],
      rules: [['a', 'm1'], ['p', 'm5'], ['T', 'm6'], ['z_a', 'm1'], ['z_b', 'm1']],
      lines: [info.gremlin ? 'live · a gremlin replaces some of Taiga’s commands with random ones; watch it undo the damage' : 'live · every step is a new forward pass of the 1.2M-parameter model'],
    });
  }

  window.snSaver = {
    async enter(o = {}) {
      prepare();
      document.documentElement.classList.add('bp-saver');
      label = typeof o.label === 'function' ? o.label : () => {};
      try { bandFn = (await import('../../../lib/saver-clear.js')).plateBand; } catch (e) { bandFn = null; }
      hud = document.createElement('div'); hud.id = 'saverHud'; hud.setAttribute('aria-hidden', 'true');
      document.body.append(hud);
      const calm = Math.max(0, Math.min(1, o.calm ?? 0.6));
      for (let i = 0; i < 100 && !app.brain; i++) await sleep(100);
      if (!app.brain) return { canvas: $('view'), warmupMs: 500 };
      D = createDirector({ brain: app.brain, seed: (o.seed >>> 0) || ((Date.now() & 0xffffff) + 1), calm, sleep, hooks: {
        onView(v, phase, info) {
          cur = v;
          const sc = app.scene;
          if (sc) {
            if (phase === 'start') { sc.setExplode(0); sc.setTape(v.ops, v.target.bbox); }
            else sc.setTape(v.ops, v.bbox || v.target.bbox);
            sc.setSketch(v.edit);
            if (phase === 'act' && info.action && /^PartDesign_/.test(info.action) && v.ops.length) sc.setHighlight(v.ops[v.ops.length - 1].id);
            else if (phase === 'think') sc.setHighlight(null);
          }
          drawHud(v, phase === 'act' ? info : null);
          plate(v, info, D.tally);
        },
        onShot: (k, info) => shot(k, info),
      } });
      D.run();
      return { canvas: $('view'), warmupMs: 1800 };
    },
    exit() {
      if (D) D.stop();
      D = null;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      if (hud) hud.remove(); hud = null;
      document.documentElement.classList.remove('bp-saver');
      if (app.scene) { app.scene.setExplode(0); app.scene.setSpin(0); app.scene.setSketch(null); }
      label(null);
    },
    debug: () => (D ? { tally: D.tally, step: cur && cur.step } : null),
  };
}
