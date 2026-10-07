// ============================================================================
//  IMAGE WORLDS  ·  tests.mjs — node stella-nova/pages/image-worlds/tests.mjs
// ----------------------------------------------------------------------------
//  Checks the DOM-free modules:
//    names ...... parseIndexedName: N-slug.ext, hidden request JSON, others
//    manifest ... parseManifest: a good entry, a bad version, unsafe paths,
//                 a duplicate slug, saver, start and background checks,
//                 url encoding
//    loader ..... loadWorlds on a fixture in the image-blaster layout (two
//                 worlds under image-blaster/worlds/, one loose .ply): roots,
//                 the latest complete version, splat keys, semantics,
//                 scene.json overrides, objects (latest .glb, no-model dirs
//                 left out), ambient order, hidden files skipped, pickSplat
//    scene ...... sanitizeScene drops bad placements, clamps the shadow
//                 opacity, keeps the sun
//    header ..... parseSplatHeader on SPZ (built here, a cut stream, and the
//                 shipped sample), PLY, .splat, .ksplat, a bad gzip, a non-splat
//    placement .. matchPlacements and the default grid
//    ground ..... createGround: plane, a box top, a wall block, no plane
//    shipped .... worlds/manifest.json parses, every listed file exists with
//                 its listed size, and the sample world loads from disk
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseIndexedName, parseManifest, loadWorlds, pickSplat, sanitizeScene, entryFromBytes, matchPlacements, gridPosition } from './worlds.js';
import { parseSplatHeader, sniffFormat, HEAD_BYTES } from './splat-header.js';
import { createGround } from './ground.js';
import { writeSpz } from './tools/formats.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
let fail = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fail++; console.log('FAIL', msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')');

// ── names ──────────────────────────────────────────────────────────────────
eq(parseIndexedName('3-world-full_res.spz'), { index: 3, slug: 'world-full_res', ext: '.spz', hidden: false }, 'names: indexed spz');
eq(parseIndexedName('.2-lamp__model-request.json'), { index: 2, slug: 'lamp', scope: 'model', ext: '.json', hidden: true }, 'names: scoped request');
eq(parseIndexedName('.0-world-request.json').hidden, true, 'names: world request is hidden');
eq(parseIndexedName('object.json'), undefined, 'names: plain name is not indexed');

// ── manifest ───────────────────────────────────────────────────────────────
{
  const m = parseManifest({ version: 1, worlds: [
    { slug: 'garden', name: 'Garden', background: '#AABBCC', files: ['project.json', 'output/world/0-world full.spz', '../etc/passwd', '/abs', 'http://x/y', 'a\\b'], saver: { target: [0, 1, -2], radius: [1, 2] }, start: { position: [0, 1, 0], target: [0, 1, -1] } },
    { slug: 'garden', files: ['a'] },
    { slug: '../up', files: ['a'] },
    { slug: 'none', files: [] },
    { slug: 'badsaver', files: ['x.spz'], saver: { target: [0, 'a', 0] } },
  ] }, 'worlds/');
  eq(m.worlds.map(w => w.slug), ['garden', 'badsaver'], 'manifest: kept slugs');
  eq(m.worlds[0].entries.map(e => e.path), ['garden/project.json', 'garden/output/world/0-world full.spz'], 'manifest: unsafe paths dropped');
  eq(m.worlds[0].entries[1].url, 'worlds/garden/output/world/0-world%20full.spz', 'manifest: url encodes each part');
  eq(m.worlds[0].saver, { target: [0, 1, -2], radius: [1, 2] }, 'manifest: saver kept');
  eq(m.worlds[1].saver, null, 'manifest: bad saver dropped');
  ok(m.worlds[0].start && m.worlds[0].start.target[2] === -1, 'manifest: start kept');
  eq([m.worlds[0].background, m.worlds[1].background], ['#aabbcc', ''], 'manifest: background colour checked');
  eq(m.errors.length, 4, 'manifest: four errors (unsafe paths, duplicate, bad slug, no files)');
  eq(parseManifest({ version: 2, worlds: [] }).errors.length, 1, 'manifest: version 2 refused');
}

