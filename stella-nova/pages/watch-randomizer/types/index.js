// ============================================================================
//  TIMEPIECE RANDOMIZER  ·  types/index.js — every case type the roll can make
// ────────────────────────────────────────────────────────────────────────────
//  A new type adds its spec module here and its builder in cases/index.js.
// ============================================================================
import pocket from './pocket.js';
import wrist from './wrist.js';
import wall from './wall.js';
import alarm from './alarm.js';
import carriage from './carriage.js';
import mantel from './mantel.js';

export const TYPE_LIST = [pocket, wrist, wall, alarm, carriage, mantel];
