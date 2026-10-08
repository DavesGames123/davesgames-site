// ============================================================================
//  MRNA VACCINE  ·  page logic  (module)
// ----------------------------------------------------------------------------
//  Binds every card of index.html. Facts come from data.js; scenes are
//  drawn by draw.js. One rAF loop redraws only the canvases that are on
//  screen and need motion. saver.js installs window.snSaver.
//
//  GREP MAP
//      grep -n 'function fit'           canvas size from CSS size and DPR
//      grep -n 'function initStats'     hero numbers
//      grep -n 'function initDecay'     01 decay chart
//      grep -n 'function initBase'      02 base figure (SVG)
//      grep -n 'function initStrand'    03 strand, drag, taps, regions
//      grep -n 'function initDelivery'  04 lipids, charge, journey
//      grep -n 'function initTranslate' 05 ribosomes
//      grep -n 'function initSpike'     06 spike and 2P
//      grep -n 'function initTitre'     07 antibody curve
//      grep -n 'function initProof'     08 cases and efficacy
//      grep -n 'function initDays'      09 the 2020 day bar
//      grep -n 'function initTimeline'  10 the strip and the list
//      grep -n 'function initSources'   references
//      grep -n 'function initChips'     sticky section bar
//      grep -n 'function loop'          the one rAF loop
// ============================================================================
import { SOURCES, TIMELINE, ERAS, TRIALS, CONSTRUCT, LNP, PEPTIDES, JOURNEY,
  ve, dayNum, fmtDate, precision, buildStrand, gcFraction, protonated } from './data.js';
import { PAL, drawStrand, strandWidth, drawJourney, drawTranslate, drawSpike, drawTitre, drawDecay, drawCharge } from './draw.js';
import { typeset, typesetAll } from '../../lib/sci-math.js';
import './saver.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SRC_IDS = Object.keys(SOURCES);
const cite = ids => ids.map(id => `<a href="#ref-${id}">[${SRC_IDS.indexOf(id) + 1}]</a>`).join('');

// Size a canvas to its CSS box at the device pixel ratio. Returns the 2D
// context with CSS-pixel units, plus the CSS width and height.
function fit(cv) {
  const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h };
}

// Each view: { cv, draw(dt), live() } — live() true means it moves now.
const views = [];
const onScreen = new Set();
const io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting ? onScreen.add(e.target) : onScreen.delete(e.target)), { rootMargin: '80px' });
function view(cv, draw, live = () => false) {
  const v = { cv, draw, live, dirty: true };
  views.push(v); io.observe(cv);
  return v;
}
addEventListener('resize', () => views.forEach(v => v.dirty = true));

// ---------------------------------------------------------------- hero
function initStats() {
  const day0 = dayNum('2020-01-11');
  const dose1 = TIMELINE.find(e => e.date === '2020-03-16'), auth = TIMELINE.find(e => e.date === '2020-12-02');
  const [b, m] = TRIALS;
  const items = [
    [`${dayNum(dose1.date) - day0}`, 'days from the posted genome to the first person dosed with mRNA-1273'],
    [`${dayNum(auth.date) - day0}`, 'days from the posted genome to the first authorization (UK, BNT162b2)'],
    [`${b.ve.toFixed(1)}%`, `efficacy of BNT162b2 in phase 3: ${b.casesV} cases against ${b.casesP}`],
    [`${m.ve.toFixed(1)}%`, `efficacy of mRNA-1273 in phase 3: ${m.casesV} cases against ${m.casesP}`],
    [`${(b.randomized + m.randomized).toLocaleString('en-US')}`, 'people randomized in the two phase 3 trials'],
  ];
  $('heroStats').innerHTML = items.map(([v, t]) => `<div><b>${v}</b><span>${t}</span></div>`).join('');
}

// ---------------------------------------------------------------- 01
function initDecay() {
  const cv = $('decayCv'), inp = $('halfIn');
  const v = view(cv, () => { const { g, w, h } = fit(cv); drawDecay(g, w, h, { half: +inp.value, hours: 72 }); });
  inp.addEventListener('input', () => { $('halfOut').textContent = `${inp.value} h`; v.dirty = true; });
  $('halfOut').textContent = `${inp.value} h`;
}

