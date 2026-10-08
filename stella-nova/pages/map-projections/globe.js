// ============================================================================
//  MAP PROJECTIONS  ·  globe.js — the 3D globe beside the map (three.js r160)
// ----------------------------------------------------------------------------
//  The globe always faces the centre of the current map, turned so that the
//  map's "up" is up. It shows what the map does to the globe:
//    the surface the map is made on: a cylinder (along the clip-frame
//      axis, tangent at the equator or cut at the standard parallels), a
//      cone (cut at the two standard parallels) or a plane (tangent at the
//      centre). Pseudocylinders and interrupted maps have none.
//    the cut (red): where the map tears the globe open; the lobe edges of
//      an interrupted map; the edge circle of an azimuthal map.
//    a marker at the point under the pointer on either view.
//  Texture: NASA Blue Marble (public domain), the copy that ships with
//  ../ancient-earth (data/present/color-2k.jpg), loaded by URL.
//
//  Three.js frame: p(lon, lat) = (cos lat cos lon, sin lat, -cos lat sin lon),
//  which matches the UV layout of THREE.SphereGeometry.
//
//  GREP MAP
//    grep -n 'export class Globe'    setup, render on demand
//    grep -n 'setMap('               camera and the map's surface and cut
//    grep -n 'pick('                 screen point -> lon, lat
// ============================================================================
import * as THREE from 'three';
import { apply, D, PI, HALF, vec } from './proj.js';

const toThree = v => new THREE.Vector3(v[0], v[2], -v[1]);   // proj.js world vector -> three
const fromThree = p => [p.x, -p.z, p.y];

export class Globe {
  constructor(canvas, data, { texture } = {}) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(24, 1, 0.1, 100);
    this.root = new THREE.Group(); this.scene.add(this.root);
    const sph = new THREE.SphereGeometry(1, 96, 64);
    this.mat = new THREE.MeshBasicMaterial({ color: 0x9fb4c8 });
    this.ball = new THREE.Mesh(sph, this.mat); this.root.add(this.ball);
    if (texture) new THREE.TextureLoader().load(texture, t => {
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
      this.mat.map = t; this.mat.color.set(0xffffff); this.mat.needsUpdate = true; this.render();
    });
    // a soft rim, so the ball reads against the dark page
    const rim = new THREE.Mesh(new THREE.SphereGeometry(1.035, 64, 48), new THREE.ShaderMaterial({
      transparent: true, side: THREE.BackSide, depthWrite: false,
      vertexShader: 'varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(normalMatrix * normal); vec4 p = modelViewMatrix * vec4(position,1.0); vP = p.xyz; gl_Position = projectionMatrix * p; }',
      fragmentShader: 'varying vec3 vN; varying vec3 vP; void main(){ float f = pow(1.0 - abs(dot(normalize(-vP), vN)), 3.0); gl_FragColor = vec4(0.45, 0.68, 1.0, f * 0.55); }',
    }));
    this.root.add(rim);
    // coast and graticule lines
    this.root.add(lineSet(data.coast110, 1.0015, 0xf2e6c8, 0.55));
    const grat = [];
    for (let lo = -180; lo < 180; lo += 30) { const l = []; for (let la = -90; la <= 90; la += 3) l.push(vec(lo * D, la * D)); grat.push(l); }
    for (let la = -60; la <= 60; la += 30) { const l = []; for (let lo = -180; lo <= 180; lo += 3) l.push(vec(lo * D, la * D)); grat.push(l); }
    this.root.add(lineSet(grat, 1.001, 0xbfd4ee, 0.18));
    this.overlay = new THREE.Group(); this.root.add(this.overlay);
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.028, 0.045, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, depthTest: false }));
    this.marker.renderOrder = 10; this.marker.visible = false; this.root.add(this.marker);
    this.ray = new THREE.Raycaster();
    this.size = [1, 1];
  }
  resize(w, h, dpr = Math.min(2, window.devicePixelRatio || 1)) {
    this.size = [w, h];
    this.renderer.setPixelRatio(dpr); this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.render();
  }
  // m: a proj.js map. Faces its centre; draws its surface and cut.
  setMap(m, opt = {}) {
    this.m = m;
    const Rt = m.R ? [m.R[0], m.R[3], m.R[6], m.R[1], m.R[4], m.R[7], m.R[2], m.R[5], m.R[8]] : null;
    const centre = apply(Rt, [1, 0, 0]), up = apply(Rt, m.rot90 ? [0, -1, 0] : [0, 0, 1]);
    const dist = opt.dist ?? 5.2;
    const c = toThree(centre).multiplyScalar(dist);
    this.camera.position.copy(c); this.camera.up.copy(toThree(up)); this.camera.lookAt(0, 0, 0);
    this.overlay.clear();
    if (opt.surface !== false) this.overlay.add(surfaceFor(m));
    this.overlay.add(cutFor(m));
    this.render();
  }
  setMarker(lonlat) {
    if (!lonlat) { this.marker.visible = false; this.render(); return; }
    const p = toThree(vec(lonlat[0], lonlat[1])).multiplyScalar(1.004);
    this.marker.position.copy(p); this.marker.lookAt(p.clone().multiplyScalar(2));
    this.marker.visible = true; this.render();
  }
  // Canvas CSS px -> world [lon, lat] radians, or null off the ball.
  pick(x, y) {
    const v = new THREE.Vector2(x / this.size[0] * 2 - 1, -(y / this.size[1]) * 2 + 1);
    this.ray.setFromCamera(v, this.camera);
    const hit = this.ray.intersectObject(this.ball, false)[0];
    if (!hit) return null;
    const w = fromThree(hit.point.clone().normalize());
    return [Math.atan2(w[1], w[0]), Math.asin(Math.max(-1, Math.min(1, w[2])))];
  }
  render() { this.renderer.render(this.scene, this.camera); }
  dispose() { this.renderer.dispose(); try { this.renderer.forceContextLoss(); } catch (e) {} }
}

