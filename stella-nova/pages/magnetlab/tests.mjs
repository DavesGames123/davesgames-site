// ============================================================================
//  MAGNETLAB TESTS  ·  node stella-nova/pages/magnetlab/tests.mjs [--print]
// ----------------------------------------------------------------------------
//  The page is classic scripts. This file runs main.js in a node vm with a
//  DOM stub, then runs each script that main.js appends, in append order,
//  as the browser does. All scripts share one global scope, as on the page.
//  Math.random is seeded, WebGL is absent (the 2D tracer path runs), and
//  every 2D canvas call and Path2D call goes into one FNV hash.
//
//  boot         the 50 ms init: one bar magnet, tracer budget, status text
//  frames       120 frames: finite tracers, the loop keeps the rAF chain
//  dynamics     a dynamic dipole near the bar moves, stays finite
//  ui           toggles, sliders, magnet card props, remove, clear
//  input        mouse drag moves a magnet, wheel zoom, pan
//  field        dipoleField and fieldAt agree with the closed form
//  colors       the ramp ends and the GLSL ramp text
//  saver        all 16 scenes build, step and send a plate; a scene change
//  golden       state and draw hashes equal the values of the single-file
//               main.js of df78b0a4, so a split keeps the behaviour.
//               --print writes the new values after an intended change.
//
//  grep -n targets: "function loadPage", "const GOLD", "function fnv"
// ============================================================================
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PRINT = process.argv.includes('--print');
let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };

// FNV-1a over strings, 32 bit.
function fnv(h, s) { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }

// ── DOM stub ──
function loadPage(W = 800, H = 600) {
  const draw = { h: 2166136261, calls: 0 };
  const log = s => { draw.h = fnv(draw.h, s + ';'); draw.calls++; };
  const listeners = {};
  const on = (who) => (type, fn) => { (listeners[who + ':' + type] ||= []).push(fn); };
  const els = {};
  const scripts = [];
  function makeEl(id, tag = 'div') {
    const cls = new Set();
    const el = {
      id, tagName: tag.toUpperCase(), textContent: '', value: '', min: '0', max: '1', children: [],
      style: { setProperty(k, v) { this[k] = v; } },
      classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c),
        toggle: (c, f) => { const v = f === undefined ? !cls.has(c) : !!f; v ? cls.add(c) : cls.delete(c); return v; } },
      set className(v) { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => cls.add(c)); },
      get className() { return [...cls].join(' '); },
      _html: '', set innerHTML(v) { this._html = v; this.children = []; }, get innerHTML() { return this._html; },
      appendChild(c) { this.children.push(c); return c; },
      querySelectorAll() { return []; }, querySelector() { return null; }, closest() { return null; },
      addEventListener: on(id), getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }),
      clientWidth: W, clientHeight: H,
    };
    return el;
  }
  const ctx2d = new Proxy({}, {
    get(t, k) {
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return (...a) => { log(k + a.join(',')); return { addColorStop: (...b) => log('stop' + b.join(',')) }; };
      if (typeof k !== 'string') return undefined;
      if (k in t) return t[k];
      return (...a) => log(k + '(' + a.map(x => typeof x === 'object' ? (x && x._p2d ? 'P' + x._p2d : 'o') : String(x)).join(',') + ')');
    },
    set(t, k, v) { t[k] = v; log(k + '=' + v); return true; },
  });
  let p2dId = 0;
  class Path2D { constructor() { this._p2d = ++p2dId; } moveTo(x, y) { log('M' + x + ',' + y); } lineTo(x, y) { log('L' + x + ',' + y); } }
  function makeCanvas(id) {
    const c = makeEl(id, 'canvas'); c.width = 300; c.height = 150;
    c.getContext = k => (k === '2d' ? ctx2d : null);
    return c;
  }
  const document = {
    hidden: false, currentScript: null,
    getElementById: id => els[id] ||= (id === 'sim-canvas' ? makeCanvas(id) : makeEl(id)),
    createElement: tag => (tag === 'canvas' ? makeCanvas('') : makeEl('', tag)),
    querySelectorAll: () => ['sl-tracer-count', 'sl-tracer-speed', 'sl-tracer-trail'].map(id => document.getElementById(id)),
    addEventListener: on('document'),
    head: { appendChild: c => c }, body: { appendChild: c => { if (c.tagName === 'SCRIPT') scripts.push(c); return c; } },
    documentElement: makeEl('html'),
  };
  for (const [id, v, mn, mx] of [['sl-tracer-count', '2500', '200', '6000'], ['sl-tracer-speed', '1.5', '0.2', '5'], ['sl-tracer-trail', '40', '5', '80']]) {
    const e = document.getElementById(id); e.value = v; e.min = mn; e.max = mx;
  }
  const timers = [], rafs = [];
  let now = 1000;
  const sandbox = {
    document, Path2D, URL, console, devicePixelRatio: 1, innerWidth: 1200,
    performance: { now: () => now },
    requestAnimationFrame: cb => { rafs.push(cb); return rafs.length; },
    cancelAnimationFrame: () => {},
    setTimeout: (cb, ms) => { timers.push(cb); return timers.length; },
    addEventListener: on('window'),
    ResizeObserver: class { constructor(cb) { this.cb = cb; } observe() { listeners['ro'] = [this.cb]; } },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  // Seeded Math.random in the page realm (mulberry32).
  vm.runInContext(`(()=>{let a=12345;Math.random=()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};})()`, context);
  const run = (file) => vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  const mainFile = path.join(DIR, 'main.js');
  document.currentScript = { src: pathToFileURL(mainFile).href };
  run(mainFile);
  document.currentScript = null;
  const loaded = [];
  // Run the appended scripts in order. A script may append more.
  for (let i = 0; i < scripts.length; i++) {
    const f = fileURLToPath(new URL(scripts[i].src, pathToFileURL(mainFile)));
    loaded.push(path.relative(DIR, f)); run(f);
  }
  const E = src => vm.runInContext(src, context);
  const flushTimers = () => { while (timers.length) timers.shift()(); };
  const frames = (n, dtMs = 1000 / 60) => { for (let i = 0; i < n; i++) { now += dtMs; const q = rafs.splice(0); for (const cb of q) cb(now); } };
  const fire = (key, ev) => (listeners[key] || []).forEach(fn => fn(ev));
  return { E, sandbox, document, draw, listeners, flushTimers, frames, fire, loaded, rafs, els };
}

