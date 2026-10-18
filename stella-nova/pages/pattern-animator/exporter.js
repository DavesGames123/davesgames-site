// ============================================================================
//  ANIMATED PATTERN DESIGNER  ·  exporter.js — loop video, GIF, frames, stills
// ----------------------------------------------------------------------------
//  Five formats (the Export section of the panel):
//    video    MediaRecorder on a canvas stream: WebM (VP9, VP8) where the
//             browser has it, else MP4 (Safari). The frames are drawn at
//             the times of encode.js framePlan and sent with requestFrame
//             when the track has it, on a real-time clock, so the file
//             plays at the chosen fps and loops with no seam. The record
//             takes the length of the export in real time.
//    gif      encode.js GifWriter: each frame drawn, read back, mapped to
//             the palette table (gifPalette, quantize) and LZW coded. The
//             delays add up to the exact length.
//    zip      a PNG per frame in a stored ZIP (encode.js zipStore).
//    svg      the frame now as SVG (pattern-designer export.js toSVG over
//             motion.js materialise); dashes go in as stroke-dasharray.
//    png      the frame now as PNG at the chosen size.
//  The user picks the size (the short side in px), the fps and the length
//  (whole loops, so every file loops). After a save, the info line shows
//  the file name and its size.
//
//  The export canvas is in the document (out of sight): a detached canvas
//  gave black recordings in Safari on other pages of this site.
//
//  grep -n targets: "export function installExport", "async function toVideo",
//                   "async function toGif", "async function toZip",
//                   "function svgText", "function renderTo"
// ============================================================================
import { toSVG } from '../pattern-designer/export.js';
import { materialise } from './motion.js';
import { drawFrame } from './render.js';
import { framePlan, GifWriter, gifPalette, quantize, zipStore, fmtBytes } from './encode.js';

export const FORMATS = { video: 'Video', gif: 'GIF', zip: 'PNG frames', svg: 'SVG frame', png: 'PNG frame' };
export const SIZES = { video: [480, 720, 1080], gif: [240, 360, 480, 640], zip: [480, 720, 1080], svg: [1080], png: [720, 1080, 2160] };
export const FPS = { video: [24, 30, 60], gif: [10, 15, 20, 25], zip: [12, 24, 30], svg: [30], png: [30] };
export const VIDEO_TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4;codecs=avc1', 'video/mp4'];
// The first type the browser can record, or ''.
export function videoType(MR = typeof MediaRecorder !== 'undefined' ? MediaRecorder : null) {
  if (!MR || typeof MR.isTypeSupported !== 'function') return '';
  return VIDEO_TYPES.find(t => { try { return MR.isTypeSupported(t); } catch (e) { return false; } }) || '';
}
// Even pixel sizes (video codecs need them) with the short side = size.
export function exportDims(view, size) {
  const k = size / Math.min(view.W, view.H), ev = v => Math.max(2, 2 * Math.round(v / 2));
  return { w: ev(view.W * k), h: ev(view.H * k) };
}

