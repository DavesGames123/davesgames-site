// ui/thumbs.js — Mandelbulber page: the thumbnail tiles from the two sprites in gen/.
//
// thumb shows a formula from gen/thumbs.jpg. presetThumb shows a preset from
// gen/preset-thumbs.jpg, or the formula thumb when the preset has no tile. The tile
// offsets are percentages, so one sprite serves every tile size.
//
// grep: function thumb  function presetThumb

import { el } from './dom.js';
import { THUMBS, PTHUMBS, byEnum, isNone } from './data.js';

// Percent sprite offsets, so one sprite serves every thumbnail size. px = null
// leaves the size to CSS.
export function thumb(f, px = 64) {
  const size = px ? `width:${px}px;height:${px}px;` : '';
  if (isNone(f) || !THUMBS || f.thumb === undefined || f.thumb === null || f.thumb < 0) return el('div', { class: 'thumb none', style: size }, '∅');
  const { cols, rows } = THUMBS;
  const c = f.thumb % cols, r = Math.floor(f.thumb / cols);
  return el('div', { class: 'thumb', style: `${size}background-image:url(${THUMBS.url});background-size:${cols * 100}% ${rows * 100}%;` +
    `background-position:${cols > 1 ? (c / (cols - 1)) * 100 : 0}% ${rows > 1 ? (r / (rows - 1)) * 100 : 0}%` });
}

// The rendered thumbnail of the preset, or the formula icon when the sprite has none.
export function presetThumb(e, px = 64) {
  const i = PTHUMBS?.index?.[e.key];
  if (i === undefined) return thumb(byEnum.get(e._formula) || null, px);
  const { cols, rows, url } = PTHUMBS;
  const c = i % cols, r = Math.floor(i / cols);
  const size = px ? `width:${px}px;height:${px}px;` : '';
  return el('div', { class: 'thumb shot', style: `${size}background-image:url(${url});background-size:${cols * 100}% ${rows * 100}%;` +
    `background-position:${cols > 1 ? (c / (cols - 1)) * 100 : 0}% ${rows > 1 ? (r / (rows - 1)) * 100 : 0}%` });
}
