// ============================================================================
//  WISHLIST  ·  lib/wishlist.js — Steam wishlist links with UTM tags
// ----------------------------------------------------------------------------
//  Each link from the site to the Stella Nova Steam page has UTM tags.
//  Steamworks UTM Analytics then shows the sim and the button that sent
//  each store visit, and the wishlists that came from it.
//
//    utm_source    davesgames.io
//    utm_medium    the button: sidebar, topbar, chip (shell-free page), home
//    utm_campaign  site
//    utm_content   the page folder under pages/, for example orbital
//
//  The folder name, not the nav key, is the page id. The shell and a page
//  that opens without the shell then give the same utm_content to one sim.
//
//  Readers
//    index.html (shell)   tags #sb-wishlist and #tb-wishlist in markTab
//    pages/*/index.html   load this script after lib/gpu-guard.js. When a
//                         page opens without the shell (window.top is the
//                         page), the script adds one small chip that links
//                         to Steam. In the shell, the script adds nothing.
//
//  Classic script, no ES modules, so it also runs on file://.
//  It sets window.snWishlist = { STORE, url, pageKey }.
//
//  grep -n targets: "function url", "function pageKey", "function mountChip"
// ============================================================================
(function () {
  if (window.snWishlist) return;
  var STORE = 'https://store.steampowered.com/app/4474070/Stella_Nova/';
  var CHIP_HIDE_KEY = 'sn-wl-chip-hidden';

  // url('orbital', 'sidebar') -> the store URL with the four UTM tags.
  // An empty content leaves out utm_content.
  function url(content, medium) {
    var q = 'utm_source=davesgames.io&utm_medium=' + encodeURIComponent(medium || 'site') +
      '&utm_campaign=site';
    if (content) q += '&utm_content=' + encodeURIComponent(content);
    return STORE + '?' + q;
  }

  // pageKey('pages/orbital/index.html') -> 'orbital'. Also takes a full
  // pathname such as /stella-nova/pages/orbital/. No match gives ''.
  function pageKey(path) {
    var m = /(?:^|\/)pages\/([^/]+)\//.exec(String(path || ''));
    return m ? m[1] : '';
  }

  window.snWishlist = { STORE: STORE, url: url, pageKey: pageKey };

  // The chip is for a page that opens without the shell, for example from
  // a search result. The shell shows its own buttons, and the home page has
  // its own links, so neither gets a chip. A shadow root keeps the page CSS
  // off the chip. The close button hides the chip for the browser session.
  // The chip is a thin vertical tab on the left edge at mid-height. Sim
  // docks and HUDs sit at the corners and the top and bottom edges, and a
  // corner chip covered dock buttons on phones (roche-limit, wind-tunnel).
  // With a mouse, the tab hides all but an 8 px gold strip and slides out
  // on hover or focus. A full tab clipped the labels of left control panels
  // on desktop (gravity, wave-membrane, wind-tunnel).
  var top;
  try { top = window.top === window; } catch (e) { top = false; }
  var key = pageKey(location.pathname);
  if (!top || !key || key === 'home') return;
  try { if (sessionStorage.getItem(CHIP_HIDE_KEY) === '1') return; } catch (e) {}

  function mountChip() {
    if (!document.body || document.getElementById('sn-wishlist-chip')) return;
    var host = document.createElement('div');
    host.id = 'sn-wishlist-chip';
    host.style.cssText = 'position:fixed;z-index:2147483000;left:env(safe-area-inset-left,0px);top:50%;transform:translateY(-50%);';
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    root.innerHTML =
      '<style>' +
      ':host{all:initial}' +
      '.w{display:flex;flex-direction:column;align-items:center;gap:2px;padding:3px 3px 3px 0;border-radius:0 14px 14px 0;background:rgba(10,12,18,.82);' +
      'box-shadow:0 6px 22px -8px rgba(0,0,0,.7);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}' +
      'a{display:inline-flex;align-items:center;gap:6px;writing-mode:vertical-rl;transform:rotate(180deg);min-width:28px;padding:12px 0;border-radius:11px 0 0 11px;' +
      'background:#ffb31a linear-gradient(135deg,#ffd65c,#ffb31a 55%,#ff8a3d);color:#1a1204;text-decoration:none;' +
      'font:600 13px/1 "Space Grotesk",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;white-space:nowrap}' +
      'a:hover{filter:brightness(1.08)}' +
      'button{all:unset;cursor:pointer;display:grid;place-items:center;width:28px;height:28px;border-radius:50%;' +
      'color:#9fb1c9;font:400 17px/1 ui-sans-serif,system-ui,sans-serif}' +
      'button:hover{color:#fff;background:rgba(150,200,255,.12)}' +
      '@media (hover:hover) and (pointer:fine){.w{transform:translateX(calc(8px - 100%));transition:transform .2s cubic-bezier(.2,.7,.2,1)}' +
      '.w:hover,.w:focus-within{transform:none}}' +
      '@media (pointer:coarse){a{min-width:34px;padding:14px 0}button{width:34px;height:40px}}' +
      '</style>' +
      '<div class="w"><a target="_blank" rel="noopener" title="Stella Nova on Steam">&#9733; Wishlist</a>' +
      '<button type="button" aria-label="Hide the wishlist button">&times;</button></div>';
    root.querySelector('a').href = url(key, 'chip');
    root.querySelector('button').addEventListener('click', function () {
      host.remove();
      try { sessionStorage.setItem(CHIP_HIDE_KEY, '1'); } catch (e) {}
    });
    document.body.appendChild(host);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountChip);
  else mountChip();
})();
