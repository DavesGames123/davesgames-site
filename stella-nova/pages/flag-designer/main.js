// ============================================================================
//  COLONY FLAG DESIGNER  ·  canvas flag composer with a cloth wave preview
// ----------------------------------------------------------------------------
//  Classic script. A flag is four choices: a pattern (background design), a
//  shape (the outline it is clipped to), an optional emblem, and three colors
//  (primary, secondary, and a symbol color for the emblem). All drawing is 2D
//  canvas. The same renderFlag() paints the big preview, every catalog and
//  preset thumbnail, and the texture fed into the waving-cloth simulation.
//
//  FLAG RENDER PIPELINE  (renderFlag)
//  ----------------------------------------------------------------------------
//      pattern.draw(c1,c2) ─▶ offscreen canvas
//      emblem.draw(c3)     ─▶ same offscreen (centered)
//                                     │
//      shape.path(W,H) ─▶ clip ───────┤
//                                     ▼
//                         drawImage offscreen ─▶ visible canvas ─▶ outline
//
//  COLOR MODEL  (three identical pickers: primary, secondary, tertiary)
//  ----------------------------------------------------------------------------
//      native <input type=color> ┐
//      hex text field            ├─▶ setX(hex) ─▶ state + every field + swatch
//      R/G/B number fields       │              └─▶ syncHsvFromHex ─▶ SV/hue canvas
//      HSV square + hue strip ───┘
//      any change ─▶ colorChanged() ─▶ repaint preview, catalog, presets
//
//  CLOTH SIMULATION  (Verlet grid, waveLoop)
//  ----------------------------------------------------------------------------
//      points (41×26) ─▶ integrate (velocity + gravity + wind)
//                     ─▶ solve distance constraints ×5 (pinned left edge)
//                     ─▶ draw as textured quads sampling the flag pixels
//
//  SECTION MAP  (jump with grep -n "<anchor>" main.js)
//    color math ........... "function hexToRgb"      hex/rgb/hsv conversions
//    live state ........... "var primaryColor"       current selection
//    shapes ............... "var SHAPES"             outline polygons
//    emblems .............. "var EMBLEMS"            centered symbol drawers
//    patterns ............. "var PATTERNS"           30 background designs
//    presets .............. "var PRESETS"            named ready-made banners
//    core render .......... "function renderFlag"    pattern + emblem + clip
//    catalog build ........ "function buildShapes"   populate the pickers
//    color pickers ........ "function setPrimary"    push a color everywhere
//    hsv pickers .......... "var hsvState"           square/hue canvas logic
//    cloth sim ............ "function initCloth"     verlet grid setup
//    cloth step ........... "function updateCloth"   integrate and constrain
//    cloth draw ........... "function renderWave"    texture the mesh
//    boot ................. "function init"          wire everything and start
// ============================================================================

