// ============================================================================
//  LEO CATALOG  ·  view/catalog.js — the catalog array and how it fills
// ----------------------------------------------------------------------------
//  sats is the one catalog array (records from core/tle.js and
//  core/storms.js), shared by index with the point cloud buffers. It only
//  grows, up to CAP records (PERF_CAP in main.js).
//    groups   'stations' then 'active' download at the same time; each tries
//             the snapshot, the live-site snapshot, then CelesTrak
//             (core/tle-fetch.js). Merge order is fixed (see loadCatalog).
//    demo     three hard-coded TLEs when every group failed
//    storms   NOAA cyclones (view/weather.js fetches) as storm records
//  Every merge refreshes the colour and glyph buffers, the fall-in times, a
//  ping ring, and the counters.
//
//  grep -n targets: "export const sats", "const knownIds",
//  "export function initCatalog", "async function fetchGroup",
//  "function mergeGroup", "export async function loadCatalog",
//  "export function useDemoIfEmpty", "export async function loadStorms"
// ============================================================================
import { parseTLE, demoDataset, mergeParsed } from '../core/tle.js';
import { fetchTLE, urlsForGroup } from '../core/tle-fetch.js';
import { stormRecord } from '../core/storms.js';
import { splash, addLoadRow, hasLoadRow, setLoadStatus } from './boot-ui.js';
import { CAT_COLOR, rebuildAttributesFromSats, stampBirths, pingGlobe } from './sat-cloud.js';
import { rebuildStationLabels } from './labels.js';
import { rebuildStationTrails } from './trails.js';
import { updateCounts } from './filters.js';
import { fetchStorms } from './weather.js';

export const sats = [];
let CAP = 0;
export function initCatalog(cap) { CAP = cap; }
// NORAD ids already in sats, so each dedupe check is O(1).
const knownIds = new Set();

// Download one TLE group: try its URLs in order and parse the first that
// works. Returns the parsed records, or null after every URL failed. Touches
// no catalog state, so several groups can download at the same time.
async function fetchGroup(group) {
  if (!hasLoadRow(group)) addLoadRow(group);
  let lastErr = null;
  for (const url of urlsForGroup(group)) {
    try {
      return parseTLE(await fetchTLE(url));
    } catch (e) {
      lastErr = e;
    }
  }
  setLoadStatus(group, 'fail', 0);
  splash(`${group}: ${lastErr ? lastErr.message : 'fail'}`, 'err');
  return null;
}

// Add one downloaded group to the catalog: add deduped objects up to
// PERF_CAP, refresh the buffers and counts, and mark the load row ok.
// The first group to merge keeps an object shared by two groups, so the
// merge order sets which forceCat wins and which group gets PERF_CAP room.
function mergeGroup(group, parsed, opts = {}) {
  if (!parsed) return -1;
  const first = sats.length;
  const n = mergeParsed(sats, knownIds, parsed, CAP, opts.forceCat || null);
  setLoadStatus(group, 'ok', n);
  splash(`${group} +${n.toLocaleString()}`, n ? 'ok' : '');
  rebuildAttributesFromSats();
  if (n > 0) {
    stampBirths(first, sats.length);
    pingGlobe(CAT_COLOR[sats[first].cat]);
  }
  updateCounts(sats);
  return n;
}

// Both groups download at the same time. The merge order stays stations
// first, then 'active': 'active' also holds the station modules, and the
// first merge keeps them with the 'station' category and PERF_CAP room.
// The 'active' group holds every active payload, so it also holds the
// objects of the old per-constellation groups (starlink, oneweb, gnss, and
// so on). classify() sets the category from the name, so the group does not
// change it. Objects land on the globe as each group merges.
export async function loadCatalog() {
  const groups = ['stations', 'active'];
  const downloads = groups.map(fetchGroup);
  mergeGroup('stations', await downloads[0], { forceCat: 'station' });
  rebuildStationLabels();
  rebuildStationTrails();
  mergeGroup('active', await downloads[1]);
}


// Fall back to the demo dataset when every group failed, so the globe is
// never empty.
export function useDemoIfEmpty() {
  if (sats.length > 0) return;
  splash('demo dataset', 'err');
  sats.push(...demoDataset());
  for (const d of sats) knownIds.add(d.noradId);
  stampBirths(0, sats.length);
}

// Add each active NOAA cyclone as a storm-class record parked at its lat/lon.
export async function loadStorms() {
  const storms = await fetchStorms();
  if (!storms) return;
  try {
    const first = sats.length;
    for (const st of storms) {
      if (sats.length >= CAP) break;
      sats.push(stormRecord(st));
    }
    rebuildAttributesFromSats();
    stampBirths(first, sats.length, 0.6);
    updateCounts(sats);
  } catch (e) {
    splash('noaa storms: parse fail', 'err');
  }
}
