# title: The 68-95-99.7 rule
# topic: Probability & statistics
# level: 1
# scene: NormalRule
# summary: Shades the area under the normal curve within one, two and three standard deviations of the mean, which hold about 68%, 95% and 99.7% of all values.
# concepts: Axes, plot, get_area, NumberLine.add_labels, Brace, MathTex, Succession

from manim import *


def pdf(x):
    return np.exp(-x**2 / 2) / np.sqrt(TAU)


BANDS = [(1, "68.3\\%", BLUE), (2, "95.4\\%", TEAL), (3, "99.7\\%", GREEN)]


class NormalRule(Scene):
    def construct(self):
        axes = Axes(
            x_range=[-4, 4, 1],
            y_range=[0, 0.45, 0.1],
            x_length=11,
            y_length=4.4,
            tips=False,
            y_axis_config={"stroke_opacity": 0},
        ).to_edge(DOWN, buff=1.0)
        # Label the ticks with mu and sigma instead of plain numbers.
        names = {0: r"\mu"}
        for k in (1, 2, 3):
            mult = "" if k == 1 else str(k)   # write mu + sigma, not mu + 1 sigma
            names[k] = rf"\mu+{mult}\sigma"
            names[-k] = rf"\mu-{mult}\sigma"
        axes.get_x_axis().add_labels({x: MathTex(t, font_size=28) for x, t in names.items()})

        curve = axes.plot(pdf, x_range=[-4, 4], color=WHITE, stroke_width=4)
        title = Text("normal distribution", font_size=32).to_corner(UL, buff=0.4)

        self.play(Create(axes), Write(title))
        self.play(Create(curve), run_time=1.5)

        shown = VGroup()
        for k, percent, color in BANDS:
            # Draw the wider band behind the narrower ones.
            area = axes.get_area(curve, x_range=[-k, k], color=color, opacity=0.45)
            area.set_z_index(-k)
            brace = BraceBetweenPoints(axes.c2p(-k, 0.40 + 0.1 * (k - 1) / 2), axes.c2p(k, 0.40 + 0.1 * (k - 1) / 2), UP)
            label = MathTex(percent, color=color, font_size=34).next_to(brace, UP, buff=0.05)
            self.play(FadeIn(area), GrowFromCenter(brace), Write(label), run_time=1.5)
            shown.add(area, brace, label)
            self.wait(0.6)

        note = Text("almost every value lies within 3 sigma of the mean", font_size=24, color=GREY_A)
        note.to_corner(UR, buff=0.45)
        self.play(FadeIn(note))
        self.wait()
