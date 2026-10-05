// ============================================================================
//  DETAIL  ·  the flight card that opens from a board row
// ----------------------------------------------------------------------------
//  open() grows a ghost from the clicked row's rect to the card's rect (a
//  container transform), then shows the card and lets its sections rise in
//  turn. close() runs the same path back to the row, or shrinks the card
//  when the row is gone. On a phone the card is a bottom sheet, and a drag
//  down on its grip closes it.
//
//  Card sections
//    head        flight number (flap), airline, callsign, status
//    route       both airports, the times, the progress bar
//    map         drawMap(): land (world-atlas 110m), the great circle, the
//                aircraft. Flown part solid, the rest dashed.
//    telemetry   altitude, speed, vertical rate, heading, distance, squawk.
//                While the card is open, pollHex() reads the aircraft from
//                the proxy every HEX_MS.
//    aircraft    adsbdb.com: type, owner, registration, photo
//    weather     Open-Meteo current weather at both airports
//    codeshares  schedule mode only
//
//  grep -n targets
//    open animation ....... "export function openDetail"
//    close animation ...... "export function closeDetail"
//    card markup .......... "function cardHtml"
//    live refresh ......... "function fill"
//    route map ............ "function drawMap"
//    weather .............. "async function weather"
// ============================================================================
import { setFlap } from './flap.js';
import { fetchHex } from './live.js';
import { distNm, gcPath, fmtTime, tzName, relMin } from './geo.js';

const HEX_MS = 4000;
const EASE = 'cubic-bezier(.2,.8,.2,1)';
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const $ = (id) => document.getElementById(id);

let cur = null;         // { row, rowEl, ctx, hexTimer, ac, info }
let busy = false;
let land = null;

export function detailOpenId() { return cur ? cur.row.id : null; }

function phone() { return matchMedia('(max-width: 720px)').matches; }

function targetRect() {
  const w = innerWidth, h = innerHeight;
  if (phone()) {
    const top = Math.max(24, h * 0.08);
    return { left: 0, top, width: w, height: h - top };
  }
  const width = Math.min(780, w - 48), height = Math.min(h - 48, 860);
  return { left: (w - width) / 2, top: (h - height) / 2, width, height };
}

function px(r) { return { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' }; }

function visibleRect(el) {
  if (!el || !el.isConnected) return null;
  const r = el.getBoundingClientRect();
  const box = $('rows').getBoundingClientRect();
  if (r.bottom < box.top || r.top > box.bottom || r.height === 0) return null;
  return r;
}

// ---- open / close ------------------------------------------------------------
export function openDetail(row, rowEl, ctx) {
  if (busy || !row) return;
  if (cur) closeDetail(true);
  busy = true;
  const card = $('detail'), scrim = $('scrim');
  cur = { row, rowEl, ctx, ac: null, info: null };
  rowEl.classList.add('open');
  card.innerHTML = cardHtml(row, ctx);
  card.dataset.tone = row.tone;
  card.hidden = false;
  scrim.hidden = false;
  const to = targetRect();
  Object.assign(card.style, px(to));
  fill();
  bindCard(card);

  const from = rowEl.getBoundingClientRect();
  const dur = reduce.matches ? 1 : 460;
  scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur * 0.8, fill: 'forwards' });
  const ghost = document.createElement('div');
  ghost.className = 'dt-ghost';
  ghost.appendChild(rowEl.cloneNode(true)).classList.remove('open');
  document.body.appendChild(ghost);
  card.style.opacity = '0';
  const g = ghost.animate([
    { ...px(from), borderRadius: '6px' },
    { ...px(to), borderRadius: phone() ? '22px 22px 0 0' : '22px' },
  ], { duration: dur, easing: EASE, fill: 'forwards' });
  ghost.firstChild.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur * 0.35, fill: 'forwards' });
  g.finished.then(() => {
    card.style.opacity = '1';
    ghost.remove();
    card.querySelectorAll('.rise').forEach((el, i) => {
      el.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }],
        { duration: reduce.matches ? 1 : 380, delay: reduce.matches ? 0 : i * 55, easing: EASE, fill: 'backwards' });
    });
    setFlap(card.querySelector('.dt-num'), row.flight, 8);
    drawMap();
    card.querySelector('.dt-close')?.focus({ preventScroll: true });
    busy = false;
  });
  loadExtras();
  startHex();
}

