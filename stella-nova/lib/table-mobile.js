// ============================================================================
//  TABLE MOBILE  ·  shared phone and touch layer for the Stella Nova tables
// ────────────────────────────────────────────────────────────────────────────
//  The table pages were built for a mouse and a wide screen. This module makes
//  them work on a phone. It loads table-mobile.css after the page style.css,
//  so the shared rules override the page rules. table-engine.js, noise-table
//  and presence-orbs import it; a page needs no other change.
//
//  WHAT CHANGES ON A PHONE
//      columns ...... 3 below 480 px of stage, 4 below 700 px, else the spec
//      controls ..... the sidebar becomes a bottom sheet behind a button
//      autoplay ..... touch has no hover, so the row under the playhead line
//                     animates. The line moves from the top of the stage to
//                     the bottom as the stage scrolls, so every row can reach it
//      pixels ....... the canvas pixel ratio stops at 2 on touch devices
//
//  EXPORTS  (grep the name to find it)
//      TOUCH ............ true when the primary pointer cannot hover
//      HOVER_LABEL ...... chip text for the hover-only animation mode
//      colsFor(w, cols) . column count for a stage content width
//      fitTable(stage, cols) . write --cols and --cell for the stage width
//      playhead(stage) .. client Y of the autoplay line
//      maxDpr() ......... the device-pixel-ratio cap
//      initMobile() ..... name tags, controls drawer, chip text
// ============================================================================
if (!document.querySelector('link[data-table-mobile]')) {
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = new URL('./table-mobile.css', import.meta.url).href; l.dataset.tableMobile = '';
  document.head.appendChild(l);
}

export const TOUCH = matchMedia('(hover: none)').matches;
export const HOVER_LABEL = TOUCH ? '◉ animate the row in focus' : '◉ animate on hover only';

export function colsFor(w, cols) {
  if (w < 480) return Math.min(cols, 3);
  if (w < 700) return Math.min(cols, 4);
  return cols;
}

// the stage keeps 12 px of padding on each side, so the content width is clientWidth - 24
export function fitTable(stage, cols) {
  const w = stage.clientWidth - 24, n = colsFor(w, cols), s = document.documentElement.style;
  s.setProperty('--cols', n); s.setProperty('--cell', Math.max(40, Math.floor(w / n)) + 'px');
}

// The line crosses the padded content box of the stage: 10 % down at the top
// of the scroll, 90 % down at the end, the middle when nothing scrolls. The
// bottom padding holds the Controls button, so the line must stay above it.
export function playhead(stage) {
  const r = stage.getBoundingClientRect(), cs = getComputedStyle(stage);
  const top = r.top + parseFloat(cs.paddingTop), h = r.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const span = stage.scrollHeight - stage.clientHeight;
  const p = span > 1 ? Math.min(1, Math.max(0, stage.scrollTop / span)) : 0.5;
  return top + h * (0.10 + 0.80 * p);
}

export const maxDpr = () => TOUCH ? 2 : 3;

export function initMobile() {
  // a phone has no hover, so every cell shows its name; add a tag where a page has none
  for (const el of document.querySelectorAll('.cell[id^="tile-"]')) {
    if (el.querySelector('.tag')) continue;
    const s = document.createElement('span'); s.className = 'tag'; s.textContent = el.id.slice(5).replace(/_/g, ' '); el.appendChild(s);
  }
  const chip = document.getElementById('hoveronly');
  if (chip && chip.classList.contains('on')) chip.textContent = HOVER_LABEL;
  const side = document.getElementById('side');
  if (!side) return;
  const fab = document.createElement('button'); fab.type = 'button'; fab.className = 'tm-fab'; fab.textContent = 'Controls';
  fab.setAttribute('aria-controls', 'side'); fab.setAttribute('aria-expanded', 'false');
  const scrim = document.createElement('div'); scrim.className = 'tm-scrim';
  const grab = document.createElement('button'); grab.type = 'button'; grab.className = 'tm-grab'; grab.setAttribute('aria-label', 'Close controls');
  side.prepend(grab); document.body.append(scrim, fab);
  const set = open => { document.body.classList.toggle('tm-side-open', open); fab.setAttribute('aria-expanded', String(open)); };
  fab.addEventListener('click', () => set(!document.body.classList.contains('tm-side-open')));
  scrim.addEventListener('click', () => set(false)); grab.addEventListener('click', () => set(false));
  addEventListener('keydown', e => { if (e.key === 'Escape') set(false); });
}
