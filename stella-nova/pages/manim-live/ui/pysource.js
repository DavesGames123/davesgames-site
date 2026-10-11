// ============================================================================
//  PYSOURCE  ·  light reads of the user's Python text  (pure)
// ----------------------------------------------------------------------------
//  The worker finds the real Scene classes when it runs the code (event
//  'scenes'). These regex reads give the scene picker and the editor a fast
//  first guess before the worker is ready. They do not run Python.
//
//  EXPORTS   (grep -n "export function <name>" pysource.js)
//    guessScenes      class names whose bases end in "Scene"
//    animationLines   1-based lines with self.play( or self.wait(
//    dottedAt         the dotted name under a column: "Circle.set_fill"
//    tracebackLines   traceback text -> [{line, file, user}] frames
// ============================================================================

export function guessScenes(code) {
  const out = [];
  const re = /^class\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*:/gm;
  let m;
  while ((m = re.exec(code))) {
    if (/(^|[\s,.])\w*Scene\s*(,|$)/.test(m[2].trim()) || /Scene\b/.test(m[2])) out.push(m[1]);
  }
  return out;
}

export function animationLines(code) {
  const out = [];
  String(code).split('\n').forEach((l, i) => { if (/\bself\.(play|wait)\s*\(/.test(l) && !/^\s*#/.test(l)) out.push(i + 1); });
  return out;
}

// text: one line. col: 0-based. Returns the dotted name up to the end of
// the word at col ("Axes" for col 1 of "Axes.plot"), or empty text.
export function dottedAt(text, col) {
  const isId = c => /[\w.]/.test(c || '');
  if (!isId(text[col]) && !isId(text[col - 1])) return '';
  let a = col, b = col;
  while (a > 0 && isId(text[a - 1])) a--;
  while (b < text.length && /\w/.test(text[b])) b++;
  const name = text.slice(a, b).replace(/^\.+|\.+$/g, '');
  return /^[A-Za-z_][\w.]*$/.test(name) ? name : '';
}

// Frames in a Python traceback. user is true for a frame that is not in
// the installed packages (manim, numpy, the Python stdlib, Pyodide).
export function tracebackLines(tb) {
  const out = [];
  const re = /File "([^"]+)", line (\d+)/g;
  let m;
  while ((m = re.exec(String(tb || '')))) {
    const file = m[1];
    // The worker writes the user code to /home/pyodide/scene.py. The shims
    // live in /home/pyodide/py/, and the packages in site-packages.
    const user = !/site-packages|\/lib\/python|_pyodide|<frozen|\/home\/pyodide\/py\//.test(file);
    out.push({ file, line: +m[2], user });
  }
  return out;
}
