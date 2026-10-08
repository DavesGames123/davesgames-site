// ============================================================================
//  OUTBREAK  ·  diseases.js — the disease presets and the custom editor (no DOM)
// ----------------------------------------------------------------------------
//  Each preset is a natural disease with approximate, illustrative values for
//  a toy metapopulation model. The values are not a forecast. `ranges` gives
//  the span that the cited sources support, and every preset value is in its
//  span (tests/diseases.test.mjs). Units: periods in days, rates per day,
//  ifr = fraction of infections that end in death.
//
//  Fields (CONTRACT.md, "diseases.js"):
//    route        'resp' | 'contact' | 'vector' | 'water' | 'flea'
//    R0           basic reproduction number. For vector, water and flea
//                 routes, R0 is at climate and sanitation factor 1.
//    latent       days in E (0 = SIR), infectious = days in I
//    ifr          fatality per infection. careSensitive: the model applies
//                 ifr x INCOME_IFR[income], use ifrFor(disease, income).
//    waning       days of immunity, 0 = lifelong
//    seasonality  0..1, peak in the local winter (vector: warm season)
//    climate      'none' | 'tropical' | 'warm'
//    detect       0..1, the share of transmission that testing and isolation
//                 can reach (high when people are sick before they spread it)
//    travel       0..1, the share of infectious people who still travel
//    immune0      fraction immune at day 0 (0 = no prior immunity)
//    vaccine      null, or { exists, lagDays, efficacy }. exists false with
//                 lagDays > 0 = a vaccine still in development.
//
//  Sources (SOURCES below, index = refs): Biggerstaff et al. 2014; Carrat et
//  al. 2008; Mills, Robins and Lipsitch 2004; Taubenberger and Morens 2006;
//  Guerra et al. 2017; WHO measles fact sheet; Liu et al. 2020; Brazeau et
//  al. 2020; Liu and Rocklov 2021; Riley et al. 2003; Lipsitch et al. 2003;
//  WHO SARS summary 2003; WHO Ebola Response Team 2014; Mukandavire et al.
//  2011; Codeco 2001; Favier et al. 2006; WHO dengue fact sheet; Smith et al.
//  2007; WHO World Malaria Report 2023; Dean et al. 2018; WHO plague fact
//  sheet; Lauer et al. 2020; Uyeki et al. 2016.
//
//  grep -n targets: "export const SOURCES", "export const INCOME_IFR",
//    "export const SCHEMA", "const BASE", "export const PRESETS",
//    "export function getDisease", "export function customDisease",
//    "export function ifrFor"
// ============================================================================

