// ============================================================================
//  WATCH MOVEMENT  ·  calibres/index.js — the movements the page can show
// ────────────────────────────────────────────────────────────────────────────
//  Each entry is a DOM-free calibre module (default export). The scene for
//  each id is in scenes/<id>.js. Order here is the order of the picker.
// ============================================================================
import lever from './lever.js';
import tourbillon from './tourbillon.js';
import automatic from './automatic.js';
import verge from './verge.js';

export const CALIBRES = [lever, tourbillon, automatic, verge];
export const byId = id => CALIBRES.find(c => c.id === id);
