// ============================================================================
//  PLANT GROWTH  ·  how each species looks (DOM-free)
// ----------------------------------------------------------------------------
//  grow.js says how a species grows. This file says how it looks: the atlas
//  cells of its leaves and flowers, how a leaf sits on its twig, its leaf
//  and autumn colours, and its bark. pose.js turns it into the tables of the
//  shaders (uniform arrays indexed by the species index of grow.js).
//
//  leafMode:  0 blade (the blade turns up to the light), 1 spray (a spruce
//             spray lies along the twig), 2 pinna (a fern pinna stands out
//             to the side of the rachis), 3 hanging (a willow leaf hangs).
//  droop:     how far a leaf blade bends down.
//  tint:      a multiplier on the scanned colour (linear).
//  autumn:    three colours; each leaf picks a mix by its random number.
//  bark:      the bark texture (assets/bark-<id>-color.jpg and -normal.jpg),
//             tile: the height of one tile in metres. twig: the colour of
//             young shoots (they turn to bark as they thicken).
// ============================================================================
import { SPECIES_IDS } from './grow.js';

export const LOOK = {
  oak: {
    leaf: 'oak', flower: null, coty: 'cotyledon', leafMode: 0, droop: 0.15, tilt: 1,
    tint: [1, 1, 1], autumn: ['#9a5a1c', '#b8782a', '#6e4a20'], litter: '#6a4a2c',
    bark: 'oak', tile: 0.7, barkTint: [1, 1, 1], twig: '#7a6248',
  },
  maple: {
    leaf: 'maple', flower: null, coty: 'cotyledon', leafMode: 0, droop: 0.12, tilt: 1,
    tint: [1, 1, 1], autumn: ['#d8361a', '#f08a1c', '#f2c230'], litter: '#8a4a26',
    bark: 'maple', tile: 0.6, barkTint: [1, 1, 1], twig: '#8a6a4a',
  },
  birch: {
    leaf: 'birch', flower: null, coty: 'cotyledon', leafMode: 3, droop: 0.35, tilt: 0.8,
    tint: [1, 1, 1], autumn: ['#e8b818', '#f2d040', '#c89a20'], litter: '#9a7a3a',
    bark: 'birch', tile: 0.8, barkTint: [1, 1, 1], twig: '#6a4636',
  },
  conifer: {
    leaf: 'spruce', flower: null, coty: 'cotyledonNeedle', leafMode: 1, droop: 0.25, tilt: 1,
    tint: [0.95, 1, 0.95], autumn: ['#6a5a30', '#7a6a38', '#5a4a28'], litter: '#6a5434',
    bark: 'spruce', tile: 0.6, barkTint: [1, 1, 1], twig: '#8a6a40',
  },
  willow: {
    leaf: 'willow', flower: null, coty: 'cotyledon', leafMode: 3, droop: 0.7, tilt: 0.55,
    tint: [1, 1, 1], autumn: ['#d8c030', '#c8b028', '#a89a30'], litter: '#8a7a3a',
    bark: 'willow', tile: 0.8, barkTint: [1, 1, 1], twig: '#a8983a',
  },
  cherry: {
    leaf: 'cherry', flower: 'blossom', coty: 'cotyledon', leafMode: 0, droop: 0.2, tilt: 1,
    tint: [1, 1, 1], autumn: ['#c8301c', '#e86a1e', '#a82820'], litter: '#7a3a22',
    bark: 'cherry', tile: 0.5, barkTint: [1, 1, 1], twig: '#6a3a30',
  },
  bush: {
    leaf: 'azalea', flower: 'azaleaFlower', coty: 'cotyledon', leafMode: 0, droop: 0.1, tilt: 1,
    tint: [1, 1, 1], autumn: ['#a8202a', '#c84a20', '#7a1a28'], litter: '#5a3022',
    bark: 'bush', tile: 0.35, barkTint: [1, 1, 1], twig: '#6a5038',
  },
  fern: {
    leaf: 'fern', flower: null, coty: 'cotyledon', leafMode: 2, droop: 0.05, tilt: 1,
    tint: [1, 1, 1], autumn: ['#a8822a', '#8a6a28', '#c8a040'], litter: '#6a5030',
    bark: 'fern', tile: 0.4, barkTint: [1, 1, 1], twig: '#6f8a35',
  },
};

// The bark textures, in the layer order of the texture array.
export const BARKS = ['oak', 'maple', 'birch', 'spruce', 'willow', 'cherry', 'bush', 'fern'];

export function lookOf(id) { return LOOK[id] || LOOK.oak; }
export const LOOK_IDS = SPECIES_IDS;

// '#rrggbb' -> [r, g, b] in 0..1 (sRGB)
export function hex3(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}
