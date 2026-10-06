// ============================================================================
//  PARTICLE COLLIDER  ·  detector.js — the barrel detector in 3D
// ----------------------------------------------------------------------------
//  Draws the tubes of geometry.js (the same sizes the engine tracks through)
//  as translucent shells with a cut-away wedge. Units: mm; the beam runs
//  along z. Each shell is an extruded annular sector; the two cut faces
//  are a separate, more opaque "section" mesh, so the cut reads like the
//  slice drawings of real detectors. Blueprint lines mark the edges, the
//  HCAL scintillator planes and the yoke sectors.
//
//  Z-FIGHTING. Thick shells shrink by 3 mm on every side, so two volumes
//  that touch (HCAL barrel and endcap at |z| = 3300) never share a plane.
//  Thin layers (silicon, beam pipe) are open surfaces with no cut face.
//  Section faces sit on the cut planes of their own shell only.
//
//  createDetector(THREE, D, o) -> { group, setCut(mode), setShow(sys, on),
//    labels: [{ id, name, pos }], dispose }
//    cut modes: 'wedge' (100 deg open), 'half' (180 deg), 'quarter' (270
//    deg open: a quarter stays), 'none' (closed, more transparent)
//
//  GREP MAP  const LOOK (colours) · function sector · function build
// ============================================================================
const LOOK = {
  pipe: { c: '#9fc4ff', o: 0.30, e: 0.25 },
  pix: { c: '#8fe3ff', o: 0.16, e: 0.35 },
  sct: { c: '#64b5f0', o: 0.09, e: 0.22 },
  ecal: { c: '#36d6b6', o: 0.16, e: 0.10, sec: 0.55 },
  hcal: { c: '#d99a4e', o: 0.13, e: 0.06, sec: 0.5 },
  sol: { c: '#c7d0de', o: 0.20, e: 0.03, sec: 0.6, metal: 0.9 },
  yoke: { c: '#b4313f', o: 0.14, e: 0.05, sec: 0.55, metal: 0.6 },
  mu: { c: '#e7ecf6', o: 0.10, e: 0.12, sec: 0.35 },
};
export const SYS_NAMES = {
  pix: 'Pixel tracker', sct: 'Strip tracker', ecal: 'EM calorimeter · PbWO₄', hcal: 'Hadron calorimeter · brass', sol: 'Solenoid · 3.8 T', yoke: 'Return yoke · iron', mu: 'Muon chambers', pipe: 'Beam pipe · Be',
};

