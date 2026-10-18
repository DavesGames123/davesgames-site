// ============================================================================
//  DLA TERRAIN  ·  world/water-tool.js — the "Add water" mode (package WATER)
// ----------------------------------------------------------------------------
//  createWaterTool({ canvas, app, pick, hydro, apply, toast }) -> tool
//    tool.active, tool.setActive(on), tool.toggle(), tool.undo(),
//    tool.canUndo(), tool.reset() (a new terrain clears the undo list),
//    tool.onChange = fn(tool) (the UI buttons follow it)
//  While the mode is on, a tap or a click on the ground (a press that moves
//  under 8 px and ends in 400 ms) floods the basin under it to its spill
//  level (hydro.addWaterAt), or scoops a bowl first where there is none.
//  Drags still move the camera: the tool only listens, it never stops an
//  event. Escape leaves the mode; Cmd/Ctrl+Z (and the Undo button) undo
//  the last lake. pick(nx, ny) -> [x, y, z] | null: the ground under a
//  point in NDC. apply(t) uploads the changed terrain (main.js: tg.finish).
//  hydro: world/hydro-lakes.js, or a function that returns it (it loads
//  after the tool is made).
//
//  grep -n targets: "export function createWaterTool", "function onUp", "tool.undo"
// ============================================================================

const MAX_UNDO = 24;
const TAP_PX = 8, TAP_MS = 400;

export function createWaterTool({ canvas, app, pick, hydro, apply, toast = () => {} }) {
  const stack = [];
  let down = null, termRef = null;
  const tool = { active: false, onChange: null };
  const hy = () => (typeof hydro === 'function' ? hydro() : hydro);
  const changed = () => { if (tool.onChange) try { tool.onChange(tool); } catch (e) { console.warn(e); } };
  const ndc = (x, y) => {
    const r = canvas.getBoundingClientRect();
    const w = r.width || innerWidth, h = r.height || innerHeight;
    return [2 * (x - (r.left || 0)) / w - 1, 1 - 2 * (y - (r.top || 0)) / h];
  };
  function same() {
    // the undo list belongs to one terrain object
    if (termRef !== app.terrain) { stack.length = 0; termRef = app.terrain; }
  }
  tool.setActive = (on) => {
    tool.active = !!on;
    canvas.style.cursor = tool.active ? 'crosshair' : '';
    if (tool.active) toast('Add water: tap the ground to fill its basin (Esc to stop)');
    changed();
  };
  tool.toggle = () => tool.setActive(!tool.active);
  tool.canUndo = () => { same(); return stack.length > 0; };
  tool.reset = () => { stack.length = 0; termRef = app.terrain; changed(); };
  tool.floodAt = (x, z) => {
    const t = app.terrain;
    const h = hy();
    if (!t || !h || app.saverRun) return null;
    same();
    const r = h.addWaterAt(t, x, z, { radius: Math.max(120, t.worldSize / t.n * 8) });
    if (!r.ok) {
      const why = { sea: 'That is the sea', lake: 'That is a lake already', edge: 'Too near the edge of the world', spills: 'The water runs away there', 'too big': 'That basin is too large' }[r.reason] || r.reason;
      toast(why);
      return r;
    }
    stack.push(r.edit);
    if (stack.length > MAX_UNDO) stack.shift();
    apply(t);
    const km2 = r.lake.area / 1e6;
    toast(`${r.scooped ? 'New pond' : 'Lake'} at ${Math.round(r.lake.level)} m: ${km2 < 0.1 ? Math.round(r.lake.area) + ' m²' : km2.toFixed(2) + ' km²'}`);
    changed();
    return r;
  };
  tool.undo = () => {
    same();
    const e = stack.pop();
    if (!e || !app.terrain || !hy()) return false;
    hy().undoWaterEdit(app.terrain, e);
    apply(app.terrain);
    toast('Lake removed');
    changed();
    return true;
  };
  function onDown(e) {
    if (!tool.active || (e.pointerType === 'mouse' && e.button !== 0)) { down = null; return; }
    down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
  }
  function onUp(e) {
    const d = down;
    down = null;
    if (!tool.active || !d || d.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_PX || performance.now() - d.t > TAP_MS) return;
    const p = pick(...ndc(e.clientX, e.clientY));
    if (!p) { toast('No ground there'); return; }
    tool.floodAt(p[0], p[2]);
  }
  canvas.addEventListener('pointerdown', onDown, true);
  canvas.addEventListener('pointerup', onUp, true);
  canvas.addEventListener('pointercancel', () => { down = null; }, true);
  addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (e.key === 'Escape' && tool.active) tool.setActive(false);
    else if (e.code === 'KeyZ' && (e.metaKey || e.ctrlKey) && !e.shiftKey && tool.canUndo()) { e.preventDefault(); tool.undo(); }
  });
  return tool;
}
