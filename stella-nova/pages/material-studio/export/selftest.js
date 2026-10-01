// ============================================================================
//  MATERIAL STUDIO  ·  export/selftest.js — export checks that need no bake
// ────────────────────────────────────────────────────────────────────────────
//  selfTest checks the codecs and writers with small fixed inputs: crc32,
//  a PNG round trip with alpha 0, a zip round trip, a .glb parse, the
//  Unity GUID, and a plan for each target. It also gives whether maps are
//  baked and the last export. __studio.io.selfTest adds the import checks.
//
//  GREP TARGETS
//      selfTest  checks
// ============================================================================
import { EXPORT_TARGETS, DEFAULT_SCALARS } from '../contract.js';
import { makeZip, encodePNG, crc32, decodePNG, readZip } from '../zip.js';
import { buildGLB, uvSphere, parseGLB } from '../glb.js';
import { S, last } from './ctx.js';
import { PLANS, resolvePlan } from './plans.js';
import { OPTS } from './options.js';
import { unityGuid } from './engines/unity.js';

/** Quick checks that need no bake: codecs, zip, glb, GUIDs, plans. */
export async function selfTest() {
  const out = { ok: true, checks: {} };
  const ok = (k, v) => { out.checks[k] = v; if (!v) out.ok = false; };
  ok('crc32', crc32(new TextEncoder().encode('123456789')) === 0xcbf43926);
  const px = new Uint8Array([0, 0, 0, 0, 255, 128, 7, 3, 1, 2, 3, 255, 9, 9, 9, 9]);
  const png = await encodePNG({ width: 2, height: 2, channels: 4, data: px });
  const back = await decodePNG(png);
  ok('png8 alpha 0 keeps rgb', back.data.every((v, i) => v === px[i]));
  const zipped = await makeZip([{ name: 'a.txt', data: 'x'.repeat(500) }, { name: 'b.png', data: png }]);
  const entries = await readZip(zipped);
  ok('zip roundtrip', entries.length === 2 && entries[0].data.length === 500);
  const glb = buildGLB({ mesh: uvSphere(8), images: [{ data: png }], material: { name: 't', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } } });
  const pg = parseGLB(glb);
  ok('glb parse', pg.json.asset.version === '2.0' && pg.json.images.length === 1);
  ok('unity guid', /^[0-9a-f]{32}$/.test(unityGuid('x')) && unityGuid('x') === unityGuid('x'));
  ok('plans', EXPORT_TARGETS.every(t => PLANS[t.id] && resolvePlan(t.id, { ...OPTS, name: 'T', uvScale: 1 }, null, DEFAULT_SCALARS).length > 0));
  out.maps = !!S.maps;
  out.last = last && { target: last.target, name: last.name, size: last.size };
  return out;
}
