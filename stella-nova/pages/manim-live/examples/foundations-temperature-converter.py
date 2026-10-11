# title: Temperature converter
# topic: Updaters & trackers
# level: 2
# scene: TemperatureConverter
# summary: One ValueTracker drives two thermometer scales and their readouts at the same time, so the °C to °F rule becomes something you can watch.
# concepts: ValueTracker, NumberLine, n2p, DecimalNumber, add_updater, always_redraw, MathTex

from manim import *


class TemperatureConverter(Scene):
    def construct(self):
        # The single source of truth: the temperature in degrees Celsius
        celsius = ValueTracker(20)
        to_f = lambda c: c * 9 / 5 + 32

        rule = MathTex(r"F = \tfrac{9}{5}\,C + 32", font_size=48).to_edge(UP)

        # Two scales of the same length that line up: 0 °C = 32 °F and 100 °C = 212 °F.
        # A step of 20 °C is a step of 36 °F, so the ticks line up too.
        c_line = NumberLine(x_range=[0, 100, 20], length=10, include_numbers=True,
                            font_size=30, color=BLUE, label_direction=UP).shift(UP * 0.6)
        f_line = NumberLine(x_range=[32, 212, 36], length=10, include_numbers=True,
                            font_size=30, color=ORANGE, label_direction=DOWN).shift(DOWN * 1.6)
        c_name = Text("°C", font_size=32, color=BLUE).next_to(c_line, LEFT)
        f_name = Text("°F", font_size=32, color=ORANGE).next_to(f_line, LEFT)

        # always_redraw rebuilds the pointer from the tracker every frame.
        # The tick labels sit outside the two scales, so the pointer never crosses them.
        pointer = always_redraw(lambda: Line(
            c_line.n2p(celsius.get_value()),
            f_line.n2p(to_f(celsius.get_value())),
            color=RED, stroke_width=6,
        ))

        # add_updater keeps a DecimalNumber in step with the tracker.
        # Start each number at its real value, so it has the right digits from frame 1.
        c_read = DecimalNumber(celsius.get_value(), num_decimal_places=1, unit=r"^\circ\mathrm{C}", font_size=48, color=BLUE)
        c_read.add_updater(lambda m: m.set_value(celsius.get_value()).next_to(c_line.n2p(celsius.get_value()), UP, buff=0.75))
        f_read = DecimalNumber(to_f(celsius.get_value()), num_decimal_places=1, unit=r"^\circ\mathrm{F}", font_size=48, color=ORANGE)
        f_read.add_updater(lambda m: m.set_value(to_f(celsius.get_value())).next_to(f_line.n2p(to_f(celsius.get_value())), DOWN, buff=0.8))

        self.play(Write(rule))
        self.play(Create(c_line), Create(f_line), FadeIn(c_name), FadeIn(f_name))
        self.play(FadeIn(pointer), FadeIn(c_read), FadeIn(f_read))
        self.wait(0.5)

        # Only the tracker is animated; everything else follows it
        for target in [0, 37, 100, 60, 20]:
            self.play(celsius.animate.set_value(target), run_time=1.5)
            self.wait(0.4)
