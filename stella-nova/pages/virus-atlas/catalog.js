// ============================================================================
//  VIRUS ATLAS  ·  catalog.js — the entries of the atlas
// ----------------------------------------------------------------------------
//  No DOM: tests.mjs reads this file. Each entry names one structure from
//  the Protein Data Bank (data/<pdb>.bin, made by tools/build-data.py), or
//  an illustration made from several (a virion: spikes on a membrane).
//
//  ENTRY FIELDS
//    key, name, group, pdb      pdb is the data file; 'parts' for a virion
//    look     capsid | rod | cone | protein | fibril | virion
//    disease, host, size        plain text for the card
//    sym      plain text for the symmetry line
//    T        { h, k, T, hand } for an icosahedral capsid (quasi-equivalence)
//    copies   { entity text, n } the subunit count the tests check
//    blurb    two or three sentences
//    note     what the model leaves out, or why it is an illustration
//    illus    true when the page draws something that is not in the PDB
//    membrane { r } a lipid shell drawn under the protein (an illustration)
//    layers   the fibril layers to draw (the screw makes them)
//
//  GROUPS lists the groups in order. CREDIT has the entry facts that the
//  build checked against RCSB (title, first authors, year, DOI).
//
//  grep -n targets: "export const GROUPS", "export const ENTRIES",
//                   "export const CREDIT", "export function entryByKey"
// ============================================================================

export const GROUPS = [
  { id: 'virus', label: 'Whole capsids' },
  { id: 'virion', label: 'Enveloped virions (illustrations)' },
  { id: 'protein', label: 'Viral proteins' },
  { id: 'prion', label: 'Prions' },
  { id: 'amyloid', label: 'Other amyloids (not prions)' },
];

