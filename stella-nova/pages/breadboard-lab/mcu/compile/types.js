// ============================================================================
//  BREADBOARD LAB  ·  mcu/compile/types.js — the C types of the sketch
// ----------------------------------------------------------------------------
//  Type names: bool char i8 u8 i16 u16 i32 u32 f32 f64 String cstr, obj:LCD,
//  obj:Servo, and { k: "arr", el, dims } for arrays. typeResolver maps the
//  type words of a declaration to one of these names for a board.
//
//  grep -n targets
//    RANGE / SIZE ......... integer ranges, sizeof
//    isInt / isFloat / isNum  type tests
//    tName ................ the C name of a type
//    wrapCode ............. JS that wraps a value to its width
//    litWrap .............. the same for a literal value
//    typeResolver ......... type words -> type name
// ============================================================================
import { CErr } from './errors.js';

export const RANGE = { bool: [0, 1], char: [-128, 127], i8: [-128, 127], u8: [0, 255], i16: [-32768, 32767], u16: [0, 65535], i32: [-2147483648, 2147483647], u32: [0, 4294967295] };
export const SIZE = { bool: 1, char: 1, i8: 1, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4, f32: 4, f64: 8, String: 6, cstr: 2 };
export const isInt = t => typeof t === 'string' && t in RANGE;
export const isFloat = t => t === 'f32' || t === 'f64';
export const isNum = t => isInt(t) || isFloat(t);
export const isArr = t => t && typeof t === 'object' && t.k === 'arr';
export const isText = t => t === 'String' || t === 'cstr';
export const isCharArr = t => isArr(t) && t.el === 'char' && t.dims.length === 1;
export const tName = t => isArr(t) ? `${tName(t.el)}[${t.dims.map(d => d ?? '').join('][')}]` :
  ({ bool: 'bool', char: 'char', i8: 'int8_t', u8: 'byte', i16: 'int', u16: 'unsigned int', i32: 'long', u32: 'unsigned long', f32: 'float', f64: 'double', String: 'String', cstr: 'const char*', void: 'void', fn: 'function', 'obj:Serial': 'Serial', 'obj:LCD': 'LiquidCrystal', 'obj:Servo': 'Servo' })[t] || String(t);

export function wrapCode(t, c) {
  switch (t) {
    case 'char': case 'i8': return `((${c})<<24>>24)`;
    case 'u8': return `((${c})&255)`;
    case 'i16': return `((${c})<<16>>16)`;
    case 'u16': return `((${c})&65535)`;
    case 'i32': return `((${c})|0)`;
    case 'u32': return `((${c})>>>0)`;
    case 'bool': return `((${c})?1:0)`;
    case 'f32': return `Math.fround(${c})`;
    default: return c;
  }
}
// a cheap literal: the constant value of an integer or float literal
export function litWrap(t, v) {
  if (isInt(t)) {
    if (t === 'bool') return v ? 1 : 0;
    const r = RANGE[t], m = r[1] - r[0] + 1;
    let x = Math.trunc(v); if (!Number.isFinite(x)) x = 0;
    x = ((x - r[0]) % m + m) % m + r[0];
    return x;
  }
  if (t === 'f32') return Math.fround(v);
  return v;
}

// type words of a declaration -> a type name, for board B (int and double widths)
export function typeResolver(B) {
  return function resolveType(words, tok) {
      const has = w => words.includes(w);
      const intT = B.intBits === 16 ? 'i16' : 'i32', uintT = B.intBits === 16 ? 'u16' : 'u32';
      const w = words.filter(x => x !== 'signed');
      const map = {
        void: 'void', bool: 'bool', boolean: 'bool', char: 'char', byte: 'u8', word: 'u16', size_t: uintT,
        uint8_t: 'u8', int8_t: 'i8', uint16_t: 'u16', int16_t: 'i16', uint32_t: 'u32', int32_t: 'i32', String: 'String',
        float: 'f32', double: B.doubleBits === 32 ? 'f32' : 'f64', LiquidCrystal: 'obj:LCD', Servo: 'obj:Servo', unsigned_char: 'u8'
      };
      if (has('uint64_t') || has('int64_t')) throw new CErr('64-bit integers are not supported', tok);
      const longs = w.filter(x => x === 'long').length;
      if (longs >= 2) throw new CErr('long long is not supported', tok);
      const uns = has('unsigned');
      if (has('double') && longs) return map.double;
      if (has('char')) return uns ? 'u8' : (has('signed') ? 'i8' : 'char');
      if (has('short')) return uns ? 'u16' : 'i16';
      if (longs) return uns ? 'u32' : 'i32';
      if (has('int') || (uns && w.length === 1) || (has('signed') && w.length === 0)) return uns ? uintT : intT;
      if (w.length !== 1) {
        if (uns) throw new CErr(`'unsigned ${w.filter(x => x !== 'unsigned').join(' ')}' is not a type`, tok);
        throw new CErr(`'${words.join(' ')}' is not a type`, tok);
      }
      if (map[w[0]]) return map[w[0]];
      if (w[0] === 'int') return intT;
      throw new CErr(`'${w[0]}' is not a type`, tok);
  };
}