// ---------------------------------------------------------------- 02
// Ring positions (SVG units). Hexagon: N1 bottom, then clockwise.
const RING = { N1: [210, 172], C2: [255, 146], N3: [255, 94], C4: [210, 68], C5: [165, 94], C6: [165, 146] };
function initBase() {
  const svg = $('baseSvg'), note = $('baseNote');
  const NOTES = {
    U: 'Uridine: the ring is bonded to the ribose through nitrogen N1 (an N–C glycosidic bond). This is the U that in-vitro-transcribed mRNA carries, and the one the TLRs react to.',
    P: 'Pseudouridine: the same atoms, but the ring is turned so that carbon C5 bonds to the ribose (a C–C bond). N1 now carries a hydrogen that can join a hydrogen bond. Cells make Ψ in their own RNA.',
    M: 'N1-methylpseudouridine: pseudouridine with a methyl group on N1. It still pairs with A like U. Both COVID-19 mRNA vaccines carry m1Ψ in place of every uridine.',
  };
  const line = (a, b, cls = '', off = 0) => {
    const [x1, y1] = a, [x2, y2] = b, dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy), nx = -dy / L * off, ny = dx / L * off;
    return `<line x1="${x1 + nx}" y1="${y1 + ny}" x2="${x2 + nx}" y2="${y2 + ny}" class="${cls}" />`;
  };
  const draw = k => {
    const col = k === 'U' ? PAL.U : PAL.M;
    let s = `<style>#baseSvg line{stroke:#c2c7d4;stroke-width:2.4;stroke-linecap:round}#baseSvg line.gly{stroke:${col};stroke-width:4}#baseSvg line.me{stroke:${PAL.M};stroke-width:3}</style>`;
    const ids = ['N1', 'C2', 'N3', 'C4', 'C5', 'C6'];
    ids.forEach((id, i) => { s += line(RING[id], RING[ids[(i + 1) % 6]]); });
    // double bonds: C5=C6, and the two carbonyls
    s += line(RING.C5, RING.C6, '', -6);
    const O2 = [292, 167], O4 = [210, 26];
    s += line(RING.C2, O2) + line(RING.C2, O2, '', 5) + line(RING.C4, O4) + line(RING.C4, O4, '', 5);
    const t = (x, y, txt, cls = '') => `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" class="${cls}">${txt}</text>`;
    const bg = (x, y) => `<circle cx="${x}" cy="${y}" r="11" fill="#0c0f17"/>`;
    s += bg(...O2) + t(...O2, 'O') + bg(...O4) + t(...O4, 'O');
    s += bg(...RING.N3) + t(...RING.N3, 'N') + line([266, 88], [292, 74]) + t(300, 68, 'H');
    // ribose and the glycosidic bond
    const rib = k === 'U' ? [210, 228] : [104, 60];
    const at = k === 'U' ? RING.N1 : RING.C5;
    s += line(at, [rib[0] + (k === 'U' ? 0 : 26), rib[1] + (k === 'U' ? -18 : 12)], 'gly');
    s += `<rect x="${rib[0] - 38}" y="${rib[1] - 18}" width="76" height="36" rx="10" fill="#121725" stroke="${col}" stroke-width="1.5"/>` + t(rib[0], rib[1], 'ribose', 'lbl');
    s += bg(...RING.N1) + t(...RING.N1, 'N');
    if (k !== 'U') {
      if (k === 'P') s += line([210, 184], [210, 210]) + t(210, 222, 'H');
      else s += line([210, 184], [210, 212], 'me') + t(210, 228, 'CH₃');
    }
    // atom numbers
    for (const [id, [x, y]] of Object.entries(RING)) s += `<text x="${x + (x < 210 ? -22 : x > 210 ? 22 : 18)}" y="${y + (id === 'N1' ? 4 : 0)}" class="lbl" text-anchor="middle" dominant-baseline="central">${id.slice(1)}</text>`;
    s += `<text x="20" y="246" class="lbl">${k === 'U' ? 'N1–C1′ bond to the sugar' : 'C5–C1′ bond to the sugar'}</text>`;
    svg.innerHTML = s;
    note.textContent = NOTES[k];
  };
  seg($('baseSeg'), draw);
  draw('U');
}

