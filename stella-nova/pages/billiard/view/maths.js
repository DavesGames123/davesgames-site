// ============================================================================
//  POOL PHYSICS  ·  view/maths.js — the equation steps and the live readouts
// ----------------------------------------------------------------------------
//  One card per step of core/shot.js mathsOf(). A card shows the plain-text
//  form at once (the fallback when MathJax does not load); the MathJax SVG
//  replaces it when it is ready (lib/sci-math.js, never KaTeX: KaTeX broke
//  in the user's Safari). A step "writes" itself in when its moment comes
//  (a left-to-right reveal, like Manim's Write), the newest card is the
//  current one, and the older cards dim. On a phone the last RECENT (4)
//  cards show (class "recent"), under the 2D diagram.
//  No layout change from the maths: every card has a fixed height and its
//  equation box (.meq) a fixed height too (style.css); the MathJax SVG is
//  scaled into that box. The list scrolls inside itself (never the page).
//  M.svg(k) gives the typeset SVG of step k (the saver draws it).
//
//  createMaths({ steps, read, typeset }) -> M
//    M.load(list, { tex })  a new shot: cards for every step, all hidden
//    M.reveal(k)         show step k (write animation), make it current
//    M.showAll()         the planner: every step at once
//    M.readouts(rows)    rows: [{ n, state, v, a, vn, vt, theta }]
//    M.count()           { cards, shown, svg } for the tests
//
//  grep -n targets: "function card", "M.reveal", "M.readouts"
// ============================================================================

const STATE = { slide: 'sliding', roll: 'rolling', rest: 'at rest', spin: 'spinning', off: 'potted' };

export function createMaths({ steps, read, typeset = null, doc = steps.ownerDocument }) {
  let list = [], cards = [], gen = 0;
  const el = (t, cls, txt) => { const e = doc.createElement(t); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  function card(s, k, g, tex) {
    const a = el('article', 'mstep');
    a.dataset.id = s.id; a.dataset.k = String(k);
    const h = el('header', 'mhead');
    h.append(el('span', 'mnum', String(k + 1)), el('span', 'mttl', s.title));
    const eq = el('div', 'meq sci-eq');
    eq.appendChild(el('span', 'mplain', s.plain));
    eq.setAttribute('aria-label', s.plain);
    a.append(h, eq);
    a.hidden = true;
    if (typeset && tex) {
      const box = doc.createElement('div');
      Promise.resolve(typeset(box, s.tex)).then(okk => {
        if (!okk || g !== gen) return;
        const svg = box.firstChild;
        if (svg) { eq.replaceChildren(svg); eq.classList.add('typeset'); }
      }).catch(() => {});
    }
    return a;
  }
  // the last RECENT shown cards (the phone shows only these)
  const RECENT = 4;
  function markRecent() {
    const shown = cards.filter(c => !c.hidden), keep = new Set(shown.slice(-RECENT));
    for (const c of cards) c.classList.toggle('recent', keep.has(c));
  }
  const M = {
    // tex false: plain text only (the planner while the user drags; the
    // MathJax pass follows when the input rests)
    load(next, { tex = true } = {}) {
      gen++;
      list = next || [];
      steps.replaceChildren();
      cards = list.map((s, k) => card(s, k, gen, tex));
      for (const c of cards) steps.appendChild(c);
      steps.classList.toggle('empty', !cards.length);
    },
    reveal(k) {
      const c = cards[k];
      if (!c) return;
      if (c.hidden) { c.hidden = false; c.classList.add('write'); }
      for (const o of cards) o.classList.toggle('current', o === c);
      markRecent();
      // keep the current card in view: scroll the list itself, never the page
      // (scrollIntoView also scrolls the page, which jumps on a phone)
      try {
        const top = c.offsetTop - steps.offsetTop, want = top + c.offsetHeight - steps.clientHeight;
        if (want > steps.scrollTop) steps.scrollTop = want; else if (top < steps.scrollTop) steps.scrollTop = top;
      } catch (e) { /* jsdom */ }
    },
    showAll() {
      for (const c of cards) { c.hidden = false; c.classList.remove('write'); c.classList.remove('current'); }
      markRecent();
    },
    shownCount: () => cards.filter(c => !c.hidden).length,
    svg: k => { const c = cards[k]; return c ? c.querySelector('.meq.typeset svg') : null; },
    recent: () => cards.filter(c => c.classList.contains('recent')).map(c => +c.dataset.k),
    readouts(rows) {
      if (!read) return;
      const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '–');
      let html = '<table class="rtab"><thead><tr><th>ball</th><th>state</th><th><i class="m1">v</i></th><th><i class="m6">a</i></th><th><i class="m3">v·n̂</i></th><th><i class="m4">v·t̂</i></th><th><i class="m5">θ</i></th></tr></thead><tbody>';
      for (const r of rows) {
        html += `<tr><td><span class="rb rb${r.n}" aria-label="ball ${r.n}">${r.n === 0 ? 'cue' : r.n}</span></td><td>${STATE[r.state] || r.state}</td><td>${f(r.v)}</td><td>${f(r.a)}</td><td>${f(r.vn)}</td><td>${f(r.vt)}</td><td>${Number.isFinite(r.theta) ? f(r.theta, 1) + '°' : '–'}</td></tr>`;
      }
      if (!rows.length) html += '<tr><td colspan="7" class="rnone">all balls at rest</td></tr>';
      html += '</tbody></table><p class="runits">v in m/s, a in m/s², n̂ the line of centres and t̂ the tangent of the first contact, θ the angle of v to n̂</p>';
      read.innerHTML = html;
    },
    count() { return { cards: cards.length, shown: M.shownCount(), svg: cards.filter(c => c.querySelector('.meq.typeset')).length, plain: cards.filter(c => (c.querySelector('.mplain') || {}).textContent).length }; },
  };
  return M;
}
