"""Run user code with the real ManimCE and stream the result to the page.

Data path of one run (grep -n for the names)
--------------------------------------------
    run(code, opts_json)
      -> _exec_user_code      compile + exec into module "manim_live_scene"
      -> emit 'scenes'        Scene subclasses defined by the user code
      -> tempconfig(...)      quality, fps, transparent, format="none"
      -> SceneClass().render()                  (real manim)
           Scene.play          -> _play_observer     -> emit 'animation'
           Camera.display_multiple_non_background_colored_vmobjects
                               -> _draw_observer     -> cairo.sync_all()
           SceneFileWriter.write_frame
                               -> _frame_observer    -> host.emit_frame
      -> emit 'done'          or 'error' (with the user-code line)

Hooks (install_hooks). Each one calls the original manim function with the
same arguments and returns its result unchanged:
    Scene.play                        observer: line of the caller, frame span
    Camera.display_multiple_non_background_colored_vmobjects
                                      observer: flush the cairo command list
    SceneFileWriter.write_frame       observer: stream the frame
    tex_file_writing.tex_to_svg_file  REPLACED: MathJax instead of latex (tex.py)
    tex_mobject.tex_to_svg_file       same function, imported there by name
"""

from __future__ import annotations

import functools
import gc
import json
import linecache
import os
import sys
import time
import traceback
import types

USER_FILE = "/home/pyodide/scene.py"
MODULE_NAME = "manim_live_scene"
MEDIA_DIR = "/tmp/manim-media"
QUALITIES = {
    "low": ("low_quality", 854, 480, 15),
    "medium": ("medium_quality", 1280, 720, 30),
    "high": ("high_quality", 1920, 1080, 60),
}


class _RunState:
    def __init__(self):
        self.active = False
        self.frames = 0
        self.fps = 15
        self.depth = 0
        self.animations = 0
        self.width = 0
        self.height = 0


_run = _RunState()
_hooks_installed = False


def _host():
    import manimlive_host

    return manimlive_host


def _emit(name: str, data) -> None:
    _host().emit(name, json.dumps(data))


def _user_line(skip: int = 2) -> int | None:
    """Line of the innermost user-code frame on the stack."""
    f = sys._getframe(skip)
    while f is not None:
        if f.f_code.co_filename == USER_FILE:
            return f.f_lineno
        f = f.f_back
    return None


def _anim_name(anim) -> str:
    try:
        from manim import Wait

        if isinstance(anim, Wait):
            return "Wait"
        methods = getattr(anim, "methods", None)
        if type(anim).__name__ == "_MethodAnimation" and methods:
            names = []
            for m in methods:
                fn = getattr(m, "method", None)
                names.append(getattr(fn, "__name__", "method"))
            return f"{type(anim.mobject).__name__}.animate." + ".".join(names)
        s = str(anim)
    except Exception:
        s = type(anim).__name__
    return s if len(s) <= 80 else s[:77] + "..."


def install_hooks() -> None:
    """Attach the observers and the TeX redirect. Idempotent."""
    global _hooks_installed
    if _hooks_installed:
        return
    import cairo
    import manim.mobject.text.tex_mobject as tex_mobject
    import manim.utils.tex_file_writing as tex_file_writing
    from manim.camera.camera import Camera
    from manim.scene.scene import Scene
    from manim.scene.scene_file_writer import SceneFileWriter

    from . import tex

    orig_draw = Camera.display_multiple_non_background_colored_vmobjects

    @functools.wraps(orig_draw)
    def _draw_observer(self, vmobjects, pixel_array):
        try:
            return orig_draw(self, vmobjects, pixel_array)
        finally:
            cairo.sync_all()

    Camera.display_multiple_non_background_colored_vmobjects = _draw_observer

    orig_write = SceneFileWriter.write_frame

    @functools.wraps(orig_write)
    def _frame_observer(self, pixels, *, repeat=1):
        if _run.active:
            index = _run.frames
            _run.frames += int(repeat)
            h, w = pixels.shape[0], pixels.shape[1]
            _run.width, _run.height = w, h
            _host().emit_frame(pixels, w, h, index, index / _run.fps, int(repeat))
        return orig_write(self, pixels, repeat=repeat)

    SceneFileWriter.write_frame = _frame_observer

    orig_play = Scene.play

    @functools.wraps(orig_play)
    def _play_observer(self, *args, **kwargs):
        if not _run.active or _run.depth:
            return orig_play(self, *args, **kwargs)
        line = _user_line()
        start_frame = _run.frames
        start_time = self.renderer.time
        _run.depth += 1
        try:
            result = orig_play(self, *args, **kwargs)
        finally:
            _run.depth -= 1
        anims = self.animations or []
        _emit(
            "animation",
            {
                "index": _run.animations,
                "name": ", ".join(_anim_name(a) for a in anims) or "play",
                "line": line,
                "runTime": float(self.renderer.time - start_time),
                "startFrame": start_frame,
                "endFrame": _run.frames,
            },
        )
        _run.animations += 1
        return result

    Scene.play = _play_observer

    tex_file_writing.tex_to_svg_file = tex.tex_to_svg_file
    tex_mobject.tex_to_svg_file = tex.tex_to_svg_file
    _hooks_installed = True


