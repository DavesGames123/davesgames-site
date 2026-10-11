# title: From secant to tangent
# topic: Calculus
# level: 2
# scene: SecantToTangent
# summary: Shrinks the step dx between two points on a curve, so the secant line turns into the tangent and its slope dy/dx settles on the derivative.
# concepts: Axes, plot, get_secant_slope_group, ValueTracker, always_redraw, DecimalNumber, get_vertical_line

from manim import *

X0 = 4  # the point where we want the slope


def f(x):
    return 0.1 * x**3 - 0.6 * x**2 + x + 1.5


def df(x):
    return 0.3 * x**2 - 1.2 * x + 1  # the exact derivative, for the final check


class SecantToTangent(Scene):
    def construct(self):
        axes = Axes(
            x_range=[0, 6.5, 1],
            y_range=[0, 8, 1],
            x_length=7.5,
            y_length=6.5,
            axis_config={"include_numbers": True, "font_size": 22},
        ).to_edge(LEFT, buff=0.5)
        graph = axes.plot(f, x_range=[0, 5.9], color=BLUE, stroke_width=5)
        graph_label = axes.get_graph_label(graph, "f(x)", x_val=1.0, direction=UP)

        dx = ValueTracker(1.8)

        # get_secant_slope_group draws the dx run, the dy rise, their
        # labels and the secant line through both points.
        secant = always_redraw(
            lambda: axes.get_secant_slope_group(
                x=X0,
                graph=graph,
                dx=dx.get_value(),
                # Labels only while there is room for them next to the lines.
                dx_label="dx" if dx.get_value() > 0.4 else None,
                dy_label="dy" if dx.get_value() > 0.4 else None,
                dx_line_color=YELLOW,
                dy_line_color=ORANGE,
                secant_line_color=GREEN,
                secant_line_length=6,
            )
        )
        p = Dot(axes.input_to_graph_point(X0, graph), color=WHITE)
        q = always_redraw(
            lambda: Dot(axes.input_to_graph_point(X0 + dx.get_value(), graph), color=GREEN)
        )
        guide = axes.get_vertical_line(axes.input_to_graph_point(X0, graph), color=GREY_B)

        def slope():
            h = dx.get_value()
            return (f(X0 + h) - f(X0)) / h

        dx_value = DecimalNumber(dx.get_value(), num_decimal_places=3, color=YELLOW)
        dx_value.add_updater(lambda d: d.set_value(dx.get_value()))
        slope_value = DecimalNumber(slope(), num_decimal_places=3, color=GREEN)
        slope_value.add_updater(lambda d: d.set_value(slope()))
        rows = VGroup(
            VGroup(MathTex("dx ="), dx_value).arrange(RIGHT),
            VGroup(MathTex(r"\frac{dy}{dx} ="), slope_value).arrange(RIGHT),
        ).arrange(DOWN, aligned_edge=LEFT, buff=0.5)
        rows.to_edge(RIGHT, buff=1.2).shift(UP)

        self.play(Create(axes), Create(graph), FadeIn(graph_label))
        self.play(Create(guide), FadeIn(p, q), Create(secant), FadeIn(rows))
        self.wait(0.5)
        # As dx -> 0 the second point slides into the first one.
        self.play(dx.animate.set_value(0.01), run_time=5, rate_func=rate_functions.ease_in_out_sine)
        self.wait(0.5)

        exact = MathTex(rf"f'({X0}) = {df(X0):g}", color=GREEN).next_to(rows, DOWN, buff=0.7)
        self.play(Write(exact))
        self.wait()
