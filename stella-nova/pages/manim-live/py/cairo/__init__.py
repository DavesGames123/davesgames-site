"""cairo -- a pycairo API subset that draws on a browser canvas.

Why this module exists
----------------------
pycairo is a C extension around the native cairo library. A browser cannot
load it. ManimCE draws every VMobject through ``manim/camera/camera.py``,
which calls pycairo. This module gives the same Python API. It records the
drawing commands into one flat list of numbers, and runs that list in ONE
call to JavaScript per sync point. JavaScript draws the list on a 2D canvas
(OffscreenCanvas in the worker, @napi-rs/canvas in the Node harness), then
writes the pixels back into the numpy array that manim gave to
``ImageSurface.create_for_data``.

Memory model
------------
Native cairo writes into the shared numpy memory at once. This module writes
the pixels when ``Surface.flush()`` runs, or when ``sync_all()`` runs. The
manim-live runtime calls ``sync_all()`` when
``Camera.display_multiple_non_background_colored_vmobjects`` returns. That
method is the only manim method that draws with cairo, so numpy code in manim
always reads the drawn pixels.

Pixel format
------------
FORMAT_ARGB32 memory is premultiplied and native-endian, that is the bytes are
B, G, R, A on wasm (little-endian). Manim gives colours with red and blue
swapped (see ``Camera.set_cairo_context_color``), so the numpy array holds
R, G, B, A. The JavaScript side uploads the memory as canvas RGBA without a
swap, and gives each cairo colour (r, g, b) to the canvas as rgb(b, g, r).
The result is the same bytes that native cairo writes. Translucent pixels are converted between
premultiplied (cairo) and straight (canvas) alpha.

Supported API (grep -n for the names)
-------------------------------------
    ImageSurface (create_for_data, constructor, get_data, get_width,
                  get_height, get_stride, get_format, flush, mark_dirty,
                  write_to_png, finish)
    Context      (save, restore, new_path, new_sub_path, move_to, line_to,
                  curve_to, rel_move_to, rel_line_to, rel_curve_to,
                  close_path, rectangle, arc, arc_negative, set_source_rgb,
                  set_source_rgba, set_source, get_source, fill,
                  fill_preserve, stroke, stroke_preserve, paint,
                  paint_with_alpha, clip, clip_preserve, reset_clip,
                  set_line_width, get_line_width, set_line_cap,
                  get_line_cap, set_line_join, get_line_join,
                  set_miter_limit, set_dash, set_fill_rule, get_fill_rule,
                  set_operator, get_operator, set_antialias, scale,
                  translate, rotate, transform, set_matrix, get_matrix,
                  identity_matrix, user_to_device, device_to_user,
                  get_current_point, has_current_point, get_target)
    Matrix, SolidPattern, LinearGradient, RadialGradient
    Format, LineCap, LineJoin, FillRule, Operator, Antialias, Extend
    sync_all()   manim-live extension: flush every surface with pending ops

Not supported (raises NotImplementedError): text API (show_text,
select_font_face; manim uses manimpango for text), SurfacePattern,
mesh patterns, PDF/SVG/PS surfaces, FORMAT_A8/A1/RGB16_565.
"""

from __future__ import annotations

import math
import weakref
from enum import IntEnum

import numpy as np

version = "1.29.0 API subset (manim-live canvas backend)"
version_info = (1, 29, 0)
CAIRO_VERSION_STRING = "canvas"
HAS_IMAGE_SURFACE = True
HAS_SVG_SURFACE = False
HAS_PDF_SURFACE = False
HAS_PS_SURFACE = False


def cairo_version() -> int:
    return 0


def cairo_version_string() -> str:
    return CAIRO_VERSION_STRING


class Error(Exception):
    pass


CairoError = Error


class Format(IntEnum):
    INVALID = -1
    ARGB32 = 0
    RGB24 = 1
    A8 = 2
    A1 = 3
    RGB16_565 = 4
    RGB30 = 5

    def stride_for_width(self, width: int) -> int:
        return ImageSurface.format_stride_for_width(self, width)


class LineCap(IntEnum):
    BUTT = 0
    ROUND = 1
    SQUARE = 2


class LineJoin(IntEnum):
    MITER = 0
    ROUND = 1
    BEVEL = 2


