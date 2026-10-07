// ============================================================================
//  PARTICLE COLLIDER  ·  physinfo.js — what each product of a collision is
// ----------------------------------------------------------------------------
//  No DOM. The detail panel ("a deeper look") reads this module.
//    ABOUT[name] ..... a short plain-language description, the static
//                      properties (mass, charge, spin, mean life and c tau,
//                      quark content, PDG id) for particles, and a text for
//                      composite and virtual objects (jet, tower, MET, a
//                      muon hit, a vertex, the collision, Z, H, W, top)
//    detail(o, ev) ... the full card of one object: title, text, static
//                      properties, measured quantities in this event,
//                      the lineage in the decay chain, constituents, and
//                      for a resonance the invariant-mass calculation
//    lineage(o, ev) .. from the colliding beams through the hard process
//                      to this object: [{ label, key | null, node }]
//  Values: PDG 2024. Energies in MeV inside, shown in GeV.
//
//  GREP MAP  export const ABOUT · export function detail · function lineage
// ============================================================================
import { PART } from './particles.js';
import { ancestors } from './picking.js';

const C_MM_NS = 299.792458;
const P = (desc, extra = {}) => ({ desc, ...extra });
export const ABOUT = {
  'mu-': P('A muon: a heavy cousin of the electron, 207 times its mass. It loses energy only by ionisation, so it crosses the calorimeters and the iron of the return yoke and is the one charged particle that reaches the outer muon chambers. That is why muons mark the cleanest signatures at a collider.', { spin: '1/2', quarks: 'none (a lepton)', family: 'lepton, second generation' }),
  'e-': P('An electron: the lightest charged particle. In the tracker it leaves a curved track; in the crystals of the electromagnetic calorimeter it radiates photons that make electron-positron pairs, and the cascade stops within about 25 radiation lengths.', { spin: '1/2', quarks: 'none (a lepton)', family: 'lepton, first generation' }),
  gamma: P('A photon: a quantum of light, with no charge and no mass. It leaves no track; it starts an electromagnetic shower in the crystal calorimeter. In the tracker material it can convert into an electron-positron pair.', { spin: '1', quarks: 'none (a gauge boson)', family: 'gauge boson of electromagnetism' }),
  'pi+': P('A charged pion: the lightest meson, an up quark with an anti-down quark. Pions are most of the particles in a jet. In the hadron calorimeter they make a nuclear cascade; slow ones decay to a muon and a neutrino.', { spin: '0', quarks: 'u d̄', family: 'meson' }),
  pi0: P('A neutral pion: it decays in 10⁻¹⁶ s into two photons, so it shows as two close electromagnetic showers. Neutral pions carry the electromagnetic part of every hadron shower.', { spin: '0', quarks: '(u ū − d d̄)/√2', family: 'meson' }),
  'K+': P('A charged kaon: a meson with a strange quark. It lives long enough to cross the tracker; it can decay to a muon and a neutrino (a kink on its track).', { spin: '0', quarks: 'u s̄', family: 'meson (strange)' }),
  K0S: P('A short-lived neutral kaon: invisible until it decays, a few centimetres out, into two charged pions. The two tracks open from a displaced vertex, a "V".', { spin: '0', quarks: '(d s̄ − s d̄)/√2', family: 'meson (strange)' }),
  K0L: P('A long-lived neutral kaon: no track; it crosses the tracker and the electromagnetic calorimeter and deposits its energy in the hadron calorimeter.', { spin: '0', quarks: '(d s̄ + s d̄)/√2', family: 'meson (strange)' }),
  p: P('A proton: two up quarks and a down quark. Here a product of a hadronic cascade or of fragmentation; it leaves a track and a hadron shower.', { spin: '1/2', quarks: 'u u d', family: 'baryon' }),
  n: P('A neutron: no charge, no track. It deposits energy only through nuclear collisions in the hadron calorimeter; slow neutrons carry energy away unseen.', { spin: '1/2', quarks: 'u d d', family: 'baryon' }),
  B: P('A B hadron: a bound state with a bottom quark. It flies about half a millimetre per unit of beta gamma before it decays, so its daughters start from a displaced vertex: the mark of a b jet.', { spin: '0', quarks: 'd b̄ (B⁰)', family: 'meson (bottom)' }),
  nu: P('A neutrino: it interacts so weakly that it leaves the detector without a trace. Its momentum shows only as an imbalance of the transverse momentum: the missing transverse energy.', { spin: '1/2', quarks: 'none (a lepton)', family: 'lepton' }),
  jet: P('A jet: a quark or a gluon from the collision cannot exist alone, so it turns into a narrow spray of hadrons (pions, kaons, protons) around its direction. The detector sees the spray: tracks and calorimeter towers inside a cone of R = 0.4. Its energy estimates the energy of the parent quark or gluon.'),
  tower: P('A calorimeter tower: the energy in one 0.087 × 0.087 cell of pseudorapidity and azimuth, summed over the crystal calorimeter (electromagnetic part) and the brass-scintillator calorimeter (hadronic part).'),
  met: P('Missing transverse energy: the beams carry no transverse momentum, so the products should balance in the transverse plane. The vector that restores the balance points along the momentum of the particles that escaped unseen, mostly neutrinos.'),
  muhit: P('A hit in a muon chamber: the gas chambers sit between the iron plates of the return yoke, outside everything else. A track that reaches them is almost certainly a muon.'),
  vertex: P('A secondary vertex: the point where a particle decayed (a kaon, a B hadron, a pion) or where a photon converted into an electron-positron pair in the tracker material.'),
  collision: P('The collision point: two particles of the beams met here, inside a region about 4.5 cm long. The hard process (a Z, a Higgs boson, a top pair, two partons) happened here, and every other object of the event comes from it.'),
  Z: P('The Z boson: a carrier of the weak force, 91.19 GeV. It lives 3 × 10⁻²⁵ s and decays at the collision point, here into a lepton pair. Its mass comes back from the invariant mass of the pair.', { spin: '1', m: 91187.6, pdg: 23, tau: '2.6×10⁻²⁵ s', quarks: 'none (a gauge boson)' }),
  'Z*': P('An off-shell Z boson: the Higgs boson is too light to make two real Z bosons, so one of them is virtual, with a mass well below 91 GeV.', { spin: '1', pdg: 23 }),
  H: P('The Higgs boson: the quantum of the field that gives the W, the Z and the fermions their masses, 125 GeV, discovered in 2012 in exactly these channels: two photons, and four leptons.', { spin: '0', m: 125250, pdg: 25, tau: '1.6×10⁻²² s', quarks: 'none (a scalar boson)' }),
  W: P('The W boson: the charged carrier of the weak force, 80.4 GeV. It decays to a lepton and a neutrino, or to two quarks.', { spin: '1', m: 80377, pdg: 24, tau: '3×10⁻²⁵ s' }),
  t: P('The top quark: the heaviest known particle, 172.5 GeV. It decays before it can form a hadron, almost always to a W boson and a b quark.', { spin: '1/2', m: 172500, pdg: 6, tau: '5×10⁻²⁵ s', quarks: 't' }),
  'tt̄': P('A top-antitop pair, made by gluon fusion (or quark-antiquark annihilation).'),
  b: P('A bottom quark: it becomes a b jet with a B hadron that flies a few millimetres before it decays.', { spin: '1/2', m: 4180, pdg: 5 }),
  q: P('A light quark (up, down, strange, charm): it becomes a jet.', { spin: '1/2', pdg: 1 }),
  g: P('A gluon: the carrier of the strong force; it becomes a jet, on average wider and with more particles than a quark jet.', { spin: '1', pdg: 21 }),
  'parton pair': P('Two partons (quarks or gluons) scattered hard, back to back in the transverse plane: the most common hard process at a hadron collider.'),
  'particle gun': P('A particle gun: one particle shot from the origin with a set energy and direction, the way detector physicists test a simulation.'),
  'soft collisions': P('Soft inelastic collisions: no hard process, only many low-momentum hadrons, mostly pions.'),
};
ABOUT['mu+'] = ABOUT['mu-']; ABOUT['e+'] = ABOUT['e-']; ABOUT['pi-'] = ABOUT['pi+']; ABOUT['K-'] = ABOUT['K+'];

