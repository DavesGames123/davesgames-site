// ============================================================================
//  RETRO SHELF  ·  play-scummvm.js — run a freeware adventure in ScummVM
// ----------------------------------------------------------------------------
//  1. Read games.json and the game of ?game=<id> (engine "scummvm").
//  2. Fetch the unchanged archive, check its sha256, unpack it in memory.
//  3. Set window.Module: retroFS (called by the build's retro-pre.js before
//     main) writes every file into /games/<id>/ of the Emscripten MEMFS.
//     The URL hash gives ScummVM its arguments:
//       --path=/games/<id>[/<root>] --auto-detect
//     (dists/emscripten/custom_shell-pre.js reads the hash).
//  4. Load scummvm.js from the vendor folder. The wasm loads next to it.
//  Two fixes for this site, without a change to ScummVM:
//    - the emscripten backend fetches its engine data from the absolute
//      path /data; fetch() here maps /data/... to the vendor data folder.
//    - its shell code asks for Web MIDI (a permission prompt); this page
//      removes navigator.requestMIDIAccess first, so the build falls back
//      to its own synthesis.
//  Saves and scummvm.ini go to IndexedDB in this browser (the build mounts
//  IDBFS on $HOME). pagehide (the shelf removes the iframe) ends it all.
//
//  Exports for node tests: scummArgs, dataUrl.
//  grep -n targets
//    "export function scummArgs"   "export function dataUrl"
//    "function patchFetch"   "function buildKeys"   "async function start"
// ============================================================================
import { zipAll } from './unzip.js';
import { status, fail, manifest, loadGame, gameFromQuery } from './player-common.js';

/** The ScummVM command line for a game (space separated, in the hash). */
export function scummArgs(game) {
  const path = '/games/' + game.id + (game.root ? '/' + game.root : '');
  return ['--path=' + path, '--auto-detect'];
}

/** Map a backend data URL (/data/...) to the vendor build folder. */
export function dataUrl(url, base) {
  if (typeof url !== 'string' || !url.startsWith('/data')) return null;
  return new URL(url.slice(1), base).href;
}

function patchFetch(base) {
  const orig = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const u = typeof input === 'string' ? input : null;
    const mapped = dataUrl(u, base);
    if (mapped) return orig(mapped, init);
    // The build asks for a default scummvm.ini next to the page; there is none.
    if (u === 'scummvm.ini') return Promise.resolve(new Response('', { status: 404 }));
    return orig(input, init);
  };
}

function buildKeys() {
  if (!matchMedia('(hover: none) and (pointer: coarse)').matches) return;
  document.documentElement.classList.add('has-keys');
  const box = document.getElementById('keys');
  box.hidden = false;
  const fire = (b, type) => {
    const ev = new KeyboardEvent(type, { key: b.dataset.key, code: b.dataset.code, bubbles: true, cancelable: true });
    // On document, so it reaches listeners on document and (by bubbling) on window.
    document.dispatchEvent(ev);
  };
  box.addEventListener('pointerdown', e => {
    const b = e.target.closest('button'); if (!b) return;
    e.preventDefault(); b.classList.add('on'); fire(b, 'keydown');
    setTimeout(() => { b.classList.remove('on'); fire(b, 'keyup'); }, 90);
  });
}

async function start() {
  try {
    try { delete Navigator.prototype.requestMIDIAccess; } catch (e) { /* not there */ }
    const data = await manifest();
    const game = gameFromQuery(data);
    if (game.engine !== 'scummvm') throw new Error(game.title + ' is not a ScummVM game.');
    document.title = game.title + ' · Retro Shelf';
    const eng = data.engines.find(e => e.id === 'scummvm');
    const base = new URL(eng.dir, import.meta.url).href;
    patchFetch(base);
    const bytes = await loadGame(data, game);
    status('Unpacking ' + game.title + '…');
    const files = await zipAll(bytes);
    status('Starting ScummVM…');
    history.replaceState(null, '', location.pathname + location.search + '#' + scummArgs(game).join(' '));
    const canvas = document.getElementById('canvas');
    window.Module = {
      canvas,
      preRun: [],
      postRun: [],
      print: t => console.log(t),
      printErr: t => console.warn(t),
      setStatus: t => { if (t) status(t.replace(/\(\d+\/\d+\)/, '').trim() || 'Starting ScummVM…'); },
      retroFS: FS => {
        const root = '/games/' + game.id;
        FS.mkdirTree(root);
        for (const [name, contents] of files) {
          const p = root + '/' + name;
          FS.mkdirTree(p.slice(0, p.lastIndexOf('/')));
          FS.writeFile(p, contents);
        }
        files.clear();
      },
      onRuntimeInitialized: () => status(''),
    };
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); fail('The graphics context was lost. Exit and press Play again.'); });
    const s = document.createElement('script');
    s.src = new URL('scummvm.js', base).href;
    s.onerror = () => fail('The ScummVM engine did not load. Please try again later.');
    document.body.append(s);
    buildKeys();
    canvas.focus();
  } catch (e) {
    fail(e.message || String(e));
  }
}

if (typeof document !== 'undefined' && document.getElementById('canvas')) start();
