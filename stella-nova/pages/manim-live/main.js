// ============================================================================
//  MANIM LIVE  ·  main.js  (the IDE: editor, player, panels)
// ----------------------------------------------------------------------------
//  Joins the parts. engine.js (the worker side) runs the real ManimCE in
//  Pyodide and gives the protocol below. This file only uses that protocol.
//
//    createEngine({onStatus}) -> {ready, run(code, opts) -> handle, cancel(),
//                                 introspect(name), source(name),
//                                 complete(code, line, col)}
//    handle.on('scenes' | 'animation' | 'frame' | 'log' | 'error' | 'done', fn)
//
//  DATA PATH OF ONE RUN (grep -n "function runCode")
//    editor text -> engine.run -> 'frame' -> ui/player.js cache and canvas
//                              -> 'animation' -> timeline segments, play
//                                 gutter marks in the editor
//                              -> 'error' -> traceback view, editor mark
//                              -> 'done' -> loop playback, lesson check
//    player head -> segment -> editor active line (onSegment)
//    editor play mark or line click -> player.seekLine
//
//  MODULES (ui/)
//    editor.js     CodeMirror 6 with worker completion and hover docs
//    player.js     frame cache, playback, timeline
//    timeline.js   pure frame / line / segment mapping
//    export.js     PNG and video export from the frame cache
//    examples.js   examples browser   (catalog.js, seed-examples.js)
//    learn.js      lessons panel
//    reference.js  live API reference (rst.js, pyhighlight.js)
//    hood.js       "Under the hood" panel
//    share.js      code <-> URL hash
//    mobile.js     phone views after a run, key row, soft keyboard inset
//    device.js     quality default, frame cache size, download advice
//    pysource.js   fast regex reads of the code (scenes, play lines)
//    markdown.js   small Markdown renderer
//
//  STORAGE (localStorage, each access in try/catch)
//    manim-live:code      the last code in the editor
//    manim-live:prefs     layout, panel, quality, qualityPicked, code width
//
//  DEVICE DEFAULTS (ui/device.js). A small or low-memory device gets the
//  'phone' quality (640x360, 15 fps) and a smaller frame cache. When the
//  user picks a quality, qualityPicked is true and the pick wins. With
//  Data Saver on, Python loads only after a tap (Load Python or Run).
//    manim-live:learn     lesson progress (ui/learn.js)
//
//  GREP MAP
//    grep -n 'async function bootEngine'   engine import and boot status
//    grep -n 'function onStatus'           boot stage list
//    grep -n 'function startBoot'          download advice, then bootEngine
//    grep -n 'function runCode'            one run
//    grep -n 'function showError'          traceback view and editor mark
//    grep -n 'function setLayout'          code | split | output
//    grep -n 'function setMTab'            phone views
//    grep -n 'function initTouch'          key row, keyboard, typing class
//    grep -n 'function toggleFull'         output full screen
//    grep -n 'function openPanel'          side panels
//    grep -n 'function initSplitter'       splitter drag
//    grep -n 'function initKeys'           page keys
//    grep -n 'function share'              URL share
//    grep -n 'function loadProgram'        examples and lessons -> editor
// ============================================================================
import { createEditor } from './ui/editor.js';
import { createPlayer } from './ui/player.js';
import { linesWithSegments } from './ui/timeline.js';
import { exportPNG, exportVideo, download, pickVideoType } from './ui/export.js';
import { mountExamples } from './ui/examples.js';
import { mountLearn } from './ui/learn.js';
import { mountReference } from './ui/reference.js';
import { mountHood } from './ui/hood.js';
import { encodeShare, decodeShare } from './ui/share.js';
import { guessScenes, tracebackLines } from './ui/pysource.js';
import { parseHeader } from './ui/catalog.js';
import { escapeHtml } from './ui/markdown.js';
import { SEEDS } from './ui/seed-examples.js';
import { PHONE_QUERY, tabAfterRun, mountKeyRow, watchKeyboard } from './ui/mobile.js';
import { DOWNLOAD_MB, deviceProfile, defaultQuality, frameBudgetMB, networkAdvice } from './ui/device.js';

