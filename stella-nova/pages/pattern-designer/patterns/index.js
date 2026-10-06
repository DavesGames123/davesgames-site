// ============================================================================
//  PATTERN DESIGNER  ·  patterns/index.js — the pattern book
// ----------------------------------------------------------------------------
//  Joins the family files into one list, PATTERNS, in family order. Each
//  family file exports a default list of entries (see patterns/grid.js
//  for the entry format). FAMILIES gives the order and the display names
//  that the explorer filters use.
//
//  grep -n targets: "export const FAMILIES", "export const PATTERNS", "export function byId"
// ============================================================================
import grid from './grid.js';
import flow from './flow.js';
import radial from './radial.js';
import texture from './texture.js';
import iso from './iso.js';
import distort from './distort.js';
import organic from './organic.js';
import physics from './physics.js';

export const FAMILIES = [
  { id: 'grid', name: 'Grid', text: 'Tiles and modules on a regular cell grid.' },
  { id: 'flow', name: 'Flow', text: 'Lines and bands that follow a vector or scalar field.' },
  { id: 'radial', name: 'Radial', text: 'Rings, rays, roses and spirals about a centre.' },
  { id: 'texture', name: 'Noise', text: 'Stipple, halftone and line textures from tone fields.' },
  { id: 'iso', name: 'Isometric', text: 'Blocks and terrain in a 30 degree projection.' },
  { id: 'distort', name: 'Distortion', text: 'Plain bases bent by lenses, twists and waves.' },
  { id: 'organic', name: 'Organic', text: 'Growth, cells and reaction patterns.' },
  { id: 'physics', name: 'Physics', text: 'Packing, springs, orbits and field lines.' },
];
export const PATTERNS = [grid, flow, radial, texture, iso, distort, organic, physics].flat();
export const byId = id => PATTERNS.find(p => p.id === id) || null;
export default PATTERNS;
