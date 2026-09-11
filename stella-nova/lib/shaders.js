// shaders.js — shared async shader loader for decomposed Stella Nova pages.
//
// Each page keeps its shader source in real .glsl / .wgsl files under its own
// shaders/ folder. A page's ES-module entry point fetches them up front, before
// it builds any GPU material, so the original synchronous init order is kept.
//
//   import { loadShaders } from '../../lib/shaders.js';
//   const SH = await loadShaders(import.meta.url, ['shaders/orb.vert.glsl', ...]);
//   const vertexShader = SH['shaders/orb.vert.glsl'];
//
// loadShaders(baseUrl, names) resolves each name against baseUrl (pass
// import.meta.url from the calling module) and returns a name -> source map.
// A non-200 response throws, so a missing shader fails loud instead of
// silently compiling an empty program.
export async function loadShaders(baseUrl, names) {
  const pairs = await Promise.all(names.map(async (name) => {
    const res = await fetch(new URL(name, baseUrl));
    if (!res.ok) throw new Error(`shader fetch failed (${res.status}): ${name}`);
    return [name, await res.text()];
  }));
  return Object.fromEntries(pairs);
}

// loadShadersClassic(baseUrl, names) — same contract for pages whose script is a
// classic (non-module) <script>. It attaches to window so a classic script can
// call it, then run its original body inside the returned promise.
//
//   SNLoadShaders(document.currentScript ? ... : location.href, [...]).then((SH) => { ... });
//
// baseUrl for a classic page is typically the folder of index.html; pass
// new URL('.', location.href) from the page to resolve 'shaders/x.glsl'.
window.SNLoadShaders = loadShaders;
