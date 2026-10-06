// ============================================================================
//  LAB  ·  sections 04, 05 and 06 of the page
// ----------------------------------------------------------------------------
//  This module is the only part of the page that runs the simulation. It
//  binds the controls of section 04, the sequence panel of section 05 and
//  the campaign funnel of section 06. main.js imports it when section 04
//  comes near the view, and calls initLab(PAGE).
//
//  IT IS NOT AlphaProtein Novo. Every design here comes from scaffold.js,
//  which is a hand-written restraint denoiser and holds no learned model.
//  Every card that shows a result says so. Section 07 lists the real
//  pipeline's stages and the metrics this page cannot compute.
//
//  THE THREE JOBS.
//    04  One design. The scaffolder grows a chain around the motif. The
//        viewer plays the denoising back, frame by frame. The evaluator
//        then scores the design and the metric card shows the four
//        families, the catalytic measurements and the funnel steps.
//    05  An ensemble of sequences for that backbone. The panel shows the
//        consensus, the agreement at every position, and the two
//        self-consistency checks with a plain verdict.
//    06  A campaign. The runner makes many designs, scores each one and
//        draws how many survive each filter. A survivor loads back into
//        the lab.
//
//  WHY THE DENOISING PLAYS BACK. scaffold() is one synchronous call, and
//  240 steps of a 145-residue chain take about 40 ms. A browser paints
//  nothing inside a synchronous call, so a per-step draw would never
//  reach the screen. onStep therefore does two things: it copies about 70
//  C-alpha frames out of the run, and it draws on a time limit so that a
//  slow phone still shows progress. The player then runs those frames at
//  about 28 frames per second, so the user watches noise become a chain.
//  The run log gives the real time the run took.
//
//  COST, measured in Node 24 on the three motifs: scaffold 33 to 50 ms,
//  four sequences 2 to 5 ms, evaluate 55 to 96 ms. A campaign design uses
//  180 steps, two sequences and the cheap evaluator settings, which is
//  about 50 to 90 ms each. The campaign yields to the browser between
//  designs, so the page never freezes.
//
//  DETERMINISM. Every random number comes from rng() in design.js, by way
//  of the seed controls. The same seed gives the same design, the same
//  sequences and the same score.
//
//  EXPORTS   (grep -n "<anchor>" lab.js)
//    the entry point ... "export async function initLab"
//
//  INTERNAL   (grep -n "<anchor>" lab.js)
//    small helpers ..... "function esc"
//    segmented button .. "function seg"
//    the tooltip ....... "function showTip"
//    the viewer ........ "function startView"
//    frame player ...... "function playFrames"
//    one design run .... "function runDesign"
//    metric card ....... "function fillMetrics"
//    sequence panel .... "function fillSequences"
//    verdict box ....... "function fillVerdict"
//    campaign runner ... "function runCampaign"
//    funnel chart ...... "function drawFunnel"
//    load a survivor ... "function loadResult"
// ============================================================================
import { MOTIFS, motifById } from './motif.js';
import { scaffold } from './scaffold.js';
import { designSequence, ensembleAgreement, AA_INFO } from './sequence.js';
import { evaluate, funnel, FILTERS, tmScore } from './metrics.js';
import { createView } from './view3d.js';
import { parseMotifStr, planChain, rng, LIMITS } from './design.js';

// ---------------------------------------------------------------- helpers
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '–');
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '–');
const f3 = (v) => (Number.isFinite(v) ? v.toFixed(3) : '–');
const pct = (v) => (Number.isFinite(v) ? Math.round(v * 100) + '%' : '–');
// Hand the browser a turn to paint. requestAnimationFrame alone can run
// before the paint on a busy page, so the message queue is the safer wait.
const yieldToPage = () => new Promise((r) => setTimeout(r, 0));
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// Size a 2D canvas to its box at devicePixelRatio, capped at 2.
function fitCanvas(cv) {
  const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  const w = Math.max(1, r.width), h = Math.max(1, r.height);
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g, w, h };
}

// A segmented button group. items = [{ v, label }]. fn(v) runs on a press.
function seg(id, items, value, fn) {
  const el = $(id);
  if (!el) return;
  if (items) {
    el.innerHTML = items.map((it) => `<button type="button" data-v="${esc(it.v)}"${it.v === value ? ' class="on"' : ''}` +
      ` aria-pressed="${it.v === value}">${esc(it.label)}</button>`).join('');
  }
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    el.querySelectorAll('button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    fn(b.dataset.v);
  });
}

// ---------------------------------------------------------------- tooltip
// The page holds one tooltip, #tip. main.js hides it on a scroll and on a
// press somewhere else, so this module only has to place it.
const tipEl = () => $('tip');
function showTip(cx, cy, html) {
  const t = tipEl();
  if (!t) return;
  t.innerHTML = html;
  t.classList.add('on');
  const r = t.getBoundingClientRect();
  let x = cx + 14, y = cy - r.height - 12;
  if (x + r.width > innerWidth - 8) x = cx - r.width - 14;
  if (x < 8) x = 8;
  if (y < 110) y = cy + 18;
  t.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}
function hideTip() { const t = tipEl(); if (t) t.classList.remove('on'); }

// Hover, tap and drag on a canvas. kind is 'hover', 'tap' or 'drag'.
function pointerOn(cv, fn, leave) {
  let down = null;
  const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener('pointerdown', (e) => { down = { id: e.pointerId, x: e.clientX, y: e.clientY }; const [x, y] = pos(e); fn(x, y, e, 'drag'); });
  cv.addEventListener('pointermove', (e) => {
    const [x, y] = pos(e);
    if (down && down.id === e.pointerId) fn(x, y, e, 'drag');
    else if (e.pointerType === 'mouse') fn(x, y, e, 'hover');
  });
  cv.addEventListener('pointerup', (e) => {
    if (!down || down.id !== e.pointerId) return;
    const [x, y] = pos(e);
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 10) fn(x, y, e, 'tap');
    down = null;
  });
  cv.addEventListener('pointercancel', () => { down = null; });
  cv.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { down = null; if (leave) leave(); } });
}

