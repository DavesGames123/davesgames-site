// ============================================================================
//  CORAL REEF  ·  the depth gauge over the minimap (node + jsdom)
//                 node tests/gauge.test.mjs
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "those options should be available
//  beautifully above the mapshown graphically like an ocean getting
//  deeper. ensure mobile layout looks good". Checks of depth-gauge.js:
//    scale ..... five equal bands in depth order, a log scale inside each
//                band, gaugeDepth inverts gaugeU
//    draw ...... the canvas draw gives five band rects in depth order, for
//                the vertical gauge and the horizontal strip
//    desktop ... the gauge is directly above the minimap with its left and
//                width; a band click calls goRegion with its id; the
//                current region is "on"; the ROV marker is at gaugeU of
//                its depth; it hides with the folded map and in the saver
//    phone ..... 390x844 and 844x390: a horizontal strip, 44 px targets,
//                no overlap with the dock, the feed card, the camera bar,
//                the readout or the minimap and its controls (the rects
//                that the phone CSS gives); the CSS moves the map down
//  Needs jsdom (JSDOM_DIR or NODE_PATH). Without it the file fails: a
//  skipped check is not a pass.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAUGE_BANDS, gaugeU, gaugeDepth, drawGauge, mountDepthGauge, DG_HEAD, DG_FOLDW } from '../depth-gauge.js';
import { loadJsdom } from './page-harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) { pass++; console.log(`ok   ${name}`); } else { fail++; console.log(`FAIL ${name} ${info}`); } };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// ── scale ──────────────────────────────────────────────────────────────────
{
  ok(GAUGE_BANDS.map(b => b.id).join() === 'shallows,reef,twilight,abyss,trench', 'scale: the five bands in depth order');
  ok(GAUGE_BANDS.every((b, i) => near(gaugeU(b.a), i / 5) && near(gaugeU(b.b), (i + 1) / 5)), 'scale: each band is one fifth of the gauge');
  let mono = true, inv = 0;
  for (let d = 0; d < 6000; d += 7) { if (gaugeU(d + 7) <= gaugeU(d)) mono = false; inv = Math.max(inv, Math.abs(gaugeDepth(gaugeU(d)) - d) / (1 + d)); }
  ok(mono && inv < 1e-9, 'scale: deeper is lower on the gauge; gaugeDepth inverts gaugeU', inv);
  const want = 0.2 + 0.2 * (Math.log10(41) - Math.log10(16)) / (Math.log10(101) - Math.log10(16));
  ok(near(gaugeU(40), want), 'scale: 40 m is on a log scale inside the reef band (as the minimap legend)', gaugeU(40));
}

// ── draw ───────────────────────────────────────────────────────────────────
{
  const mk = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  const V = drawGauge(mk(), { w: 280, h: 160, horiz: false, cur: 'reef' });
  const H = drawGauge(mk(), { w: 330, h: 54, horiz: true, cur: 'abyss' });
  ok(V.bands.length === 5 && V.bands.every((b, i) => near(b.y, i * 32) && near(b.w, 280)), 'draw: the vertical gauge has five bands, top to bottom', JSON.stringify(V.bands));
  ok(H.bands.length === 5 && H.bands.every((b, i) => near(b.x, i * 66) && near(b.h, 54)), 'draw: the strip has five bands, surface left, deep right', JSON.stringify(H.bands));
}

