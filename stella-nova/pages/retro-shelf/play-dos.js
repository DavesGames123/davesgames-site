// ============================================================================
//  RETRO SHELF  ·  play-dos.js — run a DOS game in DOSBox (js-dos emulators)
// ----------------------------------------------------------------------------
//  1. Read games.json and the game of ?game=<id> (a record with "dos").
//  2. Fetch the unchanged archive and check its sha256 (player-common.js).
//  3. Unpack it in memory (unzip.js). DOOM 1.9: the zip holds an installer
//     whose two parts DOOMS_19.1 + DOOMS_19.2 form one self-extracting zip.
//     "join-zip" joins the parts and reads that zip. Nothing is changed:
//     the files are the ones that the id installer writes.
//  4. Start DOSBox in a worker (emulators.dosboxWorker) with dosbox.conf,
//     the game files in C:\<dir>\ and a DEFAULT.CFG with sound settings
//     (the file that DOOM's own SETUP.EXE writes; DOSBox's Sound Blaster
//     is at 220 h, IRQ 7, DMA 1). The autoexec starts the .EXE.
//  5. Draw each frame on #screen, play the sound through Web Audio, and
//     send keys: keyboard, gamepad (games.json "gamepad") and the touch pad.
//  pagehide (the shelf removes this iframe) ends DOSBox and the audio.
//
//  Exports for node tests: DOS_KEYS, dosboxConf, doomCfg, unpackDos.
//  grep -n targets
//    "export const DOS_KEYS"   "export function dosboxConf"
//    "export async function unpackDos"   "function makeAudio"
//    "function bindKeys"   "function buildPad"   "async function start"
// ============================================================================
import { zipAll } from './unzip.js';
import { status, fail, manifest, loadGame, gameFromQuery, gamepadPoll } from './player-common.js';

// KeyboardEvent.code -> js-dos key code (GLFW numbering, as in js-dos 8).
export const DOS_KEYS = (() => {
  const k = {
    Space: 32, Quote: 39, Comma: 44, Minus: 45, Period: 46, Slash: 47, Semicolon: 59, Equal: 61,
    BracketLeft: 91, Backslash: 92, BracketRight: 93, Backquote: 96,
    Escape: 256, Enter: 257, Tab: 258, Backspace: 259, Insert: 260, Delete: 261,
    ArrowRight: 262, ArrowLeft: 263, ArrowDown: 264, ArrowUp: 265, PageUp: 266, PageDown: 267, Home: 268, End: 269,
    CapsLock: 280, ScrollLock: 281, NumLock: 282, PrintScreen: 283, Pause: 284,
    NumpadDecimal: 330, NumpadDivide: 331, NumpadMultiply: 332, NumpadSubtract: 333, NumpadAdd: 334, NumpadEnter: 335,
    ShiftLeft: 340, ControlLeft: 341, AltLeft: 342, ShiftRight: 344, ControlRight: 345, AltRight: 346, IntlBackslash: 348,
  };
  for (let i = 0; i < 26; i++) k['Key' + String.fromCharCode(65 + i)] = 65 + i;
  for (let i = 0; i < 10; i++) { k['Digit' + i] = 48 + i; k['Numpad' + i] = 320 + i; }
  for (let i = 1; i <= 12; i++) k['F' + i] = 289 + i;
  return k;
})();

/** dosbox.conf for a game: a fast 486-class machine with a Sound Blaster 16. */
export function dosboxConf(game) {
  const d = game.dos;
  return [
    '[sdl]', 'autolock=false',
    '[dosbox]', 'machine=svga_s3', 'memsize=16',
    '[cpu]', 'core=auto', 'cputype=auto', 'cycles=max',
    '[mixer]', 'rate=44100',
    '[sblaster]', 'sbtype=sb16', 'sbbase=220', 'irq=7', 'dma=1', 'hdma=5', 'oplmode=auto',
    '[speaker]', 'pcspeaker=true',
    '[dos]', 'xms=true', 'ems=true', 'umb=true',
    '[autoexec]', 'echo off', 'mount c .', 'c:', 'cd ' + d.dir, d.exe, '',
  ].join('\n');
}

