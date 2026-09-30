// translate.mjs — OpenCL C to WGSL source translator for the Mandelbulber2 formulas.
//
// The translator reads the upstream OpenCL headers and formula kernels and
// writes WGSL. It is a real front end: a tokenizer, a small C preprocessor, a
// recursive-descent parser for the C subset that the formulas use, and an
// emitter that keeps a type environment so that it can insert the int/float
// casts that C does implicitly and WGSL does not.
//
// Ports code from Mandelbulber2 (https://github.com/buddhi1980/mandelbulber2):
// Copyright (C) Mandelbulber Team (Krzysztof Marczak, Sebastian Jennen and the
// formula authors named in each formula header). GPL-3.0-or-later, see COPYING.
//
// grep: tokenize preprocess Parser parseProgram parseTypedefs Emitter emitFunction
//       loadUpstream buildStructWGSL buildAuxWGSL buildLayout buildHelpersWGSL
//       translateFormula SHIMS_WGSL RESERVED BUILTIN_FNS TErr

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export class TErr extends Error {}
const fail = (msg) => { throw new TErr(msg); };

// ---------------------------------------------------------------- tokenizer

const OPS = ['<<=', '>>=', '...', '->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||',
	'+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '##'];

export function tokenize(src) {
	const toks = [];
	let i = 0, line = 1;
	const n = src.length;
	while (i < n) {
		const ch = src[i];
		if (ch === '\n') { line++; i++; continue; }
		if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\f' || ch === '\v') { i++; continue; }
		if (/[A-Za-z_]/.test(ch)) {
			let j = i + 1;
			while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
			toks.push({ t: 'id', v: src.slice(i, j), line });
			i = j;
			continue;
		}
		if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1]))) {
			const m = /^(0[xX][0-9a-fA-F]+[uUlL]*|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?[fFlLuUhH]*)/.exec(src.slice(i, i + 80));
			toks.push({ t: 'num', v: m[0], line });
			i += m[0].length;
			continue;
		}
		if (ch === '"' || ch === "'") {
			let j = i + 1;
			while (j < n && src[j] !== ch) j += src[j] === '\\' ? 2 : 1;
			toks.push({ t: 'str', v: src.slice(i, j + 1), line });
			i = j + 1;
			continue;
		}
		const op = OPS.find((o) => src.startsWith(o, i)) || ch;
		toks.push({ t: 'op', v: op, line });
		i += op.length;
	}
	return toks;
}

// ------------------------------------------------------------- preprocessor

export function stripComments(text) {
	let out = '';
	let i = 0;
	const n = text.length;
	while (i < n) {
		if (text[i] === '/' && text[i + 1] === '*') {
			const j = text.indexOf('*/', i + 2);
			const end = j < 0 ? n : j + 2;
			out += text.slice(i, end).replace(/[^\n]/g, ' ');
			i = end;
		} else if (text[i] === '/' && text[i + 1] === '/') {
			while (i < n && text[i] !== '\n') i++;
		} else if (text[i] === '"') {
			let j = i + 1;
			while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
			out += text.slice(i, j + 1);
			i = j + 1;
		} else {
			out += text[i++];
		}
	}
	return out;
}

function evalIf(expr, macros) {
	let e = expr.replace(/defined\s*\(\s*(\w+)\s*\)/g, (_, n) => (macros.has(n) ? '1' : '0'))
		.replace(/defined\s+(\w+)/g, (_, n) => (macros.has(n) ? '1' : '0'));
	e = e.replace(/[A-Za-z_]\w*/g, (n) => {
		const m = macros.get(n);
		if (m && !m.params && m.body.length === 1 && m.body[0].t === 'num') return String(parseFloat(m.body[0].v));
		return '0';
	});
	e = e.replace(/(\d)[uUlLfF]+/g, '$1');
	if (!/^[\d\s.()!<>=&|+\-*/%]*$/.test(e)) return false;
	try { return !!Function(`return (${e || 0});`)(); } catch { return false; }
}

// Runs #if/#ifdef/#define over `text`, then tokenizes and expands macros.
// `macros` is a Map(name -> { params: string[] | null, body: token[] }) and is updated in place.
export function preprocess(text, macros) {
	const lines = stripComments(text).replace(/\\\r?\n/g, ' ').split('\n');
	const out = [];
	const stack = [];
	let active = true;
	for (const raw of lines) {
		const l = raw.trim();
		if (!l.startsWith('#')) { out.push(active ? raw : ''); continue; }
		out.push('');
		const m = /^#\s*(\w+)\s*(.*)$/.exec(l);
		if (!m) continue;
		const d = m[1], rest = m[2].trim();
		if (d === 'ifdef' || d === 'ifndef' || d === 'if') {
			let cond;
			if (d === 'ifdef') cond = macros.has(rest.split(/\s/)[0]);
			else if (d === 'ifndef') cond = !macros.has(rest.split(/\s/)[0]);
			else cond = evalIf(rest, macros);
			stack.push({ parent: active, taken: cond });
			active = active && cond;
		} else if (d === 'elif') {
			const top = stack.at(-1);
			if (top.taken) active = false;
			else { const c = evalIf(rest, macros); active = top.parent && c; if (c) top.taken = true; }
		} else if (d === 'else') {
			const top = stack.at(-1);
			active = top.parent && !top.taken;
			top.taken = true;
		} else if (d === 'endif') {
			active = stack.pop().parent;
		} else if (!active) {
			// skipped branch
		} else if (d === 'define') {
			const dm = /^(\w+)(\(([^)]*)\))?\s*(.*)$/.exec(rest);
			if (!dm) continue;
			const params = dm[2] ? dm[3].split(',').map((s) => s.trim()).filter(Boolean) : null;
			macros.set(dm[1], { params, body: tokenize(dm[4]) });
		} else if (d === 'undef') {
			macros.delete(rest.split(/\s/)[0]);
		}
	}
	return expand(tokenize(out.join('\n')), macros, new Set());
}

function expand(toks, macros, hide) {
	const out = [];
	for (let i = 0; i < toks.length; i++) {
		const t = toks[i];
		const m = t.t === 'id' && !hide.has(t.v) ? macros.get(t.v) : undefined;
		if (!m) { out.push(t); continue; }
		const inner = new Set(hide).add(t.v);
		if (m.params) {
			if (toks[i + 1]?.v !== '(') { out.push(t); continue; }
			let depth = 0, j = i + 1;
			const args = [[]];
			for (;;) {
				j++;
				const u = toks[j];
				if (!u) fail(`unterminated macro call ${t.v}`);
				if (u.v === '(') depth++;
				else if (u.v === ')') { if (depth === 0) break; depth--; }
				else if (u.v === ',' && depth === 0) { args.push([]); continue; }
				args.at(-1).push(u);
			}
			const body = m.body.flatMap((b) => {
				const k = b.t === 'id' ? m.params.indexOf(b.v) : -1;
				return k >= 0 ? expand(args[k] || [], macros, hide) : [{ ...b, line: t.line }];
			});
			out.push(...expand(body, macros, inner));
			i = j;
			continue;
		}
		out.push(...expand(m.body.map((b) => ({ ...b, line: t.line })), macros, inner));
	}
	return out;
}

// ------------------------------------------------------------------- types
// Internal type strings are WGSL type names ('f32', 'vec4f', 'matrix33', 'Fractal')
// with C array dims appended ('vec3f[4]', 'matrix33[2][3]').

const VEC = {};
for (const [e, s] of [['f32', 'f'], ['i32', 'i'], ['u32', 'u'], ['bool', 'b']]) {
	for (const n of [2, 3, 4]) VEC[`vec${n}${s}`] = [e, n];
}
const vecOf = (e, n) => (n === 1 ? e : `vec${n}${{ f32: 'f', i32: 'i', u32: 'u', bool: 'b' }[e]}`);
const SCALARS = new Set(['f32', 'i32', 'u32', 'bool']);
const isScalar = (t) => SCALARS.has(t);
const isNum = (t) => isScalar(t) || !!VEC[t];
const elemOf = (t) => (VEC[t] ? VEC[t][0] : t);
const sizeOf = (t) => (VEC[t] ? VEC[t][1] : 1);
const isArr = (t) => /\]$/.test(t);
const arrElem = (t) => t.replace(/\[\d+\]/, '');
const arrLen = (t) => +/\[(\d+)\]/.exec(t)[1];
const floatify = (t) => (VEC[t] ? vecOf('f32', VEC[t][1]) : 'f32');

