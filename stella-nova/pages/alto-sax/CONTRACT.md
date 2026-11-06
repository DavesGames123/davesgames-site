# Alto Sax Mechanism — contract and notes

The page is an interactive 3D explainer of a generic modern alto
saxophone in Eb, written range low Bb3 to high F#6. It models every key,
pad cup, tone hole, hinge rod, pivot screw, spring and adjustment felt or
cork, and every linkage between keys. The instrument is generic. It shows
no brand name, logo or engraving.

This file is the spec. `model.js` is the data and the solver. `tests.mjs`
checks the data against the rules in this file.

## 1. Facts, with sources

Each fact has a source tag. A tag of `[I]` marks an inference that no
source states in direct words. The reason for the inference is given.

### Acoustics

- F1. A saxophone bore is a cone. Its resonances form a full harmonic
  series, like an open pipe of the same length. `[UNSW-intro]`
- F2. At low frequency the first open tone hole acts almost as the end of
  the tube. Each open hole raises the pitch by a semitone, which needs a
  tube about 6% shorter. `[UNSW-intro]`
- F3. So a chromatic instrument needs about one tone hole for each
  semitone, and keys with linkages let one finger control more than one
  hole. `[UNSW-intro]`
- F4. The alto is in Eb. Written low Bb3 sounds Db3: the sounding pitch is
  a major sixth (9 semitones) below the written pitch. `[UNSW-intro]`
- F5. The octave (register) key opens one of two small register holes. The
  lower one (on the body) is used from written D5 to G#5. The upper one
  (on the neck) is used above G#5. The left-hand third finger (the G key)
  selects the hole. `[UNSW-intro]`
- F6. With the low D fingering and with the low C# fingering, the tube has
  three open tone holes (soprano measurements). `[UNSW-D4]` `[UNSW-Cs4]`

### Construction

- F7. The body is a conical brass tube. Leather pads on keys close the
  holes. Rods, pivot screws and springs are blued or stainless steel.
  Adolphe Sax received a 15-year patent on 28 June 1846. `[WP-sax]`
- F8. The low C pad is sprung open. The low Eb and the low C# pads are
  sprung closed. `[KeyLeaves]`
- F9. A maker describes an "improved low B to C# connection" that makes
  the low C# key close with certainty when low B is played. `[Yamaha-26]`

### Automatic octave mechanism

- F10. The thumb key is an on and off switch. It acts through a fork and a
  pin on a swivel arm. The swivel pivots on a pin fixed to the body octave
  key. One end of the swivel drives the neck (crook) key through a pin key
  (lifter). The other end bears on the body octave key. `[SH-octave]`
