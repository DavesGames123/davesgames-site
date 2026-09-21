// ============================================================================
//  MATERIAL LAB  ·  PBR material generator and real-time WebGL preview
// ----------------------------------------------------------------------------
//  A classic (non-module) script. It uploads a source image to a Python server
//  that returns PBR maps (albedo, mask, depth, normals, roughness, metallic,
//  AO) as base64 PNGs, then previews them through a WebGL PBR shader that lives
//  in <script type="x-shader"> blocks in index.html. The user relights the
//  result with a point light (a draggable sphere widget) and/or an HDRI, and
//  can hand-edit the depth map. The shaders are in the page, not .glsl files.
//
//  DATA FLOW
//  ---------
//      image ─▶ apiPost(/segment|/depth|/normals|/pbr) ─▶ base64 PNG maps
//                                    │
//                                    ▼
//        setMap(key,img) ─┬─ uploadTex()  → WebGL texture unit
//                         ├─ thumbnail strip
//                         └─ schedRender()
//                                    ▼
//        render()  binds maps 0..5 + env 6, sets uniforms, draws one quad
//                                    ▼
//                              #gl-canvas
//
//  LIGHTING INPUTS
//      point light  ← light sphere widget (azimuth/elevation) + sliders
//      IBL          ← HDRI (.hdr parsed here) or LDR env image
//      lightMode    0 point · 1 IBL · 2 both
//
//  SECTION MAP  (jump with grep -n "<anchor>" main.js)
//  ----------------------------------------------------------------------------
//      state ................ "MAP_DEFS"           the 7 PBR map slots + S
//      thumbnail tabs ....... "Build map thumbnail"  build the map strip
//      tab switching ........ "function showRender" render vs map inspect
//      download ............. "function downloadMap"  blob download (iframe safe)
//      set map .............. "function setMap"     store + upload + thumbnail
//      file upload .......... "File upload"         drag/drop and picker
//      api calls ............ "function apiPost"    POST to the Python server
//      hdri ................. "function loadHDR"    Radiance .hdr parser
//      depth editor ......... "function openDepthEditor"  paint the depth map
//      webgl ................ "function initGL"     program, quad, textures
//      render ............... "function render"     bind maps, set uniforms, draw
//      light sphere ......... "Light Sphere Widget" azimuth/elevation picker
//      boot ................. "Boot"                init GL + server health check
// ============================================================================
/* ═══ State ═══ */
// The seven PBR map slots: storage key, panel label, and accent colour.
var MAP_DEFS = [
  { key: 'albedo',    label: 'Albedo',    color: '#c0cfe0' },
  { key: 'mask',      label: 'Mask',      color: '#64c864' },
  { key: 'depth',     label: 'Depth',     color: '#96c8ff' },
  { key: 'normals',   label: 'Normals',   color: '#b896ff' },
  { key: 'roughness', label: 'Roughness', color: '#ffc832' },
  { key: 'metallic',  label: 'Metallic',  color: '#ff7b00' },
  { key: 'ao',        label: 'AO',        color: '#00d4b4' }
];

// Global app state: the source file and image, decoded maps, GPU textures,
// the busy flag that serializes API calls, env-map state, and the active tab.
var S = {
  file: null, img: null, maps: {}, tex: {},
  busy: false, envTex: null, hasEnv: false, lightMode: 0,
  activeTab: 'render'
};

// The processing server base URL, trailing slashes trimmed.
function API() {
  return document.getElementById('server-url').value.replace(/\/+$/, '');
}


/* ═══ Build map thumbnail tabs ═══ */
// Build one thumbnail tab per map: a preview canvas, a label, and a download
// button. Clicking a tab inspects that map; the button downloads its PNG.
(function() {
  var strip = document.getElementById('map-strip');
  MAP_DEFS.forEach(function(d) {
    var tab = document.createElement('div');
    tab.className = 'map-thumb empty';
    tab.id = 'tab-' + d.key;
    tab.onclick = function() { showMap(d.key); };
    tab.innerHTML =
      '<canvas width="96" height="72" id="thumb-' + d.key + '"></canvas>' +
      '<div class="map-thumb-footer">' +
        '<span class="map-thumb-label" style="color:' + d.color + '">' + d.label + '</span>' +
        '<button class="dl-btn disabled" id="dl-' + d.key + '" onclick="event.stopPropagation();downloadMap(\'' + d.key + '\')">&#8681;</button>' +
      '</div>';
    strip.appendChild(tab);
  });
})();


