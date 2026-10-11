# title: Magnifier inset
# topic: Explainer patterns
# level: 3
# scene: MagnifierInset
# summary: Uses ZoomedScene to keep the full picture on screen and show a magnified inset of one small region, like a magnifying glass in a textbook figure.
# concepts: ZoomedScene, zoomed_camera, zoomed_display, activate_zooming, get_zoomed_display_pop_out_animation

from manim import *


class MagnifierInset(ZoomedScene):
    def __init__(self, **kwargs):
        # The inset is 3 x 3 units and shows a region 0.3 times its size
        super().__init__(
            zoom_factor=0.25,
            zoomed_display_height=3,
            zoomed_display_width=3,
            image_frame_stroke_width=4,
            zoomed_camera_config={"default_frame_stroke_width": 3},
            **kwargs,
        )

    def construct(self):
        # A ruler from 0 to 1 with ticks every 0.01: too fine to read at full size
        ruler = NumberLine(x_range=[0, 1, 0.01], length=12, tick_size=0.06, stroke_width=1.5,
                           include_numbers=False).shift(DOWN * 2)
        big_ticks = NumberLine(x_range=[0, 1, 0.1], length=12, tick_size=0.15, include_numbers=True,
                               font_size=28, decimal_number_config={"num_decimal_places": 1}).move_to(ruler)
        target = Dot(ruler.n2p(0.37), color=RED, radius=0.05)
        title = Text("Where is the red dot?", font_size=36).to_edge(UP)
        self.add(ruler, big_ticks, title)
        self.play(FadeIn(target, scale=3))
        self.wait(0.5)

        # zoomed_camera.frame is the region that is magnified,
        # zoomed_display is the inset that shows it
        zoom_frame = self.zoomed_camera.frame
        zoom_frame.move_to(target).set_color(YELLOW)
        display = self.zoomed_display
        display.display_frame.set_color(YELLOW)
        # Put the inset above the dot, between the title and the ruler
        display.move_to([target.get_x(), 0.6, 0])

        self.play(Create(zoom_frame))
        self.activate_zooming()
        # The inset pops out of the small frame
        self.play(self.get_zoomed_display_pop_out_animation(), run_time=1.5)

        answer = Text("0.37", font_size=44, color=RED).next_to(display, RIGHT, buff=0.5)
        self.play(Write(answer))
        self.wait(0.5)

        # Moving the small frame changes what the inset shows
        self.play(zoom_frame.animate.move_to(ruler.n2p(0.40)), run_time=1.5)
        self.play(zoom_frame.animate.move_to(target), run_time=1.5)
        self.wait(1)
