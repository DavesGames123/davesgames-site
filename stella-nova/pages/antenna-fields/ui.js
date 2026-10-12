// ============================================================================
//  ANTENNA FIELDS  ·  ui.js — the panel, the dock, the sheet and the read-outs
// ----------------------------------------------------------------------------
//  DOM only; main.js owns the state and passes an app object:
//    app.S                 the page state
//    app.A(), app.stats(), app.geo()     the antenna, its pattern numbers,
//                          the observer geometry (geom.js)
//    app.freq(), app.lambdaM(), app.scale()
//    app.setType(t), app.setView3d(on), app.dirty() (the antenna changed),
//    app.touch(), app.invalidate() (redraw the field), app.geoDirty(),
//    app.resetFlow(), app.psiMode(), app.traceField(), app.compSpec()
//  initUI(app) wires every control and returns { sync, numbers, caption }.
//
//  grep -n: "const PARAMS"  "function buildParams"  "function numbers"
//           "function caption"  "function sheet"  "function sync"
// ============================================================================
import { drawPolar } from './plots.js';
import { patternCut } from './em.js';
import { typeset } from '../../lib/sci-math.js';

export const PHONE_Q = '(max-width:768px), (max-height:500px) and (pointer:coarse)';
const $ = id => document.getElementById(id);

export const TYPE_NAMES = { dipole: 'Dipole', halfwave: 'Half-wave dipole', loop: 'Loop', array: 'Phased array', yagi: 'Yagi-Uda', hertz: 'Short dipole' };
const TYPE_TEXT = {
  dipole: 'A straight wire fed at its centre, of any length. Past one wavelength the current changes sign along the wire, and the pattern splits into lobes.',
  halfwave: 'Half a wavelength long at 300 MHz. Change the frequency and the same metal becomes electrically shorter or longer.',
  loop: 'A ring of wire. A small loop is the magnetic twin of a short dipole: E and B change places.',
  array: 'Half-wave dipoles in a row, half a wavelength apart, with equal currents and a phase step from one to the next. The phase step turns the beam.',
  yagi: 'One fed dipole, a longer reflector behind it and shorter directors in front. Only the middle wire is fed; the field of all the wires sets the other currents.',
};
// One slider per row: [state key, symbol TeX, colour class, name, min, max, step, format].
const PARAMS = {
  dipole: [['L', 'L', '', 'Length', 0.1, 2, 0.01, v => v.toFixed(2) + ' λ']],
  halfwave: [['f', 'f', 'm6', 'Frequency', 150, 600, 1, v => v.toFixed(0) + ' MHz']],
  loop: [['C', 'C', '', 'Circumference', 0.05, 1.6, 0.01, v => v.toFixed(2) + ' λ']],
  array: [['steer', '\\theta_s', 'm6', 'Steering', -60, 60, 1, v => v.toFixed(0) + '°'], ['N', 'N', '', 'Elements', 2, 16, 1, v => v.toFixed(0)]],
  yagi: [['f', 'f', 'm6', 'Frequency', 240, 360, 1, v => v.toFixed(0) + ' MHz'], ['nd', 'n_d', '', 'Directors', 0, 8, 1, v => v.toFixed(0)]],
};
const FIELD_WORDS = { E: 'electric field', H: 'magnetic field', S: 'power flow' };
const LEGEND = {
  E: 'linear-gradient(90deg,#db5485,#0a0d14,#ff9a62)',
  H: 'linear-gradient(90deg,#8c78ff,#0a0d14,#62c4ff)',
  S: 'linear-gradient(90deg,#0a0d14,#174d3a,#86dc7c,#f2ffe6)',
};

