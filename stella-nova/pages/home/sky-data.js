// ============================================================================
//  SKY DATA  ·  real objects for the hero background
// ----------------------------------------------------------------------------
//  Classic script: it sets window.Observatory.SKY. main.js (startSky) draws
//  and places these objects. Each linked object points at the page that
//  covers it. No data is fetched at run time.
//
//  Sources
//    planets ...... mean orbit radius (AU) and sidereal period (years),
//                   standard values (NASA planetary fact sheet).
//    stars ........ J2000 right ascension (hours), declination (degrees),
//                   visual magnitude and B-V color index of bright stars.
//    deep sky ..... M31 (Andromeda galaxy) and Sagittarius A* (the black
//                   hole at the centre of the Milky Way), J2000.
//    satellites ... inclination, RAAN and mean anomaly (degrees) and mean
//                   motion (rev/day) from the site's own TLE snapshot,
//                   https://davesgames.io/stella-nova/pages/leo-catalog/data/
//                   active.txt, epoch day 26273 (2026-09-30). Read once to
//                   write this table. Never fetched from CelesTrak.
//
//  grep -n targets
//    planets ...... "planets:"
//    stars ........ "stars:"
//    deep sky ..... "deep:"
//    satellites ... "sats:"
// ============================================================================
(window.Observatory = window.Observatory || {}).SKY = {
  // [name, a (AU), period (years), radius px, page key or null]
  planets: [
    ['Mercury', 0.387, 0.241, 2.0, 'hohmann'],
    ['Venus', 0.723, 0.615, 2.6, 'hohmann'],
    ['Earth', 1.000, 1.000, 2.8, 'leo'],
    ['Mars', 1.524, 1.881, 2.3, 'hohmann'],
    ['Jupiter', 5.203, 11.86, 3.6, 'hohmann'],
  ],
  // The Moon orbits Earth: period in years, ring radius in px.
  moon: ['Moon', 0.0748, 9, 'hohmann'],
  sun: ['Sun', 'solar'],
  // [name, RA (h), Dec (deg), magnitude, B-V]
  stars: [
    ['Sirius', 6.752, -16.72, -1.46, 0.00],
    ['Arcturus', 14.261, 19.18, -0.05, 1.23],
    ['Vega', 18.616, 38.78, 0.03, 0.00],
    ['Capella', 5.278, 46.00, 0.08, 0.80],
    ['Rigel', 5.242, -8.20, 0.13, -0.03],
    ['Procyon', 7.655, 5.22, 0.34, 0.42],
    ['Betelgeuse', 5.919, 7.41, 0.50, 1.85],
    ['Altair', 19.846, 8.87, 0.77, 0.22],
    ['Aldebaran', 4.599, 16.51, 0.86, 1.54],
    ['Antares', 16.490, -26.43, 0.96, 1.83],
    ['Spica', 13.420, -11.16, 0.97, -0.13],
    ['Pollux', 7.755, 28.03, 1.14, 1.00],
    ['Fomalhaut', 22.961, -29.62, 1.16, 0.09],
    ['Deneb', 20.690, 45.28, 1.25, 0.09],
    ['Regulus', 10.140, 11.97, 1.35, -0.11],
  ],
  // [name, RA (h), Dec (deg), kind, page key]
  deep: [
    ['Andromeda Galaxy (M31)', 0.712, 41.27, 'galaxy', 'galaxy'],
    ['Sagittarius A*, black hole', 17.761, -29.01, 'hole', 'blackhole'],
  ],
  // [name, inclination, RAAN, mean anomaly, mean motion (rev/day)]
  sats: [
    ['ISS (ZARYA)', 51.6316, 139.0707, 153.8989, 15.48696172],
    ['CSS (TIANHE)', 41.4697, 42.3316, 46.1746, 15.60179228],
    ['HST', 28.4723, 80.0205, 120.2809, 15.31792315],
    ['TERRA', 97.9342, 318.8757, 283.9756, 14.61167825],
    ['AQUA', 98.442, 245.0372, 1.3011, 14.62218189],
    ['SENTINEL-2A', 98.5656, 346.9157, 275.3129, 14.30820143],
    ['NOAA 20 (JPSS-1)', 98.7841, 212.1403, 326.4911, 14.19528342],
    ['LANDSAT 9', 98.218, 342.0429, 269.2183, 14.57104757],
    ['STARLINK-1008', 53.1458, 277.5079, 277.0831, 15.65761629],
    ['STARLINK-1017', 53.0433, 294.0453, 332.429, 15.40150913],
    ['STARLINK-1036', 53.0322, 249.9879, 342.6742, 15.95559461],
  ],
};
