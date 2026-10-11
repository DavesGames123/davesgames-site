# title: Taylor polynomials of sin x
# topic: Calculus
# level: 2
# scene: TaylorSine
# summary: Adds the terms of the Taylor series of sin x one by one, so you see each new polynomial hug the curve over a wider stretch around 0.
# concepts: Axes, plot, Transform, MathTex, math.factorial, DashedVMobject

from manim import *
from math import factorial

Y_LIMIT = 3


def taylor_sin(n_terms):
    """The polynomial x - x^3/3! + x^5/5! - ... with n_terms terms."""
    powers = [2 * k + 1 for k in range(n_terms)]
    signs = [(-1) ** k for k in range(n_terms)]

    def p(x):
        return sum(s * x**n / factorial(n) for s, n in zip(signs, powers))

    return p


def inside_range(p, x_max=7):
    """Widest interval around 0 where |p(x)| stays on the axes."""
    xs = np.linspace(0, x_max, 700)
    ok_right = xs[np.cumprod(np.abs([p(x) for x in xs]) <= Y_LIMIT).astype(bool)][-1]
    ok_left = xs[np.cumprod(np.abs([p(-x) for x in xs]) <= Y_LIMIT).astype(bool)][-1]
    return [-ok_left, ok_right]


TERMS = [r"x", r"-\frac{x^3}{3!}", r"+\frac{x^5}{5!}", r"-\frac{x^7}{7!}", r"+\frac{x^9}{9!}"]
COLORS = [RED, ORANGE, YELLOW, GREEN, TEAL]


class TaylorSine(Scene):
    def construct(self):
        axes = Axes(
            x_range=[-7, 7, 1],
            y_range=[-Y_LIMIT, Y_LIMIT, 1],
            x_length=12.5,
            y_length=5.2,
            axis_config={"include_numbers": True, "font_size": 20},
        ).to_edge(DOWN, buff=0.4)
        sine = axes.plot(np.sin, x_range=[-7, 7], color=BLUE, stroke_width=6)
        sine_label = MathTex(r"\sin x", color=BLUE, font_size=40).move_to(axes.c2p(2.6, 1.6))

        self.play(Create(axes), Create(sine), Write(sine_label))

        # The formula grows term by term at the top of the frame.
        formula = MathTex(r"P(x) =", *TERMS, font_size=42).to_edge(UP, buff=0.35)
        self.play(Write(formula[0]))

        approx = None
        for n in range(1, len(TERMS) + 1):
            p = taylor_sin(n)
            curve = axes.plot(p, x_range=inside_range(p), color=COLORS[n - 1], stroke_width=4)
            term = formula[n]
            term.set_color(COLORS[n - 1])
            if approx is None:
                approx = curve
                self.play(Write(term), Create(approx), run_time=1.5)
            else:
                # Transform keeps one curve and bends it to the new polynomial.
                self.play(Write(term), Transform(approx, curve), run_time=1.5)
            self.wait(0.6)

        note = Text("more terms: a good fit over a wider range", font_size=26, color=GREY_A)
        note.next_to(formula, DOWN, buff=0.25)
        self.play(FadeIn(note))
        self.wait()
