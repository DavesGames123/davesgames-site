# String Lab engine contract

The engine is the physics, sound, MIDI and music-theory core of the String
Lab page (`stella-nova/pages/string-lab/`). Every file is an ES module with
no DOM access. Node can import each module, and `engine/tests.mjs` runs in
node with no browser. The page code (2D view, 3D view, explainer, UI) reads
the engine only through the exports listed here.

Units are SI everywhere: metres, seconds, newtons, kilograms per metre,
hertz. Positions along a string are fractions `0..1` from the bridge end
(`x = 0`) to the nut or stopping fret (`x = 1`) unless a name ends in `M`
(metres).

## Files

    strings.js      StringSim (finite-difference stiff damped string),
                    modal solution, damping fit, view clock
    instruments.js  steel-string guitar, classical guitar, violin;
                    frets, tunings, view presets
    audio.js        modal, simulated and Karplus-Strong voices, body
                    filters, strum timing, AudioEngine (WebAudio graph)
    midi.js         Standard MIDI File reader and writer, note list,
                    Scheduler, fretting mapper
    chords.js       guitar chord shapes, names, progressions, strum patterns
    harmonics.js    harmonic series, ratios, intervals, nodes, pluck
                    spectrum, beats
    fft.js          radix-2 FFT and peak finder (tests and the spectrum view)
    tests.mjs       node tests: `node stella-nova/pages/string-lab/engine/tests.mjs`
    CONTRACT.md     this file

To find a part, use `grep -n "<anchor>" engine/*.js`. Each file has a
section map in its first comment.

## Physics (strings.js)

The model is the stiff damped wave equation (Bilbao, Numerical Sound
Synthesis, 2009, ch. 7):

    u_tt = c^2 u_xx - kappa^2 u_xxxx - 2 sigma0 u_t + 2 sigma1 u_txx + F/mu

    c^2     = T / mu           (tension over linear density)
    kappa^2 = E I / mu,  I = pi d^4 / 64 (core diameter d)
    B       = kappa^2 pi^2 / (c^2 L^2)    (inharmonicity)
    f_n     = n f_1 sqrt(1 + B n^2),  f_1 = (1 / 2L) sqrt(T / mu)
    decay   sigma_n = sigma0 + sigma1 (n pi / L)^2

The scheme is the explicit centred scheme with simply supported ends
(u = 0 and u_xx = 0 at both ends). The grid spacing h obeys the
stability condition

    h >= h_min = sqrt( (c^2 k^2 + 4 sigma1 k
                 + sqrt((c^2 k^2 + 4 sigma1 k)^2 + 16 kappa^2 k^2)) / 2 )

with k = 1 / fs the time step. The constructor picks N = floor(L / h_min)
segments, so h is as near h_min as possible. Near the limit the numerical
dispersion is smallest.

### StringSim API

    new StringSim({ L, T, mu, d?, E?, kappa?, sigma0?, sigma1?, fs?, maxN? })
    sim.N, sim.h, sim.k, sim.c, sim.kappa, sim.B, sim.f1
    sim.u            Float64Array(N+1)  displacement now (m)
    sim.v            Float64Array(N+1)  velocity, centred estimate (m/s)
    sim.a            Float64Array(N+1)  acceleration = total force per unit mass (m/s^2)
    sim.aTension     Float64Array(N+1)  c^2 u_xx part of a
    sim.aStiff       Float64Array(N+1)  -kappa^2 u_xxxx part of a
    sim.aDamp        Float64Array(N+1)  damping part of a
    sim.step(n = 1)  advance n time steps; fills u, v, a after the last step
    sim.pluck({ pos, amp, width })      zero-velocity triangle, smoothed
    sim.strike({ pos, vel, width })     velocity impulse (hammer, finger tap)
    sim.bow({ pos, vel, force, a })     start stick-slip bowing (soft friction law)
    sim.stopBow()
    sim.touch({ pos, strength, seconds }) light finger touch: harmonic
    sim.setLength(L)                    stopped length (fretting); re-grids
    sim.damp(factor)                    multiply u, v (mute)
    sim.energy()                        total energy (J), exact for the scheme
    sim.bridgeForce()                   transverse force at x = 0 (N)
    sim.sampleAt(pos)                   linear interpolation of u
    sim.time                            simulated seconds
    sim.reset()

`a` is computed from the PDE right-hand side at time n, and it equals the
discrete second time difference `(u^{n+1} - 2 u^n + u^{n-1}) / k^2` of the
scheme. The test "acceleration field" checks this.

### Modal solution

    modalFrequencies(p, nMax)       f_n with inharmonicity
    modalDecay(p, nMax)             sigma_n
    pluckCoefficients(pos, amp, nMax)  triangle pluck modal amplitudes
    modalDisplacement(p, coefs, x, t)  exact sum of modes at x (fraction), t
    dampingFromT60(f1, T60a, f2, T60b, c) { sigma0, sigma1 }
    inharmonicity({ E, d, T, L })    B

    sim.schemeFrequency(n)          exact frequency of mode n in the scheme
                                    (numerical dispersion included)
    smoothField(field, passes, out) 1-2-1 smoothing for the force colour view

The explicit scheme is flat on high partials when B is large (at B = 2e-3
and 44.1 kHz, partial 12 is 16 cents flat). For real strings (B below
1.2e-4) partials 1..8 are within about 1 cent. A sharp pluck corner leaves
a grid-scale ripple in `a`; use `pluck({ width: 0.02 })` and
`smoothField(sim.a, 3)` for the colour view.

### View clock (slow motion is not physics)

    viewStepper({ timeScale, k }) -> { advance(dtWallSeconds) -> steps }

