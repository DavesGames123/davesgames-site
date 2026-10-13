// ============================================================================
//  BREADBOARD LAB  ·  parts/models/mcu.js — the three microcontroller boards
// ----------------------------------------------------------------------------
//  Generic boards: no logos, no trademark names, plain silkscreen pin names
//  (the silkscreen is a canvas label, so node builds them without text).
//
//  The on-board LEDs glow from vis.leds: L and ON on the 328 boards, LED and
//  ON on the ESP32 devkit (CONTRACT 3.5 element vis ids).
//
//  GREP MAP
//    smdLed ................. a tiny glowing LED
//    buildUno ............... free board, female headers, USB-B, barrel jack, DIP-28
//    buildNano .............. DIP-30 board on male pins, QFP chip, mini USB
//    buildEsp32 ............. 2 x 15 board, shielded module, micro USB, buttons
// ============================================================================
import { G } from '../schema.js';
import { LED_GLOW } from './basic.js';

function smdLed(K, x, y, z, color) {
  const m = K.mesh(K.box(1.6, 0.6, 0.9), '@abs-white', { x, y: y + 0.3, z }, { pick: false });
  return K.glow(m, color, 7, [x, y + 1.2, z]);
}
function ledsFrom(K, map) {
  K.onState(f => {
    const L = (f && f.vis && f.vis.leds) || {};
    for (const k in map) K.setGlow(map[k], L[k] || 0);
  });
}

// mm from the Uno-layout inch coordinates (origin at D0)
const U = (xin, yin) => ({ x: (xin - 2.6) * 25.4, z: -(yin - 2.0) * 25.4 });

