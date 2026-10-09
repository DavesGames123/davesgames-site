// ct-lab/colormaps/maps.js -- colour map catalogue for the CT pages.
//
// Each map is a 256-entry RGB lookup table (LUT). The module builds each
// LUT from control points when a caller first asks for that map. Sourced
// maps keep 33 even stops taken from their reference tables; CREDITS.md
// names each source and its licence. Our own maps interpolate in OKLab.
//
// grep -n targets:
//   SOURCED          33-stop tables from matplotlib, seaborn, Crameri
//   const DEFS       the catalogue: id, name, group, kind, use, stops
//   function buildLut
//   export function get / list / sample / apply / variant
//   export function cssGradient / toCanvasGradient
//   export function lutTexture / lutAtlasTexture
//   export const WGSL    sampling functions for page shaders
//   export function cieL  CIE L* of an sRGB byte triple (tests use it)

// Sourced maps: 33 even samples, sRGB hex. See CREDITS.md.
const SOURCED = {
  viridis: '440154 470d60 48186a 482374 472d7b 453781 424086 3e4989 3b528b 375b8d 33638d 2f6b8e 2c728e 297a8e 26828e 23898e 21918c 1f988b 1fa088 22a785 28ae80 32b67a 3fbc73 4ec36b 5ec962 70cf57 84d44b 98d83e addc30 c2df23 d8e219 ece51b fde725',
  magma: '000004 030312 0a0822 130d34 1d1147 29115a 36106b 440f76 51127c 5d177f 6a1c81 762181 832681 902a81 9c2e7f aa337d b73779 c43c75 d0416f dc4869 e75263 ef5d5e f56b5c f9795d fc8961 fd9869 fea772 feb67c fec488 fed395 fde2a3 fcf0b2 fcfdbf',
  inferno: '000004 040312 0b0724 150b37 210c4a 2f0a5b 3d0965 4a0c6b 57106e 64156e 71196e 7d1e6d 8a226a 972766 a32c61 b0315b bc3754 c73e4c d24644 db503b e45a31 eb6628 f1731d f68013 f98e09 fb9d07 fcac11 fbbc21 f9cb35 f5db4c f2ea69 f3f68a fcffa4',
  plasma: '0d0887 220690 310597 3f049c 4c02a1 5901a5 6600a7 7201a8 7e03a8 8a09a5 9511a1 a01a9c aa2395 b32c8e bc3587 c43e7f cc4778 d35171 da5a6a e06363 e66c5c eb7655 f0804e f58b47 f89540 fba139 fdac33 feb82c fdc527 fcd225 f8df25 f4ed27 f0f921',
  cividis: '00224e 00285b 002e6a 053371 1a386f 273e6e 32436d 3b496c 434e6c 4b546c 535a6d 5a5f6e 61656f 686a71 6f7073 767676 7d7c78 848279 8c8878 938e78 9b9476 a39a74 aba072 b4a76f bcae6c c4b468 cdbb63 d5c25e dec958 e7d150 f0d846 f9e03a fee838',
  turbo: '30123b 392a73 4040a2 4456c7 466be3 4680f6 4294ff 37a8fa 28bceb 1ccdd8 18ddc2 1fe9af 32f298 4ef97d 6dfe62 8bff4b a4fc3c b9f635 cdec34 dfdf37 eecf3a f8be39 fdac34 fe962b fb7e21 f46617 eb500e df3f08 d02f05 be2102 a91601 920b01 7a0403',
  twilight: 'e2d9e2 d7d7dd c4ced4 acc2cc 95b5c7 81a6c3 7297c1 6887be 6276ba 5f64b5 5e51ad 5d3da1 592a8f 511b77 45135c 381145 2f1436 3a113a 4a1342 5f174a 741e4f 872750 983550 a64550 b25652 bb6958 c27c63 c89073 cca389 d1b6a3 d8c7be dfd4d6 e2d9e2',
  coolwarm: '3b4cc0 445acc 4e68d8 5875e1 6282ea 6c8ff1 779af7 82a6fb 8db0fe 98b9ff a3c2fe aec9fc b9d0f9 c3d5f4 ccd9ed d5dbe5 dddcdc e5d8d1 ecd3c5 f1ccb8 f5c4ac f7ba9f f7b093 f6a586 f4987a f08b6e eb7d62 e46e56 dd5f4b d44e41 ca3b37 be242e b40426',
  rdbu: '053061 0e4179 175290 1f63a8 2a71b2 3480b9 3f8ec0 529dc8 6bacd1 84bcd9 9bc9e0 aed3e6 c2ddec d4e6f1 e0ecf3 ecf2f5 f7f6f6 f9eee7 fbe5d8 fddcc9 fbccb4 f8bb9e f5aa89 ee9677 e48066 db6b55 d05548 c53e3d ba2832 ab162a 930e26 7c0722 67001f',
  piyg: '8e0152 9f095f b1116d c2197a cb3289 d34f99 db6ca8 e283b7 e897c4 eeabd2 f3bcdd f6c9e3 fad6ea fde2f0 fbe9f2 f9f0f5 f7f7f6 f1f6ea ecf6de e7f5d2 d9f0bc cbe9a4 bde38d acd977 9acd61 88c24c 77b53c 67a832 589b28 498d20 3d7f1e 31711b 276419',
  brbg: '543005 663a07 774508 894f0a 995d13 a96c1e b97b29 c58e3d cfa256 d9b76f e2c787 e9d39d f1dfb3 f6e9c7 f6edd7 f5f1e6 f4f5f5 e6f1f0 d7eeeb c9eae6 b4e2db 9dd9d0 87d0c5 70c1b6 58b0a7 419f97 2d8f87 1d8078 0c7169 016259 01554b 00483d 003c30',
  berlin: '9eb0ff 8caef6 79abed 65a7e2 519fd3 4194c1 3685ad 2e7699 286886 225973 1d4b61 183d4f 14303e 11242e 111a20 121214 190c09 220c02 2b0e01 351000 411201 4d1602 5b1d08 6c2711 7d341e 8e422e 9e513f ae6051 be6f63 ce7f76 df8f89 f09f9c ffadad',
  vanimo: 'ffcdfd f3b6ec e6a0dc da8bcc cd78bd c067ae b2589f a34b90 923e80 7e336e 692a5b 542148 401b37 2f1728 24141e 1d1417 1a1513 1a1911 1c2011 222a13 2a3716 334619 3d551d 486322 527227 5c802c 678e32 729d3b 7fae47 8ec158 9ed56e afea8a befda5',
  managua: 'ffcf67 f5bf62 ebb05d e1a158 d89353 ce864f c5794a bb6d46 b16243 a6573f 9a4c3d 8e423a 813939 743139 692b3c 5f2941 572949 512d54 4e3362 4c3c71 4c4781 4d5290 505e9d 546aaa 5877b5 5c83bf 6190c8 669ed2 6bacdb 71bae4 76c9ed 7cd9f7 81e7ff',
  cubehelix: '000000 0c050e 150b1d 19132d 1b1e3b 192a46 17374d 15464e 16534c 1a6046 236a3e 317236 447731 5a7a2f 727b32 8a7a3b a1794a b5795e c57a76 cf7e8f d484a9 d48dc1 d198d4 cca6e4 c6b4ee c2c3f2 c1d1f3 c4ddf2 cbe8f0 d6f0ef e3f6f0 f2fbf6 ffffff',
  mako: '0b0405 140910 1c101c 241628 2b1c35 312142 37284f 3b2e5d 3e356b 403c79 414387 3f4c92 3b5698 385f9c 36699f 3572a1 357ba3 3484a5 348da7 3496a9 359fab 37a8ac 3cb1ad 42b9ad 4bc2ad 57cbad 6ad2ad 82d8b0 99ddb6 aee3c0 c0e9cc d0efd9 def5e5',
  rocket: '03051a 0d0a21 180f29 241432 30173a 3c1a42 481c48 541e4e 611f53 6e1f57 7b1f59 891e5b 971c5b a4195b b21758 bf1654 cb1b4f d62449 df2f44 e73d3f ec4c3e f05c42 f26b49 f47a54 f58860 f5966c f6a37a f6b089 f6bc99 f7c9aa f8d4bc f9e0cd faebdd',
  bone: '000000 07070a 0e0e13 15151d 1c1c27 232331 2a2a3a 313144 38384e 3f3f58 464661 4d4d6b 545574 5b5f7b 626882 697289 707b90 778597 7e8f9e 8598a5 8ca2ac 93acb3 9ab5ba a1bfc1 a9c8c8 b4cfcf bfd6d6 cadddd d5e4e4 e0ebeb eaf2f2 f5f9f9 ffffff',
  copper: '000000 0a0604 140c08 1e130c 281910 311f14 3b2518 452c1c 4f3220 593824 633e28 6d452c 774b30 805134 8a5738 945e3c 9e6440 a86a44 b27048 bc774c c67d50 d08354 d98958 e3905c ed9660 f79c64 ffa267 ffa96b ffaf6f ffb573 ffbb77 ffc27b ffc77f',
};

