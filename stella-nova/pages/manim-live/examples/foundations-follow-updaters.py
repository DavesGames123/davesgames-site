# title: Things that follow
# topic: Updaters & trackers
# level: 2
# scene: FollowUpdaters
# summary: A boat sails past a lighthouse while its label, a distance line, a live distance readout and a turning beam all update themselves every frame.
# concepts: add_updater, always_redraw, dt updater, DecimalNumber, clear_updaters, MoveAlongPath

from manim import *


class FollowUpdaters(Scene):
    def construct(self):
        lighthouse = VGroup(
            Triangle(color=WHITE, fill_opacity=1).stretch(0.4, 0).scale(0.6),
            Dot(radius=0.12, color=YELLOW),
        ).arrange(UP, buff=0).scale(1.4).move_to(LEFT * 4.5 + DOWN * 1.45)
        lamp = lighthouse[1]
        sea = Line(LEFT * 7, RIGHT * 7, color=BLUE_D).shift(DOWN * 2.1)

        boat = Dot(radius=0.16, color=ORANGE).move_to(RIGHT * 5 + UP * 2)

        # 1. A label that follows the boat: add_updater runs every frame
        name = Text("Boat", font_size=26, color=ORANGE)
        name.add_updater(lambda m: m.next_to(boat, UP, buff=0.15))

        # 2. A line that is rebuilt every frame from two points
        link = always_redraw(lambda: DashedLine(lamp.get_center(), boat.get_center(), color=GREY_B))

        # 3. A number that is recalculated every frame
        distance = DecimalNumber(0, num_decimal_places=2, font_size=44)
        distance.add_updater(lambda m: m.set_value(np.linalg.norm(boat.get_center() - lamp.get_center())))
        readout = VGroup(Text("distance =", font_size=32), distance).arrange(RIGHT).to_corner(UR)
        # The readout group is placed once; the number's updater only changes its value
        distance.add_updater(lambda m: m.next_to(readout[0], RIGHT))

        # 4. A dt updater: the beam turns at 1 radian per second of video
        beam = Line(ORIGIN, RIGHT * 2.5, color=YELLOW, stroke_width=8, stroke_opacity=0.6)
        beam.shift(lamp.get_center())
        beam.add_updater(lambda m, dt: m.rotate(dt, about_point=lamp.get_center()))

        self.add(sea, lighthouse)
        self.play(FadeIn(boat), FadeIn(name), Create(link), FadeIn(readout))
        self.add(beam)

        route = ArcBetweenPoints(boat.get_center(), LEFT * 0.5 + UP * 2.5, angle=-PI / 3)
        self.play(MoveAlongPath(boat, route), run_time=3)
        self.play(boat.animate.move_to(LEFT * 2 + DOWN * 0.8), run_time=2)

        # clear_updaters stops an object from following: the label stays behind
        name.clear_updaters()
        frozen = Text("name.clear_updaters()", font="monospace", font_size=26, color=ORANGE).to_corner(DR)
        self.play(FadeIn(frozen))
        self.play(boat.animate.move_to(RIGHT * 3 + DOWN * 0.5), run_time=2)
        self.wait(1)