const P = loadPage();
ok(P.loaded.length === 0 || P.loaded.every(f => fs.existsSync(path.join(DIR, f))), 'load: main.js and its appended scripts run', P.loaded.length ? P.loaded.length + ' parts' : 'single file');

// ── boot ──
P.flushTimers();
ok(P.E('magnets.length') === 1 && P.E('magnets[0].type') === 'bar', 'boot: one bar magnet after the init timer');
ok(P.E('SIM.tracerCount') === 1100 && P.E('TR_N') === 1100, 'boot: tracer budget 1100 for an 800 x 600 canvas', String(P.E('SIM.tracerCount')));
ok(P.els['st-dims'].textContent === '800×600' && P.els['st-magnets'].textContent === '1 magnet', 'boot: status bar dims and magnet count');
ok(P.E('glOK') === false && P.E('started') === true, 'boot: no WebGL, 2D tracer path, loop started');

// ── frames ──
P.frames(120);
const finite = () => P.E('(()=>{for(let i=0;i<TR_N;i++){if(!isFinite(tPX[i])||!isFinite(tPY[i]))return false;}return magnets.every(m=>isFinite(m.x)&&isFinite(m.y)&&isFinite(m.angle));})()');
ok(finite() && P.rafs.length === 1, 'frames: 120 frames, finite state, one rAF pending');
ok(/fps$/.test(P.els['st-fps'].textContent) && /^B: /.test(P.els['st-field'].textContent), 'frames: fps and field readouts', P.els['st-field'].textContent);

// ── dynamics ──
P.E("addMagnet('dipole')");
const did = P.E('magnets[1].id');
const x0 = P.E('magnets[1].x'), y0 = P.E('magnets[1].y'), a0 = P.E('magnets[1].angle');
P.E(`toggleFixed(${did})`);
ok(P.E('magnets[1].fixed') === false, 'dynamics: toggleFixed makes the dipole dynamic');
P.frames(180);
const moved = Math.hypot(P.E('magnets[1].x') - x0, P.E('magnets[1].y') - y0) + Math.abs(P.E('magnets[1].angle') - a0);
ok(moved > 0.01 && finite(), 'dynamics: the dynamic dipole moves in the bar field', 'moved ' + moved.toFixed(3));

