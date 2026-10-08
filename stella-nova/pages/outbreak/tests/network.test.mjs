// network: edges in range, symmetric, no self edges; every node reaches
// every other through air or land; total air flow about 12 million a day;
// deterministic
import { readFileSync } from 'node:fs';
import { parseNodes } from '../data.js';
import { buildNetwork, components, gcKm, SOURCES } from '../network.js';

export default function (ok) {
  const D = parseNodes(JSON.parse(readFileSync(new URL('../data/nodes.json', import.meta.url))));
  const N = D.nodes.length, net = buildNetwork(D), { air, land } = net;

  ok('network: air edge count 1000-2500', air.n >= 1000 && air.n <= 2500, `${air.n} air, ${land.n} land`);
  ok('network: typed arrays sized to n',
    [air.a, air.b, air.flow, air.dist, air.intl].every(x => x.length === air.n) &&
    [land.a, land.b, land.c, land.cross].every(x => x.length === land.n) && net.airOut.length === N);

  const inRange = (E) => { for (let e = 0; e < E.n; e++) if (!(E.a[e] >= 0 && E.a[e] < N && E.b[e] >= 0 && E.b[e] < N)) return false; return true; };
  const noSelf = (E) => { for (let e = 0; e < E.n; e++) if (E.a[e] === E.b[e]) return false; return true; };
  // stored once per pair with a < b, so each edge stands for both directions
  const once = (E) => { const s = new Set(); for (let e = 0; e < E.n; e++) { if (E.a[e] >= E.b[e]) return false; const k = E.a[e] * N + E.b[e]; if (s.has(k)) return false; s.add(k); } return true; };
  ok('network: node indices in range', inRange(air) && inRange(land));
  ok('network: no self edges', noSelf(air) && noSelf(land));
  ok('network: symmetric (one record per pair, a < b, no duplicates)', once(air) && once(land));

  let flowOk = true, distOk = true, cOk = true, intlOk = true, crossOk = true;
  for (let e = 0; e < air.n; e++) {
    const A = D.nodes[air.a[e]], B = D.nodes[air.b[e]];
    if (!(air.flow[e] > 0 && Number.isFinite(air.flow[e]))) flowOk = false;
    if (!(Math.abs(air.dist[e] - gcKm(A.lat, A.lon, B.lat, B.lon)) < 1e-6 && air.dist[e] >= 300 && air.dist[e] < 20040)) distOk = false;
    if (air.intl[e] !== (A.iso3 !== B.iso3 ? 1 : 0)) intlOk = false;
  }
  for (let e = 0; e < land.n; e++) {
    const A = D.nodes[land.a[e]], B = D.nodes[land.b[e]], d = gcKm(A.lat, A.lon, B.lat, B.lon);
    if (!(d <= 1500 && Math.abs(land.c[e] - 0.01 * Math.exp(-d / 400)) < 1e-15 && land.c[e] > 0 && land.c[e] <= 0.01)) cOk = false;
    if (land.cross[e] !== (A.iso3 !== B.iso3 ? 1 : 0)) crossOk = false;
  }
  ok('network: air flows positive and finite', flowOk);
  ok('network: air distances are great-circle km, 300 km or more', distOk);
  ok('network: land edges within 1500 km, c = 0.01 exp(-d/400)', cOk);
  ok('network: intl and cross flags match the countries', intlOk && crossOk);

  const cc = components(N, [air, land]);
  ok('network: every node reaches every other (air or land)', cc.count === 1, `${cc.count} parts`);
  ok('network: every node has an air edge', net.airOut.every(x => x > 0));

  const tot = net.airOut.reduce((s, x) => s + x, 0);
  let fsum = 0; for (let e = 0; e < air.n; e++) fsum += 2 * air.flow[e];
  ok('network: total air flow about 12 million a day', tot > 11e6 && tot < 13.5e6 && Math.abs(fsum - tot) < 1, (tot / 1e6).toFixed(2) + ' M');

  const top = [...D.nodes.keys()].sort((x, y) => D.nodes[y].cityPop - D.nodes[x].cityPop || x - y);
  ok('network: hubs ranked by cityPop', net.hubs.length === 60 && net.hubs.every((h, k) => h === top[k]));
  const hubSet = new Set(net.hubs);
  let hh = 0; for (let e = 0; e < air.n; e++) if (hubSet.has(air.a[e]) && hubSet.has(air.b[e])) hh++;
  ok('network: hub-to-hub edges between 240 and 480', hh >= 240 && hh <= 480, `${hh}`);

  const net2 = buildNetwork(D);
  const same = (x, y) => x.length === y.length && x.every((v, i) => Object.is(v, y[i]));
  ok('network: deterministic',
    ['a', 'b', 'flow', 'dist', 'intl'].every(k => same(air[k], net2.air[k])) &&
    ['a', 'b', 'c', 'cross'].every(k => same(land[k], net2.land[k])) &&
    same(net.hubs, net2.hubs) && same(net.airOut, net2.airOut));

  // a remote one-node country still joins the network
  const D3 = { regions: D.regions, nodes: [...D.nodes, { i: N, name: 'Test Isle', iso3: 'TST', country: 'Test', region: 0, income: 1, lat: -60, lon: -150, pop: 1000, cityPop: 1000, hub: 0 }] };
  const net3 = buildNetwork(D3);
  ok('network: a remote one-node country joins the network', components(N + 1, [net3.air, net3.land]).count === 1);

  ok('network: sources have ref, url, note', SOURCES.length >= 3 && SOURCES.every(s => s.ref && /^https:\/\//.test(s.url) && s.note));
}