/* ═══ Tab switching ═══ */
// Switch to the 3D render view: hide the inspector, highlight the render tab.
function showRender() {
  S.activeTab = 'render';
  document.getElementById('map-inspect').classList.add('hidden');
  document.querySelectorAll('.map-thumb').forEach(function(t) {
    t.classList.toggle('active', t.id === 'tab-render');
  });
}

// Inspect one map full-resolution in the overlay canvas and highlight its tab.
function showMap(key) {
  if (!S.maps[key]) return;
  S.activeTab = key;
  // Draw map into inspect canvas at native resolution
  var inspect = document.getElementById('map-inspect');
  var canvas  = document.getElementById('inspect-canvas');
  var img     = S.maps[key];
  canvas.width  = img.width;
  canvas.height = img.height;
  // CSS constrains display size, canvas holds full-res pixels
  canvas.style.aspectRatio = img.width + ' / ' + img.height;
  canvas.getContext('2d').drawImage(img, 0, 0);
  inspect.classList.remove('hidden');
  // Update tab highlights
  document.querySelectorAll('.map-thumb').forEach(function(t) {
    t.classList.toggle('active', t.id === 'tab-' + key);
  });
}


// Download a map as a PNG. Draws it to a blob and clicks a temporary link;
// when embedded in an iframe it appends the link to the parent document so the
// browser allows the download.
// ── NEW (works in iframes via blob URL + parent document) ────
function downloadMap(key) {
  if (!S.maps[key]) return;
  var canvas = document.createElement('canvas');
  var img = S.maps[key];
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext('2d').drawImage(img, 0, 0);
 
  canvas.toBlob(function(blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = key + '.png';
    a.style.display = 'none';
    // Use parent document if inside an iframe for reliable downloads
    var doc = document;
    try {
      if (window.parent && window.parent !== window && window.parent.document) {
        doc = window.parent.document;
      }
    } catch(e) { /* cross-origin, stay in current doc */ }
    doc.body.appendChild(a);
    a.click();
    doc.body.removeChild(a);
    setTimeout(function() { URL.revokeObjectURL(url); }, 5000);
  }, 'image/png');
}


/* ═══ Set map data ═══ */
// Store a decoded map and wire up everything that depends on it: thumbnail,
// download button, GPU texture, a re-render, and any map-specific UI (the
// upload prompt hides on albedo; depth tools enable on depth).
function setMap(key, img) {
  S.maps[key] = img;

  // Update thumbnail (letterboxed, preserves aspect ratio)
  var tc = document.getElementById('thumb-' + key);
  if (tc) {
    var tw = 96, th = 72;
    tc.width = tw; tc.height = th;
    var ctx = tc.getContext('2d');
    ctx.clearRect(0, 0, tw, th);
    var scale = Math.min(tw / img.width, th / img.height);
    var dw = img.width * scale;
    var dh = img.height * scale;
    ctx.drawImage(img, (tw - dw) / 2, (th - dh) / 2, dw, dh);
  }

  // Enable download button
  var dl = document.getElementById('dl-' + key);
  if (dl) dl.classList.remove('disabled');

  // Remove empty state
  document.getElementById('tab-' + key).classList.remove('empty');

  // Upload to WebGL
  uploadTex(key, img);
  schedRender();

  // Update render thumbnail
  updateRenderThumb();

  // Hide upload prompt
  if (key === 'albedo') {
    document.getElementById('upload-prompt').classList.add('hidden');
  }

  // Enable depth tools
  if (key === 'depth') {
    document.getElementById('btn-editdepth').disabled = false;
    document.getElementById('btn-nfd').disabled = false;
  }

  // If currently inspecting this map, refresh it
  if (S.activeTab === key) showMap(key);
}

// Snapshot the live WebGL canvas into the "Render" thumbnail (letterboxed).
function updateRenderThumb() {
  // Small delay to let WebGL render, then snapshot
  setTimeout(function() {
    var src = document.getElementById('gl-canvas');
    var dst = document.getElementById('thumb-render');
    if (src && dst) {
      var ctx = dst.getContext('2d');
      dst.width = 96; dst.height = 72;
      ctx.clearRect(0, 0, 96, 72);
      var rscale = Math.min(96 / src.width, 72 / src.height);
      var rw = src.width * rscale, rh = src.height * rscale;
      ctx.drawImage(src, (96 - rw) / 2, (72 - rh) / 2, rw, rh);
    }
  }, 100);
}


/* ═══ File upload ═══ */
// File picker: load the chosen image as the source.
var fileInput = document.getElementById('file-input');

fileInput.addEventListener('change', function() {
  if (this.files && this.files[0]) loadFile(this.files[0]);
});

