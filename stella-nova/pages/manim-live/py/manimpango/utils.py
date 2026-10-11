"""PangoUtils with the same behaviour as ManimPango 0.7 (manimpango/utils.py)."""

import re

from .enums import Style, Weight


class PangoUtils:
    @staticmethod
    def str2style(string: str) -> Style:
        """Convert a manim slant name to a Pango style."""
        styles = {"NORMAL": Style.NORMAL, "ITALIC": Style.ITALIC, "OBLIQUE": Style.OBLIQUE}
        try:
            return styles[string]
        except KeyError:
            raise AttributeError("There is no Style Called %s" % string)

    @staticmethod
    def str2weight(string: str) -> Weight:
        """Convert a manim weight name to a Pango weight."""
        try:
            return Weight[string]
        except KeyError:
            raise AttributeError("There is no Font Weight Called %s" % string)

    @staticmethod
    def remove_last_M(file_name: str) -> None:
        """Remove a trailing move-to from each path, as ManimPango does."""
        with open(file_name, "r") as fpr:
            content = fpr.read()
        content = re.sub(r'Z M [^A-Za-z]*? "\/>', 'Z "/>', content)
        with open(file_name, "w") as fpw:
            fpw.write(content)
