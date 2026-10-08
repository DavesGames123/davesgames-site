// ============================================================================
//  OUTBREAK  ·  equations.js  ·  TeX strings and color rules  (ES module)
// ----------------------------------------------------------------------------
//  This module gives the TeX of the toy metapopulation model for the about
//  box (ui.js) and the saver plate (director.js). It has no DOM. The page
//  typesets the strings only through lib/sci-math.js (MathJax SVG), because
//  KaTeX breaks in Safari.
//
//  COLORS. RULES use the same classes as the plate parameters in
//  director.js: R_0 m1, sigma m2, gamma m3, IFR m4, R_eff m5. beta gets m6.
//
//  VARIANTS. texFor(disease) gives three strings:
//    1. the compartment flow: SEIR, or SIR when latent = 0, with the
//       waning term (omega) when waning > 0 and the vaccine term (nu) when
//       the disease has a vaccine;
//    2. the force of infection for the route: coupling (resp, contact),
//       vector (vector, flea: Ross-Macdonald), water (water: reservoir);
//    3. the effective reproduction number.
//
//  The model is illustrative, not a forecast. Values are approximate.
//
//  SOURCES
//    Kermack and McKendrick 1927, Proc R Soc A 115:700 (SIR).
//    Keeling and Rohani 2008, Modeling Infectious Diseases (SEIR,
//      metapopulation coupling).
//    Smith et al. 2012, PLoS Pathog 8:e1002588 (Ross-Macdonald).
//    Codeco 2001, BMC Infect Dis 1:1 (cholera reservoir).
//
//  EXPORTS   (jump with grep -n "<anchor>" equations.js)
//      TEX ........ "export const TEX"          seir, sir, reff, coupling, vector, water
//      RULES ...... "export const RULES"        symbol -> class for sci-math colorize
//      SOURCES .... "export const SOURCES"      [{ ref, url, note }]
//      flowTeX .... "export function flowTeX"   compartment flow for one disease
//      texFor ..... "export function texFor"    disease -> [tex, tex, tex]
//      bracesOk ... "export function bracesOk"  TeX brace and environment check
// ============================================================================

export const SOURCES = [
  { ref: 'Kermack WO, McKendrick AG 1927. A contribution to the mathematical theory of epidemics. Proc R Soc A 115:700-721',
    url: 'https://doi.org/10.1098/rspa.1927.0118', note: 'SIR compartments and the epidemic threshold' },
  { ref: 'Keeling MJ, Rohani P 2008. Modeling Infectious Diseases in Humans and Animals. Princeton University Press',
    url: 'https://press.princeton.edu/books/hardcover/9780691116174/modeling-infectious-diseases-in-humans-and-animals', note: 'SEIR, waning immunity, metapopulation coupling' },
  { ref: 'Smith DL, Battle KE, Hay SI, et al. 2012. Ross, Macdonald, and a theory for the dynamics and control of mosquito-transmitted pathogens. PLoS Pathog 8:e1002588',
    url: 'https://doi.org/10.1371/journal.ppat.1002588', note: 'Ross-Macdonald host-vector loop and its R0' },
  { ref: 'Codeco CT 2001. Endemic and epidemic dynamics of cholera: the role of the aquatic reservoir. BMC Infect Dis 1:1',
    url: 'https://doi.org/10.1186/1471-2334-1-1', note: 'water reservoir force of infection W / (K + W)' },
];

// Force of infection, shared by the flow strings.
const LAM = '\\lambda_i';

