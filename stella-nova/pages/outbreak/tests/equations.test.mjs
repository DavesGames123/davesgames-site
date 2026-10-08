// equations: braces balance in every TeX string; texFor picks the route form
import { TEX, RULES, SOURCES, texFor, flowTeX, bracesOk } from '../equations.js';
import { colorize } from '../../../lib/sci-math.js';

export default function (ok) {
  ok('equations: bracesOk rejects bad TeX', !bracesOk('\\frac{a}{b') && !bracesOk('a}{') && !bracesOk('\\begin{aligned}x\\end{array}'));
  ok('equations: TEX has the five contract keys', ['seir', 'reff', 'coupling', 'vector', 'water'].every(k => typeof TEX[k] === 'string' && TEX[k].length > 10));
  const bad = Object.entries(TEX).filter(([, t]) => !bracesOk(t)).map(([k]) => k);
  ok('equations: braces balance in every TEX string', bad.length === 0, bad.join(','));

  const base = { route: 'resp', latent: 2, infectious: 3, waning: 0, vaccine: null };
  const cases = [
    base,
    { ...base, latent: 0 },
    { ...base, waning: 730, vaccine: { exists: true, lagDays: 0, efficacy: 0.5 } },
    { ...base, route: 'vector' }, { ...base, route: 'flea' }, { ...base, route: 'water' }, { ...base, route: 'contact' },
    null,
  ];
  let all = true, colorOk = true;
  for (const d of cases) {
    const list = texFor(d);
    if (!Array.isArray(list) || list.length !== 3 || !list.every(bracesOk)) all = false;
    if (!list.every(t => bracesOk(colorize(t, RULES)))) colorOk = false;
  }
  ok('equations: texFor gives three balanced strings for every route', all);
  ok('equations: colorized TeX stays balanced', colorOk);

  ok('equations: texFor gives the vector form for vector diseases', texFor({ ...base, route: 'vector' })[1] === TEX.vector);
  ok('equations: flea uses the vector form', texFor({ ...base, route: 'flea' })[1] === TEX.vector);
  ok('equations: water uses the reservoir form', texFor({ ...base, route: 'water' })[1] === TEX.water);
  ok('equations: resp uses the coupling form', texFor(base)[1] === TEX.coupling);

  ok('equations: latent 0 gives SIR (no E)', !/E_i/.test(flowTeX({ ...base, latent: 0 })) && /E_i/.test(flowTeX(base)));
  ok('equations: waning adds omega only when waning > 0', !/omega/.test(flowTeX(base)) && /omega/.test(flowTeX({ ...base, waning: 240 })));
  ok('equations: vaccine adds nu only with a vaccine', !/\\nu/.test(flowTeX(base)) && /\\nu/.test(flowTeX({ ...base, vaccine: { exists: true } })));

  ok('equations: R_eff colour matches the plate (m5)', /\\class\{m5\}\{R_\{\\mathrm\{eff\}\}\}/.test(colorize(TEX.reff, RULES)));
  ok('equations: SOURCES have ref and url', SOURCES.length >= 3 && SOURCES.every(s => s.ref && /^https:/.test(s.url)));
}
