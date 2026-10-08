// ============================================================================
//  OUTBREAK  ·  policies.js — public-health policies and their effects (no DOM)
// ----------------------------------------------------------------------------
//  The viewer sets policies. Each policy has a strength s in [0, 1] and a
//  trigger (detected cumulative cases worldwide, 0 = from day 0). model.js
//  keeps `active` = { id: dayStarted } and calls the functions below each
//  substep. Every effect is a multiplier in (0, 1] or a rate, so policies
//  combine as a product and a strength of 0 gives no effect.
//
//  Effects at strength s (values are approximate and illustrative):
//    distancing     direct share of transmission x (1 - 0.45 s)
//    masks          resp route only x (1 - 0.30 s)
//    closures       direct share of transmission x (1 - 0.35 s)
//    isolation      x (1 - 0.6 s detect cap) on resp and contact,
//                   x (1 - 0.3 s detect cap) on vector, water and flea;
//                   cap = testing capacity by node income (1 high .. 5 low)
//    vectorControl  vector and flea routes x (1 - 0.6 s)
//    cleanWater     water route x (1 - 0.7 s)
//    travel         international air edges x (1 - 0.9 s)
//    borders        cross-border land edges x (1 - 0.9 s)
//    quarantine     arrivalCatch = 0.8 s, x 0.5 when latent > 14 d
//    vaccination    S -> V at (0.002 + 0.01 s) x efficacy per day, after
//                   the vaccine exists (dayActive + vaccine.lagDays)
//
//  "Direct" means person-to-person. DIRECT_SHARE gives that share per route:
//  all of resp and contact, part of water (household spread) and flea
//  (pneumonic plague), none of vector. Distancing and closures act only on
//  the direct share: m = 1 - k s share.
//
//  transmissionMultiplier is the product over the policies of kind
//  'contact', 'vector' and 'water' (all policies that change beta).
//  The 'air', 'land', 'arrival' and 'vaccine' kinds have their own function.
//
//  Edges: airMultiplier(edge) reads edge.intl, landMultiplier(edge) reads
//  edge.cross. A plain number or boolean is also accepted (truthy = crosses
//  a border).
//
//  Sources (SOURCES below): Flaxman et al. 2020; Brauner et al. 2021;
//  Chu et al. 2020; Fraser et al. 2004; Chinazzi et al. 2020; Mateus et
//  al. 2014; Quilty et al. 2020; Bhatt et al. 2015; Wolf et al. 2018;
//  Mathieu et al. 2021 (vaccination pace).
//
//  grep -n targets: "export const POLICY_DEFS", "export const DIRECT_SHARE",
//    "export const INCOME_CAPACITY", "export function defaultPolicies",
//    "export function triggerActive", "export function transmissionMultiplier",
//    "export function airMultiplier", "export function landMultiplier",
//    "export function arrivalCatch", "export function vaccinationRate",
//    "function routeFactor"
// ============================================================================

export const SOURCES = [
  { ref: 'Flaxman S, Mishra S, Gandy A, et al. 2020. Estimating the effects of non-pharmaceutical interventions on COVID-19 in Europe. Nature 584:257-261.',
    url: 'https://doi.org/10.1038/s41586-020-2405-7',
    note: 'Combined interventions brought R_t below 1 in 11 countries; supports large distancing and closure effects.' },
  { ref: 'Brauner JM, Mindermann S, Sharma M, et al. 2021. Inferring the effectiveness of government interventions against COVID-19. Science 371:eabd9338.',
    url: 'https://doi.org/10.1126/science.abd9338',
    note: 'School and university closure about 38 % lower R; gathering limits 35-42 %; used for closures and distancing.' },
  { ref: 'Chu DK, Akl EA, Duda S, et al. 2020. Physical distancing, face masks, and eye protection to prevent person-to-person transmission of SARS-CoV-2 and COVID-19. Lancet 395:1973-1987.',
    url: 'https://doi.org/10.1016/S0140-6736(20)31142-9',
    note: 'Meta-analysis: distancing and masks both lower risk; the mask factor here (up to 30 %) is a population-level guess below the individual effect.' },
  { ref: 'Fraser C, Riley S, Anderson RM, Ferguson NM. 2004. Factors that make an infectious disease outbreak controllable. PNAS 101:6146-6151.',
    url: 'https://doi.org/10.1073/pnas.0307506101',
    note: 'Isolation works in proportion to the transmission that occurs after symptoms; the disease field "detect" plays that role.' },
  { ref: 'Chinazzi M, Davis JT, Ajelli M, et al. 2020. The effect of travel restrictions on the spread of the 2019 novel coronavirus (COVID-19) outbreak. Science 368:395-400.',
    url: 'https://doi.org/10.1126/science.aba9757',
    note: 'A 90 % cut in travel delays the epidemic only a little unless transmission also falls; used for the travel factor 0.9.' },
  { ref: 'Mateus ALP, Otete HE, Beck CR, Dolan GP, Nguyen-Van-Tam JS. 2014. Effectiveness of travel restrictions in the rapid containment of human influenza: a systematic review. Bull World Health Organ 92:868-880D.',
    url: 'https://doi.org/10.2471/BLT.14.135590',
    note: 'Internal and border travel restrictions of about 90 % delay spread by days to weeks; used for borders.' },
  { ref: 'Quilty BJ, Clifford S, CMMID nCoV working group, Flasche S, Eggo RM. 2020. Effectiveness of airport screening at detecting travellers infected with novel coronavirus (2019-nCoV). Euro Surveill 25(5):2000080.',
    url: 'https://doi.org/10.2807/1560-7917.ES.2020.25.5.2000080',
    note: 'Screening misses about half of infected travellers; arrival quarantine catches more, but not all (0.8 at full strength).' },
  { ref: 'Bhatt S, Weiss DJ, Cameron E, et al. 2015. The effect of malaria control on Plasmodium falciparum in Africa between 2000 and 2015. Nature 526:207-211.',
    url: 'https://doi.org/10.1038/nature15535',
    note: 'Insecticide-treated nets and indoor spraying averted most of the malaria cases prevented since 2000; used for vector control up to 60 %.' },
  { ref: 'Wolf J, Hunter PR, Freeman MC, et al. 2018. Impact of drinking water, sanitation and handwashing with soap on childhood diarrhoeal disease: updated meta-analysis and meta-regression. Trop Med Int Health 23:508-525.',
    url: 'https://doi.org/10.1111/tmi.13051',
    note: 'Safely managed water and sewer connection lower diarrhoea risk by about 50-75 %; used for clean water up to 70 %.' },
  { ref: 'Mathieu E, Ritchie H, Ortiz-Ospina E, et al. 2021. A global database of COVID-19 vaccinations. Nat Hum Behav 5:947-953.',
    url: 'https://doi.org/10.1038/s41562-021-01122-8',
    note: 'Fast national campaigns gave about 0.5-1 % of the population a dose per day; used for the vaccination pace up to 1.2 % per day.' },
];