export function buildUno(K) {
  const pcbY = 0.4, top = pcbY + 1.6;
  const c = U(1.35, 1.05);
  K.put(K.rbox(68.6, 1.6, 53.3, 2.5), 'pcb', { x: c.x, y: pcbY, z: c.z });
  // female headers: a body per header group, with socket holes
  const groups = [['D0', 'D7'], ['D8', 'AREF'], ['IOREF', 'VIN'], ['A0', 'A5']];
  const pin = n => K.pinsMm.find(p => p.name === n);
  for (const [a, b] of groups) {
    const pa = pin(a), pb = pin(b);
    K.put(K.box(Math.abs(pb.x - pa.x) + G, 8, 2.5), 'body', { x: (pa.x + pb.x) / 2, y: top + 4, z: pa.z });
  }
  for (const p of K.pinsMm) K.put(K.box(0.9, 0.1, 0.9), '@board-hole', { x: p.x, y: p.y + 0.05, z: p.z });
  // USB-B and the barrel jack on the left edge
  const usb = U(0.0, 1.5), jack = U(0.0, 0.45);
  K.put(K.box(16, 11, 12), 'metal', { x: usb.x + 2, y: top + 5.5, z: usb.z });
  K.put(K.box(14, 11, 9), '@abs-black', { x: jack.x + 1, y: top + 5.5, z: jack.z });
  // the DIP-28 chip in a socket
  const chip = U(1.95, 0.72);
  K.put(K.box(36, 1.4, 9), '@abs-black', { x: chip.x, y: top + 0.7, z: chip.z });
  K.put(K.rbox(35, 3.4, 7.4, 0.4, 2), 'chip', { x: chip.x, y: top + 1.4, z: chip.z });
  for (let i = 0; i < 14; i++) for (const s of [-1, 1]) K.put(K.box(0.5, 2.6, 0.3), '@tin', { x: chip.x - 16.5 + i * G, y: top + 1.6, z: chip.z + s * 3.9 });
  // crystal, regulator, caps, reset button
  const xt = U(1.1, 0.95);
  K.put(K.rbox(11, 3.5, 4.6, 2.2), '@chrome', { x: xt.x, y: top, z: xt.z });
  const rg = U(0.4, 0.2);
  K.put(K.box(6.5, 1.8, 3.5), '@epoxy-black', { x: rg.x, y: top + 0.9, z: rg.z });
  for (const [xi, yi] of [[0.55, 0.85], [0.75, 0.85]]) { const p = U(xi, yi); K.put(K.cyl(3, 3, 6, 16), '@sleeve-black', { x: p.x, y: top + 3, z: p.z }); }
  const rs = U(0.35, 1.95);
  K.put(K.box(6, 3.4, 6), '@chrome', { x: rs.x, y: top + 1.7, z: rs.z });
  const rsb = K.mesh(K.cyl(1.6, 1.6, 1.2, 12), '@abs-red', { x: rs.x, y: top + 4, z: rs.z });
  // the USB-serial chip
  const us = U(0.8, 1.45);
  K.put(K.box(5, 1, 5), '@epoxy-black', { x: us.x, y: top + 0.5, z: us.z, ry: Math.PI / 4 });
  const lp = U(1.15, 1.6), onp = U(2.35, 1.4);
  const leds = { L: smdLed(K, lp.x, top, lp.z, LED_GLOW.yellow), ON: smdLed(K, onp.x, top, onp.z, LED_GLOW.green) };
  smdLed(K, lp.x, top, lp.z + 3, LED_GLOW.yellow); smdLed(K, lp.x, top, lp.z + 5.5, LED_GLOW.yellow);   // TX, RX (dark)
  ledsFrom(K, leds);
  // silkscreen pin names (browser only)
  const d0 = pin('D0'), d13 = pin('D13'), v = pin('VIN'), a5 = pin('A5');
  K.label('~ DIGITAL (PWM ~) 13 12 11 10 9 8   7 6 5 4 3 2 1 0', d0.x - d13.x + 20, 3, { x: (d0.x + d13.x) / 2, y: top + 0.02, z: d0.z + 4.2 }, { color: '#f4f4f0', font: 'mono' });
  K.label('IOREF RESET 3V3 5V GND GND VIN    A0 A1 A2 A3 A4 A5', a5.x - pin('IOREF').x + 10, 3, { x: (a5.x + pin('IOREF').x) / 2, y: top + 0.02, z: v.z - 4.2 }, { color: '#f4f4f0', font: 'mono' });
  K.label(['328 DEV BOARD', '5V  16 MHZ'], 26, 8, { x: c.x + 8, y: top + 0.02, z: c.z - 6 }, { color: '#f4f4f0', weight: 700 });
  return K.finish({ leds, reset: rsb });
}

export function buildNano(K) {
  const pcbY = 2.5, top = pcbY + 1.6;
  for (const p of K.pinsMm) K.leg(p.x, p.z, top + 1.2, 'legs', 0.6);
  for (const z of [0, -6 * G]) K.put(K.box(15 * G, 2.5, 2.5), '@abs-black', { x: 7 * G, y: 1.25, z });
  const cx = 7 * G, cz = -3 * G;
  K.put(K.rbox(43.2, 1.6, 18, 1), 'pcb', { x: cx, y: pcbY, z: cz });
  K.put(K.box(7.5, 7.5, 1.2).rotateX(Math.PI / 2), 'chip', { x: cx - 2, y: top + 0.6, z: cz, ry: Math.PI / 4 });
  K.put(K.box(9, 4, 7.6), 'metal', { x: 14 * G + 3.5, y: top + 2, z: cz });        // mini USB at the D13 end
  K.put(K.box(3.4, 0.8, 1.6), '@chrome', { x: cx + 6, y: top + 0.4, z: cz - 4 });     // crystal
  K.put(K.box(4, 1.8, 4), '@chrome', { x: cx + 8, y: top + 0.9, z: cz });
  K.mesh(K.cyl(1, 1, 1, 10), '@abs-white', { x: cx + 8, y: top + 2.2, z: cz });
  const leds = { L: smdLed(K, cx + 11, top, cz - 4, LED_GLOW.yellow), ON: smdLed(K, cx + 11, top, cz + 4, LED_GLOW.green) };
  ledsFrom(K, leds);
  K.label('D1 D0 RST GND D2 D3 D4 D5 D6 D7 D8 D9 D10 D11 D12', 15 * G, 1.8, { x: 7 * G, y: top + 0.02, z: -1.6 }, { color: '#f4f4f0', font: 'mono' });
  K.label('VIN GND RST 5V A7 A6 A5 A4 A3 A2 A1 A0 REF 3V3 D13', 15 * G, 1.8, { x: 7 * G, y: top + 0.02, z: -6 * G + 1.6 }, { color: '#f4f4f0', font: 'mono' });
  return K.finish({ leds });
}

