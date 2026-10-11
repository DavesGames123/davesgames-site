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

// --------------------------------------------------------------- 3 fonts
// No Playfair, Cormorant or JetBrains anywhere in the page code (the
// spec files DESIGN.md and this test name them, so they are left out).
// style.css takes its stacks only from the sci.css variables, and the
// canvases take theirs from ui/tokens.js.
{
  const banned = /playfair|cormorant|jetbrains/i;
  const code = ['style.css', 'index.html', 'main.js', 'saver.js', ...uiFiles];
  for (const p of code) ok(!banned.test(read(p)), `fonts: ${p} names no banned font`);
  const decl = [...css.matchAll(/font(?:-family)?:([^;}]*)/g)].map(m => m[1]);
  const bad = decl.filter(d => !/var\(--(sans|serif|mono)\)|^inherit$/.test(d.trim()));
  ok(bad.length === 0, `fonts: every style.css font uses var(--sans|serif|mono) (${bad.slice(0, 3)})`);
  ok(/--serif:var\(--sci-serif\); --sans:var\(--sci-sans\); --mono:var\(--sci-mono\);/.test(css), 'fonts: the page stacks point at the sci.css stacks');
  ok(/\.\.\/\.\.\/lib\/sci\.css/.test(html), 'fonts: index.html loads ../../lib/sci.css');
  for (const p of uiFiles.filter(f => f !== 'ui/tokens.js')) ok(!/system-ui,sans-serif/.test(read(p)), `fonts: ${p} canvas text uses the tokens font stacks`);
}

// --------------------------------------------------------------- 4 hero beat
// ui/motion.js: the steps of one beat are in order and inside the beat,
// reduced motion gives no tween and a beat of at least 1800 ms, and the
// focus goes to the actor of the record.
{
  const M = await import('../ui/motion.js');
  const keys = ['beat', 'think', 'draw', 'cast', 'tap', 'arrow', 'dmgRise', 'lifeFlash', 'burst', 'zoom', 'sheet'];
  ok(keys.every(k => Number.isFinite(M.MOTION[k])), 'motion: MOTION has every DESIGN.md 1.4 key');
  ok(M.EASE === 'cubic-bezier(0.2,0,0,1)', 'motion: one easing');
  ok(M.beatMs(0.5) === 1800 && M.beatMs(1) === 900 && M.beatMs(3) === 300, 'motion: beat 1800 / 900 / 300 by speed');
  for (const [speed, reduced] of [[0.5, false], [1, false], [3, false], [1, true], [3, true]]) for (const rec of [{ who: 0, delta: 0.4 }, { who: 1, delta: -0.05 }, { who: 1, delta: 0.001 }, { who: 0 }]) {
    const p = M.beatPlan(rec, speed, reduced);
    const tag = `speed ${speed}${reduced ? ' reduced' : ''} who ${rec.who} δ ${rec.delta}`;
    ok(p.who === rec.who, `motion: focus is rec.who (${tag})`);
    ok(p.steps.every((s, i) => i === 0 || s.at >= p.steps[i - 1].at), `motion: steps in order (${tag})`);
    ok(p.steps.every(s => s.at >= 0 && s.at + s.dur <= p.beat), `motion: steps inside the beat (${tag})`);
    const order = p.steps.map(s => s.key).filter(k => k !== 'burst').join(' ');
    ok(order === 'focus pn kc mbon decide table', `motion: step order ${order}`);
    ok(p.steps.some(s => s.key === 'burst') === (rec.delta != null && Math.abs(rec.delta) > M.BURST_MIN), `motion: burst only above |δ| ${M.BURST_MIN} (${tag})`);
    if (reduced) ok(p.steps.every(s => s.dur === 0) && p.beat >= 1800, `motion: reduced is all cuts, beat >= 1800 (${tag})`);
    const tab = p.steps.find(s => s.key === 'table');
    ok(Math.abs(tab.at / p.beat - 0.55) < 0.01, `motion: the table plays at 0.55 of the beat (${tag})`);
  }
  const r = M.motionFor(true);
  ok(Object.entries(r).every(([k, v]) => ['beat', 'think', 'dmgHold', 'burst', 'endHold', 'reduced'].includes(k) || v === 0), 'motion: reduced sets every tween key to 0');
  ok(r.endHold === 4000 && M.motionFor(false).endHold === 2500, 'motion: end hold 2.5 s, 4 s reduced');
  // The page wires the beat: main.js uses beatPlan, the panes and captions exist.
  const js = read('main.js');
  ok(/beatPlan\(rec, hero\.speed, REDUCED\)/.test(js), 'motion: main.js runs the hero on beatPlan');
  for (const id of ['heroPaneA', 'heroPaneB', 'heroCapA', 'heroCapB']) ok(html.includes(`id="${id}"`), `motion: index.html has #${id}`);
  ok(/\.arena-brain\.waiting \.fig\.brain\{opacity:0\.5\}/.test(css), 'motion: the waiting brain is at 0.5 opacity');
}

console.log(`gui.test: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
