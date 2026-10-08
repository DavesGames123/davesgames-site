// ============================================================================
//  MRNA VACCINE  ·  facts and pure functions  (ES module, no DOM)
// ----------------------------------------------------------------------------
//  Every fact on the page comes from this file. Each fact names a source id
//  from SOURCES. If a fact had no source that we could check, we left it
//  out. Node imports this file in tests.mjs.
//
//  "Illustrative" in a name means a toy model for a drawing. It is not a
//  measured value. The page labels each one as such.
//
//  EXPORTS   (jump with grep -n "<anchor>" data.js)
//      SOURCES ........ "export const SOURCES"     references, by id
//      TIMELINE ....... "export const TIMELINE"    1961 to 2023, sorted
//      TRIALS ......... "export const TRIALS"      the two phase 3 trials
//      CONSTRUCT ...... "export const CONSTRUCT"   BNT162b2 mRNA regions
//      LNP ............ "export const LNP"         the four lipids
//      CODE ........... "export const CODE"        the genetic code
//      CODON_PICK ..... "export const CODON_PICK"  AU-rich and GC-rich codons
//      PEPTIDES ....... "export const PEPTIDES"    two real spike stretches
//      ve ............. "export function ve"       vaccine efficacy
//      dayNum ......... "export function dayNum"   date to day number
//      protonated ..... "export function protonated"  Henderson-Hasselbalch
//      remaining ...... "export function remaining"   first-order decay
//      titre .......... "export function titre"    illustrative antibody curve
//      journey ........ "export function journey"  LNP scene phases
//      shotPlan ....... "export function shotPlan" saver shots, seeded
//      nearest ........ "export function nearest"  tap to the closest mark
// ============================================================================

