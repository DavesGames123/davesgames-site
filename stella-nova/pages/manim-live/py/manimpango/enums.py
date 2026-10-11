"""Pango enum values, with the same names and numbers as ManimPango 0.7."""

from enum import Enum


class Style(Enum):
    NORMAL = 0
    OBLIQUE = 1
    ITALIC = 2


class Weight(Enum):
    THIN = 100
    ULTRALIGHT = 200
    LIGHT = 300
    BOOK = 380
    NORMAL = 400
    MEDIUM = 500
    SEMIBOLD = 600
    BOLD = 700
    ULTRABOLD = 800
    HEAVY = 900
    ULTRAHEAVY = 1000


class Variant(Enum):
    NORMAL = 0
    SMALL_CAPS = 1


class Alignment(Enum):
    LEFT = 0
    CENTER = 1
    RIGHT = 2
