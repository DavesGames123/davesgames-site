// ============================================================================
//  CHORD CHART  ·  main.js — the UI, the detail panel and the strum synth
// ----------------------------------------------------------------------------
//  Reads window.ChordTheory (theory.js) and window.ChordDiagrams
//  (diagrams.js). The page renders from five state values:
//      root   pitch class 0..11          inst   guitar | bass | ukulele | violin
//      filter all | triads | sevenths    vix    voicing index per quality
//      sel    quality open in #detail (null when closed)
//  Any change calls render(), which rebuilds the cards and the detail.
//
//  INPUT
//    root chip / ← →      change root       card click   open detail + strum
//    instrument / filter  segmented buttons play button  strum only
//    find field (/)       "F#m7" sets root and opens that chord
//    ‹ › on a card        step through its voicings
//    Esc                  close the detail  Space        strum the open chord
//
//  GREP MAP
//    state ................ "const S ="
//    root strip ........... "function buildStrip"
//    cards ................ "function cardHTML"
//    detail panel ......... "function renderDetail"
//    find field ........... "function find"
//    strum synth .......... "function strum"
//    keyboard ............. "keydown"
// ============================================================================
'use strict';
(function () {
const T = window.ChordTheory, D = window.ChordDiagrams;
const $ = id => document.getElementById(id);
// Instrument Serif has no ♯ or ♭ glyph. A span sets them in a symbol font
// at the right size, so "B♭maj7" does not break into "B ♭maj7".
const acc = name => String(name).replace(/[♯♭]/g, m => `<span class="acc">${m}</span>`);
const PLAY_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 1.2v9.6a.6.6 0 0 0 .9.5l7.8-4.8a.6.6 0 0 0 0-1L2.9.7a.6.6 0 0 0-.9.5z"/></svg>';

const S = { root: 0, inst: 'guitar', filter: 'all', vix: {}, sel: null };

const voicings = q => T.voicingsFor(S.inst, S.root, q);
const curV = q => { const vs = voicings(q); return vs[Math.min(S.vix[q] || 0, vs.length - 1)]; };

// ── root strip ──────────────────────────────────────────────────────────────
function buildStrip() {
  const strip = $('rootStrip');
  for (let pc = 0; pc < 12; pc++) {
    const b = document.createElement('button');
    b.className = 'rchip'; b.innerHTML = acc(T.pcName(pc));
    b.setAttribute('aria-label', 'Root ' + T.pcName(pc));
    b.style.color = D.pcColor(pc, 66); b.style.borderColor = D.pcColorA(pc, 0.55);
    b.addEventListener('click', () => setRoot(pc));
    strip.appendChild(b);
  }
}
function syncStrip() {
  [...$('rootStrip').children].forEach((b, pc) => {
    const on = pc === S.root;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on);
    b.style.background = on ? D.pcColorA(pc, 0.22, 40) : 'rgba(0,0,0,0.3)';
    b.style.boxShadow = on ? `0 0 18px ${D.pcColorA(pc, 0.5)}` : 'none';
  });
  const br = $('bigRoot');
  // A black key shows both names, because a chord may use the other one
  // (B♭ root, A♯dim), as spellChord picks the spelling with fewer accidentals.
  const main = T.pcName(S.root);
  const alt = T.QUAL_ORDER.map(q => T.spellChord(S.root, q).root).find(n => n !== main);
  br.innerHTML = acc(main) + (alt ? `<small>also ${acc(alt)}</small>` : '');
  br.style.color = D.pcColor(S.root, 68);
  br.style.textShadow = `0 0 26px ${D.pcColorA(S.root, 0.5)}`;
  document.documentElement.style.setProperty('--c', D.pcColor(S.root, 66));
}
function setRoot(pc) {
  S.root = ((pc % 12) + 12) % 12; S.vix = {};
  syncStrip(); render();
  $('rootStrip').children[S.root].scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
}

// ── cards ───────────────────────────────────────────────────────────────────
function notesHTML(spell) {
  return spell.notes.map(n => `<span style="color:${D.pcColor(n.pc, 68)}">${n.name}</span>`).join('');
}
function cardHTML(q) {
  const sp = T.spellChord(S.root, q), vs = voicings(q), i = Math.min(S.vix[q] || 0, vs.length - 1), v = vs[i];
  const pager = vs.length > 1
    ? `<footer class="vpager"><button data-step="-1" aria-label="Previous voicing" ${i === 0 ? 'disabled' : ''}>‹</button><span>${i + 1}/${vs.length} · ${v.name}</span><button data-step="1" aria-label="Next voicing" ${i === vs.length - 1 ? 'disabled' : ''}>›</button></footer>`
    : `<footer class="vpager"><span>${T.TUNINGS[S.inst].fretted ? v.name : 'every chord tone'}</span></footer>`;
  return `<article class="qcard${S.sel === q ? ' sel' : ''}" data-q="${q}" tabindex="0" style="--c:${D.pcColor(S.root, 66)}" aria-label="${sp.symbol}, ${sp.full}">
    <div class="qhead"><div class="qname">${acc(sp.symbol)}</div><button class="playb" data-play aria-label="Play ${sp.symbol}">${PLAY_ICON}</button></div>
    <div class="qfull">${sp.full} <b>· ${sp.notes.map(n => n.sym).join(' ')}</b></div>
    <div class="qnotes">${notesHTML(sp)}</div>
    <div class="dg">${D.diagramSVG(S.inst, S.root, q, v)}</div>
    ${pager}
  </article>`;
}
function renderGrid() {
  const keep = T.QUAL_GROUPS[S.filter];
  $('grid').innerHTML = T.QUAL_ORDER.filter(q => keep.includes(q)).map(cardHTML).join('');
  $('gridLbl').innerHTML = `${keep.length} chords on <span style="color:${D.pcColor(S.root, 68)}">${acc(T.pcName(S.root))}</span>`;
  $('tuning').textContent = T.TUNINGS[S.inst].label + (T.TUNINGS[S.inst].fretted ? '' : ' · every chord tone in first position');
}
// One delegated handler for every card.
$('chartBody').addEventListener('click', e => {
  const card = e.target.closest('.qcard'); if (!card) return;
  const q = card.dataset.q;
  const step = e.target.closest('[data-step]');
  if (step) { e.stopPropagation(); stepVoicing(q, +step.dataset.step); return; }
  if (e.target.closest('[data-play]')) { strum(q); return; }
  open(q); strum(q);
});
$('chartBody').addEventListener('keydown', e => {
  const card = e.target.closest('.qcard'); if (!card || e.target !== card) return;
  if (e.key === 'Enter') { e.preventDefault(); open(card.dataset.q); strum(card.dataset.q); }
});
function stepVoicing(q, d) {
  const n = voicings(q).length;
  S.vix[q] = Math.max(0, Math.min(n - 1, (S.vix[q] || 0) + d));
  render(q);
  strum(q);
}

// ── detail panel ────────────────────────────────────────────────────────────
function renderDetail() {
  const box = $('detail');
  if (S.sel == null) { box.hidden = true; return; }
  const q = S.sel, sp = T.spellChord(S.root, q), vs = voicings(q), v = curV(q);
  const fretted = T.TUNINGS[S.inst].fretted;
  box.style.setProperty('--c', D.pcColor(S.root, 66));
  let h = `<div class="d-name">${acc(sp.symbol)}</div>
    <div class="d-full">${sp.full} · ${sp.notes.map(n => n.sym).join(' ')}</div>
    <div class="d-tones">${sp.notes.map(n => `<div class="tone"><b style="color:${D.pcColor(n.pc, 68)}">${n.name}</b><small>${n.sym}</small></div>`).join('')}</div>
    <div class="d-acts"><button id="dStrum">Strum</button><button id="dArp">Arpeggio</button></div>
    <div class="d-big">${D.diagramSVG(S.inst, S.root, q, v)}</div>
    <div class="d-vname">${fretted ? v.name : 'every chord tone in first position'}</div>`;
  if (fretted && v.dropped5) h += `<p class="d-note">This voicing leaves out the 5th (${sp.notes[2].name}). That is normal for a 7th chord: the 5th adds the least colour.</p>`;
  if (fretted && vs.length > 1) {
    h += `<h3 class="d-h">Voicings · ${vs.length}</h3><div class="d-vlist">` +
      vs.map((w, i) => `<button class="vmini${w === v ? ' on' : ''}" data-vi="${i}" aria-label="Voicing ${i + 1}, ${w.name}">${D.diagramSVG(S.inst, S.root, q, w)}<span>${w.name}</span></button>`).join('') + '</div>';
  }
  $('dBody').innerHTML = h;
  box.hidden = false;
  $('dStrum').onclick = () => strum(q);
  $('dArp').onclick = () => strum(q, true);
  $('dBody').querySelectorAll('[data-vi]').forEach(b => b.onclick = () => { S.vix[q] = +b.dataset.vi; render(q); strum(q); });
}
function open(q) { S.sel = q; render(); }
function close() { S.sel = null; render(); }
$('dClose').addEventListener('click', close);

// Rebuild the cards and the detail. When only one card changed, keep the
// scroll and focus by replacing that card alone.
function render(onlyQ) {
  if (onlyQ != null) {
    const old = document.querySelector(`.qcard[data-q="${onlyQ}"]`);
    if (old) { const tmp = document.createElement('div'); tmp.innerHTML = cardHTML(onlyQ); old.replaceWith(tmp.firstElementChild); }
  } else renderGrid();
  renderDetail();
}

// ── segmented controls ──────────────────────────────────────────────────────
function seg(id, key, apply) {
  $(id).addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    [...$(id).children].forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
    apply(b.dataset[key]);
  });
}
seg('instSeg', 'i', v => { S.inst = v; S.vix = {}; render(); });
seg('qualSeg', 'f', v => {
  S.filter = v;
  if (S.sel != null && !T.QUAL_GROUPS[v].includes(S.sel)) S.sel = null;
  render();
});

