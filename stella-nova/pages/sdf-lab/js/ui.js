// ============================================================================
//  SDF FORGE  ·  ui.js — the panels
// ----------------------------------------------------------------------------
//  Forge's command layout: OBJECTS and SELECTION on the left describe the
//  scene; CREATE, MODIFY, VIEW and SCENE on the right are tools.
//
//  PANELS THAT FOLLOW THE SCENE OPEN THEMSELVES (Forge decision 14). OBJECTS
//  opens when the scene holds something and SELECTION when something is
//  selected. Closing one holds it shut until its condition goes away and
//  comes back, so a dismissal is about THIS selection. Tool panels open only
//  when asked. On a phone every panel lives in one bottom sheet with tabs.
//
//  A VALUE WELL (.num) is one control with two gestures: drag sideways to
//  scrub (Shift fine, Alt coarse), click to type. A scrub is one undo record
//  (hist.begin / hist.end) and shows its value next to the object as it moves.
//  While a scrub runs, the panel updates its numbers in place and does not
//  rebuild, so the pointer capture survives.
//
//  GREP MAP
//    PANELS / mkPanel ...... the six panels and their shells
//    renderObjects ......... the tree, eye toggles, rename, drag to reorder
//    renderSelection ....... name, transform rows, parameters, material, actions
//    renderModify .......... the modifier stack, add, reorder, parameters
//    renderCreate .......... primitives, compound booleans
//    renderView ............ layout, view, projection, shading, display, slice, learn
//    renderScene ........... examples, file, export, stats
//    numField / wireNums ... the value wells
//    syncOpen .............. which panels show (decision 14), the phone sheet
//    paneMenus ............. the view and shading menus on each pane label
// ============================================================================
import * as D from './doc.js';
import * as PN from './panes.js';
import { EXAMPLES } from './examples.js';
import * as FL from './files.js';
import { mountEquations } from '../equations.js';
import { SLICE_AX } from './panes.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const PANELS = [['objects', 'OBJECTS', 'leftCol'], ['selection', 'SELECTION', 'leftCol'], ['create', 'CREATE', 'rightCol'], ['modify', 'MODIFY', 'rightCol'], ['view', 'VIEW', 'rightCol'], ['scene', 'SCENE', 'rightCol']];
const OP_TAG = { union: '∪', subtract: '−', intersect: '∩' };
const hex = c => '#' + c.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
const unhex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);

