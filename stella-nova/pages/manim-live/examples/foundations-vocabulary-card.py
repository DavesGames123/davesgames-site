# title: Vocabulary card
# topic: Text & math
# level: 1
# scene: VocabularyCard
# summary: Builds a dictionary-style word card with bold, italic, serif, monospace and coloured text, which covers the Text and MarkupText options you need most.
# concepts: Text, weight, slant, font, t2c, MarkupText, RoundedRectangle, AddTextLetterByLetter

from manim import *


class VocabularyCard(Scene):
    def construct(self):
        # The card itself
        card = RoundedRectangle(width=11, height=6, corner_radius=0.3)
        card.set_stroke(GREY_B, width=2).set_fill(GREY_E, opacity=0.6)

        # weight=BOLD for the headword
        word = Text("photosynthesis", font_size=60, weight=BOLD)
        # slant=ITALIC and a grey colour for the secondary line
        info = Text("noun  ·  fo-to-SIN-the-sis", font_size=30, slant=ITALIC, color=GREY_B)

        # MarkupText reads Pango markup: <b>, <i>, <span fgcolor=...>
        meaning = MarkupText(
            'How plants turn <span fgcolor="#FFD166">light</span>, '
            '<span fgcolor="#58C4DD">water</span> and\n'
            '<span fgcolor="#B0B0B0">carbon dioxide</span> into '
            '<span fgcolor="#83C167">sugar</span> and <b>oxygen</b>.',
            font_size=32,
        )

        # font="serif" for a quotation; t2c colours one word of a plain Text
        example = Text(
            '"Leaves are the factories of photosynthesis."',
            font="serif", slant=ITALIC, font_size=28,
            t2c={"photosynthesis": YELLOW},
        )
        # font="monospace" for something that looks like code or a tag
        tag = Text("#biology  #grade-7", font="monospace", font_size=24, color=TEAL)

        body = VGroup(word, info, meaning, example, tag).arrange(DOWN, buff=0.45)
        body.move_to(card)

        self.play(FadeIn(card))
        # AddTextLetterByLetter types the headword one letter at a time
        self.play(AddTextLetterByLetter(word), run_time=1.5)
        self.play(FadeIn(info, shift=UP * 0.2))
        self.play(Write(meaning), run_time=2)
        self.play(FadeIn(example))
        self.play(FadeIn(tag, shift=LEFT * 0.3))
        self.wait(0.5)

        # Underline the headword to finish the card
        self.play(Create(Underline(word, color=YELLOW, buff=0.1)))
        self.wait(1.5)
