// ============================================================================
//  REACTIONS  ·  templates.js — the reaction library, species, basics (data)
// ----------------------------------------------------------------------------
//  No DOM. The page, the retrosynthesis worker, build/build.mjs and
//  tests.mjs all read this file.
//
//  SPECIES  key -> [SMILES, name, mhchem formula]. The mhchem formula is the
//  condensed formula a textbook writes in an equation. build/build.mjs
//  turns each SMILES into a chem.js record (PubChem 3D when the Molecule
//  Explorer library has the compound, else an OpenChemLib conformer).
//
//  CLASSES  one reaction class each:
//    id, name, family, cond (mhchem text above the arrow), below (under it),
//    arrow ('->' or '<=>'), d (a short description),
//    lhs  reactant patterns (smarts.js), every atom mapped, hydrogens that
//         move written as [H:n]
//    rhs  product patterns, rhs[0] is the main product, the rest are the
//         by-products. Map numbers pair the atoms of the two sides.
//    role per lhs pattern: 'sub' (the user picks it), a species key (the
//         reagent, filled in by default), or 'f:<key>' (a formal reagent,
//         [O] or 2[H]: written in the equation, not drawn in the tree)
//    byp  species keys of the by-products (rhs[1..]) for the backward
//         search. ex  the example: species keys of the lhs, then the main
//         product key.  tex  the general equation (R groups).
//    filter 'markovnikov' | 'eas' (ortho/para or meta rules)
//    retro false: the backward search does not use the class
//  OVERALL classes (kind 'overall') have fixed species with coefficients,
//  or (combustion) coefficients from the fuel formula. Atoms are paired by
//  react.js mapOverall().
//
//  NAMED  famous syntheses: a list of steps (class + species keys).
//  BASICS the common starting compounds of the backward search, with a
//         commonness rank 1 (bulk) .. 3 (lab reagent).
//  BLOCK  targets the page declines: species and patterns.
//
//  GREP MAP
//    grep -n 'export const SPECIES'   grep -n 'export const CLASSES'
//    grep -n 'export const NAMED'     grep -n 'export const BASICS'
//    grep -n 'export const BLOCK'
// ============================================================================

