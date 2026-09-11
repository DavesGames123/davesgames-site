// ============================================================================
//  CRAFTING DATABASE  ·  production-chain map and build calculator
// ----------------------------------------------------------------------------
//  Classic script. It holds the game production data (resources, recipes,
//  constructables, modules) mirrored from the Rust source, then builds three
//  things from it: a tiered grid of resource cards, an SVG overlay that traces
//  a hovered item back to its raw ores, and a build calculator that expands a
//  queue of items into every recipe batch and total ore needed.
//
//  DATA  ─▶  RENDER  ─▶  INTERACT
//  ----------------------------------------------------------------------------
//      R (resources) ┐
//      recipes       ├─▶ renderEl()  ─▶ tier grid  ┐
//      tierRows      ┘                              │
//                                                   ▼
//                      hover a card ─▶ updatePositions() ─▶ drawConnections()
//                                        (bezier links + ×qty labels in SVG)
//                                                   │
//                      click a card ─▶ addToCart() ─▶ cart{}
//                                                   ▼
//                      computeBreakdown(): walk cart high tier first, divide
//                      each need into recipe batches, push inputs back down
//                      into needed{} ─▶ updateCartUI() renders the totals
//
//  RAW-ORE COST  (getRawCosts, memoized in rawM)
//  ----------------------------------------------------------------------------
//      tier 0 ore ........... cost is {self: 1}
//      anything else ........ sum of each input raw cost × (inputQty / outputQty)
//
//  SECTION MAP  (jump with grep -n "<anchor>" main.js)
//    resource data ........ "var R="                 id → name, color, tier, spawn
//    recipe data .......... "var recipes="           inputs, output, time, module
//    module metadata ...... "var moduleInfo"         color, icon, blurb per module
//    tier metadata ........ "var tierC="             color, name, blurb per tier
//    helpers .............. "function rgb"           color, recipe lookup
//    derived stats ........ "var stats="             consumed/produced tallies
//    raw ore rollup ....... "function getRawCosts"   recursive ore cost, memoized
//    tier layout .......... "var tierRows="          which ids sit in which row
//    card markup .......... "function renderEl"      one resource card
//    grid build ........... "svgEl.insertAdjacentHTML" render every tier row
//    link geometry ........ "function updatePositions"  card centers for the SVG
//    link drawing ......... "function drawConnections"  trace a hover to its ores
//    tooltip .............. "function showTip"       recipe and ore breakdown card
//    search ............... "getElementById('searchInput')"  filter cards by name
//    cart ................. "var cart="              the build queue
//    calculator ........... "function computeBreakdown"  expand queue to batches
//    cart render .......... "function updateCartUI"  draw the calculator panel
//    constructables ....... "var CONSTRUCTABLES="    orbital blueprints (Station Core)
//    modules .............. "var MODULES="           station grid modules
//    construction render .. "function renderConstruction"  build the lower cards
//    boot ................. "renderConstruction();"  initial paint and resize hook
// ============================================================================
// ═══════════════════════════════════════════════════════════════════════════
// RESOURCES — mirrors src/globals/resources.rs RESOURCE_MAP
// ═══════════════════════════════════════════════════════════════════════════
// Resource table keyed by numeric id (ids are non-contiguous and match the game
// source). Each entry: display name, abbreviation, RGB accent color, tier, and
// for raw ores a spawn rate. tier 3 components also carry a group and a layer
// (dependency depth L1→L2→L3). Object key order sets the left-to-right card
// order within a tier row.
var R={
0:{name:"Iron",abbr:"Fe",color:[180,80,60],tier:0,spawn:.25},
1:{name:"Copper",abbr:"Cu",color:[255,120,40],tier:0,spawn:.20},
5:{name:"Carbon",abbr:"C",color:[90,90,100],tier:0,spawn:.18},
2:{name:"Aluminum",abbr:"Al",color:[200,220,240],tier:0,spawn:.15},
4:{name:"Silicon",abbr:"Si",color:[255,230,100],tier:0,spawn:.12},
3:{name:"Titanium",abbr:"Ti",color:[100,140,220],tier:0,spawn:.10},
6:{name:"Gold",abbr:"Au",color:[255,220,50],tier:0,spawn:.07},
7:{name:"Platinum",abbr:"Pt",color:[220,240,255],tier:0,spawn:.05},
8:{name:"Uranium",abbr:"U",color:[100,255,100],tier:0,spawn:.03},
9:{name:"Rare Earth",abbr:"RE",color:[200,80,255],tier:0,spawn:.02},
10:{name:"Iron Ingot",abbr:"Fe+",color:[220,140,120],tier:1},
11:{name:"Copper Ingot",abbr:"Cu+",color:[255,180,100],tier:1},
15:{name:"Carbon Brick",abbr:"CB",color:[130,130,140],tier:1},
12:{name:"Aluminum Ingot",abbr:"Al+",color:[230,240,255],tier:1},
14:{name:"Silicon Wafer",abbr:"SiW",color:[200,210,255],tier:1},
13:{name:"Titanium Ingot",abbr:"Ti+",color:[150,180,255],tier:1},
16:{name:"Gold Ingot",abbr:"Au+",color:[255,240,80],tier:1},
17:{name:"Platinum Ingot",abbr:"Pt+",color:[240,250,255],tier:1},
18:{name:"Uranium Ingot",abbr:"U+",color:[150,255,150],tier:1},
19:{name:"Rare Earth Ingot",abbr:"RE+",color:[230,120,255],tier:1},
20:{name:"Steel",abbr:"STL",color:[100,140,200],tier:2},
21:{name:"Bronze",abbr:"BRZ",color:[200,140,60],tier:2},
26:{name:"Copper Wire",abbr:"CuW",color:[255,150,50],tier:2},
22:{name:"Aluminum Wire",abbr:"AlW",color:[180,220,255],tier:2},
24:{name:"Glass",abbr:"GLS",color:[140,200,255],tier:2},
25:{name:"Carbon Fiber",abbr:"CF",color:[100,110,140],tier:2},
27:{name:"Structural Steel",abbr:"SST",color:[80,120,180],tier:2},
23:{name:"Titanium Alloy",abbr:"TiA",color:[80,200,255],tier:2},
28:{name:"Reinforced Alloy",abbr:"RA",color:[100,180,255],tier:2},
29:{name:"Composite Plate",abbr:"CMP",color:[120,160,220],tier:2},
30:{name:"Circuit Board",abbr:"PCB",color:[80,200,120],tier:3,group:"Electronics",layer:1},
31:{name:"Processor",abbr:"CPU",color:[120,180,255],tier:3,group:"Electronics",layer:2},
32:{name:"Sensor Array",abbr:"SNR",color:[255,80,180],tier:3,group:"Electronics",layer:2},
33:{name:"Comm Module",abbr:"COM",color:[100,220,200],tier:3,group:"Electronics",layer:2},
34:{name:"Navigation Unit",abbr:"NAV",color:[180,140,255],tier:3,group:"Electronics",layer:3},
35:{name:"Battery Cell",abbr:"BAT",color:[255,200,50],tier:3,group:"Power",layer:1},
36:{name:"Solar Cell",abbr:"SLC",color:[60,120,255],tier:3,group:"Power",layer:2},
37:{name:"Fuel Cell",abbr:"FCL",color:[255,150,50],tier:3,group:"Power",layer:2},
38:{name:"Power Regulator",abbr:"REG",color:[255,100,150],tier:3,group:"Power",layer:2},
39:{name:"Reactor Core",abbr:"RCT",color:[100,255,100],tier:3,group:"Power",layer:3},
40:{name:"Hydraulic Act.",abbr:"HYD",color:[200,100,50],tier:3,group:"Mechanical",layer:1},
41:{name:"Thruster Asm.",abbr:"THR",color:[255,120,80],tier:3,group:"Mechanical",layer:2},
42:{name:"Heat Exchanger",abbr:"HEX",color:[220,180,140],tier:3,group:"Mechanical",layer:1},
43:{name:"Pressure Vessel",abbr:"PRS",color:[140,160,200],tier:3,group:"Mechanical",layer:1},
44:{name:"Docking Clamp",abbr:"DCK",color:[180,140,100],tier:3,group:"Mechanical",layer:1},
45:{name:"Life Support",abbr:"LSU",color:[80,220,180],tier:3,group:"Specialized",layer:2},
46:{name:"Cargo Container",abbr:"CRG",color:[140,120,100],tier:3,group:"Specialized",layer:2},
47:{name:"Shield Emitter",abbr:"SHD",color:[200,100,255],tier:3,group:"Specialized",layer:2},
48:{name:"Fabricator Unit",abbr:"FAB",color:[180,200,140],tier:3,group:"Specialized",layer:1},
49:{name:"Antenna Dish",abbr:"ANT",color:[200,220,255],tier:3,group:"Specialized",layer:1},
50:{name:"Food",abbr:"FD",color:[120,200,80],tier:4},
60:{name:"Oxidized Fuel",abbr:"OxF",color:[255,140,60],tier:5},
};
// ═══════════════════════════════════════════════════════════════════════════
// RECIPES — mirrors src/globals/resources.rs CRAFTING_RECIPES verbatim
// Format: in:[[id,count]...], out:[id,count], t:base_time, mod:'Module'
// ═══════════════════════════════════════════════════════════════════════════
var recipes=[
// T0 → T1 smelting (Foundry, 1:1)
{in:[[0,1]],out:[10,1],t:8,mod:'Foundry'},
{in:[[1,1]],out:[11,1],t:7,mod:'Foundry'},
{in:[[2,1]],out:[12,1],t:10,mod:'Foundry'},
{in:[[3,1]],out:[13,1],t:15,mod:'Foundry'},
{in:[[4,1]],out:[14,1],t:12,mod:'Foundry'},
{in:[[5,1]],out:[15,1],t:6,mod:'Foundry'},
{in:[[6,1]],out:[16,1],t:12,mod:'Foundry'},
{in:[[7,1]],out:[17,1],t:18,mod:'Foundry'},
{in:[[8,1]],out:[18,1],t:25,mod:'Foundry'},
{in:[[9,1]],out:[19,1],t:30,mod:'Foundry'},
// T2 alloys (Assembler)
{in:[[10,2],[15,1],[12,1]],out:[20,1],t:5,mod:'Assembler'},
{in:[[11,2],[10,1],[15,1]],out:[21,1],t:4,mod:'Assembler'},
{in:[[12,2],[11,1],[15,1]],out:[22,1],t:2,mod:'Assembler'},
{in:[[13,2],[12,2],[10,1]],out:[23,1],t:6,mod:'Assembler'},
{in:[[14,2],[15,1],[12,1]],out:[24,1],t:2.5,mod:'Assembler'},
{in:[[15,2],[14,1],[12,1]],out:[25,1],t:6,mod:'Assembler'},
{in:[[11,2],[10,1],[14,1]],out:[26,1],t:2,mod:'Assembler'},
{in:[[20,2],[15,1],[10,1]],out:[27,2],t:4.5,mod:'Assembler'},
{in:[[23,1],[20,1],[25,1]],out:[28,1],t:7.5,mod:'Assembler'},
{in:[[25,1],[12,2],[14,1]],out:[29,1],t:5.5,mod:'Assembler'},
// T3 components (Component Lab)
{in:[[14,2],[26,1],[24,1]],out:[30,1],t:7.5,mod:'Comp. Lab'},
{in:[[30,1],[14,2],[16,1],[26,1]],out:[31,1],t:11,mod:'Comp. Lab'},
{in:[[30,1],[49,1],[19,1],[24,1]],out:[32,1],t:12.5,mod:'Comp. Lab'},
{in:[[30,1],[49,1],[26,2],[24,1]],out:[33,1],t:9,mod:'Comp. Lab'},
{in:[[31,1],[32,1],[33,1],[16,1]],out:[34,1],t:10,mod:'Comp. Lab'},
{in:[[11,2],[15,1],[26,1],[24,1]],out:[35,1],t:6,mod:'Comp. Lab'},
{in:[[35,1],[14,2],[24,1],[22,1]],out:[36,1],t:9,mod:'Comp. Lab'},
{in:[[42,1],[17,2],[26,1],[20,1]],out:[37,1],t:14,mod:'Comp. Lab'},
{in:[[30,1],[35,1],[17,1],[26,1]],out:[38,1],t:9,mod:'Comp. Lab'},
{in:[[38,1],[37,1],[43,1],[18,2]],out:[39,1],t:20,mod:'Comp. Lab'},
{in:[[20,2],[21,1],[12,1]],out:[40,1],t:7.5,mod:'Comp. Lab'},
{in:[[40,1],[43,1],[23,1],[26,1]],out:[41,1],t:11,mod:'Comp. Lab'},
{in:[[12,2],[11,2],[20,1]],out:[42,1],t:7,mod:'Comp. Lab'},
{in:[[27,2],[28,1],[25,1]],out:[43,1],t:14,mod:'Comp. Lab'},
{in:[[20,2],[12,2],[26,1]],out:[44,1],t:6,mod:'Comp. Lab'},
{in:[[42,1],[43,1],[25,1],[24,2]],out:[45,1],t:11,mod:'Comp. Lab'},
{in:[[44,1],[40,1],[20,2],[29,1]],out:[46,1],t:7.5,mod:'Comp. Lab'},
{in:[[32,1],[43,1],[19,1],[23,1]],out:[47,1],t:15,mod:'Comp. Lab'},
{in:[[20,2],[14,2],[26,2]],out:[48,1],t:10,mod:'Comp. Lab'},
{in:[[22,2],[26,2],[24,2]],out:[49,1],t:7.5,mod:'Comp. Lab'},
// Fuel processing — verified: 75 OxF per batch, 20s base time
{in:[[15,3],[12,2],[19,1]],out:[60,75],t:20,mod:'Fuel Proc.'},
];
// Per-module presentation: the CSS color variable, glyph, and one-line blurb
// shown in a tooltip. Keyed by the mod string used in each recipe.
var moduleInfo={
  'Foundry':{color:'var(--foundry)',icon:'\u2692',desc:'Auto-detect ore, 1:1 smelting'},
  'Assembler':{color:'var(--assembler)',icon:'\u2699',desc:'Assigned recipe, ingots\u2192alloys'},
  'Comp. Lab':{color:'var(--complab)',icon:'\uD83D\uDD2C',desc:'Assigned recipe, L1\u2192L2\u2192L3'},
  'Fuel Proc.':{color:'var(--fuelproc)',icon:'\u26FD',desc:'Assigned recipe, fuel output'},
};
// Tier metadata, keyed by tier number: CSS color var, name, and blurb for the
// row headers, plus a raw hex color used where an SVG or inline style cannot
// read a CSS variable.
var tierC={0:'var(--t0)',1:'var(--t1)',2:'var(--t2)',3:'var(--t3)',4:'var(--t4)',5:'var(--t5)'};
var tierN={0:'Raw Ores',1:'Ingots',2:'Alloys & Materials',3:'Components',4:'Consumables',5:'Propellants'};
var tierD={0:'Mined from asteroids',1:'Smelted 1:1 from ore',2:'Combined ingots',3:'L1\u2192L2\u2192L3 web',4:'Citizen needs',5:'Thruster fuel'};
var tierCRaw={0:'#d08050',1:'#c8a840',2:'#6898d0',3:'#58b870',4:'#78b848',5:'#e88040'};
// Format a [r,g,b] triple as an rgba() string; alpha defaults to 1.
function rgb(c,a){return'rgba('+c[0]+','+c[1]+','+c[2]+','+(a===undefined?1:a)+')';}
// Find the recipe that produces a given resource id, or null if it is a raw ore.
function recipeFor(id){for(var i=0;i<recipes.length;i++){if(recipes[i].out[0]===id)return recipes[i];}return null;}
// Derived usage tallies per resource, built once from the recipe table: how much
// is produced, how much is consumed, and how many recipes use it. Drives the
// \u25b2 produced / \u25bc consumed badges on each card.
var stats={};Object.keys(R).forEach(function(id){stats[+id]={totalConsumed:0,totalProduced:0,usedInCount:0};});
recipes.forEach(function(rec){stats[rec.out[0]].totalProduced+=rec.out[1];rec.in.forEach(function(inp){stats[inp[0]].totalConsumed+=inp[1];stats[inp[0]].usedInCount++;});});
// Memo cache for getRawCosts, keyed by resource id.
var rawM={};
// Recursively roll an item down to its raw-ore cost, returning a map of ore id
// to fractional quantity. A raw ore costs one of itself; anything else sums each
// input cost scaled by inputQty/outputQty, so a recipe that yields several units
// divides the cost across them. Results are memoized in rawM.
function getRawCosts(id){if(rawM[id])return rawM[id];if(R[id].tier===0){rawM[id]={};rawM[id][id]=1;return rawM[id];}var rc=recipeFor(id);if(!rc){rawM[id]={};return{};}var oq=rc.out[1],costs={};rc.in.forEach(function(inp){var sub=getRawCosts(inp[0]);Object.keys(sub).forEach(function(rid){costs[rid]=(costs[rid]||0)+sub[rid]*(inp[1]/oq);});});rawM[id]=costs;return costs;}
// Sum a raw-cost map into a single total ore count for one unit of the item.
function totalOre(id){var c=getRawCosts(id),t=0;Object.values(c).forEach(function(v){t+=v;});return t;}
// Fill the hero counters from the data (resource and recipe totals).
// Hero stats
document.getElementById('stat-res').textContent=Object.keys(R).length;
document.getElementById('stat-rec').textContent=recipes.length;
// Station Core actual recipe: 4 Steel + 3 Glass + 2 Copper Wire + 2 Structural Steel + 1 Carbon Fiber
var scOre=Math.round([[20,4],[24,3],[26,2],[27,2],[25,1]].reduce(function(s,p){return s+totalOre(p[0])*p[1];},0));
document.getElementById('stat-sc').textContent='~'+scOre;
// ── RENDER TIERS ──
// Layout config: one entry per grid row, listing the resource ids in display
// order. The tier 3 row is split into named subgroups; the final row (tier:45,
// a sentinel, not a real tier) collects the tier 4/5 outputs into one band.
var tierRows=[{tier:0,ids:[0,1,5,2,4,3,6,7,8,9]},{tier:1,ids:[10,11,15,12,14,13,16,17,18,19]},{tier:2,ids:[20,21,26,22,24,25,27,23,28,29]},{tier:3,ids:[30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49],subgroups:{0:{label:"Electronics (L1\u2192L2\u2192L3)",ids:[30,31,32,33,34]},1:{label:"Power Systems (L1\u2192L2\u2192L3)",ids:[35,36,37,38,39]},2:{label:"Mechanical (L1\u2192L2)",ids:[40,41,42,43,44]},3:{label:"Specialized (L1\u2192L2)",ids:[45,46,47,48,49]}}},{tier:45,ids:[50,60],label:"Outputs"}];
// Cached element references: the grid container, the SVG overlay for links, and
// the floating tooltip.
var tiersEl=document.getElementById('tiers'),svgEl=document.getElementById('svgLayer'),tipEl=document.getElementById('tip');
// Build the HTML for one resource card: id, spawn or layer badge, abbreviation,
// name, and the consumed/produced stat badges. The card wires its own hover and
// click handlers by id.
function renderEl(id){var r=R[id];if(!r)return'';var c=r.color,s=stats[id];var sp=r.spawn?'<span class="el-spawn" style="color:var(--t0)">'+(r.spawn*100).toFixed(0)+'%</span>':'';var ly=r.layer?'<span class="el-spawn" style="color:var(--t3)">L'+r.layer+'</span>':'';var cn=s.totalConsumed>0?'<span class="consumed">\u25bc'+s.totalConsumed+'</span>':'';var pr=s.totalProduced>0?'<span class="produced">\u25b2'+s.totalProduced+'</span>':'';return'<div class="el" id="el'+id+'" data-id="'+id+'" data-name="'+r.name.toLowerCase()+'" onmouseenter="elEnter('+id+')" onmouseleave="elLeave('+id+')" onclick="elClick('+id+')" style="--el-c:'+rgb(c)+'"><div class="el-top"><span class="el-id">'+id+'</span>'+(sp||ly)+'</div><div class="el-mid"><span class="el-abbr" style="color:'+rgb(c)+'">'+r.abbr+'</span></div><div class="el-bot"><span class="el-name">'+r.name+'</span><span class="el-stats">'+cn+pr+'</span></div></div>';}
// Build the whole tier grid once at load. It walks tierRows, emits a header and
// card grid per row (expanding subgroups where present), inserts a divider arrow
// between rows, and drops the finished HTML right after the SVG overlay so the
// links draw on top of the cards.
(function(){var html='';tierRows.forEach(function(row,ri){var t=row.tier,isC=t===45;var tc=isC?'var(--t4)':tierC[t];var tn=isC?'Outputs':tierN[t];var td=isC?'Food & fuel':tierD[t];html+='<div class="tier-row"><div class="tier-head"><span class="tier-badge" style="color:'+tc+';border:1px solid;opacity:0.85">'+(isC?'T4/5':'T'+t)+'</span><span class="tier-name">'+tn+'</span><span class="tier-desc">'+td+'</span></div><div class="tier-grid">';if(row.subgroups){Object.keys(row.subgroups).forEach(function(k){var sg=row.subgroups[k];html+='<div class="subgroup-label" style="color:'+tc+'">'+sg.label+'</div>';sg.ids.forEach(function(id){html+=renderEl(id);});});}else row.ids.forEach(function(id){html+=renderEl(id);});html+='</div></div>';if(ri<tierRows.length-1)html+='<div class="tier-divider"><div class="td-line"></div><span class="td-arrow">\u25bc \u25bc \u25bc</span><div class="td-line"></div></div>';});svgEl.insertAdjacentHTML('afterend',html);})();
// Card geometry cache: for each card, its horizontal center and top/bottom edge
// measured relative to the grid, so the SVG can anchor links to card edges.
var elPos={};
// Recompute elPos and resize the SVG overlay to cover the full scroll area.
// Called on hover and resize because card positions shift with layout reflow.
function updatePositions(){var pr=tiersEl.getBoundingClientRect();Object.keys(R).forEach(function(id){var el=document.getElementById('el'+id);if(!el)return;var r=el.getBoundingClientRect();elPos[id]={cx:r.left-pr.left+r.width/2,top:r.top-pr.top,bot:r.top-pr.top+r.height};});svgEl.style.width=tiersEl.scrollWidth+'px';svgEl.style.height=tiersEl.scrollHeight+'px';svgEl.setAttribute('viewBox','0 0 '+tiersEl.scrollWidth+' '+tiersEl.scrollHeight);}
// Draw the dependency links for a hovered resource. It walks the recipe tree
// upward from hId (up() recurses through every input, collecting the related set
// and each recipe touched), dims every unrelated card, then draws one bezier
// per input→output edge in the SVG. Direct edges of the hovered item render
// thicker and carry a ×qty label; deeper edges render faint. The control point
// (cp) bends each curve by 40% of its vertical span so links read as flowing
// downward. Passing null clears the overlay.
function drawConnections(hId){svgEl.innerHTML='';if(hId===null)return;var related=new Set([hId]),recs=[];function up(id,vis){if(!vis)vis=new Set();if(vis.has(id))return;vis.add(id);related.add(id);recipes.filter(function(r){return r.out[0]===id;}).forEach(function(rec){recs.push({rec:rec,direct:id===hId});rec.in.forEach(function(inp){related.add(inp[0]);up(inp[0],vis);});});}up(hId);document.querySelectorAll('.el').forEach(function(el){var id=+el.dataset.id;el.classList.toggle('dim-card',!related.has(id));el.classList.toggle('highlight',id===hId);});var seen=new Set();recs.forEach(function(item){var rec=item.rec,direct=item.direct;rec.in.forEach(function(inp){var inId=inp[0],qty=inp[1];var k=inId+'->'+rec.out[0];if(seen.has(k))return;seen.add(k);var f=elPos[inId],t=elPos[rec.out[0]];if(!f||!t)return;var x1=f.cx,y1=f.bot,x2=t.cx,y2=t.top,dy=Math.abs(y2-y1),cp=Math.max(dy*.4,30);var iR=R[inId];var p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d','M'+x1+','+y1+' C'+x1+','+(y1+cp)+' '+x2+','+(y2-cp)+' '+x2+','+y2);p.setAttribute('fill','none');p.setAttribute('stroke',rgb(iR.color,direct?.7:.22));p.setAttribute('stroke-width',direct?2.8:1.2);svgEl.appendChild(p);if(direct&&qty>0){var tx=document.createElementNS('http://www.w3.org/2000/svg','text');tx.setAttribute('x',(x1+x2)/2+7);tx.setAttribute('y',(y1+y2)/2);tx.setAttribute('font-family','JetBrains Mono,monospace');tx.setAttribute('font-size','13');tx.setAttribute('font-weight','700');tx.setAttribute('fill',rgb(iR.color,.85));tx.textContent='\u00d7'+qty;svgEl.appendChild(tx);}});});}
// Hover and tooltip state. isMobile switches the interaction model: on touch a
// tap shows the tooltip, on desktop hover shows it and a click adds to the cart.
// mX/mY track the pointer for tooltip placement; activeTipId is the tapped card.
var hoverTimeout=null,mX=0,mY=0,isMobile=('ontouchstart' in window)||(navigator.maxTouchPoints>0);var activeTipId=null;
// Follow the pointer, repositioning the tooltip while it is shown (desktop only).
document.addEventListener('mousemove',function(e){mX=e.clientX;mY=e.clientY;if(!isMobile&&tipEl.classList.contains('show'))posTip();});
// Place the tooltip near the pointer, flipping and clamping so it stays on screen.
function posTip(){if(isMobile)return;var pw=420,ph=tipEl.offsetHeight||180,vw=window.innerWidth,vh=window.innerHeight;var x=mX+16,y=mY+12;if(x+pw>vw-8)x=mX-pw-12;if(y+ph>vh-8)y=vh-ph-8;if(y<8)y=8;tipEl.style.left=x+'px';tipEl.style.top=y+'px';}
// Desktop hover in: draw the links and show the tooltip for this card.
function elEnter(id){if(isMobile)return;clearTimeout(hoverTimeout);updatePositions();drawConnections(id);showTip(id);}
// Desktop hover out: clear links and tooltip after a short grace delay so moving
// the pointer between adjacent cards does not flicker the overlay.
function elLeave(id){if(isMobile)return;hoverTimeout=setTimeout(function(){svgEl.innerHTML='';document.querySelectorAll('.el').forEach(function(el){el.classList.remove('dim-card','highlight');});tipEl.classList.remove('show');activeTipId=null;},80);}
// Card click. On touch it toggles the tooltip (and closes the calculator so the
// two overlays do not fight); on desktop it adds the item to the build queue.
function elClick(id){if(isMobile){if(activeTipId===id){closeMobileTip();return;}var cp=document.getElementById('calcPanel');if(cp.classList.contains('open')){cp.classList.remove('open');document.getElementById('calcToggle').classList.remove('open');}updatePositions();drawConnections(id);showTip(id);activeTipId=id;}else{addToCart(id);}}
// Dismiss the touch tooltip and clear the link overlay and card highlights.
function closeMobileTip(){tipEl.classList.remove('show');svgEl.innerHTML='';document.querySelectorAll('.el').forEach(function(el){el.classList.remove('dim-card','highlight');});activeTipId=null;}
// Tooltip button on touch: add the shown item to the queue, then dismiss.
function queueFromTip(){if(activeTipId!==null){addToCart(activeTipId);closeMobileTip();}}
// Build and show the tooltip for a resource: name and tier line, its recipe
// (module, ingredients, yield, time) or its mine source, and the rolled-up raw
// ore cost per unit. Ends with the add-to-queue affordances.
function showTip(id){
  var r=R[id],tc=tierC[r.tier];
  var h='<div class="tip-name" style="color:'+rgb(r.color)+'">'+r.name+' <span style="color:var(--text-faint);font-weight:400;font-size:0.78rem">['+r.abbr+']</span></div>';
  h+='<div class="tip-tier" style="color:'+tc+'">Tier '+r.tier+(r.layer?' \u00b7 Layer '+r.layer:'')+' \u00b7 '+(tierN[r.tier]||'Output')+'</div>';
  var rec=recipeFor(id);
  if(rec){var mi=moduleInfo[rec.mod];if(mi){h+='<div class="tip-module"><span class="tip-module-icon">'+mi.icon+'</span><span class="tip-module-name" style="color:'+mi.color+'">'+rec.mod+'</span><span class="tip-module-desc">'+mi.desc+'</span></div>';}
    h+='<div class="tip-section" style="margin-top:8px"><h4>Ingredients</h4>';
    rec.in.forEach(function(inp){var ir=R[inp[0]];h+='<div class="tip-row"><span class="qty" style="color:'+rgb(ir.color)+'">'+inp[1]+'\u00d7</span><span style="color:'+rgb(ir.color)+'">'+ir.name+'</span><span class="tier-tag">T'+ir.tier+(ir.layer?'/L'+ir.layer:'')+'</span></div>';});
    h+='<div class="tip-row" style="color:var(--text-faint);font-size:0.72rem;margin-top:5px;font-weight:600">\u2192 produces '+rec.out[1]+'\u00d7 &ensp;\u00b7&ensp; \u23f1 '+rec.t+'s</div></div>';
  } else if(r.spawn){h+='<div class="tip-section"><h4>Source</h4><div class="tip-row">\u26cf Mined from asteroids, '+(r.spawn*100).toFixed(0)+'% spawn rate</div></div>';}
  var raw=getRawCosts(id);var re=Object.keys(raw).filter(function(k){return raw[k]>0;});
  if(re.length>0){re.sort(function(a,b){return raw[b]-raw[a];});var tOre=0;re.forEach(function(k){tOre+=raw[k];});var tOreDisp=tOre<1?tOre.toFixed(2):Math.round(tOre);h+='<div class="tip-section tip-divider"><h4>Raw Ores (per 1\u00d7) \u00b7 '+tOreDisp+' total</h4>';re.forEach(function(rid){var rr=R[+rid],qty=raw[rid],qs=qty<1?qty.toFixed(2):(Number.isInteger(qty)?qty:qty.toFixed(1));h+='<div class="tip-row"><span class="qty" style="color:'+rgb(rr.color)+'">'+qs+'\u00d7</span><span style="color:'+rgb(rr.color)+'">'+rr.name+'</span></div>';});h+='</div>';}
  if(!isMobile){h+='<div style="margin-top:8px;font-size:0.7rem;color:var(--text-faint);font-weight:500;letter-spacing:0.04em">Click to add to build queue</div>';}
  h+='<button class="tip-close-btn" onclick="closeMobileTip()">\u2715</button>';
  h+='<button class="tip-add-btn" onclick="queueFromTip()">+ Add to Build Queue</button>';
  tipEl.innerHTML=h;tipEl.classList.add('show');posTip();
}
// Live search: hide any card whose lowercased name does not contain the query.
document.getElementById('searchInput').addEventListener('input',function(){var q=this.value.toLowerCase().trim();document.querySelectorAll('.el').forEach(function(el){el.style.display=(q&&el.dataset.name.indexOf(q)===-1)?'none':'';});});
// The build queue: resource id → count. Drives the calculator panel.
var cart={};
// Add one unit of an item, refresh the panel and card markers, and open the
// calculator if it is closed.
function addToCart(id){if(!cart[id])cart[id]=0;cart[id]++;updateCartUI();updateCardMarkers();if(!document.getElementById('calcPanel').classList.contains('open'))toggleCalc();}
// Remove an item from the queue entirely.
function removeFromCart(id){delete cart[id];updateCartUI();updateCardMarkers();}
// Set an explicit quantity; a value below one removes the item.
function setCartQty(id,q){if(q<1){removeFromCart(id);return;}cart[id]=q;updateCartUI();}
// Toggle the in-cart outline on every card to match the current queue.
function updateCardMarkers(){document.querySelectorAll('.el').forEach(function(el){el.classList.toggle('in-cart',!!cart[+el.dataset.id]);});}
// Open or close the calculator panel; on touch, closing the tooltip first.
function toggleCalc(){var cp=document.getElementById('calcPanel');var opening=!cp.classList.contains('open');if(opening&&isMobile&&activeTipId!==null)closeMobileTip();cp.classList.toggle('open');document.getElementById('calcToggle').classList.toggle('open');}
// Empty the queue.
function clearCart(){cart={};updateCartUI();updateCardMarkers();}
// Expand the queue into everything needed to build it. It seeds needed{} from
// the cart, then walks all ids from highest tier to lowest so each item is fully
// demanded before it is itself broken down. For each craftable item it computes
// the batch count (ceil of need over yield) and adds each recipe input, scaled
// by batches, back into needed{}. Returns needed{} plus per-item batch info.
// High-tier-first ordering is what lets one pass resolve the whole tree.
function computeBreakdown(){var needed={};Object.keys(cart).forEach(function(id){needed[+id]=(needed[+id]||0)+cart[+id];});var allIds=Object.keys(R).map(Number);allIds.sort(function(a,b){return(R[b].tier-R[a].tier)||b-a;});var batchInfo={};allIds.forEach(function(id){if(!needed[id]||needed[id]<=0)return;var rec=recipeFor(id);if(!rec)return;var batches=Math.ceil(needed[id]/rec.out[1]);batchInfo[id]={batches:batches,time:batches*rec.t,perBatch:rec.out[1],mod:rec.mod};rec.in.forEach(function(inp){needed[inp[0]]=(needed[inp[0]]||0)+inp[1]*batches;});});return{needed:needed,batchInfo:batchInfo};}
// Render the calculator panel from the current queue: the list of items being
// built with quantity steppers, then the total materials grouped by tier with
// module and batch time per line, and the total craft time and raw ore footer.
function updateCartUI(){var keys=Object.keys(cart);var count=0;keys.forEach(function(k){count+=cart[k];});document.getElementById('calcCount').textContent=keys.length===0?'Empty. Click any card to add.':count+' item'+(count!==1?'s':'')+' across '+keys.length+' type'+(keys.length!==1?'s':'');var inner=document.getElementById('calcInner');if(keys.length===0){inner.innerHTML='<div class="calc-empty">Click any element in the table above to add it to your build queue.</div>';document.getElementById('calcHint').textContent='';return;}var bd=computeBreakdown(),needed=bd.needed,batchInfo=bd.batchInfo;var h='<div class="calc-header"><span class="calc-title">\u2692 Build Queue</span><div class="calc-actions"><button class="calc-btn danger" onclick="clearCart()">Clear All</button></div></div>';h+='<div class="calc-columns"><div class="calc-col" style="max-width:320px"><div class="calc-col-title">Building</div>';keys.forEach(function(sid){var id=+sid,r=R[id],q=cart[id];h+='<div class="build-item"><span class="bi-color" style="background:'+rgb(r.color)+'"></span><span class="bi-name">'+r.name+'</span><div class="bi-controls"><button class="bi-btn" onclick="setCartQty('+id+','+(q-1)+')">\u2212</button><span class="bi-qty">'+q+'</span><button class="bi-btn" onclick="setCartQty('+id+','+(q+1)+')">+</button></div><button class="bi-rm" onclick="removeFromCart('+id+')">\u2715</button></div>';});h+='</div><div class="calc-col"><div class="calc-col-title">Total Materials Required</div>';var totalTime=0;[3,2,1,0,5,4].forEach(function(t){var items=[];Object.keys(needed).forEach(function(sid){var id=+sid;if(R[id].tier===t&&needed[id]>0)items.push({id:id,qty:needed[id],bi:batchInfo[id]||null});});if(!items.length)return;items.sort(function(a,b){return b.qty-a.qty;});h+='<div class="req-tier"><div class="req-tier-head" style="color:'+tierCRaw[t]+'">'+(tierN[t]||'Output')+' (T'+t+')</div>';items.forEach(function(item){var r=R[item.id],bs='';if(item.bi){var mi=moduleInfo[item.bi.mod];var mc=mi?'color:'+mi.color+';':'';bs='<span style="'+mc+'font-weight:700">'+item.bi.mod+'</span> &middot; '+item.bi.batches+'\u00d7 \u23f1'+item.bi.time.toFixed(1)+'s';totalTime+=item.bi.time;}else if(r.tier===0){bs=item.qty+' ore chunks';}h+='<div class="req-item"><span class="req-dot" style="background:'+rgb(r.color)+'"></span><span class="req-qty" style="color:'+rgb(r.color)+'">'+item.qty+'\u00d7</span><span class="req-name">'+r.name+'</span><span class="req-batches">'+bs+'</span></div>';});h+='</div>';});h+='<div class="calc-totals"><div class="ct-row"><span class="ct-label">Total Craft Time</span><span class="ct-val">'+totalTime.toFixed(1)+'s</span></div>';var oreCount=0;Object.keys(needed).forEach(function(sid){if(R[+sid].tier===0&&needed[+sid]>0)oreCount+=needed[+sid];});h+='<div class="ct-row"><span class="ct-label">Total Raw Ore</span><span class="ct-val">'+oreCount+' chunks</span></div></div></div></div>';inner.innerHTML=h;document.getElementById('calcHint').textContent=totalTime.toFixed(0)+'s \u00b7 '+oreCount+' ore';}
// ═══════════════════════════════════════════════════════════════════════════
// CONSTRUCTABLES — only Station Core exists in src/globals/construction.rs
// ═══════════════════════════════════════════════════════════════════════════
var CONSTRUCTABLES=[
  {id:1,name:"Station Core",symbol:"\u25CE",desc:"Foundation for an orbital station. Handles logistics, docking, and crew housing. Placed as a blueprint; constructor bots haul resources to it.",color:[120,180,220],recipe:[[20,4],[24,3],[26,2],[27,2],[25,1]],featured:true},
];
// ═══════════════════════════════════════════════════════════════════════════
// MODULES — mirrors src/globals/construction.rs MODULE_RECIPES
// Grouped by function for player scanning. StructureCore (auto-built) omitted.
// ═══════════════════════════════════════════════════════════════════════════
var MODULES=[
  // Structural
  {group:"Structural",name:"Structure (Orange)",recipe:[[10,3]]},
  {group:"Structural",name:"Structure (White)",recipe:[[12,3]]},
  // Habitation
  {group:"Habitation",name:"Crew Quarters",recipe:[[20,2],[24,3],[12,1]]},
  {group:"Habitation",name:"Greenhouse",recipe:[[24,5],[20,1],[12,2]]},
  {group:"Habitation",name:"Medical",recipe:[[20,2],[24,3],[30,1],[45,1]]},
  {group:"Habitation",name:"Recreation",recipe:[[20,2],[24,2],[12,1]]},
  // Production
  {group:"Production",name:"Foundry",recipe:[[10,2],[12,1]],modColor:'var(--foundry)'},
  {group:"Production",name:"Assembler",recipe:[[10,4],[11,3],[13,2]],modColor:'var(--assembler)'},
  {group:"Production",name:"Component Lab",recipe:[[10,6],[12,3],[20,3],[13,2]],modColor:'var(--complab)'},
  {group:"Production",name:"Fuel Processor",recipe:[[10,4],[15,3],[20,2],[11,2]],modColor:'var(--fuelproc)'},
  // Logistics & Defense
  {group:"Logistics & Defense",name:"Docking",recipe:[[10,3],[11,2]]},
  {group:"Logistics & Defense",name:"Hopper",recipe:[[20,1],[26,1]]},
  {group:"Logistics & Defense",name:"Thruster",recipe:[[27,2],[23,2],[41,2],[37,1]]},
  {group:"Logistics & Defense",name:"Shield",recipe:[[23,2],[47,2],[30,2],[26,1]]},
];
// Hero stat: module count (excludes free StructureCore)
document.getElementById('stat-mod').textContent=MODULES.length;
// Build the lower section: the orbital constructables (only Station Core) and
// the station modules grouped by function. Each card shows its recipe and total
// ore, and clicking one adds its whole recipe to the build queue.
function renderConstruction(){
  var wrap=document.getElementById('constrWrap');var h='';
  // Constructables (only Station Core)
  h+='<div class="constr-section"><div class="constr-head"><span class="constr-badge" style="color:var(--yellow);border-color:var(--yellow-dim)">Orbital</span><span class="constr-title">Orbital Constructables</span><span class="constr-desc">Blueprint placed in orbit, built by bots</span></div><div class="constr-grid">';
  CONSTRUCTABLES.forEach(function(c){var oreT=Math.round(c.recipe.reduce(function(s,p){return s+totalOre(p[0])*p[1];},0));var cls=c.featured?'constr-card featured':'constr-card';h+='<div class="'+cls+'" onclick="addConstrToCart('+JSON.stringify(c.recipe)+')" style="--el-c:'+rgb(c.color)+'"><div style="position:absolute;top:0;left:0;width:100%;height:2px;background:'+rgb(c.color)+';opacity:0.5"></div><div class="cc-top"><span class="cc-symbol">'+c.symbol+'</span><span class="cc-name" style="color:'+rgb(c.color)+'">'+c.name+'</span></div><div class="cc-desc">'+c.desc+'</div><div class="cc-recipe">';c.recipe.forEach(function(p){var r=R[p[0]];h+='<div class="cc-row"><span class="cc-qty" style="color:'+rgb(r.color)+'">'+p[1]+'\u00d7</span><span class="cc-rname">'+r.name+'</span></div>';});h+='</div><div class="cc-ore">\u26cf '+oreT+' total ore</div></div>';});
  h+='</div></div>';
  // Modules grouped
  h+='<div class="constr-section"><div class="constr-head"><span class="constr-badge" style="color:var(--blue);border-color:var(--blue-dim)">Modules</span><span class="constr-title">Station Modules</span><span class="constr-desc">Grid-based construction on stations</span></div><div class="constr-grid">';
  var groups={};MODULES.forEach(function(m){if(!groups[m.group])groups[m.group]=[];groups[m.group].push(m);});
  Object.keys(groups).forEach(function(g){h+='<div class="constr-subgroup">'+g+'</div>';groups[g].forEach(function(m){if(!m.recipe.length)return;var mc=m.modColor||'rgba(150,200,255,0.7)';var oreT=Math.round(m.recipe.reduce(function(s,p){return s+totalOre(p[0])*p[1];},0));h+='<div class="constr-card" onclick="addConstrToCart('+JSON.stringify(m.recipe)+')" style="--el-c:'+mc+'"><div style="position:absolute;top:0;left:0;width:100%;height:2px;background:'+mc+';opacity:0.5"></div><div class="cc-top"><span class="cc-name" style="color:'+mc+'">'+m.name+'</span></div><div class="cc-recipe">';m.recipe.forEach(function(p){var r=R[p[0]];h+='<div class="cc-row"><span class="cc-qty" style="color:'+rgb(r.color)+'">'+p[1]+'\u00d7</span><span class="cc-rname">'+r.name+'</span></div>';});h+='</div><div class="cc-ore">\u26cf '+oreT+' ore</div></div>';});});
  h+='</div></div>';
  wrap.innerHTML=h;
}
// Add every line of a constructable or module recipe to the queue at once.
function addConstrToCart(recipe){recipe.forEach(function(p){if(!cart[p[0]])cart[p[0]]=0;cart[p[0]]+=p[1];});updateCartUI();updateCardMarkers();if(!document.getElementById('calcPanel').classList.contains('open'))toggleCalc();}
// Boot: paint the construction cards and the empty calculator, keep link
// geometry synced on resize, and measure once after layout settles (the 60ms
// delay lets fonts and the grid finish laying out before positions are cached).
renderConstruction();updateCartUI();window.addEventListener('resize',updatePositions);setTimeout(updatePositions,60);
