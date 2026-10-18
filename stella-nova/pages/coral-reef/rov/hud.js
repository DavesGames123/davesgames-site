// ============================================================================
//  CORAL REEF  ·  ROV  ·  the SSTV feed panel HUD (canvas 2D, no other DOM)
// ----------------------------------------------------------------------------
//  The panel: a top bar (vehicle, camera, received mode and VIS), the
//  received picture with corner marks, a scan cursor on the row being
//  received and a centre mark, and a bottom bar (depth, heading, mission
//  time, line counter, signal meter and SNR). Panel size HUD.W x HUD.H in
//  CSS pixels; the canvas has dpr times that.
//
//  hudFields(info) gives every text field, so the node test checks them
//  without a canvas. drawHud(ctx, info, picture, o) draws them; picture is
//  a canvas (or ImageBitmap) of the received picture, or null.
//  info: { id, depth (m), heading (deg), time (s), tag ({ name, sci } of the
//          creature in view, fauna/hook.js feedTag; drawn as a label over the
//          picture), status (SstvLink.status()
//          or the live status of feed.js), rec (bool), t (s, wall clock for
//          blinks) }
//  The live status { live: true, fps, target, frames, signal, glitch }
//  gives LIVE fields: the mode 'LIVE 30 FPS', 'ANALOG', the frame count.
//  o.hole: the picture box is cleared to transparent (the live picture is
//  drawn under the panel by WebGL, feed.js present); o.aspect: its aspect.
//  o.colour: the colour of the ROV id (ROV_COLOURS, the same colour on the
//  camera bar, the feed card, the minimap and the 3D marker).
//  o.compact: the small card of a feed that is not the selected one (the
//  card stack of rov/feeds.js): larger text, only the id, the mode, the
//  depth, the heading and the signal meter, so it reads at about 200 px.
//  info.task (optional): the vehicle mode ('survey', 'inspect') in place
//  of 'CAM 1 HD' in the top bar.
//
//  grep -n targets
//    "export const HUD"          layout
//    "export const ROV_COLOURS"  one colour per ROV id (1 to 4)
//    "export function hudFields" text of each field
//    "export function drawHud"   the panel
// ============================================================================

export const HUD = { W: 352, H: 322, pic: { x: 16, y: 28, w: 320, h: 256 }, bar: 284 };
// ROV 1 amber (the old HUD id colour), 2 cyan, 3 pink, 4 lime: distinct on
// the dark blue water and in the three colour vision types; the number is
// always shown next to the colour.
export const ROV_COLOURS = ['#f2b705', '#3fd0ff', '#ff6fae', '#9be15d'];
export const rovColour = (id) => ROV_COLOURS[(((id ?? 1) - 1) % 4 + 4) % 4];
const pad2 = (n) => String(Math.floor(n)).padStart(2, '0');

// The creature in view (fauna/hook.js feedTag): 'OBS name · scientific name'.
export function tagText(tag) {
  if (!tag || !tag.name) return '';
  return 'OBS ' + tag.name + (tag.sci ? ' \u00b7 ' + tag.sci : '');
}

export function hudFields(info) {
  const s = info.status || {};
  const t = Math.max(0, info.time || 0);
  const hdg = ((Math.round(info.heading || 0) % 360) + 360) % 360;
  const db = s.signal && Number.isFinite(s.signal.db) ? s.signal.db : null;
  const phase = s.phase || 'idle';
  const cam = info.task ? String(info.task).toUpperCase().slice(0, 8) : 'CAM 1 HD';
  if (s.live) {
    return {
      id: 'ROV-' + (info.id ?? 1),
      cam,
      depth: 'DEPTH ' + (info.depth ?? 0).toFixed(1) + ' m',
      heading: 'HDG ' + String(hdg).padStart(3, '0') + '°',
      time: 'T+' + pad2(t / 3600) + ':' + pad2((t / 60) % 60) + ':' + pad2(t % 60),
      mode: 'LIVE ' + Math.round(s.fps || 0) + ' FPS',
      vis: 'ANALOG',
      signal: db == null ? 'SNR --' : 'SNR ' + Math.round(db) + ' dB',
      line: 'FRM ' + String(s.frames || 0).padStart(6, '0'),
      phase: s.glitch ? 'SYNC' : 'LIVE',
      level: s.signal ? s.signal.level : 0,
      tag: tagText(info.tag),
    };
  }
  return {
    id: 'ROV-' + (info.id ?? 1),
    cam,
    depth: 'DEPTH ' + (info.depth ?? 0).toFixed(1) + ' m',
    heading: 'HDG ' + String(hdg).padStart(3, '0') + '°',
    time: 'T+' + pad2(t / 3600) + ':' + pad2((t / 60) % 60) + ':' + pad2(t % 60),
    mode: (s.mode || 'Robot 36').toUpperCase(),
    vis: phase === 'novis' ? 'NO VIS' : s.vis != null ? 'VIS ' + s.vis : 'VIS --',
    signal: db == null ? 'SNR --' : 'SNR ' + Math.round(db) + ' dB',
    line: 'LN ' + String(s.line || 0).padStart(3, '0') + '/' + (s.lines || 0),
    phase: { vis: 'SYNC VIS', image: 'RX', done: 'HOLD', hold: 'HOLD', need: 'WAIT', novis: 'NO SIGNAL', idle: 'WAIT' }[phase] || 'RX',
    level: s.signal ? s.signal.level : 0,
    tag: tagText(info.tag),
  };
}

