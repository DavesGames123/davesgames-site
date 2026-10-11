// ============================================================================
//  FLY DUEL  ·  facts and sources  (ES module, no DOM)
// ----------------------------------------------------------------------------
//  Every number on the page comes from FACTS. Each fact names one source id
//  from SOURCES in `src`, and can name more in `also`. We resolved each DOI
//  through doi.org and read the title, year and journal from Crossref on
//  2026-10-11. We read the claim in the abstract or in the open full text
//  (Europe PMC). If we could not check a claim, we left it out.
//
//  Facts with `measured: true` are counts that tools/build-connectome.mjs
//  made from the hemibrain v1.2 export. tests/data.test.mjs checks them
//  against data/connectome.json, so they cannot drift from the shipped file.
//
//  EXPORTS   (jump with grep -n "<anchor>" data/facts.js)
//      SOURCES ......... "export const SOURCES"     references, by id
//      FACTS ........... "export const FACTS"       numbers and claims
//      DISCLAIMER ...... "export const DISCLAIMER"  trademark line
//      HONESTY ......... "export const HONESTY"     plain-words model notes
//      DATA_CREDIT ..... "export const DATA_CREDIT" connectome licence line
//      fact ............ "export function fact"     id -> fact, throws if unknown
//      cite ............ "export function cite"     fact id -> source list
// ============================================================================

// ---------------------------------------------------------------- sources
// id -> { cite, doi, url }. url is https://doi.org/<doi> when a DOI exists.
const S = (cite, doi, url) => ({ cite, doi, url: url || (doi ? `https://doi.org/${doi}` : null) });

