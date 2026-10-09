// ============================================================================
//  MUJOCO LAB  ·  explain/index.js — the "How MuJoCo works" section
// ----------------------------------------------------------------------------
//  The page mounts this module below the playground:
//
//      import { mountExplainer } from './explain/index.js';
//      const ex = mountExplainer(document.querySelector('#explain'), { mj });
//      (opts.heading = false, or a root inside [role=dialog], drops the h2)
//      ...  ex.dispose()   // on page release
//
//  It writes ten sections of text, equations (MathJax through
//  lib/sci-math.js, never KaTeX) and live figures (explain/figs.js). Each
//  figure runs the real engine on a tiny model of its own. A figure is made
//  only when it scrolls near the view, and it runs only while it is in view.
//  One requestAnimationFrame loop drives all running figures. The style is
//  explain/explain.css (the module adds the <link> when it is missing).
//
//  GREP MAP
//    export const SECTIONS ....... id, title, html, eqs, fig, controls
//    export const REFS ........... the reference list (with DOI and URL)
//    export function allTex ...... every TeX string of the section (tests)
//    export function mountExplainer root -> { dispose, ready, typeset, figs }
//    function palette ............ CSS tokens -> figure colors
//    function makeFigure ......... canvas, controls, resize, draw
// ============================================================================

import { STEPS, INTEGRATORS, SOLVERS, CITATIONS } from '../core/explain.js';
import { loadMuJoCo } from '../core/engine.js';
import { FIGS, PALETTE } from './figs.js';

const step = id => STEPS.find(s => s.id === id);
const i = tex => `<span class="mx-m" data-tex="${esc(tex)}" data-inline></span>`;
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

export const REFS = [
  ...CITATIONS.filter(c => c.id !== 'docs-solver'),
  { id: 'tassa2018', authors: 'Y. Tassa, Y. Doron, A. Muldal, et al.', year: 2018, title: 'DeepMind Control Suite', venue: 'arXiv:1801.00690', url: 'https://arxiv.org/abs/1801.00690' },
  { id: 'zakka2025', authors: 'K. Zakka, B. Tabanpour, Q. Liao, et al.', year: 2025, title: 'MuJoCo Playground', venue: 'arXiv:2502.08844', url: 'https://arxiv.org/abs/2502.08844' },
  { id: 'docs-modeling', authors: 'MuJoCo documentation (Google DeepMind)', year: 2026, title: 'Modeling: solver parameters, actuators, tendons, sensors', venue: 'MuJoCo 3.15.0 documentation', url: 'https://mujoco.readthedocs.io/en/stable/modeling.html' },
];
const cite = (...ids) => ids.map(id => { const n = REFS.findIndex(r => r.id === id) + 1; return n ? `<a class="mx-cite" href="#mx-ref-${id}">[${n}]</a>` : ''; }).join('');