// ── COLOR UTILITIES ──
// Conversions between the three color representations the pickers share: hex
// string, RGB bytes, and HSV floats in 0..1. clamp() bounds an RGB channel.
function hexToRgb(h){h=h.replace('#','');if(h.length===3)h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2];return{r:parseInt(h.substring(0,2),16),g:parseInt(h.substring(2,4),16),b:parseInt(h.substring(4,6),16)};}
function rgbToHex(r,g,b){return'#'+((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1).toUpperCase();}
function clamp(v){return Math.max(0,Math.min(255,Math.round(v)));}
// RGB bytes to HSV: hue from which channel is the max, saturation from the
// max-to-min spread, value from the max. Hue is returned as a 0..1 fraction.
function rgbToHsv(r,g,b){r/=255;g/=255;b/=255;var mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn,h=0,s=mx===0?0:d/mx,v=mx;if(d!==0){if(mx===r)h=((g-b)/d+(g<b?6:0))/6;else if(mx===g)h=((b-r)/d+2)/6;else h=((r-g)/d+4)/6;}return{h:h,s:s,v:v};}
// HSV to RGB: pick one of six hue sextants and interpolate. Inverse of rgbToHsv.
function hsvToRgb(h,s,v){var i=Math.floor(h*6),f=h*6-i,p=v*(1-s),q=v*(1-f*s),t=v*(1-(1-f)*s);var r,g,b;switch(i%6){case 0:r=v;g=t;b=p;break;case 1:r=q;g=v;b=p;break;case 2:r=p;g=v;b=t;break;case 3:r=p;g=q;b=v;break;case 4:r=t;g=p;b=v;break;case 5:r=v;g=p;b=q;break;}return{r:Math.round(r*255),g:Math.round(g*255),b:Math.round(b*255)};}

// ── STATE ──
// The current selection. Every control writes here and every renderer reads it.
var primaryColor = '#6B1D1D';
var secondaryColor = '#C0C8D0';
var tertiaryColor = '#E8D060';
var currentPattern = 'cross';
var currentShape = 'rectangle';
var currentEmblem = 'star5';

// ── FLAG SHAPES ──
// Outline definitions. Each path(W,H) returns a polygon in canvas coordinates;
// renderFlag clips the drawn flag to it. The mini SVG in the shape picker reuses
// the same path at thumbnail size.
var SHAPES = [
  {id:'rectangle', name:'Standard', path:function(W,H){return[[0,0],[W,0],[W,H],[0,H]];}},
  {id:'pennant', name:'Pennant', path:function(W,H){return[[0,0],[W,H*0.5],[0,H]];}},
  {id:'swallowtail', name:'Swallowtail', path:function(W,H){return[[0,0],[W,0],[W,H],[0,H],[W*0.2,H*0.5]];}},
  {id:'guidon', name:'Guidon', path:function(W,H){return[[0,0],[W*0.7,0],[W,H*0.5],[W*0.7,H],[0,H]];}},
  {id:'burgee', name:'Burgee', path:function(W,H){return[[0,0],[W,H*0.5],[0,H]];}},
  {id:'shield', name:'Shield', path:function(W,H){return[[0,0],[W,0],[W,H*0.6],[W*0.5,H],[0,H*0.6]];}},
];

// ── EMBLEMS ──
// Centered symbols. Each draw(ctx,cx,cy,r,c) paints one emblem of radius r in
// color c at (cx,cy). 'none' draws nothing. The crescent uses a destination-out
// pass to subtract an offset disc, carving the moon shape.
var EMBLEMS = [
  {id:'none', label:'None', draw:function(){}},
  {id:'star5', label:'Star', draw:function(ctx,cx,cy,r,c){drawStar(ctx,cx,cy,r,5,c);}},
  {id:'star6', label:'Hex Star', draw:function(ctx,cx,cy,r,c){drawStar(ctx,cx,cy,r,6,c);}},
  {id:'star8', label:'8-Star', draw:function(ctx,cx,cy,r,c){drawStar(ctx,cx,cy,r,8,c);}},
  {id:'circle', label:'Circle', draw:function(ctx,cx,cy,r,c){ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fillStyle=c;ctx.fill();}},
  {id:'ring', label:'Ring', draw:function(ctx,cx,cy,r,c){ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.lineWidth=r*0.22;ctx.strokeStyle=c;ctx.stroke();}},
  {id:'diamond', label:'Diamond', draw:function(ctx,cx,cy,r,c){ctx.beginPath();ctx.moveTo(cx,cy-r);ctx.lineTo(cx+r*0.65,cy);ctx.lineTo(cx,cy+r);ctx.lineTo(cx-r*0.65,cy);ctx.closePath();ctx.fillStyle=c;ctx.fill();}},
  {id:'crescent', label:'Crescent', draw:function(ctx,cx,cy,r,c){ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fillStyle=c;ctx.fill();ctx.globalCompositeOperation='destination-out';ctx.beginPath();ctx.arc(cx+r*0.35,cy,r*0.8,0,Math.PI*2);ctx.fill();ctx.globalCompositeOperation='source-over';}},
  {id:'cross', label:'Cross', draw:function(ctx,cx,cy,r,c){var w=r*0.32;ctx.fillStyle=c;ctx.fillRect(cx-w,cy-r,w*2,r*2);ctx.fillRect(cx-r,cy-w,r*2,w*2);}},
  {id:'anchor', label:'Anchor', draw:function(ctx,cx,cy,r,c){ctx.strokeStyle=c;ctx.lineWidth=r*0.18;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(cx,cy-r*0.8);ctx.lineTo(cx,cy+r*0.7);ctx.stroke();ctx.beginPath();ctx.arc(cx,cy+r*0.15,r*0.55,Math.PI*0.15,Math.PI*0.85);ctx.stroke();ctx.beginPath();ctx.moveTo(cx-r*0.35,cy-r*0.8);ctx.lineTo(cx+r*0.35,cy-r*0.8);ctx.stroke();ctx.beginPath();ctx.arc(cx,cy-r*0.55,r*0.25,0,Math.PI*2);ctx.stroke();}},
];

// Draw a filled star with pts points. It steps 2×pts vertices around the center,
// alternating the outer radius r and an inner radius (0.45r) to make the notches.
function drawStar(ctx,cx,cy,r,pts,c){
  ctx.beginPath();
  for(var i=0;i<pts*2;i++){var a=(i*Math.PI/pts)-Math.PI/2;var rr=i%2===0?r:r*0.45;ctx.lineTo(cx+Math.cos(a)*rr,cy+Math.sin(a)*rr);}
  ctx.closePath();ctx.fillStyle=c;ctx.fill();
}

// ── PATTERN DEFINITIONS ──
// The 30 background designs. Each draw(ctx,W,H,c1,c2) fills the full flag field
// using the primary and secondary colors; the emblem and shape clip are applied
// later by renderFlag. Order here sets the catalog grid order.
var PATTERNS = [
  {id:'solid', name:'Solid', draw:function(ctx,W,H,c1,c2){ctx.fillStyle=c1;ctx.fillRect(0,0,W,H);}},
  {id:'bicolor_h', name:'Bicolor H', draw:function(ctx,W,H,c1,c2){ctx.fillStyle=c1;ctx.fillRect(0,0,W,H/2);ctx.fillStyle=c2;ctx.fillRect(0,H/2,W,H/2);}},
  {id:'bicolor_v', name:'Bicolor V', draw:function(ctx,W,H,c1,c2){ctx.fillStyle=c1;ctx.fillRect(0,0,W/2,H);ctx.fillStyle=c2;ctx.fillRect(W/2,0,W/2,H);}},
  {id:'triband_h', name:'Triband H', draw:function(ctx,W,H,c1,c2){var h=H/3;ctx.fillStyle=c1;ctx.fillRect(0,0,W,h);ctx.fillStyle=c2;ctx.fillRect(0,h,W,h);ctx.fillStyle=c1;ctx.fillRect(0,h*2,W,h);}},
  {id:'triband_v', name:'Triband V', draw:function(ctx,W,H,c1,c2){var w=W/3;ctx.fillStyle=c1;ctx.fillRect(0,0,w,H);ctx.fillStyle=c2;ctx.fillRect(w,0,w,H);ctx.fillStyle=c1;ctx.fillRect(w*2,0,w,H);}},
  {id:'cross', name:'Cross', draw:function(ctx,W,H,c1,c2){ctx.fillStyle=c1;ctx.fillRect(0,0,W,H);var t=Math.min(W,H)*0.18;ctx.fillStyle=c2;ctx.fillRect(0,(H-t)/2,W,t);ctx.fillRect((W-t)/2,0,t,H);}},
  {id:'saltire', name:'Saltire', draw:function(ctx,W,H,c1,c2){ctx.fillStyle=c1;ctx.fillRect(0,0,W,H);ctx.strokeStyle=c2;ctx.lineWidth=Math.min(W,H)*0.16;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(W,H);ctx.moveTo(W,0);ctx.lineTo(0,H);ctx.stroke();}},
  {id:'chevron', name:'Chevron', draw:function(ctx,W,H,c1,c2){ctx.fillStyle=c2;ctx.fillRect(0,0,W,H);ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(W*0.4,H/2);ctx.lineTo(0,H);ctx.closePath();ctx.fillStyle=c1;ctx.fill();}},
  {id:'diagonal_l', name:'Diagonal ╲', draw:function(ctx,W,H,c1,c2){ctx.fillStyle=c1;ctx.fillRect(0,0,W,H);ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(W,0);ctx.lineTo(W,H);ctx.closePath();ctx.fillStyle=c2;ctx.fill();}},
  {id:'diagonal_r', name:'Diagonal ╱', draw:function(ctx,W,H,c1,c2){ctx.fillStyle=c1;ctx.fillRect(0,0,W,H);ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(W,H);ctx.lineTo(0,H);ctx.closePath();ctx.fillStyle=c2;ctx.fill();}},
  {id:'quarters', name:'Quarters', draw:function(ctx,W,H,c1,c2){ctx.fillStyle=c1;ctx.fillRect(0,0,W/2,H/2);ctx.fillRect(W/2,H/2,W/2,H/2);ctx.fillStyle=c2;ctx.fillRect(W/2,0,W/2,H/2);ctx.fillRect(0,H/2,W/2,H/2);}},
  {id:'canton', name:'Canton', draw:function(ctx,W,H,c1,c2){ctx.fillStyle=c2;ctx.fillRect(0,0,W,H);ctx.fillStyle=c1;ctx.fillRect(0,0,W*0.42,H*0.55);}},
  {id:'stripe_bot', name:'Base Stripe', draw:function(ctx,W,H,c1,c2){ctx.fillStyle=c1;ctx.fillRect(0,0,W,H);ctx.fillStyle=c2;ctx.fillRect(0,H*0.72,W,H*0.28);}},
  {id:'border_flag', name:'Border', draw:function(ctx,W,H,c1,c2){ctx.fillStyle=c2;ctx.fillRect(0,0,W,H);var m=Math.min(W,H)*0.14;ctx.fillStyle=c1;ctx.fillRect(m,m,W-m*2,H-m*2);}},
  {id:'circle_center', name:'Disc', draw:function(ctx,W,H,c1,c2){ctx.fillStyle=c1;ctx.fillRect(0,0,W,H);ctx.beginPath();ctx.arc(W/2,H/2,Math.min(W,H)*0.28,0,Math.PI*2);ctx.fillStyle=c2;ctx.fill();}},
  {id:'ring_center', name:'Ring', draw:function(ctx,W,H,c1,c2){ctx.fillStyle=c1;ctx.fillRect(0,0,W,H);var r=Math.min(W,H)*0.28;ctx.beginPath();ctx.arc(W/2,H/2,r,0,Math.PI*2);ctx.lineWidth=r*0.22;ctx.strokeStyle=c2;ctx.stroke();}},
  {id:'diamond_center', name:'Diamond', draw:function(ctx,W,H,c1,c2){ctx.fillStyle=c1;ctx.fillRect(0,0,W,H);ctx.beginPath();ctx.moveTo(W/2,H*0.12);ctx.lineTo(W*0.78,H/2);ctx.lineTo(W/2,H*0.88);ctx.lineTo(W*0.22,H/2);ctx.closePath();ctx.fillStyle=c2;ctx.fill();}},
  {id:'sunburst', name:'Sunburst', draw:function(ctx,W,H,c1,c2){ctx.fillStyle=c1;ctx.fillRect(0,0,W,H);var cx=W/2,cy=H/2,n=16;ctx.fillStyle=c2;for(var i=0;i<n;i+=2){ctx.beginPath();ctx.moveTo(cx,cy);var a1=(i/n)*Math.PI*2-Math.PI/2,a2=((i+1)/n)*Math.PI*2-Math.PI/2;var r=Math.max(W,H);ctx.arc(cx,cy,r,a1,a2);ctx.closePath();ctx.fill();}}},
  {id:'bend', name:'Bend', draw:function(ctx,W,H,c1,c2){ctx.fillStyle=c1;ctx.fillRect(0,0,W,H);ctx.strokeStyle=c2;ctx.lineWidth=Math.min(W,H)*0.24;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(W,H);ctx.stroke();}},
  {id:'pale', name:'Pale', draw:function(ctx,W,H,c1,c2){ctx.fillStyle=c1;ctx.fillRect(0,0,W,H);var w=W*0.28;ctx.fillStyle=c2;ctx.fillRect((W-w)/2,0,w,H);}},
  {id:'fess', name:'Fess', draw:function(ctx,W,H,c1,c2){ctx.fillStyle=c1;ctx.fillRect(0,0,W,H);var h=H*0.3;ctx.fillStyle=c2;ctx.fillRect(0,(H-h)/2,W,h);}},
  {id:'pall', name:'Pall', draw:function(ctx,W,H,c1,c2){ctx.fillStyle=c1;ctx.fillRect(0,0,W,H);ctx.strokeStyle=c2;ctx.lineWidth=Math.min(W,H)*0.16;ctx.lineCap='square';ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(W*0.4,H/2);ctx.lineTo(0,H);ctx.moveTo(W*0.4,H/2);ctx.lineTo(W,H/2);ctx.stroke();}},
  {id:'gyronny', name:'Gyronny', draw:function(ctx,W,H,c1,c2){ctx.fillStyle=c1;ctx.fillRect(0,0,W,H);var cx=W/2,cy=H/2;ctx.fillStyle=c2;for(var i=0;i<4;i++){ctx.beginPath();ctx.moveTo(cx,cy);var a1=(i*2/8)*Math.PI*2-Math.PI/2;var a2=((i*2+1)/8)*Math.PI*2-Math.PI/2;var r=Math.max(W,H);ctx.arc(cx,cy,r,a1,a2);ctx.closePath();ctx.fill();}}},
  {id:'per_bend', name:'Per Bend', draw:function(ctx,W,H,c1,c2){ctx.fillStyle=c1;ctx.fillRect(0,0,W,H);ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(W,H);ctx.lineTo(W,0);ctx.closePath();ctx.fillStyle=c2;ctx.fill();}},
  {id:'chief', name:'Chief', draw:function(ctx,W,H,c1,c2){ctx.fillStyle=c1;ctx.fillRect(0,0,W,H);ctx.fillStyle=c2;ctx.fillRect(0,0,W,H*0.35);}},
  {id:'five_stripes', name:'5 Stripes', draw:function(ctx,W,H,c1,c2){var h=H/5;for(var i=0;i<5;i++){ctx.fillStyle=i%2===0?c1:c2;ctx.fillRect(0,h*i,W,h);}}},
  {id:'vert_stripes', name:'V-Stripes', draw:function(ctx,W,H,c1,c2){var w=W/5;for(var i=0;i<5;i++){ctx.fillStyle=i%2===0?c1:c2;ctx.fillRect(w*i,0,w,H);}}},
  {id:'check', name:'Checkers', draw:function(ctx,W,H,c1,c2){var n=4,cw=W/n,ch=H/3;for(var r=0;r<3;r++)for(var c=0;c<n;c++){ctx.fillStyle=(r+c)%2===0?c1:c2;ctx.fillRect(cw*c,ch*r,cw,ch);}}},
  {id:'arrow', name:'Arrow', draw:function(ctx,W,H,c1,c2){ctx.fillStyle=c1;ctx.fillRect(0,0,W,H);ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(W*0.5,H/2);ctx.lineTo(0,H);ctx.lineTo(W*0.18,H/2);ctx.closePath();ctx.fillStyle=c2;ctx.fill();}},
  {id:'serrated', name:'Serrated', draw:function(ctx,W,H,c1,c2){ctx.fillStyle=c2;ctx.fillRect(0,0,W,H);ctx.beginPath();ctx.moveTo(0,0);var n=6;for(var i=0;i<n;i++){ctx.lineTo(W*0.45,H*(i+0.5)/n);ctx.lineTo(0,H*(i+1)/n);}ctx.closePath();ctx.fillStyle=c1;ctx.fill();}},
];

// ── PRESET BANNERS: [name, c1, c2, c3_symbol, pattern, shape, emblem] ──
// Ready-made banners. Each row is a complete selection; clicking one applies all
// seven fields at once. The positional tuple order is documented on this line.
var PRESETS = [
  ['Viper','#6B1D1D','#C0C8D0','#E8D060','cross','rectangle','star5'],
  ['Terran','#18244A','#C0C8D0','#D4443B','canton','rectangle','star5'],
  ['Martian','#8B0000','#D2691E','#FFD700','chevron','rectangle','none'],
  ['Void Corp','#0a0a14','#8866ff','#00e8ff','saltire','rectangle','ring'],
  ['Solaris','#CC4400','#FF9900','#FFFFFF','sunburst','rectangle','circle'],
  ['Frostheim','#d0e8f0','#2080c0','#FFFFFF','triband_h','swallowtail','star6'],
  ['Jade Fed','#005544','#50c878','#FFD700','diagonal_l','rectangle','diamond'],
  ['Crimson','#8a1a1a','#e8e0d0','#FFFFFF','cross','shield','none'],
  ['Nebula','#3020a0','#00e8ff','#ff40ff','per_bend','guidon','star5'],
  ['Iron','#404850','#c0c0c0','#E0A030','fess','rectangle','cross'],
  ['Nova','#1a0033','#ff40ff','#FFFFFF','gyronny','rectangle','star8'],
  ['Auroran','#004466','#66ffcc','#FFD700','pall','pennant','none'],
  ['Scorched','#330000','#ff3300','#FF9900','arrow','guidon','none'],
  ['Polar','#1a2a4a','#e0e8f0','#C0C8D0','canton','rectangle','star5'],
  ['Amber','#8b4513','#daa520','#FFFFFF','triband_v','rectangle','circle'],
  ['Emerald','#003300','#00cc66','#FFD700','five_stripes','rectangle','crescent'],
  ['Titanium','#1a1a2e','#e94560','#FFFFFF','bend','swallowtail','none'],
  ['Monarch','#4a0060','#ffd700','#FFFFFF','border_flag','shield','diamond'],
  ['Tempest','#003355','#88ccee','#FFD700','vert_stripes','rectangle','none'],
  ['Sentinel','#222222','#888890','#ffcc00','chief','rectangle','anchor'],
];

// ── RENDER FLAG ──
// The one renderer for every flag on the page. It paints the pattern and emblem
// onto an offscreen canvas, then clips that image to the chosen shape on the
// target canvas and strokes the outline. Drawing to an offscreen first lets the
// clip apply to the whole composed design at once. preview thins the outline for
// thumbnails. Sizing the canvas here (W/H) also clears any previous contents.
function renderFlag(canvas, W, H, c1, c2, c3, patternId, shapeId, emblemId, preview) {
  canvas.width = W; canvas.height = H;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  // Find pattern
  var pat = PATTERNS.find(function(p){return p.id===patternId;}) || PATTERNS[0];

  // Offscreen pattern render
  var offscreen = document.createElement('canvas');
  offscreen.width = W; offscreen.height = H;
  var ox = offscreen.getContext('2d');
  pat.draw(ox, W, H, c1, c2);

  // Draw emblem using tertiary (symbol) color
  if (emblemId && emblemId !== 'none') {
    var emb = EMBLEMS.find(function(e){return e.id===emblemId;});
    if (emb) {
      var er = Math.min(W, H) * 0.2;
      ox.save();
      emb.draw(ox, W/2, H/2, er, c3);
      ox.restore();
    }
  }

  // Apply shape clip
  var shape = SHAPES.find(function(s){return s.id===shapeId;}) || SHAPES[0];
  var pts = shape.path(W, H);
  ctx.save();
  ctx.beginPath();
  pts.forEach(function(p, i) { i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1]); });
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(offscreen, 0, 0);
  ctx.restore();

  // Draw shape outline
  ctx.beginPath();
  pts.forEach(function(p, i) { i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1]); });
  ctx.closePath();
  ctx.strokeStyle = 'rgba(200,220,255,0.25)';
  ctx.lineWidth = preview ? 1 : 2;
  ctx.stroke();
}

