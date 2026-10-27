// ============================================================================
//  LEO CATALOG  ·  core/info.js — object descriptions and info HTML
// ----------------------------------------------------------------------------
//  The text that the hover/lock chip and the right-hand info panel show for
//  one catalog record. Each builder takes the record and the sim date and
//  returns an HTML string; main.js puts it into the DOM. Every catalog
//  string goes through escHtml.
//
//    OBJECT_KNOWLEDGE  curated descriptions, the first regex match wins
//    describeObject    curated entry, else a per-class fallback
//    chipBodyHTML      the chip rows (storm fields, or live SGP4 readouts)
//    infoPanelHTML     the panel: class, name, description, elements, links
//
//  grep -n targets: "export const OBJECT_KNOWLEDGE",
//  "export function describeObject", "export function chipBodyHTML",
//  "function infoOrbitRowsHTML", "export function infoPanelHTML",
//  "export const INFO_EMPTY_HTML"
// ============================================================================
import { fmt, escHtml } from './format.js';
import { orbitalElements, liveState } from './tle.js';

// Curated descriptions, returned for the first regex that matches.
// Each entry: [matcher, { description, wiki, [extra fields] }]
export const OBJECT_KNOWLEDGE = [
  [/^ISS\b|ZARYA/, {
    desc: 'International Space Station. Football-field-sized, continuously crewed since November 2000. Joint US, Russia, ESA, Japan, Canada project. Orbits ~400 km up at 51.6° inclination, lapping Earth every 92 minutes. Slated for deorbit around 2030.',
    wiki: 'International_Space_Station',
  }],
  [/TIANGONG|TIANHE|WENTIAN|MENGTIAN|CSS \(|SHENZHOU|TIANZHOU/, {
    desc: 'Chinese space station and visiting vehicles. Tiangong is China\'s permanent crewed station — three modules (Tianhe core, Wentian and Mengtian labs) at ~390 km, 41.5° inc. Crewed continuously since June 2022. Shenzhou are crewed taxis; Tianzhou are cargo.',
    wiki: 'Tiangong_space_station',
  }],
  [/^DRAGON|^CREW DRAGON/, {
    desc: 'SpaceX Crew/Cargo Dragon docked to or rendezvousing with ISS. Reusable capsule first crewed in 2020 (Demo-2). Up to 4 crew per flight on Falcon 9.',
    wiki: 'SpaceX_Dragon_2',
  }],
  [/^PROGRESS/, {
    desc: 'Russian Progress cargo spacecraft — an uncrewed Soyuz-derived ferry that resupplies ISS. Burns up on reentry after delivering its load.',
    wiki: 'Progress_(spacecraft)',
  }],
  [/^CYGNUS/, {
    desc: 'Northrop Grumman Cygnus cargo spacecraft. Launches on Antares (or Falcon 9 in recent missions); delivers cargo to ISS then disposes of itself in atmosphere.',
    wiki: 'Cygnus_(spacecraft)',
  }],
  [/^STARLINK/, {
    desc: 'SpaceX Starlink LEO broadband. ~6,500+ active. Two main shells: 550 km @ 53° (bulk) and 600 km @ 70–97° (polar). Launched 20–60 per Falcon 9 since 2019. Provides direct-to-consumer internet via flat phased-array terminals.',
    wiki: 'Starlink',
  }],
  [/^ONEWEB/, {
    desc: 'OneWeb LEO broadband constellation — ~648 satellites at 1,200 km in 87° polar orbit. Targets enterprise, government, aviation, and mobility markets. Owned by Eutelsat after the 2022 merger.',
    wiki: 'OneWeb_satellite_constellation',
  }],
  [/^GPS BIIR|^GPS BIIF|^NAVSTAR/, {
    desc: 'US Air Force GPS navigation satellite. Constellation of 31+ active birds in 6 planes at 20,200 km altitude, 55° inclination, ~12-hour period. Each broadcasts coded ranging signals that civilian and military receivers use to trilateral their position to within meters.',
    wiki: 'GPS_satellite_blocks',
  }],
  [/^GSAT|^GALILEO/, {
    desc: 'European Galileo GNSS satellite. The EU\'s answer to GPS. 23,222 km altitude in 56° inclination MEO — slightly higher than GPS, so the orbit looks ‘weird\' compared to LEO. Provides sub-meter positioning to authorized users via the Public Regulated Service.',
    wiki: 'Galileo_(satellite_navigation)',
  }],
  [/^COSMOS 24|^COSMOS 25(0|1|2|3|4|5)/, {
    desc: 'Russian GLONASS navigation satellite (Cosmos series numbering). ~19,100 km, 64.8° MEO orbit. Provides global navigation; the original Soviet GPS analog, fully restored to operational status in 2011.',
    wiki: 'GLONASS',
  }],
  [/^IRIDIUM/, {
    desc: 'Iridium satphone & data constellation. 66 active birds at 780 km, 86.4° polar. Each spot-beams cellphone-style coverage to a moving footprint on the surface. The 2017–2019 NEXT generation replaced the original 1997 hardware. Famous for the bright pre-NEXT "Iridium flares".',
    wiki: 'Iridium_satellite_constellation',
  }],
  [/HUBBLE|HST|^HST/, {
    desc: 'Hubble Space Telescope. Launched 24 Apr 1990 by STS-31. 2.4 m primary mirror. Five Shuttle servicing missions (1993, 1997, 1999, 2002, 2009) — the first famously corrected a manufacturing flaw in the mirror. Currently ~535 km, 28.5° inc; without a reboost it will reenter sometime in the 2030s.',
    wiki: 'Hubble_Space_Telescope',
  }],
  [/^VANGUARD 1\b/, {
    desc: 'The oldest artificial object still in orbit. Launched 17 Mar 1958 — a 1.46 kg grapefruit-sized solar-cell test article. Its 654 × 3,840 km elliptical orbit means atmospheric drag is essentially nil; predicted to last another ~240 years.',
    wiki: 'Vanguard_1',
  }],
  [/ENVISAT/, {
    desc: 'ENVISAT — 8-tonne ESA environmental observation satellite at 768 km. Lost contact 8 Apr 2012 and never recovered. Largest dead object in heavily populated LEO; it will linger ~150 years and is the #1 collision risk in orbit. Several active-removal mission concepts have targeted it; none flown.',
    wiki: 'Envisat',
  }],
  [/^COSMOS 1408/, {
    desc: 'Russia\'s 15 Nov 2021 ASAT test target — a defunct Tselina-D ELINT bird destroyed by a PL-19 Nudol direct-ascent missile at 480 km. The strike created 1,500+ tracked fragments. ISS crew sheltered in capsules during the closest pass; the cloud still threatens LEO objects.',
    wiki: 'Russian_anti-satellite_weapon_test',
  }],
  [/^FENGYUN 1C/, {
    desc: 'Chinese weather satellite destroyed in the 11 Jan 2007 SC-19 ASAT test at 865 km. The single most debris-generating event in spaceflight history — ~3,500 fragments still tracked. Triggered global condemnation and accelerated debris-mitigation regulation.',
    wiki: '2007_Chinese_anti-satellite_missile_test',
  }],
  [/IRIDIUM 33 DEB|COSMOS 2251 DEB/, {
    desc: 'Fragment from the 10 Feb 2009 Iridium 33 + Cosmos 2251 collision. First catastrophic collision between two intact satellites — 11.7 km/s impact at 789 km over Siberia. ~2,000 trackable fragments produced. Drove the development of conjunction warning services.',
    wiki: 'Satellite_collision',
  }],
  [/^GOES|^METEOSAT|^HIMAWARI|^FY-?[234]/, {
    desc: 'Geostationary weather satellite. ~35,786 km altitude. Sits over a fixed longitude relative to Earth\'s surface, scanning a full disk every 5–15 minutes. The reason your weather forecast has those swirling cloud-top images.',
    wiki: 'Geostationary_orbit',
  }],
  [/^INTELSAT|^SES |^EUTELSAT/, {
    desc: 'Commercial geostationary communications satellite. 35,786 km altitude, equatorial, ~24-hour period — appears motionless from the ground. Carries TV, radio, broadband, and trunked telecom traffic to fixed-position dishes.',
    wiki: 'Communications_satellite',
  }],
  [/^WESTFORD/, {
    desc: 'Westford Needles — 480 million 1.78 cm copper dipole antennas USAF dispersed in 1963 to create an artificial ionospheric reflector for HF radio. Most de-orbited via solar pressure by the 1990s as designed; a few clumped masses failed to disperse and remain at ~3,500 km.',
    wiki: 'Project_West_Ford',
  }],
];

// Pick a description for an object: the first matching curated entry, else a
// category-level fallback (station, rocket, debris, or generic payload).
export function describeObject(s) {
  if (s._isStorm) {
    return {
      desc: 'Active tropical cyclone tracked by the NOAA National Hurricane Center. Position updated from the Current Storms feed.',
      wiki: 'Tropical_cyclone',
    };
  }
  for (const [pat, info] of OBJECT_KNOWLEDGE) {
    if (pat.test(s.name)) return info;
  }
  // Fall back to category-level descriptions
  if (s.cat === 'station') return {
    desc: 'Crewed orbital platform or a vehicle visiting one. Stations support continuous human habitation, science research, and Earth observation.',
    wiki: 'Space_station',
  };
  if (s.cat === 'rocket') return {
    desc: 'Spent upper stage left behind after deploying its payload. Typically aluminum-titanium tankage, often still containing residual propellant. Without active deorbiting, these decay over years (LEO) to centuries (high orbit).',
    wiki: 'Spent_upper_stage',
  };
  if (s.cat === 'debris') return {
    desc: 'Tracked space debris — a fragment from a collision, explosion, or anti-satellite test. Each piece is catalogued by USSPACECOM. Even paint flecks at orbital velocity can shatter spacecraft windows.',
    wiki: 'Space_debris',
  };
  // Generic payload
  return {
    desc: 'Earth-orbiting satellite. Use the orbital elements below to gauge its purpose: low circular orbits (~500 km) tend to be Earth observation or comms; mid (~20,000 km) are usually navigation; geosynchronous (~36,000 km) are weather or telecom.',
    wiki: 'Satellite',
  };
}

// One key/value row. cls is the row class (ch-row or info-row); dyn marks a
// value that changes as SGP4 runs.
const row = (cls, k, v, dyn) =>
  `<div class="${cls}"><span class="k">${k}</span><span class="v${dyn ? ' dyn' : ''}">${v}</span></div>`;

// The chip body for one object: storm fields for storms, live orbital
// readouts (altitude, lat/lon, velocity, elements) for satellites.
export function chipBodyHTML(s, date) {
  const R = (k, v, dyn) => row('ch-row', k, v, dyn);
  if (s._isStorm) {
    const st = s._stormData;
    return R('CLASS', escHtml(st.classification || '—')) +
      R('LAT', `${fmt(st.lat, 2)}°`, true) +
      R('LON', `${fmt(st.lon, 2)}°`, true) +
      R('WIND', st.wind ? st.wind+' kt' : '—') +
      R('SRC', 'NOAA NHC');
  }
  const oe = orbitalElements(s.satrec);
  const { alt, lat, lon, speed } = liveState(s.satrec, date);
  return R('NORAD', s.noradId) +
    R('ALT', `${fmt(alt, 0)} km`, true) +
    R('LAT / LON', `${fmt(lat, 1)}° / ${fmt(lon, 1)}°`, true) +
    R('VEL', `${fmt(speed, 2)} km/s`, true) +
    R('INC', `${fmt(oe.incDeg, 1)}°`) +
    R('PERIOD', `${fmt(oe.periodMin, 1)} min`) +
    R('APO / PER', `${fmt(oe.apogee, 0)} / ${fmt(oe.perigee, 0)} km`) +
    (s.notable ? R('EVENT', escHtml(s.notable)) : '');
}

// Build the orbital-element rows for the info panel (storm or satellite).
function infoOrbitRowsHTML(s, date) {
  const R = (k, v, dyn) => row('info-row', k, v, dyn);
  if (s._isStorm) {
    const st = s._stormData;
    return R('classification', escHtml(st.classification || '—')) +
      R('lat', `${fmt(st.lat, 2)}°`, true) +
      R('lon', `${fmt(st.lon, 2)}°`, true) +
      R('wind', st.wind ? st.wind+' kt' : '—');
  }
  if (!s.satrec) return '';
  const oe = orbitalElements(s.satrec);
  const { alt, lat, lon, speed } = liveState(s.satrec, date);
  return R('norad id', s.noradId) +
    R('altitude', `${fmt(alt, 0)} km`, true) +
    R('lat / lon', `${fmt(lat, 1)}° / ${fmt(lon, 1)}°`, true) +
    R('velocity', `${fmt(speed, 2)} km/s`, true) +
    R('inclination', `${fmt(oe.incDeg, 1)}°`) +
    R('period', `${fmt(oe.periodMin, 1)} min`) +
    R('apogee / perigee', `${fmt(oe.apogee, 0)} / ${fmt(oe.perigee, 0)} km`);
}

export const INFO_EMPTY_HTML = '<div class="info-empty">click any satellite, debris, or station to see details</div>';

// The full info panel for an object: category, name, description, live
// elements, and external reference links.
export function infoPanelHTML(s, date) {
  const info = describeObject(s);
  const wikiURL = `https://en.wikipedia.org/wiki/${info.wiki}`;
  const n2yoURL = s.noradId ? `https://www.n2yo.com/satellite/?s=${s.noradId}` : null;
  const cstrURL = s.noradId ? `https://celestrak.org/satcat/tle.php?CATNR=${s.noradId}` : null;
  return `<div class="info-section">` +
      `<span class="info-cat">${s.cat.toUpperCase()}</span>` +
      `<h3 class="info-name">${escHtml(s.name)}</h3>` +
      `<div class="info-desc">${escHtml(info.desc)}</div>` +
    `</div>` +
    `<div class="info-section">` +
      `<div class="info-label">orbital elements</div>` +
      infoOrbitRowsHTML(s, date) +
    `</div>` +
    `<div class="info-section">` +
      `<div class="info-label">external references</div>` +
      `<div class="info-links">` +
        `<a class="info-link" href="${wikiURL}" target="_blank" rel="noopener">Wikipedia</a>` +
        (n2yoURL ? `<a class="info-link" href="${n2yoURL}" target="_blank" rel="noopener">N2YO live track</a>` : '') +
        (cstrURL ? `<a class="info-link" href="${cstrURL}" target="_blank" rel="noopener">CelesTrak TLE</a>` : '') +
      `</div>` +
    `</div>`;
}
