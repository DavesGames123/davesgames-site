// ============================================================================
//  BREADBOARD LAB  ·  ui/dock.js — the phone dock and the bottom sheet
// ----------------------------------------------------------------------------
//  On a phone (narrow, or a short touch screen in landscape) the top bar and
//  the columns hide. #dock holds five buttons: LIB, INSPECT, run/pause,
//  INSTR, TOOLS (CONTRACT 8). Every panel moves into one #sheet as a tab.
//  The sheet has a half and a full height; drag the grip down to close it,
//  up to make it full. In short landscape the sheet is a drawer at the right
//  edge with a close button. The stage shrinks to the clear area (the
//  --sheet-h / --sheet-w custom properties), and onLayout lets the view
//  frame the bench again.
//
//  GREP MAP
//    PHONE_QUERY ......... the media query of the phone layout
//    createDock .......... builds #dock and #sheet, returns the API
//    setMode ............. phone or desktop, from the media query
//    openTab / close ..... the sheet
//    measure ............. --sheet-h / --sheet-w for the stage and status
//    grip gestures ....... drag down to close, up to full height
// ============================================================================
import { h, icon } from './panels.js';

export const PHONE_QUERY = '(max-width: 768px), (max-height: 520px) and (pointer: coarse)';

// opts: { dockEl, sheetEl, tabs: [{ key, label }], onTab(key), onRun(), onLayout(), onMode(phone) }
export function createDock(opts) {
  const { dockEl, sheetEl } = opts;
  const mq = typeof matchMedia === 'function' ? matchMedia(PHONE_QUERY) : null;
  let phone = false, tab = null;
  // dock buttons
  const mk = (key, label, ico, cls = '') => {
    const b = h(`button.sq${cls ? '.' + cls : ''}`, { type: 'button', 'aria-label': label, dataset: { k: key } }, icon(ico, 20), h('span', {}, label));
    dockEl.appendChild(b);
    return b;
  };
  const B = {
    library: mk('library', 'LIB', 'lib'),
    inspect: mk('inspect', 'INSPECT', 'inspect'),
    run: mk('run', 'RUN', 'play', 'run'),
    instr: mk('instr', 'INSTR', 'instr'),
    tools: mk('tools', 'TOOLS', 'tools')
  };
  for (const [k, b] of Object.entries(B)) {
    b.addEventListener('click', () => {
      if (k === 'run') { opts.onRun && opts.onRun(); return; }
      if (isOpen() && tab === k) close(); else openTab(k);
    });
  }
  // sheet
  const grip = h('div.sheet-grip', { role: 'separator', 'aria-label': 'Drag to resize the sheet' }, h('span'));
  const tabsEl = h('div.sheet-tabs', { role: 'tablist' });
  const closeBtn = h('button.sq.sheet-close', { type: 'button', 'aria-label': 'Close' }, icon('close', 18));
  const body = h('div.sheet-body');
  sheetEl.append(grip, tabsEl, closeBtn, body);
  closeBtn.addEventListener('click', () => close());
  const tabBtns = new Map();
  function setTabs(list) {
    tabsEl.innerHTML = ''; tabBtns.clear();
    for (const t of list) {
      const b = h('button.sq', { type: 'button', role: 'tab', dataset: { k: t.key } }, t.label);
      b.addEventListener('click', () => openTab(t.key));
      tabsEl.appendChild(b); tabBtns.set(t.key, b);
    }
    sync();
  }
  const isOpen = () => sheetEl.classList.contains('open');
  function sync() {
    for (const [k, b] of tabBtns) { b.classList.toggle('on', k === tab); b.setAttribute('aria-selected', String(k === tab)); }
    for (const [k, b] of Object.entries(B)) if (k !== 'run') b.classList.toggle('on', isOpen() && k === tab);
  }
  function openTab(key) {
    tab = key;
    sheetEl.classList.add('open');
    opts.onTab && opts.onTab(key);
    sync(); measure();
    const b = tabBtns.get(key);
    if (b && b.scrollIntoView) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function close() { sheetEl.classList.remove('open', 'full'); sync(); measure(); }
  function measure() {
    const run = () => {
      const on = phone && isOpen();
      const land = typeof matchMedia === 'function' && matchMedia('(max-height: 520px) and (orientation: landscape)').matches;
      document.body.style.setProperty('--sheet-h', on && !land ? sheetEl.offsetHeight + 'px' : '0px');
      document.body.style.setProperty('--sheet-w', on && land ? sheetEl.offsetWidth + 'px' : '0px');
      opts.onLayout && opts.onLayout();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run); else run();
  }
  sheetEl.addEventListener('transitionend', measure);
  let gy = null;
  grip.addEventListener('pointerdown', e => { gy = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } });
  grip.addEventListener('pointerup', e => {
    if (gy === null) return;
    const dy = e.clientY - gy; gy = null;
    if (dy > 40) { if (sheetEl.classList.contains('full')) sheetEl.classList.remove('full'); else close(); }
    else if (dy < -40) sheetEl.classList.add('full');
    else sheetEl.classList.toggle('full');
    setTimeout(measure, 300);
  });
  function setMode() {
    const was = phone;
    phone = !!(mq && mq.matches);
    document.body.classList.toggle('phone', phone);
    if (was !== phone) { if (!phone) close(); opts.onMode && opts.onMode(phone); }
    measure();
  }
  if (mq) { if (mq.addEventListener) mq.addEventListener('change', setMode); else if (mq.addListener) mq.addListener(setMode); }
  return {
    body, setTabs, openTab, close, measure, setMode,
    get phone() { return phone; }, get tab() { return tab; }, get open() { return isOpen(); },
    setRunning(on) { B.run.classList.toggle('on', on); B.run.replaceChild(icon(on ? 'pause' : 'play', 20), B.run.firstChild); B.run.lastChild.textContent = on ? 'PAUSE' : 'RUN'; }
  };
}
