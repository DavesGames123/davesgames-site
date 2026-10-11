# title: Riemann sums
# topic: Calculus
# level: 2
# scene: RiemannSums
# summary: Shrinks the rectangle width under a curve so the sum of the areas closes in on the integral, the idea that defines it.
# concepts: Axes, plot, get_riemann_rectangles, get_area, MathTex, ValueTracker, always_redraw

from manim import *


class RiemannSums(Scene):
    def construct(self):
        axes = Axes(
            x_range=[0, 4, 1],
            y_range=[0, 5, 1],
            x_length=7,
            y_length=4.5,
            axis_config={"include_numbers": True},
        ).to_edge(DOWN)
        f = lambda x: 0.25 * x**2 + 0.5
        graph = axes.plot(f, x_range=[0, 4], color=YELLOW)
        title = MathTex(r"\int_0^4 \left(\tfrac{x^2}{4} + \tfrac12\right)dx").to_corner(UL)

        dx = ValueTracker(1.0)
        rects = always_redraw(
            lambda: axes.get_riemann_rectangles(
                graph, x_range=[0, 4], dx=dx.get_value(), stroke_width=0.5, fill_opacity=0.7
            )
        )
        dx_label = always_redraw(
            lambda: MathTex(rf"\Delta x = {dx.get_value():.2f}").to_corner(UR)
        )

        self.play(Create(axes), Create(graph), Write(title))
        self.play(FadeIn(rects), FadeIn(dx_label))
        self.wait(0.5)
        # Smaller width -> more rectangles -> the sum gets closer to the area
        self.play(dx.animate.set_value(0.1), run_time=3, rate_func=smooth)
        self.wait(0.5)

        exact = axes.get_area(graph, x_range=[0, 4], color=BLUE, opacity=0.5)
        self.play(FadeOut(rects), FadeIn(exact))
        self.play(Write(MathTex(r"= \tfrac{22}{3}").next_to(title, RIGHT)))
        self.wait()
