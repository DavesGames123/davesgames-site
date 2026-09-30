// gen.mjs — regenerate everything under gen/ from a Mandelbulber2 checkout.
//
// usage: node tools/gen.mjs <path to mandelbulber2 checkout> [--only a,b] [--jobs N] [--no-catalog]
//
// Writes gen/struct.wgsl, gen/aux.wgsl, gen/helpers.wgsl, gen/layout.json, and one
// gen/formulas/<snake>.wgsl per formula, then validates every formula with naga
// (struct + aux + helpers + deps + formula + a stub entry point). A file in
// tools/overrides/<snake>.wgsl replaces the translation of that formula and is
// validated the same way. Results go to gen/formulas/index.json. When
// tools/catalog.mjs exists, its buildCatalog(UP, genDir) runs last.
// Failed translations are not written under gen/; the WGSL that naga rejected
// goes to $TMPDIR/mandelbulber-gen-failed/ for inspection.
//
// Ports code from Mandelbulber2 (GPL-3.0-or-later, (C) Mandelbulber Team); see ../COPYING.
//
// grep: main validate runPool stub classify writeIndex buildCatalog
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { tmpdir, homedir, cpus } from 'node:os';
import {
	loadUpstream, buildStructWGSL, buildAuxWGSL, buildHelpersWGSL, buildLayout, registerFormulas,
	translateFormula, snakeName, TErr,
} from './translate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const page = join(here, '..');
const genDir = join(page, 'gen');
const formulaDir = join(genDir, 'formulas');
const overrideDir = join(here, 'overrides');
const NAGA = process.env.NAGA || join(homedir(), '.cargo/bin/naga');

const args = process.argv.slice(2);
const UP = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a) && !args[args.indexOf(a) - 1]?.match(/^--(only|jobs)$/));
if (!UP) { console.error('usage: node tools/gen.mjs <mandelbulber2 checkout> [--only a,b] [--jobs N] [--no-catalog]'); process.exit(1); }
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const only = opt('--only') ? new Set(opt('--only').split(',')) : null;
const jobs = +(opt('--jobs') || Math.max(2, cpus().length));
const failDir = join(tmpdir(), 'mandelbulber-gen-failed');
const scratch = join(tmpdir(), `mandelbulber-gen-${process.pid}`);

const stub = (fn) => `
@group(0) @binding(0) var<storage, read_write> OUT: array<vec4f>;
@group(0) @binding(1) var<storage, read> FR: array<Fractal>;
@compute @workgroup_size(1) fn main() {
	var a: Aux;
	OUT[0] = ${fn}(OUT[0], 0u, &a);
}
`;

function naga(file) {
	return new Promise((resolve) => {
		const p = spawn(NAGA, [file]);
		let out = '';
		p.stdout.on('data', (d) => { out += d; });
		p.stderr.on('data', (d) => { out += d; });
		p.on('close', (code) => resolve({ ok: code === 0, out: out.trim() }));
	});
}