// A segmented control: calls fn(value) and marks the pressed button.
function seg(el, fn) {
  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    el.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    fn(b.dataset.v);
  });
}
function toggle(btn, fn) {
  btn.addEventListener('click', () => { const on = !btn.classList.contains('on'); btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', on); fn(on); });
}

// ---------------------------------------------------------------- 03
function initStrand() {
  const cv = $('strandCv'), pos = $('strandPos'), info = $('strandInfo');
  const S = { opt: 1, p2: true, mod: true, offset: 0, hover: -1, T: null, boxes: [], time: 0 };
  const REG = Object.fromEntries(CONSTRUCT.regions.map(r => [r.id, r]));
  const rebuild = () => {
    S.T = buildStrand({ opt: S.opt, p2: S.p2 });
    const cod = []; S.T.forEach(t => { if (t.codon && t.pos === 0) cod.push(t.codon); });
    $('gcOut').textContent = `GC in the codons shown: ${Math.round(gcFraction(cod) * 100)}%`;
    v.dirty = true;
  };
  const maxOff = () => Math.max(0, strandWidth(S.T) - cv.clientWidth);
  const setOff = o => { S.offset = clamp(o, 0, maxOff()); pos.value = Math.round(S.offset / (maxOff() || 1) * 1000); v.dirty = true; };
  const v = view(cv, dt => {
    const { g, w, h } = fit(cv);
    S.time += dt;
    S.boxes = drawStrand(g, w, h, { T: S.T, offset: S.offset, mod: S.mod, hover: S.hover, time: REDUCED ? 0 : S.time });
  }, () => !REDUCED);
  pos.addEventListener('input', () => { S.offset = +pos.value / 1000 * maxOff(); v.dirty = true; });
  // drag to scroll; a tap with no drag picks a token
  let drag = null;
  cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, o: S.offset, moved: false }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 4) drag.moved = true;
    if (drag.moved) setOff(drag.o - dx);
  });
  cv.addEventListener('pointerup', e => {
    const d = drag; drag = null;
    if (d && d.moved) return;
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const hit = S.boxes.find(b => x >= b.x && x < b.x + b.w && y >= b.y - 30 && y < b.y + b.h + 50);
    if (!hit) return;
    S.hover = hit.k; v.dirty = true;
    describe(S.T[hit.k]);
  });
  cv.addEventListener('pointercancel', () => { drag = null; });
  const describe = t => {
    const r = REG[t.region];
    let s = `<b>${esc(r.name)}.</b> ${esc(r.text)}`;
    if (t.k === 'nt') {
      const u = t.b === 'U';
      s = `<b>${u && S.mod ? 'm1Ψ' : t.b}</b>${u && S.mod ? ' (read as U)' : ''} in the ${esc(r.name)}. ` + s;
      if (t.codon) s += ` This codon, <b>${t.codon}</b>, encodes ${t.aa === '*' ? 'stop' : `<b>${t.aa}</b> at residue ${t.res}`}.` + (t.res === 986 || t.res === 987 ? (S.p2 ? ' One of the two stabilizing prolines.' : ' In the virus this residue is ' + (t.res === 986 ? 'lysine (K).' : 'valine (V).')) : '');
    }
    if (t.k === 'gap') s = `<b>${t.n} ${esc(t.unit)} not drawn.</b> ` + s;
    info.innerHTML = s;
  };
  // region chips jump to the region
  $('regionList').innerHTML = CONSTRUCT.regions.map(r => `<button data-r="${r.id}"><i style="background:${PAL[r.id]}"></i>${esc(r.name)}</button>`).join('');
  $('regionList').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const i = S.T.findIndex(t => t.region === b.dataset.r);
    let x = 0; for (let k = 0; k < i; k++) x += S.T[k].k === 'nt' ? 24 : S.T[k].k === 'gap' ? 92 : 46;
    setOff(x - 30);
    $('regionList').querySelectorAll('button').forEach(q => q.classList.toggle('on', q === b));
    describe(S.T[i]);
    info.innerHTML += ` <span class="dim">Sources: ${cite(CONSTRUCT.src)}</span>`;
  });
  toggle($('modBtn'), on => { S.mod = on; v.dirty = true; });
  toggle($('p2Btn'), on => { S.p2 = on; rebuild(); });
  seg($('optSeg'), val => { S.opt = +val; rebuild(); });
  rebuild();
}

