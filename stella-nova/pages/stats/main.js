// ============================================================================
//  SITE STATISTICS  ·  pages/stats/main.js
// ----------------------------------------------------------------------------
//  Reads totals from the sn-stats Worker and draws the dashboard. The Worker
//  URL comes from lib/stats-beacon.js (snStats.url), so STATS_URL there is
//  the one place to set it. Every request sends the key as a Bearer token.
//
//  Flow: gate() -> load() -> buildCards(). load() asks /stats for the range
//  and for the range just before it (for the KPI deltas). /live refreshes
//  every LIVE_MS while the tab is visible. growth.json (git history) needs
//  no Worker and always shows.
//
//  The /stats rows are { m, a, b, n, v }. worker/worker.js lists each m.
//
//  grep -n targets
//    ranges ............... "const RANGES"
//    key gate ............. "function gate"
//    fetch ................ "async function load"
//    all cards ............ "function buildCards"
//    sims table ........... "function simsTable"
//    git history .......... "async function growthCards"
// ============================================================================
import { lineChart, columns, barList, heat, stack100, worldMap, fmt, fmtInt, pct, dur, esc, empty } from './charts.js';
import { COUNTRIES } from './countries.js';

const API = (window.snStats && window.snStats.url) || '';
const KEY_STORE = 'sn-stats-key', RANGE_STORE = 'sn-stats-range';
const LIVE_MS = 20000;
const RANGES = [['today', 'Today', 1], ['7d', '7 days', 7], ['30d', '30 days', 30], ['90d', '90 days', 90], ['365d', '12 months', 365], ['all', 'All time', 0]];
const ENG_LABELS = ['<5s', '5-15s', '15-30s', '30-60s', '1-3m', '3-10m', '10-30m', '30m+'];
const LOAD_LABELS = ['<0.5s', '0.5-1s', '1-2s', '2-4s', '4-8s', '8s+'];
const DEPTH_LABELS = ['1', '2', '3-4', '5-9', '10-19', '20+'];
const CONTINENTS = { AF: 'Africa', AN: 'Antarctica', AS: 'Asia', EU: 'Europe', NA: 'North America', OC: 'Oceania', SA: 'South America', T1: 'Tor' };
const RAMP = ['var(--q1)', 'var(--q2)', 'var(--q3)', 'var(--q4)', 'var(--q5)'];
const C = { s1: 'var(--s1)', s2: 'var(--s2)', s3: 'var(--s3)', good: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad)' };

const $ = id => document.getElementById(id);
const ls = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} } };

// Page labels from the nav registry.
const LABEL = new Map();
try { (window.snPages ? window.snPages() : []).forEach(p => LABEL.set(p.key, p.label)); } catch (e) {}
(window.SN_HIDDEN || []).forEach(p => LABEL.set(p[0], p[1]));
LABEL.set('(shell)', 'Shell (no page)');
const label = k => LABEL.get(k) || k;
const simHref = k => (LABEL.has(k) && k[0] !== '(' ? '../../#' + k : null);
const cname = a2 => (COUNTRIES[a2] ? COUNTRIES[a2][1] : a2 === 'other' ? 'Other (fewer than 3)' : a2 || 'Unknown');

// ── dates (UTC days, as the Worker stores them) ─────────────────────────
const dayStr = t => new Date(t).toISOString().slice(0, 10);
const addDays = (d, n) => dayStr(Date.parse(d + 'T00:00:00Z') + n * 864e5);
const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const shortDay = (d, long) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', long ? { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' } : { day: 'numeric', month: 'short', timeZone: 'UTC' });
function rangeDates(id) {
  const to = dayStr(Date.now()), r = RANGES.find(x => x[0] === id) || RANGES[2];
  if (!r[2]) return { from: '2000-01-01', to, prev: null };
  const from = addDays(to, 1 - r[2]);
  return { from, to, prev: { from: addDays(from, -r[2]), to: addDays(from, -1) } };
}

// ── model over /stats rows ──────────────────────────────────────────────
function model(R) {
  const by = new Map();
  for (const r of (R && R.rows) || []) { if (!by.has(r.m)) by.set(r.m, []); by.get(r.m).push(r); }
  const rows = m => by.get(m) || [];
  const sum = (m, f) => rows(m).reduce((s, r) => s + (!f || f(r) ? r.n : 0), 0);
  const sumv = (m, f) => rows(m).reduce((s, r) => s + (!f || f(r) ? r.v : 0), 0);
  const group = (m, k = 'a', f) => {
    const g = new Map();
    for (const r of rows(m)) { if (f && !f(r)) continue; const o = g.get(r[k]) || { n: 0, v: 0 }; o.n += r.n; o.v += r.v; g.set(r[k], o); }
    return g;
  };
  return { rows, sum, sumv, group, days: (R && R.days) || [], since: R && R.since, from: R && R.from, to: R && R.to };
}
const list = (g, fn = k => k) => [...g].map(([k, o]) => ({ label: fn(k), n: o.n, key: k }));