export function wgslType(t) {
	const m = /^([^[]+)((?:\[\d+\])*)$/.exec(t);
	const dims = [...m[2].matchAll(/\[(\d+)\]/g)].map((x) => x[1]);
	let s = m[1];
	for (let i = dims.length - 1; i >= 0; i--) s = `array<${s}, ${dims[i]}>`;
	return s;
}

const BASE_TYPES = {
	float: 'f32', double: 'f32', half: 'f32', int: 'i32', uint: 'u32', long: 'i64', ulong: 'u64',
	short: 'i32', ushort: 'u32', char: 'i32', uchar: 'u32', bool: 'bool', void: 'void', size_t: 'u32',
	float2: 'vec2f', float3: 'vec3f', float4: 'vec4f', double2: 'vec2f', double3: 'vec3f', double4: 'vec4f',
	int2: 'vec2i', int3: 'vec3i', int4: 'vec4i', uint2: 'vec2u', uint3: 'vec3u', uint4: 'vec4u',
	uchar3: 'vec3u', uchar4: 'vec4u',
};

// WGSL keywords and reserved words: a C name in this set gets a trailing '_'.
export const RESERVED = new Set(`alias break case const const_assert continue continuing default diagnostic
discard else enable false fn for if let loop override requires return struct switch true var while
NULL Self abstract active alignas alignof as asm asm_fragment async attribute auto await become cast catch
class co_await co_return co_yield coherent column_major common compile compile_fragment concept const_cast
consteval constexpr constinit crate debugger decltype delete demote demote_to_helper do dynamic_cast enum
explicit export extends extern external fallthrough filter final finally friend from fxgroup get goto
groupshared highp impl implements import inline instanceof interface layout lowp macro macro_rules match
mediump meta mod module move mut mutable namespace new nil noexcept noinline nointerpolation non_coherent
noncoherent noperspective null nullptr of operator package packoffset partition pass patch pixelfragment
precise precision premerge priv protected pub public readonly ref regardless register reinterpret_cast
require resource restrict self set shared sizeof smooth snorm static static_assert static_cast std
subroutine super target template this thread_local throw trait try type typedef typeid typename typeof
union unless unorm unsafe unsized use using varying virtual volatile wgsl where with writeonly yield`.split(/\s+/));

// WGSL predeclared names; a local with one of these names would shadow a builtin
// that the emitter may write, so locals get a trailing '_' too.
export const BUILTIN_FNS = new Set(`abs acos acosh all any arrayLength asin asinh atan atanh atan2 ceil clamp
cos cosh countLeadingZeros countOneBits countTrailingZeros cross degrees determinant distance dot exp exp2
extractBits faceForward firstLeadingBit firstTrailingBit floor fma fract frexp insertBits inverseSqrt ldexp
length log log2 max min mix modf normalize pow quantizeToF16 radians reflect refract reverseBits round
saturate sign sin sinh smoothstep sqrt step tan tanh transpose trunc bitcast select f32 i32 u32 f16 bool
vec2 vec3 vec4 vec2f vec3f vec4f vec2i vec3i vec4i vec2u vec3u vec4u mat2x2 mat3x3 mat4x4 mat3x3f array
ptr atomic sampler FR fi z_in dpdx dpdy fwidth pack4x8snorm unpack4x8snorm storageBarrier workgroupBarrier`.split(/\s+/));

const mangleField = (n) => (RESERVED.has(n) || n.startsWith('__') ? `${n}_` : n);
const mangleLocal = (n) => (RESERVED.has(n) || BUILTIN_FNS.has(n) || n.startsWith('__') || n === '_' ? `${n}_` : n);

// ------------------------------------------------------------------- parser

const QUALS = new Set(['const', '__global', 'global', '__private', 'private', '__local', 'local', '__constant',
	'constant', 'inline', 'static', 'volatile', 'extern', '__kernel', 'kernel', 'signed', 'restrict',
	'__restrict', '__read_only', '__write_only', 'ALIGN16']);
const PREC = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7,
	'<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10 };
const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);

export class Parser {
	// types: Map(C type name -> internal type string)
	constructor(toks, types) {
		this.toks = toks;
		this.i = 0;
		this.types = types;
	}
	peek(k = 0) { return this.toks[this.i + k] || { t: 'eof', v: '<eof>', line: -1 }; }
	next() { return this.toks[this.i++] || fail('unexpected end of input'); }
	accept(v) { if (this.peek().v === v && this.peek().t !== 'str') { this.i++; return true; } return false; }
	expect(v) { const t = this.next(); if (t.v !== v) fail(`line ${t.line}: expected '${v}', found '${t.v}'`); return t; }
	isTypeName(v) { return this.types.has(v) || v === 'unsigned' || v === 'struct' || v === 'enum'; }
	isTypeStart(k = 0) { const t = this.peek(k); return t.t === 'id' && (QUALS.has(t.v) || this.isTypeName(t.v) || t.v === '__attribute__'); }
	skipAttr() {
		this.next();
		this.expect('(');
		let d = 1;
		while (d > 0) { const t = this.next(); if (t.v === '(') d++; else if (t.v === ')') d--; }
	}
	parseTypeSpec() {
		let isConst = false, name = null, space = null;
		for (;;) {
			const t = this.peek();
			if (t.t !== 'id') break;
			if (QUALS.has(t.v)) {
				if (t.v === 'const' || t.v === '__constant' || t.v === 'constant') isConst = true;
				if (/global/.test(t.v)) space = 'global';
				this.next();
				continue;
			}
			if (t.v === '__attribute__') { this.skipAttr(); continue; }
			if (name) break;
			if (t.v === 'unsigned') {
				this.next();
				const k = this.peek().v;
				name = k === 'char' ? 'uchar' : k === 'short' ? 'ushort' : k === 'long' ? 'ulong' : 'uint';
				if (['int', 'char', 'short', 'long'].includes(k)) this.next();
				continue;
			}
			if (t.v === 'struct' || t.v === 'enum') { this.next(); name = this.next().v; continue; }
			if (this.types.has(t.v)) { name = t.v; this.next(); continue; }
			break;
		}
		if (!name) fail(`line ${this.peek().line}: expected a type, found '${this.peek().v}'`);
		const base = this.types.get(name);
		if (!base) fail(`unknown type ${name}`);
		return { base, cname: name, isConst, space };
	}
	parseProgram() {
		const funcs = [];
		while (this.peek().t !== 'eof') {
			if (this.accept(';')) continue;
			if (this.peek().v === 'typedef') { this.skipToSemi(); continue; }
			const ts = this.parseTypeSpec();
			let ptr = 0;
			while (this.accept('*')) ptr++;
			const name = this.next().v;
			if (!this.accept('(')) { this.skipToSemi(); continue; }
			const params = [];
			if (!(this.peek().v === 'void' && this.peek(1).v === ')')) {
				while (this.peek().v !== ')') {
					const pt = this.parseTypeSpec();
					let pp = 0;
					while (this.accept('*')) pp++;
					const pn = this.peek().t === 'id' ? this.next().v : `_p${params.length}`;
					let t = pt.base;
					while (this.accept('[')) { t += `[${this.parseConstInt()}]`; this.expect(']'); }
					params.push({ type: t, cname: pt.cname, ptr: pp, name: pn, space: pt.space, isConst: pt.isConst });
					if (!this.accept(',')) break;
				}
			} else this.next();
			this.expect(')');
			if (this.accept(';')) continue;
			const body = this.parseBlock();
			funcs.push({ ret: ts.base, retPtr: ptr, name, params, body });
		}
		return funcs;
	}
	skipToSemi() {
		let d = 0;
		for (;;) {
			const t = this.next();
			if (t.v === '{' || t.v === '(') d++;
			else if (t.v === '}' || t.v === ')') d--;
			else if (t.v === ';' && d === 0) return;
		}
	}
	parseConstInt() {
		const e = this.parseCond();
		const v = constEval(e);
		if (v === null) fail('array size is not a constant');
		return v;
	}
	parseBlock() {
		this.expect('{');
		const stmts = [];
		while (!this.accept('}')) stmts.push(this.parseStatement());
		return { k: 'block', stmts };
	}
	parseStatement() {
		const t = this.peek();
		if (t.v === '{') return this.parseBlock();
		if (t.v === ';') { this.next(); return { k: 'empty' }; }
		if (t.t === 'id') {
			switch (t.v) {
				case 'if': {
					this.next(); this.expect('(');
					const c = this.parseExpr(); this.expect(')');
					const then = this.parseStatement();
					const els = this.accept('else') ? this.parseStatement() : null;
					return { k: 'if', c, then, els };
				}
				case 'for': {
					this.next(); this.expect('(');
					let init = null;
					if (!this.accept(';')) {
						init = this.isTypeStart() ? this.parseDecl() : { k: 'expr', e: this.parseExpr() };
						if (init.k === 'expr') this.expect(';');
					}
					const c = this.peek().v === ';' ? null : this.parseExpr();
					this.expect(';');
					const upd = this.peek().v === ')' ? null : this.parseExpr();
					this.expect(')');
					return { k: 'for', init, c, upd, body: this.parseStatement() };
				}
				case 'while': {
					this.next(); this.expect('(');
					const c = this.parseExpr(); this.expect(')');
					return { k: 'while', c, body: this.parseStatement() };
				}
				case 'do': {
					this.next();
					const body = this.parseStatement();
					this.expect('while'); this.expect('(');
					const c = this.parseExpr(); this.expect(')'); this.expect(';');
					return { k: 'do', c, body };
				}
				case 'switch': {
					this.next(); this.expect('(');
					const e = this.parseExpr(); this.expect(')');
					return { k: 'switch', e, body: this.parseStatement() };
				}
				case 'case': {
					this.next();
					const e = this.parseCond(); this.expect(':');
					return { k: 'case', e };
				}
				case 'default': this.next(); this.expect(':'); return { k: 'default' };
				case 'break': this.next(); this.expect(';'); return { k: 'break' };
				case 'continue': this.next(); this.expect(';'); return { k: 'continue' };
				case 'return': {
					this.next();
					const e = this.peek().v === ';' ? null : this.parseExpr();
					this.expect(';');
					return { k: 'return', e };
				}
				case 'goto': fail('goto is not supported');
				default:
			}
			if (this.isTypeStart() && !(this.peek(1).v === '(' && !QUALS.has(t.v))) return this.parseDecl();
		}
		const e = this.parseExpr();
		this.expect(';');
		return { k: 'expr', e };
	}
	parseDecl() {
		const ts = this.parseTypeSpec();
		const decls = [];
		do {
			let ptr = 0;
			while (this.accept('*')) ptr++;
			const nt = this.next();
			if (nt.t !== 'id') fail(`line ${nt.line}: expected a name in declaration, found '${nt.v}'`);
			let type = ts.base;
			while (this.accept('[')) {
				if (this.peek().v === ']') fail('unsized array declaration');
				type += `[${this.parseConstInt()}]`;
				this.expect(']');
			}
			const init = this.accept('=') ? this.parseInit() : null;
			decls.push({ name: nt.v, ptr, type, init, line: nt.line });
		} while (this.accept(','));
		this.expect(';');
		return { k: 'decl', ts, decls };
	}
	parseInit() {
		if (this.peek().v === '{') return { k: 'initlist', items: this.parseInitList() };
		return this.parseAssign();
	}
	parseInitList() {
		this.expect('{');
		const items = [];
		while (!this.accept('}')) {
			items.push(this.parseInit());
			if (!this.accept(',')) { this.expect('}'); break; }
		}
		return items;
	}
	parseExpr() {
		const e = this.parseAssign();
		if (this.peek().v !== ',') return e;
		const list = [e];
		while (this.accept(',')) list.push(this.parseAssign());
		return { k: 'comma', list };
	}
	parseAssign() {
		const a = this.parseCond();
		const t = this.peek();
		if (t.t === 'op' && ASSIGN_OPS.has(t.v)) {
			this.next();
			return { k: 'assign', op: t.v, a, b: this.parseAssign() };
		}
		return a;
	}
	parseCond() {
		const c = this.parseBin(1);
		if (!this.accept('?')) return c;
		const a = this.parseExpr();
		this.expect(':');
		return { k: 'cond', c, a, b: this.parseCond() };
	}
	parseBin(min) {
		let a = this.parseUnary();
		for (;;) {
			const t = this.peek();
			const p = t.t === 'op' ? PREC[t.v] : undefined;
			if (!p || p < min) return a;
			this.next();
			a = { k: 'bin', op: t.v, a, b: this.parseBin(p + 1) };
		}
	}
	parseUnary() {
		const t = this.peek();
		if (t.t === 'op') {
			if (['-', '+', '!', '~', '*', '&'].includes(t.v)) { this.next(); return { k: 'un', op: t.v, a: this.parseUnary() }; }
			if (t.v === '++' || t.v === '--') { this.next(); return { k: 'pre', op: t.v, a: this.parseUnary() }; }
			if (t.v === '(' && this.isTypeStart(1)) {
				this.next();
				const ts = this.parseTypeSpec();
				let ptr = 0;
				while (this.accept('*')) ptr++;
				this.expect(')');
				if (this.peek().v === '{') return { k: 'clit', type: ts.base, items: this.parseInitList() };
				return { k: 'cast', type: ts.base, ptr, a: this.parseUnary() };
			}
		}
		if (t.t === 'id' && t.v === 'sizeof') fail('sizeof is not supported');
		return this.parsePostfix();
	}
	parsePostfix() {
		let e = this.parsePrimary();
		for (;;) {
			const t = this.peek();
			if (t.t !== 'op') return e;
			if (t.v === '(' && e.k === 'id') {
				this.next();
				const args = [];
				while (!this.accept(')')) {
					args.push(this.parseAssign());
					if (!this.accept(',')) { this.expect(')'); break; }
				}
				e = { k: 'call', name: e.name, args, line: t.line };
			} else if (t.v === '.' || t.v === '->') {
				this.next();
				e = { k: 'member', a: e, name: this.next().v, arrow: t.v === '->' };
			} else if (t.v === '[') {
				this.next();
				const i = this.parseExpr();
				this.expect(']');
				e = { k: 'index', a: e, i };
			} else if (t.v === '++' || t.v === '--') {
				this.next();
				e = { k: 'post', op: t.v, a: e };
			} else return e;
		}
	}
	parsePrimary() {
		const t = this.next();
		if (t.t === 'num') return { k: 'num', raw: t.v };
		if (t.t === 'id') return { k: 'id', name: t.v, line: t.line };
		if (t.v === '(') { const a = this.parseExpr(); this.expect(')'); return { k: 'paren', a }; }
		fail(`line ${t.line}: unexpected '${t.v}'`);
	}
}