class FillRule(IntEnum):
    WINDING = 0
    EVEN_ODD = 1


class Operator(IntEnum):
    CLEAR = 0
    SOURCE = 1
    OVER = 2
    IN = 3
    OUT = 4
    ATOP = 5
    DEST = 6
    DEST_OVER = 7
    DEST_IN = 8
    DEST_OUT = 9
    DEST_ATOP = 10
    XOR = 11
    ADD = 12
    SATURATE = 13
    MULTIPLY = 14
    SCREEN = 15
    OVERLAY = 16
    DARKEN = 17
    LIGHTEN = 18


class Antialias(IntEnum):
    DEFAULT = 0
    NONE = 1
    GRAY = 2
    SUBPIXEL = 3
    FAST = 4
    GOOD = 5
    BEST = 6


class Extend(IntEnum):
    NONE = 0
    REPEAT = 1
    REFLECT = 2
    PAD = 3


class Filter(IntEnum):
    FAST = 0
    GOOD = 1
    BEST = 2
    NEAREST = 3
    BILINEAR = 4
    GAUSSIAN = 5


FORMAT_INVALID = Format.INVALID
FORMAT_ARGB32 = Format.ARGB32
FORMAT_RGB24 = Format.RGB24
FORMAT_A8 = Format.A8
FORMAT_A1 = Format.A1
FORMAT_RGB16_565 = Format.RGB16_565
FORMAT_RGB30 = Format.RGB30
LINE_CAP_BUTT = LineCap.BUTT
LINE_CAP_ROUND = LineCap.ROUND
LINE_CAP_SQUARE = LineCap.SQUARE
LINE_JOIN_MITER = LineJoin.MITER
LINE_JOIN_ROUND = LineJoin.ROUND
LINE_JOIN_BEVEL = LineJoin.BEVEL
FILL_RULE_WINDING = FillRule.WINDING
FILL_RULE_EVEN_ODD = FillRule.EVEN_ODD
OPERATOR_CLEAR = Operator.CLEAR
OPERATOR_SOURCE = Operator.SOURCE
OPERATOR_OVER = Operator.OVER
ANTIALIAS_DEFAULT = Antialias.DEFAULT
EXTEND_NONE = Extend.NONE
EXTEND_REPEAT = Extend.REPEAT
EXTEND_REFLECT = Extend.REFLECT
EXTEND_PAD = Extend.PAD

# Op codes of the flat command list. cairo-canvas.js holds the same table.
OP_NEW_PATH = 1
OP_MOVE_TO = 2
OP_LINE_TO = 3
OP_CURVE_TO = 4
OP_CLOSE_PATH = 5
OP_RGBA = 6
OP_LINEAR = 7
OP_RADIAL = 8
OP_FILL = 9
OP_STROKE = 10
OP_LINE_WIDTH = 11
OP_LINE_CAP = 12
OP_LINE_JOIN = 13
OP_MATRIX = 14
OP_RECT = 17
OP_ARC = 18
OP_ARC_NEG = 19
OP_FILL_RULE = 20
OP_CLIP = 21
OP_RESET_CLIP = 22
OP_PAINT = 23
OP_DASH = 24
OP_MITER = 25
OP_OPERATOR = 26

_host = None


def _get_host():
    """Return the JavaScript module that executes the command lists."""
    global _host
    if _host is None:
        import manimlive_host  # registered by runtime-core.js

        _host = manimlive_host
    return _host