// ---------------------------------------------------------------- the state
// One record of everything the lab currently holds.
const S = {
  page: null,
  view: null,
  motifId: MOTIFS[0].id,
  built: new Map(),          // motif id to built motif
  mode: 'novel',             // 'novel' or 'partial'
  indexed: true,
  cur: null,                 // { design, motif, run, result, seqs, agree, label }
  parent: null,              // the last design, for partial diffusion
  frames: [],                // [{ t, sigma, ca }] of the last run
  play: null,                // the running player
  busy: false,
  shell: false,              // the translucent pocket shell of the viewer
  camp: { running: false, stop: false, results: [], items: [], motifLabel: '' },
  campRows: [],              // funnel rows with their pixel boxes
  C: {},                     // colours read from style.css
};

function motif(id) {
  if (!S.built.has(id)) S.built.set(id, motifById(id));
  return S.built.get(id);
}
function entryOf(id) { return MOTIFS.find((m) => m.id === id) || MOTIFS[0]; }

// ---------------------------------------------------------------- the log
let logLines = [];
function logClear() { logLines = []; }
function log(text, cls) {
  logLines.push(cls ? `<span class="${cls}">${esc(text)}</span>` : esc(text));
  if (logLines.length > 160) logLines = logLines.slice(-160);
  const el = $('runLog');
  if (!el) return;
  el.innerHTML = logLines.join('\n');
  el.scrollTop = el.scrollHeight;
}

// ---------------------------------------------------------------- the viewer
function startView() {
  const cv = $('labView');
  if (!cv) throw new Error('the lab has no canvas');
  const onPick = (id, info) => {
    const d = S.cur && S.cur.design;
    if (!d) return;
    if (info && info.kind === 'ligand') {
      const a = (d.ligand.atoms || [])[info.index] || {};
      showTip(lastPt.x, lastPt.y, `<b>${esc(d.ligand.name || 'ligand')}</b><br>atom <span class="v">${esc(a.name || '?')}</span>, element ${esc(a.el || '?')}`);
      return;
    }
    if (id === null || id === undefined) { hideTip(); return; }
    const aa = d.seq[id] || 'X';
    const info2 = AA_INFO[aa];
    const kind = d.fixed[id] ? 'held by the motif' : 'designed';
    showTip(lastPt.x, lastPt.y, `<b>residue ${id + 1}</b> &middot; ${esc(kind)}<br>` +
      `amino acid <span class="v">${esc(aa)}</span>${info2 ? ' ' + esc(info2.name) : ''}<br>` +
      `structure <span class="v">${esc(d.ss[id] || 'L')}</span>`);
  };
  const lastPt = { x: 0, y: 0 };
  cv.addEventListener('pointerdown', (e) => { lastPt.x = e.clientX; lastPt.y = e.clientY; });
  S.view = createView(cv, { spin: true, onPick });
  return S.view;
}

// Draw one scene. `over` holds the fields that change this frame.
function drawScene(over = {}, opts = null) {
  if (!S.view || !S.cur) return 0;
  const d = over.design || S.cur.design;
  const scene = {
    design: d, motif: S.cur.motif, ligand: S.cur.motif.ligand,
    colorBy: 'ss', pocket: over.pocket === undefined ? S.shell : over.pocket,
    noise: over.noise || 0, seed: (S.cur.design.meta && S.cur.design.meta.seed) || 0,
    trace: true,
  };
  try { return S.view.draw(scene, opts || undefined); } catch (e) { S.page.errors.push('view.draw: ' + e.message); return 0; }
}

// ---------------------------------------------------------------- the player
// The frames of the last run, played back at about 28 frames per second.
// A frame carries t, which falls from 1 to 0, and sigma, the noise left at
// that point. The cloud of the viewer takes sigma, so the balls spread out
// exactly as far as the noise does.
const NOISE_SCALE = 4.5;       // A; sigma at which the cloud is fully loose
const PLAY_MS = 2600;          // the whole trajectory, in milliseconds

function noiseOf(frame) { return clamp((frame.sigma || 0) / NOISE_SCALE, 0, 1); }

function showFrame(i) {
  if (!S.frames.length) return;
  const k = clamp(Math.round(i), 0, S.frames.length - 1);
  const fr = S.frames[k];
  const scrub = $('stepScrub'), out = $('scrubOut');
  if (scrub && +scrub.value !== k) scrub.value = String(k);
  if (out) out.textContent = `step ${fr.step} · noise ${f2(fr.sigma)} Å`;
  drawScene({ design: { ...S.cur.design, ca: fr.ca }, noise: noiseOf(fr), pocket: S.shell && noiseOf(fr) < 0.25 });
}

function stopPlay() {
  if (S.play) cancelAnimationFrame(S.play.id);
  S.play = null;
  const b = $('playBtn');
  if (b) { b.textContent = 'play'; b.classList.remove('on'); }
}

function playFrames(from = 0) {
  if (!S.frames.length) return;
  stopPlay();
  const b = $('playBtn');
  if (b) { b.textContent = 'pause'; b.classList.add('on'); }
  const n = S.frames.length;
  const start = nowMs() - (from / Math.max(1, n - 1)) * PLAY_MS;
  const tick = () => {
    const u = (nowMs() - start) / PLAY_MS;
    if (u >= 1) { showFrame(n - 1); stopPlay(); return; }
    showFrame(u * (n - 1));
    S.play.id = requestAnimationFrame(tick);
  };
  S.play = { id: requestAnimationFrame(tick) };
}

