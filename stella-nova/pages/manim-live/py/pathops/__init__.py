"""pathops -- the skia-pathops API subset that manim uses, built on shapely.

Why this module exists
----------------------
skia-pathops is a Cython binding to Skia's path operations. A browser cannot
load it. Manim's real Union, Intersection, Difference and Exclusion classes
(manim/mobject/geometry/boolean_ops.py) build ``pathops.Path`` objects from
the cubic Bezier curves of the VMobjects, call ``union`` / ``intersection`` /
``difference`` / ``xor``, and read the result path back. This module keeps
that API and does the geometry with shapely (GEOS), which Pyodide ships.

Difference from Skia: Skia keeps the result as exact curves. Here each
curve is flattened to line segments (FLATNESS below), the polygon operation
runs in GEOS, and the result comes back as straight LINE verbs. The output
shape is accurate to about 1/1000 of the shape size. Fill rule: contours
are combined with the even-odd rule (Skia default for these operations is
non-zero winding; the two agree unless contours of one path overlap with the
same direction).

API: Path (moveTo, lineTo, quadTo, cubicTo, close, getPen, draw, __iter__,
segments), PathVerb, PathPen, FillType, union, intersection, difference,
xor, op, PathOp.
"""

from __future__ import annotations

from enum import IntEnum

import numpy as np

__version__ = "0.9.0+manim-live-shapely"

# Points per unit of curve length in the flattening; minimum 8 per curve.
FLATNESS = 64
MIN_SEGMENTS = 8
MAX_SEGMENTS = 256


class PathVerb(IntEnum):
    MOVE = 0
    LINE = 1
    QUAD = 2
    CONIC = 3
    CUBIC = 4
    CLOSE = 5


class FillType(IntEnum):
    WINDING = 0
    EVEN_ODD = 1
    INVERSE_WINDING = 2
    INVERSE_EVEN_ODD = 3


class PathOp(IntEnum):
    DIFFERENCE = 0
    INTERSECTION = 1
    UNION = 2
    XOR = 3
    REVERSE_DIFFERENCE = 4


class PathOpsError(Exception):
    pass


class UnsupportedVerbError(PathOpsError):
    pass


class OpenPathError(PathOpsError):
    pass