export const SPECIES = {
  water: ['O', 'Water', 'H2O'],
  h2: ['[H][H]', 'Hydrogen', 'H2'],
  o2: ['O=O', 'Oxygen', 'O2'],
  n2: ['N#N', 'Nitrogen', 'N2'],
  co2: ['O=C=O', 'Carbon dioxide', 'CO2'],
  nh3: ['N', 'Ammonia', 'NH3'],
  hcl: ['Cl', 'Hydrogen chloride', 'HCl'],
  hbr: ['Br', 'Hydrogen bromide', 'HBr'],
  naoh: ['[Na+].[OH-]', 'Sodium hydroxide', 'NaOH'],
  koh: ['[K+].[OH-]', 'Potassium hydroxide', 'KOH'],
  nacl: ['[Na+].[Cl-]', 'Sodium chloride', 'NaCl'],
  nabr: ['[Na+].[Br-]', 'Sodium bromide', 'NaBr'],
  nai: ['[Na+].[I-]', 'Sodium iodide', 'NaI'],
  kbr: ['[K+].[Br-]', 'Potassium bromide', 'KBr'],
  nah: ['[Na+].[H-]', 'Sodium hydride', 'NaH'],
  mg: ['[Mg]', 'Magnesium', 'Mg'],
  br2: ['BrBr', 'Bromine', 'Br2'],
  cl2: ['ClCl', 'Chlorine', 'Cl2'],
  hno3: ['O[N+](=O)[O-]', 'Nitric acid', 'HNO3'],
  socl2: ['ClS(Cl)=O', 'Thionyl chloride', 'SOCl2'],
  so2: ['O=S=O', 'Sulfur dioxide', 'SO2'],
  nh4br: ['[NH4+].[Br-]', 'Ammonium bromide', 'NH4Br'],
  mgohbr: ['O[Mg]Br', 'Magnesium hydroxybromide', 'Mg(OH)Br'],
  boh3: ['OB(O)O', 'Boric acid', 'B(OH)3'],
  oform: ['[O]', 'Oxidant [O]', '[O]'],
  methane: ['C', 'Methane', 'CH4'],
  ethane: ['CC', 'Ethane', 'C2H6'],
  methanol: ['CO', 'Methanol', 'CH3OH'],
  ethanol: ['CCO', 'Ethanol', 'C2H5OH'],
  propan2ol: ['CC(C)O', 'Propan-2-ol', 'CH3CH(OH)CH3'],
  aceticacid: ['CC(=O)O', 'Acetic acid', 'CH3COOH'],
  naacetate: ['CC(=O)[O-].[Na+]', 'Sodium acetate', 'CH3COONa'],
  ethylene: ['C=C', 'Ethylene', 'CH2=CH2'],
  propene: ['CC=C', 'Propene', 'CH3CH=CH2'],
  butadiene: ['C=CC=C', '1,3-Butadiene', 'CH2=CH-CH=CH2'],
  cyclohexene: ['C1=CCCCC1', 'Cyclohexene', 'C6H10'],
  benzene: ['c1ccccc1', 'Benzene', 'C6H6'],
  toluene: ['Cc1ccccc1', 'Toluene', 'C6H5CH3'],
  phenol: ['Oc1ccccc1', 'Phenol', 'C6H5OH'],
  formaldehyde: ['C=O', 'Formaldehyde', 'HCHO'],
  acetaldehyde: ['CC=O', 'Acetaldehyde', 'CH3CHO'],
  acetone: ['CC(C)=O', 'Acetone', 'CH3COCH3'],
  benzaldehyde: ['O=Cc1ccccc1', 'Benzaldehyde', 'C6H5CHO'],
  ch3cl: ['CCl', 'Chloromethane', 'CH3Cl'],
  ch3br: ['CBr', 'Bromomethane', 'CH3Br'],
  ch3i: ['CI', 'Iodomethane', 'CH3I'],
  etbr: ['CCBr', 'Bromoethane', 'C2H5Br'],
  etcl: ['CCCl', 'Chloroethane', 'C2H5Cl'],
  ipbr: ['CC(C)Br', '2-Bromopropane', 'CH3CHBrCH3'],
  dibromoethane: ['BrCCBr', '1,2-Dibromoethane', 'BrCH2CH2Br'],
  bromobenzene: ['Brc1ccccc1', 'Bromobenzene', 'C6H5Br'],
  ac2o: ['CC(=O)OC(C)=O', 'Acetic anhydride', '(CH3CO)2O'],
  acetylcl: ['CC(Cl)=O', 'Acetyl chloride', 'CH3COCl'],
  ylide: ['C=P(c1ccccc1)(c1ccccc1)c1ccccc1', 'Methylenetriphenylphosphorane', 'Ph3P=CH2'],
  ph3po: ['O=P(c1ccccc1)(c1ccccc1)c1ccccc1', 'Triphenylphosphine oxide', 'Ph3PO'],
  phboh2: ['OB(O)c1ccccc1', 'Phenylboronic acid', 'C6H5B(OH)2'],
  glucose: ['OCC1OC(O)C(O)C(O)C1O', 'Glucose', 'C6H12O6'],
  ethylacetate: ['CCOC(C)=O', 'Ethyl acetate', 'CH3COOC2H5'],
  salicylic: ['OC(=O)c1ccccc1O', 'Salicylic acid', 'HOC6H4COOH'],
  aspirin: ['CC(=O)Oc1ccccc1C(=O)O', 'Aspirin', 'CH3COOC6H4COOH'],
  nitrophenol4: ['Oc1ccc(cc1)[N+](=O)[O-]', '4-Nitrophenol', 'HOC6H4NO2'],
  aminophenol4: ['Nc1ccc(O)cc1', '4-Aminophenol', 'HOC6H4NH2'],
  paracetamol: ['CC(=O)Nc1ccc(O)cc1', 'Paracetamol', 'CH3CONHC6H4OH'],
  nitrobenzene: ['[O-][N+](=O)c1ccccc1', 'Nitrobenzene', 'C6H5NO2'],
  aniline: ['Nc1ccccc1', 'Aniline', 'C6H5NH2'],
  acetanilide: ['CC(=O)Nc1ccccc1', 'Acetanilide', 'CH3CONHC6H5'],
  acetophenone: ['CC(=O)c1ccccc1', 'Acetophenone', 'C6H5COCH3'],
  ethylbenzene: ['CCc1ccccc1', 'Ethylbenzene', 'C6H5C2H5'],
  ethylamine: ['CCN', 'Ethylamine', 'C2H5NH2'],
  naoet: ['CC[O-].[Na+]', 'Sodium ethoxide', 'C2H5ONa'],
  methoxyethane: ['CCOC', 'Methoxyethane', 'CH3OC2H5'],
  etmgbr: ['CC[Mg]Br', 'Ethylmagnesium bromide', 'C2H5MgBr'],
  tamyl: ['CCC(C)(C)O', '2-Methylbutan-2-ol', '(CH3)2C(OH)C2H5'],
  hydroxybutanal: ['CC(O)CC=O', '3-Hydroxybutanal', 'CH3CH(OH)CH2CHO'],
  crotonaldehyde: ['CC=CC=O', 'But-2-enal', 'CH3CH=CHCHO'],
  acetoacetate: ['CCOC(=O)CC(C)=O', 'Ethyl acetoacetate', 'CH3COCH2COOC2H5'],
  schiff: ['C(=Nc1ccccc1)c1ccccc1', 'N-Benzylideneaniline', 'C6H5CH=NC6H5'],
  biphenyl: ['c1ccc(cc1)-c1ccccc1', 'Biphenyl', 'C6H5-C6H5'],
  styrene: ['C=Cc1ccccc1', 'Styrene', 'C6H5CH=CH2'],
  maleican: ['O=C1OC(=O)C=C1', 'Maleic anhydride', 'C4H2O3'],
  thpa: ['O=C1OC(=O)C2CC=CCC12', 'Tetrahydrophthalic anhydride', 'C8H8O3'],
  adipic: ['OC(=O)CCCCC(=O)O', 'Adipic acid', 'HOOC(CH2)4COOH'],
  hmda: ['NCCCCCCN', 'Hexamethylenediamine', 'H2N(CH2)6NH2'],
  nylonlink: ['NCCCCCCNC(=O)CCCCC(=O)O', 'Nylon-6,6 repeat unit', 'H2N(CH2)6NHCO(CH2)4COOH'],
  tristearin: ['CCCCCCCCCCCCCCCCCC(=O)OCC(COC(=O)CCCCCCCCCCCCCCCCC)OC(=O)CCCCCCCCCCCCCCCCC', 'Tristearin', 'C57H110O6'],
  distearin: ['CCCCCCCCCCCCCCCCCC(=O)OCC(O)COC(=O)CCCCCCCCCCCCCCCCC', 'Glyceryl distearate', 'C39H76O5'],
  monostearin: ['CCCCCCCCCCCCCCCCCC(=O)OCC(O)CO', 'Glyceryl monostearate', 'C21H42O4'],
  glycerol: ['OCC(O)CO', 'Glycerol', 'C3H5(OH)3'],
  soap: ['CCCCCCCCCCCCCCCCCC(=O)[O-].[Na+]', 'Sodium stearate', 'C17H35COONa'],
};

// one class: compact constructor
const C = (id, name, family, o) => Object.assign({ id, name, family, arrow: '->', cond: '', below: '', retro: true }, o);

export const FAMILIES = [
  ['acidbase', 'Acids and bases'], ['carbonyl', 'Carbonyl chemistry'], ['subst', 'Substitution and elimination'],
  ['addition', 'Addition to alkenes'], ['redox', 'Oxidation and reduction'], ['arom', 'Aromatic substitution'],
  ['cc', 'Carbon-carbon bond formation'], ['overall', 'Overall equations'],
];

