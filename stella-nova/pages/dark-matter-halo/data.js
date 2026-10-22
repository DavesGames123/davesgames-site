// ============================================================================
//  DARK MATTER HALO  ·  data.js — measured points, published values, history
// ----------------------------------------------------------------------------
//  Every number in this file was copied from a source that was fetched on
//  2026-10-22. No number is typed from memory. Each value names its source
//  id (SOURCES). A table that could not be fetched is left out.
//
//  Fetched:
//    eilers19 . the LaTeX source of arXiv:1810.09466 (main.tex, table
//               "tab:measurements"). The rows that the authors commented
//               out (R < 5 kpc, inside the bar) are left out here too.
//    jiao23 ... the LaTeX source of arXiv:2309.00048 (AA_2023_47513.tex,
//               table "tab:rc_z3"). Its error bars include systematics.
//    abstracts  arXiv API records (title, DOI, journal) of every arXiv id
//               below, and Crossref records of the DOIs of the old papers.
//
//  Not fetched: the Zwicky (1933) original in Helvetica Physica Acta and the
//  Bosma (1978) Groningen thesis. ADS showed a human check. The page cites
//  the English republication of Zwicky and the 1981 journal papers of Bosma.
//
//  Each source fixes its own Sun radius R0. The points are plotted at their
//  published R; the page says so.
//
//  grep -n targets
//    sources ............. "export const SOURCES"
//    Eilers 2019 points .. "export const EILERS19"
//    Jiao 2023 points .... "export const JIAO23"
//    published values .... "export const ESTIMATES"
//    cosmic fraction ..... "export const PLANCK18"
//    history ............. "export const HISTORY"
//    methods ............. "export const METHODS"
// ============================================================================

export const SOURCES = Object.freeze({
  mcmillan17: { cite: 'P. J. McMillan 2017, "The mass distribution and gravitational potential of the Milky Way", MNRAS 465, 76', doi: '10.1093/mnras/stw2759', arxiv: '1608.00971' },
  eilers19: { cite: 'A.-C. Eilers, D. W. Hogg, H.-W. Rix, M. K. Ness 2019, "The circular velocity curve of the Milky Way from 5 to 25 kpc", ApJ 871, 120', doi: '10.3847/1538-4357/aaf648', arxiv: '1810.09466' },
  jiao23: { cite: 'Y. Jiao, F. Hammer, H. Wang et al. 2023, "Detection of the Keplerian decline in the Milky Way rotation curve", A&A 678, A208', doi: '10.1051/0004-6361/202347513', arxiv: '2309.00048' },
  planck18: { cite: 'Planck Collaboration 2020, "Planck 2018 results. VI. Cosmological parameters", A&A 641, A6', doi: '10.1051/0004-6361/201833910', arxiv: '1807.06209' },
  read14: { cite: 'J. I. Read 2014, "The local dark matter density", J. Phys. G 41, 063101', doi: '10.1088/0954-3899/41/6/063101', arxiv: '1404.1938' },
  wang20: { cite: 'W. Wang, J. Han, M. Cautun, Z. Li, M. N. Ishigaki 2020, "The mass of our Milky Way", Sci. China Phys. Mech. Astron.', doi: '10.1007/s11433-019-1541-6', arxiv: '1912.02599' },
  zwicky33: { cite: 'F. Zwicky 1933, "Die Rotverschiebung von extragalaktischen Nebeln", Helv. Phys. Acta; English republication: "The redshift of extragalactic nebulae", Gen. Relativ. Gravit. 41, 207-224 (2009)', doi: '10.1007/s10714-008-0707-4', arxiv: null },
  zwicky37: { cite: 'F. Zwicky 1937, "On the masses of nebulae and of clusters of nebulae", ApJ 86, 217', doi: '10.1086/143864', arxiv: null },
  rubin70: { cite: 'V. C. Rubin, W. K. Ford 1970, "Rotation of the Andromeda Nebula from a spectroscopic survey of emission regions", ApJ 159, 379', doi: '10.1086/150317', arxiv: null },
  bosma81a: { cite: 'A. Bosma 1981, "21-cm line studies of spiral galaxies. I. Observations of the galaxies NGC 5033, 3198, 5055, 2841, and 7331", AJ 86, 1791', doi: '10.1086/113062', arxiv: null },
  bosma81b: { cite: 'A. Bosma 1981, "21-cm line studies of spiral galaxies. II. The distribution and kinematics of neutral hydrogen in spiral galaxies of various morphological types", AJ 86, 1825', doi: '10.1086/113063', arxiv: null },
});

export const srcUrl = id => SOURCES[id].doi ? `https://doi.org/${SOURCES[id].doi}` : `https://arxiv.org/abs/${SOURCES[id].arxiv}`;

