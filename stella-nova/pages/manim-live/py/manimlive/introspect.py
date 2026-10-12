"""Live reference data from the real manim objects (inspect, jedi).

    introspect("Circle") / ("manim.Circle") / ("Mobject.shift") / ("cairo")
        -> {kind, name, module, signature, doc, members:[{name, kind, summary}],
            bases, file, line}
    source(same names)  -> {file, line, text, note, original?}
                           (inspect.getsource; "original" is manim's own
                           source of a function that manim-live replaced)
    complete(code, line, col) -> [{name, kind, signature}]   (jedi)

Names resolve against the ``manim`` namespace first (what
``from manim import *`` gives), then as dotted module paths. ``file`` is
relative to site-packages for manim, and "py/<module>/..." for the
manim-live shims, so the page can say which code is real manim.
"""

from __future__ import annotations

import importlib
import inspect
import json
import os
import site
import sys

_SHIMS = ("cairo", "manimpango", "pathops", "mapbox_earcut", "av", "moderngl", "manimlive")


def _resolve(path: str):
    path = (path or "").strip().rstrip(".")
    if path.startswith("manim."):
        rest = path[len("manim.") :]
    elif path == "manim":
        return importlib.import_module("manim")
    else:
        rest = path
    import manim

    parts = rest.split(".")
    # 1. attribute chain from the manim namespace
    obj = manim
    ok = True
    for p in parts:
        if hasattr(obj, p):
            obj = getattr(obj, p)
        else:
            ok = False
            break
    if ok:
        return obj
    # 2. dotted module path, then attributes
    for cut in range(len(parts), 0, -1):
        modname = ".".join(parts[:cut])
        candidates = ["manim." + modname] if path.startswith("manim.") else [modname, "manim." + modname]
        for candidate in candidates:
            try:
                obj = importlib.import_module(candidate)
            except Exception:
                continue
            try:
                for p in parts[cut:]:
                    obj = getattr(obj, p)
                return obj
            except AttributeError:
                continue
    raise LookupError(f"'{path}' was not found in manim")


def _kind(obj) -> str:
    if inspect.ismodule(obj):
        return "module"
    if inspect.isclass(obj):
        return "class"
    if isinstance(obj, property):
        return "property"
    if inspect.ismethod(obj) or inspect.isfunction(obj) or inspect.isbuiltin(obj) or inspect.ismethoddescriptor(obj):
        return "function"
    if callable(obj):
        return "callable"
    return "constant"


def _rel_file(path: str | None) -> str | None:
    if not path:
        return None
    path = os.path.abspath(path)
    for sp in site.getsitepackages():
        if path.startswith(sp + os.sep):
            return path[len(sp) + 1 :]
    for name in _SHIMS:
        marker = os.sep + name + os.sep
        if marker in path:
            return "py/" + name + "/" + path.split(marker, 1)[1]
        if path.endswith(os.sep + name + ".py"):
            return "py/" + name + ".py"
    return path


def _signature(obj) -> str | None:
    try:
        if inspect.isclass(obj):
            sig = inspect.signature(obj.__init__)
            params = list(sig.parameters.values())[1:]
            return "(" + ", ".join(str(p) for p in params) + ")"
        return str(inspect.signature(obj))
    except (TypeError, ValueError):
        return None


def _summary(obj) -> str:
    doc = inspect.getdoc(obj) or ""
    return doc.strip().split("\n\n")[0].replace("\n", " ")[:200]


def _members(obj) -> list[dict]:
    out = []
    if inspect.ismodule(obj):
        names = getattr(obj, "__all__", None) or [n for n in dir(obj) if not n.startswith("_")]
        for n in names:
            try:
                v = getattr(obj, n)
            except AttributeError:
                continue
            out.append({"name": n, "kind": _kind(v), "summary": _summary(v) if not _kind(v) == "constant" else ""})
        return out
    if inspect.isclass(obj):
        for n in sorted(dir(obj)):
            if n.startswith("_"):
                continue
            raw = inspect.getattr_static(obj, n, None)
            owner = next((k.__name__ for k in obj.__mro__ if n in k.__dict__), obj.__name__)
            try:
                v = getattr(obj, n)
            except Exception:
                v = raw
            kind = "property" if isinstance(raw, property) else _kind(v)
            out.append({"name": n, "kind": kind, "summary": _summary(raw if isinstance(raw, property) else v) if kind != "constant" else "", "owner": owner})
    return out