const $ = (id) => document.getElementById(id);
const work = $('work');
const QUALITY = { phone: { fps: 15, w: 640, h: 360 }, low: { fps: 15, w: 854, h: 480 }, medium: { fps: 30, w: 1280, h: 720 }, high: { fps: 60, w: 1920, h: 1080 } };
const PANEL_TITLE = { examples: 'Examples', learn: 'Learn', ref: 'Reference', hood: 'Under the hood' };
const isPhone = () => matchMedia(PHONE_QUERY).matches;

// ---- storage ---------------------------------------------------------------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const prefs = Object.assign({ layout: 'split', panel: 'examples', quality: 'low', qualityPicked: false, codeW: 50 }, store.get('manim-live:prefs', {}));
const device = deviceProfile({
  deviceMemory: navigator.deviceMemory,
  hardwareConcurrency: navigator.hardwareConcurrency,
  phone: isPhone(),
  coarse: matchMedia('(pointer: coarse)').matches,
});
const savePrefs = () => store.set('manim-live:prefs', prefs);

// ---- toast -----------------------------------------------------------------
let toastT = 0;
function toast(text, ms = 2600) {
  const t = $('toast');
  t.textContent = text; t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, ms);
}

// ---- state -----------------------------------------------------------------
let engine = null;            // set when engine.js loads
let engineReady = false;
let running = null;           // {handle, code, scenes, anims, frames, error}
let pendingRun = false;
let pendingSource = 'user';   // the source of the run that waits for Python
let preferredScene = '';      // from the loaded example or lesson
let lastResult = null;

// ---- editor ----------------------------------------------------------------
const editor = createEditor($('editor'), {
  doc: '',
  onRun: () => runCode(),
  onChange: onCodeChange,
  onLineClick: (line) => {
    if (player.seekLine(line)) {
      if (isPhone()) setMTab('output');
    }
  },
  onDoc: (name) => openRef(name),
});

// ---- player ----------------------------------------------------------------
const player = createPlayer({
  budget: frameBudgetMB(device) * 1024 * 1024,
  canvas: $('frame'),
  track: $('track'),
  onSegment(seg) {
    const lab = $('animLabel');
    if (!seg) { lab.textContent = ''; editor.setActiveLine(null); return; }
    lab.innerHTML = `${escapeHtml(seg.name)}${seg.line ? ` <a data-line="${seg.line}" title="Show this line in the editor">line ${seg.line}</a>` : ''}`;
    const follow = player.isPlaying() && !editor.view.hasFocus;
    editor.setActiveLine(seg.line, follow);
  },
  onTick(s) {
    $('time').textContent = s.timeText;
    $('play').textContent = s.playing ? '❚❚' : '▶';
    $('play').setAttribute('aria-label', s.playing ? 'Pause' : 'Play');
    const has = s.frames > 0;
    for (const id of ['play', 'stepB', 'stepF', 'exportPng']) $(id).disabled = !has;
    $('exportVid').disabled = !has || !s.done || !pickVideoType();
  },
});
$('animLabel').addEventListener('click', e => {
  const a = e.target.closest('a[data-line]');
  if (!a) return;
  if (isPhone()) setMTab('code');
  else if (work.dataset.layout === 'output') setLayout('split');
  editor.gotoLine(+a.dataset.line);
});
$('play').onclick = () => player.toggle();
$('stepB').onclick = () => player.step(-1);
$('stepF').onclick = () => player.step(1);
$('loop').onchange = e => player.setLoop(e.target.checked);
$('speed').onchange = e => player.setSpeed(e.target.value);

