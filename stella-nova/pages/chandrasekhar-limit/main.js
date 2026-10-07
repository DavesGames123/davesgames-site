// ============================================================================
//  CHANDRASEKHAR LIMIT  ·  main.js — page wiring
// ----------------------------------------------------------------------------
//  Typesets the TeX, runs the section chip bar, starts the 2D figures
//  (figures.js) and the four WebGL scenes (renders.js), and binds their
//  controls and readouts. saver.js defines window.snSaver.
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//    maths ......... "typesetAll"           MathJax SVG, colour rules
//    chips ......... "function initChips"   active section, chip row scroll
//    hero .......... "function initHero"    accretion scene, meter, modes
//    nebula ........ "function initNebula"
//    cutaway ....... "function initDwarf"   mass slider, readouts
//    black hole .... "function initHole"
//    debug ......... "window.__chandra"     state for headless checks
// ============================================================================
import { typesetAll } from '../../lib/sci-math.js';
import * as F from './figures.js';
import { heroScene, nebulaScene, dwarfScene, holeScene, mountScene, MCH, M_IGNITE, M_CAPTURE } from './renders.js';
import * as P from './physics.js';
import './saver.js';

const $ = id => document.getElementById(id);
const fmtE = F.fmtE;
const D = window.__chandra = { booted: false, errors: [], mounted: {} };

// ── maths ──────────────────────────────────────────────────────────────────
// m1 electrons and momentum, m2 mass and gravity, m3 pressure, m4 density,
// m5 the limit, m6 radius (lib/sci.css colours).
const RULES = [['p_F', 'm1'], ['x', 'm1'], ['n_e', 'm4'], ['\\rho', 'm4'], ['P', 'm3'], ['M_{\\rm Ch}', 'm5'], ['M_{\\rm crit}', 'm5'],
  ['M', 'm2'], ['G', 'm2'], ['R', 'm6'], ['r', 'm6'], ['\\xi', 'm6'], ['\\eta', 'm6'], ['\\theta', 'm3'], ['\\phi', 'm3'], ['\\omega_3', 'm5']];
typesetAll(document, RULES).catch(e => D.errors.push(String(e)));

// ── chips ──────────────────────────────────────────────────────────────────
function initChips() {
  const links = [...document.querySelectorAll('#chips a')], ol = document.querySelector('#chips ol');
  const secs = links.map(a => $(a.dataset.target));
  let cur = null;
  const pick = () => {
    const y = 140; let on = null;
    for (const s of secs) if (s.getBoundingClientRect().top < y) on = s;
    const id = on ? on.id : null;
    if (id === cur) return; cur = id;
    links.forEach(a => {
      const v = a.dataset.target === id; a.classList.toggle('on', v);
      // Scroll the chip row, not the window (scrollIntoView moved the page).
      if (v) ol.scrollTo({ left: a.offsetLeft - ol.clientWidth / 2 + a.offsetWidth / 2, behavior: 'smooth' });
    });
  };
  addEventListener('scroll', pick, { passive: true }); pick();
}

function noGL(id) { const el = $(id); if (el) el.classList.add('on'); }

// ── hero ───────────────────────────────────────────────────────────────────
function initHero() {
  const S = heroScene();
  $('heroIgn').textContent = M_IGNITE.toFixed(3);
  $('heroCap2').textContent = M_CAPTURE.toFixed(3);
  $('statMch').textContent = MCH.toFixed(3) + ' M☉';
  const lo = 0.95, hi = 1.5, pos = m => Math.min(100, Math.max(0, (m - lo) / (hi - lo) * 100));
  $('heroMark').style.left = pos(MCH) + '%'; $('heroMarkLab').style.left = pos(MCH) + '%';
  $('heroMarkLab').textContent = `M_Ch ${MCH.toFixed(3)}`;
  let shown = 0;
  const stage = () => {
    if (S.flash >= 0) return S.flash < 2 ? 'carbon ignites: thermonuclear runaway' : S.flash < 6 ? 'Type Ia supernova: the dwarf is destroyed' : 'the ejecta cool into a remnant';
    if (S.coll >= 0) {
      if (S.coll < 0.6) return 'electron capture: the core collapses';
      if (S.mode === 2 && S.coll > 2.6) return 'past the TOV limit: a black hole';
      return 'neutron star: a 12 km pulsar';
    }
    if (S.M >= S.trigger() - 1e-6) return S.mode === 0 ? 'the core simmers…' : 'electrons vanish into nuclei…';
    return 'accreting from the companion';
  };
  const read = () => {
    const n = S.numbers();
    if (n.gone || n.coll) {
      $('heroBig').firstChild.textContent = n.gone ? 'Type Ia' : S.mode === 2 && S.coll > 2.6 ? 'black hole' : 'neutron star';
      $('heroSmall').innerHTML = n.gone ? 'about 0.6 M☉ of nickel-56; nothing left behind' : S.mode === 2 && S.coll > 2.6 ? 'r<sub>s</sub> = 2GM/c² ≈ 7 km for 2.5 M☉' : 'radius ≈ 12 km, density ≈ 3 × 10¹⁴ g/cm³';
    } else {
      $('heroBig').firstChild.textContent = `${n.M.toFixed(3)} M☉ `;
      $('heroSmall').innerHTML = `${(n.ratio * 100).toFixed(1)} % of M<sub>Ch</sub> · radius ${Math.round(n.R / 1e3).toLocaleString('en')} km · ρ<sub>c</sub> ${fmtE(n.rhoc / 1e3)} g/cm³`;
    }
    $('heroBar').style.width = pos(n.gone || n.coll ? S.trigger() : n.M) + '%';
    $('heroStage').textContent = stage();
  };
  const m = mountScene($('heroCv'), S, { onFrame: () => { const t = performance.now(); if (t - shown > 150) { shown = t; read(); } }, pitch: [0.05, 1.1], maxDpr: 1.25 });
  if (!m) { noGL('heroNoGL'); }
  D.mounted.hero = !!m; D.hero = S;
  document.querySelectorAll('#heroMode button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#heroMode button').forEach(q => q.classList.toggle('on', q === b));
    S.mode = +b.dataset.mode; if (S.flash >= 0 || S.coll >= 0) S.reset(1.3); read();
  }));
  const r = $('heroRate');
  const setRate = () => { S.rate = +r.value; $('heroRateOut').textContent = `${(S.rate * 1000).toFixed(0)} mM☉/s`; };
  r.addEventListener('input', setRate); setRate();
  $('heroReset').addEventListener('click', () => { S.reset(1.0); read(); });
  $('heroJump').addEventListener('click', () => { S.reset(S.trigger() - 0.02); read(); });
  read();
}