export function closeDetail(instant = false) {
  if (!cur || (busy && !instant)) return;
  const card = $('detail'), scrim = $('scrim');
  const { rowEl } = cur;
  clearInterval(cur.hexTimer);
  const done = () => {
    card.hidden = true; scrim.hidden = true; card.innerHTML = '';
    card.style.opacity = '';
    rowEl.classList.remove('open');
    busy = false;
  };
  const stale = cur;
  cur = null;
  if (instant || reduce.matches) { done(); return; }
  busy = true;
  const from = card.getBoundingClientRect();
  const to = visibleRect(document.querySelector(`.row[data-id="${CSS.escape(stale.row.id)}"]`) || rowEl);
  scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, fill: 'forwards' });
  if (!to) {
    card.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.96) translateY(16px)' }],
      { duration: 240, easing: EASE }).finished.then(done);
    return;
  }
  const ghost = document.createElement('div');
  ghost.className = 'dt-ghost';
  document.body.appendChild(ghost);
  card.style.opacity = '0';
  ghost.animate([
    { ...px(from), borderRadius: phone() ? '22px 22px 0 0' : '22px' },
    { ...px(to), borderRadius: '6px' },
  ], { duration: 380, easing: EASE, fill: 'forwards' }).finished.then(() => { ghost.remove(); done(); });
}

function bindCard(card) {
  card.querySelector('.dt-close').addEventListener('click', () => closeDetail());
  $('scrim').onclick = () => closeDetail();
  const grip = card.querySelector('.dt-grip');
  let y0 = null;
  grip.addEventListener('pointerdown', (e) => { y0 = e.clientY; grip.setPointerCapture(e.pointerId); });
  grip.addEventListener('pointermove', (e) => {
    if (y0 == null) return;
    card.style.transform = `translateY(${Math.max(0, e.clientY - y0)}px)`;
  });
  grip.addEventListener('pointerup', (e) => {
    const dy = e.clientY - (y0 ?? e.clientY);
    y0 = null;
    card.style.transform = '';
    if (dy > 90) closeDetail();
  });
  card.querySelector('.dt-map canvas').addEventListener('click', () => drawMap());
}

export function updateDetail(row) {
  if (!cur || cur.row.id !== row.id) return;
  cur.row = row;
  fill();
  drawMap();
}

// ---- markup ------------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function ends(row, ctx) {
  const A = ctx.A;
  const here = { iata: A.iata, icao: A.icao, city: A.city, name: A.name, lat: A.lat, lon: A.lon, tz: A.tz };
  const o = ctx.airportOf(row.other) || {};
  const there = {
    iata: row.other.iata || o.iata || '', icao: row.other.icao || o.icao || '',
    city: row.other.city || o.city || '', name: row.other.name || o.name || '',
    lat: isFinite(row.other.lat) ? row.other.lat : o.lat, lon: isFinite(row.other.lon) ? row.other.lon : o.lon,
    tz: row.other.tz || o.tz || A.tz,
  };
  return row.dir === 'dep' ? [here, there] : [there, here];
}

function cardHtml(row, ctx) {
  const [a, b] = ends(row, ctx);
  const ap = (p, side) => `<div class="ap ${side}"><b>${esc(p.iata || p.icao)}</b><span>${esc(p.city)}</span><small>${esc(p.name)}</small><em class="t-${side}"></em></div>`;
  return `<div class="dt-grip" aria-hidden="true"><i></i></div>
  <button class="dt-close" aria-label="Close">
    <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></button>
  <div class="dt-scroll">
    <header class="dt-head rise">
      <div><span class="flaps dt-num"></span>
        <p class="dt-airline"><i class="badge"></i><span>${esc(row.airline.name || 'Airline')}</span>${row.callsign ? `<small>${esc(row.callsign)}</small>` : ''}</p></div>
      <div class="dt-status"><span class="pill"></span><small class="dt-when"></small></div>
    </header>
    <section class="dt-route rise">
      ${ap(a, 'from')}
      <div class="mid"><svg class="plane" viewBox="0 0 24 24"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 00-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/></svg>
        <div class="bar"><i></i><b></b></div><small class="dt-dist"></small></div>
      ${ap(b, 'to')}
    </section>
    <section class="dt-map rise"><canvas></canvas><span class="map-note"></span></section>
    <section class="dt-tele rise" hidden></section>
    <section class="dt-air rise" hidden></section>
    <section class="dt-wx rise"><div class="wx" data-end="from"></div><div class="wx" data-end="to"></div></section>
    ${row.codeshares && row.codeshares.length ? `<section class="dt-shares rise"><h4>Also sold as</h4><p>${row.codeshares.map((c) => `<span>${esc(c)}</span>`).join('')}</p></section>` : ''}
    <p class="dt-src rise"></p>
  </div>`;
}

