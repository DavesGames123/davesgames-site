// ============================================================================
//  WATCH MOVEMENT  ·  calibres/index.js — the movements the pages can show
// ────────────────────────────────────────────────────────────────────────────
//  Each calibre solves its escapement when its module loads (30-700 ms),
//  so the registry is lazy: CALIBRES holds only what the picker shows, and
//  loadCalibre(id) imports the module when it is needed. The scene for
//  each id is scenes/<id>.js. Order here is the order of the picker.
//  tests.mjs checks that each entry matches its module's own fields.
// ============================================================================
export const CALIBRES = [
  { id: 'lever', name: 'Swiss Lever', kind: 'Pocket watch', era: 'c. 1900 – today' },
  { id: 'tourbillon', name: 'Tourbillon', kind: 'Pocket watch', era: 'Breguet, 1801' },
  { id: 'automatic', name: 'Automatic', kind: 'Wristwatch', era: 'c. 1950 – today' },
  { id: 'verge', name: 'Verge Fusee', kind: 'Pocket watch', era: 'London, c. 1780' },
  { id: 'cylinder', name: 'Cylinder', kind: 'Pocket watch', era: 'Lépine, c. 1850' },
  { id: 'detent', name: 'Detent Chronometer', kind: 'Marine chronometer', era: 'Earnshaw, c. 1780' },
];
export const metaById = id => CALIBRES.find(c => c.id === id);
const cache = new Map();
export function loadCalibre(id) {
  if (!cache.has(id)) cache.set(id, import(`./${id}.js`).then(m => m.default));
  return cache.get(id);
}
export const loadAll = () => Promise.all(CALIBRES.map(c => loadCalibre(c.id)));
