# title: Parametric surfaces and a helix
# topic: 3D
# level: 3
# scene: ParametricShapes
# summary: Builds a sphere and a torus from the same (u, v) idea, morphs one into the other, and draws a helix on the torus with ParametricFunction.
# concepts: ThreeDScene, Surface, set_fill_by_checkerboard, ReplacementTransform, ParametricFunction, move_camera, add_fixed_in_frame_mobjects

from manim import *
import numpy as np

R, r = 2.0, 0.7  # torus: distance to the tube centre, tube radius


def sphere(u, v):
    # u goes around (longitude), v from pole to pole (latitude)
    return 1.8 * np.array([np.cos(u) * np.sin(v), np.sin(u) * np.sin(v), np.cos(v)])


def torus(u, v):
    # u goes around the big ring, v goes around the tube
    return np.array([(R + r * np.cos(v)) * np.cos(u), (R + r * np.cos(v)) * np.sin(u), r * np.sin(v)])


class ParametricShapes(ThreeDScene):
    def construct(self):
        self.set_camera_orientation(phi=65 * DEGREES, theta=30 * DEGREES)

        caption = Text("Sphere: (u, v) → point", font_size=28).to_corner(UL)
        self.add_fixed_in_frame_mobjects(caption)

        ball = Surface(sphere, u_range=[0, TAU], v_range=[0, PI], resolution=(24, 12))
        ball.set_fill_by_checkerboard(BLUE_D, BLUE_E, opacity=0.9)
        self.play(Create(ball), run_time=2)

        # Same grid of (u, v) values, a different formula: the sphere becomes a torus
        ring = Surface(torus, u_range=[0, TAU], v_range=[0, PI * 2], resolution=(24, 12))
        ring.set_fill_by_checkerboard(TEAL_D, TEAL_E, opacity=0.9)
        new_caption = Text("Torus: same grid, new formula", font_size=28).to_corner(UL)
        self.play(ReplacementTransform(ball, ring), FadeOut(caption), run_time=2)
        self.add_fixed_in_frame_mobjects(new_caption)
        self.play(FadeIn(new_caption))

        # A curve has one parameter t: wind 8 times round the tube while going once round the ring.
        # The Cairo renderer has no depth test for curves, so the back of the helix shows through.
        helix = ParametricFunction(
            lambda t: torus(t, 8 * t) * 1.02,  # 2 % outward so it sits on top of the surface
            t_range=[0, TAU, 0.01],
            color=YELLOW,
            stroke_width=4,
        )
        self.play(Create(helix), run_time=3)
        self.move_camera(phi=30 * DEGREES, theta=120 * DEGREES, run_time=2.5)
        self.wait()
