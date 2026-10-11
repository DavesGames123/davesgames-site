# title: Donut chart
# topic: Explainer patterns
# level: 2
# scene: DonutChart
# summary: Builds a donut chart of a monthly budget from AnnularSector pieces, labels each slice, and then pulls out the largest slice to make a point.
# concepts: AnnularSector, start_angle, angle, VGroup, Text, animate.shift, Indicate

from manim import *
import numpy as np

BUDGET = [("Rent", 40, "#4cc9f0"), ("Food", 20, "#f4d35e"), ("Transport", 12, "#e07a5f"),
          ("Savings", 15, "#80ed99"), ("Fun", 13, "#c77dff")]


class DonutChart(Scene):
    def construct(self):
        title = Text("Where a monthly budget goes", font_size=34).to_edge(UP, buff=0.3)
        centre = 2.2 * LEFT + 0.3 * DOWN
        total = sum(p for _, p, _ in BUDGET)

        slices, labels = VGroup(), VGroup()
        angle = PI / 2                      # start at 12 o'clock
        for name, part, color in BUDGET:
            sweep = -TAU * part / total     # negative angle = clockwise
            piece = AnnularSector(inner_radius=1.3, outer_radius=2.5, angle=sweep, start_angle=angle,
                                  color=color, fill_opacity=1, stroke_width=3, stroke_color=BLACK)
            piece.shift(centre)
            # put the percentage in the middle of the ring piece
            mid = angle + sweep / 2
            pct = Text(f"{part}%", font_size=24, color=BLACK).move_to(centre + 1.9 * np.array([np.cos(mid), np.sin(mid), 0]))
            slices.add(piece)
            labels.add(pct)
            angle += sweep

        # The legend on the right
        legend = VGroup(*[
            VGroup(Square(0.3, fill_color=c, fill_opacity=1, stroke_width=0), Text(n, font_size=26)).arrange(RIGHT, buff=0.25)
            for n, _, c in BUDGET
        ]).arrange(DOWN, aligned_edge=LEFT, buff=0.3).move_to(3.2 * RIGHT + 0.3 * DOWN)
        centre_text = Text(f"{total}%", font_size=34).move_to(centre)

        self.play(Write(title))
        self.play(LaggedStart(*[GrowFromPoint(s, centre) for s in slices], lag_ratio=0.25), run_time=2.5)
        self.play(FadeIn(labels), FadeIn(legend, shift=LEFT), Write(centre_text))
        self.wait(0.5)

        # Pull the biggest slice out along its middle direction
        big = 0
        mid = PI / 2 - TAU * BUDGET[big][1] / total / 2
        out = 0.35 * np.array([np.cos(mid), np.sin(mid), 0])
        self.play(slices[big].animate.shift(out), labels[big].animate.shift(out), Indicate(legend[big]))
        note = Text("Rent is the largest part", font_size=26, color=BUDGET[big][2]).next_to(legend, DOWN, buff=0.5)
        self.play(FadeIn(note))
        self.wait()