// Repaint the large preview from the current selection.
function renderPreview() {
  var c = document.getElementById('previewCanvas');
  renderFlag(c, 480, 320, primaryColor, secondaryColor, tertiaryColor, currentPattern, currentShape, currentEmblem, false);
}

// ── BUILD UI ──
// Populate the shape strip. Each button shows a mini SVG of the shape path and,
// on click, sets currentShape and repaints the preview, catalog, and presets.
function buildShapes() {
  var g = document.getElementById('shapeStrip');
  SHAPES.forEach(function(s) {
    var btn = document.createElement('div');
    btn.className = 'shape-btn' + (s.id === currentShape ? ' active' : '');
    btn.dataset.id = s.id;
    // Mini SVG shape preview
    var pts = s.path(40, 24);
    var d = pts.map(function(p,i){return (i===0?'M':'L')+p[0]+','+p[1];}).join(' ')+'Z';
    btn.innerHTML = '<svg viewBox="0 0 40 24"><path d="'+d+'" fill="var(--text-faint)" stroke="var(--text-dim)" stroke-width="0.8"/></svg><span>'+s.name+'</span>';
    btn.onclick = function() {
      currentShape = s.id;
      document.querySelectorAll('.shape-btn').forEach(function(b){b.classList.remove('active');});
      btn.classList.add('active');
      renderPreview(); renderAllPatternCards(); renderAllPresets(); updatePresetActive();
    };
    g.appendChild(btn);
  });
}