export function drawHud(ctx, info, picture, o = {}) {
  const F = hudFields(info), s = info.status || {};
  const { W, H, pic, bar } = HUD;
  const ink = '#cfe6e0', dim = '#6f8a86', amber = o.colour || '#f2b705', red = '#ff5a3c';
  ctx.save();
  ctx.fillStyle = '#05090b'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(207,230,224,0.25)'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  if (o.compact) { compact(ctx, F, s, info, o, amber, ink, dim, red, picture); ctx.restore(); return F; }
  ctx.font = '600 11px ui-monospace, Menlo, Consolas, monospace';
  ctx.textBaseline = 'middle';
  // top bar
  ctx.fillStyle = amber; ctx.textAlign = 'left'; ctx.fillText(F.id, 12, 14);
  ctx.fillStyle = dim; ctx.fillText(F.cam, 66, 14);
  ctx.textAlign = 'right'; ctx.fillStyle = s.phase === 'novis' ? red : ink;
  ctx.fillText(F.mode + '  ' + F.vis, W - 12, 14);
  // REC dot, and the receive phase
  const blink = Math.floor((info.t || 0) * 1.6) % 2 === 0;
  ctx.textAlign = 'left';
  const rec = s.phase === 'image' || s.live;
  if (blink || !rec) { ctx.fillStyle = rec ? red : dim; ctx.beginPath(); ctx.arc(140, 14, 3.2, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = dim; ctx.fillText(F.phase, 148, 14);
  // picture
  ctx.fillStyle = '#000'; ctx.fillRect(pic.x, pic.y, pic.w, pic.h);
  let py = pic.y, ph = pic.h;
  if (o.hole) {
    // the live picture is under the panel: a clear box at its aspect
    ph = Math.min(pic.h, Math.round(pic.w / (o.aspect || 4 / 3))); py = pic.y + Math.round((pic.h - ph) / 2);
    ctx.clearRect(pic.x, py, pic.w, ph);
  } else if (picture) {
    const ar = picture.width / picture.height;
    ph = Math.min(pic.h, Math.round(pic.w / ar)); py = pic.y + Math.round((pic.h - ph) / 2);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(picture, pic.x, py, pic.w, ph);
  }
  // scan cursor on the row being received
  if (s.phase === 'image' && s.lines) {
    const rows = s.lines * (s.rowsPerLine || 1), y = py + Math.min(ph - 1, ((s.row ?? -1) + 1) / rows * ph);
    ctx.fillStyle = 'rgba(190,255,230,0.55)'; ctx.fillRect(pic.x, y, pic.w, 1);
    ctx.fillStyle = 'rgba(190,255,230,0.12)'; ctx.fillRect(pic.x, y + 1, pic.w, 3);
  }
  // corner marks and centre mark
  ctx.strokeStyle = 'rgba(207,230,224,0.6)'; ctx.lineWidth = 1;
  const c = 12, x0 = pic.x + 4.5, y0 = py + 4.5, x1 = pic.x + pic.w - 4.5, y1 = py + ph - 4.5;
  ctx.beginPath();
  ctx.moveTo(x0, y0 + c); ctx.lineTo(x0, y0); ctx.lineTo(x0 + c, y0);
  ctx.moveTo(x1 - c, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + c);
  ctx.moveTo(x0, y1 - c); ctx.lineTo(x0, y1); ctx.lineTo(x0 + c, y1);
  ctx.moveTo(x1 - c, y1); ctx.lineTo(x1, y1); ctx.lineTo(x1, y1 - c);
  const mx = pic.x + pic.w / 2, my = py + ph / 2;
  ctx.moveTo(mx - 8, my); ctx.lineTo(mx - 3, my); ctx.moveTo(mx + 3, my); ctx.lineTo(mx + 8, my);
  ctx.moveTo(mx, my - 8); ctx.lineTo(mx, my - 3); ctx.moveTo(mx, my + 3); ctx.lineTo(mx, my + 8);
  ctx.stroke();
  // the creature in view (a label over the bottom of the picture)
  if (F.tag) {
    ctx.font = '600 10px ui-monospace, Menlo, Consolas, monospace';
    let t = F.tag; while (t.length > 8 && ctx.measureText(t).width > pic.w - 20) t = t.slice(0, -2);
    if (t !== F.tag) t += '…';
    const tw = ctx.measureText(t).width;
    ctx.fillStyle = 'rgba(5,9,11,0.72)'; ctx.fillRect(pic.x + 6, py + ph - 22, tw + 10, 15);
    ctx.fillStyle = amber; ctx.textAlign = 'left'; ctx.fillText(t, pic.x + 11, py + ph - 14);
    ctx.font = '600 11px ui-monospace, Menlo, Consolas, monospace';
  }
  // bottom bar
  const yb = bar + 12, yb2 = bar + 28;
  ctx.textAlign = 'left'; ctx.fillStyle = ink;
  ctx.fillText(F.depth, 12, yb); ctx.fillText(F.heading, 130, yb);
  ctx.textAlign = 'right'; ctx.fillText(F.time, W - 12, yb);
  ctx.textAlign = 'left'; ctx.fillStyle = dim; ctx.fillText(F.line, 12, yb2);
  // signal meter: 12 bars
  const n = 12, bx = 130, bw = 6, gap = 2, lv = Math.round((F.level || 0) * n);
  for (let i = 0; i < n; i++) {
    const h = 4 + i * 0.6;
    ctx.fillStyle = i < lv ? (i < 3 ? red : i < 7 ? amber : '#6fe0a0') : 'rgba(207,230,224,0.12)';
    ctx.fillRect(bx + i * (bw + gap), yb2 + 5 - h, bw, h);
  }
  ctx.textAlign = 'right'; ctx.fillStyle = dim; ctx.fillText(F.signal, W - 12, yb2);
  ctx.restore();
  return F;
}

// The small card: the picture box of the full panel (so the live picture
// and its hole have the same place), text at 20 px of the 352 px panel.
function compact(ctx, F, s, info, o, col, ink, dim, red, picture) {
  const { W, pic, bar } = HUD;
  ctx.font = '700 20px ui-monospace, Menlo, Consolas, monospace';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left'; ctx.fillStyle = col; ctx.fillText(F.id, 12, 15);
  const rec = s.phase === 'image' || s.live, blink = Math.floor((info.t || 0) * 1.6) % 2 === 0;
  if (blink || !rec) { ctx.fillStyle = rec ? red : dim; ctx.beginPath(); ctx.arc(108, 15, 5, 0, Math.PI * 2); ctx.fill(); }
  ctx.textAlign = 'right'; ctx.fillStyle = s.phase === 'novis' ? red : ink;
  ctx.font = '600 18px ui-monospace, Menlo, Consolas, monospace';
  ctx.fillText(s.live ? F.mode : F.mode.replace('ROBOT ', 'R').replace('MARTIN ', ''), W - 12, 15);
  ctx.fillStyle = '#000'; ctx.fillRect(pic.x, pic.y, pic.w, pic.h);
  if (o.hole) {
    const ph = Math.min(pic.h, Math.round(pic.w / (o.aspect || 4 / 3))), py = pic.y + Math.round((pic.h - ph) / 2);
    ctx.clearRect(pic.x, py, pic.w, ph);
  } else if (picture) {
    const p = picture, ar = p.width / p.height, ph = Math.min(pic.h, Math.round(pic.w / ar)), py = pic.y + Math.round((pic.h - ph) / 2);
    ctx.drawImage(p, pic.x, py, pic.w, ph);
  }
  if (F.tag) {
    // the common name only: the small card has no room for the rest
    ctx.font = '700 15px ui-monospace, Menlo, Consolas, monospace';
    let t = F.tag.split(' \u00b7 ')[0];
    while (t.length > 8 && ctx.measureText(t).width > pic.w - 20) t = t.slice(0, -2);
    ctx.fillStyle = 'rgba(5,9,11,0.72)'; ctx.fillRect(pic.x + 6, pic.y + pic.h - 30, ctx.measureText(t).width + 12, 22);
    ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.fillText(t, pic.x + 12, pic.y + pic.h - 19);
    ctx.font = '600 18px ui-monospace, Menlo, Consolas, monospace';
  }
  const yb = bar + 19;
  ctx.textAlign = 'left'; ctx.fillStyle = ink;
  ctx.fillText(F.depth.replace('DEPTH ', ''), 12, yb);
  ctx.fillText(F.heading.replace('HDG ', ''), 132, yb);
  const n = 8, bx = 236, bw = 10, gap = 3, lv = Math.round((F.level || 0) * n);
  for (let i = 0; i < n; i++) {
    const h = 8 + i * 2;
    ctx.fillStyle = i < lv ? (i < 2 ? red : i < 5 ? '#f2b705' : '#6fe0a0') : 'rgba(207,230,224,0.14)';
    ctx.fillRect(bx + i * (bw + gap), yb + 12 - h, bw, h);
  }
}
