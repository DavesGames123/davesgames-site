// ============================================================================
//  ULAM SPIRAL  ·  app/dom.js — the page elements, media queries, the toast
// ----------------------------------------------------------------------------
//  The first app/ module that touches the browser. It reads the media
//  queries and takes the 2D contexts of #ov and #mini once, at import, in
//  the order main.js used before the split (the shell may later call
//  getContext('webgpu') on every canvas of a released page).
//
//  GREP MAP
//    grep -n 'export const PHONE_Q'   the phone layout query
//    grep -n 'export const cv'        #gl, #ov and the 2D contexts
//    grep -n 'export function toast'  the short message at the bottom
// ============================================================================

export const $ = id => document.getElementById(id);
export const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
export const TOUCH_Q = matchMedia('(pointer:coarse)');
export const cv = $('gl'), ov = $('ov'), oc = ov.getContext('2d'), miniCtx = $('mini').getContext('2d');

let toastT = 0;
export function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600); }