- F11. The body octave pad opens for written D5 to G5 (and G#5). The neck
  pad opens for A5 and up. `[SH-octave]` `[UNSW-intro]`
- F12. When the G key is open, a foot on the G key sits on the body octave
  key cup and holds it closed. The force from the thumb key then goes
  along the swivel and opens the neck key. When the G key is closed, the
  foot lifts, the body key is free to open, and the neck key stays
  closed. With the thumb key held, the G foot alone does the change-over.
  `[SH-octave]` `[US3136199]`
- F13. The G key spring is usually the strongest spring on the
  instrument, because it must hold the body octave key closed against the
  swivel. The neck key spring is light. `[SH-octave]`
- F14. The pin key (lifter) has about 1 mm of clearance to the neck key
  ring at rest. Buffers (cork or felt) under the pin key and the thumb
  touch control free play and noise. `[SH-octave]` `[iFixit-octave]`

### G# articulation

- F15. The G# cup is closed at rest. Pressing the G# touch lets it open.
  `[Taming-Gs]`
- F16. An adjusting screw (on older instruments, felt or cork) sets the
  articulation bar against the G# cup. A G# that is not closed correctly
  makes low C#, B and Bb speak badly, while low C stays good.
  `[Taming-Gs]` `[sax.co.uk-Gs]`
- F17. The low C#, B and Bb touches hold the G# cup closed, so the player
  can keep the G# touch down and move to those notes. `[I]` Reason: the G#
  hole is far above the low C# hole, so an open G# hole would make low
  C#, B and Bb sound G#. The user request also states this articulation.
  Some sources say that these touches "operate" the G# key. On the model,
  they act on the G# cup arm, which is the part that F16 adjusts.

### Bb and C keys

- F18. The bis Bb is played with the B key and the bis key, both under
  the left first finger. The bis cup also comes down when the player
  fingers A or any note below A. `[BSWE-Bb]`
- F19. The side Bb lever closes, through a linkage, a pad over a tone hole
  on the side of the body. `[US1828389]` `[US11551648]`
- F20. B plus the right-hand F (or E) key gives Bb ("1 and 1" or forked
  Bb). On the model, the right-hand stack closes the Bb cup through the
  F# cup and a long Bb bar. `[I]` Reason: this is a standard fingering,
  but no source that we read states it. The fingering needs the Bb cup
  closed, and the F, E and D keys do not reach it directly. The timing
  fault in F23 ("F key not closing F# and bis Bb") shows that one key
  closes both.
- F21. The side C key, added to B, gives C. `[Dawkes-fing]`
- F22. Middle C is fingered with the left second finger (the A key)
  alone. `[I]` (standard chart fingering; not in a source that we read).
  So the A key closes the C# pad and the Bb cup as
  well as its own cup. `[I]` Reason: F2. C needs the C# hole closed and
  the C hole open.

### Right hand

- F23. The F# cup closes with the F, E and D keys through the F# bar. This
  gives F# with the E key alone (123|020). A timing fault is "F key not
  closing F# and bis Bb at the same time". `[NASA24]`
- F24. An auxiliary F# key (the F# trill key) adds F# to a normal F
  fingering. It opens a separate small hole. `[Dawkes-fing]`
- F24a. One source says "side Bb uses the normal A fingering plus the side
  key". The model follows the patents (F19) and the common chart (B key
  plus side Bb), where the side Bb lever closes the Bb cup. This is a
  conflict in the sources. `[Dawkes-fing]`

### Low keys

- F25. Low B and Bb do not need the right little finger on low C, so the
  low B and Bb touches close the low C pad through a link. `[I]` Reason:
  the fingering (F2).
- F26. Low Bb closes low B through the Bb to B link. `[I]` Reason: the
  fingering (F2).
- F27. On the model, the low C# touch also closes the low C pad. `[I]`
  Reason: F6 gives three open holes for low C#, the same count as for low
  D. With low C open as well there would be four. Real instruments may do
  this with a different part shape.

### Palm keys and high keys

- F28. Palm D, Eb and F open small holes near the top of the body. The
  high E side key and the high F# key open two more. The front F key,
  under the left first finger, is a second way to open the high F pad.
  `[Dawkes-fing]` `[US8129605]`

## 2. Sources

Facts are taken from these sources and put in our own words. No text,
figure or image is copied. No brand name or logo is on the model.

| Tag | Source |
| --- | --- |
| UNSW-intro | J. Wolfe, UNSW Music Acoustics, "Saxophone acoustics: an introduction", https://newt.phys.unsw.edu.au/jw/saxacoustics.html |
| UNSW-D4 | UNSW Music Acoustics, soprano D4 impedance page, https://newt.phys.unsw.edu.au/music/saxophone/soprano/D4.html |
| UNSW-Cs4 | UNSW Music Acoustics, soprano C#4 impedance page, https://newt.phys.unsw.edu.au/music/saxophone/soprano/Csharp4.html |
| WP-sax | Wikipedia, "Saxophone", https://en.wikipedia.org/wiki/Saxophone |
| SH-octave | S. Howard, "Octave mechanisms", https://www.shwoodwind.co.uk/HandyHints/octaves.htm |
| iFixit-octave | iFixit, "Alto Saxophone Octave Arm Diagnosis and Repair", https://www.ifixit.com/Guide/Alto+Saxophone+Octave+Arm+Diagnosis+and+Repair/106189 |
| US3136199 | US patent 3,136,199, "Musical wind instrument octave mechanism", https://patents.google.com/patent/US3136199A/en |
| Taming-Gs | Taming the Saxophone, "Check for a leaking G#", https://tamingthesaxophone.com/saxophone/technical/leaking-articulated-g-sharp |
| sax.co.uk-Gs | Sax.co.uk, "The eternal conundrum of the sticky G# key", https://sax.co.uk/blogs/news/the-eternal-conundrum-of-the-sticky-g-key |
| KeyLeaves | Key Leaves, "C the difference in these saxophone pads", https://keyleaves.com/blogs/news/c-the-difference-in-these-saxophone-pads |
| Yamaha-26 | Yamaha YAS-26 product page (feature list only), https://sg.yamaha.com/en/products/musical_instruments/winds/saxophones/yas-26/index.html |
| BSWE-Bb | Best Saxophone Website Ever, "A guide to finally figuring out which Bb fingering to use", https://www.bestsaxophonewebsiteever.com/?p=4755 |
| Dawkes-fing | Dawkes Music, "Saxophone fingerings: ultimate guide", https://www.dawkes.co.uk/sound-room/saxophone-fingerings-ultimate-guide/ |
| NASA24 | NASA 2024 repair handout, https://cdn.shopify.com/s/files/1/0055/6777/4793/files/NASA24_Handout.pdf |
| US1828389 | US patent 1,828,389, "Saxophone", https://patents.google.com/patent/US1828389 |
| US11551648 | US patent 11,551,648, "Saxophone having auxiliary side Bb key", https://patents.google.com/patent/US11551648 |
| US8129605 | US patent 8,129,605, "Front F, altissimo G key for saxophone", https://patents.google.com/patent/US8129605 |

