// ============================================================================
//  BLACK OCTOBER  ·  model.js — the pure logic of the page
// ----------------------------------------------------------------------------
//  DOM-free ES module. main.js, render.js, saver.js and tests.mjs use it.
//  Every text it makes comes from the event records or from a fixed name
//  table (THREAD_NAMES). It does not make numbers that are not in the data.
//
//  grep -n targets
//    thread names .......... "export const THREAD_NAMES"
//    layout options ........ "export const LAYOUT_OPTS"
//    thread colours ........ "export function threadColors"
//    UTC text .............. "export function fmtUTC"
//    counts strip .......... "export function counts"
//    view (world <-> px) ... "export function fitView"  "export function toScreen"
//    zoom about a point .... "export function zoomAt"
//    tap / hover pick ...... "export function pick"
//    links of a node ....... "export function linksOf"
//    playhead .............. "export function revealCount"
//    label placement ....... "export function placeLabels"
// ============================================================================
// Display names of the thread ids in data/events.js. A thread that is not
// here shows its id.
export const THREAD_NAMES = Object.freeze({
  'ai-discovery': 'AI-assisted bug hunting',
  php2shell: 'PHP2Shell (PHP)',
  emudhra: 'eMudhra weak CA keys',
  gitlab: 'GitLab regex RCE',
  zeabur: 'Zeabur breach',
  litellm: 'LiteLLM release hijack',
  'cert-in-ai': 'CERT-In AI-agent advisory',
  sbi: 'State Bank of India data',
  railway: 'Railway platform incident',
  opencode: 'OpenCode key exposure',
  'ovhcloud-cli': 'OVHcloud CLI tampering',
  updraft: 'TeamUpdraft breach',
  onamae: 'Onamae.com Desktop Cloud',
  plex: 'Plex2Shell',
  nodejs: 'Node.js security release',
  quest: 'Quest Diagnostics breach',
  'ca-students': 'California student data (ETS)',
  cairn: 'Cairn agent platform',
  'fridge-attack': 'French supermarket refrigeration',
  connectwise: 'ConnectWise Cloud Backup',
  artex: 'ARTEX and Korean banks',
  'claude-code-campaigns': 'Claude Code agent campaigns',
  aomei: 'AOMEI update-server tampering',
  paradigm: 'Paradigm Healthcare (Medi-Cal)',
  pwnescape: 'PwnEscape KVM escape (Linux)',
  'rank-math': "Rank Math PRO tainted release",
  'siemens-ssc': "Siemens Software Center flaw",
  'tor-exits': "Tor exit-relay SSH interception",
  ahold: "Ahold Delhaize outage",
  'bk-japan': "Burger King Japan app data",
  mrmax: "Mr. Max app and store data",
  tidb: "TiDB Cloud (PingCAP) breach",
  bullhorn: "Bullhorn staffing platform",
  flashhole: "Operation FlashHole (Lazarus)",
  nginx: "NGINX October security release",
  'http3-qpack': "HTTP/3 QPACK memory flaws",
  safepay: "SafePay ransomware advisory",
  'palo-alto-gp': "Palo Alto GlobalProtect bypass",
  'meta-muse': "Meta Muse shared chats",
  'signal-ringrtc': "Signal RingRTC hangup bug",
  label: "The 'Black October' label",
});
export const threadName = id => THREAD_NAMES[id] || id;

// The layout options of the page and the saver. linear: each UTC day ring
// has the same width (the events get denser toward the last days).
export const LAYOUT_OPTS = Object.freeze({ seed: 7, scale: 'linear' });

export const CONF_TEXT = Object.freeze({
  confirmed: 'a primary source states it',
  reported: 'news reports only',
  disputed: 'the sources disagree, or the claim is denied',
});
export const KIND_TEXT = Object.freeze({
  disclosure: 'disclosure', patch: 'patch', advisory: 'advisory', exploitation: 'exploitation',
  mitigation: 'mitigation', takedown: 'takedown', 'ca-action': 'certificate authority action',
  statement: 'statement', cve: 'CVE record', correction: 'correction',
  'unrelated-claim': 'claim of no relation', other: 'other',
});
export const PREC_TEXT = Object.freeze({ minute: 'to the minute', hour: 'to the hour', day: 'day only' });