// Each section: html (prose with inline TeX), eqs (display TeX), fig (FIGS id).
export const SECTIONS = [
  { id: 'coords', title: 'Generalized coordinates',
    html: `<p>MuJoCo describes a robot by its joints, not by its bodies. The state is ${i('q')} (every joint position) and ${i('v')} (every joint velocity). A hinge adds one number, a slide one, a ball joint four for ${i('q')} (a unit quaternion) and three for ${i('v')}, and a free body seven and six. In these coordinates, the whole multi-body system obeys one equation of motion.</p>
      <p>${i('M(q)')} is the joint-space inertia: it changes with the pose, because a bent arm is easier to turn than a straight one. ${i('c(q,\\dot q)')} holds gravity and the Coriolis and centrifugal forces, ${i('\\tau')} the applied forces (actuators, springs, the mouse) and ${i('J^T f')} the constraint forces of contacts, limits and equalities. ${cite('docs-computation', 'todorov2012')}</p>`,
    eqs: ['M(q)\\,\\ddot q + c(q,\\dot q) = \\tau + J^T f', 'T = \\tfrac12\\, \\dot q^{\\,T} M(q)\\, \\dot q'], fig: 'coords' },
  { id: 'joint-space', title: 'Why joint space is efficient',
    html: `<p>A maximal-coordinate engine gives every body six numbers and then adds constraint rows to hold the joints together: five for each hinge. It must solve for all of them, and the joints drift apart unless a stabilizer pulls them back. In joint space, a joint cannot come apart: the coordinates hold only the motion that the joint allows.</p>
      <p>The cost moves to ${i('M(q)')}, which is dense in general. MuJoCo builds it with the composite rigid body algorithm and factors it as ${i('M = L^T D L')}, where ${i('L')} has the sparsity of the kinematic tree, so a long chain and a wide tree both stay cheap. ${cite('featherstone2008', 'docs-computation')}</p>`,
    eqs: ['\\text{maximal: } \\; 6N \\text{ unknowns} + 5N \\text{ rows} \\qquad \\text{joint space: } \\; N \\text{ unknowns}', 'M(q) = L^T D L, \\qquad \\ddot q = L^{-1} D^{-1} L^{-T} (\\tau - c)'], fig: 'chain' },
  { id: 'contacts', title: 'Contacts: a convex problem with soft constraints',
    html: `<p>A rigid contact obeys complementarity: the gap is open and the force is zero, or the gap is closed and the force pushes. As an optimization this is non-convex and can have many answers or none. MuJoCo makes each constraint soft. By Gauss's principle, the true acceleration is the one closest to the unconstrained one, in the metric of ${i('M')}; MuJoCo replaces the hard constraint with a convex penalty ${i('s')}, so the answer is unique and smooth. ${cite('todorov2014', 'docs-computation')}</p>
      <p>The same solution has a dual form in the constraint forces. The regularizer ${i('R')} makes it strictly convex. The impedance ${i('d \\in (0,1)')} sets ${i('R')} and blends the unconstrained acceleration with a reference acceleration ${i('a_{\\mathrm{ref}}')}: a spring and damper that pull the violation ${i('r')} back to zero. <code>solref</code> sets the spring (time constant and damping ratio) and <code>solimp</code> sets how ${i('d')} grows with ${i('r')}. ${cite('docs-modeling')}</p>`,
    eqs: [...step('gauss').tex, ...step('primal').tex, ...step('dual').tex, ...step('impedance').tex, ...step('reference').tex, ...step('complementarity').tex], fig: 'contact' },
  { id: 'impedance', title: 'The impedance curve', sub: true,
    html: `<p>With <code>solimp = (d<sub>0</sub>, d<sub>w</sub>, width, midpoint, power)</code>, ${i('d')} goes from ${i('d_0')} at the surface to ${i('d_w')} at a violation of one width. The default makes contacts nearly hard at once; a low ${i('d_0')} gives a contact that is soft at first touch and stiff when pressed deep.</p>`,
    eqs: ['d(r) = d_0 + y\\!\\left(x\\right)(d_w - d_0), \\qquad x = \\frac{|r|}{\\text{width}}', 'y(x) = \\begin{cases} x^p / m^{p-1} & x \\le m \\\\ 1 - (1-x)^p / (1-m)^{p-1} & x > m \\end{cases}'], fig: 'impedance' },
  { id: 'cones', title: 'Friction cones',
    html: `<p>Coulomb friction keeps the tangential force inside a cone: no larger than ${i('\\mu')} times the normal force. The elliptic cone is that exact condition (with torsional and rolling terms when <code>condim</code> is 4 or 6). The pyramidal cone, the default, replaces it with edge vectors ${i('n \\pm \\mu\\, t_j')} that the solver combines with non-negative weights. Its section is a square, so a push along a diagonal meets only ${i('\\mu/\\sqrt 2')} of friction. ${cite('docs-computation')}</p>`,
    eqs: ['\\lVert f_T \\rVert \\le \\mu\\, f_N', step('cones').tex[0], 'f = \\sum_{j} \\alpha_j^{\\pm} \\left(n \\pm \\mu_j\\, t_j\\right), \\qquad \\alpha_j^{\\pm} \\ge 0'], fig: 'cones' },
  { id: 'solvers', title: 'The solvers: PGS, CG and Newton',
    html: `<p>${SOLVERS.map(s => `<b>${s.name}.</b> ${s.text}`).join(' ')} Because the problem is convex, all three find the same answer; they differ in the cost of one iteration and in the number of iterations. MuJoCo also starts each solve from the last step's acceleration (warm start), which the plot turns off. ${cite('todorov2014', 'docs-computation')}</p>`,
    eqs: ['\\lambda_i \\leftarrow \\Pi_{\\Omega_i}\\!\\left(\\lambda_i - \\frac{\\left[(A + R)\\lambda + a_u - a_{\\mathrm{ref}}\\right]_i}{(A + R)_{ii}}\\right) \\quad\\text{(PGS)}', 'x \\leftarrow x - \\alpha\\, H^{-1} \\nabla \\ell(x) \\quad\\text{(Newton, exact line search on } \\alpha)'], fig: 'solvers', button: ['reseed', 'New stack'] },
  { id: 'integrators', title: 'Integrators',
    html: `<p>${INTEGRATORS.map(s => `<b>${s.name}.</b> ${s.text}`).join(' ')} ${cite('docs-computation')}</p>`,
    eqs: INTEGRATORS.flatMap(s => s.tex), fig: 'integrators' },
  { id: 'actuators', title: 'Actuators, tendons and equality constraints',
    html: `<p>An actuator makes a scalar force ${i('p')} from its control ${i('u')}: a gain times the control plus a bias. A position servo is a gain ${i('k_p')} and a bias ${i('-k_p q - k_v \\dot q')}. The force reaches the joints through the moment arm. A tendon is a length: a sum of joint positions (fixed) or a path through sites and around wrapping objects (spatial). A tendon can carry an actuator, a spring, or a limit; a limit with only a maximum length is a rope. An equality constraint is a soft constraint row that is always active: it can weld two bodies, join them at a point, or couple two joints by a polynomial. ${cite('docs-modeling')}</p>`,
    eqs: ['p = \\text{gain}(l, \\dot l)\\, u + \\text{bias}(l, \\dot l), \\qquad \\tau_{\\text{act}} = \\left(\\frac{\\partial l}{\\partial q}\\right)^{T} p', 'p_{\\text{servo}} = k_p\\,(u - q) - k_v\\,\\dot q', 'L_{\\text{tendon}} = \\sum_k \\lVert s_{k+1} - s_k \\rVert, \\qquad r_{\\text{eq}} = q_2 - P(q_1)'], fig: 'actuators' },
  { id: 'sensors', title: 'Sensors',
    html: `<p>Sensors read the simulation the way a real sensor reads a robot: joint positions and velocities, actuator forces, tendon lengths, frame poses, touch, force and torque, gyroscope, accelerometer, range finders, and more. They are computed in the step, at the stage where their inputs are ready, and each can have noise and a cutoff. The touch sensor adds the normal forces of the contacts inside its site; the accelerometer reports the specific force in the site frame, so it reads zero in free fall. ${cite('docs-modeling')}</p>`,
    eqs: ['a_{\\text{sensor}} = R^T\\,(\\ddot p - g), \\qquad \\text{touch} = \\sum_{c \\,\\in\\, \\text{site}} f_{N,c}'], fig: 'sensors' },
  { id: 'fast', title: 'What makes MuJoCo fast',
    html: `<ul>
      <li><b>Few unknowns.</b> Joint space removes the joint constraints entirely (see above).</li>
      <li><b>Sparse algebra.</b> The factorization of ${i('M')} and the constraint Jacobian follow the tree and the contacts, and skip the zeros.</li>
      <li><b>A convex, smooth problem.</b> Newton converges in a few iterations, and the warm start often makes it one or two.</li>
      <li><b>No allocation in the step.</b> The compiler makes one flat model; all step data lives in a preallocated arena.</li>
      <li><b>Islands.</b> Groups of bodies that do not touch are solved apart.</li>
      <li><b>Analytic derivatives</b> of the smooth dynamics, for optimal control and for the implicit integrators.</li>
      <li><b>Accelerators.</b> MJX (JAX) and MuJoCo Warp run thousands of copies of a model on a GPU; this page uses the C library compiled to WebAssembly.</li>
    </ul> ${cite('todorov2012', 'docs-computation', 'mujoco-repo')}`,
    eqs: [], fig: 'speed', button: ['rerun', 'Measure again'] },
  { id: 'history', title: 'History and uses',
    html: `<p>Emanuel Todorov, Tom Erez and Yuval Tassa introduced MuJoCo (Multi-Joint dynamics with Contact) at IROS 2012, at the University of Washington, as an engine for model-based control: fast enough to run inside an optimizer, with soft contacts that make the dynamics smooth and invertible. ${cite('todorov2012', 'todorov2014')} It was a commercial product of Roboti LLC for years. Google DeepMind acquired it in October 2021, made it free, and in May 2022 released the source code under the Apache-2.0 licence.</p>
      <p>MuJoCo became a standard for reinforcement learning: the Gym and Gymnasium locomotion tasks, the DeepMind Control Suite ${cite('tassa2018')}, and MuJoCo Playground, which trains policies on a GPU in minutes and moves them to real robots ${cite('zakka2025')}. It is also used for robot design, model-predictive control, biomechanics (muscle and tendon models) and haptics. The MuJoCo Menagerie collects curated robot models.</p>
      <p class="mx-credit">This page runs MuJoCo 3.15.0, compiled to WebAssembly. MuJoCo is copyright Google DeepMind and is licensed under the Apache License 2.0; source: <a href="https://github.com/google-deepmind/mujoco" target="_blank" rel="noopener">github.com/google-deepmind/mujoco</a>. The small models in these figures are original to this site.</p>`,
    eqs: [], fig: null },
];

