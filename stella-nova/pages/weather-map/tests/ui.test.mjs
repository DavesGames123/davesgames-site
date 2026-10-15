// ui (UI package): unit formatting, the city search, the scrubber window
// and ticks, palettes, icons, the forecast card builders on the saved
// sample, and static checks of index.html / style.css / main.js (head
// order, ids, [hidden] guard, fonts, touch sizes, import names).
// ok(name, cond, info). Run alone: node tests/ui.test.mjs
import { readFileSync } from 'node:fs';
import {
  cToF, fmtTemp, tempParts, tempOne, fmtWind, fmtPrecip, fmtPressure, compass, fmtClock, fmtDate, relHours,
  searchCities, scrubRange, scrubTicks, snapTime, TEMP_STOPS, DBZ_STOPS, rampColor, tempColor, rampCSS,
  iconSVG, ICON_KEYS, frontSVG, LAYERS, esc, PHONE_MQ,
} from '../ui.js';
import { hourlyChartSVG, dailyRowsHTML, nowHTML, placeTitle } from '../forecast-card.js';
import { WMO, codeText, parseForecast } from '../data/forecast.js';
import { CITIES } from '../data/cities.js';

const here = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, here), 'utf8');
const H = 3600e3;

export default async function run(ok) {
  // ── units
  ok('ui: 22 °C reads 72°F · 22°C (F first)', fmtTemp(22, 'F') === '72°F · 22°C', fmtTemp(22, 'F'));
  ok('ui: C first swaps the order', fmtTemp(22, 'C') === '22°C · 72°F', fmtTemp(22, 'C'));
  ok('ui: -40 is the same in both units', fmtTemp(-40, 'F') === '-40°F · -40°C');
  ok('ui: NaN temperature shows a dash', fmtTemp(NaN) === '–' && tempOne(undefined) === '–');
  ok('ui: cToF(100) = 212', cToF(100) === 212);
  const tp = tempParts(0, 'F');
  ok('ui: tempParts(0, F) = 32° F / 0°C', tp.main === '32°' && tp.unit === 'F' && tp.alt === '0°C', JSON.stringify(tp));
  ok('ui: tempOne in C', tempOne(21.6, 'C') === '22°');
  ok('ui: 10 m/s = 22 mph · 36 km/h', fmtWind(10, 'F') === '22 mph · 36 km/h', fmtWind(10, 'F'));
  ok('ui: wind C first leads with km/h', fmtWind(10, 'C').startsWith('36 km/h'));
  ok('ui: 25.4 mm = 1.0 in', fmtPrecip(25.4, 'F').startsWith('1.0 in'), fmtPrecip(25.4, 'F'));
  ok('ui: 1013.25 hPa = 29.92 inHg', fmtPressure(1013.25, 'F') === '29.92 inHg · 1013 hPa', fmtPressure(1013.25, 'F'));
  ok('ui: compass 0/90/225/359', compass(0) === 'N' && compass(90) === 'E' && compass(225) === 'SW' && compass(359) === 'N');

  // ── time
  const t = Date.UTC(2026, 6, 4, 16, 5);
  ok('ui: 16:05 UTC is 12:05 PM in New York (EDT)', fmtClock(t, 'America/New_York') === '12:05 PM', fmtClock(t, 'America/New_York'));
  ok('ui: the date in Honolulu', fmtDate(t, 'Pacific/Honolulu') === 'Saturday, July 4', fmtDate(t, 'Pacific/Honolulu'));
  ok('ui: an unknown zone falls back to UTC', fmtClock(t, 'Not/AZone') === '4:05 PM');
  ok('ui: relHours', relHours(t, t) === 'Now' && relHours(t + 6 * H, t) === '+6 h' && relHours(t - 3 * H, t) === '−3 h');

  // ── search
  const names = q => searchCities(q, CITIES, 5).map(c => c.name);
  ok('ui: "new" puts New York first', names('new')[0] === 'New York', names('new').join(', '));
  ok('ui: "chi" finds Chicago first', names('chi')[0] === 'Chicago', names('chi').join(', '));
  ok('ui: "san" finds San … cities', names('san').length > 1 && names('san').every(n => /\bSan/i.test(n)), names('san').join(', '));
  const tx = searchCities('tx', CITIES, 20);
  ok('ui: a state code lists that state', tx.length >= 3 && tx.every(c => c.state === 'TX' || /\btx/i.test(c.name)), tx.map(c => c.name).join(', '));
  ok('ui: case and accents do not matter', names('NEW YORK')[0] === 'New York');
  ok('ui: empty query gives nothing', searchCities('  ', CITIES).length === 0);
  ok('ui: limit holds', searchCities('a', CITIES, 4).length <= 4);

  // ── scrubber
  const now = Date.UTC(2026, 9, 15, 18);
  const r0 = scrubRange(null, now);
  ok('ui: default window is -6 h .. +48 h', r0.t0 === now - 6 * H && r0.t1 === now + 48 * H && r0.now === now);
  const g = { times: [now - 12 * H, now - 9 * H, now - 6 * H] };
  const r1 = scrubRange(g, now);
  ok('ui: window follows grid.times and clamps now inside', r1.t0 === g.times[0] && r1.t1 === g.times[2] && r1.now === r1.t1);
  const ticks = scrubTicks(r0.t0, r0.t1, 'America/Chicago');
  const majors = ticks.filter(k => k.major);
  ok('ui: 54 h has 9 six-hour ticks', ticks.length === 9, String(ticks.length));
  ok('ui: day labels sit at local midnight', majors.length === 2 && majors.every(k => k.h === 0 && /^[A-Z][a-z]{2}$/.test(k.label)), majors.map(k => k.label).join(','));
  ok('ui: tick u inside 0..1 and rising', ticks.every((k, i) => k.u >= 0 && k.u <= 1 && (!i || k.u > ticks[i - 1].u)));
  ok('ui: snapTime snaps to 15 min and clamps', snapTime(now + 7 * 60e3, now, now + H) === now && snapTime(now + 9 * 60e3, now, now + H) === now + 15 * 60e3 && snapTime(now - H, now, now + H) === now);

  // ── palettes
  ok('ui: temp stops rise', TEMP_STOPS.every((s, i) => !i || s[0] > TEMP_STOPS[i - 1][0]));
  ok('ui: dBZ stops rise', DBZ_STOPS.every((s, i) => !i || s[0] > DBZ_STOPS[i - 1][0]));
  ok('ui: rampColor hits stops and clamps', rampColor(TEMP_STOPS, 0) === '#4fb3e8' && rampColor(TEMP_STOPS, -99) === TEMP_STOPS[0][1] && rampColor(TEMP_STOPS, 99) === TEMP_STOPS.at(-1)[1]);
  ok('ui: tempColor gives hex between stops', /^#[0-9a-f]{6}$/.test(tempColor(13)));
  const css = rampCSS(TEMP_STOPS, -18, 43);
  ok('ui: rampCSS spans 0..100%', css.includes(' 0.0%') && css.includes(' 100.0%'), css.slice(0, 60));

  // ── icons
  const wmoIcons = new Set();
  for (const k of Object.keys(WMO)) { wmoIcons.add(codeText(+k, true).icon); wmoIcons.add(codeText(+k, false).icon); }
  const missing = [...wmoIcons].filter(k => !ICON_KEYS.includes(k));
  ok('ui: every WMO icon key has a drawing', !missing.length, missing.join(','));
  const svgOk = s => s.startsWith('<svg') && s.endsWith('</svg>') && !/NaN|undefined/.test(s);
  ok('ui: icons are clean SVG', ICON_KEYS.every(k => svgOk(iconSVG(k))));
  ok('ui: front swatches are clean SVG', ['COLD', 'WARM', 'STNRY', 'OCFNT', 'TROF', 'DRYLINE'].every(k => svgOk(frontSVG(k))));
  ok('ui: esc escapes markup', esc('<a href="x">&\'') === '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  ok('ui: layer toggles cover the app.layers keys', ['clouds', 'radar', 'temp', 'isobars', 'fronts', 'labels'].every(k => LAYERS.some(l => l.key === k)));

  // ── forecast card on the saved sample
  const s = JSON.parse(read('data/sample/forecast.json'));
  const fc = parseForecast(s.response);
  const chart = hourlyChartSVG(fc.hourly, 'F', fc.tz, { now: fc.hourly[3].time });
  ok('card: 48 h chart is clean SVG', svgOk(chart.trim()), chart.slice(0, 80));
  ok('card: chart has the line, the area and a now rule', chart.includes('class="tl"') && chart.includes('class="area"') && chart.includes('class="nowr"'));
  const dayLabels = (chart.match(/class="ax day"/g) || []).length;
  ok('card: chart labels local midnights', dayLabels >= 1 && dayLabels <= 3, String(dayLabels));
  ok('card: chart in C differs from F', hourlyChartSVG(fc.hourly, 'C', fc.tz) !== hourlyChartSVG(fc.hourly, 'F', fc.tz));
  ok('card: chart copes with no data', svgOk(hourlyChartSVG([], 'F', 'UTC').trim()));
  const days = dailyRowsHTML(fc.daily, 'F', fc.tz);
  const rows = (days.match(/<li>/g) || []).length;
  ok('card: 10-day list has 10 rows', rows === 10, String(rows));
  ok('card: first row is Today', days.indexOf('Today') > 0 && days.indexOf('Today') < 200);
  const lefts = [...days.matchAll(/left:([\d.]+)%;width:([\d.]+)%/g)].map(m => [+m[1], +m[2]]);
  ok('card: hi/lo bars stay inside the track', lefts.length === 10 && lefts.every(([a, w]) => a >= 0 && a + w <= 103), JSON.stringify(lefts.slice(0, 3)));
  ok('card: no NaN in the day list', !/NaN|undefined/.test(days));
  const nh = nowHTML(fc, 'C');
  ok('card: now block leads with °C when C first', /class="v">-?\d+°<\/span><span class="u">C</.test(nh), nh.slice(0, 160));
  ok('card: now block lists feels like, wind, humidity, pressure', ['Feels like', 'Wind', 'Humidity', 'Pressure'].every(k => nh.includes(k)));
  ok('card: point title names the coordinates', placeTitle({ lat: 40.71, lon: -74.01 }).name === '40.71° N, 74.01° W');
  ok('card: city title keeps the name', placeTitle({ name: 'Boise', state: 'ID', lat: 43.6, lon: -116.2 }).name === 'Boise');

  // ── static checks: index.html, style.css, main.js
  const html = read('index.html'), cssTxt = read('style.css'), main = read('main.js'), uiTxt = read('ui.js'), cardTxt = read('forecast-card.js');
  const head = html.slice(0, html.indexOf('</head>'));
  const order = ['../../lib/gpu-guard.js', '../../lib/wishlist.js', '../../lib/stats-beacon.js'].map(p => head.indexOf(p));
  ok('page: head loads gpu-guard, wishlist, stats-beacon in order', order.every(i => i >= 0) && order[0] < order[1] && order[1] < order[2], order.join(','));
  ok('page: Inter is vendored', head.includes('../../vendor/fonts/inter.adf13477.css'));
  ok('page: no banned fonts', !/playfair|cormorant|jetbrains/i.test(html + cssTxt));
  ok('page: [hidden] guard in style.css', /\[hidden\]\{display:none!important\}/.test(cssTxt.replace(/\s/g, '')));
  ok('page: #nogpu starts hidden', /id="nogpu"[^>]*hidden/.test(html));
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  const used = new Set();
  for (const src of [main, uiTxt, cardTxt]) for (const m of src.matchAll(/(?:\$|getElementById)\('([\w-]+)'\)/g)) used.add(m[1]);
  const gone = [...used].filter(id => !ids.has(id) && id !== 'card');
  ok('page: every id the scripts read exists in index.html', !gone.length && ids.has('card'), gone.join(','));
  ok('page: phone query matches style.css', cssTxt.includes('@media (max-width:768px),(max-height:500px) and (pointer:coarse)') && PHONE_MQ.includes('max-width: 768px'));
  ok('page: 44 px touch targets', /@media \(pointer:coarse\)\{[\s\S]*min-height:44px/.test(cssTxt));
  ok('page: chrome hides in the screensaver', cssTxt.includes('html.sn-saver #top') && cssTxt.includes('html.sn-saver #timebar'));
  ok('page: attribution for Open-Meteo and RainViewer', html.includes('Weather data by Open-Meteo.com (CC BY 4.0)') && html.includes('Radar by RainViewer'));
  ok('page: no all-caps HUD labels', !/text-transform:\s*uppercase/.test(cssTxt) && !/SYS \/\//.test(html));
  // every element with a hidden attribute and a CSS display rule is covered by the guard (above); list them for the record
  const hiddenIds = [...html.matchAll(/id="([\w-]+)"[^>]*\shidden\b/g)].map(m => m[1]);
  ok('page: hidden elements are known', hiddenIds.every(id => ['searchList', 'card', 'nogpu'].includes(id)), hiddenIds.join(','));

  // main.js static imports name real exports of phase-1 modules
  const bad = [];
  for (const m of main.matchAll(/^import \{([^}]+)\} from '(\.[^']+)';/gm)) {
    const mod = await import(new URL(m[2], here));
    for (const n of m[1].split(',').map(x => x.trim().split(/\s+as\s+/)[0]).filter(Boolean)) if (!(n in mod)) bad.push(`${m[2]}:${n}`);
  }
  ok('main: static imports resolve to real exports', !bad.length, bad.join(','));
  const dyn = [...main.matchAll(/makeLayer\('([^']+)', '(\w+)'\)/g)].map(m => `${m[1]}:${m[2]}`);
  ok('main: phase-2 layers by the contract names', ['./render/clouds.js:createClouds', './render/fields.js:createFields', './render/fronts.js:createFronts'].every(x => dyn.includes(x)), dyn.join(','));
  ok('main: director, labels and saver imported defensively', ["opt('./director.js')", "opt('./labels.js')", "opt('./saver.js')"].every(x => main.includes(x)));
  ok('main: window.WX is the app', /window\.WX = app/.test(main));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let f = 0, n = 0;
  await run((name, c, info = '') => { n++; if (!c) f++; console.log(`${c ? 'ok  ' : 'FAIL'} ${name}${info ? ' · ' + info : ''}`); });
  console.log(f ? `${f} of ${n} failed` : `all ${n} passed`);
  if (f) process.exit(1);
}