// ---------------------------------------------------------------- 04 run one
// Read the controls, check them, then run the scaffolder, the sequence
// designer and the evaluator. Each stage yields to the browser first, so
// the page keeps answering a press.
async function runDesign() {
  if (S.busy) return;
  const btn = $('runBtn');
  const strEl = $('motifStr'), lenEl = $('seqLen');
  const motifStr = strEl.value.trim();
  const seqLength = lenEl.value.trim() || null;
  const seed = clamp(parseInt($('seedIn').value, 10) || 0, 0, 99999);
  const steps = clamp(parseInt($('stepsIn').value, 10) || 240, 40, 600);
  const mo = motif(S.motifId);
  strEl.classList.remove('bad'); lenEl.classList.remove('bad');
  // The log is cleared before the check, not after it, so a refusal is
  // the only thing in the box and nobody reads the last run as this one.
  logClear();

  // Check the motif language before anything expensive starts. A bad
  // motif_str must show in the log and leave the page working.
  let plan = null;
  if (S.mode === 'novel') {
    try {
      const parsed = parseMotifStr(motifStr, rng(seed || 1));
      plan = planChain(parsed, { seqLength, rand: rng(seed || 1) });
      if (plan.total < LIMITS.minLen || plan.total > LIMITS.maxLen) {
        throw new Error(`the plan gives ${plan.total} residues, outside ${LIMITS.minLen} to ${LIMITS.maxLen}`);
      }
      const want = mo.residues.length;
      const got = parsed.chain.reduce((s, x) => s + (x.kind === 'motif' ? x.to - x.from + 1 : 0), 0);
      if (got !== want) throw new Error(`this motif has ${want} residues but motif_str holds ${got}`);
    } catch (e) {
      strEl.classList.add('bad');
      log('motif_str was refused: ' + e.message, 'err');
      log('Nothing ran. Fix the text and press run again.');
      return;
    }
  } else if (!S.parent) {
    log('Partial diffusion needs a parent. Run one design from noise first.', 'err');
    return;
  }

  const parentBefore = S.parent;
  S.busy = true;
  btn.disabled = true;
  stopPlay();
  const label = `${entryOf(S.motifId).label}, seed ${seed}`;
  log(`${label}. ${S.mode === 'partial' ? 'Partial diffusion from the last design.' : (S.indexed ? 'Indexed placement.' : 'Unindexed: several placements are tried.')}`);
  if (plan) log(`The plan gives ${plan.total} residues.`);
  log('Scaffolding…');
  await yieldToPage();

  // --- the scaffolder --------------------------------------------------
  let run = null;
  const frames = [];
  const every = Math.max(1, Math.ceil(steps / 70));
  let lastDraw = 0;
  try {
    const partial = S.mode === 'partial'
      ? { parent: S.parent, stepsBack: Math.max(1, Math.round(steps * (parseInt($('backIn').value, 10) || 60) / 100)) }
      : null;
    run = scaffold({
      motif: mo, motifStr, seqLength, seed, steps,
      partial, unindexed: S.mode === 'novel' && !S.indexed,
      keepTrajectory: true,
      onStep: ({ i, t, sigma, ca }) => {
        // onStep hands over the live array, so a kept frame must copy it.
        if (i % every === 0 || i === steps) frames.push({ step: i, t, sigma, ca: Float32Array.from(ca) });
        // A draw on a time limit, so a slow device still shows progress.
        // The draw needs a design to borrow its other arrays from, so it
        // runs only when the last design has the same residue count.
        const now = nowMs();
        if (S.cur && S.cur.design.n * 3 === ca.length && now - lastDraw > 90) {
          lastDraw = now;
          drawScene({ design: { ...S.cur.design, ca }, noise: clamp(sigma / NOISE_SCALE, 0, 1), pocket: false });
        }
      },
    });
  } catch (e) {
    log('The scaffolder stopped: ' + e.message, 'err');
    log('The page is still working. Change a control and press run again.');
    S.busy = false; btn.disabled = false;
    return;
  }
  if (!frames.length || frames[frames.length - 1].step !== steps) {
    const last = run.trajectory[run.trajectory.length - 1];
    frames.push({ step: steps, t: 0, sigma: 0, ca: Float32Array.from(last ? last.ca : run.design.ca) });
  }
  // The last frame is the finished design, not the last noisy guess.
  frames[frames.length - 1] = { step: steps, t: 0, sigma: 0, ca: Float32Array.from(run.design.ca) };

  S.frames = frames;
  S.cur = { design: run.design, motif: mo, run, result: null, seqs: null, agree: null, label, source: 'lab' };
  S.parent = run.design;
  for (const line of run.log) log('  ' + line);
  log(`${run.steps} reverse steps in ${f1(run.ms)} ms. ${frames.length} frames were kept.`);

  // Partial diffusion: say how much of the parent is left. The TM-score
  // is ours, measured on our own two designs. Section 07 gives the real
  // pipeline's own figures, which are not comparable with this one.
  if (S.mode === 'partial' && parentBefore && parentBefore.n === run.design.n) {
    try {
      const tm = tmScore(run.design.ca, parentBefore.ca, run.design.n);
      const back = run.design.meta.partial ? run.design.meta.partial.stepsBack : 0;
      log(`TM to the parent ${f3(tm.tm)} after ${back} of ${steps} steps back. Fewer steps back keeps more of the parent.`);
      log('That number is ours, measured on our own two designs. The real pipeline\u2019s own figures are in section 07.');
    } catch (e) { log('The comparison with the parent failed: ' + e.message, 'err'); }
  }

  const empty = $('labEmpty');
  if (empty) empty.hidden = true;
  const scrub = $('stepScrub');
  if (scrub) { scrub.max = String(frames.length - 1); scrub.value = '0'; }
  drawScene({ design: { ...run.design, ca: frames[0].ca }, noise: noiseOf(frames[0]), pocket: false }, { fit: true });
  S.cur.fitted = true;
  playFrames(0);

  // --- the sequence ensemble -------------------------------------------
  await yieldToPage();
  try {
    const seqs = designSequence(run.design, mo, { seed, temperature: 0.1, nSeq: 4 });
    run.design.seq = seqs[0].seq;
    const agree = ensembleAgreement(seqs);
    S.cur.seqs = seqs; S.cur.agree = agree;
    fillSequences();
    log(`Four sequences at temperature 0.1. The ensemble agrees at ${pct(agree.mean)} of positions, and a pair of them shares ${pct(agree.identity)}.`);
  } catch (e) {
    log('The sequence designer stopped: ' + e.message, 'err');
    S.page.errors.push('designSequence: ' + e.message);
  }

  // --- the evaluation ---------------------------------------------------
  await yieldToPage();
  log('Scoring, which runs the pin release twice and one refold from noise…');
  await yieldToPage();
  try {
    const result = evaluate(run.design, mo, { seed: 101 + seed });
    S.cur.result = result;
    fillMetrics(result);
    fillVerdict(result);
    log(`Scored in ${f1(result.ms)} ms. Overall ${f2(result.overall)}.`);
    log(result.pass ? 'This design passes every filter of the campaign funnel.' : `It fails: ${result.failed.join(', ')}.`, result.pass ? 'ok' : 'err');
  } catch (e) {
    log('The evaluator stopped: ' + e.message, 'err');
    S.page.errors.push('evaluate: ' + e.message);
  }
  S.busy = false;
  btn.disabled = false;
}

