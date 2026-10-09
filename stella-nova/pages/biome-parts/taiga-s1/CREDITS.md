# Taiga-S1 weights (vendored)

These three files are copied unchanged from Biome-S1:

| File | Source path | Notes |
|---|---|---|
| `model.safetensors` | `release/hf/model.safetensors` | F32, 4,924,516 bytes, 1,228,163 parameters |
| `config.json` | `release/hf/config.json` | model config, version 0.3.0, calibrated temperature 2.554 |
| `LICENSE` | `release/hf/LICENSE` | MIT License, Copyright (c) 2026 Shiv Shanmugam |

- Author: Shiv Shanmugam (https://github.com/shhivv)
- Code: https://github.com/shhivv/biome-s1
- Model card: https://huggingface.co/shhivv/taiga-s1
- Commit: 84fdd19c487658a59805531fa306fa40e8f72555 (2026-10-08, "OK memory: a recent OK says whether every field was on target when pressed"), the repo head when copied
- Licence: MIT. The repo's root `LICENSE` and `release/hf/LICENSE` hold the same MIT text; the model card front matter says `license: mit`.
- sha256 of `model.safetensors`: 7ad63f77399eaddd3aebae0d0cf493340885d741a9fe51c1e4737f7273a1408c

## How they were copied

```bash
git clone --depth 1 https://github.com/shhivv/biome-s1 <scratch>/biome
cp <scratch>/biome/release/hf/{model.safetensors,config.json,LICENSE} stella-nova/pages/biome-parts/taiga-s1/
shasum -a 256 stella-nova/pages/biome-parts/taiga-s1/model.safetensors
```

No conversion: `js/model.js` reads the safetensors header and the F32 data directly.

## Reference data

`tools/biome-parts/make_ref.py` reads the clone as a library (run with
`python3 -I`, never the repo's own scripts) and writes `test-data/`: the
vocabularies, PyTorch logits for 60 recorded states, and the eval goal
streams. `tests.mjs` checks the JavaScript port against them.

```bash
node tools/biome-parts/make-fixtures.mjs
python3 -I tools/biome-parts/make_ref.py <scratch>/biome stella-nova/pages/biome-parts
node tools/biome-parts/eval.mjs [--perturb 0.2]
```
