// ============================================================================
//  ROCHE LIMIT  ·  app/legend.js — colour legend
// ----------------------------------------------------------------------------
//  The legend bar and its labels for the grain colour or the force
//  map in use. plasma() matches the fit in shaders/particles.wgsl.
//
//  grep -n targets
//    colour map .... "function plasma"
//    legend ........ "function drawLegend"
// ============================================================================
import { $, UI } from './env.js';

// matplotlib "plasma" (the polynomial fit in shaders/particles.wgsl)
function plasma(t) {
  const C = [[0.05873234392399702, 0.02333670892565664, 0.5433401826748754], [2.176514634195958, 0.2383834171260182, 0.7539604599784036], [-2.689460476458034, -7.455851135738909, 3.110799939717086],
    [6.130348345893603, 42.3461881477227, -28.51885465332158], [-11.10743619062271, -82.66631109428045, 60.13984767418263], [10.02306557647065, 71.41361770095349, -54.07218655560067], [-3.658713842777788, -22.93153465461149, 18.19190778539828]];
  return [0, 1, 2].map(k => { let v = C[6][k]; for (let i = 5; i >= 0; i--) v = C[i][k] + t * v; return Math.round(255 * Math.max(0, Math.min(1, v))); });
}
export function drawLegend() {
  const lg = $('legend');
  const heat = UI.color === 3 || UI.color === 4;
  lg.classList.toggle('off', UI.field === 0 && UI.color !== 2 && !heat);
  const c = $('lgBar'), g = c.getContext('2d'), w = c.width, h = c.height;
  const grad = g.createLinearGradient(0, 0, w, 0);
  if (UI.field === 1) {
    $('lgTitle').textContent = 'Force map: who holds a grain (bright line: the moon’s grip)';
    [[0, '#1a8cd9'], [0.35, '#0f3d5e'], [0.5, '#080a12'], [0.65, '#9b3b2c'], [1, '#ffd173']].forEach(([o, col]) => grad.addColorStop(o, col));
    $('lgLo').textContent = 'the moon'; $('lgMid').textContent = 'L1'; $('lgHi').textContent = 'the planet';
  } else if (UI.field === 2) {
    $('lgTitle').textContent = 'Force map: tide against the moon’s pull (bright line: equal)';
    [[0, '#05051a'], [0.25, '#4d1a8c'], [0.5, '#d94059'], [0.75, '#ff9e26'], [1, '#fff8bf']].forEach(([o, col]) => grad.addColorStop(o, col));
    $('lgLo').textContent = '0.01×'; $('lgMid').textContent = 'equal'; $('lgHi').textContent = '100×';
  } else if (heat) {
    $('lgTitle').textContent = UI.color === 4 ? 'Ice; grains that collide glow by the heat of their collisions' : 'Heat from collisions (energy per kilogram, log scale)';
    for (let i = 0; i <= 10; i++) { const p = plasma(i / 10); grad.addColorStop(i / 10, `rgb(${p[0]},${p[1]},${p[2]})`); }
    $('lgLo').textContent = 'cool'; $('lgMid').textContent = 'warm'; $('lgHi').textContent = 'hot';
  } else {
    $('lgTitle').textContent = 'Tide strain on each grain: tide / the moon’s own pull';
    [[0, '#05051a'], [0.25, '#4d1a8c'], [0.5, '#d94059'], [0.75, '#ff9e26'], [1, '#fff8bf']].forEach(([o, col]) => grad.addColorStop(o, col));
    $('lgLo').textContent = '0.03×'; $('lgMid').textContent = 'equal'; $('lgHi').textContent = '30×';
  }
  g.clearRect(0, 0, w, h); g.fillStyle = grad; g.fillRect(0, 0, w, h);
}