export const SOURCES = [
  /* 0 */ { ref: 'Biggerstaff M, Cauchemez S, Reed C, Gambhir M, Finelli L 2014. Estimates of the reproduction number for seasonal, pandemic, and zoonotic influenza: a systematic review of the literature. BMC Infect Dis 14:480.',
    url: 'https://doi.org/10.1186/1471-2334-14-480',
    note: 'Seasonal influenza median R 1.28 (IQR 1.19-1.37); 1918 pandemic median R 1.80 (IQR 1.47-2.27).' },
  /* 1 */ { ref: 'Carrat F, Vergu E, Ferguson NM, et al. 2008. Time lines of infection and disease in human influenza: a review of volunteer challenge studies. Am J Epidemiol 167(7):775-785.',
    url: 'https://doi.org/10.1093/aje/kwm375',
    note: 'Viral shedding peaks about 2 days after inoculation and lasts about 4-5 days.' },
  /* 2 */ { ref: 'Mills CE, Robins JM, Lipsitch M 2004. Transmissibility of 1918 pandemic influenza. Nature 432:904-906.',
    url: 'https://doi.org/10.1038/nature03063',
    note: 'R of 1918 influenza in 45 US cities: median R less than 3; median R0 less than 4 after prior immunity.' },
  /* 3 */ { ref: 'Taubenberger JK, Morens DM 2006. 1918 influenza: the mother of all pandemics. Emerg Infect Dis 12(1):15-22.',
    url: 'https://doi.org/10.3201/eid1201.050979',
    note: 'Case fatality above 2.5 %, against under 0.1 % in other influenza pandemics.' },
  /* 4 */ { ref: 'Guerra FM, Bolotin S, Lim G, et al. 2017. The basic reproduction number (R0) of measles: a systematic review. Lancet Infect Dis 17(12):e420-e428.',
    url: 'https://doi.org/10.1016/S1473-3099(17)30307-9',
    note: 'The often quoted R0 of measles is 12-18; published estimates vary widely.' },
  /* 5 */ { ref: 'World Health Organization. Measles fact sheet.',
    url: 'https://www.who.int/news-room/fact-sheets/detail/measles',
    note: 'Incubation about 10-14 days; infectious from 4 days before to 4 days after the rash; deaths mostly in low-income settings; two vaccine doses about 97 % effective.' },
  /* 6 */ { ref: 'Liu Y, Gayle AA, Wilder-Smith A, Rocklov J 2020. The reproductive number of COVID-19 is higher compared to SARS coronavirus. J Travel Med 27(2):taaa021.',
    url: 'https://doi.org/10.1093/jtm/taaa021',
    note: 'Ancestral SARS-CoV-2 R0: mean 3.28, median 2.79 (IQR 1.16).' },
  /* 7 */ { ref: 'Brazeau N, Verity R, Jenks S, et al. 2020. Report 34: COVID-19 infection fatality ratio estimates from seroprevalence. Imperial College London.',
    url: 'https://doi.org/10.25561/83545',
    note: 'IFR depends strongly on age; population IFR about 0.2 % (young, low-income) to above 1 % (old, high-income).' },
  /* 8 */ { ref: 'Liu Y, Rocklov J 2021. The reproductive number of the Delta variant of SARS-CoV-2 is far higher compared to the ancestral SARS-CoV-2 virus. J Travel Med 28(7):taab124.',
    url: 'https://doi.org/10.1093/jtm/taab124',
    note: 'Delta R0: mean 5.08, range 3.2-8.' },
  /* 9 */ { ref: 'Riley S, Fraser C, Donnelly CA, et al. 2003. Transmission dynamics of the etiological agent of SARS in Hong Kong: impact of public health interventions. Science 300:1961-1966.',
    url: 'https://doi.org/10.1126/science.1086478',
    note: 'R about 2.7 before control; incubation mean 6.4 days.' },
  /* 10 */ { ref: 'Lipsitch M, Cohen T, Cooper B, et al. 2003. Transmission dynamics and control of severe acute respiratory syndrome. Science 300:1966-1970.',
    url: 'https://doi.org/10.1126/science.1086616',
    note: 'R about 3 in Singapore without superspreading control; isolation of symptomatic cases controls SARS.' },
  /* 11 */ { ref: 'World Health Organization 2003. Summary of probable SARS cases with onset of illness from 1 November 2002 to 31 July 2003.',
    url: 'https://www.who.int/publications/m/item/summary-of-probable-sars-cases-with-onset-of-illness-from-1-november-2002-to-31-july-2003',
    note: '8096 probable cases and 774 deaths (9.6 %).' },
  /* 12 */ { ref: 'WHO Ebola Response Team 2014. Ebola virus disease in West Africa: the first 9 months of the epidemic and forward projections. N Engl J Med 371:1481-1495.',
    url: 'https://doi.org/10.1056/NEJMoa1411100',
    note: 'R0 1.71-2.02 by country; incubation mean 11.4 days; case fatality 70.8 % in cases with a known outcome.' },
  /* 13 */ { ref: 'Mukandavire Z, Liao S, Wang J, et al. 2011. Estimating the reproductive numbers for the 2008-2009 cholera outbreaks in Zimbabwe. PNAS 108(21):8767-8772.',
    url: 'https://doi.org/10.1073/pnas.1019712108',
    note: 'R0 by province about 1.1-2.7, with both water and person-to-person paths.' },
  /* 14 */ { ref: 'Codeco CT 2001. Endemic and epidemic dynamics of cholera: the role of the aquatic reservoir. BMC Infect Dis 1:1.',
    url: 'https://doi.org/10.1186/1471-2334-1-1',
    note: 'SIR model with an aquatic reservoir; the source of the water route form.' },
  /* 15 */ { ref: 'Favier C, Degallier N, Rosa-Freitas MG, et al. 2006. Early determination of the reproductive number for vector-borne diseases: the case of dengue in Brazil. Trop Med Int Health 11(3):332-340.',
    url: 'https://doi.org/10.1111/j.1365-3156.2006.01560.x',
    note: 'A method to estimate dengue R0 early in Brazilian outbreaks (the abstract gives no values; the preset R0 is illustrative).' },
  /* 16 */ { ref: 'World Health Organization. Dengue and severe dengue fact sheet.',
    url: 'https://www.who.int/news-room/fact-sheets/detail/dengue-and-severe-dengue',
    note: 'Most infections are mild or without symptoms; incubation 4-10 days; deaths are rare with good care.' },
  /* 17 */ { ref: 'Smith DL, McKenzie FE, Snow RW, Hay SI 2007. Revisiting the basic reproductive number for malaria and its implications for malaria control. PLoS Biol 5(3):e42.',
    url: 'https://doi.org/10.1371/journal.pbio.0050042',
    note: 'Malaria R0 ranges from about 1 to more than 1000 between places; untreated infections last months.' },
  /* 18 */ { ref: 'World Health Organization 2023. World Malaria Report 2023.',
    url: 'https://www.who.int/teams/global-malaria-programme/reports/world-malaria-report-2023',
    note: 'About 249 million cases and 608 000 deaths in 2022 (about 0.25 % of cases); RTS,S and R21 vaccines.' },
  /* 19 */ { ref: 'Dean KR, Krauer F, Walloe L, et al. 2018. Human ectoparasites and the spread of plague in Europe during the Second Pandemic. PNAS 115(6):1304-1309.',
    url: 'https://doi.org/10.1073/pnas.1715640115',
    note: 'A human flea and louse model fits Black Death mortality better than rat or pneumonic models.' },
  /* 20 */ { ref: 'World Health Organization. Plague fact sheet.',
    url: 'https://www.who.int/news-room/fact-sheets/detail/plague',
    note: 'Incubation 1-7 days; untreated bubonic plague case fatality 30-60 %; antibiotics cure most cases.' },
  /* 21 */ { ref: 'Lauer SA, Grantz KH, Bi Q, et al. 2020. The incubation period of coronavirus disease 2019 (COVID-19) from publicly reported confirmed cases. Ann Intern Med 172(9):577-582.',
    url: 'https://doi.org/10.7326/M20-0504',
    note: 'COVID-19 incubation median 5.1 days.' },
  /* 22 */ { ref: 'Uyeki TM, Mehta AK, Davey RT, et al. 2016. Clinical management of Ebola virus disease in the United States and Europe. N Engl J Med 374:636-646.',
    url: 'https://doi.org/10.1056/NEJMoa1504874',
    note: 'Case fatality 18.5 % in patients with intensive care in the United States and Europe.' },
  /* 23 */ { ref: 'Donnelly CA, Ghani AC, Leung GM, et al. 2003. Epidemiological determinants of spread of causal agent of severe acute respiratory syndrome in Hong Kong. Lancet 361:1761-1766.',
    url: 'https://doi.org/10.1016/S0140-6736(03)13410-1',
    note: 'SARS case fatality in Hong Kong: 13.2 % under 60 years, 43.3 % at 60 or more.' },
  /* 24 */ { ref: 'He X, Lau EHY, Wu P, et al. 2020. Temporal dynamics in viral shedding and transmissibility of COVID-19. Nat Med 26:672-675.',
    url: 'https://doi.org/10.1038/s41591-020-0869-5',
    note: 'About 44 % of transmission happens before symptoms; infectiousness starts about 2-3 days before them.' },
  /* 25 */ { ref: 'Gani R, Leach S 2004. Epidemiologic determinants for modeling pneumonic plague outbreaks. Emerg Infect Dis 10(4):608-614.',
    url: 'https://doi.org/10.3201/eid1004.030509',
    note: 'Pneumonic plague R0 about 1.3, latent 4.3 days, infectious 2.5 days. The flea-borne preset R0 of 1.8 is illustrative.' },
];

