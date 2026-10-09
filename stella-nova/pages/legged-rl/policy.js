// ============================================================================
//  LEGGED ROBOT GYM  ·  policy.js — the upstream actor network in plain JS
// ----------------------------------------------------------------------------
//  Each pretrained policy in unitree_rl_gym (deploy/pre_train/<robot>/
//  motion.pt) is a TorchScript ActorCriticRecurrent actor from rsl_rl:
//      LSTM, one layer, 64 hidden units (gates i, f, g, o, as in PyTorch)
//      Linear 64 -> 32, ELU, Linear 32 -> num_actions
//  The hidden and cell state stay in the module between calls, so the
//  policy has a memory of the last steps. tools/legged-rl/convert.py wrote
//  the weights as base64 float32 into derived/<robot>/policy.json.
//  No DOM, no THREE: tests.mjs runs it in node against torch outputs.
//
//  GREP MAP
//    export function f32 ........... base64 -> Float32Array
//    export function createPolicy .. { step(obs), reset(), h, c, z }
// ============================================================================

export function f32(b64) {
  const s = atob(b64), u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return new Float32Array(u.buffer);
}

const sig = x => 1 / (1 + Math.exp(-x));

export function createPolicy(P) {
  const H = P.hidden, NI = P.nobs, NA = P.nact, NM = P.shapes['actor.0.weight'][0];
  const Wih = f32(P.Wih), Whh = f32(P.Whh), bih = f32(P.bih), bhh = f32(P.bhh);
  const W0 = f32(P.W0), b0 = f32(P.b0), W1 = f32(P.W1), b1 = f32(P.b1);
  const h0 = f32(P.h0), c0 = f32(P.c0);
  const h = new Float32Array(H), c = new Float32Array(H), g = new Float64Array(4 * H);
  const z = new Float32Array(NM), out = new Float32Array(NA);
  const pol = {
    hidden: H, nobs: NI, nact: NA, h, c, z, gates: g,
    reset() { h.set(h0); c.set(c0); out.fill(0); z.fill(0); },
    // one call per control step; obs is a Float32Array(nobs)
    step(obs) {
      for (let r = 0; r < 4 * H; r++) {
        let s = bih[r] + bhh[r];
        const a = r * NI, b = r * H;
        for (let k = 0; k < NI; k++) s += Wih[a + k] * obs[k];
        for (let k = 0; k < H; k++) s += Whh[b + k] * h[k];
        g[r] = s;
      }
      for (let k = 0; k < H; k++) {
        const i = sig(g[k]), f = sig(g[H + k]), gg = Math.tanh(g[2 * H + k]), o = sig(g[3 * H + k]);
        const cn = f * c[k] + i * gg;
        c[k] = cn; h[k] = o * Math.tanh(cn);
      }
      for (let r = 0; r < NM; r++) {
        let s = b0[r];
        for (let k = 0; k < H; k++) s += W0[r * H + k] * h[k];
        z[r] = s > 0 ? s : Math.expm1(s);   // ELU, alpha = 1
      }
      for (let r = 0; r < NA; r++) {
        let s = b1[r];
        for (let k = 0; k < NM; k++) s += W1[r * NM + k] * z[k];
        out[r] = s;
      }
      return out;
    },
  };
  pol.reset();
  return pol;
}