export const GROUPS = ['grey', 'medical', 'perceptual', 'diverging', 'cyclic', 'artistic'];
export const GROUP_NAMES = {
  grey: 'Grey', medical: 'Medical', perceptual: 'Perceptual',
  diverging: 'Diverging', cyclic: 'Cyclic', artistic: 'Artistic',
};

// space: 'srgb' interpolates bytes; 'oklab' interpolates in OKLab.
// wavy: true marks a sequential map whose lightness is not monotonic by design.
const DEFS = [
  // grey
  { id: 'grey', name: 'Grey', group: 'grey', kind: 'sequential', space: 'srgb',
    stops: '000000 ffffff', use: 'Default CT display. Hounsfield windows read as film.' },
  { id: 'grey-inv', name: 'Inverted grey', group: 'grey', kind: 'sequential', space: 'srgb',
    stops: 'ffffff 000000', use: 'Radiograph look: dense bone dark, air white.' },
  { id: 'sepia', name: 'Sepia', group: 'grey', kind: 'sequential',
    stops: '000000 1c120a 4a3220 806040 b4946c e0ccaa fff8ec', use: 'Warm grey for long viewing and print.' },

  // medical
  { id: 'bone', name: 'Bone', group: 'medical', kind: 'sequential', space: 'srgb', src: 'matplotlib',
    stops: SOURCED.bone, use: 'Classic blue-grey bone display for CT slices.' },
  { id: 'pink-tissue', name: 'Soft tissue', group: 'medical', kind: 'sequential',
    stops: '000000 3a0d0d 7a2a26 b85a4f e0938a f5c6c0 fff4f2', use: 'Pink soft-tissue look for muscle and organ windows.' },
  { id: 'hot-iron', name: 'Hot iron', group: 'medical', kind: 'sequential',
    stops: '000000 4a0000 a01000 e04a00 ff9a00 ffd84a ffffff', use: 'Heated metal. Good for PET uptake and dose maps.' },
  { id: 'pet-rainbow', name: 'PET rainbow', group: 'medical', kind: 'sequential', space: 'srgb', wavy: true,
    stops: '000000 3c0064 4800b4 0040ff 00c0ff 00e080 80f000 ffff00 ff9000 ff0000 ffffff',
    use: 'NIH-style rainbow for PET. Hue steps, not lightness, carry the value.' },
  { id: 'ocean', name: 'Ocean', group: 'medical', kind: 'sequential',
    stops: '000814 012a4a 01497c 1676a8 3fa3c4 86cddc d6f1f2', use: 'Deep blue to aqua for perfusion and density.' },
  { id: 'copper', name: 'Copper', group: 'medical', kind: 'sequential', space: 'srgb', src: 'matplotlib',
    stops: SOURCED.copper, use: 'Warm metallic ramp for surface renders.' },
  { id: 'ice', name: 'Winter ice', group: 'medical', kind: 'sequential',
    stops: '040b1e 13306b 1f5aa8 3a8fd0 78c4e8 c3e9f7 ffffff', use: 'Cold blue ramp for low-dose and lung windows.' },

  // perceptual
  { id: 'viridis', name: 'Viridis', group: 'perceptual', kind: 'sequential', space: 'srgb', src: 'matplotlib',
    stops: SOURCED.viridis, use: 'Even steps, colour-blind safe. Good default for any scalar.' },
  { id: 'magma', name: 'Magma', group: 'perceptual', kind: 'sequential', space: 'srgb', src: 'matplotlib',
    stops: SOURCED.magma, use: 'Black to pale cream. Strong for sparse bright detail.' },
  { id: 'inferno', name: 'Inferno', group: 'perceptual', kind: 'sequential', space: 'srgb', src: 'matplotlib',
    stops: SOURCED.inferno, use: 'Black to yellow through fire. High contrast at the top.' },
  { id: 'plasma', name: 'Plasma', group: 'perceptual', kind: 'sequential', space: 'srgb', src: 'matplotlib',
    stops: SOURCED.plasma, use: 'No black end. Keeps low values visible.' },
  { id: 'cividis', name: 'Cividis', group: 'perceptual', kind: 'sequential', space: 'srgb', src: 'matplotlib',
    stops: SOURCED.cividis, use: 'Same look for most colour-vision types.' },
  { id: 'mako', name: 'Mako', group: 'perceptual', kind: 'sequential', space: 'srgb', src: 'seaborn',
    stops: SOURCED.mako, use: 'Deep sea blue-green. Calm, even steps.' },
  { id: 'rocket', name: 'Rocket', group: 'perceptual', kind: 'sequential', space: 'srgb', src: 'seaborn',
    stops: SOURCED.rocket, use: 'Dark plum to peach. Even steps.' },
  { id: 'cubehelix', name: 'Cubehelix', group: 'perceptual', kind: 'sequential', space: 'srgb', src: 'matplotlib',
    stops: SOURCED.cubehelix, use: 'Lightness rises evenly. Prints well in grey.' },
  { id: 'turbo', name: 'Turbo', group: 'perceptual', kind: 'sequential', space: 'srgb', src: 'turbo', wavy: true,
    stops: SOURCED.turbo, use: 'Smooth rainbow. Shows small steps, but not lightness order.' },

  // diverging
  { id: 'coolwarm', name: 'Cool-warm', group: 'diverging', kind: 'diverging', space: 'srgb', src: 'moreland',
    stops: SOURCED.coolwarm, use: 'Difference images. Blue below zero, red above.' },
  { id: 'red-blue', name: 'Blue-red', group: 'diverging', kind: 'diverging', space: 'srgb', src: 'colorbrewer',
    stops: SOURCED.rdbu, use: 'Strong blue-white-red for residuals and error maps.' },
  { id: 'purple-orange', name: 'Purple-orange', group: 'diverging', kind: 'diverging', space: 'srgb',
    stops: divergeStops(305, 62), use: 'Colour-blind safe two-sided map with equal-weight arms.' },
  { id: 'pink-green', name: 'Pink-green', group: 'diverging', kind: 'diverging', space: 'srgb', src: 'colorbrewer',
    stops: SOURCED.piyg, use: 'Bright two-sided map for signed change.' },
  { id: 'brown-teal', name: 'Brown-teal', group: 'diverging', kind: 'diverging', space: 'srgb', src: 'colorbrewer',
    stops: SOURCED.brbg, use: 'Earth tones for signed density change.' },
  { id: 'berlin', name: 'Berlin', group: 'diverging', kind: 'diverging', space: 'srgb', src: 'crameri',
    stops: SOURCED.berlin, use: 'Dark centre. Zero sinks into black on dark pages.' },
  { id: 'vanimo', name: 'Vanimo', group: 'diverging', kind: 'diverging', space: 'srgb', src: 'crameri',
    stops: SOURCED.vanimo, use: 'Dark centre, pink and green arms.' },
  { id: 'managua', name: 'Managua', group: 'diverging', kind: 'diverging', space: 'srgb', src: 'crameri',
    stops: SOURCED.managua, use: 'Dark centre, gold and blue arms.' },

  // cyclic
  { id: 'twilight', name: 'Twilight', group: 'cyclic', kind: 'cyclic', space: 'srgb', src: 'matplotlib',
    stops: SOURCED.twilight, use: 'Phase and angle. Light at zero, dark at half turn.' },
  { id: 'twilight-shifted', name: 'Twilight shifted', group: 'cyclic', kind: 'cyclic', space: 'srgb', src: 'matplotlib',
    stops: SOURCED.twilight, shift: 0.5, use: 'Phase and angle. Dark at zero.' },
  { id: 'phase-wheel', name: 'Phase wheel', group: 'cyclic', kind: 'cyclic', space: 'srgb',
    stops: wheelStops(0.72, 0.13, 0), use: 'Equal-lightness hue wheel for projection angle.' },

  // artistic (site style)
  { id: 'aurora', name: 'Aurora', group: 'artistic', kind: 'sequential',
    stops: '050816 0b1f3a 0b4a5c 0f7c6e 2fae6f 8bd86a e4f7a8', use: 'Night sky to green glow.' },
  { id: 'nebula', name: 'Nebula', group: 'artistic', kind: 'sequential',
    stops: '05030f 1d0b3a 4a1468 85237a c04a7a ec8a7a ffd3b0 fff6ea', use: 'Indigo, magenta and peach.' },
  { id: 'ember', name: 'Ember', group: 'artistic', kind: 'sequential',
    stops: '0a0302 2e0904 6a1405 a82c08 d95b10 f39a2e ffd27a fff3d6', use: 'Coals to flame.' },
  { id: 'glacier', name: 'Glacier', group: 'artistic', kind: 'sequential',
    stops: '02070f 0b2236 1d4a66 3f7896 72a8c0 aed3e0 e8f6fb', use: 'Steel blue to snow.' },
  { id: 'synthwave', name: 'Synthwave', group: 'artistic', kind: 'sequential',
    stops: '120424 2d0a52 5a0f7a 9a1a8a d8327f ff6a5e ffaa4a ffe36e', use: 'Purple to neon pink to sun yellow.' },
  { id: 'gold-leaf', name: 'Gold leaf', group: 'artistic', kind: 'sequential',
    stops: '0b0703 2a1a08 5a3a12 8e6420 c49536 e6c46a f6e6b4 fffaf0', use: 'Bronze to gilt.' },
  { id: 'xray-blue', name: 'X-ray film', group: 'artistic', kind: 'sequential',
    stops: '000306 07182a 1a3550 3a5a78 6a88a2 a5bccb dce8ef ffffff', use: 'Blue-base film on a light box.' },
  { id: 'cyanotype', name: 'Cyanotype', group: 'artistic', kind: 'sequential',
    stops: '0a1a3f 123a78 1f5a9e 4a82b8 8aadcc c9d8e4 f4f1e8', use: 'Prussian blue print on paper.' },
  { id: 'forest', name: 'Forest', group: 'artistic', kind: 'sequential',
    stops: '030a05 0c2a14 1c5028 3a7a38 72a24a b6c870 eef0c0', use: 'Moss and fern greens.' },
  { id: 'rose', name: 'Rose', group: 'artistic', kind: 'sequential',
    stops: '0d0408 3a1024 6e2240 a8405a d27a80 eeb2b0 fde8e2', use: 'Wine to blush.' },
  { id: 'orchid', name: 'Orchid', group: 'artistic', kind: 'sequential',
    stops: '1a0b2e 3d1a6e 6b3aa8 a35fd0 d68ae0 f5c0e8 fff0fa', use: 'Violet to lilac.' },
];

