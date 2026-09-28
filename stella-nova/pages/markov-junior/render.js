// render.js — WebGPU view of a MarkovJunior grid. No DOM.
//
// createRenderer(device, format, wgsl) returns an object with three calls:
//   pack(ip, aux)    copy the interpreter arrays into the cell texture; only
//                    the dirty rows, unless aux (matches / potential) is on
//   palette(colors)  set up to 32 palette entries, each [r, g, b] in 0..1
//   draw(enc, target, views, u)  one viewport per view
//
// The cell texture is rgba32uint, one texel per cell; grid.wgsl lists the
// channel layout.
//
// grep: export async function createRenderer  pack(  draw(  auxMatches  auxPotential

export async function createRenderer(device, format, wgsl) {
  const module = device.createShaderModule({ code: wgsl, label: 'grid' });
  const F = 2;   // GPUShaderStage.FRAGMENT
  const bgl0 = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: F, buffer: { type: 'uniform' } },
    { binding: 1, visibility: F, texture: { sampleType: 'uint', viewDimension: '2d' } },
  ] });
  const bgl1 = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: F, buffer: { type: 'uniform' } }] });
  const pipeline = await device.createRenderPipelineAsync({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bgl0, bgl1] }),
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });
  const UB = GPUBufferUsage;
  const uData = new Float32Array(16 + 32 * 4);
  const uBuf = device.createBuffer({ size: uData.byteLength, usage: UB.UNIFORM | UB.COPY_DST });
  const vBuf = device.createBuffer({ size: 256 * 4, usage: UB.UNIFORM | UB.COPY_DST });
  const vBGs = [0, 1, 2, 3].map((i) => device.createBindGroup({ layout: bgl1,
    entries: [{ binding: 0, resource: { buffer: vBuf, offset: i * 256, size: 32 } }] }));

  let tex = null, bg0 = null, MX = 0, MY = 0, cpu = null, matchBuf = null;

  function ensure(mx, my) {
    if (mx === MX && my === MY && tex) return;
    tex?.destroy();
    MX = mx; MY = my;
    tex = device.createTexture({ size: [MX, MY], format: 'rgba32uint',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    cpu = new Uint32Array(MX * MY * 4);
    matchBuf = new Uint32Array(MX * MY);
    bg0 = device.createBindGroup({ layout: bgl0, entries: [
      { binding: 0, resource: { buffer: uBuf } }, { binding: 1, resource: tex.createView() }] });
  }

  // Pending-match coverage of the last leaf: +1 on every input cell of every
  // match still in its list. Returns the largest count.
  function auxMatches(ip) {
    matchBuf.fill(0);
    const leaf = ip.leaf;
    // A prl node applies each match as it finds it and keeps no match list.
    if (!leaf?.matches || !leaf.matchCount || leaf.kind === 'prl') return 0;
    let max = 0;
    const M = leaf.matches;
    for (let k = 0; k < leaf.matchCount; k++) {
      const r = leaf.rules[M[k * 4]], x = M[k * 4 + 1], y = M[k * 4 + 2];
      for (let dy = 0; dy < r.IMY; dy++) for (let dx = 0; dx < r.IMX; dx++) {
        const i = x + dx + (y + dy) * MX;
        const v = ++matchBuf[i];
        if (v > max) max = v;
      }
    }
    return max;
  }

  // Potential of the last leaf. which >= 0: that value's potential. Auto
  // with fields: the minimum over the values that have a field. Auto with
  // observe: the one value whose backward potential spans the most turns.
  // Most cells already hold a goal value (potential 0), so the value that
  // the rules move, for example a walker head, is the one that carries the
  // shape of the search.
  function auxPotential(ip, which, out) {
    const leaf = ip.leaf;
    const pots = leaf?.potentials;
    if (!pots) { out.fill(0); return { max: 0, value: -1 }; }
    let list;
    if (which >= 0) list = [which];
    else if (leaf.fields) list = pots.map((_, c) => c).filter((c) => leaf.fields[c]);
    else {
      let bestC = 0, bestMax = -1;
      pots.forEach((p, c) => { let m = -1; for (let i = 0; i < p.length; i++) if (p[i] > m) m = p[i]; if (m > bestMax) { bestMax = m; bestC = c; } });
      list = [bestC];
    }
    let max = 0;
    for (let i = 0; i < out.length; i++) {
      let best = -1;
      for (const c of list) { const p = pots[c][i]; if (p >= 0 && (best < 0 || p < best)) best = p; }
      out[i] = best + 1;
      if (best > max) max = best;
    }
    return { max, value: list.length === 1 ? list[0] : -1 };
  }

  const potBuf = { a: null };
  return {
    // aux: { matches: bool, potential: bool, potValue: int }. Returns
    // { matchMax, potMax } for the shader scales and potOf, the value shown.
    pack(ip, aux) {
      const g = ip.grid;
      ensure(g.MX, g.MY);
      let [y0, y1] = ip.takeDirty();
      const full = aux.matches || aux.potential;
      if (full) { y0 = 0; y1 = MY - 1; }
      let matchMax = 0, potMax = 0, potOf = -1;
      if (aux.matches) matchMax = auxMatches(ip);
      if (aux.potential) {
        if (!potBuf.a || potBuf.a.length !== MX * MY) potBuf.a = new Uint32Array(MX * MY);
        ({ max: potMax, value: potOf } = auxPotential(ip, aux.potValue, potBuf.a));
      }
      if (y1 < y0) return { matchMax, potMax, potOf };
      const { state } = g;
      const { writer, stamp, heat } = ip;
      for (let i = y0 * MX, e = (y1 + 1) * MX; i < e; i++) {
        const o = i * 4;
        cpu[o] = state[i] | (writer[i] << 8) | (aux.matches ? Math.min(matchBuf[i], 65535) << 16 : 0);
        cpu[o + 1] = stamp[i];
        cpu[o + 2] = heat[i];
        cpu[o + 3] = aux.potential ? potBuf.a[i] : 0;
      }
      device.queue.writeTexture({ texture: tex, origin: [0, y0] }, cpu, { offset: y0 * MX * 16, bytesPerRow: MX * 16 },
        [MX, y1 - y0 + 1]);
      return { matchMax, potMax, potOf };
    },
    palette(colors) {
      for (let i = 0; i < 32; i++) {
        const c = colors[i] ?? [1, 0, 1];
        uData.set([c[0], c[1], c[2], 1], 16 + i * 4);
      }
    },
    // u: { turn, C, zoom, panX, panY, grid, trail, heatMax, isolate, potMax,
    //      leaves, matchMax, highlight }
    draw(enc, target, views, u) {
      if (!tex) return;
      uData.set([MX, MY, u.C, u.turn, u.zoom, u.panX, u.panY, u.grid ? 1 : 0,
        u.trail, u.heatMax, u.isolate, u.potMax, u.leaves, u.matchMax, u.highlight, 0], 0);
      device.queue.writeBuffer(uBuf, 0, uData);
      views.forEach((v, i) => device.queue.writeBuffer(vBuf, i * 256, new Float32Array([v.x, v.y, v.w, v.h, v.pass, 0, 0, 0])));
      const rp = enc.beginRenderPass({ colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store',
        clearValue: { r: 0.03, g: 0.04, b: 0.07, a: 1 } }] });
      rp.setPipeline(pipeline);
      rp.setBindGroup(0, bg0);
      views.forEach((v, i) => {
        rp.setViewport(v.x, v.y, v.w, v.h, 0, 1);
        rp.setScissorRect(v.x, v.y, v.w, v.h);
        rp.setBindGroup(1, vBGs[i]);
        rp.draw(3);
      });
      rp.end();
    },
  };
}
