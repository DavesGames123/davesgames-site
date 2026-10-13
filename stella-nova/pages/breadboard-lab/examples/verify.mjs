// ============================================================================
//  BREADBOARD LAB  ·  examples/verify.mjs — run an example and grade its checks
// ----------------------------------------------------------------------------
//  runExample(example, deps) loads the document the way the page does
//  (normalizeDoc, buildNetlist, createEngine with the MCU runtime), plays
//  the example's script (meta.script: param changes and button presses at
//  set times) and grades every meta.checks entry. It also watches every
//  frame for NaN or infinite node voltages and part currents.
//
//  CHECK FORMAT (meta.checks[i]):
//    { at, part:'p3', quantity:'i' | 'vis.b' | 'vis.leds.a' | 'damaged' ... }
//    { at, probe:'m1', quantity:'value' }                    multimeter
//    { at, probe:'m2', quantity:'vpp:ch1' | 'vmax:ch2' | 'vmin:ch1'
//                     | 'vavg:ch1' | 'freq:ch1' | 'duty:ch1'
//                     | 'gain:ch2/ch1' | 'phase:ch2/ch1', win }   scope
//    { at, probe:'m3', quantity:'level:d2' | 'freq:d0' | 'rises:d1', win }
//    { at, node:'b1:c15' | 'p2.A', quantity:'v' }            node voltage
//    { at, serial:'p1', match:'Press 2' }                    serial text so far
//    { at, event:'damage', owner:'p3' } / { at, noEvent:'damage' }
//  A part quantity with agg:'max'|'min'|'mean' and win reads the frames in
//  [at - win, at]. Grading: value with tol (relative) or abs; or min / max;
//  or equals; or match (a regular expression for text).
//
//  SCRIPT FORMAT (meta.script[i]): { at, part, key, value } sets a live
//  param (the engine's setParam, as main.js does for a doc edit).
//
//  GREP MAP
//    loadDeps ............ the modules the run needs (node or browser)
//    runExample .......... the run, the frame log, the grading
//    scopeQuantity ....... vpp / freq / duty / gain / phase from samples
//    grade ............... one check against its expectation
//    describe ............ one line per check for the test output
// ============================================================================

const here = (p) => new URL(p, import.meta.url).href;

export async function loadDeps() {
  const P = await import(here('../parts/index.js'));
  const geo = await import(here('../parts/geometry.js'));
  const { buildNetlist } = await import(here('../sim/netlist.js'));
  const { createEngine } = await import(here('../sim/engine.js'));
  const { normalizeDoc } = await import(here('../core/doc.js'));
  const { createMcu } = await import(here('../mcu/runtime.js'));
  return { registry: P.createRegistry(), geo, buildNetlist, createEngine, normalizeDoc, createMcu };
}

const getPath = (o, path) => {
  let v = o;
  for (const k of String(path).split('.')) { if (v == null) return undefined; v = v[k]; }
  return v;
};

function scopeQuantity(samples, q, ref) {
  // samples: [t, v] pairs in the window
  const vs = samples.map(s => s[1]);
  if (!vs.length) return NaN;
  const max = Math.max(...vs), min = Math.min(...vs);
  if (q === 'vmax') return max;
  if (q === 'vmin') return min;
  if (q === 'vpp') return max - min;
  if (q === 'vavg') return vs.reduce((a, b) => a + b, 0) / vs.length;
  const mid = (max + min) / 2;
  const rises = [];
  for (let i = 1; i < samples.length; i++) {
    const [t0, a] = samples[i - 1], [t1, b] = samples[i];
    if (a < mid && b >= mid) rises.push(t0 + (t1 - t0) * (mid - a) / (b - a));
  }
  if (q === 'freq') return rises.length >= 2 ? (rises.length - 1) / (rises[rises.length - 1] - rises[0]) : 0;
  if (q === 'duty') {
    if (rises.length < 2) return NaN;
    const ta = rises[0], tb = rises[rises.length - 1];
    let hi = 0;
    for (let i = 1; i < samples.length; i++) {
      const [t0, a] = samples[i - 1], [t1] = samples[i];
      if (t0 >= ta && t1 <= tb && a >= mid) hi += t1 - t0;
    }
    return hi / (tb - ta);
  }
  if (q === 'rises') return rises;
  return NaN;
}

