// Sweep and Prune · site layer: the credit record and the screensaver shots.
// main.js is the upstream demo; this file only calls its globals (canvas,
// spheres, Sphere, the algorithm radio buttons). It wraps the two global
// collision functions with a timer, so the plate shows the real cost.
TMP.page({ n: '23', title: 'Sweep and Prune', file: '23-SAP.html', video: 'MKeWXBgEGxQ', year: 2025, licence: null });

(function () {
  const TITLE = 'Sweep and Prune';
  let opts = null, shotLabel = null, liveT = 0, flip = null, cfg = null;

  // Timer around the upstream collision passes. animate() calls them by
  // their global names, so the wrapped functions run in their place.
  const meter = { ms: 0, n: 0, checks: 0, frames: 0, lastChecks: 0 };
  const wrap = name => {
    const f = window[name];
    window[name] = function (s) { const t0 = performance.now(); f(s); meter.ms += performance.now() - t0; meter.n++; };
  };
  wrap('bruteForceCollisions'); wrap('sweepAndPruneCollisions');
  const algo = () => document.querySelector('input[name="algorithm"]:checked').value;
  function setAlgo(v) { document.querySelector(`input[name="algorithm"][value="${v}"]`).checked = true; }

  // Replace the spheres. o = { n, rmin, rmax, pow, v }: radius = rmin +
  // (rmax - rmin) u^pow (upstream: 2 + 20 u^10, 5000 spheres, speed 200).
  // n is the count for a 1280 x 720 canvas; the count scales with the area,
  // so the band holds the same density as the upstream window.
  const count = n => Math.max(100, Math.round(n * canvas.width * canvas.height / (1280 * 720) / 50) * 50);
  function build(c, o) {
    spheres.length = 0;
    const W = canvas.width, H = canvas.height, v = o.v * (1.3 - 0.6 * c.calm), N = count(o.n);
    for (let i = 0; i < N; i++) {
      const r = Math.floor(o.rmin + (o.rmax - o.rmin) * Math.pow(c.rng(), o.pow));
      const s = new Sphere(r + c.rng() * (W - 2 * r), r + c.rng() * (H - 2 * r), v * (2 * c.rng() - 1), v * (2 * c.rng() - 1), r);
      s.color = `hsl(${(o.hue + o.hs * c.rng()) % 360}, 70%, 50%)`;
      spheres.push(s);
    }
    meter.ms = meter.n = meter.frames = 0;
  }

  // Live line: the mean time of one collision pass and the checks per frame,
  // from the upstream stats counter.
  function live() {
    if (!opts || typeof opts.label !== 'function' || !shotLabel) return;
    const st = document.getElementById('stats').textContent.match(/Checks\/frame: (\d+)/);
    const ms = meter.n ? meter.ms / meter.n : 0;
    meter.ms = meter.n = 0;
    const name = algo() === 'bruteforce' ? 'Brute force' : 'Sweep and prune';
    const L = Object.assign({}, shotLabel);
    L.sub = L.sub || TITLE;
    L.lines = [shotLabel.lines[0], `${spheres.length.toLocaleString('en-US')} spheres · ${name}: ${ms.toFixed(2)} ms per pass · ${(+(st ? st[1] : 0)).toLocaleString('en-US')} checks per frame`].concat(TMP.creditLines());
    opts.label(L);
  }

  const EQ_SAP = ['sort by xₘᵢₙ', 'stop when xₘᵢₙ(j) > xₘₐₓ(i)', 'cost ≈ O(n log n + k)'];
  const EQ_BF = ['checks = n(n − 1)/2', 'cost = O(n²)'];
  const CODE_SAP = { lang: 'js', name: 'sweepAndPruneCollisions', text: 'const sortedSpheres = spheres.sort((a, b) => a.left - b.left);\nfor (let i = 0; i < sortedSpheres.length; i++) {\n  const sphere1 = sortedSpheres[i];\n  for (let j = i + 1; j < sortedSpheres.length; j++) {\n    const sphere2 = sortedSpheres[j];\n    if (sphere2.left > sphere1.right) {\n      break;\n    }' };
  const CODE_BF = { lang: 'js', name: 'bruteForceCollisions', text: 'function bruteForceCollisions(spheres) {\n  for (let i = 0; i < spheres.length; i++) {\n    for (let j = i + 1; j < spheres.length; j++) {\n      solveCollision(spheres[i], spheres[j]);\n    }\n  }\n}' };
  // Each shot: the population, the method, and an optional switch period.
  // The second line of each label is the live value.
  const shot = (key, label, fn) => (label.lines.push('Timing the collision pass…'), { key, label, run(c) { shotLabel = label; flip = null; fn(c); liveT = 0.6; } });
  const shots = [
    shot('sap', { title: 'Sweep and Prune', lines: ['Spheres sorted along x; red ticks at the top mark each interval.'], eq: EQ_SAP, code: CODE_SAP },
      c => { setAlgo('sweepprune'); build(c, { n: 5000, rmin: 2, rmax: 22, pow: 10, v: 200, hue: 0, hs: 360 }); }),
    shot('brute', { title: 'Brute Force', lines: ['Every pair is tested: n(n − 1)/2 checks in each pass.'], eq: EQ_BF, code: CODE_BF },
      c => { setAlgo('bruteforce'); build(c, { n: 1500, rmin: 3, rmax: 24, pow: 6, v: 160, hue: 180 + 60 * c.rng(), hs: 90 }); }),
    shot('duel', { title: 'Brute Force against Sweep and Prune', lines: ['The same spheres; the method switches every few seconds.'], eq: ['O(n²)  vs  O(n log n + k)'], code: CODE_SAP },
      c => {
        setAlgo(c.rng() < 0.5 ? 'bruteforce' : 'sweepprune');
        build(c, { n: 1500, rmin: 3, rmax: 24, pow: 6, v: 160, hue: 20 + 40 * c.rng(), hs: 60 });
        flip = { every: 3 + 1.5 * c.calm, t: 0 };
      }),
    shot('dense', { title: 'Fine Grains', lines: ['Many small equal spheres: short intervals, so the sweep stops early.'], eq: EQ_SAP, code: CODE_SAP },
      c => { setAlgo('sweepprune'); build(c, { n: 9000 + Math.floor(3000 * c.rng()), rmin: 2, rmax: 4, pow: 1, v: 120 + 80 * c.rng(), hue: 360 * c.rng(), hs: 50 }); }),
    shot('boulders', { title: 'Wide Intervals', lines: ['Large spheres overlap many others along x: more pairs to test.'], eq: EQ_SAP, code: CODE_SAP },
      c => { setAlgo('sweepprune'); build(c, { n: 350 + Math.floor(150 * c.rng()), rmin: 6, rmax: 40, pow: 2, v: 140, hue: 360 * c.rng(), hs: 140 }); }),
  ];

  TMP.saver({
    canvas: () => canvas,
    bg: '#101010',
    enter(o) { opts = o; },
    fit(w, h) {
      if (canvas.width === w && canvas.height === h) return false;
      canvas.width = w; canvas.height = h;
      return true;
    },
    shots,
    tick(dt, c) {
      if (flip) {
        flip.t += dt;
        if (flip.t > flip.every) { flip.t = 0; setAlgo(algo() === 'bruteforce' ? 'sweepprune' : 'bruteforce'); meter.ms = meter.n = 0; liveT = 0.4; }
      }
      liveT -= dt; if (liveT <= 0) { liveT = 1; live(); }
    },
  });
})();
