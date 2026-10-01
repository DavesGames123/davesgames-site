// app/hook.js -- window.__origami, the test hook that the headless check drives.
//
// The hook loads presets, folds to a fraction, freezes the sim, reads and
// writes the node positions, reports the state, maps a world point to CSS
// pixels, and runs any control action.
//
// grep map:
//   installHook -- set window.__origami
//   state:      -- the snapshot the headless check compares
//   worldToCss: -- a diagram world point to a CSS point on the canvas

import { reportOk } from '../foldability.js';
import * as patterns from '../patterns.js';
import { S, gpu } from './state.js';
import { stage, dpr, measure, geom2d, geom3d, view2d } from './layout.js';
import { syncUI } from './readouts.js';
import { loadPreset } from './edit.js';
import { apply } from './controls.js';

// Set window.__origami. main.js calls this once, before boot.
export function installHook() {
  window.__origami = {
    presets: () => patterns.ALL.map((p) => p.id),
    // Returns a promise: a file preset is fetched on first use.
    loadPreset: (id) => loadPreset(patterns.byId(id)),
    // Fold to `fraction` and run `steps` sim steps now, then hold.
    foldTo: (fraction, steps) => {
      S.auto = false; S.fraction = fraction; S.mesh.setFraction(fraction);
      for (let i = 0; i < steps; i++) S.mesh.step();
      S.mesh.recenter(); syncUI();
    },
    freeze: (on) => { S.frozen = !!on; },
    // Replace the live node positions (a native dump), then recenter.
    setNodes: (nodes) => {
      nodes.forEach((n, i) => { S.mesh.nodes[3 * i] = n[0]; S.mesh.nodes[3 * i + 1] = n[1]; S.mesh.nodes[3 * i + 2] = n[2]; });
      S.mesh.recenter();
    },
    nodes: () => Array.from({ length: S.mesh.nodeCount }, (_, i) => S.mesh.node(i)),
    state: () => ({
      preset: S.preset && S.preset.id, tool: S.tool, fraction: S.fraction, auto: S.auto,
      creases: S.pattern.edges.length, vertices: S.pattern.vertices.length, faces: S.planar.faces.length,
      undo: S.undo.length, redo: S.redo.length, layout: stage.className, gpu: !!gpu,
      srgbView: gpu ? !gpu.encode : null, report: S.report.length, bad: S.report.filter((r) => !reportOk(r)).length,
      hoveredFace: S.hoveredFace, hoveredCrease: S.hoveredCrease,
      finite: S.mesh.nodes.every(Number.isFinite),
    }),
    pane: (name) => { measure(); const g = name === '2d' ? geom2d : geom3d; return { rect: g.rect.map((x) => x / dpr), fit: g.fit.map((x) => x / dpr) }; },
    // World point of the diagram to a CSS point relative to the canvas.
    worldToCss: (x, y) => { measure(); const p = view2d().toPx([x, y]); return [p[0] / dpr, p[1] / dpr]; },
    apply: (act) => apply(act),
  };
}