// ── ui ──
P.E('toggleGrid(); toggleArrows(); toggleTracers();');
ok(P.E('SIM.showHeatmap') && !P.E('SIM.showArrows') && !P.E('SIM.showTracers'), 'ui: layer toggles flip SIM');
P.frames(3);
P.E('toggleGrid(); toggleArrows(); toggleTracers();');
const sl = P.els['sl-tracer-speed']; sl.value = '2.5'; P.E('updateTracerSpeed')(sl);
ok(P.E('SIM.tracerSpeed') === 2.5 && P.els['vl-tracer-speed'].textContent === '2.5', 'ui: speed slider');
const tl = P.els['sl-tracer-trail']; tl.value = '60'; P.E('updateTracerTrail')(tl);
ok(P.E('SIM.tracerTrail') === 60, 'ui: trail slider');
P.E('togglePlay()'); ok(P.E('SIM.playing') === false && !P.els['btn-play'].classList.contains('active'), 'ui: pause'); P.E('togglePlay()');
P.E("addMagnet('horseshoe'); addMagnet('ring'); addMagnet('quadrupole'); addMagnet('halbach'); addMagnet('buzzer'); addMagnet('solenoid')");
ok(P.E('magnets.length') === 8 && P.els['st-magnets'].textContent === '8 magnets', 'ui: all eight magnet types add', P.E('magnets.map(m=>m.type).join(" ")'));
ok(P.E('magnets.every((m,i)=>i===0||magnets.slice(0,i).every(o=>Math.hypot(o.x-m.x,o.y-m.y)>1))'), 'ui: addMagnet places each one at a new spot');
P.frames(30);
P.E('removeMagnet(magnets[7].id)');
ok(P.E('magnets.length') === 7 && P.E('SIM.selectedId') === P.E('magnets[0].id'), 'ui: remove the selected magnet selects the first');
P.E('toggleMobilePanel()'); ok(P.els['panel'].classList.contains('mob-open'), 'ui: mobile panel toggle');

// ── input ──
{
  const m = P.E('magnets[0]'); const mx = m.x, my = m.y;
  const sx = (mx - 400 + P.E('CAM.x')) * P.E('CAM.zoom') + 400, sy = (my - 300 + P.E('CAM.y')) * P.E('CAM.zoom') + 300;
  const ev = (x, y, o = {}) => Object.assign({ clientX: x, clientY: y, shiftKey: false, preventDefault() {} }, o);
  P.fire('sim-canvas:mousedown', ev(sx, sy));
  P.fire('window:mousemove', ev(sx + 30, sy + 10));
  P.fire('window:mouseup', ev(sx + 30, sy + 10));
  ok(Math.abs(P.E('magnets[0].x') - (mx + 30)) < 1e-9 && Math.abs(P.E('magnets[0].y') - (my + 10)) < 1e-9, 'input: mouse drag moves the magnet by the cursor delta');
  P.fire('sim-canvas:wheel', ev(400, 300, { deltaY: -1 }));
  ok(Math.abs(P.E('CAM.zoom') - 1.08) < 1e-12, 'input: wheel zooms by 1.08');
  P.fire('sim-canvas:mousedown', ev(5, 5)); P.fire('window:mousemove', ev(25, 5)); P.fire('window:mouseup', ev(25, 5));
  ok(Math.abs(P.E('CAM.x') - 20 / 1.08) < 1e-9, 'input: empty-space drag pans the camera');
  P.fire('ro', []);
  ok(P.E('TR_N') === P.E('SIM.tracerCount'), 'input: a ResizeObserver call resizes and respawns tracers');
}
P.frames(60);
ok(finite(), 'frames: finite after edits and input');

