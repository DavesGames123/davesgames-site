// ============================================================================
//  NEURON LAB  ·  netmode.js  ·  several full cells wired together
// ----------------------------------------------------------------------------
//  The Network mode of the Lab. engine/netplan.js builds a MultiNet
//  (engine/multicell.js: 2 to 12 full cable cells, NetCon + Exp2Syn links)
//  from the Randomize values, a demo, or the URL hash. This file draws it
//  and binds the controls:
//    - each cell as glowing tubes (shared/neuron-mesh.js) in its place
//    - each link as an axon tube from the presynaptic hillock to the
//      synapse, E links amber, I links blue; selected links bright
//    - each spike in flight as a bead that runs down its axon with the
//      real NetCon delay; the synapse flashes when it lands; the
//      postsynaptic dendrite then lights up through the cable solve
//    - tools: Wire (drag, or tap then tap on touch, from one cell to a
//      dendrite of another), Select (tap axons; edit many at once),
//      Kick (tap a cell to fire it), Move (drag a soma), Erase (tap axon)
//    - auto-wire presets, demos, the connectivity matrix (click cycles
//      none, E, I), a raster and the soma voltage of every cell
//  Real time: the compartment budget of multicell.js (fewer segments per
//  cell as the count grows); each frame steps the solver for at most 9 ms
//  of CPU, so slow devices run in slower motion, never freeze.
//
//  installNet(ctx) returns the API that main.js and saver.js use and sets
//  window.__nlNet (on, onRandom, hashState) for the Randomize panel.
//
//  grep -n targets
//    "function enable"      turn the mode on with a built network
//    "function rebuild"     scene objects for the current network
//    "function axonMesh"    one link's tube
//    "function drawBeads"   spikes in flight and synapse flashes
//    "function step"        the solver steps, kicks, histories
//    "function bindPointer" the tools
//    "function drawMatrix"  the editable connectivity matrix
//    "function drawRaster"  raster and soma traces
//    "function selUI"       the multi-select editor
// ============================================================================
import { buildNet, applyPreset, cycleLink, editLinks, netState, flightsOf, pointOn, DEMOS, kicker, wxOf, SIGN_COL } from './engine/netplan.js';
import { BUDGET } from './engine/multicell.js';
import { decodeHash } from './engine/hashstate.js';
import { buildNeuronMesh } from './shared/neuron-mesh.js';
import { bounds, CELLS } from './engine/morph.js';

const HN = 600, HDT = 0.1;               // soma history: 60 ms
const RASTER_MS = 300;
const MAX_BEADS = 600;
const PRESET_NAMES = { chain: 'Chain', ring: 'Ring', all: 'All to all', ff: 'Feed-forward', random: 'Random p', ei: 'E/I (Dale)', loop: 'Ring + I' };
const LAYOUT_NAMES = { line: 'Line', ring: 'Ring', layer: 'Layer', cluster: 'Cluster' };
const DEMO_NAMES = { chain: 'Chain hand-off', ring: 'Self-sustaining ring', inhibit: 'Inhibition', ff: 'Feed-forward', ei: 'E/I network' };

