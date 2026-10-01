// ============================================================================
//  MATERIAL STUDIO  ·  export/engines/readme.js — README.txt of a package
// ────────────────────────────────────────────────────────────────────────────
//  readmeText lists each file with its bit depth, color space, engine role
//  and channel layout. Then it gives the import steps of the target, the
//  material scalars, and the optional maps that the export did not write.
//
//  GREP TARGETS
//      readmeText  FILES  HOW TO IMPORT  NOT WRITTEN
// ============================================================================
import { EXPORT_TARGETS } from '../../contract.js';
import { chLabel } from '../pack.js';

export function readmeText(target, o, sc, files, notes) {
  const t = EXPORT_TARGETS.find(x => x.id === target);
  const rows = files.filter(x => x.chans).map(fi => {
    const chans = fi.chans.map((c, i) => `${(fi.chans.length === 1 ? 'L' : 'RGBA'[i])}=${chLabel(c)}`).join('  ');
    return `  ${fi.name.padEnd(34)} ${String(fi.bits === 16 ? '16-bit' : fi.fmt === 'exr' ? 'half' : '8-bit').padEnd(7)} ${fi.color.padEnd(7)} ${fi.role}\n      ${chans}`;
  }).join('\n');
  const steps = {
    'unity-urp': [
      'Copy the folder into Assets/. The .meta files set the import options:',
      '  base and emission maps are sRGB; every other map has sRGB off;',
      '  the normal map has Texture Type = Normal map.',
      `Open ${o.name}.mat. It uses Universal Render Pipeline/Lit.`,
      'If you see a pink material, set the shader to Universal Render Pipeline/Lit.',
      'Clearcoat: switch the shader to Universal Render Pipeline/Complex Lit;',
      '  _ClearCoatMap (R mask, G smoothness) is already assigned.',
      'If Unity rejects a .meta file, delete it and set the options above by hand.',
    ],
    'unity-hdrp': [
      'Copy the folder into Assets/. The .meta files set sRGB off for the mask,',
      '  normal, height and coat maps and Texture Type = Normal map for the normal.',
      `Select ${o.name}.mat once so that HDRP validates its keywords.`,
      'MaskMap: R metallic, G ambient occlusion, B detail mask (1), A smoothness.',
      'Height uses pixel displacement; set Displacement Mode to None to turn it off.',
    ],
    'unity-builtin': [
      'Copy the folder into Assets/. The .meta files set the import options.',
      'The material uses the Standard shader (metallic setup).',
      'Smoothness Source = Metallic Alpha. Standard has no double-sided option.',
    ],
    unreal: [
      'Put this folder anywhere on disk. In the Unreal Editor, use',
      `  Tools > Execute Python Script... and pick import_${o.name}.py.`,
      `It imports the textures into ${o.unrealDest.replace(/\{name\}/g, o.name)} and builds M_${o.name}.`,
      'The normal map is DirectX (green flipped). Do not tick Flip Green Channel.',
      'Manual import: ORM and CC = Masks, sRGB off; N = Normalmap; H = Grayscale.',
    ],
    godot: [
      `Copy the folder to ${o.godotRoot.replace(/\{name\}/g, o.name)} in the Godot project`,
      '  (or edit the paths at the top of the .tres file).',
      'Godot detects the normal map when the material uses it, and reimports it.',
      'Sheen becomes rim light, and anisotropy is a single value: Godot has no',
      '  sheen and no anisotropy map in StandardMaterial3D.',
    ],
    gltf: ['Drop the .glb into any glTF 2.0 viewer, Blender, three.js or Babylon.js.'],
    png: ['One PNG per map. Color maps are sRGB; data maps are linear.', 'Normal maps are OpenGL (+Y) unless the name says _dx.'],
  }[target] || [];
  return `${o.name} — ${t ? t.label : target} export
Stella Nova PBR Material Studio · ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC
Resolution ${o.resolved}x${o.resolved} · UV tiling ${o.uvScale}

FILES
${rows}

HOW TO IMPORT
${steps.map(s => '  ' + s).join('\n')}

MATERIAL SCALARS
  IOR ${sc.ior} · transmission ${sc.transmission} · displacement ${sc.displacementScale}
  emissive strength ${sc.emissiveStrength}${notes.emissiveScale && notes.emissiveScale !== 1 ? ` (x${notes.emissiveScale.toFixed(3)}: the emissive map peak was above 1, so the map is divided by the peak and the strength carries it)` : ''}
  alpha ${sc.alphaMode}${sc.alphaMode === 'mask' ? ` (cutoff ${sc.alphaCutoff})` : ''} · double sided ${sc.doubleSided ? 'yes' : 'no'}
${notes.skipped && notes.skipped.length ? `\nNOT WRITTEN (no data in the bake)\n  ${notes.skipped.join(', ')}\n` : ''}`;
}
