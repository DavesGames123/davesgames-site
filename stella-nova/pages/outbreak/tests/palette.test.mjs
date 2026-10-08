// palette: one infection red across the land, the cities, the flights,
// the HUD, the chart and the rims (PAL of render/infect.js). No GPU.
import { readFileSync } from 'node:fs';
import { PAL, toHex, hueSat, RED_SPEC } from '../render/infect.js';
import { KIND_COL, KIND } from '../render/arcs.js';
import { SHADERS as NODE_SHADERS } from '../render/nodes.js';
import { SERIES } from '../charts.js';
import { holoColor } from '../render/style-holo.js';
import { dotColor } from '../render/style-dots.js';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const g3 = c => `vec3(${c.map(x => x.toFixed(2).replace(/0$/, '')).join(', ')})`;
const same = (a, b) => a.every((x, i) => Math.abs(x - b[i]) < 1e-9);

export default function (ok) {
  const hex = toHex(PAL.arterial);
  ok('palette: infected flights are arterial red, first arrivals the hot core', same(KIND_COL[KIND.infected], PAL.arterial) && same(KIND_COL[KIND.first], PAL.core));
  const mark = NODE_SHADERS.marker[1];
  ok('palette: infected city markers are arterial red with a hot-core rim', mark.includes(g3(PAL.arterial)) && mark.includes(g3(PAL.core)), g3(PAL.arterial));
  const css = read('style.css');
  ok('palette: the page accent --hot is the arterial red', css.includes(`--hot:${hex};`), hex);
  const ink = css.match(/--hot-ink:(#[0-9a-f]{6})/)[1], ih = hueSat([1, 2, 3].map(k => parseInt(ink.slice(2 * k - 1, 2 * k + 1), 16) / 255));
  ok('palette: the HUD red text is a lighter red of the same hue', ih.hue >= RED_SPEC.hue[0] && ih.hue <= RED_SPEC.hue[1] && ih.val === 1, `${ink} ${ih.hue.toFixed(1)} deg`);
  const I = SERIES.find(s => s.key === 'I');
  ok('palette: the chart draws the infectious line in the arterial red', I && I.color === hex);
  const hb = holoColor(1);
  ok('palette: the hologram warms to red, not magenta', hueSat(hb).hue > -15 && hueSat(hb).hue < 10, hueSat(hb).hue.toFixed(1));
  const d1 = hueSat(dotColor(0.8));
  ok('palette: an infected dot is in the red band', d1.hue >= RED_SPEC.hue[0] - 4 && d1.hue <= 10 && d1.sat > 0.8, `${d1.hue.toFixed(1)} deg s ${d1.sat.toFixed(2)}`);
  ok('palette: no old orange-red (#ef5a47) is left in the page files', !['style.css', 'charts.js', 'ui.js', 'index.html'].some(f => /ef5a47/i.test(read(f))));
}