// ---------------------------------------------------------------- sources
// id -> one reference. url is a DOI or an official page.
export const SOURCES = {
  brenner1961: { t: 'Brenner S, Jacob F, Meselson M. An unstable intermediate carrying information from genes to ribosomes for protein synthesis. Nature 190, 576-581 (1961).', url: 'https://doi.org/10.1038/190576a0' },
  gros1961: { t: 'Gros F, Hiatt H, Gilbert W, Kurland CG, Risebrough RW, Watson JD. Unstable ribonucleic acid revealed by pulse labelling of Escherichia coli. Nature 190, 581-585 (1961).', url: 'https://doi.org/10.1038/190581a0' },
  melton1984: { t: 'Melton DA, Krieg PA, Rebagliati MR, Maniatis T, Zinn K, Green MR. Efficient in vitro synthesis of biologically active RNA and RNA hybridization probes from plasmids containing a bacteriophage SP6 promoter. Nucleic Acids Res 12, 7035-7056 (1984).', url: 'https://doi.org/10.1093/nar/12.18.7035' },
  wolff1990: { t: 'Wolff JA, Malone RW, Williams P, et al. Direct gene transfer into mouse muscle in vivo. Science 247, 1465-1468 (1990).', url: 'https://doi.org/10.1126/science.1690918' },
  martinon1993: { t: 'Martinon F, Krishnan S, Lenzen G, et al. Induction of virus-specific cytotoxic T lymphocytes in vivo by liposome-entrapped mRNA. Eur J Immunol 23, 1719-1722 (1993).', url: 'https://doi.org/10.1002/eji.1830230749' },
  kariko2005: { t: 'Karikó K, Buckstein M, Ni H, Weissman D. Suppression of RNA recognition by Toll-like receptors: the impact of nucleoside modification and the evolutionary origin of RNA. Immunity 23, 165-175 (2005).', url: 'https://doi.org/10.1016/j.immuni.2005.06.008' },
  kariko2008: { t: 'Karikó K, Muramatsu H, Welsh FA, et al. Incorporation of pseudouridine into mRNA yields superior nonimmunogenic vector with increased translational capacity and biological stability. Mol Ther 16, 1833-1840 (2008).', url: 'https://doi.org/10.1038/mt.2008.200' },
  semple2010: { t: 'Semple SC, Akinc A, Chen J, et al. Rational design of cationic lipids for siRNA delivery. Nat Biotechnol 28, 172-176 (2010).', url: 'https://doi.org/10.1038/nbt.1602' },
  jayaraman2012: { t: 'Jayaraman M, Ansell SM, Mui BL, et al. Maximizing the potency of siRNA lipid nanoparticles for hepatic gene silencing in vivo. Angew Chem Int Ed 51, 8529-8533 (2012).', url: 'https://doi.org/10.1002/anie.201203263' },
  mclellan2013: { t: 'McLellan JS, Chen M, Joyce MG, et al. Structure-based design of a fusion glycoprotein vaccine for respiratory syncytial virus. Science 342, 592-598 (2013).', url: 'https://doi.org/10.1126/science.1243283' },
  andries2015: { t: 'Andries O, Mc Cafferty S, De Smedt SC, et al. N1-methylpseudouridine-incorporated mRNA outperforms pseudouridine-incorporated mRNA by providing enhanced protein expression and reduced immunogenicity in mammalian cell lines and mice. J Control Release 217, 337-344 (2015).', url: 'https://doi.org/10.1016/j.jconrel.2015.08.051' },
  pallesen2017: { t: 'Pallesen J, Wang N, Corbett KS, et al. Immunogenicity and structures of a rationally designed prefusion MERS-CoV spike antigen. PNAS 114, E7348-E7357 (2017).', url: 'https://doi.org/10.1073/pnas.1707304114' },
  pardi2018: { t: 'Pardi N, Hogan MJ, Porter FW, Weissman D. mRNA vaccines — a new era in vaccinology. Nat Rev Drug Discov 17, 261-279 (2018).', url: 'https://doi.org/10.1038/nrd.2017.243' },
  adams2018: { t: 'Adams D, Gonzalez-Duarte A, O\'Riordan WD, et al. Patisiran, an RNAi therapeutic, for hereditary transthyretin amyloidosis. N Engl J Med 379, 11-21 (2018).', url: 'https://doi.org/10.1056/NEJMoa1716153' },
  akinc2019: { t: 'Akinc A, Maier MA, Manoharan M, et al. The Onpattro story and the clinical translation of nanomedicines containing nucleic acid-based drugs. Nat Nanotechnol 14, 1084-1087 (2019).', url: 'https://doi.org/10.1038/s41565-019-0591-y' },
  wu2020: { t: 'Wu F, Zhao S, Yu B, et al. A new coronavirus associated with human respiratory disease in China. Nature 579, 265-269 (2020). Genome: GenBank MN908947.', url: 'https://doi.org/10.1038/s41586-020-2008-3' },
  wrapp2020: { t: 'Wrapp D, Wang N, Corbett KS, et al. Cryo-EM structure of the 2019-nCoV spike in the prefusion conformation. Science 367, 1260-1263 (2020).', url: 'https://doi.org/10.1126/science.abb2507' },
  corbett2020: { t: 'Corbett KS, Edwards DK, Leist SR, et al. SARS-CoV-2 mRNA vaccine design enabled by prototype pathogen preparedness. Nature 586, 567-571 (2020).', url: 'https://doi.org/10.1038/s41586-020-2622-0' },
  jackson2020: { t: 'Jackson LA, Anderson EJ, Rouphael NG, et al. An mRNA vaccine against SARS-CoV-2 — preliminary report. N Engl J Med 383, 1920-1931 (2020).', url: 'https://doi.org/10.1056/NEJMoa2022483' },
  walsh2020: { t: 'Walsh EE, Frenck RW, Falsey AR, et al. Safety and immunogenicity of two RNA-based Covid-19 vaccine candidates. N Engl J Med 383, 2439-2450 (2020).', url: 'https://doi.org/10.1056/NEJMoa2027906' },
  polack2020: { t: 'Polack FP, Thomas SJ, Kitchin N, et al. Safety and efficacy of the BNT162b2 mRNA Covid-19 vaccine. N Engl J Med 383, 2603-2615 (2020).', url: 'https://doi.org/10.1056/NEJMoa2034577' },
  baden2021: { t: 'Baden LR, El Sahly HM, Essink B, et al. Efficacy and safety of the mRNA-1273 SARS-CoV-2 vaccine. N Engl J Med 384, 403-416 (2021).', url: 'https://doi.org/10.1056/NEJMoa2035389' },
  orlandini2019: { t: 'Orlandini von Niessen AG, Poleganov MA, Rechner C, et al. Improving mRNA-based therapeutic gene delivery by expression-augmenting 3\' UTRs identified by cellular library screening. Mol Ther 27, 824-836 (2019).', url: 'https://doi.org/10.1016/j.ymthe.2018.12.011' },
  biontech2020: { t: 'BioNTech SE and Pfizer Inc. Press release, 29 April 2020: dosing of the first cohort of the BNT162 phase 1/2 trial in Germany, which began on 23 April 2020.', url: null },
  moderna2020: { t: 'Moderna, Inc. Timeline of the mRNA-1273 response through 16 March 2020 (exhibit to SEC Form 8-K, March 2020).', url: 'https://www.sec.gov/Archives/edgar/data/1682852/000119312520074867/d884510dex991.htm' },
  fdaEua: { t: 'US Food and Drug Administration. Emergency use authorizations for the Pfizer-BioNTech (11 December 2020) and Moderna (18 December 2020) COVID-19 vaccines, and the fact sheets for each.', url: 'https://www.fda.gov/emergency-preparedness-and-response/coronavirus-disease-2019-covid-19/covid-19-vaccines' },
  fdaGuidance: { t: 'US Food and Drug Administration. Emergency use authorization for vaccines to prevent COVID-19: guidance for industry (October 2020).', url: 'https://www.fda.gov/regulatory-information/search-fda-guidance-documents/emergency-use-authorization-vaccines-prevent-covid-19' },
  mhra2020: { t: 'UK Medicines and Healthcare products Regulatory Agency. Conditions of authorisation for the Pfizer/BioNTech COVID-19 vaccine (2 December 2020).', url: 'https://www.gov.uk/government/publications/regulatory-approval-of-pfizer-biontech-vaccine-for-covid-19' },
  ema2020: { t: 'European Medicines Agency. Comirnaty: conditional marketing authorisation and EPAR (21 December 2020).', url: 'https://www.ema.europa.eu/en/medicines/human/EPAR/comirnaty' },
  nobel2023: { t: 'The Nobel Assembly at Karolinska Institutet. The Nobel Prize in Physiology or Medicine 2023: Katalin Karikó and Drew Weissman (press release, 2 October 2023).', url: 'https://www.nobelprize.org/prizes/medicine/2023/press-release/' },
  schoenmaker2021: { t: 'Schoenmaker L, Witzigmann D, Kulkarni JA, et al. mRNA-lipid nanoparticle COVID-19 vaccines: structure and stability. Int J Pharm 601, 120586 (2021).', url: 'https://doi.org/10.1016/j.ijpharm.2021.120586' },
  xia2021: { t: 'Xia X. Detailed dissection and critical evaluation of the Pfizer/BioNTech and Moderna mRNA vaccines. Vaccines 9, 734 (2021).', url: 'https://doi.org/10.3390/vaccines9070734' },
  gilleron2013: { t: 'Gilleron J, Querbes W, Zeigerer A, et al. Image-based analysis of lipid nanoparticle-mediated siRNA delivery, intracellular trafficking and endosomal escape. Nat Biotechnol 31, 638-646 (2013).', url: 'https://doi.org/10.1038/nbt.2612' },
};

