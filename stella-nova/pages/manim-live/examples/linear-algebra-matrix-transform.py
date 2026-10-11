# title: A matrix moves the plane
# topic: Linear algebra
# level: 2
# scene: MatrixTransform
# summary: Applies a 2x2 matrix to the whole grid and to the basis vectors, so you see that the columns of the matrix are where i-hat and j-hat land.
# concepts: NumberPlane, Vector, Matrix, apply_matrix, MathTex, VGroup

from manim import *


class MatrixTransform(Scene):
    def construct(self):
        m = [[1, 1], [0.5, 1.5]]
        plane = NumberPlane(
            x_range=[-7, 7, 1],
            y_range=[-4, 4, 1],
            background_line_style={"stroke_opacity": 0.5},
        )
        i_hat = Vector([1, 0], color=GREEN)
        j_hat = Vector([0, 1], color=RED)
        matrix = Matrix(m, h_buff=1.2).to_corner(UL).add_background_rectangle()
        note = Text("columns = images of the basis vectors", font_size=26).to_corner(DL).add_background_rectangle()

        self.add(plane, i_hat, j_hat)
        self.play(Write(matrix), FadeIn(note))
        self.wait(0.5)
        # Every point p goes to M @ p; lines stay straight and parallel
        self.play(
            plane.animate.apply_matrix(m),
            i_hat.animate.put_start_and_end_on(ORIGIN, [m[0][0], m[1][0], 0]),
            j_hat.animate.put_start_and_end_on(ORIGIN, [m[0][1], m[1][1], 0]),
            run_time=2.5,
        )
        self.wait()
