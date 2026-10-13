// ============================================================================
//  BREADBOARD LAB  ·  parts/defs/util.js — short builders for part defs
// ----------------------------------------------------------------------------
//  The def files are data. These helpers only shorten the writing: a param
//  row, a slot row, a row of pins, the pins of a DIP.
//
//  DIP PINS. Pin 1 is at (0, 0) and pins 1..N/2 run along +X. Pins N/2+1..N
//  come back along the row 3 grid units toward -Z (0.3 inch). So with pin 1
//  in hole f10, pin N/2+1 lands in e(10 + N/2 - 1) (CONTRACT 7, PARTS tests).
//
//  GREP MAP
//    num / int / en / bool / str .. param rows
//    slot ....................... a material slot row
//    row ........................ pins in a line along +X
//    dip ........................ DIP pin table with labels
//    el ......................... an electrical element row
// ============================================================================

export const num = (key, label, unit, def, min, max, more = {}) => ({ key, label, unit, type: 'number', default: def, min, max, ...more });
export const int = (key, label, def, min, max, more = {}) => ({ key, label, type: 'int', default: def, min, max, step: 1, ...more });
export const en = (key, label, def, options, more = {}) => ({ key, label, type: 'enum', default: def, options, ...more });
export const bool = (key, label, def, more = {}) => ({ key, label, type: 'bool', default: def, ...more });
export const str = (key, label, def, more = {}) => ({ key, label, type: 'string', default: def, ...more });
export const slot = (key, label, def) => ({ key, label, default: def });

// names in a line: x = start + i * step, at z
export const row = (names, z = 0, x0 = 0, step = 1, more = {}) => names.map((name, i) => ({ name, x: x0 + i * step, z, ...more }));

// DIP-n with labels (index 0 = pin 1). Pin names are '1'..'n'.
export function dip(n, labels = []) {
  const h = n / 2, out = [];
  for (let i = 1; i <= n; i++) {
    const x = i <= h ? i - 1 : n - i, z = i <= h ? 0 : -3;
    out.push({ name: String(i), label: labels[i - 1] || String(i), x, z });
  }
  return out;
}

export const el = (id, type, nodes, params = {}, more = {}) => ({ id, type, nodes, params, ...more });