// ---------------------------------------------------------------- 04 metrics
const FAMILY = [
  { key: 'motif', label: 'Motif held', colour: '--f-motif', why: 'The catalytic residues sit where the chemistry needs them, and they stay there when the pin comes off.' },
  { key: 'pocket', label: 'Pocket', colour: '--f-pocket', why: 'The ligand is enclosed, free of clashes, and has neighbours on every side.' },
  { key: 'fold', label: 'Fold', colour: '--f-fold', why: 'The chain is as compact as a real protein of its length, with helices, strands and contacts across the fold.' },
  { key: 'selfConsistency', label: 'Site holds', colour: '--f-sc', why: 'The site survives the pin release: let the catalytic residues go, relax, and see how far they move.' },
];

function fillMetrics(r) {
  const el = $('metricCard');
  if (!el) return;
  const m = r.metrics;
  const rows = FAMILY.map((fa) => {
    const v = r.families[fa.key];
    const w = Number.isFinite(v) ? clamp(v, 0, 1) * 100 : 0;
    return `<div class="mc-row" title="${esc(fa.why)}"><span>${esc(fa.label)}</span>` +
      `<span class="bar" style="--c:var(${fa.colour})"><i style="width:${w.toFixed(1)}%"></i></span>` +
      `<output>${f2(v)}</output></div>`;
  }).join('');

  const subs = [
    ['Motif drift, pin off', `${f2(m.selfConsistency.motifRmsd)} Å`],
    ['Motif pin check', `${f3(m.motifHeldRmsd)} Å`],
    ['TM to the design, pin off', f3(m.selfConsistency.tm)],
    ['Ligand enclosed', pct(m.ligandBuried)],
    ['Ligand clashes', `${f1(m.ligandClashPct)}%`],
    ['Radius of gyration', `${f1(m.rg)} of ${f1(m.rgTarget)} Å`],
    ['Helix and strand', pct(m.ssFraction.H + m.ssFraction.E)],
    ['Relative contact order', f3(m.contactOrder)],
    ['Neighbours per catalytic residue', f1(m.motifSupport)],
  ].map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');

  const geo = (m.geometry || []).map((g) => {
    const unit = g.kind === 'angle' ? '°' : ' Å';
    return `<tr><td>${esc(g.label)}</td><td class="v" data-col="now">${f2(g.value)}${unit}</td>` +
      `<td class="v" data-col="wanted">${f2(g.ideal)} ± ${f2(g.tol)}</td>` +
      `<td class="p ${g.pass ? 'ok' : 'no'}">${g.pass ? 'yes' : 'no'}</td></tr>`;
  }).join('');

  const flags = FILTERS.map((fi) => {
    const ok = !r.failed.includes(fi.key);
    return `<li class="${ok ? 'ok' : 'no'}" title="${esc(fi.why)}">${esc(fi.label)}</li>`;
  }).join('');

  el.innerHTML =
    `<div class="mc-overall"><b>${f2(r.overall)}</b><span>overall, 0 to 1<br>${esc(S.cur.label)}, ${r.extra.n} residues</span></div>` +
    rows +
    `<div class="mc-sub">${subs}</div>` +
    `<div class="mc-h">Catalytic measurements, on the design</div>` +
    `<table class="geo mc-geo"><thead><tr><th>What is held</th><th>now</th><th>wanted</th><th>in</th></tr></thead><tbody>${geo}</tbody></table>` +
    `<div class="mc-h">Funnel steps</div><ul class="mc-flags">${flags}</ul>` +
    `<p class="mc-note">Every number here is this page's own simulation, measured on its own design. None of them is a result of AlphaProtein Novo, and none comes from the preprint.</p>`;
}

