// ============================================================================
//  OCTANE NUMBER  ·  data.js — measured values and their sources (no DOM)
// ----------------------------------------------------------------------------
//  FUELS   one row per fuel molecule: the record id in data/fuels.json, the
//          research and motor octane numbers (RON, MON; null when the
//          table gives none) and a family for the colour.
//          Values: the pure-compound table of the Wikipedia article
//          "Octane rating" (raw wikitext read 2026-10-23). Most rows of
//          that table go back to API Research Project 45. Values below 0
//          or above 100 are measured in blends and extrapolated: the test
//          engine cannot rate them directly.
//  CFR     the two standard test conditions (ASTM D2699 RON, D2700 MON).
//  PUMPS   what the pump sign means in different markets.
//  BDE     C-H bond dissociation energies (Blanksby and Ellison 2003).
//  SOURCES citation, DOI or URL.  HISTORY  dated events with sources.
//
//  grep -n targets: "export const FUELS", "export const CFR",
//  "export const PUMPS", "export const BDE", "export const SOURCES",
//  "export const HISTORY"
// ============================================================================

// fam: alkane (straight), branched, aromatic, alcohol, gas
export const FUELS = [
  { id: 'octane', name: 'n-Octane', ron: -20, mon: -17, fam: 'straight', note: 'Rated in blends: below zero.' },
  { id: 'heptane', name: 'n-Heptane', ron: 0, mon: 0, fam: 'straight', note: 'Zero by definition.' },
  { id: '2-methylheptane', name: '2-Methylheptane', ron: 23, mon: 23.8, fam: 'branched' },
  { id: 'hexane', name: 'n-Hexane', ron: 25, mon: 26.0, fam: 'straight' },
  { id: '2-methylhexane', name: '2-Methylhexane', ron: 44, mon: 46.4, fam: 'branched' },
  { id: 'pentane', name: 'n-Pentane', ron: 62, mon: 61.9, fam: 'straight' },
  { id: 'butane', name: 'n-Butane', ron: 94, mon: 90.1, fam: 'straight' },
  { id: 'isooctane', name: 'Iso-octane', ron: 100, mon: 100, fam: 'branched', note: '100 by definition. IUPAC: 2,2,4-trimethylpentane.' },
  { id: 'benzene', name: 'Benzene', ron: 101, mon: null, fam: 'aromatic', note: 'Limited in gasoline (carcinogen).' },
  { id: 'isobutane', name: 'Isobutane', ron: 102, mon: 97.6, fam: 'branched' },
  { id: '2,3,3-trimethylpentane', name: '2,3,3-Trimethylpentane', ron: 106.1, mon: 99.4, fam: 'branched' },
  { id: 'ethanol', name: 'Ethanol', ron: 108.6, mon: 89.7, fam: 'alcohol' },
  { id: 'methanol', name: 'Methanol', ron: 108.7, mon: 88.6, fam: 'alcohol' },
  { id: 'propane', name: 'Propane', ron: 112, mon: 97, fam: 'gas' },
  { id: 'ethylbenzene', name: 'Ethylbenzene', ron: 112, mon: 99, fam: 'aromatic' },
  { id: 'p-xylene', name: 'Xylene', ron: 118, mon: 115, fam: 'aromatic', note: 'Value for xylene (isomers not split); p-xylene shown.' },
  { id: 'methane', name: 'Methane', ron: 120, mon: 120, fam: 'gas' },
  { id: 'toluene', name: 'Toluene', ron: 121, mon: 107, fam: 'aromatic' },
];
export const FAMILY = {
  straight: { name: 'Straight-chain alkane', color: '#ff7a59' },
  branched: { name: 'Branched alkane', color: '#62c4ff' },
  aromatic: { name: 'Aromatic', color: '#e889dc' },
  alcohol: { name: 'Alcohol', color: '#86dc7c' },
  gas: { name: 'Light gas', color: '#ffd666' },
};
// The four C8H18 isomers on the page: one formula, 126 octane points.
export const ISOMERS_C8 = ['octane', '2-methylheptane', 'isooctane', '2,3,3-trimethylpentane'];

// Standard test conditions in the CFR engine (single cylinder, variable
// compression ratio, 3.25 in bore, 4.5 in stroke).
export const CFR = {
  ron: { name: 'Research (RON)', std: 'ASTM D2699', rpm: 600, intake: '52 °C intake air', spark: '13° before top centre, fixed', Tin: 325 },
  mon: { name: 'Motor (MON)', std: 'ASTM D2700', rpm: 900, intake: '149 °C mixture', spark: '14-26° before top centre, set by the compression ratio', Tin: 422 },
};

// What the sign on the pump means.
export const PUMPS = [
  { where: 'United States, Canada, Mexico', index: '(R+M)/2, the anti-knock index', grades: 'about 87 / 89-90 / 91-94', ron: '91-92 / 94-95 / 96-98' },
  { where: 'Europe, UK', index: 'RON', grades: '95 / 98, some 100', ron: '95 / 98 / 100' },
  { where: 'Australia, New Zealand', index: 'RON', grades: '91 / 95 / 98', ron: '91 / 95 / 98' },
  { where: 'Japan', index: 'RON', grades: 'about 90 regular, 96 or more premium', ron: '90 / 96-100' },
];
// Typical market gasolines (same table as FUELS): RON, MON.
export const GASOLINES = [
  { name: 'US regular, 87 on the pump', ron: 91.5, mon: 82.5 },
  { name: 'US premium (E10), 91-93 on the pump', ron: 97, mon: 87.5 },
  { name: 'Euro 95 (E10)', ron: 95, mon: 85 },
  { name: 'E85', ron: 103.5, mon: 86 },
];

