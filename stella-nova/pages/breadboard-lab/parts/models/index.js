// ============================================================================
//  BREADBOARD LAB  ·  parts/models/index.js — buildPart: def -> PartHandle
// ----------------------------------------------------------------------------
//  buildPart(THREE, def, part, ctx) picks the builder by def.model.template
//  (CONTRACT 4.3). A def with its own build(THREE, ctx) function wins. An
//  unknown template falls back to a box over the pins, so a broken custom
//  part still shows up and can be picked.
//
//  ctx: { materials: (id) => THREE.Material, quality: 'high'|'low', labels }
//  `part` may be a document Part, a Probe (instruments) or undefined (the
//  library preview); missing params take the def defaults.
//
//  GREP MAP
//    BUILDERS ............... template id -> builder
//    buildPart .............. the entry point
// ============================================================================
import { createKit } from './kit.js';
import * as B from './basic.js';
import * as D from './displays.js';
import * as Q from './bench.js';
import * as M from './mcu.js';
import * as I from './instruments.js';
import * as X from './generic.js';

export const BUILDERS = {
  // built-in
  res: B.buildRes, diode: B.buildDiode, fuse: B.buildFuse, 'cap-ceramic': B.buildCapCeramic,
  'cap-elec': B.buildCapElec, inductor: B.buildInductor, ldr: B.buildLdr, thermistor: B.buildThermistor,
  led: B.buildLed, 'led-rgb': B.buildLedRgb, pot: B.buildPot, trimpot: B.buildTrimpot,
  button: B.buildButton, 'switch-slide': B.buildSlide, buzzer: B.buildBuzzer, relay: B.buildRelay,
  'coin-cell': B.buildCoin, 'usb-breakout': B.buildUsb, 'reg-breakout': B.buildRegBoard,
  seg7: D.buildSeg7, 'seg7-4': D.buildSeg7, lcd: D.buildLcd,
  'bench-supply': Q.buildSupply, funcgen: Q.buildFuncgen, 'battery-9v': Q.buildBattery9v,
  'battery-pack': Q.buildPack, solar: Q.buildSolar, 'shield-18650': Q.buildShield,
  speaker: Q.buildSpeaker, motor: Q.buildMotor, servo: Q.buildServo, lamp: Q.buildLamp,
  joystick: Q.buildJoystick, keypad: Q.buildKeypad, module: Q.buildModule,
  uno: M.buildUno, nano: M.buildNano, esp32: M.buildEsp32,
  dmm: I.buildDmm, scope: I.buildScope, logic: I.buildLogic,
  // data templates (custom parts)
  dip: B.buildDip, to92: B.buildTo92, to220: B.buildTo220,
  axial: X.buildAxial, radial: X.buildRadial, box: X.buildBox, cylinder: X.buildCylinder,
  'header-board': X.buildHeaderBoard, 'sip-module': X.buildSip,
};

export function buildPart(THREE, def, part, ctx = {}) {
  if (typeof def.build === 'function') return def.build(THREE, { ...ctx, def, part });
  const K = createKit(THREE, def, part, ctx);
  const fn = BUILDERS[def.model && def.model.template] || X.buildBox;
  const h = fn(K);
  h.object.userData.defId = def.id;
  if (part && part.id) h.object.userData.partId = part.id;
  return h;
}
