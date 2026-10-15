# Weather Map — build contract

Page key `weather-map`, dir `stella-nova/pages/weather-map/`, label
"Weather Map", badge DATA, nav group Fluids > Earth & Ocean. A live,
TV-news-style meteorological map of the United States on a realistic 3D
globe. This file fixes the module map, the interfaces and the work
packages, so separate agents can build packages at the same time
without editing the same files.

User request, verbatim (2026-10-15): "i want a new page that's a live
metereological map (much the same way that we would see in a news
pprogram) and primarily focus on the US region and animate between
positions to show the weather accross the country. render the globe and
weather as realistically as possible (see planet forge) and please make
sure we get good overlays for cold fronts warm fronts etc we have the
temperatures pop up in celsius and farenheit animatedly as we come
nearby, we should have options for where to focus. also let's make sure
that we have a beautiful layout and a full screensaver mode that also
mentions the time and date of the current location. we should also be
able to click each location for a full forecast"
Then: "dispatch a swarm!"

## Rules for every package

- Read the project memory index first:
  `~/.claude/projects/-Users-davidkubala-Downloads-davesgames-site/memory/MEMORY.md`
  (relevant: no-headless-chrome, static-site-build-gate, mobile-first-pages,
  hidden-attr-display, wgsl-tint-vs-naga, gzip-content-length,
  no-email-in-requests, saver-camera-framing, screensaver-mode,
  page-fonts-and-math, concurrent-sessions-nav, wishlist-utm).
- No browser. No headless Chrome, Playwright, CDP, screenshots or
  recordings. Validate with `node --check`, node ESM import of DOM-free
  modules, `node tests.mjs`, `~/.cargo/bin/naga file.wgsl` for WGSL
  (bare `naga` on PATH is a game), and TypeScript checkJs or `deno lint`
  for names. Say in each commit body that browser checks did not run.
- WGSL must also pass Chrome's Tint: no mixed `*`/`^` without
  parentheses, no mixed `&&`/`||` without parentheses.
- Edit only the files your package owns (table below). Need a change in
  another package's file? Write the request in your final report.
- Do NOT touch any other page. In particular do not edit
  `pages/forge/*` (another session has uncommitted work there). Import
  read-only from `../forge/` is allowed (atmo.js, shaders via fetch).
- Tests: add `tests/<package>.test.mjs` (default export `function (ok)`).
  `tests.mjs` runs every `tests/*.test.mjs`. Only package CORE writes
  `tests.mjs`.
- Commit by pathspec in one command: `git add <your files> && git commit
  -F - -- <your paths>`. Run `git diff --cached --name-only` first and do
  not commit other paths. No `git add -A`, no amend, no rebase, no push,
  no branches. Subject `weather-map: <imperative>`. Body in Simplified
  Technical English with the real validation output. End with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never put the user's email in a request, a header or a payload.
  Browsers cannot set User-Agent; tools/ scripts use
  `davesgames.io weather-map` as UA.
- Every stylesheet has `[hidden]{display:none!important}`.
- Fonts: Inter from `../../vendor/fonts/inter.adf13477.css` (and other
  vendored fonts if they exist). Never Playfair, Cormorant or JetBrains
  Mono. Plain sentence-case UI text, no "SYS //" HUD gimmicks.

## Units and conventions

| Quantity | Convention |
|---|---|
| Time | epoch ms UTC (`app.t`). Display in the location's IANA zone via `Intl.DateTimeFormat`. |
| Temperature | stored in °C (float). Labels show both, `72°F · 22°C`, unit order set by `app.units` ('F' first or 'C' first). |
| Pressure | hPa. Wind m/s internally, shown mph and km/h. Precip mm, shown in and mm. |
| Lat, lon | degrees, north and east positive, lon in [-180, 180]. |
| Globe space | unit sphere radius 1, y up. `x = cos(lat) cos(lon)`, `y = sin(lat)`, `z = -cos(lat) sin(lon)`. Equirect texture u = (lon + 180) / 360, v = (90 - lat) / 180. |
| Shell radii | ground 1.0; cloud deck 1.0018; overlays (temp fill, radar, isobars) 1.0022; fronts 1.0026; atmosphere top 1.0157 (100 km on 6371 km). |
| Camera | `{ lat, lon, alt, tilt, heading }`; `alt` in globe radii above the ground; tilt 0 = straight down, radians. |

## Module map and owners

