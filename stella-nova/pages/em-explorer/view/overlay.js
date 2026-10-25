// ============================================================================
//  VIEW OVERLAY  ·  DOM layer over the canvas: scale bar, readout, slice rail
// ----------------------------------------------------------------------------
//  The overlay is a sibling of the canvas with the same box. It holds the
//  scale bar and coordinate readout (bottom right, left of the minimap) and
//  the slice rail (right edge, a 44 px hit area). The minimap is drawn in GL by the viewer; the
//  overlay only gives it a caption. Insets keep all parts clear of the page
//  dock. CORE can turn the overlay off (overlay: false) and draw its own
//  from state().
//
//  Theme: the CSS custom properties --emv-fg, --emv-dim, --emv-panel,
//  --emv-accent on any ancestor override the defaults.
//
//  GREP MAP
//    grep -n 'const CSS'            all overlay styles
//    grep -n 'export function createOverlay'
//    grep -n 'update(info)'         the per-frame text and bar update
//    grep -n 'rail'                 slice rail and its drag
// ============================================================================

const CSS = `
.emv-ov{position:absolute;pointer-events:none;overflow:hidden;font-family:var(--sci-sans,Inter,system-ui,sans-serif);color:var(--emv-fg,#eef2f4);
  -webkit-user-select:none;user-select:none;contain:layout}
.emv-ov [hidden]{display:none!important}
.emv-bl{position:absolute;right:0;bottom:0;display:flex;flex-direction:column;gap:6px;align-items:flex-end;text-align:right}
.emv-bar{display:flex;flex-direction:column;align-items:flex-end;gap:3px}
.emv-bar-l{font-size:12px;line-height:1;font-variant-numeric:tabular-nums;text-shadow:0 1px 2px rgba(0,0,0,.85),0 0 6px rgba(0,0,0,.6)}
.emv-bar-r{height:6px;border:2px solid currentColor;border-top:0;box-sizing:border-box;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.8));transition:width .18s ease-out}
.emv-read{font-family:var(--sci-mono,ui-monospace,Menlo,monospace);font-size:11px;line-height:1.35;color:var(--emv-dim,rgba(238,242,244,.78));
  font-variant-numeric:tabular-nums;white-space:nowrap;text-shadow:0 1px 2px rgba(0,0,0,.9)}
.emv-read b{font-weight:500;color:var(--emv-fg,#eef2f4)}
.emv-load{display:inline-block;width:6px;height:6px;border-radius:50%;margin-left:6px;background:var(--emv-accent,#62c4ff);vertical-align:1px;
  animation:emv-pulse 1s ease-in-out infinite}
@keyframes emv-pulse{50%{opacity:.25}}
.emv-rail{position:absolute;right:0;width:44px;pointer-events:auto;touch-action:none;cursor:ns-resize}
.emv-rail-t{position:absolute;left:50%;top:0;bottom:0;width:2px;margin-left:-1px;border-radius:1px;background:rgba(238,242,244,.22);
  box-shadow:0 0 0 1px rgba(0,0,0,.25)}
.emv-rail-k{position:absolute;left:50%;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:var(--emv-fg,#eef2f4);
  box-shadow:0 1px 4px rgba(0,0,0,.6);transition:transform .12s}
.emv-rail.drag .emv-rail-k{transform:scale(1.25)}
.emv-rail-l{position:absolute;right:30px;transform:translateY(-50%);font-family:var(--sci-mono,ui-monospace,Menlo,monospace);font-size:11px;
  white-space:nowrap;padding:3px 7px;border-radius:6px;background:var(--emv-panel,rgba(12,16,20,.72));color:var(--emv-fg,#eef2f4);
  opacity:0;transition:opacity .2s;pointer-events:none;font-variant-numeric:tabular-nums}
.emv-rail:hover .emv-rail-l,.emv-rail.drag .emv-rail-l,.emv-rail.show .emv-rail-l{opacity:1}
.emv-mm-l{position:absolute;font-size:11px;line-height:1;color:var(--emv-dim,rgba(238,242,244,.78));text-shadow:0 1px 2px rgba(0,0,0,.9);
  font-variant-numeric:tabular-nums;white-space:nowrap}
.emv-msg{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);max-width:min(80%,420px);text-align:center;font-size:14px;line-height:1.45;
  padding:12px 16px;border-radius:10px;background:var(--emv-panel,rgba(12,16,20,.78));color:var(--emv-fg,#eef2f4)}
@media (pointer:coarse){.emv-read{font-size:10.5px}}
`;

const fmtInt = n => Math.round(n).toLocaleString('en-US').replace(/,/g, ' ');

