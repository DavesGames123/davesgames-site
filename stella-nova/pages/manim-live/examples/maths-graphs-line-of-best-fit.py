# title: Line of best fit
# topic: Graphs & plots
# level: 2
# scene: LineOfBestFit
# summary: Turns and slides a line through a scatter of data while the vertical gaps and their squared total update, then lands on the least-squares line that makes that total smallest.
# concepts: Axes, Dot, DashedLine, ValueTracker, always_redraw, DecimalNumber, add_updater, np.polyfit

from manim import *

# Fixed seed: the same "measurements" every time the scene runs.
rng = np.random.default_rng(7)
XS = np.linspace(0.8, 9.2, 12)
YS = 0.55 * XS + 1.2 + rng.normal(0, 0.7, XS.size)
BEST_M, BEST_C = np.polyfit(XS, YS, 1)  # least-squares slope and intercept


class LineOfBestFit(Scene):
    def construct(self):
        axes = Axes(
            x_range=[0, 10, 1],
            y_range=[0, 8, 1],
            x_length=8,
            y_length=5.6,
            axis_config={"include_numbers": True, "font_size": 22},
        ).to_corner(DL, buff=0.5)
        labels = axes.get_axis_labels(Text("hours studied", font_size=22), Text("score", font_size=22))
        dots = VGroup(*[Dot(axes.c2p(x, y), color=YELLOW) for x, y in zip(XS, YS)])

        # The line is y = m x + c, with m and c in two trackers.
        m = ValueTracker(-0.1)
        c = ValueTracker(5.5)

        def line_y(x):
            return m.get_value() * x + c.get_value()

        line = always_redraw(
            lambda: axes.plot(line_y, x_range=[0, 10], color=BLUE, stroke_width=5)
        )
        # A residual is the vertical gap between a point and the line.
        residuals = always_redraw(
            lambda: VGroup(
                *[
                    DashedLine(axes.c2p(x, y), axes.c2p(x, line_y(x)), color=RED, stroke_width=3)
                    for x, y in zip(XS, YS)
                ]
            )
        )

        def sse():
            return float(np.sum((YS - (m.get_value() * XS + c.get_value())) ** 2))

        sse_label = MathTex(r"\sum (y_i - \hat y_i)^2 =", font_size=40)
        sse_value = DecimalNumber(sse(), num_decimal_places=2, font_size=40, color=RED)
        sse_value.add_updater(lambda d: d.set_value(sse()))
        sse_row = VGroup(sse_label, sse_value).arrange(RIGHT)
        caption = Text("make the red gaps small", font_size=26, color=GREY_A)
        panel = VGroup(sse_row, caption).arrange(DOWN, buff=0.3).to_corner(UR, buff=0.4)
        sse_value.add_updater(lambda d: d.next_to(sse_label, RIGHT))

        self.play(Create(axes), FadeIn(labels))
        self.play(LaggedStart(*[GrowFromCenter(d) for d in dots], lag_ratio=0.08))
        self.play(Create(line), Create(residuals), FadeIn(panel))
        self.wait(0.5)
        # A worse guess first, then the least-squares answer.
        self.play(m.animate.set_value(0.25), c.animate.set_value(1.0), run_time=2)
        self.play(m.animate.set_value(BEST_M), c.animate.set_value(BEST_C), run_time=2.5)

        result = MathTex(
            rf"\hat y = {BEST_M:.2f}\,x + {BEST_C:.2f}", font_size=42, color=BLUE
        ).next_to(panel, DOWN, buff=0.5)
        self.play(Write(result))
        self.wait()
