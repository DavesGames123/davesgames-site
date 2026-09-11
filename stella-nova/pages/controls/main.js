// ============================================================================
//  CONTROLS  ·  interactive keyboard and mouse reference
// ----------------------------------------------------------------------------
//  A classic script that paints a to-scale QWERTY keyboard from a data table,
//  colours each key by binding category, and reacts to hover and legend
//  clicks. One checkbox persists the invert-scroll preference to localStorage.
//  A left-nav plus an IntersectionObserver keep the active section in sync
//  with the scroll position of #content.
//
//  KEY DATA MODEL
//  --------------
//      KB = [ row, row, ... ]                 one array per physical row
//        row = [ entry, entry, ... ]          left to right
//          entry = [label, widthUnits, type, desc]
//                    label  text on the keycap, or null for a gap spacer
//                    width  multiple of --kw (the CSS key-unit width)
//                    type   game | system | modifier | none  (drives colour)
//                    desc   hover text; present only on bound keys
//
//  HOVER / FILTER FLOW
//  -------------------
//      mouseenter key ─▶ showHover()  ─▶ fill #hoverBar, glow same-type keys
//      legend click   ─▶ filterKeys() ─▶ toggle: dim others, glow this type
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//  ----------------------------------------------------------------------------
//      key table .......... "const KB ="        the whole keyboard layout
//      build grid ......... "function renderKeyboard"  DOM from KB
//      hover bar .......... "function showHover"  describe hovered key
//      legend filter ...... "function filterKeys" isolate one category
//      invert scroll ...... "stnv_invert_scroll" persisted checkbox
//      nav scroll ......... "function goTo"       click a nav button
//      scroll spy ......... "IntersectionObserver" active nav on scroll
//      boot ............... "renderKeyboard()"    last line runs the build
// ============================================================================

// The keyboard, row by row, top to bottom. Each entry is
// [label, widthUnits, type, desc]; a [null, width] entry is a blank spacer.
// Only keys with a real binding carry a type and a desc.
const KB = [
  // ROW_ESC
  [
    ['Esc', 1.3, 'system', 'Open settings / dismiss'],
    [null, 0.5],
    ['F1',1,'none'],['F2',1,'none'],['F3',1,'none'],['F4',1,'none'],
    [null, 0.3],
    ['F5',1,'none'],['F6',1,'none'],['F7',1,'none'],['F8',1,'none'],
    [null, 0.3],
    ['F9',1,'none'],['F10',1,'none'],['F11',1,'none'],['F12',1,'none'],
  ],
  // ROW_NUM
  [
    ['`', 1, 'game', 'Toggle debug console'],
    ['1', 1, 'game', 'Timestep — slowest'],
    ['2', 1, 'game', 'Timestep — slow'],
    ['3', 1, 'game', 'Timestep — normal'],
    ['4', 1, 'game', 'Timestep — fast'],
    ['5', 1, 'game', 'Timestep — fastest'],
    ['6',1,'none'],['7',1,'none'],['8',1,'none'],['9',1,'none'],['0',1,'none'],
    ['-', 1, 'game', 'Zoom out'],
    ['=', 1, 'game', 'Zoom in'],
    ['Del', 1.5, 'game', 'Cancel selected blueprints'],
  ],
  // ROW_TOP
  [
    ['Tab', 1.5, 'none'],
    ['Q', 1, 'none'],
    ['W', 1, 'game', 'Camera pan up'],
    ['E', 1, 'game', 'Open station management'],
    ['R', 1, 'game', 'Cycle through stations'],
    ['T',1,'none'],['Y',1,'none'],['U',1,'none'],['I',1,'none'],
    ['O',1,'none'],['P',1,'none'],['[',1,'none'],[']',1,'none'],['\\',1,'none'],
  ],
  // ROW_HOME
  [
    ['Caps', 1.8, 'none'],
    ['A', 1, 'game', 'Camera pan left'],
    ['S', 1, 'game', 'Camera pan down'],
    ['D', 1, 'game', 'Camera pan right'],
    ['F',1,'none'],['G',1,'none'],['H',1,'none'],
    ['J', 1, 'game', 'Open journal'],
    ['K',1,'none'],['L',1,'none'],[';',1,'none'],["'",1,'none'],
    ['Enter', 1.7, 'none'],
  ],
  // ROW_BOTTOM
  [
    ['Shift', 2.3, 'none'],
    ['Z',1,'none'],['X',1,'none'],['C',1,'none'],['V',1,'none'],
    ['B',1,'none'],['N',1,'none'],['M',1,'none'],
    [',',1,'none'],['.',1,'none'],['/',1,'none'],
    ['Shift', 2.2, 'none'],
  ],
  // ROW_SPACE
  [
    ['Ctrl', 1.5, 'modifier', 'Hold for multi-select'],
    ['Win', 1, 'modifier', 'Hold for multi-select (Mac: ⌘)'],
    ['Alt', 1.5, 'none'],
    ['Space', 6, 'system', 'Pause / resume simulation'],
    ['Alt', 1.5, 'none'],
    ['Fn', 1, 'none'],
    ['Ctrl', 1.5, 'modifier', 'Hold for multi-select'],
  ],
];

