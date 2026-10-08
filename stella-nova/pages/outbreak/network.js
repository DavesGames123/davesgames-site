// ============================================================================
//  OUTBREAK  ·  network.js — the air and land edges between nodes (no DOM)
// ----------------------------------------------------------------------------
//  buildNetwork(D, opts) makes a synthetic travel network from the node
//  data alone. It uses no route data (no OpenFlights). It uses no RNG, so
//  the same nodes always give the same network.
//
//  Air: a gravity model. A pair (a, b) carries
//    flow = G * pop_a^0.8 * pop_b^0.8 / max(d, 150 km)^0.5   people/day, each way
//  The edge set has three parts. No air edge is shorter than `minAirKm`
//  (300 km): the land edges carry short trips.
//    1. hub to hub: the top `hubCount` (60) nodes by cityPop. Each hub keeps
//       its top `partners` (8) other hubs by gravity score.
//    2. gateway: the largest node of each country that is not a hub links
//       to its two nearest hubs.
//    3. spoke: each other node links to the nearest hub of its own country,
//       else to its country gateway (domestic first), and to its nearest
//       other hub.
//  G scales the sum of airOut (one traveller on one leg counts once) to
//  `totalAir` = 12.3 million a day: about 4.5 billion passengers in 2019
//  (ICAO) / 365.
//
//  Land: each node links to its `landK` (5) nearest nodes within
//  `landMaxKm` (1500 km). The edge set is the union, so it is symmetric.
//  Coupling c = 0.01 * exp(-d / 400 km), per day.
//
//  Connectivity: if air and land together leave a part of the graph cut
//  off, the largest node of that part links by air to its nearest hub in
//  the main part. Every node already gets air edges, so with the shipped
//  nodes this step adds no edges. It is a guard for edited data.
//
//  Edges are stored with a < b, sorted by (a, b). `flow` and `c` are the
//  same in both directions.
//
//  grep -n targets: "export const SOURCES", "export function buildNetwork",
//                   "export function gcKm", "export function components",
//                   "function gravity", "// air: hub to hub", "// land"
// ============================================================================

export const SOURCES = [
  { ref: 'Zipf GK 1946. The P1 P2 / D hypothesis: on the intercity movement of persons. American Sociological Review 11(6):677-686',
    url: 'https://doi.org/10.2307/2087063',
    note: 'The gravity form of travel between two cities: flow grows with both populations and falls with distance.' },
  { ref: 'Viboud C, Bjornstad ON, Smith DL, Simonsen L, Miller MA, Grenfell BT 2006. Synchrony, waves, and spatial hierarchies in the spread of influenza. Science 312(5772):447-451',
    url: 'https://doi.org/10.1126/science.1125237',
    note: 'A gravity model with population exponents below 1 fits the spread of influenza between US cities. The exponents 0.8 and 0.5 here are illustrative, not fitted.' },
  { ref: 'Xia Y, Bjornstad ON, Grenfell BT 2004. Measles metapopulation dynamics: a gravity model for epidemiological coupling and dynamics. American Naturalist 164(2):267-281',
    url: 'https://doi.org/10.1086/422341',
    note: 'Distance-limited coupling between nearby populations; the model for the land edges.' },
  { ref: 'Colizza V, Barrat A, Barthelemy M, Vespignani A 2006. The role of the airline transportation network in the prediction and predictability of global epidemics. PNAS 103(7):2015-2020',
    url: 'https://doi.org/10.1073/pnas.0510525103',
    note: 'A global metapopulation model coupled by air travel; the structure this page copies at toy scale.' },
  { ref: 'Balcan D, Colizza V, Goncalves B, Hu H, Ramasco JJ, Vespignani A 2009. Multiscale mobility networks and the spatial spreading of infectious diseases. PNAS 106(51):21484-21489',
    url: 'https://doi.org/10.1073/pnas.0906910106',
    note: 'Air travel plus short-range commuting: the two layers (air and land) of this network.' },
  { ref: 'ICAO 2019. The World of Air Transport in 2019 (Annual Report of the Council)',
    url: 'https://www.icao.int/annual-report-2019/Pages/the-world-of-air-transport-in-2019.aspx',
    note: 'About 4.5 billion passengers on scheduled services in 2019, so about 12.3 million a day. The network scales its total air flow to this value.' },
];

const R_KM = 6371.0088;
const RAD = Math.PI / 180;

