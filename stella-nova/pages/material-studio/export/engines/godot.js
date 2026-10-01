// ============================================================================
//  MATERIAL STUDIO  ·  export/engines/godot.js — the Godot 4 .tres material
// ────────────────────────────────────────────────────────────────────────────
//  godotTres writes a StandardMaterial3D resource. It links each texture as
//  an ext_resource under godotRoot. Sheen becomes rim light, and anisotropy
//  is the mean value, because StandardMaterial3D has no map for them.
//
//  GREP TARGETS
//      godotTres  ext_resource  heightmap_scale
// ============================================================================
import { f } from '../format.js';

export function godotTres(o, sc, u, files, st) {
  const res = [], props = [];
  const id = {};
  files.forEach((fi, i) => {
    id[fi.key] = `${i + 1}_${fi.key}`;
    res.push(`[ext_resource type="Texture2D" path="${o.godotRoot.replace(/\{name\}/g, o.name).replace(/\/+$/, '')}/${fi.name}" id="${id[fi.key]}"]`);
  });
  const E = k => `ExtResource("${id[k]}")`;
  props.push(`resource_name = "${o.name}"`);
  if (sc.alphaMode === 'blend') props.push('transparency = 1');
  if (sc.alphaMode === 'mask') props.push('transparency = 2', `alpha_scissor_threshold = ${f(sc.alphaCutoff)}`);
  if (sc.doubleSided) props.push('cull_mode = 2');
  if (id.base) props.push(`albedo_texture = ${E('base')}`);
  if (id.orm) {
    props.push('metallic = 1.0', 'metallic_specular = 0.5', `metallic_texture = ${E('orm')}`, 'metallic_texture_channel = 2',
      'roughness = 1.0', `roughness_texture = ${E('orm')}`, 'roughness_texture_channel = 1',
      'ao_enabled = true', `ao_texture = ${E('orm')}`, 'ao_texture_channel = 0');
  }
  if (id.normal) props.push('normal_enabled = true', 'normal_scale = 1.0', `normal_texture = ${E('normal')}`);
  if (id.emissive) props.push('emission_enabled = true', 'emission = Color(1, 1, 1, 1)', `emission_energy_multiplier = ${f(sc.emissiveStrength * (u?.emissiveScale ?? 1))}`, `emission_texture = ${E('emissive')}`);
  if (id.height) props.push('heightmap_enabled = true', `heightmap_scale = ${f(Math.min(16, sc.displacementScale * 200))}`, 'heightmap_deep_parallax = true', `heightmap_texture = ${E('height')}`);
  if (id.clearcoat) props.push('clearcoat_enabled = true', 'clearcoat = 1.0', 'clearcoat_roughness = 1.0', `clearcoat_texture = ${E('clearcoat')}`);
  if (u?.anisotropy && st?.extra) props.push('anisotropy_enabled = true', `anisotropy = ${f(st.extra.mean[3])}`);
  if (u?.sheen && st?.extra) props.push('rim_enabled = true', `rim = ${f(st.extra.mean[2])}`, 'rim_tint = 0.5');
  if (sc.transmission > 0) props.push('refraction_enabled = true', `refraction_scale = ${f(sc.transmission * 0.05)}`);
  if (o.uvScale !== 1) props.push(`uv1_scale = Vector3(${f(o.uvScale)}, ${f(o.uvScale)}, 1)`);
  return `[gd_resource type="StandardMaterial3D" load_steps=${files.length + 1} format=3]\n\n${res.join('\n')}\n\n[resource]\n${props.join('\n')}\n`;
}
