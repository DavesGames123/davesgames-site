/* ============================================================================
   SMITH CHART  ·  match.js  (matching networks, uses window.SC and RF)
   ----------------------------------------------------------------------------
   The Match section of the panel. It matches the load at f to Z0 in one of
   three ways and draws the path of the selected solution on the chart:
     L-network   two lossless parts (rf.js lMatch). Both topologies, both
                 roots. Each card gives the parts in pF and nH at f, the
                 node Q, and a small schematic.
     stub        a line of length d, then a shunt open or short stub of
                 length l (rf.js stubMatch). In wavelengths, degrees and
                 millimetres at f and vf.
     lambda/4    a line of length d to a real R, then a lambda/4 line of
                 Zt = sqrt(Z0 R) (rf.js quarterWave).
   The path on the chart: a series part moves along a constant-r circle,
   a shunt part along a constant-g circle, a line along a |gamma| circle.

   GREP MAP
     grep -n 'function solutions'   the solutions of the current method
     grep -n 'function cardHTML'    one solution card
     grep -n 'function schematic'   the L-network schematic (inline SVG)
     grep -n 'function drawPath'    the path of the selected solution
     grep -n 'function copyLines'   the text for "copy results"
   ========================================================================== */
(() => {
  'use strict';
  const { S, RF, COL } = SC;
  const { cx, fmtEng, inv, zToGamma } = RF;
  const $ = id => document.getElementById(id);
  const T = { method: 'off', sol: 0, stub: 'short' };
  let last = { sols: [], key: '' };

  // ------------------------------------------------------------ solutions
  function solutions(M) {
    if (!M.ok || T.method === 'off') return [];
    if (T.method === 'lnet') return RF.lMatch(M.Z, S.z0, M.f);
    if (T.method === 'stub') return RF.stubMatch(M.Z, S.z0, T.stub, M.f, S.vf);
    if (T.method === 'qw') return RF.quarterWave(M.Z, S.z0);
    return [];
  }
  const partName = (pos, p) => (p.kind ? `${pos} ${p.kind} ${SC.fmtPart(p)}` : `${pos}: none`);
  const mmText = m => (!isFinite(m) ? '—' : m >= 1 ? `${m.toFixed(3)} m` : `${(m * 1000).toFixed(2)} mm`);

  // A small schematic of an L-network: source on the left, load on the
  // right. The part next to the load is near, the other is far.
  function schematic(sol) {
    const L = (x, y, vert) => vert
      ? `<path d="M${x} ${y} v4 a3 3 0 0 1 0 6 a3 3 0 0 1 0 6 a3 3 0 0 1 0 6 v4"/>`
      : `<path d="M${x} ${y} h4 a3 3 0 0 1 6 0 a3 3 0 0 1 6 0 a3 3 0 0 1 6 0 h4"/>`;
    const C = (x, y, vert) => vert
      ? `<path d="M${x} ${y} v11 M${x - 7} ${y + 11} h14 M${x - 7} ${y + 15} h14 M${x} ${y + 15} v11"/>`
      : `<path d="M${x} ${y} h11 M${x + 11} ${y - 7} v14 M${x + 15} ${y - 7} v14 M${x + 15} ${y} h11"/>`;
    const part = (p, x, y, vert) => (!p.kind ? (vert ? '' : `<path d="M${x} ${y} h26"/>`) : (p.kind === 'L' ? L : C)(x, y, vert));
    const ser = sol.topo === 'series' ? sol.near : sol.far, sh = sol.topo === 'series' ? sol.far : sol.near;
    // series part at the load: shunt at x = 58 (input side), series 70..96.
    // shunt part at the load: series 30..56, shunt at x = 104 (load side).
    const sx = sol.topo === 'series' ? 70 : 30, px = sol.topo === 'series' ? 58 : 104;
    const shunt = sh.part.kind
      ? `<path d="M${px} 16 v2"/>${part(sh.part, px, 18, true)}<path d="M${px} 44 v4 M${px - 6} 48 h12 M${px - 4} 51 h8 M${px - 2} 54 h4"/>`
      : '';
    return `<svg class="schem" viewBox="0 0 164 64" aria-hidden="true">
      <g fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
        <path d="M14 16 H${sx} M${sx + 26} 16 H146"/>${part(ser.part, sx, 16, false)}${shunt}
        <circle cx="10" cy="16" r="3.2"/><rect x="146" y="8" width="12" height="16" rx="2"/>
      </g>
      <text x="2" y="34">Z0</text><text x="142" y="38">ZL</text>
    </svg>`;
  }

  function cardHTML(s, i) {
    const n = `<span class="sol-n">${i + 1}</span>`;
    if (T.method === 'lnet') {
      const order = s.topo === 'series'
        ? [partName('shunt', s.far.part), partName('series', s.near.part)]
        : [partName('series', s.far.part), partName('shunt', s.near.part)];
      return `${n}<div class="sol-body"><div class="sol-t">${order.join('<span class="arr">→</span>')}<span class="arr">→</span>ZL</div>`
        + `<div class="sol-s">${s.topo === 'series' ? 'series part at the load' : 'shunt part at the load'} · node Q ${s.q.toFixed(2)}</div>${schematic(s)}</div>`;
    }
    if (T.method === 'stub') {
      return `${n}<div class="sol-body"><div class="sol-t">d ${s.d.toFixed(4)} λ <span class="dim">${s.dDeg.toFixed(1)}° · ${mmText(s.dM)}</span></div>`
        + `<div class="sol-t">l ${s.l.toFixed(4)} λ <span class="dim">${s.lDeg.toFixed(1)}° · ${mmText(s.lM)}</span></div>`
        + `<div class="sol-s">at d, y = 1 ${s.b < 0 ? '−' : '+'} j${Math.abs(s.b).toFixed(3)}; the ${T.stub} stub adds ${s.b < 0 ? '+' : '−'}j${Math.abs(s.b).toFixed(3)}</div></div>`;
    }
    const lam = RF.lambdaOf(S.f, S.vf);
    return `${n}<div class="sol-body"><div class="sol-t">d ${s.d.toFixed(4)} λ <span class="dim">${(s.d * 360).toFixed(1)}° · ${mmText(s.d * lam)}</span></div>`
      + `<div class="sol-t">Zt ${fmtEng(s.Zt, 'Ω', 4)} <span class="dim">λ/4 = ${mmText(lam / 4)}</span></div>`
      + `<div class="sol-s">to the voltage ${s.at === 'max' ? 'maximum' : 'minimum'}, R = ${fmtEng(s.R, 'Ω', 4)}</div></div>`;
  }

  function render(M) {
    const sols = solutions(M);
    const key = `${T.method}|${T.stub}|${T.sol}|${S.z0}|${S.f}|${S.vf}|${M.ok ? M.Z.re.toFixed(6) + ',' + M.Z.im.toFixed(6) : 'x'}`;
    last.sols = sols;
    if (key === last.key) return;
    last.key = key;
    $('stubKind').classList.toggle('off', T.method !== 'stub');
    const host = $('matchSols'), note = $('matchNote');
    if (T.method === 'off') { host.innerHTML = ''; note.textContent = 'Pick a method. The selected solution shows on the chart.'; return; }
    if (!M.ok) { host.innerHTML = ''; note.textContent = 'The load has no value at f.'; return; }
    if (!sols.length) {
      host.innerHTML = '';
      const m = RF.abs(M.g);
      note.textContent = m < 1e-6 ? 'The load is matched. No network is necessary.'
        : 'No solution: the load has no resistance, so a lossless network cannot reach Z0.';
      return;
    }
    if (T.sol >= sols.length) T.sol = 0;
    host.innerHTML = sols.map((s, i) => `<button class="sol${i === T.sol ? ' on' : ''}" data-sol="${i}">${cardHTML(s, i)}</button>`).join('');
    note.textContent = T.method === 'lnet' ? `Values at ${fmtEng(M.f, 'Hz', 4)}. A lower node Q gives a wider bandwidth.`
      : T.method === 'stub' ? `Lengths at ${fmtEng(M.f, 'Hz', 4)} and vf ${S.vf}, on a Z0 = ${fmtEng(S.z0, 'Ω', 4)} line.`
      : `Lengths at ${fmtEng(M.f, 'Hz', 4)} and vf ${S.vf}. The λ/4 section has its own Zt.`;
  }

  // ------------------------------------------------------------ chart path
  function drawPath(ctx, M) {
    if (!M.ok || T.method === 'off') return;
    // The overlay runs before the readout in a frame, so it takes its own
    // solutions for this M (not the cards of the last frame).
    const s = solutions(M)[T.sol];
    if (!s) return;
    const z = M.z, N = 60;
    const col = COL.match;
    if (T.method === 'lnet') {
      // step through a part: series adds jX, shunt adds jB (normalized)
      const steps = [s.near, s.far];
      let cur = z;
      steps.forEach((el, k) => {
        const pts = [];
        for (let i = 0; i <= N; i++) {
          const t = i / N;
          pts.push(el.pos === 'series' ? cx(cur.re, cur.im + t * el.X / S.z0) : inv(RF.add(inv(cur), cx(0, t * el.B * S.z0))));
        }
        SC.zPath(pts, col, 2.4, k ? [] : [7, 4]);
        cur = pts[N];
        if (!k) { SC.dot(zToGamma(cur), col, 4.5); SC.tag(zToGamma(cur), el.part.kind ? `${el.pos} ${el.part.kind}` : el.pos, col, 9, -12); }
      });
      SC.dot(cx(0, 0), col, 5.5);
      return;
    }
    if (T.method === 'stub') {
      SC.ctx.strokeStyle = 'rgba(126,224,160,0.3)'; SC.ctx.lineWidth = 1.2;
      SC.ctx.beginPath(); SC.ctx.arc(SC.view.cx - SC.view.R * 0.5, SC.view.cy, SC.view.R * 0.5, 0, Math.PI * 2); SC.ctx.stroke();
      SC.walkArc(M.g, s.d, col, [7, 4]);
      const pts = [];
      for (let i = 0; i <= N; i++) pts.push(inv(cx(1, s.b * (1 - i / N))));
      SC.zPath(pts, col, 2.4);
      SC.dot(s.gammaD, col, 4.5);
      SC.tag(s.gammaD, `d ${s.d.toFixed(3)}λ`, col, 9, -12);
      SC.dot(cx(0, 0), col, 5.5);
      return;
    }
    // quarter-wave: the line to R, then the lambda/4 section of Zt
    SC.walkArc(M.g, s.d, col, [7, 4]);
    const pts = [];
    for (let i = 0; i <= N; i++) pts.push(RF.scale(RF.zIn(cx(s.R / s.Zt, 0), 0.25 * i / N), s.Zt / S.z0));
    SC.zPath(pts, col, 2.4);
    const gR = zToGamma(cx(s.R / S.z0, 0));
    SC.dot(gR, col, 4.5);
    SC.tag(gR, `R ${fmtEng(s.R, 'Ω', 3)}`, col, 9, -12);
    SC.dot(cx(0, 0), col, 5.5);
  }

  // ------------------------------------------------------- copy and state
  function copyLines(M) {
    if (T.method === 'off' || !M.ok) return [];
    const sols = solutions(M);
    if (!sols.length) return ['Match: none'];
    const head = { lnet: 'L-network', stub: `Shunt ${T.stub} stub`, qw: 'Quarter-wave transformer' }[T.method];
    const out = [`Match (${head}, f ${fmtEng(M.f, 'Hz', 4)}, Z0 ${fmtEng(S.z0, 'Ω', 4)}, vf ${S.vf}):`];
    const lam = RF.lambdaOf(M.f, S.vf);
    sols.forEach((s, i) => {
      let t;
      if (T.method === 'lnet') {
        t = s.topo === 'series'
          ? `source -> ${partName('shunt', s.far.part)} -> ${partName('series', s.near.part)} -> load`
          : `source -> ${partName('series', s.far.part)} -> ${partName('shunt', s.near.part)} -> load`;
        t += `  (node Q ${s.q.toFixed(2)})`;
      } else if (T.method === 'stub') {
        t = `d ${s.d.toFixed(4)} λ (${s.dDeg.toFixed(1)}°, ${mmText(s.dM)}), stub l ${s.l.toFixed(4)} λ (${s.lDeg.toFixed(1)}°, ${mmText(s.lM)})`;
      } else {
        t = `d ${s.d.toFixed(4)} λ (${mmText(s.d * lam)}) to R ${fmtEng(s.R, 'Ω', 4)}, then λ/4 of Zt ${fmtEng(s.Zt, 'Ω', 4)}`;
      }
      out.push(`  ${i + 1}${i === T.sol ? '*' : ' '} ${t}`);
    });
    return out;
  }

  // -------------------------------------------------------------- binding
  const setMethodTabs = SC.radio($('matchTabs'), 'method', v => { T.method = v; T.sol = 0; last.key = ''; });
  const setStubTabs = SC.radio($('stubKind'), 'stub', v => { T.stub = v; T.sol = 0; last.key = ''; });
  $('matchSols').addEventListener('click', e => {
    const b = e.target.closest('.sol');
    if (!b) return;
    T.sol = +b.dataset.sol; last.key = ''; SC.setDirty();
  });
  SC.hooks.overlay.push(drawPath);
  SC.hooks.readout.push(render);
  SC.hooks.copy.push(copyLines);
  SC.hooks.state.push({
    get: () => ({ mt: T.method, ms: T.sol, sk: T.stub }),
    set: o => {
      if (o.mt && /^(off|lnet|stub|qw)$/.test(o.mt)) { T.method = o.mt; setMethodTabs(o.mt); }
      if (o.sk === 'open' || o.sk === 'short') { T.stub = o.sk; setStubTabs(o.sk); }
      if (o.ms != null && isFinite(+o.ms)) T.sol = Math.max(0, Math.min(3, +o.ms | 0));
      last.key = '';
    },
  });
  // M: cycle the match method
  SC.hooks.key.push(e => {
    if (e.key !== 'm' && e.key !== 'M') return false;
    const order = ['off', 'lnet', 'stub', 'qw'];
    T.method = order[(order.indexOf(T.method) + 1) % order.length]; T.sol = 0; last.key = '';
    setMethodTabs(T.method); SC.setDirty();
    return true;
  });
  SC.match = T;
})();