export const SOURCES = {
  scheffer2020: S('Scheffer LK, Xu CS, Januszewski M, et al. A connectome and analysis of the adult Drosophila central brain. eLife 9, e57443 (2020).', '10.7554/eLife.57443'),
  li2020: S('Li F, Lindsey JW, Marin EC, et al. The connectome of the adult Drosophila mushroom body provides insights into function. eLife 9, e62576 (2020).', '10.7554/eLife.62576'),
  dorkenwald2024: S('Dorkenwald S, Matsliah A, Sterling AR, et al. Neuronal wiring diagram of an adult brain. Nature 634, 124-138 (2024).', '10.1038/s41586-024-07558-y'),
  schlegel2024: S('Schlegel P, Yin Y, Bates AS, et al. Whole-brain annotation and multi-connectome cell typing of Drosophila. Nature 634, 139-152 (2024).', '10.1038/s41586-024-07686-5'),
  zheng2018: S('Zheng Z, Lauritzen JS, Perlman E, et al. A complete electron microscopy volume of the brain of adult Drosophila melanogaster. Cell 174, 730-743 (2018).', '10.1016/j.cell.2018.06.019'),
  aso2014a: S('Aso Y, Hattori D, Yu Y, et al. The neuronal architecture of the mushroom body provides a logic for associative learning. eLife 3, e04577 (2014).', '10.7554/eLife.04577'),
  aso2014b: S('Aso Y, Sitaraman D, Ichinose T, et al. Mushroom body output neurons encode valence and guide memory-based action selection in Drosophila. eLife 3, e04580 (2014).', '10.7554/eLife.04580'),
  aso2016: S('Aso Y, Rubin GM. Dopaminergic neurons write and update memories with cell-type-specific rules. eLife 5, e16135 (2016).', '10.7554/eLife.16135'),
  hige2015a: S('Hige T, Aso Y, Modi MN, Rubin GM, Turner GC. Heterosynaptic plasticity underlies aversive olfactory learning in Drosophila. Neuron 88, 985-998 (2015).', '10.1016/j.neuron.2015.11.003'),
  hige2015b: S('Hige T, Aso Y, Rubin GM, Turner GC. Plasticity-driven individualization of olfactory coding in mushroom body output neurons. Nature 526, 258-262 (2015).', '10.1038/nature15396'),
  owald2015: S('Owald D, Felsenberg J, Talbot CB, et al. Activity of defined mushroom body output neurons underlies learned olfactory behavior in Drosophila. Neuron 86, 417-427 (2015).', '10.1016/j.neuron.2015.03.025'),
  cohn2015: S('Cohn R, Morantte I, Ruta V. Coordinated and compartmentalized neuromodulation shapes sensory processing in Drosophila. Cell 163, 1742-1755 (2015).', '10.1016/j.cell.2015.11.019'),
  litwinkumar2017: S('Litwin-Kumar A, Harris KD, Axel R, Sompolinsky H, Abbott LF. Optimal degrees of synaptic connectivity. Neuron 93, 1153-1164 (2017).', '10.1016/j.neuron.2017.01.030'),
  caron2013: S('Caron SJC, Ruta V, Abbott LF, Axel R. Random convergence of olfactory inputs in the Drosophila mushroom body. Nature 497, 113-117 (2013).', '10.1038/nature12063'),
  turner2008: S('Turner GC, Bazhenov M, Laurent G. Olfactory representations by Drosophila mushroom body neurons. J Neurophysiol 99, 734-746 (2008).', '10.1152/jn.01283.2007'),
  honegger2011: S('Honegger KS, Campbell RAA, Turner GC. Cellular-resolution population imaging reveals robust sparse coding in the Drosophila mushroom body. J Neurosci 31, 11772-11785 (2011).', '10.1523/JNEUROSCI.1099-11.2011'),
  lin2014: S('Lin AC, Bygrave AM, de Calignon A, Lee T, Miesenböck G. Sparse, decorrelated odor coding in the mushroom body enhances learned odor discrimination. Nat Neurosci 17, 559-568 (2014).', '10.1038/nn.3660'),
  liu2009: S('Liu X, Davis RL. The GABAergic anterior paired lateral neuron suppresses and is suppressed by olfactory learning. Nat Neurosci 12, 53-59 (2009).', '10.1038/nn.2235'),
  claridgechang2009: S('Claridge-Chang A, Roorda RD, Vrontou E, et al. Writing memories with light-addressable reinforcement circuitry. Cell 139, 405-415 (2009).', '10.1016/j.cell.2009.08.034'),
  aso2010: S('Aso Y, Siwanowicz I, Bräcker L, Ito K, Kitamoto T, Tanimoto H. Specific dopaminergic neurons for the formation of labile aversive memory. Curr Biol 20, 1445-1451 (2010).', '10.1016/j.cub.2010.06.048'),
  liu2012: S('Liu C, Plaçais PY, Yamagata N, et al. A subset of dopamine neurons signals reward for odour memory in Drosophila. Nature 488, 512-516 (2012).', '10.1038/nature11304'),
  burke2012: S('Burke CJ, Huetteroth W, Owald D, et al. Layered reward signalling through octopamine and dopamine in Drosophila. Nature 492, 433-437 (2012).', '10.1038/nature11614'),
  eschbach2020: S('Eschbach C, Fushiki A, Winding M, et al. Recurrent architecture for adaptive regulation of learning in the insect brain. Nat Neurosci 23, 544-555 (2020).', '10.1038/s41593-020-0607-9'),
  shiu2024: S('Shiu PK, Sterne GR, Spiller N, et al. A Drosophila computational brain model reveals sensorimotor processing. Nature 634, 210-219 (2024).', '10.1038/s41586-024-07763-9'),
  schultz1997: S('Schultz W, Dayan P, Montague PR. A neural substrate of prediction and reward. Science 275, 1593-1599 (1997).', '10.1126/science.275.5306.1593'),
  sutton1988: S('Sutton RS. Learning to predict by the methods of temporal differences. Machine Learning 3, 9-44 (1988).', '10.1007/BF00115009'),
  tesauro1995: S('Tesauro G. Temporal difference learning and TD-Gammon. Communications of the ACM 38(3), 58-68 (1995).', '10.1145/203330.203343'),
  hemibrainData: S('Janelia FlyEM. Hemibrain v1.2 compact connection matrix summary (exported-traced-adjacencies-v1.2) and skeletons, released 2020-12-23. Licence CC BY 4.0. Read 2026-10-11.', null, 'https://www.janelia.org/project-team/flyem/hemibrain'),
  flywireData: S('FlyWire Consortium. FlyWire Whole-brain Connectome Connectivity Data, release 783 (proofread_connections_783.feather). Zenodo (2024). Licence CC BY 4.0. Read 2026-10-11.', '10.5281/zenodo.10676866'),
  flywireAnnotations: S('Schlegel P, Jefferis G, Yin Y, Costa M. flyconnectome/flywire_annotations: Version 3.2.0 (Supplemental_file1_neuron_annotations.tsv, Supplemental_file5_hemibrain_meta.csv). Zenodo (2026). Licence CC BY 4.0. Read 2026-10-11.', '10.5281/zenodo.23037340'),
  buhmann2021: S('Buhmann J, Sheridan A, Malin-Mayor C, et al. Automatic detection of synaptic partners in a whole-brain Drosophila electron microscopy data set. Nature Methods 18, 771-774 (2021).', '10.1038/s41592-021-01183-7'),
};