// Share of transmission that is person-to-person, by route.
export const DIRECT_SHARE = Object.freeze({ resp: 1, contact: 1, water: 0.3, flea: 0.2, vector: 0 });

// Testing and isolation capacity by node income (index 1 high .. 5 low).
// Illustrative: no single source; poorer health systems detect fewer cases.
export const INCOME_CAPACITY = Object.freeze([1, 1, 0.9, 0.75, 0.6, 0.5]);

const ALL_ROUTES = ['resp', 'contact', 'water', 'flea', 'vector'];

// kind: which function applies the policy. routes: the routes it changes
// (empty for travel, borders and vaccination, which act on every route).
// k: the effect at full strength. refs: indices into SOURCES.
export const POLICY_DEFS = Object.freeze([
  { id: 'distancing', name: 'Social distancing', kind: 'contact', k: 0.45,
    blurb: 'Fewer close contacts: work from home, smaller gatherings.',
    defaultStrength: 0.6, defaultTrigger: 1000, routes: ['resp', 'contact', 'water', 'flea'], refs: [0, 1, 2] },
  { id: 'masks', name: 'Masks', kind: 'contact', k: 0.30,
    blurb: 'Masks in shared indoor air. Acts on respiratory diseases only.',
    defaultStrength: 0.6, defaultTrigger: 1000, routes: ['resp'], refs: [2] },
  { id: 'closures', name: 'School and venue closures', kind: 'contact', k: 0.35,
    blurb: 'Schools, venues and large events close.',
    defaultStrength: 0.6, defaultTrigger: 10000, routes: ['resp', 'contact', 'water', 'flea'], refs: [1] },
  { id: 'isolation', name: 'Testing and isolation', kind: 'contact', k: 0.6, kOther: 0.3,
    blurb: 'Find and isolate cases. Works best when people are sick before they are infectious.',
    defaultStrength: 0.7, defaultTrigger: 0, routes: ALL_ROUTES.slice(), refs: [3] },
  { id: 'travel', name: 'International flight limits', kind: 'air', k: 0.9,
    blurb: 'Cuts international flights. Delays spread, does not stop it alone.',
    defaultStrength: 0.8, defaultTrigger: 1000, routes: [], refs: [4] },
  { id: 'borders', name: 'Land border controls', kind: 'land', k: 0.9,
    blurb: 'Cuts road and rail movement across national borders.',
    defaultStrength: 0.8, defaultTrigger: 1000, routes: [], refs: [5] },
  { id: 'quarantine', name: 'Arrival quarantine', kind: 'arrival', k: 0.8,
    blurb: 'Infected air travellers held at arrival. Less effective for long incubation.',
    defaultStrength: 0.7, defaultTrigger: 100, routes: [], refs: [6] },
  { id: 'vaccination', name: 'Vaccination', kind: 'vaccine', k: 0.01, base: 0.002,
    blurb: 'Vaccinates the susceptible, once a vaccine exists for the disease.',
    defaultStrength: 0.6, defaultTrigger: 0, routes: [], refs: [9] },
  { id: 'vectorControl', name: 'Vector control', kind: 'vector', k: 0.6,
    blurb: 'Bed nets, spraying, rodent and flea control.',
    defaultStrength: 0.7, defaultTrigger: 0, routes: ['vector', 'flea'], refs: [7] },
  { id: 'cleanWater', name: 'Clean water and sanitation', kind: 'water', k: 0.7,
    blurb: 'Safe drinking water, chlorination and sanitation.',
    defaultStrength: 0.7, defaultTrigger: 0, routes: ['water'], refs: [8] },
].map(d => Object.freeze(d)));

