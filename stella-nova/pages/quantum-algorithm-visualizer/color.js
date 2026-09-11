// ============================================================================
//  QAVE color maps + tone curve  (extracted from main.js, behavior-preserving)
// ----------------------------------------------------------------------------
//  Pure color helpers: CMAPS ramps, heatColor, the monotone-cubic tone curve,
//  and the Re/phase/glow color ramps. ACTIVE_HEAT is module state; the cmap
//  swatch UI in main.js swaps it through setActiveHeat().
//
//  cellColor stays in main.js: it reads VS.colorMode (mutable view state).
// ============================================================================
/* ════════ color maps ════════ */
// Clamp to [0,1].
function clamp01(x){return x<0?0:x>1?1:x;}
// Linear interpolate between two RGB triples.
function lerp3(a,b,t){return[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];}
// Selectable density colormaps (0–255). Low end is never flat black.
const CMAPS={
  inferno:[[26,12,54],[58,18,99],[101,26,123],[151,41,107],[201,62,74],[233,109,38],[248,168,40],[251,221,96],[255,250,214]],
  viridis:[[68,1,84],[72,40,120],[62,74,137],[49,104,142],[38,130,142],[31,158,137],[53,183,121],[110,206,88],[181,222,43],[253,231,37]],
  turbo:[[48,18,59],[62,84,205],[40,160,232],[42,215,167],[120,245,80],[211,228,46],[252,160,46],[227,79,17],[122,4,3]],
  ice:[[6,11,32],[10,32,74],[16,62,124],[26,104,176],[42,152,212],[96,198,236],[166,228,246],[232,249,255]],
  plasma:[[24,12,110],[84,2,163],[139,10,165],[185,50,137],[219,92,104],[244,136,73],[254,188,43],[240,249,33]],
  mono:[[24,26,34],[62,67,80],[110,117,134],[158,166,186],[206,214,232],[245,249,255]]
};
// The colormap the |ρ| mode currently uses; swapped by the colormap swatches.
let ACTIVE_HEAT=CMAPS.inferno;
// Map v in [0,1] onto the active colormap with linear interpolation.
function heatColor(v){v=clamp01(v);const H=ACTIVE_HEAT,s=v*(H.length-1),i=Math.min(Math.floor(s),H.length-2),t=s-i;return lerp3(H[i],H[i+1],t);}
// ── tone curve: input |ρ| → colormap position, shaped by draggable keys (Photoshop-style) ──
// The tone curve: three control points (ends pinned, middle draggable) plus a
// 256-entry lookup table sampled from them.
const CURVE={pts:[{x:0,y:0},{x:0.5,y:Math.pow(0.5,0.2)},{x:1,y:1}],lut:new Float32Array(256)};
// Rebuild the LUT with a monotone cubic (Fritsch-Carlson) interpolation of the
// control points, so the curve never overshoots or inverts between keys.
function buildCurve(){
  const P=CURVE.pts;P.sort((a,b)=>a.x-b.x);const n=P.length;
  const xs=P.map(p=>p.x),ys=P.map(p=>p.y),dx=[],m=[];
  for(let i=0;i<n-1;i++){dx[i]=Math.max(1e-6,xs[i+1]-xs[i]);m[i]=(ys[i+1]-ys[i])/dx[i];}
  const t=new Array(n);t[0]=m[0];t[n-1]=m[n-2];
  for(let i=1;i<n-1;i++)t[i]=(m[i-1]*m[i]<=0)?0:(m[i-1]+m[i])/2;
  for(let i=0;i<n-1;i++){if(m[i]===0){t[i]=0;t[i+1]=0;}else{const a=t[i]/m[i],b=t[i+1]/m[i],s=a*a+b*b;if(s>9){const k=3/Math.sqrt(s);t[i]=k*a*m[i];t[i+1]=k*b*m[i];}}}
  for(let k=0;k<256;k++){const x=k/255;let i=0;while(i<n-2&&x>xs[i+1])i++;
    const h=dx[i],s=(x-xs[i])/h,h00=(1+2*s)*(1-s)*(1-s),h10=s*(1-s)*(1-s),h01=s*s*(3-2*s),h11=s*s*(s-1);
    CURVE.lut[k]=Math.min(1,Math.max(0,h00*ys[i]+h10*h*t[i]+h01*ys[i+1]+h11*h*t[i+1]));}
}
// Read the tone curve at v via the LUT.
function curveEval(v){v=clamp01(v);return CURVE.lut[Math.min(255,(v*255)|0)];}
buildCurve();
// CSS gradient string for a colormap, used for the legend swatch.
function cmapCss(name){const H=CMAPS[name];return 'linear-gradient(90deg,'+H.map((c,i)=>'rgb('+c[0]+','+c[1]+','+c[2]+') '+Math.round(i/(H.length-1)*100)+'%').join(',')+')';}
function currentCmap(){for(const k in CMAPS)if(CMAPS[k]===ACTIVE_HEAT)return k;return 'inferno';}
// Accent colors reused across the 3D scene and 2D overlays.
const C_CYAN=[69,211,255],C_AMBER=[255,185,72],C_NAVY=[36,52,78];
// Re(ρ) coloring: amber for negative, navy at zero, cyan for positive.
function densityColorReal(re){const t=(Math.max(-1,Math.min(1,re))+1)*0.5;return t<0.5?lerp3(C_AMBER,C_NAVY,t*2):lerp3(C_NAVY,C_CYAN,(t-0.5)*2);}
// Phase(ρ) coloring: map the angle onto a cyan→violet→amber ramp.
function amplitudeColorArr(ph){let n=(ph+Math.PI)/(2*Math.PI);n=clamp01(n);const c0=[75,215,255],c1=[130,115,255],c2=[255,177,92];return n<0.5?lerp3(c0,c1,n*2):lerp3(c1,c2,(n-0.5)*2);}
// Color for the animation phase (pre-gate, apply, settle), used on the score.
function phaseColorArr(p){return p==='pre_gate'?[105,168,255]:p==='apply_gate'?[72,224,252]:p==='settle'?[255,194,94]:[182,196,216];}
// Glow scales smoothly with magnitude (LINEAR multiplier — applied after the sRGB→linear color conversion,
// so it never runs through the sRGB transfer and blows up). Every lit cell glows a little; pure cells most.
function glowGain(mag){const v=clamp01(mag);return 1+1.9*v;}   // linear ramp: v=0→1.0, 0.25→1.48, 0.5→1.95, 1→2.9

// Swap the active |rho| colormap (called by the cmap swatch UI in main.js).
function setActiveHeat(h){ACTIVE_HEAT=h;}

export { clamp01, heatColor, curveEval, CMAPS, cmapCss, currentCmap, C_CYAN, C_AMBER, phaseColorArr, glowGain, CURVE, buildCurve, densityColorReal, amplitudeColorArr, setActiveHeat };
