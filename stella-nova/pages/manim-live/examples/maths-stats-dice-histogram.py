# title: Rolling two dice
# topic: Probability & statistics
# level: 1
# scene: TwoDice
# summary: Rolls two dice more and more often and updates a bar chart of the share of each sum; the bars settle on the triangle of exact chances, with 7 the most likely.
# concepts: BarChart, change_bar_values, animate, ChangeDecimalToValue, Integer, np.random.default_rng

from manim import *

SUMS = list(range(2, 13))
EXACT = [(6 - abs(s - 7)) / 36 for s in SUMS]   # 1/36, 2/36, ..., 6/36, ..., 1/36
BATCHES = [20, 80, 400, 2000]                   # rolls added in each step
rng = np.random.default_rng(5)


def shares(counts):
    total = sum(counts)
    return [c / total for c in counts]


class TwoDice(Scene):
    def construct(self):
        counts = [0] * len(SUMS)

        def roll(n):
            a = rng.integers(1, 7, n)
            b = rng.integers(1, 7, n)
            for s in a + b:
                counts[s - 2] += 1

        roll(BATCHES[0])
        chart = BarChart(
            values=shares(counts),
            bar_names=[str(s) for s in SUMS],
            y_range=[0, 0.3, 0.05],
            x_length=10,
            y_length=5,
            bar_colors=[BLUE, TEAL],
            y_axis_config={"font_size": 22, "decimal_number_config": {"num_decimal_places": 2}},
            x_axis_config={"font_size": 30},
        ).to_edge(DOWN, buff=0.6)
        title = Text("share of each sum of two dice", font_size=30).to_edge(UP, buff=0.35)

        rolls = Integer(BATCHES[0], font_size=36)
        counter = VGroup(Text("rolls:", font_size=28), rolls).arrange(RIGHT).to_corner(UL, buff=0.4)
        counter.shift(DOWN * 0.8)  # below the title, left of the bars

        self.play(Write(title), Create(chart), FadeIn(counter))
        self.wait(0.5)

        total = BATCHES[0]
        for n in BATCHES[1:]:
            roll(n)
            total += n
            # change_bar_values stretches each bar to its new height.
            self.play(
                chart.animate.change_bar_values(shares(counts)),
                ChangeDecimalToValue(rolls, total),
                run_time=1.5,
            )
            self.wait(0.4)

        # The exact chances as short red marks on each bar.
        marks = VGroup(*[
            Line(LEFT * 0.35, RIGHT * 0.35, color=RED, stroke_width=5).move_to(chart.c2p(i + 0.5, p))
            for i, p in enumerate(EXACT)
        ])
        key = MathTex(r"\text{red: exact } P(7) = \tfrac{6}{36}", font_size=34, color=RED)
        key.to_edge(RIGHT, buff=0.4).match_y(counter)
        self.play(Create(marks), Write(key))
        self.wait()