function constEval(e) {
	switch (e.k) {
		case 'num': return /[.eE]/.test(e.raw) && !/^0x/i.test(e.raw) ? null : parseInt(e.raw, /^0x/i.test(e.raw) ? 16 : 10);
		case 'paren': return constEval(e.a);
		case 'bin': {
			const a = constEval(e.a), b = constEval(e.b);
			if (a === null || b === null) return null;
			return { '+': a + b, '-': a - b, '*': a * b, '/': Math.trunc(a / b) }[e.op] ?? null;
		}
		default: return null;
	}
}

// Header typedefs: `typedef enum {..} N;`, `typedef struct [attr] {..} N;`, `typedef T N;`.
export function parseTypedefs(toks, types) {
	const p = new Parser(toks, types);
	const enums = [], structs = [];
	while (p.peek().t !== 'eof') {
		if (p.peek().v !== 'typedef') {
			// skip anything else, braces balanced (function bodies)
			const t = p.next();
			if (t.v === '{') { let d = 1; while (d > 0) { const u = p.next(); if (u.v === '{') d++; else if (u.v === '}') d--; } }
			continue;
		}
		p.next();
		if (p.peek().v === 'enum') {
			p.next();
			if (p.peek().t === 'id') p.next();
			p.expect('{');
			const consts = [];
			let v = 0;
			while (!p.accept('}')) {
				const name = p.next().v;
				if (p.accept('=')) v = p.parseConstInt();
				consts.push({ name, value: v++ });
				p.accept(',');
			}
			const name = p.next().v;
			p.expect(';');
			enums.push({ name, consts });
			types.set(name, 'i32');
		} else if (p.peek().v === 'struct') {
			p.next();
			while (p.peek().v === '__attribute__' || p.peek().v === 'ALIGN16') { if (p.peek().v === 'ALIGN16') p.next(); else p.skipAttr(); }
			if (p.peek().t === 'id') p.next();
			p.expect('{');
			const fields = [];
			while (!p.accept('}')) {
				const ts = p.parseTypeSpec();
				do {
					const name = p.next().v;
					let t = ts.base;
					while (p.accept('[')) { t += `[${p.parseConstInt()}]`; p.expect(']'); }
					fields.push({ name, type: t, cname: ts.cname });
				} while (p.accept(','));
				p.expect(';');
			}
			while (p.peek().v === '__attribute__') p.skipAttr();
			const name = p.next().v;
			p.expect(';');
			structs.push({ name, fields });
			types.set(name, name);
		} else {
			const ts = p.parseTypeSpec();
			const name = p.next().v;
			p.expect(';');
			types.set(name, ts.base);
		}
	}
	return { enums, structs };
}

// ------------------------------------------------------------------ emitter

const num = (raw) => {
	const hex = /^0x/i.test(raw);
	const body = raw.replace(hex ? /[uUlL]+$/ : /[fFlLuUhH]+$/, '');
	const isFloat = !hex && /[.eE]/.test(body);
	if (!isFloat) {
		const v = parseInt(body, hex ? 16 : /^0\d/.test(body) ? 8 : 10);
		if (v > 0xffffffff) fail('64-bit literal');
		return { c: String(v), t: /[uU]/.test(raw) ? 'u32' : 'i32', lit: true, pure: true };
	}
	let c = body.startsWith('.') ? `0${body}` : body;
	c = c.replace(/\.(?=[eE]|$)/, '.0');
	return { c, t: 'f32', lit: true, pure: true };
};

// Converts a translated expression to type `to` (C implicit conversion rules).
function conv(r, to) {
	const from = r.t;
	if (from === to) return r.c;
	if (!isNum(from) || !isNum(to)) fail(`cannot convert ${from} to ${to}`);
	if (isScalar(to)) {
		if (!isScalar(from)) fail(`cannot convert ${from} to ${to}`);
		if (to === 'bool') return `(${r.c} != ${from === 'f32' ? '0.0' : from === 'u32' ? '0u' : '0'})`;
		if (to === 'f32' && r.lit && /^-?\d+$/.test(r.c)) return `${r.c}.0`;
		if (to === 'u32' && r.lit && /^\d+$/.test(r.c)) return `${r.c}u`;
		if (to === 'i32' && r.lit && from === 'u32') return r.c;
		return `${to}(${r.c})`;
	}
	const [e, n] = VEC[to];
	if (isScalar(from)) return `${to}(${conv(r, e)})`;
	if (VEC[from][1] !== n) fail(`cannot convert ${from} to ${to}`);
	return `${to}(${r.c})`;
}

function promote(a, b) {
	if (a === b && a !== 'bool') return a;
	const ia = a === 'bool' ? 'i32' : a, ib = b === 'bool' ? 'i32' : b;
	if (!isNum(ia) || !isNum(ib)) fail(`no arithmetic between ${a} and ${b}`);
	const va = VEC[ia], vb = VEC[ib];
	const es = [elemOf(ia), elemOf(ib)];
	const e = es.includes('f32') ? 'f32' : es.includes('u32') ? 'u32' : 'i32';
	if (va && vb && va[1] !== vb[1]) fail(`vector size mismatch ${a} ${b}`);
	const n = va ? va[1] : vb ? vb[1] : 1;
	return vecOf(e, n);
}

const SWZ = { x: 'x', y: 'y', z: 'z', w: 'w', r: 'x', g: 'y', b: 'z', a: 'w', s0: 'x', s1: 'y', s2: 'z', s3: 'w' };
function swizzle(name, n) {
	let s = null;
	if (/^s[0-9a-fA-F]+$/.test(name)) s = [...name.slice(1)].map((d) => 'xyzw'[parseInt(d, 16)]).join('');
	else if (name === 'lo') s = n === 4 ? 'xy' : 'x';
	else if (name === 'hi') s = n === 4 ? 'zw' : 'y';
	else if (name === 'even') s = n === 4 ? 'xz' : 'x';
	else if (name === 'odd') s = n === 4 ? 'yw' : 'y';
	else if (/^[xyzw]+$/.test(name) || /^[rgba]+$/.test(name)) s = [...name].map((c) => SWZ[c]).join('');
	if (!s || s.length > 4 || [...s].some((c) => 'xyzw'.indexOf(c) >= n)) return null;
	return s;
}