// Every TeX string in the section, display and inline (for the tests).
export function allTex() {
  const out = [];
  for (const s of SECTIONS) {
    for (const t of s.eqs) out.push([s.id, t, true]);
    for (const m of s.html.matchAll(/data-tex="([^"]*)"/g)) out.push([s.id, m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'), false]);
  }
  return out;
}

function palette(el) {
  const P = { ...PALETTE };
  try {
    const cs = (el.ownerDocument.defaultView || globalThis).getComputedStyle(el), g = k => cs.getPropertyValue(k).trim();
    const map = { bg: '--mx-fig-bg', text: '--sk-text', dim: '--sk-text2', line: '--sk-line', accent: '--sk-accent', m1: '--m1', m2: '--m2', m3: '--m3', m4: '--m4', m5: '--m5', m6: '--m6' };
    for (const k in map) { const v = g(map[k]); if (v) P[k] = v; }
  } catch (e) { /* no computed style: keep the fallback colors */ }
  return P;
}

// The DOM part of one figure. The figure model (figs.js) is made later.
function makeFigure(doc, sec, spec) {
  const fig = doc.createElement('figure'); fig.className = 'mx-fig';
  const canvas = doc.createElement('canvas'); canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', spec.caption);
  fig.appendChild(canvas);
  const ctl = doc.createElement('div'); ctl.className = 'mx-ctl'; fig.appendChild(ctl);
  const cap = doc.createElement('figcaption'); cap.textContent = spec.caption; fig.appendChild(cap);
  return { fig, canvas, ctl, F: null, spec, sec, visible: false, dirty: true, w: 0, h: 0 };
}