export function createDetector(THREE, D, o = {}) {
  const group = new THREE.Group();
  const mats = {}, lineMats = {};
  const mat = (sys, sec) => {
    const k = sys + (sec ? ':s' : '');
    if (mats[k]) return mats[k];
    const L = LOOK[sys];
    const m = new THREE.MeshStandardMaterial({ color: L.c, emissive: L.c, emissiveIntensity: (sec ? 0.08 : L.e) * 0.35, transparent: true, opacity: (sec ? L.sec * 0.55 : L.o * 0.45), depthWrite: false, side: sec ? THREE.DoubleSide : THREE.FrontSide, metalness: L.metal || 0.3, roughness: 0.45, envMapIntensity: 0.35 });
    if (sec) { m.polygonOffset = true; m.polygonOffsetFactor = 1; m.polygonOffsetUnits = 1; }
    return (mats[k] = m);
  };
  const lmat = (sys, a = 0.35) => lineMats[sys + a] || (lineMats[sys + a] = new THREE.LineBasicMaterial({ color: LOOK[sys].c, transparent: true, opacity: a, blending: THREE.AdditiveBlending, depthWrite: false }));
  let parts = [], cut = o.cut || 'wedge', cutCentre = o.cutCentre ?? Math.PI * 0.25;
  const show = { pix: true, sct: true, ecal: true, hcal: true, sol: true, yoke: true, mu: true, pipe: true };

  // the open angle range of the current cut
  const range = () => {
    const open = { wedge: 100, half: 180, quarter: 270, none: 0 }[cut] * Math.PI / 180;
    return { a0: cutCentre + open / 2, a1: cutCentre + 2 * Math.PI - open / 2, open };
  };
  function sectorShape(r0, r1, a0, a1, closed) {
    const s = new THREE.Shape();
    if (closed) {
      s.absarc(0, 0, r1, 0, Math.PI * 2, false);
      if (r0 > 0) { const h = new THREE.Path(); h.absarc(0, 0, r0, 0, Math.PI * 2, true); s.holes.push(h); }
      return s;
    }
    s.moveTo(r1 * Math.cos(a0), r1 * Math.sin(a0));
    s.absarc(0, 0, r1, a0, a1, false);
    if (r0 > 0) { s.lineTo(r0 * Math.cos(a1), r0 * Math.sin(a1)); s.absarc(0, 0, r0, a1, a0, true); }
    else s.lineTo(0, 0);
    s.closePath();
    return s;
  }
  function shell(sys, r0, r1, z0, z1, shrink = 3, seg = 96) {
    const { a0, a1, open } = range(), closed = open === 0;
    r0 = r0 > 0 ? r0 + shrink : 0; r1 -= shrink; z0 += shrink; z1 -= shrink;
    const g = new THREE.ExtrudeGeometry(sectorShape(r0, r1, a0, a1, closed), { depth: z1 - z0, bevelEnabled: false, curveSegments: seg, steps: 1 });
    g.translate(0, 0, z0);
    const m = new THREE.Mesh(g, mat(sys)); m.userData.sys = sys; m.renderOrder = 1;
    const out = [m];
    if (!closed) {
      // section faces on the two cut planes, 0.5 mm inside the shell
      const sec = new THREE.BufferGeometry(), P = [];
      for (const a of [a0 + 0.0004, a1 - 0.0004]) {
        const c = Math.cos(a), s = Math.sin(a);
        P.push(r0 * c, r0 * s, z0, r1 * c, r1 * s, z0, r1 * c, r1 * s, z1, r0 * c, r0 * s, z0, r1 * c, r1 * s, z1, r0 * c, r0 * s, z1);
      }
      sec.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); sec.computeVertexNormals();
      const sm = new THREE.Mesh(sec, mat(sys, true)); sm.userData.sys = sys; sm.renderOrder = 2;
      out.push(sm);
    }
    // blueprint edges: arcs at both ends, the four cut edges
    const L = [], arcs = (r, z) => { const n = 72, span = closed ? Math.PI * 2 : a1 - a0; for (let i = 0; i < n; i++) { const p = a0 + span * i / n, q = a0 + span * (i + 1) / n; L.push(r * Math.cos(p), r * Math.sin(p), z, r * Math.cos(q), r * Math.sin(q), z); } };
    for (const z of [z0, z1]) { arcs(r1, z); if (r0 > 0) arcs(r0, z); }
    if (!closed) for (const a of [a0, a1]) for (const r of [r0, r1]) L.push(r * Math.cos(a), r * Math.sin(a), z0, r * Math.cos(a), r * Math.sin(a), z1);
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(L, 3));
    const ln = new THREE.LineSegments(lg, lmat(sys, 0.28)); ln.userData.sys = sys;
    out.push(ln);
    return out;
  }
  // a thin layer: an open cylinder or a flat ring sector
  function surface(sys, r, z0, z1) {
    const { a0, a1, open } = range(), span = open ? a1 - a0 : Math.PI * 2;
    // CylinderGeometry measures theta from +z toward +x about its y axis:
    // build it on y, then turn y onto z
    // after rotateX(pi/2) a cylinder point at theta lands at phi = theta - pi/2
    const g = new THREE.CylinderGeometry(r, r, z1 - z0, 96, 1, true, (open ? a0 : 0) + Math.PI / 2, span);
    g.rotateX(Math.PI / 2); g.translate(0, 0, (z0 + z1) / 2);
    const m = new THREE.Mesh(g, mat(sys)); m.userData.sys = sys; m.renderOrder = 1;
    return [m];
  }
  function disk(sys, r0, r1, z) {
    const { a0, a1, open } = range(), span = open ? a1 - a0 : Math.PI * 2;
    const g = new THREE.RingGeometry(r0, r1, 96, 1, open ? a0 : 0, span); g.translate(0, 0, z);
    const m = new THREE.Mesh(g, mat(sys)); m.userData.sys = sys; m.renderOrder = 1;
    return [m];
  }
  // extra lines on the section faces: HCAL planes, yoke and chamber sectors
  function sectionLines(sys, list) {
    const { a0, a1, open } = range(); if (!open) return [];
    const L = [];
    for (const [r0, r1, z0, z1] of list) for (const a of [a0 + 0.002, a1 - 0.002]) {
      const c = Math.cos(a), s = Math.sin(a);
      L.push(r0 * c, r0 * s, z0, r1 * c, r1 * s, z1);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(L, 3));
    const ln = new THREE.LineSegments(g, lmat(sys, 0.5)); ln.userData.sys = sys;
    return [ln];
  }

  function build() {
    for (const p of parts) { group.remove(p); p.geometry.dispose(); }
    parts = [];
    const add = a => { for (const m of a) { m.visible = show[m.userData.sys] !== false; group.add(m); parts.push(m); } };
    for (const v of D.V) {
      switch (v.sys) {
        case 'pipe': add(surface('pipe', v.rmax, v.z0, v.z1)); break;
        case 'pix': case 'sct':
          if (v.rmax - v.rmin < 2 && v.z1 - v.z0 > 10) add(surface(v.sys, (v.rmin + v.rmax) / 2, v.z0, v.z1));
          else add(disk(v.sys, v.rmin, v.rmax, (v.z0 + v.z1) / 2));
          break;
        case 'ecal': add(shell('ecal', v.rmin, v.rmax, v.z0, v.z1)); break;
        case 'hcal': {
          add(shell('hcal', v.rmin, v.rmax, v.z0, v.z1));
          const pl = v.kids.map(k => (k.z1 - k.z0) > (k.rmax - k.rmin) ? [k.rmin + 2, k.rmin + 2, k.z0 + 3, k.z1 - 3] : [k.rmin + 3, k.rmax - 3, k.z0 + 2, k.z0 + 2]);
          add(sectionLines('hcal', pl));
          break;
        }
        case 'sol': add(shell('sol', v.rmin, v.rmax, v.z0, v.z1)); break;
        case 'yoke': add(shell('yoke', v.rmin, v.rmax, v.z0, v.z1)); break;
        case 'mu': add(shell('mu', v.rmin, v.rmax, v.z0, v.z1, 6)); break;
      }
    }
    // barrel wheels: five yoke wheels along z, drawn as lines on the cut
    const wheels = [-5000, -3000, -1000, 1000, 3000, 5000].map(z => [3500, 6450, z, z]);
    add(sectionLines('yoke', wheels));
  }
  build();
  return {
    group,
    get cut() { return cut; },
    setCut(m) { if (m !== cut) { cut = m; build(); } },
    setCutCentre(a) { cutCentre = a; build(); },
    range,
    setShow(sys, on) { show[sys] = on; for (const p of parts) if (p.userData.sys === sys) p.visible = on; },
    setOpacity(k) { for (const [key, m] of Object.entries(mats)) { const L = LOOK[key.split(':')[0]]; m.opacity = (key.endsWith(':s') ? L.sec * 0.55 : L.o * 0.45) * k; } },
    labels: [
      { id: 'pix', name: SYS_NAMES.pix, pos: [0, 120, 0] }, { id: 'sct', name: SYS_NAMES.sct, pos: [0, 700, 600] },
      { id: 'ecal', name: SYS_NAMES.ecal, pos: [0, 1405, 1500] }, { id: 'hcal', name: SYS_NAMES.hcal, pos: [0, 2360, 1800] },
      { id: 'sol', name: SYS_NAMES.sol, pos: [0, 3140, 2500] }, { id: 'yoke', name: SYS_NAMES.yoke, pos: [0, 4900, 3200] },
      { id: 'mu', name: SYS_NAMES.mu, pos: [0, 6350, 3800] },
    ],
    dispose() { for (const p of parts) p.geometry.dispose(); for (const m of Object.values(mats)) m.dispose(); },
  };
}
