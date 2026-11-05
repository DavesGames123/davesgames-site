# Spectral Lines: build contract

The user asked (2026-11-04): "i want a tool that shows me the spectral lines of each
element in a graphically pleasing and desne way that's animated and visually
interactive push when done". For the data the user chose "NIST, curated facts".

This file is the one spec. Each lane owns only the paths listed for it.

## Data (coordinator, done before the lanes finish)

    pages/spectral-lines/data/lines.js     classic script: window.SPECTRA (module.exports in node)
    pages/spectral-lines/tools/build-lines.mjs

Shape:

    SPECTRA = { version, source, fetched, elements: [
      { z, sym, I: Spec|null, II: Spec|null } ] }      // I neutral atom, II singly ionised
    Spec = { by: 'rel'|'gA', total, lines: Line[], levels: Level[] }
    Line  = [wl_nm_air, strength01, Aki, gk, loIdx, upIdx, forbidden01]   // sorted by wl
    (loIdx and upIdx are -1 for an unclassified line: NIST has its wavelength and
    intensity but no levels; such a line has no transition and no Boltzmann weight)
    Level = [energy_eV, 'configuration term J']

- strength01 is our log-scaled rank strength (1 = strongest kept line of that spectrum).
- About 95 elements; up to 160 lines (I) and 100 lines (II) each; 200-1100 nm.
- Element names: read stella-nova/pages/periodic-table/data/elements.js (window global,
  field "sym", "name" and so on, MIT + public domain, already on the site). Do not copy
  that data; load the file with a <script> tag.
- Credit on the page (visible, in an About/Credits panel): "Line data: NIST Atomic
  Spectra Database (ver. 5.12), A. Kramida, Yu. Ralchenko, J. Reader and NIST ASD Team,
  https://physics.nist.gov/asd, fetched 2026-11-04. (c) U.S. Secretary of Commerce on
  behalf of the United States of America. All rights reserved. This page shows a
  selection of lines (our rule: strongest by NIST relative intensity, else gA)."

## Physics the page may use

- Colour of a wavelength: CIE 1931 2-degree colour-matching functions to XYZ to linear
  sRGB, then gamma; use an analytic fit (Wyman, Sloan and Shirley 2013, multi-lobe
  Gaussian fit) written by you. UV (< 380 nm) and IR (> 750 nm) lines are drawn in a
  muted violet / deep red with a dashed or hatched style and labelled UV / IR.
- Temperature model (optional slider, Boltzmann, optically thin, LTE):
  I(T) proportional to gk * Aki / wl * exp(-Ek / kT), k = 8.617333e-5 eV/K, Ek = energy
  of the upper level (levels[upIdx][0]). Saha balance between I and II is optional;
  if used, state the simplification in the UI.
- Perceived lamp colour: sum the lines (strength or I(T)) through the CIE functions.

## Page (lane B)

    pages/spectral-lines/index.html  main.js  style.css  (+ any modules you split out)
    pages/spectral-lines/tests.mjs   node tests (no browser)

Required:
- Head scripts in this order: ../../lib/gpu-guard.js, ../../lib/wishlist.js,
  ../../lib/stats-beacon.js; viewport meta with viewport-fit=cover; meta description;
  `[hidden]{display:none!important}` in style.css. Fonts: no Playfair, Cormorant or
  JetBrains Mono. Any math uses MathJax SVG (as other pages do), never KaTeX.
- Dense overview: every element visible at once with its spectrum (for example a
  periodic-table layout where each cell is a mini emission spectrum, plus a "stack"
  layout of all spectra as rows sorted by Z). Animated transitions between layouts.
- Element view: a large spectrum band (emission: glowing lines on black; absorption:
  dark lines on a continuum), zoom and pan on the wavelength axis (wheel, pinch, drag),
  hover/tap a line for wavelength, strength, Aki, transition (lower -> upper level).
- Animated energy-level (Grotrian-style) diagram for the element: levels as bars by
  energy; picking a line animates the electron drop and a photon in the line colour;
  an idle animation fires random weighted transitions so the lamp "glows".
- Neutral / ion toggle (I, II, both), temperature slider using the model above,
  a perceived-colour "discharge tube" swatch that updates.
- Compare: stack 2-4 chosen elements; "find by wavelength": click a wavelength on the
  axis and list the elements with a line within +- 0.5 nm, strongest first.
- URL: ?el=<sym> opens that element; ?view=<table|stack>.
- Phone: the dock and sheet pattern of pages/wave-membrane (base dock with primary
  controls, bottom sheet in portrait, right drawer in landscape, 44 px targets under
  (pointer:coarse)); the spectrum never hides under the sheet.
- Canvas 2D or WebGL; keep 60 fps on a laptop with all ~95 spectra drawn (cache static
  layers in offscreen canvases).
- Export window.snSpectral = { setElement(sym), setView(name), state() } for the saver.

tests.mjs (node): data shape and sort order; wavelength-to-colour at 450/550/650 nm
gives blue/green/red dominant channels; Boltzmann weights finite and monotone in T for
a fixed line; find-by-wavelength finds H at 656.28 and Na at 589.0; main.js imports with
only browser-global ReferenceErrors; no element has both the hidden attribute and a CSS
display rule.

## Saver and thumbnail (lane C)

    pages/spectral-lines/saver.js  saver-tests.mjs  tools/thumb.mjs

- Read stella-nova/PAGES.md steps 8-9, lib/screensaver-catalog.js, lib/saver-clear.js and
  an existing hook (pages/periodic-table/saver.js + saver-plan.js) first.
- saver.js sets window.snSaver = { enter(opts), exit() }. enter({calm, seconds, caption,
  seed}) returns { canvas, warmupMs }; the canvas is in the document; frame the subject
  in plateBand(h); a seeded shuffle of 5-12 s shots: one element's emission band filling
  in line by line, the level diagram with photons, a slow pan along the whole stack of
  spectra, temperature sweeps that shift the lamp colour, two elements compared. Draw
  on your own canvas with your own code (it may import pure helpers that lane B exports,
  for example wavelength colour, but must work if they are not there yet: write your own
  small copies). Plate text: element, ion, strongest line, one TeX line
  (E = hc / lambda or the Boltzmann factor), NIST credit. No code on the plate.
- Write the catalog line for lib/screensaver-catalog.js in your report; do not edit it.
- tools/thumb.mjs: node raster (no browser, no npm deps) of a dense spectra image (for
  example the stack of all elements' emission bands, glowing) -> PNG -> `magick` to
  640x400 JPEG q84 at pages/home/thumbs/spectral-lines.jpg. Look at it with the Read tool
  and iterate until it is pretty and legible at card size.
- saver-tests.mjs: node checks of the shot plan (seeded, 5-12 s, elements exist) and the
  enter/exit contract with stubs.

## Rules for every lane

- No headless Chrome, Playwright, CDP or screenshots. Node checks only.
- Do not commit, push, stash, rebase or `git add -A`. Other sessions edit this repo.
  Edit only your own paths. The coordinator reviews, registers the page and commits.
- data/lines.js grows while the fetch runs (elements are added in Z order). Write code
  that works with any number of elements. The final file lands within ~25 minutes.
- Comments and the final report in ASD-STE100 Simplified Technical English.
- Final report <= 15 lines: files, checks run with their real output, open problems.
