// ============================================================================
//  ALPHA QUDITS  ·  webs/tests.mjs  ·  node tests of the WEBS package
// ----------------------------------------------------------------------------
//  Run:  node stella-nova/pages/alpha-qudits/webs/tests.mjs
//  Optional: NODE_PATH holding jsdom@24.1.3 (boots createWebs in a DOM).
//  Without it a skip line prints and the other checks still run.
//
//  SECTIONS   (grep -n "section('" tests.mjs)
//    data ....... Part rows sum to the deck's totals and subtotals; genres
//    scenes ..... every scene and step draws on a mock canvas, all finite
//    text ....... labels stay inside the view at 320 and 360 px
//    story ...... chapter shape, grades named, source line, no stray claims
//    saver ...... shots valid and fit 16:9 and 9:16 bands
//    dom ........ createWebs in jsdom (skip without jsdom)
// ============================================================================
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0, skip = 0;
const section = s => console.log('\n## ' + s);
async function check(name, fn) {
  try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n       ') : e)); }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };

const D = await import(join(HERE, 'data.js'));
const IDX = await import(join(HERE, 'index.js'));
const S = await import(join(HERE, 'story.js'));

section('data');
await check('Part rows sum to the deck totals 100 / 109 / 198', () => {
  const s = D.sum3(D.PARTS);
  assert(s.join() === [D.TOTALS.theorem, D.TOTALS.conditional, D.TOTALS.open].join(), s.join());
  assert(s.join() === '100,109,198', 'deck totals ' + s.join());
});
await check('subtotals: Parts I-V 41/28/55, VI-XI 17/68/78, XII-XV 25/10/29', () => {
  const pick = ids => D.sum3(D.PARTS.filter(p => ids.includes(p.part))).join();
  assert(pick(['I', 'III', 'IV', 'V']) === D.TOTALS.foundations.join(), 'I-V ' + pick(['I', 'III', 'IV', 'V']));
  assert(pick(['VI', 'VII', 'VIII', 'IX', 'X', 'XI']) === D.TOTALS.cells.join(), 'VI-XI');
  assert(pick(['XII', 'XIII', 'XIV', 'XV']) === D.TOTALS.applications.join(), 'XII-XV');
  assert(!D.PARTS.some(p => p.part === 'II' || p.part === 'XVI'), 'II and XVI hold tables only');
});
await check('six genres, larger end first; readable exactly (2,2) and (3,2) by d1 d2 <= 6', () => {
  assert(D.GENRES.length === 6 && D.GENRES.every(g => g.d[0] >= g.d[1] && g.d[1] >= 2 && g.d[0] <= 4), 'genres');
  assert(D.GENRES.filter(g => g.readable).map(g => g.d.join()).join(' ') === '2,2 3,2', 'readable');
  assert(D.GENRES.filter(g => g.byName).length === 4 && !D.GENRES.find(g => g.d.join() === '3,2').byName, 'by name only on four');
  assert(new Set(D.GENRES.map(g => g.part)).size === 6, 'one Part per genre');
});
await check('web tally: 17 particles on 16 webs, 1 + 11 + 2 + 3 = 17', () => {
  const T = D.WEB_TALLY; assert(T.theorem + T.conditional + T.open + T.notInRelease === T.particles, 'tally');
});
await check('every graded item uses a known grade; electron lists five genres', () => {
  for (const r of [...D.RESULTS, ...D.WZ, ...D.LEPTONS.filter(l => l.grade)]) assert(D.GRADES[r.grade] && r.box, JSON.stringify(r));
  assert(D.ELECTRON.map(e => e.genre.join()).join(' ') === '3,3 4,3 4,2 2,2 3,2', 'electron genres');
  assert(D.ELECTRON.every(e => D.GENRES.some(g => g.d.join() === e.genre.join())), 'electron genres are genres');
});

section('scenes');
function mockCtx(bad, texts) {
  const NUM = new Set(['moveTo', 'lineTo', 'arc', 'arcTo', 'bezierCurveTo', 'quadraticCurveTo', 'fillRect', 'strokeRect', 'clearRect', 'translate', 'rotate', 'scale', 'setTransform', 'fillText', 'strokeText', 'createRadialGradient', 'createLinearGradient', 'ellipse', 'rect']);
  const st = { font: '13px sans' };
  const px = () => { const m = /([\d.]+)px/.exec(st.font); return m ? +m[1] : 13; };
  const target = {
    measureText: s => ({ width: String(s).length * px() * 0.55 }),
    createRadialGradient: () => ({ addColorStop() {} }), createLinearGradient: () => ({ addColorStop() {} }),
    setLineDash() {}, save() {}, restore() {},
  };
  return new Proxy(target, {
    get(t, k) {
      if (k === 'font') return st.font;
      if (k in t && typeof t[k] === 'function' && !NUM.has(k)) return t[k];
      if (typeof k === 'string' && /^[a-z]/.test(k) && !(k in t && typeof t[k] !== 'function')) {
        return (...args) => {
          if (NUM.has(k)) for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) bad.push(k + '(' + args.join(',') + ')');
          if (k === 'fillText' && texts) texts.push({ s: String(args[0]), x: args[1], w: args[3] ?? String(args[0]).length * px() * 0.55, align: t.textAlign });
          if (k === 'createRadialGradient' || k === 'createLinearGradient') return { addColorStop() {} };
          return undefined;
        };
      }
      return t[k];
    },
    set(t, k, v) { if (k === 'font') st.font = v; else t[k] = v; return true; },
  });
}
await check('five scenes, each with steps, analogy (right and breaks), captions', () => {
  assert(IDX.SCENES.join() === 'chain,genres,electron,wz,grades', IDX.SCENES.join());
  for (const k of IDX.SCENES) {
    const M = IDX.SCENE_MODULES[k];
    assert(M.steps.length >= 3, k + ' steps');
    for (const part of ['right', 'breaks']) { const s = M.analogy[part]; assert(s && s.length > 80 && s.length < 700, k + ' ' + part); }
    for (const s of M.steps) for (const lepton of ['electron', 'muon', 'tau']) { const st = M.init({ step: s.id, lepton }); const c = M.caption(st, 1); assert(c && c.length > 40, k + '/' + s.id + ' caption'); }
  }
});
await check('every scene and step draws at 320 to 1280 px and in saver bands, all numbers finite', () => {
  let frames = 0; const bad = [];
  for (const k of IDX.SCENES) {
    const M = IDX.SCENE_MODULES[k];
    for (const W of [320, 360, 768, 1280]) {
      const H = M.height(W); assert(H >= 280 && H <= 700, `${k} height ${H} at ${W}`);
      for (const s of M.steps) for (const variant of [{}, { lepton: 'muon' }, { lepton: 'tau' }]) {
        for (const view of [{ x: 0, y: 0, w: W, h: H }, { x: 0, y: 120, w: W, h: Math.round(H * 0.45) }]) {
          const st = M.init(Object.assign({ step: s.id }, variant)); st.auto = false; st.since = 0;
          for (const t of [0, 0.4, 1.7, 3.3, 6.1, 12.9]) { M.draw(mockCtx(bad), { W, H, view, fill: false, reduced: false }, st, t); frames++; }
        }
      }
      const st = M.init({}); st.auto = true; st.since = 0;
      const seen = new Set();
      for (let t = 0; t < 60; t += 0.7) { M.draw(mockCtx(bad), { W, H, view: { x: 0, y: 0, w: W, h: H } }, st, t); frames++; seen.add(st.step); }
      assert(seen.size === M.steps.length, `${k} tour visits every step (${[...seen]})`);
    }
  }
  assert(bad.length === 0, bad.slice(0, 5).join('; '));
  console.log(`       ${frames} frames drew`);
});

