// rng: a seed gives the same stream; poisson and binom have the right mean
import { makeRng } from '../rng.js';

export default function (ok) {
  const a = makeRng(42), b = makeRng(42), xa = [], xb = [];
  for (let i = 0; i < 50; i++) { xa.push(a.next()); xb.push(b.next()); }
  ok('rng: same seed, same stream', xa.join() === xb.join());
  const r = makeRng(7); let s = 0, t = 0;
  for (let i = 0; i < 20000; i++) { s += r.poisson(3.5); t += r.binom(200, 0.1); }
  ok('rng: poisson mean', Math.abs(s / 20000 - 3.5) < 0.08, (s / 20000).toFixed(3));
  ok('rng: binom mean', Math.abs(t / 20000 - 20) < 0.3, (t / 20000).toFixed(3));
}