const GeV = v => `${(v / 1000).toFixed(Math.abs(v) < 10000 ? 2 : 1)} GeV`;
const fmtLife = tau => !tau ? 'stable' : `${tau >= 1 ? tau.toPrecision(3) + ' ns' : (tau * 1e3).toPrecision(3) + ' ps'} (cτ ${(tau * C_MM_NS >= 1000 ? (tau * C_MM_NS / 1000).toPrecision(3) + ' m' : tau * C_MM_NS >= 1 ? (tau * C_MM_NS).toPrecision(3) + ' mm' : (tau * C_MM_NS * 1e3).toPrecision(3) + ' μm')})`;
const charge = q => q > 0 ? '+1' : q < 0 ? '−1' : '0';
const SYS = { pix: 'pixel tracker', sct: 'strip tracker', pipe: 'beam pipe', ecal: 'ECAL (PbWO₄)', hcal: 'HCAL brass', hcalS: 'HCAL scintillator', sol: 'solenoid', yoke: 'iron yoke', mu: 'muon gas', air: 'air' };

// where a track sits in the decay chain
export function lineage(o, ev) {
  const { R, info, objs } = ev, out = [];
  const beams = info.beams ? `${info.beams[0]} + ${info.beams[1]}` : 'p + p';
  out.push({ label: `${beams} · √s ${((info.sqrtS || 0) / 1e6).toPrecision(3)} TeV`, key: 'vx' });
  const tree = info.tree;
  // the hard leaf of this object: a primary 'hard' track matched to hard[] by name and direction
  const leafPath = (node, test, path = []) => { if (!node) return null; const p = [...path, node]; if (test(node)) return p; for (const k of node.kids || []) { const r = leafPath(k, test, p); if (r) return r; } return null; };
  let root = -1;
  if (o.kind === 'track') { const anc = ancestors(R, o.k); root = anc.length ? anc[anc.length - 1] : o.k; }
  const T0 = root >= 0 ? R.tracks[root] : null;
  let path = null;
  if (T0 && tree) {
    const u = T0.u0;
    path = leafPath(tree, n => n.hard != null && info.hard[n.hard] && (info.hard[n.hard][0] === T0.name || (T0.primary !== 'hard' && 'qgb'.includes(info.hard[n.hard][0]))) && (() => { const p = info.hard[n.hard][1], pm = Math.hypot(p[1], p[2], p[3]) || 1; return (p[1] * u[0] + p[2] * u[1] + p[3] * u[2]) / pm > (T0.primary === 'hard' ? 0.999 : 0.9); })());
  }
  if (o.kind === 'jet' && tree) {
    path = leafPath(tree, n => { if (n.hard == null) return false; const p = n.p4, pt = Math.hypot(p[1], p[2]); if (!pt) return false; const eta = Math.asinh(p[3] / pt), phi = Math.atan2(p[2], p[1]); return Math.hypot(eta - o.eta, Math.atan2(Math.sin(phi - o.phi), Math.cos(phi - o.phi))) < 0.5; });
  }
  if (path) for (const n of path) out.push({ label: n.hard != null ? `${(PART[n.name] || {}).label || n.name} from the hard process` : `${n.name}${n.mass ? ` (${GeV(n.mass)})` : ''}`, key: null, node: n });
  else if (tree && o.kind !== 'collision') out.push({ label: T0 && (T0.primary === 'pu' || T0.primary === 'ue') ? 'soft collision (pile-up or underlying event)' : tree.name, key: null, node: tree });
  if (o.kind === 'track') {
    const anc = ancestors(R, o.k).reverse();
    for (const a of anc) { const ob = objs.byTrack.get(a), T = R.tracks[a]; out.push({ label: `${(PART[T.name] || {}).label || T.name} ${GeV(T.E0)}`, key: ob ? ob.key : null }); }
    out.push({ label: `${(PART[o.name] || {}).label || o.name} (this)`, key: o.key });
  } else if (o.kind !== 'collision') out.push({ label: `${o.name} (this)`, key: o.key });
  return out;
}

