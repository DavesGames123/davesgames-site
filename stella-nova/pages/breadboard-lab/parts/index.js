// ============================================================================
//  BREADBOARD LAB  ·  parts/index.js — the PARTS role's public surface
// ----------------------------------------------------------------------------
//  Other roles import from here (or from the single modules). This file and
//  everything it imports load in node and in a worker: nothing touches THREE,
//  window or document at import time. THREE is always an argument.
//
//  GREP MAP
//    BUILTIN_DEFS ........... every built-in part def, in library order
//    createRegistry ......... a registry with the built-ins loaded
//    LEGACY_MAP ............. old bench def ids -> new def ids
//    re-exports ............. schema, geometry, materials, bands, wire,
//                             buildPart, buildBoard
// ============================================================================
import { createRegistry as makeRegistry } from './registry.js';
import { POWER_DEFS } from './defs/power.js';
import { PASSIVE_DEFS } from './defs/passive.js';
import { SEMIS_DEFS } from './defs/semis.js';
import { ICS_DEFS } from './defs/ics.js';
import { OUTPUT_DEFS } from './defs/output.js';
import { INPUT_DEFS } from './defs/input.js';
import { MCU_DEFS } from './defs/mcu.js';
import { MODULE_DEFS, LEGACY_MAP } from './defs/modules.js';

export const BUILTIN_DEFS = [
  ...POWER_DEFS, ...PASSIVE_DEFS, ...SEMIS_DEFS, ...ICS_DEFS, ...OUTPUT_DEFS,
  ...INPUT_DEFS, ...MCU_DEFS, ...MODULE_DEFS,
];

// createRegistry() -> registry with the built-ins; extra = custom defs to add
export function createRegistry(extra = []) {
  const reg = makeRegistry(BUILTIN_DEFS);
  for (const d of extra) reg.add(d);
  return reg;
}

export { LEGACY_MAP };
export * from './schema.js';
export * from './geometry.js';
export { MATERIAL_PRESETS, PATTERNS, presetById, validateMaterial, makeMaterial, materialResolver, materialHash } from './materials.js';
export { resistorBands, BAND_HEX, BAND_NAMES, E12, E24, snapE, formatOhms } from './bands.js';
export { wirePath, buildWire, archHeight, polylineLength, samplePolyline, gaugeRadius } from './wire.js';
export { buildPart } from './models/index.js';
export { buildBoard } from './boards.js';