// One colour per thread, in sector order. Golden-angle hues: two sectors
// next to each other never get near hues. Two lightness steps.
export function threadColors(threads) {
  const m = new Map();
  threads.forEach((th, i) => {
    const h = (18 + i * 137.508) % 360, l = i % 2 ? 72 : 63;
    m.set(th.id, `hsl(${h.toFixed(1)} 80% ${l}%)`);
  });
  return m;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = n => String(n).padStart(2, '0');
// UTC text of a time, cut to its precision. 'day' gives the date only.
// 'hour' goes to the nearest hour with "about": some sources give an
// approximate time with minutes (for example 09:10 from a liveblog), and
// the minutes would show a precision that the source does not have.
export function fmtUTC(ms, prec = 'minute') {
  if (prec === 'hour') ms = Math.round(ms / 3600000) * 3600000;
  const d = new Date(ms), date = `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
  if (prec === 'day') return date;
  if (prec === 'hour') return `${date} about ${p2(d.getUTCHours())}:00 UTC`;
  const s = d.getUTCSeconds() ? ':' + p2(d.getUTCSeconds()) : '';
  return `${date} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}${s} UTC`;
}
// A short ring label: "13 Oct".
export const dayLabel = ms => { const d = new Date(ms); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
export const monthLabel = ms => { const d = new Date(ms); return `${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

// The numbers of the counts strip. Sources are distinct URLs.
export function counts(events) {
  const c = { events: events.length, threads: new Set(events.map(e => e.thread)).size,
    sources: new Set(events.flatMap(e => e.sources.map(s => s.url))).size,
    publishers: new Set(events.flatMap(e => e.sources.map(s => s.publisher))).size,
    confirmed: 0, reported: 0, disputed: 0 };
  for (const e of events) c[e.confidence]++;
  return c;
}

// ---------------------------------------------------------------- the view
// view = { cx, cy, s, ox, oy }: screen = (world - c) * s + o, in CSS px.
// The world y axis points down, as on the canvas.
export function fitView(rect, R = 1.14) {
  const s = Math.max(1e-3, Math.min(rect.w, rect.h) / 2 / R);
  return { cx: 0, cy: 0, s, ox: rect.x + rect.w / 2, oy: rect.y + rect.h / 2 };
}
export const toScreen = (v, x, y) => [(x - v.cx) * v.s + v.ox, (y - v.cy) * v.s + v.oy];
export const toWorld = (v, px, py) => [(px - v.ox) / v.s + v.cx, (py - v.oy) / v.s + v.cy];
// Zoom by f about the screen point (px, py): that point stays still.
export function zoomAt(v, f, px, py, min = 0, max = Infinity) {
  const s = Math.min(max, Math.max(min, v.s * f));
  const [wx, wy] = toWorld(v, px, py);
  return { ...v, s, cx: wx - (px - v.ox) / s, cy: wy - (py - v.oy) / s };
}
// Put world (x, y) at screen (px, py).
export const centreOn = (v, x, y, px = v.ox, py = v.oy) => ({ ...v, cx: x - (px - v.ox) / v.s, cy: y - (py - v.oy) / v.s });

// The nearest shown node within reach px of the screen point, or null.
// shown(n, i) says if node i is on screen.
export function pick(nodes, v, px, py, reach = 14, shown = () => true) {
  let best = null, bd = reach * reach;
  nodes.forEach((n, i) => {
    if (!shown(n, i)) return;
    const [x, y] = toScreen(v, n.x, n.y), d = (x - px) ** 2 + (y - py) ** 2;
    if (d <= bd) { bd = d; best = n; }
  });
  return best;
}

// Parent, children, ancestors to the root, and related links (both ways).
export function linksOf(L, id) {
  const n = L.byId.get(id);
  if (!n) return null;
  const chain = [];
  for (let c = n; c && c.parent; c = L.byId.get(c.parent)) chain.push(c.parent);
  const children = L.nodes.filter(m => m.parent === id).map(m => m.id);
  const out = (n.ev.related || []).filter(r => L.byId.has(r));
  const inn = L.nodes.filter(m => (m.ev.related || []).includes(id)).map(m => m.id);
  return { parent: n.parent, chain, children, related: [...new Set([...out, ...inn])] };
}

// All related pairs, once each, as [idA, idB] in time order of the later end.
export function relatedPairs(L) {
  const seen = new Set(), out = [];
  for (const n of L.nodes) for (const r of n.ev.related || []) {
    if (!L.byId.has(r)) continue;
    const k = [n.id, r].sort().join('|');
    if (!seen.has(k)) { seen.add(k); out.push([n.id, r]); }
  }
  return out;
}

// The number of nodes shown at time ms (nodes are in time order).
export function revealCount(nodes, ms) {
  let k = 0;
  while (k < nodes.length && nodes[k].t <= ms) k++;
  return k;
}

// Greedy label placement. items = [{ x, y, w, h, pri, ... }] in screen px
// (x, y = the node). Each label goes right or left of its node. A label
// that hits a placed box or a blocked box is dropped. Returns the kept
// items with lx, ly (the left-top corner of the text box).
export function placeLabels(items, blocked = [], max = 140, pad = 3) {
  const boxes = blocked.slice(), out = [];
  const hit = b => boxes.some(q => b.x0 < q.x1 && b.x1 > q.x0 && b.y0 < q.y1 && b.y1 > q.y0);
  for (const it of [...items].sort((a, b) => b.pri - a.pri)) {
    if (out.length >= max) break;
    for (const side of [1, -1]) {
      const lx = side > 0 ? it.x + 6 : it.x - 6 - it.w, ly = it.y - it.h / 2;
      const b = { x0: lx - pad, y0: ly - pad / 2, x1: lx + it.w + pad, y1: ly + it.h + pad / 2 };
      if (!hit(b)) { boxes.push(b); out.push({ ...it, lx, ly }); break; }
    }
  }
  return out;
}
