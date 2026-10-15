// WEATHER MAP · data/cities.js — US places for labels, the focus search
// and the current-conditions call. No DOM.
//
// Each city: { id, name, state, lat, lon, tz, pop, rank }.
//   rank 1  shows from the national view (big metros and regional anchors)
//   rank 2  shows at the regional view
//   rank 3  shows only near the camera
// pop is the approximate city-proper population (rounded), used to break
// ties when labels overlap. Coordinates are city centres to 0.01 deg.
//
// The list holds about 160 places because loadCurrent (now.js) asks
// Open-Meteo for every city in one call, and each location counts as one
// API call against the free limit of 600 calls per minute. The grid call
// (grid.js) takes 420 more.
//
// grep -n targets: TZ, ROWS, CITIES, CITY_BY_ID, STATES, nearestCity

const TZ = {
  E: 'America/New_York', C: 'America/Chicago', M: 'America/Denver', P: 'America/Los_Angeles',
  AZ: 'America/Phoenix', AK: 'America/Anchorage', HI: 'Pacific/Honolulu', PR: 'America/Puerto_Rico',
  DET: 'America/Detroit', IND: 'America/Indiana/Indianapolis', BOI: 'America/Boise',
  LOU: 'America/Kentucky/Louisville', JUN: 'America/Juneau', NOME: 'America/Nome',
};

