// ============================================================================
//  PROTEIN VIEWER  ·  presets.js — the preset structures and their views
// ────────────────────────────────────────────────────────────────────────────
//  No DOM and no THREE. Each preset names a vendored file in data/ and the
//  view that shows what is interesting about it:
//    rep        cartoon | trace | ballstick | licorice | spacefill | surface
//    color      chain | ss | residue | hydro | bfactor | plddt | rainbow | element
//    chains     the chains to show (all when absent)
//    sticks     selectors drawn as ball-and-stick on top of the main rep
//    focus      the selector the camera frames and the card opens on
//    surface    surface opacity, when the rep is a surface
//  A selector is 'A:23' (a residue), 'A:20-30' (a range), 'A' (a chain) or
//  'lig:RET' (every residue with that name).
//
//  grep: export const GROUPS  export const PRESETS  id:
// ============================================================================

export const GROUPS = [
  { id: 'vision', label: 'Vision and membranes' },
  { id: 'folds', label: 'Landmark folds' },
  { id: 'fast', label: 'Fast folders' },
  { id: 'oxygen', label: 'Oxygen carriers' },
  { id: 'drugs', label: 'Enzymes and drugs' },
  { id: 'nucleic', label: 'DNA, RNA and chromatin' },
  { id: 'machines', label: 'Large assemblies' },
  { id: 'af', label: 'AlphaFold predictions' },
];

