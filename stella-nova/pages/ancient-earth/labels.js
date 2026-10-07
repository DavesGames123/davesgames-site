// ============================================================================
//  ANCIENT EARTH  ·  labels.js  ·  the 2D label layer over the globe
// ----------------------------------------------------------------------------
//  A canvas the size of the view, redrawn each frame. Every label has a
//  place on the globe (riding a plate or fixed to the paleo grid) and a
//  priority. Labels on the far side or near the limb fade out; a label that
//  would overlap a placed one is skipped (greedy, highest priority first).
//
//  Kinds, by priority: pins, ancient continents and oceans (world.js
//  NAMES), plate names, the paleo-equator, countries, cities.
//
//  grep -n targets
//    readable plate names .. "export const PLATE_NAMES"
//    collision ............. "function fits"
//    the draw pass ......... "draw("
// ============================================================================
import { NAMES } from './world.js';
import { llToVec, vecToLL } from './recon.js';

// Readable names for the larger PALEOMAP plates (plate ID -> name). The
// rest use the rotation file comment (build/build_data.py "clean_name").
export const PLATE_NAMES = {
  101: 'North America', 102: 'Greenland', 103: 'North Slope', 104: 'Mexico', 106: 'Arctic islands', 109: 'Piedmont', 124: 'Cordillera',
  201: 'South America', 202: 'Paraná', 291: 'Colorado subplate', 262: 'Amazonia', 301: 'Europe', 302: 'Baltica', 304: 'Iberia', 305: 'Variscan Europe',
  307: 'Italy and Adria', 310: 'Barents shelf', 315: 'East Avalonia', 401: 'Siberia', 402: 'Kazakhstania', 405: 'Verkhoyansk', 406: 'Kamchatka–Omolon',
  501: 'India', 503: 'Arabia', 514: 'North Caspian', 601: 'Tarim', 604: 'North China', 610: 'Japan', 611: 'South China', 612: 'Qiangtang', 613: 'Lhasa',
  615: 'Indochina', 616: 'Sibumasu', 619: 'Gulf of Thailand', 620: 'Borneo and Java', 628: 'Amuria', 701: 'Africa', 702: 'Madagascar', 709: 'Somalia',
  712: 'Lake Victoria block', 714: 'Northwest Africa', 715: 'Northeast Africa', 716: 'Sudan block', 801: 'Australia', 802: 'East Antarctica',
  803: 'Antarctic Peninsula', 804: 'Marie Byrd Land', 833: 'Lord Howe Rise', 895: 'Berkner Island',
};

