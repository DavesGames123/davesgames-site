# title: Venn diagram with colour and fill
# topic: Basics
# level: 1
# scene: VennDiagram
# summary: Draws a two-set Venn diagram with see-through fills and lights up the overlap with Intersection, the most common diagram in a set-theory lesson.
# concepts: Circle, set_fill, set_stroke, fill_opacity, Intersection, Text, VGroup

from manim import *


class VennDiagram(Scene):
    def construct(self):
        # Two circles that overlap by a third of their width
        left = Circle(radius=2).shift(LEFT * 1.2)
        right = Circle(radius=2).shift(RIGHT * 1.2)

        # set_stroke styles the outline, set_fill the inside.
        # opacity < 1 lets the overlap show both colours.
        left.set_stroke(BLUE, width=4).set_fill(BLUE, opacity=0.3)
        right.set_stroke(RED, width=4).set_fill(RED, opacity=0.3)

        a_label = Text("Plays piano", font_size=28, color=BLUE).next_to(left, UP).shift(LEFT * 0.6)
        b_label = Text("Plays guitar", font_size=28, color=RED).next_to(right, UP).shift(RIGHT * 0.6)

        self.play(DrawBorderThenFill(left), Write(a_label))
        self.play(DrawBorderThenFill(right), Write(b_label))
        self.wait(0.5)

        # Intersection is a real boolean operation on the two shapes
        both = Intersection(left, right, color=YELLOW, fill_opacity=0.8, stroke_width=0)
        both_label = Text("both", font_size=30, color=BLACK).move_to(both)
        self.play(FadeIn(both), FadeIn(both_label))
        self.wait(0.5)

        # Fade the two outer parts back so the overlap stands out
        self.play(
            left.animate.set_fill(opacity=0.1),
            right.animate.set_fill(opacity=0.1),
        )
        caption = Text("A ∩ B: people who play both", font_size=30).to_edge(DOWN)
        self.play(Write(caption))
        self.wait(1.5)