// Float builtins with one argument: C name -> WGSL name.
const F1 = {
	sin: 'sin', cos: 'cos', tan: 'tan', asin: 'asin', acos: 'acos', atan: 'atan', sinh: 'sinh', cosh: 'cosh',
	tanh: 'tanh', asinh: 'asinh', acosh: 'acosh', atanh: 'atanh', exp: 'exp', exp2: 'exp2', log: 'log',
	log2: 'log2', sqrt: 'sqrt', floor: 'floor', ceil: 'ceil', trunc: 'trunc', rsqrt: 'inverseSqrt',
	normalize: 'normalize', degrees: 'degrees', radians: 'radians', sign: 'sign', fabs: 'abs', rint: 'round',
	native_sin: 'sin', native_cos: 'cos', native_tan: 'tan', native_exp: 'exp', native_exp2: 'exp2',
	native_log: 'log', native_log2: 'log2', native_sqrt: 'sqrt', native_rsqrt: 'inverseSqrt',
	half_sin: 'sin', half_cos: 'cos', half_tan: 'tan', half_exp: 'exp', half_exp2: 'exp2', half_log: 'log',
	half_log2: 'log2', half_sqrt: 'sqrt', half_rsqrt: 'inverseSqrt', fast_normalize: 'normalize',
	round: 'c_round', cbrt: 'c_cbrt', log10: 'c_log10', fract: 'fract',
};
// Two-argument builtins with one common (broadcast) type.
const F2 = { pow: 'c_pow', pown: 'c_pow', powr: 'pow', native_powr: 'pow', half_powr: 'pow', atan2: 'atan2',
	fmod: 'c_fmod', copysign: 'c_copysign', fmax: 'max', fmin: 'min', step: 'step' };
// Shims in SHIMS_WGSL that exist per type as <name>_<type>.
const SHIM_TYPED = new Set(['c_round', 'c_cbrt', 'c_log10', 'c_pow', 'c_fmod', 'c_copysign']);

class Scope {
	constructor(parent) { this.parent = parent; this.vars = new Map(); }
	get(n) { return this.vars.get(n) ?? this.parent?.get(n); }
}

export class Emitter {
	// g: { structs: Map(name -> Map(cfield -> {w, t})), enumConsts: Map, fns: Map(cname -> sig) }
	constructor(g) {
		this.g = g;
		this.deps = new Set();
		this.tmp = 0;
	}

	// ---- functions
	emitFunction(fn, { wname, formula = false } = {}) {
		this.scope = new Scope(null);
		this.ret = formula ? 'vec4f' : fn.ret;
		const assigned = new Set();
		collectAssigned(fn.body, assigned);
		const params = [], prolog = [];
		for (const p of fn.params) {
			if (p.ptr && p.type === 'Fractal') {
				params.push('fi: u32');
				this.scope.vars.set(p.name, { kind: 'fractal' });
			} else if (p.ptr && p.type === 'Aux') {
				params.push(`${p.name}: ptr<function, Aux>`);
				this.scope.vars.set(p.name, { kind: 'ptr', w: p.name, t: 'Aux' });
			} else if (p.ptr) {
				params.push(`${mangleLocal(p.name)}: ptr<function, ${wgslType(p.type)}>`);
				this.scope.vars.set(p.name, { kind: 'ptr', w: mangleLocal(p.name), t: p.type });
			} else {
				const w = mangleLocal(p.name);
				if (assigned.has(p.name)) {
					params.push(`${w}_in: ${wgslType(p.type)}`);
					prolog.push(`\tvar ${w}: ${wgslType(p.type)} = ${w}_in;`);
				} else params.push(`${w}: ${wgslType(p.type)}`);
				this.scope.vars.set(p.name, { kind: 'var', w, t: p.type });
			}
		}
		const ret = this.ret === 'void' ? '' : ` -> ${wgslType(this.ret)}`;
		const body = this.stmts(fn.body.stmts, 1);
		return `fn ${wname}(${params.join(', ')})${ret} {\n${[...prolog, ...body].join('\n')}\n}\n`;
	}

	// ---- statements
	stmts(list, ind) {
		const out = [];
		for (const s of list) out.push(...this.stmt(s, ind));
		return out;
	}
	blockOf(s, ind) {
		const saved = this.scope;
		this.scope = new Scope(saved);
		const out = s.k === 'block' ? this.stmts(s.stmts, ind) : this.stmt(s, ind);
		this.scope = saved;
		return out;
	}
	stmt(s, ind) {
		const I = '\t'.repeat(ind);
		this.pre = [];
		const lines = this.stmtInner(s, ind, I);
		const pre = this.pre;
		this.pre = [];
		return [...pre.map((l) => I + l), ...lines];
	}
	stmtInner(s, ind, I) {
		switch (s.k) {
			case 'empty': return [];
			case 'block': return [`${I}{`, ...this.blockOf(s, ind + 1), `${I}}`];
			case 'decl': return this.decl(s, I);
			case 'expr': return this.exprStmt(s.e).map((l) => I + l);
			case 'if': {
				const out = [`${I}if (${this.cond(s.c)}) {`, ...this.blockOf(s.then, ind + 1)];
				let els = s.els;
				while (els && els.k === 'if') {
					this.pre = [];
					const c = this.cond(els.c);
					if (this.pre.length) fail('hoisted code in else-if condition');
					out.push(`${I}} else if (${c}) {`, ...this.blockOf(els.then, ind + 1));
					els = els.els;
				}
				if (els) out.push(`${I}} else {`, ...this.blockOf(els, ind + 1));
				out.push(`${I}}`);
				return out;
			}
			case 'while': {
				const c = this.cond(s.c);
				if (this.pre.length) fail('hoisted code in loop condition');
				return [`${I}while (${c}) {`, ...this.blockOf(s.body, ind + 1), `${I}}`];
			}
			case 'do': {
				const body = this.blockOf(s.body, ind + 1);
				const saved = this.pre;
				this.pre = [];
				const c = this.cond(s.c);
				if (this.pre.length) fail('hoisted code in loop condition');
				this.pre = saved;
				return [`${I}loop {`, ...body, `${I}\tcontinuing {`, `${I}\t\tbreak if !(${c});`, `${I}\t}`, `${I}}`];
			}
			case 'for': return this.forStmt(s, ind, I);
			case 'switch': return this.switchStmt(s, ind, I);
			case 'case': case 'default': fail('case label outside a switch');
			// falls through
			case 'break': return [`${I}break;`];
			case 'continue': return [`${I}continue;`];
			case 'return': {
				if (!s.e) return [`${I}return;`];
				return [`${I}return ${conv(this.ex(s.e), this.ret)};`];
			}
			default: fail(`statement ${s.k}`);
		}
	}
	cond(e) { return conv(this.ex(e), 'bool'); }

	forStmt(s, ind, I) {
		const saved = this.scope;
		this.scope = new Scope(saved);
		try {
			let init = '';
			const initLines = [];
			if (s.init) {
				const lines = s.init.k === 'decl' ? this.decl(s.init, '') : this.exprStmt(s.init.e);
				if (this.pre.length) fail('hoisted code in for init');
				if (lines.length === 1) init = lines[0].replace(/;$/, '');
				else initLines.push(...lines);
			}
			const c = s.c ? this.cond(s.c) : '';
			if (this.pre.length) fail('hoisted code in loop condition');
			const updList = s.upd ? (s.upd.k === 'comma' ? s.upd.list : [s.upd]) : [];
			const upd = updList.flatMap((u) => this.exprStmt(u));
			if (this.pre.length) fail('hoisted code in for update');
			const body = this.blockOf(s.body, ind + 1);
			if (!initLines.length && upd.length <= 1) {
				return [`${I}for (${init}; ${c}; ${(upd[0] || '').replace(/;$/, '')}) {`, ...body, `${I}}`];
			}
			// General form: a loop with a continuing block.
			const out = [`${I}{`];
			if (init) out.push(`${I}\t${init};`);
			out.push(...initLines.map((l) => `${I}\t${l}`));
			out.push(`${I}\tloop {`);
			if (c) out.push(`${I}\t\tif !(${c}) { break; }`);
			out.push(...body.map((l) => `\t${l}`));
			out.push(`${I}\t\tcontinuing {`, ...upd.map((l) => `${I}\t\t\t${l}`), `${I}\t\t}`, `${I}\t}`, `${I}}`);
			return out;
		} finally {
			this.scope = saved;
		}
	}

	switchStmt(s, ind, I) {
		const sel = this.ex(s.e);
		if (!['i32', 'u32'].includes(sel.t)) fail(`switch on ${sel.t}`);
		const list = s.body.k === 'block' ? s.body.stmts : [s.body];
		const groups = [];
		let cur = null;
		for (const st of list) {
			if (st.k === 'case' || st.k === 'default') {
				if (!cur || cur.stmts.length) { cur = { labels: [], stmts: [] }; groups.push(cur); }
				cur.labels.push(st.k === 'default' ? 'default' : conv(this.ex(st.e), sel.t));
			} else {
				if (!cur) continue; // unreachable code before the first label
				cur.stmts.push(st);
			}
		}
		const ends = (ss) => {
			const l = ss.at(-1);
			if (!l) return false;
			if (['break', 'return', 'continue'].includes(l.k)) return true;
			if (l.k === 'block') return ends(l.stmts);
			return false;
		};
		const bodies = groups.map((g) => g.stmts);
		for (let i = groups.length - 2; i >= 0; i--) {
			if (!ends(bodies[i])) bodies[i] = [...bodies[i], ...bodies[i + 1]];
		}
		const out = [`${I}switch (${sel.c}) {`];
		let hasDefault = false;
		groups.forEach((g, i) => {
			if (g.labels.includes('default')) hasDefault = true;
			out.push(`${I}\tcase ${g.labels.join(', ')}: {`);
			out.push(...this.blockOf({ k: 'block', stmts: bodies[i] }, ind + 2));
			out.push(`${I}\t}`);
		});
		if (!hasDefault) out.push(`${I}\tdefault: {}`);
		out.push(`${I}}`);
		return out;
	}