// Great-circle distance in km (haversine).
export function gcKm(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * RAD, p2 = lat2 * RAD;
  const dp = p2 - p1, dl = (lon2 - lon1) * RAD;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

const DEFAULTS = {
  hubCount: 60, partners: 8,
  popExp: 0.8, distExp: 0.5, minKm: 150, minAirKm: 300,
  totalAir: 4.5e9 / 365,
  landK: 5, landMaxKm: 1500, landC0: 0.01, landScaleKm: 400,
};

function gravity(o, pa, pb, d) {
  return Math.pow(pa, o.popExp) * Math.pow(pb, o.popExp) / Math.pow(Math.max(d, o.minKm), o.distExp);
}

// Label of the connected part of each node, over the given edge lists.
// Returns { label: Int32Array(N), count }.
export function components(N, edgeLists) {
  const parent = new Int32Array(N).map((_, i) => i);
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (const { a, b, n } of edgeLists) {
    for (let e = 0; e < n; e++) {
      const ra = find(a[e]), rb = find(b[e]);
      if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
    }
  }
  const label = new Int32Array(N).fill(-1), map = new Map();
  for (let i = 0; i < N; i++) {
    const r = find(i);
    if (!map.has(r)) map.set(r, map.size);
    label[i] = map.get(r);
  }
  return { label, count: map.size };
}

// An undirected edge set keyed by (min, max). Keeps the first insert.
function edgeSet() {
  const m = new Map();
  return {
    add(a, b) { if (a === b) return; const lo = Math.min(a, b), hi = Math.max(a, b); const k = lo * 65536 + hi; if (!m.has(k)) m.set(k, [lo, hi]); },
    list() { return [...m.values()].sort((x, y) => x[0] - y[0] || x[1] - y[1]); },
  };
}

export function buildNetwork(D, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const nodes = D.nodes, N = nodes.length;
  if (N > 65535) throw new Error('network: too many nodes');

  // pairwise distances, km (N = 395 gives 156k values, cheap)
  const dist = new Float64Array(N * N);
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
    const d = gcKm(nodes[i].lat, nodes[i].lon, nodes[j].lat, nodes[j].lon);
    dist[i * N + j] = d; dist[j * N + i] = d;
  }
  const dk = (i, j) => dist[i * N + j];

  // ranking by cityPop, ties by index (stable, deterministic)
  const rank = nodes.map((n, i) => i).sort((x, y) => nodes[y].cityPop - nodes[x].cityPop || x - y);
  const H = Math.min(o.hubCount, N);
  const hubs = Int32Array.from(rank.slice(0, H));
  const isHub = new Uint8Array(N); for (const h of hubs) isHub[h] = 1;

  const air = edgeSet();
  const nearestHubs = (i, k, skip) => {
    const c = [];
    for (const h of hubs) if (h !== i && dk(i, h) >= o.minAirKm && (!skip || !skip(h))) c.push(h);
    c.sort((x, y) => dk(i, x) - dk(i, y) || x - y);
    return c.slice(0, k);
  };

  // air: hub to hub
  for (const h of hubs) {
    const c = [];
    for (const g of hubs) if (g !== h && dk(h, g) >= o.minAirKm) c.push([g, gravity(o, nodes[h].pop, nodes[g].pop, dk(h, g))]);
    c.sort((x, y) => y[1] - x[1] || x[0] - y[0]);
    for (let k = 0; k < Math.min(o.partners, c.length); k++) air.add(h, c[k][0]);
  }

  // air: gateways (largest node of each country)
  const gateway = new Map();
  for (const i of rank) if (!gateway.has(nodes[i].iso3)) gateway.set(nodes[i].iso3, i);
  for (const g of gateway.values()) if (!isHub[g]) for (const h of nearestHubs(g, 2)) air.add(g, h);

  // air: spokes, domestic first, then the nearest hub
  for (let i = 0; i < N; i++) {
    const g = gateway.get(nodes[i].iso3);
    if (isHub[i] || g === i) continue;
    let dom = -1;
    for (const h of hubs) if (nodes[h].iso3 === nodes[i].iso3 && dk(i, h) >= o.minAirKm && (dom < 0 || dk(i, h) < dk(i, dom))) dom = h;
    if (dom < 0 && dk(i, g) >= o.minAirKm) dom = g;
    if (dom >= 0) air.add(i, dom);
    for (const h of nearestHubs(i, 2)) if (h !== dom) { air.add(i, h); break; }
  }

  // land
  const land = edgeSet();
  for (let i = 0; i < N; i++) {
    const c = [];
    for (let j = 0; j < N; j++) if (j !== i && dk(i, j) <= o.landMaxKm) c.push(j);
    c.sort((x, y) => dk(i, x) - dk(i, y) || x - y);
    for (let k = 0; k < Math.min(o.landK, c.length); k++) land.add(i, c[k]);
  }

  // connectivity guard: link each cut-off part to the main part by air
  for (let guard = 0; guard < N; guard++) {
    const al = air.list(), ll = land.list();
    const pack = l => ({ a: l.map(e => e[0]), b: l.map(e => e[1]), n: l.length });
    const { label, count } = components(N, [pack(al), pack(ll)]);
    if (count <= 1) break;
    const main = label[hubs[0]];
    for (let part = 0; part < count; part++) {
      if (part === main) continue;
      const big = rank.find(i => label[i] === part);
      const h = nearestHubs(big, 1, x => label[x] !== main)[0];
      air.add(big, h ?? rank.find(i => label[i] === main));
    }
  }

  // pack air with gravity flows, scaled to the total
  const al = air.list(), na = al.length;
  const A = {
    a: new Int32Array(na), b: new Int32Array(na), flow: new Float64Array(na),
    dist: new Float64Array(na), intl: new Uint8Array(na), n: na,
  };
  let raw = 0;
  for (let e = 0; e < na; e++) {
    const [a, b] = al[e];
    A.a[e] = a; A.b[e] = b; A.dist[e] = dk(a, b);
    A.flow[e] = gravity(o, nodes[a].pop, nodes[b].pop, A.dist[e]);
    A.intl[e] = nodes[a].iso3 !== nodes[b].iso3 ? 1 : 0;
    raw += 2 * A.flow[e];
  }
  const G = raw > 0 ? o.totalAir / raw : 0;
  const airOut = new Float64Array(N);
  for (let e = 0; e < na; e++) {
    A.flow[e] *= G;
    airOut[A.a[e]] += A.flow[e]; airOut[A.b[e]] += A.flow[e];
  }

  const ll = land.list(), nl = ll.length;
  const L = { a: new Int32Array(nl), b: new Int32Array(nl), c: new Float64Array(nl), cross: new Uint8Array(nl), n: nl };
  for (let e = 0; e < nl; e++) {
    const [a, b] = ll[e];
    L.a[e] = a; L.b[e] = b;
    L.c[e] = o.landC0 * Math.exp(-dk(a, b) / o.landScaleKm);
    L.cross[e] = nodes[a].iso3 !== nodes[b].iso3 ? 1 : 0;
  }

  return { air: A, land: L, hubs, airOut };
}
