// ============================================================================
//  STEM SPLITTER  ·  main.js — the page entry
// ----------------------------------------------------------------------------
//  Mounts the UI (ui/app.js) in #app with the engine client
//  (engine/client.js) and the model list (models.js). CONTRACT 5.5.
//  The client starts the Demucs worker on the first call. It ends the
//  worker on pagehide and on window.__snRelease, which frees the worker
//  WebGPU device. mountApp chains its own __snRelease (stop playback,
//  close the AudioContext). index.html loads JSZip as a classic script
//  before this module, so window.JSZip is set here.
//  No window.snSaver: the page has no screensaver (CONTRACT 6.4).
//
//  GREP MAP
//    mount ........ "mountApp("
// ============================================================================
import { createEngine } from './engine/client.js';
import { MODELS, DEFAULT_MODEL } from './models.js';
import { mountApp } from './ui/app.js';

mountApp(document.getElementById('app'), { engine: createEngine(), models: MODELS, defaultModel: DEFAULT_MODEL, jszip: window.JSZip || null });
