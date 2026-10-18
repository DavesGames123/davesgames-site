// ============================================================================
//  SHARE URL  ·  lib/share-url.js — the link that the shell gives out
// ----------------------------------------------------------------------------
//  The shell URL is /stella-nova/#<key>[/<route>]. Link-preview bots do not
//  send the hash, so a hash URL always shows the card of the shell. The
//  deploy writes one preview page per registered page (tools/share-pages.mjs):
//
//    https://davesgames.io/stella-nova/<key>/   ->  /stella-nova/#<key>
//
//  This file maps a shell hash to that share URL, and adds the Share button
//  to the top bar (#tb-share, before #tb-wishlist). On a touch screen with
//  navigator.share, the button opens the system share sheet. Else it copies
//  the share URL to the clipboard.
//
//  The address bar keeps the hash URL. A path change with replaceState would
//  change how the relative URLs of the shell resolve (lib/, pages/).
//
//  API (window.snShare)
//    url(hash)    the share URL for a shell hash, for example '#wiki/e/x' ->
//                 'https://davesgames.io/stella-nova/wiki/#e/x'. Home and an
//                 empty hash give the shell URL. A key with no preview page
//                 (a hidden page, an unknown key) keeps the hash URL.
//    share()      share or copy the URL of the current page (the button)
//
//  Classic script. It needs lib/nav-data.js first (window.snPages).
//  tools/share-check.mjs tests it in node.
//
//  grep -n targets
//    site origin .......... "var SITE"
//    hash -> URL .......... "function shareUrl"
//    button ............... "function addButton"
// ============================================================================
(function (w) {
'use strict';
var SITE = 'https://davesgames.io';
var keys = null;

function stubKeys() {
  if (keys) return keys;
  keys = {};
  try { (w.snPages ? w.snPages() : []).forEach(function (p) { if (p.key !== 'home') keys[p.key] = 1; }); } catch (e) {}
  return keys;
}

function shareUrl(hash) {
  var h = String(hash == null ? '' : hash).replace(/^#/, '');
  var i = h.indexOf('/');
  var id = i < 0 ? h : h.slice(0, i), sub = i < 0 ? '' : h.slice(i + 1);
  try { id = decodeURIComponent(id); } catch (e) {}
  if (!id || id === 'home') return SITE + '/stella-nova/';
  if (!stubKeys()[id]) return SITE + '/stella-nova/#' + h;
  return SITE + '/stella-nova/' + id + '/' + (sub ? '#' + sub : '');
}

function flash(btn, text) {
  var lab = btn.querySelector('.tb-share-lab');
  if (!lab) return;
  lab.textContent = text;
  clearTimeout(btn.snT);
  btn.snT = setTimeout(function () { lab.textContent = 'Share'; }, 1600);
}

function share() {
  var url = shareUrl(w.location.hash);
  var btn = document.getElementById('tb-share');
  var touch = w.matchMedia && w.matchMedia('(pointer:coarse)').matches;
  var n = w.navigator;
  if (touch && n.share) {
    return n.share({ title: document.title, url: url }).catch(function () {});
  }
  var done = function () { if (btn) flash(btn, 'Link copied'); };
  var ask = function () { try { w.prompt('Copy this link', url); } catch (e) {} };
  if (n.clipboard && n.clipboard.writeText) return n.clipboard.writeText(url).then(done, ask);
  ask();
  return Promise.resolve();
}

var CSS = '#tb-share{display:inline-flex;flex:none;align-items:center;gap:7px;min-width:44px;min-height:44px;padding:0 14px 0 12px;justify-content:center;border:1px solid var(--border-b,rgba(150,200,255,.18));border-radius:999px;background:none;color:var(--dim,#7f91ad);font:500 .78rem/1 var(--f-sans,system-ui);cursor:pointer;white-space:nowrap;transition:color .15s,border-color .15s}' +
  '#tb-share:hover,#tb-share:focus-visible{color:var(--ink,#eef3fb);border-color:var(--blue,#96c8ff)}' +
  '#tb-share svg{width:18px;height:18px;flex:none}' +
  '@media (max-width:520px){#tb-share{padding:0}#tb-share .tb-share-lab{display:none}}';

function addButton() {
  var bar = document.getElementById('topbar');
  if (!bar || document.getElementById('tb-share')) return;
  var st = document.createElement('style');
  st.id = 'tb-share-css';
  st.textContent = CSS;
  document.head.appendChild(st);
  var b = document.createElement('button');
  b.id = 'tb-share';
  b.type = 'button';
  b.title = 'Copy a link to this page that shows its preview in chats';
  b.setAttribute('aria-label', 'Share a link to this page');
  b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg><span class="tb-share-lab">Share</span>';
  b.addEventListener('click', function () { share(); });
  var wl = document.getElementById('tb-wishlist');
  if (wl && wl.parentNode === bar) bar.insertBefore(b, wl); else bar.appendChild(b);
}

w.snShare = { url: shareUrl, share: share };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addButton); else addButton();
})(window);
