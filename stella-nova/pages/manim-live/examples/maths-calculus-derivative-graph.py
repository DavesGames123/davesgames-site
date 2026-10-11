# title: Graphing the derivative
# topic: Calculus
# level: 2
# scene: DerivativeGraph
# summary: Slides a tangent line along sin x and plots its slope underneath, so the slope graph traces out cos x point by point.
# concepts: Axes, plot, angle_of_tangent, slope_of_tangent, TracedPath, ValueTracker, always_redraw

from manim import *


class DerivativeGraph(Scene):
    def construct(self):
        # Two axes with the same x scale, one above the other.
        common = dict(
            x_range=[0, TAU + 0.3, PI / 2],
            x_length=10,
            y_length=2.9,
            tips=False,
        )
        top = Axes(y_range=[-1.3, 1.3, 1], **common)
        bottom = Axes(y_range=[-1.3, 1.3, 1], **common)
        VGroup(top, bottom).arrange(DOWN, buff=0.7).to_edge(RIGHT, buff=0.5)

        f = top.plot(np.sin, x_range=[0, TAU], color=BLUE, stroke_width=4)
        f_label = MathTex("f(x) = \\sin x", color=BLUE, font_size=36).next_to(top, LEFT, buff=0.3)
        slope_label = MathTex("\\text{slope of } f", color=YELLOW, font_size=36).next_to(bottom, LEFT, buff=0.3)

        x = ValueTracker(0.0)

        def tangent():
            # angle_of_tangent works in screen space, so the drawn line
            # really touches the drawn curve.
            point = top.input_to_graph_point(x.get_value(), f)
            angle = top.angle_of_tangent(x.get_value(), f)
            d = rotate_vector(RIGHT, angle) * 1.1
            return Line(point - d, point + d, color=YELLOW, stroke_width=4)

        touch = always_redraw(lambda: Dot(top.input_to_graph_point(x.get_value(), f)))
        line = always_redraw(tangent)

        # The slope at x becomes a height on the lower axes.
        slope_dot = always_redraw(
            lambda: Dot(
                bottom.c2p(x.get_value(), top.slope_of_tangent(x.get_value(), f)),
                color=YELLOW,
            )
        )
        link = always_redraw(
            lambda: DashedLine(touch.get_center(), slope_dot.get_center(), color=GREY_C, stroke_width=2)
        )
        trace = TracedPath(slope_dot.get_center, stroke_color=YELLOW, stroke_width=4)

        self.play(Create(top), Create(bottom), Create(f), Write(f_label), Write(slope_label))
        self.add(trace, link, line, touch, slope_dot)
        self.play(x.animate.set_value(TAU), run_time=7, rate_func=linear)
        self.wait(0.3)

        answer = bottom.plot(np.cos, x_range=[0, TAU], color=GREEN, stroke_width=2)
        answer_label = MathTex("f'(x) = \\cos x", color=GREEN, font_size=36).move_to(slope_label)
        self.play(Create(answer), FadeOut(link), ReplacementTransform(slope_label, answer_label))
        self.wait()
