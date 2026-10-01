// ============================================================================
//  TIMEPIECE RANDOMIZER  ·  palettes.js — colour tables for finishes and cases
// ────────────────────────────────────────────────────────────────────────────
//  FINISH maps a movement finish choice to kit material overrides; METALS,
//  PAINTS, WOODS and LEATHERS give case and strap colours by name.
// ============================================================================

// movement finishes: palette overrides for the kit's material templates
export const FINISH = {
  plate: { rhodium: { plate: { color: '#aab0bb' }, rhodium: { color: '#c4c9d2' } }, gilt: { plate: { color: '#d8b06a' }, rhodium: { color: '#e2bd72' }, giltPlate: { color: '#e2b766' }, giltBridge: { color: '#e6bc6c' } },
    'two-tone': { plate: { color: '#d8b06a' }, rhodium: { color: '#c4c9d2' } }, black: { plate: { color: '#3b3f47' }, rhodium: { color: '#2d3038', roughness: 0.3 }, giltPlate: { color: '#3b3f47' }, giltBridge: { color: '#2d3038' } },
    rose: { plate: { color: '#d9a58a' }, rhodium: { color: '#e3ae92' }, giltPlate: { color: '#d9a58a' }, giltBridge: { color: '#e3ae92' } } },
  wheels: { gilt: { gilt: { color: '#e8be72' } }, rhodium: { gilt: { color: '#d6d9e0' } }, rose: { gilt: { color: '#eaa98a' } }, black: { gilt: { color: '#30333a' } } },
  screws: { blued: { blued: { color: '#2a4fc8' } }, polished: { blued: { color: '#e4e6ec', roughness: 0.1 } }, gold: { blued: { color: '#f0c46a', roughness: 0.15 } } },
  jewels: { ruby: { ruby: { color: '#b3102c', emissive: '#3a0008' } }, sapphire: { ruby: { color: '#1838a8', emissive: '#050a30' } }, clear: { ruby: { color: '#e8eef8', emissive: '#101418' } } },
  balance: { glucydur: { glucydur: { color: '#f2a878' } }, gold: { glucydur: { color: '#f0c46a' } }, steel: { glucydur: { color: '#d6d9e0' } } },
};
export const METALS = {
  'yellow gold': { color: '#f0c66a', roughness: 0.14 }, 'rose gold': { color: '#eaa47e', roughness: 0.14 }, silver: { color: '#e1e4ea', roughness: 0.12 },
  steel: { color: '#cfd3da', roughness: 0.18 }, gunmetal: { color: '#55595f', roughness: 0.22 }, brass: { color: '#d9a95a', roughness: 0.25 }, nickel: { color: '#c9ccd2', roughness: 0.16 },
};
export const PAINTS = { red: '#b02a2a', green: '#2e6b48', cream: '#efe3c4', black: '#1d1e22', blue: '#2a4f8f', mint: '#8fc9b0', orange: '#d86b2a' };
export const WOODS = { walnut: '#6b4428', oak: '#a8794a', mahogany: '#7a3324', ebony: '#2a201c' };
export const LEATHERS = { black: '#1d1c1e', brown: '#5a3a24', tan: '#a8703e', green: '#2f4a36', blue: '#24344f', oxblood: '#5a1a1e' };