// ---------------------------------------------------------------- 05 sequence
// The ensemble panel. The consensus row shades every position by how much
// of the ensemble agrees there, so a position the designer is sure about
// reads bright and a position it is guessing at reads faint.
function fillSequences() {
  const el = $('seqPanel');
  if (!el || !S.cur || !S.cur.seqs) return;
  const seqs = S.cur.seqs, agree = S.cur.agree, design = S.cur.design;
  const n = design.n;
  const per = seqs[0].perResidue;
  const spans = [];
  for (let i = 0; i < n; i++) {
    const a = agree.perPosition[i];
    const held = design.fixed[i] === 1;
    const o = (0.12 + 0.88 * ((a - 1 / seqs.length) / (1 - 1 / seqs.length || 1))).toFixed(2);
    spans.push(`<span class="sq${held ? ' held' : ''}" data-i="${i}" style="--o:${o}">${esc(agree.consensus[i])}</span>`);
  }
  const count = new Map();
  for (const c of agree.consensus) count.set(c, (count.get(c) || 0) + 1);
  const top = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([c, k]) => `${c}\u00a0${Math.round(100 * k / n)}%`).join(' · ');
  const oily = [...agree.consensus].filter((c) => (AA_INFO[c] || {}).hydropathy > 0).length / n;

  el.innerHTML =
    `<div class="sq-head"><span>consensus of ${seqs.length} sequences, ${n} residues</span>` +
      `<span>agreement <b>${pct(agree.mean)}</b> · pairwise identity <b>${pct(agree.identity)}</b></span></div>` +
    `<div class="sq-row" id="sqRow">${spans.join('')}</div>` +
    `<div class="sq-key"><span><i class="k1"></i>every sequence agrees</span><span><i class="k0"></i>the ensemble splits</span>` +
      `<span><i class="kh"></i>held by the motif</span></div>` +
    `<div class="mc-sub"><div><span>Most common letters</span><b>${esc(top)}</b></div>` +
      `<div><span>Oily share of the consensus</span><b>${pct(oily)}</b></div>` +
      `<div><span>Sampling temperature</span><b>0.1</b></div>` +
      `<div><span>Held at the motif identity</span><b>${seqs[0].fixedCount} residues</b></div></div>` +
    seqs.map((s, k) => `<div class="seqrow"><em>#${k + 1}</em> ${esc(s.seq)}</div>`).join('') +
    `<p class="mc-note">Our designer is a heuristic and not LigandMPNN. It scores a position by burial, by the local shape and by the ligand, then samples. The letters are plausible, not predictions.</p>`;

  // Hover and tap on a position.
  const row = $('sqRow');
  if (!row) return;
  const tell = (e) => {
    const sp = e.target.closest('.sq');
    if (!sp) { hideTip(); return; }
    const i = +sp.dataset.i;
    const p = per[i] || {};
    const info = AA_INFO[agree.consensus[i]] || {};
    const letters = seqs.map((s) => s.seq[i]).join('');
    showTip(e.clientX, e.clientY,
      `<b>residue ${i + 1}</b> &middot; ${design.fixed[i] ? 'held by the motif' : 'designed'}<br>` +
      `ensemble <span class="v">${esc(letters)}</span>, agreement <span class="v">${pct(agree.perPosition[i])}</span><br>` +
      `consensus <span class="v">${esc(agree.consensus[i])}</span>${info.name ? ' ' + esc(info.name) : ''}<br>` +
      `structure <span class="v">${esc(p.ss || design.ss[i])}</span>, burial <span class="v">${f2(p.burial)}</span>` +
      (Number.isFinite(p.ligDist) ? `<br>to the ligand <span class="v">${f1(p.ligDist)} Å</span>` : ''));
  };
  row.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') tell(e); });
  row.addEventListener('pointerdown', tell);
  row.addEventListener('pointerleave', () => hideTip());
}

// ---------------------------------------------------------------- 05 verdict
// The two self-consistency checks, side by side, with a plain verdict.
// One of them measures the design and the other one measures our
// denoiser's limit. The box says which is which, because the page must
// not let a reader take either for the real pipeline's AlphaFold 3 test.
function fillVerdict(r) {
  const el = $('scBox');
  if (!el) return;
  const sc = r.metrics.selfConsistency;
  const fn = r.metrics.fromNoise;
  const ran = !!(fn && Number.isFinite(fn.tm));
  const step = FILTERS.find((f) => f.key === 'selfConsistent');
  const held = !r.failed.includes('selfConsistent');
  const card = (cls, title, tag, lines, note) =>
    `<div class="sc-card ${cls}"><div class="sc-top"><b>${esc(title)}</b><span class="tag ${tag.cls}">${esc(tag.text)}</span></div>` +
    `<div class="mc-sub">${lines.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>` +
    `<p>${note}</p></div>`;

  el.innerHTML =
    card(held ? 'pass' : 'fail', 'Check 1: let the pin go',
      { cls: 'toy', text: held ? 'our simulation: the site holds' : 'our simulation: the site springs apart' },
      [['Motif drift', `${f2(sc.motifRmsd)} Å`], ['C-alpha RMSD', `${f2(sc.rmsd)} Å`],
        ['TM to the design', f3(sc.tm)], ['Restart at', `${Math.round(sc.release * 100)}% of the schedule`]],
      `The catalytic residues are released and the chain relaxes under its own restraints. ` +
      (held
        ? `The site moves ${esc(f2(sc.motifRmsd))} \u00c5, inside what the funnel step below asks for, so the pocket holds the motif and not the clamp.`
        : `The site moves ${esc(f2(sc.motifRmsd))} Å. The scaffolder was the only thing holding it, which is the failure this whole check exists to find.`)) +
    card('flat', 'Check 2: fold the sequence from noise',
      { cls: 'toy', text: ran ? 'carries no signal here' : 'not run for this design' },
      [['TM to the design', ran ? f3(fn.tm) : 'not run'], ['C-alpha RMSD', ran ? `${f2(fn.rmsd)} \u00c5` : 'not run'],
        ['Informative', 'no']],
      ran
        ? `This is the check the real pipeline runs with AlphaFold 3, and our version of it fails honestly. ` +
          `A restraint denoiser has no learned map from a sequence to a fold, so the score sits near the value of two ` +
          `unrelated chains of the same length whatever sequence goes in. The gap between this box and check 1 ` +
          `is the difference between a learned model and a set of rules.`
        : `A campaign design skips this check, because the check carries no signal and costs about a third of the ` +
          `score. Press "run a design" in section 04 to see it measured. It is the check the real pipeline runs with ` +
          `AlphaFold 3, and our version of it returns the same flat number for every sequence, because a restraint ` +
          `denoiser has no learned map from a sequence to a fold.`) +
    `<p class="mc-note">The funnel step is <b>${esc(step ? step.label : '')}</b>. ${esc(step ? step.why : '')}</p>`;
}