export function mountExplainer(root, opts = {}) {
  const doc = root.ownerDocument || document, win = doc.defaultView || globalThis;
  if (!doc.querySelector('link[data-mx-explain]')) {
    const l = doc.createElement('link'); l.rel = 'stylesheet'; l.dataset.mxExplain = '';
    l.href = new URL('./explain.css', import.meta.url).href; doc.head.appendChild(l);
  }
  // In a dialog that has its own title (main.js #explain-dlg), skip the h2.
  const inDialog = opts.heading === false || !!(root.closest && root.closest('[role=dialog]'));
  const wrap = doc.createElement('section'); wrap.className = 'mx-explain' + (inDialog ? ' mx-in-dialog' : ''); wrap.id = 'how-mujoco-works';
  wrap.innerHTML = `<header class="mx-head">${inDialog ? '' : '<h2>How MuJoCo works</h2>'}
    <p class="mx-lede">Every figure below runs the real MuJoCo engine, the same WebAssembly build as the playground above, on a tiny model of its own.</p>
    <nav class="mx-toc">${SECTIONS.filter(s => !s.sub).map(s => `<a href="#mx-${s.id}">${s.title}</a>`).join('')}</nav></header>`;
  const figs = [];
  for (const s of SECTIONS) {
    const el = doc.createElement('article'); el.className = 'mx-sec' + (s.sub ? ' mx-sub' : ''); el.id = 'mx-' + s.id;
    el.innerHTML = `<${s.sub ? 'h4' : 'h3'}>${s.title}</${s.sub ? 'h4' : 'h3'}>${s.html}` +
      s.eqs.map(t => `<div class="mx-eq" data-tex="${esc(t)}"></div>`).join('');
    if (s.fig) {
      const f = makeFigure(doc, s, FIGS[s.fig]); f.id = s.fig; el.appendChild(f.fig); figs.push(f);
    }
    wrap.appendChild(el);
  }
  const refs = doc.createElement('article'); refs.className = 'mx-sec mx-refs'; refs.id = 'mx-references';
  refs.innerHTML = '<h3>References</h3><ol>' + REFS.map(r => `<li id="mx-ref-${r.id}">${esc(r.authors)} (${r.year}). <i>${esc(r.title)}</i>. ${esc(r.venue)}. <a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.doi ? 'doi:' + r.doi : r.url)}</a></li>`).join('') + '</ol>';
  wrap.appendChild(refs);
  root.appendChild(wrap);

  // ── MathJax ─────────────────────────────────────────────────────────────
  const typeset = import('../../../lib/sci-math.js').then(M => M.typesetAll(wrap)).catch(() => []);

  // ── figures ──────────────────────────────────────────────────────────────
  let mj = opts.mj || null, alive = true, raf = 0, last = 0;
  const ready = (mj ? Promise.resolve(mj) : loadMuJoCo()).then(m => { mj = m; return m; });
  let P = palette(wrap);

  const size = f => {
    const dpr = Math.min(2, win.devicePixelRatio || 1), w = Math.max(240, f.canvas.clientWidth || f.fig.clientWidth || 640);
    const h = Math.round(f.spec.height * (w < 520 ? 1.3 : 1));
    if (f.w !== w || f.h !== h) {
      f.w = w; f.h = h; f.canvas.style.height = h + 'px';
      f.canvas.width = Math.round(w * dpr); f.canvas.height = Math.round(h * dpr); f.dpr = dpr; f.dirty = true;
    }
  };
  const draw = f => {
    if (!f.F) return;
    const ctx = f.canvas.getContext && f.canvas.getContext('2d'); if (!ctx) return;
    size(f);
    ctx.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
    try { f.F.draw(ctx, f.w, f.h, P); } catch (e) { f.error = e; console.error('mujoco-lab explain:', f.id, e); }
    f.dirty = false;
  };
  const build = f => {
    if (f.F || !mj || !alive) return;
    try { f.F = f.spec.make(mj); } catch (e) { f.error = e; console.error('mujoco-lab explain:', f.id, e); return; }
    for (const c of f.F.controls || []) {
      const lab = doc.createElement('label'); const inp = doc.createElement('input');
      inp.type = 'range'; inp.min = c.min; inp.max = c.max; inp.step = c.step; inp.value = c.value;
      const out = doc.createElement('output'); out.textContent = c.value;
      lab.append(c.label + ' ', inp, out);
      inp.addEventListener('input', () => { out.textContent = inp.value; f.F.set(c.key, +inp.value * (c.scale || 1)); f.dirty = true; kick(); });
      f.ctl.appendChild(lab);
    }
    if (f.sec.button) {
      const b = doc.createElement('button'); b.type = 'button'; b.textContent = f.sec.button[1];
      b.addEventListener('click', () => { f.F.set(f.sec.button[0]); f.dirty = true; kick(); });
      f.ctl.appendChild(b);
    }
    f.F.tick(0); f.dirty = true;
  };
  const frame = t => {
    raf = 0; if (!alive) return;
    const dt = last ? Math.min(0.05, (t - last) / 1000) : 1 / 60; last = t;
    let again = false;
    for (const f of figs) {
      if (!f.visible) continue;
      if (!f.F) build(f);
      if (!f.F) continue;
      if (f.spec.live) { f.F.tick(dt); f.dirty = true; again = true; }
      else if (f.F.done && !f.F.done()) { f.F.tick(dt); f.dirty = true; again = true; }
      if (f.dirty) draw(f);
    }
    if (again) raf = (win.requestAnimationFrame || (cb => setTimeout(() => cb(performance.now()), 16)))(frame);
    else last = 0;
  };
  const kick = () => { if (!raf && alive && mj) raf = (win.requestAnimationFrame || (cb => setTimeout(() => cb(performance.now()), 16)))(frame); };

  let io = null;
  if (win.IntersectionObserver) {
    io = new win.IntersectionObserver(es => { for (const e of es) { const f = figs.find(x => x.fig === e.target); if (f) { f.visible = e.isIntersecting; if (f.visible) { f.dirty = true; kick(); } } } }, { rootMargin: '200px 0px' });
    figs.forEach(f => io.observe(f.fig));
  } else figs.forEach(f => { f.visible = true; });
  ready.then(() => kick(), e => { for (const f of figs) f.ctl.textContent = 'MuJoCo did not load: ' + (e && e.message || e); });

  const onTheme = () => { P = palette(wrap); figs.forEach(f => { f.dirty = true; }); kick(); };
  const onResize = () => { figs.forEach(f => { f.dirty = true; }); kick(); };
  win.addEventListener && win.addEventListener('resize', onResize);
  const mq = win.matchMedia && win.matchMedia('(prefers-color-scheme: dark)');
  mq && mq.addEventListener && mq.addEventListener('change', onTheme);

  return {
    root: wrap, figs, ready, typeset,
    // build and draw every figure now (tests, thumbnails)
    async drawAll() { await ready; for (const f of figs) { build(f); if (f.F && f.F.done) while (!f.F.done()) f.F.tick(0.016); else if (f.F) f.F.tick(0.1); draw(f); } return figs; },
    refreshTheme: onTheme,
    dispose() {
      alive = false; if (raf && win.cancelAnimationFrame) win.cancelAnimationFrame(raf); raf = 0;
      io && io.disconnect(); win.removeEventListener && win.removeEventListener('resize', onResize);
      mq && mq.removeEventListener && mq.removeEventListener('change', onTheme);
      for (const f of figs) { try { f.F && f.F.dispose(); } catch (e) { /* already freed */ } f.F = null; }
      wrap.remove();
    },
  };
}
