// ============================================================================
//  MUSHROOM DRAW  ·  saver.js — the window.snSaver hook (screensaver tour)
// ----------------------------------------------------------------------------
//  Original code (davesgames.io). Protocol: lib/screensaver.js. enter(opts)
//  hides the page GUI, puts a full-window canvas (#saverCanvas) in the
//  document, and returns { canvas, warmupMs }. exit() gives the page back.
//
//  SHOTS. A seeded shuffle of six shot types, shuffled again each round
//  (opts.seed differs per run; the counters reset on each load). Forms,
//  push-in targets, paper themes and styles come from their own seeded
//  bags, so a run does not repeat a look soon. Each shot lasts 5-12 s
//  (calm = longer), then a cut.
//    draw    one specimen or cluster drawn on by the pen, outlines first,
//            then the washes bloom in
//    push    one specimen, a push-in on a part: the gills, pores, teeth or
//            ridges from below, the warts or scales, the stem net or
//            snakeskin, the morel pits, the skirt and volva
//    age     one fruit body at seven ages, button to upturned, cross-faded
//    tilt    the camera sinks from above the cap to below it, so the
//            underside opens up
//    plate   a plate of 4 to 9 specimens that fills cell by cell
//    styles  one specimen drawn in pen, then inked with the brush, then
//            given a colour wash
//  The next shot is built in a module worker (worker.js) while the
//  current one plays. Every frame draws vectors through the camera; no
//  raster of thin lines is ever scaled up.
//
//  FRAMING. The subject sits in the clear band of the shell label plate
//  (lib/saver-clear.js plateBand), checked each 250 ms; the last band holds
//  while the plate text changes. With no shell, a band of 76% of the height. Each frame clips to that band, so a push-in
//  is a window in the band and never draws over the plate text.
//
//  LABEL. opts.label({ title, sub, tex, rules, params, lines, code,
//  anchor }): the binomen, the form, the projection equation where the
//  camera matters, the camera height, age and cap size, notes with the
//  seed and style, and a short extract of engine.js or geom.js, cut from
//  the served file by function name. A push shot anchors a leader on
//  the part it inspects.
//
//  PROBES. snSaver.debug() returns the shot state; snSaver.cut(type)
//  makes the next shot of that type and cuts to it when it is built.
//
//  GREP MAP
//    grep -n 'export function installSaver'  the hook
//    grep -n 'function prepare'              the specs of a shot
//    grep -n 'function render'               one frame of the active shot
//    grep -n 'function labelFor'             the plate text
//    grep -n 'function extract'              a code extract by function name
//    grep -n 'function boxOf'                the subject box in the band
// ============================================================================
import { formParams, randomParams, sanitize, FORMS, FORM_KEYS, UNIT_MM, PART_NAMES } from './engine.js';
import { mulberry } from './geom.js';
import { THEMES, THEME_KEYS, MM_PER_PX, layoutPlate, isDark, fitSpec, STYLES } from './plate.js';
import { drawPaper, drawSpec, drawPlate } from './render.js';

