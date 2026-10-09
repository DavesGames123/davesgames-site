// ============================================================================
//  SCIENCE TOOLKIT  ·  tools/data.js  ·  data, text and reference tools
// ----------------------------------------------------------------------------
//  Tool definitions for the "data" category (contract: tools/units.js).
//
//  GREP MAP
//    grep -n "csv:"  "latex:"  "bibtex:"  "jd:"  "geo:"
// ============================================================================
import { clean, toCsv } from '../core/csv.js';
import { parseBib, format, STYLE_NAMES } from '../core/bib.js';
import { toJD, fromJD, parseDate, gmst, weekday, MJD0 } from '../core/time.js';
import { parseCoord, dms, ddm, haversine, vincenty, bearing, midpoint } from '../core/geo.js';
import { fmt, esc, num, plot, histogram } from '../kit.js';

const blank = (s) => !String(s ?? '').trim();
const pad = (n, w = 2) => String(n).padStart(w, '0');

function colIndex(spec, header) {
  const t = String(spec).trim();
  if (!t) return -1;
  if (/^\d+$/.test(t)) { const i = Number(t) - 1; if (i < 0 || i >= header.length) throw new Error(`There is no column ${t}.`); return i; }
  const i = header.findIndex(h => h.toLowerCase() === t.toLowerCase());
  if (i < 0) throw new Error(`There is no column "${t}". Columns: ${header.join(', ')}.`);
  return i;
}

const DEMO_CSV = 'time_s,temp_C,pressure_kPa\n0,21.4,101.2\n10,23.9,101.6\n20,27.1,102.3\n30,30.2,103.1\n40,33.8,103.8\n50,36.9,104.6\n60,40.3,105.2\n70,43.1,106.1\n80,46.6,106.7\n90,49.8,107.5';

