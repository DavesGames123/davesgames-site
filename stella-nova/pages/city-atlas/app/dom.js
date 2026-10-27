// ============================================================================
//  DOM  ·  city-atlas/app/dom.js — page elements and browser queries
// ----------------------------------------------------------------------------
//  The elements of index.html that the modules of app/ share, the element
//  factory, the device class (phone, tablet), the session store of the last
//  city, the page mark of the shell plate and the default view at the
//  window size. This file reads document at load.
//
//  grep -n targets
//    element lookup ....... "export const $"
//    shared elements ...... "export const canvas"
//    element factory ...... "export const el"
//    device class ......... "export function device"
//    last city store ...... "export function storeGet"
//    page mark ............ "export function pageMark"
//    default view ......... "export const homeView"
// ============================================================================

import { STORE_KEY } from './state.js';
import { defaultView } from './view.js';

export const $ = (id) => document.getElementById(id);
export const canvas = $('map');
export const overlay = $('overlay');
export const fadeEl = $('fade');
export const loadingEl = $('loading');
export const fallbackEl = $('fallback');
export const captionEl = $('caption');
export const atlasEl = $('atlas');
export const layersEl = $('layers');
export const scrim = $('scrim');
export const headEl = $('head');
export const footEl = $('foot');
export const scrubEl = $('scrub');

export const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

export const coarse = matchMedia('(pointer: coarse)');
export function device() {
  const short = Math.min(window.innerWidth, window.innerHeight);
  const phone = coarse.matches && short < 600;
  return { phone, tablet: coarse.matches && !phone };
}

export function storeGet() { try { return sessionStorage.getItem(STORE_KEY); } catch { return null; } }
export function storeSet(v) { try { sessionStorage.setItem(STORE_KEY, v); } catch { /* private mode */ } }

// PAGE MARK. The number and the section of this page, counted as the saver
// plate counts them (lib/screensaver.js allPages). The section colour goes to --c.
export function pageMark() {
  const cat = window.SN_SAVER_CATALOG?.pages ?? {};
  let n = 0, hit = null;
  for (const r of window.SN_NAV ?? []) for (const c of r.constellations) for (const g of c.groups) for (const p of g.p) {
    if (p[0] === 'home' || cat[p[0]]?.tier === 'excluded') continue;
    n++;
    if (p[0] === 'city-atlas') hit = { n, con: c.label, color: c.color };
  }
  if (!hit) return { text: 'City atlas', color: null };
  return { text: `No. ${String(hit.n).padStart(3, '0')} · ${hit.con}`, color: hit.color };
}

// app/view.js defaultView of city meta m at the window size.
export const homeView = (m) => defaultView(m, window.innerWidth, window.innerHeight);
