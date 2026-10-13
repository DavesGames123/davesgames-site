// ============================================================================
//  RETRO SHELF  ·  node tests  (node tests.mjs)
// ----------------------------------------------------------------------------
//  Checks, with no browser (headless browsers are not used on this site):
//    licence.  every game: a pin in vendor/retro/retro.lock.json with the
//              same sha256 and size, a row in LICENSES.md (archive name and
//              full sha256), terms, licence file and source; every "file"
//              pin is a shelf game; engines and cores have a licence and a
//              source commit or tag; LICENSES.md lists the games left out
//    nocomm.   no commercial title in the page files; no ROM, disc image
//              or BIOS file in the page or the vendor folders
//    pins.     the ScummVM build matches build/SHA256SUMS; the fetched
//              files (when tools/retro-fetch.mjs has run) match their pins
//    unpack.   unzip.js on every fetched archive: DOOM 1.9 gives the known
//              DOOM1.WAD (sha256 1d7d43be…), the licence file named in
//              games.json is in each archive, the ScummVM path has files
//    dos.      dosboxConf / doomCfg agree on the Sound Blaster; every pad
//              and gamepad key has a DOSBox code
//    emu.      ejsConfig picks the exact core; cdn.emulatorjs.org is
//              refused; each core has its .data files and report
//    page.     head order (gpu-guard, wishlist, stats-beacon), [hidden]
//              rule in both stylesheets, overflow-x on html only, every
//              $('id') of each script is in its html, every module links
//              (a ReferenceError on a browser global is correct, a
//              SyntaxError is a bug)
//    saver.    planReel: every game before a repeat, no game twice in a
//              row, 6..12 s, seeds differ
//    boot.     main.js and saver.js in a linkedom DOM: the shelf, credits
//              and system list fill; a card opens the player iframe; Exit
//              removes it; a wrong file type keeps Play off; the saver
//              enters with a canvas in the document and exits. Skipped
//              when linkedom is not found (set LINKEDOM).
//  Exit code 1 on any failure.
// ============================================================================
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zipAll } from './unzip.js';
import { DOS_KEYS, dosboxConf, doomCfg, unpackDos } from './play-dos.js';
import { scummArgs, dataUrl } from './play-scummvm.js';
import { ejsConfig, blockedUrl } from './play-emu.js';
import { planReel } from './saver.js';
import { playerUrl, extOk, fmtMB } from './main.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SN = join(HERE, '..', '..');
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };
const mark = () => ({ p: pass, f: fail });
const group = (name, m) => console.log(`${name.padEnd(10)} ${pass - m.p} pass, ${fail - m.f} fail`);
const read = p => readFileSync(join(HERE, p));
const sha = b => createHash('sha256').update(b).digest('hex');
const data = JSON.parse(read('games.json'));
const lock = JSON.parse(readFileSync(join(SN, 'vendor', 'retro', 'retro.lock.json')));
const FETCHED = join(SN, '..', lock.out);
const haveFetched = existsSync(join(FETCHED, 'games'));
const licences = read('LICENSES.md').toString();

