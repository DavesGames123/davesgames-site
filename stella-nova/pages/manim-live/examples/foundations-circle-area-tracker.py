# title: Area grows with the square
# topic: Updaters & trackers
# level: 3
# scene: CircleAreaTracker
# summary: A radius tracker drives a circle, a live formula and a point on the graph of A = πr², which shows why doubling the radius gives four times the area.
# concepts: Variable, ValueTracker, always_redraw, Axes, plot, DecimalNumber, TracedPath

from manim import *


class CircleAreaTracker(Scene):
    def construct(self):
        # Variable bundles a label, an equals sign, a DecimalNumber and a ValueTracker
        r_var = Variable(0.5, MathTex("r", color=YELLOW), num_decimal_places=2)
        r = r_var.tracker
        area_num = DecimalNumber(0, num_decimal_places=2, color=TEAL)
        area_row = VGroup(MathTex(r"A = \pi r^2 =", color=TEAL), area_num).arrange(RIGHT)
        readouts = VGroup(r_var, area_row).arrange(DOWN, aligned_edge=LEFT).to_corner(UL)
        area_num.add_updater(lambda m: m.set_value(PI * r.get_value() ** 2).next_to(area_row[0], RIGHT))

        # Left: the circle itself, rebuilt from the tracker every frame
        centre = LEFT * 3.5 + DOWN * 0.8
        circle = always_redraw(lambda: Circle(radius=r.get_value(), color=TEAL, fill_opacity=0.35).move_to(centre))
        radius = always_redraw(lambda: Line(centre, centre + RIGHT * r.get_value(), color=YELLOW, stroke_width=5))

        # Right: the graph of A against r
        axes = Axes(x_range=[0, 2.2, 0.5], y_range=[0, 14, 2], x_length=5, y_length=5,
                    axis_config={"include_numbers": True, "font_size": 28}).to_edge(RIGHT, buff=0.6)
        labels = axes.get_axis_labels(MathTex("r", color=YELLOW), MathTex("A", color=TEAL))
        curve = axes.plot(lambda x: PI * x**2, x_range=[0, 2.05], color=GREY_B)
        point = always_redraw(lambda: Dot(axes.c2p(r.get_value(), PI * r.get_value() ** 2), color=TEAL))

        self.play(FadeIn(readouts), Create(axes), FadeIn(labels))
        self.add(circle, radius, point)
        self.play(Create(curve), run_time=1)

        # Mark r = 1, then r = 2: twice the radius
        self.play(r.animate.set_value(1), run_time=1.5)
        ring1 = Circle(radius=1, color=WHITE, stroke_width=2).move_to(centre)
        mark1 = DashedLine(axes.c2p(1, 0), axes.c2p(1, PI), color=WHITE)
        self.add(ring1, mark1)
        self.wait(0.4)
        self.play(r.animate.set_value(2), run_time=2.5)
        mark2 = DashedLine(axes.c2p(2, 0), axes.c2p(2, 4 * PI), color=WHITE)
        self.add(mark2)

        note = MathTex(r"2r \;\Rightarrow\; 4A", font_size=56, color=YELLOW).next_to(readouts, DOWN, buff=0.5, aligned_edge=LEFT)
        self.play(Write(note))
        self.wait(1.5)
