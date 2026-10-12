// ============================================================================
//  GRAVITY LAB  ·  test-page.mjs — the whole page on Deno's WebGPU, no browser
// ----------------------------------------------------------------------------
//  deno run -A stella-nova/pages/gravity-lab/test-page.mjs   (tests.mjs runs it)
//
//  A small fake DOM (enough for app/ui.js) and a fake canvas context whose
//  texture is an offscreen rgba8unorm target. main.js boots on the real
//  GPU device; the test drives requestAnimationFrame by hand and checks:
//  P1  boot: the renderer and the first run, no WebGPU validation errors
//  P2  frames move the sim; the image is not empty (pixel statistics of
//      the canvas texture, read back as numbers; no image is saved)
//  P3  every generated scene and a set of library runs start and run 40
//      frames with finite bodies
//  P4  the tray: every item thrown into a run (a body or a swarm); the
//      body count grows, the run stays finite
//  P5  the screensaver: enter, real time for SAVER_S s; cuts happen, the
//      plate gets a title, TeX and numbers and no code; exit
//  P6  the saver director on a virtual clock (150 s): follow and close
//      shots keep the subject on screen, a push ends on its subject
//  P7  the same run: no cut under 5 s except for a merge or a breakup,
//      no stale event shot, one close shot per event and pair
//  Each check prints PASS or FAIL. Exit code 1 on a FAIL.
// ============================================================================
if (typeof Deno === 'undefined' || !navigator.gpu) { console.log('SKIP  page tests: needs Deno with navigator.gpu'); }
else await run();

