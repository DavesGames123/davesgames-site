// ============================================================================
//  HAIRLINE  ·  code.js — the snippets the focus view writes (no DOM)
// ----------------------------------------------------------------------------
//  snippet(kind, fig, opts) gives the code that mounts one figure with the
//  options the viewer set: kind 'js', 'react', 'svelte' or 'css'. An option
//  at its library default is left out, so the code stays short.
//  The API is the README of github.com/lucasmarkes/hairline (MIT).
//
//  GREP MAP
//    grep -n 'export function snippet'   one snippet
//    grep -n 'function optionList'       the options that differ from default
// ============================================================================
import { REPO, PALETTE_KEYS } from './catalog.js';

export const KINDS = [
  { id: 'js', label: 'Any DOM' },
  { id: 'react', label: 'React' },
  { id: 'svelte', label: 'Svelte' },
  { id: 'css', label: 'Theme CSS' },
];

const round = v => Math.round(v * 100) / 100;

// [key, source text] for each option that is not at its default.
function optionList(opts) {
  const out = [];
  const i = round(Number.isFinite(opts.intensity) ? opts.intensity : 0.5);
  if (i !== 0.5) out.push(['intensity', String(i)]);
  if (opts.theme && opts.theme !== 'auto') out.push(['theme', JSON.stringify(opts.theme)]);
  if (opts.play) out.push(['play', 'true']);
  return out;
}

export function snippet(kind, fig, opts = {}) {
  const Comp = fig.name, fn = fig.fn, list = optionList(opts);
  if (kind === 'react') {
    const props = list.map(([k, v]) => (v === 'true' ? ` ${k}` : v.startsWith('"') ? ` ${k}=${v}` : ` ${k}={${v}}`)).join('');
    return `import { ${Comp} } from "${REPO.pkg}/react";\n\nexport function Hero() {\n  return <${Comp}${props} />;\n}\n`;
  }
  if (kind === 'svelte') {
    const obj = list.length ? `{{ ${list.map(([k, v]) => `${k}: ${v}`).join(', ')} }}` : '';
    return `<script>\n  import { ${fn} } from "${REPO.pkg}";\n</script>\n\n<div use:${fn}${obj ? '=' + obj : ''}></div>\n`;
  }
  if (kind === 'css') {
    const v = opts.vars || {};
    const lines = PALETTE_KEYS.filter(k => v[k]).map(k => `  --hairline-${k}: ${v[k]};`);
    const sw = round(Number.isFinite(opts.stroke) ? opts.stroke : 0.9);
    lines.push(`  --hairline-stroke: ${sw};`);
    return `.figures {\n${lines.join('\n')}\n}\n`;
  }
  const obj = list.length ? `, { ${list.map(([k, v]) => `${k}: ${v}`).join(', ')} }` : '';
  return `import { ${fn} } from "${REPO.pkg}";\n\nconst figure = ${fn}(document.getElementById("figure")${obj});\n\n// later\nfigure.update({ intensity: 0.8 });\nfigure.destroy();\n`;
}

export const INSTALL = [
  { id: 'npm', label: 'npm', text: `npm i ${REPO.pkg}` },
  { id: 'shadcn', label: 'shadcn', text: 'npx shadcn@latest add https://hairline.lucasmarkes.com/r/hairline.json' },
  { id: 'skills', label: 'Agent skills', text: 'npx skills add lucasmarkes/hairline' },
];
