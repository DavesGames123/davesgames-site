// ============================================================================
//  TENSOR CALCULUS  ·  ui/scene-controls.js  ·  the 3D scene box  (CORE)
// ----------------------------------------------------------------------------
//  A pop-up box in the 3D pane: a list of every VIZ scene and the sliders
//  of the scene on screen (VIZ sceneInfo(id).params). A param with def
//  null is animated by the VIZ clock; its "auto" box gives that motion
//  back after a slider move.
//
//  A scene that the reader picks here, or that tensorPage.setScene() sets,
//  is a free scene: CORE stops sending play(step, t) to VIZ, so the scene
//  stays while the TeX and the diagram play the trace. "Follow the steps"
//  gives VIZ the steps again. main.js owns that flag (S.vizFree).
//
//  EXPORTS   (grep -n "export" ui/scene-controls.js)
//      createSceneControls(els, deps) -> { render(), open(), close() }
// ============================================================================

// els: { box, btn }
// deps: { scenes() -> [id], info(id) -> { label, blurb, params }, current()
//   -> { id, params }, onScene(id), onParams(p) }
export function createSceneControls(els, deps) {
  const doc = els.box.ownerDocument;
  const h = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  function render() {
    els.box.replaceChildren();
    const ids = deps.scenes();
    if (!ids.length) { els.box.appendChild(h('p', 'hint', 'The 3D scenes have not loaded.')); return; }
    const cur = deps.current();
    const row = h('label', 'arg');
    row.appendChild(h('span', 'arg-name', 'Scene'));
    const sel = doc.createElement('select');
    for (const id of ids) {
      const inf = deps.info(id) || {};
      const o = h('option', null, inf.label || id.replace(/-/g, ' '));
      o.value = id; sel.appendChild(o);
    }
    if (cur.id && ids.includes(cur.id)) sel.value = cur.id;
    sel.addEventListener('change', () => { deps.onScene(sel.value); render(); });
    row.appendChild(sel);
    els.box.appendChild(row);
    const inf = deps.info(sel.value) || {};
    if (inf.blurb) els.box.appendChild(h('p', 'hint', inf.blurb));
    for (const p of inf.params || []) {
      const r = h('div', 'row');
      r.appendChild(h('span', 'row-name', p.label || p.key));
      const inp = doc.createElement('input');
      inp.type = 'range'; inp.min = p.min; inp.max = p.max; inp.step = p.step || (p.max - p.min) / 100;
      const v = cur.params && cur.params[p.key] != null ? cur.params[p.key] : p.def;
      inp.value = v == null ? (p.min + p.max) / 2 : v;
      inp.setAttribute('aria-label', p.label || p.key);
      const out = h('span', 'row-val', v == null ? 'auto' : (+v).toFixed(2));
      r.append(inp, out);
      let auto = null;
      if (p.def === null) {
        auto = doc.createElement('input'); auto.type = 'checkbox'; auto.checked = v == null; auto.title = 'Animate by time'; auto.setAttribute('aria-label', 'Animate ' + (p.label || p.key));
        auto.addEventListener('change', () => {
          if (auto.checked) { deps.onParams({ [p.key]: null }); out.textContent = 'auto'; }
          else { deps.onParams({ [p.key]: +inp.value }); out.textContent = (+inp.value).toFixed(2); }
        });
        r.appendChild(auto);
      }
      inp.addEventListener('input', () => { if (auto) auto.checked = false; deps.onParams({ [p.key]: +inp.value }); out.textContent = (+inp.value).toFixed(2); });
      els.box.appendChild(r);
    }
  }

  const api = {
    render,
    open() { render(); els.box.hidden = false; if (els.btn) els.btn.setAttribute('aria-expanded', 'true'); },
    close() { els.box.hidden = true; if (els.btn) els.btn.setAttribute('aria-expanded', 'false'); },
  };
  if (els.btn) els.btn.addEventListener('click', () => (els.box.hidden ? api.open() : api.close()));
  return api;
}