// ── find field ──────────────────────────────────────────────────────────────
function find(text, commit) {
  const inp = $('findIn'), msg = $('findMsg');
  const t = text.trim();
  if (!t) { inp.classList.remove('bad'); msg.textContent = ''; return; }
  const p = T.parseChord(t);
  if (!p) { inp.classList.toggle('bad', commit); msg.textContent = commit ? 'not a chord in this chart' : ''; return; }
  inp.classList.remove('bad'); msg.textContent = '';
  if (!commit) return;
  if (!T.QUAL_GROUPS[S.filter].includes(p.q)) {
    S.filter = 'all';
    [...$('qualSeg').children].forEach(x => x.classList.toggle('on', x.dataset.f === 'all'));
  }
  S.root = p.root; S.vix = {}; S.sel = p.q;
  syncStrip(); render(); strum(p.q);
  const card = document.querySelector(`.qcard[data-q="${p.q}"]`);
  if (card) { card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); card.classList.add('flash'); setTimeout(() => card.classList.remove('flash'), 900); }
}
$('find').addEventListener('submit', e => { e.preventDefault(); find($('findIn').value, true); $('findIn').blur(); });
$('findIn').addEventListener('input', e => find(e.target.value, false));

// ── strum synth ─────────────────────────────────────────────────────────────
// A shared AudioContext, made on the first strum (browsers need a gesture).
let AC = null;
function strum(q, arp = false) {
  if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
  if (AC.state === 'suspended') AC.resume();
  let midis, stag = 0.055, dur = 2.4;
  if (T.TUNINGS[S.inst].fretted) midis = T.voicingMidi(S.inst, curV(q).frets);
  else if (S.inst === 'bass') { const b = 28 + ((S.root - 4) % 12 + 12) % 12; midis = [b, b + 7, b + 12]; stag = 0.22; dur = 2.9; }
  else { midis = T.QUALS[q].iv.map(iv => 60 + S.root + iv); midis.unshift(48 + S.root); }
  if (arp) { stag = 0.3; dur = 1.8; }
  const t0 = AC.currentTime + 0.03;
  const master = AC.createGain(); master.gain.value = 0.5; master.connect(AC.destination);
  midis.forEach((mn, i) => {
    const f = 440 * Math.pow(2, (mn - 69) / 12), t = t0 + i * stag;
    const o1 = AC.createOscillator(), o2 = AC.createOscillator(), g = AC.createGain(), g2 = AC.createGain();
    o1.type = 'triangle'; o1.frequency.value = f;
    o2.type = 'sine'; o2.frequency.value = f * 2; o2.detune.value = 4; g2.gain.value = 0.18;
    o1.connect(g); o2.connect(g2); g2.connect(g); g.connect(master);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.34 / Math.sqrt(midis.length), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o1.start(t); o2.start(t); o1.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
  });
}

// ── keyboard ────────────────────────────────────────────────────────────────
addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const el = e.target instanceof Element ? e.target : document.body;
  const typing = el.matches('input, textarea');
  if (e.key === 'Escape') { if (typing) el.blur(); else if (S.sel != null) close(); return; }
  if (typing) return;
  if (e.key === '/') { e.preventDefault(); $('findIn').focus(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); setRoot(S.root - 1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); setRoot(S.root + 1); }
  else if (e.key === ' ' && S.sel != null && !el.closest('button')) { e.preventDefault(); strum(S.sel); }
});

// Test hook for headless checks.
window.__chart = { S, setRoot, open, close, find, render };

buildStrip(); syncStrip(); render();
})();
