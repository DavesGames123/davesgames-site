// ============================================================================
//  RETRO SHELF  ·  saver-desk.js — the 3D desk of the saver (three r160)
// ----------------------------------------------------------------------------
//  buildDesk(THREE, games, env) -> desk
//    env = { mk(w, h) -> canvas, tex(canvas) -> texture (optional),
//            coarse (a phone: no shadows), anisotropy }
//  The scene, in metres, y up, the desk top at y = 0, the camera at +z:
//    a beige desktop PC (a 3.5 inch floppy drive, a CD-ROM drive with a
//    tray, a game port, a power LED, a turbo display) under a CRT monitor
//    with a curved glass screen; a keyboard; a joystick with its cable and
//    plug; a lamp, a mug and a box of disks; at the left a wooden rack with
//    one big box per game (our own cover and spine, saver-card.js).
//  The screen glass shows desk.screen.canvas (saver.js draws the picture
//  there each frame). A glow plane and a point light in front of the glass
//  give the bloom and the light on the desk; the room reflection is a
//  small equirect canvas (PMREM), made once.
//
//  desk.pose(g, kind, u, secs) moves the parts for beat kind at u (0..1)
//  of a beat of secs s: the box out of the rack and onto the desk, the
//  media into the drive, the plug into the port, the LEDs, and back. It
//  returns { click } (1 at the click of the media or the plug, then 0).
//  desk.points(g) gives the live points for saver-plan.js beatPose:
//  { box, media, drive, port, screen, rack, desk }.
//  desk.setScreen(bright, rgb) sets the glow and the screen light.
//  desk.dispose() frees the GPU objects.
//
//  grep -n targets
//    "export const LAYOUT"  "export function buildDesk"  "function buildPC"
//    "function buildMonitor"  "function buildRack"  "function buildJoystick"
//    "function updateCable"  "desk.pose ="  "desk.points ="
// ============================================================================
import { drawCover, drawSpine, drawFloppyLabel, drawCdLabel, drawText } from './saver-card.js';
import { span, lerp, mediaOf } from './saver-plan.js';

/** Fixed points of the desk (metres). */
export const LAYOUT = {
  caseC: [0, 0.07, -0.18], caseS: [0.46, 0.14, 0.4], front: 0.02,
  floppy: [-0.12, 0.042], cd: [-0.12, 0.103], port: [0.15, 0.04],
  screen: [0, 0.352, -0.03], screenS: [0.335, 0.255],
  rackX: -0.86, rackZ: -0.29, slot: 0.052,
  shown: [-0.43, 0.13, 0.06],       // the box on the desk, cover to the camera
  plugRest: [0.31, 0.007, 0.13],
  stick: [0.47, 0, 0.13],
};

