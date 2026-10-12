// ============================================================================
//  PLANET COLLISION  ·  eos.js — the Tillotson equation of state (f64)
// ----------------------------------------------------------------------------
//  The same arithmetic as shaders/sph.wgsl "fn tillotson", "fn soundSpeed",
//  "fn uCold" and "fn temperature". Units: any consistent set. The solver
//  calls these with code-unit materials (matCode); the tests call them with
//  SI rows of data.js MATERIALS.
//
//  Tillotson (1962), as written in Melosh (1989) appendix II and Benz &
//  Asphaug (1999). eta = rho / rho0, mu = eta - 1, w = u / (E0 eta^2) + 1.
//    compressed or cold   (eta >= 1, or u <= Eiv):
//        Pc = (a + b / w) rho u + A mu + B mu^2
//    expanded and hot     (eta < 1, u >= Ecv):
//        Pe = a rho u + (b rho u / w + A mu exp(-beta x)) exp(-alpha x^2),
//        x = 1 / eta - 1
//    between Eiv and Ecv (eta < 1): the linear blend of Pc and Pe in u.
//  The model has no strength: a negative pressure becomes 0 (no tension).
//
//  Sound speed: the derivative along the adiabat, c^2 = dP/drho at fixed
//  entropy = dP/drho|u + (P / rho^2) dP/du|rho, as a forward difference
//  (compression side: at rho0 and u = 0 it gives c^2 = A / rho0, where a
//  central difference would see the clamp at P = 0). A floor
//  c^2 >= 0.25 A / rho0 keeps the time step and the viscosity finite where
//  the pressure is clamped at 0.
//
//  u_cold(eta): the energy of cold compression, the integral of
//  (A mu + B mu^2) / rho^2 from rho0 to rho (0 for eta < 1). The bodies
//  start on it (build.js), and the temperature counts only the heat above
//  it: T = T0 + max(0, u - u_cold) / c_v. Tillotson has no temperature, so
//  this is an estimate, not an EOS output.
//
//  grep -n targets: "export function tillotson", "export function soundSpeed",
//  "export function uCold", "export function temperature", "export function vapourWeight",
//  "export function matCode"
// ============================================================================
import { UNIT, MAT_LIST } from './data.js';

export function tillotson(m, rho, u) {
  const eta = Math.max(rho / m.rho0, 1e-6), mu = eta - 1;
  const w = u / (m.E0 * eta * eta) + 1;
  const Pc = (m.a + m.b / w) * rho * u + m.A * mu + m.B * mu * mu;
  let P;
  if (eta >= 1 || u <= m.Eiv) P = Pc;
  else {
    const x = 1 / eta - 1;
    const Pe = m.a * rho * u + (m.b * rho * u / w + m.A * mu * Math.exp(-m.beta * x)) * Math.exp(-m.alpha * x * x);
    P = u >= m.Ecv ? Pe : ((u - m.Eiv) * Pe + (m.Ecv - u) * Pc) / (m.Ecv - m.Eiv);
  }
  return Math.max(P, 0);
}

export function soundSpeed(m, rho, u, P = tillotson(m, rho, u)) {
  const d = 1e-3 * rho, du = P / (rho * rho) * d;
  const c2 = (tillotson(m, rho + d, u + du) - P) / d;
  return Math.sqrt(Math.max(c2, 0.25 * m.A / m.rho0));
}

export function uCold(m, eta) {
  if (eta <= 1) return 0;
  const l = Math.log(eta);
  return (m.A * (l + 1 / eta - 1) + m.B * (eta - 2 * l - 1 / eta)) / m.rho0;
}

// T in K. m.kT = (energy unit) / c_v: K per unit of u.
export function temperature(m, rho, u, T0 = 300) {
  return T0 + Math.max(0, u - uCold(m, rho / m.rho0)) * m.kT;
}

// Tillotson's own blend weight between the cold and the expanded-hot
// branch, 0..1. The page uses it as the "vapour" share of a particle; it
// is the EOS interpolation weight, not a phase calculation.
export function vapourWeight(m, rho, u) {
  if (rho >= m.rho0) return 0;
  return Math.min(1, Math.max(0, (u - m.Eiv) / (m.Ecv - m.Eiv)));
}

// A data.js MATERIALS row in code units (G = 1, Earth radius, Earth mass).
export function matCode(r) {
  const out = {
    id: r.id, name: r.name,
    rho0: r.rho0 / UNIT.RHO, A: r.A / UNIT.P, B: r.B / UNIT.P,
    E0: r.E0 / UNIT.E, Eiv: r.Eiv / UNIT.E, Ecv: r.Ecv / UNIT.E,
    a: r.a, b: r.b, alpha: r.alpha, beta: r.beta,
    kT: UNIT.E / r.cv, Tmelt: r.Tmelt,
  };
  return out;
}
// An SI row with kT for temperature() in SI (u in J/kg).
export function matSI(r) { return Object.assign({}, r, { kT: 1 / r.cv }); }
export const MATS_CODE = MAT_LIST.map(matCode);
