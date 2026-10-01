// ============================================================================
//  MATERIAL STUDIO  ·  export/plans.js — the image files of each target
// ────────────────────────────────────────────────────────────────────────────
//  PLANS has one planner per EXPORT_TARGETS id. A planner gives the image
//  list of its target: file name, channel specs, bit depth, color space,
//  engine role, and the used flag that makes the image optional.
//  PLAIN_MAPS lists the maps that the PNG target can write. resolvePlan
//  drops the optional images with no data, and the folded glTF images.
//
//  GREP TARGETS
//      PLANS  PLAIN_MAPS  FORMATS  DEFAULT_PLAIN  resolvePlan  texExt
//      baseRGB  normalGL  normalDX  gray  emissiveRGB  heightImg
// ============================================================================
import { ch } from './pack.js';

/**
 * A plan lists the image files of a target. Each entry:
 *   {key, file, chans:[channel spec], bits:8|16, fmt:'png'|'tga'|'exr',
 *    srgbChunk, color:'sRGB'|'linear', role, optional?:flag name, why}
 * `u` is usedFlags (null in the UI preview: optional entries show as "if used").
 */
function texExt(o, img) {
  if (img.fmt === 'exr') return 'exr';
  if (img.bits === 16) return 'png';
  return o.fmt === 'tga' ? 'tga' : 'png';
}
export function baseRGB(alpha) {
  return alpha ? [ch.srgb('albedo', 0), ch.srgb('albedo', 1), ch.srgb('albedo', 2), ch.s('albedo', 3)]
    : [ch.srgb('albedo', 0), ch.srgb('albedo', 1), ch.srgb('albedo', 2)];
}
const normalGL = () => [ch.s('normal', 0), ch.s('normal', 1), ch.s('normal', 2)];
const normalDX = () => [ch.s('normal', 0), ch.inv('normal', 1), ch.s('normal', 2)];
export const gray = (slot, c, label) => [ch.s(slot, c, label)];
function emissiveRGB(gain) {
  return [0, 1, 2].map(c => ({ ...ch.srgb('emissive', c), gain }));
}
function heightImg(o, file, role) {
  const fmt = o.heightFmt === 'exr' ? 'exr' : 'png', bits = o.heightFmt === 'png8' ? 8 : 16;
  return { key: 'height', file, chans: gray('height', 0), bits, fmt, color: 'linear', role, optional: 'height' };
}

