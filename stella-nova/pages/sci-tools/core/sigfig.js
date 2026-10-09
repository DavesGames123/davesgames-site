// ============================================================================
//  SCIENCE TOOLKIT  ·  core/sigfig.js  ·  significant figures and notation
// ----------------------------------------------------------------------------
//  count()   the significant figures written in a number (text), with the
//            range when trailing zeros of an integer are ambiguous ("1200").
//  round()   a number to n significant figures, as text that keeps the
//            trailing zeros ("2.50").
//  sci() and eng()   scientific and engineering notation, as parts.
//  roundUnc()  a value and its uncertainty rounded together. The PDG rule
//            (Particle Data Group, Review of Particle Physics, Introduction
//            section 5.3) reads the three leading digits of the
//            uncertainty: 100-354 keeps two significant figures, 355-949
//            keeps one, 950-999 rounds up to 1000 and keeps two. The value
//            is rounded to the same decimal place.
//
//  GREP MAP
//    grep -n "export function count"
//    grep -n "export function round"
//    grep -n "export function sci"
//    grep -n "export function eng"
//    grep -n "export function roundUnc"
// ============================================================================

export function count(text) {
  const t = String(text).trim().replace(/−/g, '-').replace(/\s*[×x]\s*10\^?\s*([-+]?\d+)/, 'e$1');
  const m = /^[-+]?(\d*)(\.?)(\d*)(?:e[-+]?\d+)?$/i.exec(t);
  if (!m || (m[1] + m[3]) === '') throw new Error(`"${text}" is not a number.`);
  const [, int, dot, frac] = m;
  const all = (int + frac).replace(/^0+/, '');
  if (all === '') {
    // A zero: the zeros after the point show the precision.
    const n = Math.max(1, frac.length);
    return { n, min: n, max: n, ambiguous: false, zero: true };
  }
  if (dot) return { n: all.length, min: all.length, max: all.length, ambiguous: false };
  const core = all.replace(/0+$/, '');
  return { n: core.length, min: core.length, max: all.length, ambiguous: core.length !== all.length };
}

// Round to n significant figures. Returns text with n significant digits.
export function round(x, n) {
  if (!Number.isFinite(x)) throw new Error('The value must be finite.');
  if (!(n >= 1 && n <= 21)) throw new Error('Significant figures must be from 1 to 21.');
  if (x === 0) return n > 1 ? '0.' + '0'.repeat(n - 1) : '0';
  const e = exponentOf(x, n);
  if (e >= 21 || e < -7) return x.toExponential(n - 1).replace('+', '');
  const dec = n - 1 - e;
  if (dec <= 0) return Number(x.toPrecision(n)).toFixed(0);
  return x.toFixed(dec);
}

// The decimal exponent of x after rounding to n figures (9.99 -> 1 at n=2).
function exponentOf(x, n) {
  const s = Math.abs(x).toExponential(n - 1);
  return Number(s.split('e')[1]);
}

// Scientific notation: { m: '6.022', e: 23 }.
export function sci(x, n) {
  if (x === 0) return { m: round(0, n), e: 0 };
  const [m, e] = x.toExponential(n - 1).split('e');
  return { m, e: Number(e) };
}

// Engineering notation: exponent a multiple of 3, mantissa 1 to 999.
export function eng(x, n) {
  if (x === 0) return { m: round(0, n), e: 0 };
  const e = exponentOf(x, n), e3 = Math.floor(e / 3) * 3;
  const mant = Number(x.toExponential(n - 1)) / 10 ** e3;
  const intDigits = e - e3 + 1;
  return { m: mant.toFixed(Math.max(0, n - intDigits)), e: e3 };
}

// Round a value and its uncertainty. rule: 'pdg' or a number of figures
// for the uncertainty (1 or 2). Returns text and the decimal place.
export function roundUnc(x, u, rule = 'pdg') {
  if (!(u > 0)) throw new Error('The uncertainty must be greater than 0.');
  let e = Math.floor(Math.log10(u));
  let lead = Math.round(u / 10 ** (e - 2));      // three leading digits
  if (lead >= 1000) { lead = Math.round(lead / 10); e += 1; }
  let figs;
  if (rule === 'pdg') {
    if (lead <= 354) figs = 2;
    else if (lead <= 949) figs = 1;
    else { figs = 2; e += 1; lead = 100; }
  } else figs = Number(rule);
  const place = e - figs + 1;                    // power of ten of the last kept digit
  const q = 10 ** place;
  const ur = rule === 'pdg' && lead === 100 && figs === 2 ? 10 ** e : Math.round(u / q) * q;
  const xr = Math.round(x / q) * q;
  const dec = Math.max(0, -place);
  const txt = (v) => (Math.abs(place) > 6 && place > 0) ? v.toExponential(0) : v.toFixed(dec);
  return { x: txt(xr), u: txt(ur), place, figs };
}
