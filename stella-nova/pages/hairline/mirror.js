// ============================================================================
//  HAIRLINE  ·  mirror.js — a live figure painted onto a canvas
// ----------------------------------------------------------------------------
//  The shell screensaver records a canvas, and a hairline figure is an SVG.
//  mirror(host, canvas) copies the figure SVG of host into the canvas on
//  each frame: it serialises the SVG, adds a <style> with the colours as
//  plain values (an SVG image does not see the custom properties of the
//  page), and draws it as an image. One decode at a time, so a slow decode
//  drops frames and never queues them.
//
//  styleText(vars, sw) is pure (node test). Its rules follow the drawing
//  rules of core/styles.ts in the vendored bundle: plates filled with the
//  plate colour, strokes by class, dots by fill.
//
//  GREP MAP
//    grep -n 'export function styleText'  the colour rules for the image
//    grep -n 'export function svgImage'   one SVG as a data URL at a size
//    grep -n 'export function mirror'     the frame loop, stop()
// ============================================================================

export function styleText(v, sw) {
  return [
    `path,polygon,ellipse,line{fill:${v.plate};stroke:${v.mid};stroke-width:${sw};vector-effect:non-scaling-stroke;stroke-linejoin:round;stroke-linecap:round}`,
    '.nf{fill:none}', '.fo{stroke:none}',
    `.sil{stroke:${v.edge}}`, `.hi{stroke:${v.hi}}`, `.lo{stroke:${v.lo}}`,
    '.dash{stroke-dasharray:1 3}',
    `.dot{stroke:none;fill:${v.hi}}`, `.dot.m{fill:${v.edge}}`, `.dot.off{fill:${v.lo}}`,
    `.ghost path{fill:none;stroke:${v.mid}}`,
    // color-mix() strokes in inline styles name the page variables
    `svg{--hl-hi:${v.hi};--hl-edge:${v.edge};--hl-mid:${v.mid};--hl-lo:${v.lo};--hl-plate:${v.plate}}`,
  ].join('');
}

export function svgImage(svg, w, h, v, sw) {
  const c = svg.cloneNode(true);
  c.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  c.setAttribute('width', String(Math.round(w)));
  c.setAttribute('height', String(Math.round(h)));
  c.removeAttribute('style');
  const st = svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'style');
  st.textContent = styleText(v, sw);
  c.insertBefore(st, c.firstChild);
  const text = new XMLSerializer().serializeToString(c);
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text);
}

// vars(): the current palette values. box(): {x, y, w, h} in CSS px.
// The canvas is filled with the plate colour, then the figure at box.
export function mirror(host, canvas, { vars, box, stroke = () => 0.9 }) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return { stop() {} };
  let busy = false, raf = 0, live = true;
  const frame = () => {
    if (!live) return;
    raf = requestAnimationFrame(frame);
    const svg = host.querySelector('svg');
    if (busy || !svg) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(innerWidth * dpr), H = Math.round(innerHeight * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const v = vars(), b = box();
    busy = true;
    const img = new Image();
    img.onload = () => {
      busy = false;
      if (!live) return;
      ctx.fillStyle = v.plate; ctx.fillRect(0, 0, W, H);
      ctx.drawImage(img, b.x * dpr, b.y * dpr, b.w * dpr, b.h * dpr);
    };
    img.onerror = () => { busy = false; };
    img.src = svgImage(svg, b.w * dpr, b.h * dpr, v, stroke() * dpr);
  };
  raf = requestAnimationFrame(frame);
  return { stop() { live = false; cancelAnimationFrame(raf); } };
}