section('text');
await check('labels stay inside the canvas at 320 and 360 px', () => {
  const out = [];
  for (const k of IDX.SCENES) {
    const M = IDX.SCENE_MODULES[k];
    for (const W of [320, 360]) for (const s of M.steps) for (const lepton of ['electron', 'tau']) {
      const H = M.height(W), texts = [], st = M.init({ step: s.id, lepton }); st.auto = false; st.since = 0;
      M.draw(mockCtx([], texts), { W, H, view: { x: 0, y: 0, w: W, h: H } }, st, 3);
      for (const tx of texts) {
        const x0 = tx.align === 'center' ? tx.x - tx.w / 2 : tx.align === 'right' ? tx.x - tx.w : tx.x;
        if (x0 < -1 || x0 + tx.w > W + 1) out.push(`${k}/${s.id}@${W}: "${tx.s}" ${x0.toFixed(0)}..${(x0 + tx.w).toFixed(0)}`);
      }
    }
  }
  assert(out.length === 0, out.slice(0, 6).join('\n       '));
});

section('story');
await check('CORE chapter shape; 2 to 5 top-level paragraphs; figures are pkg webs with known scenes', () => {
  const W = S.WEBS;
  assert(W.id === 'webs' && W.title && W.short && Array.isArray(W.blocks), 'shape');
  const ps = W.blocks.filter(b => b.p).length; assert(ps >= 2 && ps <= 5, 'paragraphs ' + ps);
  for (const b of W.blocks) if (b.fig) assert(W.figures[b.fig], 'figure ' + b.fig);
  for (const f of Object.values(W.figures)) { assert(f.pkg === 'webs', f.title); for (const s of f.scenes) assert(IDX.SCENES.includes(s.id), s.id); }
});
await check('the source line, the not-read line, the conjecture and the census caution are present', () => {
  const all = JSON.stringify(S.WEBS);
  assert(/numbers come from the talk deck only/i.test(all), 'deck-only line');
  assert(/not read the compendium/i.test(all) && /Lean/.test(all), 'not-read line');
  assert(/census of a finite catalogue/.test(all), 'census caution');
  assert(/<i>conjectured<\/i>/.test(all) && /release 0\.1/.test(all), 'conjectured, release 0.1');
  assert(!/\b(proves|proven|confirms)\b/i.test(all), 'no endorsing verbs');
  assert(/separate section/i.test(S.WEBS_POINTER) && S.WEBS_POINTER.length < 260, 'pointer line');
});