/**
 * DOOM's DEFAULT.CFG with sound on (the values of DOOM's m_misc.c defaults;
 * SB at 0x220 = 544, IRQ 7, DMA 1; music and effects on device 3, the
 * Sound Blaster). The mouse is off, so Esc never fights a pointer lock.
 */
export function doomCfg() {
  const rows = [
    ['mouse_sensitivity', 5], ['sfx_volume', 8], ['music_volume', 8], ['show_messages', 1],
    ['key_right', 77], ['key_left', 75], ['key_up', 72], ['key_down', 80],
    ['key_strafeleft', 51], ['key_straferight', 52], ['key_fire', 29], ['key_use', 57],
    ['key_strafe', 56], ['key_speed', 54], ['use_mouse', 0], ['mouseb_fire', 0], ['mouseb_strafe', 1],
    ['mouseb_forward', 2], ['use_joystick', 0], ['joyb_fire', 0], ['joyb_strafe', 1], ['joyb_use', 3],
    ['joyb_speed', 2], ['screenblocks', 10], ['detaillevel', 0], ['snd_channels', 3],
    ['snd_musicdevice', 3], ['snd_sfxdevice', 3], ['snd_sbport', 544], ['snd_sbirq', 7], ['snd_sbdma', 1],
    ['snd_mport', 816], ['usegamma', 0],
  ];
  return rows.map(([k, v]) => k + '\t\t' + v).join('\r\n') + '\r\n';
}

/** Unpack a DOS game archive: [{ path, contents }] for DOSBox. */
export async function unpackDos(game, bytes) {
  const d = game.dos;
  const outer = await zipAll(bytes);
  let files;
  if (d.unpack === 'join-zip') {
    const parts = d.join.map(n => { const b = outer.get(n); if (!b) throw new Error(n + ' is not in ' + game.file); return b; });
    const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of parts) { all.set(p, o); o += p.length; }
    files = await zipAll(all);
  } else files = outer;
  const out = [];
  for (const [name, contents] of files) out.push({ path: d.dir + '/' + name.toUpperCase(), contents });
  if (d.config === 'DEFAULT.CFG') out.push({ path: d.dir + '/DEFAULT.CFG', contents: new TextEncoder().encode(doomCfg()) });
  return out;
}

// ------------------------------------------------------------------- audio
function makeAudio(rate) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  let ctx;
  try { ctx = new AC({ sampleRate: rate }); } catch (e) { ctx = new AC(); }
  const ring = new Float32Array(1 << 16), mask = ring.length - 1;
  let w = 0, r = 0;
  const step = rate / ctx.sampleRate;
  const node = ctx.createScriptProcessor(2048, 0, 1);
  node.onaudioprocess = e => {
    const out = e.outputBuffer.getChannelData(0);
    for (let i = 0; i < out.length; i++) {
      if (w - r < 2) { out[i] = 0; continue; }
      const i0 = Math.floor(r), f = r - i0;
      out[i] = ring[i0 & mask] * (1 - f) + ring[(i0 + 1) & mask] * f;
      r += step;
    }
  };
  node.connect(ctx.destination);
  return {
    ctx,
    push(s) {
      for (let i = 0; i < s.length; i++) ring[(w++) & mask] = s[i];
      if (w - r > rate * 0.25) r = w - rate * 0.08; // too far behind: drop old sound
    },
    close() { try { node.disconnect(); ctx.close(); } catch (e) { /* closed */ } },
  };
}