// Build the keyboard DOM from KB. Each row becomes a .kb-row; each entry
// becomes a .kb-key (or a fixed-width .kb-spacer for a null gap). Bound keys
// get a data-desc and wire mouseenter/mouseleave to the hover bar.
function renderKeyboard(){
  const grid = document.getElementById('kbGrid');
  grid.innerHTML = '';
  KB.forEach((row, ri) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'kb-row' + (ri === 1 ? ' r-num' : '');
    row.forEach(entry => {
      const [label, w, type, desc] = entry;
      const el = document.createElement('div');
      // A null label marks a gap between key clusters; render an empty spacer.
      if (label === null) {
        el.className = 'kb-spacer';
        el.style.width = `calc(var(--kw) * ${w})`;
      } else {
        el.className = `kb-key t-${type || 'none'}`;
        // Labels longer than two characters (Esc, Ctrl, Space) shrink their font.
        if (label.length > 2) el.classList.add('long-label');
        el.style.width = `calc(var(--kw) * ${w})`;
        el.textContent = label;
        el.dataset.type = type || 'none';
        if (desc) {
          el.dataset.desc = desc;
          el.dataset.label = label;
          el.addEventListener('mouseenter', () => showHover(label, desc, type));
          el.addEventListener('mouseleave', hideHover);
        }
      }
      rowEl.appendChild(el);
    });
    grid.appendChild(rowEl);
  });
}

// Fill the hover bar with the hovered key and its binding, and glow every key
// that shares the same category so the group reads as one system.
function showHover(label, desc, type){
  const bar = document.getElementById('hoverBar');
  bar.innerHTML = `<span class="hb-key">${label}</span><span class="hb-desc">${desc}</span>`;
  bar.dataset.active = type;
  document.querySelectorAll(`.kb-key.t-${type}`).forEach(k => k.classList.add('glow'));
}
// Restore the hover bar's default prompt and drop every glow.
function hideHover(){
  const bar = document.getElementById('hoverBar');
  bar.innerHTML = `<span class="hb-default">Hover a colored key to see what it does</span>`;
  delete bar.dataset.active;
  document.querySelectorAll('.kb-key.glow').forEach(k => k.classList.remove('glow'));
}

// The legend acts as a category filter. Clicking a legend item glows that
// category and dims the rest; clicking the active one again clears the filter.
let activeFilter = null;
function filterKeys(el, type){
  const all = document.querySelectorAll('.kb-key');
  // Clicking the already-active category is a toggle-off: clear all styling.
  if (activeFilter === type) {
    activeFilter = null;
    el.classList.remove('on');
    all.forEach(k => k.classList.remove('dim', 'glow'));
    return;
  }
  activeFilter = type;
  document.querySelectorAll('.leg-item').forEach(l => l.classList.remove('on'));
  el.classList.add('on');
  all.forEach(k => {
    const t = k.dataset.type || 'none';
    if (t === type) { k.classList.remove('dim'); k.classList.add('glow'); }
    else { k.classList.add('dim'); k.classList.remove('glow'); }
  });
}

// Invert-scroll option. Restore the saved choice on load and write it back on
// every change, so the preference survives across visits.
(() => {
  const cb = document.getElementById('invertScroll');
  cb.checked = localStorage.getItem('stnv_invert_scroll') === '1';
  cb.addEventListener('change', () => {
    localStorage.setItem('stnv_invert_scroll', cb.checked ? '1' : '0');
  });
})();

// Nav click: mark the button active and smooth-scroll #content to its section.
function goTo(btn, id){
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const el = document.getElementById('sec-' + id);
  if (el) document.getElementById('content').scrollTo({ top: el.offsetTop - 20, behavior: 'smooth' });
}

// Scroll spy: as each section crosses a quarter of the viewport, highlight its
// matching nav button. This keeps the sidebar in sync with manual scrolling.
const obs = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      const id = e.target.id.replace('sec-', '');
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-sec') === id));
    }
  });
}, { root: document.getElementById('content'), threshold: 0.25 });
['keyboard', 'options', 'tips'].forEach(id => {
  const el = document.getElementById('sec-' + id);
  if (el) obs.observe(el);
});

// In-frame guard: when embedded in the site shell iframe, add .in-frame so the
// CSS drops this page's own chrome. A cross-origin access throw counts as framed.
try { if (window.self !== window.top) document.body.classList.add('in-frame'); }
catch (e) { document.body.classList.add('in-frame'); }

// Boot: build the keyboard once the script has parsed.
renderKeyboard();