// [id, name, state, lat, lon, tz key, pop in thousands, rank]
const ROWS = [
  // rank 1: national view
  ['nyc', 'New York', 'NY', 40.71, -74.01, 'E', 8336, 1],
  ['la', 'Los Angeles', 'CA', 34.05, -118.24, 'P', 3820, 1],
  ['chi', 'Chicago', 'IL', 41.88, -87.63, 'C', 2665, 1],
  ['hou', 'Houston', 'TX', 29.76, -95.37, 'C', 2314, 1],
  ['phx', 'Phoenix', 'AZ', 33.45, -112.07, 'AZ', 1650, 1],
  ['dal', 'Dallas', 'TX', 32.78, -96.80, 'C', 1302, 1],
  ['sfo', 'San Francisco', 'CA', 37.77, -122.42, 'P', 808, 1],
  ['sea', 'Seattle', 'WA', 47.61, -122.33, 'P', 755, 1],
  ['den', 'Denver', 'CO', 39.74, -104.99, 'M', 716, 1],
  ['atl', 'Atlanta', 'GA', 33.75, -84.39, 'E', 510, 1],
  ['mia', 'Miami', 'FL', 25.76, -80.19, 'E', 455, 1],
  ['bos', 'Boston', 'MA', 42.36, -71.06, 'E', 654, 1],
  ['dc', 'Washington', 'DC', 38.91, -77.04, 'E', 679, 1],
  ['msp', 'Minneapolis', 'MN', 44.98, -93.27, 'C', 425, 1],
  ['slc', 'Salt Lake City', 'UT', 40.76, -111.89, 'M', 210, 1],
  ['lv', 'Las Vegas', 'NV', 36.17, -115.14, 'P', 660, 1],
  ['kc', 'Kansas City', 'MO', 39.10, -94.58, 'C', 510, 1],
  ['stl', 'St. Louis', 'MO', 38.63, -90.20, 'C', 280, 1],
  ['det', 'Detroit', 'MI', 42.33, -83.05, 'DET', 633, 1],
  ['nola', 'New Orleans', 'LA', 29.95, -90.07, 'C', 364, 1],
  ['pdx', 'Portland', 'OR', 45.52, -122.68, 'P', 630, 1],
  ['okc', 'Oklahoma City', 'OK', 35.47, -97.52, 'C', 700, 1],
  ['nash', 'Nashville', 'TN', 36.16, -86.78, 'C', 690, 1],
  ['clt', 'Charlotte', 'NC', 35.23, -80.84, 'E', 900, 1],
  ['abq', 'Albuquerque', 'NM', 35.08, -106.65, 'M', 560, 1],
  ['bil', 'Billings', 'MT', 45.78, -108.50, 'M', 120, 1],
  ['anc', 'Anchorage', 'AK', 61.22, -149.90, 'AK', 291, 1],
  ['hnl', 'Honolulu', 'HI', 21.31, -157.86, 'HI', 345, 1],
  ['sju', 'San Juan', 'PR', 18.47, -66.11, 'PR', 340, 1],
  // rank 2: regional view
  ['phl', 'Philadelphia', 'PA', 39.95, -75.17, 'E', 1550, 2],
  ['sa', 'San Antonio', 'TX', 29.42, -98.49, 'C', 1495, 2],
  ['sd', 'San Diego', 'CA', 32.72, -117.16, 'P', 1390, 2],
  ['jax', 'Jacksonville', 'FL', 30.33, -81.66, 'E', 985, 2],
  ['aus', 'Austin', 'TX', 30.27, -97.74, 'C', 980, 2],
  ['fw', 'Fort Worth', 'TX', 32.76, -97.33, 'C', 980, 2],
  ['sj', 'San Jose', 'CA', 37.34, -121.89, 'P', 970, 2],
  ['col', 'Columbus', 'OH', 39.96, -83.00, 'E', 913, 2],
  ['ind', 'Indianapolis', 'IN', 39.77, -86.16, 'IND', 880, 2],
  ['elp', 'El Paso', 'TX', 31.76, -106.49, 'M', 680, 2],
  ['mem', 'Memphis', 'TN', 35.15, -90.05, 'C', 620, 2],
  ['lou', 'Louisville', 'KY', 38.25, -85.76, 'LOU', 620, 2],
  ['bal', 'Baltimore', 'MD', 39.29, -76.61, 'E', 565, 2],
  ['mil', 'Milwaukee', 'WI', 43.04, -87.91, 'C', 560, 2],
  ['tuc', 'Tucson', 'AZ', 32.22, -110.97, 'AZ', 545, 2],
  ['fre', 'Fresno', 'CA', 36.74, -119.79, 'P', 545, 2],
  ['sac', 'Sacramento', 'CA', 38.58, -121.49, 'P', 525, 2],
  ['oma', 'Omaha', 'NE', 41.26, -95.93, 'C', 485, 2],
  ['ral', 'Raleigh', 'NC', 35.78, -78.64, 'E', 480, 2],
  ['tul', 'Tulsa', 'OK', 36.15, -95.99, 'C', 413, 2],
  ['tpa', 'Tampa', 'FL', 27.95, -82.46, 'E', 400, 2],
  ['wic', 'Wichita', 'KS', 37.69, -97.34, 'C', 397, 2],
  ['cle', 'Cleveland', 'OH', 41.50, -81.69, 'E', 362, 2],
  ['orl', 'Orlando', 'FL', 28.54, -81.38, 'E', 320, 2],
  ['lex', 'Lexington', 'KY', 38.04, -84.50, 'E', 320, 2],
  ['crp', 'Corpus Christi', 'TX', 27.80, -97.40, 'C', 317, 2],
  ['cin', 'Cincinnati', 'OH', 39.10, -84.51, 'E', 311, 2],
  ['pit', 'Pittsburgh', 'PA', 40.44, -79.99, 'E', 303, 2],
  ['buf', 'Buffalo', 'NY', 42.89, -78.88, 'E', 275, 2],
  ['rno', 'Reno', 'NV', 39.53, -119.81, 'P', 270, 2],
  ['lbk', 'Lubbock', 'TX', 33.58, -101.85, 'C', 265, 2],
  ['boi', 'Boise', 'ID', 43.62, -116.20, 'BOI', 237, 2],
  ['nor', 'Norfolk', 'VA', 36.85, -76.29, 'E', 235, 2],
  ['ric', 'Richmond', 'VA', 37.54, -77.44, 'E', 230, 2],
  ['spo', 'Spokane', 'WA', 47.66, -117.43, 'P', 230, 2],
  ['dsm', 'Des Moines', 'IA', 41.59, -93.62, 'C', 210, 2],
  ['lr', 'Little Rock', 'AR', 34.75, -92.29, 'C', 203, 2],
  ['ama', 'Amarillo', 'TX', 35.22, -101.83, 'C', 200, 2],
  ['fsd', 'Sioux Falls', 'SD', 43.55, -96.73, 'C', 200, 2],
  ['tlh', 'Tallahassee', 'FL', 30.44, -84.28, 'E', 200, 2],
  ['grr', 'Grand Rapids', 'MI', 42.96, -85.67, 'DET', 197, 2],
  ['bham', 'Birmingham', 'AL', 33.52, -86.80, 'C', 196, 2],
  ['knx', 'Knoxville', 'TN', 35.96, -83.92, 'E', 195, 2],
  ['pvd', 'Providence', 'RI', 41.82, -71.41, 'E', 190, 2],
  ['mob', 'Mobile', 'AL', 30.69, -88.04, 'C', 185, 2],
  ['shv', 'Shreveport', 'LA', 32.53, -93.75, 'C', 180, 2],
  ['eug', 'Eugene', 'OR', 44.05, -123.09, 'P', 178, 2],
  ['spf', 'Springfield', 'MO', 37.21, -93.29, 'C', 170, 2],
  ['chs', 'Charleston', 'SC', 32.78, -79.93, 'E', 155, 2],
  ['sav', 'Savannah', 'GA', 32.08, -81.09, 'E', 148, 2],
  ['jxn', 'Jackson', 'MS', 32.30, -90.18, 'C', 145, 2],
  ['mid', 'Midland', 'TX', 32.00, -102.08, 'C', 135, 2],
  ['far', 'Fargo', 'ND', 46.88, -96.79, 'C', 130, 2],
  ['hfd', 'Hartford', 'CT', 41.76, -72.68, 'E', 120, 2],
  ['ilm', 'Wilmington', 'NC', 34.23, -77.94, 'E', 120, 2],
  ['man', 'Manchester', 'NH', 42.99, -71.46, 'E', 116, 2],
  ['spr', 'Springfield', 'IL', 39.78, -89.65, 'C', 113, 2],
  ['alb', 'Albany', 'NY', 42.65, -73.75, 'E', 99, 2],
  ['dul', 'Duluth', 'MN', 46.79, -92.10, 'C', 87, 2],
  ['mfr', 'Medford', 'OR', 42.33, -122.87, 'P', 86, 2],
  ['flg', 'Flagstaff', 'AZ', 35.20, -111.65, 'AZ', 77, 2],
  ['rap', 'Rapid City', 'SD', 44.08, -103.23, 'M', 77, 2],
  ['msla', 'Missoula', 'MT', 46.87, -113.99, 'M', 77, 2],
  ['bis', 'Bismarck', 'ND', 46.81, -100.78, 'C', 75, 2],
  ['wil', 'Wilmington', 'DE', 39.74, -75.55, 'E', 71, 2],
  ['pwm', 'Portland', 'ME', 43.66, -70.26, 'E', 68, 2],
  ['gjt', 'Grand Junction', 'CO', 39.06, -108.55, 'M', 66, 2],
  ['chy', 'Cheyenne', 'WY', 41.14, -104.82, 'M', 65, 2],
  ['gtf', 'Great Falls', 'MT', 47.51, -111.30, 'M', 60, 2],
  ['csp', 'Casper', 'WY', 42.87, -106.31, 'M', 59, 2],
  ['chsw', 'Charleston', 'WV', 38.35, -81.63, 'E', 47, 2],
  ['hilo', 'Hilo', 'HI', 19.71, -155.08, 'HI', 46, 2],
  ['btv', 'Burlington', 'VT', 44.48, -73.21, 'E', 45, 2],
  ['bgr', 'Bangor', 'ME', 44.80, -68.77, 'E', 32, 2],
  ['fai', 'Fairbanks', 'AK', 64.84, -147.72, 'AK', 32, 2],
  ['jnu', 'Juneau', 'AK', 58.30, -134.42, 'JUN', 32, 2],
  ['key', 'Key West', 'FL', 24.56, -81.78, 'E', 25, 2],
  ['mqt', 'Marquette', 'MI', 46.55, -87.40, 'DET', 20, 2],
  // rank 3: near view only
  ['bfl', 'Bakersfield', 'CA', 35.37, -119.02, 'P', 410, 3],
  ['cos', 'Colorado Springs', 'CO', 38.83, -104.82, 'M', 490, 3],
  ['gso', 'Greensboro', 'NC', 36.07, -79.79, 'E', 300, 3],
  ['lnk', 'Lincoln', 'NE', 40.81, -96.70, 'C', 295, 3],
  ['mad', 'Madison', 'WI', 43.07, -89.40, 'C', 280, 3],
  ['tol', 'Toledo', 'OH', 41.66, -83.56, 'E', 265, 3],
  ['lrd', 'Laredo', 'TX', 27.51, -99.51, 'C', 255, 3],
  ['hsv', 'Huntsville', 'AL', 34.73, -86.59, 'C', 225, 3],
  ['btr', 'Baton Rouge', 'LA', 30.45, -91.19, 'C', 222, 3],
  ['roc', 'Rochester', 'NY', 43.16, -77.61, 'E', 210, 3],
  ['mgm', 'Montgomery', 'AL', 32.37, -86.30, 'C', 196, 3],
  ['bro', 'Brownsville', 'TX', 25.90, -97.50, 'C', 190, 3],
  ['cha', 'Chattanooga', 'TN', 35.05, -85.31, 'E', 185, 3],
  ['syr', 'Syracuse', 'NY', 43.05, -76.15, 'E', 145, 3],
  ['cae', 'Columbia', 'SC', 34.00, -81.03, 'E', 137, 3],
  ['pse', 'Ponce', 'PR', 18.01, -66.61, 'PR', 130, 3],
  ['top', 'Topeka', 'KS', 39.05, -95.68, 'C', 126, 3],
  ['gb', 'Green Bay', 'WI', 44.51, -88.01, 'C', 107, 3],
  ['yum', 'Yuma', 'AZ', 32.69, -114.62, 'AZ', 100, 3],
  ['stg', 'St. George', 'UT', 37.10, -113.58, 'M', 100, 3],
  ['bnd', 'Bend', 'OR', 44.06, -121.31, 'P', 100, 3],
  ['avl', 'Asheville', 'NC', 35.60, -82.55, 'E', 95, 3],
  ['fmy', 'Fort Myers', 'FL', 26.64, -81.87, 'E', 95, 3],
  ['rdd', 'Redding', 'CA', 40.59, -122.39, 'P', 93, 3],
  ['saf', 'Santa Fe', 'NM', 35.69, -105.94, 'M', 89, 3],
  ['sba', 'Santa Barbara', 'CA', 34.42, -119.70, 'P', 88, 3],
  ['bzn', 'Bozeman', 'MT', 45.68, -111.04, 'M', 56, 3],
  ['pns', 'Pensacola', 'FL', 30.42, -87.22, 'C', 54, 3],
  ['har', 'Harrisburg', 'PA', 40.27, -76.88, 'E', 50, 3],
  ['mot', 'Minot', 'ND', 48.23, -101.30, 'C', 48, 3],
  ['psp', 'Palm Springs', 'CA', 33.83, -116.55, 'P', 45, 3],
  ['acy', 'Atlantic City', 'NJ', 39.36, -74.42, 'E', 38, 3],
  ['hln', 'Helena', 'MT', 46.59, -112.04, 'M', 33, 3],
  ['mry', 'Monterey', 'CA', 36.60, -121.89, 'P', 30, 3],
  ['ddc', 'Dodge City', 'KS', 37.75, -100.02, 'C', 28, 3],
  ['ogg', 'Kahului', 'HI', 20.89, -156.47, 'HI', 28, 3],
  ['eka', 'Eureka', 'CA', 40.80, -124.16, 'P', 27, 3],
  ['lbf', 'North Platte', 'NE', 41.12, -100.77, 'C', 23, 3],
  ['kona', 'Kailua-Kona', 'HI', 19.64, -155.99, 'HI', 20, 3],
  ['dro', 'Durango', 'CO', 37.28, -107.88, 'M', 19, 3],
  ['elko', 'Elko', 'NV', 40.83, -115.76, 'P', 20, 3],
  ['tvc', 'Traverse City', 'MI', 44.76, -85.62, 'DET', 15, 3],
  ['pir', 'Pierre', 'SD', 44.37, -100.35, 'C', 14, 3],
  ['hya', 'Hyannis', 'MA', 41.65, -70.28, 'E', 14, 3],
  ['jac', 'Jackson', 'WY', 43.48, -110.76, 'M', 10, 3],
  ['car', 'Caribou', 'ME', 46.86, -68.01, 'E', 8, 3],
  ['lih', 'Lihue', 'HI', 21.98, -159.37, 'HI', 8, 3],
  ['mpv', 'Montpelier', 'VT', 44.26, -72.58, 'E', 8, 3],
  ['kod', 'Kodiak', 'AK', 57.79, -152.41, 'AK', 6, 3],
  ['bet', 'Bethel', 'AK', 60.79, -161.76, 'AK', 6, 3],
  ['brw', 'Utqiagvik', 'AK', 71.29, -156.79, 'AK', 5, 3],
  ['ome', 'Nome', 'AK', 64.50, -165.41, 'NOME', 4, 3],
  ['hse', 'Cape Hatteras', 'NC', 35.25, -75.53, 'E', 1, 3],
];

export const CITIES = ROWS.map(([id, name, state, lat, lon, tz, popK, rank]) =>
  Object.freeze({ id, name, state, lat, lon, tz: TZ[tz], pop: popK * 1000, rank }));

export const CITY_BY_ID = new Map(CITIES.map(c => [c.id, c]));

export const STATES = [...new Set(CITIES.map(c => c.state))].sort();

// Nearest city by great-circle angle; maxDeg limits the search radius.
export function nearestCity(lat, lon, maxDeg = 180, list = CITIES) {
  const r = Math.PI / 180, s1 = Math.sin(lat * r), c1 = Math.cos(lat * r);
  let best = null, bd = Infinity;
  for (const c of list) {
    const d = Math.acos(Math.min(1, s1 * Math.sin(c.lat * r) + c1 * Math.cos(c.lat * r) * Math.cos((c.lon - lon) * r))) / r;
    if (d < bd) { bd = d; best = c; }
  }
  return bd <= maxDeg ? best : null;
}
