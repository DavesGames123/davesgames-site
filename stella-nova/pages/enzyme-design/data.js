// ============================================================================
//  DATA  ·  facts about AlphaProtein Novo (ES module, data only)
// ----------------------------------------------------------------------------
//  Two sources, and the page keeps them apart.
//
//  PAPER. Wu, Abramson, Frerix et al., "Designing enzymes for new-to-nature
//  chemistry and non-natural substrates with AlphaProtein Novo", bioRxiv
//  2026.10.01.756017, posted 5 October 2026. The preprint is All Rights
//  Reserved: openRxiv records "The material may not be redistributed,
//  re-used or adapted without the author's permission". So this page quotes
//  no sentence and copies no figure. It states claims in its own words and
//  links to the preprint. Only the abstract is public, so NO catalytic rate,
//  success rate or design count is given here. Do not add one without the
//  full text.
//
//  REPO. github.com/google-deepmind/alphaprotein-novo. Its README documents
//  the pipeline, the manifest fields, the example campaigns and the metric
//  names. Those are the REPO facts below. The repository splits its own
//  licensing four ways, and the page must not blur them:
//    software ........ Apache-2.0
//    documentation ... CC-BY 4.0 ("All other materials")
//    model weights ... AP Novo Parameters Terms of Use, downloaded apart
//    model outputs ... AP Novo Outputs Terms of Use
//  This site ships no weights and no model output.
//
//  AUTHOR LIST, AFFILIATIONS AND DATE come from the public bioRxiv record
//  (api.biorxiv.org details entry and the JATS metadata of the preprint),
//  not from the preprint body. The author count is 37, which the README
//  BibTeX author field and the bioRxiv author list agree on.
//
//  grep -n targets
//    paper ............. "export const PAPER"
//    pipeline stages ... "export const STAGES"
//    campaigns ......... "export const CAMPAIGNS"
//    metrics ........... "export const METRICS"
//    manifest .......... "export const KEMP_MANIFEST"
//    licences .......... "export const LICENCES"
// ============================================================================

export const PAPER = {
  title: 'Designing enzymes for new-to-nature chemistry and non-natural substrates with AlphaProtein Novo',
  short: 'AlphaProtein Novo',
  authorCount: 37,
  lead: 'Wu, Abramson, Frerix et al.',
  groups: 'Google DeepMind, California Institute of Technology, University of Pittsburgh',
  venue: 'bioRxiv preprint 2026.10.01.756017',
  posted: '2026-10-05',
  doi: '10.64898/2026.10.01.756017',
  url: 'https://www.biorxiv.org/content/10.64898/2026.10.01.756017v1',
  code: 'https://github.com/google-deepmind/alphaprotein-novo',
  // Claims of the abstract, in our own words. Nothing here is a quotation.
  claims: [
    { id: 'outperform', text: 'A de novo design pipeline addressed hard chemistry better than mining natural sequences for a starting point. The authors state this is the first such demonstration.' },
    { id: 'nitrene', text: 'Designed new-to-nature nitrene transferases make the drug building block piperidine, with product selectivity the authors call unprecedented.' },
    { id: 'dehp', text: 'Designed enzymes break down the pollutant DEHP in conditions that unfold natural enzymes.' },
    { id: 'model', text: 'On two well-studied model reactions the designs reach catalytic efficiencies the authors describe as state of the art.' },
    { id: 'enablers', text: 'What made it work, found by repeated rounds of design and analysis: metrics drawn from the reaction mechanism and computed on AlphaFold 3 predictions, and scoring a backbone by an ensemble of sequences rather than one.' },
  ],
};

