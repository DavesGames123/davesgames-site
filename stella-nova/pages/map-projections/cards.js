// ============================================================================
//  MAP PROJECTIONS  ·  cards.js — one plain-language card per projection
// ----------------------------------------------------------------------------
//  Fields: who (maker, year), keeps (what it preserves), bends (what it
//  distorts), use (where it is used), tex (the forward formula, TeX for
//  MathJax), scale (TeX: the scale factors h along the meridian and k along
//  the parallel, the area scale s, the angle error omega, or the missing
//  part of the forward formula). The card and the saver plate typeset both;
//  no projection is shown as code. tests.mjs checks every h, k and s here
//  against the numerical Jacobian (proj.js distortion). Dates and names follow
//  Snyder, "Map Projections: A Working Manual" (USGS PP 1395, 1987) and
//  Snyder, "Flattening the Earth" (1993), and the original papers for the
//  recent maps (Savric et al. 2011, 2018).
//
//  GREP MAP
//    grep -n 'export const CARDS'     the cards, keyed like proj.js PROJ
//    grep -n 'export const FAMILY'    family names and one-line notes
//    grep -n 'export const PROPS'     property names and colours
//    grep -n 'export const LEFT_OUT'  the projections this page leaves out
// ============================================================================
export const FAMILY = {
  cylindrical: { name: 'Cylindrical', note: 'A cylinder round the globe: meridians straight and evenly spaced, parallels straight.' },
  pseudocylindrical: { name: 'Pseudocylindrical', note: 'Straight parallels, curved meridians: the world as an oval or a rounded box.' },
  conic: { name: 'Conic', note: 'A cone on the globe: parallels are arcs, meridians are spokes. Best for mid-latitude bands.' },
  azimuthal: { name: 'Azimuthal', note: 'A plane that touches the globe at one point: every direction from that point is true.' },
  interrupted: { name: 'Interrupted', note: 'The globe is cut into lobes, so each lobe has little distortion.' },
};
export const PROPS = {
  conformal: { name: 'Conformal', cls: 'm1', note: 'keeps angles and small shapes' },
  'equal-area': { name: 'Equal-area', cls: 'm3', note: 'keeps areas' },
  equidistant: { name: 'Equidistant', cls: 'm5', note: 'keeps distances along some lines' },
  compromise: { name: 'Compromise', cls: 'm6', note: 'keeps nothing exactly, spreads the error' },
  perspective: { name: 'Perspective', cls: 'm4', note: 'a view of the globe from a point' },
};
export const LEFT_OUT = 'Dymaxion (Buckminster Fuller, 1943 and 1954) and AuthaGraph (Hajime Narukawa, 1999) are not here. Fuller used his own transform on each face of an icosahedron, and the full AuthaGraph method is not published. A version made here would only look like them, so this guide leaves them out.';

