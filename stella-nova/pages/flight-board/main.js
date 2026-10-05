// ============================================================================
//  FLIGHT BOARD  ·  main.js — boot, state, header, picker, rows, settings
// ----------------------------------------------------------------------------
//  The board shows one airport and one direction (departures or arrivals).
//  The data comes from one of two feeds (see index.html, DATA PATHS):
//    live      live.js     createLive() polls ADS-B through the proxy
//    schedule  schedule.js loadSchedule() with the viewer's AeroDataBox key
//  Each feed gives board rows of one shape. render() sorts them, puts a
//  NOW divider between past and future, and writes them into flap fields
//  (flap.js). A click on a row opens the detail card (detail.js).
//
//  The URL hash keeps the view: #ORD or #ORD/arrivals. localStorage keeps
//  the last airport, the recent list, the mode, the key and the proxy URL.
//
//  grep -n targets
//    proxy URL ............ "const PROXY_URL"
//    first airport ........ "function firstAirport"
//    feed start ........... "function startFeed"
//    board rows ........... "function render"
//    sort and divider ..... "function ordered"
//    airport search ....... "function openPicker"
//    settings dialog ...... "function openSettings"
//    clock ................ "function clockTick"
// ============================================================================
import { setFlap } from './flap.js';
import { createLive } from './live.js';
import { loadSchedule } from './schedule.js';
import { fmtTime, fmtDate, tzName, distNm } from './geo.js';
import { openDetail, closeDetail, updateDetail, detailOpenId } from './detail.js';

// After `npx wrangler deploy` in worker/, put the printed workers.dev URL
// here. Until then the board on davesgames.io asks for it in settings.
const PROXY_URL = '';

const HUBS = ['ATL', 'ORD', 'DFW', 'DEN', 'LAX', 'JFK', 'SFO', 'SEA', 'MIA', 'BOS', 'IAH', 'PHX', 'MSP', 'DTW',
  'YYZ', 'YVR', 'MEX', 'GRU', 'BOG', 'LIM', 'SCL', 'EZE', 'LHR', 'CDG', 'FRA', 'AMS', 'MAD', 'BCN', 'FCO',
  'MUC', 'ZRH', 'VIE', 'DUB', 'CPH', 'OSL', 'ARN', 'HEL', 'WAW', 'LIS', 'IST', 'DXB', 'DOH', 'CAI', 'ADD',
  'NBO', 'JNB', 'LOS', 'DEL', 'BOM', 'BKK', 'SIN', 'KUL', 'MNL', 'HKG', 'TPE', 'ICN', 'HND', 'PEK', 'PVG',
  'CAN', 'SYD', 'MEL', 'AKL', 'ANC', 'HNL'];
const CHIPS = ['ORD', 'ATL', 'JFK', 'LAX', 'LHR', 'CDG', 'AMS', 'FRA', 'DXB', 'IST', 'SIN', 'HND', 'HKG', 'SYD'];
const LEN = { time: 5, flight: 7, place: 14, status: 11 };

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* off */ } },
};
const regionName = (() => { try { const dn = new Intl.DisplayNames(['en'], { type: 'region' }); return (c) => { try { return dn.of(c); } catch { return c; } }; } catch { return (c) => c; } })();

const S = {
  airports: [], byIata: new Map(), byIcao: new Map(),
  A: null, dir: 'dep', mode: store.get('fb.mode', 'live'),
  key: store.get('fb.key', ''), filter: '', showShares: false,
  rows: [], feed: null, feedState: { state: 'busy', text: 'Starting' },
  sched: null, gen: 0, painted: new Set(),
};

function proxyBase() {
  const q = new URLSearchParams(location.search).get('proxy');
  const v = q || store.get('fb.proxy') || PROXY_URL;
  if (v) return v.replace(/\/+$/, '');
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return 'http://localhost:8787';
  return '';
}

// ---- airports ---------------------------------------------------------------
async function loadAirports() {
  const res = await fetch('data/airports.json');
  const rows = await res.json();
  S.airports = rows.map(([iata, icao, name, city, country, lat, lon, tz, size]) => ({
    iata, icao, name, city: city || name, country, lat, lon, tz, size,
    key: `${iata} ${icao} ${name} ${city} ${regionName(country)}`.toLowerCase(),
  }));
  for (const a of S.airports) {
    if (!S.byIata.has(a.iata)) S.byIata.set(a.iata, a);
    if (a.icao && !S.byIcao.has(a.icao)) S.byIcao.set(a.icao, a);
  }
}

