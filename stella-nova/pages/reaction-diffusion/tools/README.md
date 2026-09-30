# Reaction–diffusion preset tools

`build_presets.py` makes `../presets.json` from the Ready pattern library
(GollyGang/ready, `Patterns/**/*.vti`) and the hand-written file
`presets_overrides.json`.

Ready is GPL-3.0 and this site is not. The script reads only facts from Ready:
the equations, the parameter values, the IC geometry, and the render ranges.
All descriptions, KaTeX equations, slider ranges, and speeds are our own text in
`presets_overrides.json`. Each preset credits "Ready (GollyGang)" and the paper.

## Run

    git clone https://github.com/GollyGang/ready /tmp/ready   # tested at 7814c952
    READY_DIR=/tmp/ready python3 build_presets.py            # writes ../presets.json
    READY_DIR=/tmp/ready python3 build_presets.py --report   # also: survey table and drop list
    READY_DIR=/tmp/ready python3 build_presets.py --only gs-coral   # one preset to stdout

The script stops with exit code 1 if a preset fails to build.

## What the script does

1. It parses the `<RD>` block of the `.vti` file with `xml.etree`. It ignores
   the compressed image data.
2. It translates the OpenCL-C formula to a WGSL body for `shadergen.js`:
   - `float4 x = ...` becomes `let x = ...`, or `var x = ...` if the body
     assigns `x` again. `(float4)` casts go away.
   - `1.0f` becomes `1.0`. An integer literal becomes a float literal (`2` to `2.0`).
   - `fabs` becomes `abs`. `fmod(x, y)` becomes `x % y` (same rounding as C).
   - `pow(x, n)` with a literal n from 2 to 5 becomes a product, because WGSL
     `pow` of a negative base is NaN. Other `pow` calls stay.
   - `step(e, x)` becomes `select(0.0, 1.0, x >= e)`, because the shadergen
     entry point `step` hides the builtin.
   - `atan2(y, x)` gets a guard that gives 0 at (0, 0), as OpenCL does.
   - Ready stencils that shadergen does not supply become `let` lines built from
     `rd_ld(rd_x + i, rd_y + j)`: `bilaplacian` (Ready's 5x5 isotropic stencil,
     renamed `rd_bilaplacian_*` so it does not use the 13-point one in shadergen),
     `x_deriv2/3`, `y_deriv2/3`, `gaussian`, and `sobelN/S/E/W/NE/NW/SE/SW`.
   - Neighbor names such as `a_n`, `a_ne`, `a_e2` become `rd_ld(...)` loads.
     Ready's "n" is +y, that is the next row down in our grid.
   - A line of the form `float4 k = k1 + (k2-k1)*x_pos;` becomes a `paramMap`
     entry. The preset then has a plain param `k`, and shadergen maps it.
   - A param that the body never reads is dropped.
3. It translates the `<initial_pattern_generator>` overlays to the init ops
   below. Each shape of an overlay gives one op, as in Ready.
4. It applies the entry in `presets_overrides.json` and writes the preset.

`neighborhood` is always `"vertex"`. Ready formula rules ignore
`neighborhood_type` and always use the 9-point Laplacian ("medium" accuracy),
which is the shadergen `vertex` stencil.

## Init ops (the engine implements these in shadergen.js buildInitState)

Coordinates are in [0, 1]: x = (column + 0.5) / width, y = (row + 0.5) / height.
Ready's y maps to our row index, so a pattern shows upside down compared with
Ready. A circle radius and a Gaussian sigma are fractions of the grid width.

| op | keys | value |
|---|---|---|
| `fill` | `chem, value, region?` | constant |
| `set` | `chem, value, region` | constant in a region |
| `add` | `chem, value, region?` | old + value |
| `noise` | `chem, low, high, region?` | uniform random in [low, high) |
| `gauss` | `chem, amplitude, center:[x,y], sigma, region?` | Gaussian bump |
| `sine` | `chem, amplitude, kx, ky, phase?, offset?, region?` | offset + amplitude sin(2π(kx x + ky y) + phase) |
| `linear` | `chem, x0, y0, x1, y1, v0, v1, region?` | v0 + (v1 − v0) u, u = projection on the axis / axis length |
| `copy` | `chem, from, scale?, offset?, region?` | offset + scale × (chemical `from`) |

Every op takes `"mode": "set"` (default), `"add"` or `"mul"`, which combines the
value with the old cell value. Regions: `{"rect": [x0, y0, x1, y1]}` (half-open)
or `{"circle": [cx, cy, r]}`. No region means every cell.

Ready fill to op: `constant` and `parameter` to `fill`/`set`/`add`, or `mode:"mul"`
for multiply and divide; `white_noise` to `noise`; `gaussian` to `gauss`; `sine`
to `sine` (kx, ky, phase are solved from Ready's two points); `linear_gradient`
to `linear`; `other_chemical` to `copy`. `perlin_noise` and `radial_gradient`
have no op: those presets use a hand-written `init` or are dropped.

## presets_overrides.json

`families` holds defaults per family: `citation`, `equations`, `names`, `render`,
`speed`. Each item of `presets` has these keys:

| key | meaning |
|---|---|
| `id`, `name`, `family`, `description` | required. The description is our own words. |
| `source` | the `.vti` path under `Patterns/` |
| `citation`, `equations`, `names` | override the family values |
| `set` | `{param: value}` for a variant of the Ready pattern |
| `rename` | `{old: new}` for a name that WGSL does not allow (for example `lambda`) |
| `formula` | a full WGSL body (string or list of lines) instead of the translation |
| `formula_replace` | `[[from, to], ...]` text edits on the Ready formula before translation |
| `init` / `init_append` | replace or extend the translated init list |
| `size`, `embed` | grid size. With `embed`, the Ready grid keeps its cell size in the centre; without it, the IC scales to the new grid. |
| `params` | `{name: {min, max, step, label, hide}}` slider overrides |
| `render` | `{chem, low, high, colormap, height}` |
| `speed` | steps per frame at 60 fps |
| `timestep`, `dx`, `wrap`, `chemicals`, `notes` | direct overrides |

`dropped` maps a Ready file to the reason it is not in the catalog. The
`--report` flag prints every file that is not used, with its reason.

## Validation

Each run of the catalog must pass these checks:

1. Build every preset with `buildStepShader(preset, {paramMap: preset.paramMap})`
   from `../shadergen.js` and validate it with `~/.cargo/bin/naga file.wgsl`.
2. Run every preset in a Deno WebGPU harness with the real shader for at least
   5000 steps (and speed × 900 steps, about 15 s at 60 fps). Every value must
   stay finite. The fields must not be uniform at 2000 steps.
3. Render the end state with the render hints and look at a contact sheet.
