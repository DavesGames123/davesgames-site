// ============================================================================
//  MATERIAL STUDIO  ·  saver.js — the screensaver hook for the shell
// ────────────────────────────────────────────────────────────────────────────
//  The shell (lib/screensaver.js) calls window.snSaver.enter(opts) when this
//  page plays in screensaver mode. main.js imports this file first, so the
//  hook exists before the long boot. enter() waits for __studio.booted.
//
//  enter() hides the editor chrome and makes #viewport-wrap fill the window.
//  The viewport ResizeObserver then sizes #vp to the window. The autopilot
//  shows one material at a time on a slow turntable. Each state has a recipe
//  from MATERIAL_PRESETS, a procedural environment from env.js PRESETS and a
//  mesh, all in a seeded order. Three states play in one dwell. The view
//  exposure ramps down to -10 EV before a change and back up after the bake,
//  so the recording has a fade and no hard cut.
//
//  Saver mode only: Storage.prototype.setItem is a no-op (the viewport, the
//  bake meter and the panels save prefs on change), toasts are hidden, and no
//  Poly Haven environment ('ph:*') is used, so the loop makes no request.
//  The shell reloads the page on stop, so nothing is restored.
//
//  GREP TARGETS
//      window.snSaver ....... the hook
//      function fadeTo ...... the exposure ramp
//      function nextState ... recipe, environment and mesh change
//      function plate ....... the opts.label plate: material, inputs, BRDF terms
// ============================================================================
import { store, state } from './store.js';

const MESHES = ['shaderBall', 'sphere', 'roundedCube', 'torus'];
const DARK = -10;   // EV at the bottom of a fade
const CSS = `html.ms-saver #topbar,html.ms-saver #lib-panel,html.ms-saver #side,html.ms-saver #split,html.ms-saver #graph-wrap,
html.ms-saver #maps-strip,html.ms-saver #dock,html.ms-saver #sheet,html.ms-saver #vp-hud,html.ms-saver #toast,html.ms-saver #nogpu{display:none!important}
html.ms-saver #viewport-wrap{position:fixed!important;inset:0!important;z-index:50}html.ms-saver #vp{cursor:none}`;

const wait = ms => new Promise(r => setTimeout(r, ms));
const smooth = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

