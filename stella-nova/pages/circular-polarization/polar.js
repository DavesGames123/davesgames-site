// ============================================================================
//  CIRCULAR POLARIZATION  ·  polar.js — polarization state from the phase δ
// ----------------------------------------------------------------------------
//  E = cos φ · ê1 + cos(φ − δ) · ê2 with φ = k·r − ω·t (equal amplitudes).
//  No DOM and no THREE, so polar.test.mjs runs it in Node.
//    polState(δ°)  → { s, c, chi, kind, turn, psi }
//    jonesText(δ°) → the Jones vector (1, e^(−iδ))/√2 as text
// ============================================================================
// For equal amplitudes and phase δ between the components:
//   sin 2χ = sin δ (ellipticity angle χ), tilt ψ = ±45° when not circular,
//   turn sign = sign(sin δ) (+1 clockwise as seen by the receiver).
export function polState(deltaDeg) {
  const d = deltaDeg * Math.PI / 180, s = Math.sin(d), c = Math.cos(d);
  const chi = 0.5 * Math.asin(Math.max(-1, Math.min(1, s))) * 180 / Math.PI;
  const kind = Math.abs(s) > 0.9995 ? 'circular' : Math.abs(s) < 0.0005 ? 'linear' : 'elliptical';
  const turn = kind === 'linear' ? 0 : Math.sign(s);
  const psi = kind === 'circular' ? null : (c >= 0 ? 45 : -45);
  return { s, c, chi, kind, turn, psi };
}
// The second Jones component e^(−iδ) = cos δ − i sin δ, as text.
export function jonesText(deltaDeg) {
  const d = deltaDeg * Math.PI / 180, re = Math.cos(d), im = -Math.sin(d);
  const r = v => Math.abs(v) < 0.0005 ? 0 : v;
  const R = r(re), I = r(im);
  const num = v => (Math.abs(Math.abs(v) - 1) < 0.0005 ? '' : Math.abs(v).toFixed(2));
  let z;
  if (I === 0) z = (R < 0 ? '−' : '') + (num(R) || '1');
  else if (R === 0) z = (I < 0 ? '−' : '') + num(I) + 'i';
  else z = (R < 0 ? '−' : '') + Math.abs(R).toFixed(2) + (I < 0 ? ' − ' : ' + ') + Math.abs(I).toFixed(2) + 'i';
  return `(1, ${z})/√2`;
}

