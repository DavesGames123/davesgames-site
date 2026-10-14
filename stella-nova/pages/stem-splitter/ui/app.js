// ============================================================================
//  STEM SPLITTER  ·  ui/app.js — the page UI: file, model, separate, mixer
// ----------------------------------------------------------------------------
//  mountApp(root, { engine, models, defaultModel, jszip }) builds the whole
//  page in `root` (CONTRACT 5.5, 6.1). It talks to the engine only through
//  the client interface of CONTRACT 5.4 (init, models, load, separate,
//  cancel, evict). The engine runs Demucs in a worker. This file has no
//  model code.
//
//  States (root.dataset.state):
//    idle       no song yet
//    decoding   the browser decodes the file
//    ready      a song is decoded; Separate is on
//    working    model download, check, session, separation
//    done       stems are in the mixer
//  An error does not change the state. It shows the .ss-error box
//  (data-code = oom | net | hash | session | run | decode | nowasm | long).
//
//  The song arrays stay on the main thread for the "Original" row. The
//  engine gets copies, because the worker takes (transfers) the arrays it
//  gets. Cost: one more copy of the song, 85 MB for 4 minutes.
//  After separation each stem is copied into an AudioBuffer, and the page
//  then reads the stem (waveform, WAV) from getChannelData of that buffer.
//  The page drops the worker arrays, so it keeps one copy of each stem.
//
//  Layout (style.css): desktop has two columns (.ss-left, .ss-right). On a
//  phone (sheet.js PHONE_Q) there is one column, .ss-dock is a fixed bar at
//  the base with the settings button and the transport, and #ss-settings
//  is a bottom sheet.
//
//  GREP MAP
//    ERROR_TEXT ........ the error messages of CONTRACT 6.1 step 5
//    classifyError ..... Error -> code
//    mountApp .......... builds the DOM and binds everything
//    renderModels ...... the model picker rows
//    onProgress ........ engine events -> phase line, bar, times
//    runSeparate ....... load + separate + result
//    cancel ............ terminate in the load stage, soft cancel after
//    showResult ........ mixer, player, downloads
//    makePlayer ........ player from result.tracks (again after release)
//    download .......... WAV and zip files
//    onKey ............. Space = play / pause
//    release ........... pagehide and window.__snRelease
// ============================================================================

import { createDropzone } from './dropzone.js';
import { decodeSong, checkLength, isPhoneLimit, makeAudioBuffer } from './audio-io.js';
import { createPlayer } from './player.js';
import { createMixer, ORIGINAL, STEM_LABELS } from './mixer.js';
import { createSheet, isPhoneLayout } from './sheet.js';
import { stemToWav } from './wav.js';
import { songBase, stemFileName, noVocalsName, zipName, sumStems, buildZip, saveBlob } from './export.js';
import { fmtTime, fmtMB, phaseText, phaseFraction, timesText, epText } from './format.js';

export const ERROR_TEXT = {
  oom: 'The device ran out of memory. Try the 4-stem model, a shorter song, or a computer with WebGPU.',
  net: 'The model could not be downloaded. You may be offline, and this model is not on this device yet. Connect once to download it; after that it works offline.',
  hash: 'The model download was damaged (the checksum did not match). Try again.',
  session: 'The model could not start in this browser.',
  run: 'The separation failed.',
  decode: 'This browser cannot decode this file. Try another format, for example WAV or MP3.',
  nowasm: 'This browser has no WebAssembly, so the model cannot run here.',
};

export function classifyError(e) {
  const code = e && e.code;
  if (code && (code in ERROR_TEXT || code === 'cancelled')) return code;
  const m = String((e && (e.message || e)) || '');
  if (/^cancel/i.test(m)) return 'cancelled';
  if (/out of memory|\boom\b|allocation failed|array buffer allocation|memory access out of bounds/i.test(m)) return 'oom';
  if (/checksum|sha-?256|hash/i.test(m)) return 'hash';
  if (/failed to fetch|network|offline|load failed/i.test(m)) return 'net';
  return 'run';
}

const QUALITIES = [
  { id: 'standard', label: 'Standard' },
  { id: 'best', label: 'Best (2x time)' },
];

const PIANO_NOTE = 'The Demucs authors say that the piano stem is not good yet.';

