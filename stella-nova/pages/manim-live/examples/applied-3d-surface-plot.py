# title: Surface plot of z = f(x, y)
# topic: 3D
# level: 2
# scene: SurfacePlot
# summary: Plots a two-variable function as a coloured surface on 3D axes, turns the camera around it, and keeps the formula fixed on screen.
# concepts: ThreeDScene, ThreeDAxes, plot_surface, colorscale, set_camera_orientation, move_camera, begin_ambient_camera_rotation, add_fixed_in_frame_mobjects

from manim import *
import numpy as np


class SurfacePlot(ThreeDScene):
    def construct(self):
        axes = ThreeDAxes(
            x_range=[-3, 3, 1],
            y_range=[-3, 3, 1],
            z_range=[-1.5, 1.5, 0.5],
            x_length=6,
            y_length=6,
            z_length=4,
        )
        labels = axes.get_axis_labels(MathTex("x"), MathTex("y"), MathTex("z"))

        def f(x, y):
            # a bump in the middle with a ripple around it
            r = np.sqrt(x**2 + y**2)
            return 1.2 * np.cos(1.6 * r) * np.exp(-0.25 * r**2)

        surface = axes.plot_surface(
            f,
            u_range=[-3, 3],
            v_range=[-3, 3],
            resolution=(24, 24),          # more = smoother, but slower to draw
            colorscale=[BLUE_E, TEAL, YELLOW, RED],
            fill_opacity=0.85,
            stroke_width=0.3,
        )

        # The formula stays flat on the screen while the camera moves
        formula = MathTex(r"z = 1.2\cos(1.6r)\,e^{-r^2/4}", font_size=36).to_corner(UL)
        self.add_fixed_in_frame_mobjects(formula)
        formula.set_opacity(0)

        self.set_camera_orientation(phi=70 * DEGREES, theta=-60 * DEGREES, zoom=1.0)
        self.play(Create(axes), FadeIn(labels))
        self.play(Create(surface), formula.animate.set_opacity(1), run_time=2)

        # Turn slowly around the z-axis, then look from straight above
        self.begin_ambient_camera_rotation(rate=0.35)
        self.wait(3)
        self.stop_ambient_camera_rotation()
        self.move_camera(phi=0, theta=-90 * DEGREES, run_time=2)
        self.wait(0.5)
        self.move_camera(phi=70 * DEGREES, theta=-45 * DEGREES, run_time=2)
        self.wait(0.5)
