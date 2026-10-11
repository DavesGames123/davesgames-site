# title: Projectile motion
# topic: Physics
# level: 2
# scene: ProjectileMotion
# summary: Launches a ball at 9 m/s and 50 degrees and draws its path, its velocity and the two velocity components, so you can see that only the vertical part changes.
# concepts: Axes, ValueTracker, always_redraw, TracedPath, Arrow, DecimalNumber, plot

from manim import *
import numpy as np

# Physics values (SI units)
G = 9.8                      # gravity, m/s^2
V0 = 9.0                     # launch speed, m/s
ANGLE = 50 * DEGREES         # launch angle
VX = V0 * np.cos(ANGLE)      # horizontal speed never changes
VY0 = V0 * np.sin(ANGLE)     # vertical speed at launch
T_FLIGHT = 2 * VY0 / G       # time until the ball lands again


class ProjectileMotion(Scene):
    def construct(self):
        axes = Axes(
            x_range=[0, 9, 1],
            y_range=[0, 3, 1],
            x_length=10,
            y_length=4,
            axis_config={"include_numbers": True, "font_size": 24},
            tips=False,
        ).to_edge(DOWN, buff=1.2)
        x_label = MathTex(r"x\ (\mathrm{m})", font_size=28).next_to(axes.x_axis, RIGHT)
        y_label = MathTex(r"y\ (\mathrm{m})", font_size=28).next_to(axes.y_axis, UP)

        # One number drives the whole scene: the time t since launch.
        t = ValueTracker(0)

        def position(time):
            # x grows at a constant rate, y follows a parabola
            return axes.c2p(VX * time, VY0 * time - 0.5 * G * time**2)

        ball = always_redraw(lambda: Dot(position(t.get_value()), radius=0.12, color=YELLOW))
        path = TracedPath(ball.get_center, stroke_color=YELLOW, stroke_width=3, stroke_opacity=0.6)

        scale = 0.12  # screen units per m/s, so the arrows fit on the screen

        def velocity_arrows():
            time = t.get_value()
            vy = VY0 - G * time
            start = position(time)
            return VGroup(
                Arrow(start, start + scale * VX * RIGHT, buff=0, color=BLUE, stroke_width=5),
                Arrow(start, start + scale * vy * UP, buff=0, color=RED, stroke_width=5),
                Arrow(start, start + scale * (VX * RIGHT + vy * UP), buff=0, color=WHITE, stroke_width=4),
            )

        arrows = always_redraw(velocity_arrows)

        # A small legend in the upper-left corner
        legend = VGroup(
            MathTex(r"v_x = \text{constant}", color=BLUE, font_size=30),
            MathTex(r"v_y = v_0 \sin\theta - g\,t", color=RED, font_size=30),
        ).arrange(DOWN, aligned_edge=LEFT).to_corner(UL)
        clock = VGroup(MathTex("t =", font_size=34), DecimalNumber(0, num_decimal_places=2, font_size=34), MathTex(r"\mathrm{s}", font_size=34))
        clock.arrange(RIGHT, buff=0.15).to_corner(UR)
        clock[1].add_updater(lambda m: m.set_value(t.get_value()))

        self.play(Create(axes), Write(x_label), Write(y_label))
        self.play(FadeIn(legend), FadeIn(clock))
        self.add(path, ball, arrows)
        self.wait(0.5)

        # Fly: move the time from 0 to the landing time
        self.play(t.animate.set_value(T_FLIGHT), run_time=4, rate_func=linear)
        self.wait(0.5)

        # Compare with the exact parabola y(x)
        curve = axes.plot(
            lambda x: np.tan(ANGLE) * x - G * x**2 / (2 * VX**2),
            x_range=[0, VX * T_FLIGHT],
            color=GREEN,
            stroke_width=2,
        )
        formula = MathTex(r"y = x\tan\theta - \frac{g\,x^2}{2 v_0^2 \cos^2\theta}", color=GREEN, font_size=32)
        formula.next_to(clock, DOWN, aligned_edge=RIGHT, buff=0.4)
        self.play(Create(curve), Write(formula))
        self.wait()