function grade(c, got) {
  if (c.match !== undefined) return typeof got === 'string' && new RegExp(c.match).test(got);
  if (c.equals !== undefined) return got === c.equals;
  if (typeof got !== 'number' || !Number.isFinite(got)) return false;
  if (c.value !== undefined) {
    if (c.abs !== undefined) return Math.abs(got - c.value) <= c.abs;
    return Math.abs(got - c.value) <= (c.tol ?? 0.05) * Math.abs(c.value);
  }
  if (c.min !== undefined && got < c.min) return false;
  if (c.max !== undefined && got > c.max) return false;
  return c.min !== undefined || c.max !== undefined;
}

export function describe(c) {
  const what = c.part ? `${c.part} ${c.quantity}${c.agg ? ` (${c.agg} over ${c.win} s)` : ''}`
    : c.probe ? `${c.probe} ${c.quantity}` : c.node ? `v(${c.node})`
      : c.serial ? `serial of ${c.serial}` : c.event ? `event ${c.event}${c.owner ? ' of ' + c.owner : ''}` : c.noEvent ? `no ${c.noEvent} event` : '?';
  const want = c.match !== undefined ? `matches /${c.match}/` : c.equals !== undefined ? `= ${JSON.stringify(c.equals)}`
    : c.value !== undefined ? (c.abs !== undefined ? `${c.value} ± ${c.abs}` : `${c.value} ± ${((c.tol ?? 0.05) * 100).toFixed(0)} %`)
      : `${c.min !== undefined ? '≥ ' + c.min : ''}${c.min !== undefined && c.max !== undefined ? ' and ' : ''}${c.max !== undefined ? '≤ ' + c.max : ''}`;
  return `t=${c.at}s ${what} ${want}`;
}

