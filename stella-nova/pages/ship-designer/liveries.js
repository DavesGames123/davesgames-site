// ============================================================================
//  SHIP DESIGNER  ·  liveries.js — the livery presets and the link migration
// ----------------------------------------------------------------------------
//  No DOM. main.js reads window.SDLiveries. tests.mjs reads it with require().
//
//  CURRENT   the livery presets of the game ship designer, in the game order:
//            [name, hull, accent]. These are the colours that a player sees
//            on the preset buttons in the game. When the game liveries
//            change, update this table and the expected names in tests.mjs.
//  LEGACY    the preset table that this page used before 2026-10-18. Its
//            colours were not the game colours. It stays only so that an old
//            shared link still loads (see migrate). Do not show it.
//
//  MIGRATION  A saved design is the URL hash (#hull=..&trim=..&accent=..).
//  An old link has no "v=2". When its hull and accent are equal to a LEGACY
//  preset, migrate() gives the CURRENT preset with the same name, or the
//  CURRENT preset with the nearest colours when the name is gone. A pair that
//  is also a CURRENT preset stays as it is (the old Ember pair is the game
//  Magma). A link with custom colours loads as it is.
//
//  grep -n targets: "var CURRENT", "var LEGACY", "function migrate",
//  "function nearest", "function find"
// ============================================================================
(function (root) {
  'use strict';

  var CURRENT = [
    ['Viper', '#4ac86e', '#ffc832'], ['Crimson', '#c83232', '#ffd700'], ['Cobalt', '#2864c8', '#ffc832'],
    ['Imperial', '#dcd0b4', '#4b0082'], ['Monarch', '#4b0082', '#ffd700'], ['Regal', '#800020', '#ffd700'],
    ['Inferno', '#ff4500', '#ffd700'], ['Ember', '#b22222', '#ff8c00'], ['Magma', '#8b0000', '#ff4500'],
    ['Arctic', '#dceaf0', '#4682b4'], ['Glacier', '#e0f0ff', '#87ceeb'], ['Frost', '#b0d4e8', '#e8f0f8'],
    ['Phantom', '#beb9a8', '#3c3c46'], ['Chrome', '#c0c0c0', '#808080'], ['Stealth', '#2a2a2e', '#1a1a1e'],
    ['Synth', '#ff69b4', '#00ffff'], ['Neon', '#39ff14', '#ff00ff'], ['Plasma', '#8a2be2', '#00ffff'],
    ['Oceanic', '#008b8b', '#00ced1'], ['Polaris', '#4682b4', '#b0c4de'], ['Nebula', '#6464dc', '#c832c8'],
    ['Jade', '#00a86b', '#2e8b57'], ['Venom', '#32cd32', '#006400'], ['Militia', '#6b7353', '#c8b464'],
    ['Coral', '#ff6f61', '#ffc8a0'], ['Sakura', '#ffb7c5', '#ff69b4'], ['Lotus', '#f0c0d0', '#fff0f5'],
    ['Rustic', '#cd853f', '#8b4513'], ['Sandstorm', '#c2b280', '#f5f5dc'], ['Tundra', '#d3d3d3', '#a9a9a9'],
    ['Void', '#1a0a2e', '#483d8b'], ['Wraith', '#303040', '#6a5acd'], ['Obsidian', '#1c1c1c', '#b22222'],
    ['Hazard', '#ffd700', '#222222'], ['Hornet', '#222222', '#ffd700'], ['Scorpion', '#8b7300', '#daa520'],
    ['Blitz', '#0000ff', '#ffff00'], ['Sunset', '#ff6b35', '#ffd700'], ['Aurora', '#00c896', '#ff69b4'],
    ['Osprey', '#696969', '#ffa500'], ['Specter', '#708090', '#c0c0c0']
  ];

  var LEGACY = [
    ['Viper', '#1a6b3a', '#b8901e'], ['Crimson', '#8a1a1a', '#d0d0d8'], ['Phantom', '#181820', '#e04040'],
    ['Imperial', '#e8e0d0', '#c8a030'], ['Nebula', '#3020a0', '#00e8ff'], ['Inferno', '#cc3300', '#ff9900'],
    ['Arctic', '#d0e8f0', '#2080c0'], ['Synth', '#200840', '#ff40ff'], ['Militia', '#3a4a30', '#7a8a60'],
    ['Chrome', '#808890', '#40e0d0'], ['Monarch', '#4a0060', '#ffd700'], ['Stealth', '#1a1a1e', '#333340'],
    ['Coral', '#ff6b6b', '#ffd93d'], ['Oceanic', '#006994', '#40e0d0'], ['Ember', '#8b0000', '#ff4500'],
    ['Frost', '#e8f4f8', '#88ccee'], ['Jade', '#005544', '#50c878'], ['Sunset', '#ff6347', '#ffa500'],
    ['Void', '#0a0a14', '#6600cc'], ['Hazard', '#222222', '#ffcc00'], ['Lotus', '#ff69b4', '#fff0f5'],
    ['Tundra', '#c8d0d0', '#6a8a8a'], ['Scorpion', '#5a3a00', '#cc8800'], ['Wraith', '#2a2a3a', '#8866ff'],
    ['Venom', '#004400', '#88ff00'], ['Sakura', '#ffb7c5', '#880044'], ['Blitz', '#0044aa', '#ffcc00'],
    ['Obsidian', '#101018', '#cc0000'], ['Polaris', '#001133', '#aaeeff'], ['Rustic', '#8b4513', '#daa520'],
    ['Neon', '#0d0d0d', '#39ff14'], ['Regal', '#1a0033', '#c0a0ff'], ['Sandstorm', '#c2b280', '#8b7355'],
    ['Plasma', '#220033', '#ff00ff'], ['Osprey', '#36454f', '#c0c0c0'], ['Aurora', '#004466', '#66ffcc'],
    ['Magma', '#330000', '#ff3300'], ['Glacier', '#f0f8ff', '#4682b4'], ['Hornet', '#111100', '#ffdd00'],
    ['Specter', '#1a1a2e', '#e94560']
  ];

  function rgb(h) { var n = parseInt(String(h).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  // Squared distance of two colours, weighted for the eye (red-mean).
  function dist(a, b) {
    var x = rgb(a), y = rgb(b), rm = (x[0] + y[0]) / 2;
    var dr = x[0] - y[0], dg = x[1] - y[1], db = x[2] - y[2];
    return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
  }
  function find(table, name) {
    for (var i = 0; i < table.length; i++) if (table[i][0] === name) return table[i];
    return null;
  }
  // The CURRENT preset nearest to a hull and accent pair. The hull counts
  // double, because it covers most of the ship.
  function nearest(hull, accent) {
    var best = CURRENT[0], bd = Infinity;
    for (var i = 0; i < CURRENT.length; i++) {
      var d = dist(CURRENT[i][1], hull) * 2 + dist(CURRENT[i][2], accent);
      if (d < bd) { bd = d; best = CURRENT[i]; }
    }
    return best;
  }
  // The CURRENT preset for an old hull and accent pair, or null when the
  // pair is not a LEGACY preset. Result: { from, to, by: 'name' or 'colour' }.
  function migrate(hull, accent) {
    hull = String(hull || '').toLowerCase(); accent = String(accent || '').toLowerCase();
    // A pair that is a game livery now stays (old Ember is the game Magma).
    for (var j = 0; j < CURRENT.length; j++) if (CURRENT[j][1] === hull && CURRENT[j][2] === accent) return null;
    for (var i = 0; i < LEGACY.length; i++) {
      var o = LEGACY[i];
      if (o[1] !== hull || o[2] !== accent) continue;
      var same = find(CURRENT, o[0]);
      return { from: o, to: same || nearest(hull, accent), by: same ? 'name' : 'colour' };
    }
    return null;
  }

  var API = { CURRENT: CURRENT, LEGACY: LEGACY, migrate: migrate, nearest: nearest, find: find };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.SDLiveries = API;
})(this);
