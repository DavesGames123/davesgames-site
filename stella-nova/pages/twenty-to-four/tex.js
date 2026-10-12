// ============================================================================
//  TWENTY TO FOUR  ·  tex.js — every formula of the page, as TeX
// ----------------------------------------------------------------------------
//  typeset.mjs (Node, run by hand) turns each entry into MathJax glyph data
//  in glyphs.js. The page draws that data as inline SVG in the story
//  column and as Path2D sprites on the stage, so one TeX source makes both.
//  story.js names formulas by key; {{key}} in its prose is inline math.
//
//  COLOURS: one \class per symbol family, the lib/sci.css math colours.
//    m2  electric: E, D, and Maxwell's P Q R and f g h
//    m1  magnetic: B, and Maxwell's α β γ
//    m3  potentials: A, φ, χ, and Maxwell's F G H and Ψ
//    m4  charge: ρ, and Maxwell's e
//    m5  current: J, and Maxwell's p q r, p' q' r'
//    m6  wavelength λ (labels only)
//  Operators, constants and the forms F, d, ⋆ stay ink.
//
//  ENTRY: key: [tex, mode]. mode 'd' display, 'i' inline.
//  GREP MAP
//      grep -n "MAXWELL ="    the twenty lines of 1865, by group A to H
//      grep -n "GROUPS ="     the eight groups and the law each folds into
//      grep -n "TEX ="        every other formula, by chapter
// ============================================================================
const S = String.raw;
const cls = n => t => S`\class{m${n}}{${t}}`;
export const cE = cls(2), cB = cls(1), cA = cls(3), cR = cls(4), cJ = cls(5), cL = cls(6);
const vE = cE(S`\mathbf E`), vB = cB(S`\mathbf B`), vA = cA(S`\mathbf A`), vJ = cJ(S`\mathbf J`), vD = cE(S`\mathbf D`);
const rho = cR(S`\rho`), phi = cA(S`\varphi`), chi = cA(S`\chi`);
const dt = x => S`\frac{\partial ${x}}{\partial t}`;

// Maxwell, "A dynamical theory of the electromagnetic field" (1865), part
// III: twenty equations in twenty quantities. He wrote d for every
// derivative; the page writes ∂.
export const MAXWELL = [
  // A  total currents
  S`${cJ("p'")}=${cJ('p')}+\partial_t ${cE('f')}`,
  S`${cJ("q'")}=${cJ('q')}+\partial_t ${cE('g')}`,
  S`${cJ("r'")}=${cJ('r')}+\partial_t ${cE('h')}`,
  // B  magnetic force from the electromagnetic momentum
  S`\mu ${cB(S`\alpha`)}=\partial_y ${cA('H')}-\partial_z ${cA('G')}`,
  S`\mu ${cB(S`\beta`)}=\partial_z ${cA('F')}-\partial_x ${cA('H')}`,
  S`\mu ${cB(S`\gamma`)}=\partial_x ${cA('G')}-\partial_y ${cA('F')}`,
  // C  electric currents
  S`\partial_y ${cB(S`\gamma`)}-\partial_z ${cB(S`\beta`)}=4\pi ${cJ("p'")}`,
  S`\partial_z ${cB(S`\alpha`)}-\partial_x ${cB(S`\gamma`)}=4\pi ${cJ("q'")}`,
  S`\partial_x ${cB(S`\beta`)}-\partial_y ${cB(S`\alpha`)}=4\pi ${cJ("r'")}`,
  // D  electromotive force
  S`${cE('P')}=\mu(${cB(S`\gamma`)}\dot y-${cB(S`\beta`)}\dot z)-\partial_t ${cA('F')}-\partial_x ${cA(S`\Psi`)}`,
  S`${cE('Q')}=\mu(${cB(S`\alpha`)}\dot z-${cB(S`\gamma`)}\dot x)-\partial_t ${cA('G')}-\partial_y ${cA(S`\Psi`)}`,
  S`${cE('R')}=\mu(${cB(S`\beta`)}\dot x-${cB(S`\alpha`)}\dot y)-\partial_t ${cA('H')}-\partial_z ${cA(S`\Psi`)}`,
  // E  electric elasticity
  S`${cE('P')}=k\,${cE('f')}`, S`${cE('Q')}=k\,${cE('g')}`, S`${cE('R')}=k\,${cE('h')}`,
  // F  electric resistance
  S`${cE('P')}=-\varrho\,${cJ('p')}`, S`${cE('Q')}=-\varrho\,${cJ('q')}`, S`${cE('R')}=-\varrho\,${cJ('r')}`,
  // G  free electricity
  S`${cR('e')}+\partial_x ${cE('f')}+\partial_y ${cE('g')}+\partial_z ${cE('h')}=0`,
  // H  continuity
  S`\partial_t ${cR('e')}+\partial_x ${cJ('p')}+\partial_y ${cJ('q')}+\partial_z ${cJ('r')}=0`,
];

