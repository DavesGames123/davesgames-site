// CHORDLAB · tests.mjs — node tests, no browser. Run: node tests.mjs
//
// Boots index.html's three classic scripts (dsp.js, render.js, main.js) in
// one vm context with a small DOM made from index.html, stub 2D canvases
// and a fake Web Audio analyser. The analyser plays a synthetic C major
// chord, then a 440 Hz tone. The tests check that the hero readout, the
// tuner, the diagrams, the staff and the mic states update, that no
// script throws, and that no canvas call gets NaN or Infinity.
//
// Optional PNG output (scratch only): set CHORDLAB_CANVAS to the path of an
// @napi-rs/canvas index.js and CHORDLAB_PNG to a folder. The stub canvases
// are then real ones and each panel canvas is written as a PNG.
//
//   grep -n 'MINI DOM'     elements, a tag parser, events, selectors
//   grep -n 'CANVAS'       recording or real 2D contexts with a NaN check
//   grep -n 'FAKE AUDIO'   AudioContext, analyser, getUserMedia
//   grep -n 'BOOT'         one page instance in a vm context
//   grep -n 'TESTS'        the checks
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const HERE = new URL('./', import.meta.url);
const read = f => readFileSync(new URL(f, HERE), 'utf8');
let fails = 0, runs = 0;
const ok = (name, cond, info = '') => { runs++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${info ? ' · ' + info : ''}`); if (!cond) fails++; };

/* ── CANVAS ── */
const NAPI = process.env.CHORDLAB_CANVAS ? createRequire(import.meta.url)(process.env.CHORDLAB_CANVAS) : null;
const PNG_DIR = process.env.CHORDLAB_PNG || '';
// The vendored fonts are woff2, which the PNG path cannot load; macOS system
// fonts stand in for them (Helvetica Neue for Inter, STIX Two Text as is).
if (NAPI) {
  const F = '/System/Library/Fonts/';
  for (const [f, fam] of [['HelveticaNeue.ttc', 'Inter'], ['Supplemental/STIXTwoText.ttf', 'STIX Two Text'], ['Supplemental/STIXTwoText-Italic.ttf', 'STIX Two Text'], ['Apple Symbols.ttf', 'Apple Symbols']])
    try { NAPI.GlobalFonts.registerFromPath(F + f, fam); } catch (_) {}
}
const bad = [];          // NaN / Infinity canvas arguments
let drawCalls = 0;
function checkArgs(where, args) {
  for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) { bad.push(where); return; }
}
function makeCtx(el) {
  if (NAPI) {
    const real = () => el._napi.getContext('2d');
    return new Proxy({}, {
      get(_, k) {
        const c = real(), v = c[k];
        if (typeof v !== 'function') return v;
        return (...args) => { drawCalls++; checkArgs(String(k), args); return v.apply(c, args.map(a => a && a._napi ? a._napi : a)); };
      },
      set(_, k, v) { if (typeof v === 'number') checkArgs('set ' + String(k), [v]); real()[k] = v; return true; },
    });
  }
  const state = { font: '10px sans-serif', fillStyle: '#000', strokeStyle: '#000' };
  const text = el._text_calls = [];
  return new Proxy(state, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'createImageData') return (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      if (k === 'measureText') return s => ({ width: String(s).length * 6 });
      if (k === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
      if (k === 'roundRect' || typeof k !== 'string') return k === 'roundRect' ? (...a) => { drawCalls++; checkArgs('roundRect', a); } : undefined;
      return (...args) => { drawCalls++; checkArgs(k, args); if (k === 'fillText') text.push(String(args[0])); };
    },
    set(t, k, v) { if (typeof v === 'number') checkArgs('set ' + String(k), [v]); t[k] = v; return true; },
  });
}

/* ── MINI DOM ── */
const VOID = new Set(['meta', 'link', 'br', 'input', 'img', 'hr', 'source', 'path', 'rect', 'circle', 'ellipse']);
class El {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.attrs = {}; this.kids = []; this.parentNode = null; this._t = '';
    this.style = { setProperty(k, v) { this[k] = v; } }; this.dataset = {}; this.listeners = {}; this.scrollLeft = 0; this._w = 0; this._h = 0;
    const self = this;
    this.classList = {
      _s() { return (self.className || '').split(/\s+/).filter(Boolean); },
      contains(c) { return this._s().includes(c); },
      add(...c) { const s = this._s(); c.forEach(x => { if (!s.includes(x)) s.push(x); }); self.className = s.join(' '); },
      remove(...c) { self.className = this._s().filter(x => !c.includes(x)).join(' '); },
      toggle(c, on) { const has = this.contains(c); const want = on === undefined ? !has : !!on; if (want && !has) this.add(c); if (!want && has) this.remove(c); return want; },
    };
    this.className = '';
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
    if (k === 'id') this.id = v;
    else if (k === 'class') this.className = v;
    else if (k === 'hidden') this.hidden = true;
    else if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = v;
    else if (k === 'style') v.split(';').forEach(d => { const i = d.indexOf(':'); if (i > 0) this.style[d.slice(0, i).trim()] = d.slice(i + 1).trim(); });
  }
  getAttribute(k) { return this.attrs[k] ?? null; }
  get children() { return this.kids.filter(k => k instanceof El); }
  get firstChild() { return this.kids[0] || null; }
  appendChild(c) { if (c.parentNode) c.remove(); c.parentNode = this; this.kids.push(c); return c; }
  remove() { if (this.parentNode) { const p = this.parentNode; p.kids = p.kids.filter(k => k !== this); this.parentNode = null; } }
  get textContent() { return this._t + this.kids.map(k => k instanceof El ? k.textContent : String(k)).join(''); }
  set textContent(v) { this.kids = []; this._t = String(v); }
  get innerHTML() { return this._t + this.kids.map(k => k instanceof El ? k.outerHTML : String(k)).join(''); }
  set innerHTML(v) { this.kids = []; this._t = ''; parseInto(String(v), this); }
  get outerHTML() { const t = this.tagName.toLowerCase(); return `<${t}${Object.entries(this.attrs).map(([k, v]) => ` ${k}="${v}"`).join('')}>${this.innerHTML}</${t}>`; }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter(x => x !== f); }
  dispatchEvent(e) {
    e.target ||= this; e.preventDefault ||= () => { e.defaultPrevented = true; };
    for (let n = this; n; n = n.parentNode) { e.currentTarget = n; (n.listeners[e.type] || []).forEach(f => f.call(n, e)); if (e._stop) break; }
    if (this.ownerDocument && !e._stop) (this.ownerDocument.listeners[e.type] || []).forEach(f => f(e));
    return true;
  }
  click() { this.dispatchEvent({ type: 'click' }); }
  focus() {} select() {} blur() {}
  matches(sel) {
    if (sel.startsWith('#')) return this.id === sel.slice(1);
    if (sel.startsWith('.')) return this.classList.contains(sel.slice(1));
    return this.tagName === sel.toUpperCase();
  }
  closest(sel) { for (let n = this; n instanceof El; n = n.parentNode) if (n.matches(sel)) return n; return null; }
  querySelectorAll(sel) { const out = []; const walk = n => n.children.forEach(c => { if (c.matches(sel)) out.push(c); walk(c); }); walk(this); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  get clientWidth() { return this._w; }
  get clientHeight() { return this._h; }
  get scrollWidth() { return Math.max(this._w, ...this.children.map(c => c._w || parseFloat(c.style.width) || 0)); }
  getBoundingClientRect() { return { left: 0, top: 0, width: this._w, height: this._h, right: this._w, bottom: this._h }; }
  // canvas
  get width() { return this._cw ?? 300; }
  set width(v) { this._cw = v; if (this._napi) this._napi.width = Math.max(1, v); }
  get height() { return this._ch ?? 150; }
  set height(v) { this._ch = v; if (this._napi) this._napi.height = Math.max(1, v); }
  getContext() {
    if (!this._ctx) { if (NAPI) this._napi = NAPI.createCanvas(Math.max(1, this.width), Math.max(1, this.height)); this._ctx = makeCtx(this); }
    return this._ctx;
  }
}
function parseInto(html, parent) {
  html = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!DOCTYPE[^>]*>/i, '');
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g;
  const stack = [parent];
  let m;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[4] !== undefined) { const t = m[4].replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&'); if (t) top.kids.push(t); continue; }
    const tag = m[2].toLowerCase();
    if (m[1]) { for (let i = stack.length - 1; i > 0; i--) if (stack[i].tagName === tag.toUpperCase()) { stack.length = i; break; } continue; }
    const el = new El(tag, parent.ownerDocument);
    const ar = /([\w:-]+)(?:\s*=\s*"([^"]*)")?/g; let a;
    while ((a = ar.exec(m[3]))) if (a[1] !== '/') el.setAttribute(a[1], a[2] ?? '');
    top.appendChild(el);
    if (!VOID.has(tag) && !m[3].trim().endsWith('/')) stack.push(el);
  }
}

/* ── FAKE AUDIO ── */
// Spectrum in dB: a floor near -105 dB plus, per tone, a parabolic peak (a
// Gaussian in power) at each of 6 harmonics, 7 dB down per harmonic.
function makeAudio(scen) {
  const SR = 48000;
  const analyser = {
    fftSize: 2048, smoothingTimeConstant: 0.8,
    get frequencyBinCount() { return this.fftSize / 2; },
    getFloatFrequencyData(a) {
      const bin = SR / this.fftSize;
      for (let i = 0; i < a.length; i++) a[i] = -105 + 3 * Math.sin(i * 12.9898) ** 2;
      for (const t of scen.tones) for (let h = 1; h <= 6; h++) {
        const f = t.f * h, c = f / bin, db = t.db - 7 * (h - 1);
        for (let i = Math.max(0, Math.floor(c) - 4); i <= Math.min(a.length - 1, Math.ceil(c) + 4); i++) {
          const d = i - c; a[i] = Math.max(a[i], db - 7 * d * d);
        }
      }
    },
    getFloatTimeDomainData(a) {
      for (let i = 0; i < a.length; i++) {
        let v = 0; const t = (scen.n + i) / SR;
        for (const tn of scen.td) v += tn.a * Math.sin(2 * Math.PI * tn.f * t);
        a[i] = v;
      }
      scen.n += 800;
    },
    connect() {}, disconnect() {},
  };
  const node = () => ({ connect() {}, disconnect() {}, start() {}, stop() {}, frequency: { value: 0 }, detune: { value: 0 }, type: '',
    gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} } });
  class AudioContext {
    constructor() { this.sampleRate = SR; this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    resume() { return Promise.resolve(); }
    createMediaStreamSource() { return node(); }
    createAnalyser() { return analyser; }
    createOscillator() { return node(); }
    createGain() { return node(); }
  }
  return { AudioContext, SR };
}
const hz = (midi, a4 = 440) => a4 * 2 ** ((midi - 69) / 12);
// Strummed C major, open position: C3 E3 G3 C4 E4.
const C_MAJOR = { tones: [48, 52, 55, 60, 64].map((m, i) => ({ f: hz(m), db: -32 - i })), td: [48, 52, 55, 60, 64].map(m => ({ f: hz(m), a: 0.12 })), n: 0 };
const A440 = { tones: [{ f: 440, db: -30 }], td: [{ f: 440, a: 0.5 }], n: 0 };

/* ── BOOT ── */
// Panel sizes in CSS px (there is no layout engine here).
const SIZES = { ringCanvas: [380, 380], meterCanvas: [64, 380], diagCanvas: [290, 348], gaugeCanvas: [340, 184], specCanvas: [340, 250],
  staffScroll: [1100, 160], staffCanvas: [1100, 156], histList: [300, 32] };
function boot({ gum = 'ok', mob = false } = {}) {
  const scen = { tones: [], td: [], n: 0 };
  const audio = makeAudio(scen);
  const doc = { listeners: {}, visibilityState: 'visible' };
  const root = new El('html', doc);
  doc.documentElement = root;
  parseInto(read('index.html').replace(/^[\s\S]*?<html[^>]*>/, ''), root);
  doc.body = root.querySelector('body') || root;
  doc.getElementById = id => { let f = null; const w = n => { for (const c of n.children) { if (c.id === id) { f = c; return; } w(c); if (f) return; } }; w(root); return f; };
  doc.createElement = t => new El(t, doc);
  doc.addEventListener = (t, f) => { (doc.listeners[t] ||= []).push(f); };
  doc.execCommand = () => true;
  for (const [id, [w, h]] of Object.entries(SIZES)) { const e = doc.getElementById(id); if (e) { e._w = w; e._h = h; } }
  if (mob) root.classList.add('mob');
  let clock = 1000, raf = null;
  const errors = [];
  const winL = {};
  const store = {};
  const sb = {
    document: doc, console, Math, JSON, Date, Promise, Object, Array, Set, Map, Float32Array, Uint8ClampedArray, Uint8Array, Int32Array, Number, String, Boolean, Symbol, Error, isFinite, parseFloat, parseInt,
    setTimeout: (f, ms) => setTimeout(() => { try { f(); } catch (e) { errors.push(e); } }, Math.min(ms || 0, 5)), clearTimeout,
    performance: { now: () => clock },
    requestAnimationFrame: f => { raf = f; return 1; },
    devicePixelRatio: 2, innerWidth: mob ? 390 : 1440, innerHeight: mob ? 844 : 900, screen: { width: mob ? 390 : 1440, height: mob ? 844 : 900 },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } },
    navigator: {
      clipboard: { writeText: t => { sb._copied = t; return Promise.resolve(); } },
      mediaDevices: { getUserMedia: () => gum === 'ok'
        ? Promise.resolve({ getAudioTracks: () => [{ addEventListener() {} }], getTracks: () => [{ stop() {} }] })
        : Promise.reject(Object.assign(new Error('denied'), { name: gum })) },
    },
    AudioContext: audio.AudioContext,
    addEventListener: (t, f) => { (winL[t] ||= []).push(f); },
    removeEventListener() {},
  };
  sb.window = sb; sb.top = sb; sb.self = sb;
  const ctx = vm.createContext(sb);
  for (const f of ['dsp.js', 'render.js', 'main.js']) {
    try { new vm.Script(read(f), { filename: f }).runInContext(ctx); } catch (e) { errors.push(e); }
  }
  const run = code => vm.runInContext(code, ctx);
  const frame = (ms = 16.7) => { clock += ms; const f = raf; raf = null; if (f) try { f(clock); } catch (e) { errors.push(e); } };
  const frames = (n, ms) => { for (let i = 0; i < n; i++) frame(ms); };
  const key = k => (winL.keydown || []).forEach(f => f({ key: k, target: doc.body, preventDefault() {}, repeat: false }));
  const $ = id => doc.getElementById(id);
  const settle = () => new Promise(r => setTimeout(r, 15));
  return { run, frame, frames, key, $, scen, errors, settle, doc, sb };
}
function png(page, id, name) {
  if (!NAPI || !PNG_DIR) return;
  mkdirSync(PNG_DIR, { recursive: true });
  const e = page.$(id); if (!e || !e._napi) return;
  writeFileSync(`${PNG_DIR}/${name}.png`, e._napi.toBuffer('image/png'));
}

/* ── TESTS ── */
// 1. Boot without a mic: no exceptions, empty states, start card up.
{
  const p = boot();
  p.frames(30);
  ok('boot without mic: no exceptions', !p.errors.length, p.errors.map(e => e.message).join(' | '));
  ok('start card is shown before the mic', !p.$('micGate').classList.contains('hidden') && !p.$('micGate').classList.contains('resume'));
  ok('pill reads Mic off', p.$('micPill').textContent === 'Mic off');
  ok('hero empty state', p.$('chordRoot').textContent === '···' && /Notes show here/.test(p.$('chordNotes').textContent));
  ok('history empty state', /line up here/.test(p.$('histList').textContent));
  ok('diagram drew the default C chord', !NAPI ? p.$('diagCanvas')._text_calls.includes('C') : true);
  ok('A4 control reads 440', p.$('a4Val').textContent === 'A4 440 Hz');
  ok('six string buttons', p.$('stringRow').children.length === 6);
  ok('guitar voicings listed', p.$('voicings').children.length >= 2, p.$('voicings').children.length + ' buttons');
  png(p, 'diagCanvas', 'empty-diag'); png(p, 'staffCanvas', 'empty-staff'); png(p, 'gaugeCanvas', 'empty-gauge');
  // finger numbers for library shapes (low E string first)
  const fing = (r, q, i = 0) => JSON.parse(p.run(`JSON.stringify((()=>{const v=guitarVoicings(${r},'${q}')[${i}];return fingerFor(v.frets,v.barre||0);})())`));
  ok('fingering C open = x 3 2 0 1 0', fing(0, '').join('') === '032010', fing(0, '').join(''));
  ok('fingering D open = x x 0 1 3 2', fing(2, '').join('') === '000132', fing(2, '').join(''));
  ok('fingering F E-shape barre = 1 3 4 2 1 1', fing(5, '', 0).join('') === '134211', fing(5, '', 0).join(''));
  ok('staff position: E4 bottom line, C4 ledger, F5 top line', p.run('[staffPos(4),staffPos(0),staffPos(17)].join()') === '0,-2,8');
}

// 2. Error state: permission denied shows the reason, mic stays off.
{
  const p = boot({ gum: 'NotAllowedError' });
  p.$('micBtn').click();
  await p.settle(); p.frames(3);
  ok('denied: error text shown', p.$('micErr').style.display === 'block' && /blocked/.test(p.$('micErr').textContent), p.$('micErr').textContent.slice(0, 50));
  ok('denied: pill still Mic off, no exceptions', p.$('micPill').textContent === 'Mic off' && !p.errors.length);
}

// 3. Live: a C major chord, then a 440 Hz tone, then pause.
{
  const p = boot();
  Object.assign(p.scen, C_MAJOR);
  p.$('micBtn').click();
  await p.settle();
  p.frames(150);
  ok('live: gate hidden, pill Listening', p.$('micGate').classList.contains('hidden') && p.$('micPill').textContent === 'Listening');
  ok('live: pause button shown', !p.$('micToggle').hidden);
  ok('C major: hero root C', p.$('chordRoot').textContent === 'C', p.$('chordRoot').textContent + ' ' + p.$('chordQual').textContent);
  ok('C major: quality major', p.$('chordQual').textContent === 'major');
  const notes = p.$('chordNotes').children.map(c => c.textContent).join(' ');
  ok('C major: note chips C E G with intervals', notes === 'CR E3 G5', notes);
  ok('C major: confidence shown', /^\d+ % match$/.test(p.$('chordConf').textContent) && parseFloat(p.$('confBar').style.width) > 0, p.$('chordConf').textContent);
  ok('C major: logged to the staff and history', p.run('chordLog.length') >= 1 && p.$('histList').children.length >= 1);
  ok('C major: diagram chord is C', p.run("diagChord.root===0&&diagChord.q===''"));
  ok('likely chords banner names C', /C/.test(p.$('domList').textContent), p.$('domList').textContent.trim().slice(0, 30));
  png(p, 'ringCanvas', 'live-ring'); png(p, 'meterCanvas', 'live-meter'); png(p, 'diagCanvas', 'live-diag-guitar');
  for (const [k, n] of [['2', 'bass'], ['3', 'ukulele'], ['4', 'violin'], ['5', 'piano']]) {
    p.key(k); p.frames(2);
    ok(`key ${k} selects ${n} and draws`, p.run('instrument') === n && !p.errors.length);
    png(p, 'diagCanvas', 'live-diag-' + n);
  }
  p.key('1'); p.key('ArrowRight'); p.frames(2);
  ok('arrow right picks the next guitar voicing', p.run('voicingIdx') === 1);
  png(p, 'diagCanvas', 'live-diag-guitar-v2');
  p.key('H');
  ok('H strums without errors', !p.errors.length);
  p.key(']'); ok('] raises A4 to 441', p.$('a4Val').textContent === 'A4 441 Hz'); p.key('[');
  p.key('?'); ok('? shows the keys card', !p.$('keysCard').hidden); p.key('Escape');
  // tone
  Object.assign(p.scen, A440);
  p.frames(120);
  ok('440 Hz: tuner note A4', p.$('tunerNote').textContent === 'A4', p.$('tunerNote').textContent);
  ok('440 Hz: frequency readout', /^44[01]\.\d Hz/.test(p.$('tunerFreq').textContent), p.$('tunerFreq').textContent);
  const g = p.run('[gLive,gTarget,gNeedle]');
  ok('440 Hz: gauge live near 0 cents and settled', g[0] && Math.abs(g[1]) <= 5 && Math.abs(g[2] - g[1]) < 1.5, g.map(v => typeof v === 'number' ? v.toFixed(2) : v).join(' '));
  ok('440 Hz: in-tune class on the note', p.$('tunerNote').classList.contains('ok'));
  png(p, 'gaugeCanvas', 'live-gauge'); png(p, 'specCanvas', 'live-spec'); png(p, 'staffCanvas', 'live-staff');
  // pause
  p.key(' ');
  p.frames(3);
  ok('pause: resume card, pill Paused', !p.$('micGate').classList.contains('hidden') && p.$('micGate').classList.contains('resume') && p.$('micPill').textContent === 'Paused');
  ok('pause: resume button text', p.$('micBtn').textContent === 'Resume listening');
  p.$('copyStaff').click(); await p.settle();
  ok('copy: chord log text', /^\| .+ \|$/.test(p.sb._copied || ''), p.sb._copied);
  p.$('clearStaff').click(); p.frames(2);
  ok('clear: log and history empty', p.run('chordLog.length') === 0 && /line up here/.test(p.$('histList').textContent));
  ok('live run: no exceptions', !p.errors.length, p.errors.map(e => e.message).join(' | '));
}

// 4. A logged progression for the staff: chords with sharps, seconds and ledger lines.
{
  const p = boot();
  p.run(`[[0,''],[9,'m'],[5,''],[7,'7'],[4,''],[11,'m7'],[2,'sus2'],[5,'sus4'],[1,'maj7'],[6,'dim']].forEach(([r,q])=>chordLog.push({root:r,q}));staffDirty=true;`);
  p.frames(3);
  ok('staff with 10 chords: no exceptions', !p.errors.length, p.errors.map(e => e.message).join(' | '));
  png(p, 'staffCanvas', 'prog-staff');
  ok('phone layout class boots', (() => { const q = boot({ mob: true }); q.frames(5); q.$('mobTabs').children[2].click(); q.frames(2); return !q.errors.length && q.doc.body.classList.contains('mtab-tuner'); })());
}

ok('no NaN or Infinity in any canvas call', bad.length === 0, bad.slice(0, 5).join(', '));
ok('canvas calls happened', drawCalls > 1000, drawCalls + ' calls');
if (fails) { console.log(`${fails} of ${runs} failed`); process.exit(1); }
console.log(`all ${runs} passed`);
