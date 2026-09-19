// ============================================================================
//  POST-PROCESS TABLE  ·  main.js — data load and boot (the entry module)
// ────────────────────────────────────────────────────────────────────────────
//  Fetch the WGSL pack, the noise pack, the photos and the spec, then hand them to the
//  shared table-engine with this page's PAGE object. The engine builds the
//  sidebar and the frame loop; page.js owns the GPU work.
//
//  MODULE MAP
//      ../../lib/table-engine.js .. the shared runtime, bootTable(PAGE, data)
//      ../../lib/shaders.js ....... the shared async .wgsl loader
//      page.js .................... this page's PAGE object
//      spec.json .................. cells, gens, swatches, cols, uniform_bytes
//      shaders/pack.wgsl .......... the main WGSL pack
//      shaders/noise.wgsl ......... the shared noise field pack
//      photos.json ................ the base64 sample photos
// ============================================================================
import { bootTable } from '../../lib/table-engine.js';
import { loadShaders } from '../../lib/shaders.js';
import { PAGE } from './page.js';

const SH = await loadShaders(import.meta.url, ['shaders/pack.wgsl', 'shaders/noise.wgsl']);
const spec = await (await fetch(new URL('spec.json', import.meta.url))).json();
const photos = await (await fetch(new URL('photos.json', import.meta.url))).json();

bootTable(PAGE, { spec, pack: SH['shaders/pack.wgsl'], aux: { noisePack: SH['shaders/noise.wgsl'], photos } });
