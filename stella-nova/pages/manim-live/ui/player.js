// ============================================================================
//  PLAYER  ·  frame cache, canvas, play / loop / scrub, animation timeline
// ----------------------------------------------------------------------------
//  The worker streams 'frame' events ({index, t, bitmap}) while manim
//  renders. The player keeps every ImageBitmap in a cache and draws the
//  newest one ("live"). When the run ends ('done'), the player loops the
//  cache at the render fps. The user can pause, step, scrub, and change
//  the speed at any time, also during the render.
//
//  MEMORY. A 1080p frame is about 8 MB. The cache keeps full frames up to
//  BUDGET bytes. After that, the player keeps a half-size copy of each new
//  frame (and then a quarter-size copy), and the status line says so.
//  Export uses the cache, so a reduced cache gives a smaller video.
//
//  TIMELINE. One segment per 'animation' event (ui/timeline.js), with the
//  animation name as its label. A click or drag on the track seeks. The
//  player calls onSegment(seg) when the segment under the head changes,
//  and main.js marks the code line of that segment.
//
//  EXPORTS
//    createPlayer({canvas, track, onSegment, onTick}) -> api
//  api: reset, addFrame, setAnimations, finish, play, pause, toggle,
//       seek, step, seekLine, setLoop, setSpeed, frameCount, current,
//       bitmap, fps, size, isPlaying, segments, destroy
// ============================================================================
import { buildSegments, segmentAtFrame, frameForLine, formatTime } from './timeline.js';

const BUDGET = 700 * 1024 * 1024;

