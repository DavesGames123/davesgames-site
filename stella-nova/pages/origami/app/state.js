// app/state.js -- the session state and the constants every part of the page reads.
//
// S holds the pattern, the planarized pattern, the fold mesh, the views and the
// flags. Other modules change its fields in place. gpu is the device from
// gpu.js, or null before boot and when WebGPU fails. An ES module import is
// read-only, so boot sets gpu through setGpu.
//
// grep map:
//   PHONE_Q / COARSE / th / $  -- the media queries, the site palette, the id lookup
//   TOOLS / TOOL_KEYS / SPEEDS -- the five tools, their keys, the auto-play speeds
//   const S                    -- all state: pattern, planar, mesh, fold, views, flags
//   let gpu / setGpu           -- the GPU device, set once by boot
//   load / save                -- localStorage, with try/catch
//   isPhone                    -- the phone layout query

import { Assignment } from '../model.js';
import * as patterns from '../patterns.js';
import { Orbit } from '../view.js';
import * as theme from '../theme.js';

export const PHONE_Q = '(max-width:768px), (max-height:500px) and (pointer:coarse)';
export const COARSE = matchMedia('(pointer:coarse)').matches;
export const th = theme.site();
export const $ = (id) => document.getElementById(id);

// The five tools (app.rs Tool), with the crease kind each one draws.
export const TOOLS = {
  mountain: { kind: Assignment.Mountain, color: th.mountain, label: 'MOUNTAIN' },
  valley: { kind: Assignment.Valley, color: th.valley, label: 'VALLEY' },
  border: { kind: Assignment.Border, color: th.border, label: 'BORDER' },
  aux: { kind: Assignment.Flat, color: th.aux, label: 'AUX' },
  erase: { kind: null, color: th.textDim, label: 'ERASE' },
};
export const TOOL_KEYS = { m: 'mountain', v: 'valley', b: 'border', a: 'aux', e: 'erase' };
// The auto-play speeds, in fold fraction per second (app.rs CycleSpeed).
export const SPEEDS = [0.15, 0.3, 0.6, 1.1];

export const S = {
  tool: 'valley',
  // The first pattern: the traditional crane (a file preset, fetched at boot).
  preset: patterns.Preset.Crane,
  pattern: null, planar: null, mesh: null, report: [],
  fraction: 0, auto: true, autoDir: 1, foldSpeed: 0.3,
  orbit: new Orbit(), pan3d: [0, 0],
  zoom2d: 1, pan2d: [0, 0],
  gridN: 8, showGrid: true,
  cursor: null,          // pointer in CSS px, relative to the canvas
  drawing: null,         // the snapped world start of a crease drag
  hoveredFace: null,     // planar face index
  hoveredCrease: null,   // pattern crease index
  hoveredEdges: null,    // planar edge indices on the hovered crease
  hoveredVertex: null,   // a foldability report
  undo: [], redo: [],
  libraryOpen: false, panelOpen: false,
  layoutMode: 'auto', ui: 1,
  frozen: false,         // the test hook stops the sim with this
  dragFraction: false,
  veil: 0,               // 0..1: the screensaver fade to the canvas colour
};

export let gpu = null;
export function setGpu(g) { gpu = g; }

// ── persistence (try/catch: storage can be blocked) ─────────────────────────
export function load(key, dflt) { try { const v = localStorage.getItem(key); return v === null ? dflt : v; } catch { return dflt; } }
export function save(key, v) { try { localStorage.setItem(key, String(v)); } catch { /* storage blocked */ } }

export function isPhone() { return matchMedia(PHONE_Q).matches; }
