"""Font registry, shaping and glyph outlines for the manimpango shim.

The page bundles the DejaVu families (fonts/, licence in
fonts/LICENSE-DejaVu.txt). register_font() adds any TTF/OTF file in the
Pyodide file system. Shaping does what HarfBuzz does for simple Latin text:
cmap lookup, the GSUB 'liga'/'rlig' ligatures, and GPOS 'kern' pair
adjustments (or the legacy 'kern' table). It does not do complex scripts,
mark positioning or font fallback.
"""

from __future__ import annotations

import io
import os
from dataclasses import dataclass, field

from fontTools.pens.basePen import BasePen
from fontTools.ttLib import TTFont

FONT_DIR_FS = "/tmp/manimlive-fonts"

# family -> {(bold, italic): file name in the page fonts/ folder}
BUNDLED = {
    "DejaVu Sans": {
        (False, False): "DejaVuSans.ttf",
        (True, False): "DejaVuSans-Bold.ttf",
        (False, True): "DejaVuSans-Oblique.ttf",
        (True, True): "DejaVuSans-BoldOblique.ttf",
    },
    "DejaVu Serif": {
        (False, False): "DejaVuSerif.ttf",
        (True, False): "DejaVuSerif-Bold.ttf",
        (False, True): "DejaVuSerif-Italic.ttf",
        (True, True): "DejaVuSerif-BoldItalic.ttf",
    },
    "DejaVu Sans Mono": {
        (False, False): "DejaVuSansMono.ttf",
        (True, False): "DejaVuSansMono-Bold.ttf",
        (False, True): "DejaVuSansMono-Oblique.ttf",
        (True, True): "DejaVuSansMono-BoldOblique.ttf",
    },
}

# Generic and common names -> a bundled family (fontconfig does the same job).
ALIASES = {
    "": "DejaVu Sans",
    "sans": "DejaVu Sans",
    "sans-serif": "DejaVu Sans",
    "sans serif": "DejaVu Sans",
    "arial": "DejaVu Sans",
    "helvetica": "DejaVu Sans",
    "helvetica neue": "DejaVu Sans",
    "verdana": "DejaVu Sans",
    "inter": "DejaVu Sans",
    "noto sans": "DejaVu Sans",
    "open sans": "DejaVu Sans",
    "roboto": "DejaVu Sans",
    "serif": "DejaVu Serif",
    "times": "DejaVu Serif",
    "times new roman": "DejaVu Serif",
    "georgia": "DejaVu Serif",
    "cmu serif": "DejaVu Serif",
    "stix two text": "DejaVu Serif",
    "monospace": "DejaVu Sans Mono",
    "mono": "DejaVu Sans Mono",
    "courier": "DejaVu Sans Mono",
    "courier new": "DejaVu Sans Mono",
    "consolas": "DejaVu Sans Mono",
    "menlo": "DejaVu Sans Mono",
    "monaco": "DejaVu Sans Mono",
    "source code pro": "DejaVu Sans Mono",
    "fira code": "DejaVu Sans Mono",
}

# Generic names that list_fonts() reports, so manim does not warn for them.
GENERIC_NAMES = ["sans", "sans-serif", "serif", "monospace", "Monospace"]

# family -> {(bold, italic): path in the Pyodide file system}
REGISTERED: dict[str, dict[tuple[bool, bool], str]] = {}
_warned: set[str] = set()


def _read_bundled(file_name: str) -> bytes:
    path = os.path.join(FONT_DIR_FS, file_name)
    if os.path.exists(path):
        with open(path, "rb") as f:
            return f.read()
    import manimlive_host  # registered by engine-core.js

    data = manimlive_host.read_bytes("fonts/" + file_name).to_bytes()
    os.makedirs(FONT_DIR_FS, exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)
    return data


def family_names() -> list[str]:
    return sorted(set(BUNDLED) | set(REGISTERED))


def resolve(family: str, weight: int, italic: bool) -> tuple[str, str, bool]:
    """Return (cache key, source, is_fs_path) for a family and style."""
    bold = weight >= 600
    for table in (REGISTERED, BUNDLED):
        for name, styles in table.items():
            if name.lower() == (family or "").lower():
                return _pick(name, styles, bold, italic, table is REGISTERED)
    alias = ALIASES.get((family or "").strip().lower())
    if alias is None:
        if family and family not in _warned:
            _warned.add(family)
            print(f"manim-live: font '{family}' is not available; DejaVu Sans is used instead")
        alias = "DejaVu Sans"
    return _pick(alias, BUNDLED[alias], bold, italic, False)


