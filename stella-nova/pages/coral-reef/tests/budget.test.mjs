// ============================================================================
//  CORAL REEF  ·  budget tests (node, no browser):  node tests/budget.test.mjs
// ----------------------------------------------------------------------------
//  budget.js: the profile choice (coarse 390 x 844, desktop, low memory,
//  a laptop), the memory model per profile under its budget (desktop
//  700 MB GPU, phone 250 MB), the model of the page before the profiles
//  (printed: the before and after per profile), the context loss policy
//  and the frame governor.
// ============================================================================
import { PROFILES, PROFILE_ORDER, REEF_Q, MB, detectProfile, profileFor, stepDown, estimate, lostPolicy, frameGovernor, reefBudget, rockWorkers, clampQuality, pixelRatioFor } from '../budget.js';
import { QUALITY } from '../reef.js';

let pass = 0, fail = 0;
function ok(cond, name, info = '') { if (cond) pass++; else { fail++; console.log(`FAIL ${name}${info !== '' ? ' ' + info : ''}`); } }
const mb = b => (b / MB).toFixed(0);

// ── profile choice ─────────────────────────────────────────────────────────
{
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
  const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
  const cases = [
    [{ w: 390, h: 844, coarse: true, ua: iphone, maxTouchPoints: 5 }, 'phone', 'coarse 390x844 iPhone'],
    [{ w: 390, h: 844, coarse: true }, 'phone', 'coarse 390x844'],
    [{ w: 360, h: 740, coarse: true, deviceMemory: 2 }, 'phone-min', 'coarse 360x740, 2 GB'],
    [{ w: 340, h: 700, coarse: true }, 'phone-min', 'coarse 340x700'],
    [{ w: 1440, h: 900, coarse: false, cores: 10, ua: mac }, 'desktop', 'desktop 1440x900, 10 cores'],
    [{ w: 900, h: 1900, coarse: false, cores: 10, ua: mac }, 'desktop', 'desktop Safari 900x1900 (the screenshot)'],
    [{ w: 1366, h: 768, coarse: false, cores: 4 }, 'laptop-low', 'laptop 4 cores'],
    [{ w: 1366, h: 768, coarse: false, cores: 8, deviceMemory: 4 }, 'laptop-low', 'laptop 4 GB'],
    [{ w: 1920, h: 1080, coarse: false, cores: 8, gpu: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)' }, 'laptop-low', 'Intel UHD'],
    [{ w: 1024, h: 1366, coarse: false, ua: mac, maxTouchPoints: 5 }, 'phone', 'iPad (Mac UA, touch)'],
  ];
  for (const [env, want, name] of cases) { const got = detectProfile(env); ok(got === want, `profile: ${name} -> ${want}`, got); }
  console.log('profiles: ' + cases.map(([e, , n]) => `${n} ${detectProfile(e)}`).join('; '));
  ok(stepDown('desktop') === 'laptop-low' && stepDown('laptop-low') === 'phone' && stepDown('phone') === 'phone-min' && stepDown('phone-min') === null, 'stepDown goes desktop, laptop-low, phone, phone-min, null');
  ok(profileFor('nope').id === 'desktop', 'an unknown id gives desktop');
}

// ── the loads per profile ──────────────────────────────────────────────────
{
  for (const id of Object.keys(REEF_Q)) ok(REEF_Q[id].particles === QUALITY[id].particles && REEF_Q[id].colonies === QUALITY[id].colonies && REEF_Q[id].tris === QUALITY[id].tris && REEF_Q[id].polyps === QUALITY[id].polyps, `REEF_Q.${id} is the reef.js QUALITY`);
  const D = PROFILES.desktop, L = PROFILES['laptop-low'], P = PROFILES.phone, M = PROFILES['phone-min'];
  ok(reefBudget(D, D.reef).colonies === 66, 'desktop: Many (66) colonies by default', reefBudget(D, D.reef).colonies);
  ok(reefBudget(L, L.reef).colonies === 34 && reefBudget(P, P.reef).colonies === 34, 'laptop-low and phone: Few (34)');
  ok(L.rock === 'medium' && P.rock === 'low' && M.rock === 'low' && D.rock === 'high', 'rock: high, medium, low, low');
  ok(PROFILE_ORDER.every(id => rockWorkers(PROFILES[id], 16) <= 4) && rockWorkers(P, 8) === 2 && rockWorkers(D, 16) === 4 && rockWorkers(D, 2) === 1, 'rock workers: at most 4, 2 on a phone');
  ok(clampQuality(P, 'desktop') === 'phone' && clampQuality(L, 'desktop') === 'mid' && clampQuality(D, 'desktop') === 'desktop', 'the colonies chips clamp to the profile');
  ok(reefBudget(P, 'phone').tris <= 500000 && reefBudget(M, 'phone').particles <= 14000, 'phone caps: tris and particles');
  ok(pixelRatioFor(D, 2, 900, 1900) < 2 && pixelRatioFor(D, 2, 900, 1900) * pixelRatioFor(D, 2, 900, 1900) * 900 * 1900 <= 4.2e6 * 1.01, 'desktop 900x1900 at dpr 2: the pixel cap', pixelRatioFor(D, 2, 900, 1900));
  ok(pixelRatioFor(P, 3, 390, 844) <= 1.5, 'phone: dpr cap 1.5', pixelRatioFor(P, 3, 390, 844));
  for (const id of PROFILE_ORDER) { const p = PROFILES[id]; ok(p.feed && p.feed.w > 0 && p.feed.h > 0 && p.feed.fps > 0 && p.vol.scale > 0 && p.caustic.res > 0, `${id}: has feed, vol and caustic fields`); }
}

// ── memory per profile, and before the profiles ────────────────────────────
// BEFORE: what the page loaded until 2026-10-17 (main.js, scene.js, layout.js)
const BEFORE = {
  desktop: { id: 'before-desktop', budgetMB: 700, reef: 'desktop', reefMax: 'desktop', cap: {}, rock: 'high', rockWorkers: 12, shadow: 2048, vol: { scale: 0.5, steps: 30 }, dprCap: 2, maxPx: 8.3e6, caustic: { res: 1024, grid: 360 }, snow: 7000, polypDraw: 160000, rovs: 3, feed: { w: 320, h: 256, fps: 60 } },
  phone: { id: 'before-phone', budgetMB: 250, reef: 'phone', reefMax: 'phone', cap: {}, rock: 'low', rockWorkers: 12, shadow: 1024, vol: { scale: 0.4, steps: 14 }, dprCap: 1.6, maxPx: 2.2e6, caustic: { res: 512, grid: 200 }, snow: 2600, polypDraw: 30000, rovs: 2, feed: { w: 320, h: 256, fps: 60 } },
};
{
  const views = {
    desktop: [{ cssW: 1440, cssH: 900, dpr: 2 }, { cssW: 900, cssH: 1900, dpr: 2 }, { cssW: 2560, cssH: 1440, dpr: 2 }, { cssW: 1440, cssH: 900, dpr: 2, quality: 'desktop' }],
    'laptop-low': [{ cssW: 1366, cssH: 768, dpr: 1 }, { cssW: 1440, cssH: 900, dpr: 2, quality: 'desktop' }],
    phone: [{ cssW: 390, cssH: 844, dpr: 3 }, { cssW: 430, cssH: 932, dpr: 3 }, { cssW: 844, cssH: 390, dpr: 3 }],
    'phone-min': [{ cssW: 360, cssH: 740, dpr: 2 }],
  };
  for (const id of PROFILE_ORDER) for (const v of views[id]) {
    const e = estimate(PROFILES[id], v);
    ok(e.gpuTotal < e.budget, `${id} ${v.cssW}x${v.cssH}@${v.dpr}${v.quality ? ' ' + v.quality : ''}: GPU ${mb(e.gpuTotal)} MB < ${mb(e.budget)} MB`);
    ok(e.jsTotal + e.gpuTotal < e.budget * 2.2, `${id} ${v.cssW}x${v.cssH}: GPU + JS ${mb(e.gpuTotal + e.jsTotal)} MB under 2.2 x budget`);
  }
  const row = (name, e) => `${name.padEnd(22)} GPU ${mb(e.gpuTotal).padStart(4)} MB, JS ${mb(e.jsTotal).padStart(4)} MB (coral ${mb(e.gpu.coral)}, canvas+targets ${mb(e.gpu.canvas + e.gpu.sceneTarget + e.gpu.volTarget)}, rock ${mb(e.gpu.rock)}, reef worker ${mb(e.js.reefWorker)}, rock workers ${mb(e.js.rockWorkers)}) q ${e.quality} pr ${e.pr}`;
  const lines = [
    row('before desktop 1440', estimate(BEFORE.desktop, { cssW: 1440, cssH: 900, dpr: 2, cores: 12 })),
    row('after  desktop 1440', estimate(PROFILES.desktop, { cssW: 1440, cssH: 900, dpr: 2, cores: 12 })),
    row('before desktop 900x1900', estimate(BEFORE.desktop, { cssW: 900, cssH: 1900, dpr: 2, cores: 12 })),
    row('after  desktop 900x1900', estimate(PROFILES.desktop, { cssW: 900, cssH: 1900, dpr: 2, cores: 12 })),
    row('after  laptop-low 1366', estimate(PROFILES['laptop-low'], { cssW: 1366, cssH: 768, dpr: 1, cores: 4 })),
    row('before phone 390x844', estimate(BEFORE.phone, { cssW: 390, cssH: 844, dpr: 3, cores: 6 })),
    row('after  phone 390x844', estimate(PROFILES.phone, { cssW: 390, cssH: 844, dpr: 3, cores: 6 })),
    row('after  phone-min 360', estimate(PROFILES['phone-min'], { cssW: 360, cssH: 740, dpr: 2, cores: 4 })),
  ];
  for (const l of lines) console.log('memory: ' + l);
  const b = estimate(BEFORE.desktop, { cssW: 1440, cssH: 900, dpr: 2, cores: 12 }), a = estimate(PROFILES.desktop, { cssW: 1440, cssH: 900, dpr: 2, cores: 12 });
  ok(a.gpuTotal + a.jsTotal < b.gpuTotal + b.jsTotal, 'desktop: the profile loads less than before');
  const bp = estimate(BEFORE.phone, { cssW: 390, cssH: 844, dpr: 3, cores: 6 }), ap = estimate(PROFILES.phone, { cssW: 390, cssH: 844, dpr: 3, cores: 6 });
  ok(ap.gpuTotal + ap.jsTotal < bp.gpuTotal + bp.jsTotal, 'phone: the profile loads less than before');
}

// ── context loss ───────────────────────────────────────────────────────────
{
  const t = 1e9;
  const a = lostPolicy(null, 'desktop', t);
  ok(a.action === 'reload' && a.profile === 'laptop-low' && a.state.losses === 1, 'a first loss reloads one profile lower', JSON.stringify(a));
  const b = lostPolicy(a.state, 'laptop-low', t + 30000);
  ok(b.action === 'stop' && b.profile === 'laptop-low', 'a second loss in 10 min stops (steps down once only)', JSON.stringify(b));
  const c = lostPolicy(a.state, 'laptop-low', t + 700000);
  ok(c.action === 'reload' && c.profile === 'phone', 'a loss 11 min later reloads again, one more step down');
  const d = lostPolicy(null, 'phone-min', t);
  ok(d.action === 'reload' && d.profile === 'phone-min', 'at the bottom a first loss reloads at the same profile');
  console.log(`context loss: desktop -> ${a.action} ${a.profile}; then -> ${b.action}`);
}

// ── frame governor ─────────────────────────────────────────────────────────
{
  const log = [];
  const lv = ['volume', 'polyps', 'shadow', 'pixels'].map(name => ({ name, apply: on => log.push(`${name}:${on ? 'down' : 'up'}`) }));
  const g = frameGovernor({ frameMs: 20, levels: lv });
  for (let i = 0; i < 400; i++) g.tick(16);
  ok(g.level === 0 && !log.length, 'governor: fast frames change nothing');
  for (let i = 0; i < 300; i++) g.tick(45);          // 13.5 s of slow frames
  ok(g.level >= 2 && log[0] === 'volume:down' && log[1] === 'polyps:down', 'governor: sustained slow frames step down the volume, then the polyps', log.join(' '));
  const n = g.level;
  for (let i = 0; i < 40; i++) g.tick(60);           // a short burst: no new step in 4 s
  ok(g.level <= n + 1, 'governor: at most one step per 4 s');
  for (let i = 0; i < 10000; i++) g.tick(8);         // 80 s: four undos of 12 s + 4 s
  ok(g.level === 0, 'governor: fast frames for a long time undo the steps', `${g.level} ${log.join(' ')}`);
  const g2 = frameGovernor({ frameMs: 20, levels: lv.slice(0, 1) });
  for (let i = 0; i < 200; i++) g2.tick(16); g2.tick(5000);
  ok(g2.level === 0, 'governor: one long frame (a tab that comes back) is not slow');
  console.log('governor: ' + log.join(' '));
}

console.log(`budget: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