// ---------------------------------------------------------------- 04
function initDelivery() {
  $('lipidBar').innerHTML = LNP.lipids.map(l => `<div style="width:${l.mol * 100}%;background:${l.col}" title="${esc(l.name)}"></div>`).join('');
  $('lipidList').innerHTML = LNP.lipids.map(l => `<div><i style="background:${l.col}"></i><span><b>${esc(l.name)}</b> · about ${Math.round(l.mol * 100)}%</span><small>${esc(l.ex)}. ${esc(l.job)}</small></div>`).join('') +
    `<div><i></i><small>Shares rounded from the published compositions of both vaccines ${cite(LNP.src.slice(0, 1))}.</small></div>`;
  // charge against pH
  const ccv = $('chargeCv'), ph = $('phIn');
  const cv1 = view(ccv, () => { const { g, w, h } = fit(ccv); drawCharge(g, w, h, { pKa: LNP.pKa, pH: +ph.value }); });
  const showPH = () => { $('phOut').textContent = `${(+ph.value).toFixed(2)} → ${Math.round(protonated(+ph.value, LNP.pKa) * 100)}% charged`; cv1.dirty = true; };
  ph.addEventListener('input', showPH); showPH();
  // the journey
  const jcv = $('journeyCv'), jin = $('journeyIn'), play = $('journeyPlay');
  const S = { p: 0, t: 0, playing: !REDUCED };
  play.textContent = S.playing ? 'Pause' : 'Play';
  let last = -1;
  const v = view(jcv, dt => {
    const { g, w, h } = fit(jcv);
    S.t += dt;
    if (S.playing) { S.p += dt / 16; if (S.p > 1.06) S.p = 0; jin.value = Math.round(clamp(S.p, 0, 1) * 1000); }
    const r = drawJourney(g, w, h, { p: clamp(S.p, 0, 1), t: S.t, pKa: LNP.pKa });
    $('journeyRead').textContent = `pH ${r.pH.toFixed(1)} · ${Math.round(r.charge * 100)}% charged`;
    if (r.phase.i !== last) {
      last = r.phase.i;
      const J = JOURNEY[last];
      $('journeyNote').innerHTML = `<b>${last + 1}. ${esc(J.name)}.</b> ${esc(J.text)}` + (J.id === 'escape' ? ` ${cite(['gilleron2013'])}` : '');
    }
  }, () => S.playing || !REDUCED);
  jin.addEventListener('input', () => { S.p = +jin.value / 1000; S.playing = false; play.textContent = 'Play'; v.dirty = true; });
  play.addEventListener('click', () => { S.playing = !S.playing; play.textContent = S.playing ? 'Pause' : 'Play'; });
}

// ---------------------------------------------------------------- 05
function initTranslate() {
  const cv = $('transCv'), play = $('transPlay');
  const S = { t: 30, playing: !REDUCED };
  play.textContent = S.playing ? 'Pause' : 'Play';
  view(cv, dt => {
    const { g, w, h } = fit(cv);
    if (S.playing) S.t += dt;
    const r = drawTranslate(g, w, h, { t: S.t });
    $('transRead').textContent = `${r.spikes} spikes on the surface`;
  }, () => S.playing);
  play.addEventListener('click', () => { S.playing = !S.playing; play.textContent = S.playing ? 'Pause' : 'Play'; });
}

