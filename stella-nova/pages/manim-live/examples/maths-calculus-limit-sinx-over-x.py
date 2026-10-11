# title: A limit at a hole
# topic: Calculus
# level: 1
# scene: LimitAtAHole
# summary: Walks two points toward x = 0 on sin(x)/x from both sides, so you see the values close in on 1 even though the function has no value at 0.
# concepts: Axes, plot, Circle, ValueTracker, always_redraw, DecimalNumber, DashedLine

from manim import *


def g(x):
    return np.sin(x) / x


class LimitAtAHole(Scene):
    def construct(self):
        axes = Axes(
            x_range=[-10, 10, 2],
            y_range=[-0.4, 1.2, 0.2],
            x_length=12,
            y_length=4.8,
            axis_config={"include_numbers": True, "font_size": 20},
            y_axis_config={"decimal_number_config": {"num_decimal_places": 1}},
        ).to_edge(DOWN, buff=0.5)

        # Plot the two halves apart, so the curve never asks for g(0).
        left = axes.plot(g, x_range=[-9.6, -0.001], color=BLUE, stroke_width=4)
        right = axes.plot(g, x_range=[0.001, 9.6], color=BLUE, stroke_width=4)
        # An empty circle is the usual mark for "no value here".
        hole = Circle(radius=0.08, color=BLUE, stroke_width=3).set_fill(BLACK, 1)
        hole.move_to(axes.c2p(0, 1))
        title = MathTex(r"g(x) = \frac{\sin x}{x}", font_size=44, color=BLUE).to_corner(UL, buff=0.4)

        d = ValueTracker(8.0)  # distance of the two points from 0
        left_dot = always_redraw(lambda: Dot(axes.c2p(-d.get_value(), g(-d.get_value())), color=YELLOW))
        right_dot = always_redraw(lambda: Dot(axes.c2p(d.get_value(), g(d.get_value())), color=ORANGE))

        x_value = DecimalNumber(8, num_decimal_places=3, font_size=36)
        x_value.add_updater(lambda m: m.set_value(d.get_value()))
        g_value = DecimalNumber(g(8), num_decimal_places=4, font_size=36)
        g_value.add_updater(lambda m: m.set_value(g(d.get_value())))
        table = VGroup(
            VGroup(MathTex(r"x = \pm", font_size=36), x_value).arrange(RIGHT),
            VGroup(MathTex(r"g(x) =", font_size=36), g_value).arrange(RIGHT),
        ).arrange(DOWN, aligned_edge=LEFT).to_corner(UR, buff=0.4)

        self.play(Create(axes), Write(title))
        self.play(Create(left), Create(right), FadeIn(hole))
        self.play(FadeIn(left_dot, right_dot), FadeIn(table))
        # Exponential approach: the steps get smaller and smaller.
        self.play(d.animate.set_value(0.02), run_time=5, rate_func=rate_functions.ease_out_expo)
        self.wait(0.5)

        level = DashedLine(axes.c2p(-10, 1), axes.c2p(10, 1), color=GREEN, stroke_width=2)
        result = MathTex(r"\lim_{x \to 0} \frac{\sin x}{x} = 1", font_size=44, color=GREEN)
        result.next_to(title, DOWN, aligned_edge=LEFT, buff=0.3)
        self.play(Create(level), Write(result))
        self.wait()
