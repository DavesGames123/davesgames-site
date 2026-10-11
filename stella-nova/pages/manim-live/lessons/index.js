// ============================================================================
//  MANIM LIVE  ·  lessons/index.js  (the Learn track)
// ----------------------------------------------------------------------------
//  Twelve lessons that take a beginner from an empty file to a complete
//  explainer. ui/learn.js reads LESSONS and shows one step at a time.
//
//  Shape (ui/learn.js header has the full contract):
//    LESSONS = [{id, title, level, blurb, steps: [step]}]
//    step    = {title, md, code, scene, task, hint, check}
//  md, task and hint are short Markdown (ui/markdown.js). A name in a code
//  span that starts with a capital letter, for example `Circle`, becomes a
//  link into the Reference panel. code is a complete manim program that runs
//  on the real ManimCE 0.22.0. scene is the Scene class to run. check is
//  the step test of ui/learn.js checkStep: a RegExp source string, or
//  {contains: [...]}, {regex}, {animations: n}.
//
//  Every step renders with tools/render.mjs. tests/lessons.test.mjs checks
//  the shape, and parses each code with the Python ast module in Pyodide.
//
//  FIND
//    grep -n "id: '" lessons/index.js        one line per lesson
//    grep -n "title: '" lessons/index.js     lessons and steps
// ============================================================================

// Python code goes in py`...` so a backslash (LaTeX) stays as written.
const py = (s, ...v) => String.raw(s, ...v).replace(/^\n/, '');
// Markdown goes in md(...) as lines, joined with newlines.
const md = (...lines) => lines.join('\n');

