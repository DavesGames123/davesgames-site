# title: Kepler orbit
# topic: Physics
# level: 3
# scene: KeplerOrbit
# summary: Integrates Newton's gravity for a planet on an ellipse and shades the area swept in equal times, which shows Kepler's second law.
# concepts: add_updater, dt, TracedPath, Polygon, Arrow, always_redraw, numerical integration

from manim import *
import numpy as np

GM = 7.8                       # gravity strength of the star (screen units)
START = np.array([4.0, 0.0])   # start far from the star (aphelion)
V_START = np.array([0.0, 0.8])


class KeplerOrbit(Scene):
    def construct(self):
        star_pos = np.array([-1.6, -0.4, 0])
        star = Dot(star_pos, radius=0.22, color=YELLOW)
        glow = Dot(star_pos, radius=0.4, color=YELLOW).set_opacity(0.25)

        state = {"r": START.copy(), "v": V_START.copy(), "time": 0.0}

        def acceleration(r):
            return -GM * r / np.linalg.norm(r) ** 3

        def to_screen(r):
            return star_pos + np.array([r[0], r[1], 0])

        planet = Dot(to_screen(state["r"]), radius=0.12, color=BLUE)

        def step(mob, dt):
            # Velocity Verlet keeps the orbit closed over many turns
            n = 40
            h = dt / n
            for _ in range(n):
                a = acceleration(state["r"])
                state["r"] = state["r"] + state["v"] * h + 0.5 * a * h * h
                state["v"] = state["v"] + 0.5 * (a + acceleration(state["r"])) * h
            state["time"] += dt
            mob.move_to(to_screen(state["r"]))

        orbit = TracedPath(planet.get_center, stroke_color=BLUE_B, stroke_width=2)
        velocity = always_redraw(
            lambda: Arrow(
                planet.get_center(),
                planet.get_center() + 0.9 * np.array([*state["v"], 0]),
                buff=0,
                color=GREEN,
                stroke_width=4,
                max_tip_length_to_length_ratio=0.3,
            )
        )

        # Shade the area that the star-planet line sweeps in each 1.2 s
        wedges = VGroup()
        sweep = {"points": [planet.get_center()], "start": 0.0, "k": 0}

        def sweep_area(mob, dt):
            sweep["points"].append(planet.get_center())
            if state["time"] - sweep["start"] >= 1.2:
                # keep two wedges: one far from the star, one close to it
                if sweep["k"] in (0, 3):
                    color = TEAL if sweep["k"] == 0 else ORANGE
                    wedge = Polygon(star_pos, *sweep["points"], stroke_width=0,
                                    fill_color=color, fill_opacity=0.5)
                    mob.add(wedge)
                sweep["points"] = [planet.get_center()]
                sweep["start"] = state["time"]
                sweep["k"] += 1

        law = VGroup(
            Tex("Kepler's second law", font_size=36),
            Tex(r"Equal times $\Rightarrow$ equal areas", font_size=30, color=GREY_A),
        ).arrange(DOWN, aligned_edge=LEFT).to_corner(UL)
        legend = Tex(r"$\vec v$ = velocity", font_size=30, color=GREEN).next_to(law, DOWN, aligned_edge=LEFT)

        self.play(FadeIn(glow), GrowFromCenter(star), FadeIn(planet), Write(law))
        self.add(orbit, wedges, velocity)
        self.bring_to_front(star, planet)
        self.play(FadeIn(legend))
        planet.add_updater(step)
        wedges.add_updater(sweep_area)
        self.wait(9)
        planet.clear_updaters()
        wedges.clear_updaters()
        self.wait(0.5)