export function detail(o, ev) {
  const { R, O, info } = ev;
  const Pt = PART[o.name], A = ABOUT[o.name] || ABOUT[o.kind] || { desc: '' };
  const d = { title: '', sub: '', text: A.desc, props: [], meas: [], lineage: [], parts: [], mass: null };
  const kin = (pT, eta, phi, E) => { const p = pT * Math.cosh(eta); return [['p_T', GeV(pT)], ['η', eta.toFixed(3)], ['φ', phi.toFixed(3)], ['|p|', GeV(p)], ['E', GeV(E)], ['four-momentum (E, px, py, pz)', `(${(E / 1000).toFixed(2)}, ${(pT * Math.cos(phi) / 1000).toFixed(2)}, ${(pT * Math.sin(phi) / 1000).toFixed(2)}, ${(pT * Math.sinh(eta) / 1000).toFixed(2)}) GeV`]]; };
  switch (o.kind) {
    case 'track': {
      d.title = `${Pt ? Pt.label : o.name}`; d.sub = `${A.family || (Pt ? Pt.cls : '')}`;
      if (Pt) d.props.push(['mass', Pt.m ? `${Pt.m < 1000 ? Pt.m.toFixed(3) + ' MeV' : (Pt.m / 1000).toFixed(4) + ' GeV'}` : '0'], ['charge', charge(Pt.q)], ['spin', A.spin || '—'], ['mean life', fmtLife(Pt.tau)], ['quark content', A.quarks || '—'], ['PDG id', String(Pt.pdg)]);
      d.meas.push(...kin(o.pT, o.eta, o.phi, o.E));
      if (o.reco) d.meas.push(['fitted p_T (circle fit)', GeV(o.reco.pT)], ['curvature radius', `${(o.reco.R / 1000).toFixed(2)} m`], ['sagitta', `${o.reco.sag.toFixed(2)} mm over ${(o.reco.L / 1000).toFixed(2)} m`], ['impact parameter d₀', `${o.reco.d0.toFixed(3)} mm`]);
      if (o.T.end) d.meas.push(['fate', `${o.T.fate || '—'} at r = ${(Math.hypot(o.T.end[0], o.T.end[1]) / 1000).toFixed(2)} m, z = ${(o.T.end[2] / 1000).toFixed(2)} m, t = ${o.T.end[3].toFixed(2)} ns`]);
      const lay = new Set(); for (let i = 0; i < R.hits.n; i++) if (R.hits.trk[i] === o.k) lay.add(R.hits.f[i * 6 + 5]);
      let mh = 0; for (let i = 0; i < R.mhits.n; i++) if (R.mhits.trk[i] === o.k) mh++;
      d.meas.push(['silicon layers hit', lay.size ? String(lay.size) : 'none'], ['muon-chamber hits', String(mh)]);
      const dep = o.T.dep || {}, tot = Object.values(dep).reduce((a, b) => a + b, 0);
      d.deposits = Object.entries(dep).filter(([, v]) => v > 0.5).sort((a, b) => b[1] - a[1]).map(([k, v]) => [SYS[k] || k, v]);
      d.meas.push(['energy deposited (with its cascade)', GeV(tot)]);
      break;
    }
    case 'jet': {
      const j = o.jet; d.title = 'Jet'; d.sub = `anti-kT, R = 0.4 · ${j.n} towers`;
      d.meas.push(...kin(j.pT, j.eta, j.phi, j.E), ['jet mass', GeV(j.m)], ['EM fraction', `${(j.emf * 100).toFixed(0)} %`], ['raw p_T and energy scale', `${GeV(j.pTraw)} × ${j.jec.toFixed(2)}`]);
      d.parts = o.towers.slice().sort((a, b) => b.ET - a.ET).slice(0, 12).map(t => ({ key: 'w' + t.c, label: `tower η ${t.eta.toFixed(2)} φ ${t.phi.toFixed(2)}`, value: GeV(t.ET) }));
      const tr = ev.objs.objs.filter(q => q.kind === 'track' && Math.hypot(q.eta - j.eta, Math.atan2(Math.sin(q.phi - j.phi), Math.cos(q.phi - j.phi))) < 0.4).sort((a, b) => b.pT - a.pT).slice(0, 10);
      d.parts.unshift(...tr.map(q => ({ key: q.key, label: `${(PART[q.name] || {}).label || q.name}`, value: GeV(q.pT) })));
      break;
    }
    case 'tower': { const t = o.tower; d.title = 'Calorimeter tower'; d.sub = `η ${t.eta.toFixed(3)} · φ ${t.phi.toFixed(3)}`; d.meas.push(['E_T', GeV(t.ET)], ['E', GeV(t.E)], ['electromagnetic part', GeV(t.em)], ['hadronic part', GeV(t.E - t.em)]); break; }
    case 'met': { const m = o.met; d.title = 'Missing transverse energy'; d.sub = 'the momentum that escaped unseen'; d.meas.push(['MET (measured)', GeV(m.et)], ['φ', m.phi.toFixed(3)], ['true neutrino p_T sum', GeV(m.trueEt)], ['true φ', m.truePhi.toFixed(3)]); d.parts = (R.nu || []).slice(0, 8).map((n, i) => ({ key: null, label: `neutrino ${i + 1}`, value: GeV(Math.hypot(n[0], n[1])) })); break; }
    case 'muhit': { const p = o.pts[0]; d.title = 'Muon-chamber hit'; d.sub = `station ${o.layer + 1}`; d.meas.push(['r', `${(Math.hypot(p[0], p[1]) / 1000).toFixed(2)} m`], ['z', `${(p[2] / 1000).toFixed(2)} m`], ['time', `${p[3].toFixed(2)} ns`]); if (o.k >= 0 && ev.objs.byTrack.get(o.k)) d.parts = [{ key: 't' + o.k, label: 'the track that made it', value: '' }]; break; }
    case 'vertex': { const p = o.pts[0]; d.title = o.name === 'conversion' ? 'Photon conversion' : 'Decay vertex'; d.meas.push(['r', `${Math.hypot(p[0], p[1]).toFixed(1)} mm`], ['z', `${p[2].toFixed(1)} mm`], ['time', `${p[3].toFixed(3)} ns`]); break; }
    case 'collision': {
      d.title = info.title || 'Collision'; d.sub = info.process || '';
      d.meas.push(['beams', info.beamLabel || 'p + p'], ['√s', `${((info.sqrtS || 0) / 1e6).toPrecision(4)} TeV`], ['vertex z', `${(info.vertex ? info.vertex[2] : 0).toFixed(1)} mm`], ['pile-up vertices', String(info.pileup || 0)]);
      if (info.tree) d.parts = (info.tree.kids || []).map(n => ({ key: null, label: n.name, value: n.mass ? GeV(n.mass) : '' }));
      break;
    }
  }
  if (Pt && !d.props.length && o.kind === 'track') d.props.push(['PDG id', String(Pt.pdg)]);
  d.lineage = lineage(o, ev);
  // a resonance in the lineage: show its invariant mass from the reconstructed daughters
  const res = d.lineage.map(x => x.node).filter(n => n && n.kids && n.kids.length >= 2 && n.mass && /^(Z|Z\*|H)$/.test(n.name)).pop();
  if (res && O) d.mass = massCalc(res, ev);
  return d;
}