// ---------------------------------------------------------------- 06
function initSpike() {
  const cv = $('spikeCv'), note = $('spikeNote');
  const S = { m: 0, target: 0, p2: true, shake: 0, t: 0 };
  const say = () => {
    note.textContent = S.m > 0.5
      ? 'Postfusion: S1 has gone and HR1 and the central helix have become one long helix with the fusion peptide at its tip. Antibodies raised against this shape protect poorly.'
      : S.p2 ? 'Prefusion, held by two prolines at the hinge. Trigger it: the spike shakes but cannot form the long helix.'
        : 'Prefusion, unlocked. Trigger it and it springs into the postfusion shape, the way the native spike does.';
  };
  const v = view(cv, dt => {
    const { g, w, h } = fit(cv);
    S.t += dt;
    S.m += clamp(S.target - S.m, -dt / 2.2, dt / 2.2);
    S.shake = Math.max(0, S.shake - dt * 0.9);
    drawSpike(g, w, h, { m: S.m, p2: S.p2, shake: S.shake, t: S.t });
  }, () => Math.abs(S.target - S.m) > 1e-3 || S.shake > 0);
  toggle($('spike2P'), on => { S.p2 = on; $('spike2P').textContent = on ? '2P staple on' : '2P staple off'; if (on) S.target = 0; say(); v.dirty = true; });
  $('spikeFire').addEventListener('click', () => { if (S.p2) S.shake = 1; else S.target = 1; say(); v.dirty = true; setTimeout(say, 2400); });
  $('spikeReset').addEventListener('click', () => { S.target = 0; S.m = 0; say(); v.dirty = true; });
  say();
  // the hinge peptide, virus against vaccine
  const P = PEPTIDES.hinge;
  $('pepView').innerHTML = [...P.seq].map((a, i) => `<span>${a}<small>${P.first + i}</small></span>`).join('') +
    '<span style="border:0;background:none">→</span>' +
    [...P.seq2P].map((a, i) => `<span class="${a !== P.seq[i] ? 'hit' : ''}">${a}<small>${P.first + i}</small></span>`).join('');
}

// ---------------------------------------------------------------- 07
function initTitre() {
  const cv = $('titreCv');
  const S = { gap: 21, second: true, cursor: -1 };
  const v = view(cv, () => { const { g, w, h } = fit(cv); drawTitre(g, w, h, { gap: S.gap, second: S.second, cursor: S.cursor }); });
  seg($('titreSeg'), val => { S.gap = +val || 21; S.second = +val > 0; v.dirty = true; });
  cv.addEventListener('pointermove', e => { const r = cv.getBoundingClientRect(); S.cursor = clamp((e.clientX - r.left - 44) / (r.width - 56) * 150, 0, 150); v.dirty = true; });
  cv.addEventListener('pointerleave', () => { S.cursor = -1; v.dirty = true; });
}