class PathPen:
    """fontTools-style pen that writes into a Path."""

    def __init__(self, path: Path):
        self.path = path

    def moveTo(self, pt):
        self.path.moveTo(*pt)

    def lineTo(self, pt):
        self.path.lineTo(*pt)

    def curveTo(self, *pts):
        if len(pts) == 3:
            self.path.cubicTo(*pts[0], *pts[1], *pts[2])
        elif len(pts) == 2:
            self.path.quadTo(*pts[0], *pts[1])
        elif len(pts) == 1:
            self.path.lineTo(*pts[0])
        else:
            raise UnsupportedVerbError("curveTo with %d points" % len(pts))

    def qCurveTo(self, *pts):
        if len(pts) == 2:
            self.path.quadTo(*pts[0], *pts[1])
        elif len(pts) == 1:
            self.path.lineTo(*pts[0])
        else:
            # implied on-curve points between consecutive off-curve points
            for i in range(len(pts) - 2):
                a, b = pts[i], pts[i + 1]
                mid = ((a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0)
                self.path.quadTo(*a, *mid)
            self.path.quadTo(*pts[-2], *pts[-1])

    def closePath(self):
        self.path.close()

    def endPath(self):
        pass

    def addComponent(self, glyphName, transformation):
        raise UnsupportedVerbError("components are not supported")


class Path:
    """A list of (verb, points) like skia-pathops' Path."""

    def __init__(self, other: Path | None = None, fillType=FillType.WINDING):
        self._verbs: list[tuple[PathVerb, tuple]] = list(other._verbs) if other is not None else []
        self.fillType = FillType(fillType)

    def moveTo(self, x, y):
        self._verbs.append((PathVerb.MOVE, ((float(x), float(y)),)))

    def lineTo(self, x, y):
        self._verbs.append((PathVerb.LINE, ((float(x), float(y)),)))

    def quadTo(self, x1, y1, x2, y2):
        self._verbs.append((PathVerb.QUAD, ((float(x1), float(y1)), (float(x2), float(y2)))))

    def cubicTo(self, x1, y1, x2, y2, x3, y3):
        self._verbs.append(
            (PathVerb.CUBIC, ((float(x1), float(y1)), (float(x2), float(y2)), (float(x3), float(y3))))
        )

    def close(self):
        self._verbs.append((PathVerb.CLOSE, ()))

    def getPen(self, **kwargs) -> PathPen:
        return PathPen(self)

    def draw(self, pen) -> None:
        for verb, pts in self._verbs:
            if verb == PathVerb.MOVE:
                pen.moveTo(pts[0])
            elif verb == PathVerb.LINE:
                pen.lineTo(pts[0])
            elif verb == PathVerb.QUAD:
                pen.qCurveTo(*pts)
            elif verb == PathVerb.CUBIC:
                pen.curveTo(*pts)
            elif verb == PathVerb.CLOSE:
                pen.closePath()

    def __iter__(self):
        return iter(self._verbs)

    def __len__(self):
        return len(self._verbs)

    @property
    def segments(self):
        return list(self._verbs)

    def reset(self):
        self._verbs.clear()

    # flattening ----------------------------------------------------------------
    def _rings(self) -> list[np.ndarray]:
        rings: list[list] = []
        cur: list | None = None
        last = (0.0, 0.0)
        for verb, pts in self._verbs:
            if verb == PathVerb.MOVE:
                if cur and len(cur) >= 3:
                    rings.append(cur)
                cur = [pts[0]]
                last = pts[0]
                continue
            if cur is None:
                cur = [last]
            if verb == PathVerb.LINE:
                cur.append(pts[0])
                last = pts[0]
            elif verb in (PathVerb.QUAD, PathVerb.CUBIC):
                ctrl = (last,) + pts
                cur.extend(_flatten(ctrl)[1:])
                last = pts[-1]
            elif verb == PathVerb.CLOSE:
                if len(cur) >= 3:
                    rings.append(cur)
                last = cur[0]
                cur = None
        if cur and len(cur) >= 3:
            rings.append(cur)  # open contours are closed implicitly, as in a fill
        return [np.asarray(r, dtype=float) for r in rings]

    def _geometry(self):
        from shapely.geometry import Polygon
        from shapely.validation import make_valid

        geom = None
        for ring in self._rings():
            poly = make_valid(Polygon(ring))
            if poly.is_empty:
                continue
            geom = poly if geom is None else geom.symmetric_difference(poly)
        if geom is None:
            from shapely.geometry import GeometryCollection

            return GeometryCollection()
        return geom


def _flatten(ctrl) -> list[tuple[float, float]]:
    pts = np.asarray(ctrl, dtype=float)
    length = float(np.sum(np.linalg.norm(np.diff(pts, axis=0), axis=1)))
    n = int(min(MAX_SEGMENTS, max(MIN_SEGMENTS, np.ceil(length * FLATNESS / max(_scale_hint(pts), 1e-9)))))
    t = np.linspace(0.0, 1.0, n + 1)[:, None]
    if len(pts) == 3:
        p0, p1, p2 = pts
        out = (1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t**2 * p2
    else:
        p0, p1, p2, p3 = pts
        out = (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t**2 * p2 + t**3 * p3
    return [tuple(p) for p in out]


def _scale_hint(pts: np.ndarray) -> float:
    span = pts.max(axis=0) - pts.min(axis=0)
    return float(max(span.max(), 1e-3)) * 4.0


def _emit(geom, pen) -> None:
    from shapely.geometry import GeometryCollection, MultiPolygon, Polygon

    def ring(coords):
        coords = list(coords)
        if len(coords) > 1 and coords[0] == coords[-1]:
            coords = coords[:-1]
        if len(coords) < 3:
            return
        pen.moveTo(coords[0])
        for c in coords[1:]:
            pen.lineTo(c)
        pen.closePath()

    def poly(p):
        p = p.simplify(0.0)
        ring(p.exterior.coords)
        for interior in p.interiors:
            ring(interior.coords)

    if isinstance(geom, Polygon):
        if not geom.is_empty:
            poly(geom)
    elif isinstance(geom, (MultiPolygon, GeometryCollection)):
        for g in geom.geoms:
            _emit(g, pen)


def _combine(contours) -> object:
    geom = None
    for path in contours:
        g = path._geometry()
        geom = g if geom is None else geom.union(g)
    if geom is None:
        from shapely.geometry import GeometryCollection

        return GeometryCollection()
    return geom


def union(contours, outpen, fix_winding=True, keep_starting_points=False, clockwise=False):
    _emit(_combine(contours), outpen)


def intersection(subject_contours, clip_contours, outpen, fix_winding=True, keep_starting_points=False, clockwise=False):
    _emit(_combine(subject_contours).intersection(_combine(clip_contours)), outpen)


def difference(subject_contours, clip_contours, outpen, fix_winding=True, keep_starting_points=False, clockwise=False):
    _emit(_combine(subject_contours).difference(_combine(clip_contours)), outpen)


def xor(subject_contours, clip_contours, outpen, fix_winding=True, keep_starting_points=False, clockwise=False):
    _emit(_combine(subject_contours).symmetric_difference(_combine(clip_contours)), outpen)


def op(one: Path, two: Path, operator, fix_winding=True, keep_starting_points=False, clockwise=False) -> Path:
    out = Path()
    pen = out.getPen()
    operator = PathOp(operator)
    if operator == PathOp.UNION:
        union([one, two], pen)
    elif operator == PathOp.INTERSECTION:
        intersection([one], [two], pen)
    elif operator == PathOp.DIFFERENCE:
        difference([one], [two], pen)
    elif operator == PathOp.REVERSE_DIFFERENCE:
        difference([two], [one], pen)
    else:
        xor([one], [two], pen)
    return out