export function airportOf(o) {
  if (!o) return null;
  return (o.icao && S.byIcao.get(o.icao)) || (o.iata && S.byIata.get(o.iata)) || null;
}

function firstAirport() {
  const h = location.hash.slice(1).split('/');
  const code = (h[0] || '').toUpperCase();
  if (h[1] === 'arrivals') S.dir = 'arr';
  const fromHash = S.byIata.get(code) || S.byIcao.get(code);
  if (fromHash) return fromHash;
  const last = S.byIata.get(store.get('fb.apt', ''));
  if (last) return last;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  for (const c of HUBS) { const a = S.byIata.get(c); if (a && a.tz === tz) return a; }
  return S.byIata.get('ORD');
}

function setAirport(a, push = true) {
  if (!a) return;
  S.A = a;
  store.set('fb.apt', a.iata);
  const rec = [a.iata, ...JSON.parse(store.get('fb.recent', '[]')).filter((c) => c !== a.iata)].slice(0, 8);
  store.set('fb.recent', JSON.stringify(rec));
  setFlap($('aptCode'), a.iata, 3);
  $('aptName').textContent = a.name;
  $('aptPlace').textContent = `${a.city} · ${regionName(a.country)}${a.icao ? ' · ' + a.icao : ''}`;
  document.title = `${a.iata} ${S.dir === 'dep' ? 'Departures' : 'Arrivals'} — Flight Board · davesgames.io`;
  if (push) writeHash();
  closeDetail(true);
  clockTick(true);
  startFeed();
}

function writeHash() {
  const h = `#${S.A.iata}${S.dir === 'arr' ? '/arrivals' : ''}`;
  if (location.hash !== h) history.replaceState(null, '', h);
}

// ---- feeds -------------------------------------------------------------------
function startFeed(force = false) {
  const gen = ++S.gen;
  if (S.feed) { S.feed.stop(); S.feed = null; }
  S.rows = [];
  S.autoScroll = true;
  S.painted.clear();
  $('rows').textContent = '';
  rowEls.clear();
  const A = S.A;
  if (S.mode === 'schedule' && S.key) {
    feedStatus({ state: 'busy', text: `Loading the ${A.iata} timetable` });
    render();
    loadSchedule(A, S.key, force).then((v) => {
      if (gen !== S.gen) return;
      S.sched = v;
      S.rows = S.showShares ? v.all : v.grouped;
      const n = v.grouped.length;
      feedStatus({ state: 'ok', text: `Schedule · ${n} flights, ${fmtTime(Date.now() - 2 * 3600e3, A.tz)} to ${fmtTime(Date.now() + 10 * 3600e3, A.tz)}` });
      render(true);
    }).catch((e) => {
      if (gen !== S.gen) return;
      feedStatus({ state: 'error', text: `Schedule failed: ${e.message}` });
      render();
    });
    return;
  }
  const proxy = proxyBase();
  if (!proxy) {
    feedStatus({ state: 'error', text: 'Live feed not connected' });
    render();
    return;
  }
  S.feed = createLive({
    proxy, airport: A,
    onRows(rows) {
      if (gen !== S.gen) return;
      S.rows = rows;
      render(S.autoScroll && rows.length > 0);
      const id = detailOpenId();
      if (id) { const r = rows.find((x) => x.id === id); if (r) updateDetail(r); }
    },
    onStatus(st) {
      if (gen !== S.gen) return;
      feedStatus(st);
      // Follow NOW until the first lookup pass ends or the viewer scrolls.
      if (st.state === 'ok' && S.autoScroll) { render(true); S.autoScroll = false; }
      else if (st.state !== 'busy' || !S.rows.length) render();
    },
  });
}

function feedStatus(st) {
  S.feedState = st;
  $('feed').dataset.state = st.state;
  $('feedText').textContent = st.text;
  $('credits').innerHTML = S.mode === 'schedule' && S.key
    ? 'Schedule <a href="https://aerodatabox.com" target="_blank" rel="noopener">AeroDataBox</a> · airports <a href="https://ourairports.com" target="_blank" rel="noopener">OurAirports</a>'
    : 'Positions <a href="https://adsb.lol" target="_blank" rel="noopener">adsb.lol</a> (ODbL) · routes <a href="https://www.adsbdb.com" target="_blank" rel="noopener">adsbdb</a> · airports <a href="https://ourairports.com" target="_blank" rel="noopener">OurAirports</a>';
}