def _pick(name, styles, bold, italic, fs):
    for key in ((bold, italic), (bold, False), (False, italic), (False, False)):
        if key in styles:
            return (f"{name}|{key}", styles[key], fs)
    first = next(iter(styles.values()))
    return (f"{name}|any", first, fs)


def register(path: str) -> bool:
    font = TTFont(path, lazy=True)
    names = font["name"]
    family = (names.getDebugName(16) or names.getDebugName(1) or os.path.basename(path)).strip()
    os2 = font["OS/2"] if "OS/2" in font else None
    bold = bool(os2 and os2.usWeightClass >= 600)
    italic = bool(os2 and (os2.fsSelection & 1)) or "italic" in (names.getDebugName(2) or "").lower()
    REGISTERED.setdefault(family, {})[(bold, italic)] = path
    _FONTS.clear()
    return True


def unregister(path: str) -> bool:
    found = False
    for fam in list(REGISTERED):
        styles = REGISTERED[fam]
        for k in [k for k, v in styles.items() if v == path]:
            del styles[k]
            found = True
        if not styles:
            del REGISTERED[fam]
    _FONTS.clear()
    return found


class _SvgPathPen(BasePen):
    """Glyph outline -> SVG path data in pixels, y down, cubic curves only."""

    def __init__(self, glyphset, scale: float):
        super().__init__(glyphset)
        self.s = scale
        self.parts: list[str] = []

    def _fmt(self, x, y):
        # FreeType gives cairo the scaled outline in 1/256 px steps.
        s = self.s
        return f"{_num(round(x * s * 256.0) / 256.0)} {_num(round(-y * s * 256.0) / 256.0)}"

    def _moveTo(self, pt):
        self.parts.append("M " + self._fmt(*pt))

    def _lineTo(self, pt):
        self.parts.append("L " + self._fmt(*pt))

    def _curveToOne(self, p1, p2, p3):
        self.parts.append("C " + " ".join(self._fmt(*p) for p in (p1, p2, p3)))

    def _qCurveToOne(self, p1, p2):
        p0 = self._getCurrentPoint()
        c1 = (p0[0] + 2.0 / 3.0 * (p1[0] - p0[0]), p0[1] + 2.0 / 3.0 * (p1[1] - p0[1]))
        c2 = (p2[0] + 2.0 / 3.0 * (p1[0] - p2[0]), p2[1] + 2.0 / 3.0 * (p1[1] - p2[1]))
        self._curveToOne(c1, c2, p2)

    def _closePath(self):
        self.parts.append("Z")

    def _endPath(self):
        pass


def _num(v: float) -> str:
    """Format a number like cairo's _cairo_dtostr (SVG surface output)."""
    if abs(v) >= 0.1:
        s = f"{v:.6f}"
    else:
        digits = f"{abs(v):.18f}".split(".")[1]
        zeros = len(digits) - len(digits.lstrip("0"))
        s = f"{v:.{min(zeros + 6, 18)}f}" if zeros + 6 < 18 else f"{v:.18f}"
    s = s.rstrip("0").rstrip(".")
    return "0" if s in ("-0", "", "-") else s


