// ============================================================================
//  PLAY  ·  section 06 playground: reference, submission, score (ES module)
// ----------------------------------------------------------------------------
//  main.js imports this module when #s6 first comes near the view, and
//  calls initPlayground(page). Nothing runs at import time.
//
//  Data path for one run:
//    1. #sceneSeg selects a scene. scenes.js make() builds the reference
//       world on the main thread one time; a Map keeps it (refCache).
//    2. #subSeg selects a preset of submissions.js. Its code goes into
//       #code, and the playground runs it.
//    3. run() sends #code to sandbox.js runSubmission (a Web Worker with
//       a time limit). A newer run makes the older result stale (runToken).
//    4. score.js scoreWorld(ref, sub) gives the five families. The card
//       shows them next to the paper's top and median Overall (data.js).
//    5. Two renderers (render.js) draw the reference and the submission at
//       the same frame t. "overlay" draws the submission as a ghost on the
//       reference canvas.
//
//  Errors in submission code go to #runLog. They never stop the page:
//  every step catches its errors, and page.errors gets only playground
//  faults (not submission faults).
//
//  The draw loop runs only when #s6 is in the view and the tab is visible,
//  and only while the clip plays or a redraw is pending.
//
//  EXPORTS   (grep -n "<anchor>" play.js)
//    entry ............ "export function initPlayground"
//  INTERNALS
//    paper context .... "function paperContext"
//    reference ........ "async function ensureRef"
//    scene select ..... "async function selectScene"
//    preset select .... "function selectPreset"
//    run + score ...... "async function run("
//    score card ....... "function showScore"
//    run log .......... "function logSet"
//    draw loop ........ "function frame("
//    orbit drag ....... "function bindOrbit"
// ============================================================================

import { SCENES, sceneById, GROUND } from './scenes.js';
import { runSubmission, SUBMISSIONS, STRATEGY_LABEL } from './sandbox.js';
import { scoreWorld } from './score.js';
import { createRenderer } from './render.js';
import { LEADERBOARD, FAMILIES } from './data.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nextPaint = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
const KEYS = FAMILIES.map(f => f.key);

// The paper's Overall on the full benchmark (all 200 scenes): best model and median.
function paperContext() {
  const v = LEADERBOARD.map(r => r.overall).sort((a, b) => a - b);
  const n = v.length, mid = n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
  const top = LEADERBOARD.reduce((a, b) => (b.overall > a.overall ? b : a));
  return { top: top.overall, topModel: top.model, median: mid, n };
}

