# title: Solving an equation step by step
# topic: Explainer patterns
# level: 2
# scene: SolveStepByStep
# summary: Solves 3x + 5 = 20 with TransformMatchingTex so each symbol slides to its new place, with a caption that names every step and a check at the end.
# concepts: MathTex, TransformMatchingTex, double-brace parts, set_color_by_tex, FadeTransform, Circumscribe

from manim import *


class SolveStepByStep(Scene):
    def construct(self):
        # Write each equation as separate parts (double braces, with a space
        # before each opening pair, or manim does not split there).
        # TransformMatchingTex moves parts with the same TeX to each other,
        # and fades in or out the parts that have no match.
        steps = [
            (r"{{3}} {{x}} {{+}} {{5}} {{=}} {{20}}", "Start"),
            (r"{{3}} {{x}} {{+}} {{5}} {{-}} {{5}} {{=}} {{20}} {{-}} {{5}}", "Subtract 5 from both sides"),
            (r"{{3}} {{x}} {{=}} {{15}}", "Simplify"),
            (r"{{3}} {{x}} {{\div}} {{3}} {{=}} {{15}} {{\div}} {{3}}", "Divide both sides by 3"),
            (r"{{x}} {{=}} {{5}}", "Solution"),
        ]

        def make_eq(tex):
            eq = MathTex(tex, font_size=84)
            # set_color_by_tex colours every part whose TeX is exactly "x",
            # which is why "3" and "x" are separate parts
            eq.set_color_by_tex("x", YELLOW)
            return eq

        def make_caption(text):
            return Text(text, font_size=34, color=GREY_A).to_edge(DOWN, buff=1)

        counter = Text("Step 1 of 5", font_size=26, color=GREY_B).to_corner(UR)
        eq = make_eq(steps[0][0])
        caption = make_caption(steps[0][1])
        self.play(Write(eq), FadeIn(caption), FadeIn(counter))
        self.wait(0.8)

        for i, (tex, words) in enumerate(steps[1:], start=2):
            new_eq = make_eq(tex)
            new_caption = make_caption(words)
            new_counter = Text(f"Step {i} of 5", font_size=26, color=GREY_B).to_corner(UR)
            self.play(
                TransformMatchingTex(eq, new_eq),
                FadeTransform(caption, new_caption),
                FadeTransform(counter, new_counter),
                run_time=1.4,
            )
            eq, caption, counter = new_eq, new_caption, new_counter
            self.wait(0.7)

        # Box the answer
        self.play(Circumscribe(eq, color=YELLOW, buff=0.2))

        # Check: put x = 5 back into the first equation
        check = MathTex(r"3(5) + 5 = 20 \;\checkmark", font_size=48, color=GREEN).next_to(eq, DOWN, buff=0.6)
        self.play(Write(check))
        self.wait(1.5)
