// ============================================================================
//  GRAVITY PLAYGROUND  ·  saver scenes  (classic script, also run by Node)
// ----------------------------------------------------------------------------
//  The orbital patterns of the screensaver tour (window.snSaver in main.js).
//  Each scene builds a body list from a seeded rnd(). main.js integrates it
//  with the page's own velocity-Verlet step(). saver-test.mjs integrates
//  each scene with a copy of that step and checks the energy drift.
//
//  SCENE FIELDS
//    key, title, sub .. the plate names
//    ts ............... timeScale at calm 0 (substeps of h = dt = 0.01)
//    trail ............ trail length in steps
//    follow ........... the camera centres on this body (else the box)
//    escapeOk ......... share of framed bodies that may leave (tails)
//    tex, eq .......... the scene law (TeX and plain fallback)
//    build(rnd, G, mk) returns { bodies, omega?, extra?, pe?, info }
//      mk ........... makeBody(name, x, y, vx, vy, m, radius, color, fixed)
//      omega ........ draw in the frame that turns at omega about (0, 0)
//      extra(B) ..... adds an acceleration after the pair sum (precession)
//      pe(B) ........ the potential energy of extra, for the drift
//      info(B, t) ... live plate values: [{ sym, name, value }]
//    A body with noframe set does not count for the camera box.
//
//  SECTION MAP   (jump with grep -n "<anchor>" saver-scenes.js)
//      helpers ........... "function centre"      COM to rest at the origin
//      scenes ............ "SCENES = ["           the tour, in no order
// ============================================================================
(function (root) {
'use strict';

// Move the centre of mass to the origin and set the total momentum to zero.
// Fixed bodies stay where they are.
function centre(B) {
  var M = 0, x = 0, y = 0, vx = 0, vy = 0, i, b;
  for (i = 0; i < B.length; i++) { b = B[i]; if (b.fixed) return B; M += b.mass; x += b.mass * b.x; y += b.mass * b.y; vx += b.mass * b.vx; vy += b.mass * b.vy; }
  for (i = 0; i < B.length; i++) { b = B[i]; b.x -= x / M; b.y -= y / M; b.vx -= vx / M; b.vy -= vy / M; }
  return B;
}
// Turn the whole system by angle a (positions and velocities).
function turn(B, a) {
  var c = Math.cos(a), s = Math.sin(a);
  for (var b of B) {
    var x = b.x, y = b.y, vx = b.vx, vy = b.vy;
    b.x = c * x - s * y; b.y = s * x + c * y; b.vx = c * vx - s * vy; b.vy = s * vx + c * vy;
  }
  return B;
}
// A body on a Kepler ellipse about a fixed mass M at the origin: semi-major
// axis a, eccentricity e, periapsis at angle w, starting at periapsis.
function kepler(mk, G, M, name, a, e, w, m, rad, col) {
  var rp = a * (1 - e), vp = Math.sqrt(G * M * (1 + e) / rp);
  return mk(name, rp * Math.cos(w), rp * Math.sin(w), -vp * Math.sin(w), vp * Math.cos(w), m, rad, col);
}
var f1 = function (v) { return v.toFixed(1); };
var f2 = function (v) { return v.toFixed(2); };

var SCENES = [
  { key: 'kepler', title: 'Kepler ellipses', sub: 'Three orbits share one focus, e = 0, 0.45 and 0.7', ts: 3, trail: 1600,
    tex: [String.raw`r(\theta)=\frac{a\,(1-e^{2})}{1+e\cos\theta},\qquad T^{2}=\frac{4\pi^{2}}{G\,M}\,a^{3}`],
    eq: ['r(θ) = a(1 − e²) / (1 + e cos θ)', 'T² = 4π² a³ / (G M)'],
    build: function (rnd, G, mk) {
      var M = 8000, w = rnd() * 6.283, B = [mk('Sun', 0, 0, 0, 0, M, 18, '#ffeebb', true)];
      B.push(kepler(mk, G, M, 'e = 0', 110, 0, w + 1.1, 0.5, 6, '#5cd8e8'));
      B.push(kepler(mk, G, M, 'e = 0.45', 170, 0.45, w + 0.35 * rnd(), 0.5, 6, '#ffc832'));
      B.push(kepler(mk, G, M, 'e = 0.7', 230, 0.7, w - 0.35 * rnd(), 0.5, 6, '#e87466'));
      var T = function (a) { return 2 * Math.PI * Math.sqrt(a * a * a / (G * M)); };
      return { bodies: B, info: function () { return [{ sym: 'T_1', name: 'period, a = 110', value: f2(T(110)) }, { sym: 'T_3', name: 'period, a = 230', value: f2(T(230)) }, { sym: 'T_3/T_1', name: '(a₃/a₁)^{3/2}', value: f2(T(230) / T(110)) }]; } };
    } },

  { key: 'precession', title: 'Apsidal precession', sub: 'A GR-like 1/r⁴ term turns each ellipse into a rosette', ts: 3, trail: 4200,
    tex: [String.raw`\ddot{\vec r}=-\frac{G M}{r^{2}}\Bigl(1+\frac{3\,h^{2}}{c^{2}r^{2}}\Bigr)\hat r,\qquad \Delta\varpi=\frac{6\pi G M}{c^{2}a\,(1-e^{2})}`],
    eq: ['r̈ = −(GM/r²)(1 + 3h²/(c²r²)) r̂', 'Δϖ = 6πGM / (c² a (1 − e²)) per orbit'],
    build: function (rnd, G, mk) {
      var M = 8000, c2 = 2.3e6, w = rnd() * 6.283;
      var B = [mk('Sun', 0, 0, 0, 0, M, 18, '#ffeebb', true),
        kepler(mk, G, M, 'Inner', 120, 0.35, w, 0.5, 6, '#5cd8e8'),
        kepler(mk, G, M, 'Outer', 200, 0.6, w + 2.2, 0.5, 7, '#ffc832')];
      var dw = function (a, e) { return 6 * Math.PI * G * M / (c2 * a * (1 - e * e)) * 180 / Math.PI; };
      return { bodies: B,
        extra: function (B) { for (var b of B) { if (b.fixed) continue; var r2 = b.x * b.x + b.y * b.y, r = Math.sqrt(r2), h = b.x * b.vy - b.y * b.vx, k = -3 * G * M * h * h / (c2 * r2 * r2 * r); b.ax += k * b.x; b.ay += k * b.y; } },
        pe: function (B) { var U = 0; for (var b of B) { if (b.fixed) continue; var r = Math.hypot(b.x, b.y), h = b.x * b.vy - b.y * b.vx; U -= b.mass * G * M * h * h / (c2 * r * r * r); } return U; },
        info: function () { return [{ sym: 'c^{2}', name: 'light speed², sim units', value: '2.3·10⁶' }, { sym: '\\Delta\\varpi_1', name: 'inner, per orbit', value: f1(dw(120, 0.35)) + '°' }, { sym: '\\Delta\\varpi_2', name: 'outer, per orbit', value: f1(dw(200, 0.6)) + '°' }]; } };
    } },

  { key: 'circumbinary', title: 'Circumbinary planets', sub: 'Two planets orbit a binary star, outside 2.4 times its separation', ts: 4, trail: 2400,
    tex: [String.raw`a_p>a_{\mathrm{crit}}\approx 2.4\,a_{\mathrm{bin}},\qquad \Omega_{\mathrm{bin}}^{2}=\frac{G\,(m_1+m_2)}{a_{\mathrm{bin}}^{3}}`],
    eq: ['a_p > a_crit ≈ 2.4 a_bin', 'Ω_bin² = G(m₁ + m₂) / a_bin³'],
    build: function (rnd, G, mk) {
      var m = 3000, s = 50, v = Math.sqrt(G * m / (4 * s)), M = 2 * m;
      var B = [mk('Alpha', s, 0, 0, v, m, 13, '#ffc832'), mk('Beta', -s, 0, 0, -v, m, 13, '#5cd8e8')];
      var p1 = 260, p2 = 360, a1 = rnd() * 6.283, a2 = a1 + 2 + rnd() * 2;
      var v1 = Math.sqrt(G * M / p1), v2 = Math.sqrt(G * M / p2);
      B.push(mk('Planet b', p1 * Math.cos(a1), p1 * Math.sin(a1), -v1 * Math.sin(a1), v1 * Math.cos(a1), 2, 6, '#7ad87a'));
      B.push(mk('Planet c', p2 * Math.cos(a2), p2 * Math.sin(a2), -v2 * Math.sin(a2), v2 * Math.cos(a2), 1, 5, '#d870c8'));
      return { bodies: centre(B), info: function () { return [{ sym: 'a_{\\mathrm{bin}}', name: 'binary separation', value: String(2 * s) }, { sym: 'a_p/a_{\\mathrm{bin}}', name: 'planets b, c', value: f1(p1 / (2 * s)) + ', ' + f1(p2 / (2 * s)) }, { sym: 'q', name: 'mass ratio', value: '1' }]; } };
    } },

  { key: 'figure8', title: 'Figure-eight choreography', sub: 'Chenciner and Montgomery (2000): three equal masses on one curve', ts: 5, trail: 2600,
    tex: [String.raw`\vec r_{1}=-\vec r_{2}=(0.97000436,\,-0.24308753),\qquad \dot{\vec r}_{3}=-2\,\dot{\vec r}_{1}=(-0.93240737,\,-0.86473146)`],
    eq: ['r₁ = −r₂ = (0.97000436, −0.24308753)', 'ṙ₃ = −2ṙ₁ = (−0.93240737, −0.86473146)'],
    build: function (rnd, G, mk) {
      // s = 180 keeps the drawn bodies (radius 10) small against the curve.
      var s = 180, m = 900, vs = Math.sqrt(G * m / s);
      var B = [mk('A', -0.97000436 * s, 0.24308753 * s, 0.466203685 * vs, 0.43236573 * vs, m, 10, '#ffc832'),
        mk('B', 0.97000436 * s, -0.24308753 * s, 0.466203685 * vs, 0.43236573 * vs, m, 10, '#5cd8e8'),
        mk('C', 0, 0, -0.93240737 * vs, -0.86473146 * vs, m, 10, '#e87466')];
      return { bodies: turn(B, rnd() * 6.283), info: function () { return [{ sym: 'T', name: 'period, 6.3259 s/v', value: f2(6.3259 * s / vs) }, { sym: 'm', name: 'each mass', value: String(m) }]; } };
    } },

  { key: 'lagrange', title: 'Lagrange triangle', sub: 'Three masses at the corners of a turning equilateral triangle', ts: 4, trail: 1500,
    tex: [String.raw`\omega^{2}=\frac{G\,(m_1+m_2+m_3)}{d^{3}},\qquad 27\,(m_1m_2+m_2m_3+m_3m_1)<(m_1+m_2+m_3)^{2}`],
    eq: ['ω² = G(m₁ + m₂ + m₃) / d³', 'Routh: 27(m₁m₂ + m₂m₃ + m₃m₁) < (Σm)²'],
    build: function (rnd, G, mk) {
      var d = 220, ms = [4000, 60, 30], M = ms[0] + ms[1] + ms[2], w = Math.sqrt(G * M / (d * d * d));
      var P = [[0, 0], [d, 0], [d / 2, d * Math.sqrt(3) / 2]], cx = 0, cy = 0, i;
      for (i = 0; i < 3; i++) { cx += ms[i] * P[i][0] / M; cy += ms[i] * P[i][1] / M; }
      var names = ['Star', 'Planet', 'Trojan'], cols = ['#ffeebb', '#5cd8e8', '#ffc832'], rad = [16, 9, 7], B = [];
      for (i = 0; i < 3; i++) { var x = P[i][0] - cx, y = P[i][1] - cy; B.push(mk(names[i], x, y, -w * y, w * x, ms[i], rad[i], cols[i])); }
      var routh = 27 * (ms[0] * ms[1] + ms[1] * ms[2] + ms[2] * ms[0]) / (M * M);
      return { bodies: turn(B, rnd() * 6.283), info: function () { return [{ sym: 'd', name: 'side', value: String(d) }, { sym: 'T', name: 'period 2π/ω', value: f2(2 * Math.PI / w) }, { sym: '27\\Sigma m_im_j/M^{2}', name: 'Routh, stable < 1', value: f2(routh) }]; } };
    } },

  { key: 'trojans', title: 'Trojans at L4 and L5', sub: 'Tadpole orbits, seen in the frame that turns with the planet', ts: 8, trail: 2600,
    tex: [String.raw`\mu=\frac{m_p}{M+m_p}<0.0385,\qquad T_{\mathrm{lib}}\approx T\sqrt{\frac{4}{27\,\mu}}`],
    eq: ['μ = m_p / (M + m_p) < 0.0385', 'T_lib ≈ T √(4 / 27μ)'],
    build: function (rnd, G, mk) {
      var M = 8000, mp = 40, a = 150, W = Math.sqrt(G * (M + mp) / (a * a * a)), mu = mp / (M + mp);
      // star and planet on circles about their barycentre
      var B = [mk('Star', -mu * a, 0, 0, -W * mu * a, M, 16, '#ffeebb'), mk('Planet', (1 - mu) * a, 0, 0, W * (1 - mu) * a, mp, 9, '#5cd8e8')];
      // Test bodies at distance r from the star, angle th from the planet,
      // turning with the frame (rigid rotation W about the barycentre).
      var tb = function (name, r, th, col) { var x = -mu * a + r * Math.cos(th), y = r * Math.sin(th); return mk(name, x, y, -W * y, W * x, 0.001, 4, col); };
      var d = Math.PI / 180;
      var cols = ['#ffc832', '#e89858', '#e0e060', '#e87466', '#d870c8', '#96c8ff'];
      TROJAN.forEach(function (th, k) { B.push(tb((th > 0 ? 'L4' : 'L5') + ' Trojan', a, th * d, cols[k])); });
      return { bodies: B, omega: W, info: function () { return [{ sym: '\\mu', name: 'mass ratio', value: mu.toFixed(4) }, { sym: 'T', name: 'planet period', value: f2(2 * Math.PI / W) }, { sym: 'T_{\\mathrm{lib}}', name: 'tadpole, small swing', value: f2(2 * Math.PI / W * Math.sqrt(4 / (27 * mu))) }]; } };
    } },

  { key: 'assist', title: 'Gravity assist', sub: 'A probe passes behind a planet and leaves on a larger orbit', ts: 3, trail: 3000,
    tex: [String.raw`v_\infty^{\mathrm{in}}=v_\infty^{\mathrm{out}}\ \text{(planet frame)},\qquad \Delta v=2\,v_\infty\sin\frac{\delta}{2}`],
    eq: ['|v∞ in| = |v∞ out| in the planet frame', 'Δv = 2 v∞ sin(δ/2)'],
    build: function (rnd, G, mk) {
      var M = 8000, mp = 600, ap = 180, vp = Math.sqrt(G * M / ap), ph = ASSIST_PHASE;
      var B = [mk('Sun', 0, 0, 0, 0, M, 18, '#ffeebb', true),
        mk('Planet', ap * Math.cos(ph), ap * Math.sin(ph), -vp * Math.sin(ph), vp * Math.cos(ph), mp, 11, '#e89858'),
        kepler(mk, G, M, 'Probe', 135, 0.48, Math.PI, 0.001, 4, '#96c8ff')];
      var E0 = null;
      return { bodies: turn(B, rnd() * 6.283), info: function (B) { var p = B[2], e = 0.5 * (p.vx * p.vx + p.vy * p.vy) - G * M / Math.hypot(p.x, p.y); if (E0 === null) E0 = e; return [{ sym: '\\varepsilon', name: 'probe orbit energy', value: f1(e) }, { sym: '\\varepsilon/\\varepsilon_0', name: 'from the start', value: f2(e / E0) }, { sym: 'm_p', name: 'planet mass', value: String(mp) }]; } };
    } },

  { key: 'laplace', title: 'Laplace resonance 1 : 2 : 4', sub: 'Io, Europa and Ganymede: periods in the ratio 1 : 2 : 4', ts: 3, trail: 1500,
    tex: [String.raw`\lambda_{\mathrm{I}}-3\lambda_{\mathrm{E}}+2\lambda_{\mathrm{G}}=180^{\circ},\qquad T\propto a^{3/2}`],
    eq: ['λ_I − 3λ_E + 2λ_G = 180°', 'T ∝ a^(3/2)'],
    build: function (rnd, G, mk) {
      var M = 8000, r1 = 110, r2 = r1 * Math.pow(2, 2 / 3), r3 = r1 * Math.pow(4, 2 / 3), w = rnd() * 6.283;
      var c = function (name, r, th, m, rad, col) { var v = Math.sqrt(G * M / r); return mk(name, r * Math.cos(th), r * Math.sin(th), -v * Math.sin(th), v * Math.cos(th), m, rad, col); };
      // Io at w, Europa at w + 180°, Ganymede at w: w − 3(w + 180°) + 2w = −540° ≡ 180°
      var B = [mk('Jupiter', 0, 0, 0, 0, M, 20, '#ffeebb', true), c('Io', r1, w, 1.5, 5, '#ffc832'), c('Europa', r2, w + Math.PI, 2, 6, '#5cd8e8'), c('Ganymede', r3, w, 3, 8, '#e87466')];
      var T1 = 2 * Math.PI * Math.sqrt(r1 * r1 * r1 / (G * M));
      return { bodies: B, info: function () { return [{ sym: 'T_I', name: 'Io period', value: f2(T1) }, { sym: 'T_E/T_I', name: 'Europa', value: '2.00' }, { sym: 'T_G/T_I', name: 'Ganymede', value: '4.00' }]; } };
    } },

  { key: 'triple', title: 'Hierarchical triple', sub: 'A tight binary and a third star on a wide orbit', ts: 4, trail: 2400,
    tex: [String.raw`\frac{a_{\mathrm{out}}}{a_{\mathrm{in}}}>2.8\Bigl(1+\frac{m_3}{m_1+m_2}\Bigr)^{2/5}\ \text{(Mardling–Aarseth, circular)}`],
    eq: ['a_out / a_in > 2.8 (1 + m₃/(m₁ + m₂))^(2/5)'],
    build: function (rnd, G, mk) {
      var m = 1500, s = 30, v = Math.sqrt(G * m / (4 * s)), m3 = 2500, R = 320, Mi = 2 * m, Mt = Mi + m3;
      var vr = Math.sqrt(G * Mt / R), vi = -m3 / Mt * vr, vo = Mi / Mt * vr, xi = -m3 / Mt * R, xo = Mi / Mt * R;
      var B = [mk('A', xi + s, 0, 0, vi + v, m, 11, '#ffc832'), mk('B', xi - s, 0, 0, vi - v, m, 11, '#5cd8e8'), mk('C', xo, 0, 0, vo, m3, 13, '#e87466')];
      var lim = 2.8 * Math.pow(1 + m3 / Mi, 0.4);
      return { bodies: turn(B, rnd() * 6.283), info: function () { return [{ sym: 'a_{\\mathrm{out}}/a_{\\mathrm{in}}', name: 'ratio', value: f1(R / (2 * s)) }, { sym: '\\text{limit}', name: 'Mardling–Aarseth', value: f2(lim) }, { sym: 'm_3/m_1', name: 'mass ratio', value: f2(m3 / m) }]; } };
    } },

  { key: 'tidal', title: 'Tidal tails', sub: 'A passing mass pulls a disk of stars into a bridge and a tail', ts: 2, trail: 700, follow: 0, escapeOk: 0.35,
    tex: [String.raw`r_{\mathrm{t}}\approx q\Bigl(\frac{M}{3\,(M+M_p)}\Bigr)^{1/3},\qquad \text{parabolic: } v^{2}=\frac{2G\,(M+M_p)}{r}`],
    eq: ['r_t ≈ q (M / 3(M + M_p))^(1/3)', 'parabolic: v² = 2G(M + M_p)/r'],
    build: function (rnd, G, mk) {
      var M = 5000, Mp = 3500, q = 170, r0 = 520, Mt = M + Mp, sgn = rnd() < 0.5 ? 1 : -1;
      var B = [mk('Core', 0, 0, 0, 0, M, 14, '#ffeebb')];
      var cols = ['#5cd8e8', '#96c8ff', '#d870c8', '#ffc832'], n = 0;
      for (var ring = 0; ring < 4; ring++) {
        var r = 45 + ring * 25, k = 10 + ring * 4, ph = rnd() * 6.283, v = Math.sqrt(G * M / r);
        for (var j = 0; j < k; j++) { var th = ph + j * 6.283 / k; B.push(mk('', r * Math.cos(th), r * Math.sin(th), -sgn * v * Math.sin(th), sgn * v * Math.cos(th), 0.01, 2.5, cols[ring])); n++; }
      }
      // perturber on a parabola with periapsis q, starting at r0 (D = tan(ν/2))
      var D = -Math.sqrt(r0 / q - 1), nu = 2 * Math.atan(D), rr = q * (1 + D * D), vv = Math.sqrt(2 * G * Mt / rr);
      var px = rr * Math.cos(nu), py = rr * Math.sin(nu), fl = Math.atan(D);  // flight angle: tan γ = D
      var ux = -Math.sin(nu - fl), uy = Math.cos(nu - fl);   // velocity direction
      var P = mk('Intruder', px, py, vv * ux * M / Mt, vv * uy * M / Mt, Mp, 12, '#e87466');
      P.noframe = true;
      for (var b of B) { b.vx -= vv * ux * Mp / Mt; b.vy -= vv * uy * Mp / Mt; }
      B.push(P);
      return { bodies: turn(B, rnd() * 6.283), info: function () { return [{ sym: 'N', name: 'disk stars', value: String(n) }, { sym: 'q', name: 'periapsis', value: String(q) }, { sym: 'M_p/M', name: 'mass ratio', value: f2(Mp / M) }]; } };
    } },
];

// The planet's start phase (radians) that sends the probe behind it. A scan
// of 0 to 6.3 in steps of 0.15 found 3.60: closest pass 67 units, probe
// orbit energy from 1 to 0.43 of its start value (it stays bound), new
// apoapsis about 600.
var ASSIST_PHASE = 3.6;
// Trojans: start angles in degrees from the planet, three about L4 (+60°)
// and three about L5 (−60°). saver-test.mjs checks that each one stays a
// tadpole (its angle never reaches the planet or 180°). A horseshoe body
// was tried at mu = 0.005: its close pass sent it onto a circulating orbit.
var TROJAN = [66, 76, 86, -66, -80, -94];

var API = { SCENES: SCENES, centre: centre, turn: turn };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
root.GRAVITY_SAVER = API;
})(typeof window !== 'undefined' ? window : globalThis);
