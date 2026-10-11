# title: Staggered bar chart
# topic: Animation
# level: 2
# scene: StaggeredBars
# summary: Grows the bars of a survey chart one after another with LaggedStart and counts each value up, the standard way to reveal data in a video.
# concepts: LaggedStart, GrowFromEdge, Rectangle, Integer, ChangeDecimalToValue, Brace, Indicate

from manim import *


class StaggeredBars(Scene):
    def construct(self):
        data = [("Apple", 12, RED), ("Banana", 7, YELLOW), ("Grape", 15, PURPLE), ("Pear", 5, GREEN)]
        unit = 0.26  # height of one vote on screen

        title = Text("Favourite fruit (40 votes)", font_size=34).to_edge(UP)
        baseline = Line(LEFT * 5, RIGHT * 5, color=GREY_B).shift(DOWN * 2.6)

        bars, names, counts = VGroup(), VGroup(), VGroup()
        for i, (name, value, color) in enumerate(data):
            x = -3.6 + i * 2.4
            bar = Rectangle(width=1.4, height=value * unit, color=color, fill_opacity=0.8)
            # Stand the bar on the baseline
            bar.move_to([x, 0, 0]).align_to(baseline, DOWN)
            bars.add(bar)
            names.add(Text(name, font_size=26).next_to(bar, DOWN, buff=0.2))
            # The number starts at 0 and counts up while the bar grows
            counts.add(Integer(0, font_size=44).next_to(bar, UP, buff=0.15))

        self.play(Write(title), Create(baseline), FadeIn(names))

        # LaggedStart: each bar starts growing 30% of the way into the previous one.
        # GrowFromEdge grows from the bottom edge, like a real bar.
        self.play(
            LaggedStart(*[GrowFromEdge(bar, DOWN) for bar in bars], lag_ratio=0.3),
            LaggedStart(*[
                ChangeDecimalToValue(count, value) for count, (_, value, _) in zip(counts, data)
            ], lag_ratio=0.3),
            run_time=3,
        )
        self.wait(0.5)

        # Point at the winner
        self.play(Indicate(bars[2], color=WHITE), Indicate(counts[2]))
        winner = Text("Most popular", font_size=26, color=PURPLE).next_to(counts[2], UP, buff=0.2)
        self.play(FadeIn(winner, shift=DOWN * 0.2))
        self.wait(1.5)
