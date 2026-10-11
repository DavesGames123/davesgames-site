# title: Dijkstra's shortest path
# topic: Networks
# level: 3
# scene: DijkstraShortestPath
# summary: Runs Dijkstra's algorithm on a road map with one-way streets (a DiGraph), writes the best known distance on each vertex, and lights up the shortest route at the end.
# concepts: DiGraph, edge_config, tip_config, labels, Graph.edges, set_fill(family=False), heapq, add_background_rectangle

from manim import *
import heapq

ROADS = {  # (from, to): travel time in minutes
    ("S", "A"): 4, ("S", "B"): 2, ("B", "A"): 1, ("A", "C"): 5,
    ("B", "C"): 8, ("B", "D"): 10, ("C", "D"): 2, ("C", "T"): 6, ("D", "T"): 2,
}
LAYOUT = {
    "S": [-5, 0, 0], "A": [-2.2, 1.6, 0], "B": [-2.2, -1.6, 0],
    "C": [1.0, 1.6, 0], "D": [1.0, -1.6, 0], "T": [4.2, 0, 0],
}


class DijkstraShortestPath(Scene):
    def construct(self):
        g = DiGraph(
            list(LAYOUT), list(ROADS), layout=LAYOUT, labels=True,
            vertex_config={"radius": 0.32, "fill_color": GREY_B},
            edge_config={"stroke_color": GREY_C, "stroke_width": 3,
                         "tip_config": {"tip_length": 0.18, "tip_width": 0.18}},
        ).shift(0.3 * DOWN)

        # The travel time written on each road, on a dark patch so lines do not cross it
        weights = VGroup()
        for (u, v), w in ROADS.items():
            label = MathTex(str(w), font_size=30, color=YELLOW)
            label.move_to(g.edges[(u, v)].get_center()).add_background_rectangle(opacity=0.9, buff=0.05)
            weights.add(label)

        title = Text("Dijkstra: always settle the closest vertex next", font_size=28).to_edge(UP, buff=0.25)
        self.play(Create(g), FadeIn(weights), Write(title), run_time=1.5)

        # A distance tag above every vertex; infinity until we find a route
        tags = {}
        for v in LAYOUT:
            side = DOWN if LAYOUT[v][1] < 0 else UP  # below the bottom row, above the rest
            tag = MathTex(r"\infty", font_size=34, color=BLUE_B).next_to(g.vertices[v], side, buff=0.12)
            tags[v] = tag
        self.play(*[FadeIn(t) for t in tags.values()])

        dist = {v: float("inf") for v in LAYOUT}
        prev = {}
        dist["S"] = 0
        self.play(Transform(tags["S"], MathTex("0", font_size=34, color=BLUE_B).move_to(tags["S"])))
        heap = [(0, "S")]
        settled = set()
        while heap:
            d, u = heapq.heappop(heap)
            if u in settled:
                continue
            settled.add(u)
            # u is settled: its distance can no longer improve
            self.play(g.vertices[u].animate.set_fill(GREEN, family=False), run_time=0.3)
            for (a, b), w in ROADS.items():
                if a != u or b in settled:
                    continue
                edge = g.edges[(a, b)]
                self.play(edge.animate.set_color(ORANGE), run_time=0.2)
                if d + w < dist[b]:
                    # a shorter route to b goes through u: relax the edge
                    dist[b] = d + w
                    prev[b] = u
                    heapq.heappush(heap, (dist[b], b))
                    new_tag = MathTex(str(dist[b]), font_size=34, color=BLUE_B).move_to(tags[b])
                    self.play(Transform(tags[b], new_tag), run_time=0.25)
                self.play(edge.animate.set_color(GREY_C), run_time=0.1)

        # Walk back from T through prev[] to get the route
        path, v = [], "T"
        while v != "S":
            path.append((prev[v], v))
            v = prev[v]
        path.reverse()
        self.play(*[g.edges[e].animate.set_color(GREEN).set_stroke(width=7) for e in path])
        route = " → ".join([path[0][0]] + [b for _, b in path])
        result = Text(f"Shortest route {route}: {dist['T']} minutes", font_size=28, color=GREEN).to_edge(DOWN, buff=0.3)
        self.play(Write(result))
        self.wait()
