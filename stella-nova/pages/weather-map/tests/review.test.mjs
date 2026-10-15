// review (REVIEW package): regression checks for the bugs that the review
// pass found. The DOM parts were also run in a jsdom boot outside the repo
// (no browser); here they are static checks on the source, plus one
// DOM-free run of the director.
// ok(name, cond, info). Run alone: node tests.mjs
import { readFileSync } from 'node:fs';
import { createDirector } from '../director.js';
import { camState } from '../camera.js';
import { forecastUrl } from '../data/forecast.js';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

export default function run(ok) {
  // 1. The tap that stops the saver opened a forecast card: saver.js ate
  //    the pointerdown, but main.js took the pointerup as a click (stale
  //    dragMoved) and the click event reached the city label.
  const main = read('main.js');
  const up = main.slice(main.indexOf('const up = e =>'), main.indexOf("canvas.addEventListener('pointerup', up)"));
  ok('review: a globe pick needs a pointerdown that the canvas saw',
    /const had = pointers\.delete\(e\.pointerId\)/.test(up) && /if \(had && dragMoved < 5/.test(up));
  const saver = read('saver.js');
  const onPointer = saver.slice(saver.indexOf('function onPointer'), saver.indexOf('function onMove'));
  ok('review: the tap that stops the saver eats its click',
    /addEventListener\('click', eatClick, true\)/.test(onPointer) && /function eatClick/.test(saver) && /stopPropagation/.test(saver.slice(saver.indexOf('function eatClick'), saver.indexOf('function onPointer'))));

  // 2. National landed as "National" in the top bar; main.js and the saver
  //    plate call it "United States".
  const app = { cam: camState(30, -80, 0.3, 0.3, 0), data: {}, t: Date.now() };
  const d = createDirector(app, { view: () => ({ w: 1600, h: 900, inset: null }) });
  d.goTo('national');
  for (let i = 0; i < 400 && d.busy; i++) d.tick(0.05);
  ok('review: National lands with the focus name United States', !d.busy && app.focus && app.focus.name === 'United States', app.focus && app.focus.name);
  d.goTo('texas');
  for (let i = 0; i < 400 && d.busy; i++) d.tick(0.05);
  ok('review: other regions keep their own names', app.focus && app.focus.name === 'Texas', app.focus && app.focus.name);

  // 3. A point with no city near asked Open-Meteo for UTC days; now it asks
  //    for the local zone ('auto').
  const card = read('forecast-card.js');
  ok('review: a point with no known zone asks for timezone=auto',
    /loader\(target\.lat, target\.lon, known \|\| 'auto'\)/.test(card) && /timezone=auto&/.test(forecastUrl(10, -30, 'auto')));
}