export function installExport(api) {
  const $ = id => document.getElementById(id);
  const ex = { fmt: 'video', size: 720, fps: 30, loops: 1 };
  let busy = false, cancel = false;

  function renderTo(g, w, h, t) {
    const sc = api.scene, pl = api.player, p = api.pal();
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = p.bg; g.fillRect(0, 0, w, h);
    if (!sc || !pl) return;
    drawFrame(g, pl.play(t), { W: sc.view.W, H: sc.view.H, base: [w / sc.view.W, 0, 0], lut: pl.lut, paper: p.bg, lw: api.st.lw, lwScale: sc.lwScale, clip: api.clip() });
  }
  function canvas(w, h) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1';
    document.body.append(c);
    return c;
  }
  function download(blob, name) {
    const u = URL.createObjectURL(blob), l = document.createElement('a');
    l.href = u; l.download = name; document.body.append(l); l.click(); l.remove();
    setTimeout(() => URL.revokeObjectURL(u), 4000);
  }
  const sleepUntil = due => new Promise(r => setTimeout(r, Math.max(0, due - performance.now())));
  const tick = () => new Promise(r => setTimeout(r, 0));
  const progress = (u, label) => { const b = $('expBar'); b.hidden = u == null; b.value = u || 0; if (label) $('expState').textContent = label; };

  function plan() { return framePlan(api.st.anim.L, ex.fps, ex.loops); }
  function info(extra) {
    const sc = api.scene; if (!sc) return;
    const d = exportDims(sc.view, ex.size), P = plan();
    let t;
    if (ex.fmt === 'svg') t = `SVG of the frame now, ${d.w} × ${d.h} px.`;
    else if (ex.fmt === 'png') t = `PNG of the frame now, ${d.w} × ${d.h} px.`;
    else {
      t = `${FORMATS[ex.fmt]} ${d.w} × ${d.h} px, ${ex.fps} fps, ${ex.loops} loop${ex.loops > 1 ? 's' : ''} = ${P.len.toFixed(1)} s, ${P.n} frames.`;
      if (ex.fmt === 'video') { const vt = videoType(); t += vt ? ` ${vt.startsWith('video/mp4') ? 'MP4' : 'WebM'} (${(vt.split('codecs=')[1] || 'default codec')}); the record takes ${P.len.toFixed(0)} s.` : ' This browser cannot record video here: use GIF or PNG frames.'; }
      if (ex.fmt === 'gif' && d.w * d.h * P.n > 60e6) t += ' A large GIF: a smaller size or fps gives a smaller file.';
    }
    $('exportInfo').textContent = t + (extra ? ' ' + extra : '');
  }

  async function toVideo() {
    const sc = api.scene, type = videoType();
    if (!type) throw new Error('no video recorder in this browser');
    const d = exportDims(sc.view, ex.size), P = plan(), c = canvas(d.w, d.h), g = c.getContext('2d');
    renderTo(g, d.w, d.h, P.times[0]);
    let stream = c.captureStream(0), track = stream.getVideoTracks()[0];
    const manual = track && typeof track.requestFrame === 'function';
    if (!manual) { stream.getTracks().forEach(t => t.stop()); stream = c.captureStream(ex.fps); track = stream.getVideoTracks()[0]; }
    const rate = Math.round(Math.max(2e6, Math.min(24e6, d.w * d.h * ex.fps * 0.22)));
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: rate }), parts = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) parts.push(e.data); };
    const stopped = new Promise(r => { rec.onstop = r; });
    rec.start(500);
    const t0 = performance.now() + 30;
    for (let i = 0; i < P.n && !cancel; i++) {
      renderTo(g, d.w, d.h, P.times[i]);
      if (manual) track.requestFrame();
      await sleepUntil(t0 + (i + 1) * P.dt * 1000);
      if (i % 4 === 0) progress((i + 1) / P.n, `Recording ${Math.round(100 * (i + 1) / P.n)}%`);
    }
    rec.stop(); await stopped; stream.getTracks().forEach(t => t.stop()); c.remove();
    if (cancel) return null;
    return { blob: new Blob(parts, { type: type.split(';')[0] }), ext: type.startsWith('video/mp4') ? 'mp4' : 'webm', n: P.n };
  }
  async function toGif() {
    const sc = api.scene, d = exportDims(sc.view, ex.size), P = plan(), c = canvas(d.w, d.h), g = c.getContext('2d', { willReadFrequently: true });
    const pal = gifPalette(api.player.lut, api.pal().bg), w = new GifWriter(d.w, d.h, pal), cache = new Int16Array(32768).fill(-1), idx = new Uint8Array(d.w * d.h);
    for (let i = 0; i < P.n && !cancel; i++) {
      renderTo(g, d.w, d.h, P.times[i]);
      quantize(g.getImageData(0, 0, d.w, d.h).data, pal, cache, idx);
      w.frame(idx, P.delays[i]);
      progress((i + 1) / P.n, `GIF frame ${i + 1} of ${P.n}`);
      await tick();
    }
    c.remove();
    if (cancel) return null;
    return { blob: new Blob([w.end()], { type: 'image/gif' }), ext: 'gif', n: P.n };
  }
  async function toZip() {
    const sc = api.scene, d = exportDims(sc.view, ex.size), P = plan(), c = canvas(d.w, d.h), g = c.getContext('2d'), files = [];
    for (let i = 0; i < P.n && !cancel; i++) {
      renderTo(g, d.w, d.h, P.times[i]);
      const b = await new Promise(r => c.toBlob(r, 'image/png'));
      if (!b) throw new Error('the browser could not make a PNG');
      files.push({ name: `frame_${String(i).padStart(4, '0')}.png`, data: new Uint8Array(await b.arrayBuffer()) });
      progress((i + 1) / P.n, `PNG frame ${i + 1} of ${P.n}`);
    }
    c.remove();
    if (cancel) return null;
    const note = `Animated Pattern Designer (davesgames.io)\n${P.n} frames at ${ex.fps} fps = ${P.len} s, ${ex.loops} loop(s). Frame ${P.n} would be frame 0: the sequence loops.\n`;
    files.push({ name: 'README.txt', data: new TextEncoder().encode(note) });
    return { blob: new Blob([zipStore(files)], { type: 'application/zip' }), ext: 'zip', n: P.n };
  }
  // The frame now as SVG text.
  function svgText() {
    const sc = api.scene, pl = api.player, st = api.st; if (!sc || !pl) return '';
    const layers = pl.play(st.t); let items = [];
    for (const l of layers) items = items.concat(materialise(l.G, l.F));
    const d = exportDims(sc.view, ex.size), F = layers[0].F, z = Math.hypot(F.M[0], F.M[1]);
    const on = Object.keys(st.anim.ch).filter(k => st.anim.ch[k].on);
    const desc = `Animated Pattern Designer (davesgames.io). Pattern: ${sc.pat.name}. Seed ${st.seed}. Params ${JSON.stringify(st.P)}. Palette: ${api.pal().name}. Density ${sc.D.toFixed(2)}. Loop ${st.anim.L} s, frame at ${st.t.toFixed(3)} s. Motion: ${on.join(', ') || 'none'}.`;
    let svg = toSVG(items, { W: sc.view.W, H: sc.view.H, palette: { bg: api.pal().bg, ink: pl.lut }, lw: st.lw * sc.lwScale, title: `${sc.pat.name} · Animated Pattern Designer`, desc, size: { w: d.w, h: d.h, unit: 'px' }, clip: api.clip(), frame: false });
    if (F.dash) {
      const [a, b, o] = F.dash.map(v => (v * z).toFixed(2));
      svg = svg.replace(/<g fill="none" stroke="(#[0-9a-f]{3,8})"/gi, `<g fill="none" stroke="$1" stroke-dasharray="${a} ${b}" stroke-dashoffset="${o}"`);
    }
    return svg;
  }
  function toSvg() { const t = svgText(); return { blob: new Blob([t], { type: 'image/svg+xml' }), ext: 'svg', n: 1 }; }
  async function toPng() {
    const sc = api.scene, d = exportDims(sc.view, ex.size), c = canvas(d.w, d.h);
    renderTo(c.getContext('2d'), d.w, d.h, api.st.t);
    const b = await new Promise(r => c.toBlob(r, 'image/png')); c.remove();
    if (!b) throw new Error('the browser could not make a PNG');
    return { blob: b, ext: 'png', n: 1 };
  }

  async function go() {
    if (busy) { cancel = true; return; }
    if (!api.scene) return;
    busy = true; cancel = false;
    $('expGo').textContent = 'Stop'; $('expGo').classList.add('on');
    progress(0, 'Starting');
    const t0 = performance.now();
    try {
      const fn = { video: toVideo, gif: toGif, zip: toZip, svg: toSvg, png: toPng }[ex.fmt];
      const r = await fn();
      if (r) {
        const name = `${api.fileBase()}.${r.ext}`;
        download(r.blob, name);
        const msg = `Saved ${name} · ${fmtBytes(r.blob.size)}${r.n > 1 ? ` · ${r.n} frames` : ''}.`;
        info(msg); api.toast(msg);
        ex.last = { name, bytes: r.blob.size, frames: r.n, ms: performance.now() - t0 };
      } else { info('Stopped.'); }
    } catch (e) {
      api.toast('Export failed: ' + e.message); info('Export failed: ' + e.message);
    } finally {
      busy = false; cancel = false; progress(null, '');
      $('expGo').textContent = 'Export'; $('expGo').classList.remove('on');
    }
  }
  function options() {
    const fill = (id, list, v, f) => { const s = $(id); s.innerHTML = list.map(x => `<option value="${x}">${f(x)}</option>`).join(''); s.value = String(list.includes(v) ? v : list[Math.min(1, list.length - 1)]); return +s.value; };
    ex.size = fill('expSize', SIZES[ex.fmt], ex.size, x => `${x} px`);
    ex.fps = fill('expFps', FPS[ex.fmt], ex.fps, x => `${x} fps`);
    ex.loops = fill('expLoops', [1, 2, 3], ex.loops, x => `${x} loop${x > 1 ? 's' : ''}`);
    const still = ex.fmt === 'svg' || ex.fmt === 'png';
    $('expFps').hidden = still; $('expLoops').hidden = still; $('expSize').hidden = ex.fmt === 'svg';
    document.querySelectorAll('#expFmt button').forEach(b => { b.classList.toggle('on', b.dataset.f === ex.fmt); b.setAttribute('aria-pressed', String(b.dataset.f === ex.fmt)); });
    info();
  }
  return {
    ex, svgText, plan, info, go, renderTo,
    get busy() { return busy; },
    bind() {
      const box = $('expFmt'); box.textContent = '';
      for (const f in FORMATS) {
        const b = document.createElement('button'); b.dataset.f = f; b.textContent = FORMATS[f];
        b.addEventListener('click', () => { if (busy) return; ex.fmt = f; options(); });
        box.append(b);
      }
      $('expSize').addEventListener('change', () => { ex.size = +$('expSize').value; info(); });
      $('expFps').addEventListener('change', () => { ex.fps = +$('expFps').value; info(); });
      $('expLoops').addEventListener('change', () => { ex.loops = +$('expLoops').value; info(); });
      $('expGo').addEventListener('click', go);
      if (!videoType()) ex.fmt = 'gif';
      options();
    },
  };
}