// ---- console ---------------------------------------------------------------
let consoleLen = 0, consoleCount = 0;
function logLine(text, stream = 'stdout') {
  const c = $('console');
  if (consoleLen > 200000) { c.textContent = '(older output removed)\n'; consoleLen = 0; }
  const s = document.createElement('span');
  s.className = stream;
  s.textContent = text.endsWith('\n') ? text : text + '\n';
  c.appendChild(s);
  consoleLen += text.length;
  consoleCount++;
  $('consoleN').textContent = `(${consoleCount})`;
  if (!c.hidden) c.scrollTop = c.scrollHeight;
}
function clearConsole() { $('console').textContent = ''; consoleLen = 0; consoleCount = 0; $('consoleN').textContent = ''; }
$('consoleBtn').onclick = () => {
  const c = $('console');
  c.hidden = !c.hidden;
  $('consoleBtn').setAttribute('aria-expanded', String(!c.hidden));
  if (!c.hidden) c.scrollTop = c.scrollHeight;
};

// ---- scene picker ----------------------------------------------------------
function setScenes(list, keep = true) {
  const sel = $('scene');
  const prev = keep ? sel.value : '';
  const names = [...new Set(list)];
  sel.innerHTML = names.length ? names.map(n => `<option>${escapeHtml(n)}</option>`).join('') : '<option value="">(no Scene class)</option>';
  const want = [prev, preferredScene].find(n => n && names.includes(n));
  if (want) sel.value = want;
  else if (names.length) sel.value = names[0];
  sel.disabled = names.length <= 1;
}

let changeT = 0;
function onCodeChange(code) {
  clearTimeout(changeT);
  changeT = setTimeout(() => {
    store.set('manim-live:code', code);
    setScenes(guessScenes(code));
  }, 350);
}

// ---- boot status -----------------------------------------------------------
const STAGES = ['python', 'numpy', 'manim', 'fonts'];
let stageAt = -1;
function stageOf(s, text) {
  const k = String(s.stage || '').toLowerCase();
  const i = STAGES.indexOf(k);
  if (i >= 0) return i;
  const t = (k + ' ' + text).toLowerCase();
  if (/ready|done/.test(k)) return 4;
  if (/font|stub|cairo|pango|shim|native|stand-in|warm/.test(t)) return 3;
  if (/manim|wheel|cloup|svgelements|micropip|pypi/.test(t)) return 2;
  if (/numpy|scipy|pillow|networkx|shapely|package|sympy|fonttools|pygments/.test(t)) return 1;
  if (/pyodide|python|runtime|wasm/.test(t)) return 0;
  return Math.max(0, stageAt);
}
function onStatus(s) {
  if (s == null) return;
  if (typeof s === 'string') s = { text: s };
  const text = String(s.text || s.message || s.label || s.detail || '');
  const lis = [...document.querySelectorAll('#bootList li')];
  if (s.error) {
    lis.forEach((li, i) => { if (i === Math.max(0, stageAt)) li.className = 'bad'; });
    $('bootMsg').textContent = `Python did not start: ${s.error.message || s.error}`;
    clearInterval(bootTimer);
    $('boot').hidden = false;
    return;
  }
  // After a stop without SharedArrayBuffer, engine.js starts a new worker
  // and boots Python again. Show the stage list again for that boot.
  if (s.stage === 'restart') {
    stageAt = -1;
    $('boot').hidden = false;
    $('bootMsg').textContent = text || 'Restarting Python';
    lis.forEach(li => { li.className = ''; });
    return;
  }
  const i = s.ready ? 4 : stageOf(s, text);
  if (i >= 4) setTimeout(() => { if (stageAt >= 4) $('boot').hidden = true; }, 900);
  stageAt = Math.max(stageAt, i);
  lis.forEach((li, j) => { li.className = j < stageAt ? 'ok' : j === stageAt ? 'on' : ''; });
  let frac = Number.isFinite(s.progress) ? s.progress : Number.isFinite(s.fraction) ? s.fraction
    : (s.loaded && s.total) ? s.loaded / s.total : null;
  if (frac != null && frac > 1) frac /= 100;
  const overall = Math.min(1, (Math.min(stageAt, 4) + (frac ?? 0.3)) / 4);
  $('bootBar').style.width = (stageAt >= 4 ? 100 : Math.round(overall * 100)) + '%';
  $('bootPct').textContent = stageAt >= 4 ? '' : Math.round(overall * 100) + '%';
  if (text) $('bootMsg').textContent = text;
}

