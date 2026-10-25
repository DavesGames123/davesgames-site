// ============================================================================
//  STRANDS · paint.js — threads, pegs, beads and tags on a 2D context
// ----------------------------------------------------------------------------
//  DOM-free: every function takes a CanvasRenderingContext2D (the page,
//  the saver, and @napi-rs/canvas or a recording stub in node). The look
//  follows pages/thread-art (hairline threads that add light on a dark
//  board, 'lighter' composite) and pages/string-lab (a string that a pluck
//  sets into a decaying standing wave).
//
//  A link is a rope of threads. Thread i leaves direction dot i at one end,
//  joins the other threads in a slow helix along the middle of the link,
//  and lands on direction dot i at the far end. The helix is decoration:
//  the threads are the d terms of |ω_d⟩ and carry no order in space.
//
//  EXPORTS   (jump with grep -n "<anchor>" paint.js)
//    THEMES ........ "export const THEMES"      dark and light inks
//    dirColor ...... "export function dirColor"  colour of direction i
//    alpha ......... "export function alpha"     '#rrggbb' + a -> rgba()
//    lerp/ease ..... "export function lerp"  "export function ease"
//    linkFrame ..... "export function linkFrame" centre, normal, length
//    canonN ........ "export function canonN"    end normal that points down
//    dotPos ........ "export function dotPos"    direction dot i of an end
//    strandPoints .. "export function strandPoints"
//    strokeStrand .. "export function strokeStrand"  glow passes
//    pointAt ....... "export function pointAt"   point at fraction s of a path
//    drawBoard ..... "export function drawBoard" background
//    drawEnd ....... "export function drawEnd"   one qudit (or copy) with dots
//    bead / ring ... "export function bead"  "export function ring"
//    text / tag .... "export function text"  "export function tag"
//    phasor ........ "export function phasor"   amplitude as a clock hand
// ============================================================================

// Page colour classes (lib/sci.css, NOTES.md): m1 qubit, m2 qutrit, m3
// records and weights, m6 readout. The ends take m1 / m2 on their rims, the
// amplitude tags take m3, the read marks m6. Thread directions use their
// own four hues, outside the six math colours, so a thread colour never
// reads as a symbol colour.
export const THEMES = {
  dark: {
    bg0: '#05070d', bg1: '#0e1424', ink: '#ece8dc', dim: '#a3a9b6', faint: '#2b3346',
    disc: '#121a2b', discEdge: '#3a4660', read: '#a8a4ff', accent: '#86dc7c', zero: '#ff6b6b',
    qubit: '#62c4ff', qutrit: '#ff9a62',
    dirs: ['#4fd6c2', '#ff7f9e', '#e6d3a0', '#d6d0ff'], glow: 'lighter',
  },
  light: {
    bg0: '#fbfaf6', bg1: '#eef1f6', ink: '#1d2230', dim: '#5d6573', faint: '#cdd2db',
    disc: '#ffffff', discEdge: '#9aa4b6', read: '#5a52d6', accent: '#2f8a2d', zero: '#c0392b',
    qubit: '#1f7fc4', qutrit: '#d2642a',
    dirs: ['#14907f', '#c8385e', '#9a7a1c', '#6a5acd'], glow: 'source-over',
  },
};

export const SANS = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
export const SERIF = "'STIX Two Text', 'Times New Roman', Georgia, serif";

export function dirColor(th, i) { return th.dirs[((i % th.dirs.length) + th.dirs.length) % th.dirs.length]; }

