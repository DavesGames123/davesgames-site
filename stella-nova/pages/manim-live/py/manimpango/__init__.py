"""manimpango -- the ManimPango 0.7 API without Pango, for the browser.

Why this module exists
----------------------
ManimPango is a Cython binding to Pango, cairo and fontconfig. A browser
cannot load those C libraries. Manim's real Text, MarkupText, Paragraph and
Code classes call ``manimpango.text2svg`` / ``MarkupUtils.text2svg`` to get
an SVG file of the glyph outlines, then parse that file with manim's real
SVGMobject code. This module writes the same SVG (same structure as cairo's
SVG surface, same units, same baseline rule) from TrueType fonts read with
fontTools. See _layout.py for the format and _fonts.py for shaping.

Fonts: DejaVu Sans, DejaVu Serif and DejaVu Sans Mono are bundled (fonts/).
Generic names (sans, serif, monospace) and common names (Arial, Times,
Courier, Consolas and so on) map to them. register_font() adds any TTF/OTF
in the Pyodide file system.

Differences from real Pango (also in UNDER-THE-HOOD.md):
  * shaping: cmap, GSUB liga/rlig and GPOS kern only; no complex scripts,
    no mark positioning, no font fallback for missing glyphs (.notdef box);
  * markup: see _markup.py for the supported tags and attributes;
  * line breaking: greedy at spaces (Pango WRAP_WORD), no hyphenation.
"""

from __future__ import annotations

from xml.sax.saxutils import escape

from . import _fonts
from ._layout import PX_PER_PT, Style, SvgWriter, break_lines, place, shape_run
from ._markup import MarkupError, parse as _parse_markup, validate as _validate
from .enums import Alignment, Style as PangoStyle, Variant, Weight
from .utils import PangoUtils

__version__ = "0.7.0+manim-live"

__all__ = [
    "TextSetting",
    "text2svg",
    "MarkupUtils",
    "PangoUtils",
    "list_fonts",
    "register_font",
    "unregister_font",
    "fc_register_font",
    "fc_unregister_font",
    "registered_fonts",
    "RegisteredFont",
    "pango_version",
    "cairo_version",
    "Alignment",
    "Weight",
    "Variant",
]

_STYLE_ITALIC = {"NORMAL": False, "ITALIC": True, "OBLIQUE": True}


class TextSetting:
    """Formatting for slices of a manim Text object (same fields as ManimPango)."""

    def __init__(self, start: int, end: int, font: str, slant: str, weight: str, line_num=-1, color: str = None):
        self.start = start
        self.end = end
        self.font = font
        self.slant = slant
        self.weight = weight
        self.line_num = line_num
        self.color = color


class RegisteredFont:
    def __init__(self, path: str, type: str = "fontconfig"):
        self.path = path
        self.type = type

    def __hash__(self):
        return hash((self.path, self.type))

    def __eq__(self, other):
        return isinstance(other, RegisteredFont) and (self.path, self.type) == (other.path, other.type)


registered_fonts: set = set()


def register_font(font_path: str) -> bool:
    """Make the fonts in a TTF/OTF file available to Text and MarkupText."""
    import os

    assert os.path.exists(font_path), f"font_path doesn't exist: {font_path}"
    ok = _fonts.register(font_path)
    registered_fonts.add(RegisteredFont(font_path))
    return ok


def unregister_font(font_path: str) -> bool:
    registered_fonts.discard(RegisteredFont(font_path))
    return _fonts.unregister(font_path)


fc_register_font = register_font
fc_unregister_font = unregister_font


def list_fonts() -> list:
    return _fonts.family_names() + list(_fonts.GENERIC_NAMES)


def pango_version() -> str:
    return "manim-live fontTools layout (no Pango)"


def cairo_version() -> str:
    return "manim-live SVG writer (no cairo)"


def _hex_to_rgb(color: str | None):
    if not color:
        return None
    from ._markup import parse_color

    return parse_color(str(color))[0]


def text2svg(
    settings: list,
    size: float,
    line_spacing: float,
    disable_liga: bool,
    file_name: str,
    START_X: int,
    START_Y: int,
    width: int,
    height: int,
    orig_text: str,
    pango_width: int | None = None,
) -> str:
    """Render the SVG file of a manim Text object (same contract as ManimPango)."""
    writer = SvgWriter(width, height)
    layout_w = float(width if pango_width is None else pango_width)
    offset_x = 0.0
    last_line_num = 0
    for setting in settings:
        PangoUtils.str2style(setting.slant)  # same errors as ManimPango
        weight = PangoUtils.str2weight(setting.weight).value
        text_str = orig_text[setting.start : setting.end].replace("\n", " ")
        if setting.line_num != last_line_num:
            offset_x = 0.0
            last_line_num = setting.line_num
        if setting.color:
            err = _validate(f"<span color='{escape(str(setting.color))}'>{escape(text_str)}</span>")
            if err:
                raise ValueError(f"Pango cannot recognize your color '{setting.color}' for text '{text_str}'.")
        style = Style(
            family=setting.font or "",
            weight=weight,
            italic=_STYLE_ITALIC[setting.slant],
            size=float(size),
            color=_hex_to_rgb(setting.color),
        )
        items = shape_run(text_str, style, not disable_liga)
        lines = break_lines([items], layout_w, 0.0, [style])
        logical = place(
            writer,
            lines,
            START_X + offset_x,
            START_Y + line_spacing * setting.line_num,
            layout_w,
        )
        offset_x += logical
    with open(file_name, "w", encoding="utf-8") as f:
        f.write(writer.text())
    return file_name


class MarkupUtils:
    @staticmethod
    def validate(markup: str) -> str:
        """Return an empty string for valid Pango markup, else the error."""
        return _validate(markup)

    @staticmethod
    def text2svg(
        text: str,
        font: str | None,
        slant: str,
        weight: str,
        size: float,
        _,
        disable_liga: bool,
        file_name: str,
        START_X: int,
        START_Y: int,
        width: int,
        height: int,
        *,
        justify: bool | None = None,
        indent: float | int | None = None,
        line_spacing: float | None = None,
        alignment: Alignment | None = None,
        pango_width: int | None = None,
    ) -> str:
        """Render the SVG file of a manim MarkupText object."""
        base = Style(
            family=font or "",
            weight=PangoUtils.str2weight(weight).value,
            italic=_STYLE_ITALIC[PangoUtils.str2style(slant).name],
            size=float(size),
        )
        runs = _parse_markup(text, base)
        paragraphs: list[list] = [[]]
        fallbacks: list[Style] = [base]
        for run_text, style in runs:
            parts = run_text.split("\n")
            for i, part in enumerate(parts):
                if i > 0:
                    paragraphs.append([])
                    fallbacks.append(style)
                if part:
                    paragraphs[-1].extend(shape_run(part, style, not disable_liga))
        layout_w = float(width if pango_width is None else pango_width)
        indent_px = float(indent) * 1.0 if indent else 0.0
        lines = break_lines(paragraphs, layout_w, indent_px, fallbacks)
        writer = SvgWriter(width, height)
        place(
            writer,
            lines,
            START_X,
            START_Y,
            layout_w,
            alignment=alignment.value if alignment is not None else 0,
            justify=bool(justify),
            indent=indent_px,
            spacing_factor=float(line_spacing or 0.0),
        )
        with open(file_name, "w", encoding="utf-8") as f:
            f.write(writer.text())
        return file_name