// ---- boot: download advice, elapsed time ---------------------------------------
let bootStarted = false;
let bootT0 = 0, bootTimer = 0;
function startBoot() {
  const advice = networkAdvice(navigator.connection || null);
  const note = $('bootNote');
  note.textContent = advice.text || `About ${DOWNLOAD_MB} MB on the first visit. The browser keeps it for later visits.`;
  note.classList.toggle('warn', advice.level !== 'none');
  if (advice.level === 'ask') {
    $('bootGo').hidden = false;
    $('bootMsg').textContent = 'Python is not loaded yet. You can write code now.';
    $('bootGo').onclick = () => bootEngine();
    return;
  }
  bootEngine();
}
function tickBoot() {
  const s = Math.round((performance.now() - bootT0) / 1000);
  $('bootTime').textContent = s ? `${s} s` : '';
}

async function bootEngine() {
  if (bootStarted) return;
  bootStarted = true;
  $('bootGo').hidden = true;
  bootT0 = performance.now();
  clearInterval(bootTimer);
  bootTimer = setInterval(tickBoot, 1000);
  let mod;
  try {
    mod = await import('./engine.js');
  } catch (e) {
    onStatus({ error: 'engine.js did not load (' + (e.message || e) + ')' });
    return;
  }
  try {
    engine = mod.createEngine({ onStatus });
  } catch (e) {
    onStatus({ error: e });
    return;
  }
  editor.setBackends({
    complete: (code, line, col) => engine.complete(code, line, col),
    introspect: (name) => engine.introspect(name),
  });
  try {
    const info = await engine.ready;
    engineReady = true;
    clearInterval(bootTimer);
    onStatus({ ready: true, text: 'Ready.' });
    $('run').classList.remove('busy');
    $('run').title = 'Run (Ctrl or Cmd + Enter)';
    if (info && typeof info === 'object') engine.info = engine.info || info;
    hood.refresh();
    engine.introspect('manim').then(m => {
      const names = (m && m.members) || [];
      editor.setNames(names);
      reference.setNames(names);
    }).catch(() => {});
    if (pendingRun) { pendingRun = false; runCode(pendingSource); }
  } catch (e) {
    onStatus({ error: e });
  }
}

// ---- run -------------------------------------------------------------------
function setRunning(on) {
  $('run').hidden = on;
  $('stop').hidden = !on;
  $('renderBadge').hidden = !on;
  document.querySelector('#dock [data-mtab=output]').classList.toggle('busy', on);
  const dr = $('dockRun');
  dr.classList.toggle('stop', on);
  dr.setAttribute('aria-label', on ? 'Stop the run' : 'Run');
  dr.innerHTML = on ? '<span>■</span><b>Stop</b>' : '<span>▶</span><b>Run</b>';
}

