// ============================================================================
//  SIM KIT TESTS  ·  node stella-nova/widgets/sim-kit/tests.mjs
// ----------------------------------------------------------------------------
//  core.js: rng determinism, schema normalise, draws inside ranges, locks,
//  guard clamp and veto, hash round trip and junk, shot bag (no repeats,
//  every kind each pass), shot lengths, themes and palettes.
//  ui.js under the DOM stub (test/stubs.mjs): mount builds every control,
//  a change sets state and writes the hash, dice and lock, keys, theme
//  tokens on <html>, autoplay, phone defaults.
//  saver.js under the stub: enter, cuts, no back-to-back repeats, exit
//  restores the state.
// ============================================================================
import * as K from './core.js';
import { installDom } from './test/stubs.mjs';

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };

const SCHEMA = {
  groups: [
    { id: 'a', label: 'A', controls: [
      { key: 'n', type: 'range', min: 10, max: 100, step: 5, value: 50, random: { min: 20, max: 80 } },
      { key: 'lg', type: 'range', min: 0.01, max: 10, step: 0.01, value: 1, random: { dist: 'log' } },
      { key: 'on', type: 'toggle', value: true, random: { p: 0.3 } },
      { key: 'kind', type: 'choice', value: 'x', options: ['x', 'y', 'z'], random: { weights: { x: 0, y: 1, z: 3 } } },
      { key: 'fixed', type: 'range', min: 0, max: 1, step: 0.1, value: 0.5, random: false },
    ] },
    { id: 'b', label: 'B', controls: [
      { key: 'c', type: 'color', value: '#112233' },
      { key: 'map', type: 'cmap', value: 'viridis' },
      K.themeControl('night'), K.paletteControl('toybox'),
      { key: 'go', type: 'button', action: 'go', label: 'Go' },
    ] },
  ],
};

