// ============================================================================
//  BREADBOARD LAB  ·  parts/models/displays.js — 7-segment and character LCD
// ----------------------------------------------------------------------------
//  The digits and the LCD dots are instanced meshes from models/segments.js,
//  so they light in node tests and in the page alike, with no canvas.
//
//  FRAME TO DIGITS. seg7-1 reads vis.leds { a..g, dp }; seg7-4 reads
//  vis.leds { d1a .. d4dp }. Brightness 1 = rated current; above 1 glows
//  hotter. The LCD reads vis.rows, vis.cursor and the backlight (vis.leds.bl
//  or vis.backlight).
//
//  GREP MAP
//    SEG_ON ................. lit colour per display colour param
//    buildSeg7 .............. one or four digits on a black body
//    buildLcd ............... 1602 module: PCB, bezel, glass, 16 x 2 dots
// ============================================================================
import { G } from '../schema.js';
import { segDisplay, dotMatrix, SEG_NAMES } from './segments.js';
import { EMIT } from '../../core/light.js';

export const SEG_ON = { red: '#ff2a1a', green: '#3aff5a', blue: '#4a8aff', yellow: '#ffd21a', white: '#f2f4ff', orange: '#ff7a1a' };

export function buildSeg7(K) {
  const four = (K.def.model.digits || 1) > 1;
  const ps = K.pinsMm;
  const xs = ps.map(p => p.x), zs = ps.map(p => p.z);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const W = four ? 30 : 12.6, D = four ? 14 : 19, H = four ? 7.5 : 8;
  pinLegsUnder(K, 0.8);
  K.put(K.box(W, H - 0.4, D), 'body', { x: cx, y: 0.6 + (H - 0.4) / 2, z: cz });
  K.put(K.box(W - 0.6, 0.4, D - 0.6), 'face', { x: cx, y: 0.6 + H - 0.2, z: cz });
  const n = four ? 4 : 1;
  const dh = four ? 9.2 : 13.5;
  const disp = segDisplay(K.THREE, { digits: n, h: dh, w: dh * 0.55, gap: four ? 2.6 : 0, on: SEG_ON[K.params.color] || SEG_ON.red, off: '#241614', y: 0.6 + H + 0.06 });
  disp.mesh.position.set(cx - disp.width / 2 - (four ? 0 : 0.6), 0, cz);
  K.group.add(disp.mesh);
  K.own(disp.mesh.geometry); K.own(disp.mesh.material);
  K.onParams(p => disp.setColor(SEG_ON[p.color] || SEG_ON.red));
  K.onState(f => {
    const L = (f && f.vis && f.vis.leds) || {};
    for (let d = 0; d < n; d++) {
      const pre = four ? 'd' + (d + 1) : '';
      disp.setDigit(d, SEG_NAMES.map(s => K.damaged ? 0 : (L[pre + s] || 0)));
    }
  });
  return K.finish({ display: disp });
}

// legs straight down under a body at height y
function pinLegsUnder(K, y) {
  for (const p of K.pinsMm) K.leg(p.x, p.z, y, 'legs', 0.5);
}

export function buildLcd(K) {
  const { THREE } = K;
  const x0 = -8, w = 80, d = 36, pcbY = 9;
  const cx = x0 + w / 2, cz = 2.5 - d / 2;
  for (const p of K.pinsMm) K.leg(p.x, p.z, pcbY + 1.6 + 0.8, 'legs', 0.6);
  K.put(K.box(16 * G, 2.5, 2.5), '@abs-black', { x: 7.5 * G, y: pcbY - 1.25 });
  K.put(K.rbox(w, 1.6, d, 1.2), 'pcb', { x: cx, y: pcbY, z: cz });
  for (const [hx, hz] of [[x0 + 2.5, 2.5 - 2.5], [x0 + w - 2.5, 0], [x0 + 2.5, 2.5 - d + 2.5], [x0 + w - 2.5, 2.5 - d + 2.5]]) {
    K.put(K.cyl(1.4, 1.4, 1.7, 12), '@board-hole', { x: hx, y: pcbY + 0.8, z: hz });
  }
  const by = pcbY + 1.6, bh = 7;
  K.put(K.box(71, bh, 24), 'body', { x: cx, y: by + bh / 2, z: cz - 1 });
  const blue = K.params.screen === 'blue';
  K.mat('screen', blue ? 'lcd-blue' : 'lcd-green');
  const glass = K.mesh(K.box(64.5, 0.4, 16), 'screen', { x: cx, y: by + bh + 0.2, z: cz - 1 });
  const gl = K.glow(glass, blue ? '#3a6aff' : '#b8e04a', 0, null, { peak: EMIT.lcd });
  const dots = dotMatrix(THREE, {
    cols: 16, rows: 2, pitch: 0.6, cellGap: 0.35, rowGap: 0.75, y: by + bh + 0.42,
    ink: blue ? '#eef4ff' : '#1a2a0c', blank: blue ? '#2448c8' : '#9cbc34',
  });
  dots.mesh.position.set(cx - dots.width / 2, 0, cz - 1 - dots.height / 2);
  K.group.add(dots.mesh);
  K.own(dots.mesh.geometry); K.own(dots.mesh.material);
  dots.setLight(0.15);
  K.onState(f => {
    const v = (f && f.vis) || {};
    const bl = v.backlight ?? (v.leds && v.leds.bl) ?? 0;
    K.setGlow(gl, Math.min(1, bl));
    dots.setLight(0.15 + 0.85 * Math.min(1, bl || 0));
    if (K.damaged) { dots.setRows(['', '']); return; }
    dots.setRows(v.rows || ['', ''], v.cursor);
  });
  return K.finish({ lcd: dots });
}