def _unwrap(obj):
    """The function under a functools.wraps observer (runtime.install_hooks).

    inspect.getsourcelines() follows __wrapped__, but getsourcefile() does
    not. Without this, the real source of Scene.play would show with the
    file name of the observer (py/manimlive/runtime.py).
    """
    try:
        return inspect.unwrap(obj)
    except (TypeError, ValueError):
        return obj


def _note(file: str | None) -> str | None:
    """Plain text for the page when the code is not manim's own code."""
    if not file or not file.startswith("py/"):
        return None
    mod = file.split("/")[1]
    if mod == "manimlive":
        return ("This code is part of manim-live, not manim. It replaces a manim "
                "function that cannot run in a browser (see Under the hood).")
    return (f"This is the manim-live stand-in for the native module '{mod}', "
            "not the real library (see Under the hood).")


def introspect(path: str) -> str:
    try:
        obj = _resolve(path)
    except LookupError as e:
        return json.dumps({"error": str(e)})
    target = _unwrap(obj.fget if isinstance(obj, property) else obj)
    file = line = None
    try:
        file = _rel_file(inspect.getsourcefile(target))
        line = inspect.getsourcelines(target)[1]
    except (TypeError, OSError):
        pass
    info = {
        "kind": _kind(obj),
        "name": getattr(obj, "__qualname__", None) or getattr(obj, "__name__", None) or path,
        "module": getattr(obj, "__module__", None) if not inspect.ismodule(obj) else obj.__name__,
        "signature": _signature(target) if callable(target) else None,
        "doc": inspect.getdoc(target) or "",
        "members": _members(obj),
        "bases": [b.__module__ + "." + b.__qualname__ for b in obj.__mro__[1:]] if inspect.isclass(obj) else [],
        "file": file,
        "line": line,
        "note": _note(file),
    }
    if inspect.ismodule(obj) and getattr(obj, "__file__", None):
        info["path"] = obj.__file__
    return json.dumps(info, default=str)


def source(path: str) -> str:
    try:
        obj = _resolve(path)
        target = _unwrap(obj.fget if isinstance(obj, property) else obj)
        lines, start = inspect.getsourcelines(target)
        file = _rel_file(inspect.getsourcefile(target))
        out = {"file": file, "line": start, "text": "".join(lines), "note": _note(file)}
        original = getattr(target, "__manim_original__", None)
        if original is not None:
            olines, ostart = inspect.getsourcelines(original)
            out["original"] = {
                "file": _rel_file(inspect.getsourcefile(original)),
                "line": ostart,
                "text": "".join(olines),
            }
        return json.dumps(out)
    except (LookupError, TypeError, OSError) as e:
        return json.dumps({"error": f"No Python source for '{path}': {e}"})


_jedi_ok = None


def complete(code: str, line: int, col: int) -> str:
    """Completions at (line 1-based, col 0-based)."""
    global _jedi_ok
    if _jedi_ok is None:
        try:
            import jedi

            jedi.settings.cache_directory = "/tmp/jedi-cache"
            _jedi_ok = True
        except Exception:
            _jedi_ok = False
    if _jedi_ok:
        import jedi

        try:
            script = jedi.Script(code, path="/home/pyodide/scene.py")
            comps = script.complete(line, col)
            out = []
            for i, c in enumerate(comps[:120]):
                sig = None
                if i < 25 and c.type in ("function", "class"):
                    try:
                        sigs = c.get_signatures()
                        if sigs:
                            sig = sigs[0].to_string()
                    except Exception:
                        sig = None
                out.append({"name": c.name, "kind": c.type, "signature": sig})
            return json.dumps(out)
        except Exception:
            pass
    # Fallback: names of the manim namespace that match the word at the cursor.
    import re

    import manim

    lines = code.split("\n")
    text = lines[line - 1][:col] if 0 < line <= len(lines) else ""
    m = re.search(r"([A-Za-z_][A-Za-z0-9_]*)$", text)
    prefix = m.group(1) if m else ""
    names = sorted(n for n in dir(manim) if n.startswith(prefix) and not n.startswith("_"))
    return json.dumps([{"name": n, "kind": _kind(getattr(manim, n)), "signature": None} for n in names[:120]])
