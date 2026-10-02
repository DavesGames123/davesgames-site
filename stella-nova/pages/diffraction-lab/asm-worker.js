// ============================================================================
//  APERTURE DIFFRACTION  ·  asm-worker.js  ·  one worker of the pool
// ----------------------------------------------------------------------------
//  main.js starts min(hardwareConcurrency − 1, wavelengths) of these workers
//  and gives each worker a set of wavelengths. The worker keeps the z-free
//  spectra of its wavelengths (DiffASM.makeSpec) for one setup key. Then each
//  frame costs one multiply and one inverse FFT per wavelength.
//
//  MESSAGES
//      in  {type:'setup', key, Nx, Ny, dx, dy, jobs:[{d, lam, re, im}]}
//      in  {type:'frame', key, seq, z, bufs:[ArrayBuffer]}   bufs: recycled
//      out {type:'frame', key, seq, res:[{d, buf}]}  buf = |E|² (Float64)
//      out {type:'error', key, seq, msg}
//  A frame for a key that this worker does not hold replies with an empty
//  res and ok:false; main.js then drops the frame (sequence check).
// ============================================================================
importScripts('asm.js');
let KEY=null,SPECS=[];const FREE=[];
onmessage=e=>{const m=e.data;try{
  if(m.type==='setup'){KEY=m.key;SPECS=m.jobs.map(j=>({d:j.d,sp:DiffASM.makeSpec(j.re,j.im,m.Nx,m.Ny,m.dx,m.dy,j.lam)}));return}
  if(m.type==='frame'){
    if(m.bufs)for(const b of m.bufs)FREE.push(b);
    if(m.key!==KEY){postMessage({type:'frame',key:m.key,seq:m.seq,ok:false,res:[]});return}
    const res=[],tr=[];
    for(const{d,sp}of SPECS){const n=sp.Nx*sp.Ny;let b=FREE.pop();if(!b||b.byteLength!==n*8)b=new ArrayBuffer(n*8);DiffASM.propI(sp,m.z,new Float64Array(b));res.push({d,buf:b});tr.push(b)}
    postMessage({type:'frame',key:m.key,seq:m.seq,ok:true,res},tr);
  }
}catch(err){postMessage({type:'error',key:m.key,seq:m.seq,msg:String(err&&err.message||err)})}};