// Populate the emblem grid. Each button renders its emblem into a 32px canvas
// (an X for 'none'); clicking sets currentEmblem and repaints.
function buildEmblems() {
  var g = document.getElementById('emblemGrid');
  EMBLEMS.forEach(function(emb) {
    var btn = document.createElement('div');
    btn.className = 'emblem-btn' + (emb.id === currentEmblem ? ' active' : '');
    btn.dataset.id = emb.id;
    btn.title = emb.label;
    // Render mini emblem
    var mc = document.createElement('canvas'); mc.width = 32; mc.height = 32;
    var mx = mc.getContext('2d');
    if (emb.id === 'none') {
      mx.strokeStyle = '#6878a0'; mx.lineWidth = 1.5;
      mx.beginPath(); mx.moveTo(6,6); mx.lineTo(26,26); mx.moveTo(26,6); mx.lineTo(6,26); mx.stroke();
    } else {
      emb.draw(mx, 16, 16, 10, '#96c8ff');
    }
    btn.appendChild(mc);
    btn.onclick = function() {
      currentEmblem = emb.id;
      document.querySelectorAll('.emblem-btn').forEach(function(b){b.classList.remove('active');});
      btn.classList.add('active');
      renderPreview(); renderAllPatternCards(); renderAllPresets(); updatePresetActive();
    };
    g.appendChild(btn);
  });
}