export const PRESETS = [
  // ── vision and membranes ────────────────────────────────────────────────
  {
    id: 'rhodopsin', group: 'vision', title: 'Rhodopsin', code: '1U19', file: '1U19.pdb.gz',
    why: 'The dim-light photoreceptor of the rod cell, and the archetype of the GPCR family.',
    about: 'Seven transmembrane helices hold 11-cis-retinal (sticks) on Lys296 as a protonated Schiff base. One photon isomerises it to all-trans in about 200 fs, the helices move, and transducin is activated. Bovine rhodopsin was the first GPCR solved at high resolution (Palczewski 2000); this 2.2 Å structure is the refined dark state.',
    rep: 'cartoon', color: 'rainbow', chains: ['A'], focus: null, sticks: ['lig:RET'],
  },
  {
    id: 'p23h', group: 'vision', title: 'Rhodopsin P23H site', code: '1U19', file: '1U19.pdb.gz',
    why: 'Pro23→His is the most common rhodopsin mutation in autosomal dominant retinitis pigmentosa in North America.',
    about: 'This is the wild-type protein: residue 23 is a proline, highlighted here with its 5 Å neighbourhood. Pro23 sits in the N-terminal domain on the intradiscal side, packed against the β-hairpin of extracellular loop 2 that caps the retinal pocket like a plug. P23H opsin misfolds: in cells most of it stays in the endoplasmic reticulum, binds 11-cis-retinal poorly, and is degraded or aggregates, and rods die over years. Retinoids such as 9-cis-retinal act as pharmacological chaperones and improve folding in cells and animal models. The structure shows why a buried, packed site is sensitive; it does not model the mutant itself.',
    rep: 'cartoon', color: 'ss', chains: ['A'], focus: 'A:23', sticks: ['A:23', 'lig:RET'],
  },
  {
    id: 'retinal', group: 'vision', title: 'Retinal pocket', code: '1U19', file: '1U19.pdb.gz',
    why: 'Where light becomes chemistry: the Schiff base on Lys296 and its counterion Glu113.',
    about: 'Glu113 balances the positive charge of the protonated Schiff base and tunes the absorbance to about 500 nm. Glu181 on the extracellular loop and Trp265 (the toggle switch) line the pocket. Mutations at Gly90 and Ala292 near the Schiff base shift the colour and cause congenital night blindness.',
    rep: 'cartoon', color: 'hydro', chains: ['A'], focus: 'lig:RET', sticks: ['lig:RET', 'A:296', 'A:113', 'A:181', 'A:265', 'A:90'],
  },
  {
    id: 'metaII', group: 'vision', title: 'Metarhodopsin II', code: '3PQR', file: '3PQR.pdb.gz',
    why: 'The active state, holding a peptide from the C-terminus of transducin Gα in its open cytoplasmic cleft.',
    about: 'Light-activated rhodopsin with all-trans-retinal. Compared with the dark state, transmembrane helix 6 has swung out about 6 Å, which opens the crevice where the Gα C-terminal peptide (chain B, sticks) binds. This outward TM6 move is the common activation step of class A GPCRs.',
    rep: 'cartoon', color: 'chain', focus: 'B', sticks: ['B', 'lig:RET'],
  },
  {
    id: 'kcsa', group: 'vision', title: 'KcsA potassium channel', code: '1BL8', file: '1BL8.pdb.gz',
    why: 'The selectivity filter TVGYG passes K⁺ 10,000× faster than the smaller Na⁺.',
    about: 'Four identical subunits make a pore. Backbone carbonyl oxygens of Thr75–Gly79 (sticks) line the filter and replace the water shell of a dehydrated K⁺ ion exactly; Na⁺ is too small to fit the cage. Ions in the filter are drawn as spheres. MacKinnon, Nobel Prize in Chemistry 2003.',
    rep: 'cartoon', color: 'chain', focus: 'A:77', sticks: ['A:75-79', 'B:75-79', 'C:75-79', 'D:75-79'],
  },

  // ── landmark folds ──────────────────────────────────────────────────────
  {
    id: 'crambin', group: 'folds', title: 'Crambin', code: '1CRN', file: '1CRN.pdb.gz',
    why: '46 residues and three disulfides: a standard test case for modelling and refinement.',
    about: 'A small seed-storage protein from Abyssinian cabbage. Its crystals diffract beyond 0.5 Å, so crambin is a common benchmark for refinement, quantum chemistry and structure prediction. Two helices and a small β-sheet are held together by the Cys3–Cys40, Cys4–Cys32 and Cys16–Cys26 bridges.',
    rep: 'ballstick', color: 'element', focus: null, sticks: [],
  },
  {
    id: 'myoglobin', group: 'folds', title: 'Myoglobin', code: '1MBN', file: '1MBN.pdb.gz',
    why: 'Kendrew\'s sperm whale myoglobin: the first protein structure ever solved (1958).',
    about: 'Eight helices (A–H) wrap a heme group. The proximal His93 binds the iron from below; the distal His64 sits over the oxygen site. Kendrew and Perutz shared the 1962 Nobel Prize in Chemistry. This entry is the refined 2 Å model.',
    rep: 'cartoon', color: 'ss', focus: 'lig:HEM', sticks: ['lig:HEM', 'A:93', 'A:64'],
  },
  {
    id: 'ubiquitin', group: 'folds', title: 'Ubiquitin', code: '1UBQ', file: '1UBQ.pdb.gz',
    why: 'A 76-residue tag whose chain type decides a protein\'s fate.',
    about: 'Chains linked through Lys48 send proteins to the proteasome; chains through Lys63 signal in DNA repair and immune pathways. The hydrophobic patch at Ile44, Leu8 and Val70 is where most receptors bind. The β-grasp fold is very stable and has been used in many folding studies.',
    rep: 'cartoon', color: 'rainbow', focus: null, sticks: ['A:48', 'A:63', 'A:44', 'A:8', 'A:70'],
  },
  {
    id: 't4l', group: 'folds', title: 'T4 lysozyme', code: '2LZM', file: '2LZM.pdb.gz',
    why: 'The protein of a thousand mutants: Matthews\' lab measured how each change shifts stability.',
    about: 'Glu11 and Asp20 are the catalytic pair that cuts the bacterial cell wall. The L99A mutation opens a cavity in the C-terminal domain that binds benzene and became a model pocket for ligand-binding calculations. T4L is also the fusion partner that helped crystallise the first engineered GPCRs.',
    rep: 'cartoon', color: 'ss', focus: 'A:99', sticks: ['A:11', 'A:20', 'A:99'],
  },
  {
    id: 'tim', group: 'folds', title: 'Triosephosphate isomerase', code: '1TIM', file: '1TIM.pdb.gz',
    why: 'The TIM barrel: eight β/α units in a ring, the most common enzyme fold.',
    about: 'TIM is a "perfect" enzyme whose rate is limited by diffusion. Glu165 and His95 move the protons between the two triose phosphates. Rainbow colour from blue (N-terminus) to red shows the eight strands in order round the barrel.',
    rep: 'cartoon', color: 'rainbow', chains: ['A'], focus: null, sticks: ['A:165', 'A:95', 'A:12'],
  },
  {
    id: 'gb1', group: 'folds', title: 'Protein G B1', code: '1PGA', file: '1PGA.pdb.gz',
    why: '56 residues, one helix packed on a four-stranded sheet: a folding and design benchmark.',
    about: 'The B1 domain of streptococcal protein G binds the Fc part of antibodies. It folds in milliseconds, is very stable, and has been a test case for NMR methods, computational design and deep mutational scanning.',
    rep: 'cartoon', color: 'rainbow', focus: null, sticks: [],
  },
  {
    id: 'collagen', group: 'folds', title: 'Collagen triple helix', code: '1CAG', file: '1CAG.pdb.gz',
    why: 'Three polyproline II chains wound round each other, with a Gly→Ala defect like those in brittle-bone disease.',
    about: 'Every third residue must be glycine, because only glycine fits at the crowded centre of the triple helix. This peptide, (Pro-Hyp-Gly)₄-Pro-Hyp-Ala-(Pro-Hyp-Gly)₅, has one alanine there; the helix stays but its hydration and H-bonds are disturbed near Ala15. Glycine substitutions like this cause osteogenesis imperfecta.',
    rep: 'licorice', color: 'chain', focus: 'A:15', sticks: ['A:15', 'B:45', 'C:75'],
  },
  {
    id: 'gfp', group: 'folds', title: 'Green fluorescent protein', code: '1EMA', file: '1EMA.pdb.gz',
    why: 'An 11-strand β-can that makes its own chromophore from Ser65-Tyr66-Gly67.',
    about: 'The chromophore forms by cyclisation and oxidation of three residues inside the barrel, which shields it from water and holds it rigid so it fluoresces. This variant (S65T) is brighter and excites at 488 nm. Shimomura, Chalfie and Tsien, Nobel Prize in Chemistry 2008.',
    rep: 'cartoon', color: 'ss', focus: 'lig:CRO', sticks: ['lig:CRO', 'A:96', 'A:222', 'A:148'],
  },

  // ── fast folders ────────────────────────────────────────────────────────
  {
    id: 'trpcage', group: 'fast', title: 'Trp-cage', code: '1L2Y', file: '1L2Y.pdb.gz',
    why: 'A designed 20-residue miniprotein that folds in about 4 μs.',
    about: 'Trp6 is caged by Pro12, Pro18 and Pro19 and the short helix. Its small size and fast folding made it one of the first proteins folded from scratch in all-atom molecular dynamics. NMR model 1 of 38.',
    rep: 'cartoon', color: 'rainbow', focus: 'A:6', sticks: ['A:6', 'A:12', 'A:18', 'A:19'],
  },
  {
    id: 'villin', group: 'fast', title: 'Villin headpiece', code: '1VII', file: '1VII.pdb.gz',
    why: '36 residues, three helices and a core of three phenylalanines: a benchmark for folding simulations.',
    about: 'HP35 folds in a few microseconds. Phe47, Phe51 and Phe58 form its hydrophobic core. It was the target of Duan and Kollman\'s first microsecond simulation (1998) and of Folding@home.',
    rep: 'cartoon', color: 'rainbow', focus: null, sticks: ['A:47', 'A:51', 'A:58'],
  },

  // ── oxygen carriers ─────────────────────────────────────────────────────
  {
    id: 'oxymb', group: 'oxygen', title: 'Oxymyoglobin', code: '1MBO', file: '1MBO.pdb.gz',
    why: 'O₂ bound to heme iron, with the distal His64 donating an H-bond to it.',
    about: 'His64 stabilises bound O₂ and discriminates against CO, which would otherwise bind about 20,000 times more tightly than O₂ to free heme. His93 holds the iron from the proximal side.',
    rep: 'cartoon', color: 'ss', focus: 'lig:OXY', sticks: ['lig:HEM', 'lig:OXY', 'A:64', 'A:93'],
  },
  {
    id: 'deoxyhb', group: 'oxygen', title: 'Deoxyhaemoglobin (T state)', code: '4HHB', file: '4HHB.pdb.gz',
    why: 'Perutz\'s α₂β₂ tetramer in the low-affinity T state: the textbook of allostery.',
    about: 'Without oxygen the iron sits out of the heme plane and salt bridges lock the tetramer in the T state. Compare the oxy (R) preset: binding O₂ pulls the iron into the plane, moves the proximal His, and rotates one αβ dimer about 15° against the other.',
    rep: 'cartoon', color: 'chain', focus: null, sticks: ['lig:HEM'],
  },
  {
    id: 'oxyhb', group: 'oxygen', title: 'Oxyhaemoglobin (R state)', code: '1HHO', file: '1HHO.pdb.gz',
    why: 'The high-affinity R state with O₂ on each heme.',
    about: 'The asymmetric unit holds one αβ dimer; the full tetramer comes from the crystal symmetry. The O₂ ligands (sticks) sit on the distal side of each heme. Cooperative binding gives the sigmoid oxygen curve that lets blood load O₂ in the lungs and release it in tissue.',
    rep: 'cartoon', color: 'chain', focus: 'lig:OXY', sticks: ['lig:HEM', 'lig:OXY'],
  },

  // ── enzymes and drugs ───────────────────────────────────────────────────
  {
    id: 'hivpr', group: 'drugs', title: 'HIV-1 protease + indinavir', code: '1HSG', file: '1HSG.pdb.gz',
    why: 'Structure-based design of protease inhibitors turned HIV into a treatable disease.',
    about: 'The enzyme is a symmetric dimer; Asp25 of each chain makes the catalytic pair. The two flaps (residues 45–55) close over the drug. Indinavir (MK1) fills the active site and mimics the transition state of peptide cleavage.',
    rep: 'cartoon', color: 'chain', focus: 'lig:MK1', sticks: ['lig:MK1', 'A:25', 'B:25'],
  },
  {
    id: 'imatinib', group: 'drugs', title: 'Abl kinase + imatinib', code: '1IEP', file: '1IEP.pdb.gz',
    why: 'Imatinib (Gleevec) binds an inactive kinase form and changed chronic myeloid leukaemia treatment.',
    about: 'Imatinib (STI) binds the DFG-out conformation of the Abl kinase domain, a shape that few other kinases adopt, which gives it selectivity. Thr315 is the gatekeeper: the T315I mutation removes an H-bond to the drug and blocks binding, the main resistance mechanism.',
    rep: 'cartoon', color: 'ss', chains: ['A'], focus: 'lig:STI', sticks: ['lig:STI', 'A:315', 'A:381', 'A:286'],
  },
  {
    id: 'mpro', group: 'drugs', title: 'SARS-CoV-2 main protease + N3', code: '6LU7', file: '6LU7.cif.gz',
    why: 'The first SARS-CoV-2 drug target solved (January 2020), with a covalent peptide inhibitor.',
    about: 'Mpro cuts the viral polyproteins at 11 sites. The inhibitor N3 (chain C, sticks) forms a covalent bond to Cys145; His41 is the other half of the catalytic dyad. This structure guided the design of nirmatrelvir (in Paxlovid). Loaded from mmCIF.',
    rep: 'cartoon', color: 'ss', focus: 'C', sticks: ['C', 'A:145', 'A:41'],
  },
  {
    id: 'pka', group: 'drugs', title: 'Protein kinase A + ATP', code: '1ATP', file: '1ATP.pdb.gz',
    why: 'The first protein kinase structure: the template for all 500+ human kinases.',
    about: 'ATP sits in the cleft between the small and the large lobe. Lys72 and Glu91 form the salt bridge of an active kinase, Asp184 of the DFG motif binds the Mn²⁺ ions, and the inhibitor peptide PKI (chain I) occupies the substrate groove.',
    rep: 'cartoon', color: 'ss', focus: 'lig:ATP', sticks: ['lig:ATP', 'E:72', 'E:91', 'E:184', 'E:166'],
  },
  {
    id: 'trypsin', group: 'drugs', title: 'Trypsin + BPTI', code: '2PTC', file: '2PTC.pdb.gz',
    why: 'A protease and its inhibitor bound so tightly (Kd ~ 10⁻¹⁴ M) that the complex hardly ever dissociates.',
    about: 'Lys15 of BPTI (chain I) goes into the S1 pocket of trypsin and pairs with Asp189 at its base. The catalytic triad Ser195–His57–Asp102 is in place but cannot finish cleavage. A model for how protease inhibitors work.',
    rep: 'cartoon', color: 'chain', focus: 'I:15', sticks: ['I:15', 'E:195', 'E:57', 'E:102', 'E:189'],
  },
  {
    id: 'adkclosed', group: 'drugs', title: 'Adenylate kinase, closed', code: '1AKE', file: '1AKE.pdb.gz',
    why: 'The lids close over a bisubstrate inhibitor: a classic of conformational change.',
    about: 'The LID (residues 122–159) and the NMP-binding domain (30–59) clamp down on Ap5A, which mimics ATP and AMP together. Compare with the open preset: the domains move by more than 20 Å. Adenylate kinase is a standard test for transition-path methods.',
    rep: 'cartoon', color: 'rainbow', chains: ['A'], focus: 'lig:AP5', sticks: ['lig:AP5'],
  },
  {
    id: 'adkopen', group: 'drugs', title: 'Adenylate kinase, open', code: '4AKE', file: '4AKE.pdb.gz',
    why: 'The same enzyme with no ligand: the lids stand open.',
    about: 'Without substrates the LID and NMP domains swing away from the core. The enzyme samples the closed form even without ligand, and that motion limits its rate.',
    rep: 'cartoon', color: 'rainbow', chains: ['A'], focus: null, sticks: [],
  },
  {
    id: 'streptavidin', group: 'drugs', title: 'Streptavidin + biotin', code: '1STP', file: '1STP.pdb.gz',
    why: 'One of the strongest non-covalent bonds in biology (Kd ~ 10⁻¹⁴ M), used everywhere in labs.',
    about: 'Biotin sits deep in a β-barrel, with Trp79, Trp92 and Trp108 packed round it and an H-bond network to its ureido ring. A loop (residues 45–52) closes over the pocket.',
    rep: 'cartoon', color: 'rainbow', focus: 'lig:BTN', sticks: ['lig:BTN', 'A:79', 'A:92', 'A:108', 'A:43'],
  },
  {
    id: 'insulin', group: 'drugs', title: 'Insulin hexamer', code: '4INS', file: '4INS.pdb.gz',
    why: 'Dorothy Hodgkin\'s insulin: the storage hexamer is held together by zinc.',
    about: 'Two zinc ions on the three-fold axis each bind three HisB10 side chains. The asymmetric unit holds two insulin molecules (chains A–B and C–D); the full hexamer comes from the crystal symmetry. Fast-acting insulin analogues weaken this assembly.',
    rep: 'cartoon', color: 'chain', focus: 'B:10', sticks: ['B:10', 'D:10'],
  },
  {
    id: 'barnase', group: 'drugs', title: 'Barnase + barstar', code: '1BRS', file: '1BRS.pdb.gz',
    why: 'A ribonuclease and its inhibitor: the model system for protein–protein association.',
    about: 'Their binding is very fast because the surfaces are electrostatically complementary: basic barnase (Arg59, Arg83, Arg87, His102) meets acidic barstar (Asp35, Asp39). Fersht\'s group used double-mutant cycles here to measure each contact.',
    rep: 'surface', color: 'chain', chains: ['A', 'D'], focus: 'D:39', sticks: ['A:59', 'A:83', 'A:87', 'A:102', 'D:35', 'D:39'], surface: 0.55,
  },

  // ── DNA, RNA and chromatin ──────────────────────────────────────────────
  {
    id: 'bdna', group: 'nucleic', title: 'B-DNA dodecamer', code: '1BNA', file: '1BNA.pdb.gz',
    why: 'The Dickerson–Drew dodecamer: the first full turn of B-DNA solved by crystallography.',
    about: 'CGCGAATTCGCG. The structure showed real sequence-dependent variation of the double helix, and a narrow minor groove in the AATT centre lined by a spine of water. Spacefill shows the major and minor grooves.',
    rep: 'spacefill', color: 'residue', focus: null, sticks: [],
  },
  {
    id: 'trna', group: 'nucleic', title: 'tRNA-Phe', code: '1EHZ', file: '1EHZ.cif.gz',
    why: 'The L-shaped adaptor between the genetic code and amino acids.',
    about: 'Yeast phenylalanine tRNA has many modified nucleotides (pseudouridine, wybutosine at 37, methylated G). The anticodon Gm34-A35-A36 is at one end of the L, the CCA acceptor 72 Å away at the other. Loaded from mmCIF.',
    rep: 'cartoon', color: 'rainbow', focus: 'A:35', sticks: ['A:34-37', 'A:74-76'],
  },
  {
    id: 'nucleosome', group: 'nucleic', title: 'Nucleosome core', code: '1KX5', file: '1KX5.pdb.gz',
    why: '147 base pairs of DNA wrapped 1.65 turns round a histone octamer: the unit of chromatin.',
    about: 'Two copies each of H2A, H2B, H3 and H4 form the octamer. Arginines insert into the minor groove each time it faces the core. Histone tails leave between the DNA gyres; their modifications regulate gene expression.',
    rep: 'cartoon', color: 'chain', focus: null, sticks: [],
  },
  {
    id: 'p53dna', group: 'nucleic', title: 'p53 core domain on DNA', code: '1TUP', file: '1TUP.pdb.gz',
    why: 'The tumour suppressor most often mutated in cancer, gripping its DNA site.',
    about: 'Arg248 enters the minor groove and Arg273 contacts the backbone: both are top cancer hotspots, and mutation removes a DNA contact. Arg175 is a structural hotspot that holds the zinc-binding loops in place. Compare with the AlphaFold model of full-length p53.',
    rep: 'cartoon', color: 'chain', focus: 'B:248', sticks: ['B:248', 'B:273', 'B:175', 'lig:ZN'],
  },

  // ── large assemblies ────────────────────────────────────────────────────
  {
    id: 'spike', group: 'machines', title: 'SARS-CoV-2 spike', code: '6VXX', file: '6VXX.pdb.gz',
    why: 'The fusion machine of the coronavirus and the antigen of the COVID-19 vaccines.',
    about: 'A cryo-EM structure of the prefusion trimer with all three receptor-binding domains down (closed). The N-linked glycans (sticks) shield much of the surface from antibodies. Asp614 (the D614G variant site) is highlighted on chain A. 23,700 atoms.',
    rep: 'cartoon', color: 'chain', focus: null, sticks: ['lig:NAG', 'A:614'],
  },
  {
    id: 'groel', group: 'machines', title: 'GroEL–GroES chaperonin', code: '1AON', file: '1AON.pdb.gz',
    why: 'A folding chamber: 14 GroEL subunits in two rings, capped by GroES.',
    about: 'An unfolded protein enters the ring, ATP binds, the GroES lid closes, and the protein folds in a protected cage for about 10 s. The capped ring has much larger domain movements than the open ring. Trimmed to Cα atoms (8,000 residues), so the cartoon is drawn from the Cα trace.',
    rep: 'cartoon', color: 'chain', focus: null, sticks: [],
  },

  // ── AlphaFold predictions ───────────────────────────────────────────────
  {
    id: 'afp53', group: 'af', title: 'p53, full length (AlphaFold)', code: 'AF-P04637', file: 'AF-P04637.pdb.gz',
    why: 'High confidence for the DNA-binding core; very low for the disordered N- and C-terminal tails.',
    about: 'pLDDT (stored in the B-factor column) is AlphaFold\'s per-residue confidence: blue > 90, light blue 70–90, yellow 50–70, orange < 50. Low pLDDT often marks intrinsically disordered regions like the p53 transactivation domain, which folds only on binding a partner. The low-confidence tails are not a real structure.',
    rep: 'cartoon', color: 'plddt', focus: null, sticks: [],
  },
  {
    id: 'afsyn', group: 'af', title: 'α-Synuclein (AlphaFold)', code: 'AF-P37840', file: 'AF-P37840.pdb.gz',
    why: 'An intrinsically disordered protein that aggregates into the Lewy bodies of Parkinson\'s disease.',
    about: 'AlphaFold predicts a long helix with low-to-medium confidence: free α-synuclein is disordered, but it becomes helical on lipid membranes. The Ala53→Thr mutation (sticks) causes familial Parkinson\'s disease. In fibrils the NAC region (61–95) forms the β core, which this prediction does not show.',
    rep: 'cartoon', color: 'plddt', focus: 'A:53', sticks: ['A:53'],
  },
  {
    id: 'afegfr', group: 'af', title: 'EGFR (AlphaFold)', code: 'AF-P00533', file: 'AF-P00533.pdb.gz',
    why: 'A receptor tyrosine kinase: confident domains joined by low-confidence linkers.',
    about: 'Extracellular domains, one transmembrane helix, the kinase, and a disordered C-terminal tail. The relative placement of the domains has low confidence even where each domain is high. Leu858 and Thr790 in the kinase are the L858R driver and T790M resistance sites of lung cancer.',
    rep: 'cartoon', color: 'plddt', focus: 'A:858', sticks: ['A:858', 'A:790'],
  },
];

export const byId = id => PRESETS.find(p => p.id === id);
