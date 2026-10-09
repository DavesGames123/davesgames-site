// shots: the data-driven screensaver. The real model, network, stats,
// director and main.js app with a stub globe (no browser, no GPU):
//   - the director picks its subjects from the real sim state (the
//     fastest-growing city, a newly reached region, the export hub, a
//     region that tipped over, the curve)
//   - shots last 8-12 s, and some cuts land on events
//   - the HUD numbers match sim.history and sim.totals()
//   - the plate sub line names the subject with live numbers
//   - the HUD panel and the phone limits
import { readFileSync } from 'node:fs';
import { parseNodes } from '../data.js';
import { buildNetwork } from '../network.js';
import { createStats, GROW_MIN_I, TIP_FRAC, TIP_MIN, TIP_PREV, fmtDays } from '../stats.js';
import { SHOT_S, SHOT_KINDS } from '../director.js';
import { hudRows, hudSize, hudRect, drawHud, sparkPoints, HUD } from '../render/hud.js';
import { fmtCount } from '../ui.js';

function stubGlobe() {
  const g = {
    styles: [{ id: 'night', label: 'Night' }, { id: 'marble', label: 'Marble' }, { id: 'dots', label: 'Dots' },
      { id: 'flat', label: 'Flat map' }, { id: 'holo', label: 'Hologram' }],
    style: null, mode: 'globe', cam: null, fade: 1, hudOn: false, hudOpts: null, lastHud: null,
    setStyle(id) { g.style = id; g.mode = id === 'flat' ? 'flat' : 'globe'; },
    setCamera(c) { g.cam = { ...c }; }, setViewOffset() {}, setFade(a) { g.fade = a; },
    update(f) { g.lastHud = f.hud; g.lastSim = f.sim; }, pick: () => -1, resize() {}, dispose() {},
    setHud(o) { g.hudOpts = o; g.hudOn = !!o.on; return true; },
  };
  return g;
}

// A stub 2D context: records the text drawn.
function stub2d() {
  const texts = [];
  const g = { texts, font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: 'left', textBaseline: 'alphabetic',
    clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, stroke() {},
    measureText: s => ({ width: 7 * String(s).length }), fillText(s, x, y) { texts.push({ s: String(s), x, y }); } };
  return g;
}
// drawTab draws one character at a time from the right: join each line back
const lineTexts = texts => {
  const by = new Map();
  for (const t of texts) { const k = Math.round(t.y); if (!by.has(k)) by.set(k, []); by.get(k).push(t); }
  return [...by.values()].map(l => l.sort((a, b) => a.x - b.x).map(t => t.s).join(''));
};

