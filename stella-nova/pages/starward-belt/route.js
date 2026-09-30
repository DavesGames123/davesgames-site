// route.js — the cheapest jump course under the enabled tiers. No DOM, no GPU.
//
// Dijkstra over ROUTES as an undirected graph. A route is usable only when
// its tier is in the enabled set. The graph has ten nodes, so a linear scan
// for the next node is faster and simpler than a heap. On an equal cost the
// course with fewer jumps wins, so the result does not depend on data order.
//
// grep: function cheapest  function adjacency

import { NODES, ROUTES } from './data.js';

// For each node id, the list of { to, ri } where ri is an index into ROUTES.
function adjacency(tiers) {
  const adj = Object.fromEntries(NODES.map((n) => [n.id, []]));
  ROUTES.forEach((r, ri) => {
    if (!tiers.has(r.tier)) return;
    adj[r.from].push({ to: r.to, ri });
    adj[r.to].push({ to: r.from, ri });
  });
  return adj;
}

// Returns { nodes: [ids from start to end], routes: [ROUTES indices], cost }
// or null when no course exists. The same start and end gives a zero course.
export function cheapest(fromId, toId, tiers) {
  const adj = adjacency(tiers);
  if (!adj[fromId] || !adj[toId]) return null;
  const cost = {}, hops = {}, prev = {}, done = new Set();
  for (const n of NODES) { cost[n.id] = Infinity; hops[n.id] = Infinity; }
  cost[fromId] = 0; hops[fromId] = 0;

  for (;;) {
    let u = null;
    for (const id in cost) {
      if (done.has(id) || cost[id] === Infinity) continue;
      if (u === null || cost[id] < cost[u] || (cost[id] === cost[u] && hops[id] < hops[u])) u = id;
    }
    if (u === null || u === toId) break;
    done.add(u);
    for (const { to, ri } of adj[u]) {
      const c = cost[u] + ROUTES[ri].cost, h = hops[u] + 1;
      if (c < cost[to] || (c === cost[to] && h < hops[to])) {
        cost[to] = c; hops[to] = h; prev[to] = { id: u, ri };
      }
    }
  }
  if (cost[toId] === Infinity) return null;

  const nodes = [toId], routes = [];
  for (let id = toId; id !== fromId; id = prev[id].id) {
    routes.unshift(prev[id].ri);
    nodes.unshift(prev[id].id);
  }
  return { nodes, routes, cost: cost[toId] };
}
