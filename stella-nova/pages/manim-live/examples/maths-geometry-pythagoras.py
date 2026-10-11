# title: Pythagoras by rearrangement
# topic: Geometry
# level: 2
# scene: PythagorasRearrange
# summary: Slides the same four right triangles around inside one big square; the uncovered area is first c squared, then a squared plus b squared, so the two must be equal.
# concepts: Polygon, Square, VGroup, animate.shift, MathTex, Brace, LaggedStart

from manim import *

a, b = 1.8, 3.0      # the two legs; the hypotenuse is c = sqrt(a^2 + b^2)
s = a + b            # side of the big square
ORIGIN_BL = np.array([-6.0, -2.5, 0])  # bottom-left corner of the big square


def P(x, y):
    """A point in big-square coordinates (0..s, 0..s)."""
    return ORIGIN_BL + np.array([x, y, 0])


class PythagorasRearrange(Scene):
    def construct(self):
        frame = Square(side_length=s, color=WHITE).move_to(P(s / 2, s / 2))

        # Arrangement 1: one triangle in each corner, a tilted square in the middle.
        corners = [
            [P(0, 0), P(a, 0), P(0, b)],
            [P(s, 0), P(s, a), P(a, 0)],
            [P(s, s), P(b, s), P(s, a)],
            [P(0, s), P(0, b), P(b, s)],
        ]
        triangles = VGroup(
            *[Polygon(*pts, color=BLUE_D, fill_color=BLUE, fill_opacity=0.75, stroke_width=3) for pts in corners]
        )
        c_square = Polygon(P(a, 0), P(s, a), P(b, s), P(0, b), color=YELLOW, fill_opacity=0.35, stroke_width=0)
        c2 = MathTex("c^2", font_size=48).move_to(c_square)

        # Side labels with braces under and left of the big square.
        a_brace = Brace(Line(P(0, 0), P(a, 0)), DOWN, buff=0.1)
        b_brace = Brace(Line(P(a, 0), P(s, 0)), DOWN, buff=0.1)
        labels = VGroup(
            a_brace, a_brace.get_tex("a"), b_brace, b_brace.get_tex("b"),
            MathTex("c", font_size=36).move_to(P(a / 2, b / 2) + 0.25 * normalize(np.array([b, a, 0]))),
        )

        self.play(Create(frame), FadeIn(triangles, lag_ratio=0.2))
        self.play(FadeIn(c_square), Write(c2), FadeIn(labels))
        self.wait(1)

        # Arrangement 2: only translations, the triangles do not turn.
        self.play(FadeOut(c_square), FadeOut(c2), FadeOut(labels[4]))
        self.play(
            triangles[0].animate.shift(UP * a),                 # to the top-left rectangle
            triangles[2].animate.shift(LEFT * b),               # to the top-left rectangle
            triangles[3].animate.shift(RIGHT * a + DOWN * b),   # to the bottom-right rectangle
            run_time=2.5,
        )
        a_square = Square(side_length=a, color=GREEN, fill_opacity=0.4, stroke_width=0).move_to(P(a / 2, a / 2))
        b_square = Square(side_length=b, color=RED, fill_opacity=0.4, stroke_width=0).move_to(P(a + b / 2, a + b / 2))
        a2 = MathTex("a^2", font_size=40).move_to(a_square)
        b2 = MathTex("b^2", font_size=48).move_to(b_square)
        self.play(FadeIn(a_square), FadeIn(b_square), Write(a2), Write(b2))
        self.wait(0.5)

        # Same big square, same four triangles: the leftover areas match.
        reason = VGroup(
            Text("same big square", font_size=28),
            Text("minus the same four triangles", font_size=28),
            MathTex("a^2", "+", "b^2", "=", "c^2", font_size=64),
        ).arrange(DOWN, buff=0.4).to_edge(RIGHT, buff=0.9)
        reason[2][0].set_color(GREEN)
        reason[2][2].set_color(RED)
        reason[2][4].set_color(YELLOW)
        self.play(LaggedStart(*[FadeIn(r, shift=0.2 * UP) for r in reason], lag_ratio=0.5), run_time=2.5)
        self.wait()
