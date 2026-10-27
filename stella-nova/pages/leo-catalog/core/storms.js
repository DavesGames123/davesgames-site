// ============================================================================
//  LEO CATALOG  ·  core/storms.js — NOAA active cyclones as catalog records
// ----------------------------------------------------------------------------
//  The NHC CurrentStorms feed has no CORS header on some days, so the page
//  tries it direct, then through two public CORS proxies (STORM_URLS, in
//  order). parseStorms keeps the storms with a finite lat and lon; each one
//  becomes a storm-class record parked at its position (stormRecord).
//  No DOM and no network here: view/weather.js fetches.
//
//  grep -n targets: "export const STORM_URLS", "export function parseStorms",
//  "export function stormRecord"
// ============================================================================

const NHC = 'https://www.nhc.noaa.gov/CurrentStorms.json';
export const STORM_URLS = [
  NHC,
  'https://corsproxy.io/?url=' + encodeURIComponent(NHC),
  'https://api.allorigins.win/raw?url=' + encodeURIComponent(NHC),
];

// The feed's activeStorms as { lat, lon, name, classification, wind (kt) }.
export function parseStorms(j) {
  const arr = j.activeStorms || [];
  return arr.map(s => ({
    lat: parseFloat(s.latitudeNumeric ?? s.latitude),
    lon: parseFloat(s.longitudeNumeric ?? s.longitude),
    name: s.name || s.binNumber || 'STORM',
    classification: (s.classification || s.intensity || '').toUpperCase(),
    wind: s.intensity ? parseInt(s.intensity, 10) : null,
  })).filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon));
}

// One storm as a catalog record (no satrec; propagateAll parks it at its
// lat/lon and pulses its size).
export function stormRecord(st) {
  return {
    satrec: null, _isStorm: true,
    name: `${st.classification || 'STORM'} ${st.name}`,
    cat: 'storm', noradId: null, notable: null,
    _stormData: st,
  };
}