export const CLASSES = [
  // ── acids and bases ──────────────────────────────────────────────────────
  C('neutralise', 'Acid-base neutralisation', 'acidbase', {
    lhs: ['[Cl,Br,I:1][H:2]', '[Na+:3].[O-:4][H:5]'], rhs: ['[Na+:3].[Cl-,Br-,I-:1]', '[H:2][O:4][H:5]'],
    role: ['sub', 'naoh'], byp: ['water'], ex: ['hcl', 'naoh', 'nacl'], retro: false,
    tex: 'HX + NaOH -> NaX + H2O',
    d: 'A strong acid gives its proton to hydroxide. Water forms and the ions that are left make a salt.' }),
  C('carboxylate', 'Carboxylic acid and hydroxide', 'acidbase', {
    lhs: ['[#6,#1:9][C:1](=[O:2])[O:3][H:4]', '[Na+:5].[O-:6][H:7]'], rhs: ['[#6,#1:9][C:1](=[O:2])[O-:3].[Na+:5]', '[H:4][O:6][H:7]'],
    role: ['sub', 'naoh'], byp: ['water'], ex: ['aceticacid', 'naoh', 'naacetate'],
    tex: 'RCOOH + NaOH -> RCOONa + H2O',
    d: 'A carboxylic acid is a weak acid, but hydroxide takes its O-H proton completely. The product is a sodium carboxylate salt and water.' }),
  // ── carbonyl chemistry ───────────────────────────────────────────────────
  C('fischer', 'Fischer esterification', 'carbonyl', {
    lhs: ['[#6,#1:9][C:1](=[O:2])[O:3][H:4]', '[H:5][O:6][C&X4:7]'], rhs: ['[#6,#1:9][C:1](=[O:2])[O:6][C:7]', '[H:4][O:3][H:5]'],
    role: ['sub', 'sub'], byp: ['water'], ex: ['aceticacid', 'ethanol', 'ethylacetate'], arrow: '<=>', cond: 'H2SO4', below: '$\\Delta$',
    tex: "RCOOH + R'OH <=>[H2SO4][$\\Delta$] RCOOR' + H2O",
    d: 'An acid catalyst activates the carboxylic acid. The alcohol oxygen attacks the carbonyl carbon and water leaves. The equilibrium is pushed to the ester by excess alcohol or by removal of water.' }),
  C('anhydride-o', 'Acetylation of an alcohol or phenol (anhydride)', 'carbonyl', {
    lhs: ['[c,C&X4:7][O:6][H:5]', '[#6:9][C:1](=[O:2])[O:3][C:10](=[O:11])[#6:12]'], rhs: ['[c,C:7][O:6][C:1](=[O:2])[#6:9]', '[#6:12][C:10](=[O:11])[O:3][H:5]'],
    role: ['sub', 'ac2o'], byp: ['aceticacid'], ex: ['salicylic', 'ac2o', 'aspirin'], cond: 'H3PO4', below: '$\\Delta$',
    tex: "ArOH + (RCO)2O ->[H3PO4][$\\Delta$] ArOCOR + RCOOH",
    d: 'The O-H oxygen attacks one carbonyl of the anhydride and a carboxylate leaves. This is how aspirin is made from salicylic acid.' }),
  C('anhydride-n', 'Acetylation of an amine (anhydride)', 'carbonyl', {
    lhs: ['[c,C&X4:7][N&X3:6][H:5]', '[#6:9][C:1](=[O:2])[O:3][C:10](=[O:11])[#6:12]'], rhs: ['[c,C:7][N:6][C:1](=[O:2])[#6:9]', '[#6:12][C:10](=[O:11])[O:3][H:5]'],
    role: ['sub', 'ac2o'], byp: ['aceticacid'], ex: ['aminophenol4', 'ac2o', 'paracetamol'], cond: 'H2O', below: '$\\Delta$',
    tex: "ArNH2 + (RCO)2O -> ArNHCOR + RCOOH",
    d: 'Nitrogen is a better nucleophile than oxygen, so an amine is acylated first. 4-Aminophenol gives paracetamol.' }),
  C('acylcl-o', 'Ester from an acyl chloride', 'carbonyl', {
    lhs: ['[#6:9][C:1](=[O:2])[Cl:3]', '[H:5][O:6][C&X4,c:7]'], rhs: ['[#6:9][C:1](=[O:2])[O:6][C,c:7]', '[H:5][Cl:3]'],
    role: ['sub', 'sub'], byp: ['hcl'], ex: ['acetylcl', 'ethanol', 'ethylacetate'], cond: 'pyridine',
    tex: "RCOCl + R'OH -> RCOOR' + HCl",
    d: 'An acyl chloride is much more reactive than the acid. The alcohol adds, chloride leaves, and HCl forms. A base such as pyridine takes up the HCl.' }),
  C('acylcl-n', 'Amide from an acyl chloride', 'carbonyl', {
    lhs: ['[#6:9][C:1](=[O:2])[Cl:3]', '[H:5][N&X3:6][#6,#1:7]'], rhs: ['[#6:9][C:1](=[O:2])[N:6][#6,#1:7]', '[H:5][Cl:3]'],
    role: ['sub', 'sub'], byp: ['hcl'], ex: ['acetylcl', 'aniline', 'acetanilide'],
    tex: "RCOCl + R'NH2 -> RCONHR' + HCl",
    d: 'An amine adds to the acyl chloride and chloride leaves. The amide bond forms fast at room temperature.' }),
  C('amide', 'Amide formation (condensation)', 'carbonyl', {
    lhs: ['[#6,#1:9][C:1](=[O:2])[O:3][H:4]', '[H:5][N&X3:6][C&X4:7]'], rhs: ['[#6,#1:9][C:1](=[O:2])[N:6][C:7]', '[H:4][O:3][H:5]'],
    role: ['sub', 'sub'], byp: ['water'], ex: ['adipic', 'hmda', 'nylonlink'], below: '$\\Delta$',
    tex: "RCOOH + R'NH2 ->[][$\\Delta$] RCONHR' + H2O",
    d: 'A carboxylic acid and an amine first make a salt. Strong heat drives out water and leaves an amide. With a diacid and a diamine the step repeats and makes nylon.' }),
  C('saponify', 'Ester hydrolysis (saponification)', 'carbonyl', {
    lhs: ['[#6,#1:9][C:1](=[O:2])[O:3][C&X4,c:7]', '[Na+:5].[O-:6][H:4]'], rhs: ['[#6,#1:9][C:1](=[O:2])[O-:6].[Na+:5]', '[H:4][O:3][C,c:7]'],
    role: ['sub', 'naoh'], byp: ['ethanol'], ex: ['ethylacetate', 'naoh', 'naacetate'], below: '$\\Delta$', retro: false,
    tex: "RCOOR' + NaOH ->[][$\\Delta$] RCOONa + R'OH",
    d: 'Hydroxide attacks the ester carbonyl and the alkoxide leaves. The acid that forms gives its proton at once, so the reaction goes to completion. With fats the product is soap.' }),
  C('anhydride', 'Anhydride formation (dehydration)', 'carbonyl', {
    lhs: ['[#6,#1:9][C:1](=[O:2])[O:3][H:4]', '[H:5][O:6][C:7](=[O:8])[#6,#1:10]'], rhs: ['[#6,#1:9][C:1](=[O:2])[O:6][C:7](=[O:8])[#6,#1:10]', '[H:4][O:3][H:5]'],
    role: ['sub', 'sub'], byp: ['water'], ex: ['aceticacid', 'aceticacid', 'ac2o'], cond: 'P4O10', below: '$\\Delta$',
    tex: 'RCOOH + RCOOH ->[P4O10][$\\Delta$] (RCO)2O + H2O',
    d: 'A strong dehydrating agent removes one water from two carboxylic acid groups. The two acyl groups now share one oxygen.' }),
  C('acylchloride', 'Acyl chloride with thionyl chloride', 'carbonyl', {
    lhs: ['[#6,#1:9][C:1](=[O:2])[O:3][H:4]', '[Cl:5][S:6](=[O:7])[Cl:8]'], rhs: ['[#6,#1:9][C:1](=[O:2])[Cl:5]', '[O:3]=[S:6]=[O:7]', '[H:4][Cl:8]'],
    role: ['sub', 'socl2'], byp: ['so2', 'hcl'], ex: ['aceticacid', 'socl2', 'acetylcl'],
    tex: 'RCOOH + SOCl2 -> RCOCl + SO2 + HCl',
    d: 'Thionyl chloride turns the O-H group into a good leaving group. Chloride replaces it, and SO2 and HCl leave as gases.' }),
  C('imine', 'Imine formation', 'carbonyl', {
    lhs: ['[#6,#1:8][C:1](=[O:2])[#6,#1:9]', '[H:3][N:4]([H:5])[#6:6]'], rhs: ['[#6,#1:8][C:1](=[N:4][#6:6])[#6,#1:9]', '[H:3][O:2][H:5]'],
    role: ['sub', 'sub'], byp: ['water'], ex: ['benzaldehyde', 'aniline', 'schiff'], cond: 'H+',
    tex: "RCHO + R'NH2 ->[H+] RCH=NR' + H2O",
    d: 'A primary amine adds to the carbonyl carbon. Mild acid helps the O-H group leave as water, and a C=N double bond forms (a Schiff base).' }),
  // ── substitution and elimination ─────────────────────────────────────────
  C('sn2', 'SN2 substitution by hydroxide', 'subst', {
    lhs: ['[C&X4:1][Cl,Br,I:2]', '[Na+:3].[O-:4][H:5]'], rhs: ['[C:1][O:4][H:5]', '[Na+:3].[Cl-,Br-,I-:2]'],
    role: ['sub', 'naoh'], byp: ['nabr'], ex: ['etbr', 'naoh', 'ethanol'], cond: 'H2O', below: '$\\Delta$',
    tex: 'R-X + NaOH -> R-OH + NaX',
    d: 'Hydroxide attacks the carbon from the side opposite the halogen. The new bond forms as the old one breaks, in one step, and the carbon turns inside out (Walden inversion).' }),
  C('amination', 'Haloalkane and ammonia', 'subst', {
    lhs: ['[C&X4:1][Br:2]', '[H:3][N:4]([H:5])[H:6]', '[H:7][N:8]([H:9])[H:10]'], rhs: ['[C:1][N:4]([H:5])[H:6]', '[H:3][N+:8]([H:7])([H:9])[H:10].[Br-:2]'],
    role: ['sub', 'nh3', 'nh3'], byp: ['nh4br'], ex: ['etbr', 'nh3', 'nh3', 'ethylamine'], cond: 'ethanol', below: 'sealed tube',
    tex: 'R-Br + 2NH3 -> R-NH2 + NH4Br',
    d: 'Ammonia is the nucleophile. A second ammonia takes the proton, so ammonium bromide forms. Excess ammonia keeps the product a primary amine.' }),
  C('alkoxide', 'Alkoxide from sodium hydride', 'subst', {
    lhs: ['[C&X4:1][O:2][H:3]', '[Na+:4].[H-:5]'], rhs: ['[C:1][O-:2].[Na+:4]', '[H:3][H:5]'],
    role: ['sub', 'nah'], byp: ['h2'], ex: ['ethanol', 'nah', 'naoet'], cond: 'THF',
    tex: 'ROH + NaH -> RONa + H2',
    d: 'Hydride is a very strong base. It takes the O-H proton and hydrogen gas bubbles off, which leaves a sodium alkoxide.' }),
  C('williamson', 'Williamson ether synthesis', 'subst', {
    lhs: ['[C,c:1][O-:2].[Na+:3]', '[C&X4:4][Br,I:5]'], rhs: ['[C,c:1][O:2][C:4]', '[Na+:3].[Br-,I-:5]'],
    role: ['sub', 'sub'], byp: ['nai'], ex: ['naoet', 'ch3i', 'methoxyethane'],
    tex: "RONa + R'X -> ROR' + NaX",
    d: 'An alkoxide ion attacks a primary haloalkane by SN2. The halide leaves and an ether forms.' }),
  C('roh-rx', 'Haloalkane from an alcohol', 'subst', {
    lhs: ['[C&X4:1][O:2][H:3]', '[H:4][Br,Cl:5]'], rhs: ['[C:1][Br,Cl:5]', '[H:3][O:2][H:4]'],
    role: ['sub', 'hbr'], byp: ['water'], ex: ['ethanol', 'hbr', 'etbr'], cond: 'H2SO4', below: '$\\Delta$',
    tex: 'R-OH + HBr -> R-Br + H2O',
    d: 'Acid protonates the O-H group so that it can leave as water. Bromide takes its place.' }),
  C('e2', 'E2 elimination', 'subst', {
    lhs: ['[H:1][C&X4:2][C&X4:3][Br,Cl,I:4]', '[K+:5].[O-:6][H:7]'], rhs: ['[C:2]=[C:3]', '[H:1][O:6][H:7]', '[K+:5].[Br-,Cl-,I-:4]'],
    role: ['sub', 'koh'], byp: ['water', 'kbr'], ex: ['ipbr', 'koh', 'propene'], cond: 'ethanol', below: '$\\Delta$',
    tex: 'H-C-C-X + KOH ->[ethanol][$\\Delta$] C=C + H2O + KX',
    d: 'A strong base in hot ethanol takes a proton next to the carbon that holds the halogen. The C=C bond forms as the halide leaves, all in one step.' }),
  C('dehydrate', 'Dehydration of an alcohol', 'subst', {
    lhs: ['[H:1][C&X4:2][C&X4:3][O:4][H:5]'], rhs: ['[C:2]=[C:3]', '[H:1][O:4][H:5]'],
    role: ['sub'], byp: ['water'], ex: ['ethanol', 'ethylene'], cond: 'conc. H2SO4', below: '$170\\,^{\\circ}\\mathrm{C}$',
    tex: 'R-CH2-CH2-OH ->[conc. H2SO4][$170\\,^{\\circ}\\mathrm{C}$] R-CH=CH2 + H2O',
    d: 'Hot concentrated acid protonates the O-H group, water leaves, and a proton is lost from the next carbon. An alkene forms.' }),
  // ── addition to alkenes ──────────────────────────────────────────────────
  C('hydrate', 'Alkene hydration', 'addition', {
    lhs: ['[C:1]=[C:2]', '[H:3][O:4][H:5]'], rhs: ['[H:3][C:1][C:2][O:4][H:5]'],
    role: ['sub', 'water'], byp: [], ex: ['propene', 'water', 'propan2ol'], cond: 'H3PO4', below: '$300\\,^{\\circ}\\mathrm{C}$', filter: 'markovnikov',
    tex: 'RCH=CH2 + H2O ->[H3PO4] RCH(OH)CH3',
    d: 'A proton adds to the alkene and makes the more stable carbocation. Water bonds to that carbon (Markovnikov rule). Steam and ethylene make industrial ethanol this way.' }),
  C('hydrogenate', 'Hydrogenation', 'addition', {
    lhs: ['[C:1]=[C:2]', '[H:3][H:4]'], rhs: ['[H:3][C:1][C:2][H:4]'],
    role: ['sub', 'h2'], byp: [], ex: ['ethylene', 'h2', 'ethane'], cond: 'Ni', below: '$150\\,^{\\circ}\\mathrm{C}$',
    tex: 'C=C + H2 ->[Ni] H-C-C-H',
    d: 'Hydrogen and the alkene both bind to the metal surface. Two hydrogen atoms add to the same face of the double bond.' }),
  C('halogenate', 'Halogen addition', 'addition', {
    lhs: ['[C:1]=[C:2]', '[Br,Cl:3][Br,Cl:4]'], rhs: ['[Br,Cl:3][C:1][C:2][Br,Cl:4]'],
    role: ['sub', 'br2'], byp: [], ex: ['ethylene', 'br2', 'dibromoethane'], cond: 'CH2Cl2',
    tex: 'C=C + Br2 -> BrC-CBr',
    d: 'The alkene attacks bromine and a three-membered bromonium ion forms. Bromide opens it from the far side (anti addition). The brown colour of bromine goes away, a classic test for C=C.' }),
  C('hx-add', 'Hydrogen halide addition', 'addition', {
    lhs: ['[C:1]=[C:2]', '[H:3][Br,Cl:4]'], rhs: ['[H:3][C:1][C:2][Br,Cl:4]'],
    role: ['sub', 'hbr'], byp: [], ex: ['propene', 'hbr', 'ipbr'], filter: 'markovnikov',
    tex: 'RCH=CH2 + HBr -> RCHBrCH3',
    d: 'The proton adds first, to the carbon that already has more hydrogens, so the more stable carbocation forms. Bromide then bonds to it (Markovnikov rule).' }),
  // ── oxidation and reduction ──────────────────────────────────────────────
  C('ox-primary', 'Oxidation of a primary alcohol to an aldehyde', 'redox', {
    lhs: ['[H:5][C&X4&H2,C&X4&H3:1]([H:6])[O:2][H:3]', '[O:4]'], rhs: ['[H:6][C:1]=[O:2]', '[H:5][O:4][H:3]'],
    role: ['sub', 'f:oform'], byp: ['water'], ex: ['ethanol', 'oform', 'acetaldehyde'], cond: 'PCC',
    tex: 'RCH2OH + [O] ->[PCC] RCHO + H2O',
    d: 'A mild oxidant (PCC) removes two hydrogen atoms: one from the O-H and one from the carbon. The aldehyde does not oxidise further without water.' }),
  C('ox-aldehyde', 'Oxidation of an aldehyde to an acid', 'redox', {
    lhs: ['[#6,#1:7][C:1](=[O:2])[H:5]', '[O:4]'], rhs: ['[#6,#1:7][C:1](=[O:2])[O:4][H:5]'],
    role: ['sub', 'f:oform'], byp: [], ex: ['acetaldehyde', 'oform', 'aceticacid'], cond: 'K2Cr2O7', below: 'H2SO4',
    tex: 'RCHO + [O] ->[K2Cr2O7][H2SO4] RCOOH',
    d: 'Acidified dichromate puts an oxygen into the C-H bond of the aldehyde. The orange dichromate turns green as chromium(III) forms.' }),
  C('ox-secondary', 'Oxidation of a secondary alcohol to a ketone', 'redox', {
    lhs: ['[H:5][C&X4&H1:1]([#6:8])([#6:9])[O:2][H:3]', '[O:4]'], rhs: ['[#6:8][C:1](=[O:2])[#6:9]', '[H:5][O:4][H:3]'],
    role: ['sub', 'f:oform'], byp: ['water'], ex: ['propan2ol', 'oform', 'acetone'], cond: 'K2Cr2O7', below: 'H2SO4',
    tex: "R2CHOH + [O] ->[K2Cr2O7][H2SO4] R2C=O + H2O",
    d: 'The carbon of a secondary alcohol has one hydrogen. The oxidant removes it with the O-H hydrogen, and a ketone forms. A ketone does not oxidise further.' }),
  C('reduce', 'Carbonyl reduction (sodium borohydride)', 'redox', {
    lhs: ['[#6,#1:8][C:1](=[O:2])[#6,#1:9]', '[H:3][H:4]'], rhs: ['[#6,#1:8][C:1]([H:3])([#6,#1:9])[O:2][H:4]'],
    role: ['sub', 'f:h2'], byp: [], ex: ['acetone', 'h2', 'propan2ol'], cond: 'NaBH4', below: 'MeOH',
    tex: 'R2C=O + 2[H] ->[NaBH4][MeOH] R2CHOH',
    d: 'Borohydride delivers a hydride ion to the carbonyl carbon. The solvent then gives a proton to the oxygen. Aldehydes give primary alcohols and ketones give secondary alcohols.' }),
  C('nitro-reduce', 'Reduction of a nitro group', 'redox', {
    lhs: ['[c:1][N+:2](=[O:3])[O-:4]', '[H:5][H:6]', '[H:7][H:8]', '[H:9][H:10]'], rhs: ['[c:1][N:2]([H:5])[H:6]', '[H:7][O:3][H:8]', '[H:9][O:4][H:10]'],
    role: ['sub', 'h2', 'h2', 'h2'], byp: ['water', 'water'], ex: ['nitrobenzene', 'h2', 'h2', 'h2', 'aniline'], cond: 'Pd/C',
    tex: 'ArNO2 + 3H2 ->[Pd/C] ArNH2 + 2H2O',
    d: 'Three molecules of hydrogen on a palladium surface remove both oxygens as water and leave an amino group. Tin and hydrochloric acid do the same in the lab.' }),
  // ── aromatic substitution ────────────────────────────────────────────────
  C('nitrate', 'Nitration', 'arom', {
    lhs: ['[c:1][H:2]', '[H:3][O:4][N+:5](=[O:6])[O-:7]'], rhs: ['[c:1][N+:5](=[O:6])[O-:7]', '[H:2][O:4][H:3]'],
    role: ['sub', 'hno3'], byp: ['water'], ex: ['benzene', 'hno3', 'nitrobenzene'], cond: 'conc. H2SO4', below: '$50\\,^{\\circ}\\mathrm{C}$', filter: 'eas',
    tex: 'ArH + HNO3 ->[H2SO4] ArNO2 + H2O',
    d: 'Sulfuric acid makes the nitronium ion NO2+ from nitric acid. The ring attacks it and then loses a proton, so the ring stays aromatic.' }),
  C('fc-acyl', 'Friedel-Crafts acylation', 'arom', {
    lhs: ['[c:1][H:2]', '[#6:5][C:3](=[O:6])[Cl:4]'], rhs: ['[c:1][C:3](=[O:6])[#6:5]', '[H:2][Cl:4]'],
    role: ['sub', 'sub'], byp: ['hcl'], ex: ['benzene', 'acetylcl', 'acetophenone'], cond: 'AlCl3', filter: 'eas',
    tex: 'ArH + RCOCl ->[AlCl3] ArCOR + HCl',
    d: 'Aluminium chloride pulls chloride off the acyl chloride and leaves an acylium ion. The ring attacks it and loses a proton. An aryl ketone forms.' }),
  C('fc-alkyl', 'Friedel-Crafts alkylation', 'arom', {
    lhs: ['[c:1][H:2]', '[C&X4:3][Cl,Br:4]'], rhs: ['[c:1][C:3]', '[H:2][Cl,Br:4]'],
    role: ['sub', 'sub'], byp: ['hcl'], ex: ['benzene', 'etcl', 'ethylbenzene'], cond: 'AlCl3', filter: 'eas',
    tex: 'ArH + RCl ->[AlCl3] ArR + HCl',
    d: 'Aluminium chloride makes the alkyl group positive enough for the ring to attack. Real reactions can rearrange the carbocation and add more than one alkyl group. This model shows one.' }),
  C('kolbe', 'Kolbe-Schmitt carboxylation', 'arom', {
    lhs: ['[c:1]([O:2][H:3])[c:4][H:5]', '[O:6]=[C:7]=[O:8]'], rhs: ['[c:1]([O:2][H:3])[c:4][C:7](=[O:6])[O:8][H:5]'],
    role: ['sub', 'co2'], byp: [], ex: ['phenol', 'co2', 'salicylic'], cond: 'NaOH, CO2', below: '$125\\,^{\\circ}\\mathrm{C}$, 100 atm; H+',
    tex: 'C6H5OH + CO2 ->[1. NaOH, CO2][2. H+] HOC6H4COOH',
    d: 'Sodium phenoxide is very electron rich. Under heat and pressure it adds carbon dioxide next to the oxygen. Acid then gives salicylic acid, the start of aspirin.' }),
  // ── carbon-carbon bond formation ─────────────────────────────────────────
  C('grignard-make', 'Grignard reagent formation', 'cc', {
    lhs: ['[C,c:1][Br:2]', '[Mg:3]'], rhs: ['[C,c:1][Mg:3][Br:2]'],
    role: ['sub', 'mg'], byp: [], ex: ['etbr', 'mg', 'etmgbr'], cond: 'dry ether',
    tex: 'R-Br + Mg ->[dry ether] R-MgBr',
    d: 'Magnesium metal goes in between carbon and bromine. The carbon becomes strongly nucleophilic, like a carbanion. Water must be kept out.' }),
  C('grignard', 'Grignard addition', 'cc', {
    lhs: ['[#6,#1:8][C:1](=[O:2])[#6,#1:9]', '[#6:3][Mg:4][Br:5]', '[H:6][O:7][H:10]'], rhs: ['[#6,#1:8][C:1]([#6:3])([#6,#1:9])[O:2][H:6]', '[H:10][O:7][Mg:4][Br:5]'],
    role: ['sub', 'sub', 'water'], byp: ['mgohbr'], ex: ['acetone', 'etmgbr', 'water', 'tamyl'], cond: '1. dry ether', below: '2. H3O+',
    tex: "R2C=O + R'MgBr ->[1. ether][2. H3O+] R2C(OH)R' + Mg(OH)Br",
    d: 'The carbon of the Grignard reagent attacks the carbonyl carbon and a new C-C bond forms. Water then gives the alkoxide a proton. A ketone gives a tertiary alcohol.' }),
  C('aldol', 'Aldol addition', 'cc', {
    lhs: ['[H:1][C&X4:2][C:3](=[O:4])[#6,#1:9]', '[#6,#1:5][C:6](=[O:7])[#6,#1:8]'], rhs: ['[#6,#1:9][C:3](=[O:4])[C:2][C:6]([#6,#1:5])([#6,#1:8])[O:7][H:1]'],
    role: ['sub', 'sub'], byp: [], ex: ['acetaldehyde', 'acetaldehyde', 'hydroxybutanal'], cond: 'NaOH (aq)', below: '$5\\,^{\\circ}\\mathrm{C}$',
    tex: "2RCH2CHO ->[NaOH] RCH2CH(OH)CH(R)CHO",
    d: 'Base takes a proton from the carbon next to a carbonyl and makes an enolate. The enolate carbon attacks a second carbonyl. A beta-hydroxy carbonyl forms.' }),
  C('aldol-cond', 'Aldol condensation', 'cc', {
    lhs: ['[H:1][C&X4:2]([H:10])[C:3](=[O:4])[#6,#1:9]', '[#6,#1:5][C:6](=[O:7])[#6,#1:8]'], rhs: ['[#6,#1:9][C:3](=[O:4])[C:2]=[C:6]([#6,#1:5])[#6,#1:8]', '[H:1][O:7][H:10]'],
    role: ['sub', 'sub'], byp: ['water'], ex: ['acetaldehyde', 'acetaldehyde', 'crotonaldehyde'], cond: 'NaOH', below: '$\\Delta$',
    tex: "2RCH2CHO ->[NaOH][$\\Delta$] RCH2CH=C(R)CHO + H2O",
    d: 'Heat takes the aldol product one step further: water leaves and a C=C double bond forms in conjugation with the carbonyl.' }),
  C('claisen', 'Claisen condensation', 'cc', {
    lhs: ['[H:1][C&X4:2][C:3](=[O:4])[O:5][#6:6]', '[#6,#1:7][C:8](=[O:9])[O:10][C&X4:11]'], rhs: ['[#6:6][O:5][C:3](=[O:4])[C:2][C:8](=[O:9])[#6,#1:7]', '[H:1][O:10][C:11]'],
    role: ['sub', 'sub'], byp: ['ethanol'], ex: ['ethylacetate', 'ethylacetate', 'acetoacetate'], cond: '1. NaOEt', below: '2. H3O+',
    tex: "2CH3COOC2H5 ->[1. NaOEt][2. H3O+] CH3COCH2COOC2H5 + C2H5OH",
    d: 'An ester enolate attacks the carbonyl of a second ester. The alkoxide leaves and a beta-keto ester forms.' }),
  C('diels-alder', 'Diels-Alder cycloaddition', 'cc', {
    lhs: ['[C:1]=[C:2][C:3]=[C:4]', '[C:5]=[C:6]'], rhs: ['[C:1]1[C:2]=[C:3][C:4][C:6][C:5]1'],
    role: ['sub', 'sub'], byp: [], ex: ['butadiene', 'ethylene', 'cyclohexene'], below: '$\\Delta$',
    tex: 'diene + dienophile ->[][$\\Delta$] cyclohexene',
    d: 'A diene and an alkene join in one step through a ring of six atoms. Three pi bonds become two sigma bonds and one new pi bond. An electron-poor dienophile such as maleic anhydride reacts fastest.' }),
  C('wittig', 'Wittig reaction', 'cc', {
    lhs: ['[#6,#1:8][C:1](=[O:2])[#6,#1:9]', '[C:3]=[P:4]'], rhs: ['[#6,#1:8][C:1](=[C:3])[#6,#1:9]', '[O:2]=[P:4]'],
    role: ['sub', 'ylide'], byp: ['ph3po'], ex: ['benzaldehyde', 'ylide', 'styrene'], cond: 'THF',
    tex: 'R2C=O + Ph3P=CH2 -> R2C=CH2 + Ph3PO',
    d: 'The ylide carbon attacks the carbonyl. A four-membered ring of C, C, P and O forms and breaks apart. The very strong P=O bond drives the reaction.' }),
  C('suzuki', 'Suzuki coupling', 'cc', {
    lhs: ['[c:1][Br:2]', '[c:3][B:4]([O:5][H:6])[O:7][H:8]', '[Na+:9].[O-:10][H:11]'], rhs: ['[c:1][c:3]', '[Na+:9].[Br-:2]', '[H:6][O:5][B:4]([O:7][H:8])[O:10][H:11]'],
    role: ['sub', 'sub', 'naoh'], byp: ['nabr', 'boh3'], ex: ['bromobenzene', 'phboh2', 'naoh', 'biphenyl'], cond: 'Pd(PPh3)4',
    tex: "ArBr + Ar'B(OH)2 + NaOH ->[Pd(PPh3)4] Ar-Ar' + NaBr + B(OH)3",
    d: 'Palladium goes into the C-Br bond, takes the second aryl group from boron, and joins the two aryl groups. The palladium is set free to start again.' }),
  // ── overall equations ────────────────────────────────────────────────────
  C('combustion', 'Complete combustion', 'overall', {
    kind: 'overall', fuel: true, ex: ['methane'], cond: 'spark', retro: false,
    tex: 'CxHyOz + O2 -> CO2 + H2O',
    d: 'A fuel that holds only carbon, hydrogen and oxygen burns in excess oxygen to carbon dioxide and water. The equation is an overall balance; the real path is a chain of radical steps.' }),
  C('fermentation', 'Ethanol fermentation', 'overall', {
    kind: 'overall', lhsQ: [['glucose', 1]], rhsQ: [['ethanol', 2], ['co2', 2]], cond: 'yeast', below: '$37\\,^{\\circ}\\mathrm{C}$', retro: false,
    tex: 'C6H12O6 ->[yeast] 2C2H5OH + 2CO2',
    d: 'Yeast enzymes split glucose through glycolysis into pyruvate and then into ethanol and carbon dioxide. This is the overall equation of about twelve enzyme steps.' }),
  C('haber', 'Haber process', 'overall', {
    kind: 'overall', lhsQ: [['n2', 1], ['h2', 3]], rhsQ: [['nh3', 2]], arrow: '<=>', cond: 'Fe', below: '$450\\,^{\\circ}\\mathrm{C}$, 200 atm', retro: false,
    tex: 'N2 + 3H2 <=>[Fe][450 °C] 2NH3',
    d: 'Nitrogen and hydrogen combine on an iron catalyst. High pressure moves the equilibrium toward ammonia. Most fertiliser nitrogen comes from this reaction.' }),
];
export const CLASS = Object.fromEntries(CLASSES.map(c => [c.id, c]));