export const PLANS = {
  'unity-urp': (o, u, sc) => {
    const n = o.name, alpha = !u || u.opacity;
    return [
      { key: 'base', file: `${n}_BaseMap`, chans: baseRGB(alpha), srgbChunk: true, color: 'sRGB', role: '_BaseMap' },
      { key: 'mask', file: `${n}_MetallicSmoothness`, chans: [ch.s('orm', 2), ch.s('orm', 2), ch.s('orm', 2), ch.inv('orm', 1)], color: 'linear', role: '_MetallicGlossMap' },
      { key: 'normal', file: `${n}_Normal`, chans: o.normalBits === 16 ? normalGL() : normalGL(), bits: o.normalBits, color: 'linear', role: '_BumpMap (Normal map)' },
      { key: 'ao', file: `${n}_Occlusion`, chans: gray('orm', 0), color: 'linear', role: '_OcclusionMap' },
      heightImg(o, `${n}_Height`, '_ParallaxMap'),
      { key: 'emissive', file: `${n}_Emission`, chans: emissiveRGB(u?.emissiveGain ?? 1), srgbChunk: true, color: 'sRGB', role: '_EmissionMap', optional: 'emissive' },
      { key: 'clearcoat', file: `${n}_ClearCoat`, chans: [ch.s('extra', 0), ch.inv('extra', 1, 'clearcoat smoothness'), ch.k(0), ch.k(1)], color: 'linear', role: '_ClearCoatMap (Complex Lit)', optional: 'clearcoat' },
    ];
  },
  'unity-hdrp': (o, u) => {
    const n = o.name, alpha = !u || u.opacity;
    return [
      { key: 'base', file: `${n}_BaseColor`, chans: baseRGB(alpha), srgbChunk: true, color: 'sRGB', role: '_BaseColorMap' },
      { key: 'mask', file: `${n}_MaskMap`, chans: [ch.s('orm', 2), ch.s('orm', 0), ch.k(1, 'detail mask = 1'), ch.inv('orm', 1)], color: 'linear', role: '_MaskMap' },
      { key: 'normal', file: `${n}_Normal`, chans: normalGL(), bits: o.normalBits, color: 'linear', role: '_NormalMap (Normal map)' },
      heightImg(o, `${n}_Height`, '_HeightMap'),
      { key: 'emissive', file: `${n}_Emissive`, chans: emissiveRGB(u?.emissiveGain ?? 1), srgbChunk: true, color: 'sRGB', role: '_EmissiveColorMap', optional: 'emissive' },
      { key: 'clearcoat', file: `${n}_CoatMask`, chans: gray('extra', 0, 'clearcoat'), color: 'linear', role: '_CoatMaskMap', optional: 'clearcoat' },
    ];
  },
  'unity-builtin': (o, u) => {
    const n = o.name, alpha = !u || u.opacity;
    return [
      { key: 'base', file: `${n}_Albedo`, chans: baseRGB(alpha), srgbChunk: true, color: 'sRGB', role: '_MainTex' },
      { key: 'mask', file: `${n}_MetallicGloss`, chans: [ch.s('orm', 2), ch.s('orm', 2), ch.s('orm', 2), ch.inv('orm', 1)], color: 'linear', role: '_MetallicGlossMap' },
      { key: 'normal', file: `${n}_Normal`, chans: normalGL(), bits: o.normalBits, color: 'linear', role: '_BumpMap (Normal map)' },
      { key: 'ao', file: `${n}_Occlusion`, chans: gray('orm', 0), color: 'linear', role: '_OcclusionMap' },
      heightImg(o, `${n}_Height`, '_ParallaxMap'),
      { key: 'emissive', file: `${n}_Emission`, chans: emissiveRGB(u?.emissiveGain ?? 1), srgbChunk: true, color: 'sRGB', role: '_EmissionMap', optional: 'emissive' },
    ];
  },
  unreal: (o, u) => {
    const n = o.name, alpha = !u || u.opacity;
    return [
      { key: 'base', file: `T_${n}_BC`, chans: baseRGB(alpha), srgbChunk: true, color: 'sRGB', role: 'BaseColor (+ Opacity in A)' },
      { key: 'normal', file: `T_${n}_N`, chans: normalDX(), bits: o.normalBits, color: 'linear', role: 'Normal (DirectX, green flipped)' },
      { key: 'orm', file: `T_${n}_ORM`, chans: [ch.s('orm', 0), ch.s('orm', 1), ch.s('orm', 2)], color: 'linear', role: 'ORM (Masks)' },
      heightImg(o, `T_${n}_H`, 'Height (BumpOffset)'),
      { key: 'emissive', file: `T_${n}_E`, chans: emissiveRGB(u?.emissiveGain ?? 1), srgbChunk: true, color: 'sRGB', role: 'Emissive', optional: 'emissive' },
      { key: 'clearcoat', file: `T_${n}_CC`, chans: [ch.s('extra', 0), ch.s('extra', 1), ch.k(0)], color: 'linear', role: 'ClearCoat R, ClearCoatRoughness G', optional: 'clearcoat' },
    ];
  },
  godot: (o, u) => {
    const n = o.name, alpha = !u || u.opacity;
    return [
      { key: 'base', file: `${n}_albedo`, chans: baseRGB(alpha), srgbChunk: true, color: 'sRGB', role: 'albedo_texture' },
      { key: 'normal', file: `${n}_normal`, chans: normalGL(), bits: o.normalBits, color: 'linear', role: 'normal_texture' },
      { key: 'orm', file: `${n}_orm`, chans: [ch.s('orm', 0), ch.s('orm', 1), ch.s('orm', 2)], color: 'linear', role: 'ao / roughness / metallic channels' },
      heightImg(o, `${n}_height`, 'heightmap_texture'),
      { key: 'emissive', file: `${n}_emission`, chans: emissiveRGB(u?.emissiveGain ?? 1), srgbChunk: true, color: 'sRGB', role: 'emission_texture', optional: 'emissive' },
      { key: 'clearcoat', file: `${n}_clearcoat`, chans: [ch.s('extra', 0), ch.s('extra', 1), ch.k(0)], color: 'linear', role: 'clearcoat_texture (R amount, G roughness)', optional: 'clearcoat' },
    ];
  },
  gltf: (o, u) => {
    const alpha = !u || u.opacity;
    return [
      { key: 'base', file: 'baseColor', chans: baseRGB(alpha), srgbChunk: true, color: 'sRGB', role: 'baseColorTexture', fold: 'albedoConst' },
      { key: 'orm', file: 'occlusionRoughnessMetallic', chans: [ch.s('orm', 0), ch.s('orm', 1), ch.s('orm', 2)], color: 'linear', role: 'occlusionTexture R + metallicRoughnessTexture G B', fold: 'ormConst' },
      { key: 'normal', file: 'normal', chans: normalGL(), color: 'linear', role: 'normalTexture', optional: 'normal' },
      { key: 'emissive', file: 'emissive', chans: emissiveRGB(u?.emissiveGain ?? 1), srgbChunk: true, color: 'sRGB', role: 'emissiveTexture', optional: 'emissive' },
      { key: 'clearcoat', file: 'clearcoat', chans: [ch.s('extra', 0), ch.s('extra', 1), ch.k(0)], color: 'linear', role: 'KHR_materials_clearcoat R + roughness G', optional: 'clearcoat' },
      { key: 'sheen', file: 'sheenColor', chans: [0, 1, 2].map(() => ch.srgb('extra', 2, 'sheen')), srgbChunk: true, color: 'sRGB', role: 'KHR_materials_sheen sheenColorTexture', optional: 'sheen' },
      { key: 'aniso', file: 'anisotropy', chans: [
        { slot: 'extra', c: 3, fn: (r, g, b, a) => (a < 0 ? 0.5 : 1), label: 'direction X' },
        { slot: 'extra', c: 3, fn: (r, g, b, a) => (a < 0 ? 1 : 0.5), label: 'direction Y' },
        { slot: 'extra', c: 3, fn: (r, g, b, a) => Math.abs(a), label: '|anisotropy|' }], color: 'linear', role: 'KHR_materials_anisotropy', optional: 'anisotropy' },
    ];
  },
  png: (o, u) => {
    const n = o.name, out = [];
    const T = (map) => o.template.replace(/\{name\}/g, n).replace(/\{map\}/g, map).replace(/\{res\}/g, String(o.res || '')).replace(/\{target\}/g, 'png');
    for (const key of o.maps) {
      const m = PLAIN_MAPS[key];
      if (!m) continue;
      const e = { ...m.spec(o, u), key, file: T(key) };
      out.push(e);
    }
    return out;
  },
};

