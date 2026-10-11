# title: Graph layouts
# topic: Networks
# level: 1
# scene: GraphLayouts
# summary: Keeps one network of ten people fixed and moves it through four layout algorithms and one hand-made layout, so you can see that a layout only changes the picture, never the connections.
# concepts: Graph, change_layout, animate, layout_scale, layout_config, labels, layout dict

from manim import *

PEOPLE = list(range(1, 11))
FRIENDS = [(1, 2), (1, 3), (2, 3), (3, 4), (4, 5), (5, 6), (4, 6), (6, 7),
           (7, 8), (8, 9), (9, 7), (9, 10), (10, 1), (2, 8)]


class GraphLayouts(Scene):
    def construct(self):
        g = Graph(
            PEOPLE, FRIENDS, labels=True, layout="circular", layout_scale=2.6,
            vertex_config={"radius": 0.28, "fill_color": TEAL_D},
            edge_config={"stroke_color": GREY_B, "stroke_width": 3},
        ).shift(0.4 * DOWN)
        name = Text('layout="circular"', font_size=30).to_edge(UP)
        self.play(Create(g), Write(name))
        self.wait(0.5)

        for layout, config in [
            ("spring", {"seed": 3}),     # edges act like springs
            ("kamada_kawai", {}),        # screen distance follows path length
            ("shell", {"nlist": [[1, 4, 7], [2, 3, 5, 6, 8, 9, 10]]}),  # rings of vertices
        ]:
            new_name = Text(f'layout="{layout}"', font_size=30).to_edge(UP)
            self.play(
                g.animate.change_layout(layout, layout_scale=2.6, layout_config=config).shift(0.4 * DOWN),
                Transform(name, new_name),
                run_time=1.5,
            )
            self.wait(0.6)

        # You can also pass your own positions as a dict {vertex: point}.
        # Here each triangle of friends gets its own corner of the screen.
        mine = {
            1: [-5, 0, 0], 2: [-3.5, 1.2, 0], 3: [-3.5, -1.2, 0],
            4: [-1.2, -1.3, 0], 5: [0, -2.2, 0], 6: [1.2, -1.3, 0],
            7: [3.5, -1.2, 0], 8: [3.5, 1.2, 0], 9: [5, 0, 0], 10: [0, 2.2, 0],
        }
        self.play(
            g.animate.change_layout(mine).shift(0.2 * DOWN),
            Transform(name, Text("layout={vertex: point, ...}", font_size=30).to_edge(UP)),
            run_time=1.5,
        )
        self.wait(0.6)

        note = Text("Same 10 vertices and 14 edges every time", font_size=24, color=GREY_B).to_edge(DOWN, buff=0.3)
        self.play(FadeIn(note))
        self.wait()