window.snSaver = {
  async enter(opts) {
    while (!window.__studio || !window.__studio.booted) await wait(100);
    const S = window.__studio, vp = S.viewport, cam = vp && vp.camera;
    const calm = Math.max(0, Math.min(1, +opts.calm || 0));
    let seed = (opts.seed >>> 0) || 1;
    const rng = () => { seed = (seed + 0x6D2B79F5) >>> 0; let x = Math.imul(seed ^ seed >>> 15, 1 | seed); x ^= x + Math.imul(x ^ x >>> 7, 61 | x); return ((x ^ x >>> 14) >>> 0) / 4294967296; };
    const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

    try { Storage.prototype.setItem = function () {}; } catch (e) { /* storage off */ }
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    document.documentElement.classList.add('ms-saver');

    const { PRESETS } = await import('./env.js');
    const { loadPreset } = await import('./panels/material-view.js');
    const mats = shuffle((S.presets && S.presets.MATERIAL_PRESETS) || []);
    const envs = shuffle(PRESETS.map(p => p.id));
    const meshes = shuffle(MESHES);
    const dwell = Math.max(15, (+opts.seconds || 60) / 3) * 1000, fadeMs = 1200 + 800 * calm;
    store.setView({ autoRotate: true, exposure: DARK, background: 'env' });
    if (cam) cam.autoSpeed = 0.2 - 0.12 * calm;

    function fadeTo(ev) {
      const from = +state.view.exposure || 0, t0 = performance.now();
      return new Promise(res => {
        const step = now => {
          const k = smooth((now - t0) / fadeMs);
          store.setView({ exposure: from + (ev - from) * k });
          if (k < 1) requestAnimationFrame(step); else res();
        };
        requestAnimationFrame(step);
      });
    }
    // The plate: the preset on screen, its environment and mesh, the Material
    // Output inputs its graph drives, and the BRDF terms of shaders/pbr.wgsl
    // (fs_main analytic lights). A lobe line shows only when the graph
    // drives that input. One plate per material; it fades with the view.
    const MESH_NAME = { shaderBall: 'shader ball', sphere: 'sphere', roundedCube: 'rounded cube', torus: 'torus' };
    function plate(pr, envId, mesh) {
      if (!opts.label || !pr) return;
      const env = PRESETS.find(p => p.id === envId), g = pr.graph || {};
      const ins = (g.links || []).filter(l => l.to && l.to[0] === 'out').map(l => l.to[1]);
      const has = id => ins.includes(id);
      const eq = [
        'f = (1 − F)(1 − t)·c_diff/π + F·D·V',
        'F = F₀ + (1 − F₀)(1 − v·h)⁵',
        'D = α² / (π((n·h)²(α² − 1) + 1)²)',
        'V = ½ / (n·l·Λ(n·v) + n·v·Λ(n·l))',
        'Λ(x) = √(α² + (1 − α²)x²),  α = roughness²',
      ];
      if (has('anisotropy')) eq.push('anisotropic: α_t, α_b along tangent and bitangent');
      if (has('clearcoat')) eq.push('coat = F(0.04)·c·D(α_c)·¼/(v·h)²');
      if (has('sheen')) eq.push('sheen = D_charlie(r)·1/(4(n·l + n·v − n·l·n·v))');
      if (has('emissive')) eq.push(`emission = E·${(g.nodes && g.nodes[0] && g.nodes[0].params && g.nodes[0].params.emissiveStrength) || 1}`);
      const tex = [
        'f = (1 - F)(1 - t)\\,\\frac{c_{\\text{diff}}}{\\pi} + F\\,D\\,V',
        'F = F_0 + (1 - F_0)\\,(1 - v\\cdot h)^5',
        'D = \\frac{\\alpha^2}{\\pi\\left((n\\cdot h)^2(\\alpha^2 - 1) + 1\\right)^2}, \\qquad \\alpha = \\text{roughness}^2',
        'V = \\frac{1/2}{(n\\cdot l)\\,\\Lambda(n\\cdot v) + (n\\cdot v)\\,\\Lambda(n\\cdot l)}',
      ];
      opts.label({
        title: pr.label,
        sub: (pr.tags || []).join(', ').replace(/^./, c => c.toUpperCase()),
        params: [
          { name: 'environment', value: env ? env.label : envId },
          { name: 'mesh', value: MESH_NAME[mesh] || mesh },
          { name: 'graph', value: `${(g.nodes || []).length} nodes, ${(g.links || []).length} links` },
          { name: 'inputs', value: String(ins.length) },
        ],
        lines: [pr.description, 'Inputs: ' + ins.join(', ')],
        tex,
        eq,
        anchor: meshAnchor,
      });
    }
    // The mesh on screen, for the shell's label plate. The page has no TeX
    // or math colour classes, so the plate TeX above has no rules. The
    // centre is cam.target through cam.proj x cam.view (column-major) to
    // canvas px. vp.frame() fits the mesh bounding sphere r at the distance
    // r 1.12 / sin(m / 2), m the narrower FOV, so the sphere shows with the
    // angular radius asin(sin(m / 2) / 1.12) at any zoom. The key point is
    // the centre. Null while the view is faded (exposure under -4 EV).
    function meshAnchor() {
      if (!cam || !cam.view || !cam.proj || (+state.view.exposure || 0) < -4) return null;
      const c = document.getElementById('vp'), b = c.getBoundingClientRect(), t = cam.target;
      const mul = (m, v) => [0, 1, 2, 3].map(r => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * v[3]);
      const q = mul(cam.proj, mul(cam.view, [t[0], t[1], t[2], 1]));
      if (q[3] <= 0) return null;
      const x = b.left + (q[0] / q[3] + 1) / 2 * b.width, y = b.top + (1 - q[1] / q[3]) / 2 * b.height;
      const v = cam.fov * Math.PI / 180, hf = 2 * Math.atan(Math.tan(v / 2) * b.width / b.height), m = Math.min(v, hf);
      const fpx = (b.height / 2) / Math.tan(v / 2), r = fpx * Math.tan(Math.asin(Math.sin(m / 2) / 1.12));
      return { x, y, r, pts: [{ x, y }] };
    }
    let k = 0;
    async function nextState() {
      const baked = new Promise(res => { const u1 = store.once('bake:done', () => { u2(); res(); }); const u2 = store.once('bake:error', () => { u1(); res(); }); setTimeout(res, 8000); });
      if (mats.length) loadPreset(mats[k % mats.length]);
      store.setEnv({ preset: envs[k % envs.length], rotation: Math.round(rng() * 360 - 180) });
      if (vp) vp.setMesh(meshes[k % meshes.length]);
      plate(mats[k % mats.length], envs[k % envs.length], meshes[k % meshes.length]);
      k++;
      await baked;
      if (vp) vp.frame();
      await wait(400);
    }
    // A slow pitch swing on top of the turntable.
    const p0 = cam ? cam.pitch : 0.28, w = 0.00012 * (1 - 0.5 * calm);
    const swing = now => { if (cam) cam.pitch = p0 + 0.14 * Math.sin(now * w); requestAnimationFrame(swing); };
    (async () => {
      for (;;) {
        const t0 = performance.now();
        await nextState();
        await fadeTo(0);
        await wait(Math.max(2000, dwell - (performance.now() - t0) - fadeMs));
        await fadeTo(DARK);
      }
    })();
    requestAnimationFrame(swing);
    return { canvas: document.getElementById('vp'), warmupMs: 3000 };
  },
};