// REPO. The four stages of run_pipeline.py.
export const STAGES = [
  { id: 'generate', n: 1, script: 'run_generator.py', label: 'Generate',
    what: 'A diffusion model makes a protein backbone and a first sequence at the same time, held to the catalytic motif and the ligand.',
    out: '01_generation/: structure (.cif, .pdb), re-indexed motif, sequence (.fa)' },
  { id: 'resequence', n: 2, script: 'run_ligandmpnn.py', label: 'Resequence', optional: true,
    what: 'LigandMPNN rewrites the sequence for the fixed backbone, with the ligand in context. Default sampling temperature 0.1.',
    out: '02_resequence/: one structure and sequence per new sequence' },
  { id: 'fold', n: 3, script: 'run_alphafold.py', label: 'Fold',
    what: 'AlphaFold 3 predicts the structure of the designed sequence, once per reaction state and per seed. The default weights are AF3-LA, tuned for leaving atoms, because designs often hold a covalent intermediate.',
    out: '03_folded/: predicted structure and confidences per state and seed' },
  { id: 'evaluate', n: 4, script: 'evaluate_design.py', label: 'Evaluate',
    what: 'Metrics compare the prediction with the design: does it fold back to the shape that was drawn, and does the active site survive?',
    out: '04_eval/: per-design JSON and evaluation_summary.csv' },
];

// REPO. Diffusion settings documented in the README.
export const DIFFUSION = {
  totalSteps: 1000,
  // Partial diffusion: how far back to go from a parent design, and the
  // similarity that follows. TM-score runs 0 to 1; the README gives these
  // as approximate.
  partial: [
    { steps: 600, tm: 95, note: 'small changes around the parent' },
    { steps: 900, tm: 80, note: 'a much freer redesign' },
  ],
  parentExample: { steps: 575, parent: 'GDM_DEHP_0176', child: 'GDM_DEHP_0376' },
};

// REPO. The six example campaigns, with the design each one targets.
export const CAMPAIGNS = [
  { id: 'kemp', dir: 'kemp_eliminase', label: 'Kemp eliminase', design: 'GDM_KE_1483',
    motif: 'A glutamate to take the proton, a serine to hold the forming negative charge, and a 6-nitrobenzotriazole analogue of the transition state.',
    states: ['monomer', 'complex'], suite: 'kemp_eliminase',
    note: 'A model reaction with no natural counterpart. Also shipped as an unindexed variant.' },
  { id: 'serine', dir: 'serine_esterase', label: '4MU-Ac serine esterase', design: 'GDM_SE_2937',
    motif: 'A Ser-His-Asp triad from cutinase 1xzm, three oxyanion-hole donors, and the tetrahedral intermediate of 4-methylumbelliferyl acetate.',
    states: ['monomer', 'es', 'complex', 'aei', 'ti2'], suite: 'serine_esterase',
    note: 'Folded in all five states of the reaction, so the metrics can follow the chemistry.' },
  { id: 'dehp', dir: 'dehp_esterase_denovo', label: 'DEHP esterase, new scaffold', design: 'GDM_DEHP_0176',
    motif: 'A Ser-His-Asp triad from kexin 1r64, two oxyanion-hole donors, and the tetrahedral intermediate of bis(2-ethylhexyl) phthalate.',
    states: ['monomer', 'es', 'complex', 'aei', 'ti2'], suite: 'dehp_esterase',
    note: 'DEHP is a plasticiser and a pollutant.' },
  { id: 'dehp2', dir: 'dehp_esterase_partial_diffusion', label: 'DEHP esterase, partial diffusion', design: 'GDM_DEHP_0376',
    motif: 'The same chemistry, started from the parent design GDM_DEHP_0176 instead of from noise.',
    states: ['monomer', 'es', 'complex', 'aei', 'ti2'], suite: 'dehp_esterase',
    note: 'Noises the parent back to the level of step 575 of 1000, then runs the reverse from there.' },
  { id: 'carbene', dir: 'carbene_transferase', label: 'Carbene transferase', design: 'GDM_CT_0103',
    motif: 'A histidine below a haem, with the transition state and product of a (1S,2S) cyclopropanation.',
    states: ['monomer', 'complex'], suite: 'carbene_transferase',
    note: 'New-to-nature chemistry on an iron cofactor.' },
  { id: 'nitrene', dir: 'nitrene_transferase', label: 'Nitrene transferase', design: 'GDM_NT_0151',
    motif: 'A histidine below a haem, with the substrate bound to the cofactor.',
    states: ['monomer', 'complex', 'heme_substrate', 'heme_piperidine_R', 'heme_pyrrolidine_S', 'fiveazidopentylbenzene_heme_1', 'fiveazidopentylbenzene_heme_2'],
    suite: 'nitrene_transferase',
    note: 'Seven folding states. The metrics include which ring the enzyme makes, five-membered or six-membered.' },
];

