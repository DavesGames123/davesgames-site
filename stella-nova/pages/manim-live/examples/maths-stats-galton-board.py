# title: Galton board
# topic: Probability & statistics
# level: 2
# scene: GaltonBoard
# summary: Drops 60 balls through eight rows of pegs; each bounce is a coin flip, and the piles in the bins grow into the bell shape of the binomial distribution.
# concepts: Dot, VMobject.set_points_as_corners, MoveAlongPath, LaggedStart, ParametricFunction, np.random.default_rng

from manim import *
from math import comb

ROWS = 8          # rows of pegs = number of left/right choices
BALLS = 60
DX, DY = 0.62, 0.42          # spacing of the pegs
TOP = 3.3                    # height of the first peg
FLOOR = -3.6                 # bottom of the bins
BALL_R = 0.09

rng = np.random.default_rng(3)


def peg_point(row, j):
    """Peg j (0..row) in row `row`; the rows make a triangle."""
    return np.array([(j - row / 2) * DX, TOP - row * DY, 0])


class GaltonBoard(Scene):
    def construct(self):
        pegs = VGroup(*[Dot(peg_point(r, j), radius=0.05, color=GREY_B)
                        for r in range(ROWS) for j in range(r + 1)])
        # Bin walls between the 9 possible end positions.
        walls = VGroup(*[Line([(k - ROWS / 2 - 0.5) * DX, FLOOR, 0], [(k - ROWS / 2 - 0.5) * DX, -0.2, 0],
                              color=GREY_D, stroke_width=2) for k in range(ROWS + 2)])
        floor = Line([-(ROWS / 2 + 0.5) * DX, FLOOR, 0], [(ROWS / 2 + 0.5) * DX, FLOOR, 0], color=GREY_B)
        title = VGroup(
            Text("Galton board", font_size=34),
            Text("each peg: left or right, 50/50", font_size=22, color=GREY_A),
        ).arrange(DOWN, aligned_edge=LEFT).to_corner(UL, buff=0.4)

        self.play(FadeIn(pegs, lag_ratio=0.02), Create(walls), Create(floor), FadeIn(title))

        counts = [0] * (ROWS + 1)
        balls, moves = VGroup(), []
        for _ in range(BALLS):
            j = 0
            points = [peg_point(0, 0) + UP * 0.4]
            for r in range(ROWS):
                points.append(peg_point(r, j) + UP * (BALL_R + 0.05))   # land on the peg
                j += int(rng.integers(0, 2))                            # 0 = left, 1 = right
            x = (j - ROWS / 2) * DX
            points.append(np.array([x, -0.4, 0]))                      # fall into bin j
            points.append(np.array([x, FLOOR + BALL_R * (2 * counts[j] + 1), 0]))
            counts[j] += 1

            ball = Dot(points[0], radius=BALL_R, color=YELLOW)
            path = VMobject().set_points_as_corners(points)
            balls.add(ball)
            moves.append(MoveAlongPath(ball, path, rate_func=linear))

        # LaggedStart starts each ball a little after the one before.
        self.play(LaggedStart(*moves, lag_ratio=0.12), run_time=8)
        self.wait(0.5)

        # Expected pile height: BALLS * C(8, k) / 2^8 balls in bin k.
        expected = ParametricFunction(
            lambda t: np.array([t * DX, FLOOR + 2 * BALL_R * BALLS * np.exp(-t**2 / 4) / np.sqrt(4 * PI), 0]),
            t_range=[-4.6, 4.6],
            color=RED,
            stroke_width=4,
        )
        note = MathTex(r"P(k) = \binom{8}{k}\frac{1}{2^8}", font_size=40)
        caption = VGroup(
            Text("red: the normal curve", font_size=22, color=RED),
            Text("with the same mean and spread", font_size=22, color=RED),
        ).arrange(DOWN, aligned_edge=LEFT, buff=0.12)
        VGroup(note, caption).arrange(DOWN, aligned_edge=LEFT, buff=0.3).to_corner(UR, buff=0.4)
        self.play(Create(expected), Write(note), FadeIn(caption))
        self.wait()
