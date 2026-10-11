# title: Breadth-first search
# topic: Algorithms
# level: 2
# scene: BreadthFirstSearch
# summary: Explores a graph from vertex A in rings of equal distance, with the queue drawn under the graph so you can follow every step.
# concepts: Graph, layout dict, labels, Graph.vertices, Graph.edges, animate.set_fill, VGroup queue

from manim import *
from collections import deque

VERTICES = list("ABCDEFGHI")
EDGES = [("A", "B"), ("A", "C"), ("B", "D"), ("B", "E"), ("C", "E"), ("C", "F"),
         ("D", "G"), ("E", "G"), ("E", "H"), ("F", "H"), ("G", "I"), ("H", "I")]
# Hand-placed positions keep the picture tidy
LAYOUT = {
    "A": [-5, 0, 0], "B": [-3, 1.3, 0], "C": [-3, -1.3, 0], "D": [-0.8, 2, 0],
    "E": [-0.8, 0, 0], "F": [-0.8, -2, 0], "G": [1.6, 1.2, 0], "H": [1.6, -1.2, 0], "I": [3.6, 0, 0],
}
RING_COLORS = [YELLOW, ORANGE, RED, PURPLE, BLUE]


class BreadthFirstSearch(Scene):
    def construct(self):
        g = Graph(
            VERTICES, EDGES, layout=LAYOUT, labels=True,
            vertex_config={"radius": 0.3, "fill_color": GREY_B},
            edge_config={"stroke_color": GREY_B},
        ).shift(0.6 * UP)
        title = Text("Breadth-first search from A", font_size=32).to_corner(UL)
        queue_label = Text("queue:", font_size=26, color=GREY_B).to_corner(DL).shift(0.2 * UP)
        self.play(Create(g), Write(title), FadeIn(queue_label))

        def queue_view(items):
            # the queue drawn as a row of small boxes, front on the left
            boxes = VGroup(*[
                VGroup(Square(0.5, color=WHITE), Text(v, font_size=22)) for v in items
            ]).arrange(RIGHT, buff=0.08)
            return boxes.next_to(queue_label, RIGHT, buff=0.3)

        dist = {"A": 0}
        queue = deque(["A"])
        q_mob = queue_view(queue)
        self.play(g.vertices["A"].animate.set_fill(RING_COLORS[0], opacity=1, family=False), FadeIn(q_mob))

        while queue:
            v = queue.popleft()
            # take v from the front of the queue
            self.play(Indicate(g.vertices[v], color=WHITE), run_time=0.4)
            new = []
            for u in VERTICES:
                if (v, u) in g.edges or (u, v) in g.edges:
                    if u not in dist:
                        dist[u] = dist[v] + 1
                        queue.append(u)
                        new.append(u)
            anims = []
            for u in new:
                edge = g.edges.get((v, u)) or g.edges.get((u, v))
                anims += [
                    edge.animate.set_stroke(RING_COLORS[dist[u]], width=6),
                    # family=False colours the disc only, not the letter on it
                    g.vertices[u].animate.set_fill(RING_COLORS[dist[u]], opacity=1, family=False),
                ]
            new_q = queue_view(queue)
            self.play(*anims, Transform(q_mob, new_q), run_time=0.6)

        legend = VGroup(*[
            VGroup(Dot(color=c), Text(f"distance {d}", font_size=20)).arrange(RIGHT, buff=0.15)
            for d, c in enumerate(RING_COLORS)
        ]).arrange(DOWN, aligned_edge=LEFT).to_corner(UR)
        self.play(FadeIn(legend))
        self.wait()