// ── the gauge in jsdom ─────────────────────────────────────────────────────
const JSDOM = loadJsdom();
if (!JSDOM) { console.log('gauge: jsdom not found (set JSDOM_DIR or NODE_PATH)'); fail++; }
else {
  const mount = ({ vw, vh, phone, saver = false, mapFold = false }) => {
    const dom = new JSDOM('<!doctype html><html><body><div id="camBar"></div><div id="minimap"></div></body></html>', { pretendToBeVisual: true });
    const win = dom.window, doc = win.document;
    win.HTMLCanvasElement.prototype.getContext = () => null;   // jsdom has no 2D canvas
    Object.defineProperty(win, 'innerWidth', { value: vw, configurable: true });
    Object.defineProperty(win, 'innerHeight', { value: vh, configurable: true });
    const mm = { left: 314, top: 382, width: 296, height: 324 }; mm.right = mm.left + mm.width; mm.bottom = mm.top + mm.height;
    doc.getElementById('minimap').getBoundingClientRect = () => mm;
    doc.getElementById('camBar').getBoundingClientRect = () => ({ left: 390, right: 890, top: 56, bottom: 100, width: 500, height: 44 });
    const calls = [], S = { saver, mapFold };
    const st = { region: 'twilight', rovs: [{ id: 1, depth: 300, colour: '#ffb38a', sel: false }, { id: 2, depth: 134, colour: '#7fe0cf', sel: true }] };
    const G = mountDepthGauge({ doc, win, phoneQ: { matches: phone }, isSaver: () => S.saver, mapFolded: () => S.mapFold, goRegion: id => { calls.push(id); return true; }, state: () => st });
    G.tick(1);
    return { G, doc, win, mm, calls, S, st };
  };

  // desktop 1280x720
  {
    const { G, doc, mm, calls, S } = mount({ vw: 1280, vh: 720, phone: false });
    const el = doc.getElementById('depthGauge'), d = G.debug(), px = (v) => parseFloat(v);
    ok(el && doc.getElementById('minimap').nextElementSibling === el && !el.hidden, 'desktop: the gauge shows next to the minimap');
    ok(px(el.style.left) === mm.left && px(el.style.width) === mm.width && near(px(el.style.top) + px(el.style.height), mm.top - 6), 'desktop: directly above the minimap, the same left and width', `${el.style.left} ${el.style.top} ${el.style.width} ${el.style.height}`);
    ok(px(el.style.top) >= 108 && !d.place.horiz && px(el.style.height) >= 96, 'desktop: vertical, and under the camera bar', el.style.top);
    const bs = [...el.querySelectorAll('.dg-band')];
    ok(bs.map(b => b.dataset.region).join() === 'shallows,reef,twilight,abyss,trench' && bs[1].textContent.includes('Reef') && bs[1].textContent.includes('15–100 m'), 'desktop: five bands with name and depth range, in depth order', bs.map(b => b.textContent).join('|'));
    ok(bs.every(b => /Send the squad/.test(b.getAttribute('aria-label')) && b.title.includes(GAUGE_BANDS.find(g => g.id === b.dataset.region).range)), 'desktop: each band says its name and range on hover (title) and to a screen reader');
    bs[3].click(); bs[0].click();
    ok(calls.join() === 'abyss,shallows', 'desktop: a click on a band calls goRegion with its id', calls.join());
    ok(bs[2].classList.contains('on') && bs[2].getAttribute('aria-pressed') === 'true' && bs.filter(b => b.classList.contains('on')).length === 1 && doc.querySelector('.dg-now').textContent === 'Twilight', 'desktop: the current region is highlighted');
    const len = px(el.style.height) - 2 - DG_HEAD, m = d.marks.find(k => k.sel), o2 = d.marks.find(k => !k.sel);
    ok(m && m.id === 2 && near(m.px, gaugeU(134) * len, 0.01) && near(o2.px, gaugeU(300) * len, 0.01), 'desktop: the ROV marker is at its depth on the gauge scale; the other ROV is a dot', JSON.stringify(d.marks));
    const mk = doc.querySelector('.dg-mark');
    ok(mk && mk.textContent.includes('ROV 2 · 134 m') && /translateY\(/.test(mk.style.transform) && mk.style.getPropertyValue('--c') === '#7fe0cf', 'desktop: the marker has the ROV colour and the depth number', mk && mk.outerHTML);
    doc.getElementById('dgFold').click();
    ok(el.classList.contains('dg-fold') && doc.getElementById('dgFold').getAttribute('aria-expanded') === 'false' && px(el.style.height) < 40, 'desktop: the own fold makes the gauge a slim head row');
    doc.getElementById('dgFold').click();
    S.mapFold = true; G.tick(1);
    ok(el.hidden, 'desktop: the gauge folds with the minimap');
    S.mapFold = false; S.saver = true; G.tick(1);
    ok(el.hidden && doc.documentElement.style.getPropertyValue('--dg-h') === '0px', 'saver: the gauge is hidden');
  }
  const css = fs.readFileSync(path.join(HERE, '../hud.css'), 'utf8');
  ok(/html\.sn-saver[^{]*#depthGauge[^{]*\{display:none!important\}/.test(css), 'saver: hud.css hides #depthGauge in the saver');

  // phones
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (const [vw, vh] of [[390, 844], [844, 390]]) {
    const land = vw > vh, tag = `phone ${vw}x${vh}`;
    const { G, doc } = mount({ vw, vh, phone: true });
    const el = doc.getElementById('depthGauge'), p = G.debug().place;
    const R = { x: p.x, y: p.y, w: p.w, h: p.h };
    ok(!el.hidden && p.horiz && el.classList.contains('dg-horiz') && p.w > p.h * 4, `${tag}: a horizontal strip`, JSON.stringify(p));
    const bw = (p.w - 2 - DG_FOLDW) / 5, bh = p.h - 2;
    ok(bw >= 44 && bh >= 44, `${tag}: band targets of 44 px or more`, `${bw.toFixed(1)} x ${bh}`);
    ok(/#depthGauge\.dg-horiz #dgFold\{width:44px;height:44px/.test(css) && /\.dg-band\{[^}]*min-width:44px;min-height:44px/.test(css.replace(/#depthGauge\.dg-horiz /g, '')), `${tag}: the fold button and the bands are 44 px in the CSS`);
    // the rects of the phone CSS (style.css, hud.css, sn-panel.css)
    const dockH = 64, fw = land ? 132 : 150, fh = Math.round(fw * 322 / 352) + 44;
    const dock = { x: 0, y: vh - dockH, w: vw, h: dockH };
    const feed = { x: vw - 8 - fw, y: vh - dockH - 8 - fh, w: fw, h: fh };
    const bar = land ? { x: 8, y: vh - dockH - 8 - 60, w: 4 * 60, h: 60 } : { x: 8, y: vh - dockH - 8 - 4 * 60, w: 66, h: 4 * 60 };
    const read = { x: vw - 8 - 180, y: (land ? 8 : 52) + p.shiftR, w: 180, h: 80 };
    const mmTop = (land ? 8 : 52) + p.shiftL, canvasW = land ? Math.min(190, vh - 220) : Math.min(190, vw * 0.48);
    const mmOpen = { x: 8, y: mmTop, w: canvasW + 10, h: canvasW + 10 }, mmFold = { x: 8, y: mmTop, w: 72 + 4 + 44 + 10, h: 52 };
    const clash = Object.entries({ dock, feed, bar, read, mmOpen, mmFold }).filter(([, b]) => hit(R, b)).map(([k]) => k);
    ok(clash.length === 0, `${tag}: no overlap with the dock, the feed card, the camera bar, the readout or the minimap`, clash.join() + ' ' + JSON.stringify(R));
    ok(mmOpen.y + mmOpen.h <= bar.y, `${tag}: the open minimap under the strip keeps clear of the camera bar`, `${mmOpen.y + mmOpen.h} > ${bar.y}`);
    ok(doc.documentElement.style.getPropertyValue('--dg-h') === `${p.shiftL}px` && p.shiftL >= p.h + 4, `${tag}: the page moves the left column down by the strip (--dg-h)`);
    const len = p.w - 2 - DG_FOLDW, m = G.debug().marks.find(k => k.sel);
    ok(m && near(m.px, gaugeU(134) * len, 0.01) && /translateX\(/.test(doc.querySelector('.dg-mark').style.transform), `${tag}: the marker is at its depth along the strip`);
  }
  ok(/#minimap\{[^}]*top:calc\(52px \+ var\(--dg-h,0px\)/.test(css) && /#read,html:not\(\.in-frame\) #read\{top:calc\(52px \+ var\(--dg-hr,0px\)/.test(css), 'phone: the CSS puts the minimap and the readout under the strip');
}
console.log(`\ngauge: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