const DEF = Object.fromEntries(POLICY_DEFS.map(d => [d.id, d]));
const BETA_KINDS = new Set(['contact', 'vector', 'water']);
const MIN_MULT = 1e-3;

const clamp01 = x => (x > 0 ? (x < 1 ? x : 1) : 0);

// All policies off, with their default strength and trigger.
export function defaultPolicies() {
  const p = {};
  for (const d of POLICY_DEFS) p[d.id] = { on: false, strength: d.defaultStrength, trigger: d.defaultTrigger };
  return p;
}

// True when the policy `p` = { on, strength, trigger } should be active.
// It starts when the detected cumulative cases reach the trigger; a
// trigger of 0 (or less) starts it at day 0. `day` is accepted for the
// contract signature; the trigger does not depend on it.
export function triggerActive(p, detectedCases, day) { // eslint-disable-line no-unused-vars
  if (!p || !p.on) return false;
  const t = +p.trigger || 0;
  return t <= 0 || detectedCases >= t;
}

// Strength of policy `id` when it is on and active, else 0.
function strength(policies, active, id) {
  if (!active || active[id] === undefined || active[id] === null) return 0;
  const p = policies && policies[id];
  if (!p || !p.on) return 0;
  return clamp01(+p.strength || 0);
}

// The beta factor of one policy for one route.
function routeFactor(def, s, disease, route, income) {
  if (s <= 0 || !def.routes.includes(route)) return 1;
  switch (def.id) {
    case 'distancing':
    case 'closures':
      return 1 - def.k * s * (DIRECT_SHARE[route] ?? 1);
    case 'isolation': {
      const cap = INCOME_CAPACITY[Math.round(income)] ?? INCOME_CAPACITY[3];
      const det = clamp01(+disease.detect || 0);
      const k = (route === 'resp' || route === 'contact') ? def.k : def.kOther;
      return 1 - k * s * det * cap;
    }
    default:
      return 1 - def.k * s;
  }
}

// Product of the active policies that change beta, in (0, 1].
// `node` gives `income` (1 high .. 5 low); missing means 3.
export function transmissionMultiplier(disease, policies, active, node) {
  const route = disease && disease.route;
  if (!ALL_ROUTES.includes(route)) return 1;
  const income = node && node.income >= 1 && node.income <= 5 ? node.income : 3;
  let m = 1;
  for (const d of POLICY_DEFS) {
    if (!BETA_KINDS.has(d.kind)) continue;
    const s = strength(policies, active, d.id);
    if (s > 0) m *= routeFactor(d, s, disease, route, income);
  }
  return Math.max(MIN_MULT, Math.min(1, m));
}

const crosses = (edge, key) => !!(edge !== null && typeof edge === 'object' ? edge[key] : edge);

// Factor on one air edge's flow, in (0, 1]. Only international edges change.
export function airMultiplier(edge, policies, active) {
  if (!crosses(edge, 'intl')) return 1;
  const s = strength(policies, active, 'travel');
  return Math.max(MIN_MULT, 1 - DEF.travel.k * s);
}

// Factor on one land edge's coupling, in (0, 1]. Only cross-border edges change.
export function landMultiplier(edge, policies, active) {
  if (!crosses(edge, 'cross')) return 1;
  const s = strength(policies, active, 'borders');
  return Math.max(MIN_MULT, 1 - DEF.borders.k * s);
}

// Fraction of infected air travellers that arrival quarantine stops, 0..1.
// A 14-day quarantine misses more of a disease whose latent period is longer.
export function arrivalCatch(disease, policies, active) {
  const s = strength(policies, active, 'quarantine');
  if (s <= 0) return 0;
  const longLatent = disease && +disease.latent > 14;
  return clamp01(DEF.quarantine.k * s * (longLatent ? 0.5 : 1));
}

// Fraction of the remaining S that moves to V per day, efficacy included
// (the model moves only the people the vaccine protects). 0 when the
// disease has no vaccine (vaccine null, or exists false with no lagDays;
// exists false with lagDays > 0 = a vaccine still in development),
// when the policy is not active, or before the
// vaccine exists: day < dayActive + vaccine.lagDays. `dayActive` defaults
// to active.vaccination.
export function vaccinationRate(disease, policies, active, day, dayActive) {
  const v = disease && disease.vaccine;
  if (!v || v.exists === false && !(+v.lagDays > 0)) return 0;
  const s = strength(policies, active, 'vaccination');
  if (s <= 0) return 0;
  const start = (dayActive ?? active.vaccination) + (+v.lagDays || 0);
  if (!(day >= start)) return 0;
  const eff = v.efficacy === undefined ? 1 : clamp01(+v.efficacy);
  return (DEF.vaccination.base + DEF.vaccination.k * s) * eff;
}