export function initUI(app) {
  const S = app.S, phone = window.matchMedia(PHONE_Q);
  let built = '';

  // ── antenna and its sliders ──
  function buildParams() {
    const t = S.type, P = PARAMS[t] || [];
    if (built === t) return;
    built = t;
    const box = $('params');
    box.innerHTML = '';
    for (const [k, tex, cls, name, min, max, step, fmt] of P) {
      const row = document.createElement('div');
      row.className = 'prm';
      row.innerHTML = `<span class="nm"><span class="sci-sym ${cls}" data-tex="${tex}" data-inline></span>${name}</span><span class="val"></span><input type="range" min="${min}" max="${max}" step="${step}" aria-label="${name}">`;
      const inp = row.querySelector('input'), val = row.querySelector('.val');
      inp.value = S[t][k]; val.textContent = fmt(S[t][k]);
      inp.oninput = () => {
        const v = +inp.value;
        if (!Number.isFinite(v)) return;
        S[t][k] = Math.min(max, Math.max(min, v)); val.textContent = fmt(S[t][k]); app.dirty(); app.touch();
      };
      box.appendChild(row);
      typeset(row.querySelector('.sci-sym'), tex, { display: false }).catch(() => {});
    }
    const opts = $('typeOpts');
    opts.innerHTML = '';
    if (t === 'dipole' || t === 'halfwave') chip(opts, 'Moment-method current', () => S[t].model === 'mom', () => { S[t].model = S[t].model === 'mom' ? 'sin' : 'mom'; app.dirty(); });
    $('typeDesc').textContent = TYPE_TEXT[t] || '';
  }
  function chip(box, label, on, act) {
    const b = document.createElement('button');
    b.textContent = label; b.classList.toggle('on', on());
    b.onclick = () => { act(); b.classList.toggle('on', on()); app.touch(); app.invalidate(); sync(); };
    box.appendChild(b);
  }

  // ── read-outs ──
  const fz = Z => !Z || !isFinite(Z[0]) ? 'very large' : Z[0].toFixed(1) + (isFinite(Z[1]) ? (Z[1] < 0 ? ' − j' : ' + j') + Math.abs(Z[1]).toFixed(1) : '') + ' Ω';
  const fw = w => w >= 100 ? w.toFixed(0) + ' W' : w >= 1 ? w.toFixed(2) + ' W' : (w * 1000).toFixed(1) + ' mW';
  function numbers() {
    const A = app.A(), st = app.stats(), g = app.geo(), t = S.type;
    if (!A) return;
    const pm = app.psiMode(), tf = app.traceField();
    const lineWord = !S.tog.lines ? '' : pm === 1 ? ' The white lines are electric field lines; they are exact here, and you can see closed loops break away from the wire.'
      : pm === 2 ? ' The white lines are magnetic field lines of the uniform part of the loop current.'
      : pm === 3 ? ' The white lines are magnetic field lines in this plane; they are exact.'
      : tf ? ' The faint lines follow the ' + (tf === 'E' ? 'electric' : 'magnetic') + ' field, traced again each frame.' : '';
    const colour = S.field === 'S' ? 'Brightness is the size of the power flow now, on a log scale.'
      : 'Orange and rose are the two directions of the electric field; blue and violet those of the magnetic field. The bands move out at the speed of light.';
    $('what').textContent = S.v3.on
      ? 'The surface is the radiation pattern: its radius in each direction is the field strength there, its colour the power per solid angle. The white ring is the plane of the field view; the orange ray points at the observer. With the sphere option the surface becomes a sphere coloured by the power through it, with E, B and S drawn on it.'
      : colour + lineWord + ' Brightness grows with distance to cancel the 1/r fall-off.';
    const rows = [['Frequency', app.freq().toFixed(0) + ' MHz, λ = ' + app.lambdaM().toFixed(2) + ' m']];
    if (t === 'dipole') rows.push(['Length', S.dipole.L.toFixed(2) + ' λ']);
    if (t === 'halfwave') rows.push(['Length', (0.5 * app.scale()).toFixed(3) + ' λ (0.50 m)']);
    if (t === 'loop') rows.push(['Circumference', S.loop.C.toFixed(2) + ' λ']);
    if (t === 'array') rows.push(['Elements', S.array.N + ', λ/2 apart']);
    if (t === 'yagi') rows.push(['Elements', (S.yagi.nd + 2) + ': reflector, fed, ' + S.yagi.nd + ' director' + (S.yagi.nd === 1 ? '' : 's')]);
    rows.push([t === 'array' ? 'Impedance, centre element' : 'Input impedance', fz(A.Zin)]);
    if (st) {
      rows.push(['Directivity', st.Ddb.toFixed(2) + ' dBi (D = ' + st.D.toFixed(2) + ')']);
      const bw = [st.hpbwE, st.hpbwH].filter(isFinite);
      rows.push(['Half-power beam width', bw.length ? bw.map(v => v.toFixed(0) + '°').join(' and ') : 'all round']);
      if (t === 'yagi') rows.push(['Front to back', st.fb.toFixed(1) + ' dB']);
      if (t === 'array') rows.push(['Beam direction', (Math.atan2(st.dir[0], Math.abs(st.dir[1])) * 180 / Math.PI).toFixed(0) + '° from broadside']);
      rows.push(['Radiated power at 1 A', fw(st.P)]);
    }
    if (g && g.sf) rows.push(['Flux through the sphere', fw(g.sf.P) + ' at r = ' + (g.r * app.lambdaM()).toFixed(2) + ' m']);
    if (g && g.ob) rows.push(['E-B phase at the marker', Math.round(g.ob.gap) + '°, kr = ' + g.ob.kr.toFixed(2)]);
    $('nums').innerHTML = rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('');
    const side = S.view === 'side';
    const cut = patternCut(A.elems, [1, 0, 0], side ? [0, 0, 1] : [0, 1, 0], 360);
    const beam = S.obs ? S.obs.ang : null;
    drawPolar($('polar'), side ? { side: cut, sideX: 'x', upLabel: 'z', beam } : { top: cut, sideX: 'x', upLabel: 'y', beam });
    $('polarNote').textContent = 'Gain in the plane of the field view, 0 to −30 dB. The orange line points at the marker.';
    status();
  }
  function status() {
    const A = app.A(), st = app.stats();
    $('stMain').textContent = (TYPE_NAMES[S.type] || '') + ' · ' + app.freq().toFixed(0) + ' MHz';
    $('stRight').textContent = (st ? 'D ' + st.Ddb.toFixed(2) + ' dBi · ' : '') + (A ? 'Z ' + fz(A.Zin) : '');
  }
  function caption() {
    if (S.saver) return;
    const name = TYPE_NAMES[S.type] || '';
    $('capText').innerHTML = S.v3.on ? `<b>${name}</b> · the pattern in 3D · drag to turn`
      : `<b>${name}</b> · ${FIELD_WORDS[S.field]} · from ${S.view === 'side' ? 'the side' : 'above'}`;
    const lg = $('legend'), c = app.compSpec(), sym = S.field === 'E' ? 'E' : S.field === 'H' ? 'B' : 'S';
    const axis = c[3] ? '' : c[0] ? 'x' : c[1] ? 'y' : 'z';
    lg.style.setProperty('--leg', LEGEND[S.field]);
    const signed = S.field !== 'S' && !c[3];
    lg.querySelector('.neg').innerHTML = signed ? `−<span class="${S.field === 'E' ? 'm2' : 'm1'}">${sym}</span><sub>${axis}</sub>` : '0';
    lg.querySelector('.pos').innerHTML = signed ? `+<span class="${S.field === 'E' ? 'm2' : 'm1'}">${sym}</span><sub>${axis}</sub>`
      : `|<span class="${S.field === 'E' ? 'm2' : S.field === 'H' ? 'm1' : 'm3'}">${sym}</span>|`;
    lg.hidden = S.v3.on;
  }

  // ── sync every control with the state ──
  function sync() {
    document.querySelectorAll('#types button').forEach(b => b.classList.toggle('on', b.dataset.type === S.type));
    document.querySelectorAll('#fields button').forEach(b => b.classList.toggle('on', b.dataset.field === S.field));
    document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === S.view));
    document.querySelectorAll('#togs button').forEach(b => b.classList.toggle('on', !!S.tog[b.dataset.tog]));
    $('morphBtn').classList.toggle('on', S.v3.morphTo === 0);
    $('morphBtn').textContent = S.v3.morphTo === 0 ? '3D: flux sphere' : '3D: pattern';
    $('dbBtn').classList.toggle('on', S.v3.db);
    $('viewField').classList.toggle('on', !S.v3.on);
    $('view3d').classList.toggle('on', S.v3.on);
    $('view3d').setAttribute('aria-pressed', String(S.v3.on));
    $('dock3d').classList.toggle('on', S.v3.on);
    $('dock3d').setAttribute('aria-pressed', String(S.v3.on));
    document.body.classList.toggle('v3', S.v3.on);
    const pl = S.playing ? '❚❚' : '▶', al = S.playing ? 'Pause' : 'Play';
    for (const id of ['play', 'dockPlay']) { $(id).textContent = pl; $(id).setAttribute('aria-label', al); }
    $('speed').value = S.speed; $('speedV').textContent = S.speed.toFixed(2) + ' Hz';
    $('dockName').textContent = TYPE_NAMES[S.type] || '';
    const fsym = S.field === 'E' ? ['m2', 'E'] : S.field === 'H' ? ['m1', 'B'] : ['m3', 'S'];
    $('dockField').innerHTML = `<b class="${fsym[0]}">${fsym[1]}</b>`;
    buildParams();
    caption();
    numbers();
  }

  // ── the panel: a column, or a sheet on a phone ──
  function setPanel(open) {
    $('panel').classList.toggle('open', open);
    if (!open) $('panel').classList.remove('full');
    document.body.classList.toggle('panel-closed', !open && !phone.matches);
    $('dockPanel').classList.toggle('on', open);
    $('dockPanel').setAttribute('aria-expanded', String(open));
    app.invalidate();
  }
  function sheet() {
    const g = $('sheetGrip');
    let y0 = null;
    g.addEventListener('pointerdown', e => { y0 = e.clientY; g.setPointerCapture(e.pointerId); });
    g.addEventListener('pointerup', e => {
      if (y0 == null) return;
      const dy = e.clientY - y0; y0 = null;
      const P = $('panel');
      if (dy > 60) { if (P.classList.contains('full')) P.classList.remove('full'); else setPanel(false); }
      else if (dy < -40) P.classList.add('full');
      else if (Math.abs(dy) < 8) P.classList.toggle('full');
      app.invalidate();
    });
  }

  // ── wiring ──
  document.querySelectorAll('#types button').forEach(b => b.onclick = () => { app.setType(b.dataset.type); app.touch(); });
  const setField = f => {
    S.field = f;
    if (f === 'S' && !S.tog.flow) { S.tog.flow = true; app.resetFlow(); }
    app.invalidate(); sync();
  };
  document.querySelectorAll('#fields button').forEach(b => b.onclick = () => setField(b.dataset.field));
  document.querySelectorAll('#views button').forEach(b => b.onclick = () => { S.view = b.dataset.view; app.geoDirty(); app.invalidate(); app.touch(); sync(); });
  document.querySelectorAll('#togs button').forEach(b => b.onclick = () => {
    const k = b.dataset.tog;
    S.tog[k] = !S.tog[k];
    if (k === 'flow') app.resetFlow();
    app.geoDirty(); app.invalidate(); sync();
  });
  $('morphBtn').onclick = () => { S.v3.morphTo = S.v3.morphTo ? 0 : 1; sync(); };
  $('dbBtn').onclick = () => { S.v3.db = !S.v3.db; sync(); };
  $('viewField').onclick = () => { app.setView3d(false); sync(); };
  $('view3d').onclick = () => { app.setView3d(!S.v3.on); sync(); };
  $('dock3d').onclick = () => { app.setView3d(!S.v3.on); sync(); };
  const play = () => { S.playing = !S.playing; sync(); };
  $('play').onclick = play; $('dockPlay').onclick = play;
  $('speed').oninput = () => { const v = +$('speed').value; if (Number.isFinite(v)) { S.speed = v; $('speedV').textContent = v.toFixed(2) + ' Hz'; } };
  $('dockField').onclick = () => setField(S.field === 'E' ? 'H' : S.field === 'H' ? 'S' : 'E');
  $('dockType').onclick = () => { setPanel(true); $('panel').scrollTop = 0; };
  $('dockPanel').onclick = () => setPanel(!$('panel').classList.contains('open'));
  $('panelClose').onclick = () => setPanel(false);
  $('gear').onclick = () => setPanel(true);
  window.addEventListener('keydown', e => {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); play(); }
    if (e.key === 'Escape' && phone.matches) setPanel(false);
  });
  sheet();
  // A phone starts with the sheet closed, so the field shows.
  setPanel(!phone.matches);
  return { sync, numbers, caption, status, setPanel };
}
