# title: Wave superposition
# topic: Physics
# level: 1
# scene: WaveSuperposition
# summary: Adds two travelling waves point by point; when their frequencies are close the sum shows beats, the effect a musician hears when tuning.
# concepts: Axes, plot, ValueTracker, always_redraw, MathTex, VGroup.arrange

from manim import *
import numpy as np


class WaveSuperposition(Scene):
    def construct(self):
        phase = ValueTracker(0)   # time, moves the waves to the right
        k2 = ValueTracker(2.0)    # wave number of the second wave

        def make_axes():
            return Axes(
                x_range=[0, 4 * PI, PI],
                y_range=[-2, 2, 1],
                x_length=9.5,
                y_length=1.6,
                tips=False,
                axis_config={"stroke_opacity": 0.5},
            )

        # Three rows of axes, one above the other
        rows = VGroup(make_axes(), make_axes(), make_axes()).arrange(DOWN, buff=0.55).shift(0.6 * RIGHT + 0.2 * DOWN)
        top, mid, bottom = rows

        def wave1(x):
            return np.sin(2.0 * x - 3 * phase.get_value())

        def wave2(x):
            return np.sin(k2.get_value() * x - 3 * phase.get_value())

        w1 = always_redraw(lambda: top.plot(wave1, color=BLUE))
        w2 = always_redraw(lambda: mid.plot(wave2, color=GREEN))
        total = always_redraw(lambda: bottom.plot(lambda x: wave1(x) + wave2(x), color=YELLOW))

        names = VGroup(
            MathTex(r"y_1", color=BLUE).next_to(top, LEFT),
            MathTex(r"y_2", color=GREEN).next_to(mid, LEFT),
            MathTex(r"y_1 + y_2", color=YELLOW).next_to(bottom, LEFT),
        )
        caption = Tex("Same frequency: the waves add up", font_size=36).to_edge(UP, buff=0.3)

        self.play(Create(rows), FadeIn(names), Write(caption))
        self.add(w1, w2, total)
        # Equal waves in step: the sum is twice as tall
        self.play(phase.animate.set_value(1), run_time=2, rate_func=linear)

        # Change the second wave a little: beats appear in the sum
        new_caption = Tex("Close frequencies: beats", font_size=36).move_to(caption)
        self.play(
            k2.animate.set_value(2.5),
            phase.animate.set_value(2),
            Transform(caption, new_caption),
            run_time=2,
            rate_func=linear,
        )
        self.play(phase.animate.set_value(4), run_time=4, rate_func=linear)
        self.wait(0.5)
