// ============================================================================
//  MATERIAL STUDIO  ·  panels/util.js — numbers, strings and localStorage
// ────────────────────────────────────────────────────────────────────────────
//  Pure helpers with no DOM and no app state: clamp, deep clone and
//  compare, the number format of the param fields, the typed-number
//  parser, the file-name slug, and the localStorage pair under the
//  "material-studio." prefix.
//
//  GREP TARGETS
//      LS lsGet lsSet clamp clone same decimals fmt evalNum slug
// ============================================================================


const LS = 'material-studio.';
export function lsGet(k, d) { try { const v = localStorage.getItem(LS + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
export function lsSet(k, v) { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const clone = v => (v == null || typeof v !== 'object') ? v : JSON.parse(JSON.stringify(v));
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const decimals = step => (!(step > 0) || step >= 1) ? 0 : Math.min(5, Math.ceil(-Math.log10(step) - 1e-9));
export function fmt(v, step) {
  if (!Number.isFinite(v)) return String(v);
  const d = decimals(step);
  return d === 0 ? String(Math.round(v)) : v.toFixed(d);
}
/** Parse a typed number. Simple arithmetic is allowed: "0.5*2", "1/3". */
export function evalNum(s) {
  s = String(s).trim().replace(/,/g, '.');
  if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return parseFloat(s);
  if (!/^[\d\s.+\-*/()e]+$/i.test(s)) return NaN;
  try { const v = Function('"use strict";return (' + s + ')')(); return typeof v === 'number' ? v : NaN; } catch (e) { return NaN; }
}

export const slug = s => String(s || 'material').trim().replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '') || 'material';
