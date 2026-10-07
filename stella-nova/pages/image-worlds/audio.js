// ============================================================================
//  IMAGE WORLDS  ·  audio.js — spatial sound for a world (WebAudio)
// ────────────────────────────────────────────────────────────────────────────
//  Sound is off when the page opens. The Sound toggle makes the AudioContext
//  inside that tap, so the browser lets it play.
//
//  AMBIENT  each loop in output/sfx/ plays through its own PannerNode. The
//           upstream viewer plays the loops flat (THREE.Audio). Here each
//           loop sits at a fixed point on a 4 m circle round the spawn, with
//           a large refDistance: it stays at about the same level as you
//           move, but it turns with your head.
//  OBJECTS  each object gets a PannerNode (HRTF, refDistance 1.2) that
//           follows the object. hit(obj, strength) plays one of its impact
//           sounds, never the same one twice in a row (upstream
//           playRandomSfx), at a gain from the strength.
//  LISTENER follows the camera each frame (position, forward, up).
//
//  EXPORTS  createAudio() -> { enable(on), setWorld(world), addEmitter(id),
//           hit(id, strength, pos), update(camera, emitters), state(), dispose() }
//           emitters: Map id -> THREE.Vector3 (world position)
// ============================================================================
export function createAudio() {
  let ctx = null, master = null, on = false, gen = 0;
  let world = null;
  const buffers = new Map();          // entry.path -> AudioBuffer | Promise
  const ambient = [];                 // { src, pan }
  const emit = new Map();             // id -> { pan, sfx: [entry], last }
  let pending = 0;

  const decode = async entry => {
    if (buffers.has(entry.path)) return buffers.get(entry.path);
    const p = (async () => {
      const b = await entry.bytes();
      return ctx.decodeAudioData(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    })();
    buffers.set(entry.path, p);
    try { const buf = await p; buffers.set(entry.path, buf); return buf; }
    catch (e) { buffers.delete(entry.path); console.warn('image-worlds: skipped sound ' + entry.path + ': ' + (e.message || e)); return null; }
  };

  const panner = (x, y, z, ref, model = 'HRTF') => {
    const p = ctx.createPanner();
    p.panningModel = model; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = 1; p.maxDistance = 200;
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
    p.connect(master);
    return p;
  };

  function stopAmbient() {
    for (const a of ambient) { try { a.src.stop(); } catch (e) {} a.src.disconnect(); a.pan.disconnect(); }
    ambient.length = 0;
  }

  async function startAmbient() {
    stopAmbient();
    if (!ctx || !on || !world) return;
    const my = ++gen, list = world.ambient || [];
    pending = list.length;
    const bufs = await Promise.all(list.map(decode));
    pending = 0;
    if (my !== gen || !on) return;
    bufs.forEach((buf, i) => {
      if (!buf) return;
      const a = (i / Math.max(1, bufs.length)) * Math.PI * 2 + 0.6;
      const pan = panner(Math.sin(a) * 4, 1.6, -0.5 - Math.cos(a) * 4, 6, 'equalpower');
      const g = ctx.createGain(); g.gain.value = 0.55 / Math.sqrt(bufs.length);
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      src.connect(g); g.connect(pan);
      src.start(ctx.currentTime + 0.05, (i * 3.7) % Math.max(0.1, buf.duration));
      ambient.push({ src, pan, g });
    });
  }

  return {
    async enable(v) {
      on = !!v;
      if (on && !ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { on = false; return false; }
        ctx = new AC();
        master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
        for (const e of emit.values()) if (!e.pan) e.pan = panner(0, 0, 0, 1.2);
      }
      if (!ctx) return on;
      if (on) { await ctx.resume().catch(() => {}); master.gain.setTargetAtTime(0.9, ctx.currentTime, 0.05); startAmbient(); }
      else { gen++; master.gain.setTargetAtTime(0, ctx.currentTime, 0.05); setTimeout(() => { if (!on) { stopAmbient(); ctx.suspend().catch(() => {}); } }, 300); }
      return on;
    },
    setWorld(w) {
      world = w; gen++;
      stopAmbient();
      for (const e of emit.values()) if (e.pan) e.pan.disconnect();
      emit.clear();
      for (const k of [...buffers.keys()]) buffers.delete(k);
      if (on) startAmbient();
    },
    addEmitter(id, sfx) {
      emit.set(id, { pan: ctx ? panner(0, 0, 0, 1.2) : null, sfx: sfx || [], last: -1 });
    },
    async hit(id, strength = 1) {
      const e = emit.get(id);
      if (!on || !ctx || !e || !e.sfx.length || !e.pan) return false;
      let k = 0;
      if (e.sfx.length > 1) { k = Math.floor(Math.random() * (e.sfx.length - 1)); if (e.last >= 0 && k >= e.last) k++; }
      e.last = k;
      const buf = await decode(e.sfx[k]);
      if (!buf || !on) return false;
      const src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = buf; src.playbackRate.value = 0.94 + Math.random() * 0.12;
      g.gain.value = Math.max(0.05, Math.min(1, strength));
      src.connect(g); g.connect(e.pan); src.start();
      src.onended = () => { src.disconnect(); g.disconnect(); };
      return true;
    },
    update(camera, positions) {
      if (!ctx || !on) return;
      const L = ctx.listener, p = camera.position, t = ctx.currentTime;
      const m = camera.matrixWorld.elements;
      const fx = -m[8], fy = -m[9], fz = -m[10], ux = m[4], uy = m[5], uz = m[6];
      if (L.positionX) {
        L.positionX.setTargetAtTime(p.x, t, 0.02); L.positionY.setTargetAtTime(p.y, t, 0.02); L.positionZ.setTargetAtTime(p.z, t, 0.02);
        L.forwardX.setTargetAtTime(fx, t, 0.02); L.forwardY.setTargetAtTime(fy, t, 0.02); L.forwardZ.setTargetAtTime(fz, t, 0.02);
        L.upX.setTargetAtTime(ux, t, 0.02); L.upY.setTargetAtTime(uy, t, 0.02); L.upZ.setTargetAtTime(uz, t, 0.02);
      } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(fx, fy, fz, ux, uy, uz); }
      if (positions) for (const [id, v] of positions) {
        const e = emit.get(id); if (!e || !e.pan) continue;
        if (e.pan.positionX) { e.pan.positionX.setTargetAtTime(v.x, t, 0.02); e.pan.positionY.setTargetAtTime(v.y, t, 0.02); e.pan.positionZ.setTargetAtTime(v.z, t, 0.02); }
        else e.pan.setPosition(v.x, v.y, v.z);
      }
    },
    state: () => ({ on, ctx: ctx ? ctx.state : 'none', ambient: ambient.length, emitters: emit.size, pending }),
    dispose() { on = false; gen++; stopAmbient(); if (ctx) ctx.close().catch(() => {}); ctx = null; },
  };
}