// ---------------------------------------------------------------- timeline
// date: 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD' (the precision we could check).
// era: 'biology' | 'delivery' | 'antigen' | '2020' | 'after'
export const TIMELINE = [
  { date: '1961', era: 'biology', title: 'Messenger RNA is found', text: 'Two papers in one issue of Nature show a short-lived RNA that carries a gene\'s message to the ribosome.', src: ['brenner1961', 'gros1961'] },
  { date: '1984', era: 'biology', title: 'mRNA made in a test tube', text: 'An SP6 phage polymerase copies a DNA template into large amounts of RNA in vitro. Vaccine mRNA is still made by in vitro transcription (today with T7 polymerase).', src: ['melton1984'] },
  { date: '1990', era: 'biology', title: 'Injected mRNA makes protein in a mouse', text: 'Naked mRNA and DNA injected into mouse muscle make a reporter protein there. The idea of mRNA as a drug starts here.', src: ['wolff1990'] },
  { date: '1993', era: 'biology', title: 'An mRNA in liposomes primes T cells', text: 'Liposome-wrapped mRNA for an influenza protein makes virus-specific killer T cells in mice.', src: ['martinon1993'] },
  { date: '2005', era: 'biology', title: 'Modified nucleosides quiet the alarm', text: 'Karikó and Weissman show that RNA with modified nucleosides, pseudouridine among them, does not set off the Toll-like receptors that unmodified mRNA sets off.', src: ['kariko2005'] },
  { date: '2008', era: 'biology', title: 'Pseudouridine mRNA makes more protein', text: 'Pseudouridine mRNA is translated better and is more stable, in cells and in mice.', src: ['kariko2008'] },
  { date: '2010', era: 'delivery', title: 'Ionizable lipids by design', text: 'A rational design study tunes ionizable lipids for siRNA delivery to the liver (DLin-KC2-DMA).', src: ['semple2010'] },
  { date: '2012', era: 'delivery', title: 'The pKa sweet spot', text: 'A screen of ionizable lipids finds the best liver silencing at an apparent pKa near 6.2 to 6.5. DLin-MC3-DMA, the lipid of Onpattro, comes from it.', src: ['jayaraman2012'] },
  { date: '2013', era: 'antigen', title: 'Lock the fusion protein before it fires', text: 'Structure-based design holds the RSV F protein in its prefusion shape (DS-Cav1). The locked form makes far more neutralizing antibody.', src: ['mclellan2013'] },
  { date: '2015', era: 'biology', title: 'N1-methylpseudouridine', text: 'm1Ψ mRNA makes more protein and less immune activation than Ψ mRNA in cell lines and mice. Both COVID-19 mRNA vaccines use m1Ψ in place of every uridine.', src: ['andries2015'] },
  { date: '2017', era: 'antigen', title: 'Two prolines hold a coronavirus spike', text: 'Two proline substitutions keep the MERS-CoV spike in its prefusion shape (S-2P), and the stabilized spike is a much better immunogen.', src: ['pallesen2017'] },
  { date: '2018-08-10', era: 'delivery', title: 'Onpattro: the first approved LNP drug of its kind', text: 'The US FDA approves patisiran, an siRNA in an ionizable lipid nanoparticle. The LNP is now proven in patients at scale.', src: ['adams2018', 'akinc2019'] },
  { date: '2020-01-11', era: '2020', title: 'The genome is posted', text: 'The SARS-CoV-2 genome sequence (Wuhan-Hu-1, later GenBank MN908947) is posted publicly. It went up late on 10 January in Europe, which was 11 January in China; Moderna counts from the 11th.', src: ['wu2020', 'moderna2020'] },
  { date: '2020-01-13', era: '2020', title: 'mRNA-1273 sequence chosen', text: 'NIH and Moderna settle the sequence of mRNA-1273, a full-length S-2P spike, two days after the genome was posted.', src: ['moderna2020', 'corbett2020'] },
  { date: '2020-02', era: '2020', title: 'The spike in atomic detail', text: 'A preprint, then a Science paper, show the cryo-EM structure of the prefusion-stabilized SARS-CoV-2 spike (S-2P) at 3.5 Å. One of the three receptor-binding domains points up.', src: ['wrapp2020'] },
  { date: '2020-02-24', era: '2020', title: 'First clinical batch shipped', text: 'Moderna ships the first clinical batch of mRNA-1273 to the NIH for the phase 1 trial.', src: ['moderna2020'] },
  { date: '2020-03-16', era: '2020', title: 'First person dosed', text: 'The NIH-led phase 1 trial of mRNA-1273 doses its first participant, 63 days after the sequence was chosen.', src: ['jackson2020', 'moderna2020'] },
  { date: '2020-04-23', era: '2020', title: 'BNT162 phase 1 starts', text: 'BioNTech and Pfizer dose the first participants in Germany with BNT162 candidates; a US trial follows in May. Of the two lead candidates, BNT162b2 (the full-length 2P spike) goes forward: it caused fewer systemic side effects at a similar immune response.', src: ['biontech2020', 'walsh2020'] },
  { date: '2020-07-27', era: '2020', title: 'Phase 3 starts for both', text: 'The phase 3 efficacy trials of mRNA-1273 and BNT162b2 start on the same day. They go on to randomize 30,420 and 43,548 people.', src: ['polack2020', 'baden2021'] },
  { date: '2020-12-02', era: '2020', title: 'First authorization', text: 'The UK MHRA authorizes BNT162b2 for temporary supply. The first vaccinations outside a trial follow on 8 December.', src: ['mhra2020'] },
  { date: '2020-12-10', era: '2020', title: 'BNT162b2 efficacy published', text: '8 cases in the vaccine group and 162 in the placebo group: 95.0% efficacy (95% credible interval 90.3 to 97.6).', src: ['polack2020'] },
  { date: '2020-12-11', era: '2020', title: 'US emergency use: BNT162b2', text: 'The FDA issues an emergency use authorization for the Pfizer-BioNTech vaccine.', src: ['fdaEua'] },
  { date: '2020-12-18', era: '2020', title: 'US emergency use: mRNA-1273', text: 'The FDA issues an emergency use authorization for the Moderna vaccine.', src: ['fdaEua'] },
  { date: '2020-12-21', era: '2020', title: 'EU conditional authorization', text: 'Comirnaty (BNT162b2) gets a conditional marketing authorization in the EU.', src: ['ema2020'] },
  { date: '2020-12-30', era: '2020', title: 'mRNA-1273 efficacy published', text: '11 cases in the vaccine group and 185 in the placebo group: 94.1% efficacy (95% CI 89.3 to 96.8). All 30 severe cases were in the placebo group.', src: ['baden2021'] },
  { date: '2023-10-02', era: 'after', title: 'Nobel Prize', text: 'Karikó and Weissman receive the Nobel Prize in Physiology or Medicine for the nucleoside base modifications that made effective mRNA vaccines against COVID-19 possible.', src: ['nobel2023'] },
];

