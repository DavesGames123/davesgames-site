"""Pango markup -> styled runs.

Supported tags: markup, span, b, big, i, s, sub, sup, small, tt, u.
Supported span attributes: font, font_desc, font_family, face, size,
font_size, style, font_style, weight, font_weight, foreground, fgcolor,
color, alpha, fgalpha, underline, underline_color, strikethrough,
strikethrough_color, rise, letter_spacing, font_features (liga=0 only).
Accepted and ignored: background, bgcolor, bgalpha, variant, stretch,
font_stretch, lang, gravity, gravity_hint, fallback, allow_breaks,
insert_hyphens, show, line_height, text_transform, segment, font_scale,
baseline_shift.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import replace

from ._layout import Style

WEIGHTS = {
    "thin": 100,
    "ultralight": 200,
    "light": 300,
    "semilight": 350,
    "book": 380,
    "normal": 400,
    "medium": 500,
    "semibold": 600,
    "bold": 700,
    "ultrabold": 800,
    "heavy": 900,
    "ultraheavy": 1000,
}
ABS_SIZES = {
    "xx-small": 1.2 ** -3,
    "x-small": 1.2 ** -2,
    "small": 1.2 ** -1,
    "medium": 1.0,
    "large": 1.2,
    "x-large": 1.2 ** 2,
    "xx-large": 1.2 ** 3,
}
IGNORED = {
    "background", "bgcolor", "bgalpha", "variant", "stretch", "font_stretch", "lang", "gravity",
    "gravity_hint", "fallback", "allow_breaks", "insert_hyphens", "show", "line_height",
    "text_transform", "segment", "font_scale", "baseline_shift", "font_variant",
}
TAGS = {"markup", "span", "b", "big", "i", "s", "sub", "sup", "small", "tt", "u"}


class MarkupError(ValueError):
    pass


def parse_color(value: str):
    from PIL import ImageColor

    v = value.strip()
    m = re.fullmatch(r"#([0-9a-fA-F]{12})", v)
    if m:
        h = m.group(1)
        return tuple(int(h[i : i + 4], 16) / 65535.0 for i in (0, 4, 8)), None
    try:
        rgba = ImageColor.getcolor(v, "RGBA")
    except ValueError:
        raise MarkupError(f"Could not parse color '{value}'")
    alpha = rgba[3] / 255.0 if len(v) in (5, 9) and v.startswith("#") else None
    return (rgba[0] / 255.0, rgba[1] / 255.0, rgba[2] / 255.0), alpha


def _alpha(value: str) -> float:
    v = value.strip()
    if v.endswith("%"):
        return max(0.0, min(1.0, float(v[:-1]) / 100.0))
    return max(0.0, min(1.0, int(v) / 65535.0))


def _points(value: str, base: float, default_size: float) -> float:
    v = value.strip()
    if v in ABS_SIZES:
        return default_size * ABS_SIZES[v]
    if v == "smaller":
        return base / 1.2
    if v == "larger":
        return base * 1.2
    if v.endswith("pt"):
        return float(v[:-2])
    if v.endswith("%"):
        return base * float(v[:-1]) / 100.0
    return int(v) / 1024.0


def _font_desc(desc: str, st: Style) -> Style:
    words = desc.replace(",", " ").split()
    size = None
    if words and re.fullmatch(r"\d+(\.\d+)?(px)?", words[-1]):
        w = words.pop()
        size = float(w[:-2]) / (96 / 72) if w.endswith("px") else float(w)
    weight, italic = st.weight, st.italic
    fam: list[str] = []
    for w in words:
        lw = w.lower()
        if lw in WEIGHTS:
            weight = WEIGHTS[lw]
        elif lw in ("italic", "oblique"):
            italic = True
        elif lw in ("regular", "roman", "normal"):
            pass
        else:
            fam.append(w)
    st = replace(st, weight=weight, italic=italic)
    if fam:
        st = replace(st, family=" ".join(fam))
    if size is not None:
        st = replace(st, size=size)
    return st


def _span(attrib: dict, st: Style, default_size: float) -> Style:
    for key, value in attrib.items():
        if key in ("font", "font_desc"):
            st = _font_desc(value, st)
        elif key in ("font_family", "face"):
            st = replace(st, family=value)
        elif key in ("size", "font_size"):
            st = replace(st, size=_points(value, st.size, default_size))
        elif key in ("style", "font_style"):
            st = replace(st, italic=value.lower() in ("italic", "oblique"))
        elif key in ("weight", "font_weight"):
            lw = value.lower()
            st = replace(st, weight=WEIGHTS[lw] if lw in WEIGHTS else int(value))
        elif key in ("foreground", "fgcolor", "color"):
            rgb, a = parse_color(value)
            st = replace(st, color=rgb, alpha=st.alpha if a is None else a)
        elif key in ("alpha", "fgalpha"):
            st = replace(st, alpha=_alpha(value))
        elif key == "underline":
            v = value.lower()
            st = replace(st, underline=None if v in ("none", "false") else ("single" if v == "true" else v))
        elif key == "underline_color":
            st = replace(st, underline_color=parse_color(value)[0])
        elif key == "strikethrough":
            st = replace(st, strike=value.lower() == "true")
        elif key == "strikethrough_color":
            st = replace(st, strike_color=parse_color(value)[0])
        elif key == "rise":
            v = value.strip()
            st = replace(st, rise=st.rise + (float(v[:-2]) if v.endswith("pt") else int(v) / 1024.0))
        elif key == "letter_spacing":
            st = replace(st, letter_spacing=int(value) / 1024.0)
        elif key == "font_features":
            if re.search(r"\bliga\s*=\s*0", value):
                st = replace(st, liga=False)
        elif key in IGNORED:
            pass
        else:
            raise MarkupError(f"Attribute '{key}' is not allowed on the <span> tag")
    return st


def parse(markup: str, base: Style) -> list[tuple[str, Style]]:
    """Return [(text, style)] runs for a Pango markup string."""
    try:
        root = ET.fromstring("<markup>" + markup + "</markup>")
    except ET.ParseError as e:
        raise MarkupError(f"Error on line {e.position[0]} char {e.position[1]}: {e}")
    runs: list[tuple[str, Style]] = []

    def walk(el, st: Style):
        tag = el.tag
        if tag not in TAGS:
            raise MarkupError(f"Unknown tag '{tag}' on line 1")
        if tag == "span":
            st = _span(el.attrib, st, base.size)
        elif el.attrib and tag != "markup":
            raise MarkupError(f"Tag '{tag}' does not support any attributes")
        elif tag == "b":
            st = replace(st, weight=700)
        elif tag == "i":
            st = replace(st, italic=True)
        elif tag == "s":
            st = replace(st, strike=True)
        elif tag == "u":
            st = replace(st, underline="single")
        elif tag == "tt":
            st = replace(st, family="monospace")
        elif tag == "big":
            st = replace(st, size=st.size * 1.2)
        elif tag == "small":
            st = replace(st, size=st.size / 1.2)
        elif tag in ("sub", "sup"):
            st = replace(st, sub_sup=tag)
        if el.text:
            runs.append((el.text, st))
        for child in el:
            walk(child, st)
            if child.tail:
                runs.append((child.tail, st))

    walk(root, base)
    return runs


def validate(markup: str) -> str:
    try:
        parse(markup, Style())
    except MarkupError as e:
        return str(e)
    except (ValueError, KeyError) as e:
        return str(e)
    return ""