// ---------------------------------------------------------------- facts
// id -> { value, unit, text, src, also?, measured? }. value is a number, a
// [lo, hi] range, or null for a claim with no number.
const F = (value, unit, text, src, extra = {}) => ({ value, unit, text, src, ...extra });

export const FACTS = {
  // ----- the whole brain and the data sets
  hemibrainNeurons: F(25000, 'neurons', 'The hemibrain connectome holds around 25,000 neurons of the central brain.', 'scheffer2020'),
  hemibrainSynapses: F(20e6, 'synapses', 'The hemibrain holds about 20 million chemical synapses between those neurons.', 'scheffer2020'),
  flywireNeurons: F(139255, 'neurons', 'The FlyWire whole-brain connectome has 139,255 neurons from one adult female fly.', 'dorkenwald2024'),
  flywireSynapses: F(5e7, 'synapses', 'FlyWire maps about 50 million chemical synapses.', 'dorkenwald2024'),
  flywireCellTypes: F(8453, 'cell types', 'The FlyWire annotation names 8,453 cell types.', 'schlegel2024'),
  fafbNeurons: F(100000, 'neurons', 'The fly brain has about 100,000 neurons (the FAFB paper rounds it so).', 'zheng2018'),

  // ----- mushroom body anatomy
  kcPerHemisphere: F(2000, 'Kenyon cells', 'Each mushroom body has about 2,000 Kenyon cells (KCs).', 'aso2014a', { also: ['aso2014b'] }),
  kcHemibrainLi: F(1927, 'Kenyon cells', 'Li et al. found 1,927 KCs in the right hemisphere of the hemibrain.', 'li2020'),
  kcClasses: F(3, 'classes', 'KCs come in three main classes: α/β, α′/β′ and γ.', 'li2020'),
  kcSubtypes: F(14, 'subtypes', 'Li et al. split the KCs into 14 subtypes by shape.', 'li2020'),
  compartments: F(15, 'compartments', 'MBON dendrites and DAN axons divide the MB lobes into 15 compartments.', 'aso2014a'),
  mbonTypes: F(21, 'cell types', 'There are 21 types of MB output neuron (MBON).', 'aso2014a', { also: ['aso2014b'] }),
  mbonCells: F(34, 'neurons', 'About 2,000 KCs converge onto only 34 MBONs.', 'aso2014b', { also: ['hige2015b'] }),
  danTypes: F(20, 'cell types', 'There are 20 types of dopaminergic neuron (DAN) in the MB.', 'aso2014a', { also: ['aso2016'] }),
  danTargets: F([1, 2], 'compartments', 'Each DAN type sends its axons to one, or at most two, compartments.', 'aso2014a'),
  aplCount: F(1, 'neuron per hemisphere', 'One GABAergic APL neuron per hemisphere covers the whole mushroom body.', 'liu2009'),
  uPnLi: F(129, 'neurons', 'Li et al. count 129 uniglomerular olfactory PNs (uPNs) onto the main calyx KCs.', 'li2020'),
  uPnInputShare: F(0.636, 'fraction', 'uPNs give 63.6% of the synaptic input to the main calyx KCs.', 'li2020'),
  kcMainCalyx: F(1757, 'Kenyon cells', '1,757 KCs have their dendrites in the main calyx.', 'li2020'),
  pnPerKcTurner: F(10, 'PNs per KC', 'Each KC gets input from few PNs: about 10 on average, by a physiology estimate.', 'turner2008'),
  randomConvergence: F(200, 'KCs traced', 'Tracing of 200 KCs shows that each KC takes input from a different, apparently random set of glomeruli.', 'caron2013'),
  optimalDegree: F(null, null, 'Theory shows that the small number of inputs per KC is near the number that maximises the dimension of the KC code.', 'litwinkumar2017'),

  // ----- sparse coding
  kcSparseness: F([0.05, 0.10], 'fraction active', 'Only about 5-10% of KCs respond to a given odour.', 'lin2014', { also: ['honegger2011', 'turner2008'] }),
  aplFeedback: F(null, null, 'KCs excite APL and APL inhibits KCs. This feedback loop keeps the KC code sparse and decorrelated. When the loop is cut, flies cannot learn to tell similar odours apart.', 'lin2014'),
  sparseRobust: F(null, null, 'The KC code stays sparse across many odours, from single chemicals to natural smells.', 'honegger2011'),

  // ----- dopamine and plasticity
  ppl1Punish: F(12, 'neurons in PPL1', 'The PPL1 cluster of 12 dopaminergic cells carries the aversive (punishment) signal to the MB.', 'claridgechang2009', { also: ['aso2010'] }),
  pamReward: F(null, null, 'A group of PAM-cluster dopamine neurons signals sugar reward to the medial MB lobes.', 'liu2012', { also: ['burke2012'] }),
  dopamineCells: F(280, 'neurons', 'About 280 neurons in the fly brain make dopamine.', 'aso2010'),
  plasticityDepression: F(null, null, 'Pairing an odour with activation of specific DANs causes odour-specific depression of KC-to-MBON synapses. The order of the two signals matters.', 'hige2015a'),
  compartmentLocal: F(null, null, 'Dopamine acts only inside its own compartment, and the effect differs between compartments.', 'hige2015a', { also: ['cohn2015'] }),
  danRules: F(null, null, 'Different DAN types follow different learning rules. One DAN type can write or reduce a memory, depending on its timing relative to the odour.', 'aso2016'),
  mbonValence: F(null, null, 'Optogenetic activation of an MBON can cause attraction or repulsion, depending on its type. The MBON ensemble as a whole encodes valence.', 'aso2014b'),
  m46Avoid: F(null, null, 'Activation of the glutamatergic MBONs in the β, β′ and γ lobe tips (MBON-β2β′2a, MBON-β′2mp, MBON-γ5β′2a) causes avoidance. Their block turns odour avoidance into approach.', 'owald2015'),
  larvaFeedback: F(null, null, 'In the larva, DANs compare feedback from appetitive and aversive MBON pathways, which can compute integrated predictions.', 'eschbach2020'),

  // ----- learning theory and models
  dopaminePredictionError: F(null, null, 'In primates, dopamine neuron firing tracks errors in the prediction of reward.', 'schultz1997'),
  tdLearning: F(null, null, 'Temporal-difference learning updates a value estimate from the difference between successive predictions.', 'sutton1988'),
  selfPlay: F(null, null, 'TD-Gammon learned backgammon by temporal-difference learning in self-play.', 'tesauro1995'),
  wholeBrainModel: F(125000, 'neurons', 'A leaky integrate-and-fire model of the whole fly brain uses the FlyWire connectome (more than 125,000 neurons and 50 million synaptic connections). It predicts feeding and grooming circuits. It is not trained.', 'shiu2024'),

  // ----- counts measured from our shipped file (hemibrain v1.2)
  ourKc: F(1927, 'Kenyon cells', 'KCs in data/connectome.json (hemibrain v1.2, right hemisphere).', 'hemibrainData', { measured: 'kc.n', also: ['scheffer2020'] }),
  ourKcab: F(889, 'Kenyon cells', 'α/β KCs in our file.', 'hemibrainData', { measured: 'kcByClass.KCab' }),
  ourKcapbp: F(337, 'Kenyon cells', 'α′/β′ KCs in our file.', 'hemibrainData', { measured: "kcByClass.KCa'b'" }),
  ourKcg: F(701, 'Kenyon cells', 'γ KCs in our file.', 'hemibrainData', { measured: 'kcByClass.KCg' }),
  ourPn: F(108, 'neurons', 'Uniglomerular PNs in our file: each makes at least 3 synapses onto a KC.', 'hemibrainData', { measured: 'pn.n' }),
  ourMbon: F(48, 'neurons', 'MBONs in our file: each gets at least 100 synapses from KCs, over connections of 3 or more synapses.', 'hemibrainData', { measured: 'mbon.n' }),
  ourDan: F(312, 'neurons', 'DANs in our file (PAM, PPL1, PPL2): each makes at least 50 synapses onto KCs.', 'hemibrainData', { measured: 'dan.n' }),
  ourPam: F(298, 'neurons', 'PAM DANs in our file (both sides of the brain send PAM axons into this MB).', 'hemibrainData', { measured: 'cluster.PAM' }),
  ourPpl1: F(11, 'neurons', 'PPL1 DANs in our file.', 'hemibrainData', { measured: 'cluster.PPL1' }),
  ourPpl2: F(3, 'neurons', 'PPL2 DANs in our file. They reach the calyx, not a lobe compartment.', 'hemibrainData', { measured: 'cluster.PPL2' }),
  ourClaws: F(5.56, 'uPN partners per KC', 'Mean number of uPN partners per KC in our file (connections of 3 or more synapses, KCs with uPN input only).', 'hemibrainData', { measured: 'clawsPerKcMean' }),
  ourKcWithPn: F(1750, 'Kenyon cells', 'KCs in our file that get uPN input.', 'hemibrainData', { measured: 'kcWithPnInput' }),
  ourPnKcEdges: F(9734, 'connections', 'PN-to-KC connections in our file.', 'hemibrainData', { measured: 'edges.pn_kc' }),
  ourKcMbonEdges: F(24370, 'connections', 'KC-to-MBON connections in our file.', 'hemibrainData', { measured: 'edges.kc_mbon' }),

  // ----- counts measured from data/connectome-flywire.json (Fly B, FlyWire 783)
  // `flywire` names the path in that file. tests/flywire.test.mjs checks
  // each value against the file. data.test.mjs does not read these keys.
  fwKc: F(2597, 'Kenyon cells', 'KCs in the right hemisphere of FlyWire (data/connectome-flywire.json): a second, different female fly.', 'flywireAnnotations', { flywire: 'kc.n', also: ['schlegel2024', 'dorkenwald2024'] }),
  fwKcab: F(860, 'Kenyon cells', 'α/β KCs in the FlyWire file.', 'flywireAnnotations', { flywire: 'kcByClass.KCab' }),
  fwKcapbp: F(467, 'Kenyon cells', 'α′/β′ KCs in the FlyWire file.', 'flywireAnnotations', { flywire: "kcByClass.KCa'b'" }),
  fwKcg: F(1270, 'Kenyon cells', 'γ KCs in the FlyWire file.', 'flywireAnnotations', { flywire: 'kcByClass.KCg' }),
  fwPn: F(121, 'neurons', 'Uniglomerular PNs in the FlyWire file: each makes at least 3 synapses onto a KC.', 'flywireData', { flywire: 'pn.n' }),
  fwMbon: F(38, 'neurons', 'MBONs in the FlyWire file, by the same rule as the hemibrain file (at least 100 synapses from KCs).', 'flywireData', { flywire: 'mbon.n' }),
  fwDan: F(161, 'neurons', 'DANs in the FlyWire file, by the same rule as the hemibrain file (at least 50 synapses onto KCs).', 'flywireData', { flywire: 'dan.n' }),
  fwClaws: F(4.61, 'uPN partners per KC', 'Mean number of uPN partners per KC in the FlyWire file (connections of 3 or more synapses, KCs with uPN input only).', 'flywireData', { flywire: 'clawsPerKcMean' }),
  fwKcWithPn: F(2378, 'Kenyon cells', 'KCs in the FlyWire file that get uPN input.', 'flywireData', { flywire: 'kcWithPnInput' }),
  fwPnKcEdges: F(10955, 'connections', 'PN-to-KC connections in the FlyWire file.', 'flywireData', { flywire: 'edges.pn_kc' }),
  fwKcMbonEdges: F(17033, 'connections', 'KC-to-MBON connections in the FlyWire file.', 'flywireData', { flywire: 'edges.kc_mbon' }),
  fwKcMbonSynapses: F(103800, 'synapses', 'KC-to-MBON synapses in the FlyWire file. The hemibrain file has 309,004. The two data sets detect synapses by different methods, so this ratio is not a biological difference only.', 'flywireData', { flywire: 'kcMbonSynapses', also: ['buhmann2021'] }),
};

// ---------------------------------------------------------------- texts
export const DISCLAIMER = 'Not affiliated with or endorsed by Wizards of the Coast.';

export const HONESTY = {
  notAFly: 'We do not train a real fly. We train a computer model whose wiring comes from the published connectome of one fly brain.',
  wiringReal: 'Wiring from the connectome: hemibrain v1.2 synapse counts between the selected neurons.',
  wiringSynthetic: 'Wiring sampled from published statistics: the real connectome was not available to this build.',
  valenceModel: 'The approach or avoid sign of each MBON is a model rule from its compartment (PAM or PPL1 dopamine), not a measurement of that cell.',
  onlyMb: 'The model is the mushroom body of one hemisphere only, not the whole brain.',
};

export const DATA_CREDIT = 'Connectome data: hemibrain v1.2, Janelia FlyEM (Scheffer et al. 2020), CC BY 4.0. We selected the mushroom body neurons and thresholded the synapse counts.';

// ---------------------------------------------------------------- helpers
export function fact(id) {
  const f = FACTS[id];
  if (!f) throw new Error(`unknown fact ${id}`);
  return f;
}

export function cite(id) {
  const f = fact(id);
  return [f.src, ...(f.also || [])].map(s => SOURCES[s]);
}
