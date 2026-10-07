// ============================================================================
//  tools/wishlist-check.mjs — check the Steam wishlist links and UTM tags
// ----------------------------------------------------------------------------
//  Usage:
//    node tools/wishlist-check.mjs
//
//  The tool runs stella-nova/lib/wishlist.js in a node vm with no DOM, and
//  then reads the page files. It fails (exit 1) when one of these is false:
//    1. url(content, medium) gives the store URL with the four UTM tags.
//    2. pageKey() gives the folder under pages/ for shell and site paths.
//    3. Each page folder with an index.html, other than home, loads
//       ../../lib/wishlist.js directly after ../../lib/gpu-guard.js.
//    4. The shell loads lib/wishlist.js and tags both wishlist links.
//    5. No Stella Nova store link in the shell or the home page is untagged.
//
//  The chip (a page without the shell) needs a browser. This tool does not
//  check the chip.
//
//  grep -n targets: "function check", "loader order", "untagged"
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SN = path.join(ROOT, 'stella-nova');
const STORE = 'https://store.steampowered.com/app/4474070/Stella_Nova/';
let fails = 0, passes = 0;
function check(ok, msg) { if (ok) passes++; else { fails++; console.log('FAIL ' + msg); } }

// 1-2. url and pageKey, with window.top not equal to window so no chip mounts.
const win = {};
win.top = {};
const ctx = vm.createContext({ window: win, location: { pathname: '/stella-nova/pages/orbital/index.html' } });
vm.runInContext(fs.readFileSync(path.join(SN, 'lib/wishlist.js'), 'utf8'), ctx);
const W = win.snWishlist;
check(W && W.STORE === STORE, 'snWishlist.STORE is the Stella Nova store URL');
if (W) {
  const u = new URL(W.url('orbital', 'sidebar'));
  check(u.origin + u.pathname === STORE, 'url keeps the store path');
  check(u.searchParams.get('utm_source') === 'davesgames.io', 'utm_source');
  check(u.searchParams.get('utm_medium') === 'sidebar', 'utm_medium');
  check(u.searchParams.get('utm_campaign') === 'site', 'utm_campaign');
  check(u.searchParams.get('utm_content') === 'orbital', 'utm_content');
  check(!new URL(W.url('', 'topbar')).searchParams.has('utm_content'), 'empty content leaves out utm_content');
  check(new URL(W.url('a b&c', 'chip')).searchParams.get('utm_content') === 'a b&c', 'content is encoded');
  check(W.pageKey('pages/orbital/index.html') === 'orbital', 'pageKey of a nav path');
  check(W.pageKey('/stella-nova/pages/wind-tunnel/') === 'wind-tunnel', 'pageKey of a site pathname');
  check(W.pageKey('/stella-nova/index.html') === '', 'pageKey of the shell is empty');
}

// 3. loader order in every page.
const GUARD = '<script src="../../lib/gpu-guard.js"></script>';
const LOADER = '<script src="../../lib/wishlist.js"></script>';
let pages = 0;
for (const dir of fs.readdirSync(path.join(SN, 'pages')).sort()) {
  const f = path.join(SN, 'pages', dir, 'index.html');
  if (dir === 'home' || !fs.existsSync(f)) continue;
  pages++;
  const s = fs.readFileSync(f, 'utf8');
  check(s.includes(GUARD + '\n' + LOADER + '\n'), `pages/${dir}/index.html loads wishlist.js after gpu-guard.js`);
}

// 4. shell.
const shell = fs.readFileSync(path.join(SN, 'index.html'), 'utf8');
check(shell.includes('<script src="lib/wishlist.js"></script>'), 'shell loads lib/wishlist.js');
check(/id="tb-wishlist"/.test(shell), 'shell has #tb-wishlist');
check(/function markTab\(id\)\{wishlistTag\(id\);/.test(shell), 'markTab tags the wishlist links');

// 5. untagged store links in the shell (static href is the fallback before
// markTab runs) and in the home page.
for (const rel of ['pages/home/index.html', 'pages/home/sectors.js']) {
  const s = fs.readFileSync(path.join(SN, rel), 'utf8');
  const bare = s.split(STORE).slice(1).filter(t => !t.startsWith('?utm_source=davesgames.io')).length;
  check(bare === 0, `${rel}: ${bare} untagged store links`);
}

console.log(`wishlist-check: ${passes} passed, ${fails} failed (${pages} pages)`);
process.exit(fails ? 1 : 0);
