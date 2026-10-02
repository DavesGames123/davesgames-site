// ============================================================================
//  PIN TUMBLER LOCK  ·  analysis.js — the shear-line chart, table, relations
// ────────────────────────────────────────────────────────────────────────────
//  createAnalysis(el) draws the analysis panel for one lock:
//    #stateNow ... open or locked, and which stacks block
//    #chart ...... a side view to scale: the key's bitting edge as it is now,
//                  each stack (key pin, driver, spring) or wafer, and the
//                  shear line. A stack that crosses the line is drawn red.
//    #chTable .... one row per chamber: cut, key pin or window, gap, state
//    #nums ....... insertion, plug angle, bolt, spring load, keyspace
//    #eqs ........ the relations, in plain Unicode maths
//  main.js calls setLock(L) after a swap and frame(st) each frame.
//
//  GREP MAP
//    function drawChart ...... the side view
//    function fillTable ...... the chamber rows
//    function relations ...... the equations for each variant
// ============================================================================
import { keyTop } from './lock.js';

const D = Math.PI / 180;
const sg = v => (v > 0.0005 ? '+' : v < -0.0005 ? '−' : '') + Math.abs(v).toFixed(2);

export function createAnalysis(el) {
  const A = { L: null, tick: 0, dpr: 1 };
  const cv = el.chart, cx = cv.getContext('2d');

  function relations(L) {
    const g = L.g, k = g.key;
    if (L.pin) return [
      ['Shear condition', 'y<sub>i</sub> + k<sub>i</sub> = R &nbsp;for every chamber i'],
      ['Key pin length', `k<sub>i</sub> = R − y<sub>i</sub>* &nbsp;(y* under the right key)`],
      ['Cut height', `c<sub>i</sub> = c<sub>0</sub> − Δ·d<sub>i</sub>, &nbsp;Δ = ${k.step} mm`],
      ['Pin on the key', 'y<sub>i</sub> = max<sub>|ξ|≤r</sub> [ h(x<sub>i</sub>+ξ) + √(ρ² − ξ²) ] − ρ'],
      ['Keyspace', `${k.depths}<sup>${g.n}</sup> = ${L.keyspaceRaw.toLocaleString('en')} &nbsp;·&nbsp; MACS ${k.macs}: ${L.keyspace.toLocaleString('en')}`],
      ['Bolt (Scotch yoke)', `b = R<sub>c</sub> sin θ, &nbsp;R<sub>c</sub> = ${g.cam.Rc} mm`],
      ['Spring', `F = c (L<sub>0</sub> − L), &nbsp;c = ${g.spring.rate} N/mm`],
    ];
    return [
      ['Flush condition', '−R ≤ wafer ≤ R &nbsp;⇔&nbsp; o<sub>i</sub> = 0'],
      ['Wafer offset', 'o<sub>i</sub> = max( o<sub>rest</sub>, h<sub>i</sub> − w<sub>i</sub> )'],
      ['Window top', 'w<sub>i</sub> = h<sub>i</sub>* &nbsp;(the right key\'s cut under wafer i)'],
      ['Cut height', `c<sub>i</sub> = c<sub>0</sub> − Δ·d<sub>i</sub>, &nbsp;Δ = ${k.step} mm`],
      ['Keyspace', `${k.depths}<sup>${g.n}</sup> = ${L.keyspaceRaw.toLocaleString('en')}`],
      ['Spring', `F = c (L<sub>0</sub> − L), &nbsp;c = ${g.spring.rate} N/mm`],
    ];
  }

  A.setLock = L => {
    A.L = L;
    el.eqs.innerHTML = relations(L).map(([h, t]) => `<div class="eq"><span>${h}</span><div>${t}</div></div>`).join('');
    el.chTable.innerHTML = `<thead><tr><th>#</th><th>Cut</th><th>${L.pin ? 'Key pin' : 'Window'}</th><th>Gap</th><th>State</th></tr></thead><tbody>` +
      L.g.X.map((_, i) => `<tr data-i="${i}"><td>${i + 1}</td><td class="c"></td><td>${(L.pin ? L.g.kLen[i] : L.g.winTop[i]).toFixed(2)}</td><td class="g"></td><td class="s"></td></tr>`).join('') + '</tbody>';
    A.rows = [...el.chTable.querySelectorAll('tbody tr')];
    A.last = null;
    A.redraw();
  };

  function fillTable(st) {
    const L = A.L;
    st.ch.forEach((q, i) => {
      const r = A.rows[i]; if (!r) return;
      const cut = q.depth === null ? '—' : String(q.depth);
      const state = q.ok ? 'on the line' : L.pin ? (q.cross === 'key' ? 'key pin across' : 'driver across') : (q.cross === 'up' ? 'stands up' : 'stands down');
      const c = r.querySelector('.c'), g = r.querySelector('.g'), s = r.querySelector('.s');
      if (c.textContent !== cut) c.textContent = cut;
      const gt = sg(q.gap); if (g.textContent !== gt) g.textContent = gt;
      if (s.textContent !== state) s.textContent = state;
      r.classList.toggle('bad', !q.ok);
    });
  }

  function stateLine(st) {
    const L = A.L, bad = st.ch.filter(q => !q.ok).map(q => q.i + 1);
    let head, sub, cls;
    if (st.open) { head = st.theta > 1 * D ? 'Open · turning' : 'Open'; sub = L.pin ? 'Every stack splits on the shear line, so nothing ties the plug to the housing.' : 'Every wafer sits inside the plug, so nothing reaches into a groove.'; cls = 'ok'; }
    else if (st.keyId === 'none' || st.s < 0.02) { head = 'Locked · no key'; sub = L.pin ? 'Each driver pin reaches down across the shear line into the plug.' : 'The springs push every wafer down into the lower groove.'; cls = 'bad'; }
    else if (!st.home) { head = 'Key part way in'; sub = L.pin ? 'The pins ride up and down the cuts as the key slides under them.' : 'The wafers ride up and down the cuts as the key slides through them.'; cls = 'mid'; }
    else { head = `Locked · ${bad.length} of ${L.g.n} ${L.pin ? 'stacks' : 'wafers'} across`; sub = `Chamber${bad.length > 1 ? 's' : ''} ${bad.join(', ')} ${bad.length > 1 ? 'cross' : 'crosses'} the line. The plug turns only ${(L.g.clearance / D).toFixed(1)}° before ${bad.length > 1 ? 'they bind' : 'it binds'}.`; cls = 'bad'; }
    const html = `<b class="${cls}">${head}</b><span>${sub}</span>`;
    if (html !== A.lastState) { el.stateNow.innerHTML = html; A.lastState = html; }
  }

  function nums(st) {
    const L = A.L, g = L.g, F = st.ch.reduce((a, q) => a + q.force, 0);
    const rows = [
      ['Key in', `${(st.s * g.key.travel).toFixed(1)} of ${g.key.travel} mm`],
      ['Plug angle θ', `${(st.theta / D).toFixed(1)}°`],
      L.pin ? ['Bolt b', `${st.bolt.toFixed(2)} of ${g.cam.Rc} mm`] : ['Cam bar', st.theta > 80 * D ? 'clear of the stop' : 'behind the stop'],
      ['Spring load', `${F.toFixed(2)} N in all`],
      ['Stacks on the line', `${st.ok} of ${g.n}`],
      ['Keyspace', L.pin ? `${L.keyspace.toLocaleString('en')} codes` : `${L.keyspaceRaw.toLocaleString('en')} codes`],
    ];
    const html = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
    if (html !== A.lastNums) { el.nums.innerHTML = html; A.lastNums = html; }
  }

  // ── the side view ─────────────────────────────────────────────────────────
  function drawChart(st) {
    const L = A.L, g = L.g, k = g.key;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx.clearRect(0, 0, w, h);
    const xa = g.x0 - 0.5, xb = 3.2;
    const ya = L.pin ? -5.4 : -9.4, yb = L.pin ? g.yTop + 0.8 : 9.4;
    const sc = Math.min((w - 16) / (xb - xa), (h - 22) / (yb - ya));
    const ox = (w - (xb - xa) * sc) / 2, oy = 8 + (h - 22 - (yb - ya) * sc) / 2;
    const X = x => ox + (x - xa) * sc, Y = y => oy + (yb - y) * sc;
    // housing and plug bands
    cx.fillStyle = 'rgba(201,154,82,0.10)';
    if (L.pin) cx.fillRect(X(g.x0), Y(g.yTop), (g.x1 - g.x0) * sc, (g.yTop - g.Rp) * sc);
    else { cx.fillRect(X(g.x0), Y(9.2), (g.x1 - g.x0) * sc, (9.2 - g.Rp) * sc); cx.fillRect(X(g.x0), Y(-g.Rp), (g.x1 - g.x0) * sc, (9.2 - g.Rp) * sc); }
    cx.fillStyle = 'rgba(226,189,116,0.08)';
    cx.fillRect(X(g.x0), Y(g.Rp), (g.x1 - g.x0) * sc, 2 * g.Rp * sc);
    // the key
    const xs = st.xs;
    if (st.keyId !== 'none') {
      const bit = L.bits[st.keyId];
      cx.beginPath();
      const u0 = Math.max(-k.len, xa - xs), u1 = Math.min(0, xb - xs);
      if (u1 > u0) {
        cx.moveTo(X(u0 + xs), Y(k.yBot));
        for (let u = u0; u <= u1 + 1e-9; u += 0.08) cx.lineTo(X(u + xs), Y(keyTop(g, bit, u)));
        cx.lineTo(X(u1 + xs), Y(k.yBot)); cx.closePath();
        cx.fillStyle = 'rgba(214,212,203,0.30)'; cx.fill();
        cx.strokeStyle = 'rgba(232,230,220,0.85)'; cx.lineWidth = 1; cx.stroke();
      }
    }
    // stacks
    const r = (L.pin ? g.pinR : g.waferT / 2 + 0.25);
    st.ch.forEach((q, i) => {
      const x = g.X[i], bad = !q.ok;
      if (L.pin) {
        // spring
        cx.strokeStyle = 'rgba(184,190,200,0.75)'; cx.lineWidth = 1; cx.beginPath();
        const turns = 7, yA = q.dt, yB = g.yTop;
        for (let j = 0; j <= turns * 2; j++) { const y = yA + (yB - yA) * j / (turns * 2), xx = x + (j % 2 ? 1 : -1) * r * 0.75; j ? cx.lineTo(X(xx), Y(y)) : cx.moveTo(X(x), Y(y)); }
        cx.stroke();
        // driver and key pin
        cx.fillStyle = bad && q.cross === 'driver' ? '#e0675d' : '#cdd3dd';
        cx.fillRect(X(x - r), Y(q.dt), 2 * r * sc, (q.dt - q.db) * sc);
        cx.fillStyle = bad && q.cross === 'key' ? '#e0675d' : '#e0b060';
        cx.beginPath(); cx.moveTo(X(x - r), Y(q.kt)); cx.lineTo(X(x + r), Y(q.kt)); cx.lineTo(X(x + r), Y(q.kb + 0.6)); cx.quadraticCurveTo(X(x), Y(q.kb - 0.25), X(x - r), Y(q.kb + 0.6)); cx.closePath(); cx.fill();
      } else {
        cx.fillStyle = bad ? 'rgba(224,103,93,0.9)' : 'rgba(200,204,212,0.9)';
        cx.fillRect(X(x - r), Y(q.off + g.Rp), 2 * r * sc, 2 * g.Rp * sc);
        cx.fillStyle = 'rgba(8,9,15,0.9)';
        cx.fillRect(X(x - r) + 1, Y(q.off + g.winTop[i]), 2 * r * sc - 2, (g.winTop[i] - g.winBot) * sc);
      }
      cx.fillStyle = bad ? '#ff8a80' : '#8d90a6'; cx.font = '10px ui-monospace,Menlo,monospace'; cx.textAlign = 'center';
      cx.fillText(String(i + 1), X(x), h - 4);
    });
    // shear lines
    cx.setLineDash([5, 3]); cx.lineWidth = 1.4;
    cx.strokeStyle = st.open ? '#7fe3b0' : '#ffb35c';
    for (const y of L.pin ? [g.Rp] : [g.Rp, -g.Rp]) { cx.beginPath(); cx.moveTo(X(g.x0), Y(y)); cx.lineTo(X(g.x1), Y(y)); cx.stroke(); }
    cx.setLineDash([]);
    cx.fillStyle = st.open ? '#7fe3b0' : '#ffb35c'; cx.font = '10px Inter,system-ui,sans-serif'; cx.textAlign = 'left';
    cx.fillText(L.pin ? 'shear line' : 'plug surface', X(g.x1) + 3 > w - 60 ? X(g.x0) + 2 : X(g.x1) + 3, Y(g.Rp) - 4);
  }

  A.redraw = () => { if (A.L && A.st) drawChart(A.st); };
  A.frame = st => {
    if (!A.L) return;
    A.st = st;
    A.tick++;
    drawChart(st);
    if (A.tick % 3 === 0) { fillTable(st); stateLine(st); }
    if (A.tick % 6 === 0) nums(st);
  };
  return A;
}