export function createPlayer({ canvas, track, onSegment = () => {}, onTick = () => {} }) {
  const ctx = canvas.getContext('2d');
  let frames = [];              // ImageBitmap per index (may hold holes)
  let bytes = 0, scale = 1;
  let anims = [], segs = [];
  let fps = 15, width = 854, height = 480;
  let cur = -1, playing = false, live = true, done = false, loop = true, speed = 1;
  let raf = 0, lastT = 0, acc = 0, lastSeg = null;
  let generation = 0, lastSrc = null, lastBm = null;

  // ---- timeline DOM ----
  track.innerHTML = '';
  const segBox = document.createElement('div'); segBox.className = 'tl-segs';
  const fill = document.createElement('div'); fill.className = 'tl-buffer';
  const head = document.createElement('div'); head.className = 'tl-head';
  const tip = document.createElement('div'); tip.className = 'tl-tip'; tip.hidden = true;
  track.append(fill, segBox, head, tip);

  const span = () => Math.max(frames.length, segs.length ? segs[segs.length - 1].endFrame : 0, 1);

  function drawTimeline() {
    const n = span();
    segBox.innerHTML = '';
    segs.forEach((s, i) => {
      const el = document.createElement('div');
      el.className = 'tl-seg' + (/wait/i.test(s.name) ? ' is-wait' : '');
      el.style.left = (100 * s.startFrame / n) + '%';
      el.style.width = (100 * (s.endFrame - s.startFrame) / n) + '%';
      el.dataset.i = i;
      const lab = document.createElement('span');
      lab.textContent = s.name;
      el.appendChild(lab);
      el.title = `${s.name}${s.line ? ' · line ' + s.line : ''} · ${s.runTime.toFixed(2)} s`;
      segBox.appendChild(el);
    });
    placeHead();
  }

  function placeHead() {
    const n = span();
    fill.style.width = (100 * frames.length / n) + '%';
    head.style.left = (100 * Math.max(0, cur) / n) + '%';
    segBox.querySelectorAll('.tl-seg.on').forEach(e => e.classList.remove('on'));
    const s = segmentAtFrame(segs, cur);
    if (s) segBox.querySelector(`.tl-seg[data-i="${segs.indexOf(s)}"]`)?.classList.add('on');
  }

  function show(i) {
    if (!frames.length) return;
    i = Math.max(0, Math.min(frames.length - 1, i | 0));
    let bm = frames[i];
    if (!bm) { for (let j = i; j >= 0; j--) if (frames[j]) { bm = frames[j]; break; } }
    cur = i;
    if (bm) {
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      ctx.imageSmoothingEnabled = true;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(bm, 0, 0, width, height);
    }
    placeHead();
    const s = segmentAtFrame(segs, cur);
    if (s !== lastSeg) { lastSeg = s; onSegment(s); }
    onTick(state());
  }

  function state() {
    return { frame: cur, frames: frames.length, time: Math.max(0, cur) / fps, duration: frames.length / fps, playing, live: live && !done, done, loop, speed, scale, timeText: `${formatTime(Math.max(0, cur) / fps)} / ${formatTime(frames.length / fps)}` };
  }

  function loopFn(t) {
    raf = 0;
    if (!playing) return;
    const dt = Math.min(0.25, (t - (lastT || t)) / 1000);
    lastT = t;
    acc += dt * fps * speed;
    if (acc >= 1) {
      const stepN = Math.floor(acc);
      acc -= stepN;
      let next = cur + stepN;
      if (next >= frames.length) {
        if (!done) next = frames.length - 1;          // wait for the stream
        else if (loop) next = next % frames.length;
        else { next = frames.length - 1; show(next); pause(); return; }
      }
      if (next !== cur) show(next);
    }
    raf = requestAnimationFrame(loopFn);
  }

  function play() {
    if (!frames.length) return;
    if (done && cur >= frames.length - 1 && !loop) cur = 0;
    live = false;
    playing = true; lastT = 0; acc = 0;
    if (!raf) raf = requestAnimationFrame(loopFn);
    onTick(state());
  }
  function pause() {
    playing = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    onTick(state());
  }

  // ---- scrub on the track ----
  let dragging = false;
  const frameAtX = (x) => {
    const r = track.getBoundingClientRect();
    return Math.round(Math.max(0, Math.min(1, (x - r.left) / r.width)) * (span() - 1));
  };
  track.addEventListener('pointerdown', e => {
    if (!frames.length) return;
    dragging = true; track.setPointerCapture(e.pointerId);
    live = false; pause(); show(frameAtX(e.clientX));
  });
  track.addEventListener('pointermove', e => {
    const f = frameAtX(e.clientX);
    if (dragging) { show(f); return; }
    const s = segmentAtFrame(segs, f);
    if (s) {
      tip.hidden = false;
      tip.textContent = `${s.name}${s.line ? ' · line ' + s.line : ''}`;
      const r = track.getBoundingClientRect();
      tip.style.left = Math.max(0, Math.min(r.width - 10, e.clientX - r.left)) + 'px';
    } else tip.hidden = true;
  });
  const endDrag = () => { dragging = false; };
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);
  track.addEventListener('pointerleave', () => { tip.hidden = true; });

  const api = {
    reset(meta = {}) {
      pause();
      for (const b of new Set(frames)) try { b && b.close && b.close(); } catch {}
      generation++; lastSrc = null; lastBm = null;
      frames = []; bytes = 0; scale = 1; anims = []; segs = [];
      cur = -1; live = true; done = false; lastSeg = null;
      if (meta.fps) fps = meta.fps;
      if (meta.width) width = meta.width;
      if (meta.height) height = meta.height;
      drawTimeline();
      onSegment(null);
      onTick(state());
    },
    // engine.js sends one 'frame' event per index. A held frame (for
    // example in self.wait) is one bitmap for many indices, so the cache
    // keeps one copy per source bitmap and counts its bytes once.
    async addFrame({ index, bitmap }) {
      if (!bitmap) return;
      const gen = generation;
      const i = Number.isFinite(index) ? index : frames.length;
      if (frames.length === 0 && bitmap.width) { width = bitmap.width; height = bitmap.height; }
      if (bitmap !== lastSrc) {
        lastSrc = bitmap;
        const full = bitmap.width * bitmap.height * 4;
        while (scale > 0.25 && bytes + full * scale * scale > BUDGET) scale /= 2;
        if (scale < 1 && typeof createImageBitmap === 'function') {
          const w = Math.max(1, Math.round(bitmap.width * scale)), h = Math.max(1, Math.round(bitmap.height * scale));
          lastBm = createImageBitmap(bitmap, { resizeWidth: w, resizeHeight: h, resizeQuality: 'medium' })
            .then(small => { try { bitmap.close && bitmap.close(); } catch {} return small; }, () => bitmap);
          bytes += w * h * 4;
        } else {
          lastBm = bitmap;
          bytes += full;
        }
      }
      const bm = await lastBm;
      if (gen !== generation) return;          // a reset came while it waited
      frames[i] = bm;
      if (live && !playing) show(i);
      else placeHead();
      if (frames.length % 8 === 1) drawTimeline();
    },
    setAnimations(list) {
      anims = list.slice();
      segs = buildSegments(anims, done ? frames.length : 0, fps);
      drawTimeline();
    },
    addAnimation(a) { anims.push(a); api.setAnimations(anims); },
    finish(meta = {}) {
      done = true;
      if (meta.fps) fps = meta.fps;
      segs = buildSegments(anims, frames.length, fps);
      drawTimeline();
      if (frames.length) { cur = 0; show(0); play(); }
      onTick(state());
    },
    play, pause,
    toggle() { playing ? pause() : play(); },
    seek(i) { live = false; pause(); show(i); },
    step(d) { live = false; pause(); show((cur < 0 ? 0 : cur) + d); },
    seekLine(line) {
      const f = frameForLine(segs, line);
      if (f < 0 || f >= frames.length) return false;
      const wasPlaying = playing;
      live = false; show(f);
      if (!wasPlaying) pause();
      return true;
    },
    setLoop(v) { loop = !!v; onTick(state()); },
    setSpeed(v) { speed = +v || 1; onTick(state()); },
    frameCount: () => frames.length,
    current: () => cur,
    bitmap: (i) => frames[i ?? cur] || null,
    fps: () => fps,
    size: () => ({ width, height }),
    isPlaying: () => playing,
    segments: () => segs,
    state,
    destroy() { api.reset(); },
  };
  return api;
}