// ── cards ───────────────────────────────────────────────────────────────
let draws = [];
function section(title, note) {
  const s = document.createElement('div');
  s.className = 'sec';
  s.innerHTML = `<h2>${esc(title)}</h2>${note ? `<p>${esc(note)}</p>` : ''}`;
  $('dash').appendChild(s);
}
// opt = { title, sub, w, render(body), table() -> { cols, rows } }
function card(opt) {
  const el = document.createElement('section');
  el.className = 'card' + (opt.w && opt.w !== 6 ? ' w' + opt.w : '') + (opt.cls ? ' ' + opt.cls : '');
  el.innerHTML = `<div class="card-h"><div><h3>${esc(opt.title)}</h3>${opt.sub ? `<p>${esc(opt.sub)}</p>` : ''}</div>` +
    (opt.table ? '<button type="button" class="tbtn ghost" aria-pressed="false">Table</button>' : '') + '</div><div class="card-b"></div>';
  const body = el.querySelector('.card-b');
  let asTable = false;
  const draw = () => (asTable ? tableView(body, opt.table()) : opt.render(body));
  if (opt.table) el.querySelector('.tbtn').addEventListener('click', e => {
    asTable = !asTable; e.target.textContent = asTable ? 'Chart' : 'Table'; e.target.setAttribute('aria-pressed', asTable); draw();
  });
  $('dash').appendChild(el);
  draws.push(draw);
  return el;
}
function tableView(body, t) {
  if (!t.rows.length) return empty(body);
  body.innerHTML = `<div class="tbl-wrap"><table class="t"><thead><tr>${t.cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>` +
    t.rows.map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('') + '</tbody></table></div>';
}
const listTable = (name, rows, total) => () => ({ cols: [name, 'Count', 'Share'], rows: rows().filter(r => r.n).sort((a, b) => b.n - a.n).map(r => [r.label, fmtInt(r.n), pct(r.n, total())]) });
function splitCard(opt, parts) {
  return card({
    ...opt,
    render: body => {
      body.innerHTML = '<div class="split">' + parts.map((p, i) => `<div><h4>${esc(p.h)}</h4><div data-i="${i}"></div></div>`).join('') + '</div>';
      parts.forEach((p, i) => barList(body.querySelector(`[data-i="${i}"]`), p.rows(), { color: p.color || C.s1, limit: p.limit || 6 }));
    },
    table: () => ({ cols: ['Group', 'Value', 'Count', 'Share'], rows: parts.flatMap(p => { const rs = p.rows().filter(r => r.n).sort((a, b) => b.n - a.n), t = rs.reduce((s, r) => s + r.n, 0); return rs.map(r => [p.h, r.label, fmtInt(r.n), pct(r.n, t)]); }) }),
  });
}
function kpis(items) {
  const w = document.createElement('div');
  w.className = 'kpis';
  w.innerHTML = items.map(k => {
    let d = '';
    if (k.prev != null && isFinite(k.prev) && isFinite(k.val)) {
      if (k.prev === 0) d = k.val > 0 ? '<span class="d up">new</span>' : '<span class="d flat">±0</span>';
      else { const c = (k.val - k.prev) / k.prev, up = k.lowerBetter ? c < 0 : c > 0; d = `<span class="d ${Math.abs(c) < 0.005 ? 'flat' : up ? 'up' : 'down'}">${c > 0 ? '▲' : c < 0 ? '▼' : ''} ${Math.abs(c * 100).toFixed(Math.abs(c) < 0.1 ? 1 : 0)}%</span>`; }
    }
    return `<div class="kpi"><span>${esc(k.label)}</span><b>${k.text}</b><small>${d} ${esc(k.sub || '')}</small></div>`;
  }).join('');
  $('dash').appendChild(w);
}

