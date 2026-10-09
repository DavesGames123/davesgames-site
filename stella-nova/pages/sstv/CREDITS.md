# Slow-Scan Television page: credits

## pysstv (MIT)

The page was built around **pysstv**, https://github.com/dnet/pysstv,
by Andras Veres-Szentkiralyi. Licence: MIT, "Copyright (c) 2013 Andras
Veres-Szentkiralyi" (LICENSE.txt in that repository).

What we took from it:

- The structure of the encoder: VIS header tones (leader, break, start
  bit, 7 data bits LSB first, even parity, stop bit), (Hz, ms) segments
  per line, a phase-continuous sine.
- The mode timing tables of Robot 8 BW, Robot 24 BW, Wraase SC2-120 and
  Pasokon P3, P5 and P7, and the VIS codes. The Martin, Scottie, Robot 36
  and PD timings agree with the published spec below.
- tests.mjs checks every line length and VIS code against pysstv, and
  decodes WAV files that pysstv wrote.

The JavaScript code (modes.js, codec.js and the rest) is our own. No
pysstv source is copied. The receiver (FM demodulator, VIS and sync
detection, the line fit, pixel sampling) has no counterpart in pysstv.

MIT licence text of pysstv:

    Permission is hereby granted, free of charge, to any person
    obtaining a copy of this software and associated documentation
    files (the "Software"), to deal in the Software without
    restriction, including without limitation the rights to use,
    copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the
    Software is furnished to do so, subject to the following
    conditions:

    The above copyright notice and this permission notice shall be
    included in all copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
    EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
    OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
    NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
    HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
    WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
    FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
    OTHER DEALINGS IN THE SOFTWARE.

## Mode specifications

- JL Barber, N7CXI, "Proposal for SSTV mode specifications", Dayton SSTV
  forum, 2000: Martin, Scottie, Robot 36 and 72, PD line timings.
- Mode authors: Martin Emmerson G3OQD (Martin), Eddie Murphy GM3SBC
  (Scottie), Robot Research Inc. (Robot), Paul Turner G4IJE and Don
  Rotier K0HEO (PD), Volker Wraase DL2RZ (Wraase SC-2), John Langner
  WB2OSZ (Pasokon).

## Pictures

Every picture (images.js: test card, planet, sunset, colour bars, zone
plate, event card) is drawn by our own code from formulas. No photo or
third-party art ships with the page. The event card is our own design;
it is not an ARISS card and uses no ARISS mark.

## Reference only (no code used)

- slowrx by Oona Räisänen, https://github.com/windytan/slowrx, linked on
  the page as further reading.
