// ============================================================================
//  WATCH MOVEMENT  ·  calibres/index.js — the movements the page can show
// ────────────────────────────────────────────────────────────────────────────
//  Each entry is a DOM-free calibre module (default export). The scene for
//  each id is in scenes/<id>.js. Order here is the order of the picker.
// ============================================================================
import lever from './lever.js';
import tourbillon from './tourbillon.js';

export const CALIBRES = [lever, tourbillon];
export const byId = id => CALIBRES.find(c => c.id === id);
