"""manimlive -- the glue between the page and the real ManimCE package.

This package is NOT manim. It does not define or replace any manim module.
It imports the real ``manim`` (installed unmodified from the PyPI wheel into
site-packages) and attaches small observers to it:

    runtime.py     run(), boot(): config per run, scene pick, frame stream,
                   play/wait markers, errors   (grep -n "def run")
    tex.py         tex_to_svg_file() with MathJax 3 instead of LaTeX
                   (grep -n "def tex_to_svg_file")
    introspect.py  introspect(), source(), complete() for the editor
                   (grep -n "def introspect")

Every observer calls the original manim function and does not change its
arguments or its result. The full list is in runtime.install_hooks().
"""
