# title: The determinant is an area
# topic: Linear algebra
# level: 2
# scene: DeterminantArea
# summary: Follows the unit square through two matrices; its new area equals the determinant, and a negative determinant shows up as the plane flipping over.
# concepts: LinearTransformationScene, add_unit_square, apply_matrix, apply_inverse, Matrix, np.linalg.det

from manim import *

A = np.array([[2, 1], [0.5, 1.5]])   # det = 2.5
B = np.array([[1, 2], [1, 0.5]])     # det = -1.5


def det_card(name, matrix):
    det = np.linalg.det(matrix)
    m = DecimalMatrix(matrix, element_to_mobject_config={"num_decimal_places": 1}).scale(0.65)
    top = VGroup(MathTex(f"{name} =", font_size=40), m).arrange(RIGHT)
    bottom = MathTex(rf"\det {name} = {det:.1f}", font_size=40, color=YELLOW)
    card = VGroup(top, bottom).arrange(DOWN, aligned_edge=LEFT)
    return card.add_background_rectangle(opacity=0.85, buff=0.15).to_corner(UL, buff=0.3)


class DeterminantArea(LinearTransformationScene):
    def __init__(self, **kwargs):
        super().__init__(show_coordinates=True, **kwargs)

    def construct(self):
        # The unit square has area 1 and is transformed with the plane.
        self.add_unit_square(color=YELLOW, opacity=0.4)
        start = Text("unit square: area 1", font_size=26).add_background_rectangle(opacity=0.85)
        start.to_corner(UL, buff=0.3)
        self.play(FadeIn(start))
        self.wait(0.5)

        card_a = det_card("A", A)
        # Wait once between a play() and apply_matrix: in ManimCE 0.22 the scene's
        # moving_mobjects list still holds what the last play() moved, and
        # LinearTransformationScene would try to move those pieces as well.
        self.play(FadeOut(start), FadeIn(card_a))
        self.wait(0.5)
        self.apply_matrix(A, run_time=2)
        area_a = Text("new area = 2.5", font_size=26, color=YELLOW).add_background_rectangle(opacity=0.85)
        area_a.next_to(card_a, DOWN, aligned_edge=LEFT)
        self.play(FadeIn(area_a))
        self.wait(1)

        self.apply_inverse(A, run_time=1.2)
        card_b = det_card("B", B)
        self.play(FadeOut(card_a), FadeOut(area_a), FadeIn(card_b))
        self.wait(0.5)
        # det < 0: green i-hat and red j-hat swap sides, the square is flipped.
        self.apply_matrix(B, run_time=2)
        flip = Text("area 1.5, and the plane is flipped", font_size=26, color=YELLOW)
        flip.add_background_rectangle(opacity=0.85).next_to(card_b, DOWN, aligned_edge=LEFT)
        self.play(FadeIn(flip))
        self.wait()