export const TOOLS = {
  csv: {
    inputs: [
      { k: 'd', label: 'CSV, TSV or space-separated text', type: 'area', rows: 7, def: DEMO_CSV },
      { k: 'head', label: 'Header row', type: 'select', def: 'auto', opts: [['auto', 'detect'], ['yes', 'yes'], ['no', 'no']] },
      { k: 'dc', label: 'Decimal comma (1,5)', type: 'check', def: '0' },
      { k: 'kind', label: 'Chart', type: 'select', def: 'line', opts: [['scatter', 'scatter'], ['line', 'line'], ['hist', 'histogram (first y)'], ['none', 'no chart']] },
      { k: 'x', label: 'x column (name or number)', def: '1' },
      { k: 'y', label: 'y columns', def: '2, 3', hint: 'names or numbers, comma-separated' },
    ],
    examples: [{ label: 'semicolons and decimal commas', v: { d: 'Probe;Wert\n1;2,5\n2;3,1\n3;2,9\n4;3,6', dc: '1', x: '1', y: '2', kind: 'scatter' } }, { label: 'quoted fields', v: { d: 'name,"value, mm",note\n"a",1.5,"said ""ok"""\n"b",2.25,\n"c",3.0,"multi"', x: '', y: '2', kind: 'hist' } }],
    run({ d, head, dc, kind, x, y }) {
      const r = clean(d, { header: head, decimalComma: dc === '1' });
      const delimName = { ',': 'comma', '\t': 'tab', ';': 'semicolon', '|': 'bar', ' ': 'spaces' }[r.delim];
      const rows = [['Rows', String(r.body.length)], ['Columns', `${r.width} (${r.header.map((h, i) => `${i + 1}: ${h}${r.numeric[i] ? '' : ' [text]'}`).join(', ')})`], ['Delimiter', delimName], ['Header', r.hasHeader ? 'yes' : 'no']];
      if (r.bad) rows.push(['Cells that are not numbers', String(r.bad), 'in numeric columns; they are left out of the chart']);
      const cleaned = toCsv(r.header, r.body.map((row, i) => row.map((c, j) => r.numeric[j] && r.cols[j][i] != null ? String(r.cols[j][i]) : c)), ',');
      const preview = `<h4>Clean data (first 25 rows)</h4><table class="t"><thead><tr>${r.header.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${r.body.slice(0, 25).map((row, i) => `<tr>${row.map((c, j) => `<td class="${r.numeric[j] ? 'num' : ''}">${esc(r.numeric[j] ? (r.cols[j][i] ?? '—') : c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      let svg;
      if (kind !== 'none') {
        const ys = String(y).split(',').map(s => s.trim()).filter(Boolean).map(s => colIndex(s, r.header));
        if (!ys.length) throw new Error('Choose at least one y column.');
        for (const j of ys) if (!r.numeric[j]) throw new Error(`Column "${r.header[j]}" is not numeric.`);
        if (kind === 'hist') {
          const v = r.cols[ys[0]].filter(Number.isFinite);
          svg = histogram(v, { xlabel: r.header[ys[0]] }).svg;
        } else {
          const xi = blank(x) ? -1 : colIndex(x, r.header);
          if (xi >= 0 && !r.numeric[xi]) throw new Error(`Column "${r.header[xi]}" is not numeric; leave x empty to plot against the row number.`);
          const xs = xi >= 0 ? r.cols[xi] : r.body.map((_, i) => i + 1);
          const series = ys.map(j => {
            const pts = xs.map((xv, i) => [xv, r.cols[j][i]]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
            if (kind === 'line') pts.sort((p, q) => p[0] - q[0]);
            return { x: pts.map(p => p[0]), y: pts.map(p => p[1]), type: kind === 'scatter' ? 'scatter' : 'line', name: r.header[j] };
          });
          svg = plot(series, { xlabel: xi >= 0 ? r.header[xi] : 'row', ylabel: ys.length === 1 ? r.header[ys[0]] : '' });
        }
      }
      return { rows, html: preview, svg, copy: cleaned };
    },
    tex: ['\\text{RFC 4180: } \\texttt{field} = \\texttt{"..."} \\text{ (with "" for a quote) or plain text}'],
    how: 'The parser follows RFC 4180: quoted fields may hold the delimiter, quotes ("" inside quotes) and new lines. The delimiter is the one of comma, tab, semicolon and bar that gives the most rows with the same number of fields. Cells are trimmed and empty rows dropped. A column is numeric when 80 % or more of its cells are numbers. "Copy result" gives the clean data as comma-separated text; the chart exports as SVG or PNG.',
    refs: ['IETF RFC 4180, Common Format and MIME Type for Comma-Separated Values (CSV) Files (2005).'],
  },

  latex: {
    inputs: [
      { k: 't', label: 'TeX (math mode)', type: 'area', rows: 4, def: 'i\\hbar\\frac{\\partial}{\\partial t}\\Psi(\\mathbf r,t) = \\left[-\\frac{\\hbar^2}{2m}\\nabla^2 + V(\\mathbf r,t)\\right]\\Psi(\\mathbf r,t)' },
      { k: 'disp', label: 'Display style', type: 'check', def: '1' },
    ],
    examples: [
      { label: 'Maxwell', v: { t: '\\nabla\\cdot\\mathbf E = \\frac{\\rho}{\\varepsilon_0},\\quad \\nabla\\times\\mathbf B = \\mu_0\\mathbf J + \\mu_0\\varepsilon_0\\frac{\\partial\\mathbf E}{\\partial t}' } },
      { label: 'matrix', v: { t: 'R(\\theta) = \\begin{pmatrix}\\cos\\theta & -\\sin\\theta\\\\ \\sin\\theta & \\cos\\theta\\end{pmatrix}' } },
      { label: 'aligned', v: { t: '\\begin{aligned} f(x) &= (x+1)^2 \\\\ &= x^2 + 2x + 1 \\end{aligned}' } },
    ],
    run({ t, disp }) {
      if (blank(t)) throw new Error('Enter some TeX.');
      const s = String(t).trim().replace(/^\$\$?|\$\$?$/g, '').replace(/^\\\[|\\\]$/g, '');
      let depth = 0;
      for (const ch of s.replace(/\\[{}]/g, '')) { if (ch === '{') depth++; else if (ch === '}' && --depth < 0) break; }
      if (depth !== 0) throw new Error('The braces { } do not match.');
      return { texOut: s, display: disp === '1', rows: [['Characters', String(s.length)]], copy: s };
    },
    tex: ['\\text{TeX} \\;\\to\\; \\text{MathJax 3} \\;\\to\\; \\text{SVG paths}'],
    how: 'MathJax 3 (served from this site, so it works offline) typesets the TeX to SVG with the glyphs as paths, so the copied SVG needs no fonts and looks the same in any program. A TeX error shows the source instead of an image. Outer $…$ or \\[…\\] are removed. AMS environments (aligned, pmatrix, cases) work.',
    refs: ['MathJax 3.2, docs.mathjax.org.', 'American Mathematical Society, User\'s Guide for the amsmath Package (2020).'],
  },

  bibtex: {
    inputs: [
      { k: 'b', label: 'BibTeX', type: 'area', rows: 8, def: '@article{einstein1905,\n  author  = {Einstein, Albert},\n  title   = {Zur Elektrodynamik bewegter K{\\"o}rper},\n  journal = {Annalen der Physik},\n  volume  = {322},\n  number  = {10},\n  pages   = {891--921},\n  year    = {1905},\n  doi     = {10.1002/andp.19053221004}\n}' },
      { k: 's', label: 'Style', type: 'select', def: 'apa', opts: Object.entries(STYLE_NAMES) },
      { k: 'sort', label: 'Sort by first author', type: 'check', def: '0' },
    ],
    examples: [{ label: 'book and proceedings', v: { b: '@book{knuth1997,\n  author = {Donald E. Knuth},\n  title = {The Art of Computer Programming, Volume 2: Seminumerical Algorithms},\n  edition = {3rd},\n  publisher = {Addison-Wesley},\n  address = {Reading, MA},\n  year = 1997\n}\n@inproceedings{he2016,\n  author = {He, Kaiming and Zhang, Xiangyu and Ren, Shaoqing and Sun, Jian},\n  title = {Deep Residual Learning for Image Recognition},\n  booktitle = {Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition},\n  pages = {770--778},\n  year = {2016},\n  doi = {10.1109/CVPR.2016.90}\n}', s: 'ieee' } }],
    run({ b, s, sort }) {
      let es = parseBib(b).filter(e => e.type !== 'string');
      if (sort === '1') es = es.slice().sort((p, q) => (p.fields.author || '').localeCompare(q.fields.author || ''));
      const out = es.map(e => format(e, s));
      const numbered = s === 'ieee' || s === 'vancouver';
      const html = `<ol class="refs-out"${numbered ? '' : ' style="list-style:none;padding-left:0"'}>${out.map((o, i) => `<li style="margin-bottom:8px">${numbered ? `<span class="dim">[${i + 1}]</span> ` : ''}${o.html}${o.doi ? ` <a href="https://doi.org/${esc(o.doi)}" target="_blank" rel="noopener">doi</a>` : ''}</li>`).join('')}</ol>`;
      const text = out.map((o, i) => (numbered ? `[${i + 1}] ` : '') + o.text).join('\n');
      return { rows: [['Entries', String(es.length)], ['Style', STYLE_NAMES[s]]], html, copy: text };
    },
    tex: ['\\texttt{@type\\{key, field = \\{value\\}, \\dots\\}} \\;\\to\\; \\text{formatted reference}'],
    how: 'The parser reads nested braces, quoted values, @string macros, month names and # joins. Names in all three BibTeX forms are split into first, von, last and Jr parts; TeX accents and dashes become Unicode. It runs offline: a DOI becomes a doi.org link but nothing is fetched. Check the result against your publisher\'s rules for edge cases (corporate authors, preprints).',
    refs: ['O. Patashnik, BibTeXing (1988), §4 (names) and the btxdoc entry types.', 'American Psychological Association, Publication Manual, 7th ed. (2020), ch. 9-10.', 'IEEE Reference Guide (IEEE Periodicals, 2023).', 'ICMJE / NLM, Citing Medicine, 2nd ed. (2007).', 'The Chicago Manual of Style, 17th ed. (2017), ch. 15.'],
  },

  jd: {
    inputs: [
      { k: 'mode', label: 'From', type: 'select', def: 'date', opts: [['date', 'calendar date (UT)'], ['jd', 'Julian Date'], ['mjd', 'Modified Julian Date'], ['unix', 'Unix time (s)']] },
      { k: 'x', label: 'Value', def: '2000-01-01 12:00:00', hint: 'YYYY-MM-DD hh:mm:ss, or a decimal day 1957-10-04.81; years before 1 use 0, −1 …' },
      { k: 'cal', label: 'Calendar', type: 'select', def: 'auto', opts: [['auto', 'Julian before 1582-10-15, Gregorian after'], ['gregorian', 'proleptic Gregorian'], ['julian', 'Julian']] },
    ],
    examples: [
      { label: 'Sputnik 1', v: { mode: 'date', x: '1957-10-04.81' } },
      { label: 'MJD 0', v: { mode: 'mjd', x: '0' } },
      { label: 'JD 0', v: { mode: 'jd', x: '0' } },
      { label: 'Unix epoch', v: { mode: 'unix', x: '0' } },
    ],
    run({ mode, x, cal }) {
      let jd;
      if (mode === 'date') { const p = parseDate(x); jd = toJD(p.y, p.m, p.d, cal); }
      else if (mode === 'jd') jd = num(x);
      else if (mode === 'mjd') jd = num(x) + MJD0;
      else jd = num(x) / 86400 + 2440587.5;
      const c = fromJD(jd, cal);
      const yearText = c.y <= 0 ? `${c.y} (${1 - c.y} BC)` : String(c.y);
      const iso = `${c.y < 0 ? '-' + pad(-c.y, 4) : pad(c.y, 4)}-${pad(c.m)}-${pad(c.day)} ${pad(c.h)}:${pad(c.mi)}:${c.s.toFixed(3).padStart(6, '0')} UT`;
      const jan1 = toJD(c.y, 1, 1, cal);
      const greg = cal === 'gregorian' || (cal === 'auto' && jd >= 2299160.5);
      const g = gmst(jd), gh = g / 15;
      const rows = [
        ['Julian Date (JD)', jd.toFixed(6)], ['Modified JD (MJD = JD − 2400000.5)', (jd - MJD0).toFixed(6)],
        ['Calendar date', iso, `${greg ? 'Gregorian' : 'Julian'} calendar; year ${yearText}`], ['Day of the week', weekday(jd)],
        ['Day of the year', fmt(jd - jan1 + 1, 10)], ['Unix time', fmt((jd - 2440587.5) * 86400, 13), 's since 1970-01-01 00:00 UT'],
        ['Julian epoch', `J${fmt(2000 + (jd - 2451545) / 365.25, 10)}`], ['Julian centuries from J2000.0', fmt((jd - 2451545) / 36525, 12)],
        ['Greenwich mean sidereal time', `${Math.floor(gh)}h ${pad(Math.floor((gh % 1) * 60))}m ${(((gh * 60) % 1) * 60).toFixed(3)}s`, `${fmt(g, 10)}°`],
      ];
      return { rows, copy: jd.toFixed(6) };
    },
    tex: [
      '\\mathrm{JD} = \\lfloor 365.25(Y + 4716)\\rfloor + \\lfloor 30.6001(M + 1)\\rfloor + D + B - 1524.5',
      'B = 2 - A + \\lfloor A/4\\rfloor,\\ A = \\lfloor Y/100\\rfloor\\ \\text{(Gregorian)},\\quad B = 0\\ \\text{(Julian)}',
      '\\mathrm{MJD} = \\mathrm{JD} - 2\\,400\\,000.5,\\qquad \\theta_0 = 280.460\\,618\\,37^\\circ + 360.985\\,647\\,366\\,29^\\circ\\,(\\mathrm{JD} - 2\\,451\\,545) + \\dots',
    ],
    how: 'Meeus\' algorithm (Y and M shifted so that the year starts in March). The calendar switches from Julian to Gregorian at 1582 October 15 unless one is forced; years are astronomical (year 0 = 1 BC). Times are taken as UT; the tool applies no leap seconds and no TT − UT correction, so for ephemeris work add ΔT. GMST uses the IAU 1982 expression (Meeus eq. 12.4).',
    refs: ['J. Meeus, Astronomical Algorithms, 2nd ed. (1998), ch. 7 and 12.', 'IAU Resolution B1 (1997) and the Explanatory Supplement to the Astronomical Almanac, 3rd ed. (2012), ch. 15 (MJD).'],
  },

  geo: {
    inputs: [
      { k: 'a', label: 'Point A (lat, lon)', def: '51°28′40.12″N 0°0′5.31″W', w: 2, hint: 'decimal, D M S, or D M.m; N/S/E/W or signs' },
      { k: 'b', label: 'Point B (optional)', def: '40.6892, -74.0445', w: 2 },
    ],
    examples: [{ label: 'Vincenty test line', v: { a: '37°57′03.72030″S 144°25′29.52440″E', b: '37°39′10.15610″S 143°55′35.38390″E' } }, { label: 'one point', v: { a: '-33.8568, 151.2153', b: '' } }],
    run({ a, b }) {
      const A = parseCoord(a);
      const rows = [['A, decimal degrees', `${fmt(A[0], 10)}, ${fmt(A[1], 10)}`], ['A, degrees minutes seconds', `${dms(A[0])} ${dms(A[1], 'E', 'W')}`], ['A, degrees decimal minutes', `${ddm(A[0])} ${ddm(A[1], 'E', 'W')}`]];
      if (!blank(b)) {
        const B = parseCoord(b);
        rows.push(['B, decimal degrees', `${fmt(B[0], 10)}, ${fmt(B[1], 10)}`]);
        let v = null;
        try { v = vincenty(A, B); } catch (e) { rows.push(['Ellipsoid distance', e.message]); }
        if (v) rows.push(['Geodesic distance (WGS 84, Vincenty)', `${fmt(v.s / 1000, 10)} km`, `${fmt(v.s, 12)} m`], ['Initial azimuth A → B', `${fmt(v.az1, 9)}°`, dms(v.az1, '', '')], ['Final azimuth at B', `${fmt(v.az2, 9)}°`]);
        rows.push(['Great-circle distance (sphere, R = 6371.0088 km)', `${fmt(haversine(A, B) / 1000, 10)} km`, 'haversine; differs from the ellipsoid by up to about 0.5 %'], ['Initial bearing (sphere)', `${fmt(bearing(A, B), 8)}°`]);
        const m = midpoint(A, B);
        rows.push(['Midpoint (sphere)', `${fmt(m[0], 9)}, ${fmt(m[1], 9)}`]);
      }
      return { rows, copy: rows[!blank(b) ? 4 : 0][1] };
    },
    tex: [
      'd = 2R\\arcsin\\sqrt{\\sin^2\\frac{\\Delta\\varphi}{2} + \\cos\\varphi_1\\cos\\varphi_2\\sin^2\\frac{\\Delta\\lambda}{2}}',
      's = bA(\\sigma - \\Delta\\sigma)\\ \\ \\text{(Vincenty, WGS 84: } a = 6\\,378\\,137\\text{ m},\\ 1/f = 298.257\\,223\\,563)',
    ],
    how: 'Coordinates are read in decimal degrees, degrees–minutes–seconds or degrees–decimal minutes, with hemisphere letters or signs. The geodesic distance and azimuths use Vincenty\'s inverse formula on the WGS 84 ellipsoid (accurate to well under 1 mm; it does not converge for nearly antipodal points). The haversine distance on a sphere of the IUGG mean radius is shown too.',
    refs: ['T. Vincenty, Survey Review 23, 88 (1975).', 'NGA, World Geodetic System 1984, NGA.STND.0036 (2014).', 'H. Moritz, Geodetic Reference System 1980, J. Geodesy 74, 128 (2000) (mean radius R₁).'],
  },
};
