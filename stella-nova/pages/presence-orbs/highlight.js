// ============================================================================
//  PRESENCE ORBS  ·  highlight.js — WGSL syntax colorizer
// ----------------------------------------------------------------------------
//  highlight(src) returns HTML that wraps each token in a <span> with a tk-*
//  class. The inspector calls it to paint the pack source in the modal. One
//  regular expression splits the source into comment / attribute / number /
//  identifier / swizzle / operator / other, and the identifier arm sorts the
//  word into keyword, type, built-in function or plain name.
// ============================================================================
const KW = new Set('fn let var const struct return if else for while loop break continue continuing switch case default discard true false override alias enable requires const_assert'.split(' '));
const BI = new Set('select mix min max clamp step smoothstep length normalize dot cross abs sign floor ceil fract round trunc sqrt exp exp2 log log2 pow sin cos tan asin acos atan atan2 sinh cosh tanh saturate fma any all fwidth dpdx dpdy inverseSqrt transpose determinant distance reflect refract array'.split(' '));
const TY = /^(f32|i32|u32|f16|bool|vec[234][fiu]?|mat[234]x[234]f?|vec[234]<[^>]*>|array<[^>]*>)$/;
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const RE = /(\/\/[^\n]*)|(@[A-Za-z_]+)|(0[xX][0-9a-fA-F]+u?|\d+\.\d*(?:[eE][+-]?\d+)?[fh]?|\.\d+(?:[eE][+-]?\d+)?[fh]?|\d+(?:[eE][+-]?\d+)?[fhiu]?)|([A-Za-z_]\w*)|(\.[xyzwrgba]{1,4}\b)|([-+*\/%<>=!&|^~?:]+)|([\s\S])/g;
export function highlight(src) {
  let out = '';
  src.replace(RE, (m, cm, at, num, id, sw, op, ch, off) => {
    if (cm) out += `<span class="tk-cm">${esc(cm)}</span>`;
    else if (at) out += `<span class="tk-at">${esc(at)}</span>`;
    else if (num) out += `<span class="tk-num">${num}</span>`;
    else if (id) {
      if (KW.has(id)) out += `<span class="tk-kw">${id}</span>`;
      else if (TY.test(id)) out += `<span class="tk-ty">${id}</span>`;
      else if (BI.has(id)) out += `<span class="tk-bi">${id}</span>`;
      else if (src[off + id.length] === '(') out += `<span class="tk-fn">${id}</span>`;
      else out += id;
    }
    else if (sw) out += `<span class="tk-sw">${sw}</span>`;
    else if (op) out += `<span class="tk-op">${esc(op)}</span>`;
    else out += esc(ch);
    return m;
  });
  return out;
}
