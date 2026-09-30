// icons.js — one station glyph per node, as SVG fragment strings. No DOM.
//
// Each glyph is a '<g>…</g>' centred on (0,0) that fits inside a circle of
// radius ICON_VIEW_R. Glyphs use fill or stroke "currentColor" only, so the
// overlay sets the color (dark ink on a white disc). Keep the marks bold and
// simple: they must read at about 14 css px.
//
// grep: ICONS  ICON_VIEW_R  previewSheet  hexCluster  leaf

export const ICON_VIEW_R = 9;

const F = 'fill="currentColor"';
const S = 'fill="none" stroke="currentColor"';

// A pointy-top hexagon path of radius r at (cx, cy).
function hexPath(cx, cy, r) {
  let d = '';
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    const x = (cx + r * Math.cos(a)).toFixed(2);
    const y = (cy + r * Math.sin(a)).toFixed(2);
    d += (i ? 'L' : 'M') + x + ',' + y;
  }
  return d + 'Z';
}

// Seven hexagons: one centre, six around. Darkside's core.
function hexCluster() {
  const r = 2.75;
  const d = Math.sqrt(3) * r + 0.85;
  let p = hexPath(0, 0, r);
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    p += hexPath(d * Math.cos(a), d * Math.sin(a), r);
  }
  return `<g><path ${F} d="${p}"/></g>`;
}

// An almond leaf of length len along +x from the origin, turned by deg.
function leaf(x, y, len, wid, deg) {
  const h = len / 2;
  return `<path ${F} transform="translate(${x} ${y}) rotate(${deg})" ` +
    `d="M0,0 Q${h},${-wid} ${len},0 Q${h},${wid} 0,0Z"/>`;
}

export const ICONS = {
  // A lens: a solid oval with a thin crescent that wraps its right side.
  wellspring: `<g>
    <ellipse ${F} cx="-2" cy="0" rx="4" ry="7.2"/>
    <path ${S} stroke-width="1.6" stroke-linecap="round" d="M-0.6,-8 C8.2,-7.6 8.2,7.6 -0.6,8"/>
  </g>`,

  // Two rocks that touch: a large round body and a smaller one to the lower right.
  'holms-rock': `<g>
    <circle ${F} cx="-2.8" cy="-1.4" r="5"/>
    <circle ${F} cx="4.6" cy="2.6" r="3.4"/>
    <path ${S} stroke-width="3.4" d="M-2.8,-1.4 L4.6,2.6"/>
  </g>`,

  // A scaffold: a top beam, two posts, a cross brace and a hung block.
  flotsam: `<g ${F} transform="translate(0 0.5) scale(0.9)">
    <rect x="-7" y="-6.4" width="14" height="2.4"/>
    <rect x="-5.2" y="-8" width="2.4" height="15"/>
    <rect x="2.8" y="-8" width="2.4" height="15"/>
    <rect x="-7" y="0.6" width="14" height="2.2"/>
    <rect x="-1.4" y="-4" width="2.8" height="3.2"/>
    <rect x="-1.9" y="3.6" width="3.8" height="3.2"/>
  </g>`,

  // A spindle: a tilted mast with crossbars, a thick hub and a thin tip.
  'far-spindle': `<g ${F} transform="rotate(28)">
    <rect x="-1.1" y="-8.4" width="2.2" height="16.8"/>
    <rect x="-3.8" y="-6.8" width="7.6" height="2.2"/>
    <rect x="-3" y="-2.8" width="6" height="6.8" rx="0.6"/>
    <rect x="-3.8" y="4.8" width="7.6" height="2.2"/>
  </g>`,

  // A gate spiral: a stroke that curls inward, with an arrowhead at the mouth.
  'helion-gate': `<g>
    <path ${S} stroke-width="2.2" stroke-linecap="round"
      d="M-3.2,4.6 A5.6,5.6 0 1 1 5.4,1.6 A3.4,3.4 0 0 1 -0.6,2.6 A1.6,1.6 0 0 1 0.6,-0.9"/>
    <path ${F} d="M-6,6 L-5.3,2 L-1.7,5.3Z"/>
  </g>`,

  // A scrap hook: a squared C-bracket with a foot block and a top tab.
  scatteryards: `<g transform="translate(0.5 -0.5)">
    <path ${S} stroke-width="2.4" stroke-linejoin="round"
      d="M3.6,-6.2 H-1.6 Q-4,-6.2 -4,-3.8 V3 Q-4,5.2 -1.8,5.2 H4"/>
    <rect ${F} x="1.9" y="-7.2" width="2.4" height="3.4"/>
    <rect ${F} x="3" y="2.4" width="2.4" height="4.2"/>
    <rect ${F} x="-3" y="5.2" width="5.4" height="3" />
  </g>`,

  // The Darkside core: a cluster of seven hexagons.
  darkside: hexCluster(),

  // A sheaf: three pairs of leaves stacked on a short stem.
  greenbelt: `<g transform="translate(0 0.8)">
    <path ${S} stroke-width="1.4" stroke-linecap="round" d="M0,6.8 V-7.4"/>
    ${leaf(0, -4.4, 5.4, 2.4, -55)}
    ${leaf(0, -4.4, 5.4, 2.4, -125)}
    ${leaf(0, 0.2, 6.6, 2.7, -30)}
    ${leaf(0, 0.2, 6.6, 2.7, -150)}
    ${leaf(0, 4.6, 6.2, 2.6, -20)}
    ${leaf(0, 4.6, 6.2, 2.6, -160)}
  </g>`,

  // A cave mouth: a thick ring with a dot that sits off centre inside it.
  'the-hollow': `<g>
    <circle ${S} stroke-width="2.4" cx="0" cy="0" r="6.8"/>
    <circle ${F} cx="-1.6" cy="-1.6" r="2.6"/>
  </g>`,

  // A curled leaf: a stem that coils at the top, with leaves on its outer side.
  olivera: `<g transform="translate(0.9 0.8)">
    <path ${S} stroke-width="1.9" stroke-linecap="round"
      d="M1.4,6.8 C-4.6,5.4 -5.6,-3.6 -0.8,-6.4 C3,-8.4 6.2,-4.2 3.2,-2.2 C1.4,-1 -0.4,-2.8 0.8,-4"/>
    ${leaf(-0.8, 5.6, 5.4, 2.3, -168)}
    ${leaf(-3.4, 1.4, 5, 2.2, -150)}
    ${leaf(-3.2, -3.4, 4.6, 2.1, -118)}
  </g>`,
};

// A standalone SVG sheet of every glyph on its white disc, for visual checks.
export function previewSheet() {
  const ids = Object.keys(ICONS);
  const cols = 5, cw = 64, ch = 64;
  const w = cols * cw, h = Math.ceil(ids.length / cols) * ch;
  let body = '';
  ids.forEach((id, i) => {
    const x = (i % cols) * cw + cw / 2;
    const y = Math.floor(i / cols) * ch + 26;
    body += `<g transform="translate(${x} ${y})" style="color:#0b0b0b">` +
      `<circle r="12" fill="#ffffff"/>${ICONS[id]}</g>` +
      `<text x="${x}" y="${y + 26}" fill="#cfcfcf" font-family="Chakra Petch, sans-serif" ` +
      `font-size="5.2" letter-spacing="1.2" text-anchor="middle">${id.toUpperCase()}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" ` +
    `viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#0b0b0b"/>${body}</svg>`;
}
