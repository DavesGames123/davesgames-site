"""Line layout and SVG output in the format of cairo's SVG surface.

ManimPango asks Pango to lay out text and asks cairo to write the glyphs as
an SVG file. Manim then parses that file with its real SVGMobject code. This
module writes the same structure:

    <defs><g> <g id="glyph-F-N"><path d="..."/></g> ... </g></defs>
    <g fill="rgb(r%, g%, b%)" fill-opacity="a"> <use xlink:href="#glyph-F-N" x=".." y=".."/> ... </g>

Units are cairo SVG user units: 1 unit = 1 px at 96 dpi, so a font size of
S points gives an em of S * 96 / 72 units (the pangocairo default
resolution). The first baseline is the top of the layout plus the hhea
ascender, as in Pango.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

from . import _fonts
from ._fonts import _num

PX_PER_PT = 96.0 / 72.0
WHITESPACE = set("               　​")


@dataclass(frozen=True)
class Style:
    family: str = ""
    weight: int = 400
    italic: bool = False
    size: float = 10.0  # points
    color: tuple | None = None  # (r, g, b) in 0..1
    alpha: float = 1.0
    underline: str | None = None
    underline_color: tuple | None = None
    strike: bool = False
    strike_color: tuple | None = None
    rise: float = 0.0  # points, positive up
    letter_spacing: float = 0.0  # points
    liga: bool = True
    sub_sup: str | None = None  # "sub" | "sup", resolved with font metrics


@dataclass
class Item:
    gid: int
    font: object
    style: Style
    advance: float  # px, kerning and letter spacing included
    space: bool
    ink: bool  # has an outline worth a <use>


def _resolve_sub_sup(style: Style) -> Style:
    if not style.sub_sup:
        return style
    font = _fonts.load(style.family, style.weight, style.italic)
    os2 = font.tt["OS/2"] if "OS/2" in font.tt else None
    upm = font.upm
    if style.sub_sup == "sub":
        size_r = (os2.ySubscriptYSize / upm) if os2 and os2.ySubscriptYSize else 0.8
        off = -(os2.ySubscriptYOffset / upm) if os2 and os2.ySubscriptYOffset else -0.2
    else:
        size_r = (os2.ySuperscriptYSize / upm) if os2 and os2.ySuperscriptYSize else 0.8
        off = (os2.ySuperscriptYOffset / upm) if os2 and os2.ySuperscriptYOffset else 0.4
    return replace(style, size=style.size * size_r, rise=style.rise + off * style.size, sub_sup=None)


def shape_run(text: str, style: Style, use_liga: bool) -> list[Item]:
    """Shape one run of one style. Words are shaped one by one."""
    style = _resolve_sub_sup(style)
    font = _fonts.load(style.family, style.weight, style.italic)
    scale = style.size * PX_PER_PT / font.upm
    ls = style.letter_spacing * PX_PER_PT
    items: list[Item] = []
    word: list[str] = []

    def flush_word():
        if not word:
            return
        gids = [font.glyph_for_char(c) for c in word]
        gids = font.apply_ligatures(gids, use_liga and style.liga)
        for i, g in enumerate(gids):
            adv = font.advance(g)
            if i + 1 < len(gids):
                adv += font.kern(g, gids[i + 1])
            items.append(Item(g, font, style, adv * scale + ls, False, True))
        word.clear()

    for ch in text:
        if ch in WHITESPACE:
            flush_word()
            g = font.glyph_for_char(ch)
            if g == 0 and ch != " ":
                g = font.glyph_for_char(" ")
            items.append(Item(g, font, style, font.advance(g) * scale + ls, True, False))
        else:
            word.append(ch)
    flush_word()
    return items


@dataclass
class Line:
    items: list
    wrapped: bool  # True when the line ends at an automatic wrap
    ascent: float
    descent: float


def _metrics(items: list[Item], fallback: Style):
    asc = desc = 0.0
    styles = [it.style for it in items] or [fallback]
    for st in styles:
        st = _resolve_sub_sup(st)
        font = _fonts.load(st.family, st.weight, st.italic)
        s = st.size * PX_PER_PT / font.upm
        rise = st.rise * PX_PER_PT
        asc = max(asc, font.ascent * s + rise)
        desc = max(desc, font.descent * s - rise)
    return asc, desc


def break_lines(paragraphs: list[list[Item]], width: float, indent: float, fallbacks: list[Style]) -> list[Line]:
    lines: list[Line] = []
    for p_index, items in enumerate(paragraphs):
        fallback = fallbacks[p_index]
        if width <= 0:
            a, d = _metrics(items, fallback)
            lines.append(Line(items, False, a, d))
            continue
        # words: runs of non-space items plus the spaces that follow them
        words: list[list[Item]] = []
        cur: list[Item] = []
        for it in items:
            if not it.space and cur and cur[-1].space:
                words.append(cur)
                cur = []
            cur.append(it)
        if cur:
            words.append(cur)
        line: list[Item] = []
        line_w = 0.0
        first = True
        for w in words:
            ink_w = sum(it.advance for it in w if not it.space)
            limit = width - (indent if first else 0.0)
            if line and line_w + ink_w > limit:
                a, d = _metrics(line, fallback)
                lines.append(Line(line, True, a, d))
                line, line_w, first = [], 0.0, False
            line.extend(w)
            line_w += sum(it.advance for it in w)
        a, d = _metrics(line, fallback)
        lines.append(Line(line, False, a, d))
    return lines


class SvgWriter:
    def __init__(self, width: int, height: int):
        self.width = width
        self.height = height
        self.subsets: dict[tuple, int] = {}
        self.glyph_ids: dict[tuple, tuple[int, int]] = {}
        self.defs: list[str] = []
        self.body: list[str] = []
        self._group = None

    def _glyph_ref(self, font, size: float, gid: int) -> str:
        skey = (font.key, round(size, 6))
        sid = self.subsets.setdefault(skey, len(self.subsets))
        gkey = (skey, gid)
        ref = self.glyph_ids.get(gkey)
        if ref is None:
            n = sum(1 for k in self.glyph_ids if k[0] == skey)
            ref = (sid, n)
            self.glyph_ids[gkey] = ref
            d = font.path(gid, size * PX_PER_PT / font.upm)
            self.defs.append(f'<g id="glyph-{sid}-{n}">\n<path d="{d}"/>\n</g>')
        return f"glyph-{ref[0]}-{ref[1]}"

    @staticmethod
    def _rgb(color) -> str:
        r, g, b = color if color is not None else (0.0, 0.0, 0.0)
        return f"rgb({_num(r * 100)}%, {_num(g * 100)}%, {_num(b * 100)}%)"

    def glyph(self, item: Item, x: float, y: float) -> None:
        if not item.ink:
            return
        d = item.font.path(item.gid, item.style.size * PX_PER_PT / item.font.upm)
        if not d:
            return
        ref = self._glyph_ref(item.font, item.style.size, item.gid)
        fill = (self._rgb(item.style.color), _num(item.style.alpha))
        if self._group != fill:
            self.close_group()
            self.body.append(f'<g fill="{fill[0]}" fill-opacity="{fill[1]}">')
            self._group = fill
        self.body.append(f'<use xlink:href="#{ref}" x="{_num(x)}" y="{_num(y)}"/>')

    def rect(self, x: float, y: float, w: float, h: float, color, alpha: float) -> None:
        self.close_group()
        d = f"M {_num(x)} {_num(y)} L {_num(x + w)} {_num(y)} L {_num(x + w)} {_num(y + h)} L {_num(x)} {_num(y + h)} Z"
        self.body.append(f'<path fill-rule="nonzero" fill="{self._rgb(color)}" fill-opacity="{_num(alpha)}" d="{d}"/>')

    def close_group(self) -> None:
        if self._group is not None:
            self.body.append("</g>")
            self._group = None

    def text(self) -> str:
        self.close_group()
        head = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
            f'width="{self.width}" height="{self.height}" viewBox="0 0 {self.width} {self.height}">\n'
        )
        return head + "<defs>\n<g>\n" + "\n".join(self.defs) + "\n</g>\n</defs>\n" + "\n".join(self.body) + "\n</svg>\n"


def place(
    writer: SvgWriter,
    lines: list[Line],
    x0: float,
    y0: float,
    width: float,
    alignment: int = 0,
    justify: bool = False,
    indent: float = 0.0,
    spacing_factor: float = 0.0,
) -> float:
    """Write the lines with the top-left corner at (x0, y0). Return the logical width."""
    def ink_width(line):
        items = list(line.items)
        while items and items[-1].space:
            items.pop()
        return sum(it.advance for it in items)

    widths = [ink_width(l) for l in lines]
    full_widths = [sum(it.advance for it in l.items) for l in lines]
    layout_w = width if width > 0 else (max(widths) if widths else 0.0)
    y = y0
    for i, line in enumerate(lines):
        height = line.ascent + line.descent
        if i == 0:
            y += line.ascent
        else:
            prev = lines[i - 1]
            if spacing_factor > 0:
                y += spacing_factor * height
            else:
                y += prev.descent + line.ascent
        first_of_par = i == 0 or not lines[i - 1].wrapped
        x = x0 + (indent if (first_of_par and indent > 0) else 0.0)
        avail = layout_w - (indent if (first_of_par and indent > 0) else 0.0)
        extra_per_space = 0.0
        if justify and line.wrapped:
            spaces = [it for it in line.items[: len(line.items)] if it.space]
            trailing = 0
            for it in reversed(line.items):
                if it.space:
                    trailing += 1
                else:
                    break
            n = len(spaces) - trailing
            if n > 0:
                extra_per_space = max(0.0, avail - widths[i]) / n
        elif alignment == 1:
            x += (avail - widths[i]) / 2.0
        elif alignment == 2:
            x += avail - widths[i]
        deco: dict[tuple, list] = {}
        for it in line.items:
            rise = it.style.rise * PX_PER_PT
            writer.glyph(it, x, y - rise)
            if it.style.underline and it.style.underline != "none" or it.style.strike:
                key = (it.style, it.font.key)
                span = deco.get(key)
                if span is None:
                    deco[key] = [x, x + it.advance, it]
                else:
                    span[1] = x + it.advance
            x += it.advance
            if it.space and extra_per_space:
                x += extra_per_space
        for (style, _k), (xa, xb, it) in deco.items():
            font = it.font
            s = style.size * PX_PER_PT / font.upm
            base = y - style.rise * PX_PER_PT
            color = style.color
            if style.underline and style.underline != "none":
                post = font.tt["post"]
                thick = max(post.underlineThickness * s, 0.5)
                pos = -post.underlinePosition * s
                if style.underline == "low":
                    pos = it.font.descent * s
                ucol = style.underline_color or color
                writer.rect(xa, base + pos - thick / 2.0, xb - xa, thick, ucol, style.alpha)
                if style.underline == "double":
                    writer.rect(xa, base + pos + thick * 1.5, xb - xa, thick, ucol, style.alpha)
            if style.strike:
                os2 = font.tt["OS/2"] if "OS/2" in font.tt else None
                thick = max((os2.yStrikeoutSize if os2 else font.upm * 0.05) * s, 0.5)
                pos = (os2.yStrikeoutPosition if os2 else font.upm * 0.25) * s
                writer.rect(xa, base - pos - thick / 2.0, xb - xa, thick, style.strike_color or color, style.alpha)
    return max(full_widths) if full_widths else 0.0
