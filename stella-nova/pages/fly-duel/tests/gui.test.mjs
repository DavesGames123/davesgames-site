// ============================================================================
//  FLY DUEL  ·  GUI design checks  (node tests/gui.test.mjs)
// ----------------------------------------------------------------------------
//  The GUI agent owns this file. It holds the node and grep checks of the
//  DESIGN.md checklist (section 8). No browser: the user does not allow
//  headless Chrome. Each block names its checklist item.
//
//  GREP MAP   (grep -n "^// ---" tests/gui.test.mjs)
//  Exit code 1 on any failure.
// ============================================================================
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');
let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };

const css = read('style.css');
const html = read('index.html');
const uiFiles = readdirSync(join(ROOT, 'ui')).filter(f => f.endsWith('.js')).map(f => `ui/${f}`);
const { TOKENS } = await import('../ui/tokens.js');

// Colour helpers: '#rrggbb' -> sRGB, WCAG contrast, CIELAB, ΔE76.
const hex = h => [0, 2, 4].map(i => parseInt(h.slice(1 + i, 3 + i), 16) / 255);
const lin = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const lum = h => { const [r, g, b] = hex(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
function lab(h) {
  const [r, g, b] = hex(h).map(lin);
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, Y = 0.2126 * r + 0.7152 * g + 0.0722 * b, Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = t => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
const dE = (a, b) => { const p = lab(a), q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };

// --------------------------------------------------------------- 1 tokens
{
  const root = css.slice(css.indexOf(':root{'), css.indexOf('}', css.indexOf(':root{')));
  const cssTok = Object.fromEntries([...root.matchAll(/--([\w-]+):([^;]+);/g)].map(m => [m[1], m[2].trim()]));
  for (const [k, v] of Object.entries(TOKENS)) ok(cssTok[k] === v, `tokens: --${k} in style.css is ${cssTok[k]}, ui/tokens.js says ${v}`);
  ok(contrast(TOKENS.ink2, TOKENS.panel) >= 4.5, `tokens: --ink2 on --panel ${contrast(TOKENS.ink2, TOKENS.panel).toFixed(1)} >= 4.5`);
  ok(contrast(TOKENS.dim, TOKENS.panel) >= 4.5, `tokens: --dim on --panel ${contrast(TOKENS.dim, TOKENS.panel).toFixed(1)} >= 4.5`);
  for (const k of ['flyA', 'flyB']) ok(contrast(TOKENS[k], TOKENS.fig) >= 3, `tokens: --${k} on --fig ${contrast(TOKENS[k], TOKENS.fig).toFixed(1)} >= 3`);
  const keys = ['flyA', 'flyB', 'amber', 'moss', 'pn', 'app', 'avoid', 'kc-on'];
  let low = [99, ''];
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const d = dE(TOKENS[keys[i]], TOKENS[keys[j]]);
    if (d < low[0]) low = [d, `${keys[i]}/${keys[j]}`];
    ok(d >= 35, `tokens: ΔE76 ${keys[i]}/${keys[j]} = ${d.toFixed(1)} >= 35`);
  }
  console.log(`  tokens: lowest ΔE76 ${low[0].toFixed(1)} (${low[1]})`);
  const { COL } = await import('../ui/brain.js');
  const { SERIES_COL } = await import('../ui/charts.js');
  const { PALETTE } = await import('../ui/art.js');
  const toHex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
  ok(toHex(COL.pn) === TOKENS.pn && toHex(COL.on) === TOKENS['kc-on'] && toHex(COL.app) === TOKENS.app && toHex(COL.avoid) === TOKENS.avoid, 'tokens: ui/brain.js COL uses the tokens');
  ok(SERIES_COL[0] === TOKENS.flyA && SERIES_COL[1] === TOKENS.flyB, 'tokens: ui/charts.js SERIES_COL starts Fly A, Fly B');
  ok(PALETTE.amber.ink === TOKENS.amber && PALETTE.moss.ink === TOKENS.moss && PALETTE.none.ink === TOKENS.none, 'tokens: ui/art.js PALETTE ink uses the card tokens');
  // No old value of the pre-design palette is left in the page code.
  const old = /#62c4ff|#86dc7c|#ff6a6a|#fffae1|acc-bg|acc-line/i;
  const src = ['style.css', 'main.js', 'saver.js', 'index.html', ...uiFiles].filter(p => p !== 'ui/tokens.js');
  for (const p of src) ok(!old.test(read(p)), `tokens: ${p} has no old palette value (${(read(p).match(old) || [])[0]})`);
}

// --------------------------------------------------------------- 2 crisp
// No blur, glow, text shadow or radial gradient. A box-shadow is a hard
// ring only (no blur radius). One linear sky gradient per card art.
{
  const files = ['style.css', 'main.js', ...uiFiles];
  for (const p of files) {
    const s = read(p);
    const m = s.match(/shadowBlur|blur\(|text-shadow|radial-gradient|radialGradient|createRadialGradient/);
    ok(!m, `crisp: ${p} has no blur or glow (${m && m[0]})`);
    const bs = s.match(/box-shadow:[^;}]*[0-9]px [0-9]+px [1-9]/);
    ok(!bs, `crisp: ${p} box-shadow has no blur radius (${bs && bs[0]})`);
  }
  ok(!/filter:\s*(saturate|blur|drop-shadow)/.test(css), 'crisp: no CSS filter on cards');
  const { cardArt } = await import('../ui/art.js');
  const a = cardArt({ id: 'x', colour: 'amber', type: 'creature', keywords: ['wings'] });
  ok((a.match(/Gradient /g) || []).length === 1 && /linearGradient/.test(a), 'crisp: card art has one linear sky gradient');
}

console.log(`gui.test: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
