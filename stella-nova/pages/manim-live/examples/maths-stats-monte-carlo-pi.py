# title: Estimating pi with random points
# topic: Probability & statistics
# level: 1
# scene: MonteCarloPi
# summary: Throws more and more random points into a square; the share that lands inside the quarter circle, times 4, gets close to pi, and a log-scale chart shows how slowly it settles.
# concepts: Square, Arc, Dot, VGroup, ChangeDecimalToValue, Axes, LogBase, DashedLine

from manim import *

SIDE = 5.6
CORNER = np.array([-6.6, -3.0, 0])       # bottom-left corner of the square
BATCHES = [10, 40, 150, 400, 1400]       # points added in each step (total 2000)
rng = np.random.default_rng(11)


class MonteCarloPi(Scene):
    def construct(self):
        square = Square(side_length=SIDE, color=WHITE).move_to(CORNER + SIDE / 2 * (RIGHT + UP))
        quarter = Arc(radius=SIDE, start_angle=0, angle=PI / 2, arc_center=CORNER, color=YELLOW)

        n_value = Integer(0, font_size=34)
        pi_value = DecimalNumber(0, num_decimal_places=4, font_size=34, color=YELLOW)
        readout = VGroup(
            VGroup(Text("points", font_size=26), n_value).arrange(RIGHT, buff=0.3),
            VGroup(MathTex(r"4 \cdot \frac{\text{inside}}{\text{all}} =", font_size=34), pi_value).arrange(RIGHT),
        ).arrange(DOWN, aligned_edge=LEFT, buff=0.3).to_corner(UR, buff=0.4)

        # A chart of the estimate against the number of points (log scale on x).
        chart = Axes(
            x_range=[1, 3.4, 1],
            y_range=[2.4, 4.0, 0.4],
            x_length=5.2,
            y_length=3.0,
            x_axis_config={"scaling": LogBase(custom_labels=True), "include_numbers": True, "font_size": 22},
            y_axis_config={"include_numbers": True, "font_size": 20,
                           "decimal_number_config": {"num_decimal_places": 1}},
            tips=False,
        ).to_corner(DR, buff=0.6).shift(UP * 0.5)
        pi_line = DashedLine(chart.c2p(10, PI), chart.c2p(10**3.4, PI), color=GREEN)
        pi_label = MathTex(r"\pi", color=GREEN, font_size=32).next_to(pi_line, RIGHT, buff=0.1)
        x_name = Text("points (log scale)", font_size=20, color=GREY_A).next_to(chart.x_axis, DOWN, buff=0.4)

        self.play(Create(square), Create(quarter))
        self.play(FadeIn(readout), Create(chart), Create(pi_line), FadeIn(pi_label), FadeIn(x_name))

        total, inside, previous = 0, 0, None
        for n in BATCHES:
            xy = rng.random((n, 2))                      # uniform in [0, 1) x [0, 1)
            hit = (xy**2).sum(axis=1) <= 1               # inside the unit quarter circle?
            dots = VGroup(*[
                Dot(CORNER + SIDE * np.array([x, y, 0]), radius=0.035, color=YELLOW if h else BLUE)
                for (x, y), h in zip(xy, hit)
            ])
            total += n
            inside += int(hit.sum())
            estimate = 4 * inside / total

            point = Dot(chart.c2p(total, estimate), color=YELLOW, radius=0.06)
            step = [FadeIn(dots, lag_ratio=0.02), FadeIn(point),
                    ChangeDecimalToValue(n_value, total), ChangeDecimalToValue(pi_value, estimate)]
            if previous is not None:
                step.append(Create(Line(previous.get_center(), point.get_center(), color=YELLOW, stroke_width=2)))
            self.play(*step, run_time=1.6)
            previous = point
            self.wait(0.3)
        self.wait()