async function run() {
  const VERBOSE = Deno.args.includes('-v');
  let fails = 0;
  const ok = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}  ${info}`); if (!cond) fails++; };
  const W = 960, H = 540;
  // ── fake DOM ──────────────────────────────────────────────────────────
  const els = new Map();
  let ctx = null;
  function el(id) {
    const kids = [], cls = new Set(), ls = {};
    const o = {
      id, dataset: {}, style: { setProperty() {} }, children: kids, hidden: false, checked: false, disabled: false,
      textContent: '', innerHTML: '', clientWidth: W, clientHeight: H, width: W, height: H, tagName: 'DIV',
      classList: { add: c => cls.add(c), remove: c => cls.delete(c), toggle: (c, f) => { const on = f === undefined ? !cls.has(c) : f; on ? cls.add(c) : cls.delete(c); return on; }, contains: c => cls.has(c) },
      addEventListener(t, f) { (ls[t] = ls[t] || []).push(f); }, fire(t, e) { for (const f of ls[t] || []) f(e); },
      setAttribute() {}, appendChild(c) { kids.push(c); c.parent = o; return c; }, replaceChildren() { kids.length = 0; },
      querySelector() { return el('q'); }, querySelectorAll() { return []; }, setPointerCapture() {},
      remove() { const p = o.parent; if (p) { const i = p.children.indexOf(o); if (i >= 0) p.children.splice(i, 1); o.parent = null; } },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }),
      getContext: t => t === 'webgpu' ? ctx : { fillRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {} },
      get firstChild() { return kids[0] || null; },
    };
    if (id === 'nogpu' || /^(gallery|display|details|explain|moreMenu)$/.test(id)) cls.add('off');
    return o;
  }
  const $ = id => { if (!els.has(id)) els.set(id, el(id)); return els.get(id); };
  let canvasTex = null, dev = null;
  ctx = {
    configure(c) { dev = c.device; },
    getCurrentTexture() {
      const cv = $('gpu');
      if (!canvasTex || canvasTex.width !== cv.width || canvasTex.height !== cv.height) {
        if (canvasTex) canvasTex.destroy();
        canvasTex = dev.createTexture({ size: [cv.width, cv.height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      }
      return canvasTex;
    },
  };
  const rafQ = [];
  Object.assign(globalThis, {
    window: globalThis, matchMedia: () => ({ matches: false, addEventListener() {} }),
    document: { getElementById: $, createElement: t => el(t), querySelector: () => el('q'), querySelectorAll: () => [], documentElement: el('html'), body: el('body'), head: el('head'), createRange: () => ({}), addEventListener() {} },
    history: { replaceState() {} }, requestAnimationFrame: f => { rafQ.push(f); return rafQ.length; },
    snWishlist: { url: (c, m) => `https://store.example/?utm_content=${c}&utm_medium=${m}` },
  });
  Object.defineProperty(globalThis, 'location', { value: { search: '?exp=galaxies&v=mice', pathname: '/gravity-lab/', hash: '', href: 'http://localhost/gravity-lab/' }, configurable: true });
  const origPref = navigator.gpu.getPreferredCanvasFormat.bind(navigator.gpu);
  try { navigator.gpu.getPreferredCanvasFormat = () => 'rgba8unorm'; } catch (e) { void origPref; }
  addEventListener('error', e => { console.log('FAIL  uncaught: ' + (e.error && e.error.stack || e.message)); fails++; e.preventDefault(); });

  // ── boot ──────────────────────────────────────────────────────────────
  const t0 = Date.now();
  await import('./main.js');
  for (let k = 0; k < 400 && !(globalThis.__glab && globalThis.__glab.S.lab); k++) await new Promise(r => setTimeout(r, 25));
  const G = globalThis.__glab;
  const errs = [];
  if (G && G.S.dev) G.S.dev.addEventListener('uncapturederror', e => errs.push(String(e.error && e.error.message || e)));
  const msgs = G ? (await G.msgs()).filter(m => /error/i.test(m)) : ['no __glab'];
  ok('P1 boot: renderer, first run, shader modules compile', !!(G && G.S.lab && G.S.ren) && msgs.length === 0,
    `${G && G.S.spec ? G.S.spec.title : 'no run'}; ${msgs.length} shader errors ${msgs.slice(0, 2).join(' | ')}; ${Date.now() - t0} ms`);
  if (!G || !G.S.lab) { console.log('page tests stop: no run'); Deno.exit(1); }
  const S = G.S;
  let tNow = 1000;
  const frames = async (n, dtMs = 1000 / 60) => {
    for (let k = 0; k < n; k++) {
      tNow += dtMs;
      const q = rafQ.splice(0);
      for (const f of q) f(tNow);
      if (k % 10 === 9) await dev.queue.onSubmittedWorkDone();
    }
    await dev.queue.onSubmittedWorkDone();
  };
  const pixels = async () => {
    const tex = canvasTex, w = tex.width, h = tex.height, bpr = Math.ceil(w * 4 / 256) * 256;
    const buf = dev.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = dev.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr }, [w, h]);
    dev.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const a = new Uint8Array(buf.getMappedRange());
    let lit = 0, bright = 0, sum = 0, n = 0;
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
      const o = y * bpr + 4 * x, l = (a[o] + a[o + 1] + a[o + 2]) / 3;
      sum += l; n++; if (l > 24) lit++; if (l > 200) bright++;
    }
    buf.unmap(); buf.destroy();
    return { lit: lit / n, bright: bright / n, mean: sum / n };
  };
  const finite = () => { const s = S.lab.sys; for (let i = 0; i < 3 * s.n; i++) if (!isFinite(s.x[i]) || !isFinite(s.v[i])) return false; return true; };

  // ── P2 frames and pixels ──────────────────────────────────────────────
  const tA = S.lab.t;
  await frames(90);
  const px = await pixels();
  ok('P2 frames move the sim and draw a picture', S.lab.t > tA && px.lit > 0.01 && px.mean > 1 && errs.length === 0,
    `sim t ${tA.toFixed(3)} -> ${S.lab.t.toFixed(3)}; lit ${(100 * px.lit).toFixed(1)}%, bright ${(100 * px.bright).toFixed(2)}%, mean ${px.mean.toFixed(1)}/255; ${errs.length} WebGPU errors ${errs.slice(0, 2).join(' | ')}`);

  // ── P3 scenes and library runs ────────────────────────────────────────
  const UIm = await import('./app/ui.js');
  const R = await import('./roll.js'), X = await import('./experiments/index.js');
  const bad = [], seen = [];
  const choices = Object.keys(R.SANDBOX).map((k, i) => ({ type: 'roll', seed: 100 + i, family: 'sandbox', sandbox: k }));
  for (let s = 1; s <= 6; s++) choices.push({ type: 'roll', seed: 7000 + s, family: 'intruder' });
  for (const k of Object.keys(X.EXPERIMENTS)) choices.push({ type: 'library', key: k, variant: X.EXPERIMENTS[k].variants[0], seed: 1 });
  const slow = [];
  const only = Deno.args.includes('--only') ? Deno.args[Deno.args.indexOf('--only') + 1] : null;
  for (const c of choices) {
    if (only && (c.sandbox || c.key) !== only) continue;
    if (VERBOSE) console.log('    start', c.sandbox || c.key || c.seed);
    const tc = Date.now();
    try {
      UIm.applyChoice(c, { url: false });
      await frames(40);
      const p = await pixels();
      if (!finite()) bad.push(`${S.spec.title}: not finite`);
      if (p.lit < 0.002) bad.push(`${S.spec.title}: empty picture (${(100 * p.lit).toFixed(2)}% lit)`);
      seen.push(S.spec.title);
    } catch (e) { bad.push(`${c.sandbox || c.key || c.seed}: ${e.message}`); }
    const ms = Date.now() - tc;
    if (VERBOSE) console.log(`      ${c.sandbox || c.key || 'roll ' + c.seed}: ${ms} ms, CPU ${S.cpuMs.toFixed(1)} ms/frame, slow ${S.slow.toFixed(2)}`);
    if (ms > 8000) slow.push(`${c.sandbox || c.key || c.seed} ${ms} ms`);
  }
  if (slow.length) bad.push('slow: ' + slow.join(', '));
  ok('P3 generated scenes, intruder rolls and library runs start, run and draw', bad.length === 0 && errs.length === 0,
    `${seen.length}/${choices.length} runs; ${bad.slice(0, 4).join(' | ') || 'no problems'}; ${errs.length} WebGPU errors`);

  // ── P4 the tray ───────────────────────────────────────────────────────
  const RUN = await import('./app/run.js'), IT = await import('./items.js'), F = await import('./frame.js');
  UIm.applyChoice({ type: 'library', key: 'kepler', variant: 'laws', seed: 1 }, { url: false });
  await frames(10);
  const n0 = S.lab.sys.n, thrown = [];
  for (const it of IT.ITEMS) {
    const ext = S.spec.view.extent, dom = IT.dominant(S.lab.sys);
    const p = [dom.x[0] + 0.5 * ext, dom.x[1] + 0.2 * ext, 0];
    const v = IT.throwVelocity(p, [0, -0.1 * ext, 0], dom, ext);
    const tc = Date.now();
    thrown.push(RUN.throwItem(it.key, p, v));
    await frames(8);
    if (VERBOSE) console.log(`      threw ${it.key}: ${Date.now() - tc} ms, bodies ${S.lab.sys.n}, slow ${S.slow.toFixed(2)}`);
  }
  const bodies = IT.ITEMS.filter(x => !x.parts).length;
  await frames(120);
  ok('P4 every tray item thrown in: bodies added, swarms spawned, run stays finite', S.lab.sys.n === n0 + bodies && thrown.every(Boolean) && finite() && errs.length === 0,
    `bodies ${n0} -> ${S.lab.sys.n} (+${bodies}); ${thrown.join(' · ')}; ${errs.length} WebGPU errors`);

  // ── P5 the screensaver ────────────────────────────────────────────────
  const SAVER_S = 26;
  const labels = [], cuts = new Set(), titles = new Set();
  const res = await globalThis.snSaver.enter({ seed: 4242, calm: 0.5, label: info => labels.push(info) });
  const tEnd = Date.now() + SAVER_S * 1000;
  let lastShot = null, nCuts = 0;
  while (Date.now() < tEnd) {
    await frames(6, 1000 / 30);
    await new Promise(r => setTimeout(r, 15));
    const d = globalThis.snSaver.debug();
    if (d) { const key = d.title + '/' + d.si + '/' + d.shot; if (key !== lastShot) { nCuts++; lastShot = key; cuts.add(d.shot); } titles.add(d.title); }
  }
  const last = labels[labels.length - 1] || {};
  const anyCode = labels.some(l => l && l.code);
  const anch = last.anchor ? last.anchor() : null;
  globalThis.snSaver.exit();
  ok('P5 saver: enter returns the canvas, shots cut, plate has title + TeX + numbers, no code', !!(res && res.canvas) && nCuts >= 3 && labels.length > 5 && last.title && last.tex && last.tex.length >= 1 && last.params && last.params.length >= 2 && !anyCode && errs.length === 0,
    `${nCuts} shots in ${SAVER_S} s (${[...cuts].join(', ')}); runs: ${[...titles].join(' | ')}; ${labels.length} plate updates; tex "${last.tex && last.tex[0]}"; params ${last.params && last.params.map(p => p.name + ' ' + p.value).join(', ')}; anchor ${anch ? `${anch.x.toFixed(0)},${anch.y.toFixed(0)}` : 'none'}; ${errs.length} WebGPU errors`);
  // ── P6 the saver director on a virtual clock ──────────────────────────
  // performance.now and the 250 ms tick follow the frame clock, so
  // SAVER_V s of saver run in a few real seconds per minute. The camera
  // must keep its subject on screen in follow and close shots, and a push
  // must end on the subject (its disc at least 2x larger than at the
  // start of the push).
  {
    const SAVER_V = 150, F = await import('./frame.js');
    const ticks = [], realSI = globalThis.setInterval, realNow = performance.now;
    globalThis.setInterval = (f, ms) => { if (ms === 250) { ticks.push(f); return 1; } return realSI(f, ms); };
    Object.defineProperty(performance, 'now', { value: () => tNow, configurable: true });
    await globalThis.snSaver.enter({ seed: 4242, calm: 0.7, label: () => {} });
    const tick = ticks[ticks.length - 1], tv0 = tNow;
    let nextTick = tNow + 250, cur = null;
    const shots = [];
    while (tNow - tv0 < SAVER_V * 1000) {
      await frames(1, 1000 / 30);
      while (tNow >= nextTick) { tick(); nextTick += 250; }
      const sv = S.saver, sys = S.lab.sys;
      if (!cur || cur.at !== sv.shotAt) {
        cur = { at: sv.shotAt, kind: sv.shot.kind, title: S.spec.title, n: 0, off: 0, px: [], ev: sv.shot.event && sv.eventCut ? sv.eventCut.e : null, age: sv.shot.event && sv.eventCut ? (tNow - sv.eventCut.at) / 1000 : 0 };
        shots.push(cur);
      }
      if (sv.fade < 0.9 || !sys || sv.subject < 0 || !sys.alive[sv.subject]) continue;
      // the camera of the cut comes one frame after the tick: skip 0.3 s
      if (tNow - cur.at < 300) continue;
      const p = F.toFrame(S.frame, sys.pos(sv.subject)), q = S.ren.project(p);
      cur.n++;
      if (!q || q.x < 0 || q.y < 0 || q.x > S.ren.W || q.y > S.ren.H) { cur.off++; continue; }
      const eye = S.camNow.eye, d = Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]);
      cur.px.push([tNow - cur.at, S.meta[sv.subject].rDraw / d]);
    }
    globalThis.snSaver.exit();
    globalThis.setInterval = realSI;
    Object.defineProperty(performance, 'now', { value: realNow, configurable: true });
    const lost = shots.filter(s => (s.kind === 'follow' || s.kind === 'close') && s.n > 10 && s.off / s.n > 0.05);
    const pushes = shots.filter(s => s.kind === 'push' && s.px.length > 30 && s.px[s.px.length - 1][0] > 4500);
    const flat = pushes.filter(s => s.px[s.px.length - 1][1] < 2 * s.px[0][1]);
    const closes = shots.filter(s => s.kind === 'close').length;
    // pacing: a shot under CUT_MIN only when a merge or a breakup cuts it;
    // no event older than EVENT_STALE; one close shot per event and pair
    const SP = await import('./saver-plan.js');
    const short = [], stale = [], twice = [], keys = new Map();
    for (let i = 0; i + 1 < shots.length; i++) {
      const a = shots[i], b = shots[i + 1], len = (b.at - a.at) / 1000;
      if (len < SP.CUT_MIN - 0.1 && !(b.kind === 'close' && b.ev && SP.eventWorth(b.ev, 1e30) >= 4)) short.push(`${a.kind} ${len.toFixed(1)} s before ${b.kind}${b.ev ? ' (' + b.ev.type + ')' : ''}`);
    }
    for (const s of shots) if (s.ev) {
      if (s.age > SP.EVENT_STALE + 0.3) stale.push(`${s.ev.type} ${s.age.toFixed(1)} s`);
      const k = s.title + '|' + SP.eventKey(s.ev);
      if (keys.has(k) && s.at - keys.get(k) < SP.EVENT_REPEAT * 1000) twice.push(`${s.ev.type} in "${s.title}"`);
      keys.set(k, s.at);
    }
    ok('P6 saver framing (virtual clock): follow and close shots keep the subject, a push ends on it', lost.length === 0 && pushes.length >= 2 && flat.length === 0 && closes >= 1 && errs.length === 0,
      `${shots.length} shots in ${SAVER_V} s, ${closes} close; subject off screen: ${lost.map(s => `${s.kind} in "${s.title}" ${(100 * s.off / s.n).toFixed(0)}%`).join(', ') || 'never over 5%'}; pushes ${pushes.length}, end/start size ${pushes.map(s => (s.px[s.px.length - 1][1] / s.px[0][1]).toFixed(1)).join(' ')}; ${errs.length} WebGPU errors`);
    ok('P7 saver pacing (same run as P6): cuts at 5 s or more unless a merge or breakup, no stale or repeated event shots', short.length === 0 && stale.length === 0 && twice.length === 0 && closes >= 1,
      `short: ${short.join(', ') || 'none'}; stale: ${stale.join(', ') || 'none'}; repeated: ${twice.join(', ') || 'none'}; event shots ${shots.filter(s => s.ev).map(s => s.ev.type + ' ' + s.age.toFixed(1) + ' s').join(', ')}`);
  }
  console.log(fails ? `${fails} page tests FAILED` : 'page tests: ALL PASS');
  Deno.exit(fails ? 1 : 0);
}