// Drag & drop on viewport
// Drop an image anywhere on the viewport to load it.
var vp = document.getElementById('viewport');
vp.addEventListener('dragover', function(e) { e.preventDefault(); });
vp.addEventListener('drop', function(e) {
  e.preventDefault();
  if (e.dataTransfer.files && e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
});

// Load an image file as the albedo source, then enable the processing buttons.
function loadFile(f) {
  S.file = f;
  var img = new Image();
  img.onload = function() {
    S.img = img;
    setMap('albedo', img);
    setStatus('ok', 'Loaded ' + img.width + '\u00d7' + img.height);
    document.getElementById('status-detail').textContent = img.width + '\u00d7' + img.height;
    showRender();
    // Enable buttons
    ['btn-segment', 'btn-depth', 'btn-normals', 'btn-pbr'].forEach(function(id) {
      document.getElementById(id).disabled = false;
    });
  };
  img.src = URL.createObjectURL(f);
}

// Reset everything: drop the source, free GPU textures, clear thumbnails and
// maps, disable buttons, and re-show the upload prompt.
function clearAll() {
  S.file = null;
  S.img = null;
  S.maps = {};
  Object.keys(S.tex).forEach(function(k) { if (S.tex[k] && gl) gl.deleteTexture(S.tex[k]); });
  S.tex = {};
  // Reset thumbnails
  MAP_DEFS.forEach(function(d) {
    var tc = document.getElementById('thumb-' + d.key);
    if (tc) tc.getContext('2d').clearRect(0, 0, tc.width, tc.height);
    var dl = document.getElementById('dl-' + d.key);
    if (dl) dl.classList.add('disabled');
    document.getElementById('tab-' + d.key).classList.add('empty');
  });
  var rc = document.getElementById('thumb-render');
  if (rc) rc.getContext('2d').clearRect(0, 0, rc.width, rc.height);
  fileInput.value = '';
  ['btn-segment', 'btn-depth', 'btn-normals', 'btn-pbr', 'btn-editdepth', 'btn-nfd'].forEach(function(id) {
    document.getElementById(id).disabled = true;
  });
  document.getElementById('upload-prompt').classList.remove('hidden');
  document.getElementById('map-inspect').classList.add('hidden');
  showRender();
  setStatus('ok', 'Cleared');
  document.getElementById('status-detail').textContent = '\u2014';
  schedRender();
}


/* ═══ API calls ═══ */
// Set the status dot colour class and its message text.
function setStatus(t, m) {
  document.getElementById('status-dot').className = 'status-dot ' + t;
  document.getElementById('status-text').textContent = m;
}
function showProgress(m) {
  document.getElementById('progress').classList.remove('hidden');
  document.getElementById('progress-text').textContent = m;
}
function hideProgress() {
  document.getElementById('progress').classList.add('hidden');
}

// Decode a base64 PNG string from the server into an Image, resolving on load.
function b64Img(b) {
  return new Promise(function(resolve) {
    var img = new Image();
    img.onload = function() { resolve(img); };
    img.src = 'data:image/png;base64,' + b;
  });
}

// POST a form to the server and return the parsed JSON. The busy flag prevents
// overlapping requests; the status bar shows progress, timing, or the error.
async function apiPost(endpoint, formData, label) {
  if (S.busy) return null;
  S.busy = true;
  showProgress(label);
  setStatus('busy', label);
  try {
    var t0 = performance.now();
    var r = await fetch(API() + endpoint, { method: 'POST', body: formData });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + r.statusText);
    var d = await r.json();
    document.getElementById('status-detail').textContent =
      ((performance.now() - t0) / 1000).toFixed(1) + 's';
    return d;
  } catch(e) {
    setStatus('err', e.message);
    return null;
  } finally {
    S.busy = false;
    hideProgress();
  }
}

// Wrap the current source file in a FormData for a POST.
function fileFD() {
  var fd = new FormData();
  fd.append('file', S.file);
  return fd;
}

// Server actions: each posts the source image and stores the returned map(s).
// Segment produces the mask.
async function doSegment() {
  if (!S.file) return;
  var d = await apiPost('/segment', fileFD(), 'Segmenting...');
  if (d) { setMap('mask', await b64Img(d.mask)); setStatus('ok', 'Done'); }
}

// Depth produces the depth map.
async function doDepth() {
  if (!S.file) return;
  var d = await apiPost('/depth', fileFD(), 'Depth...');
  if (d) { setMap('depth', await b64Img(d.depth)); setStatus('ok', 'Done'); }
}