// Populate the pattern catalog. Each card holds a canvas and a name; clicking
// sets currentPattern. The thumbnails are painted separately so they can be
// repainted when colors, shape, or emblem change without rebuilding the cards.
function buildPatternGrid() {
  var g = document.getElementById('patternGrid');
  PATTERNS.forEach(function(pat) {
    var card = document.createElement('div');
    card.className = 'pattern-card' + (pat.id === currentPattern ? ' active' : '');
    card.dataset.id = pat.id;
    var c = document.createElement('canvas');
    card.appendChild(c);
    card.innerHTML += '<span>' + pat.name + '</span>';
    card.onclick = function() {
      currentPattern = pat.id;
      document.querySelectorAll('.pattern-card').forEach(function(cc){cc.classList.remove('active');});
      card.classList.add('active');
      renderPreview(); renderAllPresets(); updatePresetActive();
    };
    g.appendChild(card);
  });
  renderAllPatternCards();
}

// Repaint every catalog thumbnail with the current colors, shape, and emblem so
// each card previews how that pattern would look in the active selection.
function renderAllPatternCards() {
  document.querySelectorAll('.pattern-card').forEach(function(card) {
    var c = card.querySelector('canvas');
    renderFlag(c, 165, 110, primaryColor, secondaryColor, tertiaryColor, card.dataset.id, currentShape, currentEmblem, true);
  });
}

// Populate the preset gallery. Clicking a preset loads all seven fields into
// state, pushes the colors through the pickers, syncs the active markers on the
// shape, pattern, and emblem controls, then repaints.
function buildPresets() {
  var g = document.getElementById('presetGrid');
  PRESETS.forEach(function(p, i) {
    var item = document.createElement('div');
    item.className = 'preset-item';
    item.dataset.idx = i;
    var c = document.createElement('canvas');
    item.appendChild(c);
    item.innerHTML += '<span>' + p[0] + '</span>';
    item.onclick = function() {
      primaryColor = p[1]; secondaryColor = p[2]; tertiaryColor = p[3];
      currentPattern = p[4]; currentShape = p[5]; currentEmblem = p[6];
      setPrimary(primaryColor); setSecondary(secondaryColor); setTertiary(tertiaryColor);
      // Update shape UI
      document.querySelectorAll('.shape-btn').forEach(function(b){b.classList.toggle('active',b.dataset.id===currentShape);});
      // Update pattern UI
      document.querySelectorAll('.pattern-card').forEach(function(b){b.classList.toggle('active',b.dataset.id===currentPattern);});
      // Update emblem UI
      document.querySelectorAll('.emblem-btn').forEach(function(b){b.classList.toggle('active',b.dataset.id===currentEmblem);});
      renderPreview(); renderAllPatternCards(); updatePresetActive();
    };
    g.appendChild(item);
  });
  renderAllPresets();
}

// Repaint every preset thumbnail from its own fixed tuple (not the current
// selection), so the gallery always shows each banner as designed.
function renderAllPresets() {
  document.querySelectorAll('.preset-item').forEach(function(item) {
    var c = item.querySelector('canvas');
    var p = PRESETS[+item.dataset.idx];
    renderFlag(c, 132, 88, p[1], p[2], p[3], p[4], p[5], p[6], true);
  });
}

// Highlight a preset only when the current selection matches it exactly across
// all three colors, pattern, shape, and emblem; otherwise none is active.
function updatePresetActive() {
  document.querySelectorAll('.preset-item').forEach(function(item) {
    var p = PRESETS[+item.dataset.idx];
    var match = primaryColor.toUpperCase() === p[1].toUpperCase()
      && secondaryColor.toUpperCase() === p[2].toUpperCase()
      && tertiaryColor.toUpperCase() === p[3].toUpperCase()
      && currentPattern === p[4] && currentShape === p[5] && currentEmblem === p[6];
    item.classList.toggle('active', match);
  });
}

// ── COLOR PICKER WIRING ──
// setPrimary/setSecondary/setTertiary are the single write path for each color.
// Given a hex, each updates state, the native picker, the hex field, the R/G/B
// fields, the swatch, and the HSV canvases, so all representations stay in sync
// no matter which control changed. They do not repaint the flag; colorChanged()
// does, called by the event handlers after setX.
function setPrimary(hex) {
  primaryColor = hex;
  var rgb = hexToRgb(hex);
  document.getElementById('primaryNativePicker').value = hex;
  document.getElementById('primaryHex').value = hex.toUpperCase();
  document.getElementById('primaryR').value = rgb.r;
  document.getElementById('primaryG').value = rgb.g;
  document.getElementById('primaryB').value = rgb.b;
  document.getElementById('primarySwatchBg').style.background = hex;
  syncHsvFromHex('primary', hex);
}
function setSecondary(hex) {
  secondaryColor = hex;
  var rgb = hexToRgb(hex);
  document.getElementById('secondaryNativePicker').value = hex;
  document.getElementById('secondaryHex').value = hex.toUpperCase();
  document.getElementById('secondaryR').value = rgb.r;
  document.getElementById('secondaryG').value = rgb.g;
  document.getElementById('secondaryB').value = rgb.b;
  document.getElementById('secondarySwatchBg').style.background = hex;
  syncHsvFromHex('secondary', hex);
}
function setTertiary(hex) {
  tertiaryColor = hex;
  var rgb = hexToRgb(hex);
  document.getElementById('tertiaryNativePicker').value = hex;
  document.getElementById('tertiaryHex').value = hex.toUpperCase();
  document.getElementById('tertiaryR').value = rgb.r;
  document.getElementById('tertiaryG').value = rgb.g;
  document.getElementById('tertiaryB').value = rgb.b;
  document.getElementById('tertiarySwatchBg').style.background = hex;
  syncHsvFromHex('tertiary', hex);
}

// Repaint everything that depends on the colors after a change.
function colorChanged() { renderPreview(); renderAllPatternCards(); renderAllPresets(); updatePresetActive(); }