// source: 'user' (Run, keys), 'example', 'ref' or 'lesson'. On a phone,
// ui/mobile.js tabAfterRun picks the view: the output, except for a lesson.
function runCode(source = 'user') {
  if (!engine || !engineReady) {
    pendingRun = true;
    pendingSource = source;
    if (!bootStarted) { bootEngine(); return; }
    $('run').classList.add('busy');
    toast('Python is still loading. The scene runs when it is ready.');
    return;
  }
  if (running) cancelRun(true);
  const code = editor.getCode();
  store.set('manim-live:code', code);
  const q = QUALITY[$('quality').value] || QUALITY.low;
  const scene = $('scene').value || undefined;
  editor.clearError();
  $('err').hidden = true;
  clearConsole();
  player.reset({ fps: q.fps, width: q.w, height: q.h });
  $('stageMsg').hidden = true;
  $('renderBadge').textContent = 'Starting…';
  setRunning(true);
  if (isPhone()) {
    const t = tabAfterRun(work.dataset.mtab, source);
    if (t !== work.dataset.mtab) setMTab(t);
  }
  const run = { code, scenes: [], anims: [], frames: 0, error: null, t0: performance.now() };
  running = run;
  let handle;
  try {
    handle = engine.run(code, { scene, quality: $('quality').value });
  } catch (e) {
    running = null; setRunning(false);
    showError({ type: 'Error', message: String(e.message || e), traceback: String(e.stack || e) });
    return;
  }
  run.handle = handle;
  const live = () => running === run;
  handle.on('scenes', (list) => {
    if (!live()) return;
    run.scenes = Array.isArray(list) ? list : (list && list.scenes) || [];
    if (run.scenes.length) setScenes(run.scenes);
  });
  handle.on('animation', (a) => {
    if (!live()) return;
    run.anims.push(a);
    player.addAnimation(a);
    editor.setAnimLines(linesWithSegments(player.segments()));
    $('renderBadge').textContent = `Rendering ${a.name || 'animation'} (${run.anims.length})`;
  });
  handle.on('frame', (f) => {
    if (!live()) { try { f.bitmap && f.bitmap.close(); } catch {} return; }
    run.frames++;
    player.addFrame(f);
  });
  handle.on('log', (l) => {
    if (!live()) return;
    logLine(String(l && (l.text ?? l)), (l && l.stream) || 'stdout');
  });
  handle.on('error', (e) => {
    if (!live()) return;
    run.error = e;
    running = null;
    setRunning(false);
    player.finish({});
    showError(e || {});
    learn.onRunResult(code, { scenes: run.scenes, animations: run.anims.map(a => a.name), frames: run.frames, error: e });
  });
  handle.on('done', (d) => {
    if (!live()) return;
    running = null;
    setRunning(false);
    player.finish(d || {});
    const secs = ((performance.now() - run.t0) / 1000).toFixed(1);
    if (!run.frames) {
      $('stageMsg').hidden = false;
      $('stageMsg').innerHTML = '<p>The scene made no frames.</p><p class="muted">Add a self.play(...) or self.wait() call to construct().</p>';
    }
    toast(`Rendered ${d && d.frames != null ? d.frames : run.frames} frames in ${secs} s`);
    lastResult = { scenes: run.scenes, animations: run.anims.map(a => a.name), frames: run.frames, error: null };
    learn.onRunResult(code, lastResult);
  });
}

function cancelRun(silent = false) {
  if (!running) return;
  running = null;
  try { engine.cancel(); } catch {}
  setRunning(false);
  player.finish({});
  if (!silent) {
    logLine('Run stopped.', 'stderr');
    toast(engine.canInterrupt === false ? 'Run stopped. Python restarts, which takes a moment.' : 'Run stopped.');
  }
}
$('run').onclick = () => runCode();
$('stop').onclick = () => cancelRun();
$('quality').onchange = () => { prefs.quality = $('quality').value; prefs.qualityPicked = true; savePrefs(); };

// ---- errors ----------------------------------------------------------------
function showError(e) {
  const type = e.type || 'Error';
  const msg = e.message || '';
  const tb = String(e.traceback || `${type}: ${msg}`);
  const frames = tracebackLines(tb);
  const userFrames = frames.filter(f => f.user);
  const line = Number.isFinite(+e.line) && +e.line > 0 ? +e.line : (userFrames.length ? userFrames[userFrames.length - 1].line : null);
  $('errTitle').textContent = `${type}${msg ? ': ' + msg : ''}${line ? ` (line ${line})` : ''}`;
  const rows = tb.replace(/\n$/, '').split('\n');
  $('errText').innerHTML = rows.map((r, i) => {
    const m = /File "([^"]+)", line (\d+)/.exec(r);
    const fr = m && frames.find(f => f.file === m[1] && f.line === +m[2]);
    if (fr && fr.user) return escapeHtml(r).replace(/line (\d+)/, `<span class="tb-user" data-line="$1" title="Show this line">line $1</span>`);
    if (i === rows.length - 1) return `<span class="tb-last">${escapeHtml(r)}</span>`;
    return escapeHtml(r);
  }).join('\n');
  $('err').hidden = false;
  if (!player.frameCount()) {
    $('stageMsg').hidden = false;
    $('stageMsg').innerHTML = '<p>The run stopped with an error.</p><p class="muted">The traceback below is the real Python traceback.</p>';
  }
  if (line) editor.markError(line, `${type}: ${msg}`);
  if (isPhone()) setMTab('output');
  logLine(tb, 'stderr');
}
$('errText').addEventListener('click', e => {
  const s = e.target.closest('.tb-user');
  if (!s) return;
  if (isPhone()) setMTab('code');
  else if (work.dataset.layout === 'output') setLayout('split');
  editor.gotoLine(+s.dataset.line);
});
$('errClose').onclick = () => { $('err').hidden = true; };