// ---- live content -------------------------------------------------------------
function fill() {
  if (!cur) return;
  const { row, ctx } = cur;
  const card = $('detail');
  const q = (s) => card.querySelector(s);
  const [a, b] = ends(row, ctx);
  const ac = cur.ac;
  const pos = ac && ac.lat != null ? ac : (row.lat != null ? row : null);
  card.dataset.tone = row.tone;
  const badge = q('.dt-airline .badge');
  badge.textContent = row.airline.iata || row.airline.icao || '';
  let h = 0; for (const c of row.airline.icao || row.airline.iata || row.flight) h = (h * 31 + c.charCodeAt(0)) % 360;
  badge.style.setProperty('--h', h);
  if (!busy) setFlap(q('.dt-num'), row.flight, 8);
  q('.dt-status .pill').textContent = row.status;
  q('.dt-status .pill').dataset.tone = row.tone;

  // Times at each end, in that airport's own zone.
  const now = Date.now();
  const tf = (ms, tz) => `${fmtTime(ms, tz)} <span>${tzName(ms, tz)}</span>`;
  let fromT = '', toT = '', when = '';
  if (row.source === 'schedule') {
    const hereT = row.rev || row.sched;
    const line = `${row.dir === 'dep' ? 'Departs' : 'Arrives'} ${tf(hereT, ctx.A.tz)}${row.rev && row.rev !== row.sched ? ` <s>${fmtTime(row.sched, ctx.A.tz)}</s>` : ''}`;
    if (row.dir === 'dep') fromT = line; else toT = line;
    when = relMin(hereT, now);
    if (row.terminal || row.gate) when += ` · ${row.terminal ? 'Terminal ' + esc(row.terminal) : ''}${row.terminal && row.gate ? ', ' : ''}${row.gate ? 'Gate ' + esc(row.gate) : ''}`;
  } else if (row.dir === 'dep') {
    if (row.time) { fromT = `${row.kind === 'seen' ? 'Wheels up' : 'Off about'} ${tf(row.time, a.tz)}`; when = relMin(row.time, now); }
    else { fromT = row.status === 'Taxiing' ? 'Taxiing now' : 'At the gate'; when = 'Not yet airborne'; }
  } else {
    if (row.status === 'Landed' || row.status === 'Arrived') {
      toT = row.time ? `Touchdown ${tf(row.time, b.tz)}` : 'On the ground';
      when = row.time ? relMin(row.time, now) : 'Landed';
    } else if (row.time) { toT = `ETA ${tf(row.time, b.tz)}`; when = relMin(row.time, now); }
  }
  q('.t-from').innerHTML = fromT;
  q('.t-to').innerHTML = toT;
  q('.dt-when').innerHTML = when;

  // Progress along the great circle.
  let p = row.dir === 'dep' ? (/At gate|Taxiing/.test(row.status) ? 0 : 0.05) : (/Landed|Arrived/.test(row.status) ? 1 : 0.5);
  let distText = '';
  if (isFinite(a.lat) && isFinite(b.lat)) {
    const total = distNm(a.lat, a.lon, b.lat, b.lon);
    if (pos && !/At gate|Taxiing|Landed|Arrived/.test(row.status)) {
      const togo = distNm(pos.lat, pos.lon, b.lat, b.lon);
      p = Math.max(0, Math.min(1, 1 - togo / Math.max(1, total)));
      distText = `${Math.round(total - togo).toLocaleString()} nm flown · ${Math.round(togo).toLocaleString()} nm to go`;
    } else distText = `${Math.round(total).toLocaleString()} nm · ${Math.round(total * 1.852).toLocaleString()} km`;
  }
  q('.bar i').style.width = `${(p * 100).toFixed(1)}%`;
  q('.bar b').style.left = `${(p * 100).toFixed(1)}%`;
  q('.dt-dist').textContent = distText;

  // Telemetry.
  const tele = q('.dt-tele');
  const t = ac || (row.source === 'live' ? { alt_baro: row.alt || 'ground', gs: row.gs, track: row.track } : null);
  if (t) {
    const ground = t.alt_baro === 'ground' || row.alt === 0 && /At gate|Taxiing|Landed|Arrived/.test(row.status);
    const alt = ground ? 'Ground' : `${Math.round(+t.alt_baro || +t.alt_geom || 0).toLocaleString()}<i>ft</i>`;
    const vr = +(t.baro_rate ?? t.geom_rate ?? 0);
    const vrTxt = ground || !isFinite(vr) ? '—' : `${vr > 0 ? '+' : ''}${Math.round(vr).toLocaleString()}<i>fpm</i>`;
    const hdg = t.track != null ? Math.round(+t.track) : null;
    const togo = pos && isFinite(b.lat) ? Math.round(distNm(pos.lat, pos.lon, b.lat, b.lon)) : null;
    tele.hidden = false;
    tele.innerHTML = [
      ['Altitude', alt, ground ? '' : `FL${String(Math.round((+t.alt_baro || 0) / 100)).padStart(3, '0')}`],
      ['Ground speed', t.gs != null ? `${Math.round(+t.gs)}<i>kt</i>` : '—', t.gs != null ? `${Math.round(+t.gs * 1.852)} km/h` : ''],
      ['Vertical', vrTxt, ground ? '' : vr > 300 ? 'Climbing' : vr < -300 ? 'Descending' : 'Level'],
      ['Heading', hdg != null ? `${hdg}<i>°</i>` : '—', hdg != null ? `<svg class="needle" viewBox="0 0 24 24" style="transform:rotate(${hdg}deg)"><path d="M12 2l4 18-4-3-4 3z"/></svg>` : ''],
      ['To go', togo != null ? `${togo.toLocaleString()}<i>nm</i>` : '—', ''],
      ['Squawk', t.squawk || '—', t.squawk === '7700' ? 'Emergency' : t.squawk === '7600' ? 'Radio failure' : t.squawk === '7500' ? 'Hijack code' : ''],
    ].map(([k, v, s]) => `<div class="tile"><small>${k}</small><b>${v}</b><span>${s}</span></div>`).join('');
  }
  q('.map-note').textContent = pos && ac ? 'Live position' : pos ? 'Position from the board feed' : 'Route only';
  q('.dt-src').innerHTML = row.source === 'schedule'
    ? 'Timetable from AeroDataBox. Position from adsb.lol when the aircraft is known.'
    : 'Seen by ADS-B receivers (adsb.lol). Route from adsbdb. Times marked est. are estimates from distance and speed.';
}