	decl(s, I) {
		const out = [];
		for (const d of s.decls) {
			if (d.ptr) { out.push(...this.ptrDecl(d, s.ts, I)); continue; }
			const T = d.type;
			const w = mangleLocal(d.name);
			let init = null;
			if (d.init) init = d.init.k === 'initlist' ? this.initList(T, d.init.items) : conv(this.ex(d.init), T);
			if (s.ts.isConst && init !== null && !isArr(T)) out.push(`${I}let ${w}: ${wgslType(T)} = ${init};`);
			else out.push(`${I}var ${w}: ${wgslType(T)}${init !== null ? ` = ${init}` : ''};`);
			this.scope.vars.set(d.name, { kind: 'var', w, t: T });
		}
		return out;
	}

	initList(T, items) {
		const one = (it, t) => (it.k === 'initlist' ? this.initList(t, it.items) : conv(this.ex(it), t));
		if (isArr(T)) {
			const e = arrElem(T), n = arrLen(T);
			if (items.length > n) fail('too many initializers');
			const vals = items.map((it) => one(it, e));
			while (vals.length < n) vals.push(`${wgslType(e)}()`);
			return `${wgslType(T)}(${vals.join(', ')})`;
		}
		if (VEC[T]) return this.vecCtor(T, items);
		const st = this.g.structs.get(T);
		if (st) {
			const fs = [...st.values()];
			const vals = items.map((it, i) => one(it, fs[i].t));
			for (let i = vals.length; i < fs.length; i++) vals.push(`${wgslType(fs[i].t)}()`);
			return `${T}(${vals.join(', ')})`;
		}
		if (items.length !== 1) fail('bad scalar initializer');
		return one(items[0], T);
	}

	vecCtor(T, items) {
		const [e, n] = VEC[T];
		const rs = items.map((it) => (it.k === 'initlist' ? fail('nested init list in vector') : this.ex(it)));
		if (rs.length === 1 && isScalar(rs[0].t)) return `${T}(${conv(rs[0], e)})`;
		let count = 0;
		const parts = rs.map((r) => {
			if (VEC[r.t]) { count += VEC[r.t][1]; return conv(r, vecOf(e, VEC[r.t][1])); }
			count += 1;
			return conv(r, e);
		});
		if (count > n) fail(`too many components for ${T}`);
		while (count < n) { parts.push(conv({ c: '0', t: 'i32', lit: true }, e)); count++; }
		return `${T}(${parts.join(', ')})`;
	}

	// Pointer locals: only aliases into a vector or a variable are supported.
	ptrDecl(d, ts, I) {
		if (!d.init) fail(`pointer variable '${d.name}' without initializer`);
		let e = d.init;
		while (e.k === 'paren' || (e.k === 'cast' && e.ptr > 0)) e = e.a;
		if (e.k === 'un' && e.op === '&') {
			const tgt = this.ex(e.a);
			if (tgt.t === ts.base) { this.scope.vars.set(d.name, { kind: 'ref', c: tgt.c, t: tgt.t }); return []; }
			if (VEC[tgt.t] && elemOf(tgt.t) === ts.base) {
				this.scope.vars.set(d.name, { kind: 'vecptr', base: tgt.c, t: ts.base });
				return [];
			}
			fail(`pointer '${d.name}' to ${tgt.t}`);
		}
		if (e.k === 'cond') {
			let base = null;
			const idx = (x) => {
				while (x.k === 'paren') x = x.a;
				if (x.k === 'cond') {
					const c = this.cond(x.c);
					return `select(${idx(x.b)}, ${idx(x.a)}, ${c})`;
				}
				if (x.k === 'un' && x.op === '&' && x.a.k === 'index' && x.a.a.k === 'id') {
					const v = this.scope.get(x.a.a.name);
					if (!v || v.kind !== 'vecptr') fail('pointer select over non-vector');
					if (base && base !== v.base) fail('pointer select over two bases');
					base = v.base;
					return conv(this.ex(x.a.i), 'i32');
				}
				fail('unsupported pointer initializer');
			};
			const code = idx(e);
			const w = `${mangleLocal(d.name)}_i`;
			this.scope.vars.set(d.name, { kind: 'elemptr', base, idx: w, t: ts.base });
			return [`${I}let ${w}: i32 = ${code};`];
		}
		fail(`unsupported pointer initializer for '${d.name}'`);
	}

	exprStmt(e) {
		while (e.k === 'paren') e = e.a;
		switch (e.k) {
			case 'assign': return this.assign(e);
			case 'pre': case 'post': return this.incdec(e);
			case 'comma': return e.list.flatMap((x) => this.exprStmt(x));
			case 'cast': if (e.type === 'void') return []; break;
			case 'call': {
				if (e.name === 'Q_UNUSED') return [];
				const r = this.ex(e);
				return [r.t === 'void' ? `${r.c};` : `_ = ${r.c};`];
			}
			case 'id': case 'num': return [];
			default:
		}
		const r = this.ex(e);
		return r.t === 'void' ? [] : [`_ = ${r.c};`];
	}

	incdec(e) {
		const L = this.ex(e.a);
		if (!L.lv) fail('increment of a non-lvalue');
		if (L.t === 'i32' || L.t === 'u32') return [`${L.c}${e.op};`];
		const one = conv({ c: '1', t: 'i32', lit: true }, elemOf(L.t));
		return [`${L.c} ${e.op[0]}= ${one};`];
	}

	assign(e) {
		const out = [];
		let rhs = e.b;
		while (rhs.k === 'paren') rhs = rhs.a;
		if (rhs.k === 'assign') { out.push(...this.assign(rhs)); rhs = rhs.a; }
		let lhs = e.a;
		while (lhs.k === 'paren') lhs = lhs.a;
		// multi-component swizzle target
		if (lhs.k === 'member' && !lhs.arrow) {
			const B = this.ex(lhs.a);
			if (VEC[B.t] && lhs.name.length > 1) {
				const [el, n] = VEC[B.t];
				const sw = swizzle(lhs.name, n);
				if (!sw) fail(`bad swizzle .${lhs.name}`);
				if (!B.lv) fail('swizzle assignment to a non-lvalue');
				const vt = vecOf(el, sw.length);
				let val;
				if (e.op === '=') val = conv(this.ex(rhs), vt);
				else val = conv(this.binary(e.op.slice(0, -1), this.ex(lhs), this.ex(rhs)), vt);
				const comps = 'xyzw'.slice(0, n);
				if (comps.startsWith(sw)) {
					const rest = comps.slice(sw.length);
					out.push(`${B.c} = ${B.t}(${val}${rest ? `, ${B.c}.${rest}` : ''});`);
				} else {
					const t = `sw_t${this.tmp++}`;
					const parts = [...comps].map((c) => (sw.includes(c) ? `${t}.${'xyzw'[sw.indexOf(c)]}` : `${B.c}.${c}`));
					out.push(`{ let ${t}: ${vt} = ${val}; ${B.c} = ${B.t}(${parts.join(', ')}); }`);
				}
				return out;
			}
		}
		const L = this.ex(lhs);
		if (!L.lv) fail('assignment to a non-lvalue');
		const R = this.ex(rhs);
		if (e.op === '=') { out.push(`${L.c} = ${conv(R, L.t)};`); return out; }
		const op = e.op.slice(0, -1);
		if (op === '<<' || op === '>>') { out.push(`${L.c} ${e.op} ${conv(R, R.t.startsWith('vec') ? R.t : 'u32')};`); return out; }
		if (isNum(L.t) && isNum(R.t) && L.t !== 'bool') {
			let T;
			try { T = promote(L.t, R.t); } catch { T = null; }
			if (T === L.t && !(VEC[R.t] && !VEC[L.t])) {
				out.push(`${L.c} ${e.op} ${conv(R, VEC[R.t] ? T : elemOf(T))};`);
				return out;
			}
		}
		out.push(`${L.c} = ${conv(this.binary(op, L, R), L.t)};`);
		return out;
	}

	// ---- expressions: return { c: code, t: type, lit?, lv?, pure }
	ex(e) {
		switch (e.k) {
			case 'num': return num(e.raw);
			case 'paren': { const r = this.ex(e.a); return { ...r, lit: r.lit }; }
			case 'id': return this.id(e);
			case 'un': return this.unary(e);
			case 'pre': case 'post': fail('increment inside an expression');
			// falls through
			case 'assign': fail('assignment inside an expression');
			// falls through
			case 'comma': fail('comma operator inside an expression');
			// falls through
			case 'bin': return this.binary(e.op, this.ex(e.a), this.ex(e.b));
			case 'cond': return this.ternary(e);
			case 'call': return this.call(e);
			case 'member': return this.member(e);
			case 'index': return this.index(e);
			case 'cast': return this.cast(e);
			case 'clit': return this.clit(e);
			default: fail(`expression ${e.k}`);
		}
	}

	id(e) {
		const n = e.name;
		if (n === 'true' || n === 'false') return { c: n, t: 'bool', pure: true };
		const v = this.scope.get(n);
		if (v) {
			switch (v.kind) {
				case 'var': return { c: v.w, t: v.t, lv: true, pure: true };
				case 'fractal': return { c: 'fi', t: 'FRACTALPTR', pure: true };
				case 'ptr': return { c: v.w, t: `PTR:${v.t}`, pure: true };
				case 'ref': return { c: v.c, t: v.t, lv: true, pure: true };
				default: fail(`pointer '${n}' used as a value`);
			}
		}
		if (this.g.enumConsts.has(n)) return { c: n, t: 'i32', pure: true };
		fail(`unknown identifier '${n}'`);
	}

