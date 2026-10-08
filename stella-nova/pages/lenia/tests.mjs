// tests.mjs - node checks for pages/lenia that need no GPU and no browser.
//   node stella-nova/pages/lenia/tests.mjs
// The engine tests (WebGPU through Deno) are in tools/engine_test.js.
import { renderBudget, BUDGET } from './budget.js';

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };
const show = (name, o) => { const b = renderBudget(o); console.log(`      ${name}: dpr ${b.dpr.toFixed(2)}, ${(b.px / 1e6).toFixed(2)} M px, cubic from ${b.cubicMin} px`); return b; };

// Phone profile (touch, PHONE_Q). 16 reads per px in the cubic path.
const phones = [['360x640 @3', 360, 640, 3], ['390x844 @3', 390, 844, 3], ['844x390 @3', 844, 390, 3], ['1024x1366 @2 tablet', 1024, 1366, 2]];
for (const [n, w, h, d] of phones) {
  const s = show('phone saver ' + n, { dpr: d, cssW: w, cssH: h, saver: true, phone: true });
  check(s.dpr <= 1.5 && s.dpr >= 1, `phone saver ${n}: dpr in 1..1.5`);
  check(s.px <= Math.max(BUDGET.phone.saver.px, w * h) + 4 * (w + h), `phone saver ${n}: canvas within 1.2 M px (or 1 px per CSS px)`);
  check(s.cubicMin === 6, `phone saver ${n}: bilinear under 6 device px`);
  const p = show('phone page  ' + n, { dpr: d, cssW: w, cssH: h, saver: false, phone: true });
  check(p.dpr <= 2 && p.px <= Math.max(BUDGET.phone.page.px, w * h) + 4 * (w + h), `phone page ${n}: dpr <= 2 and within 2 M px`);
}
// A phone cell at zoom 1: page world short side 96 x detail 1.5 = 144 cells
// over 390 CSS px at dpr 2 is 5.4 device px: bilinear. A push-in at zoom 3 is cubic.
const cell = (cells, css, dpr, zoom) => css / cells * dpr * zoom;
check(cell(144, 390, 2, 1) < BUDGET.phone.cubicMin, 'phone page zoom 1 cell takes the bilinear path');
check(cell(256, 390, 1.5, 3) >= BUDGET.phone.cubicMin, 'phone saver push-in (zoom 3) cell takes the cubic path');

// Desktop profile: the e84c4cb behaviour stays.
const d1 = show('desk saver 1920x1080 @2', { dpr: 2, cssW: 1920, cssH: 1080, saver: true });
check(d1.dpr === 2 && d1.px <= 8.3e6, 'desk saver 1920x1080 @2: dpr 2 within 8.3 M px');
const d2 = show('desk saver 3008x1692 @2', { dpr: 2, cssW: 3008, cssH: 1692, saver: true });
check(d2.dpr < 2 && d2.px <= 8.3e6 + 1e4, 'desk saver 3008x1692 @2: held to 8.3 M px');
const d3 = show('desk page 1440x900 @2', { dpr: 2, cssW: 1440, cssH: 900 });
check(d3.dpr === 2 && d3.cubicMin === 3, 'desk page: dpr 2, cubic from 3 px');
check(renderBudget({ dpr: 1, cssW: 1280, cssH: 800, saver: true }).dpr === 1, 'desk saver @1: dpr 1');

console.log(fails ? `${fails} FAIL` : 'ALL PASS');
process.exit(fails ? 1 : 0);