// IFR factor by node income (1 high .. 5 low) for careSensitive diseases.
// Index 0 is not used. Illustrative: it shows the access to care, not data.
export const INCOME_IFR = [1, 1, 1.2, 1.5, 2, 2.5];

// Fatality per infection in a node of this income, at most 0.95.
export function ifrFor(disease, income) {
  const f = disease && disease.careSensitive ? (INCOME_IFR[Math.round(income)] ?? INCOME_IFR[3]) : 1;
  return Math.min(0.95, Math.max(0, (+(disease && disease.ifr) || 0) * f));
}

// The custom editor sliders. customDisease clamps each key to [min, max].
export const SCHEMA = [
  { key: 'R0', label: 'R₀', min: 0.5, max: 20, step: 0.1, unit: '' },
  { key: 'latent', label: 'Latent period', min: 0, max: 30, step: 0.5, unit: 'd' },
  { key: 'infectious', label: 'Infectious period', min: 1, max: 120, step: 1, unit: 'd' },
  { key: 'ifr', label: 'Fatality (IFR)', min: 0, max: 0.6, step: 0.0005, unit: '' },
  { key: 'waning', label: 'Immunity (0 = lifelong)', min: 0, max: 1500, step: 10, unit: 'd' },
  { key: 'seasonality', label: 'Seasonality', min: 0, max: 1, step: 0.05, unit: '' },
  { key: 'detect', label: 'Detectability', min: 0, max: 1, step: 0.05, unit: '' },
  { key: 'travel', label: 'Sick people travel', min: 0, max: 1, step: 0.05, unit: '' },
  { key: 'immune0', label: 'Immune at start', min: 0, max: 0.9, step: 0.05, unit: '' },
];

