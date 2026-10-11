# title: Bubble sort on bars
# topic: Algorithms
# level: 1
# scene: BubbleSort
# summary: Sorts seven bars by comparing neighbours and swapping them, so the largest value bubbles to the end on each pass.
# concepts: Rectangle, VGroup, animate, move_to, GrowFromEdge, LaggedStart, Text, set_color

from manim import *

VALUES = [5, 2, 7, 1, 6, 4, 3]
BAR_WIDTH = 0.9
GAP = 0.25


class BubbleSort(Scene):
    def construct(self):
        title = Text("Bubble sort", font_size=40).to_edge(UP)
        status = Text("Compare neighbours, swap if the left one is bigger", font_size=26, color=GREY_B)
        status.next_to(title, DOWN)

        # One bar per value: height grows with the value, the number sits on top
        def make_bar(v):
            rect = Rectangle(width=BAR_WIDTH, height=0.55 * v, fill_color=BLUE, fill_opacity=0.85, stroke_width=0)
            label = Text(str(v), font_size=26).next_to(rect, UP, buff=0.1)
            return VGroup(rect, label)

        bars = [make_bar(v) for v in VALUES]
        slots = [LEFT * (3 - i) * (BAR_WIDTH + GAP) + DOWN * 3 for i in range(len(VALUES))]

        def place(bar, i):
            # bottom of the bar sits on the base line at slot i
            return bar.animate.move_to(slots[i] + UP * bar.height / 2)

        for i, bar in enumerate(bars):
            bar.move_to(slots[i] + UP * bar.height / 2)
        floor = Line(slots[0] + LEFT * 0.8, slots[-1] + RIGHT * 0.8, color=GREY_D)

        self.play(Write(title), FadeIn(status), Create(floor))
        self.play(LaggedStart(*[GrowFromEdge(b, DOWN) for b in bars], lag_ratio=0.1))

        values = VALUES[:]
        n = len(values)
        for p in range(n - 1):
            for i in range(n - 1 - p):
                left, right = bars[i], bars[i + 1]
                # highlight the pair being compared
                self.play(left[0].animate.set_color(YELLOW), right[0].animate.set_color(YELLOW), run_time=0.12)
                if values[i] > values[i + 1]:
                    values[i], values[i + 1] = values[i + 1], values[i]
                    bars[i], bars[i + 1] = right, left
                    self.play(place(right, i), place(left, i + 1), run_time=0.25)
                self.play(left[0].animate.set_color(BLUE), right[0].animate.set_color(BLUE), run_time=0.08)
            # the last bar of this pass is in its final place
            self.play(bars[n - 1 - p][0].animate.set_color(GREEN), run_time=0.15)
        self.play(bars[0][0].animate.set_color(GREEN), run_time=0.15)

        done = Text("Sorted after n - 1 passes", font_size=26, color=GREEN).move_to(status)
        self.play(Transform(status, done))
        self.wait()
