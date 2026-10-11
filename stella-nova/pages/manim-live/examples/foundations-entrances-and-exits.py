# title: Entrances and exits
# topic: Animation
# level: 1
# scene: EntrancesAndExits
# summary: A reference sheet of six ways to bring an object on screen and take it off again, each labelled with the animation name.
# concepts: Create, FadeIn, GrowFromCenter, DrawBorderThenFill, SpinInFromNothing, Write, Uncreate, FadeOut, ShrinkToCenter, LaggedStart

from manim import *


class EntrancesAndExits(Scene):
    def construct(self):
        # (entrance, exit, shape) for each cell of the sheet
        cells = [
            (Create, Uncreate, Circle(radius=0.7, color=BLUE)),
            (FadeIn, FadeOut, Square(1.4, color=GREEN, fill_opacity=0.5)),
            (GrowFromCenter, ShrinkToCenter, Star(color=YELLOW, fill_opacity=0.6, outer_radius=0.8)),
            (DrawBorderThenFill, FadeOut, RegularPolygon(6, color=ORANGE, fill_opacity=0.6).scale(0.8)),
            (SpinInFromNothing, ShrinkToCenter, Triangle(color=PINK, fill_opacity=0.6).scale(0.9)),
            (Write, Unwrite, Text("Aa", font_size=72, color=TEAL)),
        ]

        shapes = VGroup(*[shape for _, _, shape in cells])
        # arrange_in_grid places the six shapes in two rows of three
        shapes.arrange_in_grid(rows=2, cols=3, buff=(2.4, 1.5)).scale(1.15).shift(UP * 0.3)

        labels = VGroup(*[
            Text(enter.__name__, font_size=24, color=GREY_A).next_to(shape, DOWN, buff=0.25)
            for (enter, _, _), shape in zip(cells, shapes)
        ])

        # Entrances: one after another, each with its own animation class
        for (enter, _, shape), label in zip(cells, labels):
            self.play(enter(shape), FadeIn(label), run_time=0.8)
        self.wait(0.8)

        # Exits: swap the labels to the exit names, then play all exits together
        exit_labels = VGroup(*[
            Text(leave.__name__, font_size=24, color=GREY_A).move_to(label)
            for (_, leave, _), label in zip(cells, labels)
        ])
        self.play(*[Transform(a, b) for a, b in zip(labels, exit_labels)])
        self.wait(0.5)
        # LaggedStart starts each exit a little after the one before it
        self.play(LaggedStart(*[leave(shape) for (_, leave, shape) in cells], lag_ratio=0.25), run_time=2.5)
        self.play(FadeOut(labels))
        rule = Text("Every entrance has a matching exit", font_size=34)
        self.play(FadeIn(rule, scale=0.8))
        self.wait(1)
