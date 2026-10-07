// ============================================================================
//  tools/stats-check.mjs — check the site stats Worker and its privacy rules
// ----------------------------------------------------------------------------
//  Usage:
//    node tools/stats-check.mjs
//    node tools/stats-check.mjs --url http://127.0.0.1:8789 --key <STATS_KEY>
//                               [--d1 <wrangler --persist-to folder>]
//
//  With no flags, the tool imports stella-nova/pages/stats/worker/worker.js
//  in node and checks the event-to-row rules (rowsFor), error-text cleanup,
//  referrer classes and user-agent families.
//
//  With --url, it also sends event batches to a running Worker (start one
//  with: npx wrangler dev --local --port 8789 --var STATS_KEY:<key>
//  --persist-to <folder>, from the worker folder) and checks the counts
//  that /stats and /live give back. Use an empty D1: the checks expect
//  exact counts. With --d1, it then reads every file in that folder and
//  fails if a test IP address or user agent is stored anywhere.
//
//  grep -n targets: "function check", "unit checks", "http checks", "privacy scan"
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = await import(pathToFileURL(path.join(ROOT, 'stella-nova/pages/stats/worker/worker.js')).href);
const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
let fails = 0, passes = 0;
function check(ok, msg, extra) { if (ok) passes++; else { fails++; console.log('FAIL ' + msg + (extra !== undefined ? '  got ' + JSON.stringify(extra) : '')); } }

// ── unit checks ─────────────────────────────────────────────────────────
const ctx = { br: 'Chrome', os: 'macOS', hour: 13, country: 'IE', region: 'Leinster', continent: 'EU' };
const rows = e => W.rowsFor(e, ctx);
const has = (rs, m, a = '', b = '') => rs.some(r => r[0] === m && r[1] === String(a) && r[2] === String(b));

let r = rows({ t: 'visit', ref: 'www.google.com', us: 'meta', um: 'cpc', uc: 'oct', dev: 'mobile', lang: 'en-IE', scr: '360-413', dpr: '3', dark: 1, rm: 0, touch: 1, gpu: 'yes', gv: 'apple', gl2: 1, mode: 'shell', sw: 1 });
check(has(r, 'visit'), 'visit row');
check(has(r, 'ref', 'search', 'google.com'), 'google is search, www. removed', r.filter(x => x[0] === 'ref'));
check(has(r, 'utm', 'meta', 'cpc') && has(r, 'utmc', 'oct'), 'utm rows');
check(has(r, 'cty', 'IE') && has(r, 'reg', 'IE', 'Leinster') && has(r, 'cont', 'EU'), 'geo rows');
check(has(r, 'gpu', 'Chrome', 'yes') && has(r, 'gpuv', 'apple'), 'gpu rows');
check(has(r, 'dev', 'mobile') && has(r, 'theme', 'dark') && has(r, 'touch', 'yes') && has(r, 'mode', 'shell'), 'audience rows');
check(!has(rows({ t: 'visit', dev: 'fridge' }), 'dev', 'fridge'), 'unknown device class dropped');
check(has(rows({ t: 'visit', ref: '' }), 'ref', 'direct', ''), 'no referrer is direct');
check(has(rows({ t: 'visit', ref: 'old.reddit.com' }), 'ref', 'social', 'old.reddit.com'), 'reddit is social');

r = rows({ t: 'pv', p: 'wind-tunnel', from: 'home', wd: 2, lh: 21, ctx: 'shell' });
check(has(r, 'pv', 'wind-tunnel') && has(r, 'flow', 'home', 'wind-tunnel') && !has(r, 'entry', 'wind-tunnel'), 'pv with from');
check(has(r, 'how', 2, 21) && has(r, 'hr', 13) && has(r, 'ctx', 'shell'), 'pv time rows');
r = rows({ t: 'pv', p: 'gravity' });
check(has(r, 'entry', 'gravity') && has(r, 'flow', '(entry)', 'gravity'), 'pv without from is an entry');
check(rows({ t: 'pv', p: '../etc' }).length === 0 && rows({ t: 'pv', p: 'A B' }).length === 0, 'bad page keys dropped');