Some sources are summaries read through a search tool, not full reads.
The inferences `[I]` are the weakest part of the model. Each one follows
from F2 (the first open hole sets the pitch) and the standard fingering.

## 3. Model rules

### Tone holes

- One chain of 15 tone holes, one for each semitone from C#5 down to B3.
  Each hole has a vent note: the written note that sounds when that hole
  is the first open hole from the top. The bell end gives Bb3.
- Seven extra holes: palm D5, palm Eb5, side E5, palm F5, high F#5
  (all played with the octave key, so they sound D6 to F#6), side C (vent
  C5) and F# trill (vent F#4).
- Two register holes: the body pip and the neck pip. They are not vents.
- `s` is the station of a hole along the centre line, in mm from the
  mouthpiece tip. The vent order must follow `s`.

### Keys

- A key is one rigid part that turns on one hinge: a rod (hinge rod
  through tubes, between two posts) or two point screws.
- A key has zero or more cups (each over one tone hole), zero or more
  touch pieces, a spring (needle or flat), and felt or cork stops.
- A cup has a rest state: open or closed. When its key is actuated, the
  cup goes to the other state.

### Linkages

Three kinds, all one way:

- `drive`: when key `from` is actuated, key `to` is actuated.
- `hold`: when key `by` is in state `when` (`actuated` or `rest`), key
  `to` cannot be actuated. A hold wins over a drive.
- `swap`: when key `from` is actuated, key `a` is actuated if it is free,
  else key `b` is actuated. This is the octave swivel.

The graph of all linkages must have no cycle. Every end must be a key.

### Solver

`solve(touches)` gives the actuated keys, the held keys, the links that
carry force, the state of each hole, the octave pip in use, the first open
vent and the written note that results. The kinematics test runs every
fingering in the chart and checks that the solver note is the chart note.

## 4. Page

- Files: see the banner in `index.html`.
- Fingering chart for the full range plus alternatives.
- Press any touch piece to hold it down. The keys that move glow and the
  linkage path is drawn as a line.
- Isolate one mechanism group: the rest goes ghost, the group parts move
  out, and labels and text explain each part.
- Optional synth: the sounding pitch (written minus 9 semitones).
- Phone: dock and bottom sheet; the view offset keeps the model clear.
- Screensaver: `window.snSaver = { enter, exit, debug, cut }`. Seeded shots
  of 6 to 12 s: fingering runs and mechanism close-ups, framed in the plate
  band from `lib/saver-clear.js`.

## 5. Checks and what is not verified

`node tests.mjs` checks the data, the linkage graph, the solver for every
chart fingering (and the acoustic rule from the hole states), the three.js
build in node (press direction, cup seat and lift, no part inside the
tube, no overlap), the saver plan and director, and the HTML. With
`NODE_PATH` set to a folder that has jsdom, it also runs `main.js` and
`saver.js` in jsdom with a fake WebGL renderer (desktop and phone).

There is no browser on this machine. Nobody has seen the page render: the
look of the materials, the lighting, the label placement, the phone sheet
and the frame rate are not verified. `tools/zfight-check.mjs` has no
adapter for this page, so z-fighting is checked only by reading the code.