// The eight groups. lines: indices into MAXWELL. law: the vector law it
// folds into (I to IV), or an aside: 'D' (D = εE), 'ohm', 'cont'.
// map: the stage map that shows the group's main quantity in this plane.
export const GROUPS = [
  { g: 'A', name: 'Total currents', lines: [0, 1, 2], law: 'IV' },
  { g: 'B', name: 'Magnetic force', lines: [3, 4, 5], law: 'II' },
  { g: 'C', name: 'Electric currents', lines: [6, 7, 8], law: 'IV' },
  { g: 'D', name: 'Electromotive force', lines: [9, 10, 11], law: 'III' },
  { g: 'E', name: 'Electric elasticity', lines: [12, 13, 14], law: 'diel' },
  { g: 'F', name: 'Electric resistance', lines: [15, 16, 17], law: 'ohm' },
  { g: 'G', name: 'Free electricity', lines: [18], law: 'I' },
  { g: 'H', name: 'Continuity', lines: [19], law: 'cont' },
];
// The twenty quantities, as Maxwell named them, with today's names.
export const QUANTITIES = [
  [S`${cE('P')},${cE('Q')},${cE('R')}`, 'electromotive force', S`${vE}`],
  [S`${cE('f')},${cE('g')},${cE('h')}`, 'electric displacement', S`${vD}`],
  [S`${cB(S`\alpha`)},${cB(S`\beta`)},${cB(S`\gamma`)}`, 'magnetic force', cB(S`\mathbf H`)],
  [S`${cA('F')},${cA('G')},${cA('H')}`, 'electromagnetic momentum', vA],
  [S`${cJ('p')},${cJ('q')},${cJ('r')}`, 'conduction current', vJ],
  [S`${cJ("p'")},${cJ("q'")},${cJ("r'")}`, 'total current', S`${vJ}+${dt(vD)}`],
  [cA(S`\Psi`), 'electric potential', phi],
  [cR('e'), 'free electricity', rho],
];

export const LAWS = {
  I: S`\nabla\cdot${vE}=\frac{${rho}}{\varepsilon_0}`,
  II: S`\nabla\cdot${vB}=0`,
  III: S`\nabla\times${vE}=-${dt(vB)}`,
  IV: S`\nabla\times${vB}=\mu_0${vJ}+\mu_0\varepsilon_0${dt(vE)}`,
  diel: S`${vD}=\varepsilon${vE}`,
  ohm: S`${vJ}=\sigma${vE}`,
  cont: S`\nabla\cdot${vJ}+${dt(rho)}=0`,
  dF: S`\mathrm dF=0`,
  dsF: S`\mathrm d{\star}F=${cJ('J')}`,
};

const comp = (F, f, i) => {
  const [a, b] = { x: ['y', 'z'], y: ['z', 'x'], z: ['x', 'y'] }[i];
  return S`(\nabla\times${f(S`\mathbf ${F}`)})_${i}=\partial_${a} ${f(`${F}_${b}`)}-\partial_${b} ${f(`${F}_${a}`)}`;
};

