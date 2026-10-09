// ============================================================================
//  SCIENCE TOOLKIT  ·  registry.js  ·  the list of tools
// ----------------------------------------------------------------------------
//  The grid, the tabs and the command palette read this list. It holds no
//  tool code. A tool's code is in tools/<category>.js, which main.js loads
//  the first time a tool of that category opens (import()).
//
//  Row: [id, category, name, one-line description, search words].
//  The id is the URL hash of the tool: #unit-convert?q=...
//
//  GREP MAP
//    grep -n "export const CATS"    category ids, names and module files
//    grep -n "export const TOOLS"   the tool rows
//    grep -n "export function search"  palette ranking
//    grep -n "export const RELATED"    other pages of the site to link to
// ============================================================================

export const CATS = [
  { id: 'units', name: 'Units and constants' },
  { id: 'measure', name: 'Measurement and errors' },
  { id: 'stats', name: 'Statistics' },
  { id: 'chem', name: 'Chemistry' },
];

export const TOOLS = [
  ['unit-convert', 'units', 'Unit converter', 'Convert any quantity, compound units too; errors for wrong dimensions.', 'units si dimension convert compound imperial'],
  ['constants', 'units', 'Physical constants', 'CODATA 2022 values with uncertainties, searchable.', 'codata nist planck boltzmann avogadro speed light'],
  ['sig-figs', 'units', 'Significant figures', 'Count and round significant figures; scientific and engineering notation.', 'sig figs sigfig rounding notation scientific engineering uncertainty'],
  ['scales', 'units', 'Temperature, pressure and energy scales', 'One value in every unit of the scale, side by side.', 'temperature pressure energy wavenumber kelvin celsius ev hartree cross table'],
  ['uncertainty', 'measure', 'Uncertainty propagation', 'Propagate standard uncertainties through any formula: first order and Monte Carlo.', 'error propagation gum monte carlo sensitivity budget'],
  ['wmean', 'measure', 'Weighted mean', 'Inverse-variance mean of values with uncertainties, χ² and Birge ratio.', 'weighted average inverse variance birge chi'],
  ['pct-error', 'measure', 'Percent error', 'Percent error and difference between values in any units.', 'percent error difference relative deviation z score'],
  ['describe', 'stats', 'Descriptive statistics', 'Mean, median, SD, SEM, CI and quartiles of pasted data, with a histogram and box plot.', 'mean median standard deviation sem quartile iqr histogram box plot summary skewness'],
  ['ttest', 'stats', 't-tests', 'One-sample, paired, Welch and Student t-tests with CI and effect size.', 'student welch paired hypothesis test p value compare means'],
  ['chisq', 'stats', 'Chi-square tests', 'Goodness of fit and contingency tables, with expected counts and Cramér\'s V.', 'chi squared contingency independence goodness fit categorical cramer'],
  ['anova', 'stats', 'One-way ANOVA', 'F-test of several group means, with the ANOVA table and η².', 'analysis variance f test groups'],
  ['corr', 'stats', 'Correlation', 'Pearson r with Fisher CI and Spearman ρ, with a scatter plot.', 'pearson spearman rank correlation coefficient'],
  ['fit', 'stats', 'Curve fitting', 'Linear, polynomial, exponential, power, Gaussian and custom least-squares fits with parameter errors.', 'regression least squares levenberg marquardt nonlinear fit curve r squared residuals'],
  ['dist', 'stats', 'Distributions', 'pdf, cdf and quantiles of the normal, t, χ², F, binomial and Poisson laws.', 'probability distribution pdf cdf quantile critical value normal binomial poisson'],
  ['power', 'stats', 'Sample size and power', 'Sample size or power for t-tests and two proportions.', 'power analysis sample size cohen effect'],
  ['molar-mass', 'chem', 'Molar mass', 'Molar mass and percent composition of any formula, hydrates too; mass ↔ moles.', 'formula weight molecular mass composition hydrate moles grams'],
  ['balance', 'chem', 'Equation balancer', 'Balance chemical equations, ionic and redox too, by exact linear algebra.', 'balance chemical equation reaction coefficients redox'],
  ['stoich', 'chem', 'Stoichiometry', 'Limiting reagent, theoretical yield and excess from reactant amounts.', 'limiting reagent reactant yield stoichiometry excess'],
  ['dilution', 'chem', 'Dilution', 'C₁V₁ = C₂V₂ in any units; solve for the missing one.', 'dilution c1v1 c2v2 stock concentration'],
  ['solution', 'chem', 'Concentration', 'Molarity, molality, mass fraction, ppm and mole fraction of a solution.', 'molarity molality ppm mass fraction mole fraction concentration solution'],
  ['ph', 'chem', 'pH and buffers', 'pH of strong and weak acids and bases, polyprotic systems and buffers.', 'ph pka acid base buffer henderson hasselbalch titration'],
  ['gas', 'chem', 'Gas laws', 'Ideal gas and van der Waals: solve for P, V, n or T.', 'ideal gas pv nrt van der waals pressure volume temperature'],
  ['decay', 'chem', 'Half-life and decay', 'Remaining amount, elapsed time or half-life of first-order decay.', 'half life radioactive decay exponential carbon dating activity'],
].map(([id, cat, name, blurb, keys]) => ({ id, cat, name, blurb, keys }));

export const BY_ID = Object.fromEntries(TOOLS.map(t => [t.id, t]));

// Palette ranking: a higher score is a better match. 0 is no match.
// Every word of the query must match the name, the words, the
// description or the category name.
export function search(q, list = TOOLS) {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list.slice();
  const catName = Object.fromEntries(CATS.map(c => [c.id, c.name.toLowerCase()]));
  const scored = [];
  for (const t of list) {
    const name = t.name.toLowerCase(), keys = t.keys.toLowerCase(), blurb = t.blurb.toLowerCase(), cat = catName[t.cat] || '';
    let s = 0, ok = true;
    for (const w of words) {
      let ws = 0;
      if (name.startsWith(w)) ws = 8;
      else if (new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(name)) ws = 6;
      else if (name.includes(w)) ws = 4;
      else if (keys.includes(w)) ws = 3;
      else if (blurb.includes(w) || cat.includes(w) || t.id.includes(w)) ws = 1;
      if (!ws) { ok = false; break; }
      s += ws;
    }
    if (ok) scored.push([s, t]);
  }
  return scored.sort((a, b) => b[0] - a[0]).map(x => x[1]);
}

// Pages elsewhere on the site that do a job this page does not repeat.
export const RELATED = [
  ['periodic-table', 'Periodic Table', 'element data, isotopes and trends'],
  ['calculators', 'Pascaline & Curta', 'mechanical calculators'],
  ['ct-lab', 'CT Lab', 'the CT colour maps'],
  ['hydrogen-table', 'Hydrogen orbitals', 'wavefunctions'],
];
