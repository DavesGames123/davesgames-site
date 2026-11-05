# Spectral Lines: credits and licences

## Line data: NIST Atomic Spectra Database

    A. Kramida, Yu. Ralchenko, J. Reader and NIST ASD Team (2024).
    NIST Atomic Spectra Database (ver. 5.12), [Online].
    Available: https://physics.nist.gov/asd [2026, November 4].
    National Institute of Standards and Technology, Gaithersburg, MD.
    DOI: https://doi.org/10.18434/T4W30F

- NIST Standard Reference Database 78. (c) U.S. Secretary of Commerce on
  behalf of the United States of America. All rights reserved.
- The page does not mirror the database. `data/lines.js` holds a
  selection of measured values that `tools/build-lines.mjs` makes by our
  own rule: for each neutral (I) and singly ionised (II) spectrum, lines
  from 200 to 1100 nm (wavelengths in air), ranked by the NIST relative
  intensity when at least 30 % of the lines have one, else by gk Aki /
  wavelength. It keeps the 160 strongest lines of X I and the 100
  strongest of X II, and the levels of those lines.
- Changes that we made: the strength column is our own log-scaled rank
  (0 to 1), not the NIST intensity. Lines closer than 0.001 nm are merged.
  References, uncertainties and line types other than "forbidden" are
  not kept.
- The data was fetched on 2026-11-04 with one request at a time, four
  seconds apart.

## Element names

`../periodic-table/data/elements.js` (already on the site; komed3/
periodic-table, MIT, and PubChem, public domain). See
`../periodic-table/CREDITS.md`.

## Colour of light

CIE 1931 2-degree colour-matching functions, from the analytic
multi-lobe fit of C. Wyman, P.-P. Sloan and P. Shirley, "Simple Analytic
Approximations to the CIE XYZ Color Matching Functions", Journal of
Computer Graphics Techniques 2(2), 2013. Our own code.