export default async function (ok) {
  const M = await import('../main.js');
  const { installSaver } = await import('../saver.js');
  const D = parseNodes(JSON.parse(readFileSync(new URL('../data/nodes.json', import.meta.url), 'utf8')));
  const net = buildNetwork(D);

  // ── stats on a real run ──
  {
    const { createSim } = await import('../model.js');
    const { getDisease } = await import('../diseases.js');
    const { defaultPolicies } = await import('../policies.js');
    const sim = createSim({ D, net, disease: getDisease('covid-ancestral'), policies: defaultPolicies(), seed: 7, seedNode: 10 });
    const st = createStats(D);
    let cur = 0, gOk = true, gN = 0, tipOk = true, tips = 0, hudOk = true, xOk = true, xN = 0;
    for (let f = 0; f < 2600 && !sim.burnedOut; f++) {
      const dayBefore = Math.floor(sim.day);
      sim.step(0.1);
      const e = sim.eventsSince(cur); cur = e.cursor; st.update(sim, e.list);
      if (Math.floor(sim.day) === dayBefore) continue;
      // growth: check the pick against a direct scan of I three days back
      const g = st.growth(sim);
      if (g) {
        gN++;
        if (!(sim.I[g.node] >= GROW_MIN_I) || !(Math.abs(g.doubling - Math.LN2 / g.rate) < 1e-9) || !(g.rate > 0)) gOk = false;
      }
      const x = st.exporter(sim);
      if (x) { xN++; if (!(x.count >= 1 && x.node >= 0)) xOk = false; }
      const tp = st.tipped(sim);
      if (tp && tp.count > tips) {
        tips = tp.count;
        const R = st.regions(sim)[tp.region];
        if (!((R.cities >= TIP_MIN && R.reached >= TIP_FRAC * R.cities) || R.I / R.pop >= TIP_PREV)) tipOk = false;
      }
      const h = st.hud(sim), t = sim.totals(), hist = sim.history;
      if (h.today !== hist.inc[hist.inc.length - 1] || h.cases !== t.cases || h.deaths !== t.deaths || h.infected !== t.E + t.I || h.day !== sim.day) hudOk = false;
    }
    ok('stats: the fastest-growing city is a real reading (enough cases, rate > 0)', gOk && gN > 50, `${gN} days with a reading`);
    ok('stats: an export hub exists once flights carry the infection', xOk && xN > 50, `${xN} days`);
    ok('stats: regions tip over only by the rule (half the cities, or 1e-3 infected)', tipOk && tips >= 3, `${tips} regions tipped`);
    ok('stats: the HUD numbers are sim.history and sim.totals(), each day', hudOk);
    const c = st.curve(sim);
    ok('stats: the curve finds the peak of daily new cases', c.peakInc === Math.max(...sim.history.inc) && c.peakDay >= 0, `peak ${fmtCount(c.peakInc)} on day ${c.peakDay}`);
  }

  // ── the director on the real app: each pick against the view it saw ──
  const { createDirector } = await import('../director.js');
  const decide = (seed, wall = 900, fps = 10) => {
    const g = stubGlobe();
    const app = M.createApp({ D, net, globe: g, seed: 5 });
    const dir = createDirector({ seed, calm: 0.6, styles: g.styles, D });
    const picks = [];
    const start = () => { const run = dir.newRun(); app.saverApp.startRun({ ...run, seed: seed + picks.length }); };
    start();
    let t = 0, known = new Set();
    for (let k = 0; k < wall * fps; k++) {
      t += 1 / fps; app.frame(t);
      const v = app.view(), r = dir.tick(t, v);
      if (r.restart) { start(); known = new Set(); continue; }
      if (r.changed) {
        picks.push({ s: r.shot, v, t, known: new Set(known) });
        app.saverApp.setSpeed(r.shot.simSpeed); app.saverApp.play(r.shot.simSpeed > 0);
        known = new Set(app.sim.firstDay.reduce((a, d, i) => (d >= 0 ? a.concat(D.nodes[i].region) : a), []));
      }
    }
    return picks;
  };
  const P = decide(4242).concat(decide(77));
  const kinds = new Set(P.map(x => x.s.kind));
  ok('shots: the real run gives the data-driven kinds', ['origin', 'surge', 'front', 'export', 'tipping', 'curve'].every(k => kinds.has(k)) && kinds.size >= 8, [...kinds].join(' '));
  ok('shots: every kind is a known kind', P.every(x => SHOT_KINDS.includes(x.s.kind)));
  const surge = P.filter(x => x.s.kind === 'surge');
  ok('shots: a surge shot pushes in on the fastest-growing city of the sim', surge.length >= 2 && surge.every(x => x.v.growth && x.s.follow.id === x.v.growth.node && x.s.camEnd.alt < x.s.cam.alt),
    `${surge.length}: ${surge.slice(0, 3).map(x => D.nodes[x.s.follow.id].name + ' x2 in ' + x.v.growth.doubling.toFixed(1) + ' d').join(', ')}`);
  const front = P.filter(x => x.s.kind === 'front' && x.s.subject.newRegion);
  ok('shots: a front shot opens on a region that was not reached at the cut before', front.length >= 2 && front.every(x => !x.known.has(x.s.subject.region) && x.v.sim.firstDay[x.s.subject.node] >= 0 && D.nodes[x.s.subject.node].region === x.s.subject.region),
    `${front.length}: ${front.slice(0, 4).map(x => D.regions[x.s.subject.region]).join(', ')}`);
  const exp = P.filter(x => x.s.kind === 'export');
  ok('shots: an export shot sits over the hub with the most infected flights out', exp.length >= 1 && exp.every(x => x.v.exporter && x.s.follow.id === x.v.exporter.node && x.v.exporter.count >= 3),
    `${exp.length}: ${exp.slice(0, 3).map(x => D.nodes[x.s.follow.id].name + ' ' + x.v.exporter.count).join(', ')}`);
  const tip = P.filter(x => x.s.kind === 'tipping');
  ok('shots: a tipping shot pulls back from the region that just tipped', tip.length >= 2 && tip.every(x => x.v.tipped && x.s.subject.region === x.v.tipped.region && x.s.camEnd.alt > x.s.cam.alt),
    `${tip.length}: ${tip.slice(0, 3).map(x => D.regions[x.s.subject.region]).join(', ')}`);
  const curve = P.filter(x => x.s.kind === 'curve' && x.s.subject.why !== 'curve');
  ok('shots: a curve moment comes after the peak or when R_eff falls below 1', curve.length >= 1 && curve.every(x => (x.s.subject.why === 'peak' && x.v.curve.peaked) || (x.s.subject.why === 'below1' && x.v.curve.below1)) && curve.every(x => x.s.hud === 'curve'),
    curve.map(x => `${x.s.subject.why} day ${Math.floor(x.v.day)}`).join(', '));
  const orig = P.filter(x => x.s.kind === 'origin' && x.v.day < 0.5);
  ok('shots: the cold open is on the seed city, close, at day 0', orig.length >= 2 && orig.every(x => x.v.sim.firstDay[x.s.follow.id] === 0 && x.s.cam.alt < 0.4 && x.s.camEnd.alt > x.s.cam.alt), `${orig.length} runs`);
  ok('shots: the shot lengths are 8-12 s', P.every(x => x.s.dur >= SHOT_S[0] && x.s.dur <= SHOT_S[1]));
  // event cuts: a cut that comes before the planned end lands on an event kind
  const lens = [];
  let early = 0, earlyOnEvent = true;
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1], b = P[i];
    if (a.v.sim !== b.v.sim) continue;
    const L = b.t - a.t; lens.push(L);
    if (L < a.s.dur - 0.15) { early++; if (!['policy', 'tipping', 'front', 'curve', 'aftermath'].includes(b.s.kind)) earlyOnEvent = false; }
  }
  ok('shots: every cut comes 8-12 s after the one before', lens.length > 30 && lens.every(L => L >= SHOT_S[0] - 1e-9 && L <= SHOT_S[1] + 0.11), `${Math.min(...lens).toFixed(1)}..${Math.max(...lens).toFixed(1)} s over ${lens.length} cuts`);
  ok('shots: cuts land on events (an early cut always opens an event shot)', early >= 3 && earlyOnEvent, `${early} early cuts`);
  const P2 = decide(4243, 300);
  ok('shots: another seed gives another shot list', P2.map(x => x.s.kind).join() !== P.slice(0, P2.length).map(x => x.s.kind).join());

  // ── the Auto runner: a faded cut runs its full length on screen ──
  {
    const g = stubGlobe();
    const app = M.createApp({ D, net, globe: g, seed: 5 });
    const shots = [];
    let tNow = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    const setShot = app.saverApp.setShot;
    app.saverApp.setShot = (s, o) => { shots.push({ s, t: tNow, sim: app.sim }); return setShot(s, o); };
    const ctl = installSaver(app.saverApp);
    app.attach({ ctl });
    ctl.auto(true, { seed: 515 });
    for (let k = 0; k < 600 * 15; k++) { app.frame(tNow); tNow += 1 / 15; }
    ctl.auto(false);
    const L = [];
    for (let i = 1; i < shots.length; i++) if (shots[i].sim === shots[i - 1].sim && shots[i - 1].s.kind !== 'aftermath') L.push(shots[i].t - shots[i - 1].t);
    ok('saver: on screen, a shot runs 8-12 s (a fade adds at most 0.9 s)', L.length > 20 && L.every(x => x >= SHOT_S[0] - 0.1 && x <= SHOT_S[1] + 1.0), `${Math.min(...L).toFixed(1)}..${Math.max(...L).toFixed(1)} s`);
  }

  // the plate: live sub lines
  {
    const g = stubGlobe();
    const app = M.createApp({ D, net, globe: g, seed: 9 });
    const plates = [];
    const had = 'window' in globalThis, old = globalThis.window;
    globalThis.window = { innerWidth: 1280, innerHeight: 800 };
    try {
      const ctl = installSaver(app.saverApp);
      app.attach({ ctl });
      globalThis.window.snSaver.enter({ calm: 0.6, seed: 31, label: p => plates.push(p) });
      let t = 50, hudMatch = true, hudN = 0, cut = false;
      for (let k = 0; k < 600 * 10; k++) {
        app.frame(t); t += 0.1;
        // snSaver.cut: a surge shot once the sim has a growth reading
        if (!cut && app.sim.day > 20 && app.view().growth) cut = globalThis.window.snSaver.cut('surge');
        if (g.lastHud) {
          hudN++;
          const s = app.sim, h = g.lastHud, inc = s.history.inc;
          if (h.today !== inc[inc.length - 1] || h.cases !== s.totals().cases || h.deaths !== s.totals().deaths || h.series !== inc) hudMatch = false;
        }
      }
      ok('saver: the screensaver turns the canvas HUD on in the clear band', g.hudOn && g.hudOpts.rect && g.hudOpts.rect.l >= 0 && g.hudOpts.rect.t + g.hudOpts.rect.h <= 800, JSON.stringify(g.hudOpts.rect));
      ok('saver: the HUD numbers each frame are the sim history and totals', hudN > 1000 && hudMatch, `${hudN} frames`);
      const subs = plates.filter(Boolean).map(p => p.sub);
      const dbl = subs.find(x => /cases doubling every \d+(\.\d)? days/.test(x));
      ok('saver: the plate sub names a city and its doubling time', !!dbl, dbl);
      ok('saver: the plate lines carry live numbers (infected, today, deaths, cities)', plates.filter(Boolean).some(p => /infected now · \+.* cases today/.test(p.lines[0]) && /deaths · \d+ cities in \d+ countries/.test(p.lines[1])), plates.filter(Boolean).slice(-1)[0].lines.slice(0, 2).join(' | '));
      ok('saver: the plate keeps TeX and no code', plates.filter(Boolean).every(p => p.tex && p.tex.length && !('code' in p)));
      ok('saver: the sub line changes with the shots', new Set(subs).size >= 8, `${new Set(subs).size} distinct`);
      globalThis.window.snSaver.exit();
      ok('saver: exit turns the canvas HUD off', g.hudOn === false);
    } finally { if (had) globalThis.window = old; else delete globalThis.window; }
  }

  // ── the HUD panel ──
  {
    const d = { day: 143.6, infected: 12.4e6, cases: 84.1e6, today: 318e3, deaths: 402e3, cities: 118, countries: 61, reff: 1.84, series: Array.from({ length: 200 }, (_, i) => Math.exp(i / 12)), curve: { peakDay: 120, peakInc: 3e6 } };
    const rows = hudRows(d);
    ok('hud: rows give day, R_eff, infected, today, cases, deaths, reach', rows.map(r => r.value).join('|') === `143|1.84|${fmtCount(12.4e6)}|+${fmtCount(318e3)}|${fmtCount(84.1e6)}|${fmtCount(402e3)}|118 cities · 61 countries`);
    ok('hud: infected now, cases today and R_eff above 1 are red', rows.filter(r => r.hot).map(r => r.k).join() === 'reff,infected,today');
    for (const phone of [false, true]) for (const focus of [null, 'curve']) {
      const g = stub2d(), s = hudSize(phone, focus);
      drawHud(g, d, { w: s.w, h: s.h, pr: 2, phone, focus });
      const lines = lineTexts(g.texts).join(' / ');
      const want = [fmtCount(12.4e6), '+' + fmtCount(318e3), fmtCount(402e3), '1.84'];
      ok(`hud: the ${phone ? 'phone' : 'desktop'}${focus ? ' curve' : ''} panel draws the live numbers`, want.every(w => lines.includes(w)) && (focus !== 'curve' || /PEAK DAY 120/.test(lines)), lines.slice(0, 120));
    }
    const sp = sparkPoints(d.series, 100, 40);
    ok('hud: the sparkline is a log curve inside its box', sp.pts.every(([x, y]) => x >= 0 && x <= 100 && y >= 0 && y <= 40) && sp.pts[sp.pts.length - 1][1] === 0);
    const band = { l: 100, r: 1180, t: 180, b: 620 };
    const r = hudRect(band, 1280, 800, false, null), rp = hudRect({ l: 0, r: 390, t: 160, b: 600 }, 390, 844, true, 'curve');
    ok('hud: the panel sits at the bottom-left of the clear band', r.l === 116 && r.t + r.h === 604 && r.t >= band.t);
    ok('hud: on a phone the panel fits the band width and stays compact', rp.l >= 0 && rp.l + rp.w <= 390 && rp.w <= HUD.phoneW && hudSize(true, null).h <= 120 && HUD.phoneHz < HUD.hz);
    ok('hud: the panel is small next to the globe (desktop at most 300 x 270 CSS px)', hudSize(false, 'curve').w <= 300 && hudSize(false, 'curve').h <= 270);
  }
  ok('stats: doubling time text', fmtDays(3.14) === '3.1 days' && fmtDays(12.4) === '12 days');
}
