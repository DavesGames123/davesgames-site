// ============================================================================
//  LIVE  ·  ADS-B positions -> departures and arrivals board rows
// ----------------------------------------------------------------------------
//  Every POLL_MS the feed reads all aircraft within RADIUS_NM of the airport
//  from adsb.lol, through the proxy Worker (worker/worker.js). An aircraft
//  with an airline callsign (three letters, then a digit) is a candidate.
//  adsbdb.com gives the route of each candidate callsign (cached in
//  localStorage). An aircraft is on the board when its route starts or ends
//  at this airport and its position agrees with that:
//    departure  on the ground here, or in the air and not flying toward
//               the airport (closer than 10 nm passes)
//    arrival    on the ground here, or in the air and flying toward it
//  classify() gives the status and the time. Wheels-up and touchdown are
//  "seen" when the feed sees the ground/air change. Else the time is an
//  estimate ("est"): wheels-up from distance flown, ETA from distance to
//  go. A row that leaves the feed stays for KEEP_MS with a final status.
//
//  grep -n targets
//    feed poll ............ "async function poll"
//    route lookup ......... "async function lookup"
//    status and time ...... "function classify"
//    row retention ........ "const KEEP_MS"
// ============================================================================
import { distNm, bearing, angleDiff } from './geo.js';

const RADIUS_NM = 180;
const POLL_MS = 12000;
const KEEP_MS = 30 * 60e3;
const LOST_MS = 4 * 60e3;
const AIRLINE_CS = /^[A-Z]{3}\d[0-9A-Z]{0,4}$/;
const ROUTE_KEY = 'fb.routes.v2';
const ROUTE_TTL = 18 * 3600e3, MISS_TTL = 3 * 3600e3;
const ADSBDB = 'https://api.adsbdb.com/v0';

// ---- route cache (shared by every airport) --------------------------------
let routes = null;
function routeStore() {
  if (routes) return routes;
  routes = new Map();
  try {
    const now = Date.now();
    for (const [cs, [t, r]] of Object.entries(JSON.parse(localStorage.getItem(ROUTE_KEY) || '{}'))) {
      if (now - t < (r ? ROUTE_TTL : MISS_TTL)) routes.set(cs, { t, r });
    }
  } catch { /* storage off: work from memory */ }
  return routes;
}
let saveTimer = 0;
function saveRoutes() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const o = {};
      const all = [...routes].sort((a, b) => b[1].t - a[1].t).slice(0, 4000);
      for (const [cs, v] of all) o[cs] = [v.t, v.r];
      localStorage.setItem(ROUTE_KEY, JSON.stringify(o));
    } catch { /* quota or storage off */ }
  }, 1500);
}

function leg(a) {
  if (!a) return null;
  return {
    iata: a.iata_code || '', icao: a.icao_code || '', name: a.name || '',
    city: (a.municipality || a.name || '').replace(/\s*\(.*\)\s*/g, ' ').split(/\s*[\/,]\s*/)[0].trim(),
    country: a.country_iso_name || '', lat: +a.latitude, lon: +a.longitude,
  };
}

function normRoute(fr) {
  const legs = [leg(fr.origin), leg(fr.midpoint), leg(fr.destination)].filter(Boolean);
  const al = fr.airline || {};
  let num = fr.callsign_iata || fr.callsign || '';
  if (al.iata && num.startsWith(al.iata)) num = `${al.iata} ${num.slice(al.iata.length)}`;
  else if (!/^[A-Z0-9]{2}\d/.test(num) || /^\d/.test(num)) num = fr.callsign_icao || fr.callsign || num;
  return { flight: num, airline: { name: al.name || '', iata: al.iata || '', icao: al.icao || '' }, legs };
}

// Route of one callsign: a route, null (adsbdb does not know it), or
// undefined (not asked yet / failed; ask again later).
export async function lookup(cs) {
  const st = routeStore();
  const hit = st.get(cs);
  if (hit) return hit.r;
  const res = await fetch(`${ADSBDB}/callsign/${encodeURIComponent(cs)}`, { signal: AbortSignal.timeout(10000) });
  if (res.status === 404) { st.set(cs, { t: Date.now(), r: null }); saveRoutes(); return null; }
  if (!res.ok) { const e = new Error(`adsbdb ${res.status}`); e.status = res.status; throw e; }
  const j = await res.json();
  const fr = j?.response?.flightroute;
  const r = fr ? normRoute(fr) : null;
  st.set(cs, { t: Date.now(), r });
  saveRoutes();
  return r;
}

