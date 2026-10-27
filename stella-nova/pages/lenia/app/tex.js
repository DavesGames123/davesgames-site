// ============================================================================
//  LENIA  ·  app/tex.js — the equation text of the rule
// ----------------------------------------------------------------------------
//  The TeX sources for the panel equations and the saver plate, the color
//  class of each symbol, and the plain text forms for the plate. No DOM.
//  The index of CORE_TEX and SAVER_CORE is kn - 1. The index of
//  GROWTH_SYM and SAVER_GROWTH is gn - 1.
//
//  GREP MAP
//    const RULES          symbol -> math color class
//    const GENERAL        the update rule
//    const CORE_TEX       the kernel core K_c(r), per kn
//    function growthTeX   G(u) with the live m and s values
//    const GROWTH_SYM     G(u) in symbol form, per gn (saver plate)
//    const SAVER_GROWTH   plain text G(u), per gn (saver plate)
//    const SAVER_CORE     plain text k(r), per kn (saver plate)
// ============================================================================

// One color per quantity, in the equations, the rule labels and the About
// text: the world A, the kernel K, the growth G, the time scale T, the
// growth center m and the growth width s. The live values of m and s in
// G(u) take the color of m and s.
export const RULES = [['A', 'm1'], ['K_c', 'm2'], ['K', 'm2'], ['G', 'm3'], ['T', 'm4'], ['m', 'm5'], ['s', 'm6']];
export const RULE_CLASS = Object.fromEntries(RULES);
export const GENERAL = String.raw`A^{t+\Delta t} = \Big[\,A^t + \tfrac{1}{T}\,G\big(K * A^t\big)\Big]_0^1`;
export const CORE_TEX = [
  String.raw`K_c(r) = \big(4r(1-r)\big)^4`,
  String.raw`K_c(r) = \exp\!\Big(4 - \tfrac{1}{r(1-r)}\Big)`,
  String.raw`K_c(r) = \mathbf{1}\big[\tfrac14 \le r \le \tfrac34\big]`,
  String.raw`K_c(r) = \mathbf{1}\big[\tfrac14 \le r \le \tfrac34\big] + \tfrac12\,\mathbf{1}\big[r < \tfrac14\big]`,
];
export function growthTeX(gn, m, s) {
  const M = `\\class{m5}{${m.toFixed(3)}}`, Sv = `\\class{m6}{${s.toFixed(4)}}`;
  if (gn === 1) return String.raw`G(u) = 2\Big(1 - \tfrac{(u-${M})^2}{9\cdot ${Sv}^2}\Big)_+^4 - 1`;
  if (gn === 3) return String.raw`G(u) = \pm 1,\ +1 \text{ if } |u-${M}| \le ${Sv}`;
  return String.raw`G(u) = 2\exp\!\Big(-\tfrac{(u-${M})^2}{2\cdot ${Sv}^2}\Big) - 1`;
}
// The saver plate holds the values of m and s in its own lines, so its
// growth line is the symbol form.
export const GROWTH_SYM = [String.raw`G(u) = 2\Big(1 - \tfrac{(u-m)^2}{9 s^2}\Big)_+^4 - 1`, String.raw`G(u) = 2\exp\!\Big(-\tfrac{(u-m)^2}{2 s^2}\Big) - 1`,
  String.raw`G(u) = \pm 1,\ +1 \text{ if } |u-m| \le s`];
// Plate text, index gn - 1 and kn - 1 (the order of growthTeX and CORE_TEX).
export const SAVER_GROWTH = ['G(u) = 2(1 − (u − m)²/9s²)₊⁴ − 1', 'G(u) = 2 exp(−(u − m)²/2s²) − 1', 'G(u) = +1 if |u − m| ≤ s, else −1'];
export const SAVER_CORE = ['k(r) = (4r(1 − r))⁴', 'k(r) = exp(4 − 1/(r(1 − r)))', 'k(r) = 1 if ¼ ≤ r ≤ ¾, else 0',
  'k(r) = 1 if ¼ ≤ r ≤ ¾, ½ if r < ¼, else 0'];
