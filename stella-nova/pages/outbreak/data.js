// ============================================================================
//  OUTBREAK  ·  data.js — the population nodes (no DOM, no GPU)
// ----------------------------------------------------------------------------
//  data/nodes.json is written by tools/build-nodes.py from Natural Earth
//  (public domain). parseNodes(json) turns its rows into node objects:
//    { i, name, iso3, country, region, income, lat, lon, pop, cityPop, hub }
//  lat, lon in degrees (north, east positive); pop = people in the node
//  catchment; region = index into json.regions (World Bank region);
//  income = 1 (high) .. 5 (low).
//  loadNodes(url) reads the file with response.json(), never sized from
//  content-length (the live site gzips data files).
//
//  grep -n targets: "export function parseNodes", "export async function loadNodes",
//                   "export function checkNodes"
// ============================================================================
export function parseNodes(json) {
  const c = json.cols, ix = Object.fromEntries(c.map((k, j) => [k, j]));
  const nodes = json.nodes.map((r, i) => ({
    i, name: r[ix.name], iso3: r[ix.iso3], country: r[ix.country], region: r[ix.region],
    income: r[ix.income], lat: r[ix.lat], lon: r[ix.lon], pop: r[ix.pop], cityPop: r[ix.cityPop], hub: r[ix.hub],
  }));
  return { regions: json.regions.slice(), nodes, src: json.src };
}

export async function loadNodes(url = new URL('data/nodes.json', import.meta.url)) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`nodes: HTTP ${r.status}`);
  return parseNodes(await r.json());
}

// A list of problems (empty when the data is valid).
export function checkNodes(D) {
  const bad = [];
  for (const n of D.nodes) {
    if (!(n.lat >= -90 && n.lat <= 90)) bad.push(`${n.name}: lat ${n.lat}`);
    if (!(n.lon >= -180 && n.lon <= 180)) bad.push(`${n.name}: lon ${n.lon}`);
    if (!(n.pop > 0)) bad.push(`${n.name}: pop ${n.pop}`);
    if (!(n.region >= 0 && n.region < D.regions.length)) bad.push(`${n.name}: region ${n.region}`);
    if (!(n.income >= 1 && n.income <= 5)) bad.push(`${n.name}: income ${n.income}`);
  }
  return bad;
}