// ---- board -------------------------------------------------------------------
const rowEls = new Map();

function hue(s) { let h = 0; for (const c of s || '?') h = (h * 31 + c.charCodeAt(0)) % 360; return h; }

function makeRow(r) {
  const el = document.createElement('div');
  el.className = 'row';
  el.setAttribute('role', 'listitem');
  el.tabIndex = 0;
  el.innerHTML = `<span class="c-time"><span class="flaps f-time"></span><small class="sub"></small></span>` +
    `<span class="c-flight"><span class="flaps f-flight"></span><small class="shares"></small></span>` +
    `<span class="c-place"><span class="flaps f-place"></span><small class="code"></small></span>` +
    `<span class="c-airline"><i class="badge"></i><span class="aname"></span></span>` +
    `<span class="c-extra"></span>` +
    `<span class="c-status"><span class="flaps f-status"></span></span>`;
  el.dataset.id = r.id;
  return el;
}

function paintRow(el, r, animate) {
  const tz = S.A.tz;
  const q = (s) => el.querySelector(s);
  setFlap(q('.f-time'), r.time ? fmtTime(r.time, tz) : '', LEN.time, animate);
  let sub = '';
  if (r.source === 'schedule') {
    if (r.rev && Math.abs(r.rev - r.sched) >= 60000) sub = `${r.status === 'Departed' || r.status === 'Arrived' ? '' : '→ '}${fmtTime(r.rev, tz)}`;
  } else if (r.kind === 'est') sub = 'est';
  else if (r.kind === 'seen') sub = r.dir === 'dep' ? 'wheels up' : 'touchdown';
  q('.sub').textContent = sub;
  q('.sub').classList.toggle('late', r.source === 'schedule' && r.late >= 15);
  setFlap(q('.f-flight'), r.flight.replace(/\s+/g, ' '), LEN.flight, animate);
  q('.shares').textContent = r.codeshares && r.codeshares.length && !S.showShares ? `+${r.codeshares.length}` : '';
  setFlap(q('.f-place'), r.other.city || r.other.iata, LEN.place, animate);
  q('.code').textContent = r.other.iata || r.other.icao;
  const b = q('.badge');
  b.textContent = r.airline.iata || r.airline.icao || r.flight.slice(0, 2);
  b.style.setProperty('--h', hue(r.airline.icao || r.airline.iata || r.flight));
  q('.aname').textContent = r.operatedBy ? `${r.airline.name} · operated as ${r.operatedBy}` : r.airline.name;
  const extra = q('.c-extra');
  if (r.source === 'schedule') {
    extra.innerHTML = r.terminal || r.gate
      ? `${r.terminal ? `<b>T${r.terminal.replace(/^T/i, '')}</b>` : ''}${r.gate ? `<span>Gate ${r.gate}</span>` : ''}`
      : '<span class="dim">—</span>';
  } else {
    extra.innerHTML = `<b>${r.type || '—'}</b><span>${r.reg || ''}</span>`;
  }
  setFlap(q('.f-status'), r.status, LEN.status, animate);
  el.dataset.tone = r.tone;
  el.classList.toggle('lost', r.source === 'live' && !r.live);
  el.classList.toggle('cargo', !!r.isCargo);
}

function matches(r, f) {
  if (!f) return true;
  return `${r.flight} ${r.callsign} ${r.other.city} ${r.other.iata} ${r.other.icao} ${r.airline.name} ${(r.codeshares || []).join(' ')} ${r.reg}`.toLowerCase().includes(f);
}

// Past rows first (oldest at top), then the NOW divider, then the future.
function ordered(list) {
  const now = Date.now();
  if (S.mode === 'schedule' && S.key) {
    const s = [...list].sort((a, b) => a.sched - b.sched || a.flight.localeCompare(b.flight));
    const cut = s.findIndex((r) => (r.rev || r.sched) >= now - 5 * 60e3 && !/Departed|Arrived|Cancel/.test(r.status));
    return { list: s, cut: cut < 0 ? s.length : cut };
  }
  const past = [], future = [];
  for (const r of list) {
    const done = r.dir === 'dep' ? !/At gate|Taxiing/.test(r.status) : /Landed|Arrived/.test(r.status);
    (done ? past : future).push(r);
  }
  past.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
  if (S.dir === 'dep') {
    const w = { Taxiing: 0, 'At gate': 1 };
    future.sort((a, b) => w[a.status] - w[b.status] || (b.gs - a.gs) || a.flight.localeCompare(b.flight));
  } else future.sort((a, b) => (a.time ?? 9e15) - (b.time ?? 9e15));
  return { list: [...past, ...future], cut: past.length };
}