function startHex() {
  const c = cur;
  const hex = c.row.hex;
  if (!hex || !c.ctx.proxy) return;
  const go = async () => {
    try {
      const ac = await fetchHex(c.ctx.proxy, hex);
      if (cur !== c) return;
      if (ac) { c.ac = ac; fill(); drawMap(); }
    } catch { /* keep the board position */ }
  };
  go();
  c.hexTimer = setInterval(() => { if (!document.hidden) go(); }, HEX_MS);
}

// ---- aircraft and weather ----------------------------------------------------------
async function loadExtras() {
  const c = cur;
  const { row, ctx } = c;
  const [a, b] = ends(row, ctx);
  const id = row.hex || row.reg;
  if (id) {
    fetch(`https://api.adsbdb.com/v0/aircraft/${encodeURIComponent(id)}`).then((r) => r.ok ? r.json() : null).then((j) => {
      if (cur !== c) return;
      const x = j?.response?.aircraft;
      const sec = $('detail').querySelector('.dt-air');
      if (!x && !row.type) return;
      sec.hidden = false;
      const photo = x?.url_photo_thumbnail || x?.url_photo;
      sec.innerHTML = `${photo ? `<a class="ph" href="${esc(x.url_photo || photo)}" target="_blank" rel="noopener" referrerpolicy="no-referrer"><img src="${esc(photo)}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.parentNode.remove()"><small>Photo · airport-data.com</small></a>` : ''}
        <div class="spec"><small>Aircraft</small><b>${esc(x ? `${x.manufacturer} ${x.type}` : row.type)}</b>
        <dl><dt>Registration</dt><dd>${esc(x?.registration || row.reg || '—')}</dd>
        <dt>Type code</dt><dd>${esc(x?.icao_type || (row.source === 'live' ? row.type : '') || '—')}</dd>
        <dt>Operator</dt><dd>${esc(x?.registered_owner || '—')}</dd>
        <dt>Mode S</dt><dd>${esc((x?.mode_s || row.hex || '—').toUpperCase())}</dd></dl></div>`;
    }).catch(() => {});
  }
  for (const [end, p] of [['from', a], ['to', b]]) {
    weather(p).then((w) => {
      if (cur !== c) return;
      const el = $('detail').querySelector(`.wx[data-end="${end}"]`);
      if (!el) return;
      el.innerHTML = w
        ? `<small>${esc(p.iata || p.icao)} now · ${fmtTime(Date.now(), p.tz)}</small><b>${w.temp}<i>°C</i></b><span>${w.text}</span><em>Wind ${w.wdir}° ${w.wspd} kt${w.gust ? ` G${w.gust}` : ''} · Vis ${w.vis}</em>`
        : `<small>${esc(p.iata || p.icao)}</small><span>No weather</span>`;
    });
  }
}