// Normals produces the normal map (and depth), smoothed by the slider value.
async function doNormals() {
  if (!S.file) return;
  var smooth = document.getElementById('depth-smooth').value;
  var fd = fileFD();
  var d = await apiPost('/normals?smooth=' + smooth, fd, 'Normals...');
  if (!d) return;
  setMap('normals', await b64Img(d.normals));
  if (d.depth) setMap('depth', await b64Img(d.depth));
  setStatus('ok', 'Done');
}

// Full PBR produces every map in one call.
async function doPBR() {
  if (!S.file) return;
  var d = await apiPost('/pbr', fileFD(), 'Full PBR...');
  if (!d) return;
  for (var i = 0; i < MAP_DEFS.length; i++) {
    var k = MAP_DEFS[i].key;
    if (d[k]) setMap(k, await b64Img(d[k]));
  }
  setStatus('ok', 'PBR done');
}

// Normals-from-depth: recompute normals from the (possibly hand-edited) depth
// map instead of the source image, so depth-editor changes flow into normals.
async function doNFD() {
  if (!S.maps.depth || S.busy) return;
  S.busy = true;
  showProgress('Normals from depth...');
  setStatus('busy', 'Computing...');
  try {
    var c = document.getElementById('thumb-depth');
    // Use full-res depth, not thumbnail
    var fullCanvas = document.createElement('canvas');
    fullCanvas.width = S.maps.depth.width;
    fullCanvas.height = S.maps.depth.height;
    fullCanvas.getContext('2d').drawImage(S.maps.depth, 0, 0);
    var blob = await new Promise(function(r) { fullCanvas.toBlob(r, 'image/png'); });
    var fd = new FormData();
    fd.append('file', blob, 'depth.png');
    var t0 = performance.now();
    var smooth = document.getElementById('depth-smooth').value;
    var r = await fetch(API() + '/normals-from-depth?smooth=' + smooth, { method: 'POST', body: fd });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var d = await r.json();
    document.getElementById('status-detail').textContent =
      ((performance.now() - t0) / 1000).toFixed(1) + 's';
    setMap('normals', await b64Img(d.normals));
    setStatus('ok', 'Done');
  } catch(e) {
    setStatus('err', e.message);
  } finally {
    S.busy = false;
    hideProgress();
  }
}


/* ═══ HDRI ═══ */
// HDRI picker: parse .hdr files here; load other image types as LDR env maps.
document.getElementById('hdri-input').addEventListener('change', function() {
  if (!this.files || !this.files[0]) return;
  var f = this.files[0];
  if (f.name.toLowerCase().endsWith('.hdr')) {
    loadHDR(f);
  } else {
    loadLDREnv(f);
  }
});

// Load a standard image as the environment map and switch to IBL lighting.
function loadLDREnv(f) {
  var img = new Image();
  img.onload = function() {
    uploadEnvTex(img);
    document.getElementById('hdri-preview').src = img.src;
    setLightMode(1);
    setStatus('ok', 'Env map loaded');
  };
  img.src = URL.createObjectURL(f);
}