// ── nebula ─────────────────────────────────────────────────────────────────
function initNebula() {
  const S = nebulaScene();
  const m = mountScene($('nebCv'), S, { pitch: [-1.2, 1.2] });
  if (!m) noGL('nebNoGL');
  D.mounted.nebula = !!m;
  $('nebAge').addEventListener('input', e => { S.age = +e.target.value; });
  $('nebPinch').addEventListener('input', e => { S.pinch = +e.target.value; });
}

// ── cutaway ────────────────────────────────────────────────────────────────
function initDwarf() {
  const S = dwarfScene();
  const read = () => {
    const w = S.model;
    $('dwarfMOut').textContent = `${S.M.toFixed(3)} M☉`;
    const g = P.K.G * w.Mkg / w.R ** 2;
    $('dwarfRead').innerHTML = `<span>R<b>${Math.round(w.R / 1e3).toLocaleString('en')} km (${(w.R / P.K.Rearth).toFixed(2)} R⊕)</b></span><span>ρ<sub>c</sub><b>${fmtE(w.rhoc / 1e3)} g/cm³</b></span><span>mean ρ<b>${fmtE(w.rhoMean / 1e3)} g/cm³</b></span><span>central p<sub>F</sub><b>${w.xc.toFixed(2)} mₑc</b></span><span>mass with p<sub>F</sub> &gt; mₑc<b>${(S.relShare * 100).toFixed(0)} %</b></span><span>surface g<b>${fmtE(g / 9.81)} g⊕</b></span>`;
  };
  let pend = null;
  const set = v => { pend = v; requestAnimationFrame(() => { if (pend == null) return; const M = Math.min(pend, MCH * 0.995); pend = null; S.setMass(M); read(); }); };
  $('dwarfM').addEventListener('input', e => set(+e.target.value));
  $('dwarfSirius').addEventListener('click', () => { $('dwarfM').value = 1.018; set(1.018); });
  read();
  const m = mountScene($('dwarfCv'), S, { pitch: [0.0, 1.0] });
  if (!m) noGL('dwarfNoGL');
  D.mounted.dwarf = !!m; D.dwarf = S;
}

// ── black hole ─────────────────────────────────────────────────────────────
function initHole() {
  const S = holeScene();
  const m = mountScene($('holeCv'), S, { pitch: [0.02, 1.3], maxDpr: 1.25 });
  if (!m) noGL('holeNoGL');
  D.mounted.hole = !!m;
  $('holeInc').addEventListener('input', e => { S.pitch = +e.target.value; });
  $('holeDist').addEventListener('input', e => { S.dist = +e.target.value; });
  const tog = (id, k) => $(id).addEventListener('click', e => { S[k] = S[k] ? 0 : 1; e.currentTarget.classList.toggle('on', !!S[k]); });
  tog('holeLens', 'lens'); tog('holeShift', 'shift'); tog('holeDisk', 'disk');
}

// ── boot ───────────────────────────────────────────────────────────────────
const steps = [initChips, F.initFermi, F.initPoly, F.initEnergyP, F.initER, F.initLE, F.initFull, F.initHubble, initHero, initNebula, initDwarf, initHole];
for (const f of steps) {
  try { f(); } catch (e) { D.errors.push(f.name + ': ' + (e && e.message)); console.error(e); }
}
$('mchOut').textContent = MCH.toFixed(3);
D.booted = true;