/** Maps the PNG target can write. spec(o,u) returns the plan fields. */
export const PLAIN_MAPS = {
  basecolor:          { label: 'Base color (sRGB)', spec: () => ({ chans: baseRGB(false), srgbChunk: true, color: 'sRGB', role: 'base color' }) },
  basecolor_alpha:    { label: 'Base color + alpha', spec: () => ({ chans: baseRGB(true), srgbChunk: true, color: 'sRGB', role: 'base color, opacity in A' }) },
  opacity:            { label: 'Opacity', spec: () => ({ chans: gray('albedo', 3), color: 'linear', role: 'opacity', optional: 'opacity' }) },
  normal:             { label: 'Normal (OpenGL +Y)', spec: o => ({ chans: normalGL(), bits: o.normalBits, color: 'linear', role: 'tangent normal +Y' }) },
  normal_dx:          { label: 'Normal (DirectX -Y)', spec: o => ({ chans: normalDX(), bits: o.normalBits, color: 'linear', role: 'tangent normal -Y' }) },
  ao:                 { label: 'Ambient occlusion', spec: () => ({ chans: gray('orm', 0), color: 'linear', role: 'AO' }) },
  roughness:          { label: 'Roughness', spec: () => ({ chans: gray('orm', 1), color: 'linear', role: 'roughness' }) },
  smoothness:         { label: 'Smoothness (1-rough)', spec: () => ({ chans: [ch.inv('orm', 1)], color: 'linear', role: 'smoothness' }) },
  metallic:           { label: 'Metallic', spec: () => ({ chans: gray('orm', 2), color: 'linear', role: 'metallic' }) },
  orm:                { label: 'ORM (AO, rough, metal)', spec: () => ({ chans: [ch.s('orm', 0), ch.s('orm', 1), ch.s('orm', 2)], color: 'linear', role: 'packed ORM' }) },
  height:             { label: 'Height', spec: o => ({ ...heightImg(o, '', 'height'), optional: undefined }) },
  emissive:           { label: 'Emissive (sRGB)', spec: (o, u) => ({ chans: emissiveRGB(u?.emissiveGain ?? 1), srgbChunk: true, color: 'sRGB', role: 'emissive', optional: 'emissive' }) },
  clearcoat:          { label: 'Clearcoat', spec: () => ({ chans: gray('extra', 0), color: 'linear', role: 'clearcoat', optional: 'clearcoat' }) },
  clearcoat_roughness:{ label: 'Clearcoat roughness', spec: () => ({ chans: gray('extra', 1), color: 'linear', role: 'clearcoat roughness', optional: 'clearcoat' }) },
  sheen:              { label: 'Sheen', spec: () => ({ chans: gray('extra', 2), color: 'linear', role: 'sheen', optional: 'sheen' }) },
  anisotropy:         { label: 'Anisotropy', spec: () => ({ chans: gray('extra', 3), color: 'linear', role: 'anisotropy', optional: 'anisotropy' }) },
};
/** 8-bit texture formats (panels.js reads this list). */
export const FORMATS = ['png', 'tga'];
export const DEFAULT_PLAIN = ['basecolor', 'normal', 'ao', 'roughness', 'metallic', 'height', 'emissive', 'opacity'];

/** Resolve a plan for a target: drop unused optional maps (and folded ones for glTF). */
export function resolvePlan(target, o, u, sc) {
  const plan = PLANS[target](o, u, sc);
  return plan.filter(img => {
    if (!u) return true;
    if (img.optional && !u[img.optional]) return false;
    if (img.fold && o.fold && u[img.fold]) return false;
    return true;
  }).map(img => ({ ...img, bits: img.bits || 8, ext: texExt(o, img) }));
}