// the invariant mass of a resonance from the reconstructed objects that
// match its leaves: m^2 = (sum E)^2 - |sum p|^2
export function massCalc(node, ev) {
  const { O, info } = ev, leaves = [];
  const walk = n => { if (n.hard != null) leaves.push(n); for (const k of n.kids || []) walk(k); };
  walk(node);
  const cands = [...O.muons.map(m => ({ ...m, kind: 'mu', phi: m.phi0, m0: 105.66 })), ...O.electrons.map(e => ({ ...e, kind: 'e', m0: 0.511 })), ...O.photons.map(g => ({ ...g, kind: 'gamma', m0: 0 }))];
  const rows = [], s = [0, 0, 0, 0];
  for (const l of leaves) {
    const p = info.hard[l.hard][1], pt = Math.hypot(p[1], p[2]); if (!pt) continue;
    const eta = Math.asinh(p[3] / pt), phi = Math.atan2(p[2], p[1]);
    const c = cands.filter(q => Math.hypot(q.eta - eta, Math.atan2(Math.sin(q.phi - phi), Math.cos(q.phi - phi))) < 0.08).sort((a, b) => Math.abs(a.pT - pt) - Math.abs(b.pT - pt))[0];
    if (!c) { rows.push({ name: info.hard[l.hard][0], missing: true }); continue; }
    const E = Math.hypot(c.pT * Math.cosh(c.eta), c.m0), v = [E, c.pT * Math.cos(c.phi), c.pT * Math.sin(c.phi), c.pT * Math.sinh(c.eta)];
    for (let i = 0; i < 4; i++) s[i] += v[i];
    rows.push({ name: info.hard[l.hard][0], v });
  }
  const m = Math.sqrt(Math.max(0, s[0] * s[0] - s[1] * s[1] - s[2] * s[2] - s[3] * s[3]));
  return { name: node.name, rows, sum: s, m, truth: node.mass };
}
