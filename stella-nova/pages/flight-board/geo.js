// ============================================================================
//  GEO  ·  great-circle math and local-time formatting (no DOM)
// ----------------------------------------------------------------------------
//  grep -n targets: export function distNm | bearing | gcPath | fmtTime
// ============================================================================

const R_NM = 3440.065;
const rad = (d) => d * Math.PI / 180;
const deg = (r) => r * 180 / Math.PI;

// Great-circle distance in nautical miles.
export function distNm(lat1, lon1, lat2, lon2) {
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Initial bearing from point 1 to point 2, degrees 0..360.
export function bearing(lat1, lon1, lat2, lon2) {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) -
    Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

// Smallest angle between two headings, degrees 0..180.
export function angleDiff(a, b) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

// n+1 points on the great circle from A to B, as [lat, lon]. The longitudes
// are continuous (no jump at the antimeridian), so a path can draw them.
export function gcPath(lat1, lon1, lat2, lon2, n = 96) {
  const v = (la, lo) => [Math.cos(rad(la)) * Math.cos(rad(lo)), Math.cos(rad(la)) * Math.sin(rad(lo)), Math.sin(rad(la))];
  const a = v(lat1, lon1), b = v(lat2, lon2);
  const d = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
  const out = [];
  let prev = lon1;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let p;
    if (d < 1e-9) p = a;
    else {
      const s1 = Math.sin((1 - t) * d) / Math.sin(d), s2 = Math.sin(t * d) / Math.sin(d);
      p = [s1 * a[0] + s2 * b[0], s1 * a[1] + s2 * b[1], s1 * a[2] + s2 * b[2]];
    }
    const la = deg(Math.atan2(p[2], Math.hypot(p[0], p[1])));
    let lo = deg(Math.atan2(p[1], p[0]));
    while (lo - prev > 180) lo -= 360;
    while (lo - prev < -180) lo += 360;
    prev = lo;
    out.push([la, lo]);
  }
  return out;
}

const fmtCache = new Map();
function fmt(tz, opts, key) {
  const k = tz + '|' + key;
  let f = fmtCache.get(k);
  if (!f) {
    try { f = new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: tz || undefined }); }
    catch { f = new Intl.DateTimeFormat('en-GB', opts); }
    fmtCache.set(k, f);
  }
  return f;
}

// "17:33" in the time zone tz.
export function fmtTime(ms, tz) {
  if (ms == null || !isFinite(ms)) return '--:--';
  return fmt(tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, 't').format(ms);
}

// "Mon 5 Oct" in the time zone tz.
export function fmtDate(ms, tz) {
  return fmt(tz, { weekday: 'short', day: 'numeric', month: 'short' }, 'd').format(ms);
}

// Short zone name, for example "CDT" or "GMT+9".
export function tzName(ms, tz) {
  const p = fmt(tz, { timeZoneName: 'short' }, 'z').formatToParts(ms).find((x) => x.type === 'timeZoneName');
  return p ? p.value : '';
}

// Minutes from now as "in 12 min" / "3 min ago".
export function relMin(ms, now = Date.now()) {
  const m = Math.round((ms - now) / 60000);
  if (Math.abs(m) < 1) return 'now';
  if (Math.abs(m) >= 90) {
    const h = Math.floor(Math.abs(m) / 60), r = Math.abs(m) % 60;
    const s = `${h} h ${r} min`;
    return m > 0 ? `in ${s}` : `${s} ago`;
  }
  return m > 0 ? `in ${m} min` : `${-m} min ago`;
}
