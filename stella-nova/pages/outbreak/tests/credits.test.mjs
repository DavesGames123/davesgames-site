// credits (package P): CREDITS.txt names every source URL and every data
// file that the page modules use, with a licence for each data file.
import { readFileSync, readdirSync } from 'node:fs';

const HERE = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, HERE), 'utf8');

function jsFiles() {
  const out = readdirSync(HERE).filter(f => f.endsWith('.js'));
  for (const f of readdirSync(new URL('render/', HERE))) if (f.endsWith('.js')) out.push('render/' + f);
  return out;
}

export default function (ok) {
  const credits = read('CREDITS.txt');
  const urls = new Set(), files = new Set();
  for (const f of jsFiles()) {
    const src = read(f);
    for (const m of src.matchAll(/url:\s*'([^']+)'/g)) urls.add(m[1]);
    for (const m of src.matchAll(/new URL\('([^']+\.(?:json|bin|jpg|png))'/g)) files.add(m[1].split('/').pop());
  }
  const missing = [...urls].filter(u => !credits.includes(u));
  ok('credits: every SOURCES url is in CREDITS.txt', urls.size > 30 && missing.length === 0, `${urls.size} urls; missing ${missing.slice(0, 3).join(', ')}`);
  files.add('nodes.json');
  for (const f of files) {
    const i = credits.indexOf(f);
    const near = i >= 0 ? credits.slice(Math.max(0, i - 200), i + 400) : '';
    ok(`credits: data file ${f} has a licence`, /public domain|MIT|Apache/i.test(near), i < 0 ? 'not named' : '');
  }
  ok('credits: vendored libraries named with licences', /three\.js[\s\S]{0,80}MIT/.test(credits) && /MathJax[\s\S]{0,100}Apache/.test(credits));
  ok('credits: says toy model, not a forecast', /not a forecast/.test(credits) && /illustrative/.test(credits));
  ok('credits: no OpenFlights route data', !/OpenFlights/.test(credits.replace(/not from OpenFlights/, '')));
}
