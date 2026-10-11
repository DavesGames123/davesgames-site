# title: Shapes and Transform
# topic: Basics
# level: 1
# scene: ShapesAndTransform
# summary: Draws a circle, morphs it into a square and moves it, which shows the three verbs of every manim scene: create, transform, move.
# concepts: Circle, Square, Create, Transform, animate, wait

from manim import *


class ShapesAndTransform(Scene):
    def construct(self):
        circle = Circle(radius=1.5, color=BLUE, fill_opacity=0.4)
        square = Square(side_length=2.6, color=ORANGE, fill_opacity=0.4)
        label = Text("Circle", font_size=36).next_to(circle, DOWN)

        # 1. Create: draw the outline, then fill it
        self.play(Create(circle), Write(label))
        self.wait(0.5)

        # 2. Transform: the circle's points move to the square's points
        self.play(
            Transform(circle, square),
            Transform(label, Text("Square", font_size=36).next_to(square, DOWN)),
        )
        self.wait(0.5)

        # 3. Move: .animate turns any method call into an animation
        self.play(circle.animate.shift(2 * LEFT).rotate(PI / 4), label.animate.shift(2 * LEFT))
        self.wait()
