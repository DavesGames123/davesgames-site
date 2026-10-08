// ============================================================================
//  GALAXY  ·  saver.js — window.snSaver for the shell screensaver
// ----------------------------------------------------------------------------
//  installSaver(api) defines window.snSaver (protocol: lib/screensaver.js).
//  enter(opts) hides the page GUI (html.saving) and plays shots from
//  saverplan.js: a seeded shuffle of presets and random galaxies of every
//  type, each with one camera move (orbit, face-on push-in, dive into the
//  disk, bulge fly-by, edge-on, interacting pair). A cut comes every 5-12
//  s behind a fade to black (the exposure goes to 0); the next galaxy
//  builds in the worker while the frame is black.
//  Framing: plateBand() (lib/saver-clear.js) gives the clear band between
//  the plate's top and bottom text. The camera backs off so the galaxy
//  fits the band, and the view offset moves it to the band centre.
//  The plate: the galaxy name and type, its parameters, and the TeX of the
//  model that the shot shows. No code on the plate.
//
//  grep -n targets: "function texFor", "function paramsFor", "enter(opts)",
//  "function frameBand", "debug()"
// ============================================================================
import * as M from './model.js';
import { makePlan, shotCamera } from './saverplan.js';
import { fitDistance } from './camera.js';
import { plateBand } from '../../lib/saver-clear.js';

const TEX = {
  spiral: 'r = a\\,e^{b\\theta},\\quad b = \\tan\\psi',
  rot: 'v(R) = \\frac{v_f R}{\\sqrt{R^2 + R_t^2}},\\quad \\Omega_p = \\text{const}',
  sersic: 'I(R) = I_e \\exp\\!\\left[-b_n\\left(\\left(\\tfrac{R}{r_e}\\right)^{1/n} - 1\\right)\\right]',
  disk: '\\rho(R,z) = \\rho_0\\, e^{-R/R_d}\\, e^{-|z|/h_z}',
  dust: 'I = I_0\\, e^{-\\tau_\\lambda},\\quad \\tau_\\lambda \\propto \\lambda^{-1}',
  tidal: '\\ddot{\\mathbf r} = -\\sum_{i=1,2} \\frac{G M_i\\,(\\mathbf r - \\mathbf r_i)}{\\left(|\\mathbf r - \\mathbf r_i|^2 + \\epsilon^2\\right)^{3/2}}',
};
const EQ = {
  spiral: 'r = a e^(bθ), b = tan ψ', rot: 'v(R) = v_f R / √(R² + R_t²)', sersic: 'I(R) = I_e exp[−b_n((R/r_e)^(1/n) − 1)]',
  disk: 'ρ(R, z) = ρ₀ e^(−R/R_d) e^(−|z|/h_z)', dust: 'I = I₀ e^(−τ_λ), τ_λ ∝ 1/λ', tidal: 'r̈ = −Σ G M_i (r − r_i) / (|r − r_i|² + ε²)^(3/2)',
};
const RULES = [['\\psi', 'm1'], ['b', 'm1'], ['R_d', 'm3'], ['h_z', 'm3'], ['r_e', 'm4'], ['n', 'm4'], ['v_f', 'm6'], ['\\Omega_p', 'm2'], ['\\tau_\\lambda', 'm5']];

function texFor(kind, P) {
  if (kind === 'pair') return ['tidal'];
  if (P.type === 'elliptical') return ['sersic'];
  if (kind === 'bulge') return ['sersic'];
  if (kind === 'dive') return ['disk', 'rot'];
  if (kind === 'edge') return ['disk', 'dust'];
  if (P.armAmp > 0.05) return ['spiral', 'rot'];
  return ['disk', 'sersic'];
}
function paramsFor(kind, P) {
  const out = [];
  if (P.type !== 'elliptical' && P.armAmp > 0.05) out.push({ sym: 'm', name: 'arms', value: String(P.m), cls: 'm2' }, { sym: '\\psi', name: 'pitch', value: P.pitch.toFixed(0) + '°', cls: 'm1' });
  if (P.BT > 0.02) out.push({ sym: 'n', name: 'Sérsic index', value: P.n.toFixed(1), cls: 'm4' }, { sym: 'B/T', name: 'bulge share', value: P.BT.toFixed(2), cls: 'm5' });
  if (P.type !== 'elliptical') out.push({ sym: 'R_d', name: 'disk scale', value: P.Rd.toFixed(1) + ' kpc', cls: 'm3' });
  out.push({ sym: 'v_f', name: 'flat speed', value: Math.round(P.vflat) + ' km/s', cls: 'm6' });
  return out.slice(0, 5);
}
const KIND = { orbit: 'a slow orbit', face: 'face-on, the arms', dive: 'a dive into the disk', bulge: 'a fly-by of the bulge', edge: 'edge-on, the dust lane', pair: 'tidal tails' };