class Matrix:
    """Affine matrix with the pycairo argument order (xx, yx, xy, yy, x0, y0)."""

    __slots__ = ("xx", "yx", "xy", "yy", "x0", "y0")

    def __init__(self, xx=1.0, yx=0.0, xy=0.0, yy=1.0, x0=0.0, y0=0.0):
        self.xx = float(xx)
        self.yx = float(yx)
        self.xy = float(xy)
        self.yy = float(yy)
        self.x0 = float(x0)
        self.y0 = float(y0)

    @classmethod
    def init_rotate(cls, radians: float) -> Matrix:
        c, s = math.cos(radians), math.sin(radians)
        return cls(c, s, -s, c, 0.0, 0.0)

    def _tuple(self):
        return (self.xx, self.yx, self.xy, self.yy, self.x0, self.y0)

    def copy(self) -> Matrix:
        return Matrix(*self._tuple())

    def multiply(self, other: Matrix) -> Matrix:
        """Return self * other: apply self first, then other (pycairo rule)."""
        a = self
        b = other
        return Matrix(
            a.xx * b.xx + a.yx * b.xy,
            a.xx * b.yx + a.yx * b.yy,
            a.xy * b.xx + a.yy * b.xy,
            a.xy * b.yx + a.yy * b.yy,
            a.x0 * b.xx + a.y0 * b.xy + b.x0,
            a.x0 * b.yx + a.y0 * b.yy + b.y0,
        )

    __mul__ = multiply

    def invert(self) -> None:
        det = self.xx * self.yy - self.yx * self.xy
        if det == 0:
            raise Error("invalid matrix (not invertible)")
        xx, yx, xy, yy = self.yy / det, -self.yx / det, -self.xy / det, self.xx / det
        x0 = -(self.x0 * xx + self.y0 * xy)
        y0 = -(self.x0 * yx + self.y0 * yy)
        self.xx, self.yx, self.xy, self.yy, self.x0, self.y0 = xx, yx, xy, yy, x0, y0

    def translate(self, tx: float, ty: float) -> None:
        m = Matrix(1, 0, 0, 1, tx, ty).multiply(self)
        self._set(m)

    def scale(self, sx: float, sy: float) -> None:
        self._set(Matrix(sx, 0, 0, sy, 0, 0).multiply(self))

    def rotate(self, radians: float) -> None:
        self._set(Matrix.init_rotate(radians).multiply(self))

    def _set(self, m: Matrix) -> None:
        self.xx, self.yx, self.xy, self.yy, self.x0, self.y0 = m._tuple()

    def transform_point(self, x: float, y: float):
        return (self.xx * x + self.xy * y + self.x0, self.yx * x + self.yy * y + self.y0)

    def transform_distance(self, dx: float, dy: float):
        return (self.xx * dx + self.xy * dy, self.yx * dx + self.yy * dy)

    def __iter__(self):
        return iter(self._tuple())

    def __getitem__(self, i):
        return self._tuple()[i]

    def __len__(self):
        return 6

    def __eq__(self, other):
        return isinstance(other, Matrix) and self._tuple() == other._tuple()

    def __repr__(self):
        return "cairo.Matrix(%g, %g, %g, %g, %g, %g)" % self._tuple()


class Pattern:
    def __init__(self):
        self._extend = Extend.PAD
        self._matrix = Matrix()

    def set_extend(self, extend) -> None:
        self._extend = Extend(extend)

    def get_extend(self):
        return self._extend

    def set_matrix(self, m: Matrix) -> None:
        self._matrix = m.copy()

    def get_matrix(self) -> Matrix:
        return self._matrix.copy()

    def set_filter(self, f) -> None:
        pass


class SolidPattern(Pattern):
    def __init__(self, r, g, b, a=1.0):
        super().__init__()
        self._rgba = (float(r), float(g), float(b), float(a))

    def get_rgba(self):
        return self._rgba

    def _encode(self):
        return (OP_RGBA, *self._rgba)


class Gradient(Pattern):
    def __init__(self):
        super().__init__()
        self._stops: list[tuple[float, float, float, float, float]] = []

    def add_color_stop_rgba(self, offset, r, g, b, a=1.0) -> None:
        self._stops.append((float(offset), float(r), float(g), float(b), float(a)))

    def add_color_stop_rgb(self, offset, r, g, b) -> None:
        self.add_color_stop_rgba(offset, r, g, b, 1.0)

    def get_color_stops_rgba(self):
        return list(self._stops)

    def _stop_values(self):
        # cairo sorts stops by offset and keeps insertion order for ties.
        stops = sorted(self._stops, key=lambda s: s[0])
        out = [len(stops)]
        for s in stops:
            out.extend(s)
        return out


class LinearGradient(Gradient):
    def __init__(self, x0, y0, x1, y1):
        super().__init__()
        self._pts = (float(x0), float(y0), float(x1), float(y1))

    def get_linear_points(self):
        return self._pts

    def _encode(self):
        return (OP_LINEAR, *self._pts, *self._stop_values())