@dataclass
class Font:
    key: str
    tt: TTFont
    upm: int
    cmap: dict
    glyph_order: list
    hmtx: object
    ascent: int
    descent: int  # positive
    liga: list = field(default_factory=list)  # [(first_gid -> [(components, lig)])] per lookup
    rlig: list = field(default_factory=list)
    kern_lookups: list = field(default_factory=list)
    legacy_kern: dict | None = None
    _gid: dict = field(default_factory=dict)
    _kern_cache: dict = field(default_factory=dict)
    _path_cache: dict = field(default_factory=dict)

    def gid(self, name: str) -> int:
        g = self._gid.get(name)
        if g is None:
            g = self.tt.getGlyphID(name)
            self._gid[name] = g
        return g

    def advance(self, gid: int) -> int:
        return self.hmtx[self.glyph_order[gid]][0]

    def glyph_for_char(self, ch: str) -> int:
        name = self.cmap.get(ord(ch))
        if name is None:
            return 0
        return self.gid(name)

    def path(self, gid: int, scale: float) -> str:
        key = (gid, round(scale, 9))
        d = self._path_cache.get(key)
        if d is None:
            gs = self.tt.getGlyphSet()
            pen = _SvgPathPen(gs, scale)
            gs[self.glyph_order[gid]].draw(pen)
            d = " ".join(pen.parts)
            self._path_cache[key] = d
        return d

    def kern(self, left: int, right: int) -> int:
        k = (left, right)
        v = self._kern_cache.get(k)
        if v is not None:
            return v
        v = 0
        names = self.glyph_order
        ln, rn = names[left], names[right]
        if self.kern_lookups:
            for subtables in self.kern_lookups:
                for st in subtables:
                    if ln not in st.Coverage.glyphs:
                        continue
                    if st.Format == 1:
                        idx = st.Coverage.glyphs.index(ln)
                        hit = None
                        for rec in st.PairSet[idx].PairValueRecord:
                            if rec.SecondGlyph == rn:
                                hit = rec
                                break
                        if hit is None:
                            continue
                        val = getattr(hit, "Value1", None)
                        v += getattr(val, "XAdvance", 0) or 0
                        break
                    if st.Format == 2:
                        c1 = st.ClassDef1.classDefs.get(ln, 0)
                        c2 = st.ClassDef2.classDefs.get(rn, 0)
                        rec = st.Class1Record[c1].Class2Record[c2]
                        val = getattr(rec, "Value1", None)
                        v += getattr(val, "XAdvance", 0) or 0
                        break
        elif self.legacy_kern:
            v = self.legacy_kern.get((ln, rn), 0)
        self._kern_cache[k] = v
        return v

    def apply_ligatures(self, gids: list[int], use_liga: bool) -> list[int]:
        tables = (self.rlig + self.liga) if use_liga else self.rlig
        if not tables:
            return gids
        names = self.glyph_order
        for ligmap in tables:
            out: list[int] = []
            i = 0
            while i < len(gids):
                first = names[gids[i]]
                done = False
                for comps, lig in ligmap.get(first, ()):
                    n = len(comps)
                    if i + n < len(gids) and all(names[gids[i + 1 + j]] == comps[j] for j in range(n)):
                        out.append(self.gid(lig))
                        i += n + 1
                        done = True
                        break
                if not done:
                    out.append(gids[i])
                    i += 1
            gids = out
        return gids


_FONTS: dict[str, Font] = {}


def _lookups_for(table, tags: tuple[str, ...]) -> list[int]:
    if table is None or table.ScriptList is None or table.FeatureList is None:
        return []
    recs = {sr.ScriptTag: sr.Script for sr in table.ScriptList.ScriptRecord}
    script = recs.get("latn") or recs.get("DFLT")
    if script is None or script.DefaultLangSys is None:
        return []
    out: set[int] = set()
    for fi in script.DefaultLangSys.FeatureIndex:
        fr = table.FeatureList.FeatureRecord[fi]
        if fr.FeatureTag in tags:
            out.update(fr.Feature.LookupListIndex)
    return sorted(out)


def _subtables(lookup, want_type: int, ext_type: int):
    out = []
    for st in lookup.SubTable:
        t = lookup.LookupType
        if t == ext_type:
            t = st.ExtensionLookupType
            st = st.ExtSubTable
        if t == want_type:
            out.append(st)
    return out


def _lig_maps(tt: TTFont, tags):
    if "GSUB" not in tt:
        return []
    g = tt["GSUB"].table
    maps = []
    for li in _lookups_for(g, tags):
        m: dict[str, list] = {}
        for st in _subtables(g.LookupList.Lookup[li], 4, 7):
            for first, ligs in st.ligatures.items():
                for lig in ligs:
                    m.setdefault(first, []).append((tuple(lig.Component), lig.LigGlyph))
        if m:
            maps.append(m)
    return maps


def load(family: str, weight: int, italic: bool) -> Font:
    key, src, is_fs = resolve(family, weight, italic)
    f = _FONTS.get(key)
    if f is not None:
        return f
    data = open(src, "rb").read() if is_fs else _read_bundled(src)
    tt = TTFont(io.BytesIO(data))
    hhea = tt["hhea"]
    kern_lookups = []
    if "GPOS" in tt:
        gp = tt["GPOS"].table
        for li in _lookups_for(gp, ("kern",)):
            sts = _subtables(gp.LookupList.Lookup[li], 2, 9)
            if sts:
                kern_lookups.append(sts)
    legacy = None
    if not kern_lookups and "kern" in tt:
        legacy = {}
        for kt in tt["kern"].kernTables:
            legacy.update(getattr(kt, "kernTable", {}) or {})
    f = Font(
        key=key,
        tt=tt,
        upm=tt["head"].unitsPerEm,
        cmap=tt.getBestCmap() or {},
        glyph_order=tt.getGlyphOrder(),
        hmtx=tt["hmtx"],
        ascent=hhea.ascent,
        descent=-hhea.descent,
        liga=_lig_maps(tt, ("liga",)),
        rlig=_lig_maps(tt, ("rlig",)),
        kern_lookups=kern_lookups,
        legacy_kern=legacy,
    )
    _FONTS[key] = f
    return f