export const ERAS = {
  biology: { name: 'RNA biology', col: '#62c4ff' },
  delivery: { name: 'Delivery', col: '#ff9a62' },
  antigen: { name: 'The antigen', col: '#86dc7c' },
  '2020': { name: '2020', col: '#ffd666' },
  after: { name: 'Recognition', col: '#e889dc' },
};

// ---------------------------------------------------------------- trials
// Primary end point: confirmed COVID-19 from 7 days (BNT162b2) or 14 days
// (mRNA-1273) after dose 2, in people with no sign of earlier infection.
export const TRIALS = [
  { id: 'bnt', name: 'BNT162b2', maker: 'Pfizer-BioNTech', randomized: 43548, casesV: 8, casesP: 162, ve: 95.0, ci: [90.3, 97.6], dose: '30 µg', gapDays: 21, src: 'polack2020',
    store: 'Shipped frozen at −80 to −60 °C. The first label allowed 5 days in a refrigerator after thawing.' },
  { id: 'mod', name: 'mRNA-1273', maker: 'Moderna', randomized: 30420, casesV: 11, casesP: 185, ve: 94.1, ci: [89.3, 96.8], dose: '100 µg', gapDays: 28, src: 'baden2021',
    store: 'Shipped frozen at −25 to −15 °C. The first label allowed 30 days in a refrigerator.' },
];

