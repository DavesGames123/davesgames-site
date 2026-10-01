// ============================================================================
//  MATERIAL STUDIO  ·  mobile.js — phone dock and bottom sheet   [STUB]
// ────────────────────────────────────────────────────────────────────────────
//  Owner: PANELS agent. body[data-sheet] names the open sheet panel
//  (graph | lib | inspector | env | export | maps); style.css shows it.
//  The stub only toggles the sheet from the dock.
// ============================================================================

/** @param {object} ctx main.js module context */
export async function init(ctx) {
  const dock = ctx.$('dock');
  const setSheet = name => {
    document.body.dataset.sheet = name || '';
    for (const b of dock.querySelectorAll('button')) b.classList.toggle('on', b.dataset.sheet === name);
    if (['inspector', 'env', 'export'].includes(name)) document.body.dataset.side = name;
    window.dispatchEvent(new Event('resize'));
  };
  dock.addEventListener('click', e => {
    const b = e.target.closest('button[data-sheet]');
    if (b) setSheet(document.body.dataset.sheet === b.dataset.sheet ? '' : b.dataset.sheet);
  });
  ctx.$('sheet-grip').addEventListener('click', () => setSheet(''));
}