export const TEX = {
  seir: String.raw`\begin{aligned}\dot S_i &= -\lambda_i S_i + \omega R_i - \nu S_i\\ \dot E_i &= \lambda_i S_i - \sigma E_i\\ \dot I_i &= \sigma E_i - \gamma I_i\\ \dot R_i &= (1-\mathrm{IFR})\,\gamma I_i - \omega R_i\\ \dot D_i &= \mathrm{IFR}\,\gamma I_i\end{aligned}`,
  sir: String.raw`\begin{aligned}\dot S_i &= -\lambda_i S_i\\ \dot I_i &= \lambda_i S_i - \gamma I_i\\ \dot R_i &= (1-\mathrm{IFR})\,\gamma I_i\\ \dot D_i &= \mathrm{IFR}\,\gamma I_i\end{aligned}`,
  reff: String.raw`R_{\mathrm{eff}} = R_0\, m_{\mathrm{policy}}\, s(t)\, \kappa(\phi)\, \frac{S}{N}, \qquad \beta = R_0\,\gamma`,
  coupling: String.raw`\begin{aligned}\lambda_i &= \frac{\beta_i}{N_i}\Big(I_i + \sum_j C_{ij}\,\frac{I_j}{N_j}\,N_i\Big)\\ T_{ij} &\sim \mathrm{Poisson}\Big(F_{ij}\,\Delta t\,\tau\,\frac{E_i + I_i}{N_i}\,m_{\mathrm{air}}\Big)\end{aligned}`,
  vector: String.raw`\begin{aligned}\lambda_i &= a\,b\,m\,\kappa(\phi_i)\,I_{v,i}\\ \dot I_{v,i} &= a\,c\,\frac{I_i}{N_i}\,(1 - I_{v,i}) - g\,I_{v,i}\\ R_0 &= \frac{m\,a^2\,b\,c\,e^{-g n}}{g\,\gamma}\end{aligned}`,
  water: String.raw`\begin{aligned}\lambda_i &= \beta_h\,\frac{I_i}{N_i} + \beta_w\,m_{\mathrm{water}}\,\frac{W_i}{K + W_i}\\ \dot W_i &= \xi\,\frac{I_i}{N_i} - \delta\,W_i\end{aligned}`,
};

// sci-math colorize rules. Longer symbols match first there.
export const RULES = [
  ['R_0', 'm1'],
  ['\\sigma', 'm2'],
  ['\\gamma', 'm3'],
  ['\\mathrm{IFR}', 'm4'],
  ['R_{\\mathrm{eff}}', 'm5'],
  ['\\beta', 'm6'],
];

// Compartment flow for one disease: SIR when latent = 0, the omega term
// only with waning > 0, the nu term only with a vaccine.
export function flowTeX(d = {}) {
  const seir = (d.latent || 0) > 0;
  const wane = (d.waning || 0) > 0;
  const vacc = !!(d.vaccine && d.vaccine.exists !== false);
  const sLine = `\\dot S_i &= -${LAM} S_i${wane ? ' + \\omega R_i' : ''}${vacc ? ' - \\nu S_i' : ''}`;
  const rows = [sLine];
  if (seir) {
    rows.push(`\\dot E_i &= ${LAM} S_i - \\sigma E_i`);
    rows.push('\\dot I_i &= \\sigma E_i - \\gamma I_i');
  } else {
    rows.push(`\\dot I_i &= ${LAM} S_i - \\gamma I_i`);
  }
  rows.push(`\\dot R_i &= (1-\\mathrm{IFR})\\,\\gamma I_i${wane ? ' - \\omega R_i' : ''}`);
  if (vacc) rows.push('\\dot V_i &= \\nu S_i');
  rows.push('\\dot D_i &= \\mathrm{IFR}\\,\\gamma I_i');
  return `\\begin{aligned}${rows.join('\\\\ ')}\\end{aligned}`;
}

// disease -> [flow, transmission for its route, R_eff]
export function texFor(disease) {
  const d = disease || {};
  const route = d.route || 'resp';
  const trans = route === 'vector' || route === 'flea' ? TEX.vector
    : route === 'water' ? TEX.water
    : TEX.coupling;
  return [flowTeX(d), trans, TEX.reff];
}

// True when every { has its }, and every \begin{x} has its \end{x}.
// An escaped brace (\{ or \}) does not count.
export function bracesOk(tex) {
  let depth = 0;
  for (let i = 0; i < tex.length; i++) {
    const c = tex[i];
    if (c === '\\') { i++; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth < 0) return false;
  }
  if (depth !== 0) return false;
  const env = [];
  const re = /\\(begin|end)\{([A-Za-z*]+)\}/g;
  let m;
  while ((m = re.exec(tex))) {
    if (m[1] === 'begin') env.push(m[2]);
    else if (env.pop() !== m[2]) return false;
  }
  return env.length === 0;
}
