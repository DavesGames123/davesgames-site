# title: Polar roses
# topic: Graphs & plots
# level: 2
# scene: PolarRose
# summary: Draws r = 3 cos(k theta) on a polar grid with a moving radius, then changes k to show the petal rule: 2k petals when k is even, k petals when k is odd.
# concepts: PolarPlane, plot_polar_graph, polar_to_point, MoveAlongPath, always_redraw, ReplacementTransform

from manim import *


class PolarRose(Scene):
    def construct(self):
        plane = PolarPlane(
            radius_max=3,
            size=6.6,
            azimuth_step=8,  # one spoke every pi/4
            azimuth_units="PI radians",
            radius_config={"font_size": 20},
            background_line_style={"stroke_color": BLUE_E, "stroke_opacity": 0.6},
        ).add_coordinates()
        plane.to_edge(LEFT, buff=0.8)

        def rose(k, color):
            return plane.plot_polar_graph(
                lambda theta: 3 * np.cos(k * theta), [0, TAU], color=color, stroke_width=4
            )

        def label(k, rule):
            eq = MathTex(rf"r = 3\cos({k}\theta)", font_size=46)
            note = Text(rule, font_size=26, color=GREY_A)
            return VGroup(eq, note).arrange(DOWN, buff=0.3).to_edge(RIGHT, buff=1.0)

        rose2 = rose(2, YELLOW)
        text2 = label(2, "k = 2 is even: 4 petals")

        # A dot rides the curve; a line from the pole shows the radius r.
        dot = Dot(rose2.get_start(), color=WHITE)
        radius = always_redraw(
            lambda: Line(plane.get_origin(), dot.get_center(), color=ORANGE, stroke_width=3)
        )

        self.play(Create(plane), run_time=1.5)
        self.play(Write(text2))
        self.add(radius, dot)
        # Create the curve and move the dot over it in step.
        self.play(Create(rose2), MoveAlongPath(dot, rose2), run_time=4, rate_func=linear)
        self.wait(0.5)

        rose3 = rose(3, PINK)
        text3 = label(3, "k = 3 is odd: 3 petals")
        self.remove(radius, dot)
        self.play(ReplacementTransform(rose2, rose3), ReplacementTransform(text2, text3), run_time=2)
        self.wait()
