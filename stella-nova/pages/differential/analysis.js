// ============================================================================
//  DIFFERENTIAL  ·  analysis.js — the top view, speed trace, torque split
// ────────────────────────────────────────────────────────────────────────────
//  createAnalysis(el) draws into the analysis group of the panel:
//    #top ..... the car from above: its path, the wheel tracks, ice, lift
//    #spd ..... wheel and carrier speed over the last 12 s
//    #split ... the torque to each wheel as two bars
//    #nums .... live numbers; #eqs the relations with today's numbers
//  main.js calls set() when the variant, scenario or torque changes and
//  frame() every frame. Plain Unicode maths only (no KaTeX).
//
//  GREP MAP
//    function drawTop ......... the car, the path, the tracks
//    function drawTrace ....... the speed trace
//    function fillNums / fillEqs
// ============================================================================
import { SPEC, BEV, HEL, SCEN } from './diff.js';

const COL = { L: '#8fb0ff', R: '#e9a0a8', C: '#e9c27a', ice: '#bfe6ff' };
const f1 = v => (Math.abs(v) < 0.05 ? 0 : v).toFixed(1), f0 = v => Math.round(v).toString();

function fitCanvas(c) {
  const r = c.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return { g: c.getContext('2d'), w, h, k: dpr };
}

