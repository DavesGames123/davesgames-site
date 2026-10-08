// ============================================================================
//  ROCHE LIMIT  ·  app/readout.js — readouts and the details drawer
// ----------------------------------------------------------------------------
//  refreshReadout() writes the clock, the speed, the distance bar, the
//  bound share and the live sentence; refreshDetails() the drawer.
//
//  grep -n targets
//    formats ....... "function fmtTime", "function fmtKm"
//    readout ....... "function refreshReadout"
//    spark line .... "function drawSpark"
//    drawer ........ "function refreshDetails"
// ============================================================================
import * as P from '../physics.js';
import { drawGauge, drawBound, drawEnergy, drawRuns } from '../plots.js';
import { syncPlayButtons } from './controls.js';
import { $, UI, SPEED_STOPS, KM_SATURN, REF_SWEEP } from './env.js';
import { loadRuns } from './history.js';
import { orbitsPerMin, paceFactor } from './loop.js';
import { timeWarp } from '../pacing.js';
import { limitsFor } from './runs.js';
import { satState } from './sat.js';
import { S } from './state.js';

export function fmtTime(sec) {
  if (sec < 120) return sec.toFixed(0) + ' s';
  if (sec < 7200) return (sec / 60).toFixed(0) + ' min';
  if (sec < 3 * 86400) return (sec / 3600).toFixed(1) + ' h';
  return (sec / 86400).toFixed(1) + ' days';
}
function fmtKm(km) { return km >= 1e4 ? Math.round(km / 100) * 100 : Math.round(km); }
function planetName(spec, cap) { const n = spec.planetName || 'the planet'; return cap ? n.charAt(0).toUpperCase() + n.slice(1) : n; }
export function refreshReadout(force) {
  if (!S.run || !S.run.sats.length) return;
  const s = S.run.sats[0], spec = S.run.spec, L = S.run.limits || limitsFor(spec);
  if (!s.ref) return;
  const st = satState(s);
  const dNow = Math.hypot(...st.r) / s.Rp;
  const tt = S.run.t / S.run.T0;
  const orbit = S.run.phase === 'orbit';
  // clock: hours and orbits
  const secs = S.run.tUnitSec ? S.run.t * S.run.tUnitSec : 0;
  const unitsNote = spec.unitsNote ? ' (for a Saturn-size planet)' : '';
  $('clock').textContent = orbit ? `${fmtTime(secs)} · ${tt.toFixed(2)} orbits` : '';
  $('clock').title = orbit ? `Time since the start${unitsNote}; one orbit is the start orbit (${fmtTime(S.run.T0 * S.run.tUnitSec)}).` : '';
  // the speed label: what it asks for and what the GPU gives
  const opm = orbitsPerMin();
  const got = S.run.rate > 0 && orbit && !UI.paused ? S.run.rate * s.C.dt / S.run.T0 * 60 : opm;
  const slow = orbit && !UI.paused && got < 0.8 * opm;
  $('speedV').textContent = `${opm < 1 ? opm.toFixed(2) : opm.toFixed(opm < 10 ? 1 : 0)} orbits/min${slow ? ` (GPU: ${got.toFixed(1)})` : ''}`;
  $('speedV').title = S.run.tUnitSec ? `1 s on screen = ${fmtTime(opm / 60 * S.run.T0 * S.run.tUnitSec)} at ${planetName(spec)}` : '';
  refreshWarp(opm, orbit);
  $('dockSpeedV').textContent = SPEED_STOPS.reduce((b, x) => Math.abs(x.v - UI.speedLog) < Math.abs(b.v - UI.speedLog) ? x : b).name;
  // distance bar: from the surface (1) to a little past the start
  const maxD = Math.max(S.run.viewD * 1.15, L.fluid * 1.3);
  const x = v => Math.max(0, Math.min(100, (v - 1) / (maxD - 1) * 100));
  $('distTitle').textContent = `Distance from ${planetName(spec)}`;
  document.querySelector('#distBar .zone.in').style.width = x(L.fluid) + '%';
  document.querySelector('#distBar .zone.out').style.left = x(L.fluid) + '%';
  $('distLim').style.left = x(L.fluid) + '%';
  $('distMark').style.left = x(dNow) + '%';
  // one-piece share
  const fs = S.run.sats.map(q => q.an ? q.an.f : 1);
  $('pieceV').textContent = S.run.sats.length > 1 ? fs.map((f, i) => `${S.run.sats[i].matName === 'rigid' ? 'rough' : 'loose'} ${Math.round(100 * f)}%`).join(' · ') : `${Math.round(100 * fs[0])}%`;
  $('pieceV').classList.toggle('two', S.run.sats.length > 1);
  drawSpark();
  // the live sentence
  const subj = spec.kind === 'flyby' ? 'The comet' : S.run.sats.length > 1 ? 'The moons' : 'The moon';
  const Pn = planetName(spec), km = dNow * (spec.Rkm || KM_SATURN);
  let sent;
  if (!orbit) sent = 'Building the moon: thousands of grains settle together under their own gravity.';
  else if (fs[0] < 0.25 && S.run.sats.length === 1 && S.run.storyKey === 'ring') sent = `${subj} is gone: its pieces now circle ${Pn}${spec.kind === 'flyby' ? ' in a stream' : ' as a ring'}.`;
  else if (dNow < L.fluid) {
    const holds = s.matName !== 'fluid' && fs[0] > 0.9;
    sent = `${subj} is ${dNow.toFixed(2)} ${Pn} radii out, inside the Roche limit (${L.fluid.toFixed(2)}): ${holds ? 'friction still holds it together, for now.' : `${Pn}’s tide is stronger than its own gravity, so it comes apart.`}`;
  } else sent = `${subj} is ${dNow.toFixed(2)} ${Pn} radii out (${fmtKm(km).toLocaleString()} km), ${Math.round((dNow / L.fluid - 1) * 100)}% outside the Roche limit: it holds together.`;
  $('sentence').textContent = sent;
  if (!$('details').classList.contains('off') || force) refreshDetails(dNow, tt, L);
  syncPlayButtons();
}
// The time warp line: how much sim time one wall second shows, and the
// pace of the story (fast approach, slow motion at the breakup). The inward
// drift of a spiral is a drag that is far faster than real tides.
function refreshWarp(opm, orbit) {
  const el = $('warp'); if (!el) return;
  if (!orbit || !S.run.tUnitSec) { el.textContent = ''; return; }
  const w = timeWarp(opm, S.run.T0, S.run.tUnitSec), f = paceFactor();
  const pc = S.run.pace, slow = pc && pc.mode === 'breakup' && f < 0.7;
  const mode = UI.paused ? 'paused' : slow ? '<b>slow motion</b>' : f > 1.5 ? 'fast forward' : '';
  const drift = S.run.spec.kind === 'spiral' && S.run.sats[0].pl.drag > 0 ? ' · inward drift sped up' : '';
  el.innerHTML = `1 s = ${fmtTime(w)} · time ×${fmtWarp(w)}${mode ? ' · ' + mode : ''}${drift}`;
}
function fmtWarp(w) {
  if (w < 1000) return w.toFixed(0);
  const e = Math.floor(Math.log10(w)), m = w / 10 ** e;
  return `${m.toFixed(1)}×10${String(e).split('').map(c => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+c]).join('')}`;
}
function drawSpark() {
  const c = $('spark'); if (!c || !c.clientWidth) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight || 40;
  if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const tNow = S.run.t / S.run.T0, tMax = Math.max(1, tNow * 1.1);
  g.strokeStyle = 'rgba(160,180,210,0.18)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, h - 1); g.lineTo(w, h - 1); g.moveTo(0, 2); g.lineTo(w, 2); g.stroke();
  for (const s of S.run.sats) {
    g.strokeStyle = S.run.sats.length > 1 ? s.color : '#ffb46a'; g.lineWidth = 1.6; g.beginPath();
    let first = true;
    for (const [t, f] of s.hist) { if (t > tNow + 1e-9) break; const X = t / tMax * w, Y = 2 + (1 - f) * (h - 4); if (first) { g.moveTo(X, Y); first = false; } else g.lineTo(X, Y); }
    g.stroke();
  }
}
function refreshDetails(dNow, tt, L) {
  const s = S.run.sats[0], spec = S.run.spec;
  const tStr = spec.kind === 'flyby' && S.run.tPeri !== undefined ? `${(S.run.t - S.run.tPeri) / S.run.T0 >= 0 ? '+' : '−'}${Math.abs((S.run.t - S.run.tPeri) / S.run.T0).toFixed(2)} from the closest pass` : `${tt.toFixed(2)} orbits`;
  $('rdT').textContent = `${tStr} · ${fmtTime(S.run.t * (S.run.tUnitSec || 0))}`;
  $('rdD').textContent = dNow.toFixed(3);
  $('rdDr').textContent = (dNow / L.rigid).toFixed(3);
  $('rdDf').textContent = (dNow / L.fluid).toFixed(3);
  const bnd = S.run.sats.map(x => x.an ? (100 * x.an.f).toFixed(1) + '%' : '—').join(' · ');
  $('rdB').textContent = bnd;
  $('rdG').textContent = s.an ? String(s.an.groups) : '—';
  $('rdH').textContent = s.an && s.an.live && Number.isFinite(s.an.rH) ? (s.an.rH / (s.Rs * Math.cbrt(s.an.f))).toFixed(2) : '—';
  $('rdRho').textContent = s.pile ? `${s.pile.st.rho.toFixed(3)} (packing ${(s.pile.st.rho / P.RHO_GRAIN).toFixed(2)})` : '—';
  $('rdE').textContent = s.an && Number.isFinite(s.an.drift) ? s.an.drift.toExponential(1) + ' |U_s|' : (s.pl && s.pl.drag ? 'drag on: not tracked' : '—');
  $('rdL').textContent = s.an && Number.isFinite(s.an.Ldrift) && !(s.pl && s.pl.drag) ? s.an.Ldrift.toExponential(1) : '—';
  $('rdAcc').textContent = s.an ? String(s.an.accreted) : '—';
  $('rdDt').textContent = `${s.C.dt.toExponential(2)} (${Math.round(S.run.T0 / s.C.dt).toLocaleString()} per orbit)`;
  $('rdGpu').textContent = `${S.gpuMs.toFixed(1)} ms · ${S.stepsMax} steps max · ${S.fps.toFixed(0)} fps · ${(S.ren.W * S.ren.H / 1e6).toFixed(1)} MP`;
  // gauge: a_tide / g at the surface = 2 (rho_p/rho_s) (R_p/d)^3
  const ratio = 2 * spec.q * Math.pow(1 / dNow, 3);
  drawGauge($('gaugeC'), ratio);
  $('gaugeV').textContent = ratio.toFixed(2);
  const tMax = Math.max(1, Math.ceil(Math.max(tt, 0.5) * 1.15));
  const tu = spec.kind === 'flyby' ? 'T_q' : 'orbits';
  drawBound($('boundC'), S.run.sats.map(x => ({ pts: x.hist, color: x.color })), tMax, tu);
  $('boundV').textContent = bnd;
  drawEnergy($('energyC'), S.run.sats.map(x => ({ pts: x.ehist, color: x.color })), tMax, tu);
  $('energyV').textContent = s.an && Number.isFinite(s.an.drift) ? s.an.drift.toExponential(1) : '—';
  const xCur = (spec.kind === 'flyby' ? spec.peri : dNow) / Math.cbrt(spec.q);
  drawRuns($('runsC'), loadRuns(), REF_SWEEP, xCur);
  $('runsV').textContent = `x = ${xCur.toFixed(2)}`;
}
