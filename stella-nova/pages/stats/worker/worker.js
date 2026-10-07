// ============================================================================
//  SITE STATS  ·  Cloudflare Worker + D1 for davesgames.io/stella-nova/#stats
// ----------------------------------------------------------------------------
//  lib/stats-beacon.js sends small event batches from the site. This Worker
//  turns each event into counts in the D1 table agg, at once. No event row
//  is kept. The #stats page reads the counts with a secret key.
//
//    POST /e        an event batch (text/plain JSON, from sendBeacon)
//    GET  /stats    ?from=YYYY-MM-DD&to=YYYY-MM-DD   totals for the range
//    GET  /live     visitors with an event in the last LIVE_S seconds
//    GET  /         a short health text
//  /stats and /live need "Authorization: Bearer <STATS_KEY>".
//
//  PRIVACY. The Worker reads the IP address and the user agent of each
//  request, and writes neither. It makes one hash per UTC day:
//  SHA-256(day salt | IP | user agent), cut to 16 hex digits. The hash
//  counts unique visitors and caps events. The cron deletes the hashes and
//  the salt of each earlier day, so two days cannot be linked. The browser
//  family, OS, country and region come from the request and go into
//  counts only. The beacon sends nothing when the browser sets Global
//  Privacy Control or Do Not Track. /stats folds each FOLD row with fewer
//  than MIN_N counts into "other", so no rare value shows.
//
//  METRICS (agg.m, agg.a, agg.b). Each event adds n = 1 unless noted.
//    visit  -, -            a new browser-tab session
//    uv     -, -            a new visitor hash for the day
//    pv     page, -         a pageview (saver runs are not counted)
//    upv    page, -         first view of a page by a hash that day
//    entry  page, -         first page of a session
//    exit   page, -         page shown when the session ends
//    flow   from, to        page to page in one session
//    how    weekday, hour   local time of the visitor (0 = Sunday)
//    hr     UTC hour, -     pageviews by UTC hour
//    ctx    shell|page, -   in the shell, or a page opened on its own
//    eng    page, -         engaged seconds in v; n counts views
//    engb   bin, -          engaged time per view, histogram
//    load   page, -         load ms in v
//    loadb  bin, -          load time histogram
//    ttfb   page, -         time to first byte ms in v
//    depth  bin, -          pages per session at its end
//    err    page, kind      kind: js | promise | gpu
//    errm   kind, text      short error text (URLs and numbers removed)
//    wl     page, medium    a click on a Steam store link
//    out    host, -         a click on any other outside link
//    ref    class, host     search | social | link | direct
//    utm    source, medium  utm tags on the entry URL
//    utmc   campaign, -
//    cty    country, -      ISO 3166-1 alpha-2 from Cloudflare
//    reg    country, region
//    cont   continent, -
//    dev    mobile|tablet|desktop
//    os, br                 OS and browser family from the user agent
//    lang   language tag
//    scr    width band      screen width in CSS px
//    dpr    1|1.5|2|3+
//    theme  dark|light      prefers-color-scheme
//    motion reduce|full
//    touch  yes|no
//    gpu    browser, yes|no|fail   WebGPU adapter by browser family
//    gpuv   vendor, -       WebGPU adapter vendor (adapter.info.vendor)
//    gl2    yes|no
//    mode   shell|page|app  app = installed (display-mode standalone)
//    sw     yes|no          a service worker controls the page
//    saver  -, -            screensaver starts; v = seconds run
//
//  Deploy: see wrangler.toml. Local: npx wrangler dev --local --port 8789
//
//  grep -n targets
//    allowed origins ...... "const ORIGINS"
//    event to rows ........ "function rowsFor"
//    stats query .......... "async function stats"
//    daily purge .......... "async function purge"
// ============================================================================

const ORIGINS = ['https://davesgames.io', 'https://www.davesgames.io'];
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const LIVE_S = 300;
const MAX_BODY = 16384;
const MAX_EVENTS = 40;
const MAX_BATCHES_PER_DAY = 400;
const MIN_N = 3;
const FOLD = new Set(['ref', 'utm', 'utmc', 'cty', 'reg', 'lang', 'gpuv', 'out', 'errm', 'scr', 'os', 'br']);
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|monitor|curl|wget|python|node-fetch|axios|go-http|java\/|httpclient|phantom|puppeteer|playwright/i;

const SEARCH = /(^|\.)(google|bing|duckduckgo|yahoo|yandex|baidu|ecosia|startpage|brave|kagi|qwant|naver|seznam)\./;
const SOCIAL = /(^|\.)(reddit|twitter|x|t|facebook|fb|instagram|tiktok|youtube|linkedin|lnkd|mastodon|bsky|threads|discord|discordapp|news\.ycombinator|ycombinator|pinterest|tumblr|vk|weibo|steamcommunity|itch)\./;

