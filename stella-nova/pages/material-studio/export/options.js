// ============================================================================
//  MATERIAL STUDIO  ·  export/options.js — the export panel options
// ────────────────────────────────────────────────────────────────────────────
//  OPTS holds the panel options. The module reads them from localStorage
//  once, at load, over DEFAULT_OPTS. saveOpts writes them back. exportPackage
//  merges its own opts over OPTS, so a call does not change OPTS.
//
//  GREP TARGETS
//      OPT_KEY  DEFAULT_OPTS  OPTS  saveOpts
// ============================================================================
import { DEFAULT_PLAIN } from './plans.js';

const OPT_KEY = 'material-studio.export';
export const DEFAULT_OPTS = {
  target: 'unity-urp', res: 0, fmt: 'png', heightFmt: 'png16', normalBits: 8, template: '{name}_{map}',
  maps: DEFAULT_PLAIN, includeGraph: true, helpers: true, readme: true, fold: true, displaceMesh: false,
  unityShaderGuid: '', godotRoot: 'res://materials/{name}', unrealDest: '/Game/Materials/{name}', compress: 'auto',
};
export let OPTS = { ...DEFAULT_OPTS };
try { Object.assign(OPTS, JSON.parse(localStorage.getItem(OPT_KEY) || '{}')); } catch (e) {}
export function saveOpts() { try { localStorage.setItem(OPT_KEY, JSON.stringify(OPTS)); } catch (e) {} }
