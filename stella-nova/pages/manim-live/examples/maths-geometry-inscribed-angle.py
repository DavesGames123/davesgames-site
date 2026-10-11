# title: The inscribed angle theorem
# topic: Geometry
# level: 2
# scene: InscribedAngle
# summary: Moves a point P around a circle while measuring the angle APB; it never changes and is always half of the central angle AOB.
# concepts: Circle, Angle, Angle.get_value, ValueTracker, always_redraw, DecimalNumber, ArcBetweenPoints

from manim import *

CENTER = LEFT * 2.6
R = 2.8


def on_circle(degrees):
    t = degrees * DEGREES
    return CENTER + R * np.array([np.cos(t), np.sin(t), 0])


A, B = on_circle(200), on_circle(340)


class InscribedAngle(Scene):
    def construct(self):
        circle = Circle(radius=R, color=GREY_B).move_to(CENTER)
        # The arc AB that both angles "look at".
        arc = Arc(radius=R, start_angle=200 * DEGREES, angle=140 * DEGREES, arc_center=CENTER,
                  color=TEAL, stroke_width=7)
        o_dot = Dot(CENTER)
        o_lbl = MathTex("O", font_size=34).next_to(o_dot, UP, buff=0.15)
        a_lbl = MathTex("A", font_size=34).next_to(A, DL, buff=0.1)
        b_lbl = MathTex("B", font_size=34).next_to(B, DR, buff=0.1)
        radii = VGroup(Line(CENTER, A), Line(CENTER, B)).set_color(TEAL)
        # Angle(line1, line2) measures counterclockwise from line1 to line2.
        central = Angle(Line(CENTER, A), Line(CENTER, B), radius=0.55, color=TEAL)

        p_deg = ValueTracker(100)
        p_point = lambda: on_circle(p_deg.get_value())
        p_dot = always_redraw(lambda: Dot(p_point(), color=YELLOW))
        p_lbl = always_redraw(
            lambda: MathTex("P", font_size=34, color=YELLOW).move_to(p_point() + 0.35 * normalize(p_point() - CENTER))
        )
        chords = always_redraw(
            lambda: VGroup(Line(p_point(), A), Line(p_point(), B)).set_color(YELLOW)
        )
        inscribed = always_redraw(
            lambda: Angle(Line(p_point(), A), Line(p_point(), B), radius=0.6, color=YELLOW)
        )

        # Live readouts straight from Angle.get_value.
        ins_value = DecimalNumber(70, num_decimal_places=1, unit=r"^\circ", color=YELLOW)
        ins_value.add_updater(lambda d: d.set_value(inscribed.get_value(degrees=True)))
        cen_value = DecimalNumber(central.get_value(degrees=True), num_decimal_places=1, unit=r"^\circ", color=TEAL)
        rows = VGroup(
            VGroup(MathTex(r"\angle APB ="), ins_value).arrange(RIGHT),
            VGroup(MathTex(r"\angle AOB ="), cen_value).arrange(RIGHT),
        ).arrange(DOWN, aligned_edge=LEFT, buff=0.4).to_edge(RIGHT, buff=1.0).shift(UP * 1.2)
        ins_value.add_updater(lambda d: d.next_to(rows[0][0], RIGHT))

        self.play(Create(circle), FadeIn(o_dot, o_lbl))
        self.play(FadeIn(a_lbl, b_lbl), Create(arc))
        self.play(Create(radii), Create(central), FadeIn(rows[1]))
        self.play(FadeIn(p_dot, p_lbl), Create(chords), Create(inscribed), FadeIn(rows[0]))
        self.wait(0.5)
        # P moves, the angle at P stays the same.
        self.play(p_deg.animate.set_value(35), run_time=2.5)
        self.play(p_deg.animate.set_value(160), run_time=3.5)

        result = MathTex(r"\angle APB = \tfrac12\,\angle AOB", font_size=46).next_to(rows, DOWN, buff=0.8)
        self.play(Write(result))
        self.wait()