// ── named syntheses: steps in order; a step: [class, [lhs species]] ─────────
export const NAMED = [
  { id: 'aspirin', name: 'Aspirin from phenol', target: 'aspirin',
    d: 'Phenol takes up carbon dioxide (Kolbe-Schmitt) to give salicylic acid. Acetic anhydride then puts an acetyl group on the phenol oxygen.',
    steps: [['kolbe', ['phenol', 'co2']], ['anhydride-o', ['salicylic', 'ac2o']]] },
  { id: 'paracetamol', name: 'Paracetamol from phenol', target: 'paracetamol',
    d: 'Nitration of phenol, reduction of the nitro group, then acetylation of the amine.',
    steps: [['nitrate', ['phenol', 'hno3'], 'nitrophenol4'], ['nitro-reduce', ['nitrophenol4', 'h2', 'h2', 'h2']], ['anhydride-n', ['aminophenol4', 'ac2o']]] },
  { id: 'soap', name: 'Soap from a fat', target: 'glycerol',
    d: 'Hot sodium hydroxide cuts the three ester bonds of tristearin one by one. Each cut sets free one sodium stearate (soap); glycerol is left at the end.',
    steps: [['saponify', ['tristearin', 'naoh'], 'distearin'], ['saponify', ['distearin', 'naoh'], 'monostearin'], ['saponify', ['monostearin', 'naoh'], 'glycerol']] },
  { id: 'nylon', name: 'Nylon-6,6: one amide link', target: 'nylonlink',
    d: 'Adipic acid and hexamethylenediamine join by an amide bond and lose water. Repeated thousands of times, the step makes nylon-6,6.',
    steps: [['amide', ['adipic', 'hmda']]] },
  { id: 'fermentation', name: 'Ethanol by fermentation', target: 'ethanol', d: 'Yeast turns glucose into ethanol and carbon dioxide.', steps: [['fermentation', ['glucose']]] },
  { id: 'haber', name: 'Ammonia: the Haber process', target: 'nh3', d: 'Nitrogen from air and hydrogen combine on iron.', steps: [['haber', ['n2', 'h2']]] },
  { id: 'grignard', name: 'A tertiary alcohol by Grignard', target: 'tamyl',
    d: 'Ethylene and HBr give bromoethane. Magnesium makes the Grignard reagent, which adds to acetone. Water work-up gives 2-methylbutan-2-ol.',
    steps: [['hx-add', ['ethylene', 'hbr']], ['grignard-make', ['etbr', 'mg']], ['grignard', ['acetone', 'etmgbr', 'water']]] },
  { id: 'diels', name: 'Diels-Alder with maleic anhydride', target: 'thpa',
    d: 'Butadiene and maleic anhydride join in one step into a six-membered ring.',
    steps: [['diels-alder', ['butadiene', 'maleican']]] },
  { id: 'ester', name: 'Ethyl acetate from ethylene', target: 'ethylacetate',
    d: 'Ethylene and steam give ethanol. Part of the ethanol is oxidised to acetic acid, and the two make the ester.',
    steps: [['hydrate', ['ethylene', 'water']], ['ox-primary', ['ethanol', 'oform']], ['ox-aldehyde', ['acetaldehyde', 'oform']], ['fischer', ['aceticacid', 'ethanol']]] },
  { id: 'styrene', name: 'Styrene by a Wittig reaction', target: 'styrene', d: 'Benzaldehyde and the methylene ylide give styrene and triphenylphosphine oxide.', steps: [['wittig', ['benzaldehyde', 'ylide']]] },
];