export const ROUTES = ['resp', 'contact', 'vector', 'water', 'flea'];
export const CLIMATES = ['none', 'tropical', 'warm'];

// Presets in display order. ranges = the span from the sources; the preset
// value is a round number inside that span.
const BASE = [
  { id: 'flu-seasonal', name: 'Seasonal influenza', short: 'Flu', route: 'resp',
    R0: 1.3, latent: 2, infectious: 3, ifr: 0.0005, careSensitive: false, waning: 730,
    seasonality: 0.35, climate: 'none', detect: 0.2, travel: 0.8, immune0: 0,
    vaccine: { exists: true, lagDays: 0, efficacy: 0.45 },
    blurb: 'A yearly respiratory virus with a low R0. It spreads in the winter of each hemisphere, and immunity fades in about two years.',
    ranges: { R0: [1.19, 1.37], latent: [1, 3], infectious: [2, 5], ifr: [0.0001, 0.001], waning: [365, 1095] },
    refs: [0, 1] },
  { id: 'flu-1918', name: '1918 pandemic influenza', short: '1918 flu', route: 'resp',
    R0: 2.0, latent: 2, infectious: 4, ifr: 0.02, careSensitive: false, waning: 0,
    seasonality: 0.2, climate: 'none', detect: 0.2, travel: 0.7, immune0: 0,
    vaccine: null,
    blurb: 'A new influenza strain in a population with no immunity. In 1918 it killed many young adults, and there was no vaccine.',
    ranges: { R0: [1.47, 3], latent: [1, 3], infectious: [3, 5], ifr: [0.01, 0.03], waning: [0, 0] },
    refs: [0, 2, 3] },
  { id: 'measles', name: 'Measles', short: 'Measles', route: 'resp',
    R0: 15, latent: 10, infectious: 8, ifr: 0.002, careSensitive: true, waning: 0,
    seasonality: 0.3, climate: 'none', detect: 0.4, travel: 0.6, immune0: 0,
    vaccine: { exists: true, lagDays: 0, efficacy: 0.97 },
    blurb: 'The most contagious common virus. This run starts with no prior immunity, so it shows why high vaccine coverage is necessary.',
    ranges: { R0: [12, 18], latent: [8, 12], infectious: [7, 9], ifr: [0.001, 0.003], waning: [0, 0] },
    refs: [4, 5] },
  { id: 'covid-ancestral', name: 'COVID-19 (2020 strain)', short: 'COVID-20', route: 'resp',
    R0: 2.8, latent: 3, infectious: 6, ifr: 0.006, careSensitive: false, waning: 0,
    seasonality: 0.2, climate: 'none', detect: 0.3, travel: 0.8, immune0: 0,
    vaccine: { exists: false, lagDays: 330, efficacy: 0.9 },
    blurb: 'A new coronavirus. Many people spread it before they have symptoms. A vaccine comes about 11 months after the vaccination policy starts.',
    ranges: { R0: [2.2, 3.9], latent: [2, 4], infectious: [5, 8], ifr: [0.002, 0.012], waning: [0, 0] },
    refs: [6, 7, 21, 24] },
  { id: 'covid-variant', name: 'COVID-19 (Delta-like variant)', short: 'Variant', route: 'resp',
    R0: 6, latent: 2.5, infectious: 5, ifr: 0.003, careSensitive: false, waning: 240,
    seasonality: 0.2, climate: 'none', detect: 0.3, travel: 0.8, immune0: 0,
    vaccine: { exists: true, lagDays: 0, efficacy: 0.6 },
    blurb: 'A more contagious variant. Immunity fades in months, so waves come back.',
    ranges: { R0: [3.2, 8], latent: [2, 4], infectious: [4, 7], ifr: [0.001, 0.006], waning: [180, 365] },
    refs: [8, 7] },
  { id: 'sars', name: 'SARS (2003)', short: 'SARS', route: 'resp',
    R0: 2.5, latent: 5, infectious: 10, ifr: 0.10, careSensitive: false, waning: 0,
    seasonality: 0.2, climate: 'none', detect: 0.9, travel: 0.5, immune0: 0,
    vaccine: null,
    blurb: 'A severe coronavirus. People spread it mostly after symptoms start, so isolation and contact tracing stopped it in 2003.',
    ranges: { R0: [2.2, 3.6], latent: [4, 7], infectious: [7, 14], ifr: [0.09, 0.15], waning: [0, 0] },
    refs: [9, 10, 11, 23] },
  { id: 'ebola', name: 'Ebola virus disease', short: 'Ebola', route: 'contact',
    R0: 1.8, latent: 10, infectious: 8, ifr: 0.3, careSensitive: true, waning: 0,
    seasonality: 0, climate: 'none', detect: 0.9, travel: 0.2, immune0: 0,
    vaccine: { exists: false, lagDays: 365, efficacy: 0.9 },
    blurb: 'Spread by close contact with sick people. It is very severe, and good care decreases the deaths. Isolation and safe burials control it.',
    ranges: { R0: [1.7, 2.1], latent: [8, 12], infectious: [6, 10], ifr: [0.18, 0.4], waning: [0, 0] },
    refs: [12, 22] },
  { id: 'cholera', name: 'Cholera', short: 'Cholera', route: 'water',
    R0: 2.5, latent: 1.5, infectious: 5, ifr: 0.01, careSensitive: true, waning: 1095,
    seasonality: 0.2, climate: 'none', detect: 0.4, travel: 0.4, immune0: 0,
    vaccine: { exists: true, lagDays: 0, efficacy: 0.6 },
    blurb: 'A bacterial infection from contaminated water. Clean water and sanitation decrease it, and oral rehydration prevents most deaths.',
    ranges: { R0: [1.1, 2.8], latent: [0.5, 5], infectious: [3, 10], ifr: [0.003, 0.02], waning: [730, 1825] },
    refs: [13, 14] },
  { id: 'dengue', name: 'Dengue', short: 'Dengue', route: 'vector',
    R0: 3, latent: 5, infectious: 5, ifr: 0.0005, careSensitive: true, waning: 0,
    seasonality: 0.5, climate: 'tropical', detect: 0.2, travel: 0.7, immune0: 0,
    vaccine: { exists: true, lagDays: 0, efficacy: 0.6 },
    blurb: 'A virus that Aedes mosquitoes carry. It spreads only where the mosquitoes live, mostly in the tropics and in the warm season.',
    ranges: { R0: [1.5, 6], latent: [4, 7], infectious: [4, 6], ifr: [0.0001, 0.001], waning: [0, 0] },
    refs: [15, 16] },
  { id: 'malaria', name: 'Malaria (falciparum)', short: 'Malaria', route: 'vector',
    R0: 3, latent: 12, infectious: 60, ifr: 0.003, careSensitive: true, waning: 365,
    seasonality: 0.5, climate: 'tropical', detect: 0.2, travel: 0.7, immune0: 0,
    vaccine: { exists: true, lagDays: 0, efficacy: 0.5 },
    blurb: 'A parasite that Anopheles mosquitoes carry. An infection lasts months. Partial immunity fades, so malaria stays endemic.',
    ranges: { R0: [1, 100], latent: [9, 14], infectious: [30, 200], ifr: [0.001, 0.005], waning: [180, 730] },
    refs: [17, 18] },
  { id: 'plague', name: 'Plague (historical)', short: 'Plague', route: 'flea',
    R0: 1.8, latent: 4, infectious: 10, ifr: 0.4, careSensitive: false, waning: 0,
    seasonality: 0.4, climate: 'warm', detect: 0.5, travel: 0.4, immune0: 0,
    vaccine: null,
    blurb: 'A bacterial disease that fleas and lice carry. This preset shows a plague without antibiotics, as in the historical pandemics.',
    ranges: { R0: [1.3, 3], latent: [1, 7], infectious: [5, 26], ifr: [0.3, 0.6], waning: [0, 0] },
    refs: [19, 20, 25] },
];

