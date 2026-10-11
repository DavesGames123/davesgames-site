# title: Shifting and stretching a parabola
# topic: Graphs & plots
# level: 1
# scene: ParabolaFamily
# summary: Moves the three sliders of y = a(x - h)^2 + k one at a time, so you see that h moves the curve sideways, k moves it up and down, and a stretches or flips it.
# concepts: Axes, plot, ValueTracker, always_redraw, Variable, DashedVMobject

from manim import *

# One colour per parameter, used in the formula AND on the readouts.
A_COLOR, H_COLOR, K_COLOR = YELLOW, TEAL, PINK

X_MIN, X_MAX, Y_MIN, Y_MAX = -5, 5, -3, 7


def visible_range(a, h, k):
    """x interval where the parabola stays inside the y range of the axes."""
    room = (Y_MAX - k) / a if a > 0 else (k - Y_MIN) / -a
    half = np.sqrt(max(room, 0.0))
    return [max(X_MIN, h - half), min(X_MAX, h + half)]


class ParabolaFamily(Scene):
    def construct(self):
        axes = Axes(
            x_range=[X_MIN, X_MAX, 1],
            y_range=[Y_MIN, Y_MAX, 1],
            x_length=7.2,
            y_length=7,
            axis_config={"include_numbers": True, "font_size": 22},
        ).to_edge(LEFT, buff=0.5)

        # The three parameters live in Variable mobjects: a label, an "=",
        # and a DecimalNumber that follows its own ValueTracker.
        a = Variable(1, "a", num_decimal_places=1)
        h = Variable(0, "h", num_decimal_places=1)
        k = Variable(0, "k", num_decimal_places=1)
        for var, col in ((a, A_COLOR), (h, H_COLOR), (k, K_COLOR)):
            var.label[0].set_color(col)
        readouts = VGroup(a, h, k).arrange(DOWN, aligned_edge=LEFT, buff=0.35)

        formula = MathTex("y", "=", "a", "(x-", "h", ")^2+", "k", font_size=48)
        formula.set_color_by_tex_to_color_map({"a": A_COLOR, "h": H_COLOR, "k": K_COLOR})
        panel = VGroup(formula, readouts).arrange(DOWN, buff=0.6)
        panel.to_edge(RIGHT, buff=1.0)

        # The parent curve y = x^2 stays as a dashed reference.
        parent = DashedVMobject(
            axes.plot(lambda x: x**2, x_range=visible_range(1, 0, 0), color=GREY_B),
            num_dashes=40,
        )

        def current_curve():
            av, hv, kv = a.tracker.get_value(), h.tracker.get_value(), k.tracker.get_value()
            return axes.plot(
                lambda x: av * (x - hv) ** 2 + kv,
                x_range=visible_range(av, hv, kv),
                color=BLUE,
                stroke_width=5,
            )

        # always_redraw rebuilds the curve and the vertex on every frame.
        curve = always_redraw(current_curve)
        vertex = always_redraw(
            lambda: Dot(axes.c2p(h.tracker.get_value(), k.tracker.get_value()), color=WHITE)
        )

        self.play(Create(axes), Write(formula))
        self.add(parent)
        self.play(Create(curve), FadeIn(vertex), FadeIn(readouts))
        self.wait(0.5)

        # k: the whole curve moves up and down
        self.play(k.tracker.animate.set_value(3), run_time=1.5)
        self.play(k.tracker.animate.set_value(-1), run_time=1.5)
        # h: the whole curve moves sideways (note: x - h, so h = 2 moves RIGHT)
        self.play(h.tracker.animate.set_value(2), run_time=1.5)
        # a: stretch, then flip upside down when a < 0
        self.play(a.tracker.animate.set_value(3), run_time=1.5)
        self.play(a.tracker.animate.set_value(-0.5), run_time=2)
        self.wait()