export function buildDesk(THREE, games, env) {
  const mk = env.mk, coarse = !!env.coarse;
  const own = [];          // GPU objects to dispose
  const T = cv => { const t = env.tex ? env.tex(cv) : new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; if (env.anisotropy) t.anisotropy = env.anisotropy; own.push(t); return t; };
  const M = (o) => { const m = new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.6, metalness: 0, envMapIntensity: 0.35 }, o)); own.push(m); return m; };
  const geo = g => { own.push(g); return g; };
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0a0d);
  const root = new THREE.Group(); scene.add(root);
  const add = (g, m, p, parent = root, r) => {
    const o = new THREE.Mesh(g, m); if (p) o.position.set(p[0], p[1], p[2]); if (r) o.rotation.set(r[0], r[1], r[2]);
    o.castShadow = !coarse; o.receiveShadow = !coarse; parent.add(o); return o;
  };
  const box = (w, h, d) => geo(new THREE.BoxGeometry(w, h, d));
  const L = LAYOUT, F = L.front;

  // ── materials ───────────────────────────────────────────────────────
  const beige = M({ color: 0xd9cfb6, roughness: 0.55 });
  const beigeDk = M({ color: 0xb9ae95, roughness: 0.6 });
  const grey = M({ color: 0x4a4a4e, roughness: 0.5 });
  const black = M({ color: 0x101012, roughness: 0.45 });
  const metal = M({ color: 0xb8bcc4, roughness: 0.3, metalness: 0.9, envMapIntensity: 0.8 });
  const ledMat = (c) => M({ color: 0x111111, emissive: c, emissiveIntensity: 0 });

  // ── room ────────────────────────────────────────────────────────────
  const wood = mk(256, 256), wc = wood.getContext('2d');
  woodGrain(wc, 256, 256, [118, 78, 46]);
  const woodT = T(wood); woodT.wrapS = woodT.wrapT = THREE.RepeatWrapping; woodT.repeat.set(3, 1.4);
  const deskMat = M({ map: woodT, roughness: 0.5, envMapIntensity: 0.5 });
  add(box(2.1, 0.05, 0.9), deskMat, [0, -0.025, 0]);
  add(box(2.1, 0.12, 0.03), deskMat, [0, -0.09, 0.44]);
  const paper = mk(128, 128), pc2 = paper.getContext('2d');
  pc2.fillStyle = '#4a3d44'; pc2.fillRect(0, 0, 128, 128);
  for (let x = 0; x < 128; x += 16) { pc2.fillStyle = 'rgba(255,230,200,0.06)'; pc2.fillRect(x, 0, 6, 128); pc2.fillStyle = 'rgba(0,0,0,0.08)'; pc2.fillRect(x + 8, 0, 2, 128); }
  const wallT = T(paper); wallT.wrapS = wallT.wrapT = THREE.RepeatWrapping; wallT.repeat.set(20, 8);
  add(geo(new THREE.PlaneGeometry(10, 4)), M({ map: wallT, roughness: 0.9, envMapIntensity: 0.2 }), [0, 0.9, -0.45]);
  add(geo(new THREE.PlaneGeometry(6, 6)), M({ color: 0x1a1412, roughness: 0.9 }), [0, -0.8, 0], root, [-Math.PI / 2, 0, 0]);
  // a cork board with our own notes
  const cork = mk(256, 160), kc = cork.getContext('2d');
  kc.fillStyle = '#9a7650'; kc.fillRect(0, 0, 256, 160);
  for (let i = 0; i < 900; i++) { kc.fillStyle = `rgba(${60 + (i * 37) % 60},${40 + (i * 13) % 30},20,0.35)`; kc.fillRect((i * 97) % 256, (i * 61) % 160, 2, 2); }
  const note = (x, y, w, h, bg, lines, rot) => { kc.save(); kc.translate(x, y); kc.rotate(rot); kc.fillStyle = bg; kc.fillRect(0, 0, w, h); lines.forEach((l, i) => drawText(kc, l, 5, 6 + i * 10, 1, '#2a2430')); kc.fillStyle = '#c33'; kc.fillRect(w / 2 - 2, 2, 4, 4); kc.restore(); };
  note(14, 14, 96, 58, '#f2ecd8', ['HI SCORE', '0012400', 'SAVE: A:\\'], -0.05);
  note(126, 22, 110, 48, '#f6e27a', ['RETURN', 'LIBRARY', 'DISKS FRI'], 0.06);
  note(40, 92, 120, 50, '#bfe0f0', ['SET BLASTER', 'A220 I5 D1'], 0.03);
  add(box(0.5, 0.31, 0.015), M({ map: T(cork), roughness: 0.95 }), [0.38, 0.86, -0.44]);

  // ── PC and monitor ─────────────────────────────────────────────────
  const pc = buildPC();
  const mon = buildMonitor();
  const rack = buildRack();
  const stick = buildJoystick();
  buildKeyboard(); buildProps();

  // ── media ───────────────────────────────────────────────────────────
  const floppy = new THREE.Group(); root.add(floppy);
  const fBody = M({ color: 0x1c1d24, roughness: 0.4 });
  add(box(0.09, 0.093, 0.0033), fBody, [0, 0, 0], floppy);
  add(box(0.05, 0.03, 0.0037), metal, [-0.005, 0.031, 0], floppy);
  const fLabelMat = M({ color: 0xffffff, roughness: 0.8 });
  add(geo(new THREE.PlaneGeometry(0.07, 0.054)), fLabelMat, [0, -0.012, 0.0018], floppy);
  floppy.visible = false;
  const cd = new THREE.Group(); root.add(cd);
  const cdLabel = M({ color: 0xffffff, roughness: 0.5, metalness: 0.1 });
  const cdData = M({ color: 0xd8dce8, roughness: 0.12, metalness: 1, envMapIntensity: 1.2 });
  const cdG = geo(new THREE.CylinderGeometry(0.06, 0.06, 0.0012, 48));
  const cdMesh = new THREE.Mesh(cdG, [cdData, cdLabel, cdData]); cdMesh.castShadow = !coarse; cd.add(cdMesh);
  cd.visible = false;
  const labelTex = new Map();
  function setMedia(g) {
    if (!labelTex.has(g.id)) {
      const a = mk(128, 100); drawFloppyLabel(a.getContext('2d'), g, 128, 100);
      const b = mk(256, 256); drawCdLabel(b.getContext('2d'), g, 256, 256);
      labelTex.set(g.id, { f: T(a), c: T(b) });
    }
    const t = labelTex.get(g.id);
    if (fLabelMat.map !== t.f) { fLabelMat.map = t.f; fLabelMat.needsUpdate = true; }
    if (cdLabel.map !== t.c) { cdLabel.map = t.c; cdLabel.needsUpdate = true; }
    fBody.color.set(g.accent).multiplyScalar(0.3);
  }

  // ── screen glow and light ──────────────────────────────────────────
  const gcv = mk(128, 128), gx = gcv.getContext('2d');
  if (gx.createRadialGradient) { const gr = gx.createRadialGradient(64, 64, 8, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); gx.fillStyle = gr; gx.fillRect(0, 0, 128, 128); }
  const glowMat = new THREE.MeshBasicMaterial({ map: T(gcv), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, color: 0xffffff });
  own.push(glowMat);
  const glow = new THREE.Mesh(geo(new THREE.PlaneGeometry(0.5, 0.4)), glowMat);
  glow.position.set(L.screen[0], L.screen[1], L.screen[2] + 0.012); glow.renderOrder = 5; root.add(glow);
  const crtLight = new THREE.PointLight(0x88aaff, 0, 1.6, 2); crtLight.position.set(L.screen[0], L.screen[1] - 0.02, 0.1); root.add(crtLight);

  // ── lights and the room reflection ─────────────────────────────────
  scene.add(new THREE.HemisphereLight(0xffeedd, 0x2a1d16, 0.55));
  const lamp = new THREE.SpotLight(0xffc98c, 5.5, 0, 0.75, 0.65, 2);
  lamp.position.set(0.66, 0.5, -0.12); lamp.target.position.set(0.05, 0, 0.05);
  if (!coarse) { lamp.castShadow = true; lamp.shadow.mapSize.set(1024, 1024); lamp.shadow.bias = -0.0004; lamp.shadow.camera.near = 0.1; lamp.shadow.camera.far = 2; }
  scene.add(lamp, lamp.target);
  const fill = new THREE.PointLight(0xb8c8ff, 1.1, 0, 2); fill.position.set(-0.7, 0.9, 1.0); scene.add(fill);
  const envCv = mk(256, 128), ec = envCv.getContext('2d');
  ec.fillStyle = '#1a1416'; ec.fillRect(0, 0, 256, 128);
  ec.fillStyle = '#3a2c24'; ec.fillRect(0, 70, 256, 58);
  ec.fillStyle = '#ffd9a0'; ec.fillRect(150, 30, 26, 18);                  // the lamp
  ec.fillStyle = '#7e93b8'; ec.fillRect(60, 18, 44, 32);                   // a window behind the viewer
  ec.fillStyle = '#2d2a3a'; ec.fillRect(78, 18, 3, 32); ec.fillRect(60, 33, 44, 3);
  let pmrem = null;
  function bakeEnv(renderer) {
    const t = env.tex ? env.tex(envCv) : new THREE.CanvasTexture(envCv);
    t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace;
    pmrem = new THREE.PMREMGenerator(renderer);
    const rt = pmrem.fromEquirectangular(t); scene.environment = rt.texture; own.push(rt, t); pmrem.dispose();
  }

  // ── the screen canvas ───────────────────────────────────────────────
  const scv = mk(512, 400);
  const screenTex = T(scv);
  mon.glass.material.map = screenTex; mon.glass.material.emissiveMap = screenTex; mon.glass.material.needsUpdate = true;

  // ─────────────────────────────────────────────────────────────────────
  function buildPC() {
    const g = new THREE.Group(); root.add(g);
    const [cx, cy, cz] = L.caseC, [sw, sh, sd] = L.caseS;
    add(box(sw, sh, sd), beige, [cx, cy, cz], g);
    add(box(sw + 0.004, 0.012, sd - 0.01), beigeDk, [cx, cy + sh / 2 - 0.006, cz], g);
    // the front panel: two bays on the left
    add(box(0.17, 0.05, 0.004), beigeDk, [L.cd[0], L.cd[1], F + 0.001], g);
    add(box(0.17, 0.034, 0.004), beigeDk, [L.floppy[0], L.floppy[1], F + 0.001], g);
    // floppy drive: slot, eject button, LED
    add(box(0.1, 0.005, 0.004), black, [L.floppy[0], L.floppy[1] + 0.002, F + 0.0015], g);
    const fBtn = add(box(0.014, 0.007, 0.006), beigeDk, [L.floppy[0] + 0.062, L.floppy[1] - 0.008, F + 0.003], g);
    const fLed = add(box(0.006, 0.003, 0.003), ledMat(0xffb020), [L.floppy[0] - 0.062, L.floppy[1] - 0.009, F + 0.003], g);
    // CD drive: the tray (its front is the bay face), a button, an LED
    const tray = new THREE.Group(); g.add(tray);
    add(box(0.15, 0.012, 0.004), M({ color: 0x2a2a2e, roughness: 0.4 }), [0, 0, 0.0675], tray);
    add(box(0.13, 0.004, 0.135), M({ color: 0x1a1a1e, roughness: 0.5 }), [0, -0.003, 0], tray);
    add(geo(new THREE.CylinderGeometry(0.062, 0.062, 0.001, 40)), M({ color: 0x0e0e10, roughness: 0.6 }), [0, -0.0005, 0], tray);
    tray.userData.closed = F - 0.0675 + 0.004; tray.userData.open = tray.userData.closed + 0.13;
    tray.position.set(L.cd[0], L.cd[1] - 0.005, tray.userData.closed);
    add(box(0.012, 0.006, 0.005), black, [L.cd[0] + 0.065, L.cd[1] - 0.016, F + 0.003], g);
    const cLed = add(box(0.006, 0.003, 0.003), ledMat(0x30ff60), [L.cd[0] - 0.065, L.cd[1] - 0.016, F + 0.003], g);
    // the right side: power button, LEDs, the turbo display, the game port
    add(box(0.03, 0.022, 0.008), beigeDk, [0.17, 0.1, F + 0.004], g);
    const pLed = add(box(0.008, 0.004, 0.003), ledMat(0x30ff60), [0.12, 0.106, F + 0.003], g);
    const hLed = add(box(0.008, 0.004, 0.003), ledMat(0xffb020), [0.12, 0.094, F + 0.003], g);
    const seg = mk(32, 16), sc = seg.getContext('2d'); sc.fillStyle = '#100808'; sc.fillRect(0, 0, 32, 16); drawText(sc, '66', 5, 4, 1, '#ff3020');
    const segMat = M({ color: 0x050505, emissive: 0xffffff, emissiveMap: T(seg), emissiveIntensity: 0 });
    add(geo(new THREE.PlaneGeometry(0.03, 0.015)), segMat, [0.06, 0.1, F + 0.0012], g);
    add(box(0.05, 0.02, 0.004), grey, [L.port[0], L.port[1], F + 0.001], g);
    add(box(0.034, 0.008, 0.003), black, [L.port[0], L.port[1], F + 0.003], g);
    // feet
    for (const x of [-0.2, 0.2]) for (const z of [-0.35, -0.02]) add(box(0.03, 0.006, 0.03), black, [x, 0.003, z], g);
    return { g, tray, fBtn, fLed, cLed, pLed, hLed, segMat };
  }

  function buildMonitor() {
    const g = new THREE.Group(); root.add(g);
    const [sx, sy, sz] = L.screen;
    // the swivel base on the case top
    add(geo(new THREE.CylinderGeometry(0.11, 0.13, 0.02, 32)), beigeDk, [0, 0.15, -0.16], g);
    add(box(0.12, 0.03, 0.12), beige, [0, 0.17, -0.17], g);
    // the bezel: a rounded frame, extruded
    const rr = (s, w, h, r) => { s.moveTo(-w / 2 + r, -h / 2); s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r); s.lineTo(w / 2, h / 2 - r); s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2); s.lineTo(-w / 2 + r, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r); s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2); };
    const outer = new THREE.Shape(); rr(outer, 0.43, 0.37, 0.03);
    const hole = new THREE.Path(); rr(hole, 0.33, 0.25, 0.028); outer.holes.push(hole);
    const bez = geo(new THREE.ExtrudeGeometry(outer, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.006, bevelSegments: 2, curveSegments: 8 }));
    add(bez, beige, [sx, sy - 0.01, sz - 0.05], g);
    // the body and the tube at the back (a square frustum)
    add(box(0.41, 0.35, 0.12), beige, [sx, sy - 0.01, sz - 0.11], g);
    const tube = geo(new THREE.CylinderGeometry(0.16, 0.27, 0.2, 4, 1));
    add(tube, beigeDk, [sx, sy - 0.02, sz - 0.27], g, [-Math.PI / 2, Math.PI / 4, 0]);
    for (let i = 0; i < 6; i++) add(box(0.2, 0.004, 0.01), M({ color: 0x8d846f }), [sx, sy + 0.14 - i * 0.012, sz - 0.2], g);
    // the glass: a bulged plane; edges behind the bezel lip
    const [gw, gh] = L.screenS, gg = geo(new THREE.PlaneGeometry(gw, gh, 32, 24));
    const p = gg.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i) / (gw / 2), y = p.getY(i) / (gh / 2); p.setZ(i, 0.016 * (1 - x * x) * (1 - y * y) + 0.004 * (2 - x * x - y * y) / 2); }
    gg.computeVertexNormals();
    const glassMat = M({ color: 0x1b201e, roughness: 0.08, metalness: 0, envMapIntensity: 1.1, emissive: 0xffffff, emissiveIntensity: 1.0 });
    const glass = add(gg, glassMat, [sx, sy, sz - 0.024], g);
    glass.castShadow = false;
    // power button and LED under the screen
    add(box(0.02, 0.01, 0.008), beigeDk, [sx + 0.17, sy - 0.16, sz - 0.004], g);
    const mLed = add(box(0.006, 0.004, 0.004), ledMat(0x40ff70), [sx + 0.145, sy - 0.16, sz - 0.004], g);
    // the cables at the back (still)
    const cab = (pts, r, m) => add(geo(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(q => new THREE.Vector3(...q))), 24, r, 6)), m, null, g);
    cab([[0.12, 0.2, -0.33], [0.2, 0.1, -0.42], [0.3, 0.005, -0.43], [0.6, 0.005, -0.42]], 0.005, black);
    cab([[-0.2, 0.06, -0.37], [-0.28, 0.01, -0.42], [-0.4, 0.005, -0.43]], 0.004, black);
    return { g, glass, mLed };
  }

  function buildRack() {
    const g = new THREE.Group(); root.add(g);
    const n = Math.max(1, games.length), w = n * L.slot + 0.03, x0 = L.rackX, cx = x0 + w / 2 - 0.015;
    const rw = M({ color: 0x5a3a24, map: woodT, roughness: 0.6 });
    add(box(w, 0.012, 0.24), rw, [cx, 0.006, L.rackZ], g);
    add(box(0.014, 0.32, 0.24), rw, [x0 - 0.022, 0.16, L.rackZ], g);
    add(box(0.014, 0.32, 0.24), rw, [x0 + w - 0.008, 0.16, L.rackZ], g);
    add(box(w + 0.03, 0.012, 0.24), rw, [cx, 0.326, L.rackZ], g);
    add(box(w + 0.03, 0.32, 0.01), rw, [cx, 0.16, L.rackZ - 0.12], g);
    const boxes = new Map();
    games.forEach((gm, i) => {
      const cov = mk(256, 320); drawCover(cov.getContext('2d'), gm, 256, 320, mk);
      const sp = mk(56, 320); drawSpine(sp.getContext('2d'), gm, 56, 320);
      const side = M({ color: new THREE.Color(gm.accent).multiplyScalar(0.4), roughness: 0.55 });
      const mats = [M({ map: T(cov), roughness: 0.45, envMapIntensity: 0.5 }), side, side, side, M({ map: T(sp), roughness: 0.45, envMapIntensity: 0.5 }), side];
      const b = new THREE.Mesh(box(0.045, 0.26, 0.2), mats);
      b.castShadow = b.receiveShadow = !coarse;
      const home = new THREE.Vector3(x0 + 0.01 + i * L.slot, 0.142, L.rackZ + 0.01);
      b.position.copy(home); g.add(b);
      boxes.set(gm.id, { mesh: b, home });
    });
    const centre = [cx, 0.16, L.rackZ + 0.1];
    return { g, boxes, centre };
  }

  function buildJoystick() {
    const g = new THREE.Group(); root.add(g);
    const [x, , z] = L.stick;
    add(box(0.12, 0.03, 0.11), black, [x, 0.015, z], g);
    add(box(0.11, 0.008, 0.1), M({ color: 0x26262a, roughness: 0.4 }), [x, 0.033, z], g);
    add(geo(new THREE.CylinderGeometry(0.018, 0.024, 0.012, 20)), black, [x, 0.04, z], g);
    const shaft = add(geo(new THREE.CylinderGeometry(0.006, 0.007, 0.11, 12)), M({ color: 0x18181a, roughness: 0.3 }), [x, 0.1, z], g, [0.12, 0, -0.1]);
    add(geo(new THREE.SphereGeometry(0.017, 20, 14)), M({ color: 0xc81e1e, roughness: 0.25, envMapIntensity: 0.8 }), [x - 0.006, 0.158, z + 0.007], g);
    add(geo(new THREE.CylinderGeometry(0.008, 0.008, 0.006, 16)), M({ color: 0xc81e1e, roughness: 0.3 }), [x + 0.04, 0.036, z - 0.03], g);
    add(geo(new THREE.CylinderGeometry(0.008, 0.008, 0.006, 16)), M({ color: 0x1e60c8, roughness: 0.3 }), [x + 0.04, 0.036, z + 0.02], g);
    void shaft;
    // the plug (a DB-15 hood), nose at -z in its own frame
    const plug = new THREE.Group(); root.add(plug);
    add(box(0.044, 0.016, 0.026), M({ color: 0x2b2b2f, roughness: 0.4 }), [0, 0, 0.004], plug);
    add(box(0.034, 0.008, 0.01), metal, [0, 0, -0.012], plug);
    add(box(0.012, 0.01, 0.012), M({ color: 0x2b2b2f, roughness: 0.4 }), [0, 0, 0.022], plug);
    const cableMat = M({ color: 0x141416, roughness: 0.5 });
    const cable = new THREE.Mesh(geo(new THREE.BufferGeometry()), cableMat); cable.castShadow = !coarse; root.add(cable);
    return { g, plug, cable, last: '' };
  }

  function buildKeyboard() {
    const kx = -0.02, kz = 0.24;
    add(box(0.46, 0.022, 0.17), beige, [kx, 0.011, kz], root, [0.06, 0, 0]);
    const keyG = box(0.021, 0.012, 0.021), n = 5 * 17;
    const keys = new THREE.InstancedMesh(keyG, M({ color: 0xcfc6ae, roughness: 0.6 }), n);
    const m4 = new THREE.Matrix4(); let k = 0;
    for (let r = 0; r < 5; r++) for (let c = 0; c < 17; c++) {
      const x = kx - 0.2 + c * 0.0245 + (r % 2) * 0.006, z = kz - 0.06 + r * 0.026;
      m4.makeRotationX(0.06); m4.setPosition(x, 0.027 - r * 0.0016 + (c > 14 ? 0 : 0), z); keys.setMatrixAt(k++, m4);
    }
    keys.castShadow = !coarse; keys.receiveShadow = !coarse; root.add(keys);
    add(box(0.13, 0.012, 0.021), M({ color: 0xcfc6ae, roughness: 0.6 }), [kx - 0.03, 0.019, kz + 0.07], root, [0.06, 0, 0]);
    const cb = geo(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([[kx + 0.1, 0.012, kz - 0.085], [kx + 0.12, 0.005, kz - 0.14], [0.26, 0.005, -0.03], [0.23, 0.04, -0.2]].map(q => new THREE.Vector3(...q))), 30, 0.003, 6));
    add(cb, black, null);
  }

  function buildProps() {
    // a desk lamp at the back right
    const lx = 0.7, lz = -0.2;
    add(geo(new THREE.CylinderGeometry(0.06, 0.07, 0.02, 28)), black, [lx, 0.01, lz]);
    add(geo(new THREE.CylinderGeometry(0.006, 0.006, 0.42, 10)), metal, [lx, 0.22, lz - 0.02], root, [-0.25, 0, 0]);
    add(geo(new THREE.CylinderGeometry(0.006, 0.006, 0.18, 10)), metal, [lx - 0.03, 0.45, lz + 0.03], root, [0.9, 0, 0.6]);
    const shade = add(geo(new THREE.CylinderGeometry(0.025, 0.075, 0.09, 28, 1, true)), M({ color: 0x2f5a3a, roughness: 0.4, side: THREE.DoubleSide }), [0.66, 0.5, -0.12], root, [0.5, 0, 0.55]);
    shade.castShadow = false;
    add(geo(new THREE.SphereGeometry(0.02, 16, 12)), M({ color: 0xffe0b0, emissive: 0xffd090, emissiveIntensity: 3 }), [0.66, 0.49, -0.12]);
    // a mug
    const mug = M({ color: 0xe8e2d4, roughness: 0.35 });
    add(geo(new THREE.CylinderGeometry(0.035, 0.032, 0.09, 24, 1, true)), mug, [0.62, 0.045, 0.2]).material.side = THREE.DoubleSide;
    add(geo(new THREE.CylinderGeometry(0.033, 0.033, 0.004, 24)), M({ color: 0x2a1408, roughness: 0.2 }), [0.62, 0.075, 0.2]);
    add(geo(new THREE.TorusGeometry(0.022, 0.006, 8, 16, Math.PI)), mug, [0.655, 0.045, 0.2], root, [0, 0, -Math.PI / 2]);
    // a box of disks at the front left
    add(box(0.12, 0.05, 0.1), M({ color: 0x30343c, roughness: 0.3, transparent: true, opacity: 0.85 }), [-0.62, 0.025, 0.2]);
    for (let i = 0; i < 6; i++) add(box(0.09, 0.093, 0.0033), M({ color: [0x1c1d24, 0x2a3a70, 0x6a1e1e, 0x1c1d24, 0x26502e, 0x1c1d24][i] }), [-0.62, 0.07, 0.165 + i * 0.012], root, [-0.25, 0, 0]);
  }

  // ── the cable from the stick to the plug ───────────────────────────
  const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  const tmp = new THREE.Vector3(), tail = new THREE.Vector3();
  function updateCable() {
    const p = stick.plug;
    tail.set(0, 0, 0.03).applyQuaternion(p.quaternion).add(p.position);
    const key = tail.x.toFixed(4) + tail.y.toFixed(4) + tail.z.toFixed(4);
    if (key === stick.last) return;
    stick.last = key;
    const back = tmp.set(0, 0, 0.07).applyQuaternion(p.quaternion).add(p.position);
    const a = V([L.stick[0] - 0.04, 0.012, L.stick[2] - 0.055]);
    const pts = [a, V([a.x - 0.03, 0.005, a.z - 0.03]), V([lerp(a.x, back.x, 0.5), 0.005, Math.max(a.z, back.z) + 0.03]), new THREE.Vector3(back.x, Math.max(0.005, back.y), back.z), tail.clone()];
    const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.0035, 6);
    stick.cable.geometry.dispose(); stick.cable.geometry = g;
  }

  // ── choreography ────────────────────────────────────────────────────
  const qId = new THREE.Quaternion();
  const qFlat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  const qStand = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
  const qShown = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2 + 0.25, 0));
  const qRest = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2 + 0.35, 0));
  const vA = new THREE.Vector3(), vB = new THREE.Vector3();
  const mAbove = new THREE.Vector3(), mIn = new THREE.Vector3(), mOver = new THREE.Vector3(), mTray = new THREE.Vector3();
  const arc = (out, a, b, k, lift) => { out.lerpVectors(a, b, k); out.y += Math.sin(Math.PI * k) * lift; return out; };
  const SHOWN = V(L.shown), PORT = V([L.port[0], L.port[1], F + 0.013]), REST = V(L.plugRest);
  const FLOP_IN = V([L.floppy[0], L.floppy[1] + 0.002, F - 0.05]), FLOP_OUT = V([L.floppy[0], L.floppy[1] + 0.002, F + 0.012]);
  const FLOP_FRONT = V([L.floppy[0], L.floppy[1] + 0.002, F + 0.14]);
  const desk = { scene, root, THREE, screen: { canvas: scv, tex: screenTex }, glass: mon.glass, bakeEnv, LAYOUT };
  let curId = '';

  function placeBox(b, kind, u) {
    const home = b.home, m = b.mesh;
    const out = vA.copy(home); out.z += 0.25; out.y += 0.01;
    if (kind === 'pick') {
      const k1 = span(u, 0.12, 0.42), k2 = span(u, 0.45, 0.85);
      if (k2 <= 0) { m.position.lerpVectors(home, out, k1); m.quaternion.copy(qId); }
      else { arc(m.position, out, SHOWN, k2, 0.08); m.quaternion.slerpQuaternions(qId, qShown, k2); }
    } else if (kind === 'eject') {
      const k1 = span(u, 0.68, 0.84), k2 = span(u, 0.84, 0.98);
      if (k2 <= 0) { arc(m.position, SHOWN, out, k1, 0.08); m.quaternion.slerpQuaternions(qShown, qId, k1); }
      else { m.position.lerpVectors(out, home, k2); m.quaternion.copy(qId); }
    } else { m.position.copy(SHOWN); m.quaternion.copy(qShown); }
  }

  function placePlug(kind, u) {
    const p = stick.plug;
    let k = 0;
    if (kind === 'plugin') k = span(u, 0.66, 0.88);
    else if (kind === 'eject') k = 1 - span(u, 0.04, 0.24);
    else if (kind === 'pick') k = 0;
    else k = 1;
    // rest -> lifted in front of the port -> in
    const lifted = vB.set(PORT.x + 0.02, PORT.y + 0.03, PORT.z + 0.09);
    if (k < 0.75) { const q = k / 0.75; arc(p.position, REST, lifted, ease2(q), 0.06); p.quaternion.slerpQuaternions(qRest, qId, ease2(q)); }
    else { const q = (k - 0.75) / 0.25; p.position.lerpVectors(lifted, PORT, ease2(q)); p.quaternion.copy(qId); }
    if (k === 0) { p.position.copy(REST); p.quaternion.copy(qRest); }
    updateCable();
  }
  const ease2 = x => x * x * (3 - 2 * x);

  // returns the media position, for the camera
  function placeMedia(g, kind, u) {
    const isCd = mediaOf(g) === 'cd', obj = isCd ? cd : floppy, other = isCd ? floppy : cd;
    other.visible = false;
    const tray = pc.tray, above = mAbove.copy(SHOWN); above.y += 0.25; above.z += 0.04;
    const inBox = mIn.copy(SHOWN); inBox.y += 0.06;
    const trayOpen = tray.userData.open, trayShut = tray.userData.closed;
    const trayTop = (z) => mTray.set(L.cd[0], L.cd[1] - 0.0035, z);
    if (!isCd) tray.position.z = trayShut;
    let vis = true;
    if (kind === 'pick') { vis = false; tray.position.z = trayShut; }
    else if (kind === 'plugin') {
      const k0 = span(u, 0.02, 0.18), k1 = span(u, 0.18, 0.46);
      if (u < 0.18) { obj.position.lerpVectors(inBox, above, k0); obj.quaternion.copy(isCd ? qStand : qId); vis = u > 0.02; }
      else if (!isCd) {
        const k2 = span(u, 0.48, 0.6);
        if (k2 <= 0) { arc(obj.position, above, FLOP_FRONT, k1, 0.04); obj.quaternion.slerpQuaternions(qId, qFlat, k1); }
        else { obj.position.lerpVectors(FLOP_FRONT, FLOP_IN, k2); obj.quaternion.copy(qFlat); }
      } else {
        tray.position.z = lerp(trayShut, trayOpen, span(u, 0.26, 0.42)) - lerp(0, trayOpen - trayShut, span(u, 0.54, 0.64));
        const over = mOver.copy(trayTop(trayOpen)); over.y += 0.04;
        if (u < 0.46) { arc(obj.position, above, over, k1, 0.04); obj.quaternion.slerpQuaternions(qStand, qId, k1); }
        else { const k3 = span(u, 0.46, 0.53); obj.position.copy(trayTop(tray.position.z)); obj.position.y += 0.04 * (1 - k3); obj.quaternion.copy(qId); }
      }
    } else if (kind === 'eject') {
      if (!isCd) {
        const k1 = span(u, 0.2, 0.26), k2 = span(u, 0.3, 0.52), k3 = span(u, 0.54, 0.64);
        if (k2 <= 0) { obj.position.lerpVectors(FLOP_IN, FLOP_OUT, k1); obj.quaternion.copy(qFlat); }
        else if (k3 <= 0) { arc(obj.position, FLOP_OUT, above, k2, 0.06); obj.quaternion.slerpQuaternions(qFlat, qId, k2); }
        else { obj.position.lerpVectors(above, inBox, k3); obj.quaternion.copy(qId); }
        vis = u < 0.64;
      } else {
        tray.position.z = lerp(trayShut, trayOpen, span(u, 0.18, 0.28)) - lerp(0, trayOpen - trayShut, span(u, 0.46, 0.56));
        const k1 = span(u, 0.28, 0.33), k2 = span(u, 0.33, 0.52), k3 = span(u, 0.54, 0.64);
        const lift = mOver.copy(trayTop(trayOpen)); lift.y += 0.04;
        if (k2 <= 0) { obj.position.copy(trayTop(tray.position.z)); obj.position.y += 0.04 * k1; obj.quaternion.copy(qId); }
        else if (k3 <= 0) { arc(obj.position, lift, above, k2, 0.06); obj.quaternion.slerpQuaternions(qId, qStand, k2); }
        else { obj.position.lerpVectors(above, inBox, k3); obj.quaternion.copy(qStand); }
        vis = u < 0.64;
      }
    } else {
      // in the drive
      if (isCd) { tray.position.z = trayShut; obj.position.copy(trayTop(trayShut)); obj.quaternion.copy(qId); }
      else { obj.position.copy(FLOP_IN); obj.quaternion.copy(qFlat); }
    }
    obj.visible = vis;
    return obj.position;
  }

  const setLed = (mesh, on) => { mesh.material.emissiveIntensity = on; };
  desk.pose = (g, kind, u, secs) => {
    if (g.id !== curId) { curId = g.id; setMedia(g); }
    const t = u * secs;
    for (const [id, b] of rack.boxes) {
      if (id === g.id) placeBox(b, kind, u);
      else { b.mesh.position.copy(b.home); b.mesh.quaternion.copy(qId); }
    }
    placeMedia(g, kind, u);
    placePlug(kind, u);
    // LEDs: the PC is on from the plug click (plugin 0.9) to the end of poweroff
    const pcOn = kind === 'plugin' ? u > 0.9 : kind === 'poweron' || kind === 'tour' || (kind === 'poweroff' && t < secs - 1.5);
    setLed(pc.pLed, pcOn ? 2.4 : 0);
    pc.segMat.emissiveIntensity = pcOn ? 1.6 : 0;
    const busy = (kind === 'plugin' && u > 0.6 && u < 0.66) || (kind === 'poweron' && t > 1.4 && t < 4.2) || (kind === 'eject' && u > 0.18 && u < 0.24);
    const flick = busy && (Math.sin(t * 37) > -0.2);
    setLed(pc.fLed, !!(flick && mediaOf(g) !== 'cd') * 2.4);
    setLed(pc.cLed, !!(flick && mediaOf(g) === 'cd') * 2.4);
    setLed(pc.hLed, pcOn && Math.sin(t * 23 + Math.sin(t * 7) * 3) > 0.55 ? 2 : 0);
    const monOn = (kind === 'poweron' && t > 0.6) || kind === 'tour' || (kind === 'poweroff' && t < secs - 1.2);
    setLed(mon.mLed, monOn ? 2.2 : 0);
    // the floppy eject button sits in when a disk is in
    pc.fBtn.position.z = F + 0.003 - ((kind === 'plugin' && u > 0.6) || kind === 'poweron' || kind === 'tour' || kind === 'poweroff' || (kind === 'eject' && u < 0.2) ? 0.002 : 0);
    // the click: the media seat (plugin 0.6 / CD 0.64) and the plug (0.88)
    let click = 0;
    if (kind === 'plugin') for (const c of [mediaOf(g) === 'cd' ? 0.64 : 0.6, 0.88]) { const d = (u - c) * secs; if (d >= 0 && d < 0.25) click = Math.max(click, 1 - d / 0.25); }
    return { click };
  };

  desk.points = (g) => {
    const b = rack.boxes.get(g.id);
    const isCd = mediaOf(g) === 'cd', obj = isCd ? cd : floppy;
    const box3 = b ? b.mesh.position.toArray() : SHOWN.toArray();
    const media = obj.visible ? obj.position.toArray() : [box3[0], box3[1] + 0.1, box3[2]];
    return {
      box: box3, media,
      drive: isCd ? [L.cd[0], L.cd[1], F + 0.04] : [L.floppy[0], L.floppy[1], F + 0.03],
      port: [PORT.x, PORT.y, PORT.z + 0.02],
      screen: L.screen.slice(),
      rack: rack.centre.slice(),
      desk: [-0.08, 0.16, -0.05],
    };
  };

  desk.setScreen = (bright, rgb) => {
    const b = Math.max(0, bright);
    glowMat.opacity = Math.min(0.35, 0.18 * b);
    glowMat.color.setRGB(rgb[0], rgb[1], rgb[2]);
    crtLight.color.setRGB(rgb[0], rgb[1], rgb[2]);
    crtLight.intensity = 0.9 * b;
    mon.glass.material.emissiveIntensity = 1.0;
  };

  desk.dispose = () => {
    for (const o of own) { try { o.dispose(); } catch (e) { /* already gone */ } }
    try { stick.cable.geometry.dispose(); } catch (e) { /* ignore */ }
  };
  desk.parts = { pc, mon, rack, stick, floppy, cd, glow, crtLight, lamp };
  return desk;
}

function woodGrain(c, w, h, base) {
  c.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`; c.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y++) {
    const v = Math.sin(y * 0.21 + Math.sin(y * 0.05) * 3) * 0.5 + 0.5;
    c.fillStyle = `rgba(40,22,10,${0.08 + 0.18 * v * v})`; c.fillRect(0, y, w, 1);
  }
  for (let i = 0; i < 60; i++) { c.fillStyle = 'rgba(255,220,170,0.05)'; c.fillRect((i * 53) % w, (i * 29) % h, 30 + (i * 7) % 60, 1); }
}