r = rows({ t: 'eng', p: 'gravity', s: 42, first: 1, last: 1, tot: 42 });
check(r.some(x => x[0] === 'eng' && x[3] === 1 && x[4] === 42) && has(r, 'engb', '30-60s'), 'eng first+last');
r = rows({ t: 'eng', p: 'gravity', s: 10 });
check(r.length === 1 && r[0][3] === 0 && r[0][4] === 10, 'eng later chunk adds time, not a view', r);

r = rows({ t: 'load', p: 'gravity', ms: 1500, ttfb: 80 });
check(has(r, 'loadb', '1-2s') && r.some(x => x[0] === 'ttfb' && x[4] === 80), 'load rows');
r = rows({ t: 'out', p: 'gravity', host: 'store.steampowered.com', med: 'chip' });
check(has(r, 'wl', 'gravity', 'chip'), 'steam click is a wishlist row');
check(has(rows({ t: 'out', host: 'discord.gg' }), 'out', 'discord.gg'), 'other outbound host');
check(has(rows({ t: 'end', p: 'gravity', depth: 4 }), 'depth', '3-4') && has(rows({ t: 'end', p: 'gravity', depth: 4 }), 'exit', 'gravity'), 'end rows');
check(rows({ t: 'nope' }).length === 0, 'unknown event type dropped');
r = rows({ t: 'end', p: 'gravity', depth: 4, undo: 1 });
check(r.some(x => x[0] === 'exit' && x[3] === -1) && r.some(x => x[0] === 'depth' && x[1] === '3-4' && x[3] === -1), 'end undo takes the exit and depth away', r);
r = rows({ t: 'eng', p: 'gravity', s: 0, undo: 1, tot: 42 });
check(r.length === 1 && r[0][0] === 'engb' && r[0][1] === '30-60s' && r[0][3] === -1, 'eng undo takes only the time bin away', r);

