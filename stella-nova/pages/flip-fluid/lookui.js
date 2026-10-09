// ============================================================================
//  FLIP WATER  ·  lookui.js  —  the "Look" section of the sheet
// ----------------------------------------------------------------------------
//  Our addition to the Ten Minute Physics port (not upstream code).
//
//  Writes state.colours (looks.js keys) and redraws: the view (water,
//  particles or a field), the water scheme (swatches drawn as gradients of
//  each scheme), the background, the object tint, foam, and for field
//  views the colour map picker of ../ct-lab/colormaps/picker.js with
//  reverse. "Random look" (also the dock button and key L) draws a whole
//  look with looks.js randomLook.
//
//  grep -n targets
//    export function installLook
//    function chips       one row of choice buttons
// ============================================================================
import { SCHEMES, BACKGROUNDS, VIEWS, OBJECT_TINTS, resolveLook, randomLook } from './looks.js';
import { createPicker } from '../ct-lab/colormaps/picker.js';

export function installLook(app, $) {
  const rows = {};
  function set(patch) {
    const c = app.state.colours;
    for (const [k, v] of Object.entries(patch)) { if (v == null) delete c[k]; else c[k] = String(v); }
    sync(); app.writeHash();
  }
  function chips(host, key, table, swatch) {
    host.textContent = '';
    rows[key] = host;
    for (const [id, item] of Object.entries(table)) {
      const b = document.createElement('button');
      b.className = 'chipbtn'; b.dataset.id = id; b.setAttribute('aria-pressed', 'false');
      if (swatch) { const s = document.createElement('i'); s.style.background = swatch(item); b.appendChild(s); }
      b.appendChild(document.createTextNode(item.name));
      b.onclick = () => set({ [key]: id, ...(key === 'view' && VIEWS[id].map ? { map: VIEWS[id].map, rev: null } : {}) });
      host.appendChild(b);
    }
  }
  chips($('lookView'), 'view', VIEWS);
  chips($('lookWater'), 'water', SCHEMES, (s) => `linear-gradient(180deg, ${s.line}, ${s.shallow} 35%, ${s.deep})`);
  chips($('lookBg'), 'bg', BACKGROUNDS, (b) => `linear-gradient(180deg, ${b.top}, ${b.bottom})`);
  chips($('lookObj'), 'obj', OBJECT_TINTS);

  let picker = null;
  try {
    picker = createPicker($('lookMap'), { value: 'turbo', compact: true, label: 'Colour map' });
    picker.addEventListener('change', (e) => set({ map: e.detail.id, rev: e.detail.reverse ? '1' : null }));
  } catch (e) { $('lookMapBox').hidden = true; }

  $('lookFoam').onclick = () => set({ foam: resolveLook(app.state.colours).foam ? '0' : null });
  const random = () => { app.state.colours = randomLook(); sync(); app.writeHash(); };
  $('lookRandom').onclick = random;
  $('bLook').onclick = random;
  $('lookReset').onclick = () => { app.state.colours = {}; sync(); app.writeHash(); };

  function sync() {
    const L = resolveLook(app.state.colours);
    for (const key of ['view', 'water', 'bg', 'obj']) {
      for (const b of rows[key].children) { const on = b.dataset.id === L[key]; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    }
    const field = !!VIEWS[L.view].field;
    $('lookMapBox').hidden = !field || !picker;
    $('lookWaterBox').hidden = field;
    if (picker && field) picker.set({ id: L.map, reverse: L.rev }, { silent: true });
    $('lookFoam').classList.toggle('on', L.foam); $('lookFoam').setAttribute('aria-pressed', L.foam ? 'true' : 'false');
    $('lookFoam').textContent = L.foam ? 'Foam and spray: on' : 'Foam and spray: off';
    app.drawOpts = Object.assign(app.drawOpts || {}, { colours: app.state.colours });
    document.documentElement.style.setProperty('--page-bg', BACKGROUNDS[L.bg].page);
  }
  app.onKey = ((prev) => (k, e) => { if (k === 'l') random(); else if (prev) prev(k, e); })(app.onKey);
  app.syncLook = sync;
  app.randomLook = random;
  sync();
}