def boot() -> str:
    """Import the real manim, attach the hooks, return facts as JSON."""
    t0 = time.time()
    os.makedirs(MEDIA_DIR, exist_ok=True)
    os.chdir("/home/pyodide")
    import manim

    t_import = time.time() - t0
    try:
        import tqdm

        tqdm.tqdm.monitor_interval = 0  # no monitor thread in wasm
    except Exception:
        pass
    install_hooks()
    from manim import config

    config.media_dir = MEDIA_DIR
    config.verbosity = "WARNING"
    config.progress_bar = "none"
    config.disable_caching = True
    import importlib.metadata as md

    dist = md.distribution("manim")
    shims = {}
    for name in ("cairo", "manimpango", "pathops", "mapbox_earcut", "av", "moderngl"):
        mod = sys.modules.get(name) or __import__(name)
        shims[name] = mod.__file__
    return json.dumps(
        {
            "manimVersion": manim.__version__,
            "manimFile": manim.__file__,
            "distVersion": dist.version,
            "python": sys.version.split()[0],
            "importSeconds": round(t_import, 3),
            "shims": shims,
            "tex": "MathJax 3.2.2 (manimlive/tex.py)",
        }
    )


def _exec_user_code(code: str) -> types.ModuleType:
    with open(USER_FILE, "w", encoding="utf-8") as f:
        f.write(code)
    linecache.checkcache(USER_FILE)
    sys.modules.pop(MODULE_NAME, None)
    module = types.ModuleType(MODULE_NAME)
    module.__file__ = USER_FILE
    sys.modules[MODULE_NAME] = module
    exec(compile(code, USER_FILE, "exec"), module.__dict__)
    return module


def _scene_classes(module) -> list:
    from manim import Scene

    out = []
    for obj in module.__dict__.values():
        if isinstance(obj, type) and issubclass(obj, Scene) and obj.__module__ == MODULE_NAME:
            out.append(obj)
    return out


def _error_payload(exc: BaseException) -> dict:
    line = None
    if isinstance(exc, SyntaxError) and exc.filename == USER_FILE:
        line = exc.lineno
    tb = exc.__traceback__
    while tb is not None:
        if tb.tb_frame.f_code.co_filename == USER_FILE:
            line = tb.tb_lineno
        tb = tb.tb_next
    text = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    return {
        "type": type(exc).__name__,
        "message": str(exc) or type(exc).__name__,
        "traceback": text,
        "line": line,
    }


def run(code: str, opts_json: str = "{}") -> str:
    """Render one scene of ``code``. Events go out through the host module."""
    from manim import config, tempconfig

    opts = json.loads(opts_json or "{}")
    q = QUALITIES.get(opts.get("quality") or "low", QUALITIES["low"])
    fps = int(opts.get("fps") or q[3])
    _run.__init__()
    _run.fps = fps
    summary = {"ok": False}
    t0 = time.time()
    try:
        module = _exec_user_code(code)
        scenes = _scene_classes(module)
        _emit("scenes", [s.__name__ for s in scenes])
        if not scenes:
            raise RuntimeError("No Scene subclass found. Define a class like: class MyScene(Scene): ...")
        wanted = opts.get("scene")
        cls = None
        if wanted:
            cls = next((s for s in scenes if s.__name__ == wanted), None)
            if cls is None:
                raise RuntimeError(f"Scene '{wanted}' is not defined in the code. Found: {', '.join(s.__name__ for s in scenes)}")
        else:
            cls = scenes[-1]
        settings = {
            "quality": q[0],
            "pixel_width": q[1],
            "pixel_height": q[2],
            "frame_rate": fps,
            "format": "none",
            "disable_caching": True,
            "progress_bar": "none",
            "media_dir": MEDIA_DIR,
            "input_file": USER_FILE,
            "preview": False,
            "dry_run": False,
            "renderer": "cairo",
        }
        if opts.get("transparent"):
            settings["transparent"] = True
            settings["background_opacity"] = 0.0
        with tempconfig(settings):
            _run.active = True
            scene = cls()
            scene.render()
            if _run.frames == 0:
                # A scene without play(): manim drew the last frame but wrote
                # nothing (format none). Stream that frame.
                frame = scene.renderer.get_frame()
                h, w = frame.shape[0], frame.shape[1]
                _run.width, _run.height = w, h
                _host().emit_frame(frame, w, h, 0, 0.0, 1)
                _run.frames = 1
            summary = {
                "ok": True,
                "scene": cls.__name__,
                "frames": _run.frames,
                "duration": _run.frames / fps,
                "width": _run.width,
                "height": _run.height,
                "fps": fps,
                "seconds": round(time.time() - t0, 3),
            }
        _emit("done", {k: summary[k] for k in ("frames", "duration", "width", "height", "fps")})
    except BaseException as exc:  # includes KeyboardInterrupt from cancel()
        payload = _error_payload(exc)
        _emit("error", payload)
        summary = {"ok": False, "error": payload}
    finally:
        _run.active = False
        _run.depth = 0
        sys.modules.pop(MODULE_NAME, None)
        gc.collect()
    return json.dumps(summary)
