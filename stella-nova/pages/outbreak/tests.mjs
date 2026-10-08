// OUTBREAK · tests.mjs — node tests (no browser). Run: node tests.mjs
import { readFileSync } from 'node:fs';
import { parseNodes, checkNodes } from './data.js';

let fails = 0;
const ok = (name, cond, info = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${info ? ' · ' + info : ''}`); if (!cond) fails++; };

// data: the node file loads, every node has valid coordinates and a population
{
  const D = parseNodes(JSON.parse(readFileSync(new URL('data/nodes.json', import.meta.url))));
  const bad = checkNodes(D), tot = D.nodes.reduce((s, n) => s + n.pop, 0);
  ok('data: nodes load', D.nodes.length >= 250 && D.nodes.length <= 500, `${D.nodes.length} nodes`);
  ok('data: valid coordinates, pop, region, income', bad.length === 0, bad.slice(0, 3).join('; '));
  ok('data: world population 7-8.5 billion', tot > 7e9 && tot < 8.5e9, (tot / 1e9).toFixed(2) + ' bn');
  ok('data: every region has nodes', D.regions.every((_, r) => D.nodes.some(n => n.region === r)));
  ok('data: hubs exist', D.nodes.filter(n => n.hub).length > 100, D.nodes.filter(n => n.hub).length + ' hubs');
}
if (fails) { console.log(`${fails} failed`); process.exit(1); }
console.log('all passed');
