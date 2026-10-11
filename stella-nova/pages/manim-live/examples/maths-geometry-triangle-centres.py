# title: Triangle centres and the Euler line
# topic: Geometry
# level: 3
# scene: TriangleCentres
# summary: Builds the centroid from the medians, the circumcentre from the perpendicular bisectors and the orthocentre from the altitudes, then drags a vertex to show the three always lie on one line.
# concepts: Polygon, Circle, DashedLine, always_redraw, ValueTracker, line_intersection, LaggedStart

from manim import *

A = np.array([-6.2, -2.0, 0])
B = np.array([-1.4, -2.0, 0])
cx, cy = ValueTracker(-3.6), ValueTracker(1.7)   # vertex C can move


def C():
    return np.array([cx.get_value(), cy.get_value(), 0])


def circumcentre(p, q, r):
    """Point at equal distance from p, q and r (solve two linear equations)."""
    m = np.array([[q[0] - p[0], q[1] - p[1]], [r[0] - p[0], r[1] - p[1]]]) * 2
    rhs = np.array([q @ q - p @ p, r @ r - p @ p])
    x, y = np.linalg.solve(m, rhs)
    return np.array([x, y, 0])


def centres():
    c = C()
    G = (A + B + c) / 3                 # centroid
    O = circumcentre(A, B, c)           # circumcentre
    H = A + B + c - 2 * O               # orthocentre (vector identity)
    return G, O, H


def foot(p, q, r):
    """Foot of the perpendicular from p to the line qr."""
    d = normalize(r - q)
    return q + np.dot(p - q, d) * d


class TriangleCentres(Scene):
    def construct(self):
        tri = always_redraw(lambda: Polygon(A, B, C(), color=WHITE, stroke_width=4))
        names = always_redraw(lambda: VGroup(
            MathTex("A", font_size=32).next_to(A, DL, buff=0.1),
            MathTex("B", font_size=32).next_to(B, DR, buff=0.1),
            MathTex("C", font_size=32).next_to(C(), UP, buff=0.15),
        ))

        def medians():
            c = C()
            return VGroup(*[Line(v, (w + u) / 2, color=GREEN, stroke_width=2)
                            for v, w, u in ((A, B, c), (B, c, A), (c, A, B))])

        def bisectors():
            G, O, H = centres()
            return VGroup(*[DashedLine((v + w) / 2, O, color=BLUE, stroke_width=2)
                            for v, w in ((A, B), (B, C()), (C(), A))])

        def altitudes():
            c = C()
            return VGroup(*[Line(v, foot(v, w, u), color=RED, stroke_width=2)
                            for v, w, u in ((A, B, c), (B, c, A), (c, A, B))])

        g_dot = always_redraw(lambda: Dot(centres()[0], color=GREEN, radius=0.09))
        o_dot = always_redraw(lambda: Dot(centres()[1], color=BLUE, radius=0.09))
        h_dot = always_redraw(lambda: Dot(centres()[2], color=RED, radius=0.09))
        circ = always_redraw(lambda: Circle(radius=np.linalg.norm(A - centres()[1]), color=BLUE,
                                            stroke_width=2).move_to(centres()[1]))

        legend = VGroup(
            Text("G centroid: medians meet", font_size=22, color=GREEN),
            Text("O circumcentre: perpendicular bisectors meet", font_size=22, color=BLUE),
            Text("H orthocentre: altitudes meet", font_size=22, color=RED),
            Text("Euler line: O, G and H in one line", font_size=22, color=YELLOW),
        ).arrange(DOWN, aligned_edge=LEFT, buff=0.4).to_edge(RIGHT, buff=0.5)

        self.play(Create(tri), FadeIn(names))
        med = medians()
        self.play(Create(med), FadeIn(legend[0]))
        self.play(FadeIn(g_dot, scale=2))
        bis = bisectors()
        self.play(Create(bis), FadeIn(legend[1]))
        self.play(FadeIn(o_dot, scale=2), Create(circ))
        alt = altitudes()
        self.play(Create(alt), FadeIn(legend[2]))
        self.play(FadeIn(h_dot, scale=2))
        self.wait(0.5)

        # Clear the construction lines, keep the three centres.
        self.play(FadeOut(med, bis, alt))

        def euler_line():
            G, O, H = centres()
            d = normalize(H - O)
            return Line(O - 1.2 * d, H + 1.2 * d, color=YELLOW, stroke_width=3)

        euler = always_redraw(euler_line)
        self.add(euler, g_dot, o_dot, h_dot)
        self.play(FadeIn(legend[3]))
        # Drag C: the three centres move, but stay on one line.
        self.play(cx.animate.set_value(-2.2), cy.animate.set_value(1.2), run_time=2)
        self.play(cx.animate.set_value(-4.6), cy.animate.set_value(2.0), run_time=2.5)
        self.wait()
