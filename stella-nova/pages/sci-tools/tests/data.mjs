// Data and references: CSV parsing (RFC 4180), BibTeX parsing and styles,
// Julian dates vs Meeus' worked examples, coordinates and Vincenty's test
// line.
import { parseCsv, sniff, clean, toCsv } from '../core/csv.js';
import { parseBib, names, format, detex } from '../core/bib.js';
import { toJD, fromJD, parseDate, gmst, weekday } from '../core/time.js';
import { parseCoord, dms, haversine, vincenty, R_MEAN } from '../core/geo.js';
import { TOOLS } from '../tools/data.js';

export default function ({ ok, near, throws }) {
  // CSV.
  const r = parseCsv('a,"b, c","say ""hi"""\n1,"two\nlines",3\n', ',');
  ok(r.length === 2 && r[0][1] === 'b, c' && r[0][2] === 'say "hi"' && r[1][1] === 'two\nlines', 'CSV: quoted delimiter, escaped quotes and a new line inside quotes (RFC 4180)');
  ok(sniff('a;b;c\n1;2;3\n4;5;6') === ';' && sniff('a\tb\n1\t2') === '\t' && sniff('x y\n1 2\n3 4') === ' ', 'CSV: delimiter detection (semicolon, tab, spaces)');
  const c = clean('Probe;Wert\n1;2,5\n2;3,1\n\n3;x\n4;1,25\n5;7', { decimalComma: true });
  ok(c.hasHeader && c.body.length === 5 && c.cols[1][0] === 2.5 && c.cols[1][2] === null && c.bad === 1, 'CSV: header found, empty row dropped, decimal comma read, a bad cell counted');
  ok(toCsv(['a', 'b'], [['1', 'x,y'], ['2', 'q"r']]) === 'a,b\n1,"x,y"\n2,"q""r"', 'CSV: writing quotes the fields that need it');
  // BibTeX.
  const n = names('Ludwig van Beethoven and {Barnes and Noble} and Ford, Jr., Henry and de la Fontaine, Jean');
  ok(n.length === 4 && n[0].von === 'van' && n[0].last === 'Beethoven' && n[1].last === 'Barnes and Noble' && n[2].jr === 'Jr.' && n[2].first === 'Henry' && n[3].von === 'de la' && n[3].last === 'Fontaine', 'BibTeX names: von part, braced corporate name, Jr part (Patashnik §4)');
  ok(detex('Schr{\\"o}dinger -- G{\\\'e}rard \\& {\\o}rsted') === 'Schrödinger – Gérard & ørsted', 'TeX accents, dashes and \\& to Unicode');
  const e = parseBib('@string{pr = "Physical Review"}\n@article{k, author = {Smith, John A. and Doe, Jane}, title = {A {Test} Title}, journal = pr # " A", volume = 12, number = {3}, pages = {100--110}, year = 2020, month = mar, doi = {https://doi.org/10.1000/xyz}}');
  ok(e.length === 1 && e[0].fields.journal === 'Physical Review A' && e[0].fields.month === 'March' && e[0].fields.volume === '12', 'BibTeX: @string macro, # join, bare number, month macro');
  const f = (s) => format(e[0], s).text;
  ok(f('apa') === 'Smith, J. A., & Doe, J. (2020). A Test Title. Physical Review A, 12(3), 100–110. https://doi.org/10.1000/xyz', 'APA 7 article', f('apa'));
  ok(f('ieee') === 'J. A. Smith and J. Doe, “A Test Title,” Physical Review A, vol. 12, no. 3, pp. 100–110, Mar. 2020, doi: 10.1000/xyz.', 'IEEE article', f('ieee'));
  ok(f('vancouver') === 'Smith JA, Doe J. A Test Title. Physical Review A. 2020;12(3):100-110. doi:10.1000/xyz', 'Vancouver article', f('vancouver'));
  ok(f('chicago') === 'Smith, John A., and Jane Doe. 2020. “A Test Title.” Physical Review A 12 (3): 100–110. https://doi.org/10.1000/xyz.', 'Chicago author-date article', f('chicago'));
  ok(format(e[0], 'apa').html.includes('<i>Physical Review A</i>, <i>12</i>'), 'APA: journal and volume in italics');
  throws(() => parseBib('no entries here'), /No BibTeX entry/, 'BibTeX: no entry is an error');
  // Julian dates: Meeus, Astronomical Algorithms, examples 7.a, 7.b and table 7.a.
  const jd = [[2000, 1, 1.5, 2451545.0], [1987, 1, 27.0, 2446822.5], [1988, 6, 19.5, 2447332.0], [1957, 10, 4.81, 2436116.31], [333, 1, 27.5, 1842713.0], [1600, 1, 1, 2305447.5], [837, 4, 10.3, 2026871.8], [-123, 12, 31, 1676496.5], [-1000, 7, 12.5, 1356001.0], [-4712, 1, 1.5, 0.0], [1582, 10, 15, 2299160.5], [1582, 10, 4, 2299159.5]];
  const badJ = jd.filter(([y, m, d, w]) => Math.abs(toJD(y, m, d) - w) > 1e-6);
  ok(!badJ.length, `JD of Meeus' worked examples (${jd.length} dates, both calendars)`, badJ.map(j => `${j}: ${toJD(j[0], j[1], j[2])}`).join(' | '));
  const back = fromJD(2436116.31);
  ok(back.y === 1957 && back.m === 10 && Math.abs(back.d - 4.81) < 1e-6, 'JD 2436116.31 back to 1957 October 4.81 (Meeus 7.c)');
  const b2 = fromJD(1842713.0);
  ok(b2.y === 333 && b2.m === 1 && Math.abs(b2.d - 27.5) < 1e-9, 'JD 1842713.0 back to 333 January 27.5 (Julian calendar)');
  ok(toJD(1858, 11, 17) - 2400000.5 === 0, 'MJD 0 = 1858 November 17, 0h');
  near(gmst(2446895.5), 197.693195, 1e-8, 'GMST at 1987 April 10, 0h UT = 13h10m46.3668s (Meeus 12.a)');
  ok(weekday(2434923.5) === 'Wednesday', '1954 June 30 was a Wednesday (Meeus 7.e)');
  const p = parseDate('2000-01-01T12:00:00Z');
  ok(p.y === 2000 && Math.abs(p.d - 1.5) < 1e-12, 'ISO date with T and Z');
  const un = TOOLS.jd.run({ mode: 'unix', x: '0', cal: 'auto' });
  ok(un.rows[0][1] === '2440587.500000', 'Unix 0 = JD 2440587.5');
  // Geo.
  const A = parseCoord('37°57′03.72030″S 144°25′29.52440″E'), B = parseCoord('37°39′10.15610″S 143°55′35.38390″E');
  const v = vincenty(A, B);
  near(v.s, 54972.271, 2e-8, 'Vincenty: Flinders Peak to Buninyong = 54 972.271 m (Vincenty 1975)');
  near(v.az1, 306 + 52 / 60 + 5.37 / 3600, 1e-7, 'Vincenty: azimuth 306°52′05.37″');
  near(haversine([0, 0], [0, 90]), Math.PI / 2 * R_MEAN, 1e-15, 'haversine: a quarter of the equator = πR/2');
  near(haversine([90, 0], [0, 0]), Math.PI / 2 * R_MEAN, 1e-15, 'haversine: pole to equator = πR/2');
  const pc = parseCoord('51 28 40.12 N, 0 0 5.31 W'), pd = parseCoord('51°28.6687′N 0°0.0885′W');
  ok(Math.abs(pc[0] - 51.477811) < 1e-6 && Math.abs(pc[1] + 0.001475) < 1e-6 && Math.abs(pd[0] - pc[0]) < 1e-5, 'coordinates: D M S with spaces, and D M.m');
  ok(dms(-33.8568, 'N', 'S') === '33°51′24.48″S', 'decimal to DMS: −33.8568 = 33°51′24.48″S');
  throws(() => parseCoord('95, 10'), /latitude/, 'a latitude above 90 is an error');
}