// -------------------------------------------------------------------- keys
function bindKeys(ci, canvas) {
  const send = (code, down) => { const k = DOS_KEYS[code]; if (k) ci.sendKeyEvent(k, down); };
  const onKey = down => e => {
    if (!(e.code in DOS_KEYS)) return;
    e.preventDefault();
    if (e.repeat) return;
    send(e.code, down);
  };
  window.addEventListener('keydown', onKey(true));
  window.addEventListener('keyup', onKey(false));
  // A lost focus would leave a key down in the game.
  window.addEventListener('blur', () => { for (const k of ['ControlLeft', 'ShiftLeft', 'AltLeft', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']) send(k, false); });
  canvas.addEventListener('pointerdown', () => canvas.focus());
  return send;
}

function buildPad(game, send) {
  if (!matchMedia('(hover: none) and (pointer: coarse)').matches) return;
  document.documentElement.classList.add('has-pad');
  const pad = document.getElementById('pad'), box = document.getElementById('btns');
  for (const [label, code] of game.pad || []) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label; b.dataset.key = code;
    box.append(b);
  }
  pad.hidden = false;
  const down = new Map();
  pad.addEventListener('pointerdown', e => {
    const b = e.target.closest('button[data-key]'); if (!b) return;
    e.preventDefault(); b.setPointerCapture(e.pointerId);
    down.set(e.pointerId, b); b.classList.add('on'); send(b.dataset.key, true);
  });
  const up = e => { const b = down.get(e.pointerId); if (!b) return; down.delete(e.pointerId); b.classList.remove('on'); send(b.dataset.key, false); };
  pad.addEventListener('pointerup', up);
  pad.addEventListener('pointercancel', up);
  pad.addEventListener('contextmenu', e => e.preventDefault());
}

// ------------------------------------------------------------------- start
async function start() {
  const canvas = document.getElementById('screen');
  const c2 = canvas.getContext('2d');
  let ci = null, audio = null, raf = 0, img = null;
  window.addEventListener('pagehide', () => {
    cancelAnimationFrame(raf);
    if (audio) audio.close();
    if (ci) ci.exit().catch(() => {});
    ci = null;
  });
  try {
    if (typeof emulators === 'undefined') throw new Error('The DOSBox engine is not on the server right now. Please try again later.');
    const data = await manifest();
    const game = gameFromQuery(data);
    if (!game.dos) throw new Error(game.title + ' is not a DOS game.');
    document.title = game.title + ' · Retro Shelf';
    const bytes = await loadGame(data, game);
    status('Unpacking ' + game.title + '…');
    const files = await unpackDos(game, bytes);
    status('Starting DOSBox…');
    const eng = data.engines.find(e => e.id === 'dos');
    emulators.pathPrefix = new URL(data.fetched + eng.dir, import.meta.url).href;
    ci = await emulators.dosboxWorker([dosboxConf(game), ...files]);
    const ev = ci.events();
    ev.onFrameSize((w, h) => { canvas.width = w; canvas.height = h; img = c2.createImageData(w, h); });
    let pending = null;
    ev.onFrame((rgb, rgba) => { pending = rgba || rgb; });
    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (!pending || !img) return;
      const src = pending; pending = null;
      const dst = img.data;
      if (src.length === dst.length) dst.set(src);
      else for (let i = 0, j = 0; j < dst.length; i += 3, j += 4) { dst[j] = src[i]; dst[j + 1] = src[i + 1]; dst[j + 2] = src[i + 2]; dst[j + 3] = 255; }
      c2.putImageData(img, 0, 0);
    };
    canvas.width = ci.width() || 640; canvas.height = ci.height() || 400;
    img = c2.createImageData(canvas.width, canvas.height);
    draw();
    audio = makeAudio(ci.soundFrequency() || 44100);
    if (audio) {
      ev.onSoundPush(s => audio.push(s));
      const hint = document.getElementById('soundHint');
      const wake = () => { audio.ctx.resume().then(() => { if (audio.ctx.state === 'running') hint.hidden = true; }).catch(() => {}); };
      wake();
      setTimeout(() => { if (audio && audio.ctx.state !== 'running') hint.hidden = false; }, 600);
      window.addEventListener('keydown', wake);
      window.addEventListener('pointerdown', wake);
    }
    const send = bindKeys(ci, canvas);
    buildPad(game, send);
    const held = new Map();
    setInterval(() => { if (ci) gamepadPoll(game.gamepad, send, held); }, 16);
    document.addEventListener('visibilitychange', () => { if (!ci) return; if (document.hidden) ci.pause(); else ci.resume(); });
    status('');
    canvas.focus();
  } catch (e) {
    fail(e.message || String(e));
  }
}

if (typeof document !== 'undefined' && document.getElementById('screen')) start();