function lineSet(lines, r, color, opacity) {
  const pos = [];
  for (const l of lines) for (let i = 1; i < l.length; i++) {
    const a = l[i - 1], b = l[i];
    pos.push(a[0] * r, a[2] * r, -a[1] * r, b[0] * r, b[2] * r, -b[1] * r);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
}
// Clip frame -> three, for a direction given in clip-frame coordinates.
function clipToThree(m, v) { return toThree(apply(m.Mt, v)); }
function clipLL(m, l, p, r = 1) { const c = Math.cos(p); return clipToThree(m, [c * Math.cos(l) * r, c * Math.sin(l) * r, Math.sin(p) * r]); }

// The developable surface in the clip frame, as a translucent mesh with a
// few rulings. Standard parallels come from the map parameters.
function surfaceFor(m) {
  const fam = m.def.family, grp = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x7fc8ff, transparent: true, opacity: 0.10, side: THREE.DoubleSide, depthWrite: false });
  const lmat = new THREE.LineBasicMaterial({ color: 0x9fd6ff, transparent: true, opacity: 0.55 });
  const pts = [], lines = [];
  // a lathe about the clip-frame axis from profile [[r, z], ...]
  const lathe = prof => {
    const N = 72, pos = [], idx = [];
    for (let i = 0; i <= N; i++) { const a = i / N * 2 * PI; for (const [r, z] of prof) { const v = clipToThree(m, [r * Math.cos(a), r * Math.sin(a), z]); pos.push(v.x, v.y, v.z); } }
    const P = prof.length;
    for (let i = 0; i < N; i++) for (let j = 0; j < P - 1; j++) { const a = i * P + j, b = (i + 1) * P + j; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    grp.add(new THREE.Mesh(g, mat));
    for (let i = 0; i < 12; i++) { const a = i / 12 * 2 * PI; lines.push(prof.map(([r, z]) => clipToThree(m, [r * Math.cos(a), r * Math.sin(a), z]))); }
    for (const [r, z] of [prof[0], prof[prof.length - 1]]) { const ring = []; for (let i = 0; i <= N; i++) { const a = i / N * 2 * PI; ring.push(clipToThree(m, [r * Math.cos(a), r * Math.sin(a), z])); } lines.push(ring); }
  };
  if (fam === 'cylindrical') {
    const k = m.key === 'gall-peters' ? Math.cos(PI / 4) : 1;
    lathe([[k, -1.25], [k, 1.25]]);
  } else if (fam === 'conic' && m.key !== 'polyconic') {
    const p1 = m.par.lat1, p2 = m.key === 'bonne' ? m.par.lat1 : m.par.lat2;
    let zA, prof;
    if (Math.abs(p1 - p2) < 1e-3) { const s = Math.sin(p1) || 1e-3; zA = 1 / s; }
    else { const r1 = Math.cos(p1), z1 = Math.sin(p1), r2 = Math.cos(p2), z2 = Math.sin(p2); zA = z1 - r1 * (z2 - z1) / (r2 - r1); }
    const sgn = Math.sign(zA) || 1, zEnd = -0.35 * sgn, zSt = Math.min(Math.abs(zA), 3.2) * sgn;
    const rAt = z => { const r1 = Math.cos(p1), z1 = Math.sin(p1); return r1 * (zA - z) / (zA - z1); };
    prof = [[Math.max(0, rAt(zSt)), zSt], [rAt(zEnd), zEnd]];
    lathe(prof);
  } else if (fam === 'azimuthal') {
    // a disc tangent at the centre (the clip-frame pole)
    lathe([[0.0001, 1], [1.15, 1]]);
  }
  for (const l of lines) { const g = new THREE.BufferGeometry().setFromPoints(l); grp.add(new THREE.Line(g, lmat)); }
  return grp;
}
// The cut and the edges, in red.
function cutFor(m) {
  const grp = new THREE.Group(), mat = new THREE.LineBasicMaterial({ color: 0xff6a6a, transparent: true, opacity: 0.95, depthTest: true });
  const add = pts => grp.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
  const r = 1.006, N = 90;
  for (const R of m.rects) {
    const [l0, l1, p0, p1] = R;
    const fam = m.def.family;
    if (fam === 'azimuthal') {
      if (p0 > -HALF + 1e-6) { const ring = []; for (let i = 0; i <= 180; i++) ring.push(clipLL(m, -PI + i / 180 * 2 * PI, p0, r)); add(ring); }
      continue;
    }
    // the two meridian edges of each rect (the cut or a lobe edge)
    for (const l of [l0, l1]) { const pts = []; for (let i = 0; i <= N; i++) pts.push(clipLL(m, l, p0 + (p1 - p0) * i / N, r)); add(pts); }
    // the lat edges where they are not the poles
    for (const p of [p0, p1]) if (Math.abs(Math.abs(p) - HALF) > 1e-6 && (m.rects.length === 1 || Math.abs(p) > 1e-6)) { const pts = []; for (let i = 0; i <= N; i++) pts.push(clipLL(m, l0 + (l1 - l0) * i / N, p, r)); add(pts); }
  }
  return grp;
}