// ---- export ----------------------------------------------------------------
let exporting = null;
$('exportPng').onclick = () => {
  const name = `${$('scene').value || 'scene'}-${String(player.current()).padStart(4, '0')}.png`;
  exportPNG(player.bitmap(), name).catch(e => toast(e.message));
};
$('exportVid').onclick = async () => {
  if (exporting) { exporting.abort(); return; }
  const ac = new AbortController();
  exporting = ac;
  const btn = $('exportVid');
  const label = btn.textContent;
  player.pause();
  try {
    const { blob, ext } = await exportVideo(player, {
      signal: ac.signal,
      onProgress: f => { btn.textContent = `Recording ${Math.round(f * 100)}% (click to stop)`; },
    });
    const how = await download(blob, `${$('scene').value || 'scene'}.${ext}`);
    if (how !== 'cancelled') toast(`Saved a ${ext.toUpperCase()} video, ${(blob.size / 1e6).toFixed(1)} MB.`);
  } catch (e) {
    toast(e.message || String(e));
  } finally {
    exporting = null;
    btn.textContent = label;
  }
};

// ---- panels ----------------------------------------------------------------
function openPanel(p, toggle = true) {
  if (toggle && !isPhone() && work.dataset.panel === p) p = 'none';
  work.dataset.panel = p;
  document.querySelectorAll('#panelSeg button').forEach(b => b.classList.toggle('on', b.dataset.panel === p));
  document.querySelectorAll('#side .panel').forEach(s => { s.hidden = s.dataset.p !== p; });
  if (PANEL_TITLE[p]) $('sideTitle').textContent = PANEL_TITLE[p];
  if (p === 'hood') hood.refresh();
  if (!isPhone()) { prefs.panel = p; savePrefs(); }
  requestAnimationFrame(() => editor.view.requestMeasure());
}
document.querySelectorAll('#panelSeg button').forEach(b => b.onclick = () => openPanel(b.dataset.panel));
$('sideClose').onclick = () => openPanel('none', false);

function openRef(name) {
  if (isPhone()) setMTab('ref'); else openPanel('ref', false);
  reference.open(name);
}

// ---- layouts ---------------------------------------------------------------
function setLayout(l) {
  if (!['code', 'split', 'output'].includes(l)) l = 'split';
  work.dataset.layout = l;
  document.querySelectorAll('#layoutSeg button').forEach(b => b.classList.toggle('on', b.dataset.layout === l));
  prefs.layout = l; savePrefs();
  requestAnimationFrame(() => editor.view.requestMeasure());
}
document.querySelectorAll('#layoutSeg button').forEach(b => b.onclick = () => setLayout(b.dataset.layout));

function setMTab(t) {
  work.dataset.mtab = t;
  document.querySelectorAll('#dock button[data-mtab]').forEach(b => b.classList.toggle('on', b.dataset.mtab === t));
  // A hidden editor must not keep the focus: the soft keyboard and the
  // typing class (no dock) go with it.
  if (t !== 'code' && editor.view.hasFocus) editor.view.contentDOM.blur();
  if (t !== 'output') exitFull();
  if (PANEL_TITLE[t]) {
    work.dataset.panel = t;
    document.querySelectorAll('#side .panel').forEach(s => { s.hidden = s.dataset.p !== t; });
    if (t === 'hood') hood.refresh();
  }
  if (t === 'code') requestAnimationFrame(() => editor.view.requestMeasure());
}
document.querySelectorAll('#dock button[data-mtab]').forEach(b => b.onclick = () => setMTab(b.dataset.mtab));
$('dockRun').onclick = () => { if (running) cancelRun(); else runCode(); };

