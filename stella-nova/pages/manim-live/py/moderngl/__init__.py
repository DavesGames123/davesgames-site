"""moderngl -- an import-time stand-in for ModernGL (OpenGL bindings).

Why this module exists
----------------------
ModernGL is a C binding to desktop OpenGL. A browser has no desktop OpenGL.
``from manim import *`` imports manim/mobject/opengl/*.py and
manim/renderer/opengl_renderer.py, and those modules read a few moderngl
constants at import time (moderngl.TRIANGLES, moderngl.POINTS as default
arguments) and import moderngl.Framebuffer for type hints. manim-live runs
the Cairo renderer only, so no OpenGL call runs. This module gives those
names and raises a clear error if user code asks for an OpenGL context
(for example config.renderer = "opengl").
"""

__version__ = "0.0.0+manim-live-stub"

_MSG = (
    "manim-live: the OpenGL renderer is not available in the browser; "
    "manim-live runs the Cairo renderer (config.renderer = 'cairo')."
)

POINTS = 0x0000
LINES = 0x0001
LINE_LOOP = 0x0002
LINE_STRIP = 0x0003
TRIANGLES = 0x0004
TRIANGLE_STRIP = 0x0005
TRIANGLE_FAN = 0x0006
BLEND = 1
DEPTH_TEST = 2
CULL_FACE = 4
PROGRAM_POINT_SIZE = 8
ZERO = 0x0000
ONE = 0x0001
SRC_ALPHA = 0x0302
ONE_MINUS_SRC_ALPHA = 0x0303
DEFAULT_BLENDING = (SRC_ALPHA, ONE_MINUS_SRC_ALPHA)
LINEAR = 0x2601
NEAREST = 0x2600


class Error(Exception):
    pass


class _Unavailable:
    def __init__(self, *args, **kwargs):
        raise Error(_MSG)


class Context(_Unavailable):
    pass


class Framebuffer(_Unavailable):
    pass


class Program(_Unavailable):
    pass


class Buffer(_Unavailable):
    pass


class VertexArray(_Unavailable):
    pass


class Texture(_Unavailable):
    pass


class Renderbuffer(_Unavailable):
    pass


def create_context(*args, **kwargs):
    raise Error(_MSG)


def create_standalone_context(*args, **kwargs):
    raise Error(_MSG)


class Attribute(_Unavailable):
    pass


class Uniform(_Unavailable):
    pass


class UniformBlock(_Unavailable):
    pass