// ── a fixture in the image-blaster layout ──────────────────────────────────
const splats = (count, seed = 1) => {
  let s = seed; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const o = { n: count, pos: new Float32Array(3 * count), dc: new Float32Array(3 * count), alpha: new Float32Array(count), lnScale: new Float32Array(3 * count), quat: new Float32Array(4 * count) };
  for (let i = 0; i < 3 * count; i++) { o.pos[i] = (r() - 0.5) * 4; o.dc[i] = r() - 0.5; o.lnScale[i] = -4 + r(); }
  for (let i = 0; i < count; i++) { o.alpha[i] = r(); o.quat.set([0, 0, 0, 1], 4 * i); }
  return new Uint8Array(writeSpz(o));
};
const J = o => JSON.stringify(o);
const spzA = splats(1000), spzB = splats(250, 7);
const W = 'image-blaster/worlds/';
const fixture = {
  [W + 'garden/project.json']: J({ slug: 'garden', display_name: 'Moss garden', notes: 'n' }),
  [W + 'garden/scene.json']: J({ version: 1, instances: [
    { instanceId: 'lamp-a', objectId: 'lamp-1', physics: 'static', position: [1, 0, -2], rotation: [0, 1, 0], scale: [2, 2, 2] },
    { instanceId: 'lamp-b', objectId: 'nope', assetId: 'garden/lamp/1', position: [0, 0, -3], rotation: [0, 0, 0], scale: [1, 1, 1] },
    { instanceId: 'bad', objectId: 'lamp-1', position: [0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  ], metricScaleFactor: 2, sun: { intensity: 2, rotation: [0.1, 0.2, 0] } }),
  [W + 'garden/image.json']: J({ caption: 'x' }),
  [W + 'garden/source/0-moss.png']: 'png0',
  [W + 'garden/source/1-moss-clean.png']: 'png1',
  [W + 'garden/source/moss.json']: J({}),
  [W + 'garden/output/world/.0-world-request.json']: J({ status: 'done' }),
  [W + 'garden/output/world/0-world.json']: J({ world_id: 'a', assets: { caption: 'Moss and stones', splats: { semantics_metadata: { metric_scale_factor: 1.5, ground_plane_offset: 0.4, flip_y: false } } } }),
  [W + 'garden/output/world/0-world-full_res.spz']: spzA,
  [W + 'garden/output/world/0-world-500k.spz']: spzB,
  [W + 'garden/output/world/0-world.glb']: 'glb',
  [W + 'garden/output/world/0-world-pano.png']: 'pano',
  [W + 'garden/output/world/0-world-thumbnail.webp']: 'thumb',
  [W + 'garden/output/world/1-world.json']: J({ world_id: 'b', assets: { splats: { semantics_metadata: { metric_scale_factor: 1.5, ground_plane_offset: 0.4 } } } }),
  [W + 'garden/output/world/1-world-100k.spz']: spzB,
  [W + 'garden/output/world/2-world.json']: J({ world_id: 'c' }),
  [W + 'garden/output/sfx/0-ambient-loop-2.mp3']: 'a2',
  [W + 'garden/output/sfx/0-ambient-loop-1.mp3']: 'a1',
  [W + 'garden/output/sfx/.DS_Store']: 'x',
  [W + 'garden/output/lamp/object.json']: J({ object: { name: 'Paper lamp' } }),
  [W + 'garden/output/lamp/0-lamp.glb']: 'm0',
  [W + 'garden/output/lamp/1-lamp.glb']: 'm1',
  [W + 'garden/output/lamp/1-lamp-thumbnail.png']: 't1',
  [W + 'garden/output/lamp/.1-lamp__model-request.json']: J({ status: 'done' }),
  [W + 'garden/output/lamp/sfx/0-impact-lamp-2.mp3']: 's2',
  [W + 'garden/output/lamp/sfx/0-impact-lamp-1.mp3']: 's1',
  [W + 'garden/output/chair/object.json']: J({ object: { name: 'Chair' } }),
  [W + 'dunes/project.json']: J({ slug: 'dunes' }),
  [W + 'dunes/output/world/0-world.json']: J({}),
  [W + 'dunes/output/world/0-world-500k.spz']: spzB,
  ['image-blaster/input/capture.ply']: 'ply\nformat binary_little_endian 1.0\nelement vertex 3\nproperty float x\nend_header\n',
  ['image-blaster/README.md']: '# readme',
};
const entries = Object.entries(fixture).map(([p, b]) => entryFromBytes(p, b));
const worlds = await loadWorlds(entries);
eq(worlds.map(w => w.slug), ['dunes', 'garden', 'capture'], 'loader: two roots and one loose splat');
const g = worlds.find(w => w.slug === 'garden'), d = worlds.find(w => w.slug === 'dunes'), c = worlds.find(w => w.slug === 'capture');
eq(g.name, 'Moss garden', 'loader: display_name from project.json');
eq(d.name, 'Dunes', 'loader: name from the slug');
eq(g.version, 1, 'loader: latest complete version (2-world.json has no splat)');
eq(g.versions.map(v => v.index), [0, 1, 2], 'loader: three versions');
eq(Object.keys(g.splats), ['100k'], 'loader: splat keys of version 1');
eq(Object.keys(g.versions[0].splats).sort(), ['500k', 'full_res'], 'loader: splat keys of version 0');
eq(g.versions[0].collider && g.versions[0].collider.path, W + 'garden/output/world/0-world.glb', 'loader: collider of version 0');
eq(g.collider, null, 'loader: version 1 has no collider');
eq(g.source.path, W + 'garden/source/0-moss.png', 'loader: source image index 0');
eq(g.sourceVersions.length, 2, 'loader: two source images');
// semantics: version 1 has scale 1.5, offset 0.4, flip_y default true;
// scene.json metricScaleFactor 2 scales the offset by 2 / 1.5.
eq(g.semantics.flipY, true, 'loader: flip_y default true');
ok(Math.abs(g.semantics.metricScale - 2) < 1e-9 && Math.abs(g.semantics.groundOffset - 0.4 * 2 / 1.5) < 1e-9, 'loader: scene.json metric scale and scaled ground offset');
eq(g.versions[0].semantics.flipY, false, 'loader: flip_y false read');
eq(g.objects.map(o => [o.id, o.name, o.model.path.split('/').pop(), o.thumb && o.thumb.path.split('/').pop(), o.sfx.map(e => e.path.split('/').pop())]),
  [['lamp-1', 'Paper lamp', '1-lamp.glb', '1-lamp-thumbnail.png', ['0-impact-lamp-1.mp3', '0-impact-lamp-2.mp3']]], 'loader: object with latest glb, chair (no glb) left out');
eq(g.ambient.map(e => e.path.split('/').pop()), ['0-ambient-loop-1.mp3', '0-ambient-loop-2.mp3'], 'loader: ambient loops sorted, .DS_Store skipped');
eq(g.scene.instances.length, 2, 'loader: bad placement dropped');
eq(g.caption, '', 'loader: caption of version 1 (none)');
eq(c.loose, true, 'loader: loose ply world');
eq(pickSplat(g.versions[0] && { splats: g.versions[0].splats }, 'low').key, '500k', 'pickSplat: low falls back to 500k');
eq(pickSplat({ splats: g.versions[0].splats }, 'high').key, 'full_res', 'pickSplat: high takes full_res');
eq(pickSplat({ splats: g.versions[0].splats }, 'mid').key, '500k', 'pickSplat: mid takes 500k');
eq(pickSplat({ splats: {} }, 'mid'), null, 'pickSplat: none');
eq((await loadWorlds([entryFromBytes('notes.txt', 'x')])).length, 0, 'loader: no world in unrelated files');
{
  const [w] = await loadWorlds([entryFromBytes('myworld/output/world/0-world-full_res.spz', spzA)]);
  ok(w && w.slug === 'myworld' && w.splats.full_res && w.warnings.some(x => /flip_y assumed/.test(x)), 'loader: output/world with no world.json still loads');
}

// ── scene ──────────────────────────────────────────────────────────────────
{
  const s = sanitizeScene({ version: 1, instances: [{ instanceId: 'a', objectId: 'b', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], physics: 'fly' }, { instanceId: 'c', objectId: 'd', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }], shadowCatcherOpacity: 3, shadowCatcherColor: '#ABCDEF', sun: { intensity: 1, rotation: [0, 0, 0], environmentIntensity: 2 } });
  eq(s.instances.map(i => [i.instanceId, i.physics]), [['c', 'rigidbody']], 'scene: bad physics dropped, default rigidbody');
  eq([s.shadowCatcherOpacity, s.shadowCatcherColor, s.sun.environmentIntensity], [1, '#abcdef', 2], 'scene: opacity clamped, colour lower case, sun kept');
  eq(sanitizeScene({ version: 2, instances: [] }), null, 'scene: version 2 refused');
}

// ── header ─────────────────────────────────────────────────────────────────
{
  const h = await parseSplatHeader(spzA.subarray(0, HEAD_BYTES), spzA.length, 'a.spz');
  eq([h.format, h.count, h.version, h.shDegree, h.fractionalBits, h.antialiased], ['spz', 1000, 2, 0, 12, false], 'header: spz written here');
  // A cut gzip stream still gives the header; a cut inside the deflate
  // table fails at once, with no wait for more bytes.
  eq((await parseSplatHeader(spzA.subarray(0, 1024), spzA.length, 'a.spz')).count, 1000, 'header: spz from the first 1 KiB');
  let cut = ''; try { await parseSplatHeader(spzA.subarray(0, 12), spzA.length, 'a.spz'); } catch (e) { cut = e.message; }
  ok(/ends before the SPZ header/.test(cut), 'header: 12 bytes fail cleanly (' + cut + ')');
  const ply = new TextEncoder().encode('ply\nformat binary_little_endian 1.0\nelement vertex 42\n' + ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', ...Array.from({ length: 9 }, (_, i) => 'f_rest_' + i), 'opacity', 'scale_0', 'rot_0'].map(p => 'property float ' + p).join('\n') + '\nend_header\n');
  const p = await parseSplatHeader(ply, ply.length + 42 * 64, 'x.ply');
  eq([p.format, p.count, p.shDegree, p.warn], ['ply', 42, 1, ''], 'header: ply with SH degree 1');
  const pp = await parseSplatHeader(new TextEncoder().encode('ply\nformat ascii 1.0\nelement vertex 5\nproperty float x\nend_header\n'), 100, 'm.ply');
  ok(/not a Gaussian splat PLY/.test(pp.warn), 'header: mesh ply flagged');
  eq((await parseSplatHeader(new Uint8Array(64), 32 * 10, 'a.splat')).count, 10, 'header: .splat count from size');
  const ks = new Uint8Array(4096); ks[0] = 0; ks[1] = 1; new DataView(ks.buffer).setUint32(16, 777, true);
  eq((await parseSplatHeader(ks, 9000, 'a.ksplat')).count, 777, 'header: ksplat count');
  let err = '';
  try { await parseSplatHeader(new Uint8Array(zlib.gzipSync(Buffer.from('not spz at all, no magic here'))), 50, 'b.spz'); } catch (e) { err = e.message; }
  ok(/not SPZ/.test(err), 'header: gzip that is not spz refused (' + err + ')');
  err = ''; try { await parseSplatHeader(new TextEncoder().encode('hello'), 5, 'x.txt'); } catch (e) { err = e.message; }
  ok(/not a splat file/.test(err), 'header: text refused');
  eq(sniffFormat(new Uint8Array([0x1f, 0x8b, 8, 0]), 'x.bin'), 'spz', 'header: sniff gzip');
}

// ── placement ──────────────────────────────────────────────────────────────
{
  const objs = [{ id: 'lamp-1', dir: 'lamp' }, { id: 'cup', dir: 'cup' }];
  eq(matchPlacements(objs, { instances: [{ objectId: 'lamp-1' }, { objectId: 'x', assetId: 'w/cup' }, { objectId: 'cup-3' }, { objectId: 'ghost' }] }).map(p => p.obj.id), ['lamp-1', 'cup', 'cup'], 'placement: by objectId, assetId, folder');
  eq(matchPlacements(objs, null).map(p => p.inst.position), [gridPosition(0, 2), gridPosition(1, 2)], 'placement: default grid');
  eq([gridPosition(0, 5), gridPosition(3, 5)], [[-1, 0, -2], [-1, 0, -3]], 'placement: grid rows of three at z -2');
}

// ── ground ─────────────────────────────────────────────────────────────────
{
  // A unit box on the plane, from (0,0,0) to (1,1,1): its top as two triangles,
  // and a wall at x = 3 from z -5..5, y 0..3.
  const P = new Float32Array([0, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 3, 0, -5, 3, 0, 5, 3, 3, 5, 3, 3, -5]);
  const I = new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  const gr = createGround({ positions: P, index: I });
  eq(gr.groundAt(0.5, 2, 0.5), 1, 'ground: box top');
  eq(gr.groundAt(2, 2, 0.5), 0, 'ground: plane beside the box');
  eq(gr.groundAt(0.5, 0.5, 0.5), 0, 'ground: under the top, the plane');
  eq(gr.blockAt({ x: 2.65, y: 1, z: 0 }, { x: 0.1, y: 0, z: 0 }), true, 'ground: wall blocks within 0.3 m');
  eq(gr.blockAt({ x: 1.5, y: 1, z: 0 }, { x: 0.1, y: 0, z: 0 }), false, 'ground: wall far away');
  eq(gr.blockAt({ x: 2.5, y: 1, z: 0 }, { x: -0.1, y: 0, z: 0 }), false, 'ground: moving away is free');
  eq(createGround({ plane: false }).groundAt(0, 1, 0), -Infinity, 'ground: no plane, no collider');
}

// ── shipped manifest and sample ────────────────────────────────────────────
{
  const raw = JSON.parse(fs.readFileSync(path.join(HERE, 'worlds/manifest.json'), 'utf8'));
  const m = parseManifest(raw, 'worlds/');
  eq(m.errors, [], 'shipped: manifest has no errors');
  for (const w of raw.worlds) {
    const missing = w.files.filter(f => !fs.existsSync(path.join(HERE, 'worlds', w.slug, f)));
    eq(missing, [], 'shipped: ' + w.slug + ' files exist');
    const bad = w.files.filter(f => fs.existsSync(path.join(HERE, 'worlds', w.slug, f)) && fs.statSync(path.join(HERE, 'worlds', w.slug, f)).size !== w.sizes[f]);
    eq(bad, [], 'shipped: ' + w.slug + ' sizes match');
    const disk = w.files.map(f => entryFromBytes(w.slug + '/' + f, new Uint8Array(fs.readFileSync(path.join(HERE, 'worlds', w.slug, f)))));
    const [sw] = await loadWorlds(disk);
    ok(sw && Object.keys(sw.splats).length > 0 && sw.warnings.length === 0, 'shipped: ' + w.slug + ' loads with no warnings (' + (sw && sw.warnings.join('; ')) + ')');
    for (const [k, e] of Object.entries(sw.splats)) {
      const b = await e.bytes(), h = await parseSplatHeader(b.subarray(0, HEAD_BYTES), b.length, e.path);
      ok(h.format === 'spz' && h.count > 1000 && !h.warn, 'shipped: ' + w.slug + ' ' + k + ' spz header (' + h.count + ' splats)');
    }
    if (w.slug === 'sample-still-life') {
      eq([sw.objects.length, sw.ambient.length, sw.scene.instances.length, !!sw.collider, !!sw.source], [3, 1, 3, true, true], 'shipped: sample has 3 meshes, 1 loop, 3 placements, a collider, a source image');
      eq(matchPlacements(sw.objects, sw.scene).length, 3, 'shipped: every sample placement finds its mesh');
    }
  }
}

console.log(`${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
