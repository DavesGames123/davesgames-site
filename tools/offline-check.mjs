#!/usr/bin/env node
// ============================================================================
//  tools/offline-check.mjs — node checks of the shell reload rules
// ----------------------------------------------------------------------------
//  Runs stella-nova/lib/offline.js in a node vm with a fake window,
//  document, navigator.serviceWorker, location, sessionStorage and clock.
//  No browser runs. A "load" is a new vm run that shares sessionStorage
//  with the loads before it, as a reload in one tab does.
//
//  The checks (function mayReload in offline.js):
//    1. six loads in a row, each with a worker change 1 s after load (a
//       CDN that gives two sw.js versions in turn): one reload in all
//    2. a worker change after a tap in the shell: no reload
//    3. a worker change after the page frame scrolled: no reload
//    4. a worker change 20 s after load: no reload, stale is true
//    5. sessionStorage that throws: no reload
//    6. a first worker (no worker at load): no reload, stale is false
//    7. a running screensaver: no reload
//
//  Usage (repo root):
//    node tools/offline-check.mjs            check lib/offline.js
//    node tools/offline-check.mjs --old REV  the same checks on
//                                            git show REV:stella-nova/lib/offline.js
//  Exit 1 on any failure.
// ============================================================================
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'stella-nova/lib/offline.js';
const i = process.argv.indexOf('--old');
const src = i > 0
  ? execFileSync('git', ['show', process.argv[i + 1] + ':' + REL], { cwd: ROOT, encoding: 'utf8' })
  : fs.readFileSync(path.join(ROOT, REL), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log('ok    ' + m); } else { fail++; console.log('FAIL  ' + m + (d ? '\n      ' + d : '')); } };

function memStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}
const badStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() {} };

// One shell load. Returns controls for the test.
function load({ session, clock, controller = true, frameY = 0, saver = false }) {
  const swL = {}, winL = {};
  let reloads = 0;
  const sw = {
    controller: controller ? {} : null,
    ready: new Promise(() => {}),
    addEventListener: (t, f) => { (swL[t] = swL[t] || []).push(f); },
    startMessages() {},
    getRegistrations: async () => [],
    register: () => new Promise(() => {}),
  };
  const frameWin = { scrollY: frameY, document: { scrollingElement: { scrollTop: frameY } } };
  const window = {
    addEventListener: (t, f) => { (winL[t] = winL[t] || []).push(f); },
    snScreensaver: saver ? { running: true } : undefined,
  };
  const FakeDate = class extends Date { static now() { return clock.t; } };
  const ctx = vm.createContext({
    window,
    navigator: { serviceWorker: sw },
    location: { protocol: 'https:', hostname: 'davesgames.io', search: '', reload: () => { reloads++; } },
    document: {
      baseURI: 'https://davesgames.io/stella-nova/', readyState: 'loading',
      querySelector: s => (s === '#frame-wrap iframe' ? { contentWindow: frameWin } : null),
      createElement: () => ({ style: {}, setAttribute() {} }), body: { appendChild() {} },
    },
    localStorage: memStorage(),
    sessionStorage: session,
    Date: FakeDate, URL, MessageChannel, setTimeout: () => 0, clearTimeout() {}, console,
  });
  ctx.window.navigator = ctx.navigator;
  vm.runInContext(src, ctx, { filename: REL });
  return {
    change: () => (swL.controllerchange || []).forEach(f => f({})),
    input: t => (winL[t] || []).forEach(f => f({})),
    get reloads() { return reloads; },
    get stale() { return ctx.window.snOffline && ctx.window.snOffline.stale; },
  };
}

// 1. six loads in a row with a change each
{
  const session = memStorage(), clock = { t: 1e12 };
  let total = 0;
  for (let n = 0; n < 6; n++) {
    clock.t += 2000;
    const s = load({ session, clock });
    clock.t += 1000;
    s.change();
    total += s.reloads;
  }
  ok(total === 1, '1: six loads with a worker change each reload once in all', `reloads ${total}`);
}
// 2. a tap first
{
  const clock = { t: 1e12 }, s = load({ session: memStorage(), clock });
  clock.t += 1000; s.input('pointerdown'); s.change();
  ok(s.reloads === 0, '2: no reload after a tap in the shell', `reloads ${s.reloads}`);
}
// 3. the frame scrolled
{
  const clock = { t: 1e12 }, s = load({ session: memStorage(), clock, frameY: 600 });
  clock.t += 1000; s.change();
  ok(s.reloads === 0, '3: no reload when the page frame is scrolled', `reloads ${s.reloads}`);
}
// 4. late change
{
  const clock = { t: 1e12 }, s = load({ session: memStorage(), clock });
  clock.t += 20000; s.change();
  ok(s.reloads === 0 && s.stale === true, '4: no reload 20 s after load, stale is true', `reloads ${s.reloads}, stale ${s.stale}`);
}
// 5. storage throws
{
  const clock = { t: 1e12 }, s = load({ session: badStorage, clock });
  clock.t += 1000; s.change();
  ok(s.reloads === 0, '5: no reload when sessionStorage throws', `reloads ${s.reloads}`);
}
// 6. first worker
{
  const clock = { t: 1e12 }, s = load({ session: memStorage(), clock, controller: false });
  clock.t += 1000; s.change();
  ok(s.reloads === 0 && s.stale === false, '6: a first worker does not reload and is not stale', `reloads ${s.reloads}, stale ${s.stale}`);
}
// 7. screensaver
{
  const clock = { t: 1e12 }, s = load({ session: memStorage(), clock, saver: true });
  clock.t += 1000; s.change();
  ok(s.reloads === 0, '7: no reload while the screensaver runs', `reloads ${s.reloads}`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
