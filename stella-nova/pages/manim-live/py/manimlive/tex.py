"""TeX -> SVG with MathJax 3, in place of latex + dvisvgm.

Why this module exists
----------------------
Manim's real MathTex/Tex/SingleStringMathTex call ONE function to turn TeX
into an SVG file: ``manim.utils.tex_file_writing.tex_to_svg_file``. Natively
that function writes a .tex file, runs ``latex`` and then ``dvisvgm``. No TeX
distribution exists in a browser, so runtime.install_hooks() points that one
name (in tex_file_writing and in tex_mobject, which imported it by name) to
``tex_to_svg_file`` below. Everything after it is real manim: SVGMobject
parses the file, MathTex splits it into parts, font_size scales it.

What this function does
-----------------------
1. It calls manim's real ``generate_tex_file`` (same hash, same cache path).
2. It turns the expression into MathJax input:
   * MathTex parts are wrapped by manim in
     ``\\special{dvisvgm:raw <g id='uniqueNNN'>}`` ... ``\\special{dvisvgm:raw </g>}``.
     These become ``\\cssId{uniqueNNN}{...}``, so MathJax writes
     ``<g id="uniqueNNN">`` groups and manim's _break_up_by_substrings finds
     them, as with dvisvgm.
   * Math environments (align*, gather*, equation*, ...) pass through.
     Text environments (center, None) are converted to \\text{} with the
     $...$ parts kept as math.
   * \\newcommand, \\renewcommand, \\def and \\DeclareMathOperator lines in
     the template preamble are kept; \\usepackage lines are dropped.
3. The SVG gets the same units as dvisvgm: width/height in pt with 1 em =
   10 pt (the 10 pt document class of manim's default template), so
   SVGMobject and MathTex.font_size give the same sizes as natively.
4. ``fill="currentColor"`` becomes black, which manim recolours to the
   mobject colour (dvisvgm glyphs are black too). \\color{...} stays.

Limits: no LaTeX packages beyond what MathJax implements (for example no
TikZ, no \\usepackage{...} side effects), text mode supports what MathJax's
textmacros supports, and a part split that leaves unbalanced braces makes
manim fall back to one group (manim logs it).
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from pathlib import Path

MATH_ENVS = {
    "align", "align*", "alignat", "alignat*", "aligned", "eqnarray", "eqnarray*", "equation",
    "equation*", "flalign", "flalign*", "gather", "gather*", "gathered", "multline", "multline*",
    "split", "array", "matrix", "pmatrix", "bmatrix", "vmatrix", "Bmatrix", "Vmatrix", "cases",
    "displaymath", "math",
}
_OPEN = re.compile(r"\\special\{dvisvgm:raw <g id='([^']+)'>\}")
_CLOSE = re.compile(r"\\special\{dvisvgm:raw </g>\}")
_MACRO_LINE = re.compile(r"^\s*\\(newcommand|renewcommand|providecommand|def|DeclareMathOperator|let)\b")
SVG_NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG_NS)
ET.register_namespace("xlink", "http://www.w3.org/1999/xlink")


class TexError(ValueError):
    pass


def _tokens(expr: str):
    """Split the expression into ('open', id) / ('close', None) / ('text', s)."""
    pos = 0
    pat = re.compile(_OPEN.pattern + "|" + _CLOSE.pattern)
    for m in pat.finditer(expr):
        if m.start() > pos:
            yield ("text", expr[pos : m.start()])
        if m.group(1) is not None:
            yield ("open", m.group(1))
        else:
            yield ("close", None)
        pos = m.end()
    if pos < len(expr):
        yield ("text", expr[pos:])


def _text_mode(s: str) -> str:
    """Text-mode LaTeX -> MathJax math: text in \\text{}, $...$ kept as math."""
    out: list[str] = []
    i = 0
    buf = ""
    while i < len(s):
        if s.startswith("\\$", i):
            buf += "\\$"
            i += 2
            continue
        if s.startswith("$$", i) or s[i] == "$" or s.startswith("\\(", i) or s.startswith("\\[", i):
            if s.startswith("$$", i):
                start, end = "$$", "$$"
            elif s[i] == "$":
                start, end = "$", "$"
            elif s.startswith("\\(", i):
                start, end = "\\(", "\\)"
            else:
                start, end = "\\[", "\\]"
            j = s.find(end, i + len(start))
            if j < 0:
                buf += s[i:]
                break
            if buf:
                out.append(_wrap_text(buf))
                buf = ""
            out.append("{" + s[i + len(start) : j] + "}")
            i = j + len(end)
            continue
        buf += s[i]
        i += 1
    if buf:
        out.append(_wrap_text(buf))
    return "".join(out)


def _wrap_text(s: str) -> str:
    # LaTeX line breaks inside text: MathJax \text cannot hold \\, so split.
    pieces = re.split(r"\\\\(?:\[[^\]]*\])?", s)
    if len(pieces) == 1:
        return "\\text{" + s + "}"
    return "\\begin{array}{c}" + " \\\\ ".join("\\text{" + p.strip() + "}" for p in pieces) + "\\end{array}"


def _macros(template) -> str:
    lines = []
    for line in (template.preamble or "").splitlines() + (template.post_doc_commands or "").splitlines():
        if _MACRO_LINE.match(line):
            lines.append(line.strip())
    return "\n".join(lines)


def _tree(expression: str):
    """Marker tokens -> nested [id, children] lists (text items are str)."""
    root = [None, []]
    stack = [root]
    for kind, val in _tokens(expression):
        if kind == "open":
            node = [val, []]
            stack[-1][1].append(node)
            stack.append(node)
        elif kind == "close":
            if len(stack) > 1:
                stack.pop()
        else:
            stack[-1][1].append(val)
    return root


def to_mathjax(expression: str, environment: str | None, template) -> tuple[str, dict, list]:
    """Return (MathJax TeX input, aliases {outer id: inner id}, all group ids).

    MathJax puts the id of \\cssId{X}{...} on the argument node itself when the
    argument is one node. Two ids that wrap the same node would then fight,
    so a group whose only content is another group is written once, and the
    outer id is restored as an alias in svg_from_mathjax().
    """
    text_mode = environment is None or environment not in MATH_ENVS
    aliases: dict[str, str] = {}
    ids: list[str] = []

    def ser(node) -> str:
        gid, children = node
        if gid is not None:
            ids.append(gid)
            real = [c for c in children if not (isinstance(c, str) and (c.strip() == "" and not text_mode))]
            if len(real) == 1 and not isinstance(real[0], str):
                inner = real[0]
                body = ser(inner)
                aliases[gid] = inner[0]
                return body
        out = []
        for c in children:
            if isinstance(c, str):
                out.append(_text_mode(c) if text_mode else c)
            else:
                out.append(ser(c))
        body = "".join(out)
        return ("\\cssId{" + gid + "}{" + body + "}") if gid is not None else body

    body = ser(_tree(expression))
    if environment and not text_mode:
        body = "\\begin{" + environment + "}" + body + "\\end{" + environment + "}"
    macros = _macros(template)
    return ((macros + "\n" + body) if macros else body), aliases, ids


def _strip_ids(src: str) -> str:
    return re.sub(r"\\cssId\{[^{}]*\}", "", src)


def svg_from_mathjax(svg_text: str, aliases: dict | None = None, ids: list | None = None) -> str:
    """Give MathJax SVG the units and colours of dvisvgm output, restore group ids."""
    root = ET.fromstring(svg_text)
    # MathJax: 1000 units per em. dvisvgm: pt, and 1 em = 10 pt. Manim's
    # SVGMobject reads the path coordinates as they are (it does not apply
    # the viewBox), so the content itself is scaled by 1/100.
    vb = [float(v) / 100.0 for v in root.get("viewBox", "0 0 0 0").split()]
    for key in ("style", "role", "focusable", "width", "height", "viewBox"):
        root.attrib.pop(key, None)
    root.set("viewBox", " ".join(f"{v:.6f}" for v in vb))
    root.set("width", f"{vb[2]:.6f}pt")
    root.set("height", f"{vb[3]:.6f}pt")
    wrapper = ET.Element(f"{{{SVG_NS}}}g", {"transform": "scale(0.01)"})
    for child in list(root):
        root.remove(child)
        wrapper.append(child)
    root.append(wrapper)
    for el in root.iter():
        for attr in ("fill", "stroke"):
            if el.get(attr) == "currentColor":
                el.set(attr, "#000000")
        for attr in [a for a in el.attrib if a.startswith("data-")]:
            del el.attrib[attr]
    _restore_ids(root, aliases or {}, ids or [])
    return ET.tostring(root, encoding="unicode")


def _restore_ids(root, aliases: dict, ids: list) -> None:
    parent = {c: p for p in root.iter() for c in p}
    # empty <text> nodes that MathJax adds to align id boxes
    for el in list(root.iter()):
        if el.tag.endswith("text") and not (el.text or "").strip() and len(el) == 0 and el in parent:
            parent[el].remove(el)
    by_id = {el.get("id"): el for el in root.iter() if el.get("id")}
    # outer groups that wrapped exactly one inner group, innermost first
    pending = dict(aliases)
    for _ in range(len(pending) + 1):
        for outer, inner in list(pending.items()):
            target = by_id.get(inner)
            if target is None or target not in parent:
                continue
            wrapper = ET.Element(f"{{{SVG_NS}}}g", {"id": outer})
            p = parent[target]
            idx = list(p).index(target)
            p.remove(target)
            wrapper.append(target)
            p.insert(idx, wrapper)
            parent[target] = wrapper
            parent[wrapper] = p
            by_id[outer] = wrapper
            del pending[outer]
    # a group MathJax dropped entirely: keep manim's lookup working (empty group)
    for gid in ids:
        if gid not in by_id:
            el = ET.SubElement(root, f"{{{SVG_NS}}}g", {"id": gid})
            by_id[gid] = el


def tex_to_svg_file(expression: str, environment: str | None = None, tex_template=None) -> Path:
    """Same contract as manim.utils.tex_file_writing.tex_to_svg_file."""
    from manim import config
    from manim.utils.tex_file_writing import generate_tex_file

    import manimlive_host

    if tex_template is None:
        tex_template = config["tex_template"]
    tex_file = generate_tex_file(expression, environment, tex_template)
    svg_file = tex_file.with_suffix(".svg")
    if svg_file.exists():
        return svg_file
    src, aliases, ids = to_mathjax(expression, environment, tex_template)
    result = manimlive_host.tex_to_svg(src, True)
    if result.startswith("ERROR:") and ids:
        # Unbalanced part split: retry without groups; manim then falls back
        # to the root group and logs it, as with a dvisvgm group problem.
        result = manimlive_host.tex_to_svg(_strip_ids(src), True)
    if result.startswith("ERROR:"):
        raise TexError(
            "MathJax could not typeset this TeX: " + result[6:].strip() + "\nInput: " + expression
        )
    svg_file.write_text(svg_from_mathjax(result, aliases, ids), encoding="utf-8")
    return svg_file