section('saver');
await check('saver shots valid and fit 9:16 and 16:9 bands', () => {
  assert(IDX.saverShots.length >= 5, 'shots');
  for (const s of IDX.saverShots) {
    assert(IDX.SCENES.includes(s.scene) && IDX.STEPS[s.scene].includes(s.params.step) && s.seconds >= 5 && s.seconds <= 12 && s.title && s.caption && s.tex, s.id);
    for (const [bw, bh] of [[405, 340], [1280, 430], [720, 900]]) {
      const L = IDX.fitLayout(IDX.SCENE_MODULES[s.scene], bw, bh);
      assert(L.w * L.k <= bw + 1e-6 && L.h * L.k <= bh + 1e-6 && L.k > 0.4, `${s.id} at ${bw}x${bh}: k ${L.k.toFixed(2)}`);
    }
  }
});

section('dom');
function findMod(name) {
  const dirs = [process.env.JSDOM_DIR, ...(process.env.NODE_PATH || '').split(':')].filter(Boolean);
  for (const d of dirs) for (const base of [join(d, 'x.js'), join(d, '..', 'x.js')]) { try { return createRequire(base)(name); } catch (e) { /* next */ } }
  return null;
}
const jsdom = findMod('jsdom');
if (!jsdom) { skip++; console.log('  skip dom: jsdom not found on NODE_PATH'); }
else {
  await check('createWebs boots in jsdom: canvas, 44 px buttons, notes, play(t), show, fill, dispose', async () => {
    const dom = new jsdom.JSDOM('<!doctype html><html><head></head><body><div id="h" style="width:360px"></div></body></html>', { pretendToBeVisual: true });
    const w = dom.window;
    for (const k of ['window', 'document', 'HTMLElement', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle']) globalThis[k] = k === 'window' ? w : w[k];
    w.HTMLCanvasElement.prototype.getContext = function () { return mockCtx(this.__bad || (this.__bad = [])); };
    const host = w.document.getElementById('h');
    const api = IDX.createWebs(host, { scene: 'chain', autoplay: false });
    assert(host.querySelector('canvas') && w.document.getElementById('webs-css'), 'canvas and css');
    assert(/\.webs-fig/.test(w.document.getElementById('webs-css').textContent) && !/ends-/.test(w.document.getElementById('webs-css').textContent), 'css prefix');
    assert(host.querySelectorAll('button').length >= 3 && host.querySelectorAll('.webs-note').length === 2, 'buttons and notes');
    for (const sc of IDX.SCENES) for (const step of IDX.STEPS[sc]) { api.show(sc, { step }); api.play(2.5); assert(host.querySelector('.webs-cap').textContent.length > 20, sc + ' caption'); }
    api.show('electron', { step: 'ladder' }); assert([...host.querySelectorAll('button')].some(b => b.textContent === 'tau'), 'lepton buttons on the ladder step');
    api.setBand({ t: 80, b: 120 }); api.play(1); api.dispose(); assert(!host.querySelector('canvas'), 'disposed');
    const f = w.document.createElement('div'); w.document.body.appendChild(f);
    const s2 = IDX.createWebs(f, { fill: true, scene: 'grades', params: { step: 'parts' } });
    assert(!f.querySelector('button') && !f.querySelector('.webs-notes'), 'fill mode has no controls'); s2.play(3); s2.dispose();
  });
}

console.log(`\nwebs: ${pass} passed, ${fail} failed, ${skip} skipped`);
process.exit(fail ? 1 : 0);