// example: { meta, doc }. Returns { ok, results, nanAt, warnings, issues, steps, t }.
export function runExample(example, deps, opts = {}) {
  const { registry, geo, buildNetlist, createEngine, normalizeDoc, createMcu } = deps;
  const meta = example.meta;
  const { doc, warnings } = normalizeDoc(JSON.parse(JSON.stringify(example.doc)), { registry });
  const nl = buildNetlist(doc, registry, geo);
  const eng = createEngine(nl, { mcuFactory: spec => createMcu(spec), pwm: (doc.sim && doc.sim.pwm) || 'auto' });
  const checks = (meta.checks || []).map(c => ({ ...c }));
  const script = (meta.script || []).slice().sort((a, b) => a.at - b.at);
  const tEnd = Math.max(0.1, ...checks.map(c => c.at), ...script.map(s => s.at)) + 1e-9;
  const fdt = opts.frameDt || 1 / 30;
  const times = new Set();
  for (let t = fdt; t < tEnd; t += fdt) times.add(+t.toFixed(9));
  for (const c of checks) times.add(c.at);
  for (const s of script) times.add(s.at);
  const order = [...times].filter(t => t <= tEnd).sort((a, b) => a - b);

  const frames = [];               // { t, parts }
  const scope = {};                // probe id -> ch -> [[t, v]]
  const logic = {};                // probe id -> [[t, ch, level]]
  const events = [];
  let serial = {};
  let nanAt = null;
  const results = [];
  let si = 0;

  const scopeWin = (id, ch, t0, t1) => ((scope[id] || {})[ch] || []).filter(s => s[0] >= t0 - 1e-12 && s[0] <= t1 + 1e-12);

  function evaluate(c, f) {
    const win = c.win ?? 0.5;
    if (c.part) {
      if (c.agg) {
        const vals = frames.filter(fr => fr.t >= c.at - win - 1e-9 && fr.t <= c.at + 1e-9).map(fr => getPath(fr.parts[c.part], c.quantity)).filter(v => typeof v === 'number');
        if (!vals.length) return NaN;
        if (c.agg === 'max') return Math.max(...vals);
        if (c.agg === 'min') return Math.min(...vals);
        return vals.reduce((a, b) => a + b, 0) / vals.length;
      }
      const pf = f.parts[c.part];
      const v = getPath(pf, c.quantity);
      return c.quantity === 'damaged' ? (v || 'none') : v;
    }
    if (c.probe) {
      const fp = f.probes[c.probe];
      const [q, arg] = String(c.quantity).split(':');
      if (q === 'value') return fp ? fp.value : NaN;
      if (q === 'level') { const ch = +arg.slice(1); return fp ? (fp.levels >> ch) & 1 : NaN; }
      if (q === 'gain' || q === 'phase') {
        const [a, b] = arg.split('/');
        const sa = scopeWin(c.probe, a, c.at - win, c.at), sb = scopeWin(c.probe, b, c.at - win, c.at);
        if (q === 'gain') return scopeQuantity(sa, 'vpp') / scopeQuantity(sb, 'vpp');
        const ra = scopeQuantity(sa, 'rises'), rb = scopeQuantity(sb, 'rises');
        const fq = scopeQuantity(sb, 'freq');
        if (!ra.length || !rb.length || !fq) return NaN;
        const lags = [];
        for (const tb of rb) { const ta = ra.find(t => t >= tb); if (ta !== undefined) lags.push(ta - tb); }
        const lag = lags.reduce((x, y) => x + y, 0) / lags.length;
        return -360 * ((lag * fq) % 1);
      }
      if (arg && arg[0] === 'd') {
        const ch = +arg.slice(1);
        const ed = (logic[c.probe] || []).filter(e => e[1] === ch && e[0] >= c.at - win && e[0] <= c.at);
        const rises = ed.filter(e => e[2] === 1).map(e => e[0]);
        if (q === 'rises') return rises.length;
        if (q === 'freq') return rises.length >= 2 ? (rises.length - 1) / (rises[rises.length - 1] - rises[0]) : 0;
        return NaN;
      }
      return scopeQuantity(scopeWin(c.probe, arg, c.at - win, c.at), q);
    }
    if (c.node) {
      const n = c.node.includes(':') ? nl.holeNode[c.node] : nl.pinNode[c.node];
      return n == null ? NaN : eng.v(n);
    }
    if (c.serial) return serial[c.serial] || '';
    if (c.event) return events.filter(e => e.kind === c.event && (!c.owner || e.owner === c.owner)).length;
    if (c.noEvent) return events.filter(e => e.kind === c.noEvent).length;
    return NaN;
  }

  for (const t of order) {
    eng.advanceTo(t);
    while (si < script.length && script[si].at <= t + 1e-12) {
      const s = script[si++];
      eng.setParam(s.part, s.key, s.value);
    }
    const f = eng.frame();
    for (let i = 1; i < f.nodeV.length; i++) if (!Number.isFinite(f.nodeV[i]) && nanAt === null) nanAt = t;
    for (const [id, pf] of Object.entries(f.parts)) if (!Number.isFinite(pf.i) && nanAt === null) nanAt = `${t} (${id}.i)`;
    frames.push({ t, parts: f.parts });
    for (const [id, fp] of Object.entries(f.probes)) {
      if (fp.kind === 'scope') {
        const S = scope[id] || (scope[id] = {});
        fp.ch.forEach((arr, k) => {
          if (!arr.length) return;
          const L = S['ch' + (k + 1)] || (S['ch' + (k + 1)] = []);
          for (let j = 0; j < arr.length; j++) L.push([fp.t0 + j * fp.dt, arr[j]]);
        });
      } else if (fp.kind === 'logic') {
        (logic[id] || (logic[id] = [])).push(...fp.edges);
      }
    }
    for (const e of eng.drainEvents()) events.push(e);
    for (const s of eng.drainSerial()) serial[s.mcu] = (serial[s.mcu] || '') + s.text;
    for (const c of checks) {
      if (c.done || c.at > t + 1e-12) continue;
      c.done = true;
      let got;
      try { got = evaluate(c, f); } catch (e) { got = 'error: ' + e.message; }
      let ok;
      if (c.event || c.noEvent) ok = c.event ? got >= 1 : got === 0;
      else ok = grade(c, got);
      results.push({ check: c, got, ok, text: describe(c) });
    }
  }
  const steps = eng.stats ? eng.stats.steps : 0;
  const ok = results.every(r => r.ok) && nanAt === null && results.length === checks.length;
  return { ok, results, nanAt, warnings, issues: nl.issues, steps, t: eng.t, events, serial, nl };
}

export function fmtGot(v) {
  if (typeof v === 'number') return Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(4) : v.toFixed(4);
  return JSON.stringify(v);
}