export class Labels {
  constructor(canvas, globe, plates, data) {
    this.cv = canvas; this.g = canvas.getContext('2d');
    this.globe = globe; this.P = plates; this.data = data;
    this.show = { names: true, plates: false, countries: false, cities: true, equator: true };
    // the largest polygon of each plate carries its name
    const best = new Map();
    plates.poly.forEach((p, k) => { const b = best.get(p.p); if (!b || p.a > plates.poly[b].a) best.set(p.p, k); });
    this.plateLabels = [...best.entries()].filter(([pid, k]) => plates.poly[k].a > 700000 || PLATE_NAMES[pid])
      .map(([pid, k]) => ({ pid, k, name: PLATE_NAMES[pid] || plates.plateName(pid), lat: plates.poly[k].c[1] / 100, lon: plates.poly[k].c[0] / 100, area: plates.poly[k].a }))
      .filter(l => l.name);
    this.cities = [];          // setCities, when data/cities.json is in
    if (data.cities) this.setCities(data.cities);
    this.dpr = 1;
    this.maxCities = 140;
  }
  setCities(c) { this.cities = c.rows.slice(0, 600); }
  resize(w, h) {
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.cv.width = Math.round(w * this.dpr); this.cv.height = Math.round(h * this.dpr);
    this.cv.style.width = w + 'px'; this.cv.style.height = h + 'px';
    this.w = w; this.h = h;
  }
  // A paleo position for a present-day anchor at t, or null.
  ride(lat, lon, t) { const r = this.P.reconstruct(lat, lon, t); return r ? r.v : null; }
  anchorVec(a, t) {
    if (a.at) return this.ride(a.at[0], a.at[1], t);
    if (a.anti) { const v = this.ride(a.anti[0], a.anti[1], t); return v ? [-v[0], -v[1], -v[2]] : null; }
    if (a.mid) {
      const u = this.ride(a.mid[0][0], a.mid[0][1], t), v = this.ride(a.mid[1][0], a.mid[1][1], t);
      if (!u || !v) return null;
      const m = [u[0] + v[0], u[1] + v[1], u[2] + v[2]], n = Math.hypot(...m);
      return n < 1e-6 ? null : m.map(x => x / n);
    }
    return null;
  }
  draw(t, extra = []) {
    const g = this.g, G = this.globe, dpr = this.dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    const items = [];
    const push = (v, o) => { if (!v) return; const [la, lo] = vecToLL(v); const s = G.projectLL(la, lo, 1.003); if (s.front < 0.12) return; items.push({ ...o, x: s.x, y: s.y, a: Math.min(1, (s.front - 0.12) / 0.2) }); };
    for (const e of extra) push(llToVec(e.lat, e.lon), e);
    if (this.show.names) for (const [name, kind, from, to, anc, size] of NAMES) {
      if (t > from || t < to) continue;
      push(this.anchorVec(anc, t), { text: name, kind: kind === 'sea' ? 'sea' : 'land', pri: 80 + size * 5, size });
    }
    if (this.show.plates) for (const l of this.plateLabels) {
      push(this.ride(l.lat, l.lon, t), { text: l.name, kind: 'plate', pri: 50 + Math.log10(l.area) });
    }
    if (this.show.equator) {
      // the paleo-equator, labelled at the visible point nearest the view centre
      const c = G.camera.position.clone().applyQuaternion(G.group.quaternion.clone().invert()).normalize();
      const lon = Math.atan2(c.x, c.z) * 180 / Math.PI;
      push(llToVec(0, lon + 12), { text: 'paleo-equator', kind: 'eq', pri: 40 });
    }
    if (this.show.countries && this.data.over) for (const [name, lo, la, k, rank] of this.data.over.countries) {
      if (k === 255) continue;
      const r = this.P.reconstruct(la / 100, lo / 100, t, k); if (!r) continue;
      push(r.v, { text: name, kind: 'country', pri: 30 - rank });
    }
    if (this.show.cities) {
      let n = 0;
      for (const c of this.cities) {
        if (c[6] === 255) continue;
        const r = this.P.reconstruct(c[2], c[3], t, c[6]); if (!r) continue;
        push(r.v, { text: c[0], kind: 'city', pri: 10 + Math.log10(Math.max(1, c[4])), dot: true });
        if (++n > this.maxCities) break;
      }
    }
    items.sort((a, b) => b.pri - a.pri);
    const placed = [];
    for (const it of items) {
      const st = STYLE[it.kind] || STYLE.city;
      g.font = st.font(it.size || 1);
      const w = g.measureText(it.text).width + (it.dot ? 9 : 0), h = st.h(it.size || 1);
      const x = it.dot ? it.x + 5 : it.x - w / 2, y = it.dot ? it.y - h / 2 : it.y - h / 2;
      const box = { x0: x - 3, y0: y - 2, x1: x + w + 3, y1: y + h + 2 };
      if (!fits(box, placed)) continue;
      placed.push(box);
      g.globalAlpha = it.a * st.alpha;
      if (it.dot) { g.fillStyle = st.dotColor || st.color; g.beginPath(); g.arc(it.x, it.y, 2.2, 0, Math.PI * 2); g.fill(); }
      g.lineWidth = 3; g.strokeStyle = 'rgba(4,7,12,0.75)'; g.lineJoin = 'round';
      g.fillStyle = it.color || st.color; g.textBaseline = 'middle';
      const tx = it.dot ? it.x + 6 : it.x - (w / 2), ty = it.y;
      if (st.letter) { g.letterSpacing = st.letter; }
      g.strokeText(it.text, tx, ty); g.fillText(it.text, tx, ty);
      if (st.letter) g.letterSpacing = '0px';
    }
    g.globalAlpha = 1;
  }
}

function fits(b, placed) {
  for (const p of placed) if (b.x0 < p.x1 && b.x1 > p.x0 && b.y0 < p.y1 && b.y1 > p.y0) return false;
  return true;
}

const SERIF = "'STIX Two Text', Georgia, serif", SANS = "Inter, system-ui, sans-serif";
const STYLE = {
  land: { font: s => `600 ${[0, 13, 16, 21][s]}px ${SERIF}`, h: s => [0, 15, 19, 25][s], color: '#fff3dc', alpha: 0.95, letter: '0.5px' },
  sea: { font: s => `italic 400 ${[0, 13, 15, 19][s]}px ${SERIF}`, h: s => [0, 15, 18, 23][s], color: '#a9d4ff', alpha: 0.9, letter: '1px' },
  plate: { font: () => `500 11px ${SANS}`, h: () => 13, color: '#d9e6c8', alpha: 0.85 },
  eq: { font: () => `italic 400 11px ${SERIF}`, h: () => 13, color: '#ffc58a', alpha: 0.85 },
  country: { font: () => `500 10.5px ${SANS}`, h: () => 12, color: '#ffe2b8', alpha: 0.8 },
  city: { font: () => `400 10.5px ${SANS}`, h: () => 12, color: '#eef3f8', dotColor: '#ffd27a', alpha: 0.85 },
  pin: { font: () => `600 12px ${SANS}`, h: () => 14, color: '#ffe08a', alpha: 1 },
};