// Native OS color pickers: apply the picked value straight through.
document.getElementById('primaryNativePicker').addEventListener('input', function() { setPrimary(this.value); colorChanged(); });
document.getElementById('secondaryNativePicker').addEventListener('input', function() { setSecondary(this.value); colorChanged(); });
document.getElementById('tertiaryNativePicker').addEventListener('input', function() { setTertiary(this.value); colorChanged(); });

// Hex text fields: accept with or without a leading #, and apply only when the
// value is a valid six-digit hex so a half-typed entry does not repaint.
document.getElementById('primaryHex').addEventListener('change', function() {
  var v = this.value.trim(); if (v[0] !== '#') v = '#' + v;
  if (/^#[0-9a-fA-F]{6}$/.test(v)) { setPrimary(v); colorChanged(); }
});
document.getElementById('secondaryHex').addEventListener('change', function() {
  var v = this.value.trim(); if (v[0] !== '#') v = '#' + v;
  if (/^#[0-9a-fA-F]{6}$/.test(v)) { setSecondary(v); colorChanged(); }
});
document.getElementById('tertiaryHex').addEventListener('change', function() {
  var v = this.value.trim(); if (v[0] !== '#') v = '#' + v;
  if (/^#[0-9a-fA-F]{6}$/.test(v)) { setTertiary(v); colorChanged(); }
});

// R/G/B number fields: read all three, clamp to 0..255, and rebuild the hex.
['primaryR','primaryG','primaryB'].forEach(function(id) {
  document.getElementById(id).addEventListener('input', function() {
    var r = clamp(+document.getElementById('primaryR').value), g = clamp(+document.getElementById('primaryG').value), b = clamp(+document.getElementById('primaryB').value);
    setPrimary(rgbToHex(r,g,b)); colorChanged();
  });
});
['secondaryR','secondaryG','secondaryB'].forEach(function(id) {
  document.getElementById(id).addEventListener('input', function() {
    var r = clamp(+document.getElementById('secondaryR').value), g = clamp(+document.getElementById('secondaryG').value), b = clamp(+document.getElementById('secondaryB').value);
    setSecondary(rgbToHex(r,g,b)); colorChanged();
  });
});
['tertiaryR','tertiaryG','tertiaryB'].forEach(function(id) {
  document.getElementById(id).addEventListener('input', function() {
    var r = clamp(+document.getElementById('tertiaryR').value), g = clamp(+document.getElementById('tertiaryG').value), b = clamp(+document.getElementById('tertiaryB').value);
    setTertiary(rgbToHex(r,g,b)); colorChanged();
  });
});

// ── HSV PICKER LOGIC ──
// Per-color HSV position, kept alongside the hex so the square and hue cursors
// have somewhere to live even when the hex loses hue (pure black/white/gray).
var hsvState = { primary: {h:0,s:0,v:0}, secondary: {h:0,s:0,v:0}, tertiary: {h:0,s:0,v:0} };

// Paint the saturation/value square for a hue: fill the hue, overlay a
// white-to-transparent gradient left to right (saturation) and a
// transparent-to-black gradient top to bottom (value). Sized in device pixels.
function renderSvCanvas(canvasId, hue) {
  var c = document.getElementById(canvasId);
  var rect = c.parentElement.getBoundingClientRect();
  var W = Math.floor(rect.width * devicePixelRatio), H = Math.floor(rect.height * devicePixelRatio);
  if (W < 1 || H < 1) return;
  c.width = W; c.height = H;
  var ctx = c.getContext('2d');
  var rgb = hsvToRgb(hue, 1, 1);
  ctx.fillStyle = 'rgb('+rgb.r+','+rgb.g+','+rgb.b+')';
  ctx.fillRect(0, 0, W, H);
  var gW = ctx.createLinearGradient(0, 0, W, 0);
  gW.addColorStop(0, 'rgba(255,255,255,1)'); gW.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gW; ctx.fillRect(0, 0, W, H);
  var gB = ctx.createLinearGradient(0, 0, 0, H);
  gB.addColorStop(0, 'rgba(0,0,0,0)'); gB.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = gB; ctx.fillRect(0, 0, W, H);
}

// Paint the vertical hue strip: a gradient through the six hue stops top to bottom.
function renderHueCanvas(canvasId) {
  var c = document.getElementById(canvasId);
  var rect = c.parentElement.getBoundingClientRect();
  var W = Math.floor(rect.width * devicePixelRatio), H = Math.floor(rect.height * devicePixelRatio);
  if (W < 1 || H < 1) return;
  c.width = W; c.height = H;
  var ctx = c.getContext('2d');
  var grad = ctx.createLinearGradient(0, 0, 0, H);
  for (var i = 0; i <= 6; i++) { var rgb = hsvToRgb(i/6, 1, 1); grad.addColorStop(Math.min(i/6, 1), 'rgb('+rgb.r+','+rgb.g+','+rgb.b+')'); }
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
}

// Position the square and hue cursors from the stored HSV: saturation across,
// inverted value down, hue down the strip.
function updateSvCursor(which) { var st = hsvState[which]; var cur = document.getElementById(which + 'SvCursor'); cur.style.left = (st.s*100)+'%'; cur.style.top = ((1-st.v)*100)+'%'; }
function updateHueCursor(which) { var st = hsvState[which]; document.getElementById(which + 'HueCursor').style.top = (st.h*100)+'%'; }

// Sync the HSV state and cursors to a hex value. When the color is (near) gray
// its hue is undefined, so the previous hue is kept to stop the cursor jumping
// to red as the user drags value or saturation toward an edge.
function syncHsvFromHex(which, hex) {
  var rgb = hexToRgb(hex), hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  if (hsv.s < 0.01 && hsvState[which].h !== undefined) hsv.h = hsvState[which].h;
  if (hsv.v < 0.01 && hsvState[which].h !== undefined) hsv.h = hsvState[which].h;
  hsvState[which] = hsv;
  renderSvCanvas(which + 'SvCanvas', hsv.h);
  updateSvCursor(which); updateHueCursor(which);
}

// Wire pointer dragging for one color picker. handleSv maps a point in the
// square to saturation/value; handleHue maps a point in the strip to hue and
// repaints the square. Both convert back to hex through setFn and repaint. Mouse
// and touch share the handlers; window-level move/up listeners keep a drag alive
// when the pointer leaves the control.
function setupHsvInteraction(which, setFn) {
  var svWrap = document.getElementById(which + 'SvWrap');
  var hueWrap = document.getElementById(which + 'HueWrap');
  var draggingSv = false, draggingHue = false;

  function handleSv(e) {
    var rect = svWrap.getBoundingClientRect();
    var x = (e.clientX !== undefined ? e.clientX : e.touches[0].clientX) - rect.left;
    var y = (e.clientY !== undefined ? e.clientY : e.touches[0].clientY) - rect.top;
    hsvState[which].s = Math.max(0, Math.min(1, x / rect.width));
    hsvState[which].v = Math.max(0, Math.min(1, 1 - y / rect.height));
    updateSvCursor(which);
    var rgb = hsvToRgb(hsvState[which].h, hsvState[which].s, hsvState[which].v);
    setFn(rgbToHex(rgb.r, rgb.g, rgb.b)); colorChanged();
  }
  function handleHue(e) {
    var rect = hueWrap.getBoundingClientRect();
    var y = (e.clientY !== undefined ? e.clientY : e.touches[0].clientY) - rect.top;
    hsvState[which].h = Math.max(0, Math.min(1, y / rect.height));
    updateHueCursor(which);
    renderSvCanvas(which + 'SvCanvas', hsvState[which].h);
    var rgb = hsvToRgb(hsvState[which].h, hsvState[which].s, hsvState[which].v);
    setFn(rgbToHex(rgb.r, rgb.g, rgb.b)); colorChanged();
  }
  svWrap.addEventListener('mousedown', function(e) { e.preventDefault(); draggingSv = true; handleSv(e); });
  hueWrap.addEventListener('mousedown', function(e) { e.preventDefault(); draggingHue = true; handleHue(e); });
  window.addEventListener('mousemove', function(e) { if (draggingSv) handleSv(e); if (draggingHue) handleHue(e); });
  window.addEventListener('mouseup', function() { draggingSv = false; draggingHue = false; });
  svWrap.addEventListener('touchstart', function(e) { e.preventDefault(); draggingSv = true; handleSv(e); }, {passive:false});
  hueWrap.addEventListener('touchstart', function(e) { e.preventDefault(); draggingHue = true; handleHue(e); }, {passive:false});
  window.addEventListener('touchmove', function(e) { if (draggingSv) handleSv(e); if (draggingHue) handleHue(e); }, {passive:false});
  window.addEventListener('touchend', function() { draggingSv = false; draggingHue = false; });
}

// ── FLAG WAVE SIMULATION ──
// A Verlet cloth: a grid of points whose motion is stored as current and
// previous position (no explicit velocity). windStrength comes from the slider,
// wavePaused freezes the step. The grid is CLOTH_W×CLOTH_H cells, so there are
// (CLOTH_W+1)×(CLOTH_H+1) points.
var waveCanvas = document.getElementById('waveCanvas');
var waveCtx = waveCanvas.getContext('2d');
var waveWrap = document.getElementById('waveWrap');
var waveW, waveH;
var wavePaused = false;
var windStrength = 0.5;

var CLOTH_W = 40, CLOTH_H = 25;
var clothPoints = [];
var clothRestLen;

// Build the point grid. Each point stores its live position (x,y), a rest anchor
// (ox,oy), its previous position (px,py) for Verlet integration, a pinned flag
// (the left column is nailed to the pole), and its u,v texture coordinate.
function initCloth() {
  clothPoints = [];
  var spacing = 8;
  clothRestLen = spacing;
  for (var y = 0; y <= CLOTH_H; y++) {
    for (var x = 0; x <= CLOTH_W; x++) {
      clothPoints.push({
        x: x * spacing + 80, y: y * spacing + 40,
        ox: x * spacing + 80, oy: y * spacing + 40,
        px: x * spacing + 80, py: y * spacing + 40,
        pinned: x === 0,
        u: x / CLOTH_W, v: y / CLOTH_H
      });
    }
  }
}

// Flatten a grid (x,y) into the clothPoints array index (row stride CLOTH_W+1).
function getClothIdx(x, y) { return y * (CLOTH_W + 1) + x; }

// Advance the cloth one step. Each free point moves by its Verlet velocity
// (current minus previous, scaled by damping) plus gravity and a time-varying
// wind push, then the previous position is stored. After integration the
// distance constraints are relaxed several times to hold neighbors near rest
// length; more iterations make the cloth stiffer. Pinned points never move.
function updateCloth(dt) {
  if (wavePaused) return;
  var gravity = 0.15;
  var damping = 0.985;
  var wind = windStrength;
  var t = performance.now() * 0.001;

  for (var i = 0; i < clothPoints.length; i++) {
    var p = clothPoints[i];
    if (p.pinned) continue;
    var vx = (p.x - p.px) * damping;
    var vy = (p.y - p.py) * damping;
    // Wind
    var wx = (Math.sin(t * 2.5 + p.v * 4 + p.u * 2) * 0.8 + 0.5) * wind * 1.8;
    var wy = Math.sin(t * 3.1 + p.u * 6) * wind * 0.3;
    p.px = p.x; p.py = p.y;
    p.x += vx + wx; p.y += vy + gravity + wy;
  }

  // Constraint solving
  for (var iter = 0; iter < 5; iter++) {
    for (var y = 0; y <= CLOTH_H; y++) {
      for (var x = 0; x <= CLOTH_W; x++) {
        var idx = getClothIdx(x, y);
        // Right neighbor
        if (x < CLOTH_W) solveConstraint(idx, getClothIdx(x+1, y));
        // Bottom neighbor
        if (y < CLOTH_H) solveConstraint(idx, getClothIdx(x, y+1));
      }
    }
  }
}

// Relax one distance constraint between two points: measure the gap, and push
// each half of the error back toward the rest length. A pinned point holds, so
// its neighbor takes the whole correction, anchoring that edge to the pole.
function solveConstraint(i1, i2) {
  var p1 = clothPoints[i1], p2 = clothPoints[i2];
  var dx = p2.x - p1.x, dy = p2.y - p1.y;
  var dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.001) return;
  var diff = (dist - clothRestLen) / dist * 0.5;
  var ox = dx * diff, oy = dy * diff;
  if (!p1.pinned) { p1.x += ox; p1.y += oy; }
  if (!p2.pinned) { p2.x -= ox; p2.y -= oy; }
}

// Draw one frame of the waving flag: a starfield backdrop, the pole, and the
// cloth mesh drawn as textured quads. It renders the current flag once to an
// offscreen canvas, then for each grid cell samples that flag pixel, shades it
// by a cheap normal approximation (how stretched the cell is horizontally), and
// fills the quad. Cached fields (_stars, _flagCanvas) are built once and reused.
function renderWave() {
  waveCtx.fillStyle = '#050810';
  waveCtx.fillRect(0, 0, waveW, waveH);

  // Draw stars
  if (!renderWave._stars) {
    renderWave._stars = [];
    for (var i = 0; i < 100; i++) renderWave._stars.push({x:Math.random(), y:Math.random(), s:0.5+Math.random()*1.5, b:0.2+Math.random()*0.5});
  }
  renderWave._stars.forEach(function(s) {
    waveCtx.fillStyle = 'rgba(200,220,255,' + s.b * 0.4 + ')';
    waveCtx.fillRect(s.x * waveW, s.y * waveH, s.s, s.s);
  });

  // Render flag texture into the cloth mesh
  // First render current flag to offscreen
  if (!renderWave._flagCanvas) { renderWave._flagCanvas = document.createElement('canvas'); }
  var fc = renderWave._flagCanvas;
  // Always render the wave texture rectangular; the mesh itself provides the
  // waving silhouette, so the selected shape clip is ignored here.
  renderFlag(fc, 400, 250, primaryColor, secondaryColor, tertiaryColor, currentPattern, 'rectangle', currentEmblem, true);

  // Scale cloth to canvas
  var scaleX = waveW / (CLOTH_W * 8 + 160);
  var scaleY = waveH / (CLOTH_H * 8 + 100);
  var scale = Math.min(scaleX, scaleY) * 0.85;

  waveCtx.save();
  waveCtx.translate(waveW * 0.12, waveH * 0.15);
  waveCtx.scale(scale, scale);

  // Draw pole
  waveCtx.strokeStyle = 'rgba(150,160,180,0.6)';
  waveCtx.lineWidth = 4 / scale;
  var poleX = clothPoints[0].x;
  waveCtx.beginPath();
  waveCtx.moveTo(poleX, clothPoints[0].y - 20);
  waveCtx.lineTo(poleX, clothPoints[getClothIdx(0, CLOTH_H)].y + 20);
  waveCtx.stroke();
  // Pole cap
  waveCtx.fillStyle = '#c0c8d0';
  waveCtx.beginPath();
  waveCtx.arc(poleX, clothPoints[0].y - 22, 4 / scale, 0, Math.PI * 2);
  waveCtx.fill();

  // Draw cloth as textured triangles
  for (var cy = 0; cy < CLOTH_H; cy++) {
    for (var cx = 0; cx < CLOTH_W; cx++) {
      var i00 = getClothIdx(cx, cy);
      var i10 = getClothIdx(cx+1, cy);
      var i01 = getClothIdx(cx, cy+1);
      var i11 = getClothIdx(cx+1, cy+1);
      var p00 = clothPoints[i00], p10 = clothPoints[i10], p01 = clothPoints[i01], p11 = clothPoints[i11];

      // Sample flag color at this grid cell
      var u = cx / CLOTH_W, v = cy / CLOTH_H;
      var px = Math.floor(u * (fc.width - 1)), py = Math.floor(v * (fc.height - 1));
      var fctx = fc.getContext('2d');
      var pixel = fctx.getImageData(px, py, 1, 1).data;

      // Simple shading based on surface normal approximation
      var nx = (p10.x - p00.x);
      var shade = 0.6 + 0.4 * Math.max(0, Math.min(1, nx / clothRestLen));

      var r = Math.round(pixel[0] * shade);
      var g = Math.round(pixel[1] * shade);
      var b = Math.round(pixel[2] * shade);

      waveCtx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
      waveCtx.beginPath();
      waveCtx.moveTo(p00.x, p00.y);
      waveCtx.lineTo(p10.x, p10.y);
      waveCtx.lineTo(p11.x, p11.y);
      waveCtx.lineTo(p01.x, p01.y);
      waveCtx.closePath();
      waveCtx.fill();
    }
  }

  waveCtx.restore();

  // Border
  waveCtx.strokeStyle = 'rgba(150,200,255,0.06)';
  waveCtx.lineWidth = 1;
  waveCtx.strokeRect(6, 6, waveW - 12, waveH - 12);
}

// Match the wave canvas backing store to its box in device pixels.
function resizeWave() {
  var rect = waveWrap.getBoundingClientRect();
  waveW = Math.floor(rect.width * devicePixelRatio);
  waveH = Math.floor(rect.height * devicePixelRatio);
  waveCanvas.width = waveW;
  waveCanvas.height = waveH;
}

// Animation loop. It clamps the frame delta (so a background tab does not lurch
// the sim), runs three smaller physics substeps per frame for stability, draws,
// and reschedules.
var waveLastTime = 0;
function waveLoop(t) {
  var dt = Math.min((t - waveLastTime) / 1000, 0.033);
  waveLastTime = t;
  for (var i = 0; i < 3; i++) updateCloth(dt / 3);
  renderWave();
  requestAnimationFrame(waveLoop);
}

// Pause button: freeze or resume the sim and update the button label and state.
function toggleWavePause() {
  wavePaused = !wavePaused;
  var btn = document.getElementById('wavePauseBtn');
  btn.classList.toggle('active', wavePaused);
  btn.textContent = wavePaused ? 'Resume' : 'Pause';
}

// Wind slider drives windStrength as a 0..1 fraction of the 0..100 range.
document.getElementById('windSlider').addEventListener('input', function() {
  windStrength = this.value / 100;
});

// ── INIT ──
// Boot: paint the hue strips, wire the three HSV pickers, seed the color state,
// build the shape/emblem/pattern/preset controls, draw the preview, then start
// the cloth simulation loop.
function init() {
  renderHueCanvas('primaryHueCanvas');
  renderHueCanvas('secondaryHueCanvas');
  renderHueCanvas('tertiaryHueCanvas');
  setupHsvInteraction('primary', setPrimary);
  setupHsvInteraction('secondary', setSecondary);
  setupHsvInteraction('tertiary', setTertiary);

  setPrimary(primaryColor);
  setSecondary(secondaryColor);
  setTertiary(tertiaryColor);

  buildShapes();
  buildEmblems();
  buildPatternGrid();
  buildPresets();
  renderPreview();
  updatePresetActive();

  resizeWave();
  initCloth();
  requestAnimationFrame(waveLoop);
}

// On resize, refit the wave canvas and repaint each picker canvas, since the
// HSV canvases are sized from their box in device pixels.
window.addEventListener('resize', function() {
  resizeWave();
  ['primary','secondary','tertiary'].forEach(function(which) {
    renderHueCanvas(which + 'HueCanvas');
    renderSvCanvas(which + 'SvCanvas', hsvState[which].h);
    updateSvCursor(which);
    updateHueCursor(which);
  });
});

// Start the app.
init();
