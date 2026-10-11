# title: Title card and section header
# topic: Explainer patterns
# level: 1
# scene: TitleCard
# summary: Opens a video with a title card, then shrinks the title into a section header and lists the plan, the opening that most explainer videos use.
# concepts: Text, Underline, VGroup, arrange, to_edge, to_corner, Transform, LaggedStart, FadeOut

from manim import *


class TitleCard(Scene):
    def construct(self):
        ACCENT = TEAL

        # 1. The title card: title, accent line, subtitle
        title = Text("Fractions", font_size=96, weight=BOLD)
        line = Line(LEFT * 3, RIGHT * 3, color=ACCENT, stroke_width=6)
        subtitle = Text("Lesson 3 · adding with unlike denominators", font_size=32, color=GREY_B)
        card = VGroup(title, line, subtitle).arrange(DOWN, buff=0.4)

        self.play(Write(title), run_time=1.2)
        self.play(GrowFromCenter(line), FadeIn(subtitle, shift=UP * 0.3))
        self.wait(1)

        # 2. The title moves to the top-left corner and becomes the header.
        #    A target copy is placed first, then Transform moves the title to it.
        header = Text("Fractions", font_size=40, weight=BOLD).to_corner(UL)
        header_line = Line(LEFT, RIGHT, color=ACCENT, stroke_width=4)
        header_line.set_width(header.width).next_to(header, DOWN, buff=0.12, aligned_edge=LEFT)
        self.play(
            Transform(title, header),
            Transform(line, header_line),
            FadeOut(subtitle, shift=DOWN * 0.3),
            run_time=1.2,
        )

        # 3. The plan: numbered steps that appear one after another
        steps = VGroup(*[
            VGroup(
                Text(str(i + 1), font_size=34, color=ACCENT, weight=BOLD),
                Text(step, font_size=34),
            ).arrange(RIGHT, buff=0.35)
            for i, step in enumerate([
                "Find a common denominator",
                "Rewrite both fractions",
                "Add the numerators",
                "Simplify the answer",
            ])
        ]).arrange(DOWN, aligned_edge=LEFT, buff=0.45).move_to(DOWN * 0.3)

        plan = Text("Today's plan", font_size=30, color=GREY_B).next_to(steps, UP, buff=0.5, aligned_edge=LEFT)
        self.play(FadeIn(plan))
        self.play(LaggedStart(*[FadeIn(s, shift=RIGHT * 0.4) for s in steps], lag_ratio=0.35), run_time=2.5)
        self.wait(0.5)

        # 4. Point at the first step before the lesson starts
        self.play(steps[0].animate.set_color(YELLOW), steps[1:].animate.set_opacity(0.4))
        self.wait(1.5)