function cors(origin) {
  const ok = origin && (ORIGINS.includes(origin) || LOCAL.test(origin));
  return ok ? {
    'Access-Control-Allow-Origin': origin, 'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Max-Age': '86400',
  } : { 'Vary': 'Origin' };
}

const today = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
// Short safe text: letters, digits and a few marks, at most len characters.
const str = (x, len = 40) => String(x ?? '').replace(/[^\w .:/@+#()-]/g, '').trim().slice(0, len);
const key = x => (/^[a-z0-9][a-z0-9_-]{0,47}$/.test(x) ? x : '');
const num = (x, lo, hi) => (Number.isFinite(+x) ? Math.min(hi, Math.max(lo, +x)) : null);

function bin(x, edges, labels) {
  for (let i = 0; i < edges.length; i++) if (x < edges[i]) return labels[i];
  return labels[labels.length - 1];
}
const ENG_EDGES = [5, 15, 30, 60, 180, 600, 1800];
const ENG_LABELS = ['<5s', '5-15s', '15-30s', '30-60s', '1-3m', '3-10m', '10-30m', '30m+'];
const LOAD_EDGES = [500, 1000, 2000, 4000, 8000];
const LOAD_LABELS = ['<0.5s', '0.5-1s', '1-2s', '2-4s', '4-8s', '8s+'];
const DEPTH_EDGES = [2, 3, 5, 10, 20];
const DEPTH_LABELS = ['1', '2', '3-4', '5-9', '10-19', '20+'];

function browserOf(ua) {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/SamsungBrowser/.test(ua)) return 'Samsung';
  if (/Firefox\/|FxiOS/.test(ua)) return 'Firefox';
  if (/CriOS|Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Other';
}
function osOf(ua) {
  if (/iPhone|iPod/.test(ua)) return 'iOS';
  if (/iPad/.test(ua)) return 'iPadOS';
  if (/Android/.test(ua)) return 'Android';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Mac OS X|Macintosh/.test(ua)) return 'macOS';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Other';
}
function refOf(host) {
  host = str(host, 80).toLowerCase().replace(/^www\./, '');
  if (!host) return ['direct', ''];
  if (SEARCH.test(host + '.')) return ['search', host];
  if (SOCIAL.test(host + '.')) return ['social', host];
  return ['link', host];
}
// Error text without URLs, paths or numbers, so it cannot carry a value
// that a visitor typed.
function errText(s) {
  return String(s || '').replace(/\b[a-z]+:\/\/\S+/gi, '<url>').replace(/\/\S+/g, '<path>')
    .replace(/\d+/g, '#').replace(/["'`][^"'`]{0,60}["'`]/g, '"…"').replace(/\s+/g, ' ').trim().slice(0, 90);
}

// One event -> a list of [m, a, b, n, v] rows for agg. ctx holds the
// request facts (browser, OS, country) and the UTC hour.
function rowsFor(e, ctx) {
  const out = [];
  const add = (m, a = '', b = '', n = 1, v = 0) => out.push([m, String(a), String(b), n, v]);
  const p = key(e.p);
  switch (e.t) {
    case 'visit': {
      add('visit');
      const [cls, host] = refOf(e.ref);
      add('ref', cls, host);
      if (e.us || e.um) add('utm', str(e.us) || '-', str(e.um) || '-');
      if (e.uc) add('utmc', str(e.uc));
      if (ctx.country) {
        add('cty', ctx.country);
        if (ctx.region) add('reg', ctx.country, ctx.region);
      }
      if (ctx.continent) add('cont', ctx.continent);
      add('os', ctx.os); add('br', ctx.br);
      if (['mobile', 'tablet', 'desktop'].includes(e.dev)) add('dev', e.dev);
      if (e.lang) add('lang', str(e.lang, 16));
      if (e.scr) add('scr', str(e.scr, 12));
      if (e.dpr) add('dpr', str(e.dpr, 4));
      add('theme', e.dark ? 'dark' : 'light');
      add('motion', e.rm ? 'reduce' : 'full');
      add('touch', e.touch ? 'yes' : 'no');
      if (['yes', 'no', 'fail'].includes(e.gpu)) add('gpu', ctx.br, e.gpu);
      if (e.gv) add('gpuv', str(e.gv, 24));
      add('gl2', e.gl2 ? 'yes' : 'no');
      if (['shell', 'page', 'app'].includes(e.mode)) add('mode', e.mode);
      add('sw', e.sw ? 'yes' : 'no');
      break;
    }
    case 'pv': {
      if (!p) break;
      add('pv', p);
      const from = key(e.from);
      add('flow', from || '(entry)', p);
      if (!from) add('entry', p);
      const wd = num(e.wd, 0, 6), lh = num(e.lh, 0, 23);
      if (wd !== null && lh !== null) add('how', wd, lh);
      add('hr', ctx.hour);
      add('ctx', e.ctx === 'page' ? 'page' : 'shell');
      break;
    }
    case 'eng': {
      const s = num(e.s, 0, 7200);
      if (!p || s === null) break;
      add('eng', p, '', e.first ? 1 : 0, s);
      if (e.last) add('engb', bin(num(e.tot, 0, 1e6) ?? s, ENG_EDGES, ENG_LABELS));
      break;
    }
    case 'load': {
      const ms = num(e.ms, 0, 120000);
      if (!p || ms === null) break;
      add('load', p, '', 1, ms);
      add('loadb', bin(ms, LOAD_EDGES, LOAD_LABELS));
      const tt = num(e.ttfb, 0, 60000);
      if (tt !== null) add('ttfb', p, '', 1, tt);
      break;
    }
    case 'err': {
      const k = ['js', 'promise', 'gpu'].includes(e.k) ? e.k : 'js';
      add('err', p || '(shell)', k);
      const m = errText(e.msg);
      if (m) add('errm', k, m);
      break;
    }
    case 'out': {
      const host = str(e.host, 80).toLowerCase();
      if (host === 'store.steampowered.com') add('wl', p || '(shell)', str(e.med, 16) || 'untagged');
      else if (host) add('out', host);
      break;
    }
    case 'end': {
      if (p) add('exit', p);
      const d = num(e.depth, 1, 10000);
      if (d !== null) add('depth', bin(d, DEPTH_EDGES, DEPTH_LABELS));
      break;
    }
    case 'saver': add('saver', '', '', e.start ? 1 : 0, num(e.s, 0, 86400) || 0); break;
  }
  return out;
}

const UPSERT = 'INSERT INTO agg (day, m, a, b, n, v) VALUES (?, ?, ?, ?, ?, ?) ' +
  'ON CONFLICT (day, m, a, b) DO UPDATE SET n = n + excluded.n, v = v + excluded.v';
// Adds one count only when the INSERT OR IGNORE just before it put in a row.
const UPSERT_IF_NEW = 'INSERT INTO agg (day, m, a, b, n, v) SELECT ?, ?, ?, ?, 1, 0 WHERE changes() = 1 ' +
  'ON CONFLICT (day, m, a, b) DO UPDATE SET n = n + 1';

const saltCache = new Map();
async function daySalt(db, day) {
  if (saltCache.has(day)) return saltCache.get(day);
  const fresh = [...crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2, '0')).join('');
  await db.prepare('INSERT OR IGNORE INTO salt (day, s) VALUES (?, ?)').bind(day, fresh).run();
  const row = await db.prepare('SELECT s FROM salt WHERE day = ?').bind(day).first();
  saltCache.clear();
  saltCache.set(day, row.s);
  return row.s;
}
async function visitorHash(db, day, ip, ua) {
  const salt = await daySalt(db, day);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + '|' + ip + '|' + ua));
  return [...new Uint8Array(buf).slice(0, 8)].map(x => x.toString(16).padStart(2, '0')).join('');
}

async function ingest(req, env) {
  const ua = req.headers.get('user-agent') || '';
  if (BOT.test(ua)) return 'bot';
  const text = await req.text();
  if (text.length > MAX_BODY) return 'big';
  let body;
  try { body = JSON.parse(text); } catch { return 'json'; }
  const events = Array.isArray(body && body.ev) ? body.ev.slice(0, MAX_EVENTS) : [];
  if (!events.length) return 'empty';

  const now = Date.now(), day = today(now);
  const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || '0.0.0.0';
  const h = await visitorHash(env.DB, day, ip, ua);
  // One counter row per hash and day caps the batches a hash can send.
  const cap = await env.DB.prepare('INSERT INTO seen (day, h, p, n) VALUES (?, ?, \'#\', 1) ' +
    'ON CONFLICT (day, h, p) DO UPDATE SET n = n + 1 RETURNING n').bind(day, h).first();
  if (cap && cap.n > MAX_BATCHES_PER_DAY) return 'cap';

  const cf = req.cf || {};
  const ctx = {
    br: browserOf(ua), os: osOf(ua), hour: new Date(now).getUTCHours(),
    country: str(cf.country, 2).toUpperCase(), region: str(cf.region, 40), continent: str(cf.continent, 2).toUpperCase(),
  };
  const st = [];
  const up = (m, a, b, n, v) => st.push(env.DB.prepare(UPSERT).bind(day, m, a, b, n, v));
  let lastPage = '';
  for (const e of events) {
    if (!e || typeof e !== 'object') continue;
    for (const r of rowsFor(e, ctx)) up(...r);
    if (e.t === 'visit') {
      st.push(env.DB.prepare('INSERT OR IGNORE INTO seen (day, h, p, n) VALUES (?, ?, \'\', 0)').bind(day, h));
      st.push(env.DB.prepare(UPSERT_IF_NEW).bind(day, 'uv', '', ''));
    }
    if (e.t === 'pv' && key(e.p)) {
      st.push(env.DB.prepare('INSERT OR IGNORE INTO seen (day, h, p, n) VALUES (?, ?, ?, 0)').bind(day, h, key(e.p)));
      st.push(env.DB.prepare(UPSERT_IF_NEW).bind(day, 'upv', key(e.p), ''));
      lastPage = key(e.p);
    }
  }
  st.push(env.DB.prepare('INSERT INTO live (h, p, t) VALUES (?, ?, ?) ON CONFLICT (h) DO UPDATE SET t = excluded.t, ' +
    'p = CASE WHEN excluded.p = \'\' THEN live.p ELSE excluded.p END').bind(h, lastPage, Math.floor(now / 1000)));
  await env.DB.batch(st);
  return 'ok';
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
async function stats(url, env) {
  const to = DAY_RE.test(url.searchParams.get('to')) ? url.searchParams.get('to') : today();
  const from = DAY_RE.test(url.searchParams.get('from')) ? url.searchParams.get('from') : to;
  const [rows, days, first] = await env.DB.batch([
    env.DB.prepare('SELECT m, a, b, SUM(n) AS n, SUM(v) AS v FROM agg WHERE day BETWEEN ? AND ? GROUP BY m, a, b').bind(from, to),
    env.DB.prepare('SELECT day, m, SUM(n) AS n, SUM(v) AS v FROM agg WHERE day BETWEEN ? AND ? ' +
      'AND m IN (\'pv\', \'uv\', \'visit\', \'wl\', \'eng\', \'err\', \'saver\') GROUP BY day, m ORDER BY day').bind(from, to),
    env.DB.prepare('SELECT MIN(day) AS day FROM agg'),
  ]);
  // Fold rare values of FOLD metrics into "other".
  const kept = [], other = new Map();
  for (const r of rows.results) {
    if (FOLD.has(r.m) && r.n < MIN_N && r.a !== '') {
      const k = r.m === 'reg' || r.m === 'ref' ? r.m + '\u0000' + r.a : r.m;
      const o = other.get(k) || { m: r.m, a: r.m === 'reg' || r.m === 'ref' ? r.a : 'other', b: r.m === 'reg' || r.m === 'ref' ? 'other' : '', n: 0, v: 0 };
      o.n += r.n; o.v += r.v; other.set(k, o);
    } else kept.push(r);
  }
  return { from, to, since: first.results[0]?.day || null, rows: kept.concat([...other.values()]), days: days.results, minN: MIN_N };
}

async function live(env) {
  const t = Math.floor(Date.now() / 1000) - LIVE_S;
  const r = await env.DB.prepare('SELECT p, COUNT(*) AS n FROM live WHERE t > ? GROUP BY p').bind(t).all();
  return { windowS: LIVE_S, total: r.results.reduce((s, x) => s + x.n, 0), pages: r.results };
}

async function purge(env) {
  const d = today();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM seen WHERE day < ?').bind(d),
    env.DB.prepare('DELETE FROM salt WHERE day < ?').bind(d),
    env.DB.prepare('DELETE FROM live WHERE t < ?').bind(Math.floor(Date.now() / 1000) - 900),
  ]);
  saltCache.clear();
}

function authorized(req, env) {
  const want = env.STATS_KEY || '';
  const got = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!want || got.length !== want.length) return false;
  let d = 0;
  for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return d === 0;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const head = cors(req.headers.get('origin'));
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...head, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: head });
    if (url.pathname === '/e' && req.method === 'POST') {
      let r = 'err';
      try { r = await ingest(req, env); } catch (e) { console.log('ingest', e && e.message); }
      return new Response(null, { status: 204, headers: { ...head, 'X-Stats': r } });
    }
    if (url.pathname === '/stats' || url.pathname === '/live') {
      if (!authorized(req, env)) return json({ error: 'key' }, 401);
      return json(url.pathname === '/stats' ? await stats(url, env) : await live(env));
    }
    if (url.pathname === '/') return new Response('sn-stats ok\n', { headers: head });
    return new Response('not found\n', { status: 404, headers: head });
  },
  async scheduled(_ev, env) { await purge(env); },
};
// Exported for tools/stats-check.mjs (node), not used by the Worker runtime.
export { rowsFor, errText, refOf, browserOf, osOf, purge };