// REPO. Metric names from evaluate_design.py, grouped as the README groups
// them. 'toy' says whether this page computes something of the same shape.
export const METRICS = [
  { group: 'Self-consistency', key: 'rmsd', label: 'C-alpha RMSD', what: 'Distance between the predicted model and the backbone that was designed.', unit: 'A', lower: true, toy: true },
  { group: 'Self-consistency', key: 'tm_score', label: 'TM-score', what: 'Fold-level agreement, 0 to 1.', lower: false, toy: true },
  { group: 'Self-consistency', key: 'lddt', label: 'lDDT', what: 'Agreement of local distances.', lower: false, toy: false },
  { group: 'Self-consistency', key: 'gdt_ha', label: 'GDT-HA', what: 'Share of atoms within tight distance cutoffs.', lower: false, toy: false },
  { group: 'Motif', key: 'motif_allatom_rmsd', label: 'Motif all-atom RMSD', what: 'Did the catalytic side chains stay where the chemistry needs them? Side-chain symmetry is allowed for.', unit: 'A', lower: true, toy: true },
  { group: 'Motif', key: 'motif_bb_aligned_allatom_rmsd', label: 'Motif RMSD, backbone aligned', what: 'The same, after aligning the active-site backbone first.', unit: 'A', lower: true, toy: false },
  { group: 'Pocket', key: 'mean_pocket_bb_aligned_ligand_rmsd', label: 'Ligand RMSD in the pocket', what: 'Does the ligand sit where it was placed, once the pocket backbone is aligned?', unit: 'A', lower: true, toy: true },
  { group: 'Pocket', key: 'percent_ligand_bb_clashes_1_5', label: 'Ligand clashes', what: 'Share of ligand atoms closer than 1.5 A to the backbone.', unit: '%', lower: true, toy: true },
  { group: 'Confidence', key: 'plddt', label: 'pLDDT', what: 'How sure AlphaFold 3 is about each atom, 0 to 100.', lower: false, toy: false },
  { group: 'Confidence', key: 'ptm', label: 'pTM / ipTM', what: 'Predicted TM-score for the chain and for the interface.', lower: false, toy: false },
];

// REPO. examples/kemp_eliminase/kemp_manifest.json, the fields the page
// shows. The page's own editor writes a manifest of the same shape.
export const KEMP_MANIFEST = {
  defaults: { num_designs: 2, seed_start: 0, num_sampling_steps: 1000 },
  design: {
    name: 'kemp_eliminase', output_prefix: 'kemp',
    description: 'Kemp eliminase from same motif as GDM_KE_1483',
    motif_str: 'A1,A2|10-100,{},2-80,{},10-100/B1',
    motif_atoms: 'A1:OE2,OE1,CD,CG A2:OG,CB,CA',
    seq_length: '120-160',
  },
  resequence: { enabled: true, temperature: 0.1, num_sequences: 2, use_side_chain_context: false },
  folding: { seeds: [0, 1, 2, 3, 4], states: ['monomer', 'complex'] },
  evaluation: { suite: 'kemp_eliminase' },
};

export const LICENCES = [
  { what: 'Pipeline source code', terms: 'Apache-2.0', can: 'Read it, run it, build on it, with the notice kept.' },
  { what: 'Repository documentation', terms: 'CC-BY 4.0', can: 'The README facts this page states, used with attribution.' },
  { what: 'Generator model weights', terms: 'AP Novo Parameters Terms of Use', can: 'Downloaded separately from Google Cloud Storage. Not in the repository, and not on this site.' },
  { what: 'Model outputs', terms: 'AP Novo Outputs Terms of Use', can: 'Anything the model produced carries its own terms.' },
  { what: 'The preprint', terms: 'All rights reserved', can: 'Read it at the link. This page quotes no sentence of it and copies no figure.' },
];
