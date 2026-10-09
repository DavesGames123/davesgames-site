// Physics and engineering: closed-form cases.
import { TOOLS, ellipK, eng, decodeBands, encodeBands, nearestE } from '../tools/phys.js';

const val = (r, i = 0) => parseFloat(String(r.rows[i][1]).replace(/[^\d.eE+-].*$/, ''));
const row = (r, label) => r.rows.find(x => x[0].startsWith(label));

export default function ({ ok, near, throws }) {
  const P = (v) => TOOLS.projectile.run({ v: '20 m/s', a: '45 deg', h: '0 m', g: '9.80665 m/s^2', ...v });
  near(val(P({})), 400 / 9.80665, 1e-7, 'projectile: R = v²/g at 45° on flat ground');
  near(parseFloat(row(P({}), 'Maximum height')[1]), 400 * 0.5 / (2 * 9.80665), 1e-7, 'projectile: H = v² sin²θ / 2g');
  near(parseFloat(row(P({ h: '10 m', a: '0 deg', v: '5 m/s' }), 'Time of flight')[1]), Math.sqrt(2 * 10 / 9.80665), 1e-7, 'projectile: horizontal launch from 10 m: t = √(2h/g)');
  near(ellipK(0), Math.PI / 2, 1e-15, 'K(0) = π/2');
  near(ellipK(Math.SQRT1_2), 1.8540746773013719, 1e-14, 'K(1/√2) = 1.854074677301372 (DLMF)');
  const pend = TOOLS.shm.run({ mode: 'pendulum', k: '', m: '', L: '1 m', g: '9.80665 m/s^2', A: '90 deg' });
  near(parseFloat(row(pend, 'Exact period')[1]) / parseFloat(row(pend, 'Small-angle period')[1]), 1.1803405990160962, 1e-7, 'pendulum at 90°: T/T₀ = 1.18034060');
  near(val(TOOLS.shm.run({ mode: 'spring', k: '50 N/m', m: '0.5 kg', L: '', g: '', A: '' })), 10, 1e-12, 'spring: ω = √(k/m) = 10 rad/s');
  const ph = TOOLS.photon.run({ x: '1 eV' });
  near(val(ph), 1239.841984, 1e-9, 'photon: 1 eV is 1239.841984 nm');
  near(parseFloat(row(TOOLS.photon.run({ x: '500 nm' }), 'Energy')[1]), 2.479683969, 1e-9, 'photon: 500 nm is 2.479683969 eV');
  const bb = TOOLS.blackbody.run({ T: '5772 K', l1: '1 nm', l2: '1 m' });
  near(val(bb), 2.897771955185172e-3 / 5772 * 1e9, 1e-7, 'black body: Wien peak at 5772 K = 502.04 nm');
  near(parseFloat(row(bb, 'Radiant exitance')[1]), 5.670374419184431e-8 * 5772 ** 4, 1e-7, 'black body: σT⁴ at 5772 K');
  near(parseFloat(row(bb, 'Fraction')[1]), 100, 1e-6, 'black body: the band 1 nm to 1 m holds 100 % of σT⁴ (quadrature check)');
  const vis = TOOLS.blackbody.run({ T: '5772 K', l1: '0 nm', l2: '502.0408 nm' });
  near(parseFloat(row(vis, 'Fraction')[1]), 25.0055, 2e-4, 'black body: 25.0 % of the power is below the Wien peak (known F(0..λmax) = 0.25005)');
  const rel = TOOLS.relativity.run({ kind: 'beta', x: '0.6', m: '1 $me', t: '1 s' });
  near(val(rel), 1.25, 1e-14, 'relativity: β = 0.6 gives γ = 1.25');
  near(parseFloat(row(rel, 'Rest energy')[1]), 0.51099895069, 1e-10, 'relativity: m_e c² = 0.51099895069 MeV (CODATA 2022)');
  near(parseFloat(row(rel, 'Kinetic')[1]), 0.25 * 0.51099895069, 1e-9, 'relativity: KE = (γ − 1) m c²');
  const lhc = TOOLS.relativity.run({ kind: 'ke', x: '6.8 TeV', m: '1 $mp', t: '' });
  near(val(lhc), 1 + 6.8e6 / 938.27208943, 1e-10, 'relativity: 6.8 TeV proton γ = 7248.4');
  const dz = TOOLS.doppler.run({ mode: 'z', v: '', f: '', vo: '', cs: '', z: '1' });
  near(val(dz), 0.6, 1e-14, 'Doppler: z = 1 is β = 0.6');
  near(val(TOOLS.doppler.run({ mode: 'light', v: '0.6', f: '500 nm', vo: '', cs: '', z: '' })), 1000, 1e-12, 'Doppler: β = 0.6 receding doubles the wavelength');
  near(val(TOOLS.doppler.run({ mode: 'sound', v: '-34.3 m/s', f: '1000 Hz', vo: '0 m/s', cs: '343 m/s', z: '' })), 1000 / 0.9, 1e-9, 'Doppler: sound source approaching at 0.1 c_s gives f/0.9');
  ok(decodeBands(['yellow', 'violet', 'red', 'gold']).value === 4700 && decodeBands(['brown', 'black', 'black', 'red', 'brown']).value === 10000, 'colour code: yellow violet red = 4.7 kΩ; brown black black red = 10 kΩ');
  ok(decodeBands(['brown', 'black', 'gold', 'gold']).value === 1, 'colour code: gold multiplier = 0.1 (1 Ω)');
  ok(encodeBands(68000).join(' ') === 'blue grey orange' && encodeBands(4.7).join(' ') === 'yellow violet gold', 'colour code: 68k = blue grey orange; 4.7 Ω = yellow violet gold');
  ok(nearestE(5000, [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2]) === 4700, 'E12: nearest to 5 kΩ is 4.7 kΩ');
  ok(eng('4k7') === 4700 && eng('2M2') === 2.2e6 && Math.abs(eng('10u') - 1e-5) < 1e-20 && eng('100') === 100, 'engineering values: 4k7, 2M2, 10u, 100');
  const cb = TOOLS.combine.run({ kind: 'R', v: '100 100' });
  ok(cb.rows[0][1] === '200 Ω' && cb.rows[1][1] === '50 Ω', 'two 100 Ω: 200 Ω series, 50 Ω parallel');
  const cc = TOOLS.combine.run({ kind: 'C', v: '10u 10u' });
  ok(cc.rows[0][1] === '5 µF' && cc.rows[1][1] === '20 µF', 'two 10 µF: 5 µF series, 20 µF parallel');
  const rlc = TOOLS.rlc.run({ R: '100', L: '10m', C: '1u' });
  near(parseFloat(row(rlc, 'Resonant')[1]), 1 / (2 * Math.PI * Math.sqrt(1e-8)) / 1000, 1e-5, 'RLC: f₀ = 1/(2π√LC) = 1.5915 kHz');
  near(parseFloat(row(rlc, 'Q (series')[1]), 1, 1e-12, 'RLC: Q = √(L/C)/R = 1');
  const op = TOOLS.optics.run({ mode: 'lens', f: '10 cm', do: '30 cm', di: '', n: '', r1: '', r2: '' });
  near(val(op), 15, 1e-12, 'thin lens: f = 10, dₒ = 30 gives dᵢ = 15 cm');
  near(parseFloat(row(op, 'Magnification')[1]), -0.5, 1e-12, 'thin lens: m = −0.5');
  near(val(TOOLS.optics.run({ mode: 'maker', f: '', do: '', di: '', n: '1.5', r1: '20 cm', r2: '-20 cm' })), 20, 1e-12, 'lensmaker: n = 1.5, R = ±20 cm gives f = 20 cm');
  near(val(TOOLS.db.run({ mode: 'pr', x: '2' })), 3.0102999566398116, 1e-9, 'dB: power ratio 2 = 3.0103 dB');
  near(val(TOOLS.db.run({ mode: 'ar', x: '2' })), 6.020599913279623, 1e-9, 'dB: amplitude ratio 2 = 6.0206 dB');
  near(val(TOOLS.db.run({ mode: 'w', x: '1 W' })), 30, 1e-14, 'dB: 1 W = 30 dBm');
  near(val(TOOLS.db.run({ mode: 'v', x: '0.7745966692 V' }), 1), 0, 0, 'dB: √0.6 V = 0 dBu', 1e-9);
  throws(() => TOOLS.db.run({ mode: 'w', x: '1 J' }), /Give a power|must be a power/, 'dB: an energy is not a power');
}
