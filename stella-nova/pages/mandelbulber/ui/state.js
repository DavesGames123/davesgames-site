// ui/state.js — Mandelbulber page: the session state that many modules read.
//
// scene is the one scene object, in upstream units. engine is the WebGPU renderer from
// engine.js, or null. info is the last engine.frame() result, or null after a change.
// Other modules read the bindings and change them only through the set* functions,
// because an ES module import is read-only. The render settings (target samples,
// pixel ratio) and the touch detection are here too, because their defaults depend
// on the pointer type.
//
// grep: let scene  let activeSlot  let engine  let currentExample  let info  function setScene  function setInfo
//       const formulaAt  const coarseMQ  function noteTouch  const touchUI  const targetSamples  const renderScale  const pixelRatio

import { byEnum } from './data.js';

export let scene;
export let activeSlot = 0;
export let engine = null;
export let currentExample = -1;
export let info = null;

export function setScene(s) { scene = s; }
export function setActiveSlot(s) { activeSlot = s; }
export function setEngine(e) { engine = e; }
export function setCurrentExample(i) { currentExample = i; }
export function setInfo(r) { info = r; }

export const formulaAt = (s) => byEnum.get(scene.main[`formula_${s + 1}`]) || null;

export const coarseMQ = matchMedia('(pointer: coarse)');
export let touchSeen = false;                                // a touch pointer was used at least once
export function noteTouch() { touchSeen = true; }
export const touchUI = () => coarseMQ.matches || touchSeen;
export const targetSamples = { value: coarseMQ.matches ? 32 : 64 };
export const SAMPLES_DEFAULT = targetSamples.value;
// Pixel ratio of the render: the device ratio, capped at 2 (1.5 on touch screens by default).
export const renderScale = { value: coarseMQ.matches ? 1.5 : 2 };
export const RENDER_SCALE_DEFAULT = renderScale.value;
export const pixelRatio = () => Math.max(0.25, Math.min(window.devicePixelRatio || 1, 2, renderScale.value));
