// transpile src/**/*.ts to cjs/ with ts.transpileModule (no type check, no logic change)
const ts = require('/usr/local/lib/node_modules/openclaw/node_modules/typescript');
const fs = require('fs'), path = require('path');
function walk(d){return fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)])}
for (const f of walk('src').filter(f=>f.endsWith('.ts'))) {
  const out = ts.transpileModule(fs.readFileSync(f,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2017,esModuleInterop:false}, fileName:f});
  const o = path.join('cjs', path.relative('src', f)).replace(/\.ts$/,'.js');
  fs.mkdirSync(path.dirname(o),{recursive:true}); fs.writeFileSync(o,out.outputText);
}