// ── basic compounds: [species, rank 1 bulk .. 3 lab reagent] ────────────────
export const BASICS = [
  ['water', 1], ['h2', 1], ['o2', 1], ['n2', 1], ['co2', 1], ['nh3', 1], ['hcl', 1], ['hbr', 2], ['naoh', 1], ['koh', 1], ['nah', 3], ['mg', 2],
  ['br2', 2], ['cl2', 1], ['hno3', 1], ['socl2', 3], ['methane', 1], ['methanol', 1], ['ethanol', 1], ['aceticacid', 1], ['ethylene', 1], ['propene', 1],
  ['butadiene', 1], ['benzene', 1], ['toluene', 1], ['phenol', 1], ['formaldehyde', 1], ['acetaldehyde', 2], ['acetone', 1], ['benzaldehyde', 2],
  ['ch3cl', 2], ['ch3br', 2], ['ch3i', 3], ['etbr', 2], ['etcl', 2], ['bromobenzene', 2], ['ac2o', 2], ['ylide', 3], ['glucose', 1], ['maleican', 2],
  ['oform', 1],
];

// ── declined targets ───────────────────────────────────────────────────────
// Explosives, chemical-weapon agents and precursors, and controlled drugs.
// The page and the worker decline these as targets and never pass through
// them. Species by SMILES (stereo ignored) and patterns (smarts.js) for
// whole families.
export const BLOCK = {
  smiles: [
    'Cc1c(cc(cc1[N+](=O)[O-])[N+](=O)[O-])[N+](=O)[O-]', 'C(C(CO[N+](=O)[O-])O[N+](=O)[O-])O[N+](=O)[O-]',
    'C1N(CN(CN1[N+](=O)[O-])[N+](=O)[O-])[N+](=O)[O-]', 'C(C(CO[N+](=O)[O-])(CO[N+](=O)[O-])CO[N+](=O)[O-])O[N+](=O)[O-]',
    'CC1(C)OOC(C)(C)OOC(C)(C)OO1', 'Oc1c(cc(cc1[N+](=O)[O-])[N+](=O)[O-])[N+](=O)[O-]',
    'CNC(C)Cc1ccccc1', 'CC(N)Cc1ccccc1', 'CNC(C)Cc1ccc2OCOc2c1', 'CC(=O)Cc1ccccc1', 'C=CCc1ccc2OCOc2c1', 'CNC(C)C(O)c1ccccc1',
    'OCCCC(=O)O', 'CN1C2CCC1C(C(=O)OC)C(OC(=O)c1ccccc1)C2', 'CCC(=O)N(c1ccccc1)C1CCN(CCc2ccccc2)CC1',
    'CC(C)OP(C)(=O)F', 'CC(C(C)(C)C)OP(C)(=O)F', 'CCOP(=O)(C#N)N(C)C', 'CCOP(C)(=O)SCCN(C(C)C)C(C)C', 'ClCCSCCCl', 'OCCSCCO',
    'CP(=O)(F)F', 'O=C(Cl)Cl', 'ClC(Cl)(Cl)[N+](=O)[O-]', 'C#N', 'ClCCN(CCCl)CCCl',
  ],
  patterns: [
    ['[#6][O][N+](=[O])[O-]', 'a nitrate ester (explosive)'],
    ['[O][O]', 'a peroxide (explosive)'],
    ['[N]=[N+]=[N-]', 'an azide (explosive)'],
    ['[P]~[F]', 'a P-F agent (nerve agent family)'],
    ['[Cl][C][C][S,N][C][C][Cl]', 'a mustard agent'],
    ['[c][C&X4][C&X4]([C&X4])[N&X3]', 'an amphetamine'],
  ],
  minNitro: 2,
};