// ---------------------------------------------------------------- colour math
function s2l(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function l2s(c) { return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }

function rgbToOklab(r, g, b) {
  const R = s2l(r / 255), G = s2l(g / 255), B = s2l(b / 255);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToRgb(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const R = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const G = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const B = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const q = (v) => Math.max(0, Math.min(255, Math.round(l2s(Math.max(0, Math.min(1, v))) * 255)));
  return [q(R), q(G), q(B)];
}

/** CIE L* (0..100) of an sRGB byte triple. */
export function cieL(r, g, b) {
  const Y = 0.2126729 * s2l(r / 255) + 0.7151522 * s2l(g / 255) + 0.072175 * s2l(b / 255);
  return Y > 216 / 24389 ? 116 * Math.cbrt(Y) - 16 : (24389 / 27) * Y;
}

// Equal-lightness hue wheel in OKLCh. First stop equals last stop.
function wheelStops(L, C, h0) {
  const out = [];
  for (let i = 0; i <= 24; i++) {
    const h = h0 + (i / 24) * 2 * Math.PI;
    const [r, g, b] = oklabToRgb(L, C * Math.cos(h), C * Math.sin(h));
    out.push(((r << 16) | (g << 8) | b).toString(16).padStart(6, '0'));
  }
  return out.join(' ');
}

// Two-arm map in OKLCh with equal lightness on each arm: dark ends, pale middle.
function divergeStops(hueA, hueB) {
  const out = [];
  const N = 16;
  for (let i = 0; i <= N; i++) {
    const u = Math.abs(i / N - 0.5) * 2; // 0 at middle, 1 at ends
    const L = 0.97 - 0.6 * Math.pow(u, 0.9);
    const C = 0.15 * Math.sin(Math.min(1, u * 1.15) * Math.PI * 0.5) * (1 - 0.35 * u);
    const h = ((i < N / 2 ? hueA : hueB) * Math.PI) / 180;
    const [r, g, b] = oklabToRgb(L, C * Math.cos(h), C * Math.sin(h));
    out.push(((r << 16) | (g << 8) | b).toString(16).padStart(6, '0'));
  }
  return out.join(' ');
}

function parseStops(str) {
  return str.trim().split(/\s+/).map((h) => [
    parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16),
  ]);
}

function buildLut(def) {
  const stops = parseStops(def.stops);
  const n = stops.length - 1;
  const oklab = (def.space || 'oklab') === 'oklab';
  const pts = oklab ? stops.map((c) => rgbToOklab(c[0], c[1], c[2])) : stops;
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    let t = i / 255;
    if (def.shift) t = (t + def.shift) % 1;
    const x = t * n;
    const k = Math.min(n - 1, Math.floor(x));
    const f = x - k;
    const A = pts[k], B = pts[k + 1];
    const v = [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f];
    const c = oklab ? oklabToRgb(v[0], v[1], v[2]) : v.map((u) => Math.round(u));
    lut[i * 3] = c[0]; lut[i * 3 + 1] = c[1]; lut[i * 3 + 2] = c[2];
  }
  return lut;
}