`timeScale` is simulated seconds per wall second (1, 0.1, 0.01, 0.001). The
display exaggeration multiplies `u` only in the view. Neither one changes
the physics.

## Instruments (instruments.js)

    INSTRUMENTS.steel     generic steel-string acoustic (dreadnought style),
                          25.4 in scale, light gauge 12-53, E2 A2 D3 G3 B3 E4
    INSTRUMENTS.classical generic classical guitar, nylon, 650 mm
    INSTRUMENTS.violin    generic violin, 328 mm, G3 D4 A4 E5
    instrument.strings[i] { name, midi, f, T, mu, d, E, material, sigma0, sigma1, gauge }
    stringParams(instrument, i, fret = 0)  -> StringSim params at that fret
    fretPositionM(L, n) = L (1 - 2^(-n/12))  distance of fret n from the nut
    stoppedLength(L, n) = L 2^(-n/12)
    TIME_SCALES, EXAGGERATIONS        view presets
    midiToFreq(m), freqToMidi(f), noteName(m)

Strings are listed low to high (index 0 = lowest pitch). The names are
generic. The page must not use any brand name, logo or branded headstock
shape for these instruments.

## Sound (audio.js)

    renderModal(params, { pos, amp, seconds, fs, nMax }) -> Float32Array
    renderSim(params, { pos, amp, seconds, fs })          -> Float32Array
    renderKS(f, { seconds, fs, decay, brightness })       -> Float32Array
    BODY_MODES[instrumentKey]   [{ f, q, gainDb }] resonances
    applyBody(buffer, fs, modes) offline biquad bank (same as the graph)
    strumOffsets(n, { direction: 'down'|'up', spreadMs })  seconds per string
    class AudioEngine
      new AudioEngine({ createContext? })   no context until start()
      start()          call from a user gesture only
      setVolume(v)     default 0.12
      setMuted(bool)
      playNote({ instrument, string, fret, velocity, when, method })
      playChord({ instrument, frets, direction, spreadMs, velocity, when })
      stopAll()
      bindPagehide(win)   stops all sound on pagehide
      createStubContext() node stub for tests (records nodes and connects;
                          each node has `kind`: gain, biquad, source, ...)
      onVoice             optional callback({ instrument, string, fret, midi, when })
      damp(instrument)    fade the strings of one instrument

`method` is 'modal' (default), 'sim' or 'ks'. 'ks' is the low-power path.

## MIDI (midi.js)

    parseMidi(bytes)  -> { format, division, tracks: [[event]] }
                         format 0 and 1, running status, tempo meta, sysex
    writeMidi(song)   -> Uint8Array   song = { format, division, tracks }
    notesFromMidi(parsed) -> [{ t, dur, midi, vel, ch, track }]  seconds
    songFromNotes(notes, { bpm, division, name, program }) -> song (for
                      files we write; note-offs are note-on velocity 0)
    songInfo(parsed)  -> { names, bpm, format, tracks }
    class Scheduler(notes)
      play(now), pause(now), seek(t), setTempoScale(s), position(now)
      due(now) -> notes whose start passed since the last call
      stepNext() -> next onset group (one note or one chord), and moves the cursor
      stepPrev()
    groupOnsets(notes, tolSeconds) -> [[note]]
    mapFretting(groups, instrument, { maxFret, span }) ->
        [{ notes: [{ midi, string, fret, shifted }], hand }]
    isPlayable(assignment, instrument, opts)

The mapper is a dynamic program over onset groups. The cost adds hand
movement, hand span, high frets and stretches. Open strings are cheap. A
note outside the instrument range is moved by octaves into range and is
marked `shifted`. A group with more notes than strings keeps the highest
note and the lowest notes that fit.

## Chords (chords.js)

    CHORD_SHAPES   [{ name, root, quality, frets[6], fingers[6], barre? }]
                   frets low E to high E, -1 = muted
    QUALITIES      { major: [0,4,7], minor: [0,3,7], 7: [0,4,7,10], ... }
    barreShape(root, quality, form 'E'|'A') -> shape
    shapePitches(shape, tuning) -> midi notes
    nameChord(midiNotes) -> { root, quality, name }
    PROGRESSIONS   [{ name, key, chords: [name], beatsPerChord }]
    STRUM_PATTERNS [{ name, steps: [{ beat, dir: 'D'|'U'|null, accent }] }]
    findShape(name)

## Harmonics (harmonics.js)

    harmonicSeries(f1, n, B = 0)
    ratioOf(n, m) -> { num, den, cents, name }
    INTERVALS  [{ name, semis, just: [num, den], justCents, etCents, diff }]
    nodes(n), antinodes(n)   fractions of the length
    pluckSpectrum(pos, nMax) relative amplitudes |sin(n pi p)| / n^2
    suppressedHarmonics(pos, nMax, tol)
    beatFrequency(f1, f2)
    harmonicFrets(nMax)      touch points of natural harmonics in fret numbers
    centsBetween(f1, f2)

## Performance

From `node engine/tests.mjs` (group "perf") on the development Mac
(Apple silicon, node 24), 2026-10-09. Budget: half of a 16.7 ms frame.

    string (N)             us/step   strings/frame, real time   at 1/100
    steel E2 (N=185)       0.45      25                          2500
    steel E4 (N=65)        0.17      68                          6800
    classical E2 (N=251)   0.62      18                          1840
    violin E5 (N=32)       0.09      131                         13150

Real time at 44.1 kHz is 735 steps per string per frame. A full guitar
(six strings) at real time costs about 2 ms per frame. In slow motion the
cost is negligible. renderModal of a 2.6 s low E note takes about 9 ms.
A phone is perhaps 3 to 5 times slower (not measured).