// ------------------------------------------------------------------ licence
{
  const m = mark();
  ok(data.games.length >= 5, 'licence: at least 5 games');
  const ids = new Set();
  for (const g of data.games) {
    ok(!ids.has(g.id), 'licence: unique id ' + g.id); ids.add(g.id);
    const pin = lock.items[g.lock];
    ok(pin && pin.kind === 'file', `licence: ${g.id} has a file pin`);
    ok(pin && pin.sha256 === g.sha256 && pin.bytes === g.bytes, `licence: ${g.id} sha256 and size equal the pin`);
    ok(pin && pin.path === g.file, `licence: ${g.id} file path equals the pin`);
    const name = g.file.split('/').pop();
    ok(licences.includes('`' + name + '` (`' + g.sha256 + '`)'), `licence: LICENSES.md row for ${name} with its full sha256`);
    ok(g.licence && g.licenceFile && /^https:\/\//.test(g.source), `licence: terms, licence file and source of ${g.id}`);
    ok(g.title && g.maker && g.year > 1980 && g.year < 2000 && g.blurb && g.controls && /^#[0-9a-f]{6}$/i.test(g.accent), `licence: text fields of ${g.id}`);
    ok(['dos', 'scummvm'].includes(g.engine) && data.engines.some(e => e.id === g.engine), `licence: engine of ${g.id}`);
  }
  for (const [id, pin] of Object.entries(lock.items)) {
    if (pin.kind === 'file') ok(data.games.some(g => g.lock === id), `licence: pin ${id} is a shelf game`);
    else ok(data.engines.some(e => e.lock === id) || data.systems.some(s => s.lock === id), `licence: pin ${id} is an engine or a core`);
    if (pin.kind === 'tgz') ok(/^https:\/\/github\.com\/.+\/tree\/[0-9a-f]{40}$/.test(pin.source) && pin.license, `licence: ${id} has a licence and a source commit`);
  }
  for (const e of data.engines) ok(e.licence && /^https:\/\/github\.com\//.test(e.source), `licence: engine ${e.id} licence and source`);
  for (const s of data.systems) ok(/GPL|MPL/.test(s.licence) && /tree\/[0-9a-f]{40}$/.test(s.source) && licences.includes(s.source), `licence: core ${s.core} licence and source in LICENSES.md`);
  for (const out of ['Quake', 'Wolfenstein 3D', 'Commander Keen', 'Cave Story', 'God of Thunder', 'DreamWeb']) ok(licences.includes('| ' + out), `licence: LICENSES.md says why ${out} is left out`);
  group('licence.', m);
}

// ------------------------------------------------------------------- nocomm
{
  const m = mark();
  const COMMERCIAL = /grand theft|\bgta\b|crash bandicoot|final fantasy|metal gear|super mario|\bzelda\b|pok[eé]mon|sonic the|resident evil|gran turismo|tekken|spyro|tony hawk|halo\b|call of duty|\bfifa\b|street fighter|mortal kombat/i;
  const files = readdirSync(HERE).filter(f => /\.(html|js|json|css)$/.test(f));
  for (const f of files) ok(!COMMERCIAL.test(read(f).toString()), `nocomm: no commercial title in ${f}`);
  const BAD = /\.(iso|bin|cue|chd|pbp|rom|z64|n64|v64|nes|sfc|smc|gba|gbc|gb|smd|gen|img|bios)$/i;
  const walk = d => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
  for (const d of [HERE, join(SN, 'vendor', 'scummvm-web@2026.4.0')]) for (const p of walk(d)) ok(!BAD.test(p), `nocomm: no ROM, disc or BIOS file: ${p}`);
  if (existsSync(FETCHED)) for (const p of walk(FETCHED)) ok(!BAD.test(p), `nocomm: no ROM, disc or BIOS file fetched: ${p}`);
  ok(data.systems.every(s => s.bios !== 'required'), 'nocomm: no offered system needs a BIOS that we would have to host');
  group('nocomm.', m);
}

// --------------------------------------------------------------------- pins
{
  const m = mark();
  const V = join(SN, 'vendor', 'scummvm-web@2026.4.0');
  const sums = readFileSync(join(V, 'build', 'SHA256SUMS'), 'utf8').trim().split('\n');
  ok(sums.length >= 7, 'pins: SHA256SUMS lists the build');
  for (const line of sums) { const [h, f] = line.split(/\s+/); ok(sha(readFileSync(join(V, f))) === h, `pins: ${f} matches SHA256SUMS`); }
  const idx = JSON.parse(readFileSync(join(V, 'data', 'index.json')));
  for (const [f, n] of Object.entries(idx)) ok(statSync(join(V, 'data', f)).size === n, `pins: data/index.json size of ${f}`);
  ok(readFileSync(join(V, 'scummvm.js'), 'utf8').includes('retroFS'), 'pins: the build has the retro-pre.js hook');
  if (haveFetched) {
    for (const [id, pin] of Object.entries(lock.items)) {
      if (pin.kind === 'file') ok(sha(readFileSync(join(FETCHED, pin.path))) === pin.sha256, `pins: fetched ${id} sha256`);
      else ok(readFileSync(join(FETCHED, pin.dir, '.retro-' + (pin.stamp || id)), 'utf8').trim() === pin.sha256, `pins: fetched ${id} stamp`);
    }
  } else console.log('pins.      fetched files skipped (run node tools/retro-fetch.mjs)');
  group('pins.', m);
}

// ------------------------------------------------------------------- unpack
if (haveFetched) {
  const m = mark();
  for (const g of data.games) {
    const bytes = new Uint8Array(readFileSync(join(FETCHED, g.file)));
    const files = await zipAll(bytes);
    if (g.engine === 'dos') {
      const out = await unpackDos(g, bytes);
      const wad = out.find(f => f.path === 'DOOM/DOOM1.WAD');
      ok(wad && sha(wad.contents) === '1d7d43be501e67d927e415e0b8f3e29c3bf33075e859721816f652a526cac771', 'unpack: DOOM1.WAD is the v1.9 shareware WAD');
      ok(out.some(f => f.path === 'DOOM/' + g.dos.exe), 'unpack: DOOM.EXE is there');
      ok(out.some(f => f.path === 'DOOM/README.TXT') && files.has('DOOMS_19.DAT'), 'unpack: the DOOM terms (DOOMS_19.DAT, README.TXT) are in the archive');
      const dat = new TextDecoder('latin1').decode(files.get('DOOMS_19.DAT'));
      ok(/SHAREWARE VERSION/.test(dat) && /PLEASE DISTRIBUTE!!!/.test(dat), 'unpack: DOOMS_19.DAT says SHAREWARE VERSION / PLEASE DISTRIBUTE!!!');
    } else {
      ok(files.has(g.licenceFile), `unpack: ${g.licenceFile} is in ${g.file}`);
      const lic = new TextDecoder('latin1').decode(files.get(g.licenceFile) || new Uint8Array());
      ok(/distribute (this game|"DRASCULA") for free on any medium/.test(lic), `unpack: ${g.id} licence permits free distribution`);
      const root = g.root ? g.root + '/' : '';
      ok([...files.keys()].filter(n => n.startsWith(root) && !n.slice(root.length).includes('/')).length >= 2, `unpack: ${g.id} has game files at ${root || '/'}`);
      ok(scummArgs(g)[0] === '--path=/games/' + g.id + (g.root ? '/' + g.root : ''), `unpack: ScummVM path of ${g.id}`);
    }
  }
  group('unpack.', m);
} else console.log('unpack.    skipped (run node tools/retro-fetch.mjs)');

// ---------------------------------------------------------------------- dos
{
  const m = mark();
  const g = data.games.find(x => x.engine === 'dos');
  const conf = dosboxConf(g);
  ok(/\[autoexec\][\s\S]*mount c \.\nc:\ncd DOOM\nDOOM\.EXE/.test(conf), 'dos: autoexec mounts C: and starts DOOM.EXE');
  const cfg = doomCfg();
  const irq = /irq=(\d+)/.exec(conf)[1], dma = /\ndma=(\d+)/.exec(conf)[1], base = parseInt(/sbbase=(\w+)/.exec(conf)[1], 16);
  ok(cfg.includes('snd_sbirq\t\t' + irq) && cfg.includes('snd_sbdma\t\t' + dma) && cfg.includes('snd_sbport\t\t' + base), 'dos: DEFAULT.CFG and dosbox.conf agree on the Sound Blaster');
  ok(cfg.includes('use_mouse\t\t0') && cfg.endsWith('\r\n'), 'dos: mouse off, DOS line ends');
  for (const [, code] of g.pad) ok(code in DOS_KEYS, `dos: pad key ${code} has a DOSBox code`);
  for (const code of Object.values(g.gamepad)) ok(code in DOS_KEYS, `dos: gamepad key ${code} has a DOSBox code`);
  ok(DOS_KEYS.KeyA === 65 && DOS_KEYS.F1 === 290 && DOS_KEYS.F12 === 301 && DOS_KEYS.ArrowUp === 265 && DOS_KEYS.Escape === 256, 'dos: key codes follow js-dos (GLFW)');
  group('dos.', m);
}

// ---------------------------------------------------------------------- emu
{
  const m = mark();
  for (const s of data.systems) {
    const c = ejsConfig(s, 'x/', { name: 'My Game.bin' }, null);
    ok(c.EJS_core === s.core && c.EJS_gameName === 'My Game' && c.EJS_disableDatabases === true && c.EJS_CacheLimit === 0, `emu: config of ${s.id}`);
    ok(extOk('a' + s.ext[0].toUpperCase(), s) && !extOk('a.exe', s), `emu: file types of ${s.id}`);
    if (haveFetched) {
      const d = join(FETCHED, 'emulatorjs-4.2.3', 'data', 'cores');
      ok(existsSync(join(d, s.core + '-wasm.data')) && existsSync(join(d, s.core + '-legacy-wasm.data')) && existsSync(join(d, 'reports', s.core + '.json')), `emu: core files of ${s.core}`);
    }
  }
  ok(blockedUrl('https://cdn.emulatorjs.org/stable/data/version.json') && blockedUrl('https://netplay.emulatorjs.org/') && !blockedUrl('../../vendor/retro/fetched/x'), 'emu: emulatorjs.org is refused, local files are not');
  ok(dataUrl('/data/index.json', 'https://h/v/') === 'https://h/v/data/index.json' && dataUrl('x', 'https://h/') === null, 'emu: ScummVM /data maps to the vendor folder');
  if (haveFetched) ok(existsSync(join(FETCHED, 'emulatorjs-4.2.3', 'data', 'loader.js')) && existsSync(join(FETCHED, 'emulators-8.5.2', 'wdosbox.wasm')), 'emu: loader.js and wdosbox.wasm fetched');
  group('emu.', m);
}

// --------------------------------------------------------------------- page
{
  const m = mark();
  const html = read('index.html').toString();
  const heads = [...html.matchAll(/<script src="([^"]+)"/g)].map(x => x[1]);
  ok(heads[0] === '../../lib/gpu-guard.js' && heads[1] === '../../lib/wishlist.js' && heads[2] === '../../lib/stats-beacon.js', 'page: head order gpu-guard, wishlist, stats-beacon');
  ok(html.indexOf('stats-beacon.js') < html.indexOf('<meta charset'), 'page: site scripts come first in the head');
  for (const css of ['style.css', 'player.css']) {
    const t = read(css).toString();
    ok(t.includes('[hidden]{display:none!important}'), `page: [hidden] rule in ${css}`);
    ok(!/body\{[^}]*overflow-x/.test(t), `page: no overflow-x on body in ${css}`);
  }
  const pairs = [['main.js', 'index.html'], ['play-dos.js', 'play-dos.html'], ['play-scummvm.js', 'play-scummvm.html'], ['play-emu.js', 'play-emu.html'], ['player-common.js', 'play-dos.html']];
  for (const [js, h] of pairs) {
    const src = read(js).toString(), doc = read(h).toString();
    const ids = new Set([...src.matchAll(/(?:\$|getElementById)\('([A-Za-z0-9_-]+)'\)/g)].map(x => x[1]));
    for (const id of ids) ok(doc.includes(`id="${id}"`), `page: #${id} of ${js} is in ${h}`);
  }
  for (const h of ['play-dos.html', 'play-scummvm.html', 'play-emu.html']) ok(read(h).toString().includes('player.css'), `page: ${h} uses player.css`);
  for (const g of data.games) ok(/^play-(dos|scummvm)\.html\?game=/.test(playerUrl(g)), `page: player URL of ${g.id}`);
  ok(fmtMB(2450688) === '2.3 MB' && fmtMB(32842993) === '31 MB', 'page: fmtMB');
  for (const f of ['main.js', 'saver.js', 'play-dos.js', 'play-scummvm.js', 'play-emu.js', 'player-common.js', 'unzip.js']) {
    let err = null;
    try { await import(pathToFileURL(join(HERE, f)).href + '?link'); } catch (e) { err = e; }
    ok(!err || err instanceof ReferenceError, `page: ${f} links (${err ? err.name + ': ' + err.message : 'ok'})`);
  }
  group('page.', m);
}

// -------------------------------------------------------------------- saver
{
  const m = mark();
  const ids = data.games.map(g => g.id);
  const reel = planReel(ids, 42, 3);
  ok(reel.length === ids.length * 3, 'saver: three rounds');
  ok(new Set(reel.slice(0, ids.length).map(s => s.id)).size === ids.length, 'saver: every game before a repeat');
  ok(reel.every((s, i) => i === 0 || s.id !== reel[i - 1].id), 'saver: no game twice in a row');
  ok(reel.every(s => s.secs >= 6 && s.secs <= 12), 'saver: 6..12 s a shot');
  ok(planReel(ids, 1).map(s => s.id).join() !== planReel(ids, 2).map(s => s.id).join(), 'saver: seeds differ');
  group('saver.', m);
}

// --------------------------------------------------------------------- boot
await bootTest();
async function bootTest() {
  const m = mark();
  const cands = [process.env.LINKEDOM, '/usr/local/lib/node_modules/openclaw/node_modules/linkedom/esm/index.js'].filter(Boolean);
  const lp = cands.find(p => existsSync(p));
  if (!lp) { console.log('boot.      skipped: linkedom not found (set LINKEDOM)'); return; }
  const { parseHTML } = await import(pathToFileURL(lp).href);
  const { window, document } = parseHTML(read('index.html').toString());
  const ctx2d = () => new Proxy({ measureText: t => ({ width: String(t).length * 8 }) }, { get: (o, k) => (k in o ? o[k] : () => {}), set: () => true });
  const raf = [];
  Object.assign(globalThis, { window, document, requestAnimationFrame: f => { raf.push(f); return raf.length; }, cancelAnimationFrame: () => {}, innerWidth: 390, innerHeight: 800,
    matchMedia: () => ({ matches: false, addEventListener() {} }) });
  window.matchMedia = globalThis.matchMedia;
  window.innerWidth = 390; window.innerHeight = 800;
  Object.defineProperty(globalThis, 'location', { value: { origin: 'https://davesgames.io', search: '' }, configurable: true });
  const proto = Object.getPrototypeOf(document.createElement('canvas'));
  proto.getContext = function () { return (this.__c ||= ctx2d()); };
  globalThis.fetch = async u => { const b = readFileSync(fileURLToPath(String(u))); return { ok: true, status: 200, json: async () => JSON.parse(b) }; };
  const errors = [];
  try {
    await import(pathToFileURL(join(HERE, 'main.js')).href + '?boot');
    await import(pathToFileURL(join(HERE, 'saver.js')).href + '?boot');
    for (let i = 0; i < 20 && !document.querySelector('#shelf .card'); i++) await new Promise(r => setTimeout(r, 5));
    ok(document.querySelectorAll('#shelf .card').length === data.games.length, 'boot: the shelf has every game');
    ok(document.querySelectorAll('#gameRows tr').length === data.games.length && document.querySelectorAll('#engineRows tr').length === data.engines.length && document.querySelectorAll('#coreRows tr').length === data.systems.length, 'boot: the credit tables fill (' + ['gameRows', 'engineRows', 'coreRows'].map(id => document.querySelectorAll('#' + id + ' tr').length).join('/') + ')');
    ok(document.querySelectorAll('#sys input[type=radio]').length === data.systems.length, 'boot: the system list fills');
    ok(document.getElementById('touchNote').hasAttribute('hidden'), 'boot: the touch note stays hidden with a fine pointer');
    document.querySelector('#shelf .card .open').dispatchEvent(new window.Event('click'));
    const f = document.querySelector('#playerStage iframe');
    ok(f && f.getAttribute('src') === 'play-dos.html?game=doom' && !document.getElementById('player').hasAttribute('hidden'), 'boot: a card opens the player iframe');
    ok(f && /fullscreen/.test(f.getAttribute('allow')) && /gamepad/.test(f.getAttribute('allow')), 'boot: the iframe may use full screen and gamepads');
    document.getElementById('exitBtn').dispatchEvent(new window.Event('click'));
    ok(!document.querySelector('#playerStage iframe') && document.getElementById('player').hasAttribute('hidden'), 'boot: Exit removes the iframe (' + !!document.querySelector('#playerStage iframe') + ' ' + document.getElementById('player').hasAttribute('hidden') + ')');
    const rom = document.getElementById('romFile');
    Object.defineProperty(rom, 'files', { value: [{ name: 'game.exe', size: 1000 }], configurable: true });
    rom.dispatchEvent(new window.Event('change'));
    ok(document.getElementById('byoPlay').disabled, 'boot: a wrong file type keeps Play off');
    Object.defineProperty(rom, 'files', { value: [{ name: 'game.cue', size: 1000 }], configurable: true });
    rom.dispatchEvent(new window.Event('change'));
    ok(document.getElementById('byoPlay').disabled, 'boot: Play stays off until the owner box is ticked');
    const own = document.getElementById('own'); own.checked = true; own.dispatchEvent(new window.Event('change'));
    ok(!document.getElementById('byoPlay').disabled, 'boot: a PlayStation .cue and the owner box turn Play on');
    const res = window.snSaver.enter({ seed: 7, calm: 0.5 });
    ok(res && res.canvas && document.body.contains(res.canvas) && res.warmupMs > 0, 'boot: saver returns a canvas in the document');
    for (let i = 0; i < 10; i++) { await new Promise(r => setTimeout(r, 2)); for (const fn of raf.splice(0)) { try { fn(2000 + i * 16); } catch (e) { errors.push(e.message); } } }
    window.snSaver.exit();
    ok(!document.body.contains(res.canvas), 'boot: saver exit removes its canvas');
  } catch (e) { errors.push(e.stack || e.message); }
  ok(errors.length === 0, 'boot: no errors (' + errors.join(' | ') + ')');
  group('boot.', m);
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
