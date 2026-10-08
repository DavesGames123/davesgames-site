// OUTBREAK · tests/diseases.test.mjs — package A: presets, ranges, sources,
// and the clamps of the custom editor.
import { PRESETS, SOURCES, SCHEMA, getDisease, customDisease, ifrFor, ROUTES, CLIMATES } from '../diseases.js';

const IDS = ['flu-seasonal', 'flu-1918', 'measles', 'covid-ancestral', 'covid-variant',
  'sars', 'ebola', 'cholera', 'dengue', 'malaria', 'plague', 'custom'];

export default function (ok) {
  const missing = IDS.filter(id => !PRESETS.some(d => d.id === id));
  ok('diseases: every preset id exists', missing.length === 0, missing.join(' '));
  ok('diseases: ids are unique', new Set(PRESETS.map(d => d.id)).size === PRESETS.length);

  const out = [];
  for (const d of PRESETS) for (const [k, [lo, hi]] of Object.entries(d.ranges)) {
    if (!(d[k] >= lo && d[k] <= hi)) out.push(`${d.id}.${k}=${d[k]} not in [${lo}, ${hi}]`);
  }
  ok('diseases: every value is in its ranges', out.length === 0, out.join('; '));

  const core = ['R0', 'latent', 'infectious', 'ifr', 'waning'];
  const noRange = PRESETS.filter(d => core.some(k => !d.ranges[k]));
  ok('diseases: R0, periods, ifr and waning have ranges', noRange.length === 0, noRange.map(d => d.id).join(' '));

  const badRefs = PRESETS.filter(d => d.id !== 'custom' && (!d.refs.length || d.refs.some(r => !SOURCES[r])));
  ok('diseases: every refs index resolves in SOURCES', badRefs.length === 0, badRefs.map(d => d.id).join(' '));
  ok('diseases: every source has ref, url, note', SOURCES.every(s => s.ref && /^https:\/\//.test(s.url) && s.note));

  const shape = PRESETS.filter(d => !(ROUTES.includes(d.route) && CLIMATES.includes(d.climate)
    && d.name && d.short && d.blurb && d.illustrative === true && typeof d.careSensitive === 'boolean'
    && (d.vaccine === null || (typeof d.vaccine.exists === 'boolean' && d.vaccine.efficacy > 0 && d.vaccine.efficacy <= 1))));
  ok('diseases: every preset has the Disease shape', shape.length === 0, shape.map(d => d.id).join(' '));
  const inSchema = PRESETS.filter(d => SCHEMA.some(s => !(d[s.key] >= s.min && d[s.key] <= s.max)));
  ok('diseases: every preset fits the slider bounds', inSchema.length === 0, inSchema.map(d => d.id).join(' '));
  const vec = PRESETS.filter(d => d.route === 'vector');
  ok('diseases: vector presets are tropical', vec.length === 2 && vec.every(d => d.climate === 'tropical'));

  const g = getDisease('measles');
  g.R0 = 99; g.ranges.R0[0] = 0;
  ok('diseases: getDisease returns a copy', getDisease('measles').R0 === 15 && getDisease('measles').ranges.R0[0] === 12);
  ok('diseases: getDisease of an unknown id is null', getDisease('nope') === null);

  const ifrMax = SCHEMA.find(s => s.key === 'ifr').max;
  ok('diseases: IFR slider max is 0.6', ifrMax === 0.6);
  const c = customDisease('flu-seasonal', { ifr: 5, R0: -3, latent: 'x', travel: 0.5, route: 'bogus' });
  ok('diseases: custom clamps IFR to 0.6', c.ifr === 0.6, String(c.ifr));
  ok('diseases: custom clamps R0 to the slider min', c.R0 === SCHEMA.find(s => s.key === 'R0').min);
  ok('diseases: custom keeps base on a bad value', c.latent === 2 && c.route === 'resp' && c.travel === 0.5);
  ok('diseases: custom is id custom and does not touch the preset',
    c.id === 'custom' && getDisease('flu-seasonal').ifr === 0.0005);
  const allIn = SCHEMA.every(s => { const v = customDisease('malaria', { [s.key]: 1e9 })[s.key]; return v === s.max; });
  ok('diseases: every schema key clamps to its max', allIn);
  const vc = customDisease('sars', { vaccine: { exists: true, lagDays: -5, efficacy: 3 } });
  ok('diseases: custom vaccine is clamped', vc.vaccine.lagDays === 0 && vc.vaccine.efficacy === 1);

  ok('diseases: careSensitive ifr rises with low income and stays <= 0.95',
    ifrFor(getDisease('ebola'), 5) > ifrFor(getDisease('ebola'), 1) && ifrFor(getDisease('ebola'), 5) <= 0.95
    && ifrFor(getDisease('sars'), 5) === ifrFor(getDisease('sars'), 1));
}
