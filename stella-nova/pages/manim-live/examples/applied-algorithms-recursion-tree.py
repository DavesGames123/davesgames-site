# title: Recursion tree of fib(4)
# topic: Algorithms
# level: 2
# scene: FibonacciCallTree
# summary: Draws every call that the naive recursive fib(4) makes, in the order Python makes them, then sends the return values back up and marks the repeated work.
# concepts: RoundedRectangle, Line, Text, recursion, LaggedStart, Circumscribe, Create

from manim import *


def fib(n):
    return n if n < 2 else fib(n - 1) + fib(n - 2)


class FibonacciCallTree(Scene):
    def construct(self):
        title = Text("fib(n) = fib(n-1) + fib(n-2)", font_size=30).to_edge(UP, buff=0.3)
        self.play(Write(title))

        nodes = []      # (n, mobject, parent_index) in call order
        edges = []

        def call(n, x, y, width, parent):
            # place this call, then its children below it, left child first
            box = RoundedRectangle(width=1.25, height=0.55, corner_radius=0.12, color=BLUE)
            label = Text(f"fib({n})", font_size=20).move_to(box)
            node = VGroup(box, label).move_to([x, y, 0])
            me = len(nodes)
            nodes.append((n, node, parent))
            if parent is not None:
                edges.append(Line(nodes[parent][1].get_bottom(), node.get_top(), color=GREY_B, stroke_width=2))
            else:
                edges.append(None)
            if n >= 2:
                call(n - 1, x - width / 2, y - 1.25, width / 2, me)
                call(n - 2, x + width / 2, y - 1.25, width / 2, me)

        call(4, 0, 2.3, 6.4, None)

        # 1. The calls, in the order Python runs them (depth first)
        for (n, node, parent), edge in zip(nodes, edges):
            anims = [FadeIn(node, shift=0.2 * DOWN)]
            if edge is not None:
                anims.append(Create(edge))
            self.play(*anims, run_time=0.35)
        self.wait(0.3)

        # 2. The return values flow back up, from the last call to the first
        for n, node, parent in reversed(nodes):
            value = Text(str(fib(n)), font_size=22, color=YELLOW).next_to(node, RIGHT, buff=0.08)
            self.play(FadeIn(value, scale=0.5), node[0].animate.set_color(GREEN), run_time=0.2)

        # 3. The same work is done more than once: fib(2) runs twice
        repeats = [node for n, node, _ in nodes if n == 2]
        note = Text("fib(2) is computed twice: memoise it", font_size=26, color=RED_B).to_edge(DOWN)
        self.play(*[Circumscribe(r, color=RED) for r in repeats], FadeIn(note))
        self.wait()