export function cachedRoute(cs) { return routeStore().get(cs)?.r; }

// One aircraft from the proxy, for the detail card.
export async function fetchHex(proxy, hex) {
  const res = await fetch(`${proxy}/hex/${hex}`);
  if (!res.ok) throw new Error(`proxy ${res.status}`);
  const j = await res.json();
  return (j.ac && j.ac[0]) || null;
}

const isGround = (ac) => ac.alt_baro === 'ground';
const matchApt = (l, A) => l && ((A.icao && l.icao === A.icao) || (A.iata && l.iata === A.iata));

// Status and time of one aircraft for airport A, or null when the route
// and the position do not agree. tr is the per-aircraft memory.
function classify(ac, A, route, tr, now) {
  const legs = route.legs;
  const i = legs.findIndex((l) => matchApt(l, A));
  if (i < 0) return null;
  const g = isGround(ac);
  const d = distNm(A.lat, A.lon, ac.lat, ac.lon);
  const alt = g ? 0 : (+ac.alt_baro || +ac.alt_geom || 0);
  const gs = +ac.gs || 0;
  const toward = ac.track != null ? angleDiff(+ac.track, bearing(ac.lat, ac.lon, A.lat, A.lon)) < 90 : null;
  let dir;
  if (i === 0) dir = 'dep';
  else if (i === legs.length - 1) dir = 'arr';
  else dir = g ? (tr.seenAir ? 'arr' : 'dep') : (toward ? 'arr' : 'dep');
  if (g && d > 6) return null;
  if (!g && d > 10 && toward != null) {
    if (dir === 'dep' && toward) return null;
    if (dir === 'arr' && !toward) return null;
  }
  const other = dir === 'dep' ? legs[i + 1] : legs[i - 1];
  if (!other) return null;

  let status, tone, time = null, kind = null;
  if (dir === 'dep') {
    if (g) {
      status = gs >= 3 ? 'Taxiing' : 'At gate';
      tone = gs >= 3 ? 'amber' : 'white';
    } else {
      if (tr.ground === true && !tr.off) { tr.off = now; tr.offKind = 'seen'; }
      if (!tr.off) {
        // Mean ground speed from the runway: slow in the climb, then gs.
        const avg = Math.max(150, 0.72 * gs);
        tr.off = now - (d / avg) * 3600e3 - 60e3;
        tr.offKind = 'est';
      }
      time = tr.off; kind = tr.offKind;
      status = alt < 4000 && d < 10 ? 'Takeoff' : 'Departed';
      tone = status === 'Takeoff' ? 'amber' : 'green';
    }
  } else {
    if (g) {
      if (tr.ground === false && !tr.on) { tr.on = now; tr.onKind = 'seen'; }
      status = gs >= 3 ? 'Landed' : 'Arrived';
      tone = 'green';
      time = tr.on || null; kind = tr.onKind || null;
    } else {
      const v = Math.max(gs, 130) * (alt > 15000 ? 1 : 0.9);
      const eta = now + (d / v) * 3600e3 + (d > 25 ? 4 * 60e3 : 0);
      tr.eta = tr.eta ? tr.eta * 0.6 + eta * 0.4 : eta;
      time = tr.eta; kind = 'est';
      status = d < 12 && alt < 4000 ? 'Final' : d < 70 ? 'Approach' : 'En route';
      tone = status === 'En route' ? 'white' : 'amber';
    }
  }
  return { dir, other, status, tone, time, kind, d };
}

