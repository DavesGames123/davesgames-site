// ============================================================================
//  LOSE THE MODIFIER  ·  stage.js — the big type on #stage
// ----------------------------------------------------------------------------
//  The stage shows one entry. main.js calls show() for a static result
//  (what the user typed). cycle.js calls the step functions to play the
//  type-in, strike, backspace and type-out sequence one frame at a time.
//
//  #big  one line: the weak phrase (mono, .w, with the modifier in .m) or
//        the strong word (bold, .s), with a caret. fit() sets one font
//        size for both, so the line does not jump between the steps.
//  #eq   the formula: mod + base = strong (the modifier struck through).
//  #alts the strong options as buttons, then the tags.
//  #ex   the example sentence, with the first target in <b>.
//
//  grep -n targets
//    "function weakParts"  the weak phrase as text + the modifier range
//    "function fit"        the font size of #big
//    "function show"       a static result
//    "function weak("      the first n letters of the weak phrase
//    "function strong("    the first n letters of the strong word
//    "function eqStep"     the formula, one part at a time
// ============================================================================
import { FAMILIES } from './phrases.js';

const FAM = new Map(FAMILIES.map(f => [f.id, f]));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const famLabel = id => (FAM.get(id) || {}).label || id;

// The weak phrase as one string, and the [a, b) range of the part that goes
// (the modifier, the adverb, or the whole stock phrase).
export function weakParts(e) {
  if (!e.base) return { text: e.phrase, a: 0, b: e.phrase.length };
  if (e.modFirst) return { text: e.mod + ' ' + e.base, a: 0, b: e.mod.length };
  return { text: e.base + ' ' + e.mod, a: e.base.length + 1, b: e.base.length + 1 + e.mod.length };
}

let measureCtx = null;
function widthAt100(text, font) {
  measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
  measureCtx.font = `${font} 100px ${font.startsWith('700') ? "'Space Grotesk'" : "'IBM Plex Mono'"}, sans-serif`;
  return measureCtx.measureText(text).width;
}

export function createStage(els) {
  const { big, eq, alts, ex, fam } = els;
  let size = 96;
  const api = {
    // One size for the weak phrase and the longest strong word.
    fit(e, words = e.targets.slice(0, 1), withWeak = true) {
      const avail = Math.max(200, big.clientWidth || innerWidth - 32) * 0.94;
      const wW = withWeak ? widthAt100(weakParts(e).text, '500') : 0;
      const wS = Math.max(...words.map(w => widthAt100(w, '700')));
      const maxPx = Math.min(innerWidth < 640 ? 112 : 150, Math.max(46, innerHeight * 0.16));
      size = Math.max(26, Math.min(maxPx, avail / Math.max(wW, wS) * 100));
      big.style.fontSize = size.toFixed(1) + 'px';
      big.style.whiteSpace = avail / Math.max(wW, wS) * 100 < 26 ? 'normal' : 'pre';
      return size;
    },
    famTag(e, how) {
      const lead = how === 'reverse' ? 'replaces' : how === 'alias' ? 'same as' : how === 'typo' ? 'did you mean' : '';
      fam.innerHTML = (lead ? esc(lead) + ' · ' : '') + '<b>' + esc(famLabel(e.family)) + '</b> · ' + esc(e.pos) + ' · ' + esc(e.reg);
    },
    // n letters of the weak phrase; cut: strike the modifier; sel: select it.
    weak(e, n, { cut = false, sel = false, caret = true } = {}) {
      const p = weakParts(e), t = p.text.slice(0, n);
      const pre = t.slice(0, p.a), mid = t.slice(p.a, p.b), post = t.slice(p.b);
      big.innerHTML = '<span class="w">' + esc(pre) + (mid ? `<span class="m${cut ? ' cut' : ''}${sel ? ' sel' : ''}">${esc(mid)}</span>` : '') + esc(post) + '</span>' + (caret ? '<span class="caret solid"></span>' : '');
    },
    strong(word, n = word.length, { caret = true, blink = false, pop = false } = {}) {
      big.innerHTML = `<span class="s${pop ? ' pop' : ''}" data-word="${esc(word)}">${esc(word.slice(0, n))}</span>` + (caret ? `<span class="caret${blink ? '' : ' solid'}"></span>` : '');
    },
    none(q) {
      big.style.fontSize = Math.min(size, 64) + 'px';
      big.innerHTML = `<span class="none">no match for “${esc(q)}” yet</span>`;
      eq.innerHTML = ''; alts.innerHTML = ''; ex.innerHTML = ''; fam.textContent = '';
    },
    // The formula, one part at a time: 0 nothing, 1 the weak parts, 2 all.
    eqStep(e, step, word = e.targets[0]) {
      if (step === 0) { eq.innerHTML = ''; return; }
      const m = `<span class="m${step === 1 ? ' in' : ''}">${esc(e.mod)}</span>`, b = `<span class="b${step === 1 ? ' in' : ''}">${esc(e.base)}</span>`;
      const op = `<span class="op${step === 1 ? ' in' : ''}">+</span>`;
      const left = !e.base ? m : e.modFirst ? m + op + b : b + op + m;
      eq.innerHTML = left + (step >= 2 ? `<span class="op in">=</span><span class="s in">${esc(word)}</span>` : '');
    },
    alts(e, cur, onPick) {
      alts.innerHTML = e.targets.map((t, i) => `<button data-i="${i}" class="${t === cur ? 'on' : ''}" aria-label="Copy ${esc(t)}">${esc(t)}</button>`).join('');
      if (onPick) alts.querySelectorAll('button').forEach(b => b.onclick = () => onPick(e.targets[+b.dataset.i]));
    },
    ex(e) {
      const t = e.targets[0], re = new RegExp(`(^|[^A-Za-z'-])(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=$|[^A-Za-z'-])`, 'i');
      ex.innerHTML = esc(e.ex).replace(re, (m, a, w) => a + '<b>' + w + '</b>');
    },
    clearInfo() { alts.innerHTML = ''; ex.innerHTML = ''; },
    // A static result: the strong word pops in, all info at once.
    show(e, { word = e.targets[0], how = '', onPick } = {}) {
      api.fit(e, [word], false);
      api.famTag(e, how);
      api.strong(word, word.length, { caret: false, pop: true });
      api.eqStep(e, 2, word);
      api.alts(e, word, onPick);
      api.ex(e);
    },
    get size() { return size; },
  };
  return api;
}