export const LESSONS = [
  // --------------------------------------------------------------------- 1
  {
    id: 'first-scene',
    title: 'Your first scene',
    level: 1,
    blurb: 'A Scene class, its construct method, self.play and self.wait.',
    steps: [
      {
        title: 'A scene is a Python class',
        md: md(
          'Every manim video is a class that inherits from `Scene`. Manim calls its `construct` method once, and everything you put on screen happens inside it.',
          '',
          '- `Circle()` makes a shape. It is not on screen yet.',
          '- `self.play(Create(circle))` animates it onto the screen. `Create` draws the outline, then fills it.',
          '- `self.wait(1)` holds the picture for one second.',
          '',
          'Press **Run** (or Ctrl/Cmd + Enter). The real manim package renders the frames in your browser.',
        ),
        code: py`
from manim import *


class FirstScene(Scene):
    def construct(self):
        circle = Circle()
        self.play(Create(circle))
        self.wait(1)
`,
        scene: 'FirstScene',
        task: 'Change `Circle()` to `Square()` and run again.',
        hint: 'Only the class name changes: `shape = Square()` or keep the variable name `circle`, manim does not care.',
        check: 'Square\\(',
      },
      {
        title: 'add shows, play animates',
        md: md(
          '`self.add(mobject)` puts an object on screen at once, with no animation. `self.play(...)` runs an animation and makes frames.',
          '',
          'Objects on screen are called *mobjects* (mathematical objects). Here the square is added, and only the circle is animated.',
          '',
          'Look at the timeline under the player: it has one bar for each `play` or `wait` call. Click a bar to jump to the line of code.',
        ),
        code: py`
from manim import *


class AddVsPlay(Scene):
    def construct(self):
        square = Square().shift(LEFT * 2)
        circle = Circle().shift(RIGHT * 2)
        self.add(square)
        self.play(Create(circle))
        self.wait(1)
`,
        scene: 'AddVsPlay',
        task: 'Make the square animate too: replace `self.add(square)` with `self.play(Create(square))`.',
        hint: 'Then the timeline shows two Create bars, one for each shape.',
        check: 'play\\(\\s*Create\\(\\s*square',
      },
      {
        title: 'Timing with run_time and wait',
        md: md(
          'Each animation lasts one second by default. `run_time=` changes that, and `self.wait(t)` holds still for `t` seconds.',
          '',
          'The video length is the sum of all the bars in the timeline. At low quality manim makes 15 frames for each second.',
        ),
        code: py`
from manim import *


class Timing(Scene):
    def construct(self):
        dot = Dot(LEFT * 4)
        self.play(FadeIn(dot))
        self.play(dot.animate.move_to(RIGHT * 4), run_time=3)
        self.wait(1)
`,
        scene: 'Timing',
        task: 'Make the trip take half a second and the final wait two seconds.',
        hint: '`run_time=0.5` and `self.wait(2)`.',
        check: 'self\\.wait\\(\\s*2',
      },
      {
        title: 'Several scenes in one file',
        md: md(
          'A file can hold many Scene classes. With no choice, the **last** one runs. Use the scene menu next to Run to pick another.',
          '',
          'This makes it easy to keep drafts side by side while you work.',
        ),
        code: py`
from manim import *


class SceneOne(Scene):
    def construct(self):
        self.play(Write(Text("Scene one")))
        self.wait(0.5)


class SceneTwo(Scene):
    def construct(self):
        self.play(GrowFromCenter(Star(color=YELLOW)))
        self.wait(0.5)
`,
        scene: 'SceneTwo',
        task: 'Add a third scene, `SceneThree`, that shows a `Triangle`. Run it from the scene menu.',
        hint: 'Copy SceneTwo, rename the class, and use `Triangle()`.',
        check: 'class\\s+SceneThree\\s*\\(\\s*Scene\\s*\\)',
      },
    ],
  },

  // --------------------------------------------------------------------- 2
  {
    id: 'positioning',
    title: 'Mobjects and positioning',
    level: 1,
    blurb: 'The frame and its coordinates, shift, move_to, next_to, arrange and VGroup.',
    steps: [
      {
        title: 'The frame and its coordinates',
        md: md(
          'The visible frame is 8 units high and about 14.2 units wide. `ORIGIN` is the centre. Directions are arrays: `UP` is $(0, 1, 0)$, `RIGHT` is $(1, 0, 0)$.',
          '',
          'You can add directions and multiply them: `2 * UP + 3 * LEFT` is the point $(-3, 2, 0)$.',
          '',
          '`print(...)` output appears in the log under the player.',
        ),
        code: py`
from manim import *


class Coordinates(Scene):
    def construct(self):
        print("frame width", config.frame_width, "height", config.frame_height)
        grid = NumberPlane()
        self.add(grid)
        for p in [ORIGIN, UP * 2, RIGHT * 3, 2 * UP + 3 * LEFT]:
            dot = Dot(p, color=YELLOW)
            label = Text(f"({p[0]:g}, {p[1]:g})", font_size=24).next_to(dot, DR, buff=0.1)
            self.play(FadeIn(dot), FadeIn(label), run_time=0.5)
        self.wait(1)
`,
        scene: 'Coordinates',
        task: 'Add a fifth point at `DOWN * 3 + RIGHT * 6`. Is it still inside the frame?',
        hint: 'Put it in the list: `[ORIGIN, UP * 2, ..., DOWN * 3 + RIGHT * 6]`. The frame edge is at x = 7.1.',
        check: 'DOWN\\s*\\*\\s*3\\s*\\+\\s*RIGHT\\s*\\*\\s*6',
      },
      {
        title: 'shift and move_to',
        md: md(
          '`shift(v)` moves an object *by* a vector. `move_to(p)` moves its centre *to* a point.',
          '',
          'Both return the object, so you can chain them: `Square().shift(UP).scale(0.5)`.',
        ),
        code: py`
from manim import *


class ShiftAndMove(Scene):
    def construct(self):
        a = Square(color=BLUE)
        b = Square(color=RED)
        self.add(a, b)
        self.play(a.animate.shift(LEFT * 3))
        self.play(b.animate.move_to(UP * 2 + RIGHT * 3))
        self.wait(1)
`,
        scene: 'ShiftAndMove',
        task: 'Run the `shift(LEFT * 3)` line twice in a row. Where does the blue square end? Then try `move_to` twice.',
        hint: 'shift adds up (it ends 6 units left); move_to twice goes to the same place.',
        check: { animations: 3 },
      },
      {
        title: 'next_to, to_edge and to_corner',
        md: md(
          'Place objects relative to each other, not with numbers.',
          '',
          '- `label.next_to(box, DOWN)` puts the label under the box. `buff=` sets the gap.',
          '- `title.to_edge(UP)` moves to the top edge of the frame.',
          '- `note.to_corner(DR)` moves to the down-right corner.',
        ),
        code: py`
from manim import *


class Relative(Scene):
    def construct(self):
        title = Text("Relative placement").to_edge(UP)
        box = Rectangle(width=3, height=1.5, color=TEAL)
        label = Text("a box", font_size=28).next_to(box, DOWN, buff=0.3)
        note = Text("corner note", font_size=20).to_corner(DR)
        self.play(Write(title))
        self.play(Create(box), FadeIn(label))
        self.play(FadeIn(note))
        self.wait(1)
`,
        scene: 'Relative',
        task: 'Put the label to the right of the box instead, with a gap of 0.5.',
        hint: '`next_to(box, RIGHT, buff=0.5)`.',
        check: 'next_to\\(\\s*box\\s*,\\s*RIGHT',
      },
      {
        title: 'VGroup and arrange',
        md: md(
          'A `VGroup` holds several mobjects so you can move, colour or animate them as one.',
          '',
          '`group.arrange(RIGHT, buff=0.4)` lines them up. `arrange_in_grid(rows, cols)` makes a table.',
        ),
        code: py`
from manim import *


class Groups(Scene):
    def construct(self):
        shapes = VGroup(Circle(), Square(), Triangle(), Star())
        shapes.scale(0.6).arrange(RIGHT, buff=0.5)
        self.play(Create(shapes))
        self.play(shapes.animate.set_color(YELLOW))
        self.play(shapes.animate.arrange(DOWN, buff=0.2))
        self.wait(1)
`,
        scene: 'Groups',
        task: 'Make eight circles with `VGroup(*[Circle(radius=0.4) for _ in range(8)])` and arrange them in a grid of 2 rows and 4 columns.',
        hint: '`shapes.arrange_in_grid(rows=2, cols=4, buff=0.3)`.',
        check: 'arrange_in_grid',
      },
      {
        title: 'align_to and the edges of things',
        md: md(
          'Every mobject has edge points: `get_top()`, `get_left()`, `get_corner(UL)` and so on.',
          '',
          '`b.align_to(a, LEFT)` moves `b` so its left edge lines up with the left edge of `a`. This is how you make neat lists.',
        ),
        code: py`
from manim import *


class AlignLeft(Scene):
    def construct(self):
        lines = VGroup(
            Text("short"),
            Text("a longer line"),
            Text("the longest line of all"),
        ).arrange(DOWN, buff=0.4)
        self.add(lines)
        self.wait(0.5)
        self.play(*[line.animate.align_to(lines, LEFT) for line in lines])
        self.play(Indicate(Dot(lines.get_corner(UL), color=RED)))
        self.wait(0.5)
`,
        scene: 'AlignLeft',
        task: 'Align the lines to the RIGHT edge instead.',
        hint: '`line.animate.align_to(lines, RIGHT)`.',
        check: 'align_to\\(\\s*lines\\s*,\\s*RIGHT',
      },
    ],
  },

  // --------------------------------------------------------------------- 3
  {
    id: 'styling',
    title: 'Styling',
    level: 1,
    blurb: 'Colour, fill, stroke, opacity, gradients and drawing order with z_index.',
    steps: [
      {
        title: 'Fill and stroke',
        md: md(
          'A vector mobject (`VMobject`) has two styles: the **stroke** (outline) and the **fill** (inside).',
          '',
          '- `color=` sets both.',
          '- `fill_opacity=` goes from 0 (empty) to 1 (solid). Most shapes start at 0.',
          '- `stroke_width=` is the outline thickness, 4 by default.',
        ),
        code: py`
from manim import *


class FillStroke(Scene):
    def construct(self):
        a = Circle(color=BLUE)
        b = Circle(color=BLUE, fill_opacity=0.5)
        c = Circle(color=BLUE, fill_opacity=1, stroke_width=12, stroke_color=WHITE)
        row = VGroup(a, b, c).arrange(RIGHT, buff=0.8)
        self.play(LaggedStart(*[DrawBorderThenFill(m) for m in row], lag_ratio=0.3))
        self.wait(1)
`,
        scene: 'FillStroke',
        task: 'Give the first circle a thin red outline: `stroke_color=RED, stroke_width=2`.',
        hint: '`a = Circle(color=BLUE, stroke_color=RED, stroke_width=2)`.',
        check: 'stroke_width\\s*=\\s*2\\b',
      },
      {
        title: 'set_fill and set_stroke',
        md: md(
          'You can change the style after you make an object: `set_fill(color, opacity)`, `set_stroke(color, width)`, `set_opacity(x)`.',
          '',
          'With `.animate` the change becomes an animation. The colour constants (`RED`, `TEAL`, `GOLD`, ...) are `ManimColor` objects. A hex text such as `"#ff8800"` works too.',
        ),
        code: py`
from manim import *


class Restyle(Scene):
    def construct(self):
        sq = Square(side_length=3)
        self.play(Create(sq))
        self.play(sq.animate.set_fill(TEAL, opacity=0.6))
        self.play(sq.animate.set_stroke("#ff8800", width=10))
        self.play(sq.animate.set_opacity(0.2))
        self.wait(1)
`,
        scene: 'Restyle',
        task: 'Add one more step that fills the square with `PURPLE` at opacity 1.',
        hint: '`self.play(sq.animate.set_fill(PURPLE, opacity=1))`.',
        check: 'set_fill\\(\\s*PURPLE',
      },
      {
        title: 'Gradients and colour lists',
        md: md(
          '`set_color_by_gradient(BLUE, GREEN, YELLOW)` spreads colours over the parts of a group. `color_gradient(colors, n)` gives a list of `n` colours you can use yourself.',
        ),
        code: py`
from manim import *


class Gradients(Scene):
    def construct(self):
        bars = VGroup(*[Rectangle(width=0.5, height=0.3 * (i + 1)) for i in range(12)])
        bars.arrange(RIGHT, buff=0.1, aligned_edge=DOWN)
        bars.set_fill(opacity=1).set_stroke(width=0)
        bars.set_color_by_gradient(BLUE, GREEN, YELLOW)
        self.play(LaggedStart(*[GrowFromEdge(b, DOWN) for b in bars], lag_ratio=0.1))
        self.wait(1)
`,
        scene: 'Gradients',
        task: 'Change the gradient to go from `RED` to `PURPLE`.',
        hint: '`bars.set_color_by_gradient(RED, PURPLE)`.',
        check: 'set_color_by_gradient\\(\\s*RED\\s*,\\s*PURPLE',
      },
      {
        title: 'Drawing order and z_index',
        md: md(
          'Objects are drawn in the order you add them: the last one is on top. `z_index` changes that: a higher value is drawn later, so it is on top.',
        ),
        code: py`
from manim import *


class ZIndex(Scene):
    def construct(self):
        back = Square(side_length=3, color=BLUE, fill_opacity=1)
        front = Circle(radius=1.5, color=RED, fill_opacity=1).shift(RIGHT * 1.2)
        self.add(back, front)
        self.wait(0.5)
        self.play(back.animate.set_z_index(1))
        self.wait(0.5)
        self.play(front.animate.set_z_index(2))
        self.wait(1)
`,
        scene: 'ZIndex',
        task: 'Make the square start on top: give it `z_index=1` when you create it, and remove the two `set_z_index` lines.',
        hint: '`Square(side_length=3, color=BLUE, fill_opacity=1, z_index=1)`.',
        check: 'z_index\\s*=\\s*1',
      },
    ],
  },

  // --------------------------------------------------------------------- 4
  {
    id: 'animations',
    title: 'Animations',
    level: 1,
    blurb: 'Create, Write, FadeIn, Transform vs ReplacementTransform, rate_func, lag_ratio, groups.',
    steps: [
      {
        title: 'Ways to enter and exit',
        md: md(
          'An animation is an object you give to `self.play`. Some common entrances:',
          '',
          '- `Create` draws the outline. `Write` is for text and formulas.',
          '- `FadeIn` and `FadeOut`, with `shift=` to slide at the same time.',
          '- `GrowFromCenter`, `SpinInFromNothing`, `DrawBorderThenFill`.',
          '',
          'Each name in the timeline is the animation class that ran.',
        ),
        code: py`
from manim import *


class Entrances(Scene):
    def construct(self):
        a = Square().shift(LEFT * 4)
        b = Text("Write").shift(LEFT * 1.3)
        c = Circle().shift(RIGHT * 1.5)
        d = Star().shift(RIGHT * 4.3)
        self.play(Create(a))
        self.play(Write(b))
        self.play(FadeIn(c, shift=UP))
        self.play(GrowFromCenter(d))
        self.play(FadeOut(a, b, c, d, shift=DOWN))
        self.wait(0.5)
`,
        scene: 'Entrances',
        task: 'Replace `GrowFromCenter(d)` with `SpinInFromNothing(d)`.',
        hint: 'Only the animation class name changes.',
        check: 'SpinInFromNothing\\(',
      },
      {
        title: 'Transform vs ReplacementTransform',
        md: md(
          '`Transform(a, b)` morphs `a` into the shape of `b`, but the object on screen is still `a`. Later you must animate `a`, not `b`.',
          '',
          '`ReplacementTransform(a, b)` morphs and then puts `b` on screen in place of `a`. Later you use `b`.',
          '',
          'The log prints which objects are on screen after each version.',
        ),
        code: py`
from manim import *


class TwoTransforms(Scene):
    def construct(self):
        a = Square(color=BLUE).shift(UP * 1.5)
        b = Circle(color=YELLOW).shift(UP * 1.5)
        self.play(Create(a))
        self.play(Transform(a, b))
        print("after Transform:", [type(m).__name__ for m in self.mobjects])

        c = Square(color=BLUE).shift(DOWN * 1.5)
        d = Circle(color=YELLOW).shift(DOWN * 1.5)
        self.play(Create(c))
        self.play(ReplacementTransform(c, d))
        print("after ReplacementTransform:", [type(m).__name__ for m in self.mobjects])
        self.play(d.animate.shift(RIGHT * 3), a.animate.shift(RIGHT * 3))
        self.wait(0.5)
`,
        scene: 'TwoTransforms',
        task: 'In the last `play`, change `a.animate` to `b.animate`. Run. Why does the top circle not move?',
        hint: 'After `Transform(a, b)` the object on screen is still `a`; `b` was never added. Read the log line.',
        check: 'b\\.animate',
      },
      {
        title: 'rate_func: how the speed changes',
        md: md(
          'A rate function maps time $t \\in [0, 1]$ to progress. The default is `smooth` (slow, fast, slow).',
          '',
          'Try `linear`, `there_and_back`, `rush_into`, `rush_from`, or the easing set `rate_functions.ease_out_bounce`.',
        ),
        code: py`
from manim import *


class RateFuncs(Scene):
    def construct(self):
        funcs = [linear, smooth, there_and_back, rate_functions.ease_out_bounce]
        names = ["linear", "smooth", "there_and_back", "ease_out_bounce"]
        dots = VGroup()
        for i, name in enumerate(names):
            y = 2 - 1.3 * i
            self.add(Text(name, font_size=24).move_to([-4.5, y, 0]))
            dots.add(Dot([-2.5, y, 0], color=YELLOW))
        self.add(dots)
        self.play(*[d.animate(rate_func=f).shift(RIGHT * 7) for d, f in zip(dots, funcs)], run_time=3)
        self.wait(0.5)
`,
        scene: 'RateFuncs',
        task: 'Replace `there_and_back` with `rush_into` in both lists, and compare it with `smooth`.',
        hint: 'Change it in `funcs` and the text in `names`.',
        check: 'rush_into',
      },
      {
        title: 'lag_ratio and LaggedStart',
        md: md(
          'When an animation acts on a group, `lag_ratio` makes the parts start one after another. 0 means all at once; 1 means each waits for the one before.',
          '',
          '`LaggedStart(*animations, lag_ratio=0.2)` does the same with a list of separate animations.',
        ),
        code: py`
from manim import *


class Lag(Scene):
    def construct(self):
        row = VGroup(*[Square(side_length=0.8) for _ in range(8)]).arrange(RIGHT)
        self.play(Create(row, lag_ratio=0.5), run_time=2)
        self.play(LaggedStart(*[sq.animate.shift(UP).set_fill(BLUE, 1) for sq in row], lag_ratio=0.15))
        self.wait(0.5)
`,
        scene: 'Lag',
        task: 'Set `lag_ratio=0` in the `LaggedStart`. Then try `lag_ratio=1`.',
        hint: 'With 0 they move together; with 1 they move one at a time.',
        check: 'LaggedStart\\([^\\n]*lag_ratio\\s*=\\s*(0|1)\\)',
      },
      {
        title: 'AnimationGroup and Succession',
        md: md(
          '`AnimationGroup(a, b)` runs animations together as one block. `Succession(a, b, c)` runs them one after another inside one `play` call.',
          '',
          'Both take `lag_ratio`, and both make one bar in the timeline.',
        ),
        code: py`
from manim import *


class GroupsOfAnimations(Scene):
    def construct(self):
        dot = Dot(LEFT * 4, color=YELLOW)
        sq = Square().shift(RIGHT * 3)
        self.add(dot)
        self.play(Succession(
            dot.animate.move_to(ORIGIN),
            dot.animate.scale(4),
            AnimationGroup(Create(sq), dot.animate.set_color(RED)),
        ), run_time=3)
        self.wait(0.5)
`,
        scene: 'GroupsOfAnimations',
        task: 'Change `Succession` to `AnimationGroup`. What changes?',
        hint: 'All three parts now run at the same time, over the full 3 seconds.',
        check: 'self\\.play\\(\\s*AnimationGroup\\(',
      },
    ],
  },

  // --------------------------------------------------------------------- 5
  {
    id: 'animate-syntax',
    title: 'The .animate syntax',
    level: 1,
    blurb: 'Turn any method call into an animation, chain calls, and know when to use Rotate instead.',
    steps: [
      {
        title: 'Any method, animated',
        md: md(
          '`mob.animate.method(...)` builds an animation from the state now to the state after the method. Without `.animate` the change happens at once, with no frames in between.',
        ),
        code: py`
from manim import *


class AnimateBasics(Scene):
    def construct(self):
        sq = Square(color=BLUE)
        self.add(sq)
        self.play(sq.animate.shift(RIGHT * 2))
        sq.shift(LEFT * 4)  # no animation: a jump
        self.wait(0.5)
        self.play(sq.animate.scale(0.5))
        self.wait(0.5)
`,
        scene: 'AnimateBasics',
        task: 'Make the jump smooth: turn `sq.shift(LEFT * 4)` into a `self.play(sq.animate...)` call.',
        hint: '`self.play(sq.animate.shift(LEFT * 4))`.',
        check: 'animate\\.shift\\(\\s*LEFT\\s*\\*\\s*4',
      },
      {
        title: 'Chain several changes',
        md: md(
          'After `.animate` you can chain calls. They all happen in one animation: `sq.animate.shift(UP).scale(2).set_color(RED)`.',
        ),
        code: py`
from manim import *


class Chained(Scene):
    def construct(self):
        sq = Square(color=BLUE)
        self.add(sq)
        self.play(sq.animate.shift(UP).scale(1.5).set_fill(RED, opacity=0.7))
        self.play(sq.animate.shift(DOWN * 2).scale(0.5).set_fill(opacity=0))
        self.wait(0.5)
`,
        scene: 'Chained',
        task: 'Add `.rotate(PI / 4)` to the end of the first chain.',
        hint: '`...set_fill(RED, opacity=0.7).rotate(PI / 4))`.',
        check: 'rotate\\(\\s*PI\\s*/\\s*4',
      },
      {
        title: 'animate.rotate vs Rotate',
        md: md(
          '`.animate` moves each point in a straight line from start to end. For a rotation of 180 degrees the points go straight through the centre, so the square shrinks and grows.',
          '',
          '`Rotate(mob, angle)` turns along the arc, so the shape stays the same. Use `Rotate` for turns.',
        ),
        code: py`
from manim import *


class RotateCompare(Scene):
    def construct(self):
        a = Square(color=RED).shift(LEFT * 3)
        b = Square(color=GREEN).shift(RIGHT * 3)
        self.add(a, b, Text("animate.rotate", font_size=24).next_to(a, DOWN),
                 Text("Rotate", font_size=24).next_to(b, DOWN))
        self.play(a.animate.rotate(PI), Rotate(b, PI), run_time=2)
        self.wait(0.5)
`,
        scene: 'RotateCompare',
        task: 'Change both angles to `PI / 4`. Is the difference still large?',
        hint: 'For small angles the two are nearly the same.',
        check: 'Rotate\\(\\s*b\\s*,\\s*PI\\s*/\\s*4',
      },
      {
        title: 'Options for one animation',
        md: md(
          'Put options in brackets right after `.animate`: `mob.animate(run_time=2, rate_func=there_and_back).shift(UP)`. This sets them for this animation only, when one `play` has several.',
        ),
        code: py`
from manim import *


class AnimateOptions(Scene):
    def construct(self):
        a = Circle(color=BLUE).shift(LEFT * 3)
        b = Circle(color=YELLOW).shift(RIGHT * 3)
        self.add(a, b)
        self.play(
            a.animate(rate_func=there_and_back).shift(UP * 2),
            b.animate(rate_func=linear).shift(DOWN * 2),
            run_time=2,
        )
        self.wait(0.5)
`,
        scene: 'AnimateOptions',
        task: 'Give the yellow circle `rate_func=rate_functions.ease_out_bounce`.',
        hint: '`b.animate(rate_func=rate_functions.ease_out_bounce).shift(DOWN * 2)`.',
        check: 'ease_out_bounce',
      },
    ],
  },

  // --------------------------------------------------------------------- 6
  {
    id: 'text-and-latex',
    title: 'Text and LaTeX',
    level: 2,
    blurb: 'Text, MathTex and Tex, parts of a formula, colouring, and TransformMatchingTex.',
    steps: [
      {
        title: 'Text',
        md: md(
          '`Text` draws plain text with a font. `font_size=` sets the size (48 by default). `t2c` colours words: `t2c={"fast": RED}`.',
          '',
          'In this page the glyphs come from the DejaVu fonts. The text layout is a small replacement for Pango (see **Under the hood**), and manim\'s real `Text` class reads the result.',
        ),
        code: py`
from manim import *


class TextBasics(Scene):
    def construct(self):
        title = Text("Manim draws text", font_size=60)
        sub = Text("small, slanted and coloured", font_size=30, slant=ITALIC,
                   t2c={"coloured": YELLOW}).next_to(title, DOWN)
        self.play(Write(title))
        self.play(FadeIn(sub, shift=UP * 0.3))
        self.wait(1)
`,
        scene: 'TextBasics',
        task: 'Make the word "small" blue with `t2c` as well.',
        hint: '`t2c={"coloured": YELLOW, "small": BLUE}`.',
        check: '"small"\\s*:\\s*BLUE',
      },
      {
        title: 'MathTex',
        md: md(
          '`MathTex` takes LaTeX math, the same as between `$...$`. Use a raw text `r"..."` so the backslashes stay.',
          '',
          'Manim normally runs LaTeX on your computer. No TeX exists in a browser, so this page sends the TeX to MathJax, and manim\'s real `SVGMobject` code reads the SVG.',
        ),
        code: py`
from manim import *


class MathBasics(Scene):
    def construct(self):
        euler = MathTex(r"e^{i\pi} + 1 = 0", font_size=72)
        gauss = MathTex(r"\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}").next_to(euler, DOWN, buff=0.8)
        self.play(Write(euler))
        self.play(Write(gauss))
        self.wait(1)
`,
        scene: 'MathBasics',
        task: 'Add a third line with the sum $\\sum_{n=1}^{\\infty} 1/n^2 = \\pi^2/6$.',
        hint: '`MathTex(r"\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}")`, then `next_to(gauss, DOWN)`.',
        check: '\\\\sum',
      },
      {
        title: 'Parts of a formula',
        md: md(
          'Give `MathTex` several texts and each becomes a part you can index: `eq[0]`, `eq[2]`, ...',
          '',
          '`set_color_by_tex("b^2", BLUE)` colours each part that contains that TeX. `substrings_to_isolate=` cuts a single text into parts for you.',
        ),
        code: py`
from manim import *


class FormulaParts(Scene):
    def construct(self):
        eq = MathTex("a^2", "+", "b^2", "=", "c^2", font_size=80)
        self.play(Write(eq))
        self.play(eq[0].animate.set_color(RED))
        eq.set_color_by_tex("b^2", BLUE)
        self.play(Indicate(eq[2]))
        self.play(Circumscribe(eq[4], color=YELLOW))
        self.wait(1)
`,
        scene: 'FormulaParts',
        task: 'Colour `c^2` green with `set_color_by_tex`.',
        hint: '`eq.set_color_by_tex("c^2", GREEN)`.',
        check: 'set_color_by_tex\\(\\s*"c\\^2"\\s*,\\s*GREEN',
      },
      {
        title: 'Tex: text with math inside',
        md: md(
          '`Tex` is LaTeX in text mode: words, with math between `$...$`. Use it for sentences that hold a formula.',
        ),
        code: py`
from manim import *


class TexSentence(Scene):
    def construct(self):
        line = Tex(r"The area of a circle is $A = \pi r^2$.", font_size=56)
        self.play(Write(line))
        self.play(line.animate.set_color(TEAL))
        self.wait(1)
`,
        scene: 'TexSentence',
        task: 'Add a second `Tex` line under it: "Its perimeter is $C = 2\\pi r$."',
        hint: '`Tex(r"Its perimeter is $C = 2\\pi r$.").next_to(line, DOWN)`.',
        check: '2\\\\pi r',
      },
      {
        title: 'TransformMatchingTex',
        md: md(
          '`TransformMatchingTex(a, b)` moves the parts that are the same in both formulas, and fades the others. It is the standard way to show algebra step by step.',
          '',
          'Mark the parts with double braces: `{{x}}`. A `{{` part starts a new part only at the start or after a space.',
        ),
        code: py`
from manim import *


class SolveStep(Scene):
    def construct(self):
        a = MathTex("{{x}} + 3 = {{7}}", font_size=72)
        b = MathTex("{{x}} = {{7}} - 3", font_size=72)
        c = MathTex("{{x}} = 4", font_size=72)
        for m in (a, b, c):
            m.set_color_by_tex("x", YELLOW)
        self.play(Write(a))
        self.play(TransformMatchingTex(a, b))
        self.wait(0.5)
        self.play(TransformMatchingTex(b, c))
        self.wait(1)
`,
        scene: 'SolveStep',
        task: 'Change the problem to $x + 5 = 12$, and fix the next two steps.',
        hint: 'a: `"{{x}} + 5 = {{12}}"`, b: `"{{x}} = {{12}} - 5"`, c: `"{{x}} = 7"`.',
        check: { contains: ['12', '= 7'] },
      },
    ],
  },

  // --------------------------------------------------------------------- 7
  {
    id: 'axes-and-graphs',
    title: 'Axes and graphs',
    level: 2,
    blurb: 'Axes, plot, coordinates, labels, areas and Riemann rectangles.',
    steps: [
      {
        title: 'Axes and plot',
        md: md(
          '`Axes(x_range=[min, max, step], y_range=[...])` makes a coordinate system. `axes.plot(f)` draws the graph of a Python function $f(x)$ in those coordinates.',
        ),
        code: py`
from manim import *


class FirstGraph(Scene):
    def construct(self):
        axes = Axes(x_range=[-3, 3, 1], y_range=[-1, 9, 2], x_length=8, y_length=5,
                    axis_config={"include_numbers": True})
        graph = axes.plot(lambda x: x ** 2, color=YELLOW)
        self.play(Create(axes))
        self.play(Create(graph), run_time=2)
        self.wait(1)
`,
        scene: 'FirstGraph',
        task: 'Plot $x^3 / 3$ in red instead. Change `y_range` so all of it fits.',
        hint: '`axes.plot(lambda x: x ** 3 / 3, color=RED)` and `y_range=[-9, 9, 3]`.',
        check: 'x\\s*\\*\\*\\s*3',
      },
      {
        title: 'Coordinates to points: c2p',
        md: md(
          'The axes have their own coordinates. `axes.c2p(x, y)` (coordinates to point) gives the point on screen. `axes.input_to_graph_point(x, graph)` gives the point on a graph.',
          '',
          '`axes.get_vertical_line(point)` drops a dashed line to the x axis.',
        ),
        code: py`
from manim import *


class Points(Scene):
    def construct(self):
        axes = Axes(x_range=[0, 5, 1], y_range=[0, 10, 2], x_length=8, y_length=5)
        graph = axes.plot(lambda x: 0.4 * x ** 2, color=BLUE)
        self.add(axes, graph)
        p = axes.input_to_graph_point(4, graph)
        dot = Dot(p, color=YELLOW)
        line = axes.get_vertical_line(p)
        corner = Dot(axes.c2p(0, 0), color=RED)
        self.play(FadeIn(dot), Create(line), FadeIn(corner))
        self.wait(1)
`,
        scene: 'Points',
        task: 'Move the yellow dot to $x = 2$.',
        hint: '`axes.input_to_graph_point(2, graph)`.',
        check: 'input_to_graph_point\\(\\s*2\\s*,',
      },
      {
        title: 'Labels',
        md: md(
          '`axes.get_axis_labels(x_label="x", y_label="y")` names the axes. `axes.get_graph_label(graph, label)` puts a formula next to the graph.',
        ),
        code: py`
from manim import *


class Labels(Scene):
    def construct(self):
        axes = Axes(x_range=[0, 2 * PI, PI / 2], y_range=[-1.5, 1.5, 0.5], x_length=10, y_length=4)
        sine = axes.plot(np.sin, color=YELLOW)
        cosine = axes.plot(np.cos, color=TEAL)
        labels = axes.get_axis_labels(x_label="x", y_label="y")
        s_label = axes.get_graph_label(sine, r"\sin x", x_val=PI / 2, direction=UP)
        c_label = axes.get_graph_label(cosine, r"\cos x", x_val=PI, direction=DOWN)
        self.play(Create(axes), Write(labels))
        self.play(Create(sine), Write(s_label))
        self.play(Create(cosine), Write(c_label))
        self.wait(1)
`,
        scene: 'Labels',
        task: 'Name the y axis "f(x)" instead of "y".',
        hint: '`get_axis_labels(x_label="x", y_label="f(x)")`.',
        check: 'y_label\\s*=\\s*"f\\(x\\)"',
      },
      {
        title: 'Areas and Riemann sums',
        md: md(
          '`axes.get_area(graph, x_range=(a, b))` shades the area under a graph. `axes.get_riemann_rectangles(graph, x_range=[a, b], dx=...)` shows the rectangles that add up to it.',
          '',
          'Make `dx` smaller and the rectangles fit the curve better. That is the idea of the integral $\\int_a^b f(x)\\,dx$.',
        ),
        code: py`
from manim import *


class Areas(Scene):
    def construct(self):
        axes = Axes(x_range=[0, 4, 1], y_range=[0, 5, 1], x_length=8, y_length=5)
        graph = axes.plot(lambda x: 0.25 * x ** 2 + 1, color=YELLOW)
        self.add(axes, graph)
        coarse = axes.get_riemann_rectangles(graph, x_range=[0, 4], dx=0.5, fill_opacity=0.6)
        fine = axes.get_riemann_rectangles(graph, x_range=[0, 4], dx=0.1, fill_opacity=0.6)
        area = axes.get_area(graph, x_range=(0, 4), color=BLUE, opacity=0.5)
        self.play(Create(coarse))
        self.play(ReplacementTransform(coarse, fine))
        self.play(ReplacementTransform(fine, area))
        self.wait(1)
`,
        scene: 'Areas',
        task: 'Shade only the part from $x = 1$ to $x = 3$ at the end.',
        hint: '`axes.get_area(graph, x_range=(1, 3), ...)`.',
        check: 'get_area\\([^)]*x_range\\s*=\\s*\\(\\s*1\\s*,\\s*3',
      },
    ],
  },

  // --------------------------------------------------------------------- 8
  {
    id: 'updaters',
    title: 'Updaters and ValueTracker',
    level: 2,
    blurb: 'Make objects follow each other: add_updater, always_redraw, ValueTracker, DecimalNumber and dt.',
    steps: [
      {
        title: 'add_updater: follow another object',
        md: md(
          'An updater is a function that manim calls on every frame. `label.add_updater(lambda m: m.next_to(dot, UP))` keeps the label on top of the dot while the dot moves.',
        ),
        code: py`
from manim import *


class Follow(Scene):
    def construct(self):
        dot = Dot(LEFT * 4, color=YELLOW)
        label = Text("me", font_size=28)
        label.add_updater(lambda m: m.next_to(dot, UP))
        self.add(dot, label)
        self.play(dot.animate.shift(RIGHT * 8), run_time=2)
        self.play(dot.animate.shift(DOWN * 2))
        self.wait(0.5)
`,
        scene: 'Follow',
        task: 'Remove the `add_updater` line and run. Then put it back.',
        hint: 'Without the updater the label stays where it was made.',
        check: 'add_updater',
      },
      {
        title: 'ValueTracker and always_redraw',
        md: md(
          'A `ValueTracker` holds one number that you can animate: `self.play(t.animate.set_value(5))`.',
          '',
          '`always_redraw(lambda: ...)` builds a new mobject on every frame from the current values. Together they make diagrams that change with a parameter.',
        ),
        code: py`
from manim import *


class Tracker(Scene):
    def construct(self):
        axes = Axes(x_range=[-4, 4, 1], y_range=[-1, 9, 2], x_length=8, y_length=5)
        a = ValueTracker(1)
        graph = always_redraw(lambda: axes.plot(lambda x: a.get_value() * x ** 2,
                                                x_range=[-2, 2], color=YELLOW))
        self.add(axes, graph)
        self.play(a.animate.set_value(0.2), run_time=2)
        self.play(a.animate.set_value(2), run_time=2)
        self.wait(0.5)
`,
        scene: 'Tracker',
        task: 'Make the tracker go to a negative value, `-0.5`, at the end. Change `y_range` to see it.',
        hint: '`self.play(a.animate.set_value(-0.5))` and `y_range=[-5, 9, 2]`.',
        check: 'set_value\\(\\s*-\\s*0?\\.5',
      },
      {
        title: 'Show the number: DecimalNumber',
        md: md(
          '`DecimalNumber` shows a number. With an updater that calls `set_value(t.get_value())`, it counts along with the tracker.',
        ),
        code: py`
from manim import *


class Counter(Scene):
    def construct(self):
        t = ValueTracker(0)
        bar = always_redraw(lambda: Rectangle(width=max(t.get_value(), 0.01), height=0.6,
                                              fill_opacity=1, color=TEAL).move_to(LEFT * 4, aligned_edge=LEFT))
        number = DecimalNumber(0, num_decimal_places=2, font_size=60).shift(UP * 1.5)
        number.add_updater(lambda m: m.set_value(t.get_value()))
        self.add(bar, number)
        self.play(t.animate.set_value(8), run_time=3, rate_func=linear)
        self.wait(0.5)
`,
        scene: 'Counter',
        task: 'Show no decimal places.',
        hint: '`num_decimal_places=0`.',
        check: 'num_decimal_places\\s*=\\s*0',
      },
      {
        title: 'Time-based updaters with dt',
        md: md(
          'An updater with a second argument `dt` receives the time step of the frame in seconds. Use it for motion that runs on its own, for example a constant spin.',
          '',
          '`self.wait(3)` still makes frames, so the updater keeps going during a wait.',
        ),
        code: py`
from manim import *


class Spin(Scene):
    def construct(self):
        wheel = VGroup(Circle(radius=2), *[Line(ORIGIN, 2 * RIGHT).rotate(a, about_point=ORIGIN)
                                           for a in np.arange(0, TAU, TAU / 6)])
        wheel.add_updater(lambda m, dt: m.rotate(dt * PI / 2))
        self.add(wheel)
        self.wait(3)
`,
        scene: 'Spin',
        task: 'Make the wheel turn the other way, twice as fast.',
        hint: '`m.rotate(-dt * PI)`.',
        check: '-\\s*dt\\s*\\*\\s*PI\\b(?!\\s*/)',
      },
    ],
  },

  // --------------------------------------------------------------------- 9
  {
    id: 'camera',
    title: 'The camera',
    level: 2,
    blurb: 'MovingCameraScene: zoom, pan, follow, save_state and Restore.',
    steps: [
      {
        title: 'Zoom with the frame',
        md: md(
          'In a `MovingCameraScene` the camera has a frame, `self.camera.frame`, which is a rectangle you can move and scale like any mobject.',
          '',
          'Scale the frame down and the picture zooms in.',
        ),
        code: py`
from manim import *


class Zoom(MovingCameraScene):
    def construct(self):
        frame = self.camera.frame
        dots = VGroup(*[Dot(radius=0.04 + 0.01 * i).shift(RIGHT * (i - 5)) for i in range(11)])
        small = Text("tiny detail", font_size=10).next_to(dots[2], UP, buff=0.05)
        self.add(dots, small)
        self.wait(0.5)
        self.play(frame.animate.scale(0.2).move_to(small))
        self.wait(1)
`,
        scene: 'Zoom',
        task: 'Zoom less: scale the frame by 0.5.',
        hint: '`frame.animate.scale(0.5)`.',
        check: 'frame\\.animate\\.scale\\(\\s*0?\\.5',
      },
      {
        title: 'Pan, then come back with Restore',
        md: md(
          '`frame.save_state()` remembers the frame. `Restore(frame)` animates it back. This is the usual pattern for "look closer, then step back".',
        ),
        code: py`
from manim import *


class PanRestore(MovingCameraScene):
    def construct(self):
        frame = self.camera.frame
        boxes = VGroup(*[Square(color=c) for c in (RED, GREEN, BLUE)]).arrange(RIGHT, buff=1)
        self.add(boxes)
        frame.save_state()
        for box in boxes:
            self.play(frame.animate.set(width=box.width * 3).move_to(box))
        self.play(Restore(frame))
        self.wait(0.5)
`,
        scene: 'PanRestore',
        task: 'Visit the boxes from right to left.',
        hint: '`for box in reversed(boxes):`.',
        check: 'reversed\\(\\s*boxes',
      },
      {
        title: 'Follow a moving object',
        md: md(
          'An updater on the frame makes the camera follow something: `frame.add_updater(lambda f: f.move_to(dot))`. Remove it with `frame.clear_updaters()`.',
        ),
        code: py`
from manim import *


class FollowCam(MovingCameraScene):
    def construct(self):
        frame = self.camera.frame
        path = VMobject().set_points_smoothly([LEFT * 6, UP * 2, RIGHT * 2 + DOWN, RIGHT * 6 + UP])
        dot = Dot(path.get_start(), color=YELLOW)
        self.add(NumberPlane(), path, dot)
        self.play(frame.animate.scale(0.4).move_to(dot))
        frame.add_updater(lambda f: f.move_to(dot))
        self.play(MoveAlongPath(dot, path), run_time=3, rate_func=linear)
        frame.clear_updaters()
        self.play(frame.animate.scale(2.5).move_to(ORIGIN))
        self.wait(0.5)
`,
        scene: 'FollowCam',
        task: 'Keep a small offset: follow a point 1 unit above the dot.',
        hint: '`f.move_to(dot.get_center() + UP)`.',
        check: 'move_to\\(\\s*dot\\.get_center\\(\\)\\s*\\+\\s*UP',
      },
    ],
  },

  // -------------------------------------------------------------------- 10
  {
    id: 'three-d',
    title: '3D scenes',
    level: 3,
    blurb: 'ThreeDScene, ThreeDAxes, Surface, camera orientation and fixed-in-frame labels.',
    steps: [
      {
        title: 'ThreeDScene and the camera angles',
        md: md(
          'A `ThreeDScene` has a camera that looks from a direction given by two angles: `phi` (down from the top, 0 is straight down) and `theta` (around the vertical axis).',
          '',
          '`self.set_camera_orientation(phi=70 * DEGREES, theta=-45 * DEGREES)` is a good starting view.',
        ),
        code: py`
from manim import *


class First3D(ThreeDScene):
    def construct(self):
        axes = ThreeDAxes(x_range=[-3, 3], y_range=[-3, 3], z_range=[-2, 2])
        cube = Cube(side_length=1.5, fill_opacity=0.7, fill_color=BLUE)
        self.set_camera_orientation(phi=70 * DEGREES, theta=-45 * DEGREES)
        self.play(Create(axes))
        self.play(FadeIn(cube))
        self.wait(1)
`,
        scene: 'First3D',
        task: 'Look from straight above: set `phi=0`.',
        hint: '`self.set_camera_orientation(phi=0, theta=-90 * DEGREES)` shows the normal x-y view.',
        check: 'phi\\s*=\\s*0\\b',
      },
      {
        title: 'Surfaces',
        md: md(
          '`Surface(lambda u, v: point, u_range=..., v_range=...)` draws a surface from a function of two parameters. For a graph $z = f(x, y)$ use `axes.c2p(u, v, f(u, v))`.',
          '',
          '`resolution=` sets the number of patches. More patches look smoother and render slower.',
        ),
        code: py`
from manim import *


class Ripple(ThreeDScene):
    def construct(self):
        axes = ThreeDAxes(x_range=[-3, 3], y_range=[-3, 3], z_range=[-1, 1],
                          x_length=6, y_length=6, z_length=2)
        surface = Surface(
            lambda u, v: axes.c2p(u, v, 0.6 * np.cos(np.sqrt(u * u + v * v) * 2)),
            u_range=[-3, 3], v_range=[-3, 3], resolution=(24, 24),
        )
        surface.set_fill_by_checkerboard(BLUE_D, BLUE_E, opacity=0.9)
        self.set_camera_orientation(phi=65 * DEGREES, theta=-50 * DEGREES)
        self.add(axes)
        self.play(Create(surface), run_time=2)
        self.wait(0.5)
`,
        scene: 'Ripple',
        task: 'Draw a saddle: $z = (u^2 - v^2) / 6$.',
        hint: '`axes.c2p(u, v, (u * u - v * v) / 6)`.',
        check: 'u\\s*\\*\\s*u\\s*-\\s*v\\s*\\*\\s*v',
      },
      {
        title: 'Move the camera',
        md: md(
          '`self.move_camera(phi=..., theta=...)` animates the view. `self.begin_ambient_camera_rotation(rate=0.3)` turns the camera slowly while other things happen; `stop_ambient_camera_rotation()` stops it.',
        ),
        code: py`
from manim import *


class Orbit(ThreeDScene):
    def construct(self):
        self.set_camera_orientation(phi=75 * DEGREES, theta=30 * DEGREES)
        axes = ThreeDAxes(x_range=[-3, 3], y_range=[-3, 3], z_range=[-2, 2])
        sphere = Sphere(radius=1.2, resolution=(16, 32)).set_color(TEAL)
        self.add(axes, sphere)
        self.move_camera(phi=45 * DEGREES, theta=120 * DEGREES, run_time=2)
        self.begin_ambient_camera_rotation(rate=0.4)
        self.wait(2)
        self.stop_ambient_camera_rotation()
        self.wait(0.5)
`,
        scene: 'Orbit',
        task: 'Make the ambient rotation go the other way.',
        hint: 'A negative rate: `rate=-0.4`.',
        check: 'rate\\s*=\\s*-',
      },
      {
        title: 'Labels that face the viewer',
        md: md(
          'Text in a 3D scene turns with the scene. `self.add_fixed_in_frame_mobjects(title)` pins a mobject to the screen, so a title stays flat and readable while the camera moves.',
        ),
        code: py`
from manim import *


class FixedTitle(ThreeDScene):
    def construct(self):
        self.set_camera_orientation(phi=70 * DEGREES, theta=-30 * DEGREES)
        title = Text("A torus", font_size=40).to_corner(UL)
        self.add_fixed_in_frame_mobjects(title)
        torus = Torus(major_radius=2, minor_radius=0.6, resolution=(16, 24)).set_color(ORANGE)
        self.play(Create(torus), run_time=2)
        self.move_camera(theta=60 * DEGREES, run_time=2)
        self.wait(0.5)
`,
        scene: 'FixedTitle',
        task: 'Add a second fixed label in the down-right corner with the text "major radius 2".',
        hint: '`note = Text("major radius 2", font_size=28).to_corner(DR)` and `self.add_fixed_in_frame_mobjects(note)`.',
        check: 'to_corner\\(\\s*DR',
      },
    ],
  },

  // -------------------------------------------------------------------- 11
  {
    id: 'inside-manim',
    title: 'How manim works inside',
    level: 3,
    blurb: 'Scene to Camera to frames, Bézier anchors and handles, interpolation, and the real source.',
    steps: [
      {
        title: 'From construct to frames',
        md: md(
          'When you press Run, the page calls manim\'s real `Scene.render`. It runs your `construct`. Each `self.play` asks the renderer to step time forward; for each frame manim updates the mobjects and the `Camera` draws them into a pixel array.',
          '',
          'The log shows the objects that do this work in your run. In the **Reference** panel, search for `Scene.play` and `Camera.capture_mobjects` and press **View source**: it is the code that runs here.',
        ),
        code: py`
from manim import *


class WhoDraws(Scene):
    def construct(self):
        print("renderer:", type(self.renderer).__name__)
        print("camera:  ", type(self.camera).__name__)
        print("pixels:  ", config.pixel_width, "x", config.pixel_height, "at", config.frame_rate, "fps")
        sq = Square()
        self.play(Create(sq))
        print("after play:", self.renderer.num_plays, "play calls,", round(self.time, 2), "s")
        self.wait(1)
        print("after wait:", self.renderer.num_plays, "play calls,", round(self.time, 2), "s")
`,
        scene: 'WhoDraws',
        task: 'Switch the quality to medium and run again. Which numbers in the log change?',
        hint: 'The pixel size and the frame rate change; the play count and the time stay the same.',
        check: { animations: 2 },
      },
      {
        title: 'A Square is cubic Bézier curves',
        md: md(
          'A `VMobject` stores its shape in `points`, an array with one row per point. Each group of 4 rows is one cubic Bézier curve: **anchor, handle, handle, anchor**.',
          '',
          'A `Square` has 4 curves, so 16 points. The anchors are the corners (red). The handles (yellow) lie on the edges, so each curve is a straight line.',
          '',
          'Read the printed array in the log.',
        ),
        code: py`
from manim import *


class SquarePoints(Scene):
    def construct(self):
        sq = Square(side_length=4)
        np.set_printoptions(precision=2, suppress=True)
        print("points shape", sq.points.shape)
        print(sq.points[:, :2])
        anchors = VGroup(*[Dot(p, color=RED, radius=0.1) for p in sq.points[0::4]])
        handles = VGroup(*[Dot(p, color=YELLOW, radius=0.07) for i, p in enumerate(sq.points) if i % 4 in (1, 2)])
        self.play(Create(sq))
        self.play(FadeIn(anchors), FadeIn(handles))
        self.wait(1)
`,
        scene: 'SquarePoints',
        task: 'Change `Square` to `Circle(radius=2)`. How many curves does a circle use?',
        hint: '`points.shape` shows 32 rows: 8 curves. A circle is only close to round: each arc is a cubic Bézier.',
        check: 'Circle\\(\\s*radius\\s*=\\s*2',
      },
      {
        title: 'Handles bend the curve',
        md: md(
          'A cubic Bézier curve goes from anchor $P_0$ to $P_3$, pulled towards the handles $P_1$ and $P_2$:',
          '',
          '$$B(t) = (1-t)^3 P_0 + 3(1-t)^2 t P_1 + 3(1-t) t^2 P_2 + t^3 P_3$$',
          '',
          '`CubicBezier(p0, p1, p2, p3)` makes one curve. Here a `ValueTracker` moves a handle, and the curve follows.',
        ),
        code: py`
from manim import *


class OneBezier(Scene):
    def construct(self):
        p0, p3 = LEFT * 4, RIGHT * 4
        h = ValueTracker(0)
        def handles():
            return (LEFT * 2 + UP * h.get_value(), RIGHT * 2 + DOWN * h.get_value())
        curve = always_redraw(lambda: CubicBezier(p0, *handles(), p3, color=WHITE))
        guide = always_redraw(lambda: VGroup(
            DashedLine(p0, handles()[0], color=GREY), DashedLine(p3, handles()[1], color=GREY),
            Dot(handles()[0], color=YELLOW), Dot(handles()[1], color=YELLOW),
            Dot(p0, color=RED), Dot(p3, color=RED)))
        self.add(curve, guide)
        self.play(h.animate.set_value(3), run_time=2)
        self.play(h.animate.set_value(-3), run_time=2)
        self.wait(0.5)
`,
        scene: 'OneBezier',
        task: 'Make both handles go UP together, so the curve becomes an arch.',
        hint: 'Use `UP * h.get_value()` for the second handle too.',
        check: 'RIGHT\\s*\\*\\s*2\\s*\\+\\s*UP\\s*\\*\\s*h\\.get_value',
      },
      {
        title: 'What Transform really does',
        md: md(
          '`Transform` does not know about squares or circles. It first gives both mobjects the same number of points (`align_points`), then moves each point in a straight line: `interpolate(a, b, alpha)`.',
          '',
          'Here we call `interpolate` ourselves for 5 values of alpha, and show the 5 shapes side by side.',
        ),
        code: py`
from manim import *


class Interpolate(Scene):
    def construct(self):
        a = Square(side_length=1.6, color=BLUE)
        b = Circle(radius=0.9, color=YELLOW)
        a.align_points(b)
        print("points after align:", len(a.points), len(b.points))
        shapes = VGroup()
        for alpha in np.linspace(0, 1, 5):
            m = a.copy().interpolate(a, b, alpha)
            m.set_color(interpolate_color(BLUE, YELLOW, alpha))
            shapes.add(m)
        shapes.arrange(RIGHT, buff=0.6)
        labels = VGroup(*[MathTex(rf"\alpha={x:.2f}", font_size=30).next_to(s, DOWN) for x, s in zip(np.linspace(0, 1, 5), shapes)])
        self.play(LaggedStart(*[Create(s) for s in shapes], lag_ratio=0.2), Write(labels))
        self.wait(1)
`,
        scene: 'Interpolate',
        task: 'Show 9 steps instead of 5.',
        hint: 'Change both `np.linspace(0, 1, 5)` to `np.linspace(0, 1, 9)`, and make the shapes smaller.',
        check: 'linspace\\(\\s*0\\s*,\\s*1\\s*,\\s*9',
      },
      {
        title: 'Where the points are drawn',
        md: md(
          'For each frame, `Camera.set_cairo_context_path` turns the points into drawing calls: `move_to` the first anchor, then one `curve_to(handle, handle, anchor)` for each curve. `Camera.apply_fill` and `Camera.apply_stroke` paint the path.',
          '',
          'Those calls go to the cairo library. A browser has no cairo, so this page puts a small replacement in its place that draws on an HTML canvas; every manim line above it is unchanged. Open **Under the hood** for the list of the five replaced parts.',
          '',
          'You can also build a shape from your own points: `add_cubic_bezier_curve_to` and `add_line_to` append curves.',
        ),
        code: py`
from manim import *


class OwnPath(Scene):
    def construct(self):
        leaf = VMobject(color=GREEN, fill_opacity=0.6)
        leaf.start_new_path(DOWN * 2)
        leaf.add_cubic_bezier_curve_to(LEFT * 2.5 + DOWN * 0.5, LEFT * 1 + UP * 1.5, UP * 2.5)
        leaf.add_cubic_bezier_curve_to(RIGHT * 1 + UP * 1.5, RIGHT * 2.5 + DOWN * 0.5, DOWN * 2)
        print("curves:", leaf.get_num_curves())
        dots = VGroup(*[Dot(p, radius=0.06, color=RED if i % 4 in (0, 3) else YELLOW)
                        for i, p in enumerate(leaf.points)])
        self.play(DrawBorderThenFill(leaf), run_time=2)
        self.play(FadeIn(dots))
        self.wait(1)
`,
        scene: 'OwnPath',
        task: 'Add a straight stem: after the two curves, call `leaf.add_line_to(DOWN * 3)`.',
        hint: 'A line is also stored as a cubic curve, with handles on the line. Count the curves in the log.',
        check: 'add_line_to\\(',
      },
    ],
  },

  // -------------------------------------------------------------------- 12
  {
    id: 'capstone',
    title: 'Build a complete explainer',
    level: 3,
    blurb: 'Put it all together: a short video on why the area of a circle is πr².',
    steps: [
      {
        title: 'Plan: a title card',
        md: md(
          'A good explainer asks one question and answers it in a few clear beats. Ours: *why is the area of a circle $\\pi r^2$?*',
          '',
          'Plan:',
          '',
          '1. Title card, then the title moves to the top as a header.',
          '2. A circle with its radius labelled.',
          '3. Cut the circle into thin rings and unroll them into a triangle.',
          '4. Area of the triangle: $\\frac{1}{2} \\cdot 2\\pi r \\cdot r = \\pi r^2$, with `TransformMatchingTex`.',
          '5. A short summary.',
          '',
          'Each step of this lesson adds one beat. The code of each step holds all the beats so far.',
        ),
        code: py`
from manim import *


class CircleArea(Scene):
    def construct(self):
        title = Text("Why is a circle's area πr²?", font_size=48)
        self.play(Write(title))
        self.wait(0.5)
        self.play(title.animate.scale(0.6).to_edge(UP))
        self.wait(0.5)
`,
        scene: 'CircleArea',
        task: 'Add a subtitle under the title card, "a proof with onion rings", that fades out before the title moves.',
        hint: '`sub = Text("a proof with onion rings", font_size=28).next_to(title, DOWN)`, `FadeIn(sub)`, then `FadeOut(sub)`.',
        check: 'onion rings',
      },
      {
        title: 'Beat 2: the circle and its radius',
        md: md(
          'Draw the circle on the left half, so the right half is free for the triangle later. Mark the radius with a `Line` and a `MathTex` label.',
        ),
        code: py`
from manim import *

R = 1.6


class CircleArea(Scene):
    def construct(self):
        title = Text("Why is a circle's area πr²?", font_size=48)
        self.play(Write(title))
        self.play(title.animate.scale(0.6).to_edge(UP))

        center = LEFT * 3.5 + DOWN * 0.3
        circle = Circle(radius=R, color=BLUE, fill_opacity=0.3).move_to(center)
        radius = Line(center, center + RIGHT * R, color=YELLOW)
        r_label = MathTex("r", color=YELLOW).next_to(radius, UP, buff=0.1)
        self.play(Create(circle))
        self.play(Create(radius), Write(r_label))
        self.wait(0.5)
`,
        scene: 'CircleArea',
        task: 'Also label the perimeter: put `MathTex(r"2\\pi r")` under the circle.',
        hint: '`c_label = MathTex(r"2\\pi r", color=BLUE).next_to(circle, DOWN)` and `Write(c_label)`.',
        check: '2\\\\pi r',
      },
      {
        title: 'Beat 3: rings unroll into a triangle',
        md: md(
          'Cut the disc into thin rings. A ring at radius $\\rho$ has length $2\\pi\\rho$. Unrolled, each ring becomes a thin strip, and the strips stack into a triangle with base $2\\pi r$ and height $r$.',
          '',
          '`Annulus` makes a ring. Each ring goes to a `Rectangle` strip with `ReplacementTransform`, in a `LaggedStart`.',
        ),
        code: py`
from manim import *

R = 1.6
N = 12


class CircleArea(Scene):
    def construct(self):
        title = Text("Why is a circle's area πr²?", font_size=48).scale(0.6).to_edge(UP)
        self.add(title)
        center = LEFT * 3.5 + DOWN * 0.3
        dr = R / N
        rings = VGroup(*[
            Annulus(inner_radius=i * dr, outer_radius=(i + 1) * dr, stroke_width=0,
                    fill_opacity=0.9).move_to(center)
            for i in range(N)
        ]).set_color_by_gradient(BLUE, TEAL)
        self.play(FadeIn(rings))

        scale = 0.5  # the full base 2*pi*R does not fit, so the strips are drawn at half length
        base_y = DOWN * 1.9
        strips = VGroup()
        for i, ring in enumerate(rings):
            rho = (i + 0.5) * dr
            strip = Rectangle(width=2 * PI * rho * scale, height=dr, stroke_width=0, fill_opacity=0.9,
                              fill_color=ring.get_fill_color())
            strip.move_to(RIGHT * 0.5 + base_y + UP * (R - rho), aligned_edge=LEFT)
            strips.add(strip)
        self.play(LaggedStart(*[ReplacementTransform(r, s) for r, s in zip(rings[::-1], strips[::-1])],
                              lag_ratio=0.15), run_time=3)
        self.wait(0.5)
`,
        scene: 'CircleArea',
        task: 'Use 24 rings instead of 12. The stack looks more like a triangle.',
        hint: 'Change `N = 12` to `N = 24`.',
        check: 'N\\s*=\\s*24',
      },
      {
        title: 'Beat 4: the formula',
        md: md(
          'The area of a triangle is half base times height. Write it, then simplify with `TransformMatchingTex`. The parts `{{r}}` keep their place between steps.',
        ),
        code: py`
from manim import *


class CircleArea(Scene):
    def construct(self):
        title = Text("Why is a circle's area πr²?", font_size=48).scale(0.6).to_edge(UP)
        tri = Polygon(LEFT * 1.5 + DOWN * 1.5, RIGHT * 3.5 + DOWN * 1.5, LEFT * 1.5 + UP * 0.5,
                      color=TEAL, fill_opacity=0.6).shift(LEFT * 2)
        base = MathTex(r"2\pi r", color=BLUE).next_to(tri, DOWN)
        height = MathTex("r", color=YELLOW).next_to(tri, LEFT)
        self.add(title, tri, base, height)

        s1 = MathTex(r"A = \frac{1}{2} \cdot {{2\pi r}} \cdot {{r}}").shift(RIGHT * 3.5)
        s2 = MathTex(r"A = {{\pi r}} \cdot {{r}}").move_to(s1)
        s3 = MathTex(r"A = \pi r^2", font_size=64).move_to(s1)
        self.play(Write(s1))
        self.play(TransformMatchingTex(s1, s2))
        self.play(TransformMatchingTex(s2, s3))
        self.play(Circumscribe(s3, color=YELLOW))
        self.wait(1)
`,
        scene: 'CircleArea',
        task: 'Colour the `r` in the last formula yellow, to match the height label.',
        hint: '`MathTex(r"A = \\pi", "r", "^2", font_size=64)` and then `s3[1].set_color(YELLOW)`.',
        check: 'set_color\\(\\s*YELLOW\\s*\\)',
      },
      {
        title: 'Beat 5: put it together',
        md: md(
          'Now join the beats into one scene. Your task list:',
          '',
          '- Copy the code of steps 2, 3 and 4 into one `construct`, in order.',
          '- Between beats, clear what is no longer needed with `FadeOut`.',
          '- End with a summary card: the question and the answer.',
          '- Give each `play` a sensible `run_time`, and add `self.wait` where the viewer must think.',
          '- Watch the timeline: each bar should have a reason to be there.',
          '',
          'The code below is the summary beat to put at the end. When the whole film runs, share it with the **Share** button.',
        ),
        code: py`
from manim import *


class CircleArea(Scene):
    def construct(self):
        q = Text("Why is a circle's area πr²?", font_size=40)
        a = Tex(r"Unroll the rings: a triangle with base $2\pi r$ and height $r$.", font_size=36)
        f = MathTex(r"A = \tfrac{1}{2} \cdot 2\pi r \cdot r = \pi r^2", font_size=56)
        card = VGroup(q, a, f).arrange(DOWN, buff=0.6)
        box = SurroundingRectangle(f, color=YELLOW, buff=0.25)
        self.play(FadeIn(q, shift=DOWN * 0.3))
        self.play(Write(a))
        self.play(Write(f))
        self.play(Create(box))
        self.wait(2)
`,
        scene: 'CircleArea',
        task: 'Join all the beats into one `CircleArea` scene that runs from the title to this summary.',
        hint: 'Keep one `construct`. Use `self.play(FadeOut(*self.mobjects))` to clear the screen between beats.',
        check: { contains: ['Annulus', 'TransformMatchingTex', 'SurroundingRectangle'], animations: 10 },
      },
    ],
  },
];

export default LESSONS;
