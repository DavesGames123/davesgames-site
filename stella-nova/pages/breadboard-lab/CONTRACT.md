# Breadboard Lab — build contract

Nav key `breadboard-lab`, title **Breadboard Lab**, folder
`stella-nova/pages/breadboard-lab/`. This file is the spec. Five roles build
against it. Four build roles (SIM, PARTS, SCENE, MCU+UI) run in parallel.
INTEGRATE runs after them. The contract agent owns this file. If you need a
change to it, or to a file that another role owns, write it under
**Requests** at the end of your report. Do not edit the file yourself.

Source of the idea: `~/Downloads/breadboard-designer-3.html` (the old 2D
"breadboard bench": an ESP32 devkit, modules, 400-point boards, wire modes,
auto-wiring, gap checks, a wire checklist). The new page is a 3D bench where
the circuit simulates live.

---

## 0. Site rules (hard, for every role)

- Work on `main`. Do not make branches. Never push, amend or rebase.
- Other sessions commit to `main` at the same time. Commit only your own
  files, by pathspec, in one command:
  `git add <paths> && git commit -F - <paths> <<'EOF' ... EOF`.
  If git reports `index.lock`, wait a few seconds and try again. Never
  delete the lock.
- Touch only the files your role owns (section 2). Requests go in your
  report.
- **No browsers.** Never run headless Chrome, Playwright, Puppeteer, CDP,
  screenshots, recordings or `tools/saver-check.mjs`. Validate with node:
  `node --check`, node ESM imports, node tests, `~/.cargo/bin/naga` on any
  WGSL (bare `naga` on PATH is a different program). No WGSL line mixes
  `&&` with `||` without parentheses. (This page uses WebGL through
  three.js. It should need no WGSL.)
- Never `pkill` by pattern. Kill only the pids you started.
- Never put the user's email in a request, payload or User-Agent.
- No CDN imports. Use `stella-nova/vendor`. three.js is
  `vendor/three@0.160.0` (the version most pages use, through an importmap:
  `"three"` and `"three/addons/"`). New third-party code needs a licence
  that permits hosting. Vendor it with its licence file and send the NOTICE
  line to INTEGRATE.
- Write original code. Do not port code from tutorial or shader sites.
- Phones: the dock and sheet pattern (see `pages/wave-membrane`, and the
  phone layout of `pages/sdf-lab`), 16 px side gutters, no horizontal
  scroll, `[hidden]{display:none!important}`.
- Fonts: never Playfair, Cormorant or JetBrains Mono. Maths, if any, is
  MathJax SVG from `vendor/mathjax@3.2.2` (KaTeX breaks in the owner's
  Safari).
- Commit subject: `breadboard-lab: <imperative phrase>`, under 72
  characters. Body in plain simple technical English: short sentences,
  active voice. Say what and why, list new files one per line, give the
  real validation commands with their output lines, and say what is not
  verified (no browser run). End the body with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Each module starts with a header comment with a **GREP MAP**, in the
  style of `pages/sdf-lab/js/ui.js` and `lib/forge-ui.js`.
- `localStorage` access is always inside `try/catch`. The page must work
  when storage throws.

---

## 1. Product

The user builds circuits on breadboards in 3D and tests them live.

### 1.1 Build

- Place breadboards: full **830** (63 columns), half **400** (30
  columns), **mini 170** (17 columns, no rails). Several boards per
  bench. Move and rotate boards (90° steps). A part can span two boards
  (the old bench's "two-board ESP32 span" falls out of the hole rule in
  4.3).
- Place parts from the library: drag from the LIBRARY panel onto the
  bench, or tap a part then tap a hole (phone). Parts snap pin 1 to a
  hole. Parts that do not plug in (bench supply, motor, 9 V battery,
  Uno-style board, instruments) sit on the mat.
- Draw jumper wires from hole to hole, or from a hole to a socket pin (a
  header socket of a board, a supply terminal). Eight colours (old bench
  set: red, black, blue, green, yellow, purple, orange, white). Three
  styles: **arch** (a bent jumper that rises and arcs), **flat** (a
  pre-cut jumper flat on the board, L-routed), **free** (the user drags
  bend points).
- Select, multi-select (shift-click, box drag), move, rotate (R),
  delete, duplicate, undo and redo for every edit.
- Inspector: every part parameter with units (value wells as in the SDF
  lab: drag to scrub, click to type, E-series snapping for R and C).

### 1.2 Power and test

- Sources: bench supply (CV/CC: set volts and a current limit, output
  on/off, shows V and A, CC lamp), 9 V battery, 2×AA and 4×AA packs,
  CR2032 coin cell, USB 5 V (polyfuse 500 mA), function generator (sine,
  square, triangle; frequency, amplitude, offset), solar panel (light
  slider), 18650 shield (old inventory).
- Instruments on the mat, each with leads the user plugs into holes or
  pins:
  - **Multimeter**: DC V, DC A (in series, like a real meter, with a
    blown-fuse state), Ω, continuity (beep through WebAudio), autorange,
    a segment display drawn in 3D and in the panel.
  - **Oscilloscope**: 2 channels on the minimum, 4 when cheap, with
    timebase, V/div, offset, trigger (edge, level, auto/normal/single),
    cursors, Vpp / Vavg / frequency readouts. The trace shows on the 3D
    screen of the scope and in the panel.
  - **Logic analyzer**: 8 channels, threshold, edges, a timing view,
    optional UART decode.
- **Run**: play, pause, single step, speed (real time, slower: ×0.1,
  ×0.01, ×0.001, and faster when the circuit allows). The circuit runs
  live while the user edits. A wire change rebuilds the netlist and keeps
  running.
- The 3D view shows the circuit state: LED glow from its current (and a
  light halo), motor shaft spin, buzzer and speaker sound (WebAudio), 7-
  segment digits, 1602 LCD text, relay click, fuse blown, bench supply
  digits. On overcurrent, overvoltage or reverse polarity: smoke puffs,
  a burnt (charred) look, a toast that says why. "Replace part" and
  "Reset bench" repair damage.
- Optional **current flow** animation: dashes move along wires and leads
  at a speed set by the current, in the conventional direction.
- **Net highlight**: hover or tap a hole with the PROBE tool. All holes and
  pins of that net glow, and the status bar shows its voltage.
- **Checks** panel (the successor of the old GAPS list): floating IC
  inputs, parts with an unconnected pin, two pins of a part in one strip
  (shorted part, for example a resistor in one column), an IC not across
  the centre channel, an LED with no series resistor, a supply shorted at
  rest, a rail used with no feed (the old "rail has loads, no feed"),
  wire ends in covered holes.

### 1.3 Microcontrollers

- **328 Dev Board (Uno layout)**: off-board, female headers, USB power,
  on-board L LED on D13. **328 Nano-layout board**: plugs into the
  breadboard. **ESP32 devkit lookalike** (30 pins, 3.3 V logic, generic
  look, no logos or trademarks). No logos, no trademarks on any model.
- A CODE panel holds the sketch of each board: an editor, a compile
  button, errors with line numbers, a serial monitor and a serial
  plotter. See the MCU decision in 6.

### 1.4 Extend: materials and custom parts ("add materials like that")

- **Material editor** in the style of the SDF lab MATERIAL rows: colour,
  roughness, metalness, clearcoat, transmission, IOR, emissive, opacity,
  a surface pattern (none, brushed, knurl, pcb, grain, fine bumps).
  Presets (gold pin, tin lead, copper, FR4 green, matte black PCB, black
  epoxy, ceramic tan, glass, red LED epoxy, white ABS, chrome, rubber).
  Each part has material **slots** (body, legs, cap, label, lens). The
  user assigns a preset or a custom material to a slot of one part or of
  every part of that kind. Custom materials save in the document and in a
  local library.
- **Custom part editor**: name, category, a 3D template with its
  parameters, pins on a 0.1 inch grid (click the grid to add a pin, name
  it), material slots, and an electrical model: none, one built-in model
  with a pin-to-terminal map, a subcircuit of primitive elements, or
  logic expressions for a digital part. It saves into the document (so a
  shared link carries it) and into the local part library. Export and
  import as JSON.

### 1.5 Files

- Save and load by name in `localStorage`. Autosave of the current bench.
- Share by URL: `#d=` plus base64url of deflate-raw of the document JSON
  (CompressionStream). Warn above 8000 characters.
- Export and import JSON.
- **Import the old bench JSON** of breadboard-designer-3 (feasible,
  approximate, see 3.10).
- Examples panel: at least 18 examples (section 5), each with a short
  "what you should see".

---

## 2. Architecture and file ownership

```
stella-nova/pages/breadboard-lab/
  CONTRACT.md            contract agent
  index.html main.js saver.js tests.mjs NOTICE examples/**      INTEGRATE
  sim/**                 SIM
  parts/**               PARTS
  view/** core/**        SCENE
  mcu/** instruments/** ui/** style.css                          MCU+UI
```

