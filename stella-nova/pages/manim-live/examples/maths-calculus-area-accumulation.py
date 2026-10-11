# title: The area function
# topic: Calculus
# level: 3
# scene: AreaFunction
# summary: Sweeps the right edge x of the area under f(t) = 2 - t and plots the signed area A(x) beside it, so you see the fundamental theorem of calculus, A'(x) = f(x).
# concepts: Axes, get_area, ValueTracker, always_redraw, TracedPath, DecimalNumber, get_vertical_line

from manim import *


def f(t):
    return 2 - t


def A(x):
    return 2 * x - x**2 / 2  # the exact integral of f from 0 to x


class AreaFunction(Scene):
    def construct(self):
        left = Axes(
            x_range=[0, 4.5, 1], y_range=[-2.5, 2.5, 1], x_length=5.6, y_length=4.6,
            axis_config={"include_numbers": True, "font_size": 20},
        )
        right = Axes(
            x_range=[0, 4.5, 1], y_range=[-2.5, 2.5, 1], x_length=5.6, y_length=4.6,
            axis_config={"include_numbers": True, "font_size": 20},
        )
        VGroup(left, right).arrange(RIGHT, buff=1.2).to_edge(DOWN, buff=0.6)

        graph = left.plot(f, x_range=[0, 4.3], color=BLUE, stroke_width=4)
        f_title = MathTex("f(t) = 2 - t", color=BLUE, font_size=38).next_to(left, UP, buff=0.3)
        a_title = MathTex(r"A(x) = \int_0^x f(t)\,dt", color=YELLOW, font_size=38).next_to(right, UP, buff=0.3)

        x = ValueTracker(0.01)

        def shaded():
            # Above the axis counts as +, below the axis counts as -.
            xv = x.get_value()
            parts = VGroup(left.get_area(graph, x_range=[0, min(xv, 2)], color=GREEN, opacity=0.6))
            if xv > 2.02:
                parts.add(left.get_area(graph, x_range=[2, xv], color=RED, opacity=0.6))
            return parts

        area = always_redraw(shaded)
        edge = always_redraw(
            lambda: left.get_vertical_line(left.i2gp(x.get_value(), graph), color=WHITE, line_func=Line)
        )
        a_dot = always_redraw(lambda: Dot(right.c2p(x.get_value(), A(x.get_value())), color=YELLOW))
        a_trace = TracedPath(a_dot.get_center, stroke_color=YELLOW, stroke_width=4)

        value = DecimalNumber(0, num_decimal_places=2, include_sign=True, font_size=36, color=YELLOW)
        value.add_updater(lambda d: d.set_value(A(x.get_value())))
        readout = VGroup(MathTex("A(x) =", font_size=36), value).arrange(RIGHT)
        readout.next_to(right.c2p(2.6, 2.1), RIGHT, buff=0)
        value.add_updater(lambda d: d.next_to(readout[0], RIGHT))

        self.play(Create(left), Create(right), Create(graph), Write(f_title), Write(a_title))
        self.add(area, edge, a_trace, a_dot)
        self.play(FadeIn(readout))
        # Up to x = 2 the area grows; after it, f < 0 and A shrinks again.
        self.play(x.animate.set_value(2), run_time=3, rate_func=linear)
        self.wait(0.5)
        self.play(x.animate.set_value(4), run_time=3, rate_func=linear)
        self.wait(0.5)

        ftc = MathTex(r"A'(x) = f(x)", font_size=44).to_corner(UL, buff=0.3)
        note = Text("A climbs while f > 0 and falls while f < 0", font_size=24, color=GREY_A)
        note.next_to(ftc, RIGHT, buff=0.5)
        self.play(Write(ftc), FadeIn(note))
        self.wait()