	unary(e) {
		if (e.op === '*') {
			let a = e.a;
			while (a.k === 'paren') a = a.a;
			if (a.k === 'id') {
				const v = this.scope.get(a.name);
				if (v?.kind === 'vecptr') return { c: `${v.base}[0]`, t: v.t, lv: true, pure: true };
				if (v?.kind === 'elemptr') return { c: `${v.base}[${v.idx}]`, t: v.t, lv: true, pure: true };
				if (v?.kind === 'ref') return { c: v.c, t: v.t, lv: true, pure: true };
				if (v?.kind === 'ptr') return { c: `(*${v.w})`, t: v.t, lv: true, pure: true };
			}
			fail('unsupported dereference');
		}
		if (e.op === '&') fail('address-of outside a pointer declaration');
		const r = this.ex(e.a);
		switch (e.op) {
			case '+': return r;
			case '-': {
				const t = r.t === 'bool' ? 'i32' : r.t;
				if (!isNum(t)) fail(`negate ${r.t}`);
				const c = r.t === 'bool' ? `i32(${r.c})` : r.c;
				const neg = /^[\w.]+$/.test(c) || /^\(.*\)$/.test(c) ? `-${c}` : `-(${c})`;
				return { c: neg, t, lit: r.lit && /^\d/.test(c), pure: r.pure };
			}
			case '!': return { c: `!(${conv(r, 'bool')})`, t: 'bool', pure: r.pure };
			case '~': {
				if (!['i32', 'u32'].includes(r.t)) fail(`~ on ${r.t}`);
				return { c: `~(${r.c})`, t: r.t, pure: r.pure };
			}
			default: fail(`unary ${e.op}`);
		}
	}

	binary(op, A, B) {
		const pure = A.pure && B.pure;
		if (op === '&&' || op === '||') return { c: `(${conv(A, 'bool')} ${op} ${conv(B, 'bool')})`, t: 'bool', pure };
		if (['==', '!=', '<', '>', '<=', '>='].includes(op)) {
			if (A.t === 'bool' && B.t === 'bool') return { c: `(${A.c} ${op} ${B.c})`, t: 'bool', pure };
			const T = promote(A.t, B.t);
			const ca = conv(A, VEC[A.t] ? T : elemOf(T)), cb = conv(B, VEC[B.t] ? T : elemOf(T));
			return { c: `(${ca} ${op} ${cb})`, t: VEC[T] ? vecOf('bool', VEC[T][1]) : 'bool', pure };
		}
		if (op === '<<' || op === '>>') {
			if (!['i32', 'u32'].includes(A.t === 'bool' ? 'i32' : A.t)) fail(`shift of ${A.t}`);
			return { c: `(${conv(A, A.t === 'bool' ? 'i32' : A.t)} ${op} ${conv(B, 'u32')})`, t: A.t === 'bool' ? 'i32' : A.t, pure };
		}
		if (['&', '|', '^'].includes(op)) {
			if (A.t === 'bool' && B.t === 'bool' && op !== '^') return { c: `(${A.c} ${op} ${B.c})`, t: 'bool', pure };
			const T = promote(A.t, B.t);
			if (elemOf(T) === 'f32') fail(`bitwise ${op} on float`);
			return { c: `(${conv(A, VEC[A.t] ? T : elemOf(T))} ${op} ${conv(B, VEC[B.t] ? T : elemOf(T))})`, t: T, pure };
		}
		if (!['+', '-', '*', '/', '%'].includes(op)) fail(`operator ${op}`);
		const T = promote(A.t, B.t);
		const ca = conv(A, VEC[A.t] ? T : elemOf(T)), cb = conv(B, VEC[B.t] ? T : elemOf(T));
		return { c: `(${ca} ${op} ${cb})`, t: T, pure };
	}

	ternary(e) {
		const c = this.cond(e.c);
		const A = this.ex(e.a), B = this.ex(e.b);
		let T;
		if (A.t === B.t) T = A.t;
		else T = promote(A.t, B.t);
		if (!(A.pure && B.pure)) fail('ternary with side effects');
		if (isArr(T)) fail('ternary on arrays');
		return { c: `select(${conv(B, T)}, ${conv(A, T)}, ${c})`, t: T, pure: true };
	}

	cast(e) {
		if (e.type === 'void') return { c: '', t: 'void', pure: true };
		if (e.ptr) fail('pointer cast outside a pointer declaration');
		let a = e.a;
		while (a.k === 'paren' && a.a.k !== 'comma') a = a.a;
		if (VEC[e.type] && a.k === 'paren' && a.a.k === 'comma') return { c: this.vecCtor(e.type, a.a.list), t: e.type, pure: true };
		const r = this.ex(a);
		if (r.t === e.type) return r;
		if (VEC[e.type] && isScalar(r.t)) return { c: this.vecCtor(e.type, [a]), t: e.type, pure: r.pure };
		return { c: conv(r, e.type), t: e.type, pure: r.pure };
	}

	clit(e) {
		if (VEC[e.type]) return { c: this.vecCtor(e.type, e.items), t: e.type, pure: true };
		return { c: this.initList(e.type, e.items), t: e.type, pure: true };
	}

	member(e) {
		const B = this.ex(e.a);
		let st, base;
		if (e.arrow) {
			if (B.t === 'FRACTALPTR') { st = 'Fractal'; base = 'FR[fi]'; }
			else if (B.t.startsWith('PTR:')) { st = B.t.slice(4); base = `(*${B.c})`; }
			else fail(`-> on ${B.t}`);
		} else if (VEC[B.t]) {
			const [el, n] = VEC[B.t];
			const sw = swizzle(e.name, n);
			if (!sw) fail(`bad swizzle .${e.name} on ${B.t}`);
			return { c: `${B.c}.${sw}`, t: vecOf(el, sw.length), lv: B.lv && sw.length === 1, swz: sw.length > 1, pure: B.pure };
		} else { st = B.t; base = B.c; }
		const fields = this.g.structs.get(st);
		if (!fields) fail(`member .${e.name} on ${st}`);
		const f = fields.get(e.name);
		if (!f) fail(`no field ${st}.${e.name}`);
		return { c: `${base}.${f.w}`, t: f.t, lv: st !== 'Fractal' && (B.lv || e.arrow), pure: B.pure };
	}

	index(e) {
		if (e.a.k === 'id') {
			const v = this.scope.get(e.a.name);
			if (v?.kind === 'vecptr') return { c: `${v.base}[${conv(this.ex(e.i), 'i32')}]`, t: v.t, lv: true, pure: true };
			if (v?.kind === 'elemptr') return { c: `${v.base}[${v.idx} + ${conv(this.ex(e.i), 'i32')}]`, t: v.t, lv: true, pure: true };
		}
		const B = this.ex(e.a);
		const I = this.ex(e.i);
		const ic = I.t === 'u32' ? I.c : conv(I, 'i32');
		if (isArr(B.t)) return { c: `${B.c}[${ic}]`, t: arrElem(B.t), lv: B.lv, pure: B.pure && I.pure };
		if (VEC[B.t]) return { c: `${B.c}[${ic}]`, t: VEC[B.t][0], lv: B.lv, pure: B.pure && I.pure };
		fail(`index on ${B.t}`);
	}

