#!/usr/bin/env python3
"""Render tests/reference/scenes.py with NATIVE manim 0.22.0 (pycairo, Pango).

Run with a CPython that has `pip install manim==0.22.0` (no LaTeX needed):
    <venv>/bin/python tools/reference-native.py
Writes tests/reference/native/<Scene>-<frame>.png for the frames in FRAMES.
The frames come from SceneFileWriter.write_frame with format "none", the
same hook that manim-live uses, so both sides see the same frame indices.
"""
import importlib.util
import os
import sys

import manimpango
from PIL import Image

PAGE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
REF = os.path.join(PAGE, "tests", "reference")
OUT = os.path.join(REF, "native")
os.makedirs(OUT, exist_ok=True)
for f in ("DejaVuSans.ttf", "DejaVuSans-Bold.ttf", "DejaVuSans-Oblique.ttf", "DejaVuSans-BoldOblique.ttf"):
    manimpango.register_font(os.path.join(PAGE, "fonts", f))

import manim
from manim import config, tempconfig
from manim.scene.scene_file_writer import SceneFileWriter

spec = importlib.util.spec_from_file_location("refscenes", os.path.join(REF, "scenes.py"))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

frames = {}
orig = SceneFileWriter.write_frame


def hook(self, pixels, *, repeat=1):
    frames["list"].extend([pixels.copy()] * repeat)
    return orig(self, pixels, repeat=repeat)


SceneFileWriter.write_frame = hook
print("manim", manim.__version__, manim.__file__)
for name, idxs in mod.FRAMES.items():
    frames["list"] = []
    with tempconfig({"quality": "low_quality", "format": "none", "disable_caching": True,
                     "progress_bar": "none", "verbosity": "WARNING", "media_dir": "/tmp/manim-ref-media"}):
        scene = getattr(mod, name)()
        scene.render()
        if not frames["list"]:
            frames["list"].append(scene.renderer.get_frame())
    for i in idxs:
        Image.fromarray(frames["list"][i], "RGBA").save(os.path.join(OUT, f"{name}-{i}.png"))
    print(name, len(frames["list"]), "frames, saved", idxs)