let nowEl = null;
function render(scrollToNow = false) {
  if (!S.A) return;
  const box = $('rows');
  const f = S.filter.trim().toLowerCase();
  const mine = S.rows.filter((r) => r.dir === S.dir && matches(r, f));
  const { list, cut } = ordered(mine);
  const keep = new Set(list.map((r) => r.id));
  for (const [id, el] of rowEls) if (!keep.has(id)) { el.remove(); rowEls.delete(id); }
  if (!nowEl) {
    nowEl = document.createElement('div');
    nowEl.className = 'now';
    nowEl.innerHTML = '<span>Now</span>';
  }
  const seq = [];
  list.forEach((r, i) => {
    if (i === cut) seq.push(nowEl);
    let el = rowEls.get(r.id);
    const fresh = !el;
    if (fresh) { el = makeRow(r); rowEls.set(r.id, el); }
    paintRow(el, r, !fresh || S.painted.size < 60);
    if (fresh) S.painted.add(r.id);
    el._row = r;
    seq.push(el);
  });
  if (cut >= list.length && list.length) seq.push(nowEl);
  if (!list.length) nowEl.remove();
  // Move only when the order changed, so a scroll position stays.
  const cur = [...box.children];
  if (cur.length !== seq.length || cur.some((e, i) => e !== seq[i])) {
    seq.forEach((e, i) => { if (box.children[i] !== e) box.insertBefore(e, box.children[i] || null); });
  }
  $('colPlace').textContent = S.dir === 'dep' ? 'Destination' : 'Origin';
  $('colExtra').textContent = S.mode === 'schedule' && S.key ? 'Gate' : 'Aircraft';
  $('board').dataset.mode = S.mode === 'schedule' && S.key ? 'schedule' : 'live';
  $('shares').hidden = !(S.mode === 'schedule' && S.key);
  emptyNotice(list.length);
  if (scrollToNow && nowEl.isConnected) {
    requestAnimationFrame(() => { box.scrollTop = Math.max(0, nowEl.offsetTop - box.clientHeight * 0.3); });
  }
}

function emptyNotice(n) {
  const e = $('empty');
  if (n) { e.hidden = true; return; }
  e.hidden = false;
  const st = S.feedState;
  const what = S.dir === 'dep' ? 'departures' : 'arrivals';
  if (S.mode !== 'schedule' && !proxyBase()) {
    e.innerHTML = `<b>The live feed is not connected.</b><p>The board reads ADS-B positions through a small proxy (worker/ in this page's folder). Open <button class="link" data-act="settings">settings</button> and paste its URL, or add an AeroDataBox key for the timetable.</p>`;
  } else if (st.state === 'error') {
    e.innerHTML = `<b>${st.text}.</b><p><button class="link" data-act="retry">Try again</button> · <button class="link" data-act="settings">Settings</button></p>`;
  } else if (st.state === 'busy') {
    e.innerHTML = `<div class="spin"></div><b>${st.text}</b><p>Reading aircraft near ${S.A.iata} and their routes.</p>`;
  } else if (S.filter) {
    e.innerHTML = `<b>No ${what} match “${S.filter}”.</b>`;
  } else {
    e.innerHTML = S.mode === 'schedule' && S.key
      ? `<b>No ${what} in the timetable window.</b>`
      : `<b>No airline ${what} near ${S.A.iata} right now.</b><p>The board shows aircraft that ADS-B receivers can see. Small airports, and places with few receivers, can be quiet. The timetable mode (settings) does not need receivers.</p>`;
  }
}

// ---- clock -----------------------------------------------------------------------
let lastMin = '';
function clockTick(force) {
  if (!S.A) return;
  const now = Date.now();
  const t = fmtTime(now, S.A.tz);
  if (t !== lastMin || force) {
    lastMin = t;
    setFlap($('clockTime'), t, 5);
    $('clockDate').textContent = `${fmtDate(now, S.A.tz)} · ${tzName(now, S.A.tz)}`;
  }
}

