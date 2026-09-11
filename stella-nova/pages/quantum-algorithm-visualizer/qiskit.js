// ============================================================================
//  QAVE Qiskit text helpers  (extracted from main.js, behavior-preserving)
// ----------------------------------------------------------------------------
//  Pure text transforms: parse Qiskit-like source to {n,gates}, emit source
//  from a gate list, and tokenize source to highlighted HTML. No DOM, no VS.
//
//  exports (grep -n): parseQiskit, gatesToQiskit, highlightQiskit
// ============================================================================
// Parse a small Qiskit-like source into {n, gates}: read QuantumCircuit(n), then
// one gate per method call. Angles allow pi and arithmetic; unknown ops throw.
function parseQiskit(src){
  const num=tok=>{const e=tok.trim().replace(/pi/gi,'Math.PI');if(!/^[-+0-9.\s*/()MathPI]*$/.test(e)||e==='')throw 'bad angle: '+tok;return Function('return ('+e+')')();};
  const qi=a=>{const v=parseInt(a,10);if(!Number.isInteger(v))throw 'bad qubit: '+a;return v;};
  let n=null;const gates=[];
  for(const raw of src.split('\n')){const line=raw.split('#')[0].trim();if(!line)continue;
    let m=line.match(/QuantumCircuit\s*\(\s*(\d+)/);if(m){n=parseInt(m[1]);continue;}
    m=line.match(/\.(\w+)\s*\(([^)]*)\)/);if(!m)continue;
    const fn=m[1].toLowerCase(),A=m[2].trim()===''?[]:m[2].split(',');
    if(['h','x','y','z','s','t'].includes(fn))gates.push({name:fn,kind:'unitary',targets:[qi(A[0])],controls:[]});
    else if(['rx','ry','rz'].includes(fn))gates.push({name:fn,kind:'unitary',targets:[qi(A[1])],controls:[],params:[num(A[0])]});
    else if(fn==='cx'||fn==='cnot')gates.push({name:'cx',kind:'unitary',targets:[qi(A[1])],controls:[qi(A[0])]});
    else if(fn==='cz')gates.push({name:'cz',kind:'unitary',targets:[qi(A[1])],controls:[qi(A[0])]});
    else if(fn==='swap')gates.push({name:'swap',kind:'unitary',targets:[qi(A[0]),qi(A[1])],controls:[]});
    else if(fn==='ccx'||fn==='toffoli')gates.push({name:'ccx',kind:'unitary',targets:[qi(A[2])],controls:[qi(A[0]),qi(A[1])]});
    else if(fn==='cswap'||fn==='fredkin')gates.push({name:'cswap',kind:'unitary',targets:[qi(A[1]),qi(A[2])],controls:[qi(A[0])]});
    else if(fn==='measure'||fn==='measure_all')gates.push({name:'measure',kind:'measurement',targets:null});
    else if(fn==='barrier'){}                                  // ignored
    else throw 'unsupported op: .'+fn+'()';}
  if(!n)throw 'no QuantumCircuit(n) line found';
  if(n<1||n>8)throw 'qubits must be 1–8 (got '+n+')';
  for(const g of gates){if(g.kind==='measurement'){g.targets=Array.from({length:n},(_,i)=>i);}
    else for(const q of g.targets.concat(g.controls||[]))if(!(q>=0&&q<n))throw 'qubit '+q+' out of range for n='+n;}
  return {n,gates};
}

// Emit Qiskit source for the current gate list (the inverse of parseQiskit).
function gatesToQiskit(gates,n){
  const fmt=x=>String(+(+x).toFixed(6));
  const out=['qc = QuantumCircuit('+n+')'];
  for(const g of gates){const nm=g.name,T=g.targets||[],C=g.controls||[];
    if(['h','x','y','z','s','t'].includes(nm))out.push('qc.'+nm+'('+T[0]+')');
    else if(['rx','ry','rz'].includes(nm))out.push('qc.'+nm+'('+fmt((g.params||[0])[0])+', '+T[0]+')');
    else if(nm==='cx')out.push('qc.cx('+C[0]+', '+T[0]+')');
    else if(nm==='cz')out.push('qc.cz('+C[0]+', '+T[0]+')');
    else if(nm==='swap')out.push('qc.swap('+T[0]+', '+T[1]+')');
    else if(nm==='ccx')out.push('qc.ccx('+C[0]+', '+C[1]+', '+T[0]+')');
    else if(nm==='cswap')out.push('qc.cswap('+C[0]+', '+T[0]+', '+T[1]+')');
    else if(g.kind==='measurement')out.push('qc.measure_all()');}
  return out.join('\n');
}
// Turn source into highlighted HTML by tokenizing and wrapping keywords, gate
// names, numbers, pi, and comments in colored spans. Drawn under the textarea.
function highlightQiskit(src){
  const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const single=/^(h|x|y|z|s|t|rx|ry|rz)$/,multi=/^(cx|cnot|cz|swap|ccx|toffoli|cswap|fredkin|measure|measure_all|barrier)$/;
  return src.split('\n').map(line=>{
    const h=line.indexOf('#');let code=line,cmt='';if(h>=0){code=line.slice(0,h);cmt=line.slice(h);}
    let out='',m;const re=/([A-Za-z_]\w*|\d+\.\d+|\.\d+|\d+|\s+|[(),.])/g;
    while((m=re.exec(code))){const t=m[0],e=esc(t);
      if(/^\s+$/.test(t)||/^[(),.]$/.test(t))out+=e;
      else if(t==='QuantumCircuit')out+='<span class="qk-kw">'+e+'</span>';
      else if(t==='qc')out+='<span class="qk-id">'+e+'</span>';
      else if(t==='pi')out+='<span class="qk-pi">'+e+'</span>';
      else if(single.test(t))out+='<span class="qk-gate">'+e+'</span>';
      else if(multi.test(t))out+='<span class="qk-cgate">'+e+'</span>';
      else if(/^(\d+\.\d+|\.\d+|\d+)$/.test(t))out+='<span class="qk-num">'+e+'</span>';
      else out+=e;}
    if(cmt)out+='<span class="qk-cmt">'+esc(cmt)+'</span>';
    return out||' ';
  }).join('\n');
}

export { parseQiskit, gatesToQiskit, highlightQiskit };