const WMO = { 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Showers', 81: 'Showers', 82: 'Violent showers',
  85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm, hail', 99: 'Thunderstorm, hail' };
const wxCache = new Map();

async function weather(p) {
  if (!isFinite(p.lat)) return null;
  const k = `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;
  const hit = wxCache.get(k);
  if (hit && Date.now() - hit.t < 10 * 60e3) return hit.v;
  try {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility&wind_speed_unit=kn`;
    const j = await (await fetch(u)).json();
    const c = j.current;
    const vis = c.visibility >= 10000 ? '10 km+' : `${(c.visibility / 1000).toFixed(1)} km`;
    const v = { temp: Math.round(c.temperature_2m), text: WMO[c.weather_code] || '—', wdir: Math.round(c.wind_direction_10m), wspd: Math.round(c.wind_speed_10m), gust: c.wind_gusts_10m > c.wind_speed_10m + 8 ? Math.round(c.wind_gusts_10m) : 0, vis };
    wxCache.set(k, { t: Date.now(), v });
    return v;
  } catch { return null; }
}

// ---- map -----------------------------------------------------------------------------
async function landRings() {
  if (land) return land;
  const topo = await (await fetch('../../vendor/world-atlas@2.0.2/land-110m.json')).json();
  const geo = window.topojson.feature(topo, topo.objects.land);
  const rings = [];
  for (const f of geo.features || [geo]) {
    const g = f.geometry || f;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) for (const ring of poly) rings.push(ring);
  }
  land = rings;
  return land;
}

