// director and saver (package M): shot lengths, restart after the
// aftermath, no disease two runs in a row, plate with tex and no code,
// determinism; the Auto runner with a stub app (no DOM, no GPU)
import { readFileSync } from 'node:fs';
import { parseNodes } from '../data.js';
import { createDirector, SHOT_KINDS, DISEASE_IDS } from '../director.js';
import { createAuto, installSaver } from '../saver.js';

const D = parseNodes(JSON.parse(readFileSync(new URL('../data/nodes.json', import.meta.url), 'utf8')));
const STYLES = [{ id: 'night', label: 'Night' }, { id: 'marble', label: 'Marble' }, { id: 'dots', label: 'Dots' },
  { id: 'flat', label: 'Flat' }, { id: 'holo', label: 'Holo' }];

// A stub epidemic: a logistic case curve, a new first infection every
// 6 days, policies that start on day 60 and 120, burned out after day 420.
function stubView(day) {
  const cases = 2e8 / (1 + Math.exp(-(day - 160) / 18));
  const k = Math.floor(day / 6), n = D.nodes.length;
  const active = {};
  if (day > 60) active.distancing = 60;
  if (day > 120) active.travel = 120;
  return {
    day, burnedOut: day > 420,
    totals: { cases, deaths: cases * 0.004, I: cases * 0.05, pop: 7.66e9 },
    reff: 2.5 * Math.exp(-day / 200), hottest: (k * 37) % n,
    newestFirst: day > 3 ? { day: k * 6, from: (k * 11) % n, to: (k * 53 + 7) % n, kind: k % 3 ? 'air' : 'land', edge: k, first: true, blocked: false } : null,
    topRegion: Math.floor(day / 50) % 7, active, D,
  };
}

// Play a director for `wall` seconds of wall time at 10 frames a second.
function play(seed, wall = 600) {
  const dir = createDirector({ seed, calm: 0.7, styles: STYLES, D });
  const shots = [], runs = [];
  let run = dir.newRun(); runs.push(run);
  let day = 0, speed = 0, restarts = 0, restartAfterAftermath = true;
  for (let i = 0; i <= wall * 10; i++) {
    const t = i / 10, r = dir.tick(t, stubView(day));
    if (r.restart) {
      if (!shots.length || shots[shots.length - 1].kind !== 'aftermath') restartAfterAftermath = false;
      restarts++; run = dir.newRun(); runs.push(run); day = 0; continue;
    }
    if (r.changed) { shots.push({ ...r.shot, t }); speed = r.shot.simSpeed; }
    day += speed * 0.1;
  }
  return { dir, shots, runs, restarts, restartAfterAftermath };
}

