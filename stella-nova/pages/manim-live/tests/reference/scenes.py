# Reference scenes: rendered by native manim 0.22.0 (real pycairo, Pango)
# with tools/reference-native.py, and by manim-live in Node. The engine
# test compares the frames listed in FRAMES. No TeX: native has no LaTeX.
from manim import *
import numpy as np

FRAMES = {
    "RefShapes": [7, 22, 36],
    "RefText": [10, 29],
    "RefPlane": [14],
    "RefSurface": [0],
    "RefBoolean": [0],
    "RefGradient": [0],
}


class RefShapes(Scene):
    def construct(self):
        c = Circle(color=BLUE, fill_opacity=0.5)
        s = Square(color=RED)
        self.play(Create(c))
        self.play(Transform(c, s))
        self.wait(0.5)


class RefText(Scene):
    def construct(self):
        t = Text("Real manim, real Text", font="DejaVu Sans", t2c={"real": YELLOW})
        m = MarkupText('<b>bold</b> <i>italic</i> <span foreground="#58C4DD">blue</span>', font="DejaVu Sans").next_to(t, DOWN)
        self.play(Write(t))
        self.play(FadeIn(m))


class RefPlane(Scene):
    def construct(self):
        plane = NumberPlane()
        self.add(plane)
        self.play(plane.animate.apply_function(lambda p: p + 0.3 * np.array([np.sin(p[1]), np.sin(p[0]), 0])), run_time=1)


class RefSurface(ThreeDScene):
    def construct(self):
        self.set_camera_orientation(phi=65 * DEGREES, theta=-45 * DEGREES)
        axes = ThreeDAxes()
        s = Surface(lambda u, v: axes.c2p(u, v, 0.6 * np.sin(u) * np.cos(v)), u_range=[-3, 3], v_range=[-3, 3], resolution=(12, 12))
        self.add(axes, s)


class RefBoolean(Scene):
    def construct(self):
        sq = Square(fill_opacity=1, color=RED).shift(LEFT)
        cr = Circle(fill_opacity=1, color=BLUE).shift(0.3 * LEFT + 0.5 * UP)
        self.add(
            Union(sq, cr, color=GREEN, fill_opacity=0.8).shift(3 * LEFT),
            Difference(sq, cr, color=YELLOW, fill_opacity=0.8).shift(3 * RIGHT),
            Intersection(sq, cr, color=PURPLE, fill_opacity=1),
        )


class RefGradient(Scene):
    def construct(self):
        r = Rectangle(width=6, height=2, fill_opacity=1).set_color_by_gradient(BLUE, GREEN, YELLOW)
        d = DashedLine(LEFT * 4, RIGHT * 4, color=WHITE).shift(2 * DOWN)
        a = Arrow(LEFT * 3, RIGHT * 3, color=ORANGE).shift(2 * UP)
        dots = VGroup(*[Dot(radius=0.12, color=interpolate_color(RED, BLUE, k / 9)).shift(RIGHT * (k - 4.5) * 0.8 + 3 * DOWN) for k in range(10)])
        self.add(r, d, a, dots, Annulus(inner_radius=0.3, outer_radius=0.6, color=TEAL, fill_opacity=0.7).shift(5 * LEFT))