const TYPES = ['draw', 'push', 'age', 'tilt', 'plate', 'styles'];
const FIRST = ['draw', 'push', 'styles'];
export const CREDIT = 'After fishdraw and shan-shui-inf by Lingdong Huang';
const GILLED = ['fly', 'parasol', 'bolete', 'chanterelle', 'inkcap', 'bonnet'];
// Push-in targets: the part to frame, the forms that have it, and the
// params that show it (a camera below the cap for the underside).
const FOCI = {
  gills:  { label: 'the gills and short gills', part: 'under', forms: ['fly', 'parasol', 'inkcap'], set: { under: 0, elev: -0.36 } },
  pores:  { label: 'the pores', part: 'under', forms: ['bolete'], set: { elev: -0.38 } },
  ridges: { label: 'the forked, decurrent ridges', part: 'under', forms: ['chanterelle'], set: { elev: -0.32 } },
  teeth:  { label: 'the teeth', part: 'under', forms: ['random'], set: { under: 2, elev: -0.36, profile: 1, marks: 0 } },
  warts:  { label: 'the warts', part: 'marks', forms: ['fly'], set: { elev: 0.32 } },
  scales: { label: 'the scales', part: 'marks', forms: ['parasol', 'inkcap'], set: { elev: 0.24 } },
  net:    { label: 'the net on the stem', part: 'stem', forms: ['bolete'], set: { elev: 0.12 } },
  snake:  { label: 'the snakeskin stem', part: 'stem', forms: ['parasol'], set: { elev: 0.06 } },
  pits:   { label: 'the pits and ribs', part: 'cap', forms: ['morel'], set: { elev: 0.16 } },
  skirt:  { label: 'the skirt and the volva', part: 'ring', forms: ['fly'], set: { elev: 0.1, ring: 2 } },
};
const FOCUS_KEYS = Object.keys(FOCI);
const INKS_LIGHT = [['#1d2f6f', 'indigo'], ['#7a1f1f', 'oxblood'], ['#24452f', 'forest'], ['#5b3a1a', 'sepia']];
const INKS_DARK = [['#e8d9a8', 'bone'], ['#9fd3ff', 'ice blue'], ['#f2b8a0', 'coral'], ['#c8e6b0', 'pale green']];
const RULES = [['e', 'm1'], ['h', 'm2'], ['r', 'm3'], ['\\varphi', 'm4']];
const TEX = 'Y = y_m - h\\cos e + r\\sin\\varphi\\,\\sin e';
export const CODE = {
  draw: ['capShape', 'start', 'engine'], age: ['capShape', 'young', 'engine'], tilt: ['makeBody', 'projS', 'engine'],
  plate: ['randomName', 'start', 'engine'], styles: ['brushPoly', 'start', 'geom'],
  gills: ['underItems', 'U === 0', 'engine'], pores: ['underItems', 'U === 1', 'engine'], teeth: ['underItems', 'U === 2', 'engine'], ridges: ['underItems', 'U === 3', 'engine'], marks: ['blob', 'start', 'engine'], stem: ['stemItems', 'tex === 3', 'engine'],
  cap: ['morelNet', 'start', 'engine'], ring: ['stemItems', 'Ring and volva', 'engine'],
};

// The lines of `function name(` (or `const name =`) to its end, from the
// first line that contains `from` ('start': the first line), n at most.
export function extract(src, name, from = 'start', n = 12) {
  if (!src) return '';
  const lines = src.split('\n');
  let i = lines.findIndex(l => new RegExp('^\\s*(export )?function ' + name + '\\(').test(l));
  if (i < 0) i = lines.findIndex(l => new RegExp('^\\s*const ' + name + ' = ').test(l));
  if (i < 0) return '';
  const ind = lines[i].match(/^\s*/)[0];
  let j = i + 1;
  while (j < lines.length && !(lines[j].startsWith(ind + '}') && lines[j].trim().length <= 3)) j++;
  let body = lines.slice(i, j + 1);
  if (from !== 'start') { const k = body.findIndex(l => l.includes(from)); if (k > 0) body = body.slice(k); }
  return body.filter(l => l.trim()).slice(0, n).join('\n');
}

const ease = t => t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);

