# title: Zooming the camera
# topic: Explainer patterns
# level: 2
# scene: CameraZoom
# summary: Zooms the camera into a graph to show a tiny wiggle that is invisible at full size, then goes back, the way to show detail without a second diagram.
# concepts: MovingCameraScene, camera.frame, save_state, Restore, animate.scale, Axes, plot

from manim import *


class CameraZoom(MovingCameraScene):
    def construct(self):
        frame = self.camera.frame  # the rectangle the camera sees

        axes = Axes(x_range=[0, 10, 1], y_range=[-1.5, 1.5, 0.5], x_length=11, y_length=5,
                    axis_config={"include_numbers": False})
        # A slow wave plus a very small fast wave
        f = lambda x: np.sin(x) + 0.01 * np.sin(25 * x)
        graph = axes.plot(f, x_range=[0, 10, 0.005], color=YELLOW, stroke_width=3)
        title = Text("Is this curve smooth?", font_size=36).to_edge(UP)

        self.play(Create(axes), Write(title))
        self.play(Create(graph), run_time=1.5)
        self.wait(0.5)

        # save_state stores the frame, so Restore can bring it back later
        frame.save_state()

        # Zoom in: scale the frame down and move it to a point on the curve
        spot = axes.c2p(4.6, f(4.6))
        box = Rectangle(width=0.8, height=0.45, color=TEAL).move_to(spot)
        self.play(Create(box))
        # The box fades out while we zoom: at 16x its outline would be very thick
        self.play(frame.animate.scale(0.06).move_to(spot), FadeOut(box), run_time=2)

        # Objects in the zoomed view must be small too: scale the label with the frame
        note = Text("the wiggle is real", font_size=48, color=TEAL).scale(0.06)
        note.next_to(spot, DOWN, buff=0.06)
        self.play(FadeIn(note))
        self.wait(1)

        # Back to the full view; the tiny label goes away on the way out
        self.play(Restore(frame), FadeOut(note), run_time=2)
        answer = MathTex(r"y = \sin x + 0.01\,\sin 25x", font_size=44, color=YELLOW).to_edge(DOWN)
        self.play(FadeTransform(title, Text("No: a small fast wave rides on it", font_size=36).to_edge(UP)), Write(answer))
        self.wait(1.5)
