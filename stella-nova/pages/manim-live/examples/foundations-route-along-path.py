# title: Following a route
# topic: Animation
# level: 2
# scene: RouteAlongPath
# summary: Moves a marker along a smooth route through waypoints and leaves a trail behind it, the pattern for maps, journeys and process diagrams.
# concepts: VMobject, set_points_smoothly, MoveAlongPath, TracedPath, LabeledDot, rate_func

from manim import *


class RouteAlongPath(Scene):
    def construct(self):
        # Waypoints of a journey (x, y, z)
        stops = [[-5, -2, 0], [-2.5, 1.5, 0], [0.5, -1, 0], [3, 2, 0], [5, -1.5, 0]]
        names = ["Home", "Park", "School", "Library", "Shop"]

        # A smooth curve through all the waypoints
        route = VMobject(color=GREY_C, stroke_width=3)
        route.set_points_smoothly([np.array(p) for p in stops])
        route_dashed = DashedVMobject(route, num_dashes=60)

        pins = VGroup(*[Dot(p, radius=0.12, color=WHITE) for p in stops])
        labels = VGroup(*[
            Text(n, font_size=24).next_to(pin, UP if i % 2 else DOWN, buff=0.2)
            for i, (n, pin) in enumerate(zip(names, pins))
        ])

        self.play(Create(route_dashed), FadeIn(pins), FadeIn(labels), run_time=1.5)

        marker = Dot(stops[0], radius=0.18, color=YELLOW)
        # TracedPath redraws itself every frame from the marker's position
        trail = TracedPath(marker.get_center, stroke_color=YELLOW, stroke_width=6)
        self.add(trail, marker)

        # MoveAlongPath keeps the marker on the curve for the whole animation
        self.play(MoveAlongPath(marker, route), run_time=5, rate_func=rate_functions.linear)
        self.play(Flash(marker, color=YELLOW))
        self.wait(1)
