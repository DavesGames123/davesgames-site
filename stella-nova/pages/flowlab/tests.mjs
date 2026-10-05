// ============================================================================
//  FLOWLAB  ·  tests.mjs — saver tracer step check  (Node, run by hand)
// ----------------------------------------------------------------------------
//  Runs the systems that the saver picks (snSaver "keys") with the saver
//  step stepAlong() of main.js, in a 16:9 and a 9:16 canvas, and asserts
//  that no tracer moves more than SUB_MAX * DS_PX screen px in one frame
//  and that every position stays finite. It also prints the largest
//  one-frame jump of the old step (one midpoint step, cap 0.7 CH px).
//
//  The check takes the source of main.js: the systems table, fieldAt and
//  stepAlong, and runs them in a vm context. No DOM is needed.
//  RUN:  node stella-nova/pages/flowlab/tests.mjs
// ============================================================================
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('anchor ' + a); return src.slice(i, j); };
const code = cut('const ST="ST"', '/* ════════ state') +
  'let cur="pendulum", P={};\n' +
  cut('function fieldAt(', '/* ════════ magnitude') +
  cut('const DS_PX=', 'function nearPole') +
  cut('const SAVER_PX=', '// The speed level') +
  'this.api={SYS,setCur:k=>{cur=k;P={};for(const[q,v]of Object.entries(SYS[k].params||{}))P[q]=v.d;},fieldAt,stepAlong,DS_PX,SUB_MAX,SAVER_PX};';
const ctx = {}; vm.createContext(ctx); vm.runInContext(code, ctx);
const A = ctx.api;
const keys = (src.match(/const keys=(\[[^\]]+\])/) || [])[1];
const KEYS = JSON.parse(keys).filter(k => A.SYS[k]);

let rnd = 12345; const R = () => (rnd = (rnd * 1103515245 + 12345) >>> 0) / 4294967296;
let fail = 0;
for (const [CW, CH] of [[1280, 720], [450, 800]]) {
  for (const k of KEYS) {
    A.setCur(k);
    const v = A.SYS[k].view, scale = Math.min(CW, CH) / (2 * v.span), dt = 1 / 60;
    const x0 = v.cx - CW / 2 / scale, x1 = v.cx + CW / 2 / scale, y0 = v.cy - CH / 2 / scale, y1 = v.cy + CH / 2 / scale;
    let maxNew = 0, maxOld = 0, bad = 0;
    for (let n = 0; n < 400; n++) {
      let x = x0 + R() * (x1 - x0), y = y0 + R() * (y1 - y0);
      if (A.SYS[k].positive) { x = Math.abs(x) + 0.02; y = Math.abs(y) + 0.02; }
      // the old step: one midpoint step of h = spd/10*0.016, capped to 0.7 CH px
      const f = A.fieldAt(x, y), m = Math.hypot(f[0], f[1]);
      if (isFinite(m) && m > 1e-4) maxOld = Math.max(maxOld, Math.min(m * 14 / 10 * 0.016 * scale, 0.7 * CH));
      for (let t = 0; t < 300; t++) {
        const q = A.stepAlong(x, y, A.SAVER_PX * dt / scale, A.DS_PX / scale);
        if (!q) break;
        if (!isFinite(q[0]) || !isFinite(q[1])) { bad++; break; }
        maxNew = Math.max(maxNew, Math.hypot(q[0] - x, q[1] - y) * scale);
        x = q[0]; y = q[1];
        if (x < x0 - 1 || x > x1 + 1 || y < y0 - 1 || y > y1 + 1) break;
      }
    }
    const ok = bad === 0 && maxNew <= A.SUB_MAX * A.DS_PX + 1e-6;
    if (!ok) fail++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${CW}x${CH} ${k.padEnd(8)} max jump: saver ${maxNew.toFixed(2)} px, old ${maxOld.toFixed(1)} px, non-finite ${bad}`);
  }
}
console.log(fail ? `${fail} FAILED` : 'all passed');
process.exit(fail ? 1 : 0);
