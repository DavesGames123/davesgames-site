# title: Bar chart race
# topic: Explainer patterns
# level: 2
# scene: BarChartRace
# summary: Animates the yearly share of five energy sources with BarChart.change_bar_values, the classic chart for a story that changes over time.
# concepts: BarChart, change_bar_values, get_bar_labels, bar_names, bar_colors, Transform

from manim import *

SOURCES = ["Coal", "Gas", "Nuclear", "Wind", "Solar"]
# Illustrative shares in percent for a made-up country, not real data
YEARS = {
    2000: [52, 22, 20, 4, 2],
    2005: [48, 26, 19, 5, 2],
    2010: [42, 30, 18, 7, 3],
    2015: [34, 33, 17, 11, 5],
    2020: [22, 35, 16, 17, 10],
    2025: [12, 31, 15, 24, 18],
}
COLORS = ["#6b6b6b", "#e07a5f", "#9d4edd", "#4cc9f0", "#f4d35e"]


class BarChartRace(Scene):
    def construct(self):
        first = list(YEARS)[0]
        chart = BarChart(
            values=YEARS[first],
            bar_names=SOURCES,
            y_range=[0, 60, 10],
            y_length=5,
            x_length=9,
            bar_colors=COLORS,
            bar_fill_opacity=0.9,
            bar_stroke_width=0,
            y_axis_config={"font_size": 24},
            x_axis_config={"font_size": 28},
        ).shift(0.4 * DOWN + 0.3 * RIGHT)
        y_title = Text("share of electricity (%)", font_size=22, color=GREY_B).rotate(PI / 2).next_to(chart.y_axis, LEFT)
        title = Text("Where the power comes from", font_size=34).to_edge(UP, buff=0.3)
        year = Text(str(first), font_size=60, color=GREY_A).to_corner(UR).shift(0.9 * DOWN)

        # A number above each bar; we rebuild it after every change
        labels = chart.get_bar_labels(font_size=26)

        self.play(Write(title), Create(chart), FadeIn(y_title), FadeIn(year))
        self.play(FadeIn(labels))

        for y, values in list(YEARS.items())[1:]:
            new_year = Text(str(y), font_size=60, color=GREY_A).move_to(year)
            # change_bar_values reshapes the bars; .animate makes it smooth
            self.play(
                chart.animate.change_bar_values(values),
                FadeOut(labels),
                Transform(year, new_year),
                run_time=1.3,
            )
            labels = chart.get_bar_labels(font_size=26)
            self.add(labels)
            self.wait(0.4)

        note = Text("Illustrative numbers, not real data", font_size=20, color=GREY_C).next_to(title, DOWN, buff=0.15)
        self.play(FadeIn(note))
        self.wait()