| Role | Owns | Builds |
|---|---|---|
| SIM | `sim/**` | netlist from the document, MNA + Newton-Raphson + transient engine, every device model, digital chips, damage, checks, the Web Worker and its client, `sim/tests.mjs` |
| PARTS | `parts/**` | part definition schema and registry, board geometry and strip connectivity, every built-in part definition with its electrical template, procedural three.js models, materials and presets, wire mesh, labels, resistor bands, `parts/tests.mjs` |
| SCENE | `view/**`, `core/**` | renderer, lights, camera, picking and snapping, placing, wire drawing, selection, gizmo-free move and rotate, the document store with undo and redo, the event bus, live visual state, current flow, smoke, performance, touch, `view/tests.mjs` |
| MCU+UI | `mcu/**`, `instruments/**`, `ui/**`, `style.css`; may add `stella-nova/vendor/avr8js@0.21.1/**` | sketch compiler and runtime, board pin tables, optional avr8js HEX runner, multimeter, scope, logic analyzer, supply and function generator panels, every squircle panel, the material editor, the part editor, examples panel, files, share, legacy import, audio, phone dock and sheet, `ui/tests.mjs` |
| INTEGRATE | `index.html`, `main.js`, `saver.js`, `tests.mjs`, `NOTICE`, `examples/**`; one row in `stella-nova/lib/nav-data.js`; one line in `pages/home/sectors.js` (BLURBS); one line in `lib/screensaver-catalog.js`; the thumbnail files `pages/home/thumbs/breadboard-lab.jpg` and `thumbs/sm/breadboard-lab.jpg`, `thumbs/list.js` and `PAGES.md` through the tools | glue, markup, examples, page tests, registration |

Rules for the parallel phase:

- Imports between roles follow the API names in section 3. Before the
  other role has delivered, write a small stub **inside your own tests**,
  never in another role's folder.
- Cross-role functions take their collaborators as arguments where the
  contract says so (for example `buildNetlist(doc, registry, geo)`), so
  each role tests alone.
- All modules are ES modules. Modules that the worker or node loads
  (`sim/**`, `mcu/**` except UI glue, `parts/schema.js`,
  `parts/geometry.js`, `parts/registry.js`, `parts/defs/**`,
  `core/**`) must not touch `window`, `document` or `THREE` at import
  time. They must import in node.
- `parts/models/**` and `view/**` import three as `import * as THREE from
  'three'` (importmap). Node tests of three-dependent code use
  `../../vendor/three@0.160.0/build/three.module.js` by path, or inject
  THREE. three r160 imports in node; geometry and materials build there.

Suggested files (a role may add files inside its own folders):

```
sim/     netlist.js engine.js solver.js devices.js semis.js sources.js
         digital.js chips.js damage.js checks.js worker.js client.js
         tests.mjs
parts/   schema.js registry.js geometry.js materials.js labels.js bands.js
         wire.js boards.js models/*.js defs/*.js index.js tests.mjs
core/    bus.js doc.js store.js
view/    scene.js camera.js picking.js place.js wires.js select.js
         effects.js flow.js touch.js preview.js tests.mjs
mcu/     boards.js compile.js runtime.js libs.js avr.js tests.mjs
instruments/ meter.js scope.js logic.js supply.js funcgen.js display.js
ui/      app.js panels.js library.js inspector.js materials.js
         part-editor.js code.js serial.js examples.js files.js share.js
         legacy.js checks.js audio.js dock.js format.js tests.mjs
```

---

## 3. Interfaces

Units everywhere: SI in the sim (V, A, Ω, F, H, s, W, °C). Millimetres
in 3D space. One grid unit `G = 2.54` mm (0.1 inch).

### 3.1 Space

- World: `+Y` up. The mat is the plane `y = 0`. Top view looks down `-Y`
  with `+X` to the right and `+Z` toward the bottom of the screen.
- Rotation `rot ∈ {0,1,2,3}`: quarter turns. One step turns a part 90°
  **clockwise as seen in the top view**. It maps local `(x, z)` to
  `(-z, x)`. In three.js: `object.rotation.y = -rot * Math.PI / 2`.
- Board-local frame: origin at the centre of the board, `y = 0` at the
  board base, top surface at `y = H = 8.5`. `+X` is the column direction
  (column 1 at `-X`). `+Z` is toward row `j` and the bottom rails.

### 3.2 Board types and hole ids

| type | size W × D × H mm | columns | rows | rails | holes |
|---|---|---|---|---|---|
| `bb830` | 165.1 × 54.6 × 8.5 | 63 | a–j | TP TN BP BN, 50 each | 630 + 200 = 830 |
| `bb400` | 82.6 × 54.6 × 8.5 | 30 | a–j | TP TN BP BN, 25 each | 300 + 100 = 400 |
| `bb170` | 45.7 × 34.5 × 8.5 | 17 | a–j | none | 170 |

Hole positions (board-local, mm):

- Terminal column `c` (1-based): `x = (c - (cols + 1) / 2) * G`.
- Row index `ri` (a = 0 … j = 9): rows a–e: `z = -3.81 - (4 - ri) * G`
  (a = -13.97, e = -3.81). Rows f–j: `z = 3.81 + (ri - 5) * G` (f = 3.81,
  j = 13.97). The channel between e and f is 0.3 inch: a DIP spans it.
- Rail hole `k` (1-based) of an `n`-hole rail (groups of 5 with a one-
  pitch gap): `x = (k - 1 + floor((k - 1) / 5) - (n - 1 + floor((n - 1)
  / 5)) / 2) * G`. Rail rows: `TN z = -22.86` (outer, blue line), `TP z
  = -20.32` (inner, red line), `BP z = +20.32` (inner, red), `BN z =
  +22.86` (outer, blue).

Hole ids: `<boardId>:<local>`. Local is `<row><col>` for terminals
(`b1:a12`, `b2:j63`) and `<rail><k>` for rails (`b1:TP7`, `b1:BN50`).
Rows are one lowercase letter. Rails are two uppercase letters.

Connectivity (strips): for each column, `a–e` is one strip and `f–j` is
one strip. Each rail is one strip along its whole length. Board param
`splitRails: true` (830 only) cuts each rail in two at the middle (k ≤ 25
and k > 25), as on some real boards. Default false. Strip ids:
`<boardId>:<col>T`, `<boardId>:<col>B`, `<boardId>:TP` (or
`<boardId>:TP.1`, `<boardId>:TP.2` when split).

### 3.3 The circuit document (JSON)

```js
Doc = {
  format: 'breadboard-lab', version: 1,
  title: string, notes: string,
  boards:  Board[],
  parts:   Part[],
  wires:   Wire[],
  probes:  Probe[],            // instruments on the mat
  materials:   MaterialSpec[], // custom materials (3.6)
  customParts: PartDef[],      // data-only definitions (3.5)
  programs: { [partId]: Program },
  sim:  { speed: 1, pwm: 'auto' },   // speed: sim seconds per wall second
  view?: { pos:[x,y,z], target:[x,y,z] },
  nextId: number
}
Board = { id:'b1', type:'bb830'|'bb400'|'bb170', x, z, rot, params?:{splitRails?:bool}, looks?:Looks }
Part  = { id:'p3', def:'res', label?:'R1',
          place:{ on:'b1'|null, x, z, rot },   // position of pin 1 (mm). on = board-local, null = world (mat)
          params:{ [key]: number|string|bool }, // missing keys take the def default
          looks?: Looks }
Looks = { [slotKey]: materialId }            // preset id or custom MaterialSpec id
Wire  = { id:'w1', a:End, b:End, color:'#d63b3b',
          style:'arch'|'flat'|'free', via?: [[x,y,z],...],  // world mm, style 'free' only
          gauge?: 22 }
End   = { hole:'b1:a12' } | { part:'p1', pin:'D13' }
Probe = { id:'m1', type:'dmm'|'scope'|'logic',
          place:{ x, z, rot },                  // world mm
          leads:{ [leadName]: End|null },       // dmm: red, black. scope: ch1..ch4, gnd. logic: d0..d7, gnd
          settings: object }                    // dmm {mode:'V'|'A'|'R'|'cont', range:'auto'|number}
                                                // scope {tdiv, vdiv:[..], offset:[..], trig:{ch, level, edge, mode}}
                                                // logic {threshold, rate}
Program = { lang:'sketch', source:string } | { lang:'hex', hex:string }
```

- Ids are unique across the whole document: `b` boards, `p` parts, `w`
  wires, `m` probes, `mat-` custom materials, `cp-` custom part defs.
  `nextId` feeds the counter.
- `core/doc.js` (SCENE) owns `emptyDoc()`, `normalizeDoc(raw) → {doc,
  warnings}` (fills defaults, drops broken references, upgrades
  versions) and `validateDoc(doc) → errors[]`.

### 3.4 Event bus (`core/bus.js`, SCENE)

```js
createBus() → { on(type, fn) → off, once(type, fn) → off, emit(type, payload) }
```

| event | payload | who emits |
|---|---|---|
| `doc:change` | `{ ops, topology:bool, source:'user'|'undo'|'redo'|'load' }` | store |
| `select` | `{ ids:string[] }` | view |
| `hover` | `{ target: Target|null, x, y }` (client px) | view |
| `tool` | `{ tool:'select'|'wire'|'probe'|'delete'|'place' }` | view or ui |
| `place:start` / `place:end` | `{ defId }` / `{ id|null }` | view |
| `sim:frame` | `Frame` (3.8) | main.js |
| `sim:event` | `SimEvent` (3.8) | main.js |
| `sim:serial` | `{ mcu, text }` | main.js |
| `sim:state` | `{ running, speed, t, ratio }` | main.js |
| `toast` | `{ level:'info'|'warn'|'error', text }` | anyone |
| `camera` | `{ mode:'orbit'|'top'|'focus' }` | view |