export function createAnalysis(el) {
  const st = { variant: 'open', scen: 'straight', drv: null, o: {}, hist: [], dist: 0, t: 0 };

  // ── top view ──────────────────────────────────────────────────────────────
  function drawTop(now) {
    const c = el.top; if (!c.offsetParent) return;
    const { g, w, h, k } = fitCanvas(c);
    g.clearRect(0, 0, w, h);
    const d = st.drv; if (!d) return;
    const sc = st.scen, track = SPEC.road.track;
    const px = Math.min(w, h * 1.4) / 7.5;           // pixels per metre
    const cx = w / 2, cy = h * 0.6;
    g.save(); g.translate(cx, cy);
    g.lineWidth = 1 * k;
    const carLen = 4.4, carW = 1.8, axleY = 0;       // rear axle at the origin, car points up
    if (sc === 'corner') {
      const R = st.o.R, dir = st.o.dir;
      const ox = -dir * R * px;                       // turning centre on the axle line
      g.setLineDash([4 * k, 5 * k]); g.strokeStyle = 'rgba(217,179,106,0.35)';
      g.beginPath(); g.moveTo(ox, 0); g.lineTo(0, 0); g.stroke(); g.setLineDash([]);
      for (const [rr, col] of [[R - track / 2, dir > 0 ? COL.L : COL.R], [R + track / 2, dir > 0 ? COL.R : COL.L], [R, COL.C]]) {
        g.strokeStyle = col; g.globalAlpha = rr === R ? 0.5 : 0.9; g.lineWidth = (rr === R ? 1 : 2) * k;
        g.beginPath(); g.arc(ox, 0, rr * px, dir > 0 ? -0.9 : Math.PI - 0.6, dir > 0 ? 0.6 : Math.PI + 0.9); g.stroke();
      }
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(217,179,106,0.8)'; g.beginPath(); g.arc(ox, 0, 3 * k, 0, 6.3); g.fill();
      g.fillStyle = '#8d90a6'; g.font = `${10 * k}px ui-monospace,Menlo,monospace`;
      g.textAlign = dir > 0 ? 'left' : 'right';
      g.fillText(`R ${R.toFixed(0)} m`, ox + dir * 6 * k, -6 * k);
    } else {
      // lane edges and dashes that move with the car
      const off = (st.dist * px) % (2.4 * px);
      g.strokeStyle = 'rgba(141,144,166,0.35)'; g.setLineDash([1.2 * px, 1.2 * px]); g.lineDashOffset = -off;
      for (const x of [-2.2, 2.2]) { g.beginPath(); g.moveTo(x * px, -cy); g.lineTo(x * px, h - cy); g.stroke(); }
      g.setLineDash([]);
    }
    if (sc === 'ice') {
      g.fillStyle = 'rgba(191,230,255,0.22)'; g.strokeStyle = 'rgba(191,230,255,0.5)';
      g.beginPath(); g.ellipse(track / 2 * px, 0.2 * px, 0.75 * px, 1.6 * px, 0, 0, 6.3); g.fill(); g.stroke();
      g.fillStyle = COL.ice; g.font = `${10 * k}px Inter,system-ui,sans-serif`; g.textAlign = 'left';
      g.fillText('ice', (track / 2 + 0.7) * px, 1.6 * px);
    }
    if (sc === 'lift') {
      g.fillStyle = 'rgba(141,144,166,0.25)';
      for (const s of [-1, 1]) g.fillRect(s * 1.3 * px - 0.15 * px, -3.2 * px, 0.3 * px, 3.9 * px);
    }
    // the car body
    g.fillStyle = 'rgba(23,26,40,0.9)'; g.strokeStyle = 'rgba(217,179,106,0.45)'; g.lineWidth = 1.2 * k;
    const bx = -carW / 2 * px, by = -(carLen - 0.9) * px;
    g.beginPath(); g.roundRect ? g.roundRect(bx, by, carW * px, carLen * px, 0.35 * px) : g.rect(bx, by, carW * px, carLen * px); g.fill(); g.stroke();
    // the rear axle and wheels, each wheel tinted by its speed
    g.strokeStyle = 'rgba(217,179,106,0.6)'; g.beginPath(); g.moveTo(-track / 2 * px, axleY); g.lineTo(track / 2 * px, axleY); g.stroke();
    const wheels = [[-1, d.kL, COL.L, d.TL], [1, d.kR, COL.R, d.TR]];
    for (const [s, kk, col, T] of wheels) {
      g.fillStyle = col; g.globalAlpha = 0.25 + 0.75 * Math.min(1, Math.abs(kk) / 2);
      g.fillRect(s * track / 2 * px - 0.13 * px, -0.33 * px, 0.26 * px, 0.66 * px);
      g.globalAlpha = 1;
      // speed arrow (length ∝ wheel speed)
      const L = kk * 0.9 * px * (sc === 'lift' ? 1 : 1);
      if (Math.abs(L) > 1) {
        const x = s * (track / 2 + 0.35) * px;
        g.strokeStyle = col; g.lineWidth = 2 * k; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, -L); g.stroke();
        g.beginPath(); g.moveTo(x - 4 * k, -L + Math.sign(L) * 6 * k); g.lineTo(x, -L); g.lineTo(x + 4 * k, -L + Math.sign(L) * 6 * k); g.stroke();
      }
    }
    // the front wheels steer in a corner
    const steer = sc === 'corner' ? Math.atan(2.7 / st.o.R) * st.o.dir : 0;
    for (const s of [-1, 1]) {
      g.save(); g.translate(s * track / 2 * px, -2.7 * px); g.rotate(-steer);
      g.fillStyle = 'rgba(185,192,207,0.55)'; g.fillRect(-0.12 * px, -0.32 * px, 0.24 * px, 0.64 * px); g.restore();
    }
    g.restore();
  }

  // ── speed trace ───────────────────────────────────────────────────────────
  function drawTrace() {
    const c = el.spd; if (!c.offsetParent) return;
    const { g, w, h, k } = fitCanvas(c);
    g.clearRect(0, 0, w, h);
    const H = st.hist; if (H.length < 2) return;
    let max = 1; for (const q of H) max = Math.max(max, Math.abs(q.L), Math.abs(q.R), Math.abs(q.C));
    max = Math.ceil(max / 10) * 10;
    const lo = H.some(q => q.L < -0.01 || q.R < -0.01) ? -max : 0;
    const t1 = H[H.length - 1].t, t0 = t1 - 12;
    const X = t => (t - t0) / 12 * w, Y = v => h - 6 * k - (v - lo) / (max - lo) * (h - 14 * k);
    g.strokeStyle = 'rgba(141,144,166,0.18)'; g.lineWidth = 1;
    for (const v of [lo, 0, max]) { g.beginPath(); g.moveTo(0, Y(v)); g.lineTo(w, Y(v)); g.stroke(); }
    g.fillStyle = '#8d90a6'; g.font = `${9 * k}px ui-monospace,Menlo,monospace`; g.textAlign = 'left';
    g.fillText(`${max} rpm`, 4 * k, Y(max) + 10 * k);
    for (const [key, col, wd] of [['C', COL.C, 1.2], ['L', COL.L, 2], ['R', COL.R, 2]]) {
      g.strokeStyle = col; g.lineWidth = wd * k; g.setLineDash(key === 'C' ? [5 * k, 4 * k] : []); g.beginPath();
      H.forEach((q, i) => { const x = X(q.t), y = Y(q[key]); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.stroke();
    }
    g.setLineDash([]);
  }

  // ── numbers and relations ────────────────────────────────────────────────
  const row = (k, v, cls = '') => `<tr${cls ? ` class="${cls}"` : ''}><td>${k}</td><td>${v}</td></tr>`;
  let lastNums = '';
  function fillNums(L) {
    const d = st.drv, tz = st.variant === 'torsen';
    const html = `<tr><th>Speed</th><th>rpm</th></tr>` +
      row('<i class="sw l"></i>Left wheel ω<sub>L</sub>', f1(L.wL)) +
      row('<i class="sw r"></i>Right wheel ω<sub>R</sub>', f1(L.wR)) +
      row('<i class="sw c"></i>Carrier ω<sub>C</sub>', f1(L.wC)) +
      row('(ω<sub>L</sub> + ω<sub>R</sub>) / 2', f1((L.wL + L.wR) / 2), 'chk') +
      row(tz ? 'Element gear in its pocket' : 'Spider on its pin', f1(L.spin)) +
      row('Drive pinion ω<sub>p</sub>', f1(L.wP)) +
      row('Road speed', st.scen === 'lift' ? '—' : `${(L.v * 3.6).toFixed(1)} km/h`) +
      `<tr><th>Torque</th><th>N·m</th></tr>` +
      row('Into the pinion T<sub>p</sub>', st.scen === 'lift' ? '—' : f0(st.o.Tin)) +
      row('Carrier T<sub>C</sub> = T<sub>p</sub> · 41/11', st.scen === 'lift' ? '—' : f0(d.Tc)) +
      row('<i class="sw l"></i>Left wheel T<sub>L</sub>', st.scen === 'lift' ? '—' : f0(d.TL)) +
      row('<i class="sw r"></i>Right wheel T<sub>R</sub>', st.scen === 'lift' ? '—' : f0(d.TR)) +
      (st.scen === 'lift' ? row('To turn one wheel by hand', `≈ ${d.hand}`) : '');
    if (html !== lastNums) { el.nums.innerHTML = html; lastNums = html; }
  }
  function fillEqs() {
    const d = st.drv, v = st.variant, sc = st.scen, tz = v === 'torsen';
    const Ns = tz ? SPEC.hel.NS : SPEC.side.N, Nq = tz ? SPEC.hel.NP : SPEC.spider.N;
    const kk = `${d.kL.toFixed(3)} and ${d.kR.toFixed(3)}`;
    const E = [
      ['Speed: the average is fixed', `ω<sub>C</sub> = (ω<sub>L</sub> + ω<sub>R</sub>) / 2`, `now ω<sub>L</sub>, ω<sub>R</sub> = ${kk} × ω${sc === 'lift' ? '' : '<sub>C</sub>'}`],
      [tz ? 'Elements on the case' : 'Spider on its pin', `ω<sub>${tz ? 'e' : 's'}</sub> = (ω<sub>R</sub> − ω<sub>L</sub>) / 2 · ${Ns}/${Nq}`, tz ? 'the two elements of a pair turn in opposite senses' : 'zero when both wheels turn together'],
      ['Final drive', `ω<sub>p</sub> = ${(BEV.ratio).toFixed(3)} · ω<sub>C</sub>,  T<sub>C</sub> = ${(BEV.ratio).toFixed(3)} · T<sub>p</sub>`, `${SPEC.ring.N} ring teeth : ${SPEC.pinion.N} pinion teeth`],
    ];
    if (sc === 'corner') E.push(['Wheel paths in a turn', `ω<sub>out</sub> / ω<sub>in</sub> = (R + t/2) / (R − t/2)`, `t = ${SPEC.road.track} m, R = ${st.o.R.toFixed(0)} m → ${((st.o.R + SPEC.road.track / 2) / (st.o.R - SPEC.road.track / 2)).toFixed(3)}`]);
    if (v === 'open') E.push(['Torque: always half each', 'T<sub>L</sub> = T<sub>R</sub> = T<sub>C</sub> / 2', 'each spider is a balance beam: equal force on both side gears']);
    if (v === 'clutch') E.push(['Torque: the clutches move it', 'T<sub>slow</sub> − T<sub>fast</sub> ≤ T<sub>f</sub> = T<sub>pre</sub> + c · T<sub>C</sub>', `T<sub>pre</sub> = ${SPEC.clutch.pre} N·m, c = ${SPEC.clutch.c} → T<sub>f</sub> = ${f0(SPEC.clutch.pre + SPEC.clutch.c * Math.max(0, d.Tc))} N·m`]);
    if (v === 'torsen') E.push(['Torque: bias ratio', 'T<sub>slow</sub> / T<sub>fast</sub> ≤ TBR', `TBR = ${SPEC.torsen.TBR}: the slow wheel can take up to ${SPEC.torsen.TBR}× the fast one`]);
    if (sc === 'ice') E.push(['Grip on each wheel', 'T<sub>max</sub> = μ · N · r', `ice μ ${SPEC.road.muIce} → ${f0(SPEC.road.muIce * SPEC.road.load * SPEC.road.tire)} N·m, dry μ ${SPEC.road.muDry} → ${f0(SPEC.road.muDry * SPEC.road.load * SPEC.road.tire)} N·m`]);
    el.eqs.innerHTML = E.map(([h, eq, sub]) => `<div class="eq"><span>${h}</span><div>${eq}</div><em>${sub}</em></div>`).join('');
  }
  function fillSplit() {
    const d = st.drv, lift = st.scen === 'lift';
    const tot = Math.max(1, Math.abs(d.TL) + Math.abs(d.TR));
    const pL = lift ? 50 : Math.abs(d.TL) / tot * 100;
    el.split.innerHTML = lift ? `<i class="l" style="width:50%;opacity:0.3"></i><i class="r" style="width:50%;opacity:0.3"></i>`
      : `<i class="l" style="width:${pL.toFixed(1)}%"></i><i class="r" style="width:${(100 - pL).toFixed(1)}%"></i>`;
    el.splitLab.innerHTML = lift ? '<span>no drive torque</span>' : `<span>L ${f0(d.TL)} N·m · ${pL.toFixed(0)}%</span><span>${(100 - pL).toFixed(0)}% · ${f0(d.TR)} N·m R</span>`;
    el.now.innerHTML = `<b>${SCEN[st.scen].name}</b><span>${d.note}</span>`;
  }

  return {
    set(variant, scen, drv, o) { Object.assign(st, { variant, scen, drv, o }); fillEqs(); fillSplit(); lastNums = ''; },
    frame(L, dt) {
      st.t += dt; st.dist += L.v * dt;
      st.hist.push({ t: st.t, L: L.wL, R: L.wR, C: L.wC });
      while (st.hist.length && st.hist[0].t < st.t - 12.5) st.hist.shift();
      if ((st.tick = (st.tick || 0) + 1) % 2) return;
      drawTop(); drawTrace(); fillNums(L);
    },
    redraw() { lastNums = ''; },
  };
}