// ── the dashboard ───────────────────────────────────────────────────────
function buildCards(cur, prev, rangeId) {
  draws = [];
  $('dash').innerHTML = '';
  const S = model(cur), P = prev ? model(prev) : null;
  const pv = S.sum('pv'), visits = S.sum('visit');
  const nDays = rangeId === 'all' ? Math.max(1, S.since ? dayDiff(S.since, S.to) + 1 : 1) : (RANGES.find(r => r[0] === rangeId) || [0, 0, 1])[2];
  const k = (M, f) => (M ? f(M) : null);
  const engAvg = M => (M.sum('eng') ? M.sumv('eng') / M.sum('eng') : NaN);
  const gpuYes = M => { const t = M.sum('gpu'); return t ? M.sum('gpu', r => r.b === 'yes') / t : NaN; };
  const errRate = M => (M.sum('pv') ? (1000 * M.sum('err')) / M.sum('pv') : NaN);
  kpis([
    { label: 'Pageviews', val: pv, prev: k(P, M => M.sum('pv')), text: fmtInt(pv), sub: 'vs previous ' + (P ? nDays + ' d' : '') },
    { label: 'Visits', val: visits, prev: k(P, M => M.sum('visit')), text: fmtInt(visits), sub: 'browser-tab sessions' },
    { label: 'Avg daily visitors', val: S.sum('uv') / nDays, prev: k(P, M => M.sum('uv') / nDays), text: fmt(S.sum('uv') / nDays), sub: fmtInt(S.sum('uv')) + ' visitor-days' },
    { label: 'Pages per visit', val: visits ? pv / visits : NaN, prev: k(P, M => (M.sum('visit') ? M.sum('pv') / M.sum('visit') : NaN)), text: visits ? (pv / visits).toFixed(2) : '–' },
    { label: 'Engaged time / view', val: engAvg(S), prev: k(P, engAvg), text: dur(engAvg(S)), sub: 'tab visible' },
    { label: 'Wishlist clicks', val: S.sum('wl'), prev: k(P, M => M.sum('wl')), text: fmtInt(S.sum('wl')), sub: pct(S.sum('wl'), visits) + ' of visits' },
    { label: 'WebGPU support', val: gpuYes(S), prev: k(P, gpuYes), text: isFinite(gpuYes(S)) ? (gpuYes(S) * 100).toFixed(0) + '%' : '–', sub: 'of new visits' },
    { label: 'Errors / 1k views', val: errRate(S), prev: k(P, errRate), lowerBetter: true, text: isFinite(errRate(S)) ? errRate(S).toFixed(1) : '–', sub: fmtInt(S.sum('err')) + ' errors' },
  ]);

  // Traffic
  section('Traffic', rangeId === 'today' ? 'UTC hours' : 'UTC days');
  if (rangeId === 'today') {
    const hrs = [...Array(24).keys()], g = S.group('hr');
    card({ title: 'Pageviews by hour', sub: 'Today, UTC', w: 12, render: b => (pv ? columns(b, { labels: hrs.map(h => String(h).padStart(2, '0')), values: hrs.map(h => (g.get(String(h)) || { n: 0 }).n), color: C.s1, height: 220 }) : empty(b)),
      table: () => ({ cols: ['UTC hour', 'Pageviews'], rows: hrs.map(h => [String(h).padStart(2, '0') + ':00', fmtInt((g.get(String(h)) || { n: 0 }).n)]) }) });
  } else {
    const start = rangeId === 'all' ? (S.since || S.to) : S.from;
    const dates = []; for (let d = start; d <= S.to; d = addDays(d, 1)) dates.push(d);
    const ser = m => { const g = new Map(); S.days.filter(r => r.m === m).forEach(r => g.set(r.day, r.n)); return dates.map(d => g.get(d) || 0); };
    const series = [{ name: 'Pageviews', color: C.s1, values: ser('pv') }, { name: 'Visits', color: C.s2, values: ser('visit') }, { name: 'Visitors', color: C.s3, values: ser('uv') }];
    card({ title: 'Pageviews, visits and visitors', sub: 'Visitors are unique per day', w: 12,
      render: b => { if (!pv) return empty(b); b.innerHTML = '<div class="legend">' + series.map(s => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('') + '</div><div class="lc"></div>'; lineChart(b.querySelector('.lc'), { x: dates, xFmt: shortDay, series, area: 0, height: 260 }); },
      table: () => ({ cols: ['Day', 'Pageviews', 'Visits', 'Visitors', 'Wishlist clicks'], rows: dates.map((d, i) => [d, fmtInt(series[0].values[i]), fmtInt(series[1].values[i]), fmtInt(series[2].values[i]), fmtInt(ser('wl')[i])]).reverse() }) });
  }

  // Sims
  section('Sims', 'every page, in this range');
  card({ title: 'All pages', sub: 'Click a column to sort. Wishlist rate is clicks per 100 views.', w: 12, render: b => simsTable(b, S) });

  // Behaviour
  section('Behaviour');
  const how = S.group('how'), ORDER = [1, 2, 3, 4, 5, 6, 0], WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hm = ORDER.map(d => [...Array(24).keys()].map(h => S.sum('how', r => r.a === String(d) && r.b === String(h))));
  card({ title: 'When people visit', sub: "Visitor's own local time", w: 8,
    render: b => (how.size ? heat(b, hm, ORDER.map(d => WD[d]), [...Array(24).keys()].map(h => String(h).padStart(2, '0')), RAMP, (r, c, v) => `<b>${WD[ORDER[r]]} ${String(c).padStart(2, '0')}:00</b><div class="tl">Pageviews<span>${fmtInt(v)}</span></div>`) : empty(b)),
    table: () => ({ cols: ['Day', ...[...Array(24).keys()].map(h => String(h).padStart(2, '0'))], rows: hm.map((r, i) => [WD[ORDER[i]], ...r.map(String)]) }) });
  const depth = S.group('depth');
  card({ title: 'Pages per visit', sub: 'At the end of each visit', w: 4,
    render: b => (depth.size ? columns(b, { labels: DEPTH_LABELS, values: DEPTH_LABELS.map(l => (depth.get(l) || { n: 0 }).n), color: C.s1 }) : empty(b)),
    table: listTable('Pages', () => DEPTH_LABELS.map(l => ({ label: l, n: (depth.get(l) || { n: 0 }).n })), () => S.sum('depth')) });
  card({ title: 'Paths between sims', sub: 'The next page in the same visit', render: b => flows(b, S) });
  splitCard({ title: 'Where visits start and end' }, [
    { h: 'Entry pages', rows: () => list(S.group('entry'), label), color: C.s1 },
    { h: 'Exit pages', rows: () => list(S.group('exit'), label), color: C.s2 },
  ]);

  // Conversion
  section('Wishlist and outside links');
  const wlMed = S.group('wl', 'b'), wlSim = S.group('wl', 'a'), pvSim = S.group('pv');
  card({ title: 'Wishlist clicks by button', sub: 'utm_medium of the clicked link', w: 4, render: b => barList(b, list(wlMed), { color: C.s1 }), table: listTable('Button', () => list(wlMed), () => S.sum('wl')) });
  card({ title: 'Wishlist clicks by page', sub: 'with clicks per 100 views', w: 4,
    render: b => barList(b, [...wlSim].map(([k, o]) => ({ label: label(k), n: o.n, sub: pvSim.get(k) ? ((100 * o.n) / pvSim.get(k).n).toFixed(1) + '/100' : '', href: simHref(k) })), { color: C.s1 }),
    table: listTable('Page', () => list(wlSim, label), () => S.sum('wl')) });
  card({ title: 'Other outside links', sub: 'Host of each click', w: 4, render: b => barList(b, list(S.group('out')), { color: C.s2 }), table: listTable('Host', () => list(S.group('out')), () => S.sum('out')) });

  // Acquisition
  section('Acquisition', 'first page of each visit');
  const refCls = S.group('ref');
  card({ title: 'Traffic sources', w: 4, render: b => barList(b, list(refCls, k => ({ search: 'Search', social: 'Social and forums', link: 'Other sites', direct: 'Direct or app' })[k] || k)), table: listTable('Source', () => list(refCls), () => S.sum('ref')) });
  const refHost = S.rows('ref').filter(r => r.a !== 'direct').map(r => ({ label: r.b === 'other' ? 'Other ' + r.a + ' (fewer than 3)' : r.b, n: r.n, sub: r.a }));
  card({ title: 'Referring sites', sub: 'Host name only', w: 4, render: b => barList(b, refHost, { color: C.s2 }), table: listTable('Host', () => refHost, () => refHost.reduce((s, r) => s + r.n, 0)) });
  splitCard({ title: 'Campaigns', sub: 'UTM tags on the entry URL', w: 4 }, [
    { h: 'Source / medium', rows: () => S.rows('utm').map(r => ({ label: r.a === 'other' ? 'Other' : r.a + ' / ' + r.b, n: r.n })), color: C.s3 },
    { h: 'Campaign', rows: () => list(S.group('utmc')), color: C.s3 },
  ]);

  // Audience
  section('Audience', 'countries come from Cloudflare, per visit');
  const cty = S.group('cty');
  card({ title: 'Visits by country', w: 8, render: b => mapCard(b, cty), table: listTable('Country', () => list(cty, cname), () => S.sum('cty')) });
  card({ title: 'Top countries', w: 4, render: b => barList(b, list(cty, cname), { color: C.s1, limit: 12 }), table: listTable('Country', () => list(cty, cname), () => S.sum('cty')) });
  splitCard({ title: 'Regions and continents' }, [
    { h: 'Continent', rows: () => list(S.group('cont'), k => CONTINENTS[k] || k) },
    { h: 'Region', rows: () => S.rows('reg').map(r => ({ label: (r.b === 'other' ? 'Other' : r.b) + ', ' + cname(r.a), n: r.n })), limit: 8 },
  ]);
  splitCard({ title: 'Devices' }, [
    { h: 'Device', rows: () => list(S.group('dev')) },
    { h: 'Operating system', rows: () => list(S.group('os')) },
    { h: 'Browser', rows: () => list(S.group('br')) },
  ]);
  splitCard({ title: 'Screens and languages' }, [
    { h: 'Screen width (CSS px)', rows: () => list(S.group('scr')), limit: 10 },
    { h: 'Pixel ratio', rows: () => list(S.group('dpr')) },
    { h: 'Language', rows: () => list(S.group('lang')), limit: 8 },
  ]);
  splitCard({ title: 'Settings and install' }, [
    { h: 'Colour scheme', rows: () => list(S.group('theme')) },
    { h: 'Reduced motion', rows: () => list(S.group('motion')) },
    { h: 'Touch screen', rows: () => list(S.group('touch')) },
    { h: 'Opened as', rows: () => list(S.group('mode'), k => ({ shell: 'Site (shell)', page: 'Single page', app: 'Installed app' })[k] || k) },
    { h: 'Offline worker active', rows: () => list(S.group('sw')) },
    { h: 'Page context', rows: () => list(S.group('ctx'), k => (k === 'page' ? 'Without the shell' : 'In the shell')) },
  ]);

  // Graphics
  section('Graphics', 'one WebGPU adapter probe per visit, no device');
  const gpuBr = S.group('gpu', 'a');
  card({ title: 'WebGPU by browser', sub: 'Share of visits with a WebGPU adapter',
    render: b => {
      b.innerHTML = '<div class="legend"><span><i style="background:var(--good)"></i>WebGPU adapter</span><span><i style="background:var(--bad)"></i>No WebGPU</span><span><i style="background:var(--warn)"></i>Probe failed or timed out</span></div><div class="sb"></div>';
      stack100(b.querySelector('.sb'), [...gpuBr.keys()].sort((x, y) => gpuBr.get(y).n - gpuBr.get(x).n).map(br => ({ label: br, parts: [['yes', 'WebGPU adapter', C.good], ['no', 'No WebGPU', C.bad], ['fail', 'Probe failed', C.warn]].map(([v, nm, col]) => ({ name: nm, color: col, n: S.sum('gpu', r => r.a === br && r.b === v) })) })));
    },
    table: () => ({ cols: ['Browser', 'Adapter', 'None', 'Failed'], rows: [...gpuBr.keys()].map(br => [br, ...['yes', 'no', 'fail'].map(v => fmtInt(S.sum('gpu', r => r.a === br && r.b === v)))]) }) });
  splitCard({ title: 'GPU' }, [
    { h: 'WebGPU adapter vendor', rows: () => list(S.group('gpuv'), k => k || '(not given)') },
    { h: 'WebGL 2', rows: () => list(S.group('gl2')) },
  ]);

  // Performance
  section('Performance');
  const loadb = S.group('loadb'), engb = S.group('engb');
  card({ title: 'Page load time', sub: 'Navigation start to the load event', w: 4,
    render: b => (loadb.size ? columns(b, { labels: LOAD_LABELS, values: LOAD_LABELS.map(l => (loadb.get(l) || { n: 0 }).n), color: C.s1 }) : empty(b)),
    table: listTable('Load', () => LOAD_LABELS.map(l => ({ label: l, n: (loadb.get(l) || { n: 0 }).n })), () => S.sum('loadb')) });
  card({ title: 'Engaged time per view', sub: 'Time with the tab visible', w: 4,
    render: b => (engb.size ? columns(b, { labels: ENG_LABELS, values: ENG_LABELS.map(l => (engb.get(l) || { n: 0 }).n), color: C.s3 }) : empty(b)),
    table: listTable('Engaged', () => ENG_LABELS.map(l => ({ label: l, n: (engb.get(l) || { n: 0 }).n })), () => S.sum('engb')) });
  const load = S.group('load'), ttfb = S.group('ttfb');
  const slow = [...load].filter(([, o]) => o.n).map(([k, o]) => ({ label: label(k), n: o.v / o.n, sub: (ttfb.get(k) ? 'TTFB ' + Math.round(ttfb.get(k).v / ttfb.get(k).n) + ' ms · ' : '') + o.n + ' loads', href: simHref(k) }));
  card({ title: 'Slowest pages', sub: 'Average load time', w: 4, render: b => barList(b, slow, { color: C.s2, share: false, valueFmt: ms => (ms / 1000).toFixed(2) + 's' }),
    table: () => ({ cols: ['Page', 'Avg load', 'Avg TTFB', 'Loads'], rows: [...load].map(([k, o]) => [label(k), (o.v / o.n / 1000).toFixed(2) + 's', ttfb.get(k) ? Math.round(ttfb.get(k).v / ttfb.get(k).n) + ' ms' : '–', String(o.n)]) }) });

  // Reliability
  section('Reliability', 'at most 5 errors per page per visit');
  const errSim = S.group('err');
  card({ title: 'Errors by page', render: b => barList(b, [...errSim].map(([k, o]) => ({ label: label(k), n: o.n, sub: ['js', 'promise', 'gpu'].map(x => S.sum('err', r => r.a === k && r.b === x)).map((v, i) => v ? v + ' ' + ['js', 'promise', 'gpu'][i] : '').filter(Boolean).join(' · '), href: simHref(k) })), { color: C.s2 }),
    table: () => ({ cols: ['Page', 'Kind', 'Count'], rows: S.rows('err').sort((a, b) => b.n - a.n).map(r => [label(r.a), r.b, fmtInt(r.n)]) }) });
  card({ title: 'Error messages', sub: 'Shortened; URLs, paths and numbers removed', render: b => barList(b, S.rows('errm').map(r => ({ label: r.b === '' ? 'Other' : r.b, n: r.n, sub: r.a })), { color: C.s2 }),
    table: () => ({ cols: ['Message', 'Kind', 'Count'], rows: S.rows('errm').sort((a, b) => b.n - a.n).map(r => [r.b, r.a, fmtInt(r.n)]) }) });

  // Screensaver
  const sv = S.sum('saver'), svs = S.sumv('saver');
  card({ title: 'Screensaver', sub: 'Cmd+Option+S runs; their views are not pageviews', w: 4,
    render: b => { b.innerHTML = `<div class="kpis" style="grid-template-columns:1fr 1fr"><div class="kpi"><span>Runs</span><b>${fmtInt(sv)}</b></div><div class="kpi"><span>Time run</span><b>${dur(svs)}</b><small>${sv ? dur(svs / sv) + ' per run' : ''}</small></div></div>`; } });
  privacyCard(8);
}

function simsTable(body, S) {
  const pv = S.group('pv'), upv = S.group('upv'), eng = S.group('eng'), wl = S.group('wl'), load = S.group('load'), err = S.group('err'), entry = S.group('entry');
  const keys = [...pv.keys()];
  if (!keys.length) return empty(body);
  const max = Math.max(...keys.map(k => pv.get(k).n));
  const rows = keys.map(k => {
    const v = pv.get(k).n, e = eng.get(k), w = (wl.get(k) || { n: 0 }).n, l = load.get(k);
    return { k, name: label(k), views: v, uniq: (upv.get(k) || { n: 0 }).n, entry: (entry.get(k) || { n: 0 }).n, eng: e && e.n ? e.v / e.n : NaN, wl: w, rate: v ? (100 * w) / v : 0, load: l && l.n ? l.v / l.n : NaN, err: (err.get(k) || { n: 0 }).n };
  });
  const cols = [['name', 'Page'], ['views', 'Views'], ['uniq', 'Unique'], ['entry', 'Entries'], ['eng', 'Avg time'], ['wl', 'Wishlist'], ['rate', 'Wl / 100'], ['load', 'Avg load'], ['err', 'Errors']];
  let sortKey = 'views', dir = -1, all = false;
  const TOP = 15;
  const cell = (r, c) => c === 'name' ? (simHref(r.k) ? `<a href="${simHref(r.k)}" target="_top">${esc(r.name)}</a>` : esc(r.name))
    : c === 'views' ? `<span class="mini" style="width:${Math.max(2, (60 * r.views) / max)}px"></span>${fmtInt(r.views)}`
    : c === 'eng' ? dur(r.eng) : c === 'load' ? (isFinite(r.load) ? (r.load / 1000).toFixed(2) + 's' : '–') : c === 'rate' ? (r.views ? r.rate.toFixed(1) : '–') : fmtInt(r[c]);
  const draw = () => {
    rows.sort((a, b) => { const x = a[sortKey], y = b[sortKey]; if (typeof x === 'string') return dir * x.localeCompare(y); return dir * ((isFinite(x) ? x : -1) - (isFinite(y) ? y : -1)); });
    body.innerHTML = `<div class="tbl-wrap"><table class="t"><thead><tr>${cols.map(([c, h]) => `<th class="sort" data-c="${c}"${c === sortKey ? ` aria-sort="${dir < 0 ? 'descending' : 'ascending'}"` : ''}>${h}${c === sortKey ? (dir < 0 ? ' ▾' : ' ▴') : ''}</th>`).join('')}</tr></thead><tbody>` +
      (all ? rows : rows.slice(0, TOP)).map(r => `<tr>${cols.map(([c]) => `<td>${cell(r, c)}</td>`).join('')}</tr>`).join('') + '</tbody></table></div>' +
      `<p class="note">${rows.length} pages with views. ${rows.length > TOP ? `<button type="button" class="ghost tbtn all">${all ? 'Show top ' + TOP : 'Show all ' + rows.length}</button>` : ''}</p>`;
    const b = body.querySelector('button.all');
    if (b) b.addEventListener('click', () => { all = !all; draw(); });
    body.querySelectorAll('th.sort').forEach(th => th.addEventListener('click', () => { const c = th.dataset.c; if (c === sortKey) dir = -dir; else { sortKey = c; dir = c === 'name' ? 1 : -1; } draw(); }));
  };
  draw();
}

function flows(body, S) {
  const f = S.rows('flow').filter(r => r.a !== '(entry)' && r.a !== r.b).sort((a, b) => b.n - a.n).slice(0, 14);
  if (!f.length) return empty(body, 'No page-to-page moves in this range yet.');
  const max = f[0].n;
  body.innerHTML = '<ol class="flowlist">' + f.map(r => `<li><span class="from">${esc(label(r.a))}</span><span class="arrow">→</span><span class="to">${esc(label(r.b))}</span><b>${fmtInt(r.n)}</b></li>`).join('') + '</ol>';
  body.querySelectorAll('.flowlist li').forEach((li, i) => { li.style.background = `linear-gradient(90deg, rgba(57,135,229,.16) ${(100 * f[i].n) / max}%, transparent 0)`; });
}

let topo = null;
async function mapCard(body, cty) {
  if (!window.topojson) return empty(body, 'Map library did not load.');
  if (!topo) {
    try { topo = await (await fetch('../../vendor/world-atlas@2.0.2/countries-110m.json')).json(); } catch (e) { return empty(body, 'Map data did not load.'); }
  }
  const feats = window.topojson.feature(topo, topo.objects.countries).features;
  const vals = new Map(), names = new Map();
  for (const [a2, o] of cty) if (COUNTRIES[a2]) vals.set(COUNTRIES[a2][0], (vals.get(COUNTRIES[a2][0]) || 0) + o.n);
  for (const a2 in COUNTRIES) names.set(COUNTRIES[a2][0], COUNTRIES[a2][1]);
  worldMap(body, feats, vals, names, RAMP);
  const max = Math.max(1, ...vals.values());
  const leg = document.createElement('div');
  leg.className = 'legend';
  leg.innerHTML = '<span>Fewer</span>' + RAMP.map(c => `<i style="background:${c};width:22px;margin:0"></i>`).join('') + `<span>More (max ${fmtInt(max)}, log scale)</span>` + (cty.get('other') ? `<span>· ${fmtInt(cty.get('other').n)} visits in countries with fewer than 3</span>` : '');
  body.appendChild(leg);
}

function privacyCard(w) {
  card({ title: 'What is counted, and what is not', w, cls: 'privacy', render: b => {
    b.innerHTML = `<ul>
      <li><b>Totals only.</b> Each event adds to a count per day, and then the event is gone. No list of visits exists.</li>
      <li><b>No cookies and no stored id.</b> A visit is one browser tab; its page count lives in sessionStorage and ends with the tab.</li>
      <li><b>Unique visitors</b> use a hash of a daily random salt, the IP address and the browser string. The Worker never writes the IP address or the browser string. It deletes each day's hashes and salt the next day, so two days cannot be linked.</li>
      <li><b>Rare values are folded.</b> A country, region, referrer, language or browser with fewer than 3 counts shows as "other".</li>
      <li><b>Not sent:</b> full URLs, page text, anything typed, exact screen size, GPU model, IP address, precise location.</li>
      <li><b>No count</b> when the browser sends Global Privacy Control or Do Not Track, for test browsers, or after "Do not count this browser" here.</li>
      <li>Cloudflare Workers Logs is off for the Worker. Bots with a known user agent are dropped.</li>
    </ul>`;
  } });
}

// ── git history (always) ────────────────────────────────────────────────
async function growthCards() {
  let g;
  try { g = await (await fetch('data/growth.json')).json(); } catch (e) { return; }
  section('Site history', 'from git: the site had no visit counter before ' + (window.__statsSince || 'the Worker'));
  const days = []; for (let d = g.first; d <= g.last; d = addDays(d, 1)) days.push(d);
  const byDay = new Map(); g.pages.forEach(([d]) => byDay.set(d, (byDay.get(d) || 0) + 1));
  let c = 0; const cum = days.map(d => (c += byDay.get(d) || 0));
  const live = window.snPages ? window.snPages().length : 0;
  card({ title: 'Pages on the site', sub: `${g.pages.length} page folders added since ${shortDay(g.first, true)}; ${live} in the nav now`, w: 6,
    render: b => lineChart(b, { x: days, xFmt: shortDay, series: [{ name: 'Pages added (total)', color: C.s1, values: cum }], area: 0, height: 220 }),
    table: () => ({ cols: ['Day', 'Page folder'], rows: g.pages.slice().reverse().map(([d, k]) => [d, label(k)]) }) });
  const wk = new Map();
  for (const [d, n] of g.commits) { const t = Date.parse(d + 'T00:00:00Z'), wd = (new Date(t).getUTCDay() + 6) % 7, mon = dayStr(t - wd * 864e5); wk.set(mon, (wk.get(mon) || 0) + n); }
  const weeks = []; for (let d = dayStr(Date.parse(g.first + 'T00:00:00Z') - ((new Date(g.first + 'T00:00:00Z').getUTCDay() + 6) % 7) * 864e5); d <= g.last; d = addDays(d, 7)) weeks.push(d);
  const total = g.commits.reduce((s, x) => s + x[1], 0);
  card({ title: 'Commits per week', sub: `${fmtInt(total)} commits on ${g.commits.length} days`, w: 6,
    render: b => columns(b, { labels: weeks.map(w => shortDay(w)), values: weeks.map(w => wk.get(w) || 0), color: C.s2, height: 220, tipFmt: i => `<b>Week of ${esc(shortDay(weeks[i], true))}</b><div class="tl">Commits<span>${fmtInt(wk.get(weeks[i]) || 0)}</span></div>` }),
    table: () => ({ cols: ['Week of', 'Commits'], rows: weeks.map(w => [w, fmtInt(wk.get(w) || 0)]).reverse() }) });
}
function drawAll() { draws.forEach(d => { try { d(); } catch (e) { console.error(e); } }); }

// ── live ────────────────────────────────────────────────────────────────
let liveTimer = 0;
async function pollLive() {
  clearTimeout(liveTimer);
  if (document.visibilityState === 'visible') {
    try {
      const r = await fetch(API + '/live', { headers: { Authorization: 'Bearer ' + ls.get(KEY_STORE) } });
      if (r.ok) {
        const L = await r.json();
        $('live').hidden = false;
        $('live-n').textContent = fmtInt(L.total);
        $('live-pages').innerHTML = L.pages.filter(p => p.p).sort((a, b) => b.n - a.n).slice(0, 6).map(p => `<li>${esc(label(p.p))} · ${p.n}</li>`).join('');
      }
    } catch (e) {}
  }
  liveTimer = setTimeout(pollLive, LIVE_MS);
}

// ── fetch ───────────────────────────────────────────────────────────────
async function get(path) {
  const r = await fetch(API + path, { headers: { Authorization: 'Bearer ' + ls.get(KEY_STORE) } });
  if (r.status === 401) throw Object.assign(new Error('key'), { key: true });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
let rangeId = ls.get(RANGE_STORE) || '30d';
async function load() {
  const d = rangeDates(rangeId);
  $('upd').textContent = 'Loading…';
  try {
    const [cur, prev] = await Promise.all([get(`/stats?from=${d.from}&to=${d.to}`), d.prev ? get(`/stats?from=${d.prev.from}&to=${d.prev.to}`) : null]);
    $('gate').hidden = true; $('bar').hidden = false;
    window.__statsSince = cur.since ? shortDay(cur.since, true) : null;
    $('since').textContent = cur.since ? `Counting since ${shortDay(cur.since, true)}. Totals only: no visitor is named or kept.` : 'Counting is on. No visit has arrived yet.';
    buildCards(cur, prev, rangeId);
    await growthCards();
    requestAnimationFrame(drawAll);
    $('upd').textContent = 'Updated ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    pollLive();
  } catch (e) {
    if (e.key) { ls.set(KEY_STORE, null); gate('That key was not accepted.'); return; }
    $('upd').textContent = '';
    $('dash').innerHTML = '';
    draws = [];
    const p = document.createElement('div');
    p.className = 'card w12';
    p.innerHTML = `<h3>Cannot reach the stats Worker</h3><p class="note">${esc(API)} · ${esc(e.message)}</p>`;
    $('dash').appendChild(p);
    $('bar').hidden = false;
  }
}

function gate(msg) {
  $('bar').hidden = true; $('dash').innerHTML = ''; $('live').hidden = true;
  $('gate').hidden = false;
  $('gate-err').hidden = !msg; $('gate-err').textContent = msg || '';
  setTimeout(() => $('gate-key').focus(), 50);
}

function initBar() {
  $('ranges').innerHTML = RANGES.map(([id, t]) => `<button type="button" role="tab" data-r="${id}" aria-selected="${id === rangeId}">${t}</button>`).join('');
  $('ranges').addEventListener('click', e => {
    const b = e.target.closest('button[data-r]'); if (!b) return;
    rangeId = b.dataset.r; ls.set(RANGE_STORE, rangeId);
    $('ranges').querySelectorAll('button').forEach(x => x.setAttribute('aria-selected', x === b));
    load();
  });
  $('refresh').addEventListener('click', load);
  $('forget').addEventListener('click', () => { ls.set(KEY_STORE, null); clearTimeout(liveTimer); gate(); });
  $('optout').checked = !!(window.snStats && window.snStats.optedOut());
  $('optout').addEventListener('change', e => window.snStats && window.snStats.optOut(e.target.checked));
}

async function init() {
  // #stats/key=<key> in the shell becomes #key=<key> here: keep it, then
  // drop it from the address bar and the shell history entry.
  const m = /(?:^#|&)key=([^&]+)/.exec(location.hash);
  if (m) {
    ls.set(KEY_STORE, decodeURIComponent(m[1]));
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
    try { if (window.parent !== window && window.parent.snNav) window.parent.snNav('', 'replace'); } catch (e) {}
  }
  initBar();
  $('gate-form').addEventListener('submit', e => { e.preventDefault(); ls.set(KEY_STORE, $('gate-key').value.trim()); $('gate-key').value = ''; load(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && API && ls.get(KEY_STORE)) pollLive(); });
  let rt = 0;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(drawAll, 150); });
  if (!API) {
    $('nodeploy').hidden = false;
    await growthCards();
    privacyCard(12);
    requestAnimationFrame(drawAll);
    return;
  }
  if (!ls.get(KEY_STORE)) gate();
  else load();
}
init();
