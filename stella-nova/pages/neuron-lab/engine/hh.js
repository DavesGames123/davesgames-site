// ============================================================================
//  NEURON LAB ENGINE  ·  hh.js  ·  the Hodgkin-Huxley mechanism
// ----------------------------------------------------------------------------
//  A JavaScript copy of the rate equations in NEURON's hh.mod
//  (neuronsimulator/nrn, src/nrnoc/hh.mod, last changed in commit
//  8202fe7e9db706d39780d0abb3531c929a325cb7; read at master 82241e0f).
//  NEURON is BSD-3-Clause, Copyright (c) 2018 Michael Hines.
//
//  Units are the NEURON units: mV, ms, S/cm2, mA/cm2, degC.
//  The defaults are the hh.mod PARAMETER block. ena = 50 mV and ek = -77 mV
//  are the NEURON ion defaults that hh picks up when it is inserted.
//
//  hh.mod uses a TABLE from -100 to 100 mV in 200 steps. This file computes
//  the rates directly, which is NEURON with usetable_hh = 0.
//
//  grep -n targets
//    "export const HH"        the PARAMETER defaults
//    "export function rates"  minf, mtau, hinf, htau, ninf, ntau
//    "export function vtrap"  the 0/0 trap
// ============================================================================

export const HH = { gnabar: 0.12, gkbar: 0.036, gl: 0.0003, el: -54.3, ena: 50, ek: -77 };
export const NRN = { dt: 0.025, celsius: 6.3, v_init: -65, cm: 1, Ra: 35.4, threshold: 10, delay: 1 };

export function vtrap(x, y) {
  return Math.abs(x / y) < 1e-6 ? y * (1 - x / y / 2) : x / (Math.exp(x / y) - 1);
}

// out = [minf, mtau, hinf, htau, ninf, ntau]
export function rates(v, celsius, out = new Float64Array(6)) {
  const q10 = Math.pow(3, (celsius - 6.3) / 10);
  let a = 0.1 * vtrap(-(v + 40), 10), b = 4 * Math.exp(-(v + 65) / 18), s = a + b;
  out[0] = a / s; out[1] = 1 / (q10 * s);
  a = 0.07 * Math.exp(-(v + 65) / 20); b = 1 / (Math.exp(-(v + 35) / 10) + 1); s = a + b;
  out[2] = a / s; out[3] = 1 / (q10 * s);
  a = 0.01 * vtrap(-(v + 55), 10); b = 0.125 * Math.exp(-(v + 65) / 80); s = a + b;
  out[4] = a / s; out[5] = 1 / (q10 * s);
  return out;
}

// A fast table for the network page: the same rates sampled every 0.05 mV
// with linear interpolation (finer than hh.mod's own 1 mV TABLE).
export function rateTable(celsius, dt, lo = -110, hi = 70, step = 0.05) {
  const n = Math.round((hi - lo) / step) + 1, r = new Float64Array(6);
  // for each gate: inf and the cnexp factor 1 - exp(-dt/tau)
  const T = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    rates(lo + i * step, celsius, r);
    T[i * 6] = r[0]; T[i * 6 + 1] = 1 - Math.exp(-dt / r[1]);
    T[i * 6 + 2] = r[2]; T[i * 6 + 3] = 1 - Math.exp(-dt / r[3]);
    T[i * 6 + 4] = r[4]; T[i * 6 + 5] = 1 - Math.exp(-dt / r[5]);
  }
  return { T, lo, step, n };
}
