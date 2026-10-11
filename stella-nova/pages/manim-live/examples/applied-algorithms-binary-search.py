# title: Binary search
# topic: Algorithms
# level: 1
# scene: BinarySearch
# summary: Finds 23 in a sorted list of 15 numbers by looking at the middle and throwing away half of the list each time.
# concepts: Square, VGroup.arrange, Arrow, Text, animate.set_opacity, SurroundingRectangle

from manim import *

DATA = [2, 5, 8, 12, 16, 23, 38, 41, 47, 56, 61, 72, 80, 91, 99]
TARGET = 23


class BinarySearch(Scene):
    def construct(self):
        title = Text(f"Binary search for {TARGET}", font_size=38).to_edge(UP)

        # A row of boxes with the value inside and the index below
        cells = VGroup()
        for i, v in enumerate(DATA):
            box = Square(0.8, stroke_color=GREY_B)
            value = Text(str(v), font_size=24).move_to(box)
            index = Text(str(i), font_size=16, color=GREY_C).next_to(box, DOWN, buff=0.1)
            cells.add(VGroup(box, value, index))
        cells.arrange(RIGHT, buff=0.05).shift(0.3 * UP)

        def pointer(i, name, color, direction):
            # an arrow with a name above or below cell i
            box = cells[i][0]
            if direction is UP:
                arrow = Arrow(box.get_top() + 0.9 * UP, box.get_top(), buff=0.05, color=color)
                tag = Text(name, font_size=22, color=color).next_to(arrow, UP, buff=0.05)
            else:
                start = cells[i][2].get_bottom()
                arrow = Arrow(start + 0.9 * DOWN, start, buff=0.05, color=color)
                tag = Text(name, font_size=22, color=color).next_to(arrow, DOWN, buff=0.05)
            return VGroup(arrow, tag)

        log = Text("", font_size=26).to_edge(DOWN)

        self.play(Write(title), FadeIn(cells, lag_ratio=0.05))

        lo, hi = 0, len(DATA) - 1
        lo_ptr = pointer(lo, "lo", BLUE, DOWN)
        hi_ptr = pointer(hi, "hi", BLUE, DOWN)
        self.play(FadeIn(lo_ptr), FadeIn(hi_ptr))
        step = 1
        while lo <= hi:
            mid = (lo + hi) // 2
            mid_ptr = pointer(mid, "mid", YELLOW, UP)
            new_log = Text(f"Step {step}: look at index {mid}, value {DATA[mid]}", font_size=26).to_edge(DOWN)
            self.play(FadeIn(mid_ptr), Transform(log, new_log), cells[mid][0].animate.set_stroke(YELLOW, 4))
            self.wait(0.4)
            if DATA[mid] == TARGET:
                found = SurroundingRectangle(cells[mid], color=GREEN, buff=0.08)
                self.play(Create(found), cells[mid][1].animate.set_color(GREEN))
                self.play(Transform(log, Text(f"Found {TARGET} at index {mid} in {step} steps", font_size=26, color=GREEN).to_edge(DOWN)))
                break
            # Throw away the half that cannot hold the target
            if DATA[mid] < TARGET:
                dropped = cells[lo:mid + 1]
                lo = mid + 1
            else:
                dropped = cells[mid:hi + 1]
                hi = mid - 1
            self.play(
                dropped.animate.set_opacity(0.2).set_stroke(GREY_B),
                FadeOut(mid_ptr),
                Transform(lo_ptr, pointer(lo, "lo", BLUE, DOWN)),
                Transform(hi_ptr, pointer(hi, "hi", BLUE, DOWN)),
            )
            step += 1
        self.wait()
