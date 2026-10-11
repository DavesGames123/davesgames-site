#!/usr/bin/env python3
"""Write py/wheels/LOCK.json from the wheels in py/wheels/.

Each wheel's sha256 is checked against the digest that PyPI publishes
(pinned below; source: https://pypi.org/pypi/<name>/<version>/json).
Run with any Python 3:  python3 tools/lock-wheels.py
"""
import hashlib
import json
import os
import sys

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "py", "wheels")
FH = "https://files.pythonhosted.org/packages/"
PINS = {
    # file: (name, version, PyPI sha256 or None, source URL, note)
    "manim-0.22.0-py3-none-any.whl": ("manim", "0.22.0", "bce56dbe420ce002cb77076c0b4e041637a0bd41ce5749e837e96375937e935f", FH + "2d/05/35fc67b65a8ecbe38de39b9747adabc18de696683e0e27b5e121ad6d05ae/manim-0.22.0-py3-none-any.whl", "PyPI wheel, unmodified"),
    "click-8.5.0-py3-none-any.whl": ("click", "8.5.0", "255bc9599cf7748b4b1a446ccc735421bd08a2ae529a8b88597d3de5664ee360", FH + "58/50/6c0d534c5f134586a8e1ba4e330569e32f057e33372ae556463212fb4cd3/click-8.5.0-py3-none-any.whl", "PyPI wheel, unmodified; cloup 4 needs click>=8.5, Pyodide ships 8.3.1"),
    "cloup-4.0.0-py3-none-any.whl": ("cloup", "4.0.0", "0678744a3a2753e1d78dd3ea5c6e4cbbc3b41561fd7a7a7d075dbc8dad74f74f", FH + "2c/34/20224fd9d52e8ce7e3b319b5d6b7126da25e89d00cd1a5692b4b46ed2d26/cloup-4.0.0-py3-none-any.whl", "PyPI wheel, unmodified"),
    "networkx-3.7-py3-none-any.whl": ("networkx", "3.7", "e3fd2c13a7814cee3746340d8d7f8598a67f16a58bf47fb7f8793fab6efca1b0", FH + "7e/cd/fe58041e9011f307c490e3e17dd48cc516448f7c698a3f2d9d9d65d7e6a8/networkx-3.7-py3-none-any.whl", "PyPI wheel, unmodified; the Pyodide build declares matplotlib as a dependency, this one does not"),
    "svgelements-1.9.6-py2.py3-none-any.whl": ("svgelements", "1.9.6", "8a5cf2cc066d98e713d5b875b1d6e5eeb9b92e855e835ebd7caab2713ae1dcad", FH + "48/2c/6c9bb53db56c8a12a736d2158a8b842a5993b96daabc29d90a098e840280/svgelements-1.9.6-py2.py3-none-any.whl", "PyPI wheel, unmodified"),
    "isosurfaces-0.1.2-py3-none-any.whl": ("isosurfaces", "0.1.2", "525a49ba93f4dbc35303cd2faf30976af0f99d9274cfa2787aec016b8ef96c64", FH + "b1/68/d5e9e6e0d6e43107d8393d2ee3d231dbb597bf93052c6f3117b313724980/isosurfaces-0.1.2-py3-none-any.whl", "PyPI wheel, unmodified"),
    "screeninfo-0.8.1-py3-none-any.whl": ("screeninfo", "0.8.1", "e97d6b173856edcfa3bd282f81deb528188aff14b11ec3e195584e7641be733c", FH + "6e/bf/c5205d480307bef660e56544b9e3d7ff687da776abb30c9cb3f330887570/screeninfo-0.8.1-py3-none-any.whl", "PyPI wheel, unmodified"),
    "watchdog-6.0.0-py3-none-manylinux2014_x86_64.whl": ("watchdog", "6.0.0", "20ffe5b202af80ab4266dcd3e91aae72bf2da48c0d33bdb15c66658e685e94e2", FH + "b5/e8/dbf020b4d98251a9860752a094d09a65e1b436ad181faf929983f697048f/watchdog-6.0.0-py3-none-manylinux2014_x86_64.whl", "PyPI wheel, unmodified; py3-none (pure Python) files, platform tag only"),
    "pydub-0.25.1-py2.py3-none-any.whl": ("pydub", "0.25.1", "65617e33033874b59d87db603aa1ed450633288aefead953b30bded59cb599a6", FH + "a6/53/d78dc063216e62fc55f6b2eebb447f6a4b0a59f55c8406376f76bf959b08/pydub-0.25.1-py2.py3-none-any.whl", "PyPI wheel, unmodified"),
    "srt-3.5.3-py3-none-any.whl": ("srt", "3.5.3", None, FH + "66/b7/4a1bc231e0681ebf339337b0cd05b91dc6a0d701fa852bb812e244b7a030/srt-3.5.3.tar.gz", "built with 'pip wheel --no-deps' from the PyPI sdist (sdist sha256 4884315043a4f0740fd1f878ed6caa376ac06d70e135f306a6dc44632eed0cc0); PyPI has no wheel"),
}

out = []
for f, (name, ver, pypi, url, note) in PINS.items():
    data = open(os.path.join(HERE, f), "rb").read()
    h = hashlib.sha256(data).hexdigest()
    if pypi and h != pypi:
        sys.exit(f"sha256 mismatch for {f}: {h} != PyPI {pypi}")
    out.append({"file": f, "name": name, "version": ver, "sha256": h, "pypiSha256": pypi, "source": url, "note": note})
extra = sorted(set(x for x in os.listdir(HERE) if x.endswith(".whl")) - set(PINS))
if extra:
    sys.exit(f"wheels without a pin: {extra}")
doc = {
    "comment": "Wheels unpacked into Pyodide site-packages by engine-core.js after a sha256 check. pypiSha256 is the digest PyPI publishes for that file.",
    "wheels": out,
}
with open(os.path.join(HERE, "LOCK.json"), "w") as fh:
    json.dump(doc, fh, indent=1)
    fh.write("\n")
print(f"LOCK.json: {len(out)} wheels, all PyPI digests match")