export function alpha(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

export function lerp(a, b, t) { return a + (b - a) * t; }
export function lerpP(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
export function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
/** Smooth 0..1 ease (cubic in-out). */
export function ease(t) { t = clamp01(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
/** Ramp of t from a to b, eased. */
export function ramp(t, a, b) { return ease((t - a) / (b - a)); }

/** Unit tangent and normal of the segment A -> B (normal turns the tangent +90°). */
export function linkFrame(A, B) {
  const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1;
  return { tx: dx / L, ty: dy / L, nx: -dy / L, ny: dx / L, L };
}

/** Direction dot i of an end at c, laid out along the unit normal n, spacing sp. */
export function dotPos(c, n, i, d, sp) {
  const o = (i - (d - 1) / 2) * sp;
  return { x: c.x + n.nx * o, y: c.y + n.ny * o, o };
}

/** The normal of a frame, turned so that it points down (or right when level). */
export function canonN(f) {
  const flip = f.ny < -1e-6 || (Math.abs(f.ny) <= 1e-6 && f.nx < 0);
  return flip ? { nx: -f.nx, ny: -f.ny } : { nx: f.nx, ny: f.ny };
}

/**
 * Points of one thread from end centre A to end centre B.
 * opt: { a, b: the thread's two dot positions (default: A and B shifted by
 *        oA, oB along the link normal), oA, oB, R: helix radius in the
 *        middle, theta: phase of this thread, twist: turns along the link,
 *        phase: time phase, gather: 0..1 how much the middle gathers into
 *        the rope, bow: sag of the centre line along the normal, pluck:
 *        displacement of a standing wave at the middle, n: points }
 * The thread starts exactly at a and ends exactly at b.
 * Returns { pts: [{x, y, z}], frame } with z in -1..1 the helix depth.
 */
export function strandPoints(A, B, opt = {}) {
  const f = linkFrame(A, B);
  const n = opt.n || 40, R = opt.R ?? 6, th = opt.theta || 0, tw = opt.twist ?? 1.2;
  const ph = opt.phase || 0, gat = opt.gather ?? 1, bow = opt.bow || 0, pl = opt.pluck || 0;
  const a = opt.a || { x: A.x + f.nx * (opt.oA || 0), y: A.y + f.ny * (opt.oA || 0) };
  const b = opt.b || { x: B.x + f.nx * (opt.oB || 0), y: B.y + f.ny * (opt.oB || 0) };
  const pts = new Array(n + 1);
  for (let k = 0; k <= n; k++) {
    const s = k / n;
    // gathering profile: 0 at the dots, 1 over the middle of the link
    const g = gat * Math.pow(Math.sin(Math.PI * s), 0.55);
    const ang = th + 2 * Math.PI * tw * s + ph;
    const off = g * R * Math.sin(ang) + bow * 4 * s * (1 - s) + pl * Math.sin(Math.PI * s);
    const fx = a.x + (b.x - a.x) * s, fy = a.y + (b.y - a.y) * s;           // fan line
    const cx = A.x + (B.x - A.x) * s, cy = A.y + (B.y - A.y) * s;           // centre line
    pts[k] = {
      x: fx + (cx - fx) * g + f.nx * off,
      y: fy + (cy - fy) * g + f.ny * off,
      z: g * Math.cos(ang),
    };
  }
  return { pts, frame: f };
}

/** Point at fraction s (0..1) of a polyline, by index (paths are evenly sampled). */
export function pointAt(pts, s) {
  const u = clamp01(s) * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(u)), t = u - i;
  const a = pts[i], b = pts[i + 1];
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: (a.z || 0) + ((b.z || 0) - (a.z || 0)) * t };
}

/**
 * Stroke a thread with three passes: wide faint glow, mid glow, bright core.
 * Segments behind the rope (z < 0) are dimmer. opt: { width, a (0..1),
 * dash: [on, off], from, to (fractions of the path to draw) }.
 */
export function strokeStrand(g, th, pts, color, opt = {}) {
  const w = opt.width || 1.6, a = opt.a ?? 1;
  if (a <= 0.003) return;
  const from = opt.from ?? 0, to = opt.to ?? 1;
  const i0 = Math.floor(from * (pts.length - 1)), i1 = Math.ceil(to * (pts.length - 1));
  if (i1 <= i0) return;
  g.save();
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.globalCompositeOperation = th.glow;
  if (opt.dash) g.setLineDash(opt.dash);
  const CH = 5;
  const passes = th.glow === 'lighter' ? [[w * 5.5, 0.05], [w * 2.4, 0.16], [w, 0.85]] : [[w * 3, 0.10], [w, 0.95]];
  for (const [pw, pa] of passes) {
    g.lineWidth = pw;
    for (let s = i0; s < i1; s += CH) {
      const e = Math.min(i1, s + CH);
      let z = 0;
      for (let k = s; k <= e; k++) z += pts[k].z || 0;
      z /= (e - s + 1);
      g.strokeStyle = alpha(color, pa * a * (0.62 + 0.38 * (z + 1) / 2));
      g.beginPath();
      g.moveTo(pts[s].x, pts[s].y);
      for (let k = s + 1; k <= e; k++) g.lineTo(pts[k].x, pts[k].y);
      g.stroke();
    }
  }
  g.restore();
}

export function drawBoard(g, th, r) {
  g.save();
  g.globalCompositeOperation = 'source-over';
  const cx = r.x + r.w / 2, cy = r.y + r.h * 0.45;
  const gr = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(r.w, r.h) * 0.75);
  gr.addColorStop(0, th.bg1); gr.addColorStop(1, th.bg0);
  g.fillStyle = gr;
  g.fillRect(r.x, r.y, r.w, r.h);
  g.restore();
}

/**
 * One end: a capsule along the normal that holds d direction dots.
 * opt: { d, sp, n (frame), label, sub, hollowFrom (first index with no
 * thread), a, scale, labelSide (+1 below / -1 above), read (ring colour) }.
 * Returns the dot positions.
 */
export function drawEnd(g, th, c, opt) {
  const d = opt.d, sp = opt.sp, n = opt.n || { nx: 0, ny: 1 }, a = opt.a ?? 1, sc = opt.scale ?? 1;
  const dots = [];
  for (let i = 0; i < d; i++) dots.push(dotPos(c, n, i, d, sp));
  if (a <= 0.003) return dots;
  g.save();
  g.globalAlpha = a;
  const half = ((d - 1) / 2) * sp + sp * 0.55 * sc;
  const rad = sp * 0.5 * sc;
  // capsule along n
  const ax = c.x - n.nx * half, ay = c.y - n.ny * half, bx = c.x + n.nx * half, by = c.y + n.ny * half;
  g.lineCap = 'round';
  const rim = d === 2 ? th.qubit : d === 3 ? th.qutrit : th.discEdge;
  g.strokeStyle = alpha(rim, 0.75); g.lineWidth = rad * 2 + 2.5;
  g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
  g.strokeStyle = th.disc; g.lineWidth = rad * 2;
  g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
  if (opt.read) {
    g.strokeStyle = alpha(opt.read, 0.9); g.lineWidth = 2;
    g.setLineDash([4, 3]);
    g.lineWidth = 1.6;
    g.beginPath();
    roundedCapsule(g, ax, ay, bx, by, rad + 6);
    g.stroke();
    g.setLineDash([]);
  }
  const hollowFrom = opt.hollowFrom ?? d;
  for (let i = 0; i < d; i++) {
    const p = dots[i], col = dirColor(th, i), r = Math.max(2.5, sp * 0.17 * sc);
    if (i >= hollowFrom) {
      g.strokeStyle = alpha(col, 0.75); g.lineWidth = 1.5;
      g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.stroke();
    } else {
      g.fillStyle = col;
      g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill();
    }
  }
  if (opt.label) {
    const side = opt.labelSide ?? 1;
    const ext = (Math.abs(n.ny) > 0.7 ? half : rad) + (opt.read ? 7 : 0);
    const ly = c.y + side * (ext + 14);
    text(g, th, opt.label, c.x, ly, { size: opt.labelSize || 13, color: th.ink, align: 'center', base: side > 0 ? 'top' : 'bottom', serif: true, italic: opt.italic !== false });
    if (opt.sub) text(g, th, opt.sub, c.x, ly + side * 16, { size: 11, color: th.dim, align: 'center', base: side > 0 ? 'top' : 'bottom' });
  }
  g.restore();
  return dots;
}

function roundedCapsule(g, ax, ay, bx, by, r) {
  const ang = Math.atan2(by - ay, bx - ax);
  g.arc(bx, by, r, ang - Math.PI / 2, ang + Math.PI / 2);
  g.arc(ax, ay, r, ang + Math.PI / 2, ang + Math.PI * 1.5);
  g.closePath();
}

export function bead(g, th, p, r, color, a = 1) {
  if (a <= 0.003) return;
  g.save();
  g.globalCompositeOperation = th.glow;
  const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3.2);
  gr.addColorStop(0, alpha(color, 0.95 * a));
  gr.addColorStop(0.3, alpha(color, 0.45 * a));
  gr.addColorStop(1, alpha(color, 0));
  g.fillStyle = gr;
  g.beginPath(); g.arc(p.x, p.y, r * 3.2, 0, Math.PI * 2); g.fill();
  g.fillStyle = alpha('#ffffff', 0.85 * a);
  g.beginPath(); g.arc(p.x, p.y, r * 0.55, 0, Math.PI * 2); g.fill();
  g.restore();
}