// ---------------------------------------------------------------- 06 campaign
const CAMP_STEPS = 180;        // reverse steps per campaign design

async function runCampaign() {
  if (S.camp.running || S.busy) return;
  const n = clamp(parseInt($('campN').value, 10) || 12, 4, 48);
  const seed0 = clamp(parseInt($('campSeed').value, 10) || 0, 0, 99999);
  const mix = S.campMix === 'mixed';
  S.camp = { running: true, stop: false, results: [], items: [], motifLabel: mix ? 'all three motifs' : entryOf(S.motifId).label };
  $('campBtn').disabled = true;
  $('campStop').disabled = false;
  const empty = $('funnelEmpty');
  if (empty) empty.hidden = true;
  $('campList').innerHTML = '';
  const t0 = nowMs();

  for (let k = 0; k < n; k++) {
    if (S.camp.stop) break;
    $('campProg').textContent = `Running design ${k + 1} of ${n}… ${S.camp.items.filter((x) => x.result.pass).length} have passed every filter so far.`;
    await yieldToPage();
    const id = mix ? MOTIFS[k % MOTIFS.length].id : S.motifId;
    const en = entryOf(id), mo = motif(id);
    const seed = (seed0 + k) >>> 0;
    const unindexed = k % 2 === 1;
    try {
      const run = scaffold({
        motif: mo, motifStr: en.motifStr, seqLength: en.seqLength, seed,
        steps: CAMP_STEPS, keepTrajectory: false, unindexed,
      });
      const seqs = designSequence(run.design, mo, { seed, temperature: 0.1, nSeq: 2 });
      run.design.seq = seqs[0].seq;
      // The cheap settings: one pin release and no refold from noise. The
      // refold carries no signal, so a campaign does not pay for it.
      const result = evaluate(run.design, mo, { seed: 101 + seed, fromNoise: false, releaseSeeds: 1 });
      S.camp.results.push(result);
      S.camp.items.push({
        design: run.design, motif: mo, run, result, seqs,
        agree: ensembleAgreement(seqs),
        label: `${en.label}, seed ${seed}${unindexed ? ', unindexed' : ''}`,
        source: 'campaign',
      });
    } catch (e) {
      log(`Design ${k + 1} of the campaign stopped: ${e.message}`, 'err');
    }
    drawFunnel();
  }

  const ms = nowMs() - t0;
  const fu = funnel(S.camp.results);
  S.camp.running = false;
  $('campBtn').disabled = false;
  $('campStop').disabled = true;
  $('campProg').textContent =
    `${fu.started} designs of ${S.camp.motifLabel} in ${(ms / 1000).toFixed(1)} s. ` +
    `${fu.kept} survived every filter, which is ${pct(fu.kept / Math.max(1, fu.started))} of the batch. ` +
    `Half of the batch placed the motif where motif_str says, and half searched for a placement.`;
  drawFunnel();
  fillSurvivors(fu);
  log(`Campaign: ${fu.started} designs in ${(ms / 1000).toFixed(1)} s. ` +
    fu.steps.map((s) => `${s.key} ${s.kept}/${s.of}`).join(', ') + '.');
}

// The survivors, as chips. A press loads that design back into the lab.
function fillSurvivors(fu) {
  const el = $('campList');
  if (!el) return;
  if (!fu.survivors.length) {
    el.innerHTML = '<p class="mc-note">No design of this batch passed every filter. That is a normal outcome of a small batch, and it is why a real campaign generates thousands.</p>';
    return;
  }
  const items = S.camp.items.filter((it) => fu.survivors.includes(it.result))
    .sort((a, b) => b.result.overall - a.result.overall);
  el.innerHTML = '<div class="camp-h">Survivors, best first. Press one to load it into the lab.</div>' +
    '<div class="camp-chips">' + items.map((it) => {
      const k = S.camp.items.indexOf(it);
      return `<button type="button" class="camp-chip" data-k="${k}"><b>${f2(it.result.overall)}</b>` +
        `<span>${esc(it.label)}</span><small>${it.design.n} residues · motif drift ${f1(it.result.metrics.selfConsistency.motifRmsd)} Å</small></button>`;
    }).join('') + '</div>' +
    '<p class="mc-note">These are our own designs, scored by our own filters. The proportions say nothing about AlphaProtein Novo.</p>';
  el.querySelectorAll('.camp-chip').forEach((b) => b.addEventListener('click', () => loadResult(S.camp.items[+b.dataset.k])));
}

