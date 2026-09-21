// ============================================================================
//  HEAT DIFFRACTION TABLE  ·  main.js — data load and boot (GENERATED)
//  Reuses ../postfx-table/photos.json for the source images (no copy).
//  Regenerate with: node build.mjs
// ============================================================================
import { bootTable } from '../../lib/table-engine.js';
import { loadShaders } from '../../lib/shaders.js';
import { PAGE } from './page.js';

const SH = await loadShaders(import.meta.url, ['shaders/pack.wgsl']);
const spec = await (await fetch(new URL('spec.json', import.meta.url))).json();
const photos = await (await fetch(new URL('../postfx-table/photos.json', import.meta.url))).json();

bootTable(PAGE, { spec, pack: SH['shaders/pack.wgsl'], aux: { photos } });
