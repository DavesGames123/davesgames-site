// ============================================================================
//  ALPHA FROM ENTANGLED QUDITS  ·  story/index.js  (CORE, DOM-free)
// ----------------------------------------------------------------------------
//  The chapter text of the page, in our own words. The paper is
//  A. D. Wissner-Gross, "A Parameter-Free Candidate for the Fine-Structure
//  Constant from Entangled Qudits" (preprint, 23 October 2026). The text
//  paraphrases it. Short quotes (the axiom, theorem names) carry the
//  attribution. Stance: the page explains the paper and does not endorse
//  it. The identification with alpha(0) is Conjecture 1 of the paper.
//
//  CHAPTER SHAPE (one object per chapter, order fixed by CONTRACT.md)
//      { id: 'c3', num: 3, short, title, blocks: [...], figures: {...} }
//  A block is one of
//      { p: 'html' }                      a paragraph
//      { eq: 'key', note: 'html' }        a display equation (equations.js)
//      { fig: 'f3a' }                     a figure card (key of figures)
//      { analogy: { name, right, breaks } }   an analogy box
//      { list: ['html', ...] }            a short list
//      { table: 'configs' }               a table that main.js builds
//      { aside: 'html' }                  a caution or a note
//      { quote: 'text', cite: 'html' }    a short attributed quote
//      { more: { title, blocks } }        a closed 'go deeper' box
//      { hero: true } on chapter 0 only: main.js puts it in the hero
//  A figure is
//      { pkg: 'strands'|'ends'|'records'|'compare'|'core', title, tag,
//        scenes: [{ id, label, cap, pkg? }] }
//  A scene with its own pkg mounts that package in a second host of the
//  same card.
//  Each chapter has 2 to 5 top-level paragraphs (CONTRACT.md); more text
//  goes in a 'more' box. tests.mjs checks it.
//  tag is 'paper' (a result of the paper in our drawing), 'model' (our
//  own computation) or 'analogy'.
//
//  The glossary and the sources are in story/sources.js.
//
//  GREP MAP
//      grep -n 'export const CHAPTERS'   the ordered list
//      grep -n 'export function m(' inline.js   inline math helper
// ============================================================================
import { INTRO } from './intro.js';
import { MODEL } from './model.js';
import { COUNT } from './count.js';
import { WEIGH } from './weigh.js';
import { CLOSE } from './sources.js';

export { GLOSSARY, SOURCES, CREDITS, CHAPTER_REFS } from './sources.js';
export { MEASURED } from './weigh.js';

export const CHAPTERS = [...INTRO, ...MODEL, ...COUNT, ...WEIGH, ...CLOSE];

export { m } from './inline.js';
