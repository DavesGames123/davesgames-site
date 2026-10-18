// mobile.mjs — phone and tablet checks of the City Generator page with
// jsdom (node, no browser). The repo has no node_modules, so give a folder
// that has node_modules/jsdom:
//   JSDOM_DIR=<folder> node mobile.mjs
// With no jsdom the run names the skip and exits 1.
//
// VIEWPORTS (touch): 360x740, 390x844, 430x932, 768x1024 portrait and
// 844x390 landscape. 1280x800 with a mouse is the desktop control.
//
// For each viewport the script loads index.html in jsdom, then main.js (a
// new module instance for each viewport). matchMedia is layout.js
// mediaMatches. jsdom has no layout, so getBoundingClientRect() of #head,
// #foot, #dock, #panel and #scrub comes from a model of style.css (function
// modelRect). The CSS checks use a small cascade of style.css (function
// cascade): the @media blocks that match the viewport, specificity, order
// and !important.
//
// What it checks:
//   mode       layout.js layoutMode and body[data-mode]; a town on phones
//   dock       shown on phones only; Settings, dice, Map / 3D, Terrain, Play;
//              it fits the width; each control acts
//   targets    each control in the dock, the playback bar and the sheets is
//              44 px or more in both directions (pseudo hit areas count)
//   text       no shown text under 11 px on a touch screen
//   overflow   no shown element has a fixed width wider than the viewport
//   safe area  the dock, the head, the foot and the sheets pad with env()
//   sheet      the accordion (one section at a time), a dice and a Keep in
//              Terrain, Tensor field, Roads and Lots; the grip snaps
//   framing    the 2D map stays in the clear area with the sheet closed and
//              open; the 3D shift points into the clear area
//   gestures   pinch zooms about the mid point, a drag pans, a double tap
//              fits; the scrubber seeks
//   exports    the export sheet opens from the settings header
//
// grep: function cascade  function modelRect  function targetSize  const VIEWS

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { layoutMode, mediaMatches, occlusion, DOCK } from './layout.js';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
let pass = 0, fail = 0;
function ok(cond, name, extra = '') {
  if (cond) pass++; else fail++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`);
}

// ─── jsdom ──────────────────────────────────────────────────────────────────
let JSDOM, VirtualConsole;
for (const dir of [process.env.JSDOM_DIR, process.cwd()].filter(Boolean)) {
  const pkg = dir.endsWith('node_modules') ? dir : dir + '/node_modules';
  if (!existsSync(pkg + '/jsdom')) continue;
  ({ JSDOM, VirtualConsole } = createRequire(pkg + '/')('jsdom'));
  break;
}
if (!JSDOM) {
  console.log('SKIP mobile.mjs: no jsdom. Set JSDOM_DIR to a folder with node_modules/jsdom (npm i jsdom@24.1.3).');
  process.exit(1);
}

// ─── a small cascade of style.css ───────────────────────────────────────────
const CSS = readFileSync(here('./style.css'), 'utf8');
// rules: { sel, media: [query...], decls: [{ p, v, imp }], order }
function parseCSS(src) {
  src = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let order = 0;
  function block(s, media) {
    let i = 0;
    while (i < s.length) {
      const open = s.indexOf('{', i);
      if (open < 0) break;
      const pre = s.slice(i, open).trim();
      // find the matching close brace
      let d = 1, j = open + 1;
      while (j < s.length && d) { if (s[j] === '{') d++; else if (s[j] === '}') d--; j++; }
      const body = s.slice(open + 1, j - 1);
      if (pre.startsWith('@media')) block(body, media.concat(pre.slice(6).trim()));
      else if (!pre.startsWith('@')) {
        const decls = body.split(';').map((x) => x.trim()).filter(Boolean).map((x) => {
          const k = x.indexOf(':');
          let v = x.slice(k + 1).trim();
          const imp = /!important$/.test(v);
          if (imp) v = v.replace(/\s*!important$/, '');
          return { p: x.slice(0, k).trim(), v, imp };
        });
        for (const sel of pre.split(',').map((x) => x.trim()).filter(Boolean)) rules.push({ sel, media, decls, order: order++ });
      }
      i = j;
    }
  }
  block(src, []);
  return rules;
}
const RULES = parseCSS(CSS);
function specificity(sel) {
  const s = sel.replace(/::[\w-]+/g, '');
  const a = (s.match(/#[\w-]+/g) || []).length;
  const b = (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!not\b)[\w-]+/g) || []).length;
  const c = (s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|:[\w-]+(\([^)]*\))?/g, ' ').match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length;
  return a * 1e6 + b * 1e3 + c;
}
const SKIP_SEL = /:hover|:focus|:active|:disabled/;
// The winning value of each property for el (pseudo: '::before' and so on).
function cascade(el, env, pseudo = '') {
  const won = {};
  for (const r of RULES) {
    if (!r.media.every((q) => mediaMatches(q, env))) continue;
    let sel = r.sel;
    if (pseudo) { if (!sel.endsWith(pseudo)) continue; sel = sel.slice(0, -pseudo.length); }
    else if (sel.includes('::')) continue;
    if (SKIP_SEL.test(sel)) continue;
    let hit = false;
    try { hit = el.matches(sel); } catch { hit = false; }
    if (!hit) continue;
    const sp = specificity(r.sel);
    for (const d of r.decls) {
      const key = [d.imp ? 1 : 0, sp, r.order];
      const cur = won[d.p];
      const beats = !cur || key[0] > cur.key[0] || (key[0] === cur.key[0] && (key[1] > cur.key[1] || (key[1] === cur.key[1] && key[2] >= cur.key[2])));
      if (beats) won[d.p] = { v: d.v, key };
    }
  }
  const out = {};
  for (const k in won) out[k] = won[k].v;
  return out;
}
const px = (v) => { const m = /^(-?[\d.]+)px$/.exec(String(v || '').trim()); return m ? +m[1] : null; };
function shown(el, env) {
  for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
    if (e.hidden) return false;
    if (cascade(e, env).display === 'none') return false;
  }
  return true;
}
function flexOf(v) {
  // flex: grow shrink basis
  if (!v) return { grow: 0, basis: null };
  const t = v.split(/\s+/);
  if (t.length === 1 && /^[\d.]+$/.test(t[0])) return { grow: +t[0], basis: null };
  return { grow: +t[0] || 0, basis: px(t[2]) };
}
// pseudo hit area: an ::before or ::after with a negative inset
function hitPad(el, env) {
  let v = 0, hz = 0;
  for (const ps of ['::before', '::after']) {
    const st = cascade(el, env, ps);
    if (!st.inset) continue;
    const t = st.inset.split(/\s+/).map((x) => px(x) ?? 0);
    const top = t[0], right = t.length > 1 ? t[1] : t[0];
    v = Math.max(v, -2 * Math.min(0, top)); hz = Math.max(hz, -2 * Math.min(0, right));
  }
  return { v, hz };
}
function targetSize(el, env) {
  const st = cascade(el, env);
  const pad = hitPad(el, env);
  let h = Math.max(px(st.height) ?? 0, px(st['min-height']) ?? 0);
  const par = el.parentElement, pst = par ? cascade(par, env) : {};
  if (!h && par && /flex/.test(pst.display || '') && !pst['flex-direction'] && !/center|start|end/.test(pst['align-items'] || '')) h = px(pst.height) ?? 0;
  const fx = flexOf(st.flex);
  let w = Math.max(px(st.width) ?? 0, px(st['min-width']) ?? 0, fx.basis ?? 0);
  if (/%$/.test(st.width || '') || fx.grow > 0) w = Infinity;
  return { h: h + pad.v, w: w + pad.hz };
}

// ─── the layout model (jsdom has no layout) ─────────────────────────────────
// Numbers from style.css: the dock is DOCK.height (64) tall; the half sheet
// is min(50dvh, 560px), the full sheet ends 40 px under the top, max-width
// 640; the landscape head, foot and dock are min(440px, 52vw) wide; the
// drawer is min(46vw, 400px); the desktop drawer is 340 px at 12 px.
function modelRect(el, w, h, mode) {
  const R = (l, t, r, b) => ({ left: l, top: t, right: r, bottom: b, width: r - l, height: b - t, x: l, y: t });
  const Z = R(0, 0, 0, 0);
  const D = DOCK.height, lw = Math.min(440, 0.52 * w);
  const body = el.ownerDocument.body;
  switch (el.id) {
    case 'head':
      if (mode === 'desk') return R(0, 0, w, 170);
      if (mode === 'drawer') return R(0, 0, lw, 64);
      return body.classList.contains('sheet-up') ? Z : R(0, 0, w, 150);
    case 'foot':
      if (mode === 'desk') return R(0, h - 190, w, h);
      if (mode === 'drawer') return R(0, h - D - 80, lw, h - D);
      return R(0, h - D - 150, w, h - D);
    case 'dock':
      if (mode === 'desk') return Z;
      return mode === 'drawer' ? R(0, h - D, lw, h) : R(0, h - D, w, h);
    case 'panel': {
      if (mode === 'desk') return R(12, 12, 352, h - 12);
      if (mode === 'drawer') return R(w - Math.min(0.46 * w, 400), 0, w, h);
      const top = el.classList.contains('full') ? 40 : h - D - Math.min(0.5 * h, 560);
      const sw = Math.min(w, 640), l = (w - sw) / 2;
      return R(l, top, l + sw, h - D);
    }
    case 'scrub': {
      const f = modelRect(el.ownerDocument.getElementById('foot'), w, h, mode);
      return R(f.left + 60, f.bottom - 30, f.right - 60, f.bottom - 26);
    }
    default: return Z;
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────
const until = async (f, ms = 30000) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 15)); return f(); };
function fire(win, el, type, o = {}) {
  const e = new win.Event(type, { bubbles: true, cancelable: true });
  for (const [k, v] of Object.entries({ pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0, buttons: 1, ...o })) Object.defineProperty(e, k, { value: v });
  el.dispatchEvent(e);
}
const tap = (win, el) => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));

const VIEWS = [
  { w: 360, h: 740, coarse: true, mode: 'sheet' },
  { w: 390, h: 844, coarse: true, mode: 'sheet' },
  { w: 430, h: 932, coarse: true, mode: 'sheet' },
  { w: 768, h: 1024, coarse: true, mode: 'sheet' },
  { w: 844, h: 390, coarse: true, mode: 'drawer' },
  { w: 1280, h: 800, coarse: false, mode: 'desk' },
];
const HTML = readFileSync(here('./index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
const SECTIONS_WITH_DICE = ['terrain', 'field', 'roads', 'build'];

for (const V of VIEWS) {
  const tag = `${V.w}x${V.h}${V.coarse ? ' touch' : ' mouse'}`;
  const env = { w: V.w, h: V.h, coarse: V.coarse };
  const phone = V.mode !== 'desk';
  console.log(`\n# ${tag} (${V.mode})`);

  const dom = new JSDOM(HTML, { url: 'https://davesgames.io/stella-nova/pages/map-generator/', pretendToBeVisual: false, virtualConsole: new VirtualConsole() });
  const win = dom.window, doc = win.document;
  Object.defineProperty(win, 'innerWidth', { value: V.w, configurable: true });
  Object.defineProperty(win, 'innerHeight', { value: V.h, configurable: true });
  Object.defineProperty(win, 'devicePixelRatio', { value: 3, configurable: true });
  win.matchMedia = (q) => ({ get matches() { return mediaMatches(q, env); }, media: q, addEventListener() {}, removeEventListener() {} });
  win.HTMLElement.prototype.getBoundingClientRect = function () { return modelRect(this, V.w, V.h, V.mode); };
  for (const k of ['window', 'document', 'location', 'history', 'matchMedia']) {
    Object.defineProperty(globalThis, k, { value: k === 'window' ? win : k === 'matchMedia' ? win.matchMedia : win[k], configurable: true, writable: true });
  }
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  delete globalThis.Worker;

  let err = null;
  try { await import(pathToFileURL(here('./main.js')).href + '?vp=' + V.w + 'x' + V.h); await win.__mapGen.started; } catch (e) { err = e; }
  const g = win.__mapGen;
  ok(!err && g && g.city, `${tag}: main.js starts and makes a city`, err ? err.stack.split('\n').slice(0, 2).join(' ') : '');
  if (err || !g || !g.city) continue;
  const $ = (id) => doc.getElementById(id);
  const st = () => g.state;

  // mode and size
  ok(layoutMode(V.w, V.h, V.coarse) === V.mode && doc.body.dataset.mode === V.mode, `${tag}: layout mode ${V.mode} (body[data-mode])`, doc.body.dataset.mode);
  ok(st().opts.size === (phone ? 'town' : 'city'), `${tag}: default city size ${phone ? 'town (smaller on a phone)' : 'city'}`, st().opts.size);

  // dock
  const dock = $('dock');
  ok(shown(dock, env) === phone, `${tag}: the dock is ${phone ? 'shown' : 'hidden'}`);
  ok(shown($('controls'), env) === !phone && shown($('chips'), env) === !phone, `${tag}: the desktop controls and chips are ${phone ? 'hidden' : 'shown'}`);
  if (phone) {
    const ids = ['dockMenu', 'dockDice', 'dockView', 'dockTerrain', 'dockPlay'];
    ok(ids.every((id) => $(id) && dock.contains($(id))) && $('dockView').querySelectorAll('button').length === 2, `${tag}: the dock has Settings, dice, Map / 3D, Terrain and Play`);
    const ds = cascade(dock, env), btn = targetSize(dock.querySelector(':scope > button'), env);
    const segMin = px(cascade($('dockView'), env)['min-width']) ?? 0;
    const pad = 20, gap = px(ds.gap) ?? 0;
    const need = 4 * btn.w + segMin + 4 * gap + pad;
    const dockW = V.mode === 'drawer' ? Math.min(440, 0.52 * V.w) : V.w;
    ok(need <= dockW, `${tag}: the dock fits its width`, `${need} <= ${dockW.toFixed(0)} px`);
    ok(/safe-area-inset-bottom/.test(ds['padding'] || ''), `${tag}: the dock pads for the safe area`);
  }

  // safe area insets on the head, foot and sheets
  if (phone) {
    const hs = cascade($('head'), env), fs = cascade($('foot'), env);
    const ph = cascade(doc.querySelector('#panel header'), env);
    ok(/safe-area-inset-(left|top)/.test(hs.padding || hs['padding-left'] || '') && /safe-area-inset/.test(fs.padding || fs['padding-left'] || '') && /safe-area-inset/.test(ph.padding || ''), `${tag}: the head, the foot and the sheet header pad for the safe area`);
  }

  // open every section, then the targets, the text and the overflow
  const wasOpen = [...doc.querySelectorAll('#panelBody .lg')].filter((s) => s.classList.contains('open'));
  if (phone) { tap(win, $('dockMenu')); for (const s of doc.querySelectorAll('#panelBody .lg')) s.classList.add('open'); }
  else { $('settingsBtn').click(); }
  $('save').hidden = false;
  const scope = phone ? '#dock, #pbar, #panel, #save' : '#panel, #save';
  const targets = [...doc.querySelectorAll(scope)].flatMap((r) => [r, ...r.querySelectorAll('button, input, select, [role="slider"], [role="switch"]')])
    .filter((e) => /^(BUTTON|INPUT|SELECT)$/.test(e.tagName) || e.getAttribute('role') === 'slider' || e.getAttribute('role') === 'switch')
    .filter((e) => shown(e, env));
  if (V.coarse) {
    const small = targets.map((e) => [e, targetSize(e, env)]).filter(([, s]) => s.h < 44 || s.w < 44);
    ok(targets.length > 40 && !small.length, `${tag}: every shown control is 44 px or more (${targets.length} controls)`, small.slice(0, 6).map(([e, s]) => `${e.id || e.className || e.tagName}:${s.w}x${s.h}`).join(' '));
    const tiny = [];
    for (const e of doc.querySelectorAll('body *')) {
      if (!e.textContent.trim() || !shown(e, env)) continue;
      const f = px(cascade(e, env)['font-size']);
      if (f != null && f < 11) tiny.push(`${e.id || e.className}:${f}`);
    }
    ok(!tiny.length, `${tag}: no shown text under 11 px`, tiny.slice(0, 6).join(' '));
  }
  {
    const wide = [];
    for (const e of doc.querySelectorAll('body *')) {
      if (!shown(e, env)) continue;
      const s = cascade(e, env);
      for (const k of ['width', 'min-width']) { const v = px(s[k]); if (v != null && v > V.w) wide.push(`${e.id || e.className}.${k}=${v}`); }
    }
    ok(!wide.length, `${tag}: no shown element is wider than the viewport (no horizontal scroll)`, wide.slice(0, 6).join(' '));
  }
  $('save').hidden = true;
  for (const s of doc.querySelectorAll('#panelBody .lg')) s.classList.toggle('open', wasOpen.includes(s));
  if (phone) tap(win, $('panelClose')); else $('panelClose').click();

  // sections: dice and Keep
  {
    const okSec = SECTIONS_WITH_DICE.every((k) => {
      const h3 = doc.querySelector(`#panelBody .lg[data-k="${k}"] h3`);
      return h3 && h3.querySelector(`[data-roll="${k}"]`) && h3.querySelector(`#keep_${k}[role="switch"]`) && h3.querySelector('.acc');
    });
    ok(okSec, `${tag}: Terrain, Tensor field, Roads and Lots each have a dice and a Keep switch in the header`);
  }

  // framing with the sheet closed
  const W = g.city.view.w, H = g.city.view.h;
  const mapBox = () => { const v = st().v2; return { l: v.ox, t: v.oy, r: v.ox + W * v.s, b: v.oy + H * v.s }; };
  const R = (id) => modelRect($(id), V.w, V.h, V.mode);
  {
    const m = mapBox(), head = R('head'), foot = R('foot');
    const top = phone ? head.bottom : 0, bot = phone ? foot.top : V.h;
    ok(m.l >= -0.5 && m.r <= V.w + 0.5 && m.t >= top - 0.5 && m.b <= bot + 0.5 && m.b - m.t > 0.15 * V.h, `${tag}: the 2D map is between the head and the foot`, `y ${m.t.toFixed(0)}..${m.b.toFixed(0)} in ${top.toFixed(0)}..${bot.toFixed(0)}`);
  }

  if (phone) {
    // the sheet: open, framing, the 3D shift, the grip
    tap(win, $('dockMenu'));
    ok(!$('panel').hidden && st().sheet === 'half' && $('dockMenu').getAttribute('aria-expanded') === 'true', `${tag}: the dock menu opens the settings (half height)`);
    ok($('scrim').hidden, `${tag}: no scrim over the map while the settings are open`);
    const m = mapBox(), p = R('panel');
    if (V.mode === 'sheet') {
      ok(m.b <= p.top + 0.5 && m.t >= -0.5 && m.r <= V.w + 0.5 && m.b - m.t > 0.15 * V.h, `${tag}: the map moves above the sheet`, `map y ${m.t.toFixed(0)}..${m.b.toFixed(0)}, sheet top ${p.top.toFixed(0)}`);
      ok(st().off3.y > 0 && st().off3.x === 0, `${tag}: the 3D view shifts up into the clear area`, JSON.stringify(st().off3));
      ok(doc.body.classList.contains('sheet-up') && !shown($('head'), env), `${tag}: the head steps aside while the sheet is open`);
    } else {
      ok(m.r <= p.left + 0.5 && m.b <= V.h - DOCK.height + 0.5 && m.r - m.l > 0.25 * V.w, `${tag}: the map moves left of the drawer`, `map x ${m.l.toFixed(0)}..${m.r.toFixed(0)}, drawer ${p.left.toFixed(0)}`);
      ok(st().off3.x < 0, `${tag}: the 3D view shifts left into the clear area`, JSON.stringify(st().off3));
      const occ = occlusion(V.w, V.h, [R('head'), R('foot'), R('dock'), R('panel')]);
      ok(occ.r > 0, `${tag}: the drawer covers the right edge`);
    }
    // accordion
    const accs = [...doc.querySelectorAll('#panelBody .lg')];
    const openKeys = () => accs.filter((s) => s.classList.contains('open')).map((s) => s.dataset.a).join(',');
    ok(openKeys() === 'city', `${tag}: the accordion starts with City open`, openKeys());
    tap(win, doc.querySelector('#panelBody .lg[data-a="terrain"] .acc'));
    ok(openKeys() === 'terrain' && doc.querySelector('.lg[data-a="terrain"] .acc').getAttribute('aria-expanded') === 'true', `${tag}: a section title opens it and closes the others`, openKeys());
    tap(win, doc.querySelector('#panelBody .lg[data-a="terrain"] .acc'));
    ok(openKeys() === '', `${tag}: a second tap closes it`, openKeys());
    if (V.mode === 'sheet') {
      const grip = $('panelGrip');
      fire(win, grip, 'pointerdown', { clientY: 400 }); fire(win, grip, 'pointerup', { clientY: 402 });
      ok(st().sheet === 'full' && $('panel').classList.contains('full'), `${tag}: a tap on the grip gives the full height`);
      fire(win, grip, 'pointerdown', { clientY: 100 }); fire(win, grip, 'pointermove', { clientY: 190 }); fire(win, grip, 'pointerup', { clientY: 190 });
      ok(st().sheet === 'half' && !$('panel').classList.contains('full'), `${tag}: a drag down gives the half height`);
      fire(win, grip, 'pointerdown', { clientY: 300 }); fire(win, grip, 'pointerup', { clientY: 400 });
      ok(st().sheet === 'closed' && $('panel').hidden && !doc.body.classList.contains('sheet-up'), `${tag}: a second drag down closes the sheet`);
    } else {
      ok(!shown($('panelGrip'), env), `${tag}: the drawer has no grip`);
      tap(win, $('dockMenu'));
      ok($('panel').hidden && st().sheet === 'closed', `${tag}: the dock menu closes the drawer`);
    }
    // exports from the sheet header
    tap(win, $('dockMenu'));
    tap(win, $('panelSave'));
    ok(!$('save').hidden && $('panel').hidden && !$('scrim').hidden && $('saveBody').querySelectorAll('.ex button').length === 4, `${tag}: Export in the sheet header opens the export sheet (4 formats)`);
    tap(win, $('saveClose'));
    tap(win, $('dockMenu')); tap(win, $('panelInfo'));
    ok(!$('caption').hidden && $('panel').hidden, `${tag}: About in the sheet header opens the about sheet`);
    tap(win, $('capClose'));
  }

  // gestures on the 2D map
  {
    const c2 = $('map2d');
    const v0 = st().v2;
    fire(win, c2, 'pointerdown', { pointerId: 1, clientX: 150, clientY: 300 });
    fire(win, c2, 'pointerdown', { pointerId: 2, clientX: 250, clientY: 300 });
    fire(win, c2, 'pointermove', { pointerId: 2, clientX: 350, clientY: 300 });
    const v1 = st().v2;
    fire(win, c2, 'pointerup', { pointerId: 2, clientX: 350, clientY: 300 });
    fire(win, c2, 'pointerup', { pointerId: 1, clientX: 150, clientY: 300 });
    // the map point under the old mid point (200, 300) is now under the new mid point (250, 300)
    const ux = (200 - v0.ox) / v0.s, ux1 = (250 - v1.ox) / v1.s;
    ok(Math.abs(v1.s / v0.s - 2) < 1e-6 && Math.abs(ux - ux1) < 1e-6, `${tag}: a pinch zooms about the mid point`, `x${(v1.s / v0.s).toFixed(3)}`);
    fire(win, c2, 'pointerdown', { pointerId: 3, clientX: 200, clientY: 300 });
    fire(win, c2, 'pointermove', { pointerId: 3, clientX: 230, clientY: 320 });
    fire(win, c2, 'pointerup', { pointerId: 3, clientX: 230, clientY: 320 });
    const v2 = st().v2;
    ok(Math.abs(v2.ox - v1.ox - 30) < 1e-6 && Math.abs(v2.oy - v1.oy - 20) < 1e-6, `${tag}: a one-finger drag pans the map`);
    fire(win, c2, 'pointerdown', { pointerId: 4, clientX: 200, clientY: 300 });
    fire(win, c2, 'pointerup', { pointerId: 4, clientX: 200, clientY: 300 });
    await new Promise((r) => setTimeout(r, 60));     // two real taps are some ms apart
    fire(win, c2, 'pointerdown', { pointerId: 5, clientX: 204, clientY: 302 });
    fire(win, c2, 'pointerup', { pointerId: 5, clientX: 204, clientY: 302 });
    const v3 = st().v2;
    ok(Math.abs(v3.s - v0.s) < 1e-9 && Math.abs(v3.ox - v0.ox) < 1e-6, `${tag}: a double tap fits the map again`);
    fire(win, c2, 'pointerdown', { pointerId: 6, clientX: 200, clientY: 300 });
    fire(win, c2, 'pointermove', { pointerId: 6, clientX: 200 - 1e5, clientY: 300 });
    fire(win, c2, 'pointerup', { pointerId: 6, clientX: 200 - 1e5, clientY: 300 });
    const m = mapBox();
    ok(m.r >= 79, `${tag}: a long drag keeps part of the map in view`, `right edge ${m.r.toFixed(0)}`);
  }

  // the playback scrubber
  {
    const sc = $('scrub'), r = sc.getBoundingClientRect(), dur = g.timeline.dur;
    fire(win, sc, 'pointerdown', { clientX: r.left + r.width / 2, clientY: r.top });
    fire(win, sc, 'pointerup', { clientX: r.left + r.width / 2, clientY: r.top });
    ok(Math.abs(st().T - dur / 2) < 1e-6 && !st().playing, `${tag}: the scrubber seeks to the touch and pauses`, `T ${st().T.toFixed(2)} of ${dur.toFixed(2)}`);
  }

  if (phone) {
    // the dock acts
    tap(win, $('dockPlay'));
    ok(st().playing && $('dockPlay').getAttribute('aria-label') === 'Pause', `${tag}: the dock Play button plays`);
    tap(win, $('dockPlay'));
    ok(!st().playing, `${tag}: and pauses`);
    const sp = st().speed; tap(win, $('pSpeed'));
    ok(st().speed !== sp && $('pSpeed').textContent !== '1×', `${tag}: the speed button of the playback bar steps the speed`, $('pSpeed').textContent);
    tap(win, $('pEnd'));
    ok(st().T === g.timeline.dur, `${tag}: the skip button goes to the finished city`);
    if (V.w === 390) {
      const seed = st().opts.seed;
      tap(win, $('dockDice'));
      ok(await until(() => g.city.seed !== seed && g.city.seed === st().opts.seed), `${tag}: the dock dice makes a new city`, `seed ${seed} -> ${g.city.seed}`);
      tap(win, $('dockTerrain'));
      ok(await until(() => !g.city.terrain) && $('dockTerrain').getAttribute('aria-pressed') === 'false' && st().opts.terrain === false, `${tag}: the dock Terrain button turns the terrain off`);
    }
    if (V.w === 360) {
      tap(win, $('dockView').querySelector('[data-v="3d"]'));
      ok(await until(() => !$('fallback').hidden, 5000) && st().view === '2d', `${tag}: 3D with no WebGPU keeps the map and shows the note`);
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