// ---------------------------------------------------------------- 08
function initProof() {
  const cv = $('dotsCv'), inp = $('veIn');
  const S = { tr: TRIALS[0], cv: TRIALS[0].casesV };
  $('trialSeg').innerHTML = TRIALS.map((t, i) => `<button data-v="${i}" class="${i ? '' : 'on'}">${esc(t.name)}</button>`).join('');
  $('trialFacts').innerHTML = TRIALS.map(t => `<div><b>${esc(t.name)}</b> (${esc(t.maker)}): ${t.randomized.toLocaleString('en-US')} randomized, ${t.dose} × 2, ${t.gapDays} days apart. ${t.casesV} vs ${t.casesP} cases; efficacy ${t.ve.toFixed(1)}% (95% interval ${t.ci[0]} to ${t.ci[1]}). ${cite([t.src])}</div>`).join('');
  $('coldFacts').innerHTML = TRIALS.map(t => `<div><b>${esc(t.name)}</b>: ${esc(t.store)}</div>`).join('') + `<div>From the December 2020 US emergency use fact sheets ${cite(['fdaEua'])}.</div>`;
  const v = view(cv, () => {
    const { g, w, h } = fit(cv);
    g.clearRect(0, 0, w, h);
    const half = w / 2, pad = 10, cols = Math.max(8, Math.floor((half - 2 * pad) / 11)), s = Math.min(11, (half - 2 * pad) / cols);
    const arm = (n, x0, col, label) => {
      g.fillStyle = PAL.dim; g.font = '12px Inter, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'top';
      g.fillText(`${label}: ${n} cases`, x0 + pad, 4);
      g.fillStyle = col;
      for (let i = 0; i < n; i++) { const cx = x0 + pad + (i % cols) * s + s / 2, cy = 26 + Math.floor(i / cols) * s + s / 2; g.beginPath(); g.arc(cx, cy, s * 0.38, 0, Math.PI * 2); g.fill(); }
    };
    arm(S.cv, 0, PAL.U, 'vaccine');
    arm(S.tr.casesP, half, PAL.A, 'placebo');
  });
  const update = () => {
    const e = ve(S.cv, S.tr.casesP);
    $('veOut').textContent = `${S.cv} → VE ${(e * 100).toFixed(1)}%`;
    $('trialTag').textContent = `${S.tr.name}: ${SOURCES[S.tr.src].t.split('.')[0]} et al.`;
    const tex = `\\mathrm{VE} = 1 - \\frac{\\mathrm{ARV}}{\\mathrm{ARU}} \\approx 1 - \\frac{${S.cv}}{${S.tr.casesP}} = ${(e * 100).toFixed(1)}\\%`;
    typeset($('veTex'), tex, { rules: [['\\mathrm{ARV}', 'm1'], ['\\mathrm{ARU}', 'm2']] });
    v.dirty = true;
  };
  seg($('trialSeg'), i => { S.tr = TRIALS[+i]; S.cv = S.tr.casesV; inp.max = S.tr.casesP; inp.value = S.cv; update(); });
  inp.addEventListener('input', () => { S.cv = +inp.value; update(); });
  inp.max = S.tr.casesP; inp.value = S.cv;
  update();
}

// ---------------------------------------------------------------- 09
function initDays() {
  const bar = $('dayBar'), info = $('dayInfo');
  const d0 = dayNum('2020-01-11'), d1 = dayNum('2020-12-31'), span = d1 - d0;
  const ev = TIMELINE.filter(e => e.era === '2020');
  let s = '<div class="axis"></div>';
  for (let m = 1; m <= 12; m++) { const d = dayNum(`2020-${String(m).padStart(2, '0')}-01`); if (d >= d0) s += `<span class="mo" style="left:${(d - d0) / span * 100}%">${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}</span>`; }
  ev.forEach((e, i) => {
    const auth = /authoriz/i.test(e.title + e.text);
    s += `<button class="ev${auth ? ' auth' : ''}" data-i="${i}" style="left:${(dayNum(e.date) - d0) / span * 100}%" aria-label="${esc(e.title)}"></button>`;
  });
  bar.innerHTML = s;
  const pick = i => {
    const e = ev[i];
    bar.querySelectorAll('.ev').forEach((b, k) => b.classList.toggle('on', k === i));
    info.innerHTML = `<b>${fmtDate(e.date)} · day ${dayNum(e.date) - d0}.</b> <b>${esc(e.title)}.</b> ${esc(e.text)} ${cite(e.src)}`;
  };
  bar.addEventListener('click', e => { const b = e.target.closest('.ev'); if (b) pick(+b.dataset.i); });
  pick(0);
}