const schemaRanges = () => Object.fromEntries(SCHEMA.map(s => [s.key, [s.min, s.max]]));

// Every preset has illustrative: true. 'custom' is last: a copy of the
// 2020 COVID preset that the sliders edit.
export const PRESETS = deepFreeze([
  ...BASE.map(d => ({ ...d, illustrative: true })),
  { ...BASE.find(d => d.id === 'covid-ancestral'), id: 'custom', name: 'Custom', short: 'Custom',
    blurb: 'Your own disease. Start from a preset, then change the values with the sliders.',
    ranges: schemaRanges(), illustrative: true },
]);

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

// A plain deep copy (the presets hold only plain data).
const copy = d => JSON.parse(JSON.stringify(d));

// A copy of the preset with this id, or null.
export function getDisease(id) {
  const d = PRESETS.find(p => p.id === id);
  return d ? copy(d) : null;
}

const SCHEMA_BY_KEY = Object.fromEntries(SCHEMA.map(s => [s.key, s]));

// A copy of `base` (a Disease or a preset id) with `patch` applied. Schema
// keys are clamped to [min, max]; a value that is not a number keeps the
// base value. route and climate must be known names, careSensitive is a
// bool, vaccine is null or { exists, lagDays, efficacy } (clamped). Other
// keys are ignored. The result has id 'custom' and the schema ranges.
export function customDisease(base, patch = {}) {
  const b = typeof base === 'string' ? getDisease(base) : base;
  const d = copy(b || PRESETS.find(p => p.id === 'custom'));
  const p = patch || {};
  for (const s of SCHEMA) {
    if (!(s.key in p)) continue;
    const v = +p[s.key];
    if (Number.isFinite(v)) d[s.key] = Math.min(s.max, Math.max(s.min, v));
  }
  for (const s of SCHEMA) {   // a base value out of the schema is clamped too
    const v = +d[s.key];
    d[s.key] = Number.isFinite(v) ? Math.min(s.max, Math.max(s.min, v)) : SCHEMA_BY_KEY[s.key].min;
  }
  if (ROUTES.includes(p.route)) d.route = p.route;
  if (CLIMATES.includes(p.climate)) d.climate = p.climate;
  if (typeof p.careSensitive === 'boolean') d.careSensitive = p.careSensitive;
  if ('vaccine' in p) {
    const v = p.vaccine;
    d.vaccine = v && typeof v === 'object' ? {
      exists: v.exists !== false,
      lagDays: Math.max(0, +v.lagDays || 0),
      efficacy: Math.min(1, Math.max(0, Number.isFinite(+v.efficacy) ? +v.efficacy : 0.5)),
    } : null;
  }
  d.id = 'custom';
  d.ranges = schemaRanges();
  d.illustrative = true;
  return d;
}
