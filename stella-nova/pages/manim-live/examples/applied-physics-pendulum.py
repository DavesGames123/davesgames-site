# title: Pendulum with updaters
# topic: Physics
# level: 2
# scene: SwingingPendulum
# summary: Solves the pendulum equation one frame at a time inside an updater and plots the angle against time while the bob swings.
# concepts: add_updater, dt, Line, Dot, TracedPath, Axes, VMobject, set_points_as_corners

from manim import *
import numpy as np

G = 9.8          # gravity, m/s^2
LENGTH = 2.5     # rod length on screen (also used as metres)
THETA0 = 50 * DEGREES


class SwingingPendulum(Scene):
    def construct(self):
        # --- left: the pendulum -------------------------------------------
        pivot = np.array([-3.5, 2.5, 0])
        state = {"theta": THETA0, "omega": 0.0, "time": 0.0}

        def bob_position():
            th = state["theta"]
            return pivot + LENGTH * np.array([np.sin(th), -np.cos(th), 0])

        ceiling = Line(pivot + 1.2 * LEFT, pivot + 1.2 * RIGHT, color=GREY_B)
        rod = Line(pivot, bob_position(), color=GREY_A, stroke_width=4)
        bob = Dot(bob_position(), radius=0.2, color=BLUE)

        def step(mob, dt):
            # Semi-implicit Euler, split into small steps so it stays stable:
            # theta'' = -(g / L) * sin(theta)
            for _ in range(10):
                h = dt / 10
                state["omega"] += -(G / LENGTH) * np.sin(state["theta"]) * h
                state["theta"] += state["omega"] * h
            state["time"] += dt
            mob.move_to(bob_position())

        rod.add_updater(lambda m: m.put_start_and_end_on(pivot, bob.get_center()))
        trail = TracedPath(bob.get_center, stroke_color=BLUE, stroke_width=2, dissipating_time=0.6)

        # --- right: the angle against time ---------------------------------
        axes = Axes(
            x_range=[0, 8, 2],
            y_range=[-1, 1, 0.5],
            x_length=5.5,
            y_length=3.2,
            axis_config={"include_numbers": True, "font_size": 22},
            tips=False,
        ).to_edge(RIGHT, buff=0.6).shift(0.3 * DOWN)
        labels = axes.get_axis_labels(MathTex("t", font_size=30), MathTex(r"\theta\ (\mathrm{rad})", font_size=30))
        title = MathTex(r"\ddot\theta = -\frac{g}{L}\sin\theta", font_size=36).next_to(axes, UP, buff=0.4)

        samples = [axes.c2p(0, THETA0)]
        curve = VMobject(color=YELLOW, stroke_width=3)
        curve.set_points_as_corners([samples[0], samples[0]])

        def grow_curve(mob):
            # Add one point per frame: (time, angle)
            samples.append(axes.c2p(state["time"], state["theta"]))
            mob.set_points_as_corners(samples)

        self.add(ceiling)
        self.play(Create(axes), FadeIn(labels), Write(title), FadeIn(rod), FadeIn(bob))
        # Start the physics only now, so the bob stays still while it fades in
        self.add(trail)
        bob.add_updater(step)
        curve.add_updater(grow_curve)
        self.add(curve)
        self.wait(7.8)
        bob.clear_updaters()
        curve.clear_updaters()
        self.wait(0.5)