export const TEX = {
  // Heaviside's four and the asides, the two forms (also used inline in prose)
  ...Object.fromEntries(Object.entries(LAWS).map(([k, t]) => ['law' + k, [t, 'd']])),

  // curl: three planes
  cBx: [comp('B', cB, 'x'), 'd'], cBy: [comp('B', cB, 'y'), 'd'], cBz: [comp('B', cB, 'z'), 'd'],
  cEx: [comp('E', cE, 'x'), 'd'], cEy: [comp('E', cE, 'y'), 'd'], cEz: [comp('E', cE, 'z'), 'd'],
  curlDef: [S`(\nabla\times\mathbf F)\cdot\hat{\mathbf n}=\lim_{S\to 0}\frac{1}{|S|}\oint_{\partial S}\mathbf F\cdot\mathrm d\boldsymbol\ell`, 'd'],
  curlBvac: [S`\nabla\times${vB}=\mu_0\varepsilon_0${dt(vE)}`, 'd'],
  curlE: [S`\nabla\times${vE}=-${dt(vB)}`, 'd'],
  curlLC: [S`(\nabla\times\mathbf F)_i=\varepsilon_{ijk}\,\partial_j F_k`, 'd'],

  // divergence: a small cube
  divE: [S`\nabla\cdot${vE}=\partial_x ${cE('E_x')}+\partial_y ${cE('E_y')}+\partial_z ${cE('E_z')}`, 'd'],
  divB: [S`\nabla\cdot${vB}=\partial_x ${cB('B_x')}+\partial_y ${cB('B_y')}+\partial_z ${cB('B_z')}`, 'd'],
  divDef: [S`\nabla\cdot\mathbf F=\lim_{V\to 0}\frac{1}{|V|}\oint_{\partial V}\mathbf F\cdot\mathrm d\mathbf S`, 'd'],
  divcurl: [S`\nabla\cdot(\nabla\times${vA})=0`, 'd'],

  // the potentials and the gauge
  pB: [S`${vB}=\nabla\times${vA}`, 'd'],
  pE: [S`${vE}=-\nabla${phi}-${dt(vA)}`, 'd'],
  gaugeA: [S`${vA}\;\to\;${vA}+\nabla${chi}`, 'd'],
  gaugeP: [S`${phi}\;\to\;${phi}-${dt(chi)}`, 'd'],
  curlgrad: [S`\nabla\times\nabla${chi}=0`, 'd'],
  lorenz: [S`\nabla\cdot${vA}+\frac{1}{c^2}${dt(phi)}=0`, 'd'],
  dipA: [S`${vA}=\frac{\mu_0}{4\pi}\,\frac{\dot{\mathbf p}(t-r/c)}{r}`, 'd'],

  // the field of the dipole
  Efull: [S`${vE}=\frac{1}{4\pi\varepsilon_0}\Big[\frac{3\hat{\mathbf r}(\hat{\mathbf r}\cdot\mathbf p)-\mathbf p}{r^3}+\frac{3\hat{\mathbf r}(\hat{\mathbf r}\cdot\dot{\mathbf p})-\dot{\mathbf p}}{c\,r^2}+\frac{\hat{\mathbf r}\times(\hat{\mathbf r}\times\ddot{\mathbf p})}{c^2 r}\Big]`, 'd'],
  Bfull: [S`${vB}=-\frac{\mu_0}{4\pi}\,\hat{\mathbf r}\times\Big[\frac{\dot{\mathbf p}}{r^2}+\frac{\ddot{\mathbf p}}{c\,r}\Big]`, 'd'],
  lines: [S`\sin^2\theta\Big[\frac{\cos(kr-\omega t)}{kr}+\sin(kr-\omega t)\Big]=\text{const}`, 'd'],
  power: [S`\frac{\mathrm dP}{\mathrm d\Omega}=\frac{\mu_0\,\ddot p^{\,2}}{16\pi^2 c}\,\sin^2\theta`, 'd'],
  terms: [S`\frac{1}{(kr)^3},\quad\frac{1}{(kr)^2},\quad\frac{1}{kr}`, 'd'],

  // forms
  Fdef: [S`F=${vB}+${vE}\wedge\mathrm dt`, 'd'],
  FdA: [S`F=\mathrm d${cA('A')}`, 'd'],
  ddA: [S`\mathrm dF=\mathrm d\,\mathrm d${cA('A')}=0`, 'd'],
  dd0: [S`\partial\,\partial=0`, 'd'],
  Fmat: [S`F_{\mu\nu}=\begin{pmatrix}0&-${cE('E_x')}&-${cE('E_y')}&-${cE('E_z')}\\${cE('E_x')}&0&${cB('B_z')}&-${cB('B_y')}\\${cE('E_y')}&-${cB('B_z')}&0&${cB('B_x')}\\${cE('E_z')}&${cB('B_y')}&-${cB('B_x')}&0\end{pmatrix}`, 'd'],
  dFc: [S`\partial_\lambda F_{\mu\nu}+\partial_\mu F_{\nu\lambda}+\partial_\nu F_{\lambda\mu}=0`, 'd'],
  dsFc: [S`\partial_\mu F^{\nu\mu}=${cJ(S`J^\nu`)}`, 'd'],
  tXYZ: [S`\partial_x ${cB('B_x')}+\partial_y ${cB('B_y')}+\partial_z ${cB('B_z')}=0`, 'd'],
  tTYZ: [S`\partial_t ${cB('B_x')}+\partial_y ${cE('E_z')}-\partial_z ${cE('E_y')}=0`, 'd'],
  tTZX: [S`\partial_t ${cB('B_y')}+\partial_z ${cE('E_x')}-\partial_x ${cE('E_z')}=0`, 'd'],
  tTXY: [S`\partial_t ${cB('B_z')}+\partial_x ${cE('E_y')}-\partial_y ${cE('E_x')}=0`, 'd'],

  // inline symbols for prose and labels
  iE: [vE, 'i'], iB: [vB, 'i'], iA: [vA, 'i'], iJ: [vJ, 'i'], iD: [vD, 'i'], iphi: [phi, 'i'], ichi: [chi, 'i'], irho: [rho, 'i'],
  iF: [S`F`, 'i'], id: [S`\mathrm d`, 'i'], istar: [S`{\star}`, 'i'], ilam: [cL(S`\lambda`), 'i'], ikr1: [S`kr=1`, 'i'],
  idEdt: [dt(vE), 'i'], idBdt: [dt(vB), 'i'], icurlB: [S`\nabla\times${vB}`, 'i'], icurlE: [S`\nabla\times${vE}`, 'i'],
  idivE: [S`\nabla\cdot${vE}`, 'i'], idivB: [S`\nabla\cdot${vB}`, 'i'], isin2: [S`\sin^2\theta`, 'i'],
  ir3: [S`1/r^3`, 'i'], ir2: [S`1/r^2`, 'i'], ir1: [S`1/r`, 'i'], ih: [S`h`, 'i'], ih2: [S`h^2`, 'i'], ih3: [S`h^3`, 'i'],
  iByz: [S`\partial_y ${cB('B_z')}-\partial_z ${cB('B_y')}`, 'i'], ipartial: [S`\partial`, 'i'], iJnu: [cJ(S`J^\nu`), 'i'],
  iFmn: [S`F_{\mu\nu}`, 'i'], ieps: [S`\varepsilon_{ijk}`, 'i'], ichiG: [S`${chi}=g\cos\omega t\;e^{-|\mathbf x-\mathbf c|^2/w^2}`, 'i'],
};

