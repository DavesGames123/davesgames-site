// ============================================================================
//  STEM SPLITTER  ·  ui/tests.mjs — node tests of the UI (CONTRACT 8.3)
// ----------------------------------------------------------------------------
//  Run: node stella-nova/pages/stem-splitter/ui/tests.mjs
//  No browser. The DOM is ui/fakedom.mjs. The engine is a fake object with
//  the client shape of CONTRACT 5.4. AudioContext and OfflineAudioContext
//  are fakes that record what the UI does. JSZip is the vendored file,
//  loaded with require().
//
//  models.js belongs to the MODEL role. When it is present, the app tests
//  use it; else they use STUB_MODELS (the shape of CONTRACT 5.1), and the
//  output says so.
//
//  GREP MAP
//    check / section ... the small harness
//    wav ............... header, round trip, clip rule, no-vocals sum, zip
//    gain .............. the gain rule truth table
//    player ............ fake AudioContext: start, seek, pause, gains
//    peaks ............. computePeaks of a known ramp
//    format ............ time, size and progress strings
//    fakeEngine ........ the engine double
//    app ............... the page flow on the fake DOM
//    css ............... style.css greps
//    syntax ............ node --check and ESM import of each ui/*.js
// ============================================================================
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = join(HERE, '..');
const VENDOR_ZIP = join(PAGE, '..', '..', 'vendor', 'jszip@3.10.1', 'dist', 'jszip.min.js');
const require = createRequire(import.meta.url);

