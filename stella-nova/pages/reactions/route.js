// ============================================================================
//  REACTIONS  ·  route.js — the page hash, inside and outside the site shell
// ----------------------------------------------------------------------------
//  The page keeps its state in its own hash (#s=<named>, #c=<class>,
//  #b=<builder ops>). In the site shell the page runs in an iframe, and the
//  shell URL is #<tab>/<route> (stella-nova/index.html, "window.snNav").
//  A replaceState in the frame does not fire hashchange, so the shell URL
//  did not follow, and a share link pointed at the bare page URL.
//
//  setRoute(route)  writes the frame hash and tells the shell (snNav with
//                   'replace': the URL changes, no history entry)
//  shareUrl(route)  the link to give out: the shell URL #<tab>/<route> when
//                   the page runs in the shell, else the page URL
//
//  GREP MAP
//    export function shellOf .... the shell window, or null
//    export function setRoute ... write the route
//    export function shareUrl ... the link for a route
// ============================================================================

export function shellOf(w = globalThis.window) {
  try {
    const p = w && w.parent;
    if (!p || p === w || typeof p.snNav !== 'function') return null;
    void p.location.href;   // a cross-origin parent throws here
    return p;
  } catch (e) { return null; }
}

export function setRoute(route, w = globalThis.window) {
  const r = String(route || '').replace(/^#/, '');
  try { w.history.replaceState(null, '', r ? '#' + r : w.location.pathname); } catch (e) { /* sandboxed */ }
  const p = shellOf(w);
  if (p) { try { p.snNav(r, 'replace'); } catch (e) { /* shell busy */ } }
}

export function shareUrl(route, w = globalThis.window) {
  const r = String(route || '').replace(/^#/, '');
  const p = shellOf(w);
  if (p) {
    const tab = (p.location.hash.replace(/^#/, '').split('/')[0]) || 'reactions';
    return p.location.origin + p.location.pathname + '#' + tab + (r ? '/' + r : '');
  }
  return w.location.origin + w.location.pathname + (r ? '#' + r : '');
}
