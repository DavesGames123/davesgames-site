// ============================================================================
//  RETRO SHELF  ·  play-emu.js — EmulatorJS for a file that the person owns
// ----------------------------------------------------------------------------
//  This page hosts no game and no BIOS. The shelf page (main.js) sends the
//  File objects that the person picked with postMessage, in the same
//  origin: the browser clones them into this window. EmulatorJS reads them
//  from memory. Nothing is uploaded.
//
//  Settings (EJS_* globals, read by data/loader.js):
//    EJS_core        the exact core of games.json "systems" (so iOS Safari
//                    does not swap the N64 core for one that we do not host)
//    EJS_pathtodata  the deploy-fetched EmulatorJS data folder
//    EJS_DEBUG_XX    true: load data/src/*.js (the npm package has no
//                    minified bundle)
//    EJS_disableDatabases, EJS_CacheLimit 0: do not copy the game into
//                    IndexedDB
//  fetch() here refuses cdn.emulatorjs.org (an update check and a core
//  fallback), so the page sends no request to a third party.
//
//  Exports for node tests: ejsConfig, blockedUrl.
//  grep -n targets
//    "export function ejsConfig"   "export function blockedUrl"
//    "function patchFetch"   "async function start"
// ============================================================================
import { status, fail, manifest, bootGame } from './player-common.js';

export function blockedUrl(url) {
  try { return new URL(url, 'https://x.invalid/').hostname.endsWith('emulatorjs.org'); } catch (e) { return false; }
}

/** The EJS_* globals for a system record, a game File and an optional BIOS File. */
export function ejsConfig(system, dataDir, file, bios) {
  return {
    EJS_player: '#game',
    EJS_core: system.core,
    EJS_gameUrl: file,
    EJS_biosUrl: bios || '',
    EJS_gameName: String(file && file.name || 'game').replace(/\.[^.]+$/, ''),
    EJS_pathtodata: dataDir,
    EJS_DEBUG_XX: true,
    EJS_startOnLoaded: false,
    EJS_disableDatabases: true,
    EJS_CacheLimit: 0,
    EJS_threads: false,
    EJS_color: '#ffb347',
    EJS_backgroundColor: '#000000',
    EJS_language: 'en-US',
    EJS_disableAutoLang: false, // false + en-US: the loader fetches no language file
  };
}

function patchFetch() {
  const orig = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const u = typeof input === 'string' ? input : input && input.url;
    if (blockedUrl(u)) return Promise.resolve(new Response('', { status: 404 }));
    return orig(input, init);
  };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, url, ...rest) {
    if (blockedUrl(String(url))) url = 'data:,';
    return open.call(this, m, url, ...rest);
  };
}

async function start() {
  try {
    patchFetch();
    const data = await manifest();
    const id = new URLSearchParams(location.search).get('system');
    const system = data.systems.find(s => s.id === id);
    if (!system) throw new Error('No system "' + id + '".');
    bootGame(system.name);
    const eng = data.engines.find(e => e.id === 'emu');
    const dataDir = new URL(data.fetched + eng.dir, import.meta.url).href;
    window.addEventListener('message', e => {
      if (e.origin !== location.origin || !e.data || e.data.type !== 'retro-file') return;
      const { file, bios } = e.data;
      if (!(file instanceof Blob)) { fail('No game file arrived.'); return; }
      document.title = file.name + ' · Retro Shelf';
      bootGame(file.name);
      Object.assign(window, ejsConfig(system, dataDir, file, bios instanceof Blob ? bios : null));
      status('');
      const s = document.createElement('script');
      s.src = dataDir + 'loader.js';
      s.onerror = () => fail('The emulator is not on the server right now. Please try again later.');
      document.body.append(s);
    }, { once: false });
    parent.postMessage({ type: 'retro-ready' }, location.origin);
  } catch (e) {
    fail(e.message || String(e));
  }
}

if (typeof document !== 'undefined' && document.getElementById('game')) start();
