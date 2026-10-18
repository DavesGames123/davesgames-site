// ============================================================================
//  TEST VM  ·  pages/soft-bodies/test-vm.mjs — run an upstream three.js
//  Ten Minute Physics script in a node vm (no browser, no WebGL)
// ----------------------------------------------------------------------------
//  loadUpstream(pageDir) makes a fresh vm context with small DOM stubs,
//  loads vendor three.js r139 and its OrbitControls, swaps the
//  WebGLRenderer for a no-op, then runs the page's own classic scripts
//  (pageScripts: the local <script src> tags of index.html without
//  type="module", in page order, for example a mesh data file and then
//  main.js). The scene, meshes and physics classes are real; nothing is
//  drawn.
//  Returns { ctx, lex(name), U(extra) }: lex reads a class or let binding
//  of the script (they are not properties of the global object).
//  Used by the tests of soft-bodies, soft-body-interaction,
//  soft-body-skinning, cloth and cloth-self-collision.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VENDOR = path.resolve(HERE, '../../vendor/three@0.139.2');

class El {
  constructor(tag) { this.tagName = (tag || 'div').toUpperCase(); this.style = {}; this.children = []; this.innerHTML = ''; this.value = '0'; this.width = 300; this.height = 150; }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener() {} removeEventListener() {} setPointerCapture() {} releasePointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 500, right: 800, bottom: 500 }; }
  getContext() { return null; }
  get ownerDocument() { return DOC; }
}
const DOC = { getElementById: id => (DOC._ids[id] = DOC._ids[id] || new El('div')), createElement: t => new El(t), createElementNS: (n, t) => new El(t), body: new El('body'), addEventListener() {}, removeEventListener() {}, _ids: {} };

// The local classic scripts of the page, in the order index.html loads them.
// A src with a "/" or a scheme (lib, vendor, widgets) is not the page's own.
export function pageScripts(pageDir) {
  const html = fs.readFileSync(path.join(pageDir, 'index.html'), 'utf8');
  const out = [];
  for (const m of html.matchAll(/<script\b([^>]*)>/g)) {
    const attrs = m[1], src = /\bsrc="([^"]+)"/.exec(attrs);
    if (src && !/\btype="module"/.test(attrs) && !/[/:]/.test(src[1])) out.push(src[1]);
  }
  return out.length ? out : ['main.js'];
}

export function loadUpstream(pageDir) {
  const ctx = {
    console: { log() {}, info() {}, warn() {}, error: (...a) => console.error(...a) },
    document: Object.assign(Object.create(DOC), { _ids: {} }),
    container: new El('div'), innerWidth: 800, innerHeight: 500, devicePixelRatio: 1,
    requestAnimationFrame: () => 0, cancelAnimationFrame() {}, addEventListener() {}, removeEventListener() {},
    performance: { now: () => 0 }, navigator: { userAgent: 'node' }, setTimeout: () => 0, clearTimeout() {},
    location: { reload() {} },
  };
  ctx.document.getElementById = id => (ctx.document._ids[id] = ctx.document._ids[id] || new El('div'));
  ctx.window = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(VENDOR, 'build/three.min.js'), 'utf8'), ctx, { filename: 'three.min.js' });
  ctx.THREE.WebGLRenderer = class { constructor() { this.domElement = new El('canvas'); this.shadowMap = {}; } setPixelRatio() {} setSize() {} render() {} };
  vm.runInContext(fs.readFileSync(path.join(VENDOR, 'examples/js/controls/OrbitControls.js'), 'utf8'), ctx, { filename: 'OrbitControls.js' });
  for (const f of pageScripts(pageDir)) vm.runInContext(fs.readFileSync(path.join(pageDir, f), 'utf8'), ctx, { filename: path.join(pageDir, f) });
  const lex = name => vm.runInContext(name, ctx);
  return { ctx, lex };
}

// A tiny test reporter shared by the page tests.
export function reporter() {
  let pass = 0, fail = 0;
  const ok = (c, name, info = '') => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };
  const done = () => { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); };
  return { ok, done };
}