export function installSaver(api) {
  let run = null;
  window.snSaver = {
    enter(opts = {}) {
      const calm = Math.min(1, Math.max(0, opts.calm ?? 0.7));
      const label = typeof opts.label === 'function' ? opts.label : null;
      const plan = makePlan((opts.seed >>> 0) || ((Math.random() * 1e9) >>> 0), calm);
      const saved = { P: api.P, speed: api.st.speed, playing: api.st.playing };
      document.documentElement.classList.add('saving');
      document.getElementById('panel').classList.remove('open');
      api.saving = true; api.fade = 0; api.st.playing = true; api.st.speed = 7 - 3 * calm;
      let shot = null, t0 = 0, ready = false, band = null, bandAt = -1e9, fr = null, alive = true, cx = null;
      function frameBand() {
        const H = innerHeight, now = performance.now();
        if (now - bandAt > 250) { bandAt = now; const b = plateBand(H); if (b || !label) band = b; }
        if (!band) return { cy: H / 2, h: H };
        let t = band.t, b = band.b; const k = (t + b) / (0.68 * H); if (k > 1) { t /= k; b /= k; }
        return { cy: t + (H - t - b) / 2, h: H - t - b };
      }
      async function next() {
        if (!alive) return;
        ready = false; api.fade = 0;
        shot = plan.next();
        const [k, s] = shot.key.split(':');
        const P = s ? M.randomParams(k, +s) : M.presetParams(k);
        if (shot.kind === 'edge') P.incl = shot.incl;
        await api.setParams(P);
        if (!alive) return;
        const c = api.ctx(); cx = c;
        api.snap = true;
        t0 = performance.now(); ready = true;
        send();
      }
      function send() {
        if (!label || !shot) return;
        const P = api.P, t = M.TYPES.find(x => x.key === P.type);
        const keys = texFor(shot.kind, P);
        label({
          title: P.name || (t && t.name), sub: `${t ? t.name + ' · ' + t.hubble : ''} · ${KIND[shot.kind]}`,
          params: paramsFor(shot.kind, P), tex: keys.map(k => TEX[k]), rules: RULES, eq: keys.map(k => EQ[k]),
          anchor: fr ? { x: innerWidth / 2, y: fr.cy, r: fr.h * 0.4 } : undefined,
        });
      }
      api.saverOff = () => { const H = innerHeight; return [0, fr ? 1 - 2 * fr.cy / H : 0]; };
      api.saverCam = dt => {
        const f = frameBand();
        fr = fr ? { cy: fr.cy + (f.cy - fr.cy) * 0.08, h: fr.h + (f.h - fr.h) * 0.08 } : f;
        if (!ready || !shot) return api.cam;
        const el = (performance.now() - t0) / 1000, p = Math.min(1, el / shot.dur);
        api.fade = Math.min(1, el / 0.9, Math.max(0, (shot.dur - el) / 0.7));
        if (el >= shot.dur) { ready = false; next(); return api.cam; }
        const c = Object.assign({}, cx, { fit: fitDistance(cx.R, 40, innerWidth / innerHeight, fr.h / innerHeight) });
        const cam = shotCamera(shot, p, c);
        Object.assign(api.cam, cam, { target: cam.target.slice() });
        return api.cam;
      };
      run = { saved, stop() { alive = false; } };
      next();
      this.debug = () => ({ shot, ready, band, fr, el: shot ? +((performance.now() - t0) / 1000).toFixed(1) : 0 });
      return { canvas: api.canvas, warmupMs: 1500 };
    },
    exit() {
      if (!run) return;
      run.stop();
      document.documentElement.classList.remove('saving');
      api.saving = false; api.saverCam = null; api.saverOff = null; api.fade = 1;
      api.st.speed = run.saved.speed; api.st.playing = run.saved.playing;
      api.setParams(run.saved.P).then(() => api.fitGoal(true));
      run = null;
    },
  };
}
