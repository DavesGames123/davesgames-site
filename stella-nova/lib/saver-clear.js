// ============================================================================
//  SAVER CLEAR BAND  ·  where a page subject can sit clear of the label plate
// ----------------------------------------------------------------------------
//  The shell label plate (#sn-saver-label in lib/screensaver.js) covers a
//  band at the top (category, title, sub, logo) and a band at the bottom
//  (equations, values, notes). A page in the shell iframe calls
//  plateBand() to get the clear middle band in its own CSS px, so it can
//  centre and size its subject there.
//
//  plateBand(h) -> { t, b, w } or null
//      t   the bottom of the top text, plus a margin (px from the top)
//      b   the top of the bottom text, plus a margin (px from the bottom)
//      w   the plate width: the visible column (100vw, or the 9:16 column)
//      The band h - t - b is 30% of h or more (see bandFloor).
//  null: no shell, no plate on, or no text yet.
//
//  bandFloor(t, b, h, min = 0.3) -> { t, b }   the floor, a pure function
//  (node test: tools/saver-plate-check.mjs).
//  The boxes are the text and logo boxes, not the plate boxes: the plate
//  boxes span the full width and height of their flex column.
//
//  The same walk is in pages/human-skeleton/main.js "function plateClear",
//  which also returns the side columns.
// ============================================================================
export function plateBand(h, margin = 14) {
  let doc, fr;
  try { doc = window.parent && window.parent !== window ? window.parent.document : null; fr = window.frameElement; } catch (e) { return null; }
  const p = doc && doc.getElementById('sn-saver-label');
  if (!p || !fr || !p.classList.contains('on')) return null;
  const o = fr.getBoundingClientRect(), rg = doc.createRange();
  const band = sel => {
    let y0 = Infinity, y1 = -Infinity;
    const host = p.querySelector(sel); if (!host) return null;
    const add = q => { if (q.width < 1 || q.height < 1) return; y0 = Math.min(y0, q.top - o.top); y1 = Math.max(y1, q.bottom - o.top); };
    const walk = n => {
      if (n.nodeType === 3) { if (n.textContent.trim()) { rg.selectNodeContents(n); add(rg.getBoundingClientRect()); } return; }
      if (n.nodeType !== 1 || n.classList.contains('rule') || n.classList.contains('ln')) return;
      if (n.tagName.toLowerCase() === 'svg' || n.classList.contains('logo')) { add(n.getBoundingClientRect()); return; }
      for (const c of n.childNodes) walk(c);
    };
    walk(host);
    return y1 > y0 ? { y0, y1 } : null;
  };
  const top = band('.top'), bot = band('.bot');
  if (!top && !bot) return null;
  const f = bandFloor(top ? Math.max(0, top.y1 + margin) : 0, bot ? Math.max(0, h - bot.y0 + margin) : 0, h);
  return { t: f.t, b: f.b, w: p.getBoundingClientRect().width };
}

// The clear band never goes under min of h. A short phone frame or a long
// label can leave a band of a few px (or none), and a page that sizes its
// subject from the band then draws a dot. bandFloor cuts t and b in their
// own ratio, so the subject stays centred between the two text blocks and
// overlaps the inner edges of the text a little.
export function bandFloor(t, b, h, min = 0.3) {
  const room = h * (1 - min);
  if (!(h > 0) || t + b <= room) return { t, b };
  const k = room / (t + b);
  return { t: t * k, b: b * k };
}
