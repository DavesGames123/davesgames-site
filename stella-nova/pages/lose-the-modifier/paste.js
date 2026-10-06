// ============================================================================
//  LOSE THE MODIFIER  ·  paste.js — the "Paste text" view
// ----------------------------------------------------------------------------
//  The user pastes a paragraph into #src. scan() (matcher.js) finds every
//  weak phrase it knows, and #marked shows the text with a <mark> on each.
//  A tap (or a mouse hover) on a mark opens #tip: the strong options as
//  buttons; a button puts that word in the text. A stem-only mark (a verb
//  in another tense) is dotted and only shows the options.
//  "Fix all" shows #fixed: fixText() with the new words in <ins>, and
//  buttons to copy it or to put it back in #src.
//
//  grep -n targets
//    "function render"     scan and draw the marks
//    "function openTip"    the options for one mark
//    "function applyOne"   put one option in the text
//    "function preview"    the fix-all preview
//    "const SAMPLE"        the sample paragraph
// ============================================================================
import { PHRASES } from './phrases.js';
import { buildScan, scan, fixText, matchCase } from './matcher.js';
import { famLabel } from './stage.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Written for this page: a padded paragraph with many weak phrases.
const SAMPLE = `It was a very cold morning, and the harbor was really quiet. Due to the fact that the ferry was late, a lot of people waited on the pier. A little girl looked at the gulls carefully while her father walked slowly along the rail. In order to stay warm, they drank very hot tea. When the ferry finally came, it was very big and extremely loud, and everyone was so happy to board.`;

