"""tools/biome-parts/make_ref.py: PyTorch reference data for the biome-parts page.

Reads the Biome-S1 source (a clone of github.com/shhivv/biome-s1, MIT) as a
library, never runs its scripts, and writes into
stella-nova/pages/biome-parts/test-data/:

  ref.json     for each state in states.json (make-fixtures.mjs): the tokens,
               the action rows, the logits and the done logits from the
               PyTorch Taiga-S1 (release/hf), via the repo's own featurizer
  vocab.json   the vocabularies, in embedding-row order
  eval.json    the repo's eval goal streams (evaluate.py SUITES, seeds
               TEST_SEED_BASE + level * 100000 + split offset + i) with the
               start spec of each episode, 100 per suite
  weights.json sha256 and size of the vendored weights

Run with an isolated interpreter (no site dir, no cwd on the path):

  python3 -I tools/biome-parts/make_ref.py <biome-s1 clone> <page dir>

Feasibility: episode.sample_feasible_goal asks FreeCAD to build each goal
and resamples (same rng) when the build fails. FreeCAD is not here; FEASIBLE
below rejects the one family known to fail (a vertical-edge fillet after a
cylinder, whose seam edge cannot be filleted). The streams match the repo's
exactly only where that rule matches FreeCAD.
"""

import hashlib
import json
import random
import sys
from pathlib import Path

repo, page = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
sys.path.insert(0, str(repo))

import torch  # noqa: E402

from freecad_s1 import actions as A  # noqa: E402
from freecad_s1 import schema as SC  # noqa: E402
from freecad_s1.goals import sample_split_goal, sample_start  # noqa: E402
from freecad_s1.model.featurize import collate, make_example  # noqa: E402
from freecad_s1.model.net import from_pretrained  # noqa: E402

out_dir = page / "test-data"
weights = repo / "release" / "hf" / "model.safetensors"
blob = weights.read_bytes()
(out_dir / "weights.json").write_text(json.dumps({"sha256": hashlib.sha256(blob).hexdigest(), "bytes": len(blob)}, indent=1))

(out_dir / "vocab.json").write_text(json.dumps({
    "ACTION_IDS": A.ACTION_IDS, "CATEGORIES": A.CATEGORIES, "SCOPES": A.SCOPES, "WORD_VOCAB": A.WORD_VOCAB,
    "NODE_TYPES": SC.NODE_TYPES, "WORKBENCHES": SC.WORKBENCHES, "GOAL_KINDS": SC.GOAL_KINDS,
    "NODE_NUM_KEYS": SC.NODE_NUM_KEYS, "GOAL_PARAM_KEYS": SC.GOAL_PARAM_KEYS,
    "words": {a: A.action_words(a) for a in A.CATALOGUE}, "vectors": {a: A.action_vector(a) for a in A.CATALOGUE},
}))

torch.manual_seed(0)
model = from_pretrained(repo / "release" / "hf", device="cpu")
opts = model.cfg.feature_opts()
states = json.loads((out_dir / "states.json").read_text())
ref = []
with torch.no_grad():
    for rec in states:
        st = SC.State.from_json(rec["state"])
        goal = SC.Goal.from_json(rec["goal"])
        ex = make_example(st, goal, rec["actions"], **opts)
        batch = collate([ex])
        logits, _value, ptr = model(batch, return_aux=True)
        goal_slots = (batch["seg"][0] == 6).nonzero().flatten().tolist()
        ref.append({
            "seg": ex.tokens.seg.tolist(), "a": ex.tokens.a.tolist(), "b": ex.tokens.b.tolist(), "pos": ex.tokens.pos.tolist(),
            "ord": ex.tokens.ord.tolist(), "num": ex.tokens.num.astype("float32").tolist(),
            "act_id": ex.actions["id"].tolist(), "act_cat": ex.actions["cat"].tolist(), "act_scope": ex.actions["scope"].tolist(),
            "act_words": ex.actions["words"].tolist(), "act_vec": ex.actions["vec"].tolist(),
            "logits": logits[0, : len(rec["actions"])].tolist(), "done": [float(ptr[0, s]) for s in goal_slots],
        })
(out_dir / "ref.json").write_text(json.dumps(ref))

TEST_SEED_BASE = 1_000_000
OFFSET = {"iid": 0, "comp": 10_000, "comp2": 20_000, "comp3": 30_000, "len": 0}
SUITES = {"iid-L1": (1, "iid"), "iid-L2": (2, "iid"), "iid-L3": (3, "iid"), "comp-L3": (3, "comp"), "comp2-L3": (3, "comp2"),
          "comp3-L3": (3, "comp3"), "len-L4": (4, "len"), "len2-L5": (5, "len"), "len3-L6": (6, "len")}


def feasible(goal):
    kinds = [f.kind for f in goal.features]
    if "fillet_vertical" in kinds:
        i = kinds.index("fillet_vertical")
        return not any(k in ("hole", "hole_std", "boss_cyl") for k in kinds[:i])
    return True


ev = {}
for name, (level, split) in SUITES.items():
    base = TEST_SEED_BASE + level * 100_000 + OFFSET[split]
    eps = []
    for i in range(100):
        rng = random.Random(base + i)
        for _ in range(20):
            goal = sample_split_goal(split, level, rng)
            if feasible(goal):
                break
        start = sample_start(rng, level)
        eps.append({"seed": base + i, "goal": {"features": [{"kind": f.kind, "params": f.params} for f in goal.features],
                                               "level": goal.level, "scale": goal.scale},
                    "start": {"doc_open": start.doc_open, "workbench": start.workbench, "body": start.body}})
    ev[name] = eps
(out_dir / "eval.json").write_text(json.dumps(ev))
print("ref", len(ref), "suites", {k: len(v) for k, v in ev.items()})