function el(doc, tag, cls, text) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}
function btn(doc, cls, text, label) {
  const b = el(doc, 'button', cls, text);
  b.type = 'button';
  if (label) b.setAttribute('aria-label', label);
  return b;
}

function isTextField(t) {
  if (!t || !t.tagName) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  return ['text', 'search', 'email', 'number', 'password', 'url', 'tel'].includes(String(t.type || 'text').toLowerCase());
}

export function mountApp(root, { engine, models, defaultModel, jszip = null, win = globalThis, save = null } = {}) {
  const doc = win.document;
  const now = () => (win.performance || performance).now();
  const saveFile = save || ((blob, name) => saveBlob(blob, name, doc));
  const modelList = Object.values(models);
  let modelId = models[defaultModel] ? defaultModel : modelList[0].id;
  let quality = 'standard';
  let song = null;            // { name, base, left, right, duration, channels }
  let busy = false, cancelAsked = false;
  let stage = null;           // 'load' | 'separate' while busy
  let cached = {};            // modelId -> boolean
  let sizes = {};             // modelId -> bytes (graph + weights)
  let epInfo = null, fallback = null;
  let result = null;          // { id, stems, order }
  let ctx = null, player = null, mixer = null;
  let raf = 0, tick = 0, t0 = 0, lastEv = null, lastAt = 0, seeking = false;
  let dead = false;
  const hasWasm = typeof win.WebAssembly === 'object' || typeof win.WebAssembly === 'function';

  // ------------------------------------------------------------- DOM
  root.textContent = '';
  const app = el(doc, 'div', 'ss-app');
  const head = el(doc, 'header', 'ss-top');
  head.append(el(doc, 'h1', 'ss-title', 'Stem Splitter'),
    el(doc, 'p', 'ss-sub', 'Split a song into drums, bass, vocals and more with Demucs v4. The model runs on this device.'));
  const cols = el(doc, 'div', 'ss-cols');
  const left = el(doc, 'section', 'ss-left'); left.setAttribute('aria-label', 'Song and model');
  const right = el(doc, 'section', 'ss-right'); right.setAttribute('aria-label', 'Stems');
  cols.append(left, right);

  const drop = createDropzone(left, { onFile: f => loadFile(f), doc });

  const settings = el(doc, 'section', 'ss-sheet'); settings.id = 'ss-settings';
  settings.setAttribute('aria-label', 'Model and quality');
  const grip = el(doc, 'div', 'ss-grip'); grip.setAttribute('role', 'button'); grip.setAttribute('aria-label', 'Close settings');
  grip.appendChild(el(doc, 'span'));
  const modelHead = el(doc, 'h2', 'ss-h2', 'Model');
  const modelBox = el(doc, 'div', 'ss-models'); modelBox.setAttribute('role', 'radiogroup'); modelBox.setAttribute('aria-label', 'Model');
  const qualHead = el(doc, 'h2', 'ss-h2', 'Quality');
  const qualBox = el(doc, 'div', 'ss-seg ss-quality'); qualBox.setAttribute('role', 'radiogroup'); qualBox.setAttribute('aria-label', 'Quality');
  const qualBtns = QUALITIES.map(q => {
    const b = btn(doc, 'ss-q', q.label); b.dataset.quality = q.id; b.setAttribute('role', 'radio');
    b.addEventListener('click', () => { if (!busy) { quality = q.id; renderQuality(); } });
    qualBox.appendChild(b); return b;
  });
  const epLine = el(doc, 'p', 'ss-ep', `Runs on: ${epText(null)}`);
  settings.append(grip, modelHead, modelBox, qualHead, qualBox, epLine);
  left.appendChild(settings);

  const actions = el(doc, 'div', 'ss-actions');
  const go = btn(doc, 'ss-go', 'Separate');
  go.disabled = true;
  const choice = btn(doc, 'ss-choice', '', 'Change the model and quality');
  choice.setAttribute('aria-controls', 'ss-settings');
  actions.append(go, choice);
  left.appendChild(actions);

  const prog = el(doc, 'div', 'ss-progress'); prog.hidden = true;
  prog.setAttribute('role', 'status'); prog.setAttribute('aria-live', 'polite');
  const phase = el(doc, 'div', 'ss-phase');
  const bar = el(doc, 'div', 'ss-bar'); const fill = el(doc, 'div', 'ss-bar-fill'); bar.appendChild(fill);
  const times = el(doc, 'div', 'ss-times');
  const cancelBtn = btn(doc, 'ss-cancel', 'Cancel');
  prog.append(phase, bar, times, cancelBtn);
  left.appendChild(prog);

  const msg = el(doc, 'p', 'ss-msg'); msg.hidden = true;
  const err = el(doc, 'div', 'ss-error'); err.hidden = true; err.setAttribute('role', 'alert');
  left.append(msg, err);

  const empty = el(doc, 'div', 'ss-empty', 'The stems show here after you separate a song.');
  const presets = el(doc, 'div', 'ss-presets'); presets.hidden = true;
  const presetBtns = [['karaoke', 'Karaoke'], ['vocals', 'Vocals only'], ['all', 'All']].map(([id, label]) => {
    const b = btn(doc, 'ss-preset', label); b.dataset.preset = id;
    b.addEventListener('click', () => { if (mixer) mixer.preset(id); });
    presets.appendChild(b); return b;
  });
  const mixHost = el(doc, 'div', 'ss-mixhost');
  const dls = el(doc, 'div', 'ss-downloads'); dls.hidden = true;
  right.append(empty, presets, mixHost, dls);

  const dock = el(doc, 'nav', 'ss-dock'); dock.setAttribute('aria-label', 'Player');
  const dockSettings = btn(doc, 'ss-dock-settings', '⚙', 'Model and quality settings');
  dockSettings.setAttribute('aria-controls', 'ss-settings');
  const transport = el(doc, 'div', 'ss-transport'); transport.hidden = true;
  const play = btn(doc, 'ss-play', '▶', 'Play');
  const seek = el(doc, 'input', 'ss-seek'); seek.type = 'range';
  seek.setAttribute('min', '0'); seek.setAttribute('max', '1000'); seek.setAttribute('step', '1'); seek.value = '0';
  seek.setAttribute('aria-label', 'Position');
  const timeLbl = el(doc, 'span', 'ss-time', '0:00 / 0:00');
  transport.append(play, seek, timeLbl);
  dock.append(dockSettings, transport);
  right.insertBefore(dock, empty);

  app.append(head, cols);
  root.appendChild(app);

  const sheet = createSheet(settings, { button: dockSettings, grip, doc });
  choice.addEventListener('click', () => sheet.open());

  // ------------------------------------------------------------- state view
  function setState(s) {
    root.dataset.state = s;
    app.dataset.state = s;
    drop.setBusy(busy || s === 'decoding');
    go.disabled = !(hasWasm && song && !busy && s !== 'decoding');
    for (const b of qualBtns) b.disabled = busy;
    for (const b of modelBox.querySelectorAll('button')) b.disabled = busy;
  }
  function showError(code, detail) {
    err.dataset.code = code;
    const base = code === 'long' ? detail : (ERROR_TEXT[code] || ERROR_TEXT.run);
    const extra = code !== 'long' && detail && (code === 'session' || code === 'run') ? ` ${String(detail).slice(0, 200)}` : '';
    err.textContent = base + extra;
    err.hidden = false;
  }
  function clearError() { err.hidden = true; err.textContent = ''; delete err.dataset.code; }
  function note(text) { msg.textContent = text || ''; msg.hidden = !text; }

  function renderQuality() {
    for (const b of qualBtns) {
      const on = b.dataset.quality === quality;
      b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on));
    }
    renderChoice();
  }
  // Phone only (style.css): the model and quality in one line under Separate.
  function renderChoice() {
    const m = models[modelId] || {};
    const ml = modelId === 'htdemucs_6s' ? '6 stems' : (m.label || modelId);
    const ql = quality === 'best' ? 'Best' : 'Standard';
    choice.textContent = `${ml} · ${ql} · ${epText(epInfo && epInfo.ep)} — change`;
  }

  function modelBytes(m) {
    if (sizes[m.id]) return sizes[m.id];
    return ((m.graph && m.graph.bytes) || 0) + ((m.weights && m.weights.bytes) || 0);
  }

  function renderModels() {
    modelBox.textContent = '';
    for (const m of modelList) {
      const row = el(doc, 'div', 'ss-model'); row.dataset.model = m.id;
      const pick = btn(doc, 'ss-model-pick');
      pick.setAttribute('role', 'radio');
      const on = m.id === modelId;
      pick.setAttribute('aria-checked', String(on));
      row.classList.toggle('on', on);
      const isCached = !!cached[m.id];
      pick.append(
        el(doc, 'span', 'ss-model-label', m.id === 'htdemucs_6s' ? '6 stems (adds guitar, piano)' : (m.label || m.id)),
        el(doc, 'span', 'ss-model-meta', `${fmtMB(modelBytes(m))} · ${isCached ? 'downloaded' : 'not downloaded'}`));
      if (m.stems && m.stems.includes('piano')) pick.appendChild(el(doc, 'span', 'ss-model-note', PIANO_NOTE));
      pick.disabled = busy;
      pick.addEventListener('click', () => { if (!busy) { modelId = m.id; renderModels(); renderChoice(); } });
      row.appendChild(pick);
      if (isCached) {
        const rm = btn(doc, 'ss-model-rm', 'Remove download', `Remove the ${m.label || m.id} download`);
        rm.disabled = busy;
        rm.addEventListener('click', async () => {
          if (busy) return;
          try { await engine.evict(m.id); } catch (e) { /* the list refresh shows the real state */ }
          await refreshModels();
        });
        row.appendChild(rm);
      }
      modelBox.appendChild(row);
    }
  }

  function renderEp() {
    let t = `Runs on: ${epText(epInfo && epInfo.ep)}`;
    if (fallback) t += ` — the GPU failed, so the model runs on the CPU.`;
    epLine.textContent = t;
    epLine.dataset.ep = (epInfo && epInfo.ep) || '';
    renderChoice();
  }

  async function refreshModels() {
    try {
      const list = await engine.models();
      cached = {}; for (const m of list || []) { cached[m.id] = !!m.cached; if (m.bytes) sizes[m.id] = m.bytes; }
    } catch (e) { /* keep the old view */ }
    if (!dead) renderModels();
  }

  // ------------------------------------------------------------- file
  async function loadFile(file) {
    if (busy || dead || root.dataset.state === 'decoding') return;
    clearError(); note('');
    busy = false;
    setState('decoding');
    drop.setInfo(`Decoding ${file.name || 'the file'}…`);
    let s;
    try {
      s = await decodeSong(file, { win });
    } catch (e) {
      if (dead) return;
      drop.setInfo(song ? songInfo(song) : '');
      showError('decode');
      setState(song ? (result ? 'done' : 'ready') : 'idle');
      return;
    }
    if (dead) return;
    const tooLong = checkLength(s.duration, isPhoneLimit(win));
    if (tooLong) {
      drop.setInfo(song ? songInfo(song) : '');
      showError('long', tooLong);
      setState(song ? (result ? 'done' : 'ready') : 'idle');
      return;
    }
    clearResult();
    song = { name: file.name || 'song', base: songBase(file.name), left: s.left, right: s.right, duration: s.duration, channels: s.channels };
    drop.setInfo(songInfo(song));
    setState('ready');
  }

  function songInfo(sg) {
    const src = sg.channels === 1 ? 'mono source' : sg.channels > 2 ? `${sg.channels}-channel source, first two used` : 'stereo';
    return `${sg.name} · ${fmtTime(sg.duration)} · 44 100 Hz after decode (${src})`;
  }

  // ------------------------------------------------------------- progress
  function onProgress(ev) {
    if (dead || !ev) return;
    lastEv = ev; lastAt = now();
    const t = phaseText(ev);
    if (t) phase.textContent = t;
    const f = phaseFraction(ev);
    bar.classList.toggle('busy', f === null);
    fill.style.width = f === null ? '100%' : `${(f * 100).toFixed(1)}%`;
    bar.setAttribute('aria-valuenow', f === null ? '' : String(Math.round(f * 100)));
    paintTimes();
  }
  function leftMs() {
    if (!lastEv || lastEv.phase !== 'separate' || !Number.isFinite(lastEv.etaMs)) return null;
    return Math.max(0, lastEv.etaMs - (now() - lastAt));
  }
  function paintTimes() { times.textContent = timesText(now() - t0, leftMs()); }

  // ------------------------------------------------------------- separate
  async function runSeparate() {
    if (!song || busy || dead || !hasWasm) return;
    clearError(); note('');
    busy = true; cancelAsked = false; fallback = null;
    setState('working');
    if (isPhoneLayout(win)) sheet.close();
    prog.hidden = false; cancelBtn.disabled = false; cancelBtn.textContent = 'Cancel';
    phase.textContent = 'Starting'; fill.style.width = '0%'; bar.classList.remove('busy');
    t0 = now(); lastEv = null;
    paintTimes();
    tick = setInterval(paintTimes, 500);
    const id = modelId, q = quality;
    try {
      stage = 'load';
      const ld = await engine.load(id, onProgress);
      if (ld && ld.ep) { epInfo = { ...(epInfo || {}), ep: ld.ep }; }
      fallback = ld && ld.fallback ? ld.fallback : null;
      renderEp();
      if (cancelAsked) { const c = new Error('cancelled'); c.code = 'cancelled'; throw c; }
      stage = 'separate';
      // transfer: our copies go to the worker as they are (engine/client.js
      // copies again without it; an engine without the flag ignores it).
      const res = await engine.separate({ modelId: id, left: song.left.slice(), right: song.right.slice(), quality: q, onProgress, transfer: true });
      if (dead) return;
      busy = false;
      showResult(id, res);
    } catch (e) {
      if (dead) return;
      busy = false;
      const code = classifyError(e);
      if (code === 'cancelled') note('Cancelled.');
      else showError(code, e && e.message);
      setState(result ? 'done' : 'ready');
    } finally {
      stage = null;
      clearInterval(tick); tick = 0;
      if (!dead) { prog.hidden = true; refreshModels(); }
    }
  }

  function cancel() {
    if (!busy) return;
    cancelAsked = true;
    cancelBtn.disabled = true;
    cancelBtn.textContent = 'Stopping…';
    if (stage === 'load') {
      // The download, check and session steps have no cancel point in the
      // worker: end the worker. The client starts a new one on the next call.
      phase.textContent = lastEv && lastEv.phase === 'download' ? 'Stopping the download' : 'Stopping';
      try { engine.terminate(); } catch (e) { /* the load ends with an error */ }
      return;
    }
    phase.textContent = 'Stopping after this segment';
    try { engine.cancel(); } catch (e) { /* the run ends with an error */ }
  }

  // ------------------------------------------------------------- result
  function clearResult() {
    stopLoop();
    if (player) { player.destroy(); player = null; }
    if (mixer) { mixer.destroy(); mixer = null; }
    result = null;
    presets.hidden = true; dls.hidden = true; dls.textContent = ''; transport.hidden = true;
    dock.classList.remove('has-transport');
    empty.hidden = false;
    seek.value = '0'; timeLbl.textContent = '0:00 / 0:00';
  }

  function audioCtx() {
    if (ctx) return ctx;
    const C = win.AudioContext || win.webkitAudioContext;
    if (!C) return null;
    try { ctx = new C({ sampleRate: 44100 }); } catch (e) { try { ctx = new C(); } catch (x) { ctx = null; } }
    return ctx;
  }

  function showResult(id, res) {
    clearResult();
    // The EP can change in the first run (WebGPU -> wasm fallback).
    if (res.ep) epInfo = { ...(epInfo || {}), ep: res.ep };
    if (res.fallback) fallback = res.fallback;
    renderEp();
    const stems = res.stems || {};
    const known = (models[id] && models[id].stems) || [];
    const order = [...known.filter(n => stems[n]), ...Object.keys(stems).filter(n => !known.includes(n))];
    result = { id, stems, order, tracks: null };
    const rows = [...order.map(n => ({ id: n, channels: stems[n] })), { id: ORIGINAL, channels: [song.left, song.right] }];
    const c = audioCtx();
    if (c) {
      const tracks = rows.map(r => {
        const buffer = makeAudioBuffer(c, r.channels);
        r.channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
        if (r.id === ORIGINAL) { song.left = r.channels[0]; song.right = r.channels[1]; }
        else stems[r.id] = r.channels;
        return { id: r.id, buffer, mute: r.id === ORIGINAL };
      });
      result.tracks = tracks;
      makePlayer();
    }
    mixer = createMixer(mixHost, {
      rows, doc, win,
      onChange: states => { if (player) player.setAll(states); },
      onSeek: f => { if (player) { player.seek(f * player.duration); paintTransport(); } },
    });
    empty.hidden = true;
    presets.hidden = false;
    for (const b of presetBtns) b.disabled = b.dataset.preset !== 'all' && !stems.vocals;
    transport.hidden = false;
    dock.classList.add('has-transport');
    play.disabled = !player;
    if (!player) note('This browser has no Web Audio playback. The downloads still work.');
    buildDownloads();
    paintTransport();
    const segs = Number.isFinite(res.segments) ? `, ${res.segments} segments` : '';
    note(`Done in ${fmtTime((res.ms || 0) / 1000)} on ${epText(res.ep || (epInfo && epInfo.ep))}${segs}.`);
    setState('done');
  }

  // A player for the stems of `result`. After window.__snRelease closes the
  // context, the next Play makes a new context and player from the same
  // AudioBuffers, with the mixer states.
  function makePlayer() {
    if (!result || !result.tracks) return null;
    const c = audioCtx();
    if (!c) return null;
    player = createPlayer({ ctx: c, tracks: result.tracks, onEnded: () => { paintTransport(); stopLoop(); } });
    if (mixer) player.setAll(mixer.states);
    return player;
  }

  function buildDownloads() {
    dls.textContent = '';
    dls.appendChild(el(doc, 'h2', 'ss-h2', 'Download'));
    const box = el(doc, 'div', 'ss-dl-row');
    for (const n of result.order) {
      const b = btn(doc, 'ss-dl', `${STEM_LABELS[n] || n} (WAV)`); b.dataset.dl = n;
      b.addEventListener('click', () => download(n, b));
      box.appendChild(b);
    }
    if (result.stems.vocals && result.order.length > 1) {
      const b = btn(doc, 'ss-dl', 'No vocals (WAV)'); b.dataset.dl = 'no_vocals';
      b.addEventListener('click', () => download('no_vocals', b));
      box.appendChild(b);
    }
    if (typeof jszip === 'function') {
      const b = btn(doc, 'ss-dl ss-dl-zip', 'All stems (zip)'); b.dataset.dl = 'zip';
      b.addEventListener('click', () => download('zip', b));
      box.appendChild(b);
    }
    dls.appendChild(box);
    dls.hidden = false;
  }

  async function download(what, b) {
    if (!result || !song) return;
    const base = song.base, Blob_ = win.Blob || Blob;
    const old = b.textContent;
    b.disabled = true; b.textContent = what === 'zip' ? 'Zipping…' : 'Writing…';
    try {
      await new Promise(r => setTimeout(r, 0));
      if (what === 'zip') {
        const files = result.order.map(n => ({ name: stemFileName(base, n), bytes: stemToWav(result.stems[n]) }));
        const blob = await buildZip(jszip, files, 'blob');
        saveFile(blob, zipName(base));
      } else if (what === 'no_vocals') {
        saveFile(new Blob_([stemToWav(sumStems(result.stems, ['vocals']))], { type: 'audio/wav' }), noVocalsName(base));
      } else {
        saveFile(new Blob_([stemToWav(result.stems[what])], { type: 'audio/wav' }), stemFileName(base, what));
      }
    } catch (e) {
      showError(classifyError(e) === 'oom' ? 'oom' : 'run', e && e.message);
    } finally {
      if (!dead) { b.disabled = false; b.textContent = old; }
    }
  }

  // ------------------------------------------------------------- transport
  function paintTransport() {
    if (!player) return;
    const pos = player.position(), dur = player.duration;
    if (!seeking) seek.value = String(Math.round(dur > 0 ? (pos / dur) * 1000 : 0));
    timeLbl.textContent = `${fmtTime(pos)} / ${fmtTime(dur)}`;
    play.textContent = player.playing ? '❚❚' : '▶';
    play.setAttribute('aria-label', player.playing ? 'Pause' : 'Play');
    if (mixer) mixer.setHead(dur > 0 ? pos / dur : 0);
  }
  function loop() {
    raf = 0;
    if (dead || !player) return;
    paintTransport();
    if (player.playing) raf = win.requestAnimationFrame(loop);
  }
  function stopLoop() { if (raf) { win.cancelAnimationFrame(raf); raf = 0; } }
  function togglePlay() {
    if (!player) makePlayer();
    if (!player) return;
    player.toggle();
    paintTransport();
    stopLoop();
    if (player.playing) raf = win.requestAnimationFrame(loop);
  }

  play.addEventListener('click', togglePlay);
  seek.addEventListener('pointerdown', () => { seeking = true; });
  // A tap that does not change the value fires no `change`, so the end of
  // the pointer also ends `seeking`; else the bar stops for good.
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) seek.addEventListener(t, () => { seeking = false; });
  seek.addEventListener('input', () => {
    if (!player) return;
    const f = (Number(seek.value) || 0) / 1000;
    timeLbl.textContent = `${fmtTime(f * player.duration)} / ${fmtTime(player.duration)}`;
    if (mixer) mixer.setHead(f);
  });
  seek.addEventListener('change', () => {
    seeking = false;
    if (!player) return;
    player.seek(((Number(seek.value) || 0) / 1000) * player.duration);
    paintTransport();
  });

  go.addEventListener('click', runSeparate);
  cancelBtn.addEventListener('click', cancel);

  // A focused button acts on Space at keyup, so keyup is cancelled too.
  let spaceDown = false;
  const isSpace = e => e.key === ' ' || e.code === 'Space';
  const onKey = e => {
    if (!isSpace(e) || isTextField(e.target)) return;
    if (!player || (e.target && e.target.closest && e.target.closest('.ss-drop'))) return;
    e.preventDefault();
    spaceDown = true;
    if (!e.repeat) togglePlay();
  };
  const onKeyUp = e => { if (isSpace(e) && spaceDown) { spaceDown = false; e.preventDefault(); } };
  doc.addEventListener('keydown', onKey);
  doc.addEventListener('keyup', onKeyUp);

  // A drop outside the zone must not open the file in the tab.
  const onWinOver = e => { e.preventDefault(); };
  const onWinDrop = e => {
    e.preventDefault();
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  };
  if (win.addEventListener) { win.addEventListener('dragover', onWinOver); win.addEventListener('drop', onWinDrop); }

  // ------------------------------------------------------------- release
  function release() {
    if (player && player.playing) { player.pause(); paintTransport(); }
    stopLoop();
  }
  const onHide = () => release();
  if (win.addEventListener) win.addEventListener('pagehide', onHide);
  const prevRelease = win.__snRelease;
  win.__snRelease = function () {
    release();
    if (ctx && ctx.close) { try { ctx.close(); } catch (e) { /* closed */ } ctx = null; if (player) { player.destroy(); player = null; } }
    if (typeof prevRelease === 'function') return prevRelease.apply(this, arguments);
  };

  // ------------------------------------------------------------- start
  renderQuality();
  renderModels();
  renderEp();
  setState('idle');
  if (!hasWasm) {
    showError('nowasm');
    epLine.textContent = 'Runs on: not available (no WebAssembly)';
  } else {
    (async () => {
      try { epInfo = await engine.init({ ep: 'auto' }); } catch (e) {
        epInfo = null;
        if (!dead) epLine.textContent = `Runs on: the engine did not start (${String((e && e.message) || e).slice(0, 120)})`;
      }
      if (dead) return;
      if (epInfo) renderEp();
      await refreshModels();
    })();
  }

  return {
    destroy() {
      dead = true;
      clearInterval(tick);
      stopLoop();
      if (busy) { try { engine.cancel(); } catch (e) { /* ignore */ } }
      if (player) player.destroy();
      if (mixer) mixer.destroy();
      if (ctx && ctx.close) { try { ctx.close(); } catch (e) { /* closed */ } }
      ctx = null; player = null; mixer = null;
      sheet.destroy();
      doc.removeEventListener('keydown', onKey);
      doc.removeEventListener('keyup', onKeyUp);
      if (win.removeEventListener) {
        win.removeEventListener('dragover', onWinOver); win.removeEventListener('drop', onWinDrop);
        win.removeEventListener('pagehide', onHide);
      }
      root.textContent = '';
    },
    // read-only view for tests and the console
    get state() { return root.dataset.state; },
    get player() { return player; },
    get mixer() { return mixer; },
  };
}
