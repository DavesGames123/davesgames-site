// view-fit: the first view fits the National region into the clear area.
// The first browser render (2026-10-15) showed the boot camera NATIONAL
// (a fixed guess) with Seattle and Las Vegas under the left panel and
// Miami under the legend. main.js now swaps it for the director's fit.
// ok(name, cond, info). Run alone: node tests.mjs
import { readFileSync } from 'node:fs';
import { REGIONS, regionCam } from '../director.js';
import { camState, viewProj, project } from '../camera.js';
import { CITY_BY_ID } from '../data/cities.js';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

export default function run(ok) {
  const main = read('main.js');
  const boot = main.slice(main.indexOf('async function bootDirector'), main.indexOf('async function bootDirector') + 600);
  ok('view-fit: bootDirector fits National at boot', /fitNational\(\);/.test(boot));
  ok('view-fit: a resize fits again', /addEventListener\('resize', \(\) => \{ syncView\(\); fitNational\(\); \}\)/.test(boot));
  ok('view-fit: clearInsets keeps the legend clear', /rect\('legend'\)/.test(main) && /ins\.r = /.test(main));

  // the 1280 x 800 desktop layout measured in the render: top bar, left
  // panel to x = 304, time bar, legend from x = 1016
  const W = 1280, H = 800, view = { w: W, h: H, inset: { t: 56, l: 304, b: 82, r: W - 1016 } };
  const nat = REGIONS.find(r => r.id === 'national');
  const cam = regionCam(nat, view);
  const m = viewProj(cam, W, H);
  const out = nat.cities.map(id => CITY_BY_ID.get(id)).filter(Boolean)
    .map(c => ({ id: c.id, p: project(m, c.lat, c.lon) }))
    .filter(({ p }) => !p.visible || p.x < 304 || p.x > 1016 || p.y < 56 || p.y > H - 82);
  ok('view-fit: every National city sits in the clear area', out.length === 0, out.map(o => o.id).join(' '));

  const m0 = viewProj(camState(38.5, -97, 0.95, 0.32, 0), W, H);
  const sea = CITY_BY_ID.get('sea'), p0 = project(m0, sea.lat, sea.lon);
  ok('view-fit: the old boot guess put Seattle under the panel (why the fit exists)', p0.x < 304, `x ${p0.x | 0}`);
}