	call(e) {
		const n = e.name;
		const args = () => e.args.map((a) => this.ex(a));
		// user functions: helpers, local functions, other formulas
		const sig = this.g.fns.get(n);
		if (sig) {
			if (sig.params.length !== e.args.length) fail(`${n} takes ${sig.params.length} arguments`);
			const rs = args();
			const cs = rs.map((r, i) => {
				const p = sig.params[i];
				if (p.fractal) { if (r.t !== 'FRACTALPTR') fail('bad fractal argument'); return 'fi'; }
				if (p.ptr) { if (r.t !== `PTR:${p.type}`) fail(`bad pointer argument to ${n}`); return r.c; }
				return conv(r, p.type);
			});
			if (sig.formulaFile) this.deps.add(sig.formulaFile);
			return { c: `${sig.w}(${cs.join(', ')})`, t: sig.ret, pure: !sig.impure && rs.every((r) => r.pure) };
		}
		const rs = args();
		const pure = rs.every((r) => r.pure);
		const need = (k) => { if (rs.length !== k) fail(`${n} takes ${k} arguments`); };
		const common = (list) => {
			let T = list[0].t;
			for (const r of list.slice(1)) T = promote(T, r.t);
			return T === 'bool' ? 'i32' : T;
		};
		const shim = (w, T) => (SHIM_TYPED.has(w) ? `${w}_${T}` : w);
		if (F1[n]) {
			need(1);
			const T = n === 'fabs' || n === 'sign' ? floatify(rs[0].t) : floatify(rs[0].t);
			return { c: `${shim(F1[n], T)}(${conv(rs[0], T)})`, t: T, pure };
		}
		if (F2[n]) {
			need(2);
			let T = common(rs);
			if (n !== 'fmax' && n !== 'fmin' || elemOf(T) !== 'f32') T = floatify(T);
			return { c: `${shim(F2[n], T)}(${conv(rs[0], T)}, ${conv(rs[1], T)})`, t: T, pure };
		}
		switch (n) {
			case 'abs': need(1); return { c: `abs(${conv(rs[0], rs[0].t === 'bool' ? 'i32' : rs[0].t)})`, t: rs[0].t === 'bool' ? 'i32' : rs[0].t, pure };
			case 'min': case 'max': {
				need(2);
				const T = common(rs);
				return { c: `${n}(${conv(rs[0], T)}, ${conv(rs[1], T)})`, t: T, pure };
			}
			case 'clamp': {
				need(3);
				const T = common(rs);
				return { c: `clamp(${rs.map((r) => conv(r, T)).join(', ')})`, t: T, pure };
			}
			case 'mix': {
				need(3);
				const T = floatify(common(rs.slice(0, 2)));
				const tt = isScalar(rs[2].t) ? elemOf(T) : T;
				return { c: `mix(${conv(rs[0], T)}, ${conv(rs[1], T)}, ${conv(rs[2], tt)})`, t: T, pure };
			}
			case 'smoothstep': {
				need(3);
				const T = floatify(common(rs));
				return { c: `smoothstep(${rs.map((r) => conv(r, T)).join(', ')})`, t: T, pure };
			}
			case 'mad': case 'fma': {
				need(3);
				const T = floatify(common(rs));
				return { c: `fma(${rs.map((r) => conv(r, T)).join(', ')})`, t: T, pure };
			}
			case 'native_divide': case 'half_divide': need(2); return this.binary('/', ...rs.map((r) => (elemOf(r.t) === 'f32' ? r : { ...r, c: conv(r, floatify(r.t)), t: floatify(r.t), lit: false })));
			case 'native_recip': case 'half_recip': need(1); return this.binary('/', { c: '1.0', t: 'f32', lit: true, pure: true }, { ...rs[0], c: conv(rs[0], floatify(rs[0].t)), t: floatify(rs[0].t), lit: false });
			case 'length': case 'fast_length': {
				need(1);
				if (isScalar(rs[0].t)) return { c: `abs(${conv(rs[0], 'f32')})`, t: 'f32', pure };
				return { c: `length(${conv(rs[0], floatify(rs[0].t))})`, t: 'f32', pure };
			}
			case 'dot': case 'distance': case 'fast_distance': {
				need(2);
				const T = floatify(common(rs));
				if (isScalar(T)) return { c: n === 'dot' ? `(${conv(rs[0], 'f32')} * ${conv(rs[1], 'f32')})` : `abs(${conv(rs[0], 'f32')} - ${conv(rs[1], 'f32')})`, t: 'f32', pure };
				return { c: `${n === 'dot' ? 'dot' : 'distance'}(${conv(rs[0], T)}, ${conv(rs[1], T)})`, t: 'f32', pure };
			}
			case 'cross': {
				need(2);
				const T = floatify(common(rs));
				if (T === 'vec3f') return { c: `cross(${conv(rs[0], T)}, ${conv(rs[1], T)})`, t: T, pure };
				if (T === 'vec4f') return { c: `vec4f(cross(${rs[0].c}.xyz, ${rs[1].c}.xyz), 0.0)`, t: T, pure };
				fail(`cross on ${T}`);
			}
			// falls through
			case 'hypot': need(2); return { c: `length(vec2f(${conv(rs[0], 'f32')}, ${conv(rs[1], 'f32')}))`, t: 'f32', pure };
			case 'fdim': {
				need(2);
				const T = floatify(common(rs));
				return { c: `max((${conv(rs[0], T)} - ${conv(rs[1], T)}), ${T}(0.0))`, t: T, pure };
			}
			case 'convert_int': need(1); return { c: conv(rs[0], 'i32'), t: 'i32', pure };
			case 'convert_float': need(1); return { c: conv(rs[0], 'f32'), t: 'f32', pure };
			case 'isnan': case 'isinf': case 'isfinite': {
				need(1);
				if (rs[0].t !== 'f32') fail(`${n} on ${rs[0].t}`);
				return { c: `c_${n}(${rs[0].c})`, t: 'i32', pure };
			}
			default: fail(`unknown function '${n}'`);
		}
	}
}

function collectAssigned(node, set) {
	if (!node || typeof node !== 'object') return;
	if (Array.isArray(node)) { node.forEach((n) => collectAssigned(n, set)); return; }
	const root = (x) => { while (x && ['member', 'index', 'paren'].includes(x.k)) x = x.a; return x?.k === 'id' ? x.name : null; };
	if (node.k === 'assign' || node.k === 'pre' || node.k === 'post' || (node.k === 'un' && node.op === '&')) {
		const r = root(node.a);
		if (r) set.add(r);
	}
	for (const v of Object.values(node)) if (v && typeof v === 'object') collectAssigned(v, set);
}

// ------------------------------------------------------------- upstream load

const SEED_MACROS = {
	OPENCL_KERNEL_CODE: '1', __OPENCL_VERSION__: '120', USE_OPENCL: '1',
	M_PI_F: '3.14159274101257f', M_PI: '3.14159265358979323846', M_E_F: '2.71828174591064f',
	M_E: '2.718281828459045', M_1_PI_F: '0.318309873342514f', M_2_PI_F: '0.636619746685028f',
	M_LN2_F: '0.693147182464599f', M_LN10_F: '2.30258512496948f', M_SQRT2_F: '1.41421353816986f',
	M_SQRT1_2_F: '0.707106769084930f', M_LOG2E_F: '1.44269502162933f', MAXFLOAT: '3.40282346e38f',
	FLT_MAX: '3.40282346e38f', FLT_MIN: '1.17549435e-38f', FLT_EPSILON: '1.1920929e-7f',
};

// Reads the upstream headers. Returns the global context for Emitter and the
// struct/enum descriptions for struct.wgsl and layout.json.
export function loadUpstream(UP) {
	const macros = new Map();
	for (const [k, v] of Object.entries(SEED_MACROS)) macros.set(k, { params: null, body: tokenize(v) });
	const types = new Map(Object.entries(BASE_TYPES));
	const read = (p) => readFileSync(join(UP, p), 'utf8');
	const all = { enums: [], structs: [] };
	const algebraSrc = read('opencl/opencl_algebra.h');
	for (const f of ['opencl/defines_cl.h', 'opencl/opencl_typedefs.h', 'opencl/opencl_algebra.h', 'opencl/fractal_cl.h']) {
		const toks = preprocess(read(f), macros);
		const r = parseTypedefs(toks, types);
		all.enums.push(...r.enums);
		all.structs.push(...r.structs);
	}
	// Rename the two top structs to the contract names.
	types.set('sFractalCl', 'Fractal');
	types.set('sExtendedAuxCl', 'Aux');
	const rename = { sFractalCl: 'Fractal', sExtendedAuxCl: 'Aux' };
	const structs = new Map();
	const structList = [];
	for (const s of all.structs) {
		const name = rename[s.name] || s.name;
		const fields = s.fields.map((f) => ({ ...f, type: rename[f.type] || f.type, w: mangleField(f.name) }));
		structs.set(name, new Map(fields.map((f) => [f.name, { w: f.w, t: f.type, cname: f.cname }])));
		structList.push({ name, cname: s.name, fields });
	}
	const enumConsts = new Map();
	for (const e of all.enums) for (const c of e.consts) enumConsts.set(c.name, c.value);
	const enumNames = new Set(all.enums.map((e) => e.name));
	return { UP, macros, types, structs, structList, enums: all.enums, enumNames, enumConsts, fns: new Map(), algebraSrc };
}

// ----------------------------------------------------------- struct + layout

const HEADER_GPL = `// Ported from Mandelbulber2 (https://github.com/buddhi1980/mandelbulber2), upstream commit 600da8d.
// Copyright (C) Mandelbulber Team. GPL-3.0-or-later, see ../COPYING.`;

