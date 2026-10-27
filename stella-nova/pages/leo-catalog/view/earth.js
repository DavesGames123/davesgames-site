// ============================================================================
//  LEO CATALOG  ·  view/earth.js — the globe, atmosphere and star backdrop
// ----------------------------------------------------------------------------
//  The static scene parts. main.js owns the renderer, scene and earthRoot and
//  passes them in; the animate loop writes earthUniforms.uSunDir each frame.
//    buildEarthMap   draws the world-atlas coastlines (topojson global) and a
//                    lat/lon grid into a 2D canvas, then wraps it on a sphere
//                    with the day/night shader (shaders/earth.*.glsl)
//    addBackdrop     the placeholder shell, the fresnel atmosphere
//                    (shaders/atmosphere.*.glsl) and the "stars" points
//  The star field uses Math.random once, at boot.
//
//  grep -n targets: "export const earthUniforms", "export async function
//  buildEarthMap", "function drawRings", "function walkLand",
//  "export function addBackdrop", "stars.name"
// ============================================================================
import * as THREE from 'three';
import { splash, setGauge } from './boot-ui.js';

// ── Earth canvas texture (continents + grid baked in, halos for glow) ──
export const earthUniforms = {
  uMap: { value: null },
  uSunDir: { value: new THREE.Vector3(1, 0, 0) },
};

// Build the Earth texture by drawing the world-atlas coastline data and a
// lat/lon grid into a 2D canvas, then wrap it on a sphere with the day/night
// shader. Runs at boot; drives the GEODESY gauge as it fetches and draws.
export async function buildEarthMap(renderer, earthRoot, SH, IS_MOBILE) {
  splash('fetch continents (110m)');
  setGauge('geo', 10);
  const res = await fetch(new URL('../../../vendor/world-atlas@2.0.2/land-110m.json', import.meta.url));
  if (!res.ok) throw new Error('HTTP '+res.status);
  setGauge('geo', 40);
  const topo = await res.json();
  const land = topojson.feature(topo, topo.objects.land);
  setGauge('geo', 60);

  const W = IS_MOBILE ? 2048 : 4096;
  const H = IS_MOBILE ? 1024 : 2048;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  // Sea — deep navy
  ctx.fillStyle = '#020816';
  ctx.fillRect(0, 0, W, H);

  // Lat/lon grid (baked in, halo glow)
  function drawLat(d) { const y = (90-d)/180*H; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
  function drawLon(d) { const x = (d+180)/360*W; ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(120, 240, 150, 0.13)';
  ctx.lineWidth = W / 500;
  for (let lat = -75; lat <= 75; lat += 15) drawLat(lat);
  for (let lon = -180; lon < 180; lon += 15) drawLon(lon);
  ctx.strokeStyle = 'rgba(140, 220, 160, 0.42)';
  ctx.lineWidth = Math.max(1, W / 2000);
  for (let lat = -75; lat <= 75; lat += 15) if (lat !== 0) drawLat(lat);
  for (let lon = -180; lon < 180; lon += 15) if (lon !== 0 && lon !== -180) drawLon(lon);
  ctx.strokeStyle = 'rgba(180, 250, 200, 0.78)';
  ctx.lineWidth = W / 1100;
  drawLat(0); drawLon(0); drawLon(180); drawLon(-180);

  // Continents
  // Trace a set of polygon rings (in lon/lat) into the equirectangular canvas.
  function drawRings(rings, op) {
    ctx.beginPath();
    for (const ring of rings) {
      ring.forEach((p, i) => {
        const x = (p[0]+180)/360*W;
        const y = (90-p[1])/180*H;
        if (i === 0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      });
      ctx.closePath();
    }
    if (op === 'fill') ctx.fill();
    else if (op === 'stroke') ctx.stroke();
  }
  // Visit every polygon in the land geometry, calling fn with its rings.
  function walkLand(fn) {
    function walk(g) {
      if (!g) return;
      if (g.type === 'Polygon') fn(g.coordinates);
      else if (g.type === 'MultiPolygon') g.coordinates.forEach(fn);
    }
    if (land.type === 'FeatureCollection') land.features.forEach(f => walk(f.geometry));
    else if (land.type === 'Feature') walk(land.geometry);
    else walk(land);
  }
  ctx.fillStyle = 'rgba(38, 110, 58, 0.95)';
  walkLand(rings => drawRings(rings, 'fill'));
  ctx.strokeStyle = 'rgba(150, 255, 180, 0.42)';
  ctx.lineWidth = W / 450; ctx.lineJoin = 'round';
  walkLand(rings => drawRings(rings, 'stroke'));
  ctx.strokeStyle = '#b8ffd0';
  ctx.lineWidth = Math.max(1, W / 1500);
  walkLand(rings => drawRings(rings, 'stroke'));

  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;
  earthUniforms.uMap.value = tex;

  const earthGeo = new THREE.SphereGeometry(0.999, 128, 96);
  const earthMat = new THREE.ShaderMaterial({
    uniforms: earthUniforms,
    vertexShader: SH['shaders/earth.vert.glsl'],
    fragmentShader: SH['shaders/earth.frag.glsl'],
  });
  earthRoot.add(new THREE.Mesh(earthGeo, earthMat));
  setGauge('geo', 100, { done: true });
  splash('earth map ok', 'ok');
}

// Add the static scene parts in this order: the dark placeholder globe (shown
// until the real Earth texture is built, or if the continent fetch fails;
// main.js removes it once buildEarthMap() succeeds), the atmosphere and the
// stars. Returns the placeholder.
export function addBackdrop(scene, earthRoot, SH, IS_MOBILE) {
  const fallbackShell = new THREE.Mesh(
    new THREE.SphereGeometry(0.992, 64, 48),
    new THREE.MeshBasicMaterial({ color: 0x010906 })
  );
  earthRoot.add(fallbackShell);

  // Atmosphere fresnel
  // A slightly larger back-side sphere with the atmosphere shader adds a rim glow.
  {
    const g = new THREE.SphereGeometry(1.055, 64, 48);
    const m = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0x5fb872) } },
      vertexShader: SH['shaders/atmosphere.vert.glsl'],
      fragmentShader: SH['shaders/atmosphere.frag.glsl'],
      transparent: true, blending: THREE.AdditiveBlending,
      side: THREE.BackSide, depthWrite: false,
    });
    scene.add(new THREE.Mesh(g, m));
  }

  // Stars
  // Scatter points on a large sphere around the scene as a fixed star backdrop.
  {
    const N = IS_MOBILE ? 800 : 1500;
    const pos = new Float32Array(N*3);
    for (let i = 0; i < N; i++) {
      const u = Math.random(), v = Math.random();
      const th = 2*Math.PI*u, ph = Math.acos(2*v-1);
      const r = 40 + Math.random()*10;
      pos[i*3+0] = r*Math.sin(ph)*Math.cos(th);
      pos[i*3+1] = r*Math.cos(ph);
      pos[i*3+2] = r*Math.sin(ph)*Math.sin(th);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({
      color: 0xfff5d8, size: 0.015, sizeAttenuation: true,
      transparent: true, opacity: 0.5, depthWrite: false,
    });
    const stars = new THREE.Points(g, m);
    stars.name = 'stars';   // xr.js hides it in AR
    scene.add(stars);
  }
  return fallbackShell;
}