export const ENTRIES = [
  // ── whole capsids ──────────────────────────────────────────────────────
  { key: 'polio', name: 'Poliovirus', group: 'virus', pdb: '1HXS', look: 'capsid',
    disease: 'Poliomyelitis', host: 'Humans', size: '≈ 30 nm',
    sym: 'Icosahedral, pseudo T = 3: 60 protomers of VP1, VP2, VP3 and VP4',
    T: { h: 1, k: 1, T: 3, pseudo: true },
    copies: { text: 'VP1–VP4 chains', n: 240 },
    blurb: 'A small, non-enveloped RNA virus (a picornavirus). Sixty copies each of VP1, VP2 and VP3 make the shell; VP4 lines its inside. Three different proteins fill the three quasi-equivalent positions of a T = 3 lattice, so the shell is called pseudo T = 3.',
    note: 'The RNA genome inside is not in the model.' },
  { key: 'rhino', name: 'Rhinovirus 14', group: 'virus', pdb: '4RHV', look: 'capsid',
    disease: 'Common cold', host: 'Humans', size: '≈ 30 nm',
    sym: 'Icosahedral, pseudo T = 3: 60 protomers',
    T: { h: 1, k: 1, T: 3, pseudo: true },
    copies: { text: 'VP1–VP4 chains', n: 240 },
    blurb: 'A cousin of poliovirus and the most common cause of colds. A depression, the "canyon", rings each 5-fold axis; the cell receptor ICAM-1 binds in it. This was one of the first virus structures solved at near-atomic detail (Rossmann lab, 1985).',
    note: 'The RNA genome is not in the model.' },
  { key: 'noro', name: 'Norovirus (Norwalk)', group: 'virus', pdb: '1IHM', look: 'capsid',
    disease: 'Acute gastroenteritis ("stomach flu")', host: 'Humans', size: '≈ 38 nm',
    sym: 'Icosahedral, T = 3: 180 copies of VP1',
    T: { h: 1, k: 1, T: 3 },
    copies: { text: 'VP1 chains', n: 180 },
    blurb: 'One protein, VP1, makes the whole shell: 90 dimers whose protruding (P) domains stand up as arches. The same chain sits in three slightly different environments (A, B and C), the classic case of quasi-equivalence.',
    note: 'A virus-like particle made from VP1 alone, so it has no genome.' },
  { key: 'hbv', name: 'Hepatitis B core', group: 'virus', pdb: '1QGT', look: 'capsid',
    disease: 'Hepatitis B (liver cirrhosis and cancer)', host: 'Humans', size: '≈ 34 nm (core)',
    sym: 'Icosahedral, T = 4: 240 copies of the core protein',
    T: { h: 2, k: 0, T: 4 },
    copies: { text: 'core protein chains', n: 240 },
    blurb: 'The inner core of hepatitis B virus. Core-protein dimers make the spikes: each spike is a four-helix bundle. In the virus a lipid envelope with surface antigen (HBsAg) wraps this core, for a particle of about 42 nm.',
    note: 'Residues 1–149 of the core protein; the envelope and DNA genome are not in the model.' },
  { key: 'hpv', name: 'Human papillomavirus 16', group: 'virus', pdb: '3J6R', look: 'capsid',
    disease: 'Cervical and other cancers; warts', host: 'Humans', size: '≈ 55–60 nm',
    sym: 'Icosahedral, T = 7d: 72 pentamers of L1 (360 chains)',
    T: { h: 2, k: 1, T: 7, hand: 'd' },
    copies: { text: 'L1 chains', n: 360 },
    blurb: 'All 72 capsomeres are pentamers of L1, even the 60 that sit on 6-coordinated places of the T = 7 lattice, so this capsid breaks quasi-equivalence. HPV vaccines are virus-like particles of this same L1 shell.',
    note: 'A model fitted into a 9.1 Å cryo-EM map; the minor protein L2 and the DNA are not in it.' },
  { key: 'adeno', name: 'Human adenovirus 5', group: 'virus', pdb: '6CGV', look: 'capsid',
    disease: 'Colds, conjunctivitis; also a vaccine vector', host: 'Humans', size: '≈ 90 nm',
    sym: 'Icosahedral, pseudo T = 25: 240 hexon trimers and 12 penton bases',
    T: { h: 5, k: 0, T: 25, pseudo: true },
    copies: { text: 'hexon chains', n: 720 },
    blurb: 'A large DNA virus with no envelope. Hexon trimers tile the 20 faces, a penton base sits on each 5-fold vertex, and minor proteins (IIIa, VIII, IX, VI) cement the shell from outside and inside.',
    note: 'The long fibres that stick out of the vertices are not ordered in the crystal and are not in the model.' },
  { key: 'zika', name: 'Zika virus', group: 'virus', pdb: '5IRE', look: 'capsid',
    disease: 'Zika fever; congenital Zika syndrome (microcephaly)', host: 'Humans (by mosquitoes)', size: '≈ 50 nm',
    sym: 'Icosahedral: 180 E and 180 M in a herringbone of 90 E dimers',
    copies: { text: 'E chains', n: 180 },
    membrane: { r: 17.5 },
    blurb: 'An enveloped flavivirus, but the proteins on its surface lie flat and make an icosahedral shell. Three E dimers lie side by side in a raft, and 30 rafts make the herringbone. M sits under E in the membrane.',
    note: 'The lipid bilayer is drawn as a shell; it is not in the PDB model. The RNA and capsid protein inside are not in the model.',
    illus: true },
  { key: 'hk97', name: 'Bacteriophage HK97', group: 'virus', pdb: '1OHG', look: 'capsid',
    disease: 'None in people: it infects E. coli', host: 'Bacteria (E. coli)', size: '≈ 60–65 nm',
    sym: 'Icosahedral, T = 7l: 420 copies of gp5',
    T: { h: 2, k: 1, T: 7, hand: 'l' },
    copies: { text: 'gp5 chains', n: 420 },
    blurb: 'A virus of bacteria. When the head matures, each gp5 forms a covalent bond to its neighbour, and the rings of bonded subunits interlock like chain mail (a protein catenane). Many phages and herpesviruses share this HK97 fold.',
    note: 'The empty, mature head. The tail and the portal vertex are not in this crystal structure.' },
  { key: 'tmv', name: 'Tobacco mosaic virus', group: 'virus', pdb: '4UDV', look: 'rod',
    disease: 'Mosaic disease of tobacco and other plants', host: 'Plants', size: '300 × 18 nm',
    sym: 'Helical: 16.33 subunits per turn, 2.3 nm pitch; ≈ 2130 subunits',
    copies: { text: 'coat protein subunits', n: 2130 },
    blurb: 'The first virus found (1892–1898) and the first seen in an electron microscope. Coat proteins stack in a helix around a single RNA, three nucleotides per subunit. The page builds the full 300 nm rod from the helical symmetry of the cryo-EM model.',
    note: 'The deposited model has one subunit and its RNA; the page repeats it 2130 times with the deposited twist and rise. The build animation is an illustration: TMV assembly starts at an internal origin on the RNA and runs both ways.',
    illus: true },
  { key: 'hiv-cone', name: 'HIV-1 capsid cone', group: 'virus', pdb: '3J3Q', look: 'cone',
    disease: 'HIV infection and AIDS', host: 'Humans', size: '≈ 120 × 60 nm',
    sym: 'A fullerene cone: 216 CA hexamers and 12 CA pentamers (1356 chains)',
    copies: { text: 'CA chains', n: 1356 },
    blurb: 'Inside the HIV envelope, the capsid protein CA builds a cone around the RNA genome. Hexamers tile the surface and exactly 12 pentamers close it, seven at the wide end and five at the narrow end, as in a fullerene.',
    note: 'An all-atom model built from cryo-EM of CA assemblies and molecular dynamics (Zhao et al. 2013), not one imaged capsid. The assembly animation is an illustration.' },

  // ── enveloped virions (illustrations) ─────────────────────────────────
  { key: 'sars2-virion', name: 'SARS-CoV-2 virion', group: 'virion', look: 'virion',
    disease: 'COVID-19', host: 'Humans', size: '≈ 90 nm envelope; spikes to ≈ 130 nm',
    sym: 'No overall symmetry: spikes stand on a lipid envelope',
    parts: [{ pdb: '6VSB', count: 26, stalk: 7 }], membrane: { r: 45 }, tilt: 0.4,
    blurb: 'An illustration made from real parts: copies of the prefusion spike (6VSB) stand on stalks on a membrane sphere. Cryo-electron tomography of intact virions found a 91 nm envelope with about 24 ± 9 spikes, many tilted on flexible hinges (Ke et al. 2020).',
    note: 'The membrane, the stalks, the spike positions and the sway are drawn by this page. The M, E and N proteins and the RNA are not shown.',
    illus: true },
  { key: 'flu-virion', name: 'Influenza A virion', group: 'virion', look: 'virion',
    disease: 'Influenza', host: 'Humans, birds, pigs', size: '≈ 100 nm',
    sym: 'No overall symmetry: HA and NA spikes on a lipid envelope',
    parts: [{ pdb: '1RUZ', count: 260, stalk: 1 }, { pdb: '2HTY', count: 40, stalk: 6 }], membrane: { r: 50 }, tilt: 0.12,
    blurb: 'An illustration made from real parts: the 1918 hemagglutinin (HA, 1RUZ) and an H5N1 neuraminidase head (NA, 2HTY) packed on a membrane sphere. HA binds sialic acid on cells; NA cuts it to set new virions free. HA spikes outnumber NA several-fold.',
    note: 'Spike counts, the membrane and the stalks are drawn by this page. Real virions vary in size and shape (some are long filaments). M1, M2 and the genome are not shown.',
    illus: true },

  // ── viral proteins ────────────────────────────────────────────────────
  { key: 'spike', name: 'SARS-CoV-2 spike', group: 'protein', pdb: '6VSB', look: 'protein',
    disease: 'COVID-19', host: 'Humans', size: '≈ 17 nm (modelled ectodomain)',
    sym: 'Trimer, pseudo C3: one receptor-binding domain up',
    blurb: 'The prefusion spike that the virus uses to enter cells, from the first weeks of the pandemic (Wrapp et al. 2020). One of its three receptor-binding domains (RBDs) is raised, ready to bind ACE2. Most vaccines teach the immune system this shape.',
    note: 'A stabilised construct (two prolines). Sugars show as one bead each.' },
  { key: 'rbd-ace2', name: 'Spike RBD on ACE2', group: 'protein', pdb: '6M0J', look: 'protein',
    disease: 'COVID-19', host: 'Humans', size: '≈ 11 nm',
    sym: 'A 1:1 complex',
    blurb: 'The receptor-binding domain of the spike bound to the human receptor ACE2 (its peptidase domain). This interface decides which cells the virus can enter, and many neutralising antibodies block it.',
    note: 'ACE2 is the gold chain; the RBD the virus colour.' },
  { key: 'ha', name: 'Influenza hemagglutinin (1918)', group: 'protein', pdb: '1RUZ', look: 'protein',
    disease: 'Influenza (the 1918 pandemic)', host: 'Humans', size: '≈ 13 nm tall',
    sym: 'Trimer of HA1–HA2, C3',
    blurb: 'The hemagglutinin of the 1918 pandemic virus, made from the gene sequence recovered from preserved 1918 tissue. HA1 makes the head that binds sialic acid; HA2 makes the stem that later drives fusion of the viral and cell membranes.',
    note: 'The membrane anchor is not in the construct.' },
  { key: 'na', name: 'Influenza neuraminidase N1', group: 'protein', pdb: '2HTY', look: 'protein',
    disease: 'Influenza (H5N1)', host: 'Birds, humans', size: '≈ 10 nm across',
    sym: 'Tetramer, C4',
    blurb: 'The head of the N1 neuraminidase from an H5N1 bird-flu virus. Its four active sites cut sialic acid so new virions can leave the cell. Oseltamivir (Tamiflu) and zanamivir block these sites.',
    note: 'The stalk and membrane anchor are not in the construct.' },
  { key: 'env', name: 'HIV-1 Env trimer', group: 'protein', pdb: '4TVP', look: 'protein',
    disease: 'HIV infection and AIDS', host: 'Humans', size: '≈ 12 nm tall (trimer)',
    sym: 'Trimer of gp120–gp41, C3, with two antibody Fabs per protomer',
    blurb: 'The only viral protein on the HIV surface, in its prefusion shape (BG505 SOSIP.664). A dense coat of sugars, the glycan shield, hides most of it. Two broadly neutralising antibodies (PGT122 at the top, 35O22 at the gp120–gp41 interface) are bound.',
    note: 'A stabilised soluble trimer. Antibodies show in grey; hide them in the panel.' },
  { key: 'hiv-ca', name: 'HIV-1 CA hexamer', group: 'protein', pdb: '3H47', look: 'protein',
    disease: 'HIV infection and AIDS', host: 'Humans', size: '≈ 10 nm across',
    sym: 'Hexamer, C6',
    blurb: 'Six capsid (CA) proteins, the building block of the cone. The N-terminal domains make a ring in the middle with a pore; the C-terminal domains on the outside link to the next hexamers.',
    note: 'A cross-linked, engineered hexamer that crystallises; the cone uses the same building block.' },
  { key: 'ebola', name: 'Ebola glycoprotein', group: 'protein', pdb: '5JQ3', look: 'protein',
    disease: 'Ebola virus disease', host: 'Humans, bats', size: '≈ 11 nm',
    sym: 'Trimer of GP1–GP2, C3',
    blurb: 'The spike of Ebola virus. GP1 binds the receptor NPC1 deep in the cell; GP2 then fuses the membranes. This structure was solved with the drug toremifene bound in a pocket between GP1 and GP2.',
    note: 'The mucin-like domain and the membrane anchor are not in the construct.' },
  { key: 'rabies', name: 'Rabies glycoprotein', group: 'protein', pdb: '7U9G', look: 'protein',
    disease: 'Rabies', host: 'Mammals', size: '≈ 12 nm',
    sym: 'Trimer, pseudo C3, with three Fabs of RVA122',
    blurb: 'The prefusion trimer of the rabies G protein, the only protein on the rabies virus surface and the target of rabies vaccines. The antibody RVA122 holds the trimer in its prefusion shape.',
    note: 'Antibodies show in grey; hide them in the panel.' },
  { key: 'measles', name: 'Measles hemagglutinin', group: 'protein', pdb: '2ZB6', look: 'protein',
    disease: 'Measles', host: 'Humans', size: '≈ 10 nm',
    sym: 'Dimer of the head domain, C2',
    blurb: 'The receptor-binding head of measles H. A six-bladed β-propeller binds the cell receptors SLAM and nectin-4. Its main antibody sites change very little, one reason the measles vaccine stays effective.',
    note: 'The stalk is not in the construct.' },

  // ── prions ────────────────────────────────────────────────────────────
  { key: 'prp', name: 'Human prion protein (PrPᶜ)', group: 'prion', pdb: '1QLX', look: 'protein',
    disease: 'Normal cellular form: not a disease state', host: 'Humans', size: '≈ 3–4 nm (folded domain)',
    sym: 'One chain: three α-helices and a short β-sheet',
    blurb: 'The normal, folded prion protein of human cells (PrPᶜ). In prion diseases, such as Creutzfeldt–Jakob disease, kuru and fatal familial insomnia, the same chain refolds into the β-rich fibril form (PrPˢᶜ) that templates more of itself.',
    note: 'NMR model 1. The flexible N-terminal tail (residues 23–124) is not ordered, so it has no beads.' },
  { key: 'prion-263k', name: '263K prion fibril', group: 'prion', pdb: '7LNA', look: 'fibril', layers: 60,
    disease: 'Scrapie (hamster-adapted 263K strain)', host: 'Hamsters', size: '≈ 10 nm wide',
    sym: 'Cross-β fibril: one PrP chain per layer, 4.9 Å rise',
    blurb: 'The first near-atomic structure of an infectious mammalian prion, purified from the brains of sick hamsters (Kraus et al. 2021). Each layer is one whole PrP chain folded flat; layers stack by hydrogen bonds into a cross-β fibril.',
    note: 'The deposited model has 3 layers; the page stacks 60 with the fitted screw. The growth animation shows templated addition at the ends as an illustration, not a simulated path.',
    illus: true },
  { key: 'prion-rml', name: 'RML prion fibril', group: 'prion', pdb: '7QIG', look: 'fibril', layers: 60,
    disease: 'Scrapie (mouse-adapted RML strain)', host: 'Mice', size: '≈ 10 nm wide',
    sym: 'Cross-β fibril: one PrP chain per layer, 4.8 Å rise',
    blurb: 'An infectious prion fibril purified from mouse brain (Manka et al. 2022). Compare it with 263K: the same protein folds into a different flat layer, and strains of prion disease follow these different folds.',
    note: 'The deposited model has 3 layers; the page stacks 60 with the fitted screw.', illus: true },
  { key: 'prp-fibril', name: 'Human PrP fibril (in vitro)', group: 'prion', pdb: '6LNI', look: 'fibril', layers: 60,
    disease: 'A lab-made fibril of human PrP', host: 'In vitro', size: '≈ 13 nm wide',
    sym: 'Two protofilaments, cross-β',
    blurb: 'A fibril of full-length human prion protein, made in a test tube from recombinant protein (Wang et al. 2020). Two protofilaments twist around each other. Lab-made PrP fibrils show the cross-β fold but are not the same as infectious prions from a patient.',
    note: 'The page stacks 60 layers with the fitted screw.', illus: true },

  // ── other amyloids ────────────────────────────────────────────────────
  { key: 'tau', name: 'Tau paired helical filament', group: 'amyloid', pdb: '5O3L', look: 'fibril', layers: 60,
    disease: "Alzheimer's disease", host: 'Human brain', size: '≈ 15 nm wide',
    sym: 'Two C-shaped protofilaments, cross-β',
    blurb: "Tau filaments from the brain of a person with Alzheimer's disease (Fitzpatrick et al. 2017). Not a prion: Alzheimer's does not pass between people in normal life. Tau seeds can spread from cell to cell in a prion-like way, which is studied.",
    note: 'The page stacks 60 layers with the fitted screw.', illus: true },
  { key: 'asyn', name: 'α-Synuclein fibril', group: 'amyloid', pdb: '6A6B', look: 'fibril', layers: 60,
    disease: "Parkinson's disease (lab-made fibril)", host: 'In vitro', size: '≈ 10 nm wide',
    sym: 'Two protofilaments, cross-β',
    blurb: "A fibril of full-length α-synuclein made in vitro (Li et al. 2018). α-Synuclein aggregates make the Lewy bodies of Parkinson's disease. Not a prion: like tau, it can seed its own aggregation.",
    note: 'The page stacks 60 layers with the fitted screw.', illus: true },
];