| Package | Owns |
|---|---|
| CORE | `index.html` (first version), `main.js` (first version), `style.css` (first version), `tests.mjs`, `astro.js`, `camera.js`, `render/core.js`, `render/globe.js`, `shaders/frame.wgsl`, `shaders/globe.wgsl`, `tests/core.test.mjs` |
| ASSETS | `tools/fetch-earth.mjs`, `tex/*`, `CREDITS.txt`, `tests/assets.test.mjs` |
| DATA | `data/*.js`, `data/sample/*`, `tools/snapshot.mjs`, `tests/data.test.mjs` |
| SKY | `render/clouds.js`, `render/fields.js`, `shaders/clouds.wgsl`, `shaders/fields.wgsl`, `tests/sky.test.mjs` |
| FRONTS | `render/fronts.js`, `shaders/fronts.wgsl`, `tests/fronts.test.mjs` |
| DIRECTOR | `director.js`, `labels.js`, `labels.css`, `tests/director.test.mjs` |
| UI | `index.html`, `style.css`, `main.js`, `ui.js`, `forecast-card.js` (phase 2: takes these over from CORE), `tests/ui.test.mjs` |
| SAVER | `saver.js`, `saver.css`, `tests/saver.test.mjs` |
| INTEGRATE | phase 3: any file, to wire the packages together and fix seams |

## Interfaces

### astro.js (CORE, no DOM)
- `sunDir(t) -> [x, y, z]` unit vector in globe space at epoch ms t (real
  solar declination and hour angle; good to ~0.5 deg).
- `localParts(t, tz) -> { y, mo, d, h, mi, s, weekday, tzAbbr }`.

### camera.js (CORE, no DOM)
- `camState(lat, lon, alt, tilt=0, heading=0)` -> camera object.
- `viewProj(cam, w, h, fovY) -> { view, proj, viewProj, invViewProj, eye }` (Float32Array(16) each, column-major, WebGPU depth 0..1).
- `project(m, lat, lon, r=1) -> { x, y, depth, visible }` CSS px; `visible` false when behind the horizon or off screen.
- `pick(m, x, y) -> { lat, lon } | null` ray against the unit sphere.
- `flight(from, to, opts) -> (u 0..1) -> cam` eased great-circle flight that rises in alt mid-way (news-style "zoom out, travel, zoom in"); `opts.duration` seconds suggestion via `flightSeconds(from, to)`.
- `lerpCam`, `slerpLatLon` helpers.

### render/core.js (CORE)
`createCore(canvas, { loadText }) -> Promise<core>`; `core`:
- `device, format, depthFormat ('depth24plus'), context`
- `frameLayout`: GPUBindGroupLayout for group(0) binding(0) = Frame uniform (`shaders/frame.wgsl` struct `Frame`: viewProj, invViewProj, eye, time, sunDir, viewport (w, h, dpr, 0), exposure, cam alt, focus lat/lon). Layers prepend `frame.wgsl` text to their shader.
- `frameGroup`: the matching GPUBindGroup.
- `addLayer(layer)` / `removeLayer(layer)`. A layer is
  `{ name, order, update(frame, app), encode(pass, frame) , destroy() }`.
  core draws: globe (opaque, depth write), then layers by `order`
  ascending in the same render pass (depth test less-equal, no depth
  write, premultiplied alpha blend), then the atmosphere limb/scatter
  pass. Layers that need a compute pass get `core.encoderHooks.push(fn(encoder, frame))` run before the render pass.
- `setCloudMap(textureView, bounds)` the globe shader samples this
  rgba16float lat/lon map (r = cloud optical depth 0..1, g = precip,
  b, a free) for cloud shadows and wet ground; `bounds = { lat0, lat1, lon0, lon1 }`. Default: an empty 1x1 map.
- `render(cam, app)` one frame; `resize()`; `destroy()`.
- Realism: day albedo, night lights (fade at the terminator with a warm
  tint), ocean specular glint with Fresnel and wave roughness, terrain
  normal from a height map, Forge-style physically based atmosphere
  (reuse `../forge/atmo.js` and `../forge/shaders/atmo-common.wgsl`,
  `sky.wgsl` by import/fetch), stars behind. Tone map (ACES-ish) with
  exposure. Real sun position from `astro.sunDir(app.t)` so day/night
  across the country is true; `app.lightMode` 'real' | 'day' (news
  default 'day' lights the US evenly, real is optional).