`Target = {kind:'hole', hole} | {kind:'pin', part, pin} | {kind:'part', id} |
{kind:'wire', id} | {kind:'probe', id} | {kind:'lead', probe, lead} |
{kind:'board', id}`

### 3.5 Part definitions (`parts/schema.js`, `parts/registry.js`, PARTS)

```js
PartDef = {
  id, name, category, tags?:[], desc,
  mount: 'board' | 'free' | 'either',
  pins: [{ name:'1', label?:'1A', x, z, socket?:bool }],
     // x, z in grid units G, local frame, pin 1 at (0,0) for board parts.
     // A string value '$key' or '$key-1' etc. reads an instance param (expression of
     // +,-,*,/ and integers only), for example the resistor span.
     // socket:true marks a pin a wire end can plug into (headers, terminals).
  params: [{ key, label, unit?, type:'number'|'int'|'enum'|'bool'|'string',
             default, min?, max?, step?, scale?:'lin'|'log', series?:'E12'|'E24',
             options?:[...], live?:bool, geometric?:bool }],
     // live: user may change it while running (pot pos, lux, switch).
     // geometric: changes pin positions (topology change).
  electrical: ElementTemplate[],
  interact?: { kind:'press'|'toggle'|'knob'|'slider', key },   // clickable in 3D
  slots: [{ key:'body', label:'Body', default:'abs-white' }],
  model: { template: TemplateId, ...templateParams } ,   // data, used by custom parts
  build?: (THREE, ctx) => PartHandle,                      // code, built-ins may use it
  visual?: 'led'|'leds'|'motor'|'buzzer'|'speaker'|'seg7'|'lcd'|'relay'|'fuse'|'supply'|'meter'|'lamp'|'servo'|'none'
}
ElementTemplate = { id, type, nodes:{ [terminal]: pinName | '#internal' | 'GND@pin' },
                    params:{ [k]: literal | '$paramKey' }, vis?: string }
```

- `nodes` maps the element terminals (3.7) to part pin names, or to an
  internal node `#name` (local to this part instance).
- Element id in the netlist: `<partId>/<template id>` (for example
  `p7/a` for segment a of a 7-segment display). A part with one element
  uses template id `main`.
- `registry`: `createRegistry() → reg` with `reg.get(id)`, `reg.list(category?)`,
  `reg.add(def) → {ok, errors}` (custom), `reg.remove(id)`,
  `reg.validate(def) → errors[]`, `reg.categories`. `parts/index.js`
  exports `BUILTIN_DEFS` and `createRegistry` with them loaded.
- Categories: `power`, `passive`, `semis`, `ics`, `output`, `input`,
  `sensors`, `mcu`, `modules`, `instruments`, `custom`.
- Template ids for data models: `dip` {pins, label}, `sip-module` {pins,
  bodyW, bodyD, pcb, label, top:'none'|'chip'|'screen'|'lens'},
  `axial` {len, dia, bands}, `radial` {dia, h}, `box` {w, d, h, r},
  `to92`, `to220`, `cylinder` {dia, h}, `header-board` {w, d, rows}.

**Built-in part ids** (PARTS ships all of them; other roles and the
examples use these ids; pin names in brackets):

- power: `supply-bench` [+, −] free, sockets; `battery-9v` [+, −] free,
  snap with leads ending in sockets; `battery-aa2` [+, −]; `battery-aa4`
  [+, −]; `coin-cr2032` [+, −] board; `usb-breakout` [VBUS, GND] board;
  `funcgen` [OUT, COM] free; `solar-panel` [+, −] free;
  `batt-18650-shield` [3V, 5V, GND] free.
- passive: `res` [1, 2] (param `span` 3–12, default 4); `pot` [1, W, 2];
  `trimpot` [1, W, 2]; `cap-ceramic` [1, 2]; `cap-elec` [+, −];
  `inductor` [1, 2]; `fuse` [1, 2]; `ldr` [1, 2]; `thermistor` [1, 2].
- semis: `diode-1n4148` [A, K]; `diode-1n4007` [A, K]; `diode-schottky`
  [A, K]; `zener` [A, K] (param vz); `led` [A, K] (param color: red,
  orange, yellow, green, blue, white, ir); `led-rgb` [R, K, G, B];
  `npn-2n3904` [E, B, C]; `npn-2n2222` [E, B, C]; `pnp-2n3906` [E, B, C];
  `nmos-2n7000` [S, G, D]; `nmos-logic-to220` [G, D, S];
  `pmos-to220` [G, D, S].
- ics (DIP, pins named by number '1'…'N' with labels): `ic-555`,
  `ic-lm358`, `ic-74hc00`, `ic-74hc02`, `ic-74hc04`, `ic-74hc08`,
  `ic-74hc32`, `ic-74hc86`, `ic-74hc74`, `ic-74hc595`, `ic-cd4017`;
  regulators `reg-7805` [IN, GND, OUT] TO-220, `reg-3v3` [IN, GND, OUT]
  (AMS1117-style breakout).
- output: `buzzer-active` [+, −]; `buzzer-passive` [+, −]; `speaker-8r`
  [+, −] free; `motor-dc` [A, B] free, sockets; `servo` [SIG, VCC, GND]
  free, sockets; `relay-5v` [C1, C2, COM, NO, NC]; `seg7-1` [a…g, dp,
  COM1, COM2] (param common: cathode|anode); `seg7-4` [a…g, dp, D1…D4];
  `lcd-1602` [VSS, VDD, V0, RS, RW, E, D0…D7, A, K]; `lamp-6v` [1, 2] free.
- input: `button-6mm` [1, 2, 3, 4] (1–2 joined, 3–4 joined, press joins
  the pairs; pins 1 (0,0), 2 (2,0), 3 (0,−3), 4 (2,−3): it straddles the
  channel); `button-12mm` [1, 2, 3, 4] (param cap colour);
  `switch-slide` [A, COM, B]; `joystick` [GND, +5V, VRX, VRY, SW];
  `keypad-4x4` [R1…R4, C1…C4].
- sensors: `ldr` and `thermistor` (above), `temp-analog` [+V, OUT, GND]
  (10 mV/°C, 0.5 V at 0 °C).