// ---------------------------------------------------------------- 10
function initTimeline() {
  const list = $('tlList'), strip = $('tlStrip'), segEl = $('eraSeg');
  segEl.innerHTML = '<button data-v="all" class="on">All</button>' + Object.entries(ERAS).map(([k, e]) => `<button data-v="${k}">${esc(e.name)}</button>`).join('');
  list.innerHTML = TIMELINE.map((e, i) => `<li id="tl-${i}" data-era="${e.era}" style="--c:${ERAS[e.era].col}"><span class="d">${fmtDate(e.date)}</span><h4>${esc(e.title)}</h4><p>${esc(e.text)}</p><span class="src">${cite(e.src)}</span></li>`).join('');
  // the strip: 1960 to 2024, one lane per era; 2020 is crowded, so it gets
  // a wider share of the axis than its length
  const lanes = Object.keys(ERAS);
  const X = date => {
    const y = dayNum(date) / 365.25 + 1970;
    return y < 2019 ? 20 + (y - 1960) / (2019 - 1960) * 640 : 660 + (Math.min(y, 2024) - 2019) / 5 * 320;
  };
  let s = '<line x1="10" y1="104" x2="990" y2="104" stroke="rgba(255,255,255,0.2)"/>';
  for (const y of [1960, 1970, 1980, 1990, 2000, 2010, 2020, 2023]) s += `<text x="${X(String(y))}" y="117" fill="#8a91a5" font-size="10" text-anchor="middle">${y}</text>`;
  TIMELINE.forEach((e, i) => {
    const lane = lanes.indexOf(e.era), y = 14 + lane * 20;
    s += `<circle data-i="${i}" cx="${X(e.date)}" cy="${y}" r="${precision(e.date) === 3 ? 5 : 7}" fill="${ERAS[e.era].col}" style="cursor:pointer"><title>${esc(fmtDate(e.date) + ': ' + e.title)}</title></circle>`;
  });
  strip.innerHTML = s;
  strip.addEventListener('click', e => {
    const c = e.target.closest('circle'); if (!c) return;
    const li = $('tl-' + c.dataset.i);
    list.querySelectorAll('li').forEach(x => x.classList.toggle('on', x === li));
    li.style.display = ''; li.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'center' });
  });
  seg(segEl, era => {
    list.querySelectorAll('li').forEach(li => { li.style.display = era === 'all' || li.dataset.era === era ? '' : 'none'; });
    strip.querySelectorAll('circle').forEach(c => { c.style.opacity = era === 'all' || TIMELINE[+c.dataset.i].era === era ? 1 : 0.2; });
  });
}

// ---------------------------------------------------------------- refs
function initSources() {
  $('srcList').innerHTML = SRC_IDS.map(id => {
    const s = SOURCES[id];
    return `<li id="ref-${id}">${esc(s.t)}${s.url ? ` <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url.replace(/^https?:\/\//, ''))}</a>` : ''}</li>`;
  }).join('');
}

// ---------------------------------------------------------------- chips
function initChips() {
  const links = [...document.querySelectorAll('#chips a')];
  const secs = links.map(a => $(a.dataset.target));
  const ol = $('chips').querySelector('ol');
  let cur = null;
  const update = () => {
    let best = null;
    for (const s of secs) if (s.getBoundingClientRect().top < innerHeight * 0.4) best = s;
    if (best === cur) return;
    cur = best;
    links.forEach(a => {
      const on = !!best && a.dataset.target === best.id;
      a.classList.toggle('on', on);
      // scroll the chip row only; scrollIntoView would move the window too
      if (on) ol.scrollTo({ left: a.offsetLeft - ol.offsetLeft - 20, behavior: 'smooth' });
    });
  };
  addEventListener('scroll', update, { passive: true });
  update();
}

// ---------------------------------------------------------------- loop
let lastT = 0;
function loop(now) {
  const dt = Math.min(0.05, lastT ? (now - lastT) / 1000 : 0.016);
  lastT = now;
  if (!window.__mvSaver) {
    for (const v of views) {
      if (!onScreen.has(v.cv)) continue;
      if (v.dirty || v.live()) { v.dirty = false; try { v.draw(dt); } catch (e) { console.error(e); } }
    }
  }
  requestAnimationFrame(loop);
}

function boot() {
  const steps = [initStats, initDecay, initBase, initStrand, initDelivery, initTranslate, initSpike, initTitre, initProof, initDays, initTimeline, initSources, initChips];
  for (const f of steps) { try { f(); } catch (e) { console.error(f.name, e); } }
  typesetAll(document.querySelector('#doc'));
  requestAnimationFrame(loop);
}
boot();