// ---- touch: key row, soft keyboard, typing class ------------------------------
function initTouch() {
  mountKeyRow($('keys'), (key) => {
    if (key === 'run') { runCode(); return; }
    if (key === 'doc') {
      const name = editor.nameAtCursor();
      if (name) openRef(name); else toast('Put the cursor on a name, then tap Ref.');
      return;
    }
    editor.applyKey(key);
  });
  const root = document.documentElement;
  watchKeyboard(window, root);
  const touchUI = matchMedia(`${PHONE_QUERY}, (pointer: coarse)`);
  const typing = () => root.classList.toggle('typing', touchUI.matches && editor.view.hasFocus);
  editor.view.dom.addEventListener('focusin', typing);
  editor.view.dom.addEventListener('focusout', () => setTimeout(typing, 0));
}

// ---- output full screen ----------------------------------------------------------
// Element full screen where the browser has it (Android Chrome, iPad,
// desktop). iPhone Safari has it only for <video>, so there #outPane
// gets the class pseudo-full and covers the window.
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
function exitFull() {
  const out = $('outPane');
  if (out.classList.contains('pseudo-full')) out.classList.remove('pseudo-full');
  else if (fsElement()) (document.exitFullscreen || document.webkitExitFullscreen).call(document)?.catch?.(() => {});
  syncFull();
}
function syncFull() {
  const on = !!fsElement() || $('outPane').classList.contains('pseudo-full');
  $('fullBtn').setAttribute('aria-pressed', String(on));
  $('fullBtn').setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
}
function toggleFull() {
  const out = $('outPane');
  if (fsElement() || out.classList.contains('pseudo-full')) { exitFull(); return; }
  const req = out.requestFullscreen || out.webkitRequestFullscreen;
  const fallback = () => { out.classList.add('pseudo-full'); syncFull(); };
  if (!req) { fallback(); return; }
  Promise.resolve(req.call(out))
    .then(() => { syncFull(); return screen.orientation?.lock?.('landscape'); })
    .catch(() => { if (!fsElement()) fallback(); });
}
$('fullBtn').onclick = toggleFull;
document.addEventListener('fullscreenchange', syncFull);
document.addEventListener('webkitfullscreenchange', syncFull);
addEventListener('keydown', e => { if (e.key === 'Escape' && $('outPane').classList.contains('pseudo-full')) exitFull(); });

function initSplitter() {
  const sp = $('split');
  const apply = (pct) => {
    pct = Math.max(18, Math.min(82, pct));
    prefs.codeW = pct;
    work.style.setProperty('--code-w', pct + '%');
  };
  apply(prefs.codeW);
  let drag = false;
  sp.addEventListener('pointerdown', e => { drag = true; sp.classList.add('drag'); sp.setPointerCapture(e.pointerId); });
  sp.addEventListener('pointermove', e => {
    if (!drag) return;
    // flex-basis % resolves against the width of #work.
    const cp = $('codePane').getBoundingClientRect();
    apply(100 * (e.clientX - cp.left) / work.clientWidth);
  });
  const end = () => { if (!drag) return; drag = false; sp.classList.remove('drag'); savePrefs(); editor.view.requestMeasure(); };
  sp.addEventListener('pointerup', end);
  sp.addEventListener('pointercancel', end);
  sp.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') { apply(prefs.codeW - 3); savePrefs(); }
    if (e.key === 'ArrowRight') { apply(prefs.codeW + 3); savePrefs(); }
  });
  sp.addEventListener('dblclick', () => { apply(50); savePrefs(); });
}

