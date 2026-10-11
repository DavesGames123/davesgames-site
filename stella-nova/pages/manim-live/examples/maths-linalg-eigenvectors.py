# title: Eigenvectors stay on their line
# topic: Linear algebra
# level: 3
# scene: Eigenvectors
# summary: Applies a matrix to a fan of vectors; most of them turn off their own line, but the two eigenvectors only stretch, by their eigenvalues 3 and 2.
# concepts: LinearTransformationScene, add_vector, apply_matrix, DashedLine, Matrix

from manim import *

M = np.array([[3, 1], [0, 2]])
# Eigen pairs of M: M @ v = lambda * v
EIGEN = [(np.array([1, 0]), 3), (np.array([-1, 1]), 2)]
OTHERS = [np.array([1, 1]), np.array([0, 1]), np.array([-1, -0.5])]


def span_line(v, color):
    """The whole line through 0 in the direction v (the span of v)."""
    d = np.array([v[0], v[1], 0]) / np.linalg.norm(v)
    return DashedLine(-9 * d, 9 * d, color=color, stroke_width=2, dash_length=0.15)


class Eigenvectors(LinearTransformationScene):
    def __init__(self, **kwargs):
        super().__init__(show_basis_vectors=False, **kwargs)

    def construct(self):
        card = VGroup(MathTex("M =", font_size=40), IntegerMatrix(M).scale(0.7)).arrange(RIGHT)
        card.add_background_rectangle(opacity=0.85, buff=0.15).to_corner(UL, buff=0.3)

        # The span lines are NOT transformable: they show where an
        # eigenvector must still be after the matrix acts.
        spans = VGroup(*[span_line(v, YELLOW) for v, _ in EIGEN])
        self.play(FadeIn(card), Create(spans))

        # add_vector puts the arrow in the list of vectors that move with the plane.
        eigen_arrows = [self.add_vector(v, color=YELLOW, animate=False) for v, _ in EIGEN]
        other_arrows = [self.add_vector(v, color=BLUE_B, animate=False) for v in OTHERS]
        self.play(*[GrowArrow(a) for a in eigen_arrows + other_arrows])
        self.wait(0.5)

        self.apply_matrix(M, run_time=3)
        self.wait(0.5)

        # Label each eigenvector with its stretch factor.
        tags = VGroup()
        for arrow, (v, lam) in zip(eigen_arrows, EIGEN):
            tag = MathTex(rf"\lambda = {lam}", color=YELLOW, font_size=36)
            tag.add_background_rectangle(opacity=0.85)
            tag.next_to(arrow.get_end(), UP + RIGHT * np.sign(v[0]), buff=0.15)
            tags.add(tag)
        note = Text("eigenvectors only stretch; the blue ones turn", font_size=24)
        note.add_background_rectangle(opacity=0.85).to_edge(DOWN, buff=0.3)
        self.play(FadeIn(tags), FadeIn(note))
        self.wait()
