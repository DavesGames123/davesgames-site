// ============================================================================
//  MATERIAL STUDIO  ·  panels/widgets/index.js — param kind -> widget table
// ────────────────────────────────────────────────────────────────────────────
//  Each widget is makeX(p, value, onChange) -> {el, set(v)}. onChange(v,
//  final): final is false while a drag runs and true when the gesture
//  ends. makeWidget picks the widget from p.kind. WIDE lists the kinds
//  that take the full row width.
//
//  GREP TARGETS
//      WIDGETS WIDE makeWidget
// ============================================================================
import { wSlider } from './slider.js';
import { wColor } from './color.js';
import { wEnum, wBool, wVec2, wText } from './basic.js';
import { wGradient } from './gradient.js';
import { wCurve } from './curve.js';
import { wImage } from './image.js';

export const WIDGETS = { slider: wSlider, int: wSlider, color: wColor, enum: wEnum, bool: wBool, vec2: wVec2, gradient: wGradient, curve: wCurve, image: wImage, text: wText };
export const WIDE = new Set(['gradient', 'curve', 'image', 'text']);
export function makeWidget(p, value, onChange) {
  const fn = WIDGETS[p.kind] || (typeof p.default === 'number' ? wSlider : wText);
  return fn(p, value, onChange);
}