// ---- keys ------------------------------------------------------------------
function initKeys() {
  addEventListener('keydown', e => {
    if (e.altKey && !e.metaKey && !e.ctrlKey && /^Digit[123]$/.test(e.code)) {
      e.preventDefault();
      setLayout(['code', 'split', 'output'][+e.code.slice(5) - 1]);
      return;
    }
    if (e.key === 'Escape' && running) { cancelRun(); return; }
    const t = e.target;
    const inField = t.closest && (t.closest('.cm-editor') || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable);
    if (inField || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ' && player.frameCount()) { e.preventDefault(); player.toggle(); }
    else if (e.key === ',') player.step(-1);
    else if (e.key === '.') player.step(1);
  });
}

// ---- share -----------------------------------------------------------------
async function share() {
  try {
    const hash = await encodeShare({ code: editor.getCode(), scene: $('scene').value, quality: $('quality').value });
    history.replaceState(null, '', location.pathname + location.search + hash);
    const url = location.href;
    let copied = false;
    try { await navigator.clipboard.writeText(url); copied = true; } catch {}
    toast(copied ? `Link copied (${url.length} characters).` : 'The link is in the address bar.');
  } catch (e) {
    toast('Could not make a link: ' + (e.message || e));
  }
}
$('share').onclick = share;

// ---- programs from examples and lessons -------------------------------------
function loadProgram(code, scene, title, source = 'user') {
  const head = parseHeader(code);
  preferredScene = scene || head.scene || '';
  editor.setCode(code);
  setScenes(guessScenes(code), false);
  store.set('manim-live:code', code);
  if (title) toast(`Loaded “${title}”. Ctrl or Cmd + Z brings back your code.`);
  if (engineReady) runCode(source);
  else { pendingRun = true; pendingSource = source; }
}

// ---- panels: mount ---------------------------------------------------------
const examples = mountExamples($('pExamples'), {
  onOpen: (entry, code) => {
    loadProgram(code, entry.scene, entry.title, 'example');
    document.querySelectorAll('.ex-card').forEach(c => c.classList.toggle('cur', c.dataset.id === entry.id));
    if (isPhone()) setMTab('output');
  },
  onConcept: (name) => openRef(name),
});
const learn = mountLearn($('pLearn'), {
  onLoadCode: (code, scene) => { loadProgram(code, scene, undefined, 'lesson'); if (isPhone()) setMTab('code'); },
  onConcept: (name) => openRef(name),
});
const reference = mountReference($('pRef'), {
  getEngine: () => engine,
  onLoadCode: (code, scene) => { loadProgram(code, scene, scene || 'docstring example', 'ref'); if (isPhone()) setMTab('output'); },
});
const hood = mountHood($('pHood'), { getEngine: () => engine });

// ---- start -----------------------------------------------------------------
async function start() {
  const q = prefs.qualityPicked ? prefs.quality : defaultQuality(device);
  $('quality').value = QUALITY[q] ? q : 'low';
  setLayout(prefs.layout);
  initSplitter();
  initKeys();
  initTouch();
  openPanel(isPhone() ? 'examples' : (prefs.panel || 'none'), false);
  if (isPhone()) setMTab('code');

  let code = null;
  const shared = await decodeShare(location.hash).catch(() => null);
  if (shared && shared.code) {
    code = shared.code;
    preferredScene = shared.scene || '';
    if (shared.quality && QUALITY[shared.quality]) $('quality').value = shared.quality;
    toast('Loaded the code from the link.');
  }
  if (!code) code = store.get('manim-live:code', null);
  if (!code || !code.trim()) code = SEEDS[0].code;
  if (!preferredScene) preferredScene = parseHeader(code).scene || '';
  editor.setCode(code);
  setScenes(guessScenes(code), false);
  setRunning(false);
  $('run').classList.add('busy');
  $('run').title = 'Python is loading. A click now runs the scene when it is ready.';
  startBoot();
}

window.__manimLive = { editor, player, examples, learn, reference, hood, device, get engine() { return engine; }, runCode };
start();