// Read a Radiance .hdr file, tone-map its float pixels to an 8-bit canvas
// (1 - exp(-x) compresses the high dynamic range), then upload as the env map.
function loadHDR(file) {
  var reader = new FileReader();
  reader.onload = function() {
    try {
      var res = parseHDR(new Uint8Array(reader.result));
      var cv = document.createElement('canvas');
      cv.width = res.width; cv.height = res.height;
      var cx = cv.getContext('2d');
      var id = cx.createImageData(res.width, res.height);
      for (var i = 0; i < res.data.length; i += 3) {
        var pi = (i / 3) * 4;
        for (var c = 0; c < 3; c++) {
          var v = 1.0 - Math.exp(-res.data[i + c]);
          id.data[pi + c] = Math.min(255, v * 255) | 0;
        }
        id.data[pi + 3] = 255;
      }
      cx.putImageData(id, 0, 0);
      var img = new Image();
      img.onload = function() {
        uploadEnvTex(img);
        setLightMode(1);
        setStatus('ok', 'HDR loaded ' + res.width + 'x' + res.height);
      };
      img.src = cv.toDataURL();
      document.getElementById('hdri-preview').src = img.src;
    } catch(e) {
      setStatus('err', 'HDR: ' + e.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

// Parse a Radiance RGBE (.hdr) byte array into a Float32 RGB image. Skips the
// text header, reads the resolution line, then decodes each scanline and turns
// the shared exponent byte back into linear float radiance.
function parseHDR(b) {
  var i = 0;
  // Skip header
  while (i < b.length - 1) {
    if (b[i] === 10 && b[i+1] === 10) { i += 2; break; }
    if (b[i] === 10 && b[i+1] === 13 && b[i+2] === 10) { i += 3; break; }
    i++;
  }
  // Dimensions
  var dl = '';
  while (i < b.length && b[i] !== 10) { dl += String.fromCharCode(b[i]); i++; }
  i++;
  var m = dl.match(/-Y\s+(\d+)\s+\+X\s+(\d+)/);
  if (!m) throw new Error('Bad HDR dimensions');
  var H = parseInt(m[1]), W = parseInt(m[2]);
  var data = new Float32Array(W * H * 3);
  for (var y = 0; y < H; y++) {
    var sl = decodeScanline(b, i, W);
    i = sl.next;
    for (var x = 0; x < W; x++) {
      var si = x * 4, di = (y * W + x) * 3;
      var e = sl.px[si + 3];
      if (e === 0) { data[di] = data[di+1] = data[di+2] = 0; }
      else {
        var sc = Math.pow(2, e - 128 - 8);
        data[di]   = sl.px[si] * sc;
        data[di+1] = sl.px[si+1] * sc;
        data[di+2] = sl.px[si+2] * sc;
      }
    }
  }
  return { width: W, height: H, data: data };
}

// Decode one RGBE scanline. Handles both flat scanlines and the new-style
// run-length encoding (marker bytes 2,2), where each of the four channels is
// stored separately as alternating runs and literal spans.
function decodeScanline(b, o, W) {
  var i = o;
  if (W < 8 || W > 32767 || b[i] !== 2 || b[i+1] !== 2) {
    var px = new Uint8Array(W * 4);
    for (var x = 0; x < W; x++) {
      px[x*4] = b[i++]; px[x*4+1] = b[i++];
      px[x*4+2] = b[i++]; px[x*4+3] = b[i++];
    }
    return { px: px, next: i };
  }
  var sw = (b[i+2] << 8) | b[i+3]; i += 4;
  if (sw !== W) throw new Error('Width mismatch');
  var px = new Uint8Array(W * 4);
  for (var ch = 0; ch < 4; ch++) {
    var p = 0;
    while (p < W) {
      if (b[i] > 128) {
        var cnt = b[i++] - 128, val = b[i++];
        for (var j = 0; j < cnt; j++) px[(p++) * 4 + ch] = val;
      } else {
        var cnt = b[i++];
        for (var j = 0; j < cnt; j++) px[(p++) * 4 + ch] = b[i++];
      }
    }
  }
  return { px: px, next: i };
}

// Upload the environment image as a WebGL texture, wrapping horizontally so the
// equirectangular map is seamless as it rotates. Replaces any previous env map.
function uploadEnvTex(img) {
  if (!gl) return;
  if (S.envTex) gl.deleteTexture(S.envTex);
  var t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  S.envTex = t;
  S.hasEnv = true;
  schedRender();
}

// Switch lighting mode (0 point, 1 IBL, 2 both) and highlight its button.
function setLightMode(m) {
  S.lightMode = m;
  document.querySelectorAll('#mode-toggle button').forEach(function(b) {
    b.classList.toggle('active', parseInt(b.dataset.mode) === m);
  });
  schedRender();
}


/* ═══ Depth Editor ═══ */
// deOrig snapshots the depth image for Reset; deCtx is the editor canvas context.
var deOrig = null, deCtx = null;

// Open the depth painter: draw the current depth map into the editor canvas and
// wire up brush painting (a grey disc, its value and opacity from the sliders).
function openDepthEditor() {
  if (!S.maps.depth) return;
  document.getElementById('de-overlay').classList.remove('hidden');
  var cv  = document.getElementById('de-canvas');
  var img = S.maps.depth;
  cv.width = img.width; cv.height = img.height;
  cv.style.width = Math.min(img.width, window.innerWidth * 0.85) + 'px';
  cv.style.height = 'auto';
  deCtx = cv.getContext('2d');
  deCtx.drawImage(img, 0, 0);
  deOrig = deCtx.getImageData(0, 0, cv.width, cv.height);
  var painting = false;
  function gp(e) {
    var r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (cv.width / r.width), y: (e.clientY - r.top) * (cv.height / r.height) };
  }
  function paint(e) {
    if (!painting) return;
    var p  = gp(e);
    var br = parseInt(document.getElementById('de-brush').value);
    deCtx.globalAlpha = parseFloat(document.getElementById('de-opacity').value);
    var v = parseInt(document.getElementById('de-value').value);
    deCtx.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
    deCtx.beginPath();
    deCtx.arc(p.x, p.y, br / 2, 0, Math.PI * 2);
    deCtx.fill();
    deCtx.globalAlpha = 1;
  }
  cv.onmousedown = function(e) { painting = true; paint(e); };
  cv.onmousemove = paint;
  cv.onmouseup = cv.onmouseleave = function() { painting = false; };
}

// Blur the whole depth canvas once (soften painted edges).
function deBlur() {
  if (!deCtx) return;
  var c = document.getElementById('de-canvas');
  var t = document.createElement('canvas');
  t.width = c.width; t.height = c.height;
  var tc = t.getContext('2d');
  tc.filter = 'blur(3px)';
  tc.drawImage(c, 0, 0);
  deCtx.drawImage(t, 0, 0);
}

// Restore the depth canvas to the snapshot taken when the editor opened.
function deReset() {
  if (deCtx && deOrig) deCtx.putImageData(deOrig, 0, 0);
}

// Commit the edited depth canvas back into the depth map and close the editor.
function deApply() {
  var c = document.getElementById('de-canvas');
  var img = new Image();
  img.onload = function() {
    setMap('depth', img);
    document.getElementById('de-overlay').classList.add('hidden');
  };
  img.src = c.toDataURL('image/png');
}

// Close the depth editor without applying changes.
function deCancel() {
  document.getElementById('de-overlay').classList.add('hidden');
}


/* ═══ WebGL ═══ */
// gl is the context, prog the PBR program, renderPending coalesces redraws.
var gl, prog, renderPending = false;

// Create the WebGL context and PBR program from the in-page shader scripts, set
// up the full-screen quad, assign texture units, and seed placeholder textures.
function initGL() {
  var c = document.getElementById('gl-canvas');
  gl = c.getContext('webgl', { antialias: false, premultipliedAlpha: false });
  if (!gl) return;
  // The tab shell removes this iframe on a page swap. Drop the context so the
  // browser does not run out of live WebGL contexts during heavy swapping.
  window.addEventListener('pagehide', function () { try { if (gl) gl.getExtension('WEBGL_lose_context').loseContext(); } catch (e) {} });

  var vs = compileShader(gl.VERTEX_SHADER, document.getElementById('vs-quad').textContent);
  var fs = compileShader(gl.FRAGMENT_SHADER, document.getElementById('fs-pbr').textContent);
  prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('Shader link error:', gl.getProgramInfoLog(prog));
    return;
  }
  gl.useProgram(prog);

  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  var a = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(a);
  gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);

  // Texture units: 0-5 = maps, 6 = env
  var texNames = ['uAlbedo', 'uNormal', 'uRoughness', 'uMetallic', 'uAO', 'uMask', 'uEnvMap'];
  texNames.forEach(function(name, i) {
    gl.uniform1i(gl.getUniformLocation(prog, name), i);
  });

  // Placeholder textures
  MAP_DEFS.forEach(function(d) {
    S.tex[d.key] = makePlaceholder(d.key === 'normals' ? [128,128,255,255] : [0,0,0,255]);
  });

  resizeGL();
  window.addEventListener('resize', function() { resizeGL(); schedRender(); });
  schedRender();
}

// Compile one shader stage from source, logging any compile error.
function compileShader(type, src) {
  var s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(s));
  }
  return s;
}

