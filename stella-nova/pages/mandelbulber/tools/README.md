# Mandelbulber generator tools

These tools read a Mandelbulber2 checkout and write everything under `../gen/`.
The page reads only `gen/` at run time. The upstream checkout is never copied
into the repo.

Upstream: https://github.com/buddhi1980/mandelbulber2, commit `600da8d`.
The generated files port upstream code, which is GPL-3.0-or-later,
(C) Mandelbulber Team. See `../COPYING`.

## Regenerate

    node tools/gen.mjs <path to mandelbulber2 checkout>

Run the command from the page folder. Options:

- `--only a,b` translates and validates only the named formulas (snake_case
  file stems). The other entries in `gen/formulas/index.json` stay.
- `--jobs N` sets how many naga processes run at the same time.
- `--no-catalog` skips `tools/catalog.mjs`.

`gen.mjs` needs `~/.cargo/bin/naga` (or set `NAGA=<path>`). The bare `naga`
on the PATH is a different program.

## What each tool writes

| Tool | Output |
| --- | --- |
| `translate.mjs` | the OpenCL C to WGSL translator (library, no CLI) |
| `gen.mjs` | `gen/struct.wgsl`, `gen/aux.wgsl`, `gen/helpers.wgsl`, `gen/layout.json`, `gen/formulas/*.wgsl`, `gen/formulas/index.json`; then calls `catalog.mjs` |
| `catalog.mjs` | `gen/catalog.json`, `gen/params.json`, `gen/examples.json`, `gen/collections.json`, `gen/CREDITS-examples.md`, formula thumbnails |
| `originals.mjs` | `gen/originals.json`, the site original presets |
| `preset-thumbs.mjs` | `gen/preset-thumbs.jpg`, `gen/preset-thumbs.json`, a render check report |

- `struct.wgsl`: `struct Fractal` from `sFractalCl` in `opencl/fractal_cl.h`,
  all nested structs, and the enum constants. The field names and the nesting
  are the upstream ones. `matrix33` is a struct of three rows `m1 m2 m3`
  (`vec3f`), as in `opencl_algebra.h`. A field whose name is a WGSL reserved
  word gets a trailing `_` (only `genFoldBox.type` becomes `type_`).
- `aux.wgsl`: `struct Aux` from `sExtendedAuxCl`.
- `helpers.wgsl`: C-semantics shims (`c_fmod_<T>`, `c_round_<T>`,
  `c_pow_<T>`, `c_copysign_<T>`, and so on) and the `opencl_algebra.h`
  functions, translated by the same translator.
- `layout.json`: the WGSL storage layout of `struct Fractal`. There is one
  entry per scalar or vector leaf, keyed by the C dotted path, for example
  `mandelbox.rot[1][2].m3` or `IFS.enabled[4]`. `wgslName` marks a renamed
  field.
- `formulas/<snake>.wgsl`: one function per formula,
  `fn F_<snake>(z: vec4f, fi: u32, aux: ptr<function, Aux>) -> vec4f`.
  Parameters read as `FR[fi].<path>`. The engine declares
  `@group(0) @binding(1) var<storage, read> FR: array<Fractal>;`.
- `formulas/index.json`: per formula `{ fn, deps, status, error? }`. The
  status is `ok`, `override`, or `fail`. `deps` lists other formula files that
  the formula calls. The engine must include them first.

## Validation

For each formula, `gen.mjs` joins `struct.wgsl + aux.wgsl + helpers.wgsl +
deps + formula + a stub entry point` and runs naga on it. A formula that fails
gets `status: "fail"` and the naga error in `index.json`. Its WGSL is not
written under `gen/`. It goes to `$TMPDIR/mandelbulber-gen-failed/` for
inspection.

## Overrides

`tools/overrides/<snake>.wgsl` is hand-written WGSL for one formula. When the
file exists, `gen.mjs` copies it to `gen/formulas/` in place of the
translation, validates it the same way, and records `status: "override"`.
The dependencies of an override are the `F_<name>(` calls in its text.

To write an override:

1. Run `node tools/gen.mjs <checkout> --only <snake>`.
2. Start from `$TMPDIR/mandelbulber-gen-failed/<snake>.wgsl`, or from the
   upstream `formula/opencl/<snake>.cl` if the translator stopped early.
3. Keep the function signature above and the file header (GPL notice,
   formula credit, `grep:` line). Say why the override exists.
4. Run `node tools/gen.mjs <checkout> --only <snake>` again and look for
   `override` in the summary.

## Translator notes

`translate.mjs` has a tokenizer, a C preprocessor (`#if`, `#ifdef`,
`#define`, with the single-precision OpenCL defines), a recursive-descent
parser for the C subset of the formulas, and an emitter with a type
environment. The emitter does these conversions:

- C implicit int/float conversions become explicit `f32()`/`i32()` casts.
  Integer literals in a float context become float literals.
- `fractal->a.b` becomes `FR[fi].a.b`. `aux->x` becomes `(*aux).x`.
  An int used as a condition becomes `!= 0`.
- `c ? a : b` becomes `select(b, a, c)` when both sides are free of side
  effects. The translator stops with an error in the other case.
- A multi-component swizzle assignment (`z.xyz = v`) becomes a full vector
  constructor.
- `switch` fallthrough copies the next case body. A `default` is added if
  the C code has none. `do/while` becomes `loop` with `break if`.
- `fmod`, `round`, `pow`, `copysign`, `cbrt` and `log10` call the shims, so
  they keep C semantics (for example `pow(-2, 3) = -8`).
- Pointer locals are supported only as aliases into a vector, for example
  `REAL *p = (REAL *)&v;` and `&p[0]`/`&p[1]` selected by a ternary.
- Locals whose names are WGSL keywords or builtins get a trailing `_`.

Unsupported constructs (for example a pointer to one of several storage
arrays, or `sizeof`) stop the translation with `translate: <reason>`. Those
formulas need an override.

## Presets

The page browser shows three preset sources, in this order:

1. `gen/examples.json`: the upstream main example folder (153 files).
2. `gen/collections.json`: the upstream example collection folders. Each folder
   name states the author and the licence, and no folder has a licence file.
   `catalog.mjs` uses a folder only when its licence has no NC or ND term
   (`LICENCE_OK`), because the site may be commercial. It leaves out a scene
   that turns on a feature the port does not render (`MISSING_FEATURES`), or
   that is in `tools/collections-drop.json` (a failed render check). The page
   shows the author and the licence on each collection group.
   `gen/CREDITS-examples.md` lists the authors, the licences, the left-out
   scenes and the excluded folders. `--no-collections` skips the step.
3. `gen/originals.json`: the site originals from `tools/originals.mjs`. Run
   `node tools/originals.mjs` after a change. An unknown param name stops it.

`preset-thumbs.mjs` renders every preset in headless Chrome and packs one
thumbnail per preset into `gen/preset-thumbs.jpg`. It needs a static server
for the site and Chrome with WebGPU and a CDP port:

    python3 -m http.server 47444 --bind 127.0.0.1        # from the site root
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
      --enable-unsafe-webgpu --use-angle=metal --remote-debugging-port=9444 \
      --user-data-dir=<scratch dir>
    node tools/preset-thumbs.mjs --url http://127.0.0.1:47444/stella-nova/pages/mandelbulber/index.html

The thumbnails and the checks stay in `--cache` (default
`$TMPDIR/mandelbulber-thumbs`), so a second run renders only changed presets.
The report marks a preset as failed for a compile error, a console error, a
timeout, a black frame or a flat frame. Put a failed collection scene in
`tools/collections-drop.json` and run `catalog.mjs` again.

