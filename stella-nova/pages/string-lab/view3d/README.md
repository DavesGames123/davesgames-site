# String Lab 3D view

The 3D view draws one generic instrument in three.js (r160, from
`stella-nova/vendor`) with live strings. Each string is a tube mesh. The
view reads the displacement of a `StringSim` from `../engine/strings.js`,
multiplies it by the display exaggeration, and colours each vertex by one
field through a ct-lab colour map. The page and the saver use this module.
It has no physics of its own: it reads the sims and never steps them.

The models are our own procedural geometry. They are generic and
unbranded: a steel-string acoustic guitar (dreadnought style), a classical
guitar and a violin with its bow. No brand name, logo or branded headstock
shape is in the models or in the code. Wood grain, flame and rosette
textures are `DataTexture`s made in code, so the module needs no image
files and runs in node.

## Files

| File | What it is |
|---|---|
| `index.js` | `createStringView3D()`: renderer, scene, lights, camera presets, frame loop |
| `models.js` | procedural guitar, classical guitar, violin and bow; string anchor points |
| `strings3d.js` | live string tubes, field values, colour mapping, hand dots |
| `textures.js` | procedural wood, flame, rosette and winding textures (`DataTexture`) |
| `tests.mjs` | node tests: `node stella-nova/pages/string-lab/view3d/tests.mjs` |
| `README.md` | this file |

## Coordinates

Units are metres. The bridge saddle (guitar) or the bridge top (violin) is
at `x = 0`. The nut is at `x = +L` (scale length). The top of the
instrument faces `+z` and `y` is across the strings. String 0 (lowest
pitch) has the largest `y`. A string point at fraction `s` from the bridge
(the engine convention) is at `bridge + s (stop - bridge)`.

## API

```js
import { createStringView3D, FIELDS, CAMERA_PRESETS } from './view3d/index.js';

const view = createStringView3D(canvas, {
  instrument: 'steel',      // 'steel' | 'classical' | 'violin' (INSTRUMENTS keys)
  field: 'accel',           // a FIELDS id, or 'none' (natural string colours)
  colormap: 'magma',        // any ct-lab colour map id
  reverse: false, gamma: 1,
  exaggeration: 20,         // display only, multiplies u
  polarization: 0,          // rad; 0 = in the plane of the top, PI/2 = toward it
  controls: true,           // OrbitControls on the canvas (needs DOM events)
  pixelRatio: 2,            // capped at 2
  quality: 'high',          // 'low' for phones: fewer tube segments, no shadows
  background: 0x0b0d12,     // or null for a transparent canvas
  orientation: 'auto',      // 'auto' (portrait canvas: neck up), 'landscape', 'portrait'
  thick: 1.8,               // drawn string radius / real radius
  renderer: null,           // an existing WebGLRenderer, or 'none' (no GL; tests)
});

view.setInstrument('violin');          // rebuilds the model; detaches all sims
view.attach(i, sim);                   // StringSim for string i (null = string at rest)
view.attachAll(sims);                  // array by string index
view.setFret(i, fret, finger);         // -1 muted, 0 open, n = fret (violin: semitone stop)
view.setFrets(frets, fingers);         // arrays by string index
view.setField('velocity');
view.setColormap('inferno', { reverse: false, gamma: 1 });
view.setRange(null);                   // null = auto range, or a fixed max (field units)
view.setExaggeration(50);
view.setPolarization(Math.PI / 4);
view.setBow({ string: 2, pos: 0.09, speed: 0.4, on: true }); // violin only; null hides
view.highlight(i);                     // draw one string thicker (null = none)
view.setThickness(2.5);                // drawn string radius / real radius
view.setCamera('soundhole', { animate: true, string: 2 });
view.autoOrbit(0.05);                  // rad per wall second, 0 = off (saver)
view.frame(dtWall, dtSim);             // read sims, update tubes, move bow, render
view.resize(width, height);            // CSS pixels
view.legend();                         // { id, label, unit, max, signed, colormap }
view.stringAt(clientX, clientY);       // { string, pos } or null (pick to pluck)
view.dispose();

view.renderer; view.scene; view.camera; view.model; view.controls;
view.live;                             // LiveStrings (strings3d.js)
view.state;                            // copy of the view state (field, auto range, bow, ...)
```

Call `frame()` once per animation frame. `dtWall` is the wall time in
seconds. `dtSim` is the simulated time of the frame (the page gets it from
the engine's `viewStepper`). The bow moves with simulated time, so it also
moves slowly in slow motion.

### Fields (`FIELDS`)

| id | value per point | unit | colour range |
|---|---|---|---|
| `accel` | total acceleration `a` = net force per unit mass, smoothed | m/s^2 | magnitude |
| `velocity` | `v` | m/s | signed |
| `displacement` | `u` | m | signed |
| `energy` | `mu v^2 / 2 + T u_x^2 / 2` | J/m | magnitude |
| `tension` | tension part of `a`, `c^2 u_xx` | m/s^2 | signed |
| `none` | natural string material | | |

A sequential map shows the magnitude from 0 to max. A diverging map (for
example `coolwarm`) shows a signed field from -max to +max. The auto range
follows the peak over all strings and falls slowly (half life 1.5 wall
seconds), so the colours stay legible while a note decays.

### Camera presets (`CAMERA_PRESETS`)

| id | view |
|---|---|
| `instrument` | the whole instrument |
| `soundhole` | the strings over the sound hole (violin: between the f-holes) |
| `string` | close along one string (`opts.string`) |
| `bow` | the bow on the strings (violin) |
| `fretboard` | the hand on the neck |

## Notes

- The colour map LUT bytes are sRGB. The view converts them to linear for
  the vertex colours, so the screen shows the LUT colours.
- Strings are drawn about two times thicker than real, for legibility.
- The sim of a fretted string covers the bridge to the fret only. The part
  from the fret to the nut is drawn straight.