export function initPlayground(page) {
  const S = {
    sceneId: null, ref: null, sub: null, subLabel: '',
    refCache: new Map(),      // scene id -> reference World
    hist: new Map(),          // scene id -> [{ label, overall, ok }]
    preset: null, edited: false,
    t: 0, playing: true, last: 0, dirty: true,
    visible: false, raf: 0, runToken: 0, sceneToken: 0,
    view: 'both', paths: false, orbit: { yaw: 0, pitch: 0 },
  };
  page.play = S;

  // ------------------------------------------------------------ renderers
  const opts = { ground: GROUND };
  const rRef = createRenderer($('playRef'), opts);
  const rSub = createRenderer($('playSub'), opts);
  const glOk = rRef.ok && rSub.ok;

  const ctx = paperContext();
  $('scPaper').innerHTML =
    `<div class="sc-scale" aria-hidden="true"><i class="you" style="left:0%"></i>` +
    `<i class="mk med" style="left:${(ctx.median * 100).toFixed(1)}%"></i>` +
    `<i class="mk top" style="left:${(ctx.top * 100).toFixed(1)}%"></i></div>` +
    `<p>For context, the paper's Overall on the full benchmark (all 200 scenes): top <b>${ctx.top.toFixed(2)}</b> (${esc(ctx.topModel)}, white mark), ` +
    `median <b>${ctx.median.toFixed(3)}</b> of ${ctx.n} models (grey mark). The cyan dot is this run. Those are other scenes and other metrics, so the numbers here are not comparable in absolute terms.</p>`;

  // A one-particle world under the floor: the renderer draws only the floor.
  // One world for each reference, so the renderer cache keeps one entry.
  const empties = new WeakMap();
  const emptyWorld = ref => {
    if (!empties.has(ref)) empties.set(ref, { fps: ref.fps, frames: 1, camera: ref.camera, objects: [{ name: 'none', kind: 'points', color: [0, 0, 0], dynamic: false, count: 1, radius: 1e-4, pos: new Float32Array([0, -50, 0]) }] });
    return empties.get(ref);
  };

  // ------------------------------------------------------------ run log
  function logSet(lines) {
    $('runLog').innerHTML = lines.map(([cls, txt]) => (cls ? `<span class="${cls}">${esc(txt)}</span>` : esc(txt))).join('\n');
    $('runLog').scrollTop = 0;
  }

  // ------------------------------------------------------------ scenes
  async function ensureRef(id) {
    if (S.refCache.has(id)) return S.refCache.get(id);
    const sc = sceneById(id);
    const t0 = performance.now();
    const w = sc.make();
    const ms = performance.now() - t0;
    S.refCache.set(id, w);
    page.refMs = page.refMs || {}; page.refMs[id] = Math.round(ms);
    return w;
  }

  function buildPresetButtons(id) {
    const list = SUBMISSIONS[id] || [];
    $('subSeg').innerHTML = list.map(p =>
      `<button data-v="${esc(p.id)}" title="${esc(STRATEGY_LABEL[p.strategy] || p.strategy)}">${esc(p.label)}</button>`).join('');
  }

  function markOn(segId, v) {
    $(segId).querySelectorAll('button').forEach(b => {
      const on = b.dataset.v === v; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
    });
  }

  async function selectScene(id) {
    const sc = sceneById(id);
    if (!sc) return;
    const tok = ++S.sceneToken;
    S.runToken++;                       // a run of the old scene is stale now
    S.sceneId = id; S.sub = null; S.preset = null;
    markOn('sceneSeg', id);
    buildPresetButtons(id);
    $('sceneBlurb').textContent = `${sc.label}. ${sc.blurb} ${sc.seconds} s at 30 frames per second, simulated in your browser.`;
    $('subEmpty').hidden = false;
    clearScore();
    showHist();
    if (!S.refCache.has(id)) { logSet([['', `Building the reference simulation of "${sc.label}"…`]]); await nextPaint(); }
    let ref;
    try { ref = await ensureRef(id); }
    catch (e) { logSet([['err', `The reference scene failed: ${e.message}`]]); page.errors.push('play ref: ' + e.message); return; }
    if (tok !== S.sceneToken) return;
    S.ref = ref; S.t = 0;
    $('scrub').max = String(ref.frames - 1);
    $('scrub').value = '0';
    S.dirty = true; kick();
    const first = (SUBMISSIONS[id] || [])[0];
    if (first) selectPreset(first.id, true);
  }

  // ------------------------------------------------------------ presets
  function selectPreset(pid, autorun) {
    const p = (SUBMISSIONS[S.sceneId] || []).find(x => x.id === pid);
    if (!p) return;
    S.preset = p; S.edited = false;
    markOn('subSeg', pid);
    $('code').value = p.code;
    $('presetNote').innerHTML = `<b>${esc(STRATEGY_LABEL[p.strategy] || p.strategy)}.</b> ${esc(p.note)}`;
    if (autorun) run();
  }

  // ------------------------------------------------------------ score card
  function setRow(k, v) {
    const row = $('scoreCard').querySelector(`.sc-row[data-k="${k}"]`);
    if (!row) return;
    row.querySelector('.bar i').style.width = v === null ? '0%' : `${(Math.max(0, Math.min(1, v)) * 100).toFixed(1)}%`;
    row.querySelector('output').textContent = v === null ? '–' : v.toFixed(2);
  }
  function setYou(v) {
    const you = $('scPaper').querySelector('.you');
    you.style.left = `${((v || 0) * 100).toFixed(1)}%`;
    you.classList.toggle('on', v !== null);
  }
  function clearScore() {
    KEYS.forEach(k => setRow(k, null));
    $('scoreCard').querySelector('[data-k="overall"]').textContent = '–';
    $('scoreCard').classList.remove('failed');
    setYou(null);
  }
  function showScore(r, failed) {
    KEYS.forEach(k => setRow(k, r.families[k]));
    $('scoreCard').querySelector('[data-k="overall"]').textContent = r.overall.toFixed(2);
    $('scoreCard').classList.toggle('failed', !!failed);
    setYou(r.overall);
  }
  function showHist() {
    const h = S.hist.get(S.sceneId) || [];
    $('runHist').innerHTML = h.map(x =>
      `<li class="${x.ok ? '' : 'bad'}"><span>${esc(x.label)}</span><b>${x.ok ? x.overall.toFixed(2) : 'failed'}</b></li>`).join('');
  }
  function addHist(label, overall, ok) {
    const h = S.hist.get(S.sceneId) || [];
    h.unshift({ label, overall, ok });
    S.hist.set(S.sceneId, h.slice(0, 5));
    showHist();
  }

  // ------------------------------------------------------------ run + score
  async function run() {
    if (!S.ref) return;
    const tok = ++S.runToken;
    const ref = S.ref, sceneId = S.sceneId;
    const label = S.preset ? (S.edited ? `${S.preset.label} (edited)` : S.preset.label) : 'your code';
    const code = $('code').value;
    $('runBtn').disabled = true;
    $('runBtn').textContent = 'running…';
    logSet([['', `Running "${label}" in a Web Worker…`]]);
    let r;
    try { r = await runSubmission(code, { scene: ref, timeoutMs: 8000 }); }
    catch (e) { r = { ok: false, errors: [`sandbox fault: ${e.message}`], log: [], ms: 0 }; }
    if (tok !== S.runToken || sceneId !== S.sceneId) return;   // stale
    const lines = [];
    for (const l of r.log || []) lines.push(['', `log: ${l}`]);
    if (!r.ok || !r.world) {
      for (const e of (r.errors && r.errors.length ? r.errors : ['the run gave no world'])) lines.push(['err', `error: ${e}`]);
      lines.unshift(['err', `"${label}" failed after ${Math.round(r.ms || 0)} ms. A failed run gets the worst value, as in the paper.`]);
      logSet(lines);
      S.sub = null; S.subLabel = '';
      $('subEmpty').hidden = false;
      S.dirty = true; kick();
      showScore({ families: Object.fromEntries(KEYS.map(k => [k, 0])), overall: 0 }, true);
      addHist(label, 0, false);
      done();
      return;
    }
    S.sub = r.world; S.subLabel = label;
    $('subEmpty').hidden = true;
    S.dirty = true; kick();
    logSet([['', `Ran "${label}" in ${Math.round(r.ms)} ms: ${r.world.objects.length} objects, ${r.world.frames} frames. Scoring…`], ...lines]);
    await nextPaint();
    if (tok !== S.runToken) return;
    let sc;
    try { sc = scoreWorld(ref, r.world); }
    catch (e) {
      logSet([['err', `The scorer failed: ${e.message}`], ...lines]);
      page.errors.push('play score: ' + e.message);
      done(); return;
    }
    if (tok !== S.runToken) return;
    showScore(sc, false);
    addHist(label, sc.overall, true);
    const m = sc.metrics;
    logSet([
      ['ok', `"${label}": Overall ${sc.overall.toFixed(3)}. Ran in ${Math.round(r.ms)} ms, scored in ${Math.round(sc.ms)} ms.`],
      ['', `metrics: appearance ${m.appearance.toFixed(2)}, dynamic IoU ${m.dynamicIoU.toFixed(2)}, depth ${m.depth.toFixed(2)}, scene 3D ${m.scene3d.toFixed(2)}, trajectory DTW ${m.trajectoryDTW.toFixed(2)}, EMD step ${m.emdStep.toFixed(2)}`],
      ...lines,
    ]);
    page.lastScore = { scene: sceneId, label, families: sc.families, overall: sc.overall, ms: sc.ms };
    done();
  }
  function done() {
    $('runBtn').disabled = false;
    $('runBtn').textContent = 'run and score';
  }

  // ------------------------------------------------------------ draw loop
  function kick() {
    if (!S.raf && S.visible && !document.hidden && (S.playing || S.dirty)) {
      S.last = performance.now();
      S.raf = requestAnimationFrame(frame);
    }
  }
  function frame(now) {
    S.raf = 0;
    if (!S.visible || document.hidden || !S.ref) return;
    const ref = S.ref;
    if (S.playing) {
      const dt = Math.min(0.1, (now - S.last) / 1000);
      S.t += dt * ref.fps;
      if (S.t > ref.frames - 1) S.t = 0;
      $('scrub').value = String(Math.floor(S.t));
    }
    S.last = now;
    const k = Math.floor(S.t);
    $('scrubOut').textContent = `frame ${k} · ${(k / ref.fps).toFixed(2)} s`;
    try {
      const sub = S.sub;
      const tSub = sub ? Math.min(S.t, sub.frames - 1) : 0;
      if (S.view === 'overlay') {
        rRef.draw(ref, S.t, { ghost: sub || undefined, showPaths: S.paths, orbit: S.orbit });
      } else {
        rRef.draw(ref, S.t, { showPaths: S.paths, orbit: S.orbit });
        rSub.draw(sub || emptyWorld(ref), tSub, { showPaths: S.paths && !!sub, orbit: S.orbit });
      }
    } catch (e) {
      S.playing = false; syncPlayBtn();
      page.errors.push('play draw: ' + e.message);
      logSet([['err', `The renderer failed: ${e.message}`]]);
      return;
    }
    S.dirty = false;
    page.drawn = (page.drawn || 0) + 1;
    kick();
  }
  function syncPlayBtn() {
    $('playBtn').textContent = S.playing ? 'pause' : 'play';
    $('playBtn').setAttribute('aria-label', S.playing ? 'Pause' : 'Play');
  }

  // ------------------------------------------------------------ orbit drag
  function bindOrbit(el) {
    let drag = null;
    el.addEventListener('pointerdown', e => {
      drag = { x: e.clientX, y: e.clientY, yaw: S.orbit.yaw, pitch: S.orbit.pitch, touch: e.pointerType === 'touch' };
    });
    el.addEventListener('pointermove', e => {
      if (!drag) return;
      S.orbit.yaw = drag.yaw - (e.clientX - drag.x) * 0.008;
      if (!drag.touch) S.orbit.pitch = Math.max(-0.4, Math.min(0.9, drag.pitch + (e.clientY - drag.y) * 0.006));
      S.dirty = true; kick();
    });
    const end = () => { drag = null; };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('pointerleave', end);
    el.addEventListener('dblclick', () => { S.orbit.yaw = 0; S.orbit.pitch = 0; S.dirty = true; kick(); });
  }

  // ------------------------------------------------------------ bindings
  $('sceneSeg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.dataset.v === S.sceneId) return;
    selectScene(b.dataset.v).catch(err => page.errors.push('play scene: ' + err.message));
  });
  $('subSeg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    selectPreset(b.dataset.v, true);
  });
  $('viewSeg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    S.view = b.dataset.v;
    markOn('viewSeg', S.view);
    $('playViews').classList.toggle('overlay', S.view === 'overlay');
    $('refLab').textContent = S.view === 'overlay' ? 'reference, submission as a cyan ghost' : 'reference';
    requestAnimationFrame(() => { rRef.resize(); rSub.resize(); S.dirty = true; kick(); });
  });
  $('pathsBtn').addEventListener('click', () => {
    S.paths = !S.paths;
    $('pathsBtn').setAttribute('aria-pressed', S.paths);
    $('pathsBtn').classList.toggle('on', S.paths);
    S.dirty = true; kick();
  });
  $('playBtn').addEventListener('click', () => { S.playing = !S.playing; syncPlayBtn(); kick(); });
  $('scrub').addEventListener('input', () => {
    S.playing = false; syncPlayBtn();
    S.t = Number($('scrub').value) || 0;
    S.dirty = true; kick();
  });
  $('runBtn').addEventListener('click', () => { run(); });
  const code = $('code');
  code.addEventListener('input', () => { S.edited = true; });
  code.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run(); return; }
    if (e.key === 'Tab' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      const a = code.selectionStart, b = code.selectionEnd;
      code.setRangeText('  ', a, b, 'end');
      S.edited = true;
    }
  });
  bindOrbit($('playViews'));

  const ro = new ResizeObserver(() => { rRef.resize(); rSub.resize(); S.dirty = true; kick(); });
  ro.observe($('playRef')); ro.observe($('playSub'));
  new IntersectionObserver(es => {
    S.visible = es.some(e => e.isIntersecting);
    if (S.visible) { S.dirty = true; kick(); }
  }).observe($('s6'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { S.dirty = true; kick(); } });

  syncPlayBtn();
  if (!glOk) {
    page.errors.push('play: WebGL2 is not available');
    $('subEmpty').textContent = 'this browser has no WebGL2, so the views stay empty; runs and scores still work';
  }
  const startId = (SCENES.find(s => s.id === ($('sceneSeg').querySelector('button.on') || {}).dataset?.v) || SCENES[0]).id;
  selectScene(startId).catch(err => page.errors.push('play start: ' + err.message));
  page.playReady = true;
  return S;
}