- Budget: no MSAA, no HDR intermediate unless cheap; cap backing store
  at 2560x1440 and dpr 2; quality 0 phone / 1 tablet / 2 desktop.

### tex/ (ASSETS)
Public-domain NASA imagery only (Blue Marble Next Generation, Black
Marble, GEBCO/ETOPO-derived height), sized for the web:
- `tex/day-8k.jpg` 8192x4096 equirect (or 4096 if 8k > 6 MB), `tex/day-2k.jpg` phone fallback
- `tex/us-day.jpg` high-res crop lat 15..60, lon -170..-50 (≤ 4 MB)
- `tex/night-4k.jpg` city lights, `tex/height-4k.png` or `.jpg` (8-bit, 0 = sea level, land only), `tex/water-2k.png` water mask
- `tex/manifest.json` `{ file: { w, h, bounds?, bytes, sha256, source } }`.
CREDITS.txt lists each source URL and licence.

### data/ (DATA, no DOM except fetch; same parsers run in node)
All loaders return plain objects, cache in `sessionStorage` (try/catch)
for 20 min, and fall back to `data/sample/*` (a committed snapshot made
by `tools/snapshot.mjs`) on any error, flagging `{ live: false }`.
Never size a buffer from content-length.
- `cities.js` `CITIES`: ~150 US cities (all 50 states, Puerto Rico; big
  metros plus regional anchors): `{ id, name, state, lat, lon, tz, pop, rank }`; rank 1 shows from far, 3 only near.
- `fronts.js`
  - `parseCodsus(text) -> { valid: ms, highs:[{lat,lon,hPa}], lows:[…], fronts:[{ type:'COLD'|'WARM'|'STNRY'|'OCFNT'|'TROF', strength?, pts:[[lat,lon],…] }] }` (WPC coded surface bulletin: 4-digit `LLLo` = lat 2 digits lon 2-3 digits, west positive; 7-digit hi-res variant in ASUS02).
  - `loadFronts() -> { analysis, forecasts:[{ valid, …same }], live }` from `https://api.weather.gov/products/types/COD/locations/SUS` (ASUS01 analysis, ASUS02 hi-res if useful) and FSUS02 forecast bulletins (`…/locations/` list them); fetch only the newest of each.
  - `frontsAt(set, t)` interpolated or nearest-held set for time t.
- `grid.js` `loadGrid() -> { lat0, dLat, nLat, lon0, dLon, nLon, times:[ms], fields:{ t2m, msl, cloud, precip, u10, v10 } (Float32Array per time, row-major lat then lon), live }` over lat 18..56, lon -132..-60 (plus Alaska/Hawaii sub-grids optional) from Open-Meteo forecast API (multi-location, hourly; `past_hours`, `forecast_hours` about -6..+48 every 3 h). Keep the request count and size modest (one or two requests, < 3 MB); attribution "Weather data by Open-Meteo.com (CC BY 4.0)". `sampleGrid(g, field, lat, lon, t)` bilinear in space, linear in time.
- `radar.js` `loadRadar() -> { frames:[{ time, path }], host, live }` from `https://api.rainviewer.com/public/weather-maps.json`; `tileUrl(frame, z, x, y, opts)`. Respect RainViewer terms (attribution, modest zoom).
- `forecast.js` `loadForecast(lat, lon, tz) -> { current, hourly (48 h), daily (10 d: max, min, precip prob, sum, code, sunrise, sunset, uv, wind max), tz, live }` (Open-Meteo); `codeText(code, isDay) -> { text, icon }` WMO weather code table.
- `now.js` `loadCurrent(cities) -> Map(id -> { t2m, code, wind, gust, rh, feels })` (one multi-location Open-Meteo call).

### SKY layers (render/clouds.js, render/fields.js)
- `createClouds(core) -> layer` + `setGrid(grid)`: builds the cloud
  map from `grid.fields.cloud` (and precip) in a compute pass with
  fBm/Worley detail advected by u10/v10 so clouds look like satellite
  imagery (bright tops, soft edges, cellular texture, thin cirrus), not a
  blurred colour field; calls `core.setCloudMap`; draws the cloud shell
  lit by the sun with self-shadow and a terminator tint.
