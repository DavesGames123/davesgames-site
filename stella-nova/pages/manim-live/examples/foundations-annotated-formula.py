# title: Annotated formula
# topic: Text & math
# level: 2
# scene: AnnotatedFormula
# summary: Labels the parts of the quadratic formula with a brace, an arrow and a box, the usual way to explain what each piece of a formula means.
# concepts: MathTex, substrings_to_isolate, get_part_by_tex, Brace, get_text, Arrow, SurroundingRectangle

from manim import *


class AnnotatedFormula(Scene):
    def construct(self):
        # substrings_to_isolate makes each listed piece its own part,
        # even inside \frac and \sqrt, so we can point at it later.
        formula = MathTex(
            r"x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}",
            substrings_to_isolate=["b^2 - 4ac", r"\pm", "2a"],
            font_size=80,
        ).shift(DOWN * 0.4)
        disc = formula.get_part_by_tex("b^2 - 4ac")
        pm = formula.get_part_by_tex(r"\pm")
        denom = formula.get_part_by_tex("2a")

        title = Text("The quadratic formula", font_size=36).to_edge(UP)
        self.play(Write(title))
        self.play(Write(formula), run_time=2)
        self.wait(0.5)

        # 1. A brace over the discriminant; get_text puts a label on the brace
        brace = Brace(disc, UP, buff=0.15, color=YELLOW)
        disc_label = brace.get_text("discriminant").set_color(YELLOW)
        self.play(disc.animate.set_color(YELLOW), GrowFromCenter(brace))
        self.play(FadeIn(disc_label, shift=DOWN * 0.2))
        self.wait(0.5)

        # 2. An arrow from a note to the plus-or-minus sign
        pm_note = Text("two answers: + and −", font_size=28, color=TEAL)
        pm_note.move_to([pm.get_x() - 1.8, disc_label.get_y() + 0.2, 0])
        pm_arrow = Arrow(pm_note.get_bottom(), pm.get_top(), buff=0.1, color=TEAL)
        self.play(pm.animate.set_color(TEAL), FadeIn(pm_note), GrowArrow(pm_arrow))
        self.wait(0.5)

        # 3. A box around the denominator, with a note under it
        box = SurroundingRectangle(denom, color=ORANGE, buff=0.12)
        denom_note = Text("a cannot be 0", font_size=28, color=ORANGE).next_to(box, DOWN, buff=0.3)
        self.play(Create(box), denom.animate.set_color(ORANGE), FadeIn(denom_note))
        self.wait(2)
