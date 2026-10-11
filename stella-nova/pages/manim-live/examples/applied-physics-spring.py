# title: Damped spring
# topic: Physics
# level: 2
# scene: DampedSpring
# summary: A mass on a spring loses energy to friction; the coil stretches with the mass and a graph traces x(t) inside its shrinking envelope.
# concepts: ValueTracker, always_redraw, VMobject, set_points_as_corners, Axes, plot, DashedVMobject

from manim import *
import numpy as np

AMPLITUDE = 1.2   # starting stretch
GAMMA = 0.35      # damping rate, 1/s
OMEGA = 2.6       # angular frequency, rad/s
DURATION = 8


def x_of(t):
    # Under-damped oscillator: x(t) = A e^(-gamma t) cos(omega t)
    return AMPLITUDE * np.exp(-GAMMA * t) * np.cos(OMEGA * t)


class DampedSpring(Scene):
    def construct(self):
        t = ValueTracker(0)

        # --- top: the wall, the spring and the mass --------------------------
        wall_x, rest_x, y = -5, 0, 1.8
        wall = Line([wall_x, y - 0.8, 0], [wall_x, y + 0.8, 0], stroke_width=6, color=GREY_B)
        floor = Line([wall_x, y - 0.45, 0], [3, y - 0.45, 0], color=GREY_D)
        rest_mark = DashedLine([rest_x, y - 0.8, 0], [rest_x, y + 0.8, 0], color=GREY_C)

        def spring():
            end = rest_x + x_of(t.get_value()) - 0.4  # left face of the block
            # a zig-zag of 14 teeth between two short straight leads
            lead, teeth = 0.3, 14
            xs = np.linspace(wall_x + lead, end - lead, 2 * teeth + 1)
            ys = [y + (0.25 if i % 2 else -0.25) * (0 < i < 2 * teeth) for i in range(2 * teeth + 1)]
            points = [[wall_x, y, 0]] + [[a, b, 0] for a, b in zip(xs, ys)] + [[end, y, 0]]
            return VMobject(color=GREY_A, stroke_width=3).set_points_as_corners(points)

        coil = always_redraw(spring)
        block = always_redraw(
            lambda: Square(0.8, color=BLUE, fill_opacity=0.8).move_to([rest_x + x_of(t.get_value()), y, 0])
        )

        # --- bottom: the graph of x(t) ---------------------------------------
        axes = Axes(
            x_range=[0, DURATION, 1],
            y_range=[-1.5, 1.5, 0.5],
            x_length=11,
            y_length=3,
            axis_config={"include_numbers": True, "font_size": 20},
            tips=False,
        ).to_edge(DOWN, buff=0.5)
        envelope = VGroup(
            DashedVMobject(axes.plot(lambda s: AMPLITUDE * np.exp(-GAMMA * s), color=RED_B), num_dashes=60),
            DashedVMobject(axes.plot(lambda s: -AMPLITUDE * np.exp(-GAMMA * s), color=RED_B), num_dashes=60),
        )
        law = MathTex(r"x(t) = A\,e^{-\gamma t}\cos(\omega t)", font_size=34).to_corner(UR)
        trace = always_redraw(
            lambda: axes.plot(x_of, x_range=[0, max(t.get_value(), 0.01)], color=YELLOW)
        )
        dot = always_redraw(lambda: Dot(axes.c2p(t.get_value(), x_of(t.get_value())), color=YELLOW))

        self.add(wall, floor, rest_mark)
        self.play(FadeIn(coil), FadeIn(block), Create(axes), Write(law))
        self.play(Create(envelope))
        self.add(trace, dot)
        self.play(t.animate.set_value(DURATION), run_time=DURATION, rate_func=linear)
        self.wait(0.5)