export function createOverlay(canvas, opts = {}) {
  const doc = canvas.ownerDocument;
  if (!doc.getElementById('emv-style')) {
    const st = doc.createElement('style'); st.id = 'emv-style'; st.textContent = CSS;
    doc.head.appendChild(st);
  }
  const root = doc.createElement('div');
  root.className = 'emv-ov';
  root.innerHTML = `
    <div class="emv-bl"><div class="emv-bar"><span class="emv-bar-l"></span><div class="emv-bar-r"></div></div>
      <div class="emv-read"></div></div>
    <div class="emv-rail" role="slider" aria-label="Slice" tabindex="-1"><div class="emv-rail-t"></div><div class="emv-rail-k"></div><div class="emv-rail-l"></div></div>
    <div class="emv-mm-l" hidden></div>
    <div class="emv-msg" hidden></div>`;
  canvas.insertAdjacentElement('afterend', root);
  const q = s => root.querySelector(s);
  const el = { bl: q('.emv-bl'), barL: q('.emv-bar-l'), barR: q('.emv-bar-r'), read: q('.emv-read'), rail: q('.emv-rail'),
    knob: q('.emv-rail-k'), railL: q('.emv-rail-l'), mmL: q('.emv-mm-l'), msg: q('.emv-msg') };
  let ins = { top: 0, right: 0, bottom: 0, left: 0 };
  let last = {};
  let frac = 0;
  let mmBox = null, mmSig = '';
  const arrange = () => {
    const pad = 14, W = canvas.clientWidth || 0;
    const right = mmBox ? Math.max(ins.right + pad, W - mmBox.x + 12) : ins.right + pad + 30;
    el.bl.style.right = right + 'px';
    el.bl.style.bottom = (ins.bottom + pad) + 'px';
    el.rail.style.right = (ins.right + 2) + 'px';
    el.rail.style.top = (ins.top + 18) + 'px';
    el.rail.style.bottom = (mmBox ? mmBox.bottomGap + 22 : ins.bottom + pad + 8) + 'px';
  };

  // rail drag: frac 0 at the top, 1 at the bottom
  let drag = null;
  const railFrac = e => {
    const r = el.rail.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientY - r.top - 8) / Math.max(1, r.height - 16)));
  };
  el.rail.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    drag = e.pointerId; el.rail.setPointerCapture?.(e.pointerId); el.rail.classList.add('drag');
    opts.onSlice && opts.onSlice(railFrac(e), 'start');
  });
  el.rail.addEventListener('pointermove', e => { if (drag === e.pointerId) opts.onSlice && opts.onSlice(railFrac(e), 'move'); });
  const end = e => { if (drag !== e.pointerId) return; drag = null; el.rail.classList.remove('drag'); opts.onSlice && opts.onSlice(railFrac(e), 'end'); };
  el.rail.addEventListener('pointerup', end);
  el.rail.addEventListener('pointercancel', end);
  el.rail.addEventListener('wheel', e => { e.preventDefault(); e.stopPropagation(); opts.onSliceStep && opts.onSliceStep(Math.sign(e.deltaY || e.deltaX)); }, { passive: false });

  const ov = {
    root,
    place() {
      const win = doc.defaultView;
      const fixed = win && win.getComputedStyle && win.getComputedStyle(canvas).position === 'fixed';
      root.style.position = fixed ? 'fixed' : 'absolute';
      const r = fixed ? canvas.getBoundingClientRect() : null;
      root.style.left = (fixed ? r.left : canvas.offsetLeft) + 'px';
      root.style.top = (fixed ? r.top : canvas.offsetTop) + 'px';
      root.style.width = canvas.clientWidth + 'px';
      root.style.height = canvas.clientHeight + 'px';
    },
    // The lower right: the minimap in the corner, the scale bar and readout
    // to its left, the slice rail on the right edge above them.
    setInsets(i) { ins = { ...ins, ...i }; arrange(); },
    // mm: { x, y, w, h, bottomGap } CSS px of the shown minimap, or null
    setMinimap(mm, label) {
      const sig = mm ? `${mm.x},${mm.y},${mm.w},${mm.h}` : '';
      if (sig !== mmSig) { mmSig = sig; mmBox = mm; arrange(); }
      if (!mm) { el.mmL.hidden = true; return; }
      el.mmL.hidden = false;
      el.mmL.style.left = mm.x + 'px';
      el.mmL.style.top = (mm.y - 15) + 'px';
      if (label !== last.mm) { el.mmL.textContent = label; last.mm = label; }
    },
    message(text) { el.msg.hidden = !text; if (text) el.msg.textContent = text; },
    showRail(b) { el.rail.hidden = !b; },
    flashRail() { el.rail.classList.add('show'); clearTimeout(ov._ft); ov._ft = setTimeout(() => el.rail.classList.remove('show'), 900); },
    update(info) {
      if (info.bar && info.bar.label !== last.bar) { el.barL.textContent = info.bar.label; last.bar = info.bar.label; }
      if (info.bar) { const w = Math.round(info.bar.px) + 'px'; if (w !== last.barW) { el.barR.style.width = w; last.barW = w; } }
      const c = info.cursor;
      const ax = info.axes || ['x', 'y', 'z'];
      const html = (c ? `<b>${ax[0]}</b> ${fmtInt(c[0])}  <b>${ax[1]}</b> ${fmtInt(c[1])}  <b>${ax[2]}</b> ${fmtInt(c[2])} vx` : '&nbsp;') +
        `<br>${info.res}${info.loading ? '<span class="emv-load"></span>' : ''}`;
      if (html !== last.read) { el.read.innerHTML = html; last.read = html; }
      if (info.slice) {
        const f = info.slice.count > 1 ? info.slice.index / (info.slice.count - 1) : 0;
        if (Math.abs(f - frac) > 1e-6 || last.knob === undefined) {
          frac = f; last.knob = 1;
          el.knob.style.top = `calc(8px + ${f} * (100% - 16px))`;
          el.railL.style.top = `calc(8px + ${f} * (100% - 16px))`;
        }
        const t = `${info.slice.axis} ${fmtInt(info.slice.index)} / ${fmtInt(info.slice.count)}`;
        if (t !== last.rail) {
          el.railL.textContent = t; last.rail = t;
          el.rail.setAttribute('aria-valuenow', String(info.slice.index));
          el.rail.setAttribute('aria-valuemax', String(info.slice.count - 1));
        }
      }
    },
    dispose() { root.remove(); },
  };
  ov.place(); ov.setInsets({});
  return ov;
}
