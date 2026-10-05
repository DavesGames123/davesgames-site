// Local run of worker.js on http://localhost:8787, with no Cloudflare tools.
// Node 18+ (global fetch, Request, Response). The cf cache option is ignored.
//   node stella-nova/pages/flight-board/worker/dev-server.mjs [port]
import http from 'node:http';
import worker from './worker.js';

const port = +(process.argv[2] || 8787);
http.createServer(async (req, res) => {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  const r = await worker.fetch(new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers }));
  const out = {};
  r.headers.forEach((v, k) => { out[k] = v; });
  res.writeHead(r.status, out);
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(port, () => console.log(`flight-board proxy on http://localhost:${port}`));