let pass = 0, fail = 0, skip = 0;
const fails = [];
function section(name) { console.log(`\n== ${name}`); }
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ok   ${name}${detail ? '  ' + detail : ''}`); }
  else { fail++; fails.push(name); console.log(`  FAIL ${name}${detail ? '  ' + detail : ''}`); }
}
function skipped(name, why) { skip++; console.log(`  SKIP ${name} (${why})`); }
const settle = (ms = 5) => new Promise(r => setTimeout(r, ms));

const wav = await import('./wav.js');
const ex = await import('./export.js');
const wf = await import('./waveform.js');
const pl = await import('./player.js');
const fm = await import('./format.js');
const aio = await import('./audio-io.js');
const mx = await import('./mixer.js');

// ------------------------------------------------------------------- wav
section('wav');
{
  const N = 1000;
  const h = wav.wavHeader(N, 2, 44100);
  const exp = new Uint8Array(44), v = new DataView(exp.buffer);
  const put = (o, s) => [...s].forEach((c, i) => { exp[o + i] = c.charCodeAt(0); });
  put(0, 'RIFF'); v.setUint32(4, 36 + N * 4, true); put(8, 'WAVE'); put(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, 44100, true);
  v.setUint32(28, 176400, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); put(36, 'data'); v.setUint32(40, N * 4, true);
  check('header is 44 bytes, byte exact', h.length === 44 && h.every((b, i) => b === exp[i]), `RIFF size ${36 + N * 4}, data ${N * 4}`);
  const L = new Float32Array(N), R = new Float32Array(N);
  for (let i = 0; i < N; i++) { L[i] = 0.9 * Math.sin(2 * Math.PI * 440 * i / 44100); R[i] = -0.7 * Math.sin(2 * Math.PI * 220 * i / 44100); }
  const bytes = wav.encodeWav16([L, R]);
  check('file size = 44 + 4 x frames', bytes.length === 44 + N * 4, `${bytes.length} B`);
  check('encoded header = wavHeader', bytes.subarray(0, 44).every((b, i) => b === exp[i]));
  const back = wav.decodeWav16(bytes);
  let e = 0;
  for (let i = 0; i < N; i++) e = Math.max(e, Math.abs(back.data[0][i] - L[i]), Math.abs(back.data[1][i] - R[i]));
  check('16-bit round trip of a sine', e <= 1 / 32767 + 1e-9 && back.sampleRate === 44100 && back.channels === 2, `max abs ${e.toExponential(3)} <= ${(1 / 32767).toExponential(3)}`);
  const full = wav.encodeWav16([new Float32Array([1, -1, 2, -2])], 44100);
  const fv = new DataView(full.buffer, 44);
  check('full scale and clamp: 1 -> 32767, -1 -> -32767, 2 -> 32767', fv.getInt16(0, true) === 32767 && fv.getInt16(2, true) === -32767 && fv.getInt16(4, true) === 32767 && fv.getInt16(6, true) === -32767);

  const loud = [new Float32Array([0.2, -1.5, 0.75]), new Float32Array([1.0, 0.3, -0.1])];
  const r1 = wav.rescaleClip(loud);
  const peak1 = wav.peakAbs(r1.channels);
  check('clip rescale: peak 1.5 -> 1.5 / (1.01 x 1.5)', Math.abs(peak1 - 1.5 / (1.01 * 1.5)) <= 1e-6, `peak ${peak1.toFixed(7)}, scale ${r1.scale.toFixed(7)}`);
  const quiet = [new Float32Array([0.2, -0.5, 0.25]), new Float32Array([0.1, 0.3, -0.1])];
  const r2 = wav.rescaleClip(quiet);
  check('clip rescale: peak 0.5 unchanged', r2.scale === 1 && r2.channels.every((c, k) => c.every((x, i) => x === quiet[k][i])));
  check('clip rescale does not change its input', loud[0][1] === -1.5);
  const edge = wav.rescaleClip([new Float32Array([0.99])]);
  check('clip rescale: peak 0.99 (1.01 x 0.99 < 1) has scale 1', edge.scale === 1);

  // No vocals = sum of the other stems before rescale
  const n = 5000, mk = (f) => [Float32Array.from({ length: n }, (_, i) => f(i, 0)), Float32Array.from({ length: n }, (_, i) => f(i, 1))];
  const stems = {
    drums: mk((i, c) => Math.sin(i * 0.01 + c) * 0.5), bass: mk((i, c) => Math.cos(i * 0.002 + c) * 0.4),
    other: mk((i, c) => ((i * 7 + c) % 13) / 26 - 0.25), vocals: mk((i, c) => Math.sin(i * 0.05) * 0.9),
  };
  const nv = ex.sumStems(stems, ['vocals']);
  let ne = 0;
  for (let c = 0; c < 2; c++) for (let i = 0; i < n; i++) ne = Math.max(ne, Math.abs(nv[c][i] - (stems.drums[c][i] + stems.bass[c][i] + stems.other[c][i])));
  check('"No vocals" = drums + bass + other', ne <= 1e-6, `max abs ${ne.toExponential(2)}`);
  check('names: <song>_<stem>.wav, _no_vocals.wav, _stems.zip',
    ex.stemFileName('My Song', 'drums') === 'My Song_drums.wav' && ex.noVocalsName('My Song') === 'My Song_no_vocals.wav' && ex.zipName('My Song') === 'My Song_stems.zip');
  check('songBase strips the extension and unsafe characters',
    ex.songBase('a/b:c?.mp3') === 'a_b_c_' && ex.songBase('Track 01.flac') === 'Track 01' && ex.songBase('') === 'song' && ex.songBase('x'.repeat(200) + '.wav').length === 80,
    JSON.stringify([ex.songBase('a/b:c?.mp3'), ex.songBase('Track 01.flac')]));

  // zip with the vendored JSZip
  if (existsSync(VENDOR_ZIP)) {
    const JSZip = require(VENDOR_ZIP);
    const files = Object.keys(stems).map(k => ({ name: ex.stemFileName('My Song', k), bytes: wav.stemToWav(stems[k]) }));
    const zbytes = await ex.buildZip(JSZip, files, 'uint8array');
    const z = await JSZip.loadAsync(zbytes);
    const names = Object.keys(z.files).sort();
    let same = names.length === files.length;
    for (const f of files) {
      const got = await z.file(f.name).async('uint8array');
      same = same && got.length === f.bytes.length && got.every((b, i) => b === f.bytes[i]);
    }
    const stored = Object.values(z.files).every(f => f._data && f._data.compression && f._data.compression.magic === '\x00\x00');
    check('zip entries <song>_<stem>.wav, each byte-equal to the WAV', same, names.join(', '));
    const raw = files.reduce((s, f) => s + f.bytes.length, 0);
    check('zip is STORE (no compression)', stored && zbytes.length >= raw, `zip ${zbytes.length} B >= WAVs ${raw} B`);
  } else skipped('zip', 'vendor jszip absent');
}

// ------------------------------------------------------------------- gain
section('gain rule');
{
  let ok = 0, cases = 0;
  for (const mute of [false, true]) for (const solo of [false, true]) for (const anySolo of [false, true]) for (const volume of [1, 0.4]) {
    if (solo && !anySolo) continue; // a soloed track makes anySolo true
    cases++;
    const want = volume * (anySolo ? (solo ? 1 : 0) : (mute ? 0 : 1));
    if (pl.gainFor({ volume, mute, solo }, anySolo) === want) ok++;
  }
  // the 4 impossible rows (solo && !anySolo) still follow the formula
  for (const mute of [false, true]) for (const volume of [1, 0.4]) { cases++; if (pl.gainFor({ volume, mute, solo: true }, false) === volume * (mute ? 0 : 1)) ok++; }
  check('truth table mute x solo x anySolo x volume', ok === 16 && cases === 16, `${ok}/${cases}`);
  check('volume 0.25, no solo, no mute -> 0.25', pl.gainFor({ volume: 0.25, mute: false, solo: false }, false) === 0.25);
}

// ------------------------------------------------------------------- fakes
function fakeAudioCtx() {
  const log = { sources: [], gains: [], resumed: 0, closed: 0 };
  const param = v => ({ value: v, calls: [], setTargetAtTime(x, t, tc) { this.calls.push([x, t, tc]); this.value = x; } });
  const ctx = {
    currentTime: 0, state: 'running', sampleRate: 44100, destination: { id: 'dest' }, log,
    createGain() { const g = { gain: param(1), out: null, connect(n) { this.out = n; }, disconnect() { this.out = null; } }; log.gains.push(g); return g; },
    createBufferSource() {
      const s = { buffer: null, started: null, stopped: false, out: null, onended: null,
        connect(n) { this.out = n; }, disconnect() { this.out = null; },
        start(when, offset) { this.started = { when, offset }; }, stop() { this.stopped = true; } };
      log.sources.push(s); return s;
    },
    createBuffer(nc, len, sr) {
      const d = Array.from({ length: nc }, () => new Float32Array(len));
      return { numberOfChannels: nc, length: len, sampleRate: sr, duration: len / sr, getChannelData: c => d[c], copyToChannel(a, c) { d[c].set(a); } };
    },
    resume() { log.resumed++; this.state = 'running'; return Promise.resolve(); },
    close() { log.closed++; this.state = 'closed'; return Promise.resolve(); },
  };
  return ctx;
}

// ------------------------------------------------------------------- player
section('player (fake AudioContext)');
{
  const ctx = fakeAudioCtx();
  const buf = s => ctx.createBuffer(2, Math.round(s * 44100), 44100);
  const p = pl.createPlayer({ ctx, tracks: [{ id: 'drums', buffer: buf(10) }, { id: 'vocals', buffer: buf(10) }, { id: 'original', buffer: buf(10), mute: true }] });
  check('duration = longest track', p.duration === 10);
  check('initial gains: original muted', JSON.stringify(p.gains()) === '{"drums":1,"vocals":1,"original":0}', JSON.stringify(p.gains()));
  ctx.currentTime = 1;
  p.play();
  const live = () => ctx.log.sources.filter(s => !s.stopped);
  let L = live();
  const when1 = 1 + pl.START_DELAY;
  check('play starts all 3 sources with one `when` and one `offset`', L.length === 3 && L.every(s => s.started.when === when1 && s.started.offset === 0), JSON.stringify(L.map(s => s.started)));
  check('each source goes to its own gain node', L.every(s => s.out && s.out.gain));
  ctx.currentTime = 3.05;
  check('position = offset + (currentTime - when)', p.position() === 0 + (3.05 - when1), `${p.position()}`);
  ctx.currentTime = 4;
  p.seek(5);
  const old = ctx.log.sources.slice(0, 3);
  L = live();
  check('seek stops all old sources', old.every(s => s.stopped));
  check('seek restarts all with the new offset and one `when`', L.length === 3 && L.every(s => s.started.offset === 5 && s.started.when === 4 + pl.START_DELAY));
  ctx.currentTime = 6;
  const posBefore = 5 + (6 - (4 + pl.START_DELAY));
  p.pause();
  check('pause stops all and keeps the position', live().length === 0 && p.position() === posBefore && !p.playing, `${p.position()}`);
  ctx.currentTime = 9;
  check('position does not move while paused', p.position() === posBefore);
  p.seek(2);
  check('seek while paused starts nothing', live().length === 0 && p.position() === 2);
  p.play();
  check('play after seek uses the new offset', live().every(s => s.started.offset === 2) && live().length === 3);
  ctx.currentTime = 100;
  check('position is clamped to the duration', p.position() === 10);
  p.set('drums', { solo: true });
  const g = p.tracks.find(t => t.id === 'vocals').gain.gain;
  const last = g.calls[g.calls.length - 1];
  check('solo drums -> vocals target 0 with setTargetAtTime(v, now, 0.01)', last[0] === 0 && last[1] === 100 && last[2] === 0.01, JSON.stringify(last));
  check('gains after solo drums', JSON.stringify(p.gains()) === '{"drums":1,"vocals":0,"original":0}');
  p.set('drums', { solo: false, volume: 0.5 });
  check('volume 0.5 on drums', p.gains().drums === 0.5);
  p.destroy();
  check('destroy stops all sources', live().length === 0);
  ctx.state = 'suspended';
  const p2 = pl.createPlayer({ ctx, tracks: [{ id: 'a', buffer: buf(1) }] });
  p2.play();
  check('play resumes a suspended context', ctx.log.resumed === 1);
  p2.destroy();
  // Pause within START_DELAY of play / seek must not move the position back.
  const p3 = pl.createPlayer({ ctx, tracks: [{ id: 'a', buffer: buf(10) }] });
  ctx.currentTime = 20;
  p3.seek(2); p3.play(); p3.pause();
  const a1 = p3.position();
  p3.play(); p3.pause();
  const a2 = p3.position();
  check('quick play / pause keeps the position (no step back by START_DELAY)', a1 === 2 && a2 === 2, `${a1}, ${a2}`);
  p3.destroy();
}

// ------------------------------------------------------------------- peaks
section('peaks');
{
  const n = 1000, ramp = Float32Array.from({ length: n }, (_, i) => i / (n - 1) * 2 - 1);
  const P = wf.computePeaks(ramp, 10);
  let ok = true;
  for (let c = 0; c < 10; c++) {
    const a = c * 100, b = a + 99;
    if (P.min[c] !== ramp[a] || P.max[c] !== ramp[b]) ok = false;
  }
  check('ramp, 10 columns: min = first, max = last sample of each column', ok, `col0 [${P.min[0]}, ${P.max[0]}]`);
  const odd = wf.computePeaks(ramp, 7);
  let ok2 = true;
  for (let c = 0; c < 7; c++) { const a = Math.floor(c * n / 7), b = Math.floor((c + 1) * n / 7) - 1; if (odd.min[c] !== ramp[a] || odd.max[c] !== ramp[b]) ok2 = false; }
  check('ramp, 7 columns (uneven split)', ok2);
  const tiny = wf.computePeaks(new Float32Array([0.5, -0.25, 1]), 6);
  check('more columns than samples: each column takes one sample', [...tiny.max].join() === '0.5,0.5,-0.25,-0.25,1,1', [...tiny.max].join());
  const st = wf.computePeaks([new Float32Array([0, 0.5]), new Float32Array([-0.75, 0])], 1);
  check('stereo: min and max over both channels', st.min[0] === -0.75 && st.max[0] === 0.5);
}

// ------------------------------------------------------------------- format
section('format');
{
  const T = [[42, '0:42'], [725, '12:05'], [0, '0:00'], [59.6, '1:00'], [3600, '1:00:00'], [3725, '1:02:05'], [-1, '0:00'], [NaN, '0:00']];
  for (const [s, want] of T) check(`fmtTime(${s}) = "${want}"`, fm.fmtTime(s) === want, `got "${fm.fmtTime(s)}"`);
  check('fmtMB(90765552) = "90.8 MB"', fm.fmtMB(90765552) === '90.8 MB', fm.fmtMB(90765552));
  check('phase download', fm.phaseText({ phase: 'download', loaded: 12.34e6, total: 90.7e6 }) === 'Downloading model 12.3 of 90.7 MB', fm.phaseText({ phase: 'download', loaded: 12.34e6, total: 90.7e6 }));
  check('phase verify / session', fm.phaseText({ phase: 'verify' }) === 'Checking the model download' && fm.phaseText({ phase: 'session' }) === 'Preparing the model');
  check('phase separate: the segment in work is done + 1', fm.phaseText({ phase: 'separate', done: 3, total: 42 }) === 'Separating segment 4 of 42');
  check('phase separate: done 0 -> segment 1; done = total -> last', fm.phaseText({ phase: 'separate', done: 0, total: 42 }) === 'Separating segment 1 of 42' && fm.phaseText({ phase: 'separate', done: 42, total: 42 }) === 'Separating segment 42 of 42');
  check('fraction separate done 0 = 0', fm.phaseFraction({ phase: 'separate', done: 0, total: 42 }) === 0);
  check('bar fraction', fm.phaseFraction({ phase: 'separate', done: 21, total: 42 }) === 0.5 && fm.phaseFraction({ phase: 'verify' }) === null);
  check('times "0:42 elapsed · 12:05 left"', fm.timesText(42000, 725000) === '0:42 elapsed · 12:05 left', fm.timesText(42000, 725000));
  check('times with no estimate', fm.timesText(5000, null) === '0:05 elapsed');
  check('EP text', fm.epText('webgpu') === 'GPU (WebGPU)' && fm.epText('wasm') === 'CPU (slower)');
}

// ------------------------------------------------------------------- audio-io
section('audio-io');
{
  const mono = { length: 4, numberOfChannels: 1, sampleRate: 44100, getChannelData: () => new Float32Array([1, 2, 3, 4]) };
  const [l, r] = aio.toStereo(mono);
  check('1 channel -> copy to L and R', l.join() === '1,2,3,4' && r.join() === '1,2,3,4' && l !== r);
  const quad = { length: 2, numberOfChannels: 4, sampleRate: 44100, getChannelData: c => new Float32Array([c, c]) };
  const [ql, qr] = aio.toStereo(quad);
  check('4 channels -> the first two', ql.join() === '0,0' && qr.join() === '1,1');
  check('length limit: 20 min desktop, 8 min phone', aio.checkLength(20 * 60, false) === null && !!aio.checkLength(20 * 60 + 1, false) && aio.checkLength(8 * 60, true) === null && /8 minutes/.test(aio.checkLength(8 * 60 + 1, true)));
  check('phone limit needs a coarse pointer and width < 700',
    aio.isPhoneLimit({ matchMedia: () => ({ matches: true }), innerWidth: 400 }) === true &&
    aio.isPhoneLimit({ matchMedia: () => ({ matches: true }), innerWidth: 900 }) === false &&
    aio.isPhoneLimit({ matchMedia: () => ({ matches: false }), innerWidth: 400 }) === false);
  let code = null;
  try { await aio.decodeSong(new ArrayBuffer(8), { win: {} }); } catch (e) { code = e.code; }
  check('no OfflineAudioContext -> code decode', code === 'decode');
}

// ------------------------------------------------------------------- mixer presets
section('mixer presets');
{
  const s0 = mx.initialStates(['drums', 'bass', 'other', 'vocals', 'original']);
  check('Original muted at the start, stems not', s0.original.mute && !s0.vocals.mute && !s0.drums.mute);
  const k = mx.applyPreset({ ...s0, drums: { ...s0.drums, solo: true, mute: true } }, 'karaoke');
  check('Karaoke: vocals muted, solo cleared, others unmuted', k.vocals.mute && !k.drums.mute && !k.drums.solo && k.original.mute && Object.values(k).every(s => !s.solo));
  const v = mx.applyPreset(k, 'vocals');
  check('Vocals only: solo on vocals only', v.vocals.solo && Object.entries(v).every(([id, s]) => s.solo === (id === 'vocals')));
  const a = mx.applyPreset(v, 'all');
  check('All: stems unmuted, Original muted, no solo', Object.entries(a).every(([id, s]) => !s.solo && s.mute === (id === 'original')));
  check('presets keep the volume', mx.applyPreset({ x: { volume: 0.3, mute: false, solo: false } }, 'all').x.volume === 0.3);
  check('stem colours of CONTRACT 6.3', mx.STEM_COLORS.drums === '#ff8a5c' && mx.STEM_COLORS.bass === '#7a9cff' && mx.STEM_COLORS.other === '#b48cff' &&
    mx.STEM_COLORS.vocals === '#ff8ac2' && mx.STEM_COLORS.guitar === '#ffd166' && mx.STEM_COLORS.piano === '#5fd3a8' && mx.STEM_COLORS.original === '#9aa3b2');
}

// ------------------------------------------------------------------- app
const STUB_MODELS = {
  htdemucs: { id: 'htdemucs', label: '4 stems', note: 'Demucs v4 (htdemucs), the default model', stems: ['drums', 'bass', 'other', 'vocals'],
    graph: { file: 'models/htdemucs.onnx', bytes: 6624641, sha256: '0'.repeat(64) },
    weights: { file: 'models/955717e8-8726e21a.th', name: '955717e8-8726e21a.th', bytes: 84141911, sha256: '8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4' } },
  htdemucs_6s: { id: 'htdemucs_6s', label: '6 stems', note: 'adds guitar, piano', stems: ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'],
    graph: { file: 'models/htdemucs_6s.onnx', bytes: 5193185, sha256: '0'.repeat(64) },
    weights: { file: 'models/5c90dfd2-34c22ccb.th', name: '5c90dfd2-34c22ccb.th', bytes: 54996327, sha256: '34c22ccb381c6f9fdbf324f04e1e2fe21aaaf293f5ded163a162697ff9a02ddd' } },
};

function deferred() { let res, rej; const p = new Promise((a, b) => { res = a; rej = b; }); return { p, res, rej }; }

// The engine double. opts.loadError / opts.sepError: errors to throw.
function fakeEngine(models, opts = {}) {
  const calls = [];
  const cached = {};
  let gate = null, cancelled = false, loadGate = null;
  const eng = {
    calls, cached,
    async init(o) { calls.push(['init', o]); if (opts.initError) throw opts.initError; return { ep: opts.ep || 'webgpu', gpu: true, threads: 1, isolated: false }; },
    async models() {
      calls.push(['models']);
      return Object.values(models).map(m => ({ id: m.id, label: m.label, note: m.note, stems: m.stems, bytes: m.graph.bytes + m.weights.bytes, cached: !!cached[m.id] }));
    },
    async load(id, onP) {
      calls.push(['load', id]);
      onP({ op: 'progress', phase: 'download', model: id, loaded: 45e6, total: 90.7e6 });
      if (opts.loadGate) { loadGate = deferred(); await loadGate.p; }
      onP({ op: 'progress', phase: 'verify', model: id });
      onP({ op: 'progress', phase: 'session', model: id });
      if (opts.loadError) throw opts.loadError;
      cached[id] = true;
      return { ep: opts.ep || 'webgpu', fallback: opts.fallback || null, fromCache: false };
    },
    separate({ modelId, left, right, quality, onProgress }) {
      calls.push(['separate', modelId, quality, left.length, right.length, left, right]);
      cancelled = false;
      gate = deferred();
      onProgress({ op: 'progress', phase: 'separate', model: modelId, done: 1, total: 3, elapsedMs: 4000, etaMs: 8000 });
      return gate.p.then(() => {
        if (cancelled) { const e = new Error('cancelled'); e.code = 'cancelled'; throw e; }
        if (opts.sepError) throw opts.sepError;
        const stems = {};
        models[modelId].stems.forEach((n, k) => { stems[n] = [left.map(x => x * (k + 1) * 0.1), right.map(x => x * (k + 1) * 0.1)]; });
        left.fill(NaN); right.fill(NaN);   // the worker owns (and here spoils) the arrays it got
        return { stems, ms: 12000, ep: opts.sepEp || opts.ep || 'webgpu', fallback: opts.sepFallback || null, segments: 3 };
      });
    },
    finish() { if (gate) gate.res(); },
    cancel() { calls.push(['cancel']); cancelled = true; if (gate) gate.res(); },
    async evict(id) { calls.push(['evict', id]); cached[id] = false; },
    // like engine/client.js: a pending call rejects as cancelled
    terminate() { calls.push(['terminate']); if (loadGate) { const e = new Error('engine stopped'); e.code = 'cancelled'; loadGate.rej(e); loadGate = null; } },
  };
  return eng;
}

// A file: the fake decoder makes a sine of `seconds` (mono), or fails when
// bad is true.
function fakeFile(name, seconds, bad = false) {
  return { name, async arrayBuffer() { const b = new ArrayBuffer(8); const v = new DataView(b); v.setFloat64(0, bad ? -1 : seconds); return b; } };
}
class FakeOffline {
  constructor(ch, len, sr) { this.sampleRate = sr; }
  decodeAudioData(ab) {
    const s = new DataView(ab).getFloat64(0);
    if (s < 0) return Promise.reject(new Error('EncodingError: unable to decode'));
    const n = Math.round(s * 44100), d = new Float32Array(n);
    if (n < 2e6) for (let i = 0; i < n; i++) d[i] = 0.5 * Math.sin(2 * Math.PI * 220 * i / 44100);
    return Promise.resolve({ length: n, numberOfChannels: 1, sampleRate: 44100, duration: n / 44100, getChannelData: () => d });
  }
}

section('app (fake DOM, fake engine, fake audio)');
if (!existsSync(join(HERE, 'app.js'))) skipped('app flow', 'ui/app.js absent');
else {
  const { installDom, mkEvent, fireWindow } = await import('./fakedom.mjs');
  let MODELS = STUB_MODELS, DEFAULT = 'htdemucs', modelsSrc = 'STUB_MODELS (models.js absent)';
  if (existsSync(join(PAGE, 'models.js'))) {
    try { const m = await import(pathToFileURL(join(PAGE, 'models.js')).href); MODELS = m.MODELS; DEFAULT = m.DEFAULT_MODEL; modelsSrc = 'models.js'; }
    catch (e) { modelsSrc = `STUB_MODELS (models.js import failed: ${e.message})`; }
  }
  console.log(`  (models: ${modelsSrc})`);
  const JSZip = existsSync(VENDOR_ZIP) ? require(VENDOR_ZIP) : null;
  const { mountApp, classifyError, ERROR_TEXT } = await import('./app.js');

  function boot({ engineOpts = {}, phone = false, width = 1400, win = null } = {}) {
    const doc = installDom({ phone, width });
    if (phone) { globalThis.matchMedia = q => ({ matches: /pointer: coarse|max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} }); }
    globalThis.OfflineAudioContext = FakeOffline;
    const ctxs = [];
    globalThis.AudioContext = function () { const c = fakeAudioCtx(); ctxs.push(c); return c; };
    delete globalThis.__snRelease;
    const root = doc.createElement('div'); root.id = 'app'; doc.body.appendChild(root);
    const engine = fakeEngine(MODELS, engineOpts);
    const saved = [];
    const app = mountApp(root, { engine, models: MODELS, defaultModel: DEFAULT, jszip: JSZip, win: win || globalThis, save: (blob, name) => saved.push({ blob, name }) });
    const $ = s => root.querySelector(s), $$ = s => root.querySelectorAll(s);
    const pick = async (file) => { const inp = $('.ss-file'); inp.files = [file]; inp.dispatchEvent(mkEvent('change')); await settle(10); };
    return { doc, root, engine, app, saved, ctxs, $, $$, pick };
  }

  // --- the main flow
  const T = boot();
  await settle(10);
  const { root, engine, $, $$ } = T;
  check('idle: state idle, Separate off', root.dataset.state === 'idle' && $('.ss-go').disabled === true);
  check('drop zone text and privacy line', /Drop a song or choose a file/.test($('.ss-drop-big').textContent) && $('.ss-drop-privacy').textContent === 'Your audio stays on this device. Nothing is uploaded.');
  check('file input accept list', $('.ss-file').getAttribute('accept') === 'audio/*,.mp3,.wav,.flac,.ogg,.m4a,.aac,.opus');
  check('init then models were called', engine.calls[0][0] === 'init' && engine.calls[0][1].ep === 'auto' && engine.calls.some(c => c[0] === 'models'));
  check('EP line says GPU (WebGPU)', /GPU \(WebGPU\)/.test($('.ss-ep').textContent), $('.ss-ep').textContent);
  const mrows = $$('.ss-model');
  const sizeTxt = mrows.map(r => r.querySelector('.ss-model-meta').textContent);
  check('two model rows with size and "not downloaded"', mrows.length === 2 && sizeTxt.every(t => /MB · not downloaded$/.test(t)), sizeTxt.join(' | '));
  check('6-stem row label and piano note', /6 stems \(adds guitar, piano\)/.test(mrows[1].textContent) && /piano stem is not good/.test(mrows[1].textContent));
  check('default model is selected', mrows[0].classList.contains('on') && mrows[0].dataset.model === DEFAULT);
  check('quality Standard selected; Best says 2x time', $('.ss-q[data-quality="standard"]').classList.contains('on') && /2x time/.test($('.ss-q[data-quality="best"]').textContent));
  check('mixer empty state shows', !$('.ss-empty').hidden && $('.ss-presets').hidden && $('.ss-transport').hidden);
  check('choice line (phone) names model, quality, EP', $('.ss-choice').textContent === '4 stems · Standard · GPU (WebGPU) — change', $('.ss-choice').textContent);
  $('.ss-choice').click();
  check('choice line opens the settings sheet', $('#ss-settings').classList.contains('open'));
  $('.ss-grip').click();
  check('grip tap closes the sheet', !$('#ss-settings').classList.contains('open'));

  await T.pick(fakeFile('My Song.mp3', 3));
  check('file -> ready, Separate on', root.dataset.state === 'ready' && $('.ss-go').disabled === false);
  const info = $('.ss-drop-info').textContent;
  check('song info: name, duration, rate, mono source', /My Song\.mp3/.test(info) && /0:03/.test(info) && /44 100 Hz/.test(info) && /mono source/.test(info), info);

  $('.ss-q[data-quality="best"]').click();
  $('.ss-go').click();
  await settle(10);
  check('Separate -> working, progress visible', root.dataset.state === 'working' && !$('.ss-progress').hidden);
  check('phase text: Separating segment 2 of 3', $('.ss-phase').textContent === 'Separating segment 2 of 3', $('.ss-phase').textContent);
  check('times show elapsed and left', /^0:0\d elapsed · 0:0[78] left$/.test($('.ss-times').textContent), $('.ss-times').textContent);
  check('bar at 1/3', $('.ss-bar-fill').style.width === '33.3%', $('.ss-bar-fill').style.width);
  const sep = engine.calls.find(c => c[0] === 'separate');
  check('engine got load(model) then separate(model, quality best, full length)', engine.calls.some(c => c[0] === 'load' && c[1] === DEFAULT) && sep[1] === DEFAULT && sep[2] === 'best' && sep[3] === 3 * 44100 && sep[4] === 3 * 44100);
  check('controls are locked while working', $('.ss-go').disabled && $('.ss-q').disabled && $('.ss-model-pick').disabled);

  engine.finish();
  await settle(20);
  const stems = MODELS[DEFAULT].stems;
  check('done: state done, progress hidden', root.dataset.state === 'done' && $('.ss-progress').hidden);
  const rows = $$('.ss-row');
  check(`mixer: ${stems.length} stem rows + Original`, rows.length === stems.length + 1 && rows.map(r => r.dataset.stem).join() === [...stems, 'original'].join(), rows.map(r => r.dataset.stem).join());
  check('Original row muted at the start', $('.ss-row[data-stem="original"] .ss-mute').classList.contains('on') && $('.ss-row[data-stem="original"]').classList.contains('silent'));
  check('each row has a waveform canvas, a play head, M, S, volume', rows.every(r => r.querySelector('canvas') && r.querySelector('.ss-head') && r.querySelector('.ss-mute') && r.querySelector('.ss-solo') && r.querySelector('.ss-vol')));
  check('waveforms are drawn', rows.every(r => r.querySelector('canvas').getContext('2d').rects > 0));
  check('row colour from STEM_COLORS', $('.ss-row[data-stem="vocals"]').style.getPropertyValue('--stem') === '#ff8ac2');
  check('presets and transport show', !$('.ss-presets').hidden && !$('.ss-transport').hidden && $('.ss-empty').hidden);
  const dl = $$('.ss-dl').map(b => b.dataset.dl);
  check('downloads: each stem, No vocals, All stems (zip)', dl.join() === [...stems, 'no_vocals', 'zip'].join(), dl.join());
  check('done message', /^Done in 0:12 on GPU \(WebGPU\), 3 segments\.$/.test($('.ss-msg').textContent), $('.ss-msg').textContent);
  check('model shows "downloaded" and Remove download', /downloaded$/.test($('.ss-model[data-model="' + DEFAULT + '"] .ss-model-meta').textContent) && !/not downloaded/.test($('.ss-model[data-model="' + DEFAULT + '"] .ss-model-meta').textContent) && !!$('.ss-model[data-model="' + DEFAULT + '"] .ss-model-rm'));
  const origBuf = T.app.player.tracks.find(t => t.id === 'original').buffer.getChannelData(0);
  check('song arrays sent to the engine are copies: Original row keeps the song', Number.isNaN(sep[5][100]) && Math.abs(origBuf[100] - 0.5 * Math.sin(2 * Math.PI * 220 * 100 / 44100)) < 1e-7, `orig[100] = ${origBuf[100]}`);

  // play
  const ctx = T.ctxs[0];
  check('one AudioContext', T.ctxs.length === 1);
  ctx.currentTime = 2;
  $('.ss-play').click();
  const live = () => ctx.log.sources.filter(s => !s.stopped);
  let L = live();
  check(`play starts ${rows.length} sources, same when and offset`, L.length === rows.length && L.every(s => s.started.when === 2.05 && s.started.offset === 0));
  check('play button shows pause', $('.ss-play').getAttribute('aria-label') === 'Pause');
  const gains = () => T.app.player.gains();
  check('gains: stems 1, Original 0', stems.every(n => gains()[n] === 1) && gains().original === 0, JSON.stringify(gains()));
  $('.ss-preset[data-preset="karaoke"]').click();
  check('Karaoke: vocals 0, others 1, Original 0', gains().vocals === 0 && stems.filter(n => n !== 'vocals').every(n => gains()[n] === 1) && gains().original === 0, JSON.stringify(gains()));
  $('.ss-preset[data-preset="vocals"]').click();
  check('Vocals only: vocals 1, all else 0', Object.entries(gains()).every(([k, v]) => v === (k === 'vocals' ? 1 : 0)), JSON.stringify(gains()));
  $('.ss-preset[data-preset="all"]').click();
  check('All: stems 1, Original 0', stems.every(n => gains()[n] === 1) && gains().original === 0);
  $('.ss-row[data-stem="bass"] .ss-solo').click();
  check('solo bass button -> only bass sounds', Object.entries(gains()).every(([k, v]) => v === (k === 'bass' ? 1 : 0)) && $('.ss-row[data-stem="drums"]').classList.contains('silent'));
  $('.ss-row[data-stem="bass"] .ss-solo').click();
  const vol = $('.ss-row[data-stem="drums"] .ss-vol'); vol.value = '40'; vol.dispatchEvent(mkEvent('input'));
  check('volume slider 40 -> drums gain 0.4', Math.abs(gains().drums - 0.4) < 1e-12);
  $('.ss-row[data-stem="original"] .ss-mute').click();
  check('unmute Original -> gain 1', gains().original === 1);

  // seek bar
  ctx.currentTime = 3;
  const seek = $('.ss-seek'); seek.value = '500'; seek.dispatchEvent(mkEvent('change'));
  L = live();
  check('seek bar to 50% restarts all sources at 1.5 s', L.length === rows.length && L.every(s => s.started.offset === 1.5 && s.started.when === 3.05), JSON.stringify(L[0] && L[0].started));
  // waveform click seek
  ctx.currentTime = 4;
  $('.ss-row[data-stem="drums"] .ss-wave').dispatchEvent(mkEvent('pointerdown', { clientX: 75, pointerId: 1, pointerType: 'mouse' }));
  $('.ss-row[data-stem="drums"] .ss-wave').dispatchEvent(mkEvent('pointerup', { clientX: 75, pointerId: 1, pointerType: 'mouse' }));
  L = live();
  check('waveform click at 25% seeks to 0.75 s', L.every(s => s.started.offset === 0.75));
  // Touch: a scroll that starts on a waveform must not seek; a tap seeks;
  // a horizontal drag scrubs with at most one restart per frame.
  {
    const w = $('.ss-row[data-stem="bass"] .ss-wave');
    const n0 = ctx.log.sources.length;
    const tp = (type, x, y) => w.dispatchEvent(mkEvent(type, { clientX: x, clientY: y, pointerId: 3, pointerType: 'touch' }));
    tp('pointerdown', 150, 10);
    const afterDown = ctx.log.sources.length - n0;
    tp('pointermove', 152, 40); tp('pointermove', 153, 90); tp('pointercancel', 153, 90);
    const afterScroll = ctx.log.sources.length - n0;
    check('touch: pointerdown and a vertical scroll do not seek', afterDown === 0 && afterScroll === 0, `${afterDown} and ${afterScroll} new sources`);
    tp('pointerdown', 150, 10); tp('pointerup', 152, 12);
    L = live();
    check('touch: a tap at 50% seeks to 1.5 s', ctx.log.sources.length - n0 === rows.length && L.every(s => s.started.offset === 1.5), `${ctx.log.sources.length - n0} new sources`);
    const n1 = ctx.log.sources.length;
    tp('pointerdown', 0, 10);
    for (const x of [30, 60, 100, 150, 225]) tp('pointermove', x, 12);
    tp('pointerup', 225, 12);
    await settle(10);
    L = live();
    check('touch: a horizontal drag scrubs, one restart, ends at 75% = 2.25 s', ctx.log.sources.length - n1 === rows.length && L.every(s => s.started.offset === 2.25), `${(ctx.log.sources.length - n1) / rows.length} restarts, offset ${L[0] && L[0].started.offset}`);
    ctx.currentTime = 4;
    $('.ss-seek').value = '250'; $('.ss-seek').dispatchEvent(mkEvent('change'));
  }
  // A tap on the seek bar with no value change fires no `change`; the bar
  // must still follow the play position after it.
  seek.dispatchEvent(mkEvent('pointerdown', { pointerId: 2 }));
  seek.dispatchEvent(mkEvent('pointerup', { pointerId: 2 }));
  ctx.currentTime = 5.05;
  // Space
  T.doc.dispatchEvent(mkEvent('keydown', { key: ' ', code: 'Space', target: T.doc.body }));
  check('Space pauses', !T.app.player.playing && live().length === 0);
  check('seek bar follows the position after a tap with no change', seek.value === String(Math.round(1.75 / 3 * 1000)), `value ${seek.value}, want ${Math.round(1.75 / 3 * 1000)}`);
  const txt = T.doc.createElement('input'); txt.type = 'text';
  T.doc.dispatchEvent(mkEvent('keydown', { key: ' ', code: 'Space', target: txt }));
  check('Space in a text field does nothing', !T.app.player.playing);
  T.doc.dispatchEvent(mkEvent('keydown', { key: ' ', code: 'Space', target: T.doc.body }));
  check('Space plays again', T.app.player.playing);
  const up = mkEvent('keyup', { key: ' ', code: 'Space', target: T.doc.body });
  T.doc.dispatchEvent(up);
  check('Space keyup is cancelled after a handled keydown', up.defaultPrevented === true);
  T.doc.dispatchEvent(mkEvent('keydown', { key: ' ', code: 'Space', repeat: true, target: T.doc.body }));
  check('a key repeat does not toggle', T.app.player.playing);
  fireWindow('pagehide');
  check('pagehide pauses', !T.app.player.playing && live().length === 0);
  check('time label m:ss / m:ss', /^\d:\d\d \/ 0:03$/.test($('.ss-time').textContent), $('.ss-time').textContent);

  // downloads
  $('.ss-dl[data-dl="drums"]').click();
  await settle(20);
  $('.ss-dl[data-dl="no_vocals"]').click();
  await settle(20);
  $('.ss-dl[data-dl="zip"]').click();
  await settle(150);
  const names = T.saved.map(s => s.name);
  check('download names', names.join() === 'My Song_drums.wav,My Song_no_vocals.wav,My Song_stems.zip', names.join());
  check('drums WAV blob = 44 + 4 x frames', T.saved[0] && T.saved[0].blob.size === 44 + 4 * 3 * 44100, T.saved[0] && `${T.saved[0].blob.size} B`);
  if (JSZip && T.saved[2]) {
    const z = await JSZip.loadAsync(new Uint8Array(await T.saved[2].blob.arrayBuffer()));
    check('zip holds one WAV per stem', Object.keys(z.files).sort().join() === stems.map(n => `My Song_${n}.wav`).sort().join(), Object.keys(z.files).join());
  }
  const drumsBytes = new Uint8Array(await T.saved[0].blob.arrayBuffer());
  const dd = wav.decodeWav16(drumsBytes);
  check('drums WAV holds the drums stem', Math.abs(dd.data[0][100] - 0.05 * Math.sin(2 * Math.PI * 220 * 100 / 44100)) <= 1 / 32767, `${dd.data[0][100]}`);

  // remove download
  $('.ss-model[data-model="' + DEFAULT + '"] .ss-model-rm').click();
  await settle(10);
  check('Remove download -> evict + "not downloaded"', engine.calls.some(c => c[0] === 'evict' && c[1] === DEFAULT) && /not downloaded$/.test($('.ss-model[data-model="' + DEFAULT + '"] .ss-model-meta').textContent));

  // cancel on a second run
  $('.ss-go').click();
  await settle(10);
  check('second run: working', root.dataset.state === 'working');
  $('.ss-cancel').click();
  check('Cancel calls engine.cancel and says stopping', engine.calls.some(c => c[0] === 'cancel') && $('.ss-cancel').disabled && /Stopping/.test($('.ss-phase').textContent));
  await settle(10);
  check('cancelled: back to done (old stems kept), "Cancelled."', root.dataset.state === 'done' && $('.ss-msg').textContent === 'Cancelled.' && $('.ss-error').hidden && $('.ss-progress').hidden);

  // sheet
  const set = $('#ss-settings'), gear = $('.ss-dock-settings');
  gear.click();
  check('settings button opens the sheet', set.classList.contains('open') && gear.getAttribute('aria-expanded') === 'true');
  T.doc.dispatchEvent(mkEvent('keydown', { key: 'Escape', target: T.doc.body }));
  check('Escape closes the sheet', !set.classList.contains('open') && gear.getAttribute('aria-expanded') === 'false');

  // new file clears the old result
  await T.pick(fakeFile('Other.wav', 2));
  check('new file clears the mixer, state ready', root.dataset.state === 'ready' && $$('.ss-row').length === 0 && !$('.ss-empty').hidden);

  // __snRelease chain
  check('window.__snRelease is set', typeof globalThis.__snRelease === 'function');
  T.app.destroy();
  check('destroy empties the root', root.childNodes.length === 0);
  await settle(5);

  // --- errors
  {
    const E = boot({ engineOpts: { loadError: Object.assign(new Error('Failed to fetch'), { code: 'net' }) } });
    await settle(10); await E.pick(fakeFile('a.mp3', 1)); E.$('.ss-go').click(); await settle(20);
    check('net error: message, state ready', E.$('.ss-error').dataset.code === 'net' && !E.$('.ss-error').hidden && E.root.dataset.state === 'ready' && /offline/.test(E.$('.ss-error').textContent), E.$('.ss-error').textContent);
    E.app.destroy();
  }
  {
    const E = boot({ engineOpts: { sepError: Object.assign(new Error('RangeError: Array buffer allocation failed'), { code: 'oom' }) } });
    await settle(10); await E.pick(fakeFile('a.mp3', 1)); E.$('.ss-go').click(); await settle(10); E.engine.finish(); await settle(20);
    check('oom code -> memory message with the 3 hints', E.$('.ss-error').dataset.code === 'oom' && E.$('.ss-error').textContent === ERROR_TEXT.oom && /4-stem model/.test(ERROR_TEXT.oom) && /shorter song/.test(ERROR_TEXT.oom) && /WebGPU/.test(ERROR_TEXT.oom));
    E.app.destroy();
  }
  {
    const E = boot({ engineOpts: { loadError: Object.assign(new Error('sha256 mismatch'), { code: 'hash' }) } });
    await settle(10); await E.pick(fakeFile('a.mp3', 1)); E.$('.ss-go').click(); await settle(20);
    check('hash error message', E.$('.ss-error').dataset.code === 'hash' && /checksum/.test(E.$('.ss-error').textContent));
    E.app.destroy();
  }
  {
    const E = boot({ engineOpts: { sepError: Object.assign(new Error('Non-zero status code returned while running Conv node'), { code: 'run' }) } });
    await settle(10); await E.pick(fakeFile('a.mp3', 1)); E.$('.ss-go').click(); await settle(10); E.engine.finish(); await settle(20);
    check('run error shows the engine text', E.$('.ss-error').dataset.code === 'run' && /Conv node/.test(E.$('.ss-error').textContent), E.$('.ss-error').textContent);
    E.app.destroy();
  }
  {
    const E = boot();
    await settle(10); await E.pick(fakeFile('bad.xyz', 0, true));
    check('decode error: message, state idle, Separate off', E.$('.ss-error').dataset.code === 'decode' && E.root.dataset.state === 'idle' && E.$('.ss-go').disabled && /cannot decode/.test(E.$('.ss-error').textContent));
    await E.pick(fakeFile('ok.mp3', 1));
    check('a good file after an error clears the error', E.$('.ss-error').hidden && E.root.dataset.state === 'ready');
    E.app.destroy();
  }
  {
    const E = boot({ engineOpts: { ep: 'wasm', fallback: 'webgpu session failed: no adapter' } });
    await settle(10);
    check('wasm EP: "CPU (slower)"', /CPU \(slower\)/.test(E.$('.ss-ep').textContent));
    await E.pick(fakeFile('a.mp3', 1)); E.$('.ss-go').click(); await settle(10);
    check('fallback is shown after load', /GPU failed/.test(E.$('.ss-ep').textContent), E.$('.ss-ep').textContent);
    E.engine.finish(); await settle(20);
    check('done on CPU message', /on CPU \(slower\)/.test(E.$('.ss-msg').textContent), E.$('.ss-msg').textContent);
    E.app.destroy();
  }
  {
    const E = boot({ phone: true, width: 390 });
    globalThis.innerWidth = 390;
    await settle(10); await E.pick(fakeFile('long.mp3', 8.5 * 60));
    check('phone: 8.5 min song refused with the 8 minute message', E.$('.ss-error').dataset.code === 'long' && /8 minutes/.test(E.$('.ss-error').textContent) && E.root.dataset.state === 'idle');
    await E.pick(fakeFile('short.mp3', 2));
    check('phone: a 2 s song is fine', E.root.dataset.state === 'ready');
    E.$('.ss-dock-settings').click();
    E.$('.ss-go').click(); await settle(10);
    check('phone: Separate closes the sheet', !E.$('#ss-settings').classList.contains('open'));
    E.engine.finish(); await settle(20);
    E.app.destroy();
  }
  {
    const w = Object.create(globalThis);
    w.WebAssembly = undefined;
    const E = boot({ win: w });
    await settle(10);
    check('no WebAssembly: message, engine not started, Separate off', E.$('.ss-error').dataset.code === 'nowasm' && !E.engine.calls.some(c => c[0] === 'init'));
    await E.pick(fakeFile('a.mp3', 1));
    check('no WebAssembly: Separate stays off with a song', E.$('.ss-go').disabled);
    E.app.destroy();
  }
  {
    // Cancel during the model download stops the download (terminate),
    // not only the separation.
    const E = boot({ engineOpts: { loadGate: true } });
    await settle(10); await E.pick(fakeFile('a.mp3', 1)); E.$('.ss-go').click(); await settle(10);
    E.$('.ss-cancel').click();
    const txt = E.$('.ss-phase').textContent;
    await settle(10);
    check('cancel in the download: engine.terminate, "Stopping the download", then ready + "Cancelled."',
      E.engine.calls.some(c => c[0] === 'terminate') && txt === 'Stopping the download' && E.root.dataset.state === 'ready' && E.$('.ss-msg').textContent === 'Cancelled.' && !E.engine.calls.some(c => c[0] === 'separate'),
      `calls ${E.engine.calls.map(c => c[0]).join(',')}; phase "${txt}"; state ${E.root.dataset.state}`);
    E.app.destroy();
  }
  {
    // WebGPU fails in the first run: load said webgpu, the result says wasm.
    const E = boot({ engineOpts: { ep: 'webgpu', sepEp: 'wasm', sepFallback: 'GPU device lost' } });
    await settle(10); await E.pick(fakeFile('a.mp3', 1)); E.$('.ss-go').click(); await settle(10);
    E.engine.finish(); await settle(20);
    check('fallback in the first run: EP line and choice line say CPU and GPU failed',
      /CPU \(slower\)/.test(E.$('.ss-ep').textContent) && /GPU failed/.test(E.$('.ss-ep').textContent) && /CPU/.test(E.$('.ss-choice').textContent),
      `"${E.$('.ss-ep').textContent}" | "${E.$('.ss-choice').textContent}"`);
    E.app.destroy();
  }
  {
    // After window.__snRelease the stems stay, and Play builds a new context.
    const E = boot();
    await settle(10); await E.pick(fakeFile('a.mp3', 1)); E.$('.ss-go').click(); await settle(10);
    E.engine.finish(); await settle(20);
    globalThis.__snRelease();
    E.$('.ss-play').click();
    check('after __snRelease: Play makes a new AudioContext and plays',
      !E.$('.ss-play').disabled && E.ctxs.length === 2 && E.app.player && E.app.player.playing && E.ctxs[1].log.sources.filter(x => !x.stopped).length === E.$$('.ss-row').length,
      `contexts ${E.ctxs.length}, playing ${!!(E.app.player && E.app.player.playing)}`);
    E.app.destroy();
  }
  check('classifyError on messages without a code',
    classifyError(new Error('cancelled')) === 'cancelled' && classifyError(new Error('Out of memory')) === 'oom' &&
    classifyError(new Error('TypeError: Failed to fetch')) === 'net' && classifyError(new Error('bad sha256')) === 'hash' && classifyError(new Error('x')) === 'run');
}

// ------------------------------------------------------------------- css
section('style.css');
if (!existsSync(join(PAGE, 'style.css'))) skipped('style.css greps', 'style.css absent');
else {
  const css = readFileSync(join(PAGE, 'style.css'), 'utf8');
  check('[hidden] { display: none !important }', /\[hidden\]\s*\{\s*display\s*:\s*none\s*!important\s*;?\s*\}/.test(css));
  check('no Playfair, Cormorant, JetBrains', !/playfair|cormorant|jetbrains/i.test(css));
  check('no 100vw', !/100vw/.test(css));
  check('system UI font stack', /font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif/.test(css));
  check('tabular numbers', /font-variant-numeric:tabular-nums/.test(css));
  check('phone query matches sheet.js PHONE_Q', /@media \(max-width:699px\), \(pointer:coarse\)/.test(css));
  check('overflow-x hidden on html only, not body', /html\{overflow-x:hidden/.test(css) && !/body\{[^}]*overflow-x/.test(css));
  check('44 px targets on coarse pointers', /@media \(pointer:coarse\)\{\s*:root\{--tap:44px\}/.test(css));
  check('touch-action:none on the range inputs', /\.ss-vol\{[^}]*touch-action:none/.test(css) && /\.ss-seek\{[^}]*touch-action:none/.test(css));
  // every class the UI sets display on, and that also gets [hidden], is covered by the [hidden] rule above
  const src = readdirSync(HERE).filter(f => f.endsWith('.js')).map(f => readFileSync(join(HERE, f), 'utf8')).join('\n');
  const hiddenUse = (src.match(/\b\w+\.hidden\s*=/g) || []).length;
  check('UI uses the hidden attribute; the [hidden] rule guards it', hiddenUse > 0, `${hiddenUse} hidden assignments`);
}

// ------------------------------------------------------------------- syntax
section('syntax and import');
{
  const files = readdirSync(HERE).filter(f => /\.(m?js)$/.test(f)).sort();
  for (const f of files) {
    let ok = true, msg = '';
    try { execFileSync(process.execPath, ['--check', join(HERE, f)], { stdio: 'pipe' }); } catch (e) { ok = false; msg = String(e.stderr || e.message).split('\n').slice(0, 3).join(' '); }
    check(`node --check ui/${f}`, ok, msg);
  }
  for (const f of files.filter(f => f.endsWith('.js'))) {
    // a fresh node process with no DOM: import must not touch a browser global
    let ok = true, msg = '';
    try { execFileSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(join(HERE, f)).href)})`], { stdio: 'pipe' }); }
    catch (e) { ok = false; msg = String(e.stderr || e.message).split('\n').filter(Boolean).slice(-2).join(' '); }
    check(`ESM import of ui/${f} with no DOM`, ok, msg);
  }
}

console.log(`\nui tests: ${pass} passed, ${fail} failed, ${skip} skipped`);
if (fail) { console.log('failed: ' + fails.join(' | ')); process.exitCode = 1; }
process.exit(process.exitCode || 0);