// ---------------------------------------------------------------- catalogue
const BY_ID = new Map();
for (const d of DEFS) {
  const entry = {
    id: d.id, name: d.name, group: d.group, kind: d.kind, use: d.use,
    src: d.src || 'own', wavy: !!d.wavy, _def: d, _lut: null,
  };
  Object.defineProperty(entry, 'lut', {
    enumerable: true,
    get() { return this._lut || (this._lut = buildLut(this._def)); },
  });
  BY_ID.set(d.id, entry);
}

export const DEFAULT_ID = 'grey';

/** The map with this id, or the grey map if the id is unknown. */
export function get(id) {
  return BY_ID.get(id) || BY_ID.get(DEFAULT_ID);
}

export function has(id) { return BY_ID.has(id); }

/** All maps, or the maps of one group, in catalogue order. */
export function list(group) {
  const all = [...BY_ID.values()];
  return group ? all.filter((m) => m.group === group) : all;
}

export function ids() { return [...BY_ID.keys()]; }

/** A random map id. opts.group limits the choice; opts.not skips one id. */
export function randomId(opts = {}) {
  const pool = list(opts.group).filter((m) => m.id !== opts.not);
  return pool[Math.floor(Math.random() * pool.length)].id;
}

// ---------------------------------------------------------------- variants
// opts: { reverse, gamma, contrast }. gamma > 1 spreads the high values,
// gamma < 1 spreads the low values. contrast scales about the middle.
// Reverse flips the colours, not the data, so gamma keeps its meaning.
const VARIANTS = new Map();

