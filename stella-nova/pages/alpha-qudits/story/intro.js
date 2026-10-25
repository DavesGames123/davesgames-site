// ============================================================================
//  ALPHA FROM ENTANGLED QUDITS  ·  story/intro.js  (CORE, DOM-free)
// ----------------------------------------------------------------------------
//  Chapter 0 (the hero: the number) and chapter 1 (what alpha is, and why
//  one would want to derive it). Shape: see story/index.js.
//  Facts of chapter 1 that are not from the paper are textbook QED
//  (Peskin and Schroeder; Sommerfeld for the name) and carry no number
//  beyond 1/137.036 and the one-loop slope 2/(3 pi).
// ============================================================================

export const INTRO = [
  {
    id: 'c0', num: 0, short: 'The number', title: 'One number, counted from entangled pairs',
    hero: true,
    blocks: [
      { p: `The fine-structure constant <i>α</i> is the strength of electromagnetism: a pure number, close to 1/137, that sets how strongly light and charge pull on each other. It is measured to about a tenth of a part per billion, and the Standard Model of particle physics cannot predict it. The model takes it from the laboratory.` },
      { p: `A preprint by A. D. Wissner-Gross, dated 23 October 2026, proposes a closed form for it. The paper starts from a single statement about entangled quantum systems, picks out one small network of entangled pairs, and counts its measurement records with weights 1, √2, √3 and √6. The count comes to` },
      { eq: 'hero' },
      { p: `<b>What the paper claims.</b> The paper derives this number from its axiom with no adjustable parameter, and lists every input it uses. The inverse is 0.6 standard deviations from the CODATA 2022 value of 1/<i>α</i>.` },
      { p: `<b>What it does not yet show.</b> That the number <em>is</em> the fine-structure constant is a conjecture of the paper itself (Conjecture 1). The step from the model's charge to electric charge, to spacetime and to the photon is not made. Agreement with experiment is the test of the conjecture, not a proof of it.` },
      { fig: 'f0' },
    ],
    figures: {
      f0: { pkg: 'compare', title: 'Every digit fixed in advance', tag: 'paper', scenes: [
        { id: 'digits', label: 'Digits', cap: 'The digits of 1/α<sub>cand</sub> as our model computes them from the exact form with integer square roots. The measurements stop after ten or eleven significant figures; the closed form does not.' },
        { id: 'ruler', label: 'Against the measurements', cap: 'The candidate (line) against the four most precise determinations of α(0), each with its one-standard-deviation bar. Zoom in from 137 to the ninth decimal.' },
      ] },
    },
  },
  {
    id: 'c1', num: 1, short: 'What alpha is', title: 'What alpha is, and why one would want to derive it',
    blocks: [
      { p: `Alpha is the charge of the electron, squared, in the natural units of quantum mechanics and relativity. Each time an electron emits or absorbs a photon, the amplitude gains a factor proportional to √<i>α</i>, so each extra photon costs a factor of order <i>α</i> in probability. It fixes the size of atoms (the Bohr radius is the electron's reduced Compton wavelength divided by <i>α</i>), and the small splittings of spectral lines that gave it its name in 1916.` },
      { eq: 'alphaDef' },
      { p: `It is not quite one number. The vacuum of quantum field theory is full of short-lived electron–positron pairs, and they line up around a charge and screen part of it. Seen from far away, at zero momentum transfer, the charge looks smallest; probed at short range, it looks larger. The value 1/137.036 is the long-distance one, written <i>α</i>(0), the Thomson limit. At the mass of the Z boson the same coupling is close to 1/128.` },
      { eq: 'running', note: 'The large-<i>Q</i> form of the one-loop electron term. The chart in the figure draws the full one-loop electron term (our model). The real curve also counts the muon, the tau and the quarks, which is why it reaches about 1/128 at the Z mass (Particle Data Group).' },
      { fig: 'f1' },
      { p: `Quantum electrodynamics makes the long-distance value precise through the on-shell scheme. The coupling at zero transfer is universal for a massless spin-one field coupled to a conserved charge (Weinberg). The Ward identity says the vertex and the charged field are renormalized by the same factor, <i>Z</i><sub>1</sub> = <i>Z</i><sub>2</sub>, so they cancel. What is left is the dressing of the photon line alone, <i>Z</i><sub>3</sub>, the ratio of the dressed photon two-point function to the bare one at its pole. Heavy charged particles do not change this limit (decoupling, Appelquist and Carazzone).` },
      { eq: 'onShell' },
      { p: `The paper turns this into a shopping list. To derive <i>α</i>(0) one needs exactly one object that has (i) a conserved abelian charge with a Ward identity, (ii) a two-point function with its pole at zero transfer, and (iii) its dressed-over-bare ratio at that pole. Everything else the paper does is an attempt to find such an object inside a network of entangled pairs, and to count its ratio exactly.` },
      { aside: `Why is this hard? A formula for 1/137 has to match about ten significant figures, and it has to say what fixed its normalization. Earlier proposals failed on the second point, because the volume of a geometric domain can be rescaled and the number with it (chapter 10).` },
    ],
    figures: {
      f1: { pkg: 'core', title: 'Screening: why alpha depends on distance', tag: 'model', scenes: [
        { id: 'screen', label: 'Screening', cap: 'A bare charge (centre) polarizes the vacuum: short-lived pairs turn their opposite end toward it. Move the probe in, and less of the cloud lies between you and the charge, so the coupling you measure grows. The chart is the one-loop electron-only curve of the equation above.' },
      ] },
    },
  },
];