// C-H bond dissociation energies at 298 K, kJ/mol (Blanksby and Ellison
// 2003, Table 1): ethane (primary), propane C2 (secondary), isobutane C2
// (tertiary), benzene (aromatic C-H). Paper values in kcal/mol: 101.1,
// 98.6, 96.5, 112.9; times 4.184.
export const BDE = { primary: 423.0, secondary: 412.5, tertiary: 403.8, aromatic: 472.4 };

export const SOURCES = {
  wiki: { cite: 'Octane rating, table of pure compounds and market fuels. Wikipedia, read 2026-10-23 (values largely from API Research Project 45)', url: 'https://en.wikipedia.org/wiki/Octane_rating' },
  astm2699: { cite: 'ASTM D2699, Standard Test Method for Research Octane Number of Spark-Ignition Engine Fuel', url: 'https://store.astm.org/d2699-25.html' },
  astm2700: { cite: 'ASTM D2700, Standard Test Method for Motor Octane Number of Spark-Ignition Engine Fuel', url: 'https://store.astm.org/d2700-26b.html' },
  douaud78: { cite: 'Douaud, A. M., Eyzat, P. (1978). Four-octane-number method for predicting the anti-knock behavior of fuels and engines. SAE Technical Paper 780080', doi: '10.4271/780080' },
  livengood55: { cite: 'Livengood, J. C., Wu, P. C. (1955). Correlation of autoignition phenomena in internal combustion engines and rapid compression machines. Symposium (International) on Combustion 5, 347-356', doi: '10.1016/S0082-0784(55)80047-1' },
  heywood: { cite: 'Heywood, J. B. (2018). Internal Combustion Engine Fundamentals, 2nd ed., ch. 10 (knock; the Douaud-Eyzat delay correlation). McGraw-Hill' },
  mckenzie16: { cite: 'McKenzie, J., Cheng, W. K. (2016). The anatomy of knock. SAE Technical Paper 2016-01-0704', doi: '10.4271/2016-01-0704' },
  kalghatgi01: { cite: 'Kalghatgi, G. T. (2001). Fuel anti-knock quality - Part I. Engine studies. SAE Technical Paper 2001-01-3584', doi: '10.4271/2001-01-3584' },
  curran98: { cite: 'Curran, H. J., Gaffuri, P., Pitz, W. J., Westbrook, C. K. (1998). A comprehensive modeling study of n-heptane oxidation. Combustion and Flame 114, 149-177', doi: '10.1016/S0010-2180(97)00282-4' },
  curran02: { cite: 'Curran, H. J., Gaffuri, P., Pitz, W. J., Westbrook, C. K. (2002). A comprehensive modeling study of iso-octane oxidation. Combustion and Flame 129, 253-280', doi: '10.1016/S0010-2180(01)00373-X' },
  westbrook00: { cite: 'Westbrook, C. K. (2000). Chemical kinetics of hydrocarbon ignition in practical combustion systems. Proceedings of the Combustion Institute 28, 1563-1577', doi: '10.1016/S0082-0784(00)80554-8' },
  blanksby03: { cite: 'Blanksby, S. J., Ellison, G. B. (2003). Bond dissociation energies of organic molecules. Accounts of Chemical Research 36, 255-263', doi: '10.1021/ar020230d' },
  pubchem: { cite: 'PubChem (NCBI). Structures and 3D conformers of the fuel molecules, public domain', url: 'https://pubchem.ncbi.nlm.nih.gov/' },
  unep21: { cite: 'UN Environment Programme (2021). Era of leaded petrol over, eliminating a major threat to human and planetary health. Press release, 30 August 2021', url: 'https://www.unep.org/news-and-stories/press-release/era-leaded-petrol-over-eliminating-major-threat-human-and-planetary' },
};

export const HISTORY = [
  { year: '1921', who: 'Tetraethyl lead', what: 'Thomas Midgley Jr. and colleagues at General Motors find that a little tetraethyl lead stops knock. Leaded gasoline follows in 1923; the lead in the air and in children\'s blood becomes one of the great public health harms of the century.', src: ['unep21'] },
  { year: '1927', who: 'The octane scale', what: 'Graham Edgar proposes n-heptane and iso-octane as the two reference fuels. A gasoline gets the number of the blend that knocks the same way.', src: ['wiki'] },
  { year: '1930s', who: 'The CFR engine', what: 'The Cooperative Fuel Research committee standardises a single-cylinder test engine with a compression ratio that can change while it runs. The Research and Motor methods (ASTM D2699 and D2700) still use it.', src: ['astm2699', 'astm2700'] },
  { year: '1955', who: 'Livengood and Wu', what: 'Show that knock arrives when the end gas has used up its ignition delay, added over the changing pressure and temperature of the cycle: the integral on this page.', src: ['livengood55'] },
  { year: '1978', who: 'Douaud and Eyzat', what: 'Fit the ignition delay of the reference blends to octane number, pressure and temperature: the correlation that drives the cylinder on this page.', src: ['douaud78'] },
  { year: '2021', who: 'End of leaded petrol', what: 'Algeria, the last country to sell leaded petrol for cars, stops. Octane now comes from refining (branched and aromatic molecules) and from ethanol.', src: ['unep21'] },
];