export function remapT(t, opts = {}) {
  t = t > 0 ? (t < 1 ? t : 1) : 0;
  const c = opts.contrast ?? 1;
  if (c !== 1) t = Math.max(0, Math.min(1, 0.5 + (t - 0.5) * c));
  const g = opts.gamma ?? 1;
  if (g !== 1) t = Math.pow(t, g);
  return opts.reverse ? 1 - t : t;
}

/** The 256x3 LUT of a map after reverse, gamma and contrast. Cached. */
export function variant(id, opts = {}) {
  const m = get(id);
  const g = +(opts.gamma ?? 1), c = +(opts.contrast ?? 1), r = !!opts.reverse;
  if (g === 1 && c === 1 && !r) return m.lut;
  const key = `${m.id}|${r ? 1 : 0}|${g}|${c}`;
  let out = VARIANTS.get(key);
  if (out) return out;
  const base = m.lut;
  out = new Uint8Array(768);
  for (let i = 0; i < 256; i++) {
    const j = Math.round(remapT(i / 255, { gamma: g, contrast: c, reverse: r }) * 255);
    out[i * 3] = base[j * 3]; out[i * 3 + 1] = base[j * 3 + 1]; out[i * 3 + 2] = base[j * 3 + 2];
  }
  if (VARIANTS.size > 96) VARIANTS.clear();
  VARIANTS.set(key, out);
  return out;
}

