// ============================================================================
//  SEED EXAMPLES  ·  a few programs for the first boot
// ----------------------------------------------------------------------------
//  The examples browser reads examples/catalog.js. When that file is not
//  there (or does not load), it shows these seeds. Each seed is plain
//  ManimCE code with the same header format as examples/*.py.
//
//  EXPORTS
//    SEEDS   [{id, file, title, topic, level, scene, summary, concepts, code}]
// ============================================================================

const seed = (id, topic, level, scene, title, summary, concepts, code) =>
  ({ id, file: '', title, topic, level, scene, summary, concepts, code: code.replace(/^\n/, '') });

export const SEEDS = [
  seed('seed-square-to-circle', 'Basics', 1, 'SquareToCircle', 'Square to circle',
    'The first manim scene: make a shape, show it, and turn it into another shape.',
    ['Square', 'Circle', 'Create', 'Transform', 'FadeOut'], `
# title: Square to circle
# topic: Basics
# level: 1
# scene: SquareToCircle
# summary: The first manim scene: make a shape, show it, and turn it into another shape.
# concepts: Square, Circle, Create, Transform, FadeOut
from manim import *


class SquareToCircle(Scene):
    def construct(self):
        square = Square(side_length=3, color=BLUE)
        square.rotate(PI / 4)
        circle = Circle(radius=1.7, color=PINK).set_fill(PINK, opacity=0.5)

        self.play(Create(square))
        self.play(Transform(square, circle))
        self.wait(0.5)
        self.play(FadeOut(square))
`),
  seed('seed-pythagoras', 'Algebra', 1, 'Pythagoras', 'An equation, term by term',
    'MathTex splits a formula into parts, so each part can get its own color and animation.',
    ['MathTex', 'Write', 'set_color_by_tex', 'TransformMatchingTex'], `
# title: An equation, term by term
# topic: Algebra
# level: 1
# scene: Pythagoras
# summary: MathTex splits a formula into parts, so each part can get its own color and animation.
# concepts: MathTex, Write, set_color_by_tex, TransformMatchingTex
from manim import *


class Pythagoras(Scene):
    def construct(self):
        eq = MathTex("a^2", "+", "b^2", "=", "c^2").scale(1.6)
        eq.set_color_by_tex("a^2", BLUE)
        eq.set_color_by_tex("b^2", GREEN)
        eq.set_color_by_tex("c^2", YELLOW)
        self.play(Write(eq))
        self.wait(0.5)

        solved = MathTex("c", "=", r"\\sqrt{a^2 + b^2}").scale(1.6)
        solved[0].set_color(YELLOW)
        self.play(TransformMatchingTex(eq, solved))
        self.wait()
`),
  seed('seed-plot', 'Calculus', 1, 'PlotSine', 'Plot a function on axes',
    'Axes map math coordinates to the screen, and plot draws a function as a smooth curve.',
    ['Axes', 'plot', 'get_graph_label', 'Create'], `
# title: Plot a function on axes
# topic: Calculus
# level: 1
# scene: PlotSine
# summary: Axes map math coordinates to the screen, and plot draws a function as a smooth curve.
# concepts: Axes, plot, get_graph_label, Create
from manim import *


class PlotSine(Scene):
    def construct(self):
        axes = Axes(
            x_range=[-PI, PI, PI / 2],
            y_range=[-1.5, 1.5, 0.5],
            x_length=10,
            y_length=5,
            tips=False,
        )
        sine = axes.plot(np.sin, color=BLUE)
        cosine = axes.plot(np.cos, color=ORANGE)
        sine_label = axes.get_graph_label(sine, r"\\sin x", x_val=2, direction=UP)
        cos_label = axes.get_graph_label(cosine, r"\\cos x", x_val=-2, direction=UP)

        self.play(Create(axes))
        self.play(Create(sine), Write(sine_label))
        self.play(Create(cosine), Write(cos_label))
        self.wait()
`),
  seed('seed-tangent', 'Calculus', 2, 'TangentLine', 'A tangent line that moves',
    'A ValueTracker drives the point, and always_redraw rebuilds the tangent line on every frame.',
    ['ValueTracker', 'always_redraw', 'TangentLine', 'Dot', 'DecimalNumber'], `
# title: A tangent line that moves
# topic: Calculus
# level: 2
# scene: TangentLine
# summary: A ValueTracker drives the point, and always_redraw rebuilds the tangent line on every frame.
# concepts: ValueTracker, always_redraw, TangentLine, Dot, DecimalNumber
from manim import *


class TangentLine(Scene):
    def construct(self):
        axes = Axes(x_range=[-3, 3], y_range=[-1, 9], x_length=8, y_length=5.5)
        curve = axes.plot(lambda x: x ** 2, color=BLUE)
        x = ValueTracker(-2.5)

        dot = always_redraw(lambda: Dot(axes.i2gp(x.get_value(), curve), color=YELLOW))
        tangent = always_redraw(
            lambda: TangentLine(curve, alpha=(x.get_value() + 3) / 6, length=4, color=YELLOW)
        )
        slope = always_redraw(
            lambda: MathTex(
                rf"f'(x) = {2 * x.get_value():.2f}"
            ).to_corner(UL)
        )

        self.add(axes, curve, dot, tangent, slope)
        self.play(x.animate.set_value(2.5), run_time=4, rate_func=there_and_back)
        self.wait()
`),
  seed('seed-text', 'Text', 1, 'TextStyles', 'Text, fonts and colour',
    'Text draws plain words as vector shapes, and t2c colours single words in a line.',
    ['Text', 't2c', 'AddTextLetterByLetter', 'VGroup', 'arrange'], `
# title: Text, fonts and colour
# topic: Text
# level: 1
# scene: TextStyles
# summary: Text draws plain words as vector shapes, and t2c colours single words in a line.
# concepts: Text, t2c, AddTextLetterByLetter, VGroup, arrange
from manim import *


class TextStyles(Scene):
    def construct(self):
        title = Text("Manim in the browser", font_size=56)
        line = Text("every glyph is a vector path", t2c={"vector": BLUE, "path": YELLOW})
        group = VGroup(title, line).arrange(DOWN, buff=0.6)

        self.play(AddTextLetterByLetter(title))
        self.play(FadeIn(line, shift=UP))
        self.wait()
`),
  seed('seed-graph', 'Graphs', 2, 'GraphLayout', 'A network graph',
    'Graph builds vertices and edges from lists and places them with a networkx layout.',
    ['Graph', 'layout', 'Create', 'animate'], `
# title: A network graph
# topic: Graphs
# level: 2
# scene: GraphLayout
# summary: Graph builds vertices and edges from lists and places them with a networkx layout.
# concepts: Graph, layout, Create, animate
from manim import *


class GraphLayout(Scene):
    def construct(self):
        vertices = [1, 2, 3, 4, 5, 6]
        edges = [(1, 2), (2, 3), (3, 4), (4, 1), (1, 5), (5, 6), (6, 3)]
        g = Graph(vertices, edges, layout="circular", labels=True,
                  vertex_config={"fill_color": BLUE})

        self.play(Create(g))
        self.play(g.animate.change_layout("spring", layout_config={"seed": 2}))
        self.play(g.vertices[1].animate.set_color(YELLOW))
        self.wait()
`),
];
