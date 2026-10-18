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
//    saver.    planTour, per seed: every game once a round, no game twice
//              in a row, the six beats in order (pick, plugin, poweron,
//              tour, poweroff, eject), 8..15 s a beat; the CRT power
//              curve and crtState per beat; frameFit and the desk camera
//              keep the subject in the plate band at 16:9 and 9:16; the
//              plate fields (title, year and maker, licence kind from
//              LICENSES.md, no code); the desk choreography; no fetch to
//              another origin; no game art or commercial asset path
//    shelf.    shelf-art.js: a cover palette per game (own colour, ink
//              4.5:1 on the cover), seeded box poses, spine titles, one
//              shelf per engine, the layout breakpoints (two boxes on a
//              375 px phone, six in one row from 1024 px), disc or cart
//              per system; reduced motion and focus rules in style.css
//    boot.     main.js and saver.js in a linkedom DOM: the bookcase, credits
//              and system list fill; a box opens the pull-out and puts
//              itself back; Play in the pull-out opens the player; Exit
//              removes it; a wrong file type keeps Play off; the saver
//              enters with a canvas in the document, runs its plan (the
//              2D path: node has no WebGL) and exits. Skipped
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
import { planTour, BEATS, TOUR_MOVES, crtPower, crtState, locate, shotLabel, licenceKind, mediaOf, frameFit, fovFor, beatPose, blendPose, poseEye, span, sameOrigin } from './saver-plan.js';
import { norm, hasGlyph } from './saver-card.js';
import { THREE_URL } from './saver.js';
import { playerUrl, extOk, fmtMB } from './main.js';
import { coverPalette, contrast, shelfGroups, shelfLayout, shelfRoom, LAYOUTS, boxPose, spineTitle, systemMedia, platformBand } from './shelf-art.js';

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
  for (const f of ['main.js', 'shelf-art.js', 'saver.js', 'saver-plan.js', 'saver-card.js', 'saver-desk.js', 'play-dos.js', 'play-scummvm.js', 'play-emu.js', 'player-common.js', 'unzip.js']) {
    let err = null;
    try { await import(pathToFileURL(join(HERE, f)).href + '?link'); } catch (e) { err = e; }
    ok(!err || err instanceof ReferenceError, `page: ${f} links (${err ? err.name + ': ' + err.message : 'ok'})`);
  }
  group('page.', m);
}