// Vaccine efficacy from the attack rates of the two arms. With no group
// sizes, the arms count as the same size (the trials were 1:1).
export function ve(casesV, casesP, nV = 1, nP = 1) {
  const arv = casesV / nV, aru = casesP / nP;
  if (!(aru > 0)) return NaN;
  return 1 - arv / aru;
}

// ---------------------------------------------------------------- dates
// Days since 1970-01-01 (UTC) for 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD'.
export function dayNum(date) {
  const [y, m = 1, d = 1] = String(date).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}
export function precision(date) { return String(date).split('-').length; }
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function fmtDate(date) {
  const [y, m, d] = String(date).split('-').map(Number);
  if (!m) return String(y);
  if (!d) return `${MONTHS[m - 1]} ${y}`;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// ---------------------------------------------------------------- mRNA
// The BNT162b2 construct, 5' to 3'. len: nucleotides, where the source
// gives them. The page draws the regions, not the real sequence.
export const CONSTRUCT = {
  name: 'BNT162b2', src: ['xia2021', 'orlandini2019'],
  regions: [
    { id: 'cap', name: "5' cap", text: "A modified guanosine joined 5'-to-5' to the first nucleotide. Ribosomes need the cap to start, and it guards the end from enzymes that chew RNA from the 5' end." },
    { id: 'utr5', name: "5' UTR", text: "A short leader that is not translated. In BNT162b2 it is derived from the human alpha-globin gene, a leader that starts translation well." },
    { id: 'orf', name: 'Coding sequence', text: 'A signal peptide, then the full spike: 1,273 codons, with the two prolines at 986 and 987. The codons are changed from the virus\'s own (more G and C), but every codon still encodes the same amino acid.' },
    { id: 'utr3', name: "3' UTR", text: 'Two elements chosen in a screen for long-lived, well-translated mRNA: part of the AES (amino-terminal enhancer of split) mRNA and part of the mitochondrial 12S rRNA.' },
    { id: 'polyA', name: 'Poly(A) tail', text: 'About 110 adenosines in two runs, 30 and 70, joined by a 10-nucleotide linker. The tail protects the 3\' end, and its shortening starts decay.', len: 110 },
  ],
};

// The standard genetic code, codon (RNA) -> one-letter amino acid; '*' stop.
export const CODE = (() => {
  const b = 'UCAG', aa = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG';
  const t = {};
  let i = 0;
  for (const x of b) for (const y of b) for (const z of b) t[x + y + z] = aa[i++];
  return t;
})();

// Codon choices for the strand view. "au": an A/U-rich synonym (like the
// bias of the viral genome); "gc": a G/C-rich synonym, the direction that
// codon optimization takes. Both are illustrative: they are not the real
// viral or vaccine codons.
export const CODON_PICK = {
  M: ['AUG', 'AUG'], F: ['UUU', 'UUC'], V: ['GUU', 'GUG'], L: ['UUA', 'CUG'], P: ['CCU', 'CCC'],
  S: ['UCU', 'AGC'], Q: ['CAA', 'CAG'], C: ['UGU', 'UGC'], N: ['AAU', 'AAC'], T: ['ACU', 'ACC'],
  D: ['GAU', 'GAC'], K: ['AAA', 'AAG'], E: ['GAA', 'GAG'], A: ['GCU', 'GCC'], R: ['AGA', 'CGG'],
  G: ['GGU', 'GGC'], I: ['AUU', 'AUC'], Y: ['UAU', 'UAC'], H: ['CAU', 'CAC'], W: ['UGG', 'UGG'],
  '*': ['UAA', 'UGA'],
};

// Two real stretches of the SARS-CoV-2 spike (UniProt P0DTC2). first: the
// residue number of the first letter.
export const PEPTIDES = {
  signal: { first: 1, seq: 'MFVFLVLLPLVSSQCVNLT', note: 'The N-terminus. Residues 1 to 13 are the signal peptide that sends the chain into the endoplasmic reticulum.' },
  hinge: { first: 984, seq: 'LDKVEAE', seq2P: 'LDPPEAE', note: 'K986 and V987 sit where heptad repeat 1 meets the central helix. Proline there blocks the helix that the spike must form to fuse.' },
};

export function codonsFor(seq, mode /* 0 au, 1 gc */) { return [...seq].map(a => CODON_PICK[a][mode]); }
export function translate(codons) { return codons.map(c => CODE[c]).join(''); }
export function gcFraction(codons) {
  const s = codons.join('');
  let g = 0; for (const c of s) if (c === 'G' || c === 'C') g++;
  return s.length ? g / s.length : 0;
}

// Illustrative first-order decay: the fraction left after t hours.
export function remaining(t, halfLife) { return Math.pow(0.5, t / halfLife); }

// ---------------------------------------------------------------- LNP
// Approximate share by mole of each lipid (both vaccines are close to it).
export const LNP = {
  src: ['schoenmaker2021', 'jayaraman2012'],
  pKa: 6.4,   // illustrative, inside the 6.2 to 6.5 optimum of Jayaraman 2012
  lipids: [
    { id: 'ion', name: 'Ionizable lipid', mol: 0.48, col: '#ff9a62', ex: 'ALC-0315 (BNT162b2), SM-102 (mRNA-1273)', job: 'Neutral at blood pH, positive in the acid endosome. It binds the mRNA in the particle and breaks the endosome membrane.' },
    { id: 'chol', name: 'Cholesterol', mol: 0.40, col: '#ffd666', ex: 'cholesterol', job: 'Fills gaps between lipids and makes the particle stable.' },
    { id: 'dspc', name: 'Phospholipid', mol: 0.10, col: '#62c4ff', ex: 'DSPC', job: 'A helper lipid that forms bilayer around the core.' },
    { id: 'peg', name: 'PEG-lipid', mol: 0.02, col: '#86dc7c', ex: 'ALC-0159 (BNT162b2), PEG2000-DMG (mRNA-1273)', job: 'A thin polymer coat. It sets the particle size and stops particles from sticking together.' },
  ],
};

// Henderson-Hasselbalch: the fraction of an ionizable amine that carries a
// proton (charge +1) at a given pH.
export function protonated(pH, pKa) { return 1 / (1 + Math.pow(10, pH - pKa)); }

// Index of the x in xs closest to x, or -1 if none is within maxD. The day
// bar and the timeline strip use it, so a finger tap need not hit a small
// dot. Entries that are null (hidden marks) are skipped.
export function nearest(xs, x, maxD = Infinity) {
  let best = -1, bd = maxD;
  xs.forEach((v, i) => { if (v == null) return; const d = Math.abs(v - x); if (d <= bd) { bd = d; best = i; } });
  return best;
}

// ---------------------------------------------------------------- scenes
// The LNP journey, p in 0..1. Phase names in order; pH goes down in the
// endosome and stays down.
export const JOURNEY = [
  { id: 'blood', to: 0.18, name: 'In tissue fluid', text: 'The particle drifts at pH 7.4. Its ionizable lipids are almost all neutral, so it does little harm on the way.' },
  { id: 'uptake', to: 0.36, name: 'Endocytosis', text: 'The cell membrane folds in around the particle and pinches off a bubble: an endosome.' },
  { id: 'acid', to: 0.60, name: 'The endosome acidifies', text: 'Proton pumps drop the pH toward 5 to 6. The ionizable lipids pick up protons and turn positive.' },
  { id: 'escape', to: 0.80, name: 'Endosomal escape', text: 'The positive lipids pair with negative lipids of the endosome membrane and break it. Only a few percent of the cargo gets out; the rest is digested.' },
  { id: 'free', to: 1.00, name: 'mRNA in the cytosol', text: 'Free mRNA meets ribosomes. It never enters the nucleus and is not copied into DNA.' },
];
export function journey(p) {
  p = Math.max(0, Math.min(1, p));
  let from = 0;
  for (let i = 0; i < JOURNEY.length; i++) {
    const ph = JOURNEY[i];
    if (p <= ph.to || i === JOURNEY.length - 1) {
      const k = (p - from) / (ph.to - from);
      return { i, id: ph.id, k: Math.max(0, Math.min(1, k)), pH: journeyPH(p) };
    }
    from = ph.to;
  }
}
export function journeyPH(p) {
  const a = JOURNEY[1].to, b = JOURNEY[2].to;
  if (p <= a) return 7.4;
  if (p >= b) return 5.5;
  const k = (p - a) / (b - a);
  return 7.4 - 1.9 * k * k * (3 - 2 * k);
}

// Illustrative antibody titre (arbitrary units) at a day, after doses on
// the given days. Each dose adds a response that rises over about two
// weeks and then decays; a later dose answers about 10 times stronger.
// Not trial data.
export function titre(day, doses, { half = 60, boost = 10 } = {}) {
  let v = 0;
  doses.forEach((d0, i) => {
    const s = day - d0;
    if (s <= 0) return;
    const rise = Math.pow(1 - Math.exp(-s / 5), 3);
    v += (i === 0 ? 1 : boost) * rise * Math.pow(0.5, s / half);
  });
  return v;
}

// ---------------------------------------------------------------- saver
// A small seeded generator (mulberry32).
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const SHOTS = ['lnp', 'translate', 'spike', 'strand'];
// n shots: each pass of the four is a fresh seeded shuffle, with no shot
// twice in a row across passes. Each lasts 5 to 12 s; calm makes them longer.
export function shotPlan(seed, n, calm = 0.7) {
  const R = rng(seed + 97), out = [];
  while (out.length < n) {
    const pass = SHOTS.slice();
    for (let k = pass.length - 1; k > 0; k--) { const m = Math.floor(R() * (k + 1)); [pass[k], pass[m]] = [pass[m], pass[k]]; }
    if (out.length && pass[0] === out[out.length - 1].id) [pass[0], pass[1]] = [pass[1], pass[0]];
    for (const id of pass) {
      const sec = Math.min(12, Math.max(5, 5 + 7 * (0.35 * calm + 0.65 * R())));
      out.push({ id, sec });
    }
  }
  return out.slice(0, n);
}

// ---------------------------------------------------------------- strand
// The strand view: a token list, 5' to 3'. Real parts: the order of the
// regions, the two spike stretches (PEPTIDES), the stop codon, and the
// 30 + linker + 70 layout of the poly(A) tail. Illustrative parts: the UTR
// letters, the codon choices and the linker letters. A 'gap' token stands
// for a run that the view leaves out.
// opt: 0 AU-rich codons, 1 GC-rich (optimized). p2: hinge with K986P/V987P.
// Seeded letters for the UTRs: placeholders, not the real UTR sequences.
export function fakeBases(seed, n) { const R = rng(seed); let s = ''; for (let i = 0; i < n; i++) s += 'ACGU'[Math.floor(R() * 4)]; return s; }
export function buildStrand({ opt = 1, p2 = true } = {}) {
  const T = [];
  const nts = (region, s) => { for (const b of s) T.push({ k: 'nt', region, b }); };
  T.push({ k: 'cap', region: 'cap' });
  nts('utr5', fakeBases(5, 30) + 'GCCACC');   // a Kozak-type GCCACC before AUG
  const pep = (p, seq) => {
    codonsFor(seq, opt).forEach((c, i) => {
      for (let j = 0; j < 3; j++) T.push({ k: 'nt', region: 'orf', b: c[j], codon: c, aa: seq[i], res: p.first + i, pos: j });
    });
  };
  pep(PEPTIDES.signal, PEPTIDES.signal.seq);
  const s1 = PEPTIDES.signal.first + PEPTIDES.signal.seq.length, h0 = PEPTIDES.hinge.first;
  T.push({ k: 'gap', region: 'orf', n: h0 - s1, unit: 'codons' });
  pep(PEPTIDES.hinge, p2 ? PEPTIDES.hinge.seq2P : PEPTIDES.hinge.seq);
  const h1 = h0 + PEPTIDES.hinge.seq.length;
  T.push({ k: 'gap', region: 'orf', n: 1273 - h1 + 1, unit: 'codons' });
  const stop = CODON_PICK['*'][opt];
  for (let j = 0; j < 3; j++) T.push({ k: 'nt', region: 'orf', b: stop[j], codon: stop, aa: '*', res: 1274, pos: j });
  nts('utr3', fakeBases(3, 36));
  nts('polyA', 'A'.repeat(30));
  nts('polyA', 'GCAUAUGACU');
  nts('polyA', 'A'.repeat(14));
  T.push({ k: 'gap', region: 'polyA', n: 56, unit: 'more A' });
  return T;
}