// Load a campaign design into section 04 and section 05.
function loadResult(item) {
  if (!item) return;
  stopPlay();
  S.frames = [];
  S.cur = item;
  S.parent = item.design;
  const scrub = $('stepScrub');
  if (scrub) { scrub.max = '0'; scrub.value = '0'; }
  const out = $('scrubOut');
  if (out) out.textContent = 'no frames';
  const empty = $('labEmpty');
  if (empty) empty.hidden = true;
  drawScene({}, { fit: true });
  fillMetrics(item.result);
  fillSequences();
  fillVerdict(item.result);
  logClear();
  log(`Loaded ${item.label} from the campaign. Overall ${f2(item.result.overall)}.`);
  log('A campaign design keeps no trajectory, so there is nothing to scrub. Press run to make a fresh one with frames.');
  $('s4').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------------------------------------------------------------- 06 funnel
const STEP_COLOUR = { chain: '--f-fold', site: '--f-motif', fold: '--f-fold', pocket: '--f-pocket', support: '--f-pocket', selfConsistent: '--f-sc' };

function drawFunnel() {
  const cv = $('funnelCv');
  if (!cv) return;
  const { g, w, h } = fitCanvas(cv);
  const res = S.camp.results;
  S.campRows = [];
  if (!res.length) {
    g.fillStyle = S.C.dim; g.font = '12px Inter, system-ui, sans-serif'; g.textAlign = 'center';
    g.fillText('Press "run a campaign" to fill the funnel.', w / 2, h / 2);
    return;
  }
  const fu = funnel(res);
  const rows = [{ key: 'start', label: `Generated`, kept: fu.started, of: fu.started, why: 'Every design the campaign made. Half take the placement motif_str gives, and half search for one.' }, ...fu.steps];
  g.font = w < 520 ? '11px Inter, system-ui, sans-serif' : '12px Inter, system-ui, sans-serif';
  // The label column is as wide as the longest label, so no label is cut
  // off at the left edge of the canvas.
  let widest = 0;
  for (const r of rows) widest = Math.max(widest, g.measureText(r.label).width);
  const padL = Math.min(w * 0.42, Math.ceil(widest) + 14), padR = 58, padT = 16, padB = 26;
  const rowH = (h - padT - padB) / rows.length;
  const barH = Math.min(26, rowH * 0.62);
  const span = Math.max(10, w - padL - padR);
  const scale = (k) => span * (k / Math.max(1, fu.started));
  g.textBaseline = 'middle';
  g.font = w < 520 ? '11px Inter, system-ui, sans-serif' : '12px Inter, system-ui, sans-serif';

  rows.forEach((r, i) => {
    const y = padT + rowH * i + rowH / 2;
    const colour = r.key === 'start' ? S.C.acc : css(STEP_COLOUR[r.key] || '--acc');
    // The share that reached this step, as a faint outline.
    g.fillStyle = 'rgba(255,255,255,0.055)';
    g.beginPath(); g.roundRect ? g.roundRect(padL, y - barH / 2, scale(r.of), barH, 5) : g.rect(padL, y - barH / 2, scale(r.of), barH); g.fill();
    // The share that survived.
    g.fillStyle = colour;
    g.globalAlpha = 0.85;
    g.beginPath(); g.roundRect ? g.roundRect(padL, y - barH / 2, Math.max(2, scale(r.kept)), barH, 5) : g.rect(padL, y - barH / 2, Math.max(2, scale(r.kept)), barH); g.fill();
    g.globalAlpha = 1;
    // The label on the left, the count on the right.
    g.fillStyle = S.C.ink2; g.textAlign = 'right';
    g.fillText(r.label, padL - 10, y);
    g.fillStyle = '#fff'; g.textAlign = 'left';
    g.font = '500 12px ui-monospace, "SF Mono", Menlo, monospace';
    g.fillText(String(r.kept), padL + scale(r.of) + 8, y);
    if (r.key !== 'start' && r.lost) {
      g.fillStyle = S.C.dim;
      g.font = '11px Inter, system-ui, sans-serif';
      g.fillText(`−${r.lost}`, padL + scale(r.of) + 8 + 22, y);
    }
    g.font = w < 520 ? '11px Inter, system-ui, sans-serif' : '12px Inter, system-ui, sans-serif';
    S.campRows.push({ y0: padT + rowH * i, y1: padT + rowH * (i + 1), row: r });
  });
  // The axis note at the foot.
  g.fillStyle = S.C.dim; g.textAlign = 'left'; g.font = '11px Inter, system-ui, sans-serif';
  const foot = w < 620
    ? `bar length = share of ${fu.started}`
    : `bar length = share of the ${fu.started} designs that reached and passed each step`;
  g.fillText(foot, padL, h - 10);
}

// ---------------------------------------------------------------- init
export async function initLab(page) {
  S.page = page || { errors: [], missing: [] };
  S.C = {
    ink: css('--ink'), ink2: css('--ink2'), dim: css('--dim'),
    acc: css('--acc'), pass: css('--pass'), fail: css('--fail'),
  };

  logClear();
  log('The lab is ready. Pick a motif, then press "run a design".');
  log('Nothing here is AlphaProtein Novo. The scaffolder is this page’s own restraint denoiser.');

  startView();

  // The two overlays carry a "loading" message that is wrong once the lab
  // is here. The funnel canvas paints its own message, so the overlay above
  // it is hidden; otherwise the two texts land on the same spot. The lab
  // canvas paints nothing when it is empty, so its overlay stays and says
  // what to press.
  const fe = $('funnelEmpty');
  if (fe) fe.hidden = true;
  const le = $('labEmpty');
  if (le) le.textContent = 'Press "run a design" to grow a chain around the motif.';

  // --- section 04 controls ---------------------------------------------
  seg('motifSeg', MOTIFS.map((m) => ({ v: m.id, label: m.label })), S.motifId, (v) => {
    S.motifId = v;
    const en = entryOf(v);
    $('motifStr').value = en.motifStr;
    $('seqLen').value = en.seqLength;
    $('motifStr').classList.remove('bad');
    log(`Motif: ${en.label}. ${en.chemistry}`);
    log(`motif_str and seq_length now hold this motif’s own values. ${en.id === 'kemp' ? 'They come from the repository’s Kemp manifest.' : 'They are ours, not the repository’s.'}`);
  });
  seg('idxSeg', [{ v: 'indexed', label: 'indexed' }, { v: 'unindexed', label: 'unindexed' }], 'indexed', (v) => {
    S.indexed = v === 'indexed';
    log(S.indexed
      ? 'Indexed: the motif sits at the sequence positions motif_str gives.'
      : 'Unindexed: the scaffolder draws several placements, tries each one briefly, and keeps the best.');
  });
  seg('modeSeg', null, 'novel', (v) => {
    S.mode = v;
    const wrap = $('backWrap');
    if (wrap) wrap.hidden = v !== 'partial';
    const idx = $('idxWrap');
    if (idx) idx.hidden = v === 'partial';
    log(v === 'partial'
      ? 'Partial diffusion: the last design is noised part way back, then the reverse runs again from there.'
      : 'From noise: the chain starts as a cloud and only the motif is certain.');
    if (v === 'partial' && !S.parent) log('There is no parent yet. Run one design from noise first.', 'err');
  });
  const back = $('backIn');
  if (back) {
    const show = () => { const o = $('backOut'); if (o) o.textContent = `${back.value}% back`; };
    back.addEventListener('input', show);
    show();
  }
  $('runBtn').addEventListener('click', () => { runDesign().catch((e) => { S.busy = false; $('runBtn').disabled = false; log('The run stopped: ' + e.message, 'err'); S.page.errors.push('runDesign: ' + e.message); }); });
  $('motifStr').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('runBtn').click(); });

  const shellBtn = $('shellBtn');
  if (shellBtn) {
    shellBtn.addEventListener('click', () => {
      S.shell = !S.shell;
      shellBtn.setAttribute('aria-pressed', String(S.shell));
      shellBtn.classList.toggle('on', S.shell);
      if (S.cur) drawScene({});
    });
  }
  const scrub = $('stepScrub');
  scrub.addEventListener('input', () => { stopPlay(); showFrame(+scrub.value); });
  $('playBtn').addEventListener('click', () => {
    if (!S.frames.length) { log('There are no frames yet. Press "run a design" first.'); return; }
    if (S.play) stopPlay();
    else playFrames(+scrub.value >= S.frames.length - 1 ? 0 : +scrub.value);
  });

  // --- section 06 controls ---------------------------------------------
  S.campMix = 'one';
  seg('campMix', [{ v: 'one', label: 'this motif' }, { v: 'mixed', label: 'all three motifs' }], 'one', (v) => { S.campMix = v; });
  $('campBtn').addEventListener('click', () => { runCampaign().catch((e) => { S.camp.running = false; $('campBtn').disabled = false; $('campStop').disabled = true; log('The campaign stopped: ' + e.message, 'err'); S.page.errors.push('runCampaign: ' + e.message); }); });
  $('campStop').addEventListener('click', () => { S.camp.stop = true; $('campProg').textContent = 'Stopping after this design…'; });
  $('campStop').disabled = true;

  // The funnel answers hover and tap, and redraws after a width change.
  const fcv = $('funnelCv');
  pointerOn(fcv, (_x, y, e, kind) => {
    if (kind === 'drag' && e.pointerType === 'mouse' && e.buttons) return;
    const hit = S.campRows.find((r) => y >= r.y0 && y <= r.y1);
    if (!hit) { hideTip(); return; }
    const r = hit.row;
    showTip(e.clientX, e.clientY, `<b>${esc(r.label)}</b><br>` +
      `kept <span class="v">${r.kept}</span> of <span class="v">${r.of}</span> that reached it` +
      (r.lost ? `, dropped <span class="v">${r.lost}</span>` : '') + `<br>${esc(r.why)}`);
  }, hideTip);
  let pend = false;
  new ResizeObserver(() => {
    if (pend) return;
    pend = true;
    requestAnimationFrame(() => { pend = false; drawFunnel(); });
  }).observe(fcv);
  drawFunnel();

  // The lab starts empty on purpose: a run costs about 150 ms of work and
  // the user asks for it. The panels say what to press.
  page.lab = {
    run: () => runDesign(), campaign: () => runCampaign(),
    state: () => ({
      busy: S.busy, motif: S.motifId, mode: S.mode, indexed: S.indexed,
      frames: S.frames.length, playing: !!S.play,
      overall: S.cur && S.cur.result ? S.cur.result.overall : null,
      failed: S.cur && S.cur.result ? S.cur.result.failed : null,
      n: S.cur ? S.cur.design.n : null,
      campaign: S.camp.results.length ? funnel(S.camp.results).steps.map((s) => ({ key: s.key, kept: s.kept, of: s.of })) : null,
      campaignRunning: S.camp.running,
      survivors: S.camp.results.length ? funnel(S.camp.results).kept : null,
      agreement: S.cur && S.cur.agree ? S.cur.agree.mean : null,
      viewPrims: S.view ? S.view.stats().prims : 0,
    }),
  };
  return page.lab;
}