// -------------------------------------------------------------------- saver
{
  const m = mark();
  const ids = data.games.map(g => g.id), N = ids.length, KINDS = BEATS.map(b => b.kind).join();
  ok(KINDS === 'pick,plugin,poweron,tour,poweroff,eject', 'saver: the beat order is pick, plugin, poweron, tour, poweroff, eject');
  for (const seed of [1, 7, 42, 9001, 0xdeadbeef]) {
    const plan = planTour(ids, seed, { rounds: 3, calm: seed % 2 ? 0.2 : 0.9 });
    ok(plan.length === N * 3, `saver: seed ${seed}: three rounds`);
    let rounds = true, order = true, secs = true, moves = true;
    for (let k = 0; k < 3; k++) {
      const r = plan.slice(k * N, k * N + N).map(s => s.id);
      if (new Set(r).size !== N || !ids.every(id => r.includes(id))) rounds = false;
    }
    for (const s of plan) {
      if (s.beats.map(b => b.kind).join() !== KINDS) order = false;
      if (!s.beats.every(b => b.secs >= 8 && b.secs <= 15)) secs = false;
      if (!TOUR_MOVES.includes(s.beats[3].move)) moves = false;
    }
    ok(rounds, `saver: seed ${seed}: every game once a round, no repeat until all have played`);
    ok(plan.every((s, i) => i === 0 || s.id !== plan[i - 1].id), `saver: seed ${seed}: no game twice in a row`);
    ok(order, `saver: seed ${seed}: each game runs the six beats in order`);
    ok(secs, `saver: seed ${seed}: 8..15 s a beat`);
    ok(moves && plan.every((s, i) => i === 0 || s.beats[3].move !== plan[i - 1].beats[3].move), `saver: seed ${seed}: a tour move each game, not the last one`);
    // locate walks the beats in order
    const sh = plan[0], t = sh.beats[0].secs + sh.beats[1].secs + 1;
    const L = locate(plan, t);
    ok(L.si === 0 && L.bi === 2 && Math.abs(L.tb - 1) < 1e-9, `saver: seed ${seed}: locate finds beat 3 at ${t.toFixed(1)} s`);
  }
  ok(planTour(ids, 1).map(s => s.id).join() !== planTour(ids, 2).map(s => s.id).join(), 'saver: seeds differ');
  ok(planTour(ids, 5).map(s => s.id).join() === planTour(ids, 5).map(s => s.id).join(), 'saver: one seed, one plan');
  // the CRT
  const on = [0, 0.1, 0.4, 0.9, 2].map(u => crtPower('on', u)), off = [0, 0.1, 0.3, 1, 3].map(u => crtPower('off', u));
  ok(on[0].bright === 0 && on[1].sx < 0.05 && on[1].sy < 0.05 && on[2].sy < 0.05 && on[2].sx > 0.1 && on[4].sx === 1 && on[4].sy === 1, 'saver: power on goes dot, line, full picture');
  ok(off[0].sy === 1 && off[1].sy < 1 && off[2].sx < 1 && off[3].sx < 0.05 && off[4].bright === 0, 'saver: power off goes line, dot, dark');
  {
    const s = planTour(ids, 3)[0], b = k => s.beats.findIndex(x => x.kind === k);
    ok(crtState(s, b('pick'), 3).pw === null && crtState(s, b('plugin'), 3).pw === null && crtState(s, b('eject'), 3).pw === null, 'saver: the CRT is off in pick, plugin and eject');
    ok(crtState(s, b('poweron'), 0.1).pw.bright === 0 && crtState(s, b('poweron'), s.beats[b('poweron')].secs - 0.01).pw.sy === 1, 'saver: the CRT comes on in the poweron beat');
    const endOn = crtState(s, b('poweron'), s.beats[b('poweron')].secs).at, startTour = crtState(s, b('tour'), 0).at;
    ok(Math.abs(endOn - startTour) < 1e-6, 'saver: the attract screen runs on from poweron into tour');
    ok(crtState(s, b('poweroff'), s.beats[b('poweroff')].secs - 0.01).pw.bright < 0.05, 'saver: the CRT is dark at the end of poweroff');
  }
  // plate band framing, pure
  for (const [w, h] of [[1920, 1080], [1080, 1920], [390, 844]]) {
    for (const band of [null, { t: h * 0.24, b: h * 0.22 }]) {
      const fov = fovFor(w, h), f = frameFit(w, h, band, fov, 0.25);
      const ch = h - (band ? band.t + band.b : 0), tv = Math.tan(fov * Math.PI / 360);
      const pxR = 0.25 / f.dist / tv * (h / 2);
      ok(pxR <= ch / 2 + 1e-6 && pxR * 1 <= w / 2 + 1e-6, `saver: frameFit ${w}x${h} ${band ? 'band' : 'no band'}: the subject (${pxR.toFixed(0)} px) fits the band (${ch.toFixed(0)} px) and the width`);
      ok(Math.abs(h / 2 - f.offY - f.cy) < 1e-9 && Math.abs(f.cy - ((band ? band.t : 0) + ch / 2)) < 1e-9, `saver: frameFit ${w}x${h}: the view offset puts the band centre on the subject`);
    }
  }
  // the plate
  for (const g of data.games) {
    const row = licences.split('\n').find(l => l.includes('`' + g.file.split('/').pop() + '`')) || '';
    ok((licenceKind(g) === 'Shareware') === /shareware/i.test(row) && row.length > 0, `saver: licence kind of ${g.id} (${licenceKind(g)}) agrees with LICENSES.md`);
    ok(g.saver && ['floppy', 'cd'].includes(g.saver.media) && g.saver.genre && g.saver.motif && mediaOf(g) === g.saver.media, `saver: games.json saver fields of ${g.id}`);
    for (const k of BEATS.map(b => b.kind)) {
      const l = shotLabel(g, k);
      ok(l.title === g.title && l.sub.includes(String(g.year)) && l.sub.includes(g.maker) && l.lines.length === 2 && l.lines[0].startsWith(licenceKind(g)) && l.lines[1].length > 8 && l.lines[1].length < 120 && !('code' in l) && !('tex' in l), `saver: plate of ${g.id} ${k}: title, year and maker, licence, a one-line note, no code`);
    }
    const text = norm(g.title + g.maker + g.year + g.sub + g.saver.genre + 'PRESS ANY KEY FREEWARE SHAREWARE');
    ok([...text].every(hasGlyph), `saver: the bitmap font has every letter of ${g.id} (${[...text].filter(c => !hasGlyph(c)).join('')})`);
  }
  // the sources: no other origin, no game art, three from the vendor folder
  const SAVER = ['saver.js', 'saver-plan.js', 'saver-card.js', 'saver-desk.js'];
  for (const f of SAVER) {
    const src = read(f).toString();
    ok(!/https?:\/\//.test(src.replace(/^\s*\/\/.*$/gm, '')), `saver: ${f} names no absolute URL`);
    ok(!/\.(png|jpe?g|gif|webp|avif|mp4|webm|ogv|iso|bin|cue|rom|wad|zip)\b['"`]/i.test(src), `saver: ${f} loads no image, video, disc or game file`);
    ok(!/fetched\/|vendor\/retro/.test(src), `saver: ${f} reads nothing from the fetched games`);
    const fetches = [...src.matchAll(/fetch\(([^)]*)\)/g)].map(x => x[1]);
    ok(fetches.every(a => /^u$/.test(a.trim())) && (f !== 'saver.js' || /new URL\('games\.json', import\.meta\.url\)/.test(src)), `saver: ${f} fetches only games.json (${fetches.join(' | ') || 'none'})`);
  }
  ok(sameOrigin('games.json', 'https://davesgames.io/stella-nova/pages/retro-shelf/saver.js') && !sameOrigin('https://example.com/x.png', 'https://davesgames.io/a/'), 'saver: sameOrigin');
  ok(/^\.\.\/\.\.\/vendor\/three@0\.160\.0\//.test(THREE_URL) && existsSync(join(HERE, THREE_URL)), 'saver: three r160 comes from the vendor folder');
  // the desk: choreography and camera, with three in node (no WebGL)
  const THREE = await import(pathToFileURL(join(HERE, THREE_URL)).href);
  const { buildDesk } = await import('./saver-desk.js');
  const ctx = () => new Proxy({ measureText: t => ({ width: String(t).length * 8 }) }, { get: (o, k) => (k in o ? o[k] : (k === 'createImageData' || k === 'createRadialGradient' || k === 'arc') ? undefined : () => {}), set: () => true });
  const mk = (w, h) => { const c = ctx(); return { width: w, height: h, getContext: () => c }; };
  const desk = buildDesk(THREE, data.games, { mk, coarse: true, tex: cv => { const t = new THREE.Texture(); t.image = cv; return t; } });
  const rack = desk.parts.rack.boxes;
  ok(rack.size === N, 'saver: the rack holds one box per game');
  const cam = new THREE.PerspectiveCamera(34, 1, 0.01, 20), v = new THREE.Vector3();
  let inBand = true, worst = '';
  for (const s of planTour(ids, 11, { rounds: 1 })) {
    const g = data.games.find(x => x.id === s.id), isCd = mediaOf(g) === 'cd', media = isCd ? desk.parts.cd : desk.parts.floppy;
    desk.pose(g, 'pick', 0, 9);
    ok(rack.get(g.id).mesh.position.distanceTo(rack.get(g.id).home) < 1e-6 && !media.visible, `saver: ${g.id} pick starts with the box in the rack`);
    desk.pose(g, 'pick', 1, 9);
    ok(rack.get(g.id).mesh.position.distanceTo(rack.get(g.id).home) > 0.2, `saver: ${g.id} pick ends with the box out on the desk`);
    desk.pose(g, 'plugin', 1, 12);
    const P = desk.points(g), drv = new THREE.Vector3(...P.drive), port = new THREE.Vector3(...P.port);
    ok(media.visible && media.position.distanceTo(drv) < 0.12 && media.position.z < 0.02, `saver: ${g.id} plugin ends with the ${isCd ? 'CD' : 'disk'} in the drive`);
    ok(desk.parts.stick.plug.position.distanceTo(port) < 0.04, `saver: ${g.id} plugin ends with the plug in the game port`);
    ok(desk.parts.pc.pLed.material.emissiveIntensity > 0, `saver: ${g.id} the power LED is on after the plug click`);
    const clicks = [0.6, 0.64, 0.88].map(u => desk.pose(g, 'plugin', u + 0.005, 12).click);
    ok(clicks.some(c => c > 0.5), `saver: ${g.id} plugin has a click`);
    desk.pose(g, 'eject', 1, 11);
    ok(rack.get(g.id).mesh.position.distanceTo(rack.get(g.id).home) < 1e-6 && !media.visible, `saver: ${g.id} eject ends with the media in the box and the box in the rack`);
    ok(desk.parts.stick.plug.position.distanceTo(port) > 0.1 && desk.parts.pc.pLed.material.emissiveIntensity === 0, `saver: ${g.id} eject ends with the plug out and the power LED off`);
    // the camera: the pose target stays inside the plate band at 16:9 and 9:16
    for (const [w, h] of [[1920, 1080], [1080, 1920]]) {
      const band = { t: h * 0.24, b: h * 0.22 };
      let last = null;
      for (const b of s.beats) for (const u of [0, 0.25, 0.5, 0.75, 1]) {
        desk.pose(g, b.kind, u, b.secs);
        const tp = beatPose(b, u, desk.points(g)), pose = u === 0 && last ? last : blendPose(last || tp, tp, span(u, 0, 0.32));
        if (u === 1) last = pose;
        const fov = fovFor(w, h), f = frameFit(w, h, band, fov, pose.R), eye = poseEye(pose, f.dist);
        cam.fov = fov; cam.aspect = w / h; cam.position.set(...eye); cam.lookAt(...pose.target); cam.setViewOffset(w, h, 0, f.offY, w, h); cam.updateProjectionMatrix(); cam.updateMatrixWorld();
        v.set(...pose.target).project(cam);
        const px = (v.x * 0.5 + 0.5) * w, py = (1 - (v.y * 0.5 + 0.5)) * h;
        if (!(px > w * 0.3 && px < w * 0.7 && py > band.t && py < h - band.b)) { inBand = false; worst = `${g.id} ${b.kind} u=${u} ${w}x${h}: ${px.toFixed(0)},${py.toFixed(0)}`; }
        if (eye[1] < 0.02 || eye[2] < -0.4) { inBand = false; worst = `${g.id} ${b.kind} u=${u}: the eye is under the desk or in the wall`; }
      }
    }
  }
  ok(inBand, 'saver: every beat aims the camera at its subject inside the plate band, 16:9 and 9:16 ' + worst);
  desk.dispose();
  group('saver.', m);
}

// -------------------------------------------------------------------- shelf
{
  const m = mark();
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  for (const g of data.games) {
    const p = coverPalette(g);
    ok(['accent', 'base', 'dark', 'light', 'ink'].every(k => /^#[0-9a-f]{6}$/.test(p[k])), `shelf: ${g.id} palette has five hex colours`);
    ok(contrast(rgb(p.ink), rgb(p.base)) >= 4.5, `shelf: ${g.id} ink on base is 4.5:1 or more (${contrast(rgb(p.ink), rgb(p.base)).toFixed(2)})`);
    ok(p.accent === g.accent.toLowerCase(), `shelf: ${g.id} palette keeps the accent`);
    const q = boxPose(g.id);
    ok(q.ry >= 18 && q.ry <= 31 && q.dz >= 0 && q.dz <= 8 && JSON.stringify(q) === JSON.stringify(boxPose(g.id)), `shelf: ${g.id} pose in range and the same each time (${q.ry}, ${q.dz})`);
    ok(spineTitle(g).length > 0 && !spineTitle(g).includes(':'), `shelf: ${g.id} spine title "${spineTitle(g)}"`);
    ok(/^PC {2}· {2}(DOSBOX|SCUMMVM)$/.test(platformBand(g)) && [...norm(platformBand(g))].every(hasGlyph), `shelf: ${g.id} band "${platformBand(g)}" has glyphs`);
  }
  ok(new Set(data.games.map(g => coverPalette(g).base)).size === data.games.length, 'shelf: each game has its own cover colour');
  ok(spineTitle({ title: 'Drascula: The Vampire Strikes Back' }) === 'Drascula', 'shelf: spineTitle cuts at the colon');
  const groups = shelfGroups(data.games);
  ok(groups.map(x => x.id).join() === 'dos,scummvm' && groups.reduce((n, x) => n + x.games.length, 0) === data.games.length, 'shelf: one shelf per engine, every game once');
  ok(groups.every(x => x.label && x.engine), 'shelf: every shelf has a label and an engine name');
  ok(shelfLayout(320).name === 'phone' && shelfLayout(390).mode === 'scroll' && shelfLayout(600).name === 'tablet' && shelfLayout(1100).mode === 'row' && shelfLayout(1600).name === 'wide', 'shelf: layout breakpoints');
  ok(shelfLayout(1023).mode === 'scroll' && shelfLayout(1024).mode === 'row', 'shelf: the row mode starts at 1024 px');
  ok(shelfLayout(NaN).name === 'phone' && shelfLayout(-5).name === 'phone', 'shelf: a bad width gives the phone layout');
  ok(LAYOUTS.every((L, i) => i === 0 || (L.min > LAYOUTS[i - 1].min && L.bw >= LAYOUTS[i - 1].bw)), 'shelf: layouts grow with the width');
  // A phone shows at least two boxes side by side; a desk shows the six adventures in one row.
  const fits = (w, n) => { const L = shelfLayout(w); return L.bd + L.gap + n * (L.bw + L.gap) <= shelfRoom(w); };
  ok(fits(375, 2) && fits(430, 2) && fits(600, 3), 'shelf: two boxes fit on a 375 px phone, three on a 600 px tablet');
  ok([1024, 1280, 1600, 2560].every(w => fits(w, groups[1].games.length)), 'shelf: the six adventures fit in one row from 1024 px');
  ok(['bw', 'bh', 'bd', 'gap'].every(k => shelfLayout(390)[k] > 0) && shelfLayout(390).bh === Math.round(112 * 4 / 3), 'shelf: box height is 4:3 of the width');
  ok(data.systems.map(systemMedia).join() === 'disc,cart,cart,cart,cart', 'shelf: PlayStation is a disc, the others cartridges');
  const css = read('style.css').toString();
  ok(/prefers-reduced-motion:reduce/.test(css), 'shelf: style.css has a reduced-motion rule');
  ok(/\.box:focus-visible/.test(css), 'shelf: a focused box shows a focus ring');
  ok(!/url\((?!data:|"data:|\$)[^)]*\.(png|jpe?g|webp|gif)/i.test(css), 'shelf: style.css loads no image file (the grain is SVG turbulence)');
  group('shelf.', m);
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
    for (let i = 0; i < 20 && !document.querySelector('#shelf .box'); i++) await new Promise(r => setTimeout(r, 5));
    ok(document.querySelectorAll('#shelf .box').length === data.games.length, 'boot: the bookcase has a box for every game');
    ok(document.querySelectorAll('#shelf .bay').length === shelfGroups(data.games).length && document.querySelectorAll('#shelf .bay .plank').length === document.querySelectorAll('#shelf .bay').length, 'boot: one bay with a plank per engine');
    ok([...document.querySelectorAll('#shelf .box')].every(b => b.tagName === 'BUTTON' && /Take the box off the shelf/.test(b.getAttribute('aria-label')) && b.querySelectorAll('.face').length === 3), 'boot: every box is a labelled button with three faces');
    ok([...document.querySelectorAll('#shelf .bay')].every(b => document.getElementById(b.getAttribute('aria-labelledby'))), 'boot: every bay has its plate as its label');
    ok(/^\d+px$/.test(document.documentElement.style.getPropertyValue('--bw')) && document.getElementById('shelf').dataset.mode === 'scroll', 'boot: the phone layout is in the CSS variables (' + document.documentElement.style.getPropertyValue('--bw') + ')');
    ok(document.querySelectorAll('#gameRows tr').length === data.games.length && document.querySelectorAll('#engineRows tr').length === data.engines.length && document.querySelectorAll('#coreRows tr').length === data.systems.length, 'boot: the credit tables fill (' + ['gameRows', 'engineRows', 'coreRows'].map(id => document.querySelectorAll('#' + id + ' tr').length).join('/') + ')');
    ok(document.querySelectorAll('#sys input[type=radio]').length === data.systems.length, 'boot: the system list fills');
    ok(document.getElementById('touchNote').hasAttribute('hidden'), 'boot: the touch note stays hidden with a fine pointer');
    document.querySelector('#shelf .box').dispatchEvent(new window.Event('click'));
    const box0 = document.querySelector('#shelf .box');
    ok(document.getElementById('info').hasAttribute('open') && document.getElementById('infoTitle').textContent === data.games[0].title, 'boot: a box opens its pull-out');
    ok(box0.classList.contains('out') && document.querySelectorAll('#infoBox .face').length === 3, 'boot: the box leaves the shelf and its 3D copy is in the pull-out');
    ok(document.querySelectorAll('#infoChips li').length === 5 && /Runs in DOSBox/.test(document.getElementById('infoChips').textContent), 'boot: the pull-out lists engine, size, input, licence kind and media');
    ok(/sha256 [0-9a-f]{64}/.test(document.getElementById('infoFile').textContent) && document.querySelector('#infoLic a'), 'boot: the pull-out shows the sha256 and the source link');
    document.getElementById('infoBack').dispatchEvent(new window.Event('click'));
    ok(!document.getElementById('info').hasAttribute('open') && !box0.classList.contains('out'), 'boot: Put it back closes the pull-out and returns the box');
    box0.dispatchEvent(new window.Event('click'));
    document.getElementById('infoPlay').dispatchEvent(new window.Event('click'));
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
    let dbg = null;
    for (let i = 0; i < 300 && !(dbg && i > 20); i++) { await new Promise(r => setTimeout(r, 10)); for (const fn of raf.splice(0)) { try { fn(performance.now() + i * 500); } catch (e) { errors.push(e.message); } } dbg = window.snSaver.debug(); }
    ok(dbg && dbg.shot && dbg.shot.beats.length === 6 && dbg.flat === true, 'boot: the saver runs its plan (2D path: node has no WebGL) ' + JSON.stringify(dbg && dbg.loc));
    const live = [...document.querySelectorAll('canvas')].filter(c => /z-index:200/.test(c.getAttribute('style') || ''));
    ok(live.length === 1, 'boot: one saver canvas is in the document while it runs');
    window.snSaver.exit();
    ok(!document.body.contains(res.canvas), 'boot: saver exit removes its canvas');
  } catch (e) { errors.push(e.stack || e.message); }
  ok(errors.length === 0, 'boot: no errors (' + errors.join(' | ') + ')');
  group('boot.', m);
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
