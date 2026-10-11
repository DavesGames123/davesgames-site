# title: Two transforms in a row
# topic: Linear algebra
# level: 2
# scene: ComposeTransforms
# summary: Rotates the plane by 90 degrees, then shears it, then undoes both and does the same move with one matrix, the product, so you see that matrix multiplication means doing one transform after another.
# concepts: LinearTransformationScene, apply_matrix, apply_inverse, IntegerMatrix, leave_ghost_vectors

from manim import *

ROTATE = np.array([[0, -1], [1, 0]])   # 90 degrees counterclockwise
SHEAR = np.array([[1, 1], [0, 1]])     # slide each row to the right
PRODUCT = SHEAR @ ROTATE               # first ROTATE, then SHEAR (read right to left)


def matrix_card(name, matrix, color):
    label = MathTex(name, "=", font_size=40)
    label[0].set_color(color)
    m = IntegerMatrix(matrix, h_buff=0.9, v_buff=0.7).scale(0.7)
    card = VGroup(label, m).arrange(RIGHT)
    return card.add_background_rectangle(opacity=0.85, buff=0.15)


class ComposeTransforms(LinearTransformationScene):
    def __init__(self, **kwargs):
        # LinearTransformationScene takes its options in __init__.
        super().__init__(leave_ghost_vectors=True, **kwargs)

    def construct(self):
        rot_card = matrix_card("R", ROTATE, TEAL).to_corner(UL, buff=0.3)
        shear_card = matrix_card("S", SHEAR, ORANGE).next_to(rot_card, DOWN, aligned_edge=LEFT)
        prod_card = matrix_card("SR", PRODUCT, YELLOW).next_to(shear_card, DOWN, aligned_edge=LEFT)

        # Cards are added after the plane, so they are drawn on top of it and
        # do not move: apply_matrix moves only the plane and the vectors.
        # Wait once between a play() and apply_matrix: in ManimCE 0.22 the scene's
        # moving_mobjects list still holds what the last play() moved, and
        # LinearTransformationScene would try to move those pieces as well.
        self.play(FadeIn(rot_card))
        self.wait(0.5)
        self.apply_matrix(ROTATE, run_time=2)
        self.wait(0.5)

        self.play(FadeIn(shear_card))
        self.wait(0.5)
        self.apply_matrix(SHEAR, run_time=2)
        self.wait(0.5)

        # Go back to the start: the inverse of the product undoes both.
        self.apply_inverse(PRODUCT, run_time=1.5)
        self.play(FadeIn(prod_card))
        self.wait(0.5)
        # One matrix, one move, the same end result.
        self.apply_matrix(PRODUCT, run_time=2)
        self.wait()
