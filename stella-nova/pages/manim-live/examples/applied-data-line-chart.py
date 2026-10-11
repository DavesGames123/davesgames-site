# title: Line chart with growth
# topic: Graphs & plots
# level: 1
# scene: SavingsGrowth
# summary: Compares a plain savings account with compound interest year by year, drawing both lines and labelling the gap at the end.
# concepts: Axes, plot_line_graph, vertex_dot_style, decimal_number_config, Create, DashedLine, next_to

from manim import *

YEARS = list(range(0, 21, 2))
START = 1000
SIMPLE = [START + 50 * y for y in YEARS]             # 5 % of the start each year
COMPOUND = [START * 1.05**y for y in YEARS]          # 5 % of the current amount


class SavingsGrowth(Scene):
    def construct(self):
        axes = Axes(
            x_range=[0, 20, 2],
            y_range=[0, 3000, 500],
            x_length=8.5,
            y_length=5.2,
            tips=False,
            axis_config={"include_numbers": True, "font_size": 22},
            y_axis_config={"decimal_number_config": {"num_decimal_places": 0}},
        ).shift(0.3 * DOWN + 0.6 * LEFT)
        x_title = Text("years", font_size=22, color=GREY_B).next_to(axes.x_axis, DOWN, buff=0.45)
        y_title = Text("balance ($)", font_size=22, color=GREY_B).next_to(axes.y_axis, UP, buff=0.2)
        title = Text("1000 dollars at 5 % a year", font_size=32).to_edge(UP, buff=0.3)

        simple = axes.plot_line_graph(YEARS, SIMPLE, line_color=BLUE, vertex_dot_radius=0.06,
                                      vertex_dot_style={"fill_color": BLUE})
        compound = axes.plot_line_graph(YEARS, COMPOUND, line_color=YELLOW, vertex_dot_radius=0.06,
                                        vertex_dot_style={"fill_color": YELLOW})

        simple_tag = Text("simple", font_size=24, color=BLUE).next_to(simple["line_graph"].get_end(), RIGHT)
        compound_tag = Text("compound", font_size=24, color=YELLOW).next_to(compound["line_graph"].get_end(), RIGHT)

        self.play(Write(title), Create(axes), FadeIn(x_title), FadeIn(y_title))
        self.play(Create(simple), run_time=2.5, rate_func=linear)
        self.play(FadeIn(simple_tag))
        self.play(Create(compound), run_time=2.5, rate_func=linear)
        self.play(FadeIn(compound_tag))

        # The gap between the two lines after 20 years
        top = axes.c2p(20, COMPOUND[-1])
        bottom = axes.c2p(20, SIMPLE[-1])
        gap_line = DashedLine(bottom, top, color=GREEN)
        gap = Text(f"+{COMPOUND[-1] - SIMPLE[-1]:.0f} dollars", font_size=24, color=GREEN)
        gap.next_to(gap_line, RIGHT, buff=0.15)
        self.play(Create(gap_line), Write(gap))
        self.wait()
