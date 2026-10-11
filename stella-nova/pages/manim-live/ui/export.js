// ============================================================================
//  EXPORT  ·  PNG of one frame, and a video from the frame cache
// ----------------------------------------------------------------------------
//  PNG: the current cached frame at its cached size.
//  Video: MediaRecorder on a canvas stream. The exporter draws each cached
//  frame once, calls track.requestFrame(), and waits one frame period, so
//  the video plays at the render fps. MP4 (H.264) when the browser can
//  record it (Safari, new Chrome), else WebM (VP9 or VP8). No ffmpeg.
//  The export takes as long as the clip, because MediaRecorder stamps
//  frames with wall-clock time.
//
//  EXPORTS
//    pickVideoType()                -> {mime, ext} or null
//    exportPNG(bitmap, name)        -> Promise<void> (download)
//    exportVideo(player, opts)      -> Promise<{blob, ext}>
//    download(blob, name)
// ============================================================================

export function pickVideoType() {
  if (typeof MediaRecorder === 'undefined') return null;
  const list = [
    ['video/mp4;codecs=avc1.42E01E', 'mp4'], ['video/mp4;codecs=avc1', 'mp4'], ['video/mp4', 'mp4'],
    ['video/webm;codecs=vp9', 'webm'], ['video/webm;codecs=vp8', 'webm'], ['video/webm', 'webm'],
  ];
  for (const [mime, ext] of list) if (MediaRecorder.isTypeSupported?.(mime)) return { mime, ext };
  return null;
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export async function exportPNG(bitmap, name = 'frame.png') {
  if (!bitmap) throw new Error('No frame to save yet.');
  const c = document.createElement('canvas');
  c.width = bitmap.width; c.height = bitmap.height;
  c.getContext('2d').drawImage(bitmap, 0, 0);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  download(blob, name);
}

// opts: {onProgress(fraction), signal: AbortSignal, bitrate}
export async function exportVideo(player, opts = {}) {
  const type = pickVideoType();
  if (!type) throw new Error('This browser cannot record video (no MediaRecorder).');
  const n = player.frameCount();
  if (!n) throw new Error('Run a scene first.');
  const fps = player.fps();
  const first = player.bitmap(0);
  const { width, height } = player.size();
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, width, height);
  if (first) g.drawImage(first, 0, 0, width, height);
  const stream = c.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const rec = new MediaRecorder(stream, { mimeType: type.mime, videoBitsPerSecond: opts.bitrate || Math.round(width * height * fps * 0.12) });
  const chunks = [];
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise(r => { rec.onstop = r; });
  rec.start(250);
  const period = 1000 / fps;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    if (opts.signal?.aborted) break;
    const bm = player.bitmap(i);
    if (bm) g.drawImage(bm, 0, 0, width, height);
    track.requestFrame?.();
    opts.onProgress?.((i + 1) / n);
    const wait = t0 + (i + 1) * period - performance.now();
    await new Promise(r => setTimeout(r, Math.max(0, wait)));
  }
  rec.stop();
  await stopped;
  track.stop();
  if (opts.signal?.aborted) throw new Error('Export stopped.');
  return { blob: new Blob(chunks, { type: type.mime.split(';')[0] }), ext: type.ext };
}