class RadialGradient(Gradient):
    def __init__(self, cx0, cy0, radius0, cx1, cy1, radius1):
        super().__init__()
        self._circles = tuple(float(v) for v in (cx0, cy0, radius0, cx1, cy1, radius1))

    def get_radial_circles(self):
        return self._circles

    def _encode(self):
        return (OP_RADIAL, *self._circles, *self._stop_values())


class SurfacePattern(Pattern):
    def __init__(self, surface):
        raise NotImplementedError(
            "manim-live: cairo.SurfacePattern is not in the canvas backend"
        )


# Surfaces with pending commands. sync_all() flushes them.
_pending: weakref.WeakSet = weakref.WeakSet()


def sync_all() -> None:
    """Flush every surface that has pending drawing commands."""
    for surface in list(_pending):
        surface.flush()


class Surface:
    def finish(self) -> None:
        self.flush()

    def mark_dirty(self) -> None:
        pass

    def mark_dirty_rectangle(self, x, y, w, h) -> None:
        pass

    def set_device_scale(self, x, y) -> None:
        raise NotImplementedError("manim-live: device scale is not supported")


class ImageSurface(Surface):
    """An image surface whose pixels live in a numpy uint8 array."""

    def __init__(self, format=Format.ARGB32, width: int = 0, height: int = 0, *, _data=None, _stride=None):
        fmt = Format(format)
        if fmt not in (Format.ARGB32, Format.RGB24):
            raise NotImplementedError(
                f"manim-live: cairo format {fmt.name} is not supported (ARGB32 and RGB24 only)"
            )
        self._format = fmt
        self._width = int(width)
        self._height = int(height)
        stride = _stride if _stride is not None else self.format_stride_for_width(fmt, width)
        self._stride = int(stride)
        if _data is None:
            self._array = np.zeros(self._stride * self._height, dtype=np.uint8)
        else:
            self._array = np.frombuffer(_data, dtype=np.uint8)
            if self._array.size < self._stride * self._height:
                raise Error("buffer is too small for the surface")
        self._ops: list = []
        self._owner_ctx = None  # the Context whose state the JS side holds

    @staticmethod
    def format_stride_for_width(format, width: int) -> int:
        return int(width) * 4

    @classmethod
    def create_for_data(cls, data, format, width, height, stride=None):
        return cls(format, width, height, _data=data, _stride=stride)

    @classmethod
    def create_from_png(cls, fobj):
        from PIL import Image

        img = Image.open(fobj).convert("RGBA")
        arr = np.asarray(img, dtype=np.uint8).astype(np.float32)
        a = arr[..., 3:4] / 255.0
        bgra = np.empty_like(arr)
        bgra[..., 0] = arr[..., 2] * a[..., 0]
        bgra[..., 1] = arr[..., 1] * a[..., 0]
        bgra[..., 2] = arr[..., 0] * a[..., 0]
        bgra[..., 3] = arr[..., 3]
        surf = cls(Format.ARGB32, img.width, img.height)
        surf._array[:] = np.round(bgra).astype(np.uint8).ravel()
        return surf

    def get_width(self) -> int:
        return self._width

    def get_height(self) -> int:
        return self._height

    def get_stride(self) -> int:
        return self._stride

    def get_format(self):
        return self._format

    def get_data(self):
        self.flush()
        return memoryview(self._array)

    def _emit(self, ctx, values) -> None:
        """Append commands of ``ctx``; first restate its gstate if needed."""
        if self._owner_ctx is not ctx:
            self._owner_ctx = ctx
            ctx._emit_state(self._ops)
        self._ops.extend(values)
        _pending.add(self)

    def flush(self) -> None:
        """Run the pending commands in one JavaScript call."""
        ops = self._ops
        if not ops:
            return
        self._ops = []
        # The JS canvas forgets state and path between calls. The next
        # command of any context restates them (see _emit and _emit_state).
        self._owner_ctx = None
        _pending.discard(self)
        buf = np.asarray(ops, dtype=np.float64)
        _get_host().cairo_flush(
            self._width,
            self._height,
            self._stride,
            int(self._format),
            self._array,
            buf,
        )

    def write_to_png(self, fobj) -> None:
        from PIL import Image

        self.flush()
        arr = self._array[: self._stride * self._height].reshape(self._height, self._stride // 4, 4)
        arr = arr[:, : self._width].astype(np.float32)
        a = arr[..., 3]
        safe = np.where(a > 0, a, 1.0) / 255.0
        rgba = np.empty_like(arr)
        rgba[..., 0] = arr[..., 2] / safe
        rgba[..., 1] = arr[..., 1] / safe
        rgba[..., 2] = arr[..., 0] / safe
        rgba[..., 3] = a if self._format == Format.ARGB32 else 255
        img = Image.fromarray(np.clip(np.round(rgba), 0, 255).astype(np.uint8), "RGBA")
        img.save(fobj, format="PNG")


class _GState:
    __slots__ = (
        "matrix",
        "source",
        "line_width",
        "line_cap",
        "line_join",
        "miter_limit",
        "dash",
        "dash_offset",
        "fill_rule",
        "operator",
        "clips",
        "antialias",
    )

    def __init__(self):
        self.matrix = Matrix()
        self.source = SolidPattern(0.0, 0.0, 0.0, 1.0)
        self.line_width = 2.0
        self.line_cap = LineCap.BUTT
        self.line_join = LineJoin.MITER
        self.miter_limit = 10.0
        self.dash = ()
        self.dash_offset = 0.0
        self.fill_rule = FillRule.WINDING
        self.operator = Operator.OVER
        self.clips: tuple = ()  # each clip: (fill_rule, path command tuple)
        self.antialias = Antialias.DEFAULT

    def copy(self) -> _GState:
        g = _GState.__new__(_GState)
        for k in _GState.__slots__:
            setattr(g, k, getattr(self, k))
        g.matrix = self.matrix.copy()
        return g


class Context:
    """pycairo Context API. Records commands on its target surface."""

    def __init__(self, target: ImageSurface):
        if not isinstance(target, ImageSurface):
            raise TypeError("Context needs a cairo.ImageSurface")
        self._target = target
        self._g = _GState()
        self._stack: list[_GState] = []
        self._path: list = []  # path commands since new_path (device-space semantics in JS)
        self._cur = None  # current point, user space
        self._start = None  # start of the current sub path, user space

    # state -----------------------------------------------------------------
    def _emit_state(self, out: list) -> None:
        g = self._g
        out.append(OP_RESET_CLIP)
        for rule, cmds in g.clips:
            out.append(OP_NEW_PATH)
            out.extend(cmds)
            out.extend((OP_FILL_RULE, int(rule), OP_CLIP, 0.0))
        out.extend((OP_MATRIX, *g.matrix._tuple()))
        out.extend(g.source._encode())
        out.extend((OP_LINE_WIDTH, g.line_width, OP_LINE_CAP, int(g.line_cap), OP_LINE_JOIN, int(g.line_join)))
        out.extend((OP_MITER, g.miter_limit, OP_FILL_RULE, int(g.fill_rule), OP_OPERATOR, int(g.operator)))
        out.extend((OP_DASH, len(g.dash), g.dash_offset, *g.dash))
        out.append(OP_NEW_PATH)
        out.extend(self._path)

    def _op(self, *values) -> None:
        self._target._emit(self, values)

    def get_target(self) -> ImageSurface:
        return self._target

    def save(self) -> None:
        self._stack.append(self._g.copy())

    def restore(self) -> None:
        if not self._stack:
            raise Error("cairo_restore() without matching cairo_save()")
        old = self._g
        self._g = self._stack.pop()
        if old.clips != self._g.clips:
            # restate everything, including the clip stack
            self._target._owner_ctx = None
            self._target._emit(self, ())
        else:
            g = self._g
            self._op(OP_MATRIX, *g.matrix._tuple())
            self._op(*g.source._encode())
            self._op(OP_LINE_WIDTH, g.line_width, OP_LINE_CAP, int(g.line_cap), OP_LINE_JOIN, int(g.line_join))
            self._op(OP_MITER, g.miter_limit, OP_FILL_RULE, int(g.fill_rule), OP_OPERATOR, int(g.operator))
            self._op(OP_DASH, len(g.dash), g.dash_offset, *g.dash)

    # transforms ------------------------------------------------------------
    def set_matrix(self, matrix: Matrix) -> None:
        self._g.matrix = matrix.copy()
        self._op(OP_MATRIX, *self._g.matrix._tuple())

    def get_matrix(self) -> Matrix:
        return self._g.matrix.copy()

    def identity_matrix(self) -> None:
        self.set_matrix(Matrix())

    def transform(self, matrix: Matrix) -> None:
        self.set_matrix(matrix.multiply(self._g.matrix))

    def translate(self, tx, ty) -> None:
        self.set_matrix(Matrix(1, 0, 0, 1, tx, ty).multiply(self._g.matrix))

    def scale(self, sx, sy) -> None:
        self.set_matrix(Matrix(sx, 0, 0, sy, 0, 0).multiply(self._g.matrix))

    def rotate(self, radians) -> None:
        self.set_matrix(Matrix.init_rotate(radians).multiply(self._g.matrix))

    def user_to_device(self, x, y):
        return self._g.matrix.transform_point(x, y)

    def user_to_device_distance(self, dx, dy):
        return self._g.matrix.transform_distance(dx, dy)

    def device_to_user(self, x, y):
        m = self._g.matrix.copy()
        m.invert()
        return m.transform_point(x, y)

    def device_to_user_distance(self, dx, dy):
        m = self._g.matrix.copy()
        m.invert()
        return m.transform_distance(dx, dy)

    # source ----------------------------------------------------------------
    def set_source_rgba(self, red, green, blue, alpha=1.0) -> None:
        pat = SolidPattern(red, green, blue, alpha)
        self._g.source = pat
        self._op(OP_RGBA, pat._rgba[0], pat._rgba[1], pat._rgba[2], pat._rgba[3])

    def set_source_rgb(self, red, green, blue) -> None:
        self.set_source_rgba(red, green, blue, 1.0)

    def set_source(self, source: Pattern) -> None:
        if isinstance(source, SurfacePattern):
            raise NotImplementedError("manim-live: surface patterns are not supported")
        self._g.source = source
        self._op(*source._encode())

    def get_source(self) -> Pattern:
        return self._g.source

    # path ------------------------------------------------------------------
    def _path_op(self, *values) -> None:
        self._path.extend(values)
        self._target._emit(self, values)

    def new_path(self) -> None:
        self._path = []
        self._cur = None
        self._start = None
        self._target._emit(self, (OP_NEW_PATH,))

    def new_sub_path(self) -> None:
        self._cur = None

    def move_to(self, x, y) -> None:
        self._cur = self._start = (x, y)
        self._path_op(OP_MOVE_TO, x, y)

    def line_to(self, x, y) -> None:
        if self._cur is None:
            self.move_to(x, y)
            return
        self._cur = (x, y)
        self._path_op(OP_LINE_TO, x, y)

    def curve_to(self, x1, y1, x2, y2, x3, y3) -> None:
        if self._cur is None:
            self.move_to(x1, y1)
        self._cur = (x3, y3)
        self._path_op(OP_CURVE_TO, x1, y1, x2, y2, x3, y3)

    def rel_move_to(self, dx, dy) -> None:
        cx, cy = self._require_point()
        self.move_to(cx + dx, cy + dy)

    def rel_line_to(self, dx, dy) -> None:
        cx, cy = self._require_point()
        self.line_to(cx + dx, cy + dy)

    def rel_curve_to(self, dx1, dy1, dx2, dy2, dx3, dy3) -> None:
        cx, cy = self._require_point()
        self.curve_to(cx + dx1, cy + dy1, cx + dx2, cy + dy2, cx + dx3, cy + dy3)

    def _require_point(self):
        if self._cur is None:
            raise Error("no current point")
        return self._cur

    def close_path(self) -> None:
        if self._cur is None:
            return
        self._cur = self._start
        self._path_op(OP_CLOSE_PATH)

    def rectangle(self, x, y, width, height) -> None:
        self._cur = self._start = (x, y)
        self._path_op(OP_RECT, x, y, width, height)

    def arc(self, xc, yc, radius, angle1, angle2) -> None:
        self._cur = (xc + radius * math.cos(angle2), yc + radius * math.sin(angle2))
        if self._start is None:
            self._start = (xc + radius * math.cos(angle1), yc + radius * math.sin(angle1))
        self._path_op(OP_ARC, xc, yc, radius, angle1, angle2)

    def arc_negative(self, xc, yc, radius, angle1, angle2) -> None:
        self._cur = (xc + radius * math.cos(angle2), yc + radius * math.sin(angle2))
        if self._start is None:
            self._start = (xc + radius * math.cos(angle1), yc + radius * math.sin(angle1))
        self._path_op(OP_ARC_NEG, xc, yc, radius, angle1, angle2)

    def has_current_point(self) -> bool:
        return self._cur is not None

    def get_current_point(self):
        return self._cur if self._cur is not None else (0.0, 0.0)

    # painting --------------------------------------------------------------
    def fill_preserve(self) -> None:
        self._target._emit(self, (OP_FILL, 1.0))

    def fill(self) -> None:
        self._target._emit(self, (OP_FILL, 0.0))
        self._path = []
        self._cur = self._start = None

    def stroke_preserve(self) -> None:
        self._target._emit(self, (OP_STROKE, 1.0))

    def stroke(self) -> None:
        self._target._emit(self, (OP_STROKE, 0.0))
        self._path = []
        self._cur = self._start = None

    def paint(self) -> None:
        self._target._emit(self, (OP_PAINT, 1.0))

    def paint_with_alpha(self, alpha) -> None:
        self._target._emit(self, (OP_PAINT, float(alpha)))

    def clip_preserve(self) -> None:
        g = self._g
        g.clips = g.clips + ((g.fill_rule, tuple(self._path)),)
        self._target._emit(self, (OP_CLIP, 1.0))

    def clip(self) -> None:
        self.clip_preserve()
        self.new_path()

    def reset_clip(self) -> None:
        self._g.clips = ()
        self._target._owner_ctx = None
        self._target._emit(self, ())

    # stroke and fill parameters --------------------------------------------
    def set_line_width(self, width) -> None:
        self._g.line_width = float(width)
        self._op(OP_LINE_WIDTH, self._g.line_width)

    def get_line_width(self) -> float:
        return self._g.line_width

    def set_line_cap(self, cap) -> None:
        self._g.line_cap = LineCap(cap)
        self._op(OP_LINE_CAP, int(self._g.line_cap))

    def get_line_cap(self):
        return self._g.line_cap

    def set_line_join(self, join) -> None:
        self._g.line_join = LineJoin(join)
        self._op(OP_LINE_JOIN, int(self._g.line_join))

    def get_line_join(self):
        return self._g.line_join

    def set_miter_limit(self, limit) -> None:
        self._g.miter_limit = float(limit)
        self._op(OP_MITER, self._g.miter_limit)

    def get_miter_limit(self) -> float:
        return self._g.miter_limit

    def set_dash(self, dashes, offset=0) -> None:
        self._g.dash = tuple(float(d) for d in dashes)
        self._g.dash_offset = float(offset)
        self._op(OP_DASH, len(self._g.dash), self._g.dash_offset, *self._g.dash)

    def get_dash(self):
        return (self._g.dash, self._g.dash_offset)

    def set_fill_rule(self, rule) -> None:
        self._g.fill_rule = FillRule(rule)
        self._op(OP_FILL_RULE, int(self._g.fill_rule))

    def get_fill_rule(self):
        return self._g.fill_rule

    def set_operator(self, op) -> None:
        self._g.operator = Operator(op)
        self._op(OP_OPERATOR, int(self._g.operator))

    def get_operator(self):
        return self._g.operator

    def set_antialias(self, antialias) -> None:
        self._g.antialias = Antialias(antialias)

    def get_antialias(self):
        return self._g.antialias

    def set_tolerance(self, tolerance) -> None:
        pass

    # text: manim does text with manimpango, not with the cairo toy API --------
    def _no_text(self, *args, **kwargs):
        raise NotImplementedError(
            "manim-live: the cairo text API is not supported; manim draws text with manimpango"
        )

    show_text = text_path = select_font_face = set_font_size = _no_text
    show_glyphs = glyph_path = text_extents = font_extents = _no_text

    def set_source_surface(self, surface, x=0.0, y=0.0):
        raise NotImplementedError("manim-live: set_source_surface is not supported")


__all__ = [n for n in dir() if not n.startswith("_") and n not in ("annotations", "math", "np", "weakref", "IntEnum")]