// ---- core -------------------------------------------------------------------
{
  const a = K.rng(42), b = K.rng(42), xs = [];
  let same = true; for (let i = 0; i < 100; i++) { const x = a(); xs.push(x); if (x !== b()) same = false; }
  ok(same && xs.every(x => x >= 0 && x < 1), 'rng: one seed, one stream, values in [0, 1)');
}
{
  let bad = [];
  for (let s = 1; s <= 500; s++) {
    const st = K.scene(SCHEMA, s);
    if (!(st.n >= 20 && st.n <= 80 && st.n % 5 === 0)) bad.push('n=' + st.n);
    if (!(st.lg >= 0.01 && st.lg <= 10)) bad.push('lg=' + st.lg);
    if (st.kind === 'x') bad.push('kind x has weight 0');
    if (st.fixed !== 0.5) bad.push('fixed drawn');
    if (!/^#[0-9a-f]{6}$/.test(st.c)) bad.push('c=' + st.c);
  }
  ok(!bad.length, 'scene: 500 draws stay in range, weights and random:false respected', bad.slice(0, 3).join(' '));
  const on = Array.from({ length: 2000 }, (_, s) => K.scene(SCHEMA, s + 1).on).filter(Boolean).length / 2000;
  ok(Math.abs(on - 0.3) < 0.04, 'scene: a toggle with p 0.3 is on about 30 % of draws', on.toFixed(3));
  ok(JSON.stringify(K.scene(SCHEMA, 9)) === JSON.stringify(K.scene(SCHEMA, 9)), 'scene: same seed, same scene');
}
{
  const base = K.scene(SCHEMA, 3);
  const r = K.randomize(SCHEMA, 77, base, { locks: ['a'] });
  ok(['n', 'lg', 'on', 'kind'].every(k => r.state[k] === base[k]) && r.state.c !== base.c, 'locks: a locked group keeps its values, others draw');
  const g = K.randomize(SCHEMA, 78, base, { group: 'b' });
  ok(['n', 'lg', 'on', 'kind'].every(k => g.state[k] === base[k]), 'group dice: only that group draws');
  // per-key streams: locking b does not change a's draws
  ok(K.scene(SCHEMA, 5, null, ['b']).n === K.scene(SCHEMA, 5).n, 'streams: a lock on one group does not shift the draws of another');
  const clamp = K.randomize(SCHEMA, 11, base, { guard: s => Object.assign({}, s, { n: 20 }) });
  ok(clamp.state.n === 20 && clamp.tries === 1, 'guard: a returned state clamps the draw');
  let calls = 0;
  const veto = K.randomize(SCHEMA, 11, base, { guard: () => (++calls < 3 ? false : undefined) });
  ok(veto.tries === 3 && veto.seed === 13, 'guard: a veto draws again from seed + 1', `tries ${veto.tries} seed ${veto.seed}`);
  const all = K.randomize(SCHEMA, 11, base, { guard: () => false });
  ok(all.vetoed && all.state.n === base.n, 'guard: eight vetoes keep the previous state');
}
{
  let bad = 0;
  for (let s = 1; s <= 300; s++) {
    const st = K.scene(SCHEMA, s), h = K.encodeHash(SCHEMA, st, s), d = K.decodeHash(SCHEMA, '#' + h);
    if (d.seed !== s || JSON.stringify(d.state) !== JSON.stringify(st)) bad++;
  }
  ok(bad === 0, 'hash: 300 scenes round-trip through encode and decode');
  const j = K.decodeHash(SCHEMA, '#s=abc&n=99999&kind=nope&c=zzz&on=maybe&%E0%A4%A=1&extra=7');
  ok(j.seed === null && j.state.n === 100 && j.state.kind === 'x' && j.state.c === '#112233' && j.state.on === true && j.extra.extra === '7', 'hash: junk values are clamped or dropped, unknown keys go to extra');
  ok(K.encodeHash(SCHEMA, K.defaults(SCHEMA), 1) === 's=1', 'hash: defaults write only the seed');
}
{
  const shots = [{ key: 'a' }, { key: 'b', weight: 2 }, { key: 'c' }];
  const r = K.rng(5), bag = K.shotBag(shots, r); let prev = null, rep = 0; const seen = {};
  for (let i = 0; i < 4000; i++) { const k = bag.next(); if (k === prev) rep++; prev = k; seen[k] = (seen[k] || 0) + 1; }
  ok(rep === 0 && Math.abs(seen.b / seen.a - 2) < 0.15, 'shot bag: no shot twice in a row, weights hold', JSON.stringify(seen));
  const plan = K.planShots(shots, 9, 300);
  ok(plan.every(p => p.sec >= 6 && p.sec <= 12) && plan.every((p, i) => !i || p.theme !== plan[i - 1].theme), 'plan: cuts last 6-12 s and the theme changes every cut');
}
{
  ok(K.THEMES.every(t => /^#[0-9a-f]{6}$/.test(t.bg) && /^#[0-9a-f]{6}$/.test(t.accent)) && new Set(K.THEMES.map(t => t.id)).size === K.THEMES.length, 'themes: unique ids, valid colours');
  const p1 = K.paletteColors('rnd-123'), p2 = K.paletteColors('rnd-123');
  ok(p1.length === 6 && p1.join() === p2.join() && p1.every(c => /^#[0-9a-f]{6}$/.test(c)), 'palettes: a random palette id gives the same 6 colours every time');
}

// ---- ui ---------------------------------------------------------------------
const dom = installDom({ hash: '' });
const { mount } = await import('./ui.js');
{
  let acted = 0; const changes = [];
  const kit = mount({ schema: SCHEMA, title: 'T', seed: 1234, actions: { go: () => acted++ } });
  kit.on('change', (out, st, why) => changes.push([Object.keys(out), why]));
  const root = document.getElementById('sk-root');
  const ranges = root.findAll(e => e.tagName === 'INPUT' && e.attrs.type === 'range');
  ok(root && ranges.length === 3, 'mount: builds the panel with one slider per range control', `${ranges.length} sliders`);
  ok(kit.playing === true, 'mount: autoplay is on by default');
  const nIn = ranges.find(e => e.attrs['aria-label'] === undefined || true);
  nIn.value = '73'; nIn.dispatch('change');
  ok(kit.state.n === 75 && changes.length === 1, 'control: a slider change snaps to the step and reaches onChange', `n=${kit.state.n}`);
  await new Promise(r => setTimeout(r, 300));
  ok(/n=75/.test(location.hash) && /s=1234/.test(location.hash), 'hash: a change writes the share link', location.hash);
  kit.set('theme', 'paper');
  ok(document.documentElement.style['--sk-bg'] === '#f3efe6' && document.documentElement.classList.contains('sk-light'), 'theme: a theme change writes the tokens on <html>');
  const btn = root.find(e => e.tagName === 'BUTTON' && e.textContent === 'Go'); btn.click();
  ok(acted === 1, 'button: a button control calls its action');
  kit.toggleLock('a'); const n0 = kit.state.n; kit.newScene(999);
  ok(kit.state.n === n0 && kit.seed >= 999, 'lock: a new scene keeps a locked group');
  kit.toggleLock('a');
  const s0 = kit.seed; dispatch('keydown', { key: 'n', target: document.body });
  ok(kit.seed !== s0, 'keys: N draws a new scene');
  dispatch('keydown', { key: ' ', target: document.body });
  ok(kit.playing === false, 'keys: Space pauses');
  kit.step(); ok(kit.takeStep() === true && kit.takeStep() === false, 'transport: step gives exactly one frame');
  kit.destroy();
}
{
  installDom({ hash: '#s=55&n=30&kind=y&lock=b', phone: true });
  const { mount: m2 } = await import('./ui.js?phone');
  const PH = { groups: [{ id: 'a', controls: [{ key: 'n', type: 'range', min: 10, max: 100, step: 5, value: 50, phone: 20 }, { key: 'kind', type: 'choice', value: 'x', options: ['x', 'y'] }] }, { id: 'b', controls: [{ key: 'z', type: 'toggle', value: false }] }] };
  const kit = m2({ schema: PH });
  ok(kit.fromHash && kit.seed === 55 && kit.state.n === 30 && kit.state.kind === 'y' && kit.locks.has('b'), 'hash: a shared link restores seed, values and locks');
  ok(kit.phone && kit.panelOpen === false, 'phone: the panel starts closed on a phone');
  kit.destroy();
  installDom({ phone: true });
  const kit2 = m2({ schema: PH });
  ok(kit2.state.n === 20, 'phone: a control with a phone value starts lighter on a phone');
  kit2.destroy();
}

// ---- saver ------------------------------------------------------------------
{
  installDom({});
  const { mount: m3 } = await import('./ui.js?saver');
  const { director } = await import('./saver.js');
  const kit = m3({ schema: SCHEMA, seed: 7 });
  kit.set('n', 35);
  const applied = [];
  const cv = document.createElement('canvas'); cv.width = 100; cv.height = 60;
  director({ kit, canvas: () => cv, shots: [{ key: 'one', title: 'One', tex: 'x' }, { key: 'two', title: 'Two' }, { key: 'three', title: 'Three', scene: () => ({ n: 90 }) }], apply: (st, shot) => applied.push(shot && shot.key), frame() {} });
  const labels = [];
  const res = await window.snSaver.enter({ seed: 3, label: L => labels.push(L) });
  for (let i = 0; i < 40; i++) window.snSaver.cut();
  const keys = applied.filter(Boolean);
  let rep = 0; for (let i = 1; i < keys.length; i++) if (keys[i] === keys[i - 1]) rep++;
  ok(res && res.canvas === cv && keys.length === 41 && rep === 0, 'saver: enter and 40 cuts, no shot twice in a row', `${keys.length} cuts, ${rep} repeats`);
  const d = window.snSaver.debug();
  ok(d.hist.every((h, i) => !i || h.theme !== d.hist[i - 1].theme) && labels.length >= 41 && labels.every(L => !('code' in L)), 'saver: the theme changes every cut and plates carry no code');
  window.snSaver.cut('three');
  ok(kit.state.n === 90, 'saver: a shot scene() sets its keys');
  window.snSaver.exit();
  ok(kit.state.n === 35 && kit.seed === 7, 'saver: exit restores the state and the seed');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
