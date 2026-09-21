// ============================================================================
//  RANDOMA11Y  ·  main.js — the UI, the roll loop and the reference panel
// ────────────────────────────────────────────────────────────────────────────
//  Import the pair math from contrast.js. Hold the current pair and the gate in
//  a small state object. render() paints the preview and the two metric cards.
//  generate() rolls until the gate passes, then renders. The reference panel
//  prints the source of the running functions, so the shown code is the code.
// ============================================================================
import {
  hexToRgb, srgbToLinear, relLuminance, wcagRatio, apcaLc,
  randomHex, generatePair, THRESHOLDS,
} from './contrast.js';

const $ = (id) => document.getElementById(id);

const state = {
  fg: '#e8ecf4',
  bg: '#0e1118',
  gate: 'wcag-aa',
  lockFg: false,
  lockBg: false,
  tries: 1,
};

// ---------------------------------------------------------- metric helpers
const setBadge = (id, pass) => {
  const el = $('b-' + id).closest('.badge');
  el.classList.toggle('pass', pass);
  el.classList.toggle('fail', !pass);
  $('b-' + id).textContent = pass ? '✓' : '✗';
};

// the APCA use band for the size of Lc
const apcaBand = (lc) => {
  const a = Math.abs(lc);
  if (a >= 90) return 'Lc ≥ 90 · any text, any size';
  if (a >= 75) return 'Lc 75–90 · body text';
  if (a >= 60) return 'Lc 60–75 · large or bold body text';
  if (a >= 45) return 'Lc 45–60 · large headings, non-text';
  if (a >= 30) return 'Lc 30–45 · large display only';
  return 'Lc < 30 · fails for text';
};

// ---------------------------------------------------------- render
function render() {
  document.documentElement.style.setProperty('--pv-bg', state.bg);
  document.documentElement.style.setProperty('--pv-fg', state.fg);
  $('hex-bg').textContent = state.bg;
  $('hex-fg').textContent = state.fg;

  const fg = hexToRgb(state.fg), bg = hexToRgb(state.bg);

  const ratio = wcagRatio(fg, bg);
  $('wcag-ratio').textContent = ratio.toFixed(2) + ':1';
  $('wcag-note').textContent = 'max 21';
  setBadge('aa', ratio >= 4.5);
  setBadge('aaa', ratio >= 7);
  setBadge('aal', ratio >= 3);
  setBadge('aaal', ratio >= 4.5);

  const lc = apcaLc(fg, bg);
  const r = Math.round(lc);
  $('apca-lc').textContent = (r > 0 ? '+' : '') + r;
  $('apca-pol').textContent = lc > 0 ? 'dark on light' : lc < 0 ? 'light on dark' : 'no polarity';
  $('apca-band').textContent = apcaBand(lc);

  $('tries').textContent = state.tries + (state.tries === 1 ? ' try' : ' tries');
}

// ---------------------------------------------------------- generate
function generate() {
  const gate = THRESHOLDS[state.gate].test;
  const res = generatePair(gate, {
    fixedFg: state.lockFg ? state.fg : null,
    fixedBg: state.lockBg ? state.bg : null,
  });
  if (!res) {
    $('tries').textContent = 'no pair in 10000 tries';
    return;
  }
  state.fg = res.fg;
  state.bg = res.bg;
  state.tries = res.tries;
  render();
}

// ---------------------------------------------------------- controls
$('gen').addEventListener('click', generate);
$('threshold').addEventListener('change', (e) => { state.gate = e.target.value; generate(); });
$('swap').addEventListener('click', () => { [state.fg, state.bg] = [state.bg, state.fg]; render(); });

const toggleLock = (key, id) => {
  state[key] = !state[key];
  const b = $(id);
  b.setAttribute('aria-pressed', String(state[key]));
};
$('lock-bg').addEventListener('click', () => toggleLock('lockBg', 'lock-bg'));
$('lock-fg').addEventListener('click', () => toggleLock('lockFg', 'lock-fg'));

const flash = (btn, msg) => {
  const old = btn.textContent;
  btn.textContent = msg;
  setTimeout(() => { btn.textContent = old; }, 1100);
};
$('copy').addEventListener('click', (e) => {
  navigator.clipboard.writeText(`${state.fg} on ${state.bg}`)
    .then(() => flash(e.currentTarget, 'Copied'))
    .catch(() => flash(e.currentTarget, 'Copy failed'));
});

// space rolls a new pair, unless a control has focus
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space') return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'select' || tag === 'input' || tag === 'button' || tag === 'textarea') return;
  e.preventDefault();
  generate();
});

// ---------------------------------------------------------- reference panel
const join = (...fns) => fns.map((f) => f.toString()).join('\n\n');
$('src-loop').textContent = join(randomHex, generatePair);
$('src-wcag').textContent = join(srgbToLinear, relLuminance, wcagRatio);
$('src-apca').textContent = apcaLc.toString();
document.querySelectorAll('.ref-copy').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    const pre = $('src-' + btn.dataset.src);
    navigator.clipboard.writeText(pre.textContent)
      .then(() => flash(e.currentTarget, 'Copied'))
      .catch(() => flash(e.currentTarget, 'Copy failed'));
  });
});

// ---------------------------------------------------------- boot
generate();
