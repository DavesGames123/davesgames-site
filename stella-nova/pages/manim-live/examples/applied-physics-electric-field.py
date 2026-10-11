# title: Electric field of a dipole
# topic: Physics
# level: 3
# scene: DipoleField
# summary: Builds the field of a positive and a negative charge with Coulomb's law, shows it as an arrow field, then as flowing stream lines.
# concepts: ArrowVectorField, StreamLines, start_animation, Circle, color_scheme, Coulomb's law

from manim import *
import numpy as np

CHARGES = [(+1, np.array([-1.8, 0, 0])), (-1, np.array([1.8, 0, 0]))]


def field(p):
    # Coulomb's law: E = sum of q * r / |r|^3 over the charges
    e = np.zeros(3)
    for q, c in CHARGES:
        r = p - c
        d = max(np.linalg.norm(r), 0.35)  # avoid infinity at the charge
        e += q * r / d**3
    return e


class DipoleField(Scene):
    def construct(self):
        charges = VGroup()
        for q, c in CHARGES:
            color = RED if q > 0 else BLUE
            disc = Circle(0.3, color=color, fill_opacity=1).move_to(c)
            sign = MathTex("+" if q > 0 else "-", color=WHITE).move_to(c)
            charges.add(VGroup(disc, sign))

        title = MathTex(r"\vec E = \sum_i \frac{q_i\,\vec r_i}{|\vec r_i|^3}", font_size=36)
        title.to_corner(UL).add_background_rectangle(opacity=0.8)

        # 1. Arrows: direction and (clipped) length of E on a grid
        arrows = ArrowVectorField(
            field,
            x_range=[-7, 7, 0.7],
            y_range=[-4, 4, 0.7],
            length_func=lambda norm: 0.55 * sigmoid(norm),
            min_color_scheme_value=0,
            max_color_scheme_value=1.5,
            colors=[BLUE_E, TEAL, YELLOW],
        )
        # Drop the arrows that would sit on top of a charge
        near = [a for a in arrows if min(np.linalg.norm(a.get_center() - c) for _, c in CHARGES) < 0.6]
        arrows.remove(*near)

        self.play(FadeIn(charges))
        self.play(Write(title))
        self.play(LaggedStart(*[GrowArrow(a) for a in arrows], lag_ratio=0.002), run_time=2)
        self.bring_to_front(charges, title)
        self.wait(1)

        # 2. Stream lines: the paths a small positive test charge would follow
        lines = StreamLines(
            field,
            x_range=[-7, 7, 0.4],
            y_range=[-4, 4, 0.4],
            stroke_width=2,
            max_anchors_per_line=40,
            padding=1,
            min_color_scheme_value=0,
            max_color_scheme_value=1.5,
            colors=[BLUE_E, TEAL, YELLOW],
        )
        self.play(FadeOut(arrows))
        self.add(lines)
        self.bring_to_front(charges, title)
        lines.start_animation(warm_up=False, flow_speed=1.5)
        self.wait(5)
