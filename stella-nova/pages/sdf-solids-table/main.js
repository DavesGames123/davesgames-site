// ============================================================================
//  SDF SOLIDS TABLE  ·  main.js — data load and boot (the entry module, GENERATED)
// ────────────────────────────────────────────────────────────────────────────
//  Fetch the WGSL pack and the spec, then hand them to the shared table-engine
//  with this page's PAGE object. The engine builds the sidebar and the frame
//  loop; page.js owns the GPU work. saver.js is the screensaver (hand written,
//  not generated). Regenerate with: node build.mjs
// ============================================================================
import { bootTable } from '../../lib/table-engine.js';
import { loadShaders } from '../../lib/shaders.js';
import { PAGE } from './page.js';
import { SAVER } from './saver.js';

const SH = await loadShaders(import.meta.url, ['shaders/pack.wgsl']);
const spec = await (await fetch(new URL('spec.json', import.meta.url))).json();

// The build-up screensaver (saver.js) takes the GPU device from PAGE.init.
// install() runs after bootTable defines the engine's one-cell hook, so its
// window.snSaver replaces that hook. The table itself does not change.
const page = Object.create(PAGE);
page.init = function (ctx) { SAVER.setCtx(ctx); return PAGE.init.call(this, ctx); };
bootTable(page, { spec, pack: SH['shaders/pack.wgsl'] });
SAVER.install();