async function drawMap() {
  if (!cur) return;
  const c = cur;
  const cv = $('detail').querySelector('.dt-map canvas');
  if (!cv) return;
  const rings = await landRings().catch(() => []);
  if (cur !== c || !cv.isConnected) return;
  const { row, ctx } = c;
  const [a, b] = ends(row, ctx);
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = cv.clientWidth, H = cv.clientHeight;
  if (!W || !H) return;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const css = getComputedStyle(document.documentElement);
  const col = (n) => css.getPropertyValue(n).trim();

  const path = isFinite(a.lat) && isFinite(b.lat) ? gcPath(a.lat, a.lon, b.lat, b.lon, 128) : [[a.lat, a.lon]];
  const pos = c.ac && c.ac.lat != null ? c.ac : row.lat != null ? row : null;
  // Fit: the bounding box of the path, in an equirectangular plane scaled
  // by cos(mid latitude).
  let la0 = 90, la1 = -90, lo0 = 1e9, lo1 = -1e9;
  for (const [la, lo] of path) { la0 = Math.min(la0, la); la1 = Math.max(la1, la); lo0 = Math.min(lo0, lo); lo1 = Math.max(lo1, lo); }
  const midLa = (la0 + la1) / 2, k = Math.cos(midLa * Math.PI / 180);
  let spanX = Math.max(4, (lo1 - lo0) * k), spanY = Math.max(3, la1 - la0);
  const pad = 1.35;
  const s = Math.min(W / (spanX * pad), H / (spanY * pad));
  const cx = (lo0 + lo1) / 2, cy = (la0 + la1) / 2;
  const X = (lo) => W / 2 + (lo - cx) * k * s;
  const Y = (la) => H / 2 - (la - cy) * s;

  g.fillStyle = col('--map-sea'); g.fillRect(0, 0, W, H);
  // Graticule every 10 degrees.
  g.strokeStyle = col('--map-grid'); g.lineWidth = 1;
  g.beginPath();
  for (let lo = Math.floor((cx - 400) / 10) * 10; lo <= cx + 400; lo += 10) { const x = X(lo); if (x > -2 && x < W + 2) { g.moveTo(x, 0); g.lineTo(x, H); } }
  for (let la = -80; la <= 80; la += 10) { const y = Y(la); if (y > -2 && y < H + 2) { g.moveTo(0, y); g.lineTo(W, y); } }
  g.stroke();
  // Land, drawn in three copies so the view can cross the antimeridian.
  g.fillStyle = col('--map-land'); g.strokeStyle = col('--map-coast'); g.lineWidth = 0.8;
  for (const off of [-360, 0, 360]) {
    g.beginPath();
    for (const ring of rings) {
      // world-atlas rings are already cut at the antimeridian: no unwrap.
      ring.forEach(([lo, la], i) => { i ? g.lineTo(X(lo + off), Y(la)) : g.moveTo(X(lo + off), Y(la)); });
      g.closePath();
    }
    g.fill(); g.stroke();
  }
  // Route: flown part solid, the rest dashed. Split at the nearest path point.
  let split = row.dir === 'dep' && /At gate|Taxiing/.test(row.status) ? 0 : /Landed|Arrived/.test(row.status) ? path.length - 1 : -1;
  let pLon = null;
  if (pos && split < 0) {
    let best = 1e9;
    path.forEach(([la, lo], i) => {
      const d = (la - pos.lat) ** 2 + (((lo - pos.lon + 540) % 360) - 180) ** 2;
      if (d < best) { best = d; split = i; }
    });
    pLon = path[split][1] + ((((pos.lon - path[split][1]) + 540) % 360) - 180);
  }
  if (split < 0) split = 0;
  const accent = col('--accent');
  g.lineCap = 'round';
  const line = (from, to, dash, alpha, w) => {
    g.save(); g.setLineDash(dash); g.globalAlpha = alpha; g.strokeStyle = accent; g.lineWidth = w;
    g.beginPath();
    for (let i = from; i <= to; i++) { const [la, lo] = path[i]; i === from ? g.moveTo(X(lo), Y(la)) : g.lineTo(X(lo), Y(la)); }
    g.stroke(); g.restore();
  };
  line(split, path.length - 1, [2, 6], 0.75, 2);
  if (split > 0) { g.save(); g.shadowColor = accent; g.shadowBlur = 12; line(0, split, [], 1, 2.6); g.restore(); }
  // Airports.
  for (const [p, lab] of [[path[0], a], [path[path.length - 1], b]]) {
    if (!isFinite(p[0])) continue;
    const x = X(p[1]), y = Y(p[0]);
    g.fillStyle = col('--bg'); g.strokeStyle = accent; g.lineWidth = 2;
    g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill(); g.stroke();
    g.font = '600 12px Inter, system-ui, sans-serif'; g.fillStyle = col('--ink');
    g.textAlign = x > W - 60 ? 'right' : 'left';
    g.fillText(lab.iata || lab.icao, x + (g.textAlign === 'right' ? -10 : 10), y - 8);
  }
  // Aircraft.
  if (pos && pLon != null) {
    const x = X(pLon), y = Y(pos.lat);
    g.save(); g.translate(x, y); g.rotate(((+pos.track || 0) * Math.PI) / 180);
    g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 8;
    g.fillStyle = col('--ink');
    const p = new Path2D('M0 -11 L2 -3 L10 2 L10 4 L2 2 L1.5 8 L4 10 L4 11.5 L0 10.5 L-4 11.5 L-4 10 L-1.5 8 L-2 2 L-10 4 L-10 2 L-2 -3 Z');
    g.fill(p);
    g.restore();
  }
}

addEventListener('resize', () => {
  if (!cur || busy) return;
  Object.assign($('detail').style, px(targetRect()));
  drawMap();
});