async function runPool(items, n, fn) {
	let next = 0;
	const worker = async () => { while (next < items.length) { const i = next++; await fn(items[i], i); } };
	await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

// Short failure category: the first error line with names and numbers removed.
function classify(err) {
	const first = err.split('\n').find((l) => /error|translate:/i.test(l)) || err.split('\n')[0];
	return first.replace(/`[^`]*`/g, '`_`').replace(/'[^']*'/g, "'_'").replace(/\d+/g, 'N')
		.replace(/\b(?:vec\df|vec\di|f32|i32|u32|bool|matrix33|Aux|Fractal)\b/g, 'T').slice(0, 110);
}

function trimError(out) {
	// naga prints the error and a source excerpt; keep a readable head.
	return out.split('\n').slice(0, 14).join('\n');
}

async function main() {
	const t0 = Date.now();
	mkdirSync(formulaDir, { recursive: true });
	mkdirSync(scratch, { recursive: true });
	const g = loadUpstream(UP);

	const structW = buildStructWGSL(g);
	const auxW = buildAuxWGSL(g);
	const { text: helpersW, skipped } = buildHelpersWGSL(g);
	const layout = buildLayout(g);
	writeFileSync(join(genDir, 'struct.wgsl'), structW);
	writeFileSync(join(genDir, 'aux.wgsl'), auxW);
	writeFileSync(join(genDir, 'helpers.wgsl'), helpersW);
	writeFileSync(join(genDir, 'layout.json'), `${JSON.stringify(layout, null, 1)}\n`);
	const prelude = `${structW}\n${auxW}\n${helpersW}\n`;
	{
		const f = join(scratch, '_prelude.wgsl');
		writeFileSync(f, `${prelude}\n@compute @workgroup_size(1) fn main() {}\n`);
		const r = await naga(f);
		console.log(`prelude (struct + aux + helpers): ${r.ok ? 'naga ok' : 'NAGA FAIL'}`);
		if (!r.ok) { console.log(r.out); process.exit(1); }
		console.log(`Fractal: ${layout.Fractal.size} bytes, ${Object.keys(layout.Fractal.fields).length} leaf fields; helpers skipped: ${skipped.map((s) => s.split(':')[0]).join(', ') || 'none'}`);
	}

	const clDir = join(UP, 'formula/opencl');
	const files = readdirSync(clDir).filter((f) => f.endsWith('.cl')).sort().map((f) => [f, readFileSync(join(clDir, f), 'utf8')]);
	registerFormulas(g, files);

	const indexPath = join(formulaDir, 'index.json');
	const index = only && existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : {};
	const results = new Map();
	for (const [file, src] of files) {
		const snake = snakeName(file);
		if (only && !only.has(snake)) continue;
		const ov = join(overrideDir, `${snake}.wgsl`);
		if (existsSync(ov)) {
			const code = readFileSync(ov, 'utf8');
			const deps = [...new Set([...code.matchAll(/\bF_(\w+)\s*\(/g)].map((m) => m[1]).filter((d) => d !== snake))];
			results.set(snake, { file, code, deps, status: 'override' });
			continue;
		}
		try {
			const r = translateFormula(g, file, src);
			results.set(snake, { file, code: r.code, deps: r.deps, status: 'ok' });
		} catch (err) {
			if (!(err instanceof TErr)) throw err;
			results.set(snake, { file, code: null, deps: [], status: 'fail', error: `translate: ${err.message}` });
		}
	}

	// Formula code by name, for dependency inclusion (includes earlier results when --only).
	const codeOf = (d) => results.get(d)?.code ?? (existsSync(join(formulaDir, `${d}.wgsl`)) ? readFileSync(join(formulaDir, `${d}.wgsl`), 'utf8') : null);
	const depClosure = (snake) => {
		const out = [];
		const seen = new Set([snake]);
		const visit = (s) => {
			for (const d of results.get(s)?.deps ?? index[s]?.deps ?? []) {
				if (seen.has(d)) continue;
				seen.add(d);
				visit(d);
				out.push(d);
			}
		};
		visit(snake);
		return out;
	};

	const todo = [...results.entries()].filter(([, r]) => r.code);
	await runPool(todo, jobs, async ([snake, r]) => {
		const deps = depClosure(snake);
		const missing = deps.filter((d) => !codeOf(d));
		if (missing.length) { r.status = 'fail'; r.error = `missing dependency: ${missing.join(', ')}`; return; }
		const f = join(scratch, `${snake}.wgsl`);
		writeFileSync(f, `${prelude}\n${deps.map(codeOf).join('\n')}\n${r.code}\n${stub(`F_${snake}`)}`);
		const v = await naga(f);
		if (!v.ok) {
			r.error = `naga: ${trimError(v.out)}`;
			r.status = 'fail';
		}
	});

	rmSync(failDir, { recursive: true, force: true });
	mkdirSync(failDir, { recursive: true });
	for (const [snake, r] of results) {
		const out = join(formulaDir, `${snake}.wgsl`);
		if (r.status === 'fail') {
			if (existsSync(out)) rmSync(out);
			if (r.code) writeFileSync(join(failDir, `${snake}.wgsl`), r.code);
		} else writeFileSync(out, r.code);
		index[snake] = { fn: `F_${snake}`, deps: r.deps, status: r.status, ...(r.error ? { error: r.error } : {}) };
	}
	if (!only) {
		for (const f of readdirSync(formulaDir)) {
			if (f.endsWith('.wgsl') && !results.has(f.replace(/\.wgsl$/, ''))) rmSync(join(formulaDir, f));
		}
	}
	const sorted = Object.fromEntries(Object.keys(index).sort().map((k) => [k, index[k]]));
	writeFileSync(indexPath, `${JSON.stringify(sorted, null, 1)}\n`);
	rmSync(scratch, { recursive: true, force: true });

	// Summary.
	const all = Object.values(sorted);
	const count = (s) => all.filter((x) => x.status === s).length;
	const cats = new Map();
	for (const x of all) if (x.status === 'fail') { const c = classify(x.error); cats.set(c, (cats.get(c) || 0) + 1); }
	console.log('\n=== formula translation summary ===');
	console.log(`total     ${all.length}`);
	console.log(`ok        ${count('ok')}`);
	console.log(`override  ${count('override')}`);
	console.log(`fail      ${count('fail')}`);
	console.log(`pass rate ${(100 * (count('ok') + count('override')) / all.length).toFixed(1)}%`);
	if (cats.size) {
		console.log('\ntop failure categories:');
		for (const [c, n] of [...cats].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`${String(n).padStart(4)}  ${c}`);
		console.log(`\nfailed WGSL (when any was emitted): ${failDir}`);
	}
	console.log(`time ${((Date.now() - t0) / 1000).toFixed(1)} s`);

	const catalog = join(here, 'catalog.mjs');
	if (existsSync(catalog) && !args.includes('--no-catalog')) {
		const { buildCatalog } = await import(pathToFileURL(catalog).href);
		await buildCatalog(UP, genDir);
	}
}

main().catch((err) => { console.error(err); process.exit(1); });
