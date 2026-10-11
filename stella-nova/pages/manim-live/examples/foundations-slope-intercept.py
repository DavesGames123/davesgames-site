# title: Colour-coded equation
# topic: Text & math
# level: 2
# scene: SlopeIntercept
# summary: Colours each symbol of y = mx + b and uses the same colour on the graph, so students link every letter to what it does.
# concepts: MathTex, tex_to_color_map, get_part_by_tex, Axes, plot, Indicate, ReplacementTransform

from manim import *


class SlopeIntercept(Scene):
    def construct(self):
        M_COL, B_COL = YELLOW, TEAL

        # tex_to_color_map isolates each listed substring and colours it
        eq = MathTex("y", "=", "m", "x", "+", "b", font_size=72,
                     tex_to_color_map={"m": M_COL, "b": B_COL})
        eq.to_corner(UL, buff=0.6)

        # Legend lines use the same colours as the symbols
        m_note = VGroup(MathTex("m", color=M_COL), Text("slope: rise over run", font_size=26)).arrange(RIGHT)
        b_note = VGroup(MathTex("b", color=B_COL), Text("where the line meets the y-axis", font_size=26)).arrange(RIGHT)
        legend = VGroup(m_note, b_note).arrange(DOWN, aligned_edge=LEFT).next_to(eq, DOWN, buff=0.5, aligned_edge=LEFT)

        axes = Axes(
            x_range=[-1, 4, 1], y_range=[-1, 6, 1], x_length=5.5, y_length=5.5,
            axis_config={"include_numbers": True, "font_size": 28},
        ).to_edge(RIGHT, buff=0.5)

        m, b = 1, 1
        line = axes.plot(lambda x: m * x + b, x_range=[-1, 4], color=WHITE)

        self.play(Write(eq))
        self.play(Create(axes), Create(line))
        self.wait(0.3)

        # b: the intercept dot
        intercept = Dot(axes.c2p(0, b), color=B_COL, radius=0.12)
        self.play(Indicate(eq.get_part_by_tex("b")), FadeIn(b_note))
        self.play(GrowFromCenter(intercept))

        # m: the slope triangle from x = 1 to x = 2
        p1, p2 = axes.c2p(1, m + b), axes.c2p(2, 2 * m + b)
        corner = axes.c2p(2, m + b)
        run = Line(p1, corner, color=M_COL)
        rise = Line(corner, p2, color=M_COL)
        run_label = Text("run 1", font_size=22, color=M_COL).next_to(run, DOWN, buff=0.1)
        rise_label = Text("rise 1", font_size=22, color=M_COL).next_to(rise, RIGHT, buff=0.1)
        self.play(Indicate(eq.get_part_by_tex("m")), FadeIn(m_note))
        self.play(Create(run), Create(rise), FadeIn(run_label), FadeIn(rise_label))
        self.wait(0.5)

        # Change m and b: a new equation with numbers, a new line
        eq2 = MathTex("y", "=", "2", "x", "+", "1", font_size=72).move_to(eq, aligned_edge=LEFT)
        eq2[2].set_color(M_COL)
        eq2[5].set_color(B_COL)
        line2 = axes.plot(lambda x: 2 * x + 1, x_range=[-1, 2.5], color=WHITE)
        rise2 = Line(axes.c2p(2, 3), axes.c2p(2, 5), color=M_COL)
        rise2_label = Text("rise 2", font_size=22, color=M_COL).next_to(rise2, RIGHT, buff=0.1)
        p_new = axes.c2p(1, 3)
        run2 = Line(p_new, axes.c2p(2, 3), color=M_COL)
        run2_label = Text("run 1", font_size=22, color=M_COL).next_to(run2, DOWN, buff=0.1)
        self.play(
            ReplacementTransform(eq, eq2),
            ReplacementTransform(line, line2),
            ReplacementTransform(rise, rise2), ReplacementTransform(rise_label, rise2_label),
            ReplacementTransform(run, run2), ReplacementTransform(run_label, run2_label),
            run_time=1.5,
        )
        self.wait(1.5)