// Stage labels at the tips of the arrows.
TEX.lcurlB = [S`\nabla\times${vB}`, 'i'];
TEX.ldispB = [S`\mu_0\varepsilon_0${dt(vE)}`, 'i'];
TEX.lcurlE = [S`\nabla\times${vE}`, 'i'];
TEX.lmdBdt = [S`-${dt(vB)}`, 'i'];

// Map buttons: Maxwell's symbol and today's name of the quantity shown.
Object.assign(TEX, {
  sb: [cB(S`\beta`), 'i'], sBy: [cB('B_y'), 'i'],
  sP: [cE('P'), 'i'], sEx: [cE('E_x'), 'i'], sR: [cE('R'), 'i'], sEz: [cE('E_z'), 'i'],
  sp1: [cJ("p'"), 'i'], sJx: [S`\partial_t ${cE('E_x')}`, 'i'], sr1: [cJ("r'"), 'i'], sJz: [S`\partial_t ${cE('E_z')}`, 'i'],
  sH: [cA('H'), 'i'], sAz: [cA('A_z'), 'i'], sPsi: [cA(S`\Psi`), 'i'], sphi: [phi, 'i'],
});

// The sixteen cells of F_{μν} (row μ, column ν = t x y z), for the grid
// of the forms chapter: Fc0 … Fc15.
export const FCELLS = [
  '0', S`-${cE('E_x')}`, S`-${cE('E_y')}`, S`-${cE('E_z')}`,
  cE('E_x'), '0', cB('B_z'), S`-${cB('B_y')}`,
  cE('E_y'), S`-${cB('B_z')}`, '0', cB('B_x'),
  cE('E_z'), cB('B_y'), S`-${cB('B_x')}`, '0'];
FCELLS.forEach((t, i) => { TEX['Fc' + i] = [t, 'i']; });
['t', 'x', 'y', 'z'].forEach(a => { TEX['ix' + a] = [a, 'i']; });

// Every Maxwell line is a display formula too: m01 … m20.
MAXWELL.forEach((t, i) => { TEX['m' + String(i + 1).padStart(2, '0')] = [t, 'd']; });
QUANTITIES.forEach(([a, , b], i) => { TEX['q' + i + 'a'] = [a, 'i']; TEX['q' + i + 'b'] = [b, 'i']; });
