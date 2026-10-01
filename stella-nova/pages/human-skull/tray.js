// ============================================================================
//  HUMAN SKULL  ·  tray.js — the specimen tray for the Catalogue layout
// ────────────────────────────────────────────────────────────────────────────
//  createTray() makes a shallow tray: a rounded slab (ExtrudeGeometry) and a
//  top face with a canvas texture. The texture is the felt (dark theme) or
//  the linen (light theme), a hairline round each slot, and a slot label:
//  the catalogue number and a short name, as on a museum drawer.
//  The top face sits at TRAY_Y (arrange.js), so the parts lie on it.
//
//  GREP MAP
//    function drawTop ....... felt, slot lines and labels into the canvas
//    tray.setLayout ......... new slots or size: rebuild the slab and redraw
//    tray.setTheme .......... felt or linen
//    tray.frame ............. fade in and out with the layout
// ============================================================================
import * as THREE from 'three';
import { TRAY_Y } from './arrange.js';

const RIM = 9;            // mm, the slab border round the top face
const H = 10;             // mm, slab height

export function shortName(m) {
  if (m.fdi) return 'Tooth ' + m.fdi;
  return m.name.replace(/^Right /, 'R. ').replace(/^Left /, 'L. ').replace(/ bone$/, '').replace('inferior nasal concha', 'concha');
}

export function createTray({ coarse, parts }) {
  const group = new THREE.Group();
  group.visible = false;
  const canvas = document.createElement('canvas');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const topMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.96, metalness: 0, transparent: true, opacity: 0 });
  const slabMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1d, roughness: 0.7, metalness: 0, transparent: true, opacity: 0 });
  let top = null, slab = null, layout = null, theme = 'dark', alpha = 0, want = 0;

  function drawTop() {
    if (!layout) return;
    const [W, D] = layout.size;
    const pxmm = Math.min(coarse ? 2.2 : 3.4, 2048 / Math.max(W, D));
    canvas.width = Math.round(W * pxmm); canvas.height = Math.round(D * pxmm);
    const g = canvas.getContext('2d'), dark = theme === 'dark';
    g.fillStyle = dark ? '#1c1b1f' : '#cdc2ae';
    g.fillRect(0, 0, canvas.width, canvas.height);
    // felt fibres: a few thousand faint specks
    let s = 1234567;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < canvas.width * canvas.height / 90; i++) {
      g.fillStyle = (rnd() > 0.5) ? (dark ? 'rgba(255,240,220,0.035)' : 'rgba(255,255,255,0.22)') : (dark ? 'rgba(0,0,0,0.25)' : 'rgba(90,70,40,0.07)');
      g.fillRect(rnd() * canvas.width, rnd() * canvas.height, 1 + rnd() * 1.6, 1 + rnd() * 1.6);
    }
    const X = x => (x + W / 2) * pxmm, Z = z => (z + D / 2) * pxmm;
    const ink = dark ? 'rgba(232,214,180,0.8)' : 'rgba(48,32,16,0.95)';
    const line = dark ? 'rgba(232,214,180,0.12)' : 'rgba(60,40,20,0.22)';
    // an inner hairline frame
    g.strokeStyle = line; g.lineWidth = Math.max(1, pxmm * 0.35);
    g.strokeRect(14 * pxmm, 14 * pxmm, (W - 28) * pxmm, (D - 28) * pxmm);
    for (const sl of layout.slots) {
      const m = parts[sl.i].m;
      const x = X(sl.x), y = Z(sl.z);
      g.strokeStyle = line;
      g.beginPath(); g.moveTo(x - sl.w * pxmm / 2, y - 3.2 * pxmm); g.lineTo(x + sl.w * pxmm / 2, y - 3.2 * pxmm); g.stroke();
      const num = String(m.i + 1).padStart(2, '0');
      const fs = Math.max(9, 3.9 * pxmm);
      g.fillStyle = ink; g.textBaseline = 'top';
      const label = shortName(m);
      g.font = `italic ${fs * 1.08}px "STIX Two Text", Georgia, serif`;
      const wl = g.measureText(label).width;
      g.font = `600 ${fs * 0.86}px Inter, system-ui, sans-serif`;
      const wn = g.measureText(num).width;
      const total = wn + fs * 0.5 + wl, x0 = x - total / 2;
      g.textAlign = 'left';
      g.fillText(num, x0, y);
      g.font = `italic ${fs * 1.08}px "STIX Two Text", Georgia, serif`;
      g.fillText(label, x0 + wn + fs * 0.5, y - fs * 0.08);
    }
    tex.needsUpdate = true;
  }

  function rounded(w, d, r) {
    const s = new THREE.Shape();
    s.moveTo(-w / 2 + r, -d / 2); s.lineTo(w / 2 - r, -d / 2); s.quadraticCurveTo(w / 2, -d / 2, w / 2, -d / 2 + r);
    s.lineTo(w / 2, d / 2 - r); s.quadraticCurveTo(w / 2, d / 2, w / 2 - r, d / 2); s.lineTo(-w / 2 + r, d / 2);
    s.quadraticCurveTo(-w / 2, d / 2, -w / 2, d / 2 - r); s.lineTo(-w / 2, -d / 2 + r); s.quadraticCurveTo(-w / 2, -d / 2, -w / 2 + r, -d / 2);
    return s;
  }
  const tray = {
    group,
    setLayout(l) {
      layout = l;
      const [W, D] = l.size;
      if (top) { group.remove(top, slab); top.geometry.dispose(); slab.geometry.dispose(); }
      const sg = new THREE.ExtrudeGeometry(rounded(W + 2 * RIM, D + 2 * RIM, 14), { depth: H, bevelEnabled: true, bevelThickness: 2, bevelSize: 2, bevelSegments: 3, curveSegments: 8 });
      sg.rotateX(-Math.PI / 2);
      slab = new THREE.Mesh(sg, slabMat);
      slab.position.y = TRAY_Y - H - 1.5;
      slab.receiveShadow = true;
      const tg = new THREE.PlaneGeometry(W, D);
      tg.rotateX(-Math.PI / 2);
      top = new THREE.Mesh(tg, topMat);
      top.position.y = TRAY_Y + 0.6;
      top.receiveShadow = true;
      group.add(slab, top);
      drawTop();
    },
    setTheme(t) {
      theme = t;
      slabMat.color.set(t === 'dark' ? 0x141316 : 0xb3a792);
      topMat.color.set(t === 'dark' ? 0xffffff : 0xb9b2a6);
      drawTop();
    },
    redraw: drawTop,
    show(on) { want = on ? 1 : 0; if (on) group.visible = true; },
    frame(dt) {
      alpha += (want - alpha) * Math.min(1, dt * 4);
      if (want === 0 && alpha < 0.01) { alpha = 0; group.visible = false; }
      topMat.opacity = alpha; slabMat.opacity = alpha;
      const solid = alpha > 0.98;
      if (topMat.transparent === solid) { topMat.transparent = slabMat.transparent = !solid; topMat.needsUpdate = slabMat.needsUpdate = true; }
      group.position.y = (1 - alpha) * -30;
    },
    dispose() { tex.dispose(); topMat.dispose(); slabMat.dispose(); if (top) { top.geometry.dispose(); slab.geometry.dispose(); } },
  };
  return tray;
}