export function installSaver(ctxIn) {
  const { getSpec, getGrain, onEnter, onExit } = ctxIn;
  let V = null;
  const srcs = { engine: '', geom: '' };
  for (const k of Object.keys(srcs)) fetch(new URL('./' + k + '.js', import.meta.url)).then(r => r.text()).then(t => { srcs[k] = t; }).catch(() => { /* no extract */ });

  // ── builder ───────────────────────────────────────────────────────────────
  // A module worker builds specimens; with no worker, the main thread does.
  function makeBuilder() {
    let w = null, id = 0;
    const pend = new Map();
    const local = (params, seed) => { try { return getSpec(params, seed); } catch (e) { return null; } };
    try {
      w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      w.onmessage = e => { const p = pend.get(e.data.id); if (p) { pend.delete(e.data.id); p.res(e.data.spec || null); } };
      w.onerror = () => { w = null; for (const p of pend.values()) p.res(local(p.params, p.seed)); pend.clear(); };
    } catch (e) { w = null; }
    return {
      build: (params, seed) => (w ? new Promise(res => { const i = ++id; pend.set(i, { res, params, seed }); w.postMessage({ id: i, params, seed }); }) : Promise.resolve(local(params, seed))),
      stop: () => { if (w) w.terminate(); w = null; pend.clear(); },
    };
  }

  function shuffled(arr, rnd) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  // A bag: a seeded shuffle, drawn from until empty, then shuffled again
  // with no repeat across the seam.
  function bag(items) {
    let b = [], last = null;
    return () => {
      if (!b.length) { b = shuffled(items, V.rnd); if (b[0] === last && b.length > 1) b.push(b.shift()); }
      return (last = b.shift());
    };
  }
  const u32 = () => ((V.rnd() * 4294967295) >>> 0) || 1;

  // ── prepare ───────────────────────────────────────────────────────────────
  function styleOf(shot) {
    const th = THEMES[shot.theme], dark = isDark(th);
    if (V.rnd() < 0.25) { const l = dark ? INKS_DARK : INKS_LIGHT, k = l[Math.floor(V.rnd() * l.length)]; shot.ink = k[0]; shot.inkName = k[1]; }
    shot.jitter = V.rnd() < 0.3 ? +(0.15 + V.rnd() * 0.45).toFixed(2) : 0;
    shot.penK = +(0.7 + V.rnd() * 0.7).toFixed(2);
  }
  function prepare(type) {
    const calm = V.calm, R = V.rnd;
    const shot = { type, theme: V.themeBag(), style: V.styleBag(), dur: 5 + 4 * calm + R() * 3, specs: [], t0: 0, ready: false, failed: false };
    styleOf(shot);
    const jobs = [];
    const job = (p, s) => jobs.push(V.builder.build(sanitize(p), s));
    if (type === 'draw') {
      const form = V.formBag(), seed = u32(), p = formParams(form, seed);
      p.elev = Math.max(-0.3, Math.min(0.4, p.elev + (R() - 0.5) * 0.3));
      if (R() < 0.35 && p.count < 3 && p.profile < 8) p.count = 3 + Math.floor(R() * 3);
      shot.form = form; shot.seed = seed; job(p, seed);
    } else if (type === 'push') {
      const key = V.focusBag(), F = FOCI[key], form = F.forms[Math.floor(R() * F.forms.length)], seed = u32();
      const p = Object.assign(form === 'random' ? randomParams(seed) : formParams(form, seed), F.set, { count: 1 });
      if (F.part === 'marks' || key === 'skirt') p.age = 0.5 + R() * 0.15;
      if (key === 'skirt') p.volva = Math.max(p.volva, 0.5);
      shot.form = form; shot.seed = seed; shot.focus = key; shot.zoomMax = 2.4 + R() * 1.6; shot.off = [R(), R()];
      job(p, seed);
    } else if (type === 'age' || type === 'tilt') {
      const form = V.gillBag(), seed = u32(), base = formParams(form, seed);
      base.count = type === 'age' ? 1 : 1 + Math.floor(R() * 2);
      base.litter = Math.min(base.litter, 4);
      shot.form = form; shot.seed = seed;
      const K = 7;
      shot.steps = [];
      for (let k = 0; k < K; k++) {
        const t = k / (K - 1), p = Object.assign({}, base);
        if (type === 'age') p.age = 0.03 + 0.94 * t;
        else p.elev = 0.42 - 0.84 * t;
        shot.steps.push(type === 'age' ? p.age : p.elev);
        job(p, seed);
      }
      shot.dur = Math.max(shot.dur, 8 + 3 * calm);
    } else if (type === 'plate') {
      const bx = boxOf(1), land = bx.w >= bx.h * 1.6;
      const opts = land ? [[2, 3], [2, 4], [3, 3], [2, 2]] : [[3, 2], [4, 2], [2, 2], [3, 3]];
      const [rows, cols] = opts[Math.floor(R() * opts.length)];
      shot.rows = rows; shot.cols = cols; shot.dur += 2;
      shot.same = R() < 0.4 ? V.formBag() : null;
      for (let i = 0; i < rows * cols; i++) {
        const seed = u32(), p = shot.same ? formParams(shot.same, seed) : randomParams(seed);
        p.count = Math.min(p.count, 3);
        jobs.push(V.builder.build(sanitize(p), seed));
      }
      shot.seed = u32();
    } else if (type === 'styles') {
      const form = V.formBag(), seed = u32();
      shot.form = form; shot.seed = seed; shot.style = 'pen';
      job(formParams(form, seed), seed);
      shot.dur = Math.max(shot.dur, 9 + 2 * calm);
      shot.theme = V.rnd() < 0.5 ? 'rice' : shot.theme;
    }
    const timeout = new Promise(res => setTimeout(() => res(null), 25000));
    Promise.race([Promise.all(jobs), timeout]).then(specs => {
      if (!specs || specs.some(s => !s)) { shot.failed = true; return; }
      shot.specs = specs;
      if (type === 'push') aimPush(shot);
      shot.ready = true;
    });
    return shot;
  }
  // The push target: the bbox of the lines of the focus part.
  function aimPush(shot) {
    const f = shot.specs[0], F = FOCI[shot.focus], pi = PART_NAMES.indexOf(F.part);
    const pj = F.part === 'ring' ? PART_NAMES.indexOf('volva') : -1;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i + 1 < f.offs.length; i++) {
      if (f.part[i] !== pi && f.part[i] !== pj) continue;
      for (let k = f.offs[i]; k < f.offs[i + 1]; k++) {
        const x = f.xy[k * 2], y = f.xy[k * 2 + 1];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (!(x1 > x0)) { x0 = f.bbox.x; y0 = f.bbox.y; x1 = x0 + f.bbox.w; y1 = y0 + f.bbox.h; }
    // A window inside the part, so the close-up shows texture, not the
    // whole part again: about 40% of its larger side, set off at random.
    const pw = x1 - x0, ph = y1 - y0, diag = Math.hypot(f.bbox.w, f.bbox.h);
    const win = Math.max(diag * 0.07, Math.max(pw, ph) * 0.42);
    const ww = Math.min(pw, win * 1.25), wh = Math.min(ph, win);
    const cx = (x0 + x1) / 2 + (shot.off[0] - 0.5) * Math.max(0, pw - ww) * 0.7;
    const cy = (y0 + y1) / 2 + (shot.off[1] - 0.5) * Math.max(0, ph - wh) * 0.5;
    shot.target = { x: cx, y: cy, w: Math.max(4, ww), h: Math.max(4, wh) };
  }

  // ── label ─────────────────────────────────────────────────────────────────
  function code(key) {
    const [fn, from, file] = CODE[key];
    const text = extract(srcs[file], fn, from, 7);
    return text ? { lang: 'js', name: file + '.js · ' + fn + '()', text } : undefined;
  }
  function styleNote(shot, style) {
    const tl = THEMES[shot.theme].label;
    return (STYLES[style || shot.style].label) + ' on ' + (/paper|print/i.test(tl) ? tl.toLowerCase() : tl.toLowerCase() + ' paper') +
      (shot.inkName ? `, ${shot.inkName} ink` : '') + (shot.jitter ? `, hand wobble ${Math.round(shot.jitter * 100)}%` : '');
  }
  const formName = f => (FORMS[f] ? FORMS[f].label + ' form' : 'A random species');
  // Short text: the plate must leave a tall clear band for the subject.
  function labelFor(shot) {
    const f = shot.specs[0], P = f.params;
    const params = [
      { sym: 'e', name: 'camera height', value: P.elev.toFixed(2), cls: 'm1' },
      { sym: 'a', name: 'age', value: P.age.toFixed(2), cls: 'm2' },
      { sym: 'R', name: 'cap radius', value: (P.capR * UNIT_MM / 10).toFixed(1) + ' cm', cls: 'm3' },
    ];
    const meta = `Seed ${shot.seed} · ${styleNote(shot)}`;
    if (shot.type === 'plate') {
      return { title: 'Fungi fictae', sub: `A plate of ${shot.specs.length} ${shot.same ? FORMS[shot.same].label.toLowerCase() + ' specimens' : 'random species'}`,
        lines: [`${shot.rows} x ${shot.cols} · ${styleNote(shot)}`, CREDIT], code: code('plate') };
    }
    const base = { title: f.name, sub: formName(shot.form), params };
    if (shot.type === 'draw') return Object.assign(base, { lines: ['Drawn on by the pen, outlines first; the washes bloom in last.', meta, CREDIT], code: code('draw') });
    if (shot.type === 'push') {
      const F = FOCI[shot.focus];
      return Object.assign(base, F.part === 'under' ? { tex: TEX, rules: RULES, params: params.slice(0, 1) } : {}, {
        lines: [`A close look at ${F.label}, redrawn as vectors.`, meta, CREDIT],
        code: code(CODE[shot.focus] ? shot.focus : F.part), anchor: () => shot.anchor || null });
    }
    if (shot.type === 'age') return Object.assign(base, { params: params.slice(0, 1).concat(params.slice(2)),
      lines: ['Seven ages: button, convex, plane, upturned.', meta, CREDIT], code: code('age') });
    if (shot.type === 'tilt') return Object.assign(base, { params: params.slice(1),
      lines: ['The camera sinks below the cap; the underside opens.', meta, CREDIT], code: code('tilt') });
    return Object.assign(base, { lines: ['Pen, then ink brush, then colour wash.', `Seed ${shot.seed}`, CREDIT], code: code('styles') });
  }

  // ── boxOf ─────────────────────────────────────────────────────────────────
  function boxOf(dpr) {
    // The last band the plate reported. The plate drops out for a moment
    // while its text changes; then the last band holds. Before the first
    // report, a safe band clear of a typical plate (or 12% with no shell).
    const b = V.band, shell = !!V.bandFn && window.parent !== window;
    const t = b ? b.t : innerHeight * (shell ? 0.3 : 0.12), bb = b ? b.b : innerHeight * (shell ? 0.27 : 0.12);
    const h = Math.max(80, innerHeight - t - bb), w = Math.min(innerWidth, (b && b.w) || innerWidth) * 0.9;
    return { x: (innerWidth - w) / 2 * dpr, y: t * dpr, w: w * dpr, h: h * dpr };
  }
  function unionFit(specs, cell, fill) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const f of specs) { x0 = Math.min(x0, f.bbox.x); y0 = Math.min(y0, f.bbox.y); x1 = Math.max(x1, f.bbox.x + f.bbox.w); y1 = Math.max(y1, f.bbox.y + f.bbox.h); }
    return fitSpec({ bbox: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } }, cell, fill);
  }

  // ── render ────────────────────────────────────────────────────────────────
  function render(now) {
    if (!V) return;
    V.raf = requestAnimationFrame(render);
    if (V.bandFn && now - V.bandAt > 250) { V.bandAt = now; try { const b = V.bandFn(innerHeight); if (b) V.band = b; } catch (e) { /* keep the last band */ } }
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = Math.round(innerWidth * dpr), H = Math.round(innerHeight * dpr), c = V.canvas, x = V.ctx;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    let shot = V.shot;
    if (V.next.failed) V.next = prepare(nextType());
    const over = shot && shot.t0 && (now - shot.t0) / 1000 > shot.dur;
    if ((over || V.forced || (shot && shot.failed)) && V.next.ready) {
      V.shot = shot = V.next; shot.t0 = 0; V.forced = false;
      V.next = prepare(nextType());
    }
    if (shot && !shot.t0 && shot.ready) { shot.t0 = now; V.count++; V.label(labelFor(shot)); }
    const theme = THEMES[shot && shot.t0 ? shot.theme : (V.lastTheme || 'cream')];
    const mmDev = MM_PER_PX / dpr;
    x.setTransform(1, 0, 0, 1, 0, 0);
    drawPaper(x, { w: W * mmDev, h: H * mmDev }, theme, { s: 1 / mmDev, ox: 0, oy: 0 }, getGrain(), false, dpr);
    if (!shot || !shot.t0) return;
    V.lastTheme = shot.theme;
    const t = (now - shot.t0) / 1000, box = boxOf(dpr);
    const cell = { ax: box.x * mmDev, ay: box.y * mmDev, aw: box.w * mmDev, ah: box.h * mmDev };
    const pen = 0.3 * shot.penK * Math.max(0.8, Math.min(1.6, Math.min(innerWidth, innerHeight) / 700));
    const view = { s: 1 / mmDev, ox: 0, oy: 0 };
    const o = { theme, ink: shot.ink || null, style: shot.style, pen, jitter: shot.jitter || 0, prog: null, marker: true, dpr };
    const f = shot.specs[0];
    // Every shot stays inside the clear band: a push-in is a window there,
    // never a drawing over the plate text.
    x.save();
    x.beginPath(); x.rect(0, box.y, W, box.h); x.clip();
    renderShot(x, shot, t, box, cell, view, o, f, pen, mmDev, dpr, W, H, theme);
    x.restore();
  }
  function renderShot(x, shot, t, box, cell, view, o, f, pen, mmDev, dpr, W, H, theme) {
    if (shot.type === 'draw') {
      const T = shot.dur * 0.68;
      drawSpec(x, f, fitSpec(f, cell, 0.95), view, Object.assign(o, { prog: t < T ? f.total * t / T : null }));
    } else if (shot.type === 'push') {
      const fit = fitSpec(f, cell, 0.95), tg = shot.target;
      const tw = tg.w * fit.k, th = tg.h * fit.k;
      const zMax = Math.max(1.5, Math.min(shot.zoomMax, cell.aw * 0.7 / tw, cell.ah * 0.75 / th));
      const e = ease((t - shot.dur * 0.12) / (shot.dur * 0.75)), z = 1 + (zMax - 1) * e;
      const fm = [fit.ox + tg.x * fit.k, fit.oy + tg.y * fit.k];
      const sx0 = fm[0] / mmDev, sy0 = fm[1] / mmDev;
      const sx = sx0 + (box.x + box.w / 2 - sx0) * e, sy = sy0 + (box.y + box.h / 2 - sy0) * e;
      const s = view.s * z;
      const pv = { s, ox: sx - fm[0] * s, oy: sy - fm[1] * s };
      drawSpec(x, f, fit, pv, Object.assign(o, { pen: pen / Math.sqrt(z), marker: false }));
      shot.zoom = +z.toFixed(2);
      shot.anchor = { x: sx / dpr, y: sy / dpr, r: Math.max(20, Math.min(tw, th) * z / mmDev / dpr * 0.5), pts: [[sx / dpr, sy / dpr]], lead: true };
    } else if (shot.type === 'age' || shot.type === 'tilt') {
      const fit = unionFit(shot.specs, cell, 0.95), K = shot.specs.length, step = shot.dur / K;
      const k = Math.min(K - 1, Math.floor(t / step)), local = (t - k * step) / step;
      const a = k < K - 1 ? ease((local - 0.6) / 0.4) : 0;
      shot.step = k;
      x.globalAlpha = 1 - a;
      drawSpec(x, shot.specs[k], fit, view, Object.assign({}, o, { marker: false }));
      if (a > 0) { x.globalAlpha = a; drawSpec(x, shot.specs[k + 1], fit, view, Object.assign({}, o, { marker: false })); }
      x.globalAlpha = 1;
    } else if (shot.type === 'plate') {
      const L = layoutPlate({ w: cell.aw, h: cell.ah, rows: shot.rows, cols: shot.cols, border: false, title: false, labels: true, screen: true, names: shot.specs.map(q => q.name) });
      L.cells.forEach(cc => { cc.ax += cell.ax; cc.ay += cell.ay; cc.x += cell.ax; cc.y += cell.ay; cc.lx += cell.ax; cc.ly += cell.ay; });
      L.texts.forEach(tx => { tx.x += cell.ax; tx.y += cell.ay; });
      const n = shot.specs.length, slot = shot.dur * 0.7 / n;
      const progress = shot.specs.map((q, i) => { const lt = t - i * slot; return lt <= 0 ? 0 : lt >= slot * 1.8 ? null : q.total * lt / (slot * 1.8); });
      const Lv = Object.assign({}, L, { w: W * mmDev, h: H * mmDev, texts: L.texts.filter(tx => tx.cell == null || t > tx.cell * slot) });
      drawPlate(x, { L: Lv, theme, ink: shot.ink, style: shot.style, pen: pen * 0.8, jitter: shot.jitter, view, specs: shot.specs, progress, grain: null, marker: true, hiCell: -1, paperOut: false, dpr, noPaper: true });
    } else if (shot.type === 'styles') {
      const fit = fitSpec(f, cell, 0.95), T = shot.dur;
      const draw1 = T * 0.3, b0 = T * 0.4, b1 = T * 0.5, w0 = T * 0.68, w1 = T * 0.78;
      const cur = t < b1 ? 'pen' : t < w1 ? 'brush' : 'wash';
      if (cur !== shot.curStyle) { shot.curStyle = cur; if (cur !== 'pen') { const lb = labelFor(shot); lb.lines[1] = `Seed ${shot.seed} · ${styleNote(shot, cur)}`; V.label(lb); } }
      const a1 = ease((t - b0) / (b1 - b0)), a2 = ease((t - w0) / (w1 - w0));
      const base = Object.assign({}, o, { marker: true });
      if (a1 < 1) { x.globalAlpha = 1 - a1; drawSpec(x, f, fit, view, Object.assign({}, base, { style: 'pen', prog: t < draw1 ? f.total * t / draw1 : null })); }
      if (a1 > 0 && a2 < 1) { x.globalAlpha = a1 * (1 - a2); drawSpec(x, f, fit, view, Object.assign({}, base, { style: 'brush' })); }
      if (a2 > 0) { x.globalAlpha = a2; drawSpec(x, f, fit, view, Object.assign({}, base, { style: 'wash' })); }
      x.globalAlpha = 1;
    }
  }

  function nextType() {
    if (V.forceType) { const t = V.forceType; V.forceType = null; return t; }
    if (!V.count && !V.started) { V.started = true; return FIRST[Math.floor(V.rnd() * FIRST.length)]; }
    return V.typeBag();
  }

  window.snSaver = {
    enter(o = {}) {
      if (V) this.exit();
      const calm = Math.min(1, Math.max(0, o.calm ?? 0.7));
      const st = document.createElement('style');
      st.id = 'saverStyle';
      st.textContent = '.topbar,#panel,#dock,#gear,#caption,#busy,#desk,#sn-wishlist-chip{display:none!important}' +
        '#saverCanvas{position:fixed;inset:0;width:100%;height:100%;display:block;z-index:60;cursor:none}';
      document.head.append(st);
      const canvas = document.createElement('canvas');
      canvas.id = 'saverCanvas';
      document.body.append(canvas);
      V = { rnd: mulberry((o.seed >>> 0) || 1), calm, label: typeof o.label === 'function' ? o.label : () => {},
        canvas, ctx: canvas.getContext('2d'), style: st, count: 0, started: false, forced: false, forceType: null,
        band: null, bandFn: null, bandAt: 0, raf: 0, builder: makeBuilder(), lastTheme: null };
      V.typeBag = bag(TYPES);
      V.themeBag = bag(THEME_KEYS);
      V.styleBag = bag(['pen', 'brush', 'wash', 'wash']);
      V.formBag = bag([...FORM_KEYS, 'random', 'random']);
      V.gillBag = bag(GILLED.concat(['random']));
      V.focusBag = bag(FOCUS_KEYS);
      import('../../lib/saver-clear.js').then(m => { if (V) V.bandFn = m.plateBand; }).catch(() => { /* no shell: the default band */ });
      onEnter();
      V.shot = prepare(nextType());
      V.next = prepare(nextType());
      V.raf = requestAnimationFrame(render);
      return { canvas, warmupMs: 1500 };
    },
    exit() {
      if (!V) return;
      cancelAnimationFrame(V.raf);
      V.builder.stop();
      V.label(null);
      V.style.remove(); V.canvas.remove();
      V = null;
      onExit();
    },
    cut(type) {
      if (!V) return false;
      if (type && !TYPES.includes(type)) return false;
      V.forceType = type || null;
      V.next = prepare(nextType());
      V.forced = true;
      return true;
    },
    debug() {
      if (!V) return null;
      const s = V.shot, n = V.next;
      return s ? { type: s.type, form: s.form, focus: s.focus, name: s.specs[0] && s.specs[0].name, seed: s.seed, theme: s.theme, style: s.curStyle || s.style,
        ink: s.inkName, jitter: s.jitter, dur: +s.dur.toFixed(1), t: s.t0 ? +((performance.now() - s.t0) / 1000).toFixed(1) : null,
        zoom: s.zoom, step: s.step, cells: s.type === 'plate' ? s.specs.length : undefined, count: V.count, band: V.band,
        next: n && { type: n.type, ready: n.ready, failed: n.failed } } : null;
    },
  };
  return window.snSaver;
}