export function installNet(ctx) {
  const { stage, THREE, $, randValues, writeHash, PHONE_Q, COARSE } = ctx;
  const phone = () => PHONE_Q.matches || COARSE;
  const N = {
    on: false, net: null, group: new THREE.Group(), cells: [], axons: [], beads: null, syns: null,
    sel: new Set(), tool: 'wire', newTy: 'e', pending: -1, auto: true, kickEvery: 80, lastKick: -1e9,
    kick: null, w: null, hist: null, labels: [], demo: null, msg: '',
  };
  if (stage) stage.scene.add(N.group);
  N.group.visible = false;

  // ── build ─────────────────────────────────────────────────────────────
  const wireNow = () => N.w || (N.w = { ...randValues('wire') });
  function make(o = {}) {
    const w = o.wire || wireNow();
    return buildNet({
      wire: w, morph: o.types ? null : (ctx.RS.seeds.morph ? randValues('morph') : null), bio: randValues('bio'),
      seeds: { morph: ctx.RS.seeds.morph || 1, wire: ctx.RS.seeds.wire || o.seed || 1 },
      phone: phone(), types: o.types, conns: o.conns, place: o.place, velocity: o.velocity,
    });
  }
  function enable(net, o = {}) {
    disposeScene();
    N.net = net; N.on = true; N.sel.clear(); N.pending = -1;
    N.demo = o.demo || null;
    N.kick = o.kicks ? kicker(o.kicks) : null;
    N.lastKick = -1e9;
    ctx.L.group.visible = false; N.group.visible = true;
    document.body.classList.add('net');
    rebuild(); resetHist();
    syncUI();
    if (o.fit !== false) fit(!o.jump);
    if (o.hash !== false) writeHash();
  }
  function disable(o = {}) {
    if (!N.on) return;
    N.on = false; disposeScene(); N.net = null;
    N.group.visible = false; ctx.L.group.visible = true;
    document.body.classList.remove('net');
    syncUI(); if (o.hash !== false) writeHash();
  }

  // ── scene ─────────────────────────────────────────────────────────────
  const beadGeo = new THREE.SphereGeometry(1, 12, 8);
  function disposeScene() {
    for (const o of [...N.group.children]) { N.group.remove(o); o.traverse(q => { if (q.geometry && q.geometry !== beadGeo) q.geometry.dispose(); if (q.material) [].concat(q.material).forEach(m => m.dispose()); }); }
    N.cells = []; N.axons = []; N.beads = null; N.syns = null;
    for (const l of N.labels) l.remove(); N.labels = [];
  }
  function rebuild() {
    disposeScene();
    const net = N.net;
    net.cells.forEach((cell, i) => {
      const B = bounds(cell.sections), g = new THREE.Group();
      const m = buildNeuronMesh(THREE, cell, { thick: 1.6, minR: Math.max(0.9, B.R * 0.0026) });
      g.add(m.mesh); g.position.set(...net.place[i].p); g.rotation.y = net.place[i].yaw;
      N.group.add(g); N.cells.push({ g, m, B });
      const d = document.createElement('div'); d.className = 'mk netlab'; $('marks').appendChild(d); N.labels.push(d);
    });
    for (const c of net.conns) N.axons.push(axonMesh(c));
    N.beads = new THREE.InstancedMesh(beadGeo, new THREE.MeshBasicMaterial({ toneMapped: false }), MAX_BEADS);
    N.beads.instanceMatrix.setUsage(THREE.DynamicDrawUsage); N.beads.count = 0; N.beads.frustumCulled = false;
    N.beads.setColorAt(0, new THREE.Color(1, 1, 1));
    N.group.add(N.beads);
    relabel();
  }
  const scaleR = () => { let r = 0; for (const c of N.cells) r = Math.max(r, c.B.R); return r || 400; };
  function axonMesh(c) {
    const pts = c.pts.map(p => new THREE.Vector3(p[0], p[1], p[2]));
    const curve = new THREE.CatmullRomCurve3(pts);
    const r = Math.max(1.2, scaleR() * 0.0032);
    const geo = new THREE.TubeGeometry(curve, Math.min(64, pts.length * 2), r, 6, false);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(SIGN_COL[c.ty]), transparent: true, opacity: 0.42, depthWrite: false, toneMapped: false });
    const mesh = new THREE.Mesh(geo, mat); mesh.renderOrder = 2; mesh.userData.conn = c;
    const syn = new THREE.Mesh(beadGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(SIGN_COL[c.ty]), toneMapped: false, transparent: true, opacity: 0.9 }));
    const q = c.pts[c.pts.length - 1]; syn.position.set(q[0], q[1], q[2]); syn.userData.base = r * 2.4; syn.scale.setScalar(r * 2.4);
    mesh.add(syn); mesh.userData.syn = syn;
    N.group.add(mesh);
    return mesh;
  }
  function refreshAxons(list) {
    const want = new Set(list || N.net.conns);
    for (let k = N.axons.length - 1; k >= 0; k--) {
      const a = N.axons[k], c = a.userData.conn;
      if (!N.net.conns.includes(c) || want.has(c)) { N.group.remove(a); a.geometry.dispose(); a.material.dispose(); a.userData.syn.material.dispose(); N.axons.splice(k, 1); }
    }
    for (const c of N.net.conns) if (!N.axons.some(a => a.userData.conn === c)) N.axons.push(axonMesh(c));
    for (const c of [...N.sel]) if (!N.net.conns.includes(c)) N.sel.delete(c);
    paintSel();
  }
  function paintSel() {
    for (const a of N.axons) {
      const c = a.userData.conn, on = N.sel.has(c);
      a.material.color.set(on ? '#ffffff' : SIGN_COL[c.ty]); a.material.opacity = on ? 0.95 : 0.42;
      a.userData.syn.material.color.set(SIGN_COL[c.ty]);
    }
  }
  function relabel() {
    if (!N.net) return;
    N.net.cells.forEach((_c, i) => {
      const s = N.net.sign[i] || 'e', t = N.net.specs[i].type, C = CELLS.find(q => q.id === t);
      const d = N.labels[i]; d.textContent = `${i + 1} · ${C ? C.short : t}${s === 'i' ? ' · I' : ''}`;
      d.style.color = i === N.pending ? '#ffffff' : SIGN_COL[s];
    });
  }

  // ── simulation ────────────────────────────────────────────────────────
  function resetHist() { const n = N.net ? N.net.n : 0; N.hist = { k: 0, n: 0, next: N.net ? N.net.t : 0, v: Array.from({ length: n }, () => new Float32Array(HN).fill(-65)) }; }
  function sample() {
    const H = N.hist, net = N.net; if (net.t + 1e-9 < H.next) return;
    H.next = net.t + HDT;
    for (let i = 0; i < net.n; i++) H.v[i][H.k] = net.cells[i].v[0];
    H.k = (H.k + 1) % HN; H.n = Math.min(HN, H.n + 1);
  }
  // simMs of simulated time, at most budgetMs of CPU
  function step(simMs, budgetMs = 9) {
    const net = N.net; if (!net) return;
    const t0 = performance.now(), n = Math.min(800, Math.round(simMs / net.cells[0].dt));
    for (let q = 0; q < n; q++) {
      net.step(); sample();
      if (N.kick) N.kick(net);
      else if (N.auto && net.t - N.lastKick >= N.kickEvery) { N.lastKick = net.t; net.kick(0); }
      if ((q & 7) === 7 && performance.now() - t0 > budgetMs) break;
    }
    // keep memory flat over hours: old spikes leave the raster window
    if (net.spikes.length > 6000) { let cut = 0; while (cut < net.spikes.length && net.spikes[cut] < net.t - RASTER_MS - 50) cut += 2; net.spikes.splice(0, cut); }
  }

  // ── drawing ───────────────────────────────────────────────────────────
  const _m = new THREE.Matrix4(), _c = new THREE.Color(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), fl = [];
  function drawBeads() {
    const net = N.net, R = scaleR(), br = Math.max(4, R * 0.012);
    let k = 0;
    for (const a of N.axons) {
      const c = a.userData.conn, syn = a.userData.syn;
      flightsOf(c, net.t, fl);
      let flash = 0;
      for (const f of fl) {
        if (f.u <= 1 && k < MAX_BEADS) {
          const p = pointOn(c.pts, f.u);
          _p.set(p[0], p[1], p[2]); _s.setScalar(br * (1 + 0.35 * Math.sin(f.age * 2)));
          _m.compose(_p, _q, _s); N.beads.setMatrixAt(k, _m);
          _c.set(c.ty === 'i' ? '#9cc0ff' : '#ffd27a').multiplyScalar(2.2); N.beads.setColorAt(k, _c); k++;
        } else if (f.u > 1) flash = Math.max(flash, 1 - (f.u - 1) / 0.6);
      }
      syn.scale.setScalar(syn.userData.base * (1 + 2.2 * flash));
      syn.material.opacity = 0.55 + 0.45 * flash;
    }
    N.beads.count = k; N.beads.instanceMatrix.needsUpdate = true;
    if (N.beads.instanceColor) N.beads.instanceColor.needsUpdate = true;
    N.net.cells.forEach((cell, i) => N.cells[i].m.update(cell.v));
  }
  const _v = new THREE.Vector3();
  function placeLabels() {
    const rect = $('view').getBoundingClientRect(), net = N.net;
    N.labels.forEach((d, i) => {
      const w = net.world(i, 0); _v.set(w[0], w[1], w[2]).project(stage.camera);
      const on = _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1 && !ctx.L.saver;
      d.style.display = on ? '' : 'none';
      if (on) d.style.transform = `translate(${((_v.x + 1) / 2 * rect.width).toFixed(1)}px,${((1 - _v.y) / 2 * rect.height).toFixed(1)}px) translate(-50%,-190%)`;
    });
  }
  function worldBounds() {
    const net = N.net, lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    net.cells.forEach((_c, i) => { const p = net.place[i].p, r = N.cells[i].B.R * 0.8; for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[a] - r); hi[a] = Math.max(hi[a], p[a] + r); } });
    const c = lo.map((v, a) => (v + hi[a]) / 2);
    return { c, R: 0.5 * Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) };
  }
  function fit(soft = true) {
    if (!stage || !N.net) return;
    const B = worldBounds(), fov = stage.camera.fov * Math.PI / 180;
    const o = { az: 0.55, el: 0.42, r: B.R / Math.tan(fov / 2) * 0.95 / stage.fit, target: B.c };
    if (soft) stage.flyTo(o, 2.2); else stage.jump(o);
  }

  // ── plots ─────────────────────────────────────────────────────────────
  function fitCanvas(cv) {
    const r = cv.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const g = cv.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0);
    return { g, w: r.width, h: r.height };
  }
  function drawMatrix(cv = $('netMatrix')) {
    if (!cv || !N.net || (cv.offsetParent === null && !cv.__force)) return;
    const { g, w, h } = fitCanvas(cv), n = N.net.n, pad = 18, s = Math.min((w - pad - 4) / n, (h - pad - 4) / n);
    g.fillStyle = '#060a13'; g.fillRect(0, 0, w, h);
    g.font = '9px ui-monospace, Menlo, monospace'; g.fillStyle = '#56627a'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i < n; i++) { g.fillText(String(i + 1), pad + s * (i + 0.5), 8); g.fillText(String(i + 1), 8, pad + s * (i + 0.5)); }
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const c = N.net.conns.find(q => q.pre === i && q.post === j), x = pad + s * j, y = pad + s * i;
      g.fillStyle = i === j ? '#0b0f19' : c ? SIGN_COL[c.ty] : '#111827';
      if (c) g.globalAlpha = 0.35 + 0.65 * Math.min(1, wxOf(N.net, c) / 4);
      g.fillRect(x + 1, y + 1, s - 2, s - 2); g.globalAlpha = 1;
      if (c && N.sel.has(c)) { g.strokeStyle = '#ffffff'; g.lineWidth = 1.5; g.strokeRect(x + 1.5, y + 1.5, s - 3, s - 3); }
    }
    g.textAlign = 'left'; cv.__geo = { pad, s, n };
  }
  function drawRaster(cv = $('netRaster'), tv = $('netTraces'), opts = {}) {
    const net = N.net; if (!net) return;
    if (cv && (cv.offsetParent !== null || opts.force)) {
      const { g, w, h } = fitCanvas(cv), n = net.n, t1 = net.t, t0 = t1 - RASTER_MS, rh = (h - 14) / n;
      g.fillStyle = opts.bg || '#060a13'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? 'rgba(255,255,255,0.025)' : 'transparent'; g.fillRect(0, i * rh, w, rh); }
      for (let q = 0; q < net.spikes.length; q += 2) {
        const t = net.spikes[q], i = net.spikes[q + 1]; if (t < t0) continue;
        const x = (t - t0) / RASTER_MS * w; g.fillStyle = SIGN_COL[net.sign[i] || 'e'];
        g.fillRect(x - 1, i * rh + rh * 0.15, opts.lw || 2.2, rh * 0.7);
      }
      g.fillStyle = '#56627a'; g.font = '10px ui-monospace, Menlo, monospace'; g.fillText(RASTER_MS + ' ms', w - 46, h - 4);
    }
    if (tv && (tv.offsetParent !== null || opts.force)) {
      const { g, w, h } = fitCanvas(tv), H = N.hist, n = net.n, rh = h / n;
      g.fillStyle = opts.bg || '#060a13'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < n; i++) {
        const y0 = i * rh, fy = v => y0 + rh * (1 - (v + 85) / 135);
        g.strokeStyle = SIGN_COL[net.sign[i] || 'e']; g.lineWidth = opts.lw || 1.2; g.beginPath();
        for (let j = 0; j < H.n; j++) { const k = (H.k - H.n + j + HN) % HN, x = w * (j + HN - H.n) / (HN - 1), y = fy(H.v[i][k]); if (j) g.lineTo(x, y); else g.moveTo(x, y); }
        g.stroke();
      }
    }
  }

  // ── picking ───────────────────────────────────────────────────────────
  function toScreen(p, rect) { _v.set(p[0], p[1], p[2]).project(stage.camera); return _v.z > 1 ? null : [(_v.x + 1) / 2 * rect.width, (1 - _v.y) / 2 * rect.height, _v.z]; }
  // nearest node of any cell to (x, y) within lim px: { i, k } or null
  function pickNode(cx, cy, lim = COARSE ? 44 : 30) {
    const rect = $('view').getBoundingClientRect(), x = cx - rect.left, y = cy - rect.top, net = N.net;
    let best = null, bd = lim * lim, bz = 9;
    for (let i = 0; i < net.n; i++) { const c = net.cells[i]; for (let k = 0; k < c.n; k++) {
      const s = toScreen(net.world(i, k), rect); if (!s) continue;
      const d = (s[0] - x) ** 2 + (s[1] - y) ** 2; if (d < bd - 4 || (d < bd + 4 && s[2] < bz)) { bd = d; best = { i, k }; bz = s[2]; }
    } }
    return best;
  }
  function pickSoma(cx, cy, lim = COARSE ? 48 : 36) {
    const rect = $('view').getBoundingClientRect(), x = cx - rect.left, y = cy - rect.top; let best = -1, bd = lim * lim;
    for (let i = 0; i < N.net.n; i++) { const s = toScreen(N.net.world(i, 0), rect); if (s) { const d = (s[0] - x) ** 2 + (s[1] - y) ** 2; if (d < bd) { bd = d; best = i; } } }
    return best;
  }
  function pickConn(cx, cy, lim = COARSE ? 28 : 16) {
    const rect = $('view').getBoundingClientRect(), x = cx - rect.left, y = cy - rect.top; let best = null, bd = lim * lim;
    for (const c of N.net.conns) {
      let prev = null;
      for (const p of c.pts) {
        const s = toScreen(p, rect); if (!s) { prev = null; continue; }
        if (prev) { const ax = prev[0], ay = prev[1], dx = s[0] - ax, dy = s[1] - ay, L2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)), d = (ax + dx * t - x) ** 2 + (ay + dy * t - y) ** 2; if (d < bd) { bd = d; best = c; } }
        prev = s;
      }
    }
    return best;
  }
  const _ray = new THREE.Raycaster(), _pl = new THREE.Plane(), _hit = new THREE.Vector3();
  function planePoint(cx, cy, yLevel) {
    const rect = $('view').getBoundingClientRect();
    _ray.setFromCamera({ x: (cx - rect.left) / rect.width * 2 - 1, y: -((cy - rect.top) / rect.height * 2 - 1) }, stage.camera);
    _pl.set(new THREE.Vector3(0, 1, 0), -yLevel);
    return _ray.ray.intersectPlane(_pl, _hit) ? [_hit.x, yLevel, _hit.z] : null;
  }

  function connectTo(src, hit) {
    const net = N.net; if (src < 0 || !hit || hit.i === src) return null;
    if (net.conns.some(c => c.pre === src && c.post === hit.i)) { say(`Cell ${src + 1} already drives cell ${hit.i + 1}.`); return null; }
    const ty = net.sign[src] === 'i' ? 'i' : N.newTy;
    const o = { ty, wx: ty === 'i' ? wireNow().wI : wireNow().wE };
    if (net.isDend(hit.i, hit.k)) o.node = hit.k;
    const c = net.connect(src, hit.i, o);
    if (ty === 'i') net.sign[src] = 'i';
    refreshAxons([c]); relabel(); drawMatrix(); writeHash();
    say(`Linked ${src + 1} → ${hit.i + 1} (${ty === 'i' ? 'inhibitory' : 'excitatory'}, delay ${c.delay.toFixed(1)} ms).`);
    return c;
  }
  function say(t) { N.msg = t; const e = $('netMsg'); if (e) e.textContent = t; }

  function bindPointer() {
    let down = null, moveT = 0;
    const view = $('view');
    view.addEventListener('pointerdown', e => {
      if (!N.on || ctx.L.saver) return;
      down = { x: e.clientX, y: e.clientY, t: performance.now(), drag: null };
      if (N.tool === 'move') { const i = pickSoma(e.clientX, e.clientY); if (i >= 0) { down.drag = { i }; stage.controls.enabled = false; } }
      else if (N.tool === 'wire' && !COARSE && N.pending < 0) { const h = pickNode(e.clientX, e.clientY); if (h) { down.drag = { src: h.i }; N.pending = h.i; relabel(); stage.controls.enabled = false; } }
    });
    view.addEventListener('pointermove', e => {
      if (!down || !down.drag || down.drag.i == null) return;
      const now = performance.now(); if (now - moveT < 40) return; moveT = now;
      const i = down.drag.i, p = planePoint(e.clientX, e.clientY, N.net.place[i].p[1]); if (!p) return;
      N.net.move(i, p); N.net.moved[i] = true; N.cells[i].g.position.set(...p);
      refreshAxons(N.net.conns.filter(c => c.pre === i || c.post === i));
    });
    const up = e => {
      if (!down) return;
      const d = Math.hypot(e.clientX - down.x, e.clientY - down.y), tap = d < 8 && performance.now() - down.t < 600, dr = down.drag;
      stage.controls.enabled = true; down = null;
      if (!N.on) return;
      if (dr && dr.i != null) { refreshAxons(); writeHash(); return; }
      if (dr && dr.src != null && !tap) { const h = pickNode(e.clientX, e.clientY); connectTo(dr.src, h); N.pending = -1; relabel(); return; }
      if (!tap) { if (dr) { N.pending = -1; relabel(); } return; }
      $('hint').classList.add('gone');
      if (N.tool === 'wire') {
        const h = pickNode(e.clientX, e.clientY);
        if (!h) { N.pending = -1; relabel(); return; }
        if (N.pending < 0 || N.pending === h.i) { N.pending = h.i; relabel(); say(`Cell ${h.i + 1} chosen. Now tap a dendrite of another cell.`); }
        else { connectTo(N.pending, h); N.pending = -1; relabel(); }
      } else if (N.tool === 'kick') { const h = pickNode(e.clientX, e.clientY); if (h) { N.net.kick(h.i); say(`Kicked cell ${h.i + 1}.`); } }
      else if (N.tool === 'select') { const c = pickConn(e.clientX, e.clientY); if (c) { if (N.sel.has(c)) N.sel.delete(c); else N.sel.add(c); } else if (!e.shiftKey) N.sel.clear(); paintSel(); selUI(); drawMatrix(); }
      else if (N.tool === 'erase') { const c = pickConn(e.clientX, e.clientY); if (c) { editLinks(N.net, [c], { remove: true }); refreshAxons(); selUI(); drawMatrix(); writeHash(); say('Link removed.'); } }
    };
    view.addEventListener('pointerup', up); view.addEventListener('pointercancel', () => { down = null; stage.controls.enabled = true; });
  }

  // ── controls ──────────────────────────────────────────────────────────
  const segs = (host, items, cur, on) => {
    host.innerHTML = Object.entries(items).map(([k, v]) => `<button type="button" data-k="${k}" class="${k === cur ? 'on' : ''}">${v}</button>`).join('');
    host.querySelectorAll('button').forEach(b => b.addEventListener('click', () => on(b.dataset.k)));
  };
  function rangeRow(id, fn, fmt) { const e = $(id); if (!e) return; const show = () => { const o = $(id + 'V'); if (o) o.textContent = fmt(+e.value); }; e.addEventListener('input', () => { fn(+e.value); show(); }); show(); }
  function syncUI() {
    $('netMode').querySelectorAll('button').forEach(b => b.classList.toggle('on', (b.dataset.k === 'net') === N.on));
    if (!N.on) return;
    const w = wireNow(), net = N.net;
    segs($('netLayout'), LAYOUT_NAMES, w.layout, k => { w.layout = k; enable(make()); });
    segs($('netPreset'), PRESET_NAMES, w.preset, k => { w.preset = k; applyPreset(N.net, w, ctx.RS.seeds.wire || 1); refreshAxons(); relabel(); selUI(); drawMatrix(); writeHash(); N.kick = null; syncUI(); });
    segs($('netDemos'), DEMO_NAMES, N.demo, k => runDemo(k));
    segs($('netTools'), { wire: 'Wire', select: 'Select', kick: 'Kick', move: 'Move', erase: 'Erase' }, N.tool, k => { N.tool = k; N.pending = -1; relabel(); syncUI(); hint(); });
    segs($('netNewTy'), { e: 'Excitatory', i: 'Inhibitory' }, N.newTy, k => { N.newTy = k; syncUI(); });
    const set = (id, v) => { const e = $(id); if (e) { e.value = v; e.dispatchEvent(new Event('show')); } };
    set('netCount', net.n); set('netWE', w.wE); set('netWI', w.wI); set('netVel', net.velocity); set('netP', w.p);
    $('netCount').max = phone() ? BUDGET.phone.cells : BUDGET.desktop.cells;
    for (const id of ['netCount', 'netWE', 'netWI', 'netVel', 'netP', 'netKickEvery']) { const e = $(id), o = $(id + 'V'); if (e && o) o.textContent = FMT[id](+e.value); }
    $('netAuto').classList.toggle('on', N.auto && !N.kick);
    $('netStats').textContent = `${net.n} cells · ${net.conns.length} links · ${net.total} compartments (d_lambda ${net.dl}${net.over ? ', over budget' : ''}) · budget ${phone() ? BUDGET.phone.comps : BUDGET.desktop.comps}`;
    selUI(); hint();
  }
  const FMT = { netCount: v => String(v), netWE: v => v.toFixed(1) + '×', netWI: v => v.toFixed(1) + '×', netVel: v => v.toFixed(2) + ' m/s', netP: v => v.toFixed(2), netKickEvery: v => v + ' ms', netSelW: v => v.toFixed(1) + '×', netSelD: v => v.toFixed(1) + ' ms' };
  function hint() {
    const t = { wire: COARSE ? 'Tap a cell, then tap a dendrite of another cell to link them.' : 'Drag from a cell to a dendrite of another cell to link them (or tap one, then the other).', select: 'Tap axons to select them; edit the selection below.', kick: 'Tap a cell to fire it.', move: 'Drag a soma to move its cell; the axons and delays follow.', erase: 'Tap an axon to remove the link.' }[N.tool];
    const e = $('netHint'); if (e) e.textContent = t;
  }
  function selUI() {
    const box = $('netSel'); if (!box) return;
    const list = [...N.sel];
    box.hidden = !N.on;
    $('netSelN').textContent = list.length ? `${list.length} link${list.length > 1 ? 's' : ''} selected` : 'No links selected';
    box.classList.toggle('empty', !list.length);
    if (list.length) {
      const wx = list.reduce((a, c) => a + wxOf(N.net, c), 0) / list.length, fixed = list.find(c => c.fixed != null);
      $('netSelW').value = wx.toFixed(1); $('netSelWV').textContent = FMT.netSelW(wx);
      $('netSelD').value = fixed ? fixed.fixed : list[0].delay; $('netSelDV').textContent = FMT.netSelD(+$('netSelD').value);
      $('netSelAuto').classList.toggle('on', !fixed);
      const tys = new Set(list.map(c => c.ty));
      $('netSelTy').querySelectorAll('button').forEach(b => b.classList.toggle('on', tys.size === 1 && tys.has(b.dataset.k)));
    }
  }
  function editSel(e) { const list = [...N.sel]; if (!list.length) return; editLinks(N.net, list, e); if (e.remove) N.sel.clear(); refreshAxons(); relabel(); selUI(); drawMatrix(); writeHash(); }
  function runDemo(k, o = {}) {
    const D = DEMOS[k]; if (!D) return;
    N.w = { ...D.wire };
    enable(make({ wire: N.w, seed: o.seed }), { demo: k, kicks: D.kick, ...o });
    say(D.title + '.');
  }
  function bindUI() {
    segs($('netMode'), { cell: 'One cell', net: 'Network' }, 'cell', k => { if (k === 'net') { if (!N.on) runDemo('chain'); } else disable(); });
    rangeRow('netCount', v => { wireNow().count = v; enable(make()); }, FMT.netCount);
    rangeRow('netWE', v => { const w = wireNow(); w.wE = v; editLinks(N.net, N.net.conns.filter(c => c.ty === 'e'), { wx: v }); drawMatrix(); writeHash(); }, FMT.netWE);
    rangeRow('netWI', v => { const w = wireNow(); w.wI = v; editLinks(N.net, N.net.conns.filter(c => c.ty === 'i'), { wx: v }); drawMatrix(); writeHash(); }, FMT.netWI);
    rangeRow('netVel', v => { wireNow().velocity = v; N.net.setVelocity(v); refreshAxons(); writeHash(); }, FMT.netVel);
    rangeRow('netP', v => { wireNow().p = v; }, FMT.netP);
    rangeRow('netKickEvery', v => { N.kickEvery = v; }, FMT.netKickEvery);
    rangeRow('netSelW', v => editSel({ wx: v }), FMT.netSelW);
    rangeRow('netSelD', v => editSel({ delay: v }), FMT.netSelD);
    $('netAuto').addEventListener('click', () => { N.kick = null; N.auto = !N.auto; syncUI(); });
    $('netKick').addEventListener('click', () => { if (N.net) N.net.kick(0); });
    $('netKickAll').addEventListener('click', () => { if (N.net) for (let i = 0; i < N.net.n; i++) N.net.kick(i); });
    $('netReset').addEventListener('click', () => { if (N.net) { N.net.reset(); N.lastKick = -1e9; resetHist(); if (N.demo) N.kick = kicker(DEMOS[N.demo].kick); } });
    $('netFit').addEventListener('click', () => fit(true));
    $('netSelAll').addEventListener('click', () => { for (const c of N.net.conns) N.sel.add(c); paintSel(); selUI(); drawMatrix(); });
    $('netSelNone').addEventListener('click', () => { N.sel.clear(); paintSel(); selUI(); drawMatrix(); });
    $('netSelDel').addEventListener('click', () => editSel({ remove: true }));
    $('netSelAuto').addEventListener('click', () => editSel({ delay: 'auto' }));
    segs($('netSelTy'), { e: 'Excitatory', i: 'Inhibitory' }, null, k => editSel({ ty: k }));
    const mx = $('netMatrix');
    mx.addEventListener('click', e => {
      const G = mx.__geo; if (!G || !N.net) return;
      const r = mx.getBoundingClientRect(), x = e.clientX - r.left - G.pad, y = e.clientY - r.top - G.pad;
      const j = Math.floor(x / G.s), i = Math.floor(y / G.s); if (i < 0 || j < 0 || i >= G.n || j >= G.n) return;
      const w = wireNow(), st = cycleLink(N.net, i, j, { e: w.wE, i: w.wI });
      if (st === -1) N.net.sign[i] = 'i'; else if (!N.net.conns.some(c => c.pre === i && c.ty === 'i')) N.net.sign[i] = 'e';
      N.kick = null; refreshAxons(); relabel(); selUI(); drawMatrix(); writeHash();
      say(st === 0 ? `No link ${i + 1} → ${j + 1}.` : `Link ${i + 1} → ${j + 1} is ${st > 0 ? 'excitatory' : 'inhibitory'}.`);
    });
    bindPointer();
  }

  // ── per frame ─────────────────────────────────────────────────────────
  let plotT = 0;
  function frame(dt, now, simMs) {
    if (!N.on) return;
    if (simMs > 0) step(simMs);
    drawBeads();
    if (!ctx.L.saver) {
      placeLabels();
      if (now - plotT > 60) { plotT = now; drawRaster(); drawMatrix(); readout(); }
    }
  }
  function readout() {
    const net = N.net, last = net.spikes.length ? net.spikes[net.spikes.length - 2] : NaN;
    let firing = 0; for (let q = net.spikes.length - 2; q >= 0 && net.spikes[q] > net.t - 50; q -= 2) firing++;
    $('read').innerHTML = `Network · ${net.n} cells · t <span class="hi">${net.t.toFixed(1)}</span> ms<br>${net.conns.length} links · <span class="hi">${firing}</span> spikes in the last 50 ms<br><span class="lo">${isNaN(last) ? 'no spike yet' : 'last spike ' + (net.t - last).toFixed(1) + ' ms ago'}</span>`;
  }

  // ── hooks for main.js, randpanel.js and the saver ─────────────────────
  const api = {
    get on() { return N.on; }, N, enable, disable, make, step, frame, fit, worldBounds, runDemo, drawRaster, resetHist, rebuild, refreshAxons,
    onRandom(cats) {
      if (!N.on) return;
      if (cats.includes('wire')) { N.w = { ...randValues('wire') }; N.demo = null; enable(make(), { hash: false }); }
      else if (cats.includes('morph')) enable(make(), { hash: false });
      else if (cats.includes('bio')) { const st = netState(N.net); enable(make({ types: st.types, conns: st.conns, place: st.pos, velocity: st.vel }), { fit: false, hash: false }); }
    },
    hashState() { return N.on ? { mode: 'net', net: netState(N.net) } : {}; },
    boot(hash) {
      bindUI(); syncUI();
      let st = {}; try { st = decodeHash(hash || ''); } catch (e) { /* bad hash */ }
      if (st.mode === 'net' && st.net) {
        const w = wireNow(); w.layout = st.net.layout || w.layout; w.count = st.net.n; w.velocity = st.net.vel;
        try { enable(make({ types: st.net.types, conns: st.net.conns || [], place: st.net.pos, velocity: st.net.vel }), { hash: false, jump: true }); }
        catch (e) { console.warn('neuron-lab: the network in the link did not load:', e.message); }
      }
    },
  };
  window.__nlNet = api;
  return api;
}