/** A ring (partial when prog < 1), used for a distillation closing on two ends. */
export function ring(g, th, c, rx, ry, color, prog = 1, opt = {}) {
  if (prog <= 0.003) return;
  g.save();
  g.strokeStyle = alpha(color, opt.a ?? 0.9);
  g.lineWidth = opt.width || 2;
  if (opt.dash) g.setLineDash(opt.dash);
  g.beginPath();
  const a0 = -Math.PI / 2;
  g.ellipse(c.x, c.y, rx, ry, 0, a0, a0 + 2 * Math.PI * clamp01(prog));
  g.stroke();
  g.restore();
}

/** Text. opt: { size, color, align, base, serif, italic, weight, a } */
export function text(g, th, s, x, y, opt = {}) {
  g.save();
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha *= opt.a ?? 1;
  const fam = opt.serif ? SERIF : SANS;
  // never under 11 px (NOTES.md: text >= 11 px)
  g.font = `${opt.italic ? 'italic ' : ''}${opt.weight || 400} ${Math.max(11, opt.size || 12)}px ${fam}`;
  g.fillStyle = opt.color || th.ink;
  g.textAlign = opt.align || 'left';
  g.textBaseline = opt.base || 'alphabetic';
  if (opt.box) {
    // keep the text inside opt.box (a rect) by shifting it sideways
    const w = g.measureText(s).width, al = g.textAlign;
    let x0 = al === 'center' ? x - w / 2 : al === 'right' ? x - w : x;
    const lo = opt.box.x + 4, hi = opt.box.x + opt.box.w - 4 - w;
    const nx0 = Math.max(lo, Math.min(hi, x0));
    x += nx0 - x0;
  }
  g.fillText(s, x, y);
  g.restore();
}