export function initUI(app) {
  const body = {}, shell = {};
  for (const [key, title, col] of PANELS) {
    const sec = document.createElement('section');
    sec.className = 'panel'; sec.id = 'p-' + key; sec.hidden = true;
    sec.innerHTML = `<div class="ph"><h2>${title}</h2><button type="button" class="x" aria-label="Close ${title}">close</button></div><div class="pb"></div>`;
    $(col).appendChild(sec);
    shell[key] = sec; body[key] = sec.querySelector('.pb');
    sec.querySelector('.x').addEventListener('click', () => setOpen(key, false));
  }
  const open = { objects: false, selection: false, create: false, modify: false, view: false, scene: false };
  const dismissed = { objects: false, selection: null };
  let sheetTab = 'create';
  app.modSel = null;
  app.open = open;

  // ── open state ────────────────────────────────────────────────────────────
  function setOpen(key, on) {
    open[key] = on;
    if (key === 'objects') dismissed.objects = !on;
    if (key === 'selection') dismissed.selection = on ? null : app.sel.join(',');
    if (on && ['create', 'modify', 'view', 'scene'].includes(key)) fitRight(key);
    syncOpen();
  }
  // Right panels that do not fit beside the left column close, oldest first;
  // at most two stay open, so the viewport keeps its middle.
  const order = [];
  function fitRight(key) {
    const i = order.indexOf(key); if (i >= 0) order.splice(i, 1); order.push(key);
    const room = innerWidth - ($('leftCol').offsetWidth || 0) - 60;
    while ((order.filter(k => open[k]).length * 312 > room || order.filter(k => open[k]).length > 2) && order.filter(k => open[k]).length > 1) {
      const old = order.find(k => open[k] && k !== key); if (!old) break; open[old] = false;
    }
  }
  function syncOpen() {
    const nonEmpty = app.doc.roots.length > 0;
    if (!nonEmpty) dismissed.objects = false;
    if (!app.sel.length) dismissed.selection = null;
    const showObj = open.objects || (nonEmpty && !dismissed.objects);
    const showSel = open.selection || (app.sel.length > 0 && dismissed.selection !== app.sel.join(','));
    const vis = app.phone ? Object.fromEntries(PANELS.map(([k]) => [k, k === sheetTab])) : { ...open, objects: showObj, selection: showSel };
    for (const [k] of PANELS) shell[k].hidden = !vis[k];
    document.querySelectorAll('#bar .tab').forEach(b => b.classList.toggle('on', !!vis[b.dataset.panel] && !app.phone));
    document.querySelectorAll('#sheetTabs button').forEach(b => b.classList.toggle('on', b.dataset.panel === sheetTab));
  }
  // Escape with nothing else to cancel closes the last tool panel opened.
  app.closeLastPanel = () => { const k = order.slice().reverse().find(x => open[x]); if (k) { setOpen(k, false); return true; } return false; };
  app.closeAll = () => { for (const k of Object.keys(open)) open[k] = false; dismissed.objects = true; dismissed.selection = app.sel.join(','); syncOpen(); };
  app.openPanel = (key, on = true) => { if (app.phone) { sheetTab = key; openSheet(true); placePanels(); syncOpen(); } else setOpen(key, on); };
  document.querySelectorAll('#bar .tab').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.panel;
    const shown = !shell[k].hidden;
    setOpen(k, !shown);
  }));

  // ── phone sheet ───────────────────────────────────────────────────────────
  const sheet = $('sheet');
  $('sheetTabs').innerHTML = PANELS.map(([k, t]) => `<button type="button" data-panel="${k}">${t}</button>`).join('');
  $('sheetTabs').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; sheetTab = b.dataset.panel; syncOpen(); renderAll(); });
  function openSheet(on) {
    sheet.classList.toggle('open', on);
    $('dockSheet').classList.toggle('on', on);
    $('dockSheet').setAttribute('aria-expanded', String(on));
    measureSheet();
  }
  function measureSheet() {
    requestAnimationFrame(() => {
      const on = app.phone && sheet.classList.contains('open');
      const land = matchMedia('(max-height: 500px) and (orientation: landscape)').matches;
      document.body.style.setProperty('--sheet-h', on && !land ? sheet.offsetHeight + 'px' : '0px');
      document.body.style.setProperty('--sheet-w', on && land ? sheet.offsetWidth + 'px' : '0px');
      app.layoutKey = null; app.dirtyAll();
    });
  }
  app.openSheet = openSheet;
  $('dockSheet').addEventListener('click', () => openSheet(!sheet.classList.contains('open')));
  $('sheetClose').addEventListener('click', () => openSheet(false));
  $('dockUndo').addEventListener('click', () => app.undo());
  sheet.addEventListener('transitionend', measureSheet);
  let gripY = null;
  const grip = $('sheetGrip');
  grip.addEventListener('pointerdown', e => { gripY = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } });
  grip.addEventListener('pointerup', e => {
    if (gripY === null) return;
    const dy = e.clientY - gripY; gripY = null;
    if (dy > 40) { if (sheet.classList.contains('full')) sheet.classList.remove('full'); else openSheet(false); }
    else if (dy < -40) sheet.classList.add('full');
    else sheet.classList.toggle('full');
    setTimeout(measureSheet, 280);
  });
  function placePanels() {
    for (const [k, , col] of PANELS) {
      const want = app.phone ? $('sheetBody') : $(col);
      if (shell[k].parentNode !== want) want.appendChild(shell[k]);
    }
    if (app.phone) {
      // the left column order is kept: objects, selection, then the tools
      for (const [k] of PANELS) $('sheetBody').appendChild(shell[k]);
    } else $('rightCol').append(...['create', 'modify', 'view', 'scene'].map(k => shell[k]));
  }
  function renderDockPanes() {
    const names = [[3, 'PERSP'], [0, 'TOP'], [1, 'FRONT'], [2, 'LEFT']];
    $('dockPanes').innerHTML = names.map(([s, t]) => `<button type="button" data-slot="${s}" class="${app.panes.active === s ? 'on' : ''}">${t}</button>`).join('');
  }
  $('dockPanes').classList.add('seg');
  $('dockPanes').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    app.panes.active = +b.dataset.slot; app.layoutKey = null; app.dirtyAll(); app.emit('panes');
  });

  // ── value wells ───────────────────────────────────────────────────────────
  // A well with id -1 is a VIEW setting (q.* quality, s.* slice), not the document.
  const getAny = (id, path) => {
    if (id !== -1) return D.getPath(app.doc, id, path);
    const [g, k] = path.split('.');
    return g === 'q' ? app.quality[k] : app.slice[k];
  };
  // o: { id, path, value, step, min, max, int, label, key, digits, unit }
  function numField(o) {
    const d = o.digits ?? 3;
    return `<div class="num" data-id="${o.id}" data-path="${o.path}" data-step="${o.step ?? 0.01}" data-min="${o.min ?? -1e6}" data-max="${o.max ?? 1e6}" data-int="${o.int ? 1 : 0}" data-digits="${d}" data-label="${esc(o.key || o.label || '')}">${o.axis ? `<i>${o.axis}</i>` : ''}<span class="v">${fmt(o.value, d)}</span></div>`;
  }
  const fmt = (v, d) => (typeof v === 'number' ? (Object.is(v, -0) ? 0 : v).toFixed(d) : '');
  function row(label, field) { return `<div class="rowv"><span class="lab">${label}</span>${field}</div>`; }
  function xyz(id, path, v, step, digits, key) {
    return `<div class="xyz">${['X', 'Y', 'Z'].map((a, i) => numField({ id, path: `${path}.${i}`, value: v[i], step, digits, axis: a, key: key + a })).join('')}</div>`;
  }
  // Update the numbers in place (during a scrub, or after an undo of a value).
  function refreshValues(root = document) {
    root.querySelectorAll('.num').forEach(el => {
      if (el.querySelector('input')) return;
      const v = getAny(+el.dataset.id, el.dataset.path);
      if (typeof v === 'number') el.querySelector('.v').textContent = fmt(v, +el.dataset.digits);
    });
  }
  app.refreshValues = refreshValues;
  let scrub = null;
  function wireNums(root) {
    root.addEventListener('pointerdown', e => {
      const el = e.target.closest('.num');
      if (!el || el.querySelector('input') || e.button > 0) return;
      const v0 = getAny(+el.dataset.id, el.dataset.path);
      scrub = { el, x0: e.clientX, y0: e.clientY, v0, moved: false, pid: e.pointerId };
      try { el.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    });
    root.addEventListener('pointermove', e => {
      if (!scrub || e.pointerId !== scrub.pid) return;
      const dx = e.clientX - scrub.x0;
      if (!scrub.moved && Math.abs(dx) > 4) {
        scrub.moved = true; scrub.x0 = e.clientX;
        app.hist.begin('scrub'); app.scrubbing = true; scrub.el.classList.add('hot');
        return;
      }
      if (!scrub.moved) return;
      const step = +scrub.el.dataset.step * (e.shiftKey ? 0.1 : e.altKey ? 10 : 1);
      let v = scrub.v0 + (e.clientX - scrub.x0) * step;
      v = Math.min(+scrub.el.dataset.max, Math.max(+scrub.el.dataset.min, v));
      if (scrub.el.dataset.int === '1') v = Math.round(v); else v = +v.toFixed(6);
      setVal(scrub.el, v, true);
    });
    const end = e => {
      if (!scrub || (e.pointerId !== undefined && e.pointerId !== scrub.pid)) return;
      const s = scrub; scrub = null;
      if (s.moved) {
        app.hist.end(); app.scrubbing = false; s.el.classList.remove('hot');
        app.readout = null; app.ovDirty = true; renderAll();
      } else if (e.type === 'pointerup') typeInto(s.el);
    };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', e => { if (scrub && scrub.moved) { app.hist.end(); app.scrubbing = false; } scrub = null; void e; });
  }
  function setVal(el, v, live) {
    const id = +el.dataset.id, path = el.dataset.path;
    app.setValues([{ id, path, value: v }], { label: el.dataset.label || 'Value', merge: !live });
    el.querySelector('.v').textContent = fmt(v, +el.dataset.digits);
    // the readout beside the object, as Forge shows R 1.800 while you drag
    const n = app.doc.nodes[id], W = n && D.worldBounds(app.doc, id);
    if (W && live && id !== -1) { app.readout = { at: W.hi, lines: [[el.dataset.label || path, fmt(v, +el.dataset.digits)]] }; app.ovDirty = true; }
    refreshValues();
  }
  function typeInto(el) {
    const v0 = getAny(+el.dataset.id, el.dataset.path);
    const inp = document.createElement('input');
    inp.type = 'text'; inp.inputMode = 'decimal'; inp.value = fmt(v0, +el.dataset.digits);
    el.appendChild(inp); inp.focus(); inp.select();
    let done = false;
    const finish = ok => {
      if (done) return; done = true;
      const t = inp.value.trim();
      inp.remove();
      if (ok && t !== '') {
        let v = Number(t.replace(',', '.'));
        if (!Number.isFinite(v)) { app.toast('Not a number: ' + t); return; }
        v = Math.min(+el.dataset.max, Math.max(+el.dataset.min, v));
        if (el.dataset.int === '1') v = Math.round(v);
        setVal(el, v, false);
        renderAll();
      }
    };
    inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
    inp.addEventListener('blur', () => finish(true));
  }

  // ── OBJECTS ───────────────────────────────────────────────────────────────
  function renderObjects() {
    const rows = D.depthFirst(app.doc);
    if (!rows.length) { body.objects.innerHTML = '<div class="empty">The scene is empty. Open CREATE and drag in a viewport, or load an example from SCENE.</div>'; return; }
    body.objects.innerHTML = '<div class="olist">' + rows.map(({ n, depth }) => {
      const tag = n.kind === 'group' ? (n.smooth ? 'S' : '') + OP_TAG[n.op] : '';
      return `<div class="orow${app.sel.includes(n.id) ? ' sel' : ''}${n.hidden ? ' hid' : ''}" data-id="${n.id}" style="--d:${depth}"><span class="nm">${esc(n.name)}</span><span class="k">${tag}</span><button type="button" class="eye" data-eye="${n.id}" aria-label="${n.hidden ? 'Show' : 'Hide'} ${esc(n.name)}">${n.hidden ? '○' : '●'}</button></div>`;
    }).join('') + '</div>';
  }
  let odrag = null;
  body.objects.addEventListener('click', e => {
    const eye = e.target.closest('[data-eye]');
    if (eye) { app.toggleHide([+eye.dataset.eye]); return; }
    const r = e.target.closest('.orow');
    if (!r || odrag && odrag.moved) return;
    const id = +r.dataset.id;
    app.select([id], e.shiftKey || e.metaKey || e.ctrlKey ? 'toggle' : 'set');
    if (app.pick) app.finishPick(id);
  });
  body.objects.addEventListener('dblclick', e => {
    const r = e.target.closest('.orow'); if (!r) return;
    const id = +r.dataset.id, nm = r.querySelector('.nm');
    const inp = document.createElement('input'); inp.value = app.doc.nodes[id].name;
    nm.replaceWith(inp); inp.focus(); inp.select();
    const fin = ok => { if (ok && inp.value.trim()) app.setValues([{ id, path: 'name', value: inp.value.trim() }], { label: 'Rename' }); renderAll(); };
    inp.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') fin(true); if (ev.key === 'Escape') fin(false); });
    inp.addEventListener('blur', () => fin(true));
  });
  body.objects.addEventListener('pointerdown', e => {
    const r = e.target.closest('.orow');
    if (!r || e.target.closest('button') || e.pointerType === 'touch') return;
    odrag = { id: +r.dataset.id, y0: e.clientY, moved: false, target: null };
  });
  addEventListener('pointermove', e => {
    if (!odrag) return;
    if (!odrag.moved && Math.abs(e.clientY - odrag.y0) < 6) return;
    odrag.moved = true;
    body.objects.querySelectorAll('.orow').forEach(x => x.classList.remove('drop-before', 'drop-after', 'drop-into'));
    const r = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.orow');
    if (!r || +r.dataset.id === odrag.id) { odrag.target = null; return; }
    const b = r.getBoundingClientRect(), f = (e.clientY - b.top) / b.height, n = app.doc.nodes[+r.dataset.id];
    const where = n.kind === 'group' && f > 0.28 && f < 0.72 ? 'into' : f < 0.5 ? 'before' : 'after';
    r.classList.add('drop-' + where);
    odrag.target = { id: +r.dataset.id, where };
  });
  addEventListener('pointerup', () => {
    if (!odrag) return;
    const d = odrag; odrag = null;
    body.objects.querySelectorAll('.orow').forEach(x => x.classList.remove('drop-before', 'drop-after', 'drop-into'));
    if (!d.moved || !d.target) return;
    const t = d.target;
    app.commit('Reorder', doc => {
      if (t.where === 'into') return D.moveNode(doc, d.id, t.id, -1);
      const par = D.parentOf(doc, t.id), list = par ? par.children : doc.roots;
      const i = list.indexOf(t.id) + (t.where === 'after' ? 1 : 0);
      return D.moveNode(doc, d.id, par ? par.id : null, i);
    });
    setTimeout(() => renderAll(), 0);
  });

  // ── SELECTION ─────────────────────────────────────────────────────────────
  function renderSelection() {
    const n = app.primary();
    if (!n) { body.selection.innerHTML = '<div class="empty">Click an object in a viewport or in OBJECTS.</div>'; return; }
    const id = n.id;
    let h = `<input class="name" id="selName" value="${esc(n.name)}" aria-label="Name">`;
    if (app.sel.length > 1) h += `<p class="note"><b>${app.sel.length}</b> objects selected. The gizmo moves each about its own pivot. CREATE, COMPOUND joins them.</p>`;
    h += '<div class="sec">POSITION</div>' + xyz(id, 'pos', n.pos, 0.01, 3, '');
    h += '<div class="sec">ROTATION <span class="r">EULER XYZ</span></div>' + xyz(id, 'rot', n.rot, 0.5, 1, 'R');
    h += '<div class="sec">SCALE</div>' + xyz(id, 'scl', n.scl, 0.005, 3, 'S');
    if (n.kind === 'prim') {
      h += '<div class="sec">PARAMETERS</div>';
      for (const [k, lab, , mn, mx, st] of D.PRIMS[n.type].params) h += row(lab, numField({ id, path: 'p.' + k, value: n.p[k], step: st, min: mn, max: mx, key: lab.split(' ')[0][0] + (lab.includes(' ') ? lab.split(' ')[1] : '') }));
      h += '<div class="sec">MATERIAL</div>';
      h += row('COLOUR', `<input type="color" class="swatch" id="selColor" value="${hex(n.mat.color)}" aria-label="Colour">`);
      h += row('ROUGHNESS', numField({ id, path: 'mat.rough', value: n.mat.rough, step: 0.005, min: 0.02, max: 1, key: 'ROUGH' }));
      h += row('METAL', numField({ id, path: 'mat.metal', value: n.mat.metal, step: 0.01, min: 0, max: 1, key: 'METAL' }));
    } else {
      h += '<div class="sec">BOOLEAN <span class="r">BLEND ORDER = LIST ORDER</span></div><div class="grid3">'
        + Object.keys(D.OPS).map(op => `<button type="button" class="btn${n.op === op ? ' on' : ''}" data-op="${op}">${op.toUpperCase()}</button>`).join('') + '</div>';
      h += `<button type="button" class="tog${n.smooth ? ' on' : ''}" id="selSmooth">SMOOTH</button>`;
      if (n.smooth) h += row('BLEND K', numField({ id, path: 'p.k', value: n.p.k, step: 0.005, min: 0.001, max: 10, key: 'K' }));
      h += `<p class="note">${n.children.length} children. ${n.op === 'subtract' ? 'The first child is kept; every later one is cut out of it.' : n.op === 'intersect' ? 'Only the space inside every child is kept.' : 'All children are joined.'}</p>`;
    }
    const b = D.worldBounds(app.doc, id);
    if (b) h += `<div class="stats"><span>SIZE</span><b>${b.hi.map((v, j) => (v - b.lo[j]).toFixed(2)).join(' × ')}</b><span>MODIFIERS</span><b>${n.mods.length}</b></div>`;
    h += '<div class="sec">OBJECT</div><div class="grid3">'
      + '<button type="button" class="btn" data-act="clone">CLONE</button>'
      + '<button type="button" class="btn warn" data-act="delete">DELETE</button>'
      + `<button type="button" class="btn" data-act="hide">${n.hidden ? 'UNHIDE' : 'HIDE'}</button>`
      + '<button type="button" class="btn" data-act="up" title="Earlier in blend order">UP</button>'
      + '<button type="button" class="btn" data-act="down" title="Later in blend order">DOWN</button>'
      + '<button type="button" class="btn" data-act="frame">FRAME</button>'
      + (n.kind === 'group' ? '<button type="button" class="btn wide" data-act="ungroup">UNGROUP</button>' : '<button type="button" class="btn wide" data-act="group">GROUP</button>')
      + '</div>';
    body.selection.innerHTML = h;
  }
  body.selection.addEventListener('change', e => {
    const n = app.primary(); if (!n) return;
    if (e.target.id === 'selName' && e.target.value.trim()) app.setValues([{ id: n.id, path: 'name', value: e.target.value.trim() }], { label: 'Rename' });
    if (e.target.id === 'selColor') app.setValues([{ id: n.id, path: 'mat.color', value: unhex(e.target.value) }], { label: 'Colour' });
  });
  body.selection.addEventListener('input', e => {
    const n = app.primary(); if (!n || e.target.id !== 'selColor') return;
    D.setPath(app.doc, n.id, 'mat.color', unhex(e.target.value)); app.touch();
  });
  body.selection.addEventListener('keydown', e => { if (e.target.id === 'selName') { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); } });
  body.selection.addEventListener('click', e => {
    const n = app.primary(); if (!n) return;
    const op = e.target.closest('[data-op]');
    if (op) { app.commit('Operation', d => { d.nodes[n.id].op = op.dataset.op; }); return; }
    if (e.target.id === 'selSmooth') { app.setValues([{ id: n.id, path: 'smooth', value: !n.smooth }], { label: 'Smooth' }); return; }
    const a = e.target.closest('[data-act]'); if (!a) return;
    const act = a.dataset.act;
    if (act === 'clone') app.duplicateSel();
    if (act === 'delete') app.deleteSel();
    if (act === 'hide') app.toggleHide();
    if (act === 'frame') app.frameSelected();
    if (act === 'group') { if (app.selRoots().length > 1) app.boolean('union', false, 0.3); else groupOne(n.id); }
    if (act === 'ungroup') app.ungroupSel();
    if (act === 'up' || act === 'down') {
      app.commit('Reorder', d => {
        const list = D.siblings(d, n.id), i = list.indexOf(n.id), j = i + (act === 'up' ? -1 : 1);
        if (j < 0 || j >= list.length) return;
        [list[i], list[j]] = [list[j], list[i]];
      });
    }
  });
  function groupOne(id) { const g = app.commit('Group', d => D.groupNodes(d, [id], 'union', false, 0.3)); if (g) app.select([g.id]); }

  // ── MODIFY ────────────────────────────────────────────────────────────────
  function renderModify() {
    const n = app.primary();
    if (!n) { body.modify.innerHTML = '<div class="sec">PARAMETERS</div><div class="empty">Select an object to edit its modifier stack.</div>'; return; }
    if (app.modSel && !n.mods.some(m => m.id === app.modSel)) app.modSel = null;
    let h = `<div class="sec">MODIFIER LIST</div><div class="grid2">${D.MOD_TYPES.map(t => `<button type="button" class="btn" data-add="${t}">${D.MODS[t].label.toUpperCase()}</button>`).join('')}</div>`;
    h += `<div class="sec">STACK <span class="r">${esc(n.name)}</span></div><div class="stack">`;
    for (let i = n.mods.length - 1; i >= 0; i--) {
      const m = n.mods[i];
      h += `<div class="mrow${app.modSel === m.id ? ' sel' : ''}${m.on ? '' : ' off'}" data-mod="${m.id}"><button type="button" data-on="${m.id}" aria-label="Toggle ${D.MODS[m.type].label}">${m.on ? '●' : '○'}</button><span class="nm">${D.MODS[m.type].label.toUpperCase()}</span><button type="button" data-up="${m.id}" aria-label="Move up">▲</button><button type="button" data-down="${m.id}" aria-label="Move down">▼</button><button type="button" data-del="${m.id}" aria-label="Delete">✕</button></div>`;
    }
    const base = n.kind === 'group' ? (n.smooth ? 'SMOOTH ' : '') + n.op.toUpperCase() : D.PRIMS[n.type].label.toUpperCase();
    h += `<div class="mrow base${app.modSel ? '' : ' sel'}" data-mod="0"><span class="nm">${base}</span></div></div>`;
    h += '<div class="sec">PARAMETERS</div>';
    const m = n.mods.find(x => x.id === app.modSel);
    if (m) {
      for (const [k, lab, , mn, mx, st] of D.MODS[m.type].params) {
        const isFlag = mn === 0 && mx === 1 && st === 1;
        if (isFlag) h += `<button type="button" class="tog${m.p[k] >= 0.5 ? ' on' : ''}" data-flag="${k}">${lab}</button>`;
        else h += row(lab, numField({ id: n.id, path: `mods.${m.id}.p.${k}`, value: m.p[k], step: st, min: mn, max: mx, int: st === 1, digits: st === 1 ? 0 : 3, key: lab.split(' ')[0] }));
      }
      h += `<p class="note">${MOD_NOTE[m.type]}</p>`;
    } else if (n.kind === 'prim') {
      for (const [k, lab, , mn, mx, st] of D.PRIMS[n.type].params) h += row(lab, numField({ id: n.id, path: 'p.' + k, value: n.p[k], step: st, min: mn, max: mx, key: lab.split(' ')[0][0] }));
    } else {
      h += n.smooth ? row('BLEND K', numField({ id: n.id, path: 'p.k', value: n.p.k, step: 0.005, min: 0.001, max: 10, key: 'K' })) : '<p class="note">A hard boolean has no parameters. Turn on SMOOTH in SELECTION for a blend.</p>';
    }
    body.modify.innerHTML = h;
  }
  const MOD_NOTE = {
    round: 'Subtracts a radius from the distance: every edge gets a fillet and the shape grows by that radius.',
    onion: 'Takes |d| minus a thickness: the solid becomes a shell. Cut it with a subtract to see inside.',
    twist: 'Turns each slice about local Y by an angle that grows with height. It raises the field gradient, so the tracer takes shorter steps.',
    bend: 'Turns each slice about local Z by an angle that grows along X.',
    elongate: 'Pulls the shape apart at its centre and fills the gap with its own cross-section.',
    repeat: 'Copies the shape on a grid, limited to the given count each side of the centre. One evaluation per point, whatever the count.',
    mirror: 'Folds space on the chosen local axes: what is on the positive side shows on both. Offset moves the fold.',
    displace: 'Adds value noise to the distance. Large amounts break the distance bound, so the tracer slows to stay safe.',
  };
  body.modify.addEventListener('click', e => {
    const n = app.primary(); if (!n) return;
    const t = e.target.closest('button,[data-mod]');
    if (!t) return;
    const ds = t.dataset;
    if (ds.add) { const m = app.commit('Add ' + D.MODS[ds.add].label, d => D.addMod(d, n.id, ds.add)); app.modSel = m.id; renderAll(); return; }
    if (ds.on) { const m = n.mods.find(x => x.id === +ds.on); app.setValues([{ id: n.id, path: `mods.${m.id}.on`, value: !m.on }], { label: 'Modifier on' }); return; }
    if (ds.up) { app.commit('Modifier up', d => D.moveMod(d, n.id, +ds.up, +1)); return; }
    if (ds.down) { app.commit('Modifier down', d => D.moveMod(d, n.id, +ds.down, -1)); return; }
    if (ds.del) { app.commit('Delete modifier', d => D.removeMod(d, n.id, +ds.del)); return; }
    if (ds.flag) { const m = n.mods.find(x => x.id === app.modSel); app.setValues([{ id: n.id, path: `mods.${m.id}.p.${ds.flag}`, value: m.p[ds.flag] >= 0.5 ? 0 : 1 }], { label: 'Mirror axis' }); return; }
    if (ds.mod !== undefined) { app.modSel = +ds.mod || null; renderModify(); }
  });

  // ── CREATE ────────────────────────────────────────────────────────────────
  app.compound = app.compound || { smooth: true, k: 0.3 };
  function renderCreate() {
    const btn = t => `<button type="button" class="btn${app.arm === t ? ' on' : ''}" data-prim="${t}">${D.PRIMS[t].label.toUpperCase()}</button>`;
    let h = '<div class="sec">STANDARD</div><div class="grid2">' + D.PRIM_TYPES.filter(t => D.PRIMS[t].group === 'standard').map(btn).join('') + '</div>';
    h += '<div class="sec">EXTENDED</div><div class="grid2">' + D.PRIM_TYPES.filter(t => D.PRIMS[t].group === 'extended').map(btn).join('') + '</div>';
    h += '<div class="sec">COMPOUND</div><div class="grid3">' + Object.keys(D.OPS).map(op => `<button type="button" class="btn${app.pick && app.pick.op === op ? ' on' : ''}" data-bool="${op}">${op.toUpperCase()}</button>`).join('') + '</div>';
    h += `<button type="button" class="tog${app.compound.smooth ? ' on' : ''}" id="cSmooth">SMOOTH</button>`;
    h += `<p class="note">${app.arm ? GESTURE_NOTE[D.PRIMS[app.arm].create] : app.pick ? `Pick operand B in a viewport or in OBJECTS. <b>Esc</b> cancels.` : 'Arm a primitive, then drag on the construction plane of any pane: the ground in perspective and TOP, the wall in FRONT and LEFT. With two or more objects selected, a compound joins them at once; with one, it asks for operand B.'}</p>`;
    body.create.innerHTML = h;
  }
  const GESTURE_NOTE = {
    radius: 'Press at the centre and drag out the radius.',
    boxfoot: 'Drag the footprint from corner to corner, release, then move up for the height and click.',
    radiusH: 'Drag out the radius, release, then move up for the height and click.',
    cone: 'Drag radius 1, release, move up for the height and click, then move for radius 2 (read at the top) and click.',
    torus: 'Drag the ring radius, release, then move off the ring for the tube radius and click.',
    link: 'Drag the loop radius, release, then move up to stretch the link and click.',
    click: 'Click to place a plane. It is an infinite half-space: use it to cut with SUBTRACT or INTERSECT.',
  };
  app.GESTURE_NOTE = GESTURE_NOTE;
  body.create.addEventListener('click', e => {
    const p = e.target.closest('[data-prim]');
    if (p) { const t = p.dataset.prim; app.setTool(app.tool); app.arm = app.arm === t ? null : t; app.emit('tool'); if (app.phone && app.arm) openSheet(false); return; }
    const b = e.target.closest('[data-bool]');
    if (b) {
      const op = b.dataset.bool, ids = app.selRoots();
      if (ids.length >= 2) app.boolean(op, app.compound.smooth, app.compound.k, ids);
      else if (ids.length === 1) { app.arm = null; app.pick = { op, a: ids[0] }; app.emit('tool'); }
      else app.toast('Select an object first: it becomes operand A.');
      return;
    }
    if (e.target.id === 'cSmooth') { app.compound.smooth = !app.compound.smooth; renderCreate(); }
  });

  // ── VIEW ──────────────────────────────────────────────────────────────────
  function renderView() {
    const s = app.panes.slots[app.panes.active], S = app.slice;
    const b = (attr, v, on, label) => `<button type="button" class="btn${on ? ' on' : ''}" data-${attr}="${v}">${label}</button>`;
    let h = '<div class="sec">LAYOUT</div><div class="grid3">' + [['single', 'SINGLE'], ['split', 'SPLIT'], ['quad', 'QUAD']].map(([k, t]) => b('layout', k, app.panes.layout === k, t)).join('') + '</div>';
    h += `<div class="sec">VIEW <span class="r">ACTIVE PANE</span></div><div class="grid3">` + ['top', 'front', 'left', 'right', 'persp', 'iso'].map(v => b('view', v, s.view === v, PN.VIEW_LABEL[v] === 'PERSPECTIVE' ? 'PERSP' : PN.VIEW_LABEL[v])).join('') + '</div>';
    h += '<div class="sec">PROJECTION</div><div class="grid2">' + b('proj', 'persp', !s.ortho, 'PERSP') + b('proj', 'ortho', s.ortho, 'ORTHO') + '</div>';
    h += '<div class="sec">SHADING <span class="r">KEYS 1-6</span></div><div class="grid3">' + PN.MODES.map(m => b('mode', m, s.mode === m, PN.MODE_LABEL[m])).join('') + '</div>';
    h += '<div class="sec">DISPLAY</div>';
    const tg = (k, label) => `<button type="button" class="tog${app.disp[k] ? ' on' : ''}" data-disp="${k}">${label}</button>`;
    h += tg('grid', 'GRID') + tg('axes', 'AXES') + tg('cube', 'VIEW CUBE') + tg('ghost', 'GHOST CUTTERS') + tg('shadows', 'SHADOWS');
    h += '<div class="sec">BOUNDS</div><div class="grid3">' + [['off', 'OFF'], ['sel', 'SELECTED'], ['all', 'ALL']].map(([k, t]) => b('bounds', k, app.disp.bounds === k, t)).join('') + '</div>';
    h += '<div class="sec">QUALITY</div>';
    h += row('MAX STEPS', numField({ id: -1, path: 'q.maxSteps', value: app.quality.maxSteps, step: 1, min: 16, max: 512, int: true, digits: 0 }));
    h += row('OTHER PANES', numField({ id: -1, path: 'q.inactive', value: app.quality.inactive, step: 0.01, min: 0.25, max: 1, digits: 2 }));
    h += '<div class="sec">SLICE <span class="r">SPHERE TRACING</span></div>';
    h += '<div class="grid3">' + Object.entries(SLICE_AX).map(([k, a]) => b('sax', k, S.axis === k, a.label)).join('') + '</div>';
    h += row('OFFSET', numField({ id: -1, path: 's.off', value: S.off, step: 0.01, min: -50, max: 50 }));
    h += `<button type="button" class="tog${S.relax ? ' on' : ''}" id="sRelax">OVER-RELAXATION</button>`;
    h += row('OMEGA', numField({ id: -1, path: 's.omega', value: S.omega, step: 0.01, min: 1, max: 1.95, digits: 2 }));
    h += row('STEP SCALE', numField({ id: -1, path: 's.stepScale', value: S.stepScale, step: 0.01, min: 0.2, max: 1.2, digits: 2 }));
    h += `<button type="button" class="btn wide" id="sOpen" style="width:100%;margin-top:6px">${app.rects.some(r => app.panes.slots[r.slot].mode === 'slice') ? 'SLICE PANE IS OPEN' : 'OPEN A SLICE PANE'}</button>`;
    h += `<details class="learn"${app.learnOpen ? ' open' : ''}><summary>HOW SPHERE TRACING WORKS</summary>
      <p><b>The step.</b> At a point on the ray, d is the radius of a sphere that holds no surface, so the ray can move by d and stay safe (Hart 1996). In the SLICE pane each circle is that sphere cut by the plane; a white dot marks where it touches the nearest surface.</p><div class="eq" id="eq-step"></div>
      <p><b>Bounds.</b> Booleans, smooth blends and space warps often give only a lower bound of the distance. That is safe but slow. A twist or a displacement can make the gradient larger than 1; then the tracer divides each step by the Lipschitz bound L. SDF Forge computes L from the modifiers and the STEPS shading shows the cost.</p><div class="eq" id="eq-bound"></div>
      <p><b>Over-relaxation.</b> Keinert et al. 2014 step by ωd with ω &gt; 1. When the new sphere does not reach back to the old one, the step may have skipped a surface, so the tracer goes back and uses ω = 1. Failed steps show dashed in coral.</p><div class="eq" id="eq-relax"></div>
      <p><b>Smooth union.</b> A polynomial blend of two fields adds a fillet of width k (Quilez).</p><div class="eq" id="eq-smin"></div>
      <p><b>Soft shadows.</b> March from the surface toward the light; the smallest ratio of d to distance gives the penumbra (Quilez).</p><div class="eq" id="eq-shadow"></div>
    </details>`;
    body.view.innerHTML = h;
    if (app.learnOpen) mountEquations();
  }
  body.view.addEventListener('toggle', e => { if (e.target.matches('details.learn')) { app.learnOpen = e.target.open; if (e.target.open) mountEquations(); } }, true);
  body.view.addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return;
    const ds = t.dataset, s = app.panes.slots[app.panes.active];
    if (ds.layout) app.setLayout(ds.layout);
    if (ds.view) app.setPaneView(app.panes.active, ds.view);
    if (ds.proj) { s.ortho = ds.proj === 'ortho'; app.dirtyAll(); }
    if (ds.mode) app.setPaneMode(app.panes.active, ds.mode);
    if (ds.disp) { app.disp[ds.disp] = !app.disp[ds.disp]; app.dirtyAll(); }
    if (ds.bounds) { app.disp.bounds = ds.bounds; app.ovDirty = true; }
    if (ds.sax) { app.slice.axis = ds.sax; const r = app.rects.find(x => app.panes.slots[x.slot].mode === 'slice'); app.fitSlice(r ? r.w / r.h : 1.6); }
    if (t.id === 'sRelax') { app.slice.relax = !app.slice.relax; app.ovDirty = true; }
    if (t.id === 'sOpen') app.openSlicePane();
    renderView();
  });
  // the VIEW wells write app settings, not the document
  const setSetting = (path, v) => {
    const [g, k] = path.split('.');
    if (g === 'q') app.quality[k] = v;
    if (g === 's') app.slice[k] = v;
    app.dirtyAll(); app.poke();
  };
  app.setSetting = setSetting;

  // ── SCENE ─────────────────────────────────────────────────────────────────
  function renderScene() {
    let h = '<div class="sec">EXAMPLES</div><div class="grid2">' + Object.entries(EXAMPLES).map(([k, e]) => `<button type="button" class="btn" data-ex="${k}" title="${esc(e.note)}">${e.label.toUpperCase()}</button>`).join('') + '</div>';
    h += '<div class="sec">FILE</div><div class="grid3"><button type="button" class="btn" data-file="new">NEW</button><button type="button" class="btn" data-file="open">OPEN</button><button type="button" class="btn" data-file="save">SAVE</button></div>';
    h += '<p class="note">The scene also saves itself in this browser after every edit.</p>';
    h += '<div class="sec">EXPORT</div><div class="grid2"><button type="button" class="btn" data-exp="wgsl">COPY WGSL</button><button type="button" class="btn" data-exp="glsl">COPY GLSL</button></div>';
    h += '<div class="sec">MESH <span class="r">MARCHING CUBES</span></div><div class="grid3">' + [64, 128, 192].map(r => `<button type="button" class="btn${app.objRes === r ? ' on' : ''}" data-res="${r}">${r}</button>`).join('') + '</div>';
    h += `<button type="button" class="btn" data-exp="obj" style="width:100%;margin-top:6px"${app.objBusy ? ' disabled' : ''}>${app.objBusy ? 'MESHING…' : 'EXPORT OBJ'}</button><div class="prog"><i id="objProg"></i></div>`;
    if (app.lastObj) h += `<p class="note">${app.lastObj.tris.toLocaleString()} triangles, ${app.lastObj.closed ? 'closed' : 'open'} mesh, ${app.lastObj.ms} ms.</p>`;
    const L = app.F && app.F.L;
    h += `<div class="sec">STATS</div><div class="stats" id="statsBox">${statsHTML(L)}</div>`;
    body.scene.innerHTML = h;
  }
  const statsHTML = L => `<span>NODES</span><b>${L ? L.order.length : 0}</b><span>PARAM SLOTS</span><b>${L ? L.size : 0}</b><span>SHADER LINES</span><b>${app.stats.lines}</b><span>COMPILE</span><b>${app.stats.compileMs.toFixed(0)} ms</b><span>GPU FRAME</span><b>${app.stats.gpuMs.toFixed(1)} ms</b><span>STEP FACTOR</span><b>${(app.stepK || 1).toFixed(3)}</b>`;
  app.objRes = 128;
  body.scene.addEventListener('click', async e => {
    const t = e.target.closest('button'); if (!t) return;
    const ds = t.dataset;
    if (ds.ex) { app.loadDoc(EXAMPLES[ds.ex].build(), EXAMPLES[ds.ex].label); app.toast(EXAMPLES[ds.ex].note, 3000); }
    if (ds.file === 'new') app.loadDoc(D.newDoc(), 'New');
    if (ds.file === 'save') FL.saveJSON(app);
    if (ds.file === 'open') $('fileIn').click();
    if (ds.exp === 'wgsl') { const ok = await FL.copyText(FL.exportWGSL(app)); app.toast(ok ? 'WGSL copied: fn mapD(p: vec3f) -> f32' : 'Copy failed'); }
    if (ds.exp === 'glsl') { const ok = await FL.copyText(FL.exportGLSL(app)); app.toast(ok ? 'GLSL copied: float mapD(vec3 p)' : 'Copy failed'); }
    if (ds.res) { app.objRes = +ds.res; renderScene(); }
    if (ds.exp === 'obj') app.exportOBJ();
  });
  $('fileIn').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try { await FL.openJSON(app, f); app.toast('Opened ' + f.name); } catch (err) { app.toast(String(err.message || err), 4000); }
  });
  app.exportOBJ = () => {
    if (app.objBusy) return Promise.resolve(null);
    app.objBusy = true; renderScene();
    return FL.exportOBJ(app, app.objRes, p => { const el = $('objProg'); if (el) el.style.width = (p * 100).toFixed(0) + '%'; })
      .then(r => { app.lastObj = r.stats; FL.download('sdf-forge.obj', r.obj, 'text/plain'); app.toast(`OBJ: ${r.stats.tris.toLocaleString()} triangles`); return r; })
      .catch(err => { app.toast('OBJ failed: ' + err.message, 4000); return null; })
      .finally(() => { app.objBusy = false; renderScene(); });
  };

  // ── VIEW wells, the status strip, the bar ─────────────────────────────────
  // The VIEW panel wells have id -1 and write settings; patch getPath/setValues for them.
  const docSet = app.setValues;
  app.setValues = (changes, opt) => {
    const docC = changes.filter(c => c.id !== -1);
    changes.filter(c => c.id === -1).forEach(c => setSetting(c.path, c.value));
    if (docC.length) docSet(docC, opt);
  };
  $('undoBtn').addEventListener('click', () => app.undo());
  $('redoBtn').addEventListener('click', () => app.redo());
  $('tools').addEventListener('click', e => { const b = e.target.closest('[data-tool]'); if (b) app.setTool(b.dataset.tool); });
  $('coordBtn').addEventListener('click', () => { app.coord = app.coord === 'world' ? 'local' : 'world'; app.ovDirty = true; syncStatus(); });
  $('snapBtn').addEventListener('click', () => { app.snap = !app.snap; syncStatus(); });
  function syncStatus() {
    document.querySelectorAll('#tools button').forEach(b => b.classList.toggle('on', b.dataset.tool === app.tool && !app.arm));
    $('coordBtn').textContent = app.coord === 'world' ? 'WORLD' : 'LOCAL';
    $('coordBtn').classList.toggle('on', app.coord === 'local');
    $('snapBtn').classList.toggle('on', app.snap);
    $('undoBtn').disabled = !app.hist.canUndo(); $('redoBtn').disabled = !app.hist.canRedo();
    const r = app.rectOf(app.panes.active);
    if (r) {
      const P = app.projOf(r), s = app.panes.slots[r.slot];
      const w = P.worldPerPx(s.cam.target);
      $('gridTag').textContent = 'GRID ' + Math.pow(10, Math.ceil(Math.log10(w * 9))).toFixed(3);
    }
    let hint = '';
    if (app.arm) hint = D.PRIMS[app.arm].label.toUpperCase() + ': ' + GESTURE_NOTE[D.PRIMS[app.arm].create];
    else if (app.pick) hint = D.OPS[app.pick.op].toUpperCase() + ': pick operand B. Esc cancels.';
    else hint = 'Drag empty space to orbit (ortho: pan). Shift or middle drag pans. Wheel zooms. Click selects. W E R move rotate scale.';
    $('hint').textContent = hint;
  }
  app.syncStatus = syncStatus;

  // ── pane label menus ──────────────────────────────────────────────────────
  let menu = null;
  function closeMenu() { if (menu) { menu.remove(); menu = null; } }
  function showMenu(x, y, items) {
    closeMenu();
    menu = document.createElement('div'); menu.className = 'menu';
    menu.innerHTML = items.map((it, i) => it ? `<button type="button" data-i="${i}" class="${it.on ? 'on' : ''}">${it.label}${it.key ? `<kbd>${it.key}</kbd>` : ''}</button>` : '<hr style="border:0;border-top:1px solid #26262c;margin:3px 0">').join('');
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
    menu.style.top = Math.max(8, y - r.height - 6) + 'px';
    menu.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; items[+b.dataset.i].run(); closeMenu(); });
  }
  addEventListener('pointerdown', e => { if (menu && !menu.contains(e.target)) closeMenu(); }, true);
  app.paneDom.forEach((pd, slot) => {
    pd.v.addEventListener('click', e => {
      const s = app.panes.slots[slot], r = pd.v.getBoundingClientRect();
      app.panes.active = slot; app.layoutKey = null;
      const views = [['top', 'T'], ['front', 'F'], ['left', 'L'], ['right', ''], ['back', ''], ['bottom', ''], ['persp', 'P'], ['iso', '']];
      showMenu(r.left, r.top, [...views.map(([v, k]) => ({ label: PN.VIEW_LABEL[v], key: k, on: s.view === v, run: () => app.setPaneView(slot, v) })), null,
        { label: s.ortho ? 'PERSPECTIVE' : 'ORTHOGRAPHIC', run: () => { s.ortho = !s.ortho; app.dirtyAll(); } },
        { label: app.panes.layout === 'single' ? 'RESTORE LAYOUT' : 'MAXIMIZE', key: 'Alt+W', run: () => app.toggleMax() },
        { label: 'FRAME', key: 'Z', run: () => app.frameSelected(slot) }]);
      e.stopPropagation();
    });
    pd.m.addEventListener('click', e => {
      const s = app.panes.slots[slot], r = pd.m.getBoundingClientRect();
      app.panes.active = slot; app.layoutKey = null;
      showMenu(r.left, r.top, PN.MODES.map((m, i) => ({ label: PN.MODE_LABEL[m], key: String(i + 1), on: s.mode === m, run: () => app.setPaneMode(slot, m) })));
      e.stopPropagation();
    });
    pd.v.addEventListener('pointerdown', e => e.stopPropagation());
    pd.m.addEventListener('pointerdown', e => e.stopPropagation());
  });
  app.cubeBtns.addEventListener('pointerdown', e => e.stopPropagation());
  app.cubeBtns.addEventListener('click', e => {
    const b = e.target.closest('[data-proj]'); if (!b) return;
    app.panes.slots[app.panes.active].ortho = b.dataset.proj === 'ortho'; app.dirtyAll(); syncCube();
  });
  function syncCube() {
    const s = app.panes.slots[app.panes.active];
    app.cubeBtns.querySelectorAll('button').forEach(b => b.classList.toggle('on', (b.dataset.proj === 'ortho') === !!s.ortho));
    app.cubeBtns.hidden = !app.disp.cube || s.mode === 'slice';
  }

  // ── pane commands shared by the menus, the VIEW panel and the keys ────────
  app.setLayout = l => { app.panes.prev = app.panes.layout; app.panes.layout = l; app.layoutKey = null; app.dirtyAll(); app.emit('panes'); };
  app.toggleMax = () => app.setLayout(app.panes.layout === 'single' ? (app.panes.prev && app.panes.prev !== 'single' ? app.panes.prev : 'quad') : 'single');
  app.setPaneView = (slot, v) => { PN.setView(app.panes.slots[slot], v); app.dirtyAll(); app.emit('panes'); };
  app.setPaneMode = (slot, m) => { app.panes.slots[slot].mode = m; app.dirtyAll(); app.emit('panes'); };
  app.openSlicePane = () => {
    // a slice pane beside the perspective pane: SPLIT, with FRONT as the slice
    const s = app.panes.slots[1];
    s.mode = 'slice';
    app.panes.active = 3;
    app.setLayout(app.phone ? 'single' : 'split');
    if (app.phone) app.panes.active = 1;
    requestAnimationFrame(() => { const r = app.rectOf(1); app.fitSlice(r ? r.w / r.h : 1); });
    app.dirtyAll(); app.emit('panes');
  };

  // ── render all ────────────────────────────────────────────────────────────
  function renderAll() {
    if (app.scrubbing) { app.refreshValues(); syncStatus(); return; }
    renderObjects(); renderSelection(); renderModify(); renderCreate(); renderView(); renderScene();
    app.refreshValues();
    syncOpen(); syncStatus(); syncCube(); renderDockPanes();
  }
  app.renderAll = renderAll;
  for (const k of Object.keys(body)) wireNums(body[k]);
  let pend = false;
  const soon = () => { if (pend) return; pend = true; requestAnimationFrame(() => { pend = false; renderAll(); }); };
  app.on(what => {
    if (what === 'compiled') { const sb = $('statsBox'); if (sb) sb.innerHTML = statsHTML(app.F && app.F.L); syncStatus(); return; }
    if (what === 'phone') { placePanels(); if (!app.phone) openSheet(false); measureSheet(); }
    if (what === 'cam') { syncStatus(); return; }
    soon();
  });
  setInterval(() => { const sb = $('statsBox'); if (sb && !shell.scene.hidden) sb.innerHTML = statsHTML(app.F && app.F.L); }, 1000);
  placePanels();
  renderAll();
}
