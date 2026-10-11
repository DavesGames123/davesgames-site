# title: Highlighting toolkit
# topic: Explainer patterns
# level: 1
# scene: HighlightToolkit
# summary: Points the viewer at different words of one sentence with seven highlight effects, and names each effect as it plays, so you can pick the right one.
# concepts: Indicate, Circumscribe, SurroundingRectangle, Flash, Wiggle, ShowPassingFlash, Underline, FocusOn

from manim import *


class HighlightToolkit(Scene):
    def construct(self):
        text = "Light travels faster than sound"
        sentence = Text(text, font_size=52).shift(UP * 0.5)
        self.play(Write(sentence))

        # A Text has one submobject per visible character (spaces are skipped),
        # so we count the non-space characters before a word to slice it out.
        def word(w):
            start = text.index(w)
            skip = len(text[:start].replace(" ", ""))
            return sentence[skip: skip + len(w)]

        light, travels, faster, than, sound = (word(w) for w in text.split())

        # The name of the effect sits at the bottom and changes with each effect
        name = VMobject()

        def effect(label, animation, **kwargs):
            nonlocal name
            new = Text(label, font="monospace", font_size=30, color=YELLOW).to_edge(DOWN, buff=1)
            # The label change and the effect play at the same time
            self.play(FadeTransform(name, new), animation, **kwargs)
            name = new

        effect("Indicate", Indicate(light, color=YELLOW))
        effect("Circumscribe", Circumscribe(faster, color=TEAL))
        box = SurroundingRectangle(sound, color=ORANGE, buff=0.12)
        effect("SurroundingRectangle", Create(box))
        effect("Flash", Flash(light.get_center(), color=YELLOW, flash_radius=0.9))
        effect("Wiggle", Wiggle(travels))
        effect("ShowPassingFlash", ShowPassingFlash(Underline(faster, color=TEAL, stroke_width=8), time_width=0.5), run_time=1.2)
        effect("FocusOn", FocusOn(than))

        # Keep a coloured result on screen at the end
        self.play(
            light.animate.set_color(YELLOW),
            faster.animate.set_color(TEAL),
            sound.animate.set_color(ORANGE),
            FadeOut(name),
        )
        self.wait(1)