- mcu: `mcu-uno` free, sockets [D0…D13, A0…A5, 5V, 3V3, GND.1, GND.2,
  GND.3, VIN, AREF, IOREF, RESET]; `mcu-nano` board, 30 pins [D0…D13,
  A0…A7, 5V, 3V3, GND.1, GND.2, VIN, AREF, RST.1, RST.2]; `mcu-esp32`
  board, 30 pins [EN, VP, VN, 34, 35, 32, 33, 25, 26, 27, 14, 12, 13,
  GND.1, VIN, 23, 22, TX0, RX0, 21, 19, 18, 5, 17, 16, 4, 2, 15, GND.2,
  3V3]. The ESP32 devkit is 1.0 inch wide: pins sit in rows b and i of
  one board, so rows a and j stay free (the old bench's "only one row
  reachable" lesson). A user can span two boards side by side.
- modules (from the old inventory; "not simulated" shows in the
  inspector, the electrical model is a supply load and 1 MΩ inputs):
  `mod-gps`, `mod-tft154`, `mod-rfid`, `mod-nrf24`, `mod-radar`,
  `mod-fm`, `mod-charger`.
- instruments (3D only, used by probes): `inst-dmm`, `inst-scope`,
  `inst-logic`.

Electrical templates of the composite parts (PARTS writes them):

- `button-6mm`: `wire` 1–2 and 3–4 (r 0.01), `button` between 1 and 3.
- `seg7-1`: 8 `led` elements a…dp from the segment pin to COM (anode
  types reversed), vis ids `a`…`g`, `dp`. `seg7-4`: 32 leds
  `d1a`…`d4dp`.
- `led-rgb`: three `led` elements (red, green, blue colours).
- `lcd-1602`: one `hd44780` element plus `led` A→K backlight (vis
  `bl`).
- `mcu-uno`/`mcu-nano`: `usbpower` (5V/GND, param `usb` default true),
  `regulator` 3V3 from 5V (model `ams1117-3.3`), `regulator` VIN→5V
  (model `ncp1117-5`), `led` + `resistor` 1 kΩ for the L LED on D13 (vis
  `L`), a power LED (vis `ON`). The MCU pins themselves are not
  elements: they are listed in `Netlist.mcus` and SIM makes the pin
  drivers.
- `mcu-esp32`: `usbpower` on VIN, `regulator` 3V3 (`ams1117-3.3`), blue
  LED on GPIO 2 (vis `LED`), red power LED.
- `joystick`: two `pot` (x, y) and a `button` SW to GND.
- `keypad-4x4`: 16 `button` elements Ri–Cj (live param `pressed` per key
  through `interact`).
- `batt-18650-shield`: `battery` 3.7 V plus `regulator` 5 V boost
  modelled as an ideal regulator.

### 3.6 Materials (`parts/materials.js`, PARTS)

```js
MaterialSpec = { id, name, color:'#rrggbb', roughness:0..1, metalness:0..1,
  clearcoat?:0..1, clearcoatRoughness?:0..1, transmission?:0..1, ior?:1..2.5,
  thickness?:mm, opacity?:0..1, emissive?:'#rrggbb', emissiveIntensity?:0..10,
  pattern?:'none'|'brushed'|'knurl'|'pcb'|'grain'|'bumps', patternScale?:number }
MATERIAL_PRESETS: MaterialSpec[]        // at least 20, ids like 'gold-pin', 'tin', 'copper',
                                        // 'fr4-green', 'pcb-black', 'pcb-blue', 'epoxy-black',
                                        // 'ceramic-tan', 'glass', 'led-red' … 'led-white',
                                        // 'abs-white', 'abs-black', 'chrome', 'rubber',
                                        // 'resistor-beige', 'resistor-blue', 'mat-teal'
validateMaterial(spec) → errors[]
makeMaterial(THREE, spec) → THREE.MeshPhysicalMaterial   // cached by spec hash; patterns are
                                                          // small procedural normal maps made in code
```

### 3.7 Netlist (`sim/netlist.js`, SIM)

```js
buildNetlist(doc, registry, geo) → Netlist
  // geo = the parts/geometry.js module (injected)
Netlist = {
  nodeCount,                    // node 0 is ground
  nodeNames: string[],          // a readable name per node: 'b1:12T', 'p3#mid', …
  ground: { node:0, why:'first source negative'|'mcu GND'|'none' },
  elements: Element[],
  mcus: [{ id, board:'uno328'|'nano328'|'esp32dev', pins:{ [pinName]: node },
           gnd: node, vdd: node, program: Program|null }],
  probes: [{ id, type, leads:{ [lead]: node|null }, settings }],
  holeNode: { [holeId]: node },     // every used hole
  pinNode:  { [partId + '.' + pin]: node|null },   // null = floating pin
  wireIds:  string[],               // order of Frame.wires
  issues:   Issue[]                 // static checks, 3.9
}
Element = { id, owner:partId|wireId|probeId, type, nodes:{ [terminal]: node }, params:{…}, vis?:string }
```

Ground: the negative terminal of the first source in document order (or
the GND of the first MCU board), else node 0 is a free node. SIM adds
`gmin = 1e-12 S` from every node to ground. Each wire becomes a
`wire` element (r 0.02 Ω) so wire currents exist. Strips are nodes. A
pin with no hole in 0.6 mm and no wire is floating.

**Element types** (SIM implements all; PARTS uses them in templates).
Terminals in brackets. Default params in parentheses.

| type | terminals | params |
|---|---|---|
| `resistor` | a b | r, pmax (0.25) |
| `wire` | a b | r (0.02), imax (3) |
| `pot` | a w b | r, pos 0..1 (w–a = pos·r), taper 'lin'/'log', pmax (0.5) |
| `capacitor` | a b (a = + when polarized) | c, esr (0.01; 0.1 electrolytic), polarized, vmax (50), leak (1e9) |
| `inductor` | a b | l, rdc (0.1) |
| `vsource` | p n | wave {kind:'dc', v} or {kind:'sine'|'square'|'tri', amp, freq, offset, phase, duty}, rint (0) |
| `isource` | p n | i (pushes current into node p through the outside circuit) |
| `supply` | p n | v, ilim, on — CV/CC bench supply; reports cc:true in CC |
| `battery` | p n | v (full EMF), rint, mah, soc 0..1 (EMF falls with soc) |
| `usbpower` | p n | v (5), rint (0.2), trip (0.5 A polyfuse; resets when cool, and only after the fault is gone), usb (on) |
| `diode` | a k | model '1n4148'/'1n4007'/'schottky' or is, n, rs, bv, ibv, cj |
| `zener` | a k | vz, rz (5), plus forward diode |
| `led` | a k | color (sets vf at 20 mA: red 2.0, orange 2.05, yellow 2.1, green 2.2, blue 3.1, white 3.1, ir 1.3), imax (0.02), iabs (0.05), vrmax (5; warns above it, reverse knee at 4 × vrmax) |
| `npn` / `pnp` | c b e | model '2n3904'/'2n2222'/'2n3906' or bf, br, is, vaf, pmax, cje, cjc (junction capacitance), rb (10 Ω), ikf (high-injection knee) — Ebers-Moll with Early effect |
| `nmos` / `pmos` | d g s | model '2n7000'/'logic-to220'/'p-to220' or vth, k (A/V²), lambda, pmax — square law |
| `opamp` | inp inn out vcc vee | model 'lm358'/'ideal' — a0, gbw, rout, slew, vos (input offset: 1 mV / 1 µV), swing to rails per model |
| `timer555` | gnd trig out reset ctrl thres dis vcc | behavioural: comparators at 2/3 and 1/3 of vcc (or ctrl), SR latch, dis switch 10 Ω, out source rout 10 Ω; the output burns above 300 mA for 50 ms or above 150 °C |
| `switch` | a b | on, ron (0.05) |
| `spdt` | com a b | pos 0/1 |
| `button` | a b | pressed (live), ron (0.05), bounce (0 or ms) |
| `relay` | c1 c2 com no nc | coilR (70), vpick (3.75), vdrop (1.5), tmove (0.005 s) |
| `ldr` | a b | lux (live, 0.1..10000), r10 (10 kΩ at 10 lux), gamma (0.7) |
| `thermistor` | a b | r25 (10k), beta (3950), tempC (live) |
| `tempsensor` | vs out gnd | tempC (live), 10 mV/°C, 0.5 V offset |
| `motor` | a b | r (5), l (0.001), ke (0.005 V·s/rad), j, bfric, load; vis omega, angle |
| `servo` | sig vcc gnd | reads pulse width 0.5–2.5 ms → angle 0–180°, draws current |
| `buzzer` | a b | active (bool), r (active 160 / passive 40), vmin (2.5 for active) |
| `speaker` | a b | r (8) |
| `lamp` | a b | vnom (6), pnom (0.6), cold/hot resistance ratio (10) |
| `fuse` | a b | rating A, i2t; blows → open |
| `regulator` | in gnd out | model '7805'/'ncp1117-5'/'ams1117-3.3' (vout, dropout, iq, imax, thermal limit); boost: true is the ideal boost, uvlo (2.7 V for a boost) its undervoltage lockout |
| `logic` | p1 … pN | chip '74hc00'/'02'/'04'/'08'/'32'/'86'/'74'/'595'/'cd4017' — pins by DIP number |
| `logic-expr` | named pins incl. vcc gnd | outputs { Y:'!(A&B)' }, inputs [..] — for custom parts |
| `hd44780` | vss vdd v0 rs rw e d0…d7 | 16×2, 4- and 8-bit mode, ROM A00 subset |
| `solar` | p n | isc, voc, lux (live) |
| `vmeter` | a b | r (10 MΩ) — made by SIM for probes |
| `ameter` | a b | r (0.1), fuse (10) — made by SIM for probes |
| `mcupin` | p gnd | made by SIM for MCU pins |

Logic chips: inputs read the node voltage against the chip supply: HC
`VIL = 0.3·Vcc`, `VIH = 0.7·Vcc`, hysteresis band holds the old level;
CD4017 the same thresholds, 3–15 V. Outputs are sources to Vcc or GND
through `rout` (HC 50 Ω, 4000 series 400 Ω). With `Vcc − GND < 1.5 V`
outputs go high impedance. The chip draws a quiescent current plus its
output currents from the supply pins.

MCU pin driver (`mcupin`): `out` = source to the board's `vdd` level or 0
through 25 Ω (AVR) or 30 Ω (ESP32); `in` = 100 MΩ; `in_pullup` = 35 kΩ to
vdd (AVR) or 45 kΩ (ESP32); `pwm` and `tone` see 3.11. Absolute limits:
AVR pin 40 mA, ESP32 pin 40 mA → damage event (the pin dies, the MCU
lives).

### 3.8 Sim engine, client and frames (SIM)

Pure engine (node and worker):

```js
// sim/engine.js
createEngine(netlist, opts?) → eng
   opts: { method:'trap'|'be', dtMax, dtMin (1e-9), reltol (1e-3), vabstol (1e-6),
           abstol (1e-12), pwm:'auto'|'average'|'switch', mcuFactory?: (mcuSpec)=>Mcu }
eng.dcop() → { ok, iters, method:'newton'|'gmin'|'source' }
eng.advanceTo(t, budgetMs?) → { t, steps, rejected, done:bool }   // stops at budget
eng.t
eng.v(node) / eng.i(elementId)
eng.setParam(owner, key, value)         // live params, no rebuild
eng.patch(owner, elements)              // same ids and nodes, new params
eng.press(elementId, bool)
eng.repair(owner) / eng.reset()
eng.loadProgram(mcuId, program) → { ok, errors }
eng.serialIn(mcuId, text)
eng.addProbe(probe) / eng.removeProbe(id)
eng.measureR(nodeA, nodeB) → ohms|Infinity   // all independent sources zeroed, 1 mA test current
eng.frame() → Frame                     // and clears drained buffers
eng.drainEvents() → SimEvent[]
eng.snapshotState() / eng.restoreState(s)   // for rebuild with carry-over (cap voltages, inductor currents, mcu)
runFor(netlist, seconds, opts) → { eng, frames }   // test helper
```

- Method: trapezoid by default, backward Euler for the first two steps
  after a breakpoint (damps the trapezoid ringing). Step control from a
  local truncation error estimate. Breakpoints at source edges, MCU pin
  changes, digital output changes and relay moves. Newton-Raphson with
  junction voltage limiting; DC op falls back to gmin stepping, then
  source stepping. The linear solve uses a sparse LU with the symbolic
  order reused while the topology stays.
- Budget: a 200-node circuit with a 555 astable at 1 kHz runs at ≥ 1×
  real time in node on this machine. Report `ratio` (sim seconds per
  wall second / speed).

Worker and client:

```js
// sim/client.js
createSim({ inline?:bool }) → sim        // inline: no worker (node, fallback)
sim.load(netlist) → Promise<{ ok, warnings, dcop }>
sim.start() / sim.pause() / sim.stepOnce(dt) / sim.setSpeed(x) / sim.reset()
sim.setParam(owner, key, value) / sim.patch(owner, elements) / sim.press(id, bool)
sim.repair(owner) / sim.loadProgram(mcuId, program) / sim.serialIn(mcuId, text)
sim.measureR(probeId) → Promise<ohms>
sim.on('frame'|'event'|'serial'|'state'|'error', fn) → off
sim.dispose()                            // terminates the worker
```

Worker messages (`sim/worker.js`, module worker made with `new
Worker(new URL('./worker.js', import.meta.url), {type:'module'})`):
`{cmd:'load', netlist}`, `{cmd:'run'|'pause'|'reset'|'dispose'}`,
`{cmd:'speed', x}`, `{cmd:'step', dt}`, `{cmd:'param', owner, key,
value}`, `{cmd:'patch', owner, elements}`, `{cmd:'press', id, on}`,
`{cmd:'repair', owner}`, `{cmd:'program', mcu, program}`, `{cmd:'serial',
mcu, text}`, `{cmd:'measureR', probe, reqId}`. Replies: `{type:'frame',
…}`, `{type:'event', …}`, `{type:'serial', mcu, text}`, `{type:'state',
…}`, `{type:'loaded', ok, warnings}`, `{type:'error', msg}`. Typed arrays
go as transferables. The worker loop runs in slices of at most 12 ms,
targets `t_sim = t0 + speed · wall`, and drops debt beyond 100 ms of wall
time. Frames post at 30 Hz.

```js
Frame = {
  t, speed, ratio, running,
  nodeV: Float32Array,                      // index = node
  wires: Float32Array,                      // amps, order = netlist.wireIds; + = a→b
  parts: { [partId]: {
      i?, p?, temp?, damaged?: 'burnt'|'vented'|'blown'|'dead-pin'|null,
      vis?: { // per def.visual
        b?            // led: brightness 0..1.5 (1 = 20 mA)
        color?,
        leds?: { [visId]: brightness },        // seg7, leds, rgb, board LEDs
        omega?, angle?,                        // motor (rad/s, rad), servo angle
        freq?, amp?,                           // buzzer, speaker (Hz, 0..1)
        rows?: [string,string], cursor?:{r,c,on}, backlight?,   // lcd
        on?,                                   // relay, lamp glow, supply output
        v?, a?, cc?,                           // supply readout
        soc?                                   // battery
      } } },
  probes: { [probeId]:
      { kind:'dmm', value, unit:'V'|'A'|'Ω', overload:bool, fuse:'ok'|'blown', beep:bool }
    | { kind:'scope', t0, dt, ch: Float32Array[] }     // new samples since the last frame
    | { kind:'logic', t0, edges: [t, ch, level][], levels: number } },
  mcus: { [id]: { running, error?, millis, pins:{ [name]:{ mode, level, duty?, freq? } } } },
  stats: { steps, rejected, newton, solveMs, nodes }
}
SimEvent = { t, kind:'damage'|'short'|'cc'|'fuse'|'brownout'|'warn'|'info',
             owner?, severity:'info'|'warn'|'error', msg, smoke?:bool }
```

Damage: each element with a rating keeps a first-order temperature
(`C·dT/dt = P − (T − 25)/Rth`). It is damaged above its limit. Fast
rules: an LED above `iabs` for 50 ms burns (open, `smoke:true`); an
electrolytic reversed beyond 1 V for 0.5 s vents (open, smoke); a
resistor at 4 × `pmax` burns in about a second (open, charred); a fuse
blows by `i2t`; a transistor above `pmax` dies (open); a regulator goes
into thermal limit, it does not die. Damage stays until `repair(owner)`
or `reset()`. `short` fires when a source current exceeds 5 A or its own
limit within 1 ms of a topology change. `cc` fires when a bench supply
enters CC.

### 3.9 Checks (`sim/checks.js`, SIM)

```js
checkCircuit(netlist, doc, registry) → Issue[]
Issue = { level:'info'|'warn'|'error', code, msg, targets:Target[] }
```

Codes: `floating-input`, `unconnected-pin`, `shorted-part` (two pins of
one part in one strip), `ic-not-straddling`, `led-no-resistor`,
`supply-short`, `rail-no-feed`, `covered-hole`, `pin-overlap` (two part
pins in one hole), `no-ground`, `not-simulated` (modules).

### 3.10 Parts geometry (`parts/geometry.js`, PARTS)

```js
BOARD_TYPES = { bb830:{cols:63, railHoles:50, size:[165.1,54.6,8.5]}, bb400:{…}, bb170:{…} }
holeLocal(type, local) → { x, z }                  // board-local mm, top at y = 8.5
holeList(type) → string[]                           // every local id
stripOf(type, local, params?) → stripLocalId        // '12T', '12B', 'TP', 'TP.2'
strips(type, params?) → { [stripLocalId]: local[] }
boardToWorld(board, x, z) → { x, y, z } / worldToBoard(board, x, z) → { x, z }
holeWorld(doc, holeId) → { x, y, z }
pinLocal(def, pin, params) → { x, z }               // grid units → mm, rot 0
partPinsWorld(doc, part, def) → [{ pin, x, y, z }]  // y = pin tip height
resolvePins(doc, registry) → { pinHole: { 'p3.1': holeId|null }, covered:Set<holeId>, overlaps:[...] }
     // a pin plugs into the nearest hole of ANY board within 0.6 mm (spans across boards work)
nearestHole(doc, x, z, maxDist = 1.27, opts?) → holeId|null
partFootprint(doc, part, def) → { holes:Set, bbox }  // holes the body covers (for covered-hole check)
```

Wire geometry (`parts/wire.js`): `wirePath(a:[x,y,z], b:[x,y,z], style,
via?) → [x,y,z][]` (pure; arch height `min(25, 3 + 0.25·len)` mm above
the higher end, rises 3 mm vertical from each hole; flat: 0.8 mm above
the board, one bend), and `buildWire(THREE, {points, color, gauge}) →
{ object, setPoints(points), dispose }` (insulated tube plus a tinned
tip at each end).

Legacy mapping for the old bench import (UI uses it, PARTS provides the
defs): `esp32`, `esp32e`, `esp32sp` → `mcu-esp32`; `gps` → `mod-gps`;
`tft` → `mod-tft154`; `keypad` → `keypad-4x4`; `lcd` → `lcd-1602`;
`rc522` → `mod-rfid`; `joy` → `joystick`; `seg7` → `seg7-4`; `btnr`,
`btnb` → `button-12mm` (cap red/blue); `btnm` → `button-6mm`; `nrf` →
`mod-nrf24`; `radar` → `mod-radar`; `fm` → `mod-fm`; `vshield` →
`batt-18650-shield`; `tp` → `mod-charger`; `spk` → `speaker-8r`; `solar`
→ `solar-panel`. Old boards are `bb400`. Old coordinates: 22 px = 1 G
(2.54 mm); old `{type:'hole', board, row, col}` → `b<board+1>:<row><col+1>`;
rails `P1→TP`, `N1→TN`, `P2→BP`, `N2→BN`, rail col `0..24` → `k = col+1`.
Old wire ends at a pin of a board-mounted part land in the nearest free
hole of that pin's strip (the old "one hole over" rule). Pin indexes map
through the old `top`/`bot`/`pins` arrays (in breadboard-designer-3.html,
lines 260–306). The import returns warnings for anything approximate.

### 3.11 PWM, tone and the MCU bridge

- `analogWrite` drives `{mode:'pwm', duty, freq}` (AVR 490 Hz, pins 5
  and 6 980 Hz; ESP32 1 kHz). `tone(pin, f)` drives `{mode:'tone', freq}`.
  `servo.write` drives `{mode:'servo', pulse}` (50 Hz).
- `pwm: 'auto'` (default): SIM switches the pin (real edges as
  breakpoints) when a scope or logic lead, a digital input, a servo or a
  buzzer/speaker is on that net, or reachable through resistors,
  switches and transistor base/gate. Else it drives the average
  (`duty · vdd`). Required outcome either way: an LED on a PWM pin shows
  brightness ∝ duty; `tone(8, 440)` through 100 Ω and through an NPN
  driver gives buzzer `vis.freq` within 1 % of 440; a 50-node circuit
  with a tone stays at ≥ 1× real time.

The MCU runs **inside the sim worker**, co-simulated on the sim clock.
SIM calls the MCU through this interface (MCU+UI implements it in
`mcu/runtime.js`):

```js
// mcu/boards.js
BOARDS = { uno328:{ vdd:5, adcBits:10, vref:5, pins:{ D13:{ gpio:13, pwm:false }, A0:{ gpio:14, adc:0 }, … },
                    led:'D13', alias:{ LED_BUILTIN:'D13', SDA:'A4', SCL:'A5' } },
           nano328:{…}, esp32dev:{ vdd:3.3, adcBits:12, … inputOnly:[34,35,36,39] } }
// mcu/compile.js
compileSketch(source, { board }) → { ok, code?, errors:[{ line, col, msg }], warnings:[] }
// mcu/runtime.js
createMcu({ board, program }) → mcu        // program: { lang:'sketch', source } | { lang:'hex', hex }
mcu.reset(t)
mcu.nextWake() → t | Infinity               // next sim time it must run; Infinity = waits for a pin change
mcu.run(t, io)                              // runs until it blocks at a time > t; never re-enters
mcu.pinChanged(pin, level, t)               // input edge (interrupts, pulseIn, waits); may set nextWake to t
mcu.serialIn(text)
mcu.state() → { running, error?, millis, pins:{ [name]:{ mode, level, duty?, freq? } } }
io = { read(pin) → volts, vdd() → volts, drive(pin, cfg), serial(text), now() → t }
   // cfg: { mode:'in'|'in_pullup'|'out'|'pwm'|'tone'|'servo'|'off', level?, duty?, freq?, pulse? }
```

SIM calls `run` at each `nextWake` (a breakpoint) and after an input
edge that the MCU asked for. Brownout: when `vdd` of the board is below
80 % of nominal, SIM calls `reset` and holds every pin `off`.

---

## 4. View, store and UI interfaces

### 4.1 Store (`core/store.js`, SCENE)

```js
createStore(doc, bus) → store
store.doc                     // current document; treat as read-only
store.apply(op, { merge?:string }) → inverse   // merge: same key within 600 ms = one undo step (scrubs)
store.undo() / store.redo() / store.canUndo / store.canRedo
store.load(doc)               // clears history
Op = { op:'add', kind:'board'|'part'|'wire'|'probe'|'material'|'customPart', item }
   | { op:'remove', ids:[…] }                 // removing a part removes its wires and probe leads on it
   | { op:'move', id, place }                 // boards, parts, probes
   | { op:'set', id, path:'params.r'|'looks.body'|'color'|'style'|'via'|'settings.mode'|'leads.red'|…, value }
   | { op:'program', id, program }
   | { op:'meta', title?, notes?, sim? }
   | { op:'batch', ops:[…] }
applyOp(doc, op) → { doc, inverse, topology:bool }   // pure, exported for tests
```

`topology` is true for add, remove, move (except of a free part with no
wires), geometric params, wire ends and probe leads. The store emits
`doc:change`.

### 4.2 View (`view/scene.js`, SCENE)

```js
createView({ canvas, store, registry, bus, THREE, materials, quality:'high'|'low' }) → view
view.setFrame(frame)                 // pushes vis state to part handles, wires, meters
view.setNetlist(netlist)             // for net highlight and current flow
view.setTool(tool) / view.setWireColor(hex) / view.setWireStyle(style)
view.beginPlace(defId, params, pointerEvent?)   // drag from the library; phone: next tap places
view.beginProbe(type)                // add an instrument, then its leads
view.focus(id) / view.topView() / view.orbitView() / view.fit()
view.cameraTo({ pos, target }, ms) / view.getCamera() → { pos, target }
view.setFlow(on) / view.setQuality(q) / view.setLabels(on)
view.highlightNet(node|null) / view.flash(targets)    // checks panel jumps here
view.pick(clientX, clientY) → Target|null
view.screenPos(target) → { x, y }|null                 // for tooltips
view.screens(probeId) → { [name]: CanvasRenderingContext2D }   // instrument screens in 3D (UI draws)
view.effect('smoke'|'spark', partId)
view.previewMaterial(spec, size) → HTMLCanvasElement   // shared offscreen render: sphere + pin
view.canvas
view.dispose()                       // frees geometry, textures, renderer; forceContextLoss
```

Interaction rules: SELECT drags parts (snap pin 1 to a hole within 2 mm,
show a ghost with green or red pins), drags boards (snap edge to edge),
box-select on empty mat. WIRE: tap a hole or socket, then a second; while
drawing the wire follows the pointer; Esc cancels; style free adds bend
points by click. PROBE: tap a hole to show its net; drag a lead tip of an
instrument to a hole. DELETE: tap to remove. Wheel zooms, right drag or
two-finger drag pans, left drag on empty space orbits (SELECT box-selects
with shift). Touch: one finger = tool, two fingers = orbit/pan/pinch,
long press = context menu (rotate, delete, duplicate, replace).

Performance budget: ≤ 250 draw calls and ≤ 400 k triangles with three
830 boards and 60 parts. Holes are one InstancedMesh per board (or a
texture plus normal map). Shadows one directional light, 2048 map on
`high`, none on `low`. Phones start on `low`. Render on demand when idle
(no running sim and no camera motion), 60 fps while running on desktop,
30 fps cap on phones. Pixel ratio cap 2 (1.5 on phones).

Look: anti-static mat (teal-grey, faint grid), RoomEnvironment PMREM,
ACES filmic tone mapping, LED glow by emissive plus an additive halo
sprite (bloom pass only on `high`). Smoke: soft sprite particles rising
and fading over 2 s. Burnt: the handle darkens to char and adds a scorch
decal.

### 4.3 Part handles (`parts/models/**`, PARTS)

```js
buildPart(THREE, def, part, ctx) → PartHandle
   // ctx: { materials: (id)=>THREE.Material, quality, labels:bool }
PartHandle = {
  object: THREE.Group,          // local frame, pin 1 at origin, board surface y = 0
  pins: [{ name, local: THREE.Vector3 }],    // lead tip at the hole (y = 0) or socket mouth
  pickables: THREE.Mesh[],
  slots: { [slotKey]: THREE.Mesh[] },        // for material changes
  setLook(slotKey, material),
  setState(partFrame|undefined, dt),         // glow, spin, digits, lcd text, supply digits
  setDamage(kind|null),
  interact?: { kind, meshes:THREE.Mesh[], key },   // button cap, knob, switch lever
  screens?: { [name]: { canvas, ctx, texture } },  // dmm, scope, logic, supply, funcgen, lcd
  leads?: { [leadName]: THREE.Vector3 },     // instrument jacks
  dispose()
}
buildBoard(THREE, board, ctx) → { object, holes:THREE.InstancedMesh, pickables, dispose }
resistorBands(ohms, tolerance = 0.05) → ['red','red','brown','gold']   // 4-band; 5-band for 1 %
```

ICs carry the printed part name and a pin-1 notch and dot. Resistor
bands come from the value. The Uno-style board and the ESP32 devkit are
generic: plain silkscreen pin names, no logos, no trademark names on the
model. Model budget: ≤ 3 k triangles for a small part, ≤ 25 k for a dev
board or instrument, on `high`; about half on `low`.

### 4.4 UI (`ui/app.js`, MCU+UI)

```js
createUI({ store, registry, bus, view, sim, mcu:{ compileSketch, BOARDS }, materials }) → ui
ui.setFrame(frame) / ui.setNetlist(netlist) / ui.toast(level, text) / ui.open(panel)
ui.examples(list)               // INTEGRATE passes the example index
```

DOM contract (INTEGRATE writes these ids in `index.html`; UI fills them):
`#stage` (holds `canvas#gl`), `#bar` (top bar), `#leftCol`, `#rightCol`,
`#instrDock` (instrument panels, bottom), `#status`, `#toasts`, `#dock`
(phone), `#sheet` (phone bottom sheet), `#nogl` (no WebGL message),
`#tip` (hover tooltip).

Panels: LIBRARY (left), INSPECT (right), CHECKS, EXAMPLES, MATERIALS,
PARTS (custom part editor), CODE (editor, serial monitor, plotter),
FILE (save, load, share, export, import, legacy import), and the
instruments DMM, SCOPE, LOGIC, SUPPLY, FUNCGEN in `#instrDock`. Top bar:
panel buttons, run controls (play/pause, step, speed, reset), tools
(SELECT V, WIRE W, PROBE P, DELETE X), wire colours, wire style, undo,
redo. Status bar: sim time, real-time ratio, net voltage under the
pointer, issue count.

Keys: V W P X tools, R rotate, Delete/Backspace delete, Cmd/Ctrl+Z undo,
Shift+Cmd/Ctrl+Z redo, Cmd/Ctrl+D duplicate, F focus, T top view, O
orbit view, Space run/pause, 1–8 wire colours, Esc cancel. Keys do
nothing while focus is in an input or the code editor.

### 4.5 Main glue (`main.js`, INTEGRATE)

1. Registry, materials, bus, store (`normalizeDoc` of the URL hash, else
   autosave, else the first example).
2. View, sim client (worker, inline fallback), UI.
3. `doc:change`: if `topology`, `buildNetlist` → `sim.load` (carry state)
   → `view.setNetlist` and `ui.setNetlist`; else `sim.patch` /
   `sim.setParam` for the part.
4. `sim.on('frame')` → `view.setFrame`, `ui.setFrame`, bus `sim:frame`.
   Events → toasts, `view.effect('smoke')`, audio.
5. `pagehide`: `view.dispose()`, `sim.dispose()`, audio close (the GPU
   release rule).
6. `window.snSaver` from `saver.js`.

---

## 5. Examples (`examples/<key>.json`, INTEGRATE)

Each file: `{ meta:{ key, title, level:1..3, blurb, see:[…], checks:[…] },
doc:Doc }`. `checks` are node-verified expectations: `{ at:seconds,
probe|node|part, quantity, value, tol }`. `examples/index.js` exports the
list in order.

| # | key | Shows | The user should see |
|---|---|---|---|
| 1 | `first-led` | 5 V bench supply, 220 Ω, red LED, DMM in series | LED glows; DMM reads about 13.6 mA |
| 2 | `no-resistor` | LED straight on a 9 V battery | LED flashes bright, smokes, goes dark; toast explains the missing resistor; Replace part |
| 3 | `ohms-law` | series and parallel resistors, DMM in V and Ω | readings that match V = IR; Ω mode works only with power off |
| 4 | `divider-pot` | pot as a divider (DMM on the wiper) and a pot as a rheostat in series with an LED and 220 Ω | wiper voltage on the DMM follows the knob; LED dims |
| 5 | `button-pulldown` | push button, 10 kΩ pull-down, LED | LED on while the button is held (click the cap) |
| 6 | `rc-charge` | 10 kΩ, 100 µF, switch, scope | exponential rise, 63 % at τ = 1 s, cursors read it |
| 7 | `night-light` | LDR divider drives an NPN, LED | light slider down, LED comes on |
| 8 | `transistor-motor` | NPN switch, DC motor, flyback diode | motor spins; remove the diode and see a voltage spike on the scope |
| 9 | `blink-555` | 555 astable, two LEDs alternate | about 1.4 Hz blink; scope shows the cap ramp 1/3–2/3 Vcc and the square output |
| 10 | `tone-555` | 555 at audio rate into a passive buzzer, pot sets pitch | a tone you can hear; pitch follows the pot |
| 11 | `zener-reg` | 5.1 V zener and resistor from 9 V | 5.1 V across the zener over a load range |
| 12 | `reg-7805` | 9 V battery, 7805, caps, LEDs | 5.00 V out; battery drain shown; dropout when the battery falls |
| 13 | `opamp-amp` | LM358 non-inverting gain 11, function generator, scope | 0.2 Vpp in, 2.2 Vpp out; raise input until it clips at the rails |
| 14 | `rc-lowpass` | function generator, RC low-pass, scope 2 ch | attenuation and phase lag; at fc output is 0.707 and 45° |
| 15 | `thermostat` | thermistor + LM358 comparator drives a motor fan through an NPN | temperature slider past the set point starts the fan |
| 16 | `logic-gates` | two switches, 74HC08 and 74HC32, LEDs, logic analyzer | truth tables; analyzer shows A, B, AND, OR |
| 17 | `chaser-4017` | 555 clock into a CD4017, 10 LEDs | a running light; the analyzer shows the clock and Q0–Q3 |
| 18 | `flipflop-74` | 74HC74 as divide by two, button clock | LED toggles per press; analyzer shows Q at half the clock |
| 19 | `relay-lamp` | NPN drives a 5 V relay that switches a 6 V lamp, flyback diode | relay clicks, lamp glows |
| 20 | `mosfet-pwm` | 555 PWM (duty by pot) into an N-MOSFET and motor | motor speed follows the pot; scope shows duty |
| 21 | `cc-limit` | bench supply set to 100 mA limit, a short | supply drops to CC, CC lamp on, nothing burns |
| 22 | `reverse-cap` | electrolytic reversed on 9 V | it vents with smoke after a moment |
| 23 | `uno-blink` | Uno-style board, D13 LED and resistor | LED and on-board L LED blink at 1 Hz |
| 24 | `uno-button-serial` | button on D2 with INPUT_PULLUP, debounce, Serial | serial monitor prints presses |
| 25 | `uno-fade-pot` | pot on A0, PWM LED on D9, Serial plotter | LED brightness follows the pot; plotter draws the reading |
| 26 | `uno-595` | 74HC595 drives 8 LEDs, a scanner pattern | a sweeping light; analyzer shows data, clock, latch |
| 27 | `uno-7seg` | single 7-segment counter, resistors | digits count 0–9 |
| 28 | `uno-lcd-thermo` | 1602 LCD in 4-bit mode and a thermistor | LCD shows "TEMP 23.4 C" that follows the slider |
| 29 | `uno-melody` | passive buzzer with tone() | a short tune through WebAudio |
| 30 | `uno-servo` | pot controls a servo | horn angle follows the pot |
| 31 | `esp32-traffic` | ESP32 devkit on an 830 board, 3 LEDs, 3.3 V logic | traffic light sequence; DMM shows 3.3 V high level |
| 32 | `nano-joystick` | Nano-layout board, joystick, two LEDs | LEDs track the stick |

INTEGRATE may drop at most four of 21–32 if a feature is not ready, and
says which in its report. The minimum is 18 that pass their checks.

---

## 6. MCU decision

Facts on this machine (2026-10-13): `avr-gcc` is not installed.
Homebrew LLVM has an AVR backend (`clang --target=avr -mmcu=atmega328p`
compiles to an object), but there is no linker (`ld.lld` is absent) and
no avr-libc. So we cannot build `.hex` example programs now. `avr8js`
0.21.1 is on npm under MIT.

Decision:

1. **Primary: a sketch runtime.** `mcu/compile.js` translates an
   Arduino-style C/C++ subset to JavaScript **generator functions**.
   Every user function becomes `function*`. Calls to user functions
   become `yield*`. Blocking built-ins (`delay`, `delayMicroseconds`,
   `pulseIn`, `Serial` when the TX buffer is full) `yield` a sleep.
   Each loop back-edge yields a tick that costs simulated time (about 1
   µs on AVR, 0.2 µs on ESP32), so a busy loop such as
   `while(digitalRead(2));` advances time and cannot hang. The runtime
   steps the generator synchronously inside `mcu.run(t, io)`. Works in
   node and in the sim worker; no SharedArrayBuffer needed (GitHub Pages
   has no cross-origin isolation).
   - Language subset: `void int long unsigned byte bool boolean float
     double char uint8_t int16_t uint16_t int32_t uint32_t String`
     (basic), `const`, `static`, `volatile`, `#define` constants and
     simple macros, `#include` of the supported libraries (others are an
     error with a clear message), 1-D and 2-D arrays with initialisers,
     functions, `if/else for while do switch break continue return`,
     ternary, bit operators, casts. Integer semantics: `/` truncates for
     integer types; assignment wraps to the declared width (int is 16
     bits on 328 boards, 32 on ESP32). No pointers, classes or templates
     (error message says so).
   - API: `pinMode digitalWrite digitalRead analogRead analogWrite
     millis micros delay delayMicroseconds tone noTone pulseIn shiftOut
     shiftIn map constrain min max abs random randomSeed
     attachInterrupt detachInterrupt digitalPinToInterrupt bitRead
     bitWrite bitSet bitClear`, constants `HIGH LOW INPUT OUTPUT
     INPUT_PULLUP LED_BUILTIN A0..A7 RISING FALLING CHANGE`, `Serial`
     (`begin print println write available read parseInt`),
     `LiquidCrystal` (drives the real pins; the `hd44780` element decodes
     them), `Servo`. ESP32 adds `ledcAttach`/`ledcWrite` as aliases of
     PWM.
   - Cost model: digitalWrite 4 µs (AVR), analogRead 112 µs, Serial TX
     at the set baud (10 bits per byte) once the 64-byte buffer is full.
2. **Secondary (after the sketch path passes its tests): avr8js HEX
   runner.** MCU+UI vendors `avr8js@0.21.1` (MIT) to
   `stella-nova/vendor/avr8js@0.21.1/` with its LICENSE, and writes
   `mcu/avr.js` that implements the same `createMcu` interface for
   `{lang:'hex'}` on the 328 boards (ports B/C/D, timers 0/1/2 PWM,
   USART, ADC). A user can load a `.hex` built elsewhere (for example
   the Arduino IDE's "Export compiled binary"). No example depends on
   it. If it is not done, the FILE panel hides the HEX option.

---

## 7. Test plan (node only)

Each role has its own test file, run as `node <file>`, exit 1 on any
failure, and prints one line per check with the measured value.

### SIM — `sim/tests.mjs`

Numeric checks against analytic results:

- Divider: 9 V, 1 kΩ over 2 kΩ → 6.000 V (abs error < 1e-6).
- Current source 1 mA into 4.7 kΩ ‖ 4.7 kΩ → 2.35 V.
- Diode: 5 V, 1 kΩ, 1N4148 (`is = 2.52e-9`, `n = 1.752`): compare with
  the Lambert-W solution, error < 1e-4 V.
- LED red, 220 Ω, 5 V: current within 2 % of the solve of its own
  model; brightness vis ≈ I / 20 mA.
- RC charge (10 kΩ, 100 µF, 5 V): v(τ) = 3.1606 V within 0.5 %, v(5τ)
  within 0.1 %, with both `trap` and `be`.
- RL: i(t) = V/R·(1 − e^(−tR/L)) within 0.5 % at t = L/R.
- LC tank (1 mH, 1 µF): frequency within 0.5 % of 1/(2π√LC); amplitude
  after 10 periods within 1 % (trapezoid).
- Series RLC step, underdamped: peak time and overshoot within 2 %.
- NPN common emitter: in the active region Ic/Ib within 2 % of the model
  β (with the Early effect); in saturation Vce < 0.2 V.
- NMOS saturation: Id within 1 % of k/2·(Vgs − Vth)²(1 + λVds).
- Op-amp non-inverting, gain 11: within 0.5 %; output clips inside the
  model rails; GBW gives −3 dB within 10 % of 1 MHz / 11.
- 555 astable (R1 1 kΩ, R2 10 kΩ, C 10 µF): f within 5 % of
  1.44/((R1 + 2R2)C), duty within 3 %.
- Zener 5.1 V: output within 3 % for loads 1–10 mA.
- 7805: 5.00 ± 0.05 V for Vin 7–20 V; dropout below 7 V.
- Battery: terminal V = E − I·Rint within 0.1 %.
- Motor: steady state ω = (V − I·R)/ke within 1 %.
- Logic: full truth tables for 74HC00/02/04/08/32/86; 74HC74 toggles;
  74HC595 shifts and latches a byte; CD4017 counts 0–9 and resets.
- hd44780: a 4-bit init sequence and "HI" written by pin edges shows
  `rows[0]` starting with "HI".
- Damage: LED with no resistor on 9 V → `damage` event within 0.5 s sim;
  a 1/4 W resistor at 1 W → burnt; reversed electrolytic → vented; fuse
  blows at 2× rating; bench supply short → `cc`, no damage.
- Netlist (with the real `parts/geometry.js` when present, else a stub
  written in the test from section 3.2): 830 rails continuous, a–e one
  strip, split rails split; a resistor with both pins in one column is
  `shorted-part`; an ESP32 that spans two boards connects both rows.
- MCU co-sim with a stub MCU that toggles a pin every 0.5 s: the LED
  current toggles at 0.5 s ± 1 µs.
- Speed: a 200-node 555 circuit runs ≥ 1× real time; print the ratio.

### PARTS — `parts/tests.mjs`

- Every built-in def passes `reg.validate`; ids unique; every
  `electrical` template uses only types and terminals of 3.7; every
  pin name in a template exists.
- Hole counts 830 / 400 / 170; hole positions match 3.2 at a1, e1, f1,
  j63, TP1, BN50; strips per 3.2.
- `resolvePins`: a DIP placed with pin 1 at `f10` puts pin N/2+1 at
  `e(10 + N/2 − 1)`; a pin off a hole gives null.
- Resistor bands: 220 → red red brown gold; 4.7 k → yellow violet red
  gold; 1 M → brown black green gold; 10 → brown black black gold.
- Every built-in builds with three r160 in node; triangle counts within
  budget; pin locals within 0.01 mm of the def grid; `setState`,
  `setDamage` and `dispose` run without throwing on an undefined frame.
- Material presets validate and build; `makeMaterial` caches.
- `wirePath` ends at both points exactly; arch height per 3.10.

### SCENE — `view/tests.mjs`

- `applyOp` inverse property: 500 random op sequences on a sample
  document; undoing all of them restores a deep-equal document;
  `topology` flags as in 4.1.
- Store merge: 20 scrub ops with one merge key within 600 ms → one undo.
- `normalizeDoc` on broken input (dangling wire ends, unknown defs,
  duplicate ids) returns warnings and a valid document.
- Snap: a drag ending 1.5 mm from a hole snaps pin 1 to it; a part over
  the edge of a board shows red pins (pure function).
- Picking math: a ray from a stub camera through a known hole returns
  that hole id.
- The bus delivers in order and `off` works.
- `view/scene.js` imports in node with an injected THREE (no DOM
  access at import).

### MCU+UI — `ui/tests.mjs` and `mcu/tests.mjs`

- `compileSketch` compiles every sketch in the examples and the
  feature set of 6 (one test per feature); errors carry line numbers;
  unsupported features give the stated messages.
- Runtime with a fake `io`: blink toggles D13 every 500 ms of sim time
  exactly; `millis` advances; `while(digitalRead(2));` advances time;
  `attachInterrupt` fires on edges; `analogRead` maps 2.5 V to 512 on a 328
  board (5 V ref, 10 bits) and to 3103 on ESP32 (3.3 V ref, 12 bits); `analogWrite(9,128)`
  gives duty 128/255; `Serial.println(42)` emits "42\r\n"; int wraps at
  32767 + 1 on 328.
- LiquidCrystal drives a pin-edge sequence that the test decodes to
  "HELLO".
- Format: SI formatting (0.0136 → "13.6 mA", 4700 → "4.70 kΩ"); DMM
  autorange; scope trigger finds rising edges at the level; logic UART
  decode of a 9600-baud byte.
- Share: encode/decode round trip of every example document;
  `localStorage` that throws does not break save.
- Legacy import: a fixture made from the old bench seed (5 boards, 18
  parts) imports with every board, the mapped parts and wires, and a
  warning list.
- avr8js (if done): a hand-assembled 20-byte AVR program (written as
  bytes in the test) toggles PB5; the runtime reports the edges.

### INTEGRATE — `tests.mjs`

- `node --check` on every `.js` file in the page; import of every
  module that must import in node.
- Head order in `index.html`: `gpu-guard.js`, `wishlist.js`,
  `stats-beacon.js`; the importmap; `[hidden]{display:none!important}`
  in `style.css`; no element with `hidden` and a CSS display rule that
  shows it.
- Every example: `normalizeDoc` with no warnings, `buildNetlist` with no
  errors, `runFor` for its check times, every `meta.checks` passes.
- `node tools/nav-sync.js --check` exit 0; `node
  tools/wishlist-check.mjs`; `node stella-nova/pages/home/tests.mjs`;
  `node tools/thumbs-list.mjs --check`.

---

## 8. Visual design

Reference: `lib/forge-ui.css` and `lib/forge-ui.js` (the Forge palette,
the `.sq` squircle plate, `unfold()`), as used by `pages/sdf-lab` and
`pages/biome-parts`.

- **Palette.** Use the forge `:root` tokens (`--bg #19191c`, `--panel
  #111113`, `--well #08080a`, `--btn #1d1d21`, `--txt #e2e3e9`, `--dim
  #9496a1`, `--acc #6b9fe2`). Add electronics tokens in `style.css`:
  `--copper #c98a4b`, `--tin #c9ccd1`, `--gold #d6b04a`, `--ok #63c24c`,
  `--warn #f2b33d`, `--bad #e2474e`, `--volt #ff7a1a` (net voltage
  readouts), `--amp #4fc3e8`. Wire colours: `#d63b3b #2b2b2b #2f80d6
  #4e9a2e #e0c126 #7a6fd8 #e2704a #edede6`. Mat in 3D: `#2f4a46` with a
  `#36544f` grid.
- **Type.** Inter (`vendor/fonts/inter.adf13477.css`) for the UI, the
  system mono stack (`ui-monospace, "SF Mono", Menlo, Consolas`) for
  numbers and code. No Playfair, Cormorant or JetBrains Mono. Instrument
  digits are drawn segments on canvas, not a font.
- **Squircle panels.** Every panel, button, chip, well and toast is a
  `.sq` plate (`corner-shape: squircle`, else the 9-slice mask, else a
  radius): panels `--sq-r: 14px`, buttons and chips 9 px, wells 7 px,
  instrument faces 18 px. Fill `--sq-fill: rgba(12,12,15,.94)`. Shadow
  `filter: drop-shadow(0 8px 24px rgba(0,0,0,.45))`. Header 32 px with a
  10 px letter-spaced title, body padding 12 px, 8 px gaps.
- **Motion.** Panels unfold out of the button that opened them and close
  back into it (`unfold`, 360 ms open, 220 ms close, `--ease-out`), no
  clicks during motion. Lists reorder with `measure`/`flip`. Buttons
  press to scale 0.96 in 120 ms. Toasts unfold from the status bar. The
  instrument faces breathe a 1 px glow on their screens while running.
  The squircle radius animates on hover from 9 to 11 px where
  `corner-shape` exists. `prefers-reduced-motion` sets every duration to
  0.
- **Desktop layout.** `#bar` on top; LIBRARY in `#leftCol`; INSPECT,
  CHECKS, MATERIALS, CODE in `#rightCol` (panels that follow the
  selection open themselves, as in the SDF lab); instruments in
  `#instrDock` along the bottom, each its own squircle; `#status` at the
  very bottom. The 3D stage fills the rest. The view frames the bench in
  the gap between the columns.
- **Phone layout** (`max-width: 768px`, or short landscape coarse
  pointer): `#dock` at the base with LIB, INSPECT, run/pause, INSTR and
  TOOLS; one `#sheet` bottom sheet with tabs (half and full height, drag
  down to close); in landscape the sheet is a drawer at the right edge.
  16 px side gutters, no horizontal scroll, tap targets ≥ 44 px. Place by
  tap: pick a part, tap a hole. Wire by tap-tap. Long press opens the
  context menu.

---

## 9. Registration and finish (INTEGRATE)

- Nav: Science › Light & Fields, new group **"Electronics"** after
  "Electromagnetism" (no current group fits a circuit bench; the
  constellation already holds smith-chart and antenna-fields). Row:
  `["breadboard-lab", "Breadboard Lab", "NEW"]`. Then `node
  tools/nav-sync.js` and `node tools/nav-sync.js --check`.
- Blurb in `pages/home/sectors.js` BLURBS.
- Thumbnail: typographic, no browser (as for retro-shelf: a PIL script
  in the session scratchpad, not committed), 640 × 400 JPEG q84, then
  `node tools/thumbs-list.mjs` and `node tools/thumbs-small.mjs`.
- Saver: `window.snSaver = { enter(opts), exit() }`; loads
  `chaser-4017` or `uno-595`, runs it, orbits; frames the subject in
  `plateBand(h)` from `lib/saver-clear.js`; seeded shots every 5–12 s.
  One line in `lib/screensaver-catalog.js` (tier 3, `hook: true`).
- NOTICE: three.js (MIT), avr8js (MIT, if vendored), Inter (OFL), and
  the statement that every model and the simulator are original.

---

## Requests

(Roles write requests in their reports. The contract agent folds
accepted ones in here.)