// Start the live feed for airport A. onRows(rows) gets every row after each
// poll; onStatus({state, text}) reports the feed state.
export function createLive({ proxy, airport: A, onRows, onStatus }) {
  const memo = new Map();          // hex -> per-aircraft memory
  const rows = new Map();          // hex -> row
  const queue = [];                // callsigns to look up
  const queued = new Set();
  let stopped = false, pollTimer = 0, working = 0, backoff = 0, total = 0, lastAc = [];
  let busyLookup = 0, stamp = 0;

  function build(ac, now) {
    const cs = (ac.flight || '').trim();
    const route = cachedRoute(cs);
    if (!route) return;
    const tr = memo.get(ac.hex) || {};
    memo.set(ac.hex, tr);
    const c = classify(ac, A, route, tr, now);
    tr.ground = isGround(ac);
    tr.seenAir = tr.seenAir || !tr.ground;
    if (!c) { rows.delete(ac.hex); return; }
    rows.set(ac.hex, {
      id: ac.hex, hex: ac.hex, source: 'live', callsign: cs,
      flight: route.flight || cs, airline: route.airline, other: c.other, legs: route.legs,
      dir: c.dir, status: c.status, tone: c.tone, time: c.time, kind: c.kind,
      type: ac.t || '', reg: ac.r || '', dist: c.d,
      alt: isGround(ac) ? 0 : +ac.alt_baro || 0, gs: +ac.gs || 0, track: ac.track,
      lat: ac.lat, lon: ac.lon, seen: now, stamp, live: true,
    });
  }

  function publish() {
    const now = Date.now();
    for (const [hex, r] of rows) {
      if (r.stamp === stamp) continue;
      const final = r.status === 'Departed' || r.status === 'Arrived' || r.status === 'Landed';
      if (r.live) {
        r.live = false;
        if (r.dir === 'dep' && r.status !== 'At gate' && r.status !== 'Taxiing') { r.status = 'Departed'; r.tone = 'green'; }
        if (r.dir === 'arr' && (r.status === 'Landed')) r.status = 'Arrived';
      }
      if (now - r.seen > (final ? KEEP_MS : LOST_MS)) rows.delete(hex);
    }
    onRows([...rows.values()]);
  }

  async function pump() {
    while (!stopped && queue.length && busyLookup < 4) {
      const cs = queue.shift();
      busyLookup++;
      lookup(cs).then(() => {
        queued.delete(cs);
        const now = Date.now();
        for (const ac of lastAc) if ((ac.flight || '').trim() === cs) build(ac, now);
      }).catch((e) => {
        queued.delete(cs);
        if (e.status === 429) backoff = Date.now() + 15000;
      }).finally(() => {
        busyLookup--;
        working++;
        if (working % 6 === 0 || !queue.length) { publish(); status(); }
        if (backoff > Date.now()) setTimeout(pump, backoff - Date.now());
        else pump();
      });
    }
  }

  function status(err) {
    if (err) { onStatus({ state: 'error', text: err }); return; }
    const pending = queue.length + busyLookup;
    onStatus({
      state: pending ? 'busy' : 'ok',
      text: pending ? `Identifying flights · ${pending} to go` : `Live · ${total} aircraft in range`,
      total, pending,
    });
  }

  async function poll() {
    if (stopped) return;
    clearTimeout(pollTimer);
    if (document.hidden) { pollTimer = setTimeout(poll, 2000); return; }
    try {
      const res = await fetch(`${proxy}/point/${A.lat.toFixed(4)}/${A.lon.toFixed(4)}/${RADIUS_NM}`, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`proxy answered ${res.status}`);
      const j = await res.json();
      if (stopped) return;
      const now = Date.now();
      stamp++;
      const ac = (j.ac || []).filter((a) => a.lat != null && AIRLINE_CS.test((a.flight || '').trim()));
      total = (j.ac || []).length;
      lastAc = ac;
      const want = [];
      for (const a of ac) {
        const cs = a.flight.trim();
        const d = distNm(A.lat, A.lon, a.lat, a.lon);
        if (isGround(a) ? d > 6 : false) continue;
        if (cachedRoute(cs) !== undefined) { build(a, now); continue; }
        if (!queued.has(cs)) want.push([d, cs]);
      }
      want.sort((x, y) => x[0] - y[0]);
      for (const [, cs] of want) { queued.add(cs); queue.push(cs); }
      publish();
      status();
      pump();
    } catch (e) {
      status(`Live feed unreachable (${e.message})`);
    }
    if (!stopped) pollTimer = setTimeout(poll, POLL_MS);
  }

  poll();
  return {
    stop() { stopped = true; clearTimeout(pollTimer); },
    refresh() { poll(); },
    row(hex) { return rows.get(hex); },
  };
}