// ---- picker ----------------------------------------------------------------------
let pkSel = 0, pkItems = [];
function search(q) {
  q = q.trim().toLowerCase();
  if (!q) {
    const rec = JSON.parse(store.get('fb.recent', '[]'));
    return [...rec, ...HUBS].map((c) => S.byIata.get(c)).filter((a, i, l) => a && l.indexOf(a) === i).slice(0, 30);
  }
  const out = [];
  for (const a of S.airports) {
    let s = 0;
    const iata = a.iata.toLowerCase(), icao = (a.icao || '').toLowerCase(), city = a.city.toLowerCase(), name = a.name.toLowerCase();
    if (iata === q || icao === q) s = 1000;
    else if (q.length <= 4 && (iata.startsWith(q) || icao.startsWith(q))) s = 400;
    else if (city.startsWith(q)) s = 300;
    else if (name.startsWith(q)) s = 250;
    else if (city.includes(q) || name.includes(q)) s = 150;
    else if (a.key.includes(q)) s = 60;
    if (s) out.push([s + a.size * 30, a]);
  }
  return out.sort((x, y) => y[0] - x[0]).slice(0, 40).map((x) => x[1]);
}

function drawPicker() {
  const list = $('pkList');
  pkItems = search($('pkInput').value);
  pkSel = Math.min(pkSel, Math.max(0, pkItems.length - 1));
  list.innerHTML = pkItems.map((a, i) =>
    `<li role="option" data-i="${i}" aria-selected="${i === pkSel}"><span class="pk-code">${a.iata}</span>` +
    `<span class="pk-text"><b>${a.name}</b><small>${a.city} · ${regionName(a.country)}${a.icao ? ' · ' + a.icao : ''}</small></span>` +
    `<span class="pk-size s${a.size}"></span></li>`).join('') ||
    '<li class="none">No airport with scheduled service matches.</li>';
}

function openPicker() {
  const p = $('picker');
  p.hidden = false;
  requestAnimationFrame(() => p.classList.add('on'));
  $('pkInput').value = '';
  pkSel = 0;
  $('pkChips').innerHTML = CHIPS.map((c) => `<button data-c="${c}">${c}</button>`).join('');
  drawPicker();
  setTimeout(() => $('pkInput').focus(), 30);
}
function closePicker() {
  const p = $('picker');
  p.classList.remove('on');
  setTimeout(() => { p.hidden = true; }, 220);
}
function pick(a) { closePicker(); if (a && a !== S.A) setAirport(a); }

// ---- settings ----------------------------------------------------------------------
function openSettings() {
  const d = $('settings');
  for (const r of d.querySelectorAll('input[name=mode]')) r.checked = r.value === S.mode;
  $('stKey').value = S.key;
  $('stProxy').value = store.get('fb.proxy', '') || '';
  $('stProxy').placeholder = PROXY_URL || proxyBase() || 'https://flight-board.example.workers.dev';
  $('stNote').textContent = 'Live mode is free for every airport. Schedule mode uses your RapidAPI key and counts against its plan.';
  d.hidden = false;
  requestAnimationFrame(() => d.classList.add('on'));
}
function closeSettings() { const d = $('settings'); d.classList.remove('on'); setTimeout(() => { d.hidden = true; }, 220); }
function saveSettings() {
  const mode = $('settings').querySelector('input[name=mode]:checked')?.value || 'live';
  const key = $('stKey').value.trim();
  const proxy = $('stProxy').value.trim();
  if (mode === 'schedule' && !key) { $('stNote').textContent = 'Schedule mode needs a key.'; $('stKey').focus(); return; }
  S.mode = mode; S.key = key;
  store.set('fb.mode', mode); store.set('fb.key', key || null); store.set('fb.proxy', proxy || null);
  closeSettings();
  startFeed(true);
}

// ---- wiring --------------------------------------------------------------------------
function setDir(dir) {
  if (S.dir === dir) return;
  S.dir = dir;
  for (const b of document.querySelectorAll('#tabs button')) b.setAttribute('aria-selected', String(b.dataset.dir === dir));
  document.title = `${S.A.iata} ${dir === 'dep' ? 'Departures' : 'Arrivals'} — Flight Board · davesgames.io`;
  writeHash();
  closeDetail(true);
  $('rows').textContent = '';
  rowEls.clear();
  S.painted.clear();
  render(true);
}

