# title: Captioned picture proof
# topic: Explainer patterns
# level: 2
# scene: CaptionedProof
# summary: Shows a 3-4-5 right triangle with squares on its sides, colour-codes the sides and the formula a² + b² = c², and changes a caption at each step.
# concepts: Polygon, Square, RightAngle, MathTex, tex_to_color_map, TransformMatchingTex, FadeTransform, captions

from manim import *


class CaptionedProof(Scene):
    def construct(self):
        A_COL, B_COL, C_COL = BLUE, GREEN, ORANGE
        u = 0.55  # one unit of length on screen

        # Right angle at C; leg a is vertical (3 units), leg b is horizontal (4 units)
        C = np.array([0, 0, 0])
        A = np.array([4 * u, 0, 0])
        B = np.array([0, 3 * u, 0])
        tri = Polygon(C, A, B, color=WHITE, stroke_width=4)
        right = RightAngle(Line(C, A), Line(C, B), length=0.25, color=WHITE)

        # Squares on the three sides, built from their corner points
        n = np.array([3 * u, 4 * u, 0])  # outward normal of AB, same length as AB
        sq_a = Polygon(C, B, B + LEFT * 3 * u, C + LEFT * 3 * u, color=A_COL, fill_opacity=0.35)
        sq_b = Polygon(C, A, A + DOWN * 4 * u, C + DOWN * 4 * u, color=B_COL, fill_opacity=0.35)
        sq_c = Polygon(A, B, B + n, A + n, color=C_COL, fill_opacity=0.35)

        # Side names inside the triangle, each near its own side
        a_lab = MathTex("a", color=A_COL).move_to(C + np.array([0.2, 1.5 * u, 0]))
        b_lab = MathTex("b", color=B_COL).move_to(C + np.array([2.6 * u, 0.22, 0]))
        c_lab = MathTex("c", color=C_COL).move_to(C + np.array([1.8 * u, 1.35 * u, 0]))

        figure = VGroup(sq_a, sq_b, sq_c, tri, right, a_lab, b_lab, c_lab)
        figure.move_to(LEFT * 3 + UP * 0.25)

        # The caption bar: one helper makes every caption the same style
        caption = Text("A right triangle with sides 3, 4 and 5", font_size=30).to_edge(DOWN, buff=0.4)

        def recaption(text):
            nonlocal caption
            new = Text(text, font_size=30).to_edge(DOWN, buff=0.4)
            anim = FadeTransform(caption, new)
            caption = new
            return anim

        self.play(Create(tri), Create(right), FadeIn(caption))
        self.play(Write(a_lab), Write(b_lab), Write(c_lab))
        self.wait(0.5)

        # Areas of the squares, each in the colour of its side
        self.play(DrawBorderThenFill(sq_a), DrawBorderThenFill(sq_b), recaption("Draw a square on each side"))
        self.play(DrawBorderThenFill(sq_c))
        areas = VGroup(
            MathTex("9", color=A_COL).move_to(sq_a),
            MathTex("16", color=B_COL).move_to(sq_b),
            MathTex("25", color=C_COL).move_to(sq_c),
        ).scale(1.2)
        self.play(FadeIn(areas), recaption("Their areas are 9, 16 and 25"))
        self.wait(0.8)

        # The equation on the right, same colours as the picture
        colours = {"a^2": A_COL, "b^2": B_COL, "c^2": C_COL, "9": A_COL, "16": B_COL, "25": C_COL}
        numbers = MathTex("9", "+", "16", "=", "25", font_size=80, tex_to_color_map=colours).move_to(RIGHT * 3.5 + UP * 0.5)
        self.play(
            TransformFromCopy(areas[0], numbers[0]),
            TransformFromCopy(areas[1], numbers[2]),
            TransformFromCopy(areas[2], numbers[4]),
            FadeIn(numbers[1]), FadeIn(numbers[3]),
            recaption("The two small squares fill the big one"),
            run_time=1.5,
        )
        self.wait(0.8)

        letters = MathTex("a^2", "+", "b^2", "=", "c^2", font_size=80, tex_to_color_map=colours).move_to(numbers)
        self.play(TransformMatchingTex(numbers, letters), recaption("This holds for every right triangle"))
        self.play(Circumscribe(letters, color=WHITE))
        self.wait(1.5)