- `createFields(core) -> layer` + `setGrid`, `setRadar(radarSet)`, `set({ temp, radar, isobars, wind })`:
  temperature fill (TV palette, translucent, smooth), radar mosaic
  (RainViewer tiles stitched into a CONUS texture, green-yellow-red, with
  the standard dBZ ramp), isobars (marching squares on msl every 4 hPa,
  smooth lines, labels via `labels`-style API returned as data), and
  big H / L marks from fronts.highs/lows (as data for DIRECTOR's labels).

### FRONTS layer (render/fronts.js)
`createFronts(core) -> layer` + `setFronts(set)`, `set({ visible, reveal 0..1 })`.
Classic WPC/TV symbology drawn on the sphere, anti-aliased, screen-space
sized symbols that stay legible at every altitude: cold = blue line with
triangles on the warm side, warm = red with semicircles, stationary =
alternating red semicircles / blue triangles on opposite sides,
occluded = purple with alternating triangles and semicircles, trough =
dashed orange/brown. Smooth the polyline (Catmull-Rom on the sphere).
Animated "draw-on" when shown and a smooth morph between forecast times.
Pure helpers (`frontGeometry(front, opts)`) are DOM-free and tested.

### DIRECTOR (director.js, labels.js, labels.css)
- `REGIONS`: National (CONUS), Northeast, Mid-Atlantic, Southeast,
  Florida, Great Lakes, Midwest, Plains, Texas, Southwest, Rockies,
  California, Pacific Northwest, Alaska, Hawaii, plus "Follow fronts"
  and "Tour" (auto). Each `{ id, name, cam, cities:[ids] }`.
- `createDirector(app) -> { goTo(regionId | {lat,lon,alt}), tour(on), tick(dt) -> cam, busy }`:
  news-program moves: hold, zoom out, slide across the country, zoom in
  on the next region, with time-lapse of the forecast while holding.
- `createLabels(root, app) -> { update(m, dt), onPick(fn) }`: DOM city
  labels that pop in (scale and fade) when the camera comes near, with the
  temperature counting up to the value in both units (`72°F · 22°C`),
  a weather icon, declutter by rank and screen overlap, H/L pressure
  marks and isobar values. Clicking a label calls the pick handler.

### UI (index.html, style.css, main.js, ui.js, forecast-card.js)
- `main.js` owns the `app` object (also `window.WX` for debugging):
  `{ t, playing, rate, units, lightMode, layers:{ clouds, radar, temp, isobars, fronts, labels }, focus, data:{ grid, fronts, radar, current }, core, cam }`, boot order, frame loop, refresh every 10 min.
- Broadcast-quality layout: top bar (title, live/sample badge, local
  time of the focus), focus selector (region chips + city search), layer
  toggles, legend (temperature ramp, radar dBZ, front symbols), a time
  scrubber with play and "now" (past 6 h radar, +48 h forecast), °F/°C
  order switch. Mobile: dock + bottom sheet (wave-membrane pattern),
  44 px touch targets, the globe framed in the clear area.
- `forecast-card.js` `openForecast(city | {lat,lon})`: full forecast —
  now (temp both units, feels, wind, humidity, pressure), 48 h hourly
  chart (temperature line and precip bars, SVG), 10-day list with
  hi/lo bars, sunrise/sunset, UV, local time and date. Opened by clicking
  a label or clicking the globe (nearest city, else the point itself).
- Required lines in `<head>` in this order: `../../lib/gpu-guard.js`,
  `../../lib/wishlist.js`, `../../lib/stats-beacon.js`. A `#nogpu`
  message if WebGPU is missing (the forecast card and lists still work).

### SAVER (saver.js, saver.css)
`window.snSaver = { enter(opts), exit() }`, opts `{ calm, seconds,
caption, seed }`, enter returns `{ canvas, warmupMs }` (the page's own
in-document canvas). A full-screen screensaver mode also available from
the page (a button and the `S` key): director tour without UI chrome,
a lower-third broadcast plate with the focus place name, the current
local time (ticking) and date of that place, the temperature and
conditions, a slowly playing forecast time-lapse. Shots vary per run
(seeded shuffle), cut every ~8-14 s, calm and wide, framed for both 16:9
and 9:16 inside `plateBand()` from `../../lib/saver-clear.js`. A node
test samples shots for both aspects.

## Phases

1. CORE, ASSETS, DATA (parallel).
2. SKY, FRONTS, DIRECTOR, UI, SAVER (parallel, read phase-1 code first).
3. INTEGRATE: wire everything, run every check, fix seams, then a
   review pass.
