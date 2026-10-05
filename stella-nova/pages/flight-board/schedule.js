// ============================================================================
//  SCHEDULE  ·  AeroDataBox airport FIDS -> board rows
// ----------------------------------------------------------------------------
//  The schedule mode uses the viewer's own RapidAPI key for AeroDataBox.
//  The key stays in localStorage and goes only to aerodatabox.p.rapidapi.com.
//  One call gives a 12 h window (2 h back, 10 h ahead) of departures and
//  arrivals. The answer stays in sessionStorage for CACHE_MS, because the
//  free plan counts calls.
//
//  Codeshares: AeroDataBox gives one record per flight number. Records with
//  the same time, other airport and operator callsign are one flight.
//  group() keeps the operating carrier as the row and lists the others in
//  row.codeshares. With "show codeshares" on, each number is its own row.
//
//  The answer shape follows the AeroDataBox v1 FIDS docs. It was not run
//  against a live key here. norm() reads both the "movement" and the older
//  "departure"/"arrival" shapes and skips fields that are missing.
//
//  grep -n targets: export async function loadSchedule | function norm |
//                   function group | const STATUS
// ============================================================================

const HOST = 'aerodatabox.p.rapidapi.com';
const CACHE_MS = 10 * 60e3;

const STATUS = {
  Expected: ['Scheduled', 'white'], Unknown: ['Scheduled', 'white'],
  CheckIn: ['Check-in', 'blue'], Boarding: ['Boarding', 'blue'], GateClosed: ['Gate closed', 'amber'],
  Departed: ['Departed', 'green'], EnRoute: ['En route', 'white'], Approaching: ['Approach', 'amber'],
  Arrived: ['Arrived', 'green'], Delayed: ['Delayed', 'red'], Diverted: ['Diverted', 'red'],
  Canceled: ['Cancelled', 'red'], CanceledUncertain: ['Cancelled?', 'red'],
};

function t(x) {
  if (!x) return null;
  const s = typeof x === 'string' ? x : x.utc;
  if (!s) return null;
  const ms = Date.parse(s.replace(' ', 'T').replace(/Z?$/, 'Z'));
  return isFinite(ms) ? ms : null;
}

function norm(f, dir) {
  const mv = f.movement || (dir === 'dep' ? f.arrival : f.departure) || {};
  const here = f.movement || (dir === 'dep' ? f.departure : f.arrival) || {};
  const ap = mv.airport || {};
  const sched = t(here.scheduledTime || here.scheduledTimeUtc);
  const rev = t(here.revisedTime || here.actualTime || here.actualTimeUtc || here.estimatedTime);
  const runway = t(here.runwayTime);
  let [status, tone] = STATUS[f.status] || [f.status || 'Scheduled', 'white'];
  const late = sched && rev ? Math.round((rev - sched) / 60000) : 0;
  if (late >= 15 && (status === 'Scheduled' || status === 'Check-in' || status === 'Boarding' || status === 'En route')) {
    status = 'Delayed'; tone = 'red';
  }
  const al = f.airline || {};
  return {
    id: `${dir}|${f.number}|${sched}`, source: 'schedule', dir,
    flight: (f.number || '').replace(/\s+/, ' '), callsign: f.callSign || '',
    airline: { name: al.name || '', iata: al.iata || '', icao: al.icao || '' },
    other: { iata: ap.iata || '', icao: ap.icao || '', name: ap.name || '', city: ap.municipalityName || ap.name || '', tz: ap.timeZone || '' },
    sched, rev, runway, late, time: sched, status, tone, kind: 'sched',
    terminal: here.terminal || '', gate: here.gate || '', belt: here.baggageBelt || '',
    type: f.aircraft?.model || '', reg: f.aircraft?.reg || '', hex: (f.aircraft?.modeS || '').toLowerCase(),
    shareStatus: f.codeshareStatus || 'Unknown', isCargo: !!f.isCargo, codeshares: [],
  };
}

// Fold codeshare records into the operating flight.
function group(list) {
  const ops = new Map();
  const key = (r) => `${r.dir}|${r.sched}|${r.other.icao || r.other.iata}|${r.callsign || r.reg}`;
  for (const r of list) if (r.shareStatus !== 'IsCodeshared') {
    const k = key(r);
    if (!ops.has(k)) ops.set(k, r);
  }
  const out = [...ops.values()];
  for (const r of list) {
    if (r.shareStatus !== 'IsCodeshared') continue;
    const op = ops.get(key(r));
    if (op) { op.codeshares.push(r.flight); r.operatedBy = op.flight; }
    else out.push(r);
  }
  return out;
}

// Load the 12 h window for airport A. Returns { all, grouped }.
export async function loadSchedule(A, key, force = false) {
  const ck = `fb.sched.${A.iata}`;
  if (!force) {
    try {
      const c = JSON.parse(sessionStorage.getItem(ck) || 'null');
      if (c && Date.now() - c.t < CACHE_MS) return c.v;
    } catch { /* no cache */ }
  }
  const q = 'offsetMinutes=-120&durationMinutes=720&withLeg=false&direction=Both&withCancelled=true&withCodeshared=true&withCargo=false&withPrivate=false&withLocation=false';
  const res = await fetch(`https://${HOST}/flights/airports/iata/${A.iata}?${q}`, {
    headers: { 'x-rapidapi-key': key, 'x-rapidapi-host': HOST },
  });
  if (res.status === 204) return { all: [], grouped: [] };
  if (!res.ok) {
    const msg = res.status === 401 || res.status === 403 ? 'the key was refused'
      : res.status === 429 ? 'the plan limit is used up' : `AeroDataBox answered ${res.status}`;
    throw new Error(msg);
  }
  const j = await res.json();
  const all = [
    ...(j.departures || []).map((f) => norm(f, 'dep')),
    ...(j.arrivals || []).map((f) => norm(f, 'arr')),
  ].filter((r) => r.sched);
  const v = { all, grouped: group(all.map((r) => ({ ...r, codeshares: [] }))) };
  try { sessionStorage.setItem(ck, JSON.stringify({ t: Date.now(), v })); } catch { /* full */ }
  return v;
}