export function buildEsp32(K) {
  const pcbY = 2.5, top = pcbY + 1.6;
  for (const p of K.pinsMm) K.leg(p.x, p.z, top + 1.2, 'legs', 0.6);
  for (const z of [0, 9 * G]) K.put(K.box(15 * G, 2.5, 2.5), '@abs-black', { x: 7 * G, y: 1.25, z });
  const x0 = -2.5 * G, x1 = 15.5 * G, cx = (x0 + x1) / 2, cz = 4.5 * G;
  K.put(K.rbox(x1 - x0, 1.6, 28, 1), 'pcb', { x: cx, y: pcbY, z: cz });
  // the radio module: its board, the shield can and the antenna
  const mx = x0 + 13;
  K.put(K.box(25.5, 0.8, 18), 'module', { x: mx, y: top + 0.4, z: cz });
  K.put(K.box(17.5, 2.6, 16), 'can', { x: mx + 3.5, y: top + 0.8 + 1.3, z: cz });
  for (let i = 0; i < 4; i++) K.put(K.box(0.5, 0.06, 12 - i * 2), '@gold-pin', { x: x0 + 1.5 + i * 1.2, y: top + 0.83, z: cz });
  // micro USB at the far end, the regulator, the USB chip, two buttons
  K.put(K.box(6, 2.6, 7.6), 'metal', { x: x1 - 2, y: top + 1.3, z: cz });
  K.put(K.box(6.5, 1.8, 3.5), '@epoxy-black', { x: x1 - 14, y: top + 0.9, z: cz - 7 });
  K.put(K.box(5, 1, 5), '@epoxy-black', { x: x1 - 14, y: top + 0.5, z: cz + 4 });
  const btn = [];
  for (const [bx, bz] of [[x1 - 6, cz - 9], [x1 - 6, cz + 9]]) {
    K.put(K.box(4, 1.6, 3), '@chrome', { x: bx, y: top + 0.8, z: bz });
    btn.push(K.mesh(K.box(1.6, 0.8, 1.2), '@abs-black', { x: bx, y: top + 2, z: bz }));
  }
  const leds = { LED: smdLed(K, x1 - 22, top, cz + 8, LED_GLOW.blue), ON: smdLed(K, x1 - 22, top, cz - 8, LED_GLOW.red) };
  ledsFrom(K, leds);
  K.label('EN VP VN 34 35 32 33 25 26 27 14 12 13 GND VIN', 15 * G, 1.8, { x: 7 * G, y: top + 0.02, z: 1.7 }, { color: '#f4f4f0', font: 'mono' });
  K.label('23 22 TX RX 21 19 18 5 17 16 4 2 15 GND 3V3', 15 * G, 1.8, { x: 7 * G, y: top + 0.02, z: 9 * G - 1.7 }, { color: '#f4f4f0', font: 'mono' });
  K.label(['WIFI DEVKIT', '30 PIN  3V3'], 14, 6, { x: x1 - 24, y: top + 0.02, z: cz }, { color: '#f4f4f0', weight: 700 });
  return K.finish({ leds, buttons: btn });
}
