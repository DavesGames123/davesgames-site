// ============================================================================
//  FLAP  ·  split-flap text cells
// ----------------------------------------------------------------------------
//  A flap field is an element with a fixed number of <i> cells, one per
//  character. setFlap() writes new text. Each changed cell turns through
//  some random glyphs before it stops on its target, with a short delay per
//  column, like a Solari board. One timer runs all moving cells and stops
//  when no cell moves. With prefers-reduced-motion, cells change at once.
//
//  grep -n targets: export function setFlap | function tick | const GLYPHS
// ============================================================================

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const STEP_MS = 42;
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const moving = new Map();     // cell -> { target, left, delay }
let timer = 0;

function tick() {
  for (const [cell, m] of moving) {
    if (m.delay > 0) { m.delay--; continue; }
    if (m.left-- <= 0) {
      cell.textContent = m.target;
      moving.delete(cell);
    } else {
      cell.textContent = GLYPHS[(Math.random() * GLYPHS.length) | 0];
    }
    cell.classList.toggle('a');
    cell.classList.toggle('b');
  }
  if (!moving.size) { clearInterval(timer); timer = 0; }
}

function cells(el, len) {
  if (el.childElementCount !== len) {
    el.textContent = '';
    for (let i = 0; i < len; i++) {
      const c = document.createElement('i');
      c.className = 'a';
      c.textContent = ' ';
      el.appendChild(c);
    }
  }
  return el.children;
}

// Write text into the flap field el, padded or cut to len cells.
// animate=false sets the cells at once (first paint of a long list).
export function setFlap(el, text, len, animate = true) {
  const t = String(text ?? '').toUpperCase().slice(0, len).padEnd(len, ' ');
  if (el.dataset.flap === t && el.childElementCount === len) return;
  el.dataset.flap = t;
  el.setAttribute('aria-label', t.trim());
  const cs = cells(el, len);
  const still = !animate || reduce.matches || document.hidden;
  for (let i = 0; i < len; i++) {
    const ch = t[i] === ' ' ? ' ' : t[i];
    const c = cs[i];
    const cur = moving.get(c)?.target ?? c.textContent;
    if (cur === ch) continue;
    if (still) { moving.delete(c); c.textContent = ch; continue; }
    moving.set(c, { target: ch, left: 2 + ((Math.random() * 5) | 0), delay: (i * 0.6 + Math.random() * 2) | 0 });
  }
  if (moving.size && !timer) timer = setInterval(tick, STEP_MS);
}
