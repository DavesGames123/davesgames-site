# title: Merge sort
# topic: Algorithms
# level: 2
# scene: MergeSort
# summary: Splits a list of eight numbers into halves until each piece has one number, then merges the pieces back in order, level by level.
# concepts: VGroup, arrange, Square, Text, TransformFromCopy, FadeOut, SurroundingRectangle

from manim import *

DATA = [38, 27, 43, 3, 9, 82, 10, 15]
ROW_Y = [2.2, 0.9, -0.4, -1.7]  # height of each split level


def row(values, color=BLUE):
    # a block of joined boxes, one number in each
    cells = VGroup()
    for v in values:
        box = Square(0.6, fill_color=color, fill_opacity=0.25, stroke_color=color)
        cells.add(VGroup(box, Text(str(v), font_size=20).move_to(box)))
    return cells.arrange(RIGHT, buff=0)


def pieces_at(level):
    # the list cut into 2**level equal pieces
    size = len(DATA) // 2**level
    return [DATA[i:i + size] for i in range(0, len(DATA), size)]


def layout(groups, y):
    # spread the pieces across the screen, spaced like a tree
    VGroup(*groups).arrange(RIGHT, buff=0.35).move_to(UP * y)
    return groups


class MergeSort(Scene):
    def construct(self):
        title = Text("Merge sort: split, then merge", font_size=34).to_edge(UP, buff=0.2)
        self.play(Write(title))

        # --- split phase: each level cuts every piece in half -------------------
        levels = []
        for lv in range(4):
            groups = layout([row(p) for p in pieces_at(lv)], ROW_Y[lv])
            levels.append(groups)
            if lv == 0:
                self.play(FadeIn(*groups))
            else:
                parents = levels[lv - 1]
                self.play(*[
                    TransformFromCopy(parents[i // 2][(i % 2) * len(g):(i % 2 + 1) * len(g)], g)
                    for i, g in enumerate(groups)
                ], run_time=0.8)
        self.wait(0.3)

        # --- merge phase: going back up, pairs of sorted pieces become one ---
        current, current_values = levels[3], pieces_at(3)
        for lv in (2, 1, 0):
            merged_values = []
            for i in range(2**lv):
                merged_values.append(sorted(current_values[2 * i] + current_values[2 * i + 1]))
            merged = layout([row(v, GREEN) for v in merged_values], ROW_Y[lv])
            anims = [FadeOut(*levels[lv])]  # the unsorted row at this level goes away
            for i, target in enumerate(merged):
                pair = [*current[2 * i], *current[2 * i + 1]]
                pair_values = current_values[2 * i] + current_values[2 * i + 1]
                # each number flies to its sorted place in the merged piece
                for cell, value in zip(pair, pair_values):
                    anims.append(TransformFromCopy(cell, target[merged_values[i].index(value)]))
            self.play(*anims, run_time=1.2)
            current, current_values = merged, merged_values
            self.wait(0.2)

        box = SurroundingRectangle(current[0], color=GREEN, buff=0.1)
        note = Text("log2(8) = 3 levels, 8 numbers moved per level", font_size=24, color=GREY_B).to_edge(DOWN, buff=0.6)
        self.play(Create(box), FadeIn(note))
        self.wait()
