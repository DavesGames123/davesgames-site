# title: Laying out a flowchart
# topic: Basics
# level: 1
# scene: FlowchartLayout
# summary: Builds a three-step flowchart with arrange, next_to and to_edge, so you place things relative to each other instead of typing coordinates.
# concepts: VGroup, arrange, next_to, to_edge, RoundedRectangle, Arrow, FadeIn, GrowArrow

from manim import *


class FlowchartLayout(Scene):
    def construct(self):
        # A title pinned to the top edge of the frame
        title = Text("How a program runs", font_size=40).to_edge(UP)
        self.play(Write(title))

        # One helper makes every box the same size and style
        def box(label, color):
            frame = RoundedRectangle(width=3, height=1.4, corner_radius=0.2, color=color)
            frame.set_fill(color, opacity=0.15)
            text = Text(label, font_size=30).move_to(frame)
            return VGroup(frame, text)

        steps = VGroup(box("Input", BLUE), box("Process", YELLOW), box("Output", GREEN))
        # arrange() puts the boxes in a row with equal gaps (buff)
        steps.arrange(RIGHT, buff=1.2)

        # The arrows run from the right side of one box to the left side of the next
        arrows = VGroup(
            Arrow(steps[0].get_right(), steps[1].get_left(), buff=0.1),
            Arrow(steps[1].get_right(), steps[2].get_left(), buff=0.1),
        )

        for i, step in enumerate(steps):
            self.play(FadeIn(step, shift=UP * 0.3), run_time=0.6)
            if i < len(arrows):
                self.play(GrowArrow(arrows[i]), run_time=0.5)

        # next_to puts a note just below the middle box
        note = Text("next_to(box, DOWN)", font_size=24, color=GREY_B)
        note.next_to(steps[1], DOWN, buff=0.4)
        # to_edge pins the footer to the bottom of the frame
        footer = Text("arrange · next_to · to_edge", font_size=26, color=YELLOW)
        footer.to_edge(DOWN)
        self.play(FadeIn(note), FadeIn(footer))
        self.wait(1.5)