/** [r, g, b] bytes for t in 0..1. Uses the same 256 steps as apply(). */
export function sample(id, t, opts) {
  const lut = variant(id, opts);
  const x = Number.isFinite(t) ? t : 0;
  const i = Math.round((x > 0 ? (x < 1 ? x : 1) : 0) * 255) * 3;
  return [lut[i], lut[i + 1], lut[i + 2]];
}

/** 256x1 RGBA bytes (1024) of a map, for textures and ImageData. */
export function rgba(id, opts) {
  const lut = variant(id, opts);
  const out = new Uint8Array(1024);
  for (let i = 0; i < 256; i++) {
    out[i * 4] = lut[i * 3]; out[i * 4 + 1] = lut[i * 3 + 1]; out[i * 4 + 2] = lut[i * 3 + 2]; out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * Colour a float array into RGBA bytes. lo maps to t = 0 and hi to t = 1.
 * out: Uint8ClampedArray or Uint8Array of length >= 4 * src.length (made
 * if absent). opts: { reverse, gamma, contrast, nan: [r, g, b, a] }.
 */
export function apply(id, src, lo, hi, out, opts = {}) {
  const n = src.length;
  if (!out) out = new Uint8ClampedArray(n * 4);
  const lut = variant(id, opts);
  const span = hi - lo;
  const k = span !== 0 ? 255 / span : 0;
  const nan = opts.nan || [0, 0, 0, 0];
  for (let p = 0, o = 0; p < n; p++, o += 4) {
    const v = src[p];
    if (v !== v) { out[o] = nan[0]; out[o + 1] = nan[1]; out[o + 2] = nan[2]; out[o + 3] = nan[3]; continue; }
    let x = (v - lo) * k;
    x = x > 0 ? (x < 255 ? x : 255) : 0;
    const i = ((x + 0.5) | 0) * 3;
    out[o] = lut[i]; out[o + 1] = lut[i + 1]; out[o + 2] = lut[i + 2]; out[o + 3] = 255;
  }
  return out;
}

// ---------------------------------------------------------------- swatches
const hex2 = (v) => v.toString(16).padStart(2, '0');

/** CSS linear-gradient string for a swatch. */
export function cssGradient(id, opts = {}, dir = '90deg', steps = 16) {
  const parts = [];
  for (let s = 0; s <= steps; s++) {
    const [r, g, b] = sample(id, s / steps, opts);
    parts.push(`#${hex2(r)}${hex2(g)}${hex2(b)} ${((100 * s) / steps).toFixed(2)}%`);
  }
  return `linear-gradient(${dir}, ${parts.join(', ')})`;
}

/** CanvasGradient from (x0, y0) to (x1, y1) on a 2D context. */
export function toCanvasGradient(ctx, id, x0, y0, x1, y1, opts = {}, steps = 32) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (let s = 0; s <= steps; s++) {
    const [r, gg, b] = sample(id, s / steps, opts);
    g.addColorStop(s / steps, `rgb(${r},${gg},${b})`);
  }
  return g;
}

// ---------------------------------------------------------------- WebGPU
// GPUTextureUsage values from the WebGPU spec, for runtimes without the global.
const TEX_BIND = 0x04, COPY_DST = 0x02;
const usage = () => (globalThis.GPUTextureUsage
  ? globalThis.GPUTextureUsage.TEXTURE_BINDING | globalThis.GPUTextureUsage.COPY_DST
  : TEX_BIND | COPY_DST);

/** 256x1 rgba8unorm GPUTexture of one map. Call again or use write() to change it. */
export function lutTexture(device, id, opts) {
  const texture = device.createTexture({
    label: `cmap:${id}`, size: { width: 256, height: 1 }, format: 'rgba8unorm', usage: usage(),
  });
  const write = (nid, nopts) => device.queue.writeTexture(
    { texture }, rgba(nid, nopts), { bytesPerRow: 1024, rowsPerImage: 1 }, { width: 256, height: 1 });
  write(id, opts);
  return Object.assign(texture, { writeMap: write });
}

/**
 * 256xN rgba8unorm atlas with one map per row, for shaders that switch map
 * by a uniform. Returns { texture, rows } where rows maps id -> row index.
 */
export function lutAtlasTexture(device, mapIds = ids(), opts) {
  const h = mapIds.length;
  const data = new Uint8Array(1024 * h);
  const rows = new Map();
  mapIds.forEach((id, r) => { data.set(rgba(id, opts), r * 1024); rows.set(id, r); });
  const texture = device.createTexture({
    label: 'cmap:atlas', size: { width: 256, height: h }, format: 'rgba8unorm', usage: usage(),
  });
  device.queue.writeTexture({ texture }, data, { bytesPerRow: 1024, rowsPerImage: h }, { width: 256, height: h });
  return { texture, rows };
}

/**
 * WGSL helpers. Paste into a shader module (string concat). They take the
 * LUT texture as a parameter, so the page keeps its own binding numbers.
 *   cmap_window(v, lo, hi)          -> t in 0..1
 *   cmap_load(lut, t)               -> rgb, exact LUT step (textureLoad)
 *   cmap_sample(lut, samp, t)       -> rgb, linear filter between steps
 *   cmap_load_row(atlas, t, row)    -> rgb from row `row` of an atlas
 */
export const WGSL = /* wgsl */ `
fn cmap_window(v: f32, lo: f32, hi: f32) -> f32 {
  return clamp((v - lo) / max(hi - lo, 1e-20), 0.0, 1.0);
}
fn cmap_load(lut: texture_2d<f32>, t: f32) -> vec3<f32> {
  let i = i32(round(clamp(t, 0.0, 1.0) * 255.0));
  return textureLoad(lut, vec2<i32>(i, 0), 0).rgb;
}
fn cmap_sample(lut: texture_2d<f32>, samp: sampler, t: f32) -> vec3<f32> {
  let u = (clamp(t, 0.0, 1.0) * 255.0 + 0.5) / 256.0;
  return textureSampleLevel(lut, samp, vec2<f32>(u, 0.5), 0.0).rgb;
}
fn cmap_load_row(atlas: texture_2d<f32>, t: f32, row: i32) -> vec3<f32> {
  let i = i32(round(clamp(t, 0.0, 1.0) * 255.0));
  return textureLoad(atlas, vec2<i32>(i, row), 0).rgb;
}
`;