const et = W.errText('Failed to fetch https://x.io/a?q=dave@mail.com at /stella-nova/pages/x/main.js:120:7 "secret text"');
check(!/x\.io|dave|mail|secret|120|stella-nova/.test(et), 'errText strips URLs, paths, numbers and quotes', et);
check(W.errText('a'.repeat(400)).length <= 90, 'errText length cap');
check(W.browserOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1') === 'Safari', 'iPhone Safari family');
check(W.osOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)') === 'iOS', 'iPhone OS family');
check(W.browserOf('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/141.0 Safari/537.36 Edg/141.0') === 'Edge', 'Edge before Chrome');

// ── http checks ─────────────────────────────────────────────────────────
const URL_ = arg('--url'), KEY = arg('--key'), D1 = arg('--d1');
const UA_A = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15 STATSCHECK-UA-ALPHA';
const UA_B = 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 STATSCHECK-UA-BRAVO';
const IP_A = '203.0.113.77', IP_B = '198.51.100.23';
if (URL_) {
  const post = (ua, ip, ev) => fetch(URL_ + '/e', { method: 'POST', headers: { 'Content-Type': 'text/plain', 'User-Agent': ua, 'CF-Connecting-IP': ip, 'Origin': 'http://localhost:8000' }, body: JSON.stringify({ v: 1, ev }) });
  const session = (lang, med) => [
    { t: 'visit', ref: 'news.ycombinator.com', dev: 'desktop', lang, scr: '1440-1919', dpr: '2', gpu: 'yes', gv: 'apple', gl2: 1, mode: 'shell', sw: 0 },
    { t: 'pv', p: 'home', wd: 3, lh: 20, ctx: 'shell' },
    { t: 'pv', p: 'wind-tunnel', from: 'home', wd: 3, lh: 20, ctx: 'shell' },
    { t: 'load', p: 'wind-tunnel', ms: 900, ttfb: 40 },
    { t: 'out', p: 'wind-tunnel', host: 'store.steampowered.com', med },
    { t: 'eng', p: 'wind-tunnel', s: 75, first: 1, last: 1, tot: 75 },
    { t: 'end', p: 'wind-tunnel', depth: 2 },
  ];
  let res = await post(UA_A, IP_A, session('en-US', 'topbar'));
  check(res.status === 204 && res.headers.get('x-stats') === 'ok', 'POST /e from visitor A', [res.status, res.headers.get('x-stats')]);
  res = await post(UA_B, IP_B, session('ga-IE', 'chip'));
  check(res.headers.get('x-stats') === 'ok', 'POST /e from visitor B', res.headers.get('x-stats'));
  res = await post(UA_A, IP_A, [{ t: 'pv', p: 'wind-tunnel', from: 'wind-tunnel', ctx: 'shell' }]);
  check(res.headers.get('x-stats') === 'ok', 'POST /e repeat view by A');
  res = await post('Googlebot/2.1 (+http://www.google.com/bot.html)', '66.249.66.1', session('en-US', 'x'));
  check(res.headers.get('x-stats') === 'bot', 'bot user agent dropped', res.headers.get('x-stats'));
  res = await post(UA_A, IP_A, 'x'.repeat(20000));
  check(res.status === 204, 'oversize batch answered 204');

  res = await fetch(URL_ + '/stats');
  check(res.status === 401, '/stats without key is 401', res.status);
  res = await fetch(URL_ + '/stats', { headers: { Authorization: 'Bearer wrong' } });
  check(res.status === 401, '/stats with wrong key is 401', res.status);
  res = await fetch(URL_ + '/stats', { headers: { Authorization: 'Bearer ' + KEY } });
  check(res.status === 200, '/stats with key is 200', res.status);
  const S = await res.json();
  const n = (m, a = '', b = '') => S.rows.filter(x => x.m === m && x.a === a && x.b === b).reduce((s, x) => s + x.n, 0);
  check(n('visit') === 2, 'two visits', n('visit'));
  check(n('uv') === 2, 'two unique visitors', n('uv'));
  check(n('pv', 'wind-tunnel') === 3 && n('upv', 'wind-tunnel') === 2, 'wind-tunnel 3 views, 2 unique', [n('pv', 'wind-tunnel'), n('upv', 'wind-tunnel')]);
  check(n('flow', 'home', 'wind-tunnel') === 2 && n('entry', 'home') === 2, 'flow and entry');
  check(n('wl', 'wind-tunnel', 'topbar') === 1 && n('wl', 'wind-tunnel', 'chip') === 1, 'wishlist clicks by medium');
  check(n('ref', 'social', 'news.ycombinator.com') === 0 && n('ref', 'social', 'other') === 2, 'rare referrer host folded to other (min ' + S.minN + ')', S.rows.filter(x => x.m === 'ref'));
  check(n('lang', 'other') === 2 && n('lang', 'en-US') === 0, 'rare languages folded to other');
  check(n('br', 'other') === 2, 'rare browser families folded to other', S.rows.filter(x => x.m === 'br'));
  const eng = S.rows.find(x => x.m === 'eng' && x.a === 'wind-tunnel');
  check(eng && eng.n === 2 && eng.v === 150, 'engaged time sum', eng);
  check(Array.isArray(S.days) && S.days.some(d => d.m === 'pv' && d.n === 5), 'daily pv series', S.days);
  check(!JSON.stringify(S).includes('STATSCHECK') && !JSON.stringify(S).includes(IP_A), '/stats has no UA or IP');

  res = await fetch(URL_ + '/live', { headers: { Authorization: 'Bearer ' + KEY } });
  const L = await res.json();
  check(L.total === 2 && L.pages.some(p => p.p === 'wind-tunnel'), 'live: 2 visitors now', L);

  // ── privacy scan ──────────────────────────────────────────────────────
  if (D1) {
    const files = [];
    const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else files.push(f); });
    walk(D1);
    const needles = ['STATSCHECK-UA', IP_A, IP_B, 'Macintosh; Intel', 'Android 15'];
    let hits = [];
    for (const f of files) {
      const buf = fs.readFileSync(f);
      for (const s of needles) if (buf.includes(Buffer.from(s)) || buf.includes(Buffer.from(s, 'utf16le'))) hits.push(path.basename(f) + ': ' + s);
    }
    check(files.length > 0, 'privacy scan found D1 files', files.length);
    check(hits.length === 0, 'no IP address or user agent in any D1 file (' + files.length + ' files)', hits);
  }
}

console.log(`stats-check: ${passes} passed, ${fails} failed${URL_ ? ' (unit + http' + (D1 ? ' + privacy scan' : '') + ')' : ' (unit only)'}`);
process.exit(fails ? 1 : 0);
