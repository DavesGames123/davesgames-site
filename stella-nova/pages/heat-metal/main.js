// ============================================================================
//  HEAT METAL TABLE  ·  main.js — data load and boot (GENERATED)
//  Regenerate with: node build.mjs
// ============================================================================
import { bootTable } from '../../lib/table-engine.js';
import { loadShaders } from '../../lib/shaders.js';
import { PAGE } from './page.js';

const SH = await loadShaders(import.meta.url, ['shaders/pack.wgsl']);
const spec = await (await fetch(new URL('spec.json', import.meta.url))).json();

bootTable(PAGE, { spec, pack: SH['shaders/pack.wgsl'] });