export function measure(g, s, size, serif) {
  g.save();
  g.font = `400 ${Math.max(11, size)}px ${serif ? SERIF : SANS}`;
  const w = g.measureText(s).width;
  g.restore();
  return w;
}

/** A small rounded tag with text, centred at x, y. */
export function tag(g, th, s, x, y, opt = {}) {
  const size = Math.max(11, opt.size || 12), a = opt.a ?? 1;
  if (a <= 0.003) return;
  const w = measure(g, s, size, opt.serif) + 14, h = size + 10;
  g.save();
  g.globalAlpha *= a;
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = alpha(th.bg0, 0.82);
  g.strokeStyle = alpha(opt.color || th.dim, 0.7);
  g.lineWidth = 1;
  const x0 = x - w / 2, y0 = y - h / 2, r = h / 2;
  g.beginPath();
  g.moveTo(x0 + r, y0); g.lineTo(x0 + w - r, y0);
  g.arc(x0 + w - r, y0 + r, r, -Math.PI / 2, Math.PI / 2);
  g.lineTo(x0 + r, y0 + h);
  g.arc(x0 + r, y0 + r, r, Math.PI / 2, Math.PI * 1.5);
  g.closePath();
  g.fill(); g.stroke();
  g.restore();
  text(g, th, s, x, y + 0.5, { size, color: opt.color || th.ink, align: 'center', base: 'middle', serif: opt.serif, italic: opt.italic, a });
  return { w, h };
}

/**
 * An amplitude as a clock hand: a circle of radius rr (modulus 1), a hand
 * of length |z|·rr at angle arg z (counter-clockwise from +x).
 */
export function phasor(g, th, p, rr, re, im, color, a = 1) {
  g.save();
  g.globalAlpha *= a;
  g.strokeStyle = alpha(th.dim, 0.45); g.lineWidth = 1;
  g.beginPath(); g.arc(p.x, p.y, rr, 0, Math.PI * 2); g.stroke();
  const m = Math.hypot(re, im);
  if (m < 1e-9) {
    g.fillStyle = alpha(th.dim, 0.7);
    g.beginPath(); g.arc(p.x, p.y, 1.6, 0, Math.PI * 2); g.fill();
  } else {
    const x = p.x + re * rr, y = p.y - im * rr;
    g.strokeStyle = color; g.lineWidth = 2.2; g.lineCap = 'round';
    g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(x, y); g.stroke();
    g.fillStyle = color;
    g.beginPath(); g.arc(x, y, 2.4, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}
