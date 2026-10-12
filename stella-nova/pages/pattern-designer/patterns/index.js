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
import tiling from './tiling.js';
import textile from './textile.js';
import geometric from './geometric.js';
import opart from './opart.js';

export const FAMILIES = [
  { id: 'grid', name: 'Grid', text: 'Tiles and modules on a regular cell grid.' },
  { id: 'flow', name: 'Flow', text: 'Lines and bands that follow a vector or scalar field.' },
  { id: 'radial', name: 'Radial', text: 'Rings, rays, roses and spirals about a centre.' },
  { id: 'texture', name: 'Noise', text: 'Stipple, halftone and line textures from tone fields.' },
  { id: 'iso', name: 'Isometric', text: 'Blocks and terrain in a 30 degree projection.' },
  { id: 'distort', name: 'Distortion', text: 'Plain bases bent by lenses, twists and waves.' },
  { id: 'organic', name: 'Organic', text: 'Growth, cells and reaction patterns.' },
  { id: 'physics', name: 'Physics', text: 'Packing, springs, orbits and field lines.' },
  { id: 'geometric', name: 'Geometric', text: 'Guilloche, gear curves, Lissajous tables, superformula, pursuit polygons and circle packing.' },
  { id: 'opart', name: 'Op art', text: 'Moire line fields, drifting tunnels, waving bands and turning squares.' },
  { id: 'textile', name: 'Textile', text: 'Plaid setts, dyed bands and rings, twill checks, chevrons and diamonds.' },
  { id: 'tiling', name: 'Tilings', text: 'Rhombs, Truchet tiles, matched edges, star rosettes, pentagons and bricks.' },
];
export const PATTERNS = [grid, flow, radial, texture, iso, distort, organic, physics, tiling, textile, geometric, opart].flat();
export const byId = id => PATTERNS.find(p => p.id === id) || null;
export default PATTERNS;