// Eilers et al. 2019, Table 1 (tab:measurements): R kpc, v_c km/s, lower
// error, upper error. Formal errors only; the paper gives a 2-5 %
// systematic on top. R0 = 8.122 kpc in that paper.
export const EILERS19 = Object.freeze({
  src: 'eilers19', r0: 8.122, label: 'Eilers et al. 2019 (APOGEE + Gaia red giants)',
  errors: 'formal (bootstrap) only; systematics 2-5 %',
  rows: [
    [5.27, 226.83, 1.91, 1.90], [5.74, 230.80, 1.43, 1.35], [6.23, 231.20, 1.70, 1.10],
    [6.73, 229.88, 1.44, 1.32], [7.22, 229.61, 1.37, 1.11], [7.82, 229.91, 0.92, 0.88],
    [8.19, 228.86, 0.80, 0.67], [8.78, 226.50, 1.07, 0.95], [9.27, 226.20, 0.72, 0.62],
    [9.76, 225.94, 0.42, 0.52], [10.26, 225.68, 0.44, 0.40], [10.75, 224.73, 0.38, 0.41],
    [11.25, 224.02, 0.33, 0.54], [11.75, 223.86, 0.40, 0.39], [12.25, 222.23, 0.51, 0.37],
    [12.74, 220.77, 0.54, 0.46], [13.23, 220.92, 0.57, 0.40], [13.74, 217.47, 0.64, 0.51],
    [14.24, 217.31, 0.77, 0.66], [14.74, 217.60, 0.65, 0.68], [15.22, 217.07, 1.06, 0.80],
    [15.74, 217.38, 0.84, 1.07], [16.24, 216.14, 1.20, 1.48], [16.74, 212.52, 1.39, 1.43],
    [17.25, 216.41, 1.44, 1.85], [17.75, 213.70, 2.22, 1.65], [18.24, 207.89, 1.76, 1.88],
    [18.74, 209.60, 2.31, 2.77], [19.22, 206.45, 2.54, 2.36], [19.71, 201.91, 2.99, 2.26],
    [20.27, 199.84, 3.15, 2.89], [20.78, 198.14, 3.33, 3.37], [21.24, 195.30, 5.99, 6.50],
    [21.80, 213.67, 15.38, 12.18], [22.14, 176.97, 28.58, 18.57], [22.73, 193.11, 27.64, 19.05],
    [23.66, 176.63, 18.67, 16.74], [24.82, 198.42, 6.50, 6.12],
  ].map(([R, v, lo, hi]) => Object.freeze({ R, v, lo, hi })),
});

// Jiao et al. 2023, Table 1 (tab:rc_z3): R kpc, V_c km/s, sigma (with
// systematics). Gaia DR3 stars within |z| < 3 kpc. R0 = 8.34 kpc.
export const JIAO23 = Object.freeze({
  src: 'jiao23', r0: 8.34, label: 'Jiao et al. 2023 (Gaia DR3)',
  errors: 'include systematics',
  rows: [
    [9.5, 221.75, 3.17], [10.5, 223.32, 3.02], [11.5, 220.72, 3.47], [12.5, 222.92, 3.19],
    [13.5, 224.16, 3.48], [14.5, 221.60, 4.20], [15.5, 218.79, 4.75], [16.5, 216.38, 4.96],
    [17.5, 213.48, 6.13], [18.5, 209.17, 4.42], [19.5, 206.25, 4.63], [20.5, 202.54, 4.40],
    [21.5, 197.56, 4.62], [22.5, 197.00, 3.81], [23.5, 191.62, 12.95], [24.5, 187.12, 8.06],
    [25.5, 181.44, 19.58], [26.5, 175.68, 24.68],
  ].map(([R, v, s]) => Object.freeze({ R, v, lo: s, hi: s })),
});

// Published values that the page compares. Each has its own definition:
// "total" and "halo virial" masses are not the same quantity.
export const ESTIMATES = Object.freeze({
  localGeV: [
    { src: 'eilers19', v: 0.30, err: 0.03, note: 'from the rotation curve and baryon models' },
    { src: 'mcmillan17', v: 0.38, err: null, note: 'best-fit NFW mass model (0.0101 Msun/pc^3)' },
  ],
  vSun: [
    { src: 'eilers19', v: 229.0, err: 0.2, r0: 8.122, note: 'formal error; systematics 2-5 %' },
    { src: 'mcmillan17', v: 233.1, err: null, r0: 8.21, note: 'best-fit model' },
  ],
  slope: [
    { src: 'eilers19', v: -1.7, err: 0.1, note: 'km/s per kpc, 5-25 kpc; systematic 0.46' },
    { src: 'jiao23', v: -2.18, err: 0.23, note: 'km/s per kpc, linear fit to their curve' },
  ],
  mass: [
    { src: 'jiao23', v: 2.06e11, lo: 0.13e11, hi: 0.24e11, kind: 'total (dark + visible)', note: 'Keplerian decline beyond about 19 kpc' },
    { src: 'jiao23', v: 5.4e11, lo: null, hi: null, kind: 'upper limit, total', note: 'from the upper values of the velocities' },
    { src: 'eilers19', v: 7.25e11, lo: 0.26e11, hi: 0.26e11, kind: 'dark halo, virial', note: "NFW halo fit to 5-25 kpc, baryons fixed (abstract: +/- 0.26; text: +/- 0.25)" },
    { src: 'mcmillan17', v: 1.37e12, lo: null, hi: null, kind: 'total, virial', note: 'best-fit model' },
  ],
  stars: { src: 'mcmillan17', v: 5.43e10 },
  jiaoDrop: { src: 'jiao23', from: 19.5, to: 26.5, dv: 30, gamma: -0.47, gammaErr: 0.15, sigma: 3 },
});

