#!/usr/bin/env node
// ============================================================================
//  tools/shell-nav-check.mjs — node checks of the shell page swap
// ----------------------------------------------------------------------------
//  Takes functions out of the inline script of stella-nova/index.html and
//  runs them in a node vm with fake frames. No browser runs.
//
//  The checks:
//    release   releaseFrame on a page with lib/gpu-guard.js calls
//              __snRelease and makes no new canvas context; on a page with
//              no guard it still loses each WebGL context
//
//  Usage (repo root):
//    node tools/shell-nav-check.mjs            check stella-nova/index.html
//    node tools/shell-nav-check.mjs --old REV  the same checks on
//                                              git show REV:stella-nova/index.html
//  Exit 1 on any failure.
// ============================================================================
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'stella-nova/index.html';
const io = process.argv.indexOf('--old');
const OLD = io > 0 ? process.argv[io + 1] : null;
const html = OLD
  ? execFileSync('git', ['show', OLD + ':' + REL], { cwd: ROOT, encoding: 'utf8' })
  : fs.readFileSync(path.join(ROOT, REL), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log('ok    ' + m); } else { fail++; console.log('FAIL  ' + m + (d ? '\n      ' + d : '')); } };

// One top-level function of the inline shell script, by name.
function fnSource(name) {
  const m = html.match(new RegExp('^function ' + name + '\\(.*$', 'm'));
  if (!m) throw new Error('no function ' + name + ' in ' + REL);
  return m[0];
}

// ── release ─────────────────────────────────────────────────────────────────
// A fake canvas: ctx is its context type ('2d', 'webgl2' or null). A
// getContext call on a canvas with no context makes one (as browsers do).
function canvas(ctx) {
  const c = { type: ctx, made: 0, lost: 0 };
  c.getContext = t => {
    if (c.type === null) { c.type = t; c.made++; }
    if (c.type !== t) return null;
    if (t === 'webgpu') return { unconfigure() {}, getConfiguration: () => null };
    if (t === '2d') return {};
    return { getExtension: () => ({ loseContext: () => { c.lost++; } }) };
  };
  return c;
}
function frame(canvases, guard) {
  let released = 0;
  const w = guard ? { __snRelease: () => { released++; } } : {};
  return {
    f: { contentWindow: w, contentDocument: { querySelectorAll: () => canvases } },
    get released() { return released; },
  };
}
{
  const ctx = vm.createContext({});
  vm.runInContext(fnSource('releaseFrame'), ctx);
  // A guarded page with one WebGL canvas, one 2d canvas and four unused canvases.
  const cs = [canvas('webgl2'), canvas('2d'), canvas(null), canvas(null), canvas(null), canvas(null)];
  const g = frame(cs, true);
  ctx.releaseFrame(g.f);
  const made = cs.reduce((a, c) => a + c.made, 0);
  ok(g.released === 1, 'release: a guarded page gets __snRelease', `calls ${g.released}`);
  ok(made === 0, 'release: a guarded page gets no new canvas context', `new contexts ${made}`);
  // A page with no guard: the sweep still loses its WebGL context.
  const cs2 = [canvas('webgl2'), canvas('2d')];
  const n = frame(cs2, false);
  ctx.releaseFrame(n.f);
  ok(cs2[0].lost === 1, 'release: a page with no guard still loses its WebGL context', `lost ${cs2[0].lost}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