export default function (ok) {
  const A = play(12345), B = play(12345), C = play(999);

  ok('director: shots happen', A.shots.length > 20, `${A.shots.length} shots`);
  const durs = A.shots.concat(C.shots).map(s => s.dur);
  ok('director: every shot lasts 5-12 s', durs.every(d => d >= 5 && d <= 12), `${Math.min(...durs).toFixed(1)}..${Math.max(...durs).toFixed(1)}`);
  ok('director: every shot kind is known', A.shots.every(s => SHOT_KINDS.includes(s.kind)));
  ok('director: every shot has a camera and a style', A.shots.every(s => s.cam && Number.isFinite(s.cam.lat) && Number.isFinite(s.cam.lon) && s.cam.alt > 0 && s.style));
  ok('director: a run starts with the origin shot', A.shots[0].kind === 'origin');
  const kinds = new Set(A.shots.concat(C.shots).map(s => s.kind));
  ok('director: at least 6 shot kinds in 20 minutes', kinds.size >= 6, [...kinds].join(' '));
  const repeats = A.shots.filter((s, i) => i && s.kind === A.shots[i - 1].kind && s.kind !== 'origin');
  ok('director: no kind two times in a row (inside a run)', repeats.length === 0, repeats.map(s => s.kind).join(' '));
  ok('director: a burned-out view yields restart after the aftermath shot', A.restarts >= 1 && A.restartAfterAftermath, `${A.restarts} restarts`);

  // a burned-out view directly: the next cut is aftermath, then restart
  {
    const d = createDirector({ seed: 5, styles: STYLES, D }); d.newRun();
    const r0 = d.tick(0, stubView(0));
    const r1 = d.tick(r0.shot.dur + 0.01, stubView(500));
    const r2 = d.tick(r0.shot.dur + 0.02, stubView(500));
    const r3 = d.tick(r0.shot.dur + r1.shot.dur + 0.1, stubView(500));
    ok('director: burned out -> aftermath, holds, then restart', r1.shot.kind === 'aftermath' && !r2.restart && !r2.changed && r3.restart && r1.shot.simSpeed === 0);
  }

  // two runs never pick the same disease in a row
  {
    const d = createDirector({ seed: 77, styles: STYLES, D }), ids = [];
    for (let i = 0; i < 300; i++) ids.push(d.newRun().diseaseId);
    const same = ids.filter((id, i) => i && id === ids[i - 1]).length;
    ok('director: never the same disease two runs in a row', same === 0, `${new Set(ids).size} diseases`);
    ok('director: every run disease is a preset id', ids.every(id => DISEASE_IDS.includes(id)));
    const r = d.newRun();
    ok('director: newRun gives a seed node, policies and a day of year',
      r.seedNode >= 0 && r.seedNode < D.nodes.length && r.policies && r.policies.distancing && r.startDayOfYear >= 0 && r.startDayOfYear < 365);
    const runs = []; for (let i = 0; i < 60; i++) runs.push(d.newRun());
    const vec = runs.filter(x => x.diseaseId === 'dengue' || x.diseaseId === 'malaria');
    ok('director: vector diseases start in the tropics', vec.length > 0 && vec.every(x => Math.abs(D.nodes[x.seedNode].lat) < 25));
    ok('director: run styles change between runs', runs.every((x, i) => !i || x.style !== runs[i - 1].style));
  }

  // the plate
  {
    const d = createDirector({ seed: 3, styles: STYLES, D }); d.newRun(); d.tick(0, stubView(0));
    const dis = { id: 'measles', name: 'Measles', R0: 15, latent: 10, infectious: 8, ifr: 0.002 };
    const p = d.plate(stubView(130), dis);
    ok('director: the plate has tex and no code', Array.isArray(p.tex) && p.tex.length > 0 && !('code' in p), p.title);
    ok('director: the plate names the disease and the shot', p.title === 'Measles' && typeof p.sub === 'string' && p.sub.length > 0);
    ok('director: the plate params have TeX symbols and values', p.params.length >= 4 && p.params.every(q => q.sym && q.value));
    const braces = s => { let n = 0; for (const c of s) { if (c === '{') n++; if (c === '}') n--; if (n < 0) return false; } return n === 0; };
    ok('director: plate TeX braces balance', p.tex.every(braces));
    const d2 = createDirector({ seed: 3, styles: STYLES, D, texFor: x => ['\\dot I = ' + x.R0] });
    ok('director: the plate uses texFor when given', d2.plate(stubView(1), dis).tex[0] === '\\dot I = 15');
    ok('director: a plate with no disease still has tex and no code', (q => q.tex.length && !('code' in q))(d.plate({}, null)));
  }

  // determinism
  const key = r => r.shots.map(s => `${s.kind}|${s.style}|${s.dur.toFixed(4)}|${s.cam.lat.toFixed(4)}|${s.cam.lon.toFixed(4)}|${s.title}`).join('\n');
  ok('director: the same seed gives the same shot list', key(A) === key(B) && A.runs.map(r => r.diseaseId).join() === B.runs.map(r => r.diseaseId).join());
  ok('director: another seed gives another shot list', key(A) !== key(C));

  // force (snSaver.cut)
  {
    const d = createDirector({ seed: 9, styles: STYLES, D }); d.newRun();
    d.tick(0, stubView(0));
    d.force('flat');
    const r = d.tick(1, stubView(200));
    ok('director: force cuts to the kind at once', r.changed && r.shot.kind === 'flat' && r.shot.style === 'flat');
    ok('director: force rejects an unknown kind', d.force('nope') === false);
  }

  // the Auto runner with a stub app
  {
    let day = 0, speed = 0, playing = false, styleNow = null;
    const fades = [], startRuns = [], setShots = [];
    const app = {
      canvas: {}, D, styles: STYLES,
      globe: { setStyle: s => { styleNow = s; }, setFade: a => fades.push(a), setViewOffset() {} },
      view: () => stubView(day), disease: () => ({ id: 'x', name: 'Test', R0: 2, latent: 2, infectious: 4, ifr: 0.01 }),
      startRun: r => { startRuns.push(r); day = 0; },
      setSpeed: s => { speed = s; }, play: b => { playing = b; },
      setShot: (s, o) => setShots.push({ kind: s.kind, fly: o.fly }),
    };
    const plates = [];
    const auto = createAuto(app, { seed: 42, calm: 0.6, label: p => plates.push(p) });
    auto.start(0);
    for (let i = 1; i <= 9000; i++) { const t = i / 15; auto.frame(t); if (playing) day += speed / 15; }
    const dbg = auto.debug();
    ok('saver: the runner restarts runs', startRuns.length >= 2, `${startRuns.length} runs, ${setShots.length} shots`);
    ok('saver: startRun gets a seed and a preset disease', startRuns.every(r => r.seed > 0 && DISEASE_IDS.includes(r.diseaseId)));
    ok('saver: fades stay in 0..1', fades.length > 0 && fades.every(a => a >= 0 && a <= 1));
    ok('saver: some cuts fly and some fade', setShots.some(s => s.fly) && setShots.some(s => !s.fly));
    ok('saver: a style is on the globe', typeof styleNow === 'string' && dbg.style === styleNow);
    ok('saver: plates have no code', plates.length > 0 && plates.filter(Boolean).every(p => !('code' in p) && p.tex.length));
    auto.stop();
    ok('saver: stop clears the plate and the fade', plates[plates.length - 1] === null && fades[fades.length - 1] === 1 && !auto.running);
  }
  // installSaver with a stub window (no document): the snSaver protocol
  {
    const had = 'window' in globalThis, old = globalThis.window;
    globalThis.window = { innerWidth: 1280, innerHeight: 800 };
    try {
      let day = 0, speed = 0, starts = 0, restored = 0;
      const canvas = { id: 'globe' };
      const app = {
        canvas, D, styles: STYLES, globe: { setStyle() {}, setFade() {}, setViewOffset() {} },
        view: () => stubView(day), disease: () => null, startRun: () => { starts++; day = 0; },
        setSpeed: s => { speed = s; }, play() {}, setShot() {}, saveState: () => ({ a: 1 }), restoreState: s => { if (s && s.a) restored++; },
      };
      const ctl = installSaver(app), sv = globalThis.window.snSaver;
      const labels = [];
      const got = sv.enter({ calm: 0.5, seed: 11, label: p => labels.push(p) });
      for (let i = 1; i < 600; i++) { ctl.frame(i / 30); day += speed / 30; }
      ok('saver: enter returns the canvas and a warmup', got.canvas === canvas && got.warmupMs > 0 && ctl.mode === 'saver' && starts === 1);
      ok('saver: cut and debug work', sv.cut('network') === true && sv.debug().mode === 'saver');
      ok('saver: the Auto button does not replace the screensaver', ctl.auto(true) === false && ctl.mode === 'saver');
      sv.exit();
      ok('saver: exit restores the state and clears the plate', restored === 1 && ctl.mode === null && labels[labels.length - 1] === null);
      ok('saver: the Auto button runs without a plate', ctl.auto(true, { seed: 4 }) === true && ctl.mode === 'button' && ctl.running);
      ctl.auto(false);
      ok('saver: the Auto button stops', ctl.mode === null && !ctl.running);
    } finally { if (had) globalThis.window = old; else delete globalThis.window; }
  }
}