export const CARDS = {
  mercator: {
    who: 'Gerardus Mercator, 1569',
    keeps: 'Angles and the shape of small areas. A line of constant compass bearing (a rhumb line) is a straight line.',
    bends: 'Area. The scale grows as 1/cos(latitude), so areas grow as its square: at 60° by 4, at 72° (Greenland) by about 10. The poles are infinitely far away, so the map stops near 85°.',
    use: 'Nautical charts since the 1600s, because a navigator can draw a course with a ruler and read the bearing.',
    tex: 'y = \\ln\\tan\\!\\left(\\frac{\\pi}{4}+\\frac{\\varphi}{2}\\right),\\quad x = \\lambda',
    scale: 'h = k = \\sec\\varphi,\\quad s = hk = \\sec^2\\varphi,\\quad \\omega = 0',
  },
  'web-mercator': {
    who: 'Google Maps, 2005; registered as EPSG:3857',
    keeps: 'Angles on a sphere, and a square world at zoom 0, so the world splits into square tiles at every zoom.',
    bends: 'Area, as Mercator. It also puts ellipsoidal (GPS) latitudes into the sphere formula, so on the real Earth it is not quite conformal: at the equator north-south and east-west scales differ by 0.67%.',
    use: 'Almost every web map: Google Maps, OpenStreetMap, Bing Maps and most tile servers.',
    tex: 'x = R\\lambda,\\quad y = R\\ln\\tan\\!\\left(\\frac{\\pi}{4}+\\frac{\\varphi}{2}\\right),\\quad R = 6\\,378\\,137\\ \\text{m}',
    scale: 'h = k = \\sec\\varphi \\ (\\text{sphere}),\\quad s = \\sec^2\\varphi,\\quad \\varphi_{\\max} = 2\\arctan e^{\\pi} - \\tfrac{\\pi}{2} \\approx 85.05^\\circ',
  },
  'transverse-mercator': {
    who: 'Johann Heinrich Lambert, 1772; Gauss and Krüger for the ellipsoid',
    keeps: 'Angles. The scale is true along the central meridian, so a narrow north-south zone is almost free of distortion.',
    bends: 'Scale grows quickly away from the central meridian. Whole-world views like this one show why it is used only in narrow zones.',
    use: 'UTM (60 zones, each 6° wide), most national grids such as the British National Grid and Gauss–Krüger. The readout under the pointer gives the UTM position from the ellipsoidal series.',
    tex: 'x = \\operatorname{artanh}(\\cos\\varphi\\,\\sin\\lambda),\\quad y = \\operatorname{atan2}(\\tan\\varphi,\\ \\cos\\lambda)',
    scale: 'B = \\cos\\varphi\\sin\\lambda,\\quad h = k = \\frac{1}{\\sqrt{1-B^2}},\\quad \\omega = 0',
  },
  equirectangular: {
    who: 'Marinus of Tyre, about AD 100 (as Ptolemy reports)',
    keeps: 'Distances along every meridian and along the equator. Latitude and longitude are simply x and y.',
    bends: 'East-west lengths grow as 1/cos(latitude); at the poles a point becomes the whole top edge.',
    use: 'Global raster data: satellite mosaics, climate grids and the image wrapped on the 3D globe on this page.',
    tex: 'x = \\lambda,\\quad y = \\varphi',
    scale: 'h = 1,\\quad k = \\sec\\varphi,\\quad s = \\sec\\varphi',
  },
  'lambert-cylindrical': {
    who: 'Johann Heinrich Lambert, 1772',
    keeps: 'Area, everywhere. Scale is true along the equator.',
    bends: 'Shape: lands near the poles are squashed north-south and stretched east-west.',
    use: 'The parent of Gall–Peters, Behrmann and other equal-area cylinders; teaching.',
    tex: 'x = \\lambda,\\quad y = \\sin\\varphi',
    scale: 'h = \\cos\\varphi,\\quad k = \\sec\\varphi,\\quad s = hk = 1',
  },
  'gall-peters': {
    who: 'James Gall, 1855; promoted by Arno Peters from 1973',
    keeps: 'Area. Shapes are true at 45° north and south.',
    bends: 'Shape: the tropics are stretched north-south, high latitudes squashed.',
    use: 'Maps that argue for fair size: some schools, charities and agencies. Its fame came from the 1970s debate, not from new mathematics.',
    tex: 'x = \\lambda\\cos 45^\\circ,\\quad y = \\frac{\\sin\\varphi}{\\cos 45^\\circ}',
    scale: 'h = \\frac{\\cos\\varphi}{\\cos 45^\\circ},\\quad k = \\frac{\\cos 45^\\circ}{\\cos\\varphi},\\quad s = hk = 1',
  },
  mollweide: {
    who: 'Karl Brandan Mollweide, 1805',
    keeps: 'Area. The world fills an ellipse twice as wide as it is high, with straight parallels.',
    bends: 'Shape, more and more toward the left and right edges.',
    use: 'World maps of a quantity (population, climate) and maps of the whole sky, such as the cosmic microwave background.',
    tex: '2\\theta+\\sin 2\\theta = \\pi\\sin\\varphi,\\quad x = \\tfrac{2\\sqrt2}{\\pi}\\lambda\\cos\\theta,\\quad y = \\sqrt2\\sin\\theta',
    scale: 'k = \\frac{2\\sqrt2\\,\\cos\\theta}{\\pi\\cos\\varphi},\\quad s = 1,\\quad \\frac{d\\theta}{d\\varphi} = \\frac{\\pi\\cos\\varphi}{4\\cos^2\\theta}',
  },
  hammer: {
    who: 'Ernst Hammer, 1892',
    keeps: 'Area. It is the equatorial Lambert azimuthal map of one hemisphere, stretched to twice its width.',
    bends: 'Shape, though with less shear at the edges than Mollweide, because the parallels curve.',
    use: 'World and sky maps; often called Hammer–Aitoff in astronomy.',
    tex: 'x = \\frac{2\\sqrt2\\cos\\varphi\\sin\\frac{\\lambda}{2}}{\\sqrt{1+\\cos\\varphi\\cos\\frac{\\lambda}{2}}},\\quad y = \\frac{\\sqrt2\\sin\\varphi}{\\sqrt{1+\\cos\\varphi\\cos\\frac{\\lambda}{2}}}',
    scale: '(x, y)_{\\mathrm{Hammer}}(\\lambda, \\varphi) = \\bigl(2x,\\ y\\bigr)_{\\mathrm{Lambert\\ azimuthal}}\\!\\left(\\tfrac{\\lambda}{2}, \\varphi\\right),\\quad s = 1',
  },
  aitoff: {
    who: 'David Aitoff (Aitov), 1889',
    keeps: 'Nothing exactly. It is the equatorial azimuthal equidistant map of one hemisphere, stretched to twice its width.',
    bends: 'Area and angle, moderately.',
    use: 'Mostly as one half of the Winkel tripel.',
    tex: '\\alpha = \\arccos\\!\\left(\\cos\\varphi\\cos\\tfrac{\\lambda}{2}\\right),\\quad x = \\frac{2\\cos\\varphi\\sin\\frac{\\lambda}{2}}{\\operatorname{sinc}\\alpha},\\quad y = \\frac{\\sin\\varphi}{\\operatorname{sinc}\\alpha}',
    scale: '(x, y)_{\\mathrm{Aitoff}}(\\lambda, \\varphi) = \\bigl(2x,\\ y\\bigr)_{\\mathrm{az.\\ equidistant}}\\!\\left(\\tfrac{\\lambda}{2}, \\varphi\\right)',
  },
  'winkel-tripel': {
    who: 'Oswald Winkel, 1921',
    keeps: 'Nothing exactly. "Tripel" means it tries to keep three errors small at once: area, direction and distance.',
    bends: 'A little of everything; the pole lines are curved and short.',
    use: 'National Geographic world maps since 1998, and many atlases.',
    tex: 'x = \\tfrac12\\left(\\lambda\\cos\\varphi_1 + x_{\\mathrm{Aitoff}}\\right),\\quad y = \\tfrac12\\left(\\varphi + y_{\\mathrm{Aitoff}}\\right),\\quad \\varphi_1 = \\arccos\\tfrac{2}{\\pi}',
    scale: '\\cos\\varphi_1 = \\tfrac{2}{\\pi} \\;\\Rightarrow\\; \\varphi_1 \\approx 50.46^\\circ,\\quad \\alpha = \\arccos\\!\\left(\\cos\\varphi\\cos\\tfrac{\\lambda}{2}\\right)',
  },
  robinson: {
    who: 'Arthur H. Robinson, 1963 (for Rand McNally)',
    keeps: 'Nothing exactly. Robinson chose the shape by eye and published it as a table every 5°.',
    bends: 'Area moderately (high latitudes are too big), shapes a little; the poles are lines 0.53 of the equator.',
    use: 'National Geographic world maps from 1988 to 1998, and many school atlases.',
    tex: 'x = 0.8487\\,X(\\varphi)\\,\\lambda,\\quad y = 1.3523\\,Y(\\varphi)\\quad (X, Y \\text{ from the table})',
    scale: 'X(\\varphi),\\ Y(\\varphi):\\ 19 \\text{ values each, } \\varphi = 0^\\circ, 5^\\circ, \\dots, 90^\\circ,\\ \\text{a cubic between nodes}',
  },
  'equal-earth': {
    who: 'Bojan Šavrič, Tom Patterson and Bernhard Jenny, 2018',
    keeps: 'Area, with a Robinson-like look: straight parallels and rounded sides.',
    bends: 'Shape near the edges and the poles, less than other equal-area world maps.',
    use: 'Thematic world maps; made as an equal-area answer to Gall–Peters, free for any use.',
    tex: '\\sin\\theta = \\tfrac{\\sqrt3}{2}\\sin\\varphi,\\quad y = A_1\\theta + A_2\\theta^3 + \\theta^7(A_3 + A_4\\theta^2)',
    scale: 'x = \\frac{2\\sqrt3\\,\\lambda\\cos\\theta}{3\\,(9A_4\\theta^8 + 7A_3\\theta^6 + 3A_2\\theta^2 + A_1)},\\quad A_{1..4} = 1.340264,\\ -0.081106,\\ 0.000893,\\ 0.003796,\\quad s = 1',
  },
  'natural-earth': {
    who: 'Tom Patterson; polynomials by Šavrič, Patterson et al., 2011',
    keeps: 'Nothing exactly. Designed by eye for a natural look, then fitted with polynomials.',
    bends: 'Area and shape a little; flat poles with rounded corners.',
    use: 'General world maps, often with the Natural Earth data this page also uses.',
    tex: 'x = \\lambda\\,(0.8707 - 0.131979\\varphi^2 - \\dots),\\quad y = \\varphi\\,(1.007226 + 0.015085\\varphi^2 - \\dots)',
    scale: 'x = \\lambda\\,(0.8707 - 0.131979\\varphi^2 - 0.013791\\varphi^4 + 0.003971\\varphi^{10} - 0.001529\\varphi^{12}),\\quad y = \\varphi\\,(1.007226 + 0.015085\\varphi^2 - 0.044475\\varphi^6 + 0.028874\\varphi^8 - 0.005916\\varphi^{10})',
  },
  'eckert-iv': {
    who: 'Max Eckert, 1906',
    keeps: 'Area. The poles are lines half as long as the equator, joined by half-circles.',
    bends: 'Shape near the edges; the flat poles stretch the polar regions east-west.',
    use: 'World atlases and thematic maps.',
    tex: '\\theta + \\sin\\theta\\cos\\theta + 2\\sin\\theta = \\left(2+\\tfrac{\\pi}{2}\\right)\\sin\\varphi',
    scale: 'x = \\frac{2\\lambda\\,(1+\\cos\\theta)}{\\sqrt{\\pi(4+\\pi)}},\\quad y = 2\\sqrt{\\frac{\\pi}{4+\\pi}}\\,\\sin\\theta,\\quad s = 1',
  },
  sinusoidal: {
    who: 'In use from the 1500s (Jean Cossin, 1570); later Sanson and Flamsteed',
    keeps: 'Area, and true scale along every parallel and along the central meridian.',
    bends: 'Shape, badly, far from the central meridian.',
    use: 'NASA\'s MODIS land products are on a sinusoidal grid; also maps of Africa and South America.',
    tex: 'x = \\lambda\\cos\\varphi,\\quad y = \\varphi',
    scale: 'h = \\sqrt{1 + \\lambda^2\\sin^2\\varphi},\\quad k = 1,\\quad s = 1',
  },
  goode: {
    who: 'J. Paul Goode, 1923',
    keeps: 'Area. Sinusoidal below 40°44′ and Mollweide above, joined where their parallels have the same length; cut in the oceans so each continent sits on its own lobe.',
    bends: 'The oceans, which are torn apart. Shapes on land stay good.',
    use: 'Goode\'s World Atlas, and global land data sets such as the 1 km AVHRR land cover.',
    tex: '|\\varphi| \\le 40^\\circ 44^\\prime:\\ x = \\lambda\\cos\\varphi;\\quad \\text{above: Mollweide}',
    scale: '\\text{above } 40^\\circ 44^\\prime:\\ y = y_{\\mathrm{Mollweide}} - 0.05280\\,\\operatorname{sgn}\\varphi,\\quad x \\text{ per lobe from its } \\lambda_0,\\quad s = 1',
  },
  orthographic: {
    who: 'Known to Greek astronomers; often credited to Hipparchus, 2nd century BC',
    keeps: 'The look of a globe seen from far away. It shows one hemisphere.',
    bends: 'Area and shape toward the rim, where the land is seen edge on.',
    use: 'Pictures of the Earth, globe views in atlases and on screens.',
    tex: 'x = \\cos\\varphi\\sin\\lambda,\\quad y = \\cos\\varphi_0\\sin\\varphi - \\sin\\varphi_0\\cos\\varphi\\cos\\lambda',
    scale: '\\cos c = \\sin\\varphi_0\\sin\\varphi + \\cos\\varphi_0\\cos\\varphi\\cos\\lambda,\\quad \\rho = \\sin c,\\quad h = \\cos c,\\ k = 1',
  },
  stereographic: {
    who: 'Known to Hipparchus; named by François d\'Aguilon, 1613',
    keeps: 'Angles. Every circle on the globe maps to a circle (or a line) on the map.',
    bends: 'Area: the scale grows away from the centre, four times the area at 90°.',
    use: 'Polar maps (the Universal Polar Stereographic grid beyond UTM), star charts and astrolabes, crystallography.',
    tex: '\\rho = 2\\tan\\frac{c}{2}\\quad (c = \\text{angle from the centre})',
    scale: 'x = \\rho\\sin A,\\ y = \\rho\\cos A,\\quad h = k = \\sec^2\\frac{c}{2},\\quad \\omega = 0',
  },
  gnomonic: {
    who: 'Traditionally credited to Thales of Miletus, 6th century BC',
    keeps: 'Straightness of great circles: every shortest route is a straight line.',
    bends: 'Everything else, fast. It cannot show a whole hemisphere.',
    use: 'Planning great-circle routes for ships and aircraft, and some seismic and radio maps.',
    tex: '\\rho = \\tan c',
    scale: 'x = \\rho\\sin A,\\ y = \\rho\\cos A,\\quad h = \\sec^2 c,\\quad k = \\sec c',
  },
  'azimuthal-equidistant': {
    who: 'Old; Guillaume Postel\'s polar map of 1581 made it popular',
    keeps: 'Distance and direction from the centre, to every point on Earth.',
    bends: 'Shape and area away from the centre; the opposite point of the globe becomes the whole rim.',
    use: 'The United Nations emblem (polar), range maps for radio, airlines and missiles centred on one city.',
    tex: '\\rho = c',
    scale: 'x = \\rho\\sin A,\\ y = \\rho\\cos A,\\quad h = 1,\\quad k = \\frac{c}{\\sin c}',
  },
  'lambert-azimuthal': {
    who: 'Johann Heinrich Lambert, 1772',
    keeps: 'Area, and true direction from the centre.',
    bends: 'Shape toward the rim; the whole globe fits in a circle.',
    use: 'The EU statistics grid (ETRS89-LAEA, EPSG:3035), polar and continental atlas maps.',
    tex: '\\rho = 2\\sin\\frac{c}{2}',
    scale: 'x = \\rho\\sin A,\\ y = \\rho\\cos A,\\quad h = \\cos\\frac{c}{2},\\quad k = \\sec\\frac{c}{2},\\quad s = 1',
  },
  albers: {
    who: 'Heinrich C. Albers, 1805',
    keeps: 'Area. Scale is true on the two standard parallels.',
    bends: 'Shape, a little, between and outside the standard parallels.',
    use: 'USGS maps of the 48 states (parallels 29.5° and 45.5°, the defaults here) and many national statistical maps.',
    tex: 'n = \\tfrac{\\sin\\varphi_1+\\sin\\varphi_2}{2},\\quad \\rho = \\frac{\\sqrt{\\cos^2\\varphi_1 + 2n(\\sin\\varphi_1 - \\sin\\varphi)}}{n}',
    scale: '\\theta = n\\lambda,\\quad x = \\rho\\sin\\theta,\\quad y = \\rho_0 - \\rho\\cos\\theta,\\quad k = \\frac{n\\rho}{\\cos\\varphi} = \\frac{1}{h},\\quad s = 1',
  },
  'lambert-conformal': {
    who: 'Johann Heinrich Lambert, 1772',
    keeps: 'Angles. Scale is true on the two standard parallels.',
    bends: 'Area away from the standard parallels; the far pole is at infinity.',
    use: 'Aeronautical charts, weather maps, US State Plane zones, and national grids such as France\'s Lambert-93.',
    tex: '\\rho = \\frac{F}{\\tan^n\\!\\left(\\frac{\\pi}{4}+\\frac{\\varphi}{2}\\right)},\\quad x = \\rho\\sin n\\lambda,\\quad y = \\rho_0 - \\rho\\cos n\\lambda',
    scale: 'n = \\frac{\\ln(\\cos\\varphi_1/\\cos\\varphi_2)}{\\ln\\!\\bigl(\\tan(\\frac{\\pi}{4}+\\frac{\\varphi_2}{2}) / \\tan(\\frac{\\pi}{4}+\\frac{\\varphi_1}{2})\\bigr)},\\quad F = \\frac{\\cos\\varphi_1\\tan^n(\\frac{\\pi}{4}+\\frac{\\varphi_1}{2})}{n},\\quad h = k = \\frac{n\\rho}{\\cos\\varphi}',
  },
  'equidistant-conic': {
    who: 'A simple form goes back to Ptolemy, about AD 150; Joseph-Nicolas de l\'Isle, 1745',
    keeps: 'Distances along every meridian and along the two standard parallels.',
    bends: 'Area and shape a little, more outside the standard parallels.',
    use: 'Atlas maps of wide mid-latitude countries, such as Russia.',
    tex: 'n = \\frac{\\cos\\varphi_1 - \\cos\\varphi_2}{\\varphi_2 - \\varphi_1},\\quad \\rho = \\frac{\\cos\\varphi_1}{n} + \\varphi_1 - \\varphi',
    scale: 'x = \\rho\\sin n\\lambda,\\quad y = \\rho_0 - \\rho\\cos n\\lambda,\\quad h = 1,\\quad k = \\frac{n\\rho}{\\cos\\varphi}',
  },
  bonne: {
    who: 'Bernardus Sylvanus, 1511 (an early form); Rigobert Bonne, about 1752',
    keeps: 'Area, and true scale along every parallel and the central meridian. The world becomes a heart.',
    bends: 'Shape far from the central meridian.',
    use: 'Topographic maps of France and other European countries in the 1800s; atlas maps of continents.',
    tex: '\\rho = \\cot\\varphi_1 + \\varphi_1 - \\varphi,\\quad E = \\frac{\\lambda\\cos\\varphi}{\\rho}',
    scale: 'x = \\rho\\sin E,\\quad y = \\cot\\varphi_1 - \\rho\\cos E,\\quad k = 1,\\quad s = 1',
  },
  polyconic: {
    who: 'Ferdinand Rudolph Hassler, about 1820 (US Coast Survey)',
    keeps: 'True scale along every parallel and the central meridian: each parallel is drawn from its own tangent cone.',
    bends: 'Area and angle grow fast away from the central meridian, which the whole world shows clearly.',
    use: 'USGS topographic quadrangle maps until the 1950s; it is good only near its central meridian.',
    tex: 'E = \\lambda\\sin\\varphi,\\quad x = \\cot\\varphi\\sin E,\\quad y = \\varphi - \\varphi_0 + \\cot\\varphi\\,(1 - \\cos E)',
    scale: 'k = 1 \\text{ on every parallel},\\quad h = 1 \\text{ on the central meridian}',
  },
};