// Planck 2018, abstract (TT,TE,EE+lowE+lensing): physical densities of cold
// dark matter and of baryons. The dark share of all matter follows.
export const PLANCK18 = Object.freeze({ src: 'planck18', omch2: 0.120, ombh2: 0.0224, omegaM: 0.315 });
export const cosmicDarkFraction = () => PLANCK18.omch2 / (PLANCK18.omch2 + PLANCK18.ombh2);

// History. Text is ours; each entry cites what was fetched.
export const HISTORY = Object.freeze([
  { year: 1933, who: 'Fritz Zwicky', what: 'The galaxies of the Coma cluster move much faster than the visible mass of the cluster can hold together. Zwicky concluded that the cluster must contain far more unseen matter than visible matter.', src: ['zwicky33'] },
  { year: 1937, who: 'Fritz Zwicky', what: 'A longer English paper on the masses of galaxies and of clusters, with the cluster argument in full.', src: ['zwicky37'] },
  { year: 1970, who: 'Vera Rubin and Kent Ford', what: 'Spectra of glowing gas clouds across the Andromeda galaxy gave its rotation far out into the disc. The speeds did not fall off as the starlight did.', src: ['rubin70'] },
  { year: 1981, who: 'Albert Bosma', what: 'Radio maps of the 21 cm line of neutral hydrogen traced rotation well past the edge of the starlight in many spirals. The curves stayed flat there, where almost no stars are left.', src: ['bosma81a', 'bosma81b'] },
  { year: 2017, who: 'Paul McMillan', what: 'A full mass model of the Milky Way: bulge, two stellar discs, two gas discs and an NFW halo, fit to many data sets. This page uses it as the base model.', src: ['mcmillan17'] },
  { year: 2019, who: 'Anna-Christina Eilers and others', what: 'Precise speeds of about 23,000 red giant stars give the rotation curve from 5 to 25 kpc. It falls gently, by 1.7 km/s per kpc.', src: ['eilers19'] },
  { year: 2023, who: 'Yongjun Jiao and others', what: 'With Gaia DR3 the curve falls faster beyond about 19 kpc, close to the Keplerian law. The total mass comes out near 2 x 10^11 Msun, several times less than earlier models.', src: ['jiao23'] },
]);

// How the dark matter of the Milky Way is measured.
export const METHODS = Object.freeze([
  { id: 'rc', title: 'Rotation curves', range: 'about 5 to 27 kpc', src: ['eilers19', 'jiao23'],
    text: 'Measure the speed of stars or gas on near-circular orbits at each radius. The speed gives the pull toward the centre, and so the mass inside that radius. Inside 5 kpc the bar stirs the orbits and the method needs a non-axisymmetric model.' },
  { id: 'local', title: 'Vertical motions near the Sun', range: 'a few hundred pc around the Sun', src: ['read14'],
    text: 'Stars bob up and down through the disc. How high they get for their speed gives the total density of matter near the Sun. Subtract the stars and gas that are seen, and what is left is the local dark matter density.' },
  { id: 'far', title: 'Satellites, clusters and streams', range: 'tens to hundreds of kpc', src: ['wang20'],
    text: 'Far out there are no orbits in a disc. Halo stars, globular clusters, satellite galaxies and the tidal streams of torn-apart clusters move in the full potential. Their speeds and paths give the mass out to the edge of the halo, with model assumptions that set most of the error.' },
]);

// The slip in a widely shared short video (checked by the coordinator from
// the video's own numbers). Kept as text, not as data for the plots.
export const VIDEO_NOTE = 'A widely shared short video says that the disc and the bulge together give 168 km/s at the Sun. With that video\'s own numbers, 168 km/s is the disc alone; the disc and the bulge together give 192 km/s. Speeds of parts add as squares, not as plain numbers.';