// RCSB facts per PDB ID (checked against data.rcsb.org on 2026-10-08).
export const CREDIT = {
  '1HXS': ['Crystal structure of Mahoney strain of poliovirus at 2.2 Å resolution', 'Miller, S.T., Hogle, J.M., Filman, D.J.', 2001, '10.1006/jmbi.2001.4485'],
  '4RHV': ['The use of molecular-replacement phases for the refinement of the human rhinovirus 14 structure', 'Arnold, E., Rossmann, M.G.', 1988, '10.1107/S0108767387011875'],
  '1IHM': ['Crystal structure analysis of Norwalk virus capsid', 'Prasad, B.V., Hardy, M.E., Dokland, T., et al.', 1999, '10.1126/science.286.5438.287'],
  '1QGT': ['Human hepatitis B viral capsid (HBcAg)', 'Wynne, S.A., Crowther, R.A., Leslie, A.G.', 1999, '10.1016/S1097-2765(01)80009-5'],
  '3J6R': ['Electron cryo-microscopy of human papillomavirus type 16 capsid', 'Cardone, G., Moyer, A.L., Cheng, N., et al.', 2014, '10.1128/mBio.01104-14'],
  '6CGV': ['Revised crystal structure of human adenovirus', 'Kundhavai Natchiar, S., Venkataraman, S., Mullen, T.M., et al.', 2018, '10.1016/j.jmb.2018.08.011'],
  '5IRE': ['The cryo-EM structure of Zika virus', 'Sirohi, D., Chen, Z., Sun, L., et al.', 2016, '10.1126/science.aaf5316'],
  '1OHG': ['Structure of the dsDNA bacteriophage HK97 mature empty capsid', 'Helgstrand, C., Wikoff, W.R., Duda, R.L., et al.', 2003, '10.1016/j.jmb.2003.09.035'],
  '4UDV': ['Cryo-EM structure of TMV at 3.35 Å resolution', 'Fromm, S.A., Bharat, T.A.M., Jakobi, A.J., et al.', 2015, '10.1016/j.jsb.2014.12.002'],
  '3J3Q': ['Atomic-level structure of the entire HIV-1 capsid', 'Zhao, G., Perilla, J.R., Yufenyuy, E.L., et al.', 2013, '10.1038/nature12162'],
  '6VSB': ['Prefusion 2019-nCoV spike glycoprotein with a single receptor-binding domain up', 'Wrapp, D., Wang, N., Corbett, K.S., et al.', 2020, '10.1126/science.abb2507'],
  '6M0J': ['Crystal structure of SARS-CoV-2 spike receptor-binding domain bound with ACE2', 'Lan, J., Ge, J., Yu, J., et al.', 2020, '10.1038/s41586-020-2180-5'],
  '1RUZ': ['1918 H1 hemagglutinin', 'Gamblin, S.J., Haire, L.F., Russell, R.J., et al.', 2004, '10.1126/science.1093155'],
  '2HTY': ['N1 neuraminidase', 'Russell, R.J., Haire, L.F., Stevens, D.J., et al.', 2006, '10.1038/nature05114'],
  '4TVP': ['Crystal structure of the HIV-1 BG505 SOSIP.664 Env trimer ectodomain', 'Pancera, M., Zhou, T., Druz, A., et al.', 2014, '10.1038/nature13808'],
  '3H47': ['X-ray structure of hexameric HIV-1 CA', 'Pornillos, O., Ganser-Pornillos, B.K., Kelly, B.N., et al.', 2009, '10.1016/j.cell.2009.04.063'],
  '5JQ3': ['Crystal structure of Ebola glycoprotein', 'Zhao, Y., Ren, J., Harlos, K., et al.', 2016, '10.1038/nature18615'],
  '7U9G': ['Rabies virus glycoprotein pre-fusion trimer in complex with neutralizing antibody RVA122', 'Callaway, H.M., Zyla, D., Larrous, F., et al.', 2022, '10.1126/sciadv.abp9151'],
  '2ZB6': ['Crystal structure of the measles virus hemagglutinin (oligo-sugar type)', 'Hashiguchi, T., Kajikawa, M., Maita, N., et al.', 2007, '10.1073/pnas.0707830104'],
  '1QLX': ['Human prion protein', 'Zahn, R., Liu, A., Luhrs, T., et al.', 2000, '10.1073/pnas.97.1.145'],
  '7LNA': ['Infectious mammalian prion fibril (263K scrapie)', 'Kraus, A., Hoyt, F., Schwartz, C.L., et al.', 2021, '10.1016/j.molcel.2021.08.011'],
  '7QIG': ['Infectious mouse-adapted RML scrapie prion fibril purified from terminally-infected mouse brains', 'Manka, S.W., Zhang, W., Wenborn, A., et al.', 2022, '10.1038/s41467-022-30457-7'],
  '6LNI': ['Cryo-EM structure of amyloid fibril formed by full-length human prion protein', 'Wang, L.Q., Zhao, K., Yuan, H.Y., et al.', 2020, '10.1038/s41594-020-0441-5'],
  '5O3L': ["Paired helical filament in Alzheimer's disease brain", 'Fitzpatrick, A.W.P., Falcon, B., He, S., et al.', 2017, '10.1038/nature23002'],
  '6A6B': ['Cryo-EM structure of alpha-synuclein fiber', 'Li, Y., Zhao, C., Luo, F., et al.', 2018, '10.1038/s41422-018-0075-x'],
};

// The PDB IDs an entry needs.
export const pdbsOf = e => e.parts ? e.parts.map(p => p.pdb) : [e.pdb];
export function entryByKey(key) { return ENTRIES.find(e => e.key === key) || null; }

// The order of the scale ladder (the lineup), small to large.
export const LADDER_KEYS = ['prp', 'prion-263k', 'spike', 'polio', 'hbv', 'zika', 'hpv', 'adeno', 'hiv-cone', 'sars2-virion', 'tmv'];

// TeX for the card and the saver plate.
export const TEX = {
  T: 'T = h^2 + hk + k^2',
  N: 'N = 60\\,T',
  icosa: '|I| = 60',
  helix: '\\mathbf{x}_j = R_y(j\\,\\Delta\\phi)\\,\\mathbf{x}_0 + j\\,\\Delta z\\,\\hat{\\mathbf{y}}',
  crossBeta: '\\Delta z \\approx 4.8\\ \\text{Å}',
};