function bind() {
  for (const b of document.querySelectorAll('#tabs button')) b.addEventListener('click', () => setDir(b.dataset.dir));
  $('apt').addEventListener('click', openPicker);
  $('gear').addEventListener('click', openSettings);
  $('shares').addEventListener('click', () => {
    S.showShares = !S.showShares;
    $('shares').setAttribute('aria-pressed', String(S.showShares));
    if (S.sched) { S.rows = S.showShares ? S.sched.all : S.sched.grouped; render(); }
  });
  for (const ev of ['wheel', 'touchmove']) $('rows').addEventListener(ev, () => { S.autoScroll = false; }, { passive: true });
  $('filter').addEventListener('input', (e) => { S.filter = e.target.value; render(); });
  $('rows').addEventListener('click', (e) => {
    const el = e.target.closest('.row');
    if (el && el._row) openDetail(el._row, el, ctx());
  });
  $('rows').addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('row')) { e.preventDefault(); openDetail(e.target._row, e.target, ctx()); }
  });
  $('empty').addEventListener('click', (e) => {
    const a = e.target.dataset.act;
    if (a === 'settings') openSettings();
    if (a === 'retry') startFeed(true);
  });
  $('pkInput').addEventListener('input', () => { pkSel = 0; drawPicker(); });
  $('pkInput').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { pkSel = Math.min(pkItems.length - 1, pkSel + 1); drawPicker(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { pkSel = Math.max(0, pkSel - 1); drawPicker(); e.preventDefault(); }
    else if (e.key === 'Enter') pick(pkItems[pkSel]);
    else if (e.key === 'Escape') closePicker();
    $('pkList').querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' });
  });
  $('pkList').addEventListener('click', (e) => { const li = e.target.closest('li[data-i]'); if (li) pick(pkItems[+li.dataset.i]); });
  $('pkChips').addEventListener('click', (e) => { const c = e.target.dataset.c; if (c) pick(S.byIata.get(c)); });
  $('picker').addEventListener('click', (e) => { if (e.target.id === 'picker') closePicker(); });
  $('pkNear').addEventListener('click', () => {
    if (!navigator.geolocation) return;
    $('pkNear').textContent = 'Locating';
    navigator.geolocation.getCurrentPosition((p) => {
      $('pkNear').textContent = 'Near me';
      const { latitude: la, longitude: lo } = p.coords;
      let best = null, bd = 1e9;
      for (const a of S.airports) if (a.size >= 2) { const d = distNm(la, lo, a.lat, a.lon); if (d < bd) { bd = d; best = a; } }
      pick(best);
    }, () => { $('pkNear').textContent = 'No location'; }, { timeout: 10000, maximumAge: 600000 });
  });
  $('settings').addEventListener('click', (e) => { if (e.target.id === 'settings') closeSettings(); });
  $('stCancel').addEventListener('click', closeSettings);
  $('stSave').addEventListener('click', saveSettings);
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (!$('picker').hidden) closePicker(); else if (!$('settings').hidden) closeSettings(); else closeDetail(); }
    if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); openPicker(); }
  });
  addEventListener('hashchange', () => {
    const [code, d] = location.hash.slice(1).split('/');
    const a = S.byIata.get((code || '').toUpperCase()) || S.byIcao.get((code || '').toUpperCase());
    if (a && a !== S.A) setAirport(a, false);
    setDir(d === 'arrivals' ? 'arr' : 'dep');
  });
  setInterval(clockTick, 1000);
  // Schedule rows change status with time; repaint each minute.
  setInterval(() => { if (S.mode === 'schedule' && S.key) render(); }, 60000);
}

function ctx() {
  return { A: S.A, proxy: proxyBase(), airportOf, mode: S.mode === 'schedule' && S.key ? 'schedule' : 'live', dir: S.dir, sched: S.sched };
}

async function boot() {
  bind();
  try { await loadAirports(); }
  catch { feedStatus({ state: 'error', text: 'The airport list did not load' }); return; }
  const a = firstAirport();
  for (const b of document.querySelectorAll('#tabs button')) b.setAttribute('aria-selected', String(b.dataset.dir === S.dir));
  setAirport(a);
  window.__fb = { S, render, setAirport: (c) => setAirport(S.byIata.get(c)), proxyBase };
}
boot();