// Make a 1x1 solid-colour texture, used where a map is missing (flat normal is
// [128,128,255], everything else black) so the shader always has a bound sampler.
function makePlaceholder(rgba) {
  var t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

// Upload a decoded map image as the GPU texture for that map key.
function uploadTex(key, img) {
  if (!gl) return;
  if (S.tex[key]) gl.deleteTexture(S.tex[key]);
  var t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  S.tex[key] = t;
}

// Match the canvas backing store to the viewport size times device pixel ratio.
function resizeGL() {
  var c  = document.getElementById('gl-canvas');
  var vp = document.getElementById('viewport');
  var d  = window.devicePixelRatio || 1;
  c.width  = vp.clientWidth * d;
  c.height = vp.clientHeight * d;
  if (gl) gl.viewport(0, 0, c.width, c.height);
}

// Request a single render on the next animation frame, coalescing bursts of
// control changes into one draw.
function schedRender() {
  if (!renderPending) {
    renderPending = true;
    requestAnimationFrame(render);
  }
}

// Draw one PBR frame: clear, bind the six map textures and the env map, push
// every material and lighting uniform from the controls, then draw the quad.
function render() {
  renderPending = false;
  if (!gl) return;

  var c = document.getElementById('gl-canvas');
  gl.viewport(0, 0, c.width, c.height);
  gl.clearColor(0.016, 0.024, 0.035, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(prog);

  // Bind map textures (0-5)
  var order = ['albedo', 'normals', 'roughness', 'metallic', 'ao', 'mask'];
  order.forEach(function(key, i) {
    gl.activeTexture(gl.TEXTURE0 + i);
    gl.bindTexture(gl.TEXTURE_2D, S.tex[key] || makePlaceholder([0,0,0,255]));
  });

  // Env map (6)
  gl.activeTexture(gl.TEXTURE6);
  gl.bindTexture(gl.TEXTURE_2D, S.envTex || makePlaceholder([0,0,0,255]));

  // Uniforms
  // u() looks up a uniform location; v() reads a control value as a float.
  var u = function(n) { return gl.getUniformLocation(prog, n); };
  var v = function(id) { return parseFloat(document.getElementById(id).value); };

  gl.uniform1i(u('uHasAlbedo'),    S.maps.albedo    ? 1 : 0);
  gl.uniform1i(u('uHasNormal'),    S.maps.normals   ? 1 : 0);
  gl.uniform1i(u('uHasRoughness'), S.maps.roughness ? 1 : 0);
  gl.uniform1i(u('uHasMetallic'),  S.maps.metallic  ? 1 : 0);
  gl.uniform1i(u('uHasAO'),        S.maps.ao        ? 1 : 0);
  gl.uniform1i(u('uHasMask'),      S.maps.mask      ? 1 : 0);
  gl.uniform1i(u('uHasEnv'),       S.hasEnv         ? 1 : 0);
  gl.uniform1i(u('uLightMode'),    S.lightMode);

  gl.uniform3f(u('uLightPos'), v('light-x'), v('light-y'), v('light-z'));
  gl.uniform1f(u('uLightCone'), v('light-cone'));
  gl.uniform1f(u('uLightIntensity'), v('light-int'));
  gl.uniform3f(u('uLightDir'), -v('light-x'), -v('light-y'), -v('light-z'));
  gl.uniform1f(u('uAmbient'), v('ambient'));
  gl.uniform1f(u('uRoughMult'), v('rough-mult'));
  gl.uniform1f(u('uMetalMult'), v('metal-mult'));
  gl.uniform1f(u('uNormStr'), v('norm-str'));
  gl.uniform2f(u('uResolution'), c.width, c.height);
  gl.uniform1f(u('uAspect'), c.width / c.height);
  gl.uniform1f(u('uImgAspect'), S.maps.albedo ? (S.maps.albedo.width / S.maps.albedo.height) : 0.0);
  gl.uniform1i(u('uBgMode'), parseInt(document.getElementById('bg-mode').value));
  gl.uniform1f(u('uEnvRot'), v('env-rot'));
  gl.uniform1f(u('uEnvExp'), v('env-exp'));

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}


/* ═══ Viewport drag: IBL rotation only ═══ */
// Dragging the viewport spins the environment map, but only in IBL mode with an
// env map loaded, so a point-light setup is not disturbed by a stray drag.
(function() {
  var vp = document.getElementById('viewport');
  var drag = false;
  vp.addEventListener('mousedown', function(e) {
    if (e.button === 0 && S.activeTab === 'render' && S.lightMode === 1 && S.hasEnv) drag = true;
  });
  window.addEventListener('mouseup', function() { drag = false; });
  vp.addEventListener('mousemove', function(e) {
    if (!drag) return;
    var r = vp.getBoundingClientRect();
    var dx = e.movementX / r.width * 3.0;
    var el = document.getElementById('env-rot');
    el.value = ((parseFloat(el.value) + dx) % (Math.PI * 2)).toFixed(3);
    schedRender();
  });
})();

/* ═══ Light Sphere Widget ═══ */
// The light direction as spherical angles; the widget draws and edits these.
var sphereAzimuth = 0.78;  // radians, initial ~45deg
var sphereElevation = 0.78;
var sphereCanvas = document.getElementById('sphere-canvas');
var sphereCtx = sphereCanvas.getContext('2d');

// Draw the light sphere: a shaded hemisphere with grid lines, a direction line
// from the centre, and a glowing dot marking the current light direction.
function drawSphere() {
  var w = sphereCanvas.width, h = sphereCanvas.height;
  var cx = w / 2, cy = h / 2, r = w / 2 - 4;
  var ctx = sphereCtx;

  ctx.clearRect(0, 0, w, h);

  // Hemisphere background with shading
  var grad = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.2, 0, cx, cy, r);
  grad.addColorStop(0, '#1a2030');
  grad.addColorStop(0.7, '#0e1420');
  grad.addColorStop(1, '#080c14');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(150,200,255,0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Grid lines (latitude/longitude)
  ctx.strokeStyle = 'rgba(150,200,255,0.04)';
  ctx.lineWidth = 0.5;
  // Equator
  ctx.beginPath();
  ctx.ellipse(cx, cy, r, r * 0.15, 0, 0, Math.PI * 2);
  ctx.stroke();
  // Meridian
  ctx.beginPath();
  ctx.ellipse(cx, cy, r * 0.15, r, 0, 0, Math.PI * 2);
  ctx.stroke();
  // 45-deg latitude
  ctx.beginPath();
  ctx.ellipse(cx, cy - r * 0.5, r * 0.866, r * 0.13, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Light dot position on sphere surface
  var lx = Math.cos(sphereElevation) * Math.sin(sphereAzimuth);
  var ly = Math.cos(sphereElevation) * Math.cos(sphereAzimuth);
  var lz = Math.sin(sphereElevation);
  // Project to 2D (orthographic)
  var px = cx + lx * r;
  var py = cy - lz * r;

  // Direction line from center
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(px, py);
  ctx.strokeStyle = 'rgba(255,200,50,0.3)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Light glow
  var glow = ctx.createRadialGradient(px, py, 0, px, py, 18);
  glow.addColorStop(0, 'rgba(255,200,50,0.25)');
  glow.addColorStop(1, 'rgba(255,200,50,0)');
  ctx.beginPath();
  ctx.arc(px, py, 18, 0, Math.PI * 2);
  ctx.fillStyle = glow;
  ctx.fill();

  // Light dot
  ctx.beginPath();
  ctx.arc(px, py, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffc832';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,200,50,0.6)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Center dot
  ctx.beginPath();
  ctx.arc(cx, cy, 2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(150,200,255,0.2)';
  ctx.fill();
}

// Convert the sphere angles and distance into a light position, write it to the
// hidden light inputs and the readout, redraw the widget, and re-render.
function updateLightFromSphere() {
  var dist = parseFloat(document.getElementById('light-dist').value);
  var lx = Math.cos(sphereElevation) * Math.sin(sphereAzimuth) * dist;
  var ly = Math.cos(sphereElevation) * Math.cos(sphereAzimuth) * dist;
  var lz = Math.sin(sphereElevation) * dist + 0.5;
  document.getElementById('light-x').value = lx.toFixed(2);
  document.getElementById('light-y').value = ly.toFixed(2);
  document.getElementById('light-z').value = lz.toFixed(2);
  document.getElementById('light-readout').textContent =
    'X:' + lx.toFixed(1) + ' Y:' + ly.toFixed(1) + ' Z:' + lz.toFixed(1);
  drawSphere();
  schedRender();
}

// Sphere interaction
// Drag inside the sphere to aim the light: the pointer offset from centre maps
// to azimuth (left-right) and elevation (up-down), clamped to the disc radius.
(function() {
  var el = document.getElementById('light-sphere');
  var dragging = false;

  function handleSphereInput(e) {
    var rect = el.getBoundingClientRect();
    var cx = rect.width / 2;
    var cy = rect.height / 2;
    var mx = e.clientX - rect.left - cx;
    var my = -(e.clientY - rect.top - cy);
    var maxR = cx - 2;
    // Clamp to sphere radius
    var d = Math.sqrt(mx * mx + my * my);
    if (d > maxR) { mx = mx / d * maxR; my = my / d * maxR; d = maxR; }

    sphereAzimuth = Math.atan2(mx, 1);  // left-right maps to azimuth
    sphereElevation = Math.asin(Math.min(my / maxR, 1.0));  // up-down maps to elevation

    updateLightFromSphere();
  }

  el.addEventListener('mousedown', function(e) {
    if (e.button === 0) { dragging = true; handleSphereInput(e); }
  });
  window.addEventListener('mouseup', function() { dragging = false; });
  el.addEventListener('mousemove', function(e) {
    if (dragging) handleSphereInput(e);
  });
})();

// Initial draw
// Place the light and paint the widget once at startup.
updateLightFromSphere();


/* ═══ Boot ═══ */
// Start WebGL, then probe the server /health endpoint and show its status.
initGL();

(async function() {
  try {
    var r = await fetch(API() + '/health');
    if (r.ok) {
      var d = await r.json();
      setStatus('ok', 'Connected \u00b7 ' + d.device);
    } else {
      setStatus('err', 'Server returned ' + r.status);
    }
  } catch(e) {
    setStatus('err', 'Server offline');
    document.getElementById('status-detail').textContent = API();
  }
})();