// ── field ──
{
  const b = P.E('dipoleField(30,40,1,0)'); const r = 50, rx = 30 / r, ry = 40 / r;
  const ex = (3 * rx * rx - 1) / r ** 3 * 80000, ey = 3 * rx * ry / r ** 3 * 80000;
  ok(Math.abs(b[0] - ex) < 1e-9 && Math.abs(b[1] - ey) < 1e-9 && P.E('dipoleField(3,0,1,0)').every(v => v === 0), 'field: dipoleField is the point-dipole form, zero inside r 5');
  const d = P.E('(()=>{refreshFrameCache();let e=0;for(const[x,y]of[[100,100],[420,250],[700,520]]){fieldAt(x,y);let bx=0,by=0;for(const m of magnets){const ca=Math.cos(m.angle),sa=Math.sin(m.angle);for(const p of m.poles){const q=dipoleField(x-(m.x+p.dx*ca-p.dy*sa),y-(m.y+p.dx*sa+p.dy*ca),(p.mx*ca-p.my*sa)*m.strength,(p.mx*sa+p.my*ca)*m.strength);bx+=q[0];by+=q[1];}}e=Math.max(e,Math.abs(FBx-bx)+Math.abs(FBy-by));}return e;})()');
  ok(d < 1e-9, 'field: fieldAt from the pole cache equals the per-pole sum', d.toExponential(1));
}

// ── colors ──
ok(JSON.stringify(P.E('rampStopRGB(0)')) === '[0.05,0,0.3]' && JSON.stringify(P.E('rampStopRGB(1)')) === '[1,1,1]', 'colors: ramp ends');
ok(P.E('fieldColorCSS(0,0.4)') === 'rgba(12,0,76,0.4)' && /vec3 ramp\(float t\)/.test(P.E('TR_FS')), 'colors: CSS ramp and GLSL ramp text', P.E('fieldColorCSS(0,0.4)'));

const stateHash = () => fnv(2166136261, P.E('JSON.stringify(magnets.map(m=>[m.type,m.x,m.y,m.angle,m.vx,m.vy,m.va,m.fixed,m.strength]))+JSON.stringify(Array.from(tPX).concat(Array.from(tPY)))+JSON.stringify(CAM)'));
const pageState = stateHash(), pageDraw = P.draw.h;

// ── saver ──
const labels = [];
await P.sandbox.snSaver.enter({ seed: 7, calm: 0.7, seconds: 60, label: L => labels.push(L) });
ok(P.E('saverOn') && P.E('SV.order.length') === 16 && new Set(P.E('SV.order')).size === 16, 'saver: enter shuffles all 16 scenes', P.E('SV.order.join(",")'));
const sc = [];
for (let k = 0; k < 16; k++) {
  P.E(`saverScene(${k})`); P.frames(30, 50);
  sc.push(P.E('SV.scene.id') + ':' + P.E('magnets.length') + ':' + P.E('SV.st.view.name').split(' ')[0]);
}
const plate = P.E('saverPlate()');
ok(sc.length === 16 && new Set(sc.map(s => s.split(':')[0])).size === 16 && finite(), 'saver: each scene builds and steps, finite', sc.join(' '));
ok(plate && plate.title.startsWith('MagnetLab · ') && plate.tex && plate.tex.length > 0 && plate.lines.at(-1).startsWith('View: '), 'saver: plate has title, TeX and view note');
const k0 = P.E('SV.k'); P.frames(420, 50);
ok(P.E('SV.k') === k0 + 1, 'saver: the dwell runs out and the next scene starts');
ok(labels.length > 16 && labels.every(L => L && L.title), 'saver: labels sent', labels.length + ' labels');
P.sandbox.snSaver.exit();
ok(!P.E('saverOn') && labels.at(-1) === null, 'saver: exit clears the plate');
const saverState = stateHash(), saverDraw = P.draw.h;
const labelHash = fnv(2166136261, JSON.stringify(labels.map(L => L && { ...L, anchor: undefined })));

// ── golden ──
const GOLD = { pageState: 3468425419, pageDraw: 2088018254, saverState: 402802642, saverDraw: 3163013986, labels: 1337544366, calls: 43134726 };
const got = { pageState, pageDraw, saverState, saverDraw, labels: labelHash, calls: P.draw.calls };
if (PRINT) console.log('GOLD = ' + JSON.stringify(got));
for (const k of Object.keys(GOLD)) ok(GOLD[k] === null || GOLD[k] === got[k], 'golden: ' + k + ' equals the single-file page', String(got[k]));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
