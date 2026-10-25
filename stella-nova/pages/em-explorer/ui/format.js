// ============================================================================
//  EM EXPLORER  ·  ui/format.js — numbers and sizes for people
// ----------------------------------------------------------------------------
//  Pure functions, no DOM. tests.mjs tests them in node.
//
//  grep -n targets
//    length .......... "export function fmtLength"
//    voxel size ...... "export function fmtVoxel"
//    volume size ..... "export function fmtExtent"
//    big counts ...... "export function fmtCount"
// ============================================================================

// fmtLength(nm) -> '8 nm', '1.2 µm', '35 µm', '1.3 mm'
export function fmtLength(nm) {
  const v = Math.abs(Number(nm));
  if (!Number.isFinite(v)) return '';
  const fix = (x) => (x >= 100 ? Math.round(x).toString() : x >= 10 ? (Math.round(x * 10) / 10).toString() : (Math.round(x * 100) / 100).toString());
  if (v < 1000) return fix(v) + ' nm';
  if (v < 1e6) return fix(v / 1000) + ' µm';
  return fix(v / 1e6) + ' mm';
}

// fmtVoxel([8,8,8]) -> '8 nm'; fmtVoxel([8,8,40]) -> '8 × 8 × 40 nm'
export function fmtVoxel(res) {
  if (!Array.isArray(res) || res.length < 3) return '';
  const r = res.map((v) => Math.round(Number(v) * 100) / 100);
  if (r[0] === r[1] && r[1] === r[2]) return r[0] + ' nm';
  return r.join(' × ') + ' nm';
}

// fmtExtent(size voxels, res nm) -> '250 × 280 × 200 µm'
export function fmtExtent(size, res) {
  if (!Array.isArray(size) || !Array.isArray(res) || size.length < 3 || res.length < 3) return '';
  const nm = size.map((s, i) => Number(s) * Number(res[i]));
  if (nm.some((v) => !Number.isFinite(v) || v <= 0)) return '';
  const unit = Math.max(...nm) >= 1e6 ? ['mm', 1e6] : Math.max(...nm) >= 1000 ? ['µm', 1000] : ['nm', 1];
  const f = (v) => { const x = v / unit[1]; return x >= 100 ? Math.round(x) : x >= 10 ? Math.round(x * 10) / 10 : Math.round(x * 100) / 100; };
  return nm.map(f).join(' × ') + ' ' + unit[0];
}

// fmtCount(3.2e11) -> '320 billion'
export function fmtCount(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  const steps = [[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']];
  for (const [d, w] of steps) if (v >= d) { const x = v / d; return (x >= 100 ? Math.round(x) : Math.round(x * 10) / 10) + ' ' + w; }
  return String(Math.round(v));
}