export function initPaste({ root, copyWord, toast }) {
  root.innerHTML = `
    <section class="paste">
      <div class="phead">
        <h2>Paste your text</h2>
        <p>Every weak phrase the page knows gets a mark. Tap a mark for the options.</p>
      </div>
      <textarea id="src" rows="6" placeholder="Paste or type a paragraph here." aria-label="Your text" spellcheck="false"></textarea>
      <div class="pbar">
        <span id="pcount" class="pcount"></span>
        <button id="sampleBtn" class="act">Sample</button>
        <button id="clearSrc" class="act">Clear</button>
        <button id="fixBtn" class="act hi">Fix all</button>
      </div>
      <div id="marked" class="marked" aria-live="polite"></div>
      <div id="fixedBox" class="fixedbox" hidden>
        <div class="fhead"><h3>Fixed</h3>
          <button id="copyFixed" class="act">Copy</button>
          <button id="useFixed" class="act">Use this text</button></div>
        <div id="fixed" class="fixed"></div>
      </div>
      <div id="tip" class="tip" role="dialog" aria-label="Options" hidden></div>
    </section>`;
  const $ = id => root.querySelector('#' + id);
  const src = $('src'), marked = $('marked'), tip = $('tip');
  const idx = buildScan(PHRASES);
  let spans = [], tipFor = -1, hoverT = 0;

  function render() {
    const text = src.value;
    spans = scan(text, idx);
    let html = '', at = 0;
    spans.forEach((s, i) => {
      html += esc(text.slice(at, s.start)) + `<mark data-i="${i}" class="${s.fixable ? '' : 'loose'}" tabindex="0">${esc(s.text)}</mark>`;
      at = s.end;
    });
    html += esc(text.slice(at));
    marked.innerHTML = text.trim() ? html : '<span class="empty">Your text shows here with the weak phrases marked.</span>';
    const n = spans.length, f = spans.filter(s => s.fixable).length;
    $('pcount').textContent = text.trim() ? (n ? `${n} weak phrase${n > 1 ? 's' : ''}` + (f < n ? ` · ${n - f} to fix by hand` : '') : 'no weak phrases found') : '';
    $('fixBtn').disabled = !f;
    closeTip();
    if (!$('fixedBox').hidden) preview();
  }

  function openTip(i, anchor) {
    const s = spans[i]; if (!s) return;
    tipFor = i;
    const e = s.entry;
    tip.innerHTML = `<div class="th"><span class="tw">${esc(s.text)}</span><span class="tf">${esc(famLabel(e.family))} · ${esc(e.pos)}${s.alias ? ' · same as ' + esc(e.phrase) : ''}</span></div>` +
      `<div class="to">${e.targets.map((t, k) => `<button data-k="${k}"${s.fixable ? '' : ' disabled'}>${esc(matchCase(s.text, t))}</button>`).join('')}</div>` +
      (s.fixable ? '' : `<p class="tn">The verb here is in another tense: change it by hand, for example to “${esc(e.targets[0])}” in the same tense.</p>`) +
      `<p class="tx">${esc(e.ex)}</p>`;
    tip.hidden = false;
    const r = anchor.getBoundingClientRect(), pr = root.getBoundingClientRect();
    const w = Math.min(340, pr.width - 16);
    tip.style.width = w + 'px';
    let x = r.left - pr.left + r.width / 2 - w / 2;
    x = Math.max(8, Math.min(pr.width - w - 8, x));
    tip.style.left = x + 'px';
    tip.style.top = (r.bottom - pr.top + 8) + 'px';
    marked.querySelectorAll('mark').forEach(m => m.classList.toggle('on', +m.dataset.i === i));
  }
  function closeTip() { tip.hidden = true; tipFor = -1; marked.querySelectorAll('mark.on').forEach(m => m.classList.remove('on')); }

  function applyOne(i, k) {
    const s = spans[i]; if (!s || !s.fixable) return;
    const one = fixText(src.value, [s], () => s.entry.targets[k]);
    src.value = one.text;
    toast(`${s.text} → ${matchCase(s.text, s.entry.targets[k])}`);
    render();
  }

  function preview() {
    const r = fixText(src.value, spans);
    $('fixed').innerHTML = r.parts.map(p => p.fix ? `<ins title="was: ${esc(p.from)}">${esc(p.t)}</ins>` : esc(p.t)).join('');
    $('fixedBox').hidden = false;
    return r;
  }

  let inT = 0;
  src.addEventListener('input', () => { clearTimeout(inT); inT = setTimeout(render, 120); });
  marked.addEventListener('click', ev => {
    const m = ev.target.closest('mark'); if (!m) { closeTip(); return; }
    const i = +m.dataset.i;
    if (tipFor === i && ev.pointerType !== 'mouse') closeTip(); else openTip(i, m);
  });
  marked.addEventListener('keydown', ev => { const m = ev.target.closest('mark'); if (m && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); openTip(+m.dataset.i, m); } });
  marked.addEventListener('pointerover', ev => {
    if (ev.pointerType !== 'mouse') return;
    const m = ev.target.closest('mark'); if (!m) return;
    clearTimeout(hoverT); openTip(+m.dataset.i, m);
  });
  marked.addEventListener('pointerout', ev => { if (ev.pointerType === 'mouse' && ev.target.closest('mark')) { clearTimeout(hoverT); hoverT = setTimeout(() => { if (!tip.matches(':hover')) closeTip(); }, 350); } });
  tip.addEventListener('pointerleave', ev => { if (ev.pointerType === 'mouse') { hoverT = setTimeout(closeTip, 300); } });
  tip.addEventListener('pointerenter', () => clearTimeout(hoverT));
  tip.addEventListener('click', ev => { const b = ev.target.closest('button[data-k]'); if (b) applyOne(tipFor, +b.dataset.k); });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeTip(); });

  $('sampleBtn').onclick = () => { src.value = SAMPLE; render(); };
  $('clearSrc').onclick = () => { src.value = ''; $('fixedBox').hidden = true; render(); src.focus(); };
  $('fixBtn').onclick = () => { const r = preview(); toast(`${r.count} fixed in the preview`); $('fixedBox').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };
  $('copyFixed').onclick = () => copyWord(fixText(src.value, spans).text, 'Copied the fixed text');
  $('useFixed').onclick = () => { src.value = fixText(src.value, spans).text; $('fixedBox').hidden = true; render(); };

  src.value = SAMPLE;
  render();
  return { render, preview, get spans() { return spans; } };
}