function reachable(g, root) {
	const seen = new Set();
	const visit = (n) => {
		if (seen.has(n) || !g.structs.has(n)) return;
		for (const f of g.structs.get(n).values()) visit(f.t.replace(/\[.*$/, ''));
		seen.add(n);
	};
	visit(root);
	return [...seen]; // dependency order
}

function structDecl(g, name) {
	const s = g.structList.find((x) => x.name === name);
	const lines = s.fields.map((f) => `\t${f.w}: ${wgslType(f.type)},${g.enumNames.has(f.cname) ? ` // ${f.cname}` : ''}`);
	return `struct ${name} {\n${lines.join('\n')}\n}\n`;
}

export function buildStructWGSL(g) {
	const names = [...reachable(g, 'Fractal'), 'matrix44'];
	const enumLines = [];
	for (const e of g.enums) {
		enumLines.push(`// ${e.name}`);
		for (const c of e.consts) enumLines.push(`const ${c.name}: i32 = ${c.value};`);
	}
	return `// struct.wgsl — WGSL copy of sFractalCl (the per-slot formula parameters) and its nested
// structs, generated by tools/translate.mjs from opencl/fractal_cl.h. Do not edit.
//
// Field names and nesting match fractal_cl.h, so fractal->bulb.power reads as FR[fi].bulb.power.
// C types map: cl_float -> f32, cl_int -> i32, cl_float3 -> vec3f, cl_float4 -> vec4f,
// enums -> i32 (constants below), matrix33 -> struct matrix33 { m1, m2, m3: vec3f } (rows).
// A field whose name is a WGSL reserved word gets a trailing '_' (genFoldBox.type -> type_).
// Byte offsets for the host are in layout.json (WGSL storage layout rules).
${HEADER_GPL}
//
// grep: struct Fractal, struct matrix33, ${names.filter((n) => n !== 'Fractal' && n !== 'matrix33').slice(0, 4).join(', ')}, enum constants

${enumLines.join('\n')}

${names.map((n) => structDecl(g, n)).join('\n')}`;
}

export function buildAuxWGSL(g) {
	return `// aux.wgsl — WGSL copy of sExtendedAuxCl, the per-point iteration state that every formula
// reads and writes through its aux pointer. Generated by tools/translate.mjs from
// opencl/fractal_cl.h. Do not edit.
${HEADER_GPL}
//
// grep: struct Aux

${structDecl(g, 'Aux')}`;
}

// WGSL host-shareable layout (storage address space).
function sizeAlign(g, t) {
	if (isArr(t)) {
		const e = arrElem(t), n = arrLen(t);
		const [s, a] = sizeAlign(g, e);
		const stride = Math.ceil(s / a) * a;
		return [stride * n, a, stride];
	}
	switch (t) {
		case 'f32': case 'i32': case 'u32': return [4, 4];
		case 'vec2f': case 'vec2i': case 'vec2u': return [8, 8];
		case 'vec3f': case 'vec3i': case 'vec3u': return [12, 16];
		case 'vec4f': case 'vec4i': case 'vec4u': return [16, 16];
		default: {
			const st = g.structList.find((x) => x.name === t);
			if (!st) fail(`layout of ${t}`);
			let off = 0, al = 1;
			for (const f of st.fields) {
				const [s, a] = sizeAlign(g, f.type);
				off = Math.ceil(off / a) * a + s;
				al = Math.max(al, a);
			}
			return [Math.ceil(off / al) * al, al];
		}
	}
}

export function buildLayout(g) {
	const fields = {};
	const walk = (t, off, path, cname) => {
		if (isArr(t)) {
			const [, , stride] = sizeAlign(g, t);
			const e = arrElem(t);
			for (let i = 0; i < arrLen(t); i++) walk(e, off + i * stride, `${path}[${i}]`, cname);
			return;
		}
		const st = g.structList.find((x) => x.name === t);
		if (!st) {
			const entry = { offset: off, type: t };
			if (g.enumNames.has(cname)) entry.enum = cname;
			fields[path] = entry;
			return;
		}
		let o = 0;
		for (const f of st.fields) {
			const [s, a] = sizeAlign(g, f.type);
			o = Math.ceil(o / a) * a;
			const p = path ? `${path}.${f.name}` : f.name;
			walk(f.type, off + o, p, f.cname);
			if (f.w !== f.name) fields[p] = { ...(fields[p] || {}), wgslName: f.w };
			o += s;
		}
	};
	walk('Fractal', 0, '', 'sFractalCl');
	const [size, align] = sizeAlign(g, 'Fractal');
	return {
		Fractal: {
			size, align, stride: Math.ceil(size / align) * align,
			note: 'WGSL storage layout of struct Fractal; one entry per scalar/vector leaf, arrays expanded as path[i]; matrix33 leaves are rows m1/m2/m3 (vec3f).',
			fields,
		},
	};
}

// ----------------------------------------------------------------- helpers

// C-semantics shims for OpenCL builtins that differ from WGSL, one per type.
function shimSet() {
	const T = ['f32', 'vec2f', 'vec3f', 'vec4f'];
	const out = [];
	for (const t of T) {
		const z = t === 'f32' ? '0.0' : `${t}(0.0)`;
		out.push(`// C fmod: x - y * trunc(x / y) (WGSL % would also do, kept explicit).
fn c_fmod_${t}(x: ${t}, y: ${t}) -> ${t} { return x - y * trunc(x / y); }`);
		out.push(`// C round: halfway cases away from zero (WGSL round() rounds them to even).
fn c_round_${t}(x: ${t}) -> ${t} { return sign(x) * floor(abs(x) + 0.5); }`);
		out.push(`fn c_cbrt_${t}(x: ${t}) -> ${t} { return sign(x) * pow(abs(x), ${t === 'f32' ? '' : t}(1.0 / 3.0)); }`);
		out.push(`fn c_log10_${t}(x: ${t}) -> ${t} { return log(x) * 0.43429448190325182; }`);
		if (t === 'f32') {
			out.push(`fn c_copysign_f32(x: f32, y: f32) -> f32 {
	return bitcast<f32>((bitcast<u32>(x) & 0x7fffffffu) | (bitcast<u32>(y) & 0x80000000u));
}`);
			out.push(`// C pow: a negative base with an integer exponent gives a real result.
fn c_pow_f32(x: f32, y: f32) -> f32 {
	if (y == 0.0) { return 1.0; }
	if (x >= 0.0) { return pow(x, y); }
	let r = pow(-x, y);
	if (floor(y) != y) { return pow(x, y); }
	if (floor(y * 0.5) * 2.0 == y) { return r; }
	return -r;
}`);
		} else {
			const n = VEC[t][1];
			const comps = 'xyzw'.slice(0, n);
			out.push(`fn c_copysign_${t}(x: ${t}, y: ${t}) -> ${t} { return ${t}(${[...comps].map((c) => `c_copysign_f32(x.${c}, y.${c})`).join(', ')}); }`);
			out.push(`fn c_pow_${t}(x: ${t}, y: ${t}) -> ${t} { return ${t}(${[...comps].map((c) => `c_pow_f32(x.${c}, y.${c})`).join(', ')}); }`);
		}
		void z;
	}
	out.push(`fn c_isnan(x: f32) -> i32 { return i32((bitcast<u32>(x) & 0x7fffffffu) > 0x7f800000u); }
fn c_isinf(x: f32) -> i32 { return i32((bitcast<u32>(x) & 0x7fffffffu) == 0x7f800000u); }
fn c_isfinite(x: f32) -> i32 { return i32((bitcast<u32>(x) & 0x7fffffffu) < 0x7f800000u); }`);
	return out.join('\n\n');
}
export const SHIMS_WGSL = shimSet();

// Registers a parsed function in g.fns so later code can call it.
function register(g, f, w, extra = {}) {
	g.fns.set(f.name, {
		w, ret: f.ret,
		params: f.params.map((p) => ({ type: p.type, ptr: p.ptr && p.type !== 'Fractal', fractal: p.ptr && p.type === 'Fractal' })),
		...extra,
	});
}

// helpers.wgsl: the C shims plus the opencl_algebra.h functions, translated by
// the same emitter. Functions that cannot be translated (64-bit random) are skipped.
export function buildHelpersWGSL(g) {
	const macros = new Map([...g.macros].filter(([k]) => !/^MANDELBULBER2_/.test(k)));
	const toks = preprocess(g.algebraSrc, macros);
	const funcs = new Parser(toks, g.types).parseProgram();
	const parts = [], skipped = [];
	for (const f of funcs) {
		try {
			const code = new Emitter(g).emitFunction(f, { wname: f.name });
			register(g, f, f.name);
			parts.push(code);
		} catch (err) {
			if (!(err instanceof TErr)) throw err;
			skipped.push(`${f.name}: ${err.message}`);
		}
	}
	const text = `// helpers.wgsl — WGSL ports of the OpenCL helpers that the formulas call: C-semantics shims
// for OpenCL builtins (fmod, round, pow, copysign, cbrt, log10, isnan) and the functions of
// opencl/opencl_algebra.h (Matrix33MulFloat4, RotateAroundVectorByAngle4, SmoothConditionALessB, ...),
// translated by tools/translate.mjs. Do not edit.
${HEADER_GPL} Algebra authors: Krzysztof Marczak, Sebastian Jennen.
//
// grep: c_fmod_ c_round_ c_pow_ c_copysign_ c_cbrt_ c_log10_ c_isnan ${funcs.filter((f) => g.fns.has(f.name)).map((f) => f.name).join(' ')}
${skipped.length ? `//\n// Not ported (not used by any formula): ${skipped.map((s) => s.split(':')[0]).join(', ')}\n` : ''}
${SHIMS_WGSL}

${parts.join('\n')}`;
	return { text, skipped };
}

// ---------------------------------------------------------------- formulas

export const snakeName = (file) => file.replace(/\.cl$/, '');

// Pass 1 over all formula files: register every formula function name.
export function registerFormulas(g, files) {
	g.formulaByName = new Map();
	for (const [file, src] of files) {
		const m = /\b(?:REAL4|float4)\s+(\w+Iteration)\s*\(/.exec(src);
		if (m) {
			const snake = snakeName(file);
			g.formulaByName.set(m[1], snake);
			g.fns.set(m[1], {
				w: `F_${snake}`, ret: 'vec4f', formulaFile: snake, impure: true,
				params: [{ type: 'vec4f' }, { fractal: true }, { type: 'Aux', ptr: true }],
			});
		}
	}
}

function credits(src) {
	const m = /^\/\*\*([\s\S]*?)\*\//.exec(src);
	if (!m) return [];
	const lines = m[1].split('\n').map((l) => l.replace(/^\s*\*\s?/, '').trimEnd());
	const start = lines.findIndex((l, i) => i > 2 && l === '');
	const out = [];
	for (const l of lines.slice(start + 1)) {
		if (/autogenerated|D O {4}N O T|from the file/.test(l)) break;
		out.push(l);
	}
	while (out.length && !out.at(-1)) out.pop();
	while (out.length && !out[0]) out.shift();
	return out;
}

// Translates one formula file. Returns { code, fn, deps }; throws TErr on failure.
export function translateFormula(g, file, src) {
	const snake = snakeName(file);
	const toks = preprocess(src, new Map(g.macros));
	const funcs = new Parser(toks, g.types).parseProgram();
	const main = funcs.find((f) => g.formulaByName?.get(f.name) === snake) || funcs.at(-1);
	if (!main) fail('no function found');
	const saved = new Map();
	const parts = [];
	const deps = new Set();
	try {
		for (const f of funcs.filter((x) => x !== main)) {
			saved.set(f.name, g.fns.get(f.name));
			register(g, f, `${snake}_${f.name}`);
		}
		for (const f of funcs) {
			const em = new Emitter(g);
			const w = f === main ? `F_${snake}` : `${snake}_${f.name}`;
			parts.push(em.emitFunction(f, { wname: w, formula: f === main }));
			for (const d of em.deps) if (d !== snake) deps.add(d);
		}
	} finally {
		for (const [k, v] of saved) { if (v) g.fns.set(k, v); else g.fns.delete(k); }
	}
	const cr = credits(src);
	const header = `// ${snake}.wgsl — Mandelbulber2 formula ${main.name.replace(/Iteration$/, '')}, generated by
// tools/translate.mjs from formula/opencl/${file}. Do not edit; put fixes in tools/overrides/.
${HEADER_GPL}
${cr.map((l) => `//   ${l}`.trimEnd()).join('\n')}
//
// grep: F_${snake}
`;
	return { code: `${header}\n${parts.join('\n')}`, fn: `F_${snake}`, deps: [...deps] };
}
