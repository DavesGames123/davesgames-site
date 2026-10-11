# title: Rate functions race
# topic: Animation
# level: 2
# scene: RateFunctionRace
# summary: Five dots make the same move with different rate functions, each shown next to its curve, so you can see how easing changes the feel of one animation.
# concepts: rate_func, rate_functions, linear, smooth, rush_into, rush_from, ease_out_bounce, ParametricFunction

from manim import *


class RateFunctionRace(Scene):
    def construct(self):
        # Each rate function maps time t in [0, 1] to progress in [0, 1]
        funcs = [
            ("linear", rate_functions.linear, BLUE),
            ("smooth", rate_functions.smooth, GREEN),
            ("rush_into", rate_functions.rush_into, YELLOW),
            ("rush_from", rate_functions.rush_from, ORANGE),
            ("ease_out_bounce", rate_functions.ease_out_bounce, RED),
        ]

        start_x, end_x = -2.4, 5.6
        rows = VGroup()
        dots = []
        for i, (name, func, color) in enumerate(funcs):
            y = 2 - i * 1.05
            # A tiny plot of progress against time: x = t, y = func(t)
            box = Square(0.8, stroke_color=GREY_D, stroke_width=1.5).move_to([-3.4, y, 0])
            corner = box.get_corner(DL)
            curve = ParametricFunction(
                lambda t, f=func, c=corner: c + 0.8 * np.array([t, f(t), 0]),
                t_range=[0, 1, 0.01],
                color=color,
                stroke_width=3,
            )
            label = Text(name, font_size=24, color=color).next_to(box, LEFT, buff=0.3)
            track = DashedLine([start_x, y, 0], [end_x, y, 0], color=GREY_D)
            rows.add(label, box, curve, track)
            dots.append(Dot([start_x, y, 0], radius=0.15, color=color))

        finish = Line([end_x, 2.5, 0], [end_x, -2.5, 0], color=WHITE)
        title = Text("Same move, different rate_func", font_size=32).to_edge(UP, buff=0.3)
        self.add(title)
        self.play(FadeIn(rows), FadeIn(*dots), Create(finish))
        self.wait(0.5)

        # All five moves start together and take the same 3 seconds;
        # only the rate function differs.
        def race():
            return [
                dot.animate(rate_func=func).move_to([end_x, dot.get_y(), 0])
                for dot, (_, func, _) in zip(dots, funcs)
            ]

        self.play(*race(), run_time=3)
        self.wait(0.5)

        # Put the dots back and race again, slower, so the eye can compare
        self.play(*[dot.animate.move_to([start_x, dot.get_y(), 0]) for dot in dots], run_time=0.6)
        self.play(*race(), run_time=4)
        self.wait(1)
