// ============================================================================
//  CNN EXPLAINER  ·  net.js  the Tiny VGG forward pass in plain JavaScript
// ----------------------------------------------------------------------------
//  This module is DOM-free. Node tests import it, and the page runs it on the
//  main thread (one image takes about 10 ms). It does not use TensorFlow.js.
//
//  THE MODEL. Tiny VGG from CNN Explainer (Wang et al., IEEE VIS 2020,
//  github.com/poloclub/cnn-explainer, MIT). The weights in model/weights.bin
//  are the file public/assets/data/group1-shard1of1.bin of that repository,
//  without a change: 19,920 float32 values, little endian, in this order:
//
//    conv_1_1 kernel [3,3,3,10]  bias [10]     64x64x3  -> 62x62x10
//    conv_1_2 kernel [3,3,10,10] bias [10]     62x62x10 -> 60x60x10
//    max_pool_1  2x2, stride 2                 60x60x10 -> 30x30x10
//    conv_2_1 kernel [3,3,10,10] bias [10]     30x30x10 -> 28x28x10
//    conv_2_2 kernel [3,3,10,10] bias [10]     28x28x10 -> 26x26x10
//    max_pool_2  2x2, stride 2                 26x26x10 -> 13x13x10
//    flatten                                   13x13x10 -> 1690
//    output   kernel [1690,10]   bias [10]     1690 -> 10, softmax
//
//  Each conv has "valid" padding, stride 1 and a ReLU after it. The input is
//  the RGB pixel value / 255, as in the original page (src/utils/cnn-tf.js).
//
//  LAYOUT OF A TENSOR. Channels last, as in Keras: the value of channel c at
//  row y, column x is data[(y * W + x) * C + c]. The flatten order of Keras
//  is the same, so the flat vector is the pooled tensor without a copy.
//
//  GREP MAP
//    grep -n 'export const CLASSES'      the ten class names
//    grep -n 'export const ARCH'         the layer list of the network
//    grep -n 'export function parseWeights'  weights.bin -> layer weights
//    grep -n 'export function conv2d'    one convolution (stride, padding)
//    grep -n 'export function relu'      ReLU
//    grep -n 'export function maxPool'   max pooling
//    grep -n 'export function dense'     the dense layer
//    grep -n 'export function softmax'   a stable softmax
//    grep -n 'export function forward'   the whole pass, all activations
//    grep -n 'export function convTerms' the products of one conv unit
//    grep -n 'export function poolWindow'    the window of one pool unit
//    grep -n 'export function sourceWindow'  which inputs feed a unit
//    grep -n 'export function receptiveField' the field in the input image
// ============================================================================

export const CLASSES = ['lifeboat', 'ladybug', 'pizza', 'bell pepper', 'school bus',
  'koala', 'espresso', 'red panda', 'orange', 'sport car'];

export const INPUT_SIZE = 64;

// One row per layer that the page shows. 'w' names the weights entry.
export const ARCH = [
  { name: 'input', type: 'input', label: 'Input' },
  { name: 'conv_1_1', type: 'conv', w: 'conv_1_1', label: 'Conv 1·1' },
  { name: 'relu_1_1', type: 'relu', label: 'ReLU 1·1' },
  { name: 'conv_1_2', type: 'conv', w: 'conv_1_2', label: 'Conv 1·2' },
  { name: 'relu_1_2', type: 'relu', label: 'ReLU 1·2' },
  { name: 'max_pool_1', type: 'pool', label: 'Max pool 1' },
  { name: 'conv_2_1', type: 'conv', w: 'conv_2_1', label: 'Conv 2·1' },
  { name: 'relu_2_1', type: 'relu', label: 'ReLU 2·1' },
  { name: 'conv_2_2', type: 'conv', w: 'conv_2_2', label: 'Conv 2·2' },
  { name: 'relu_2_2', type: 'relu', label: 'ReLU 2·2' },
  { name: 'max_pool_2', type: 'pool', label: 'Max pool 2' },
  { name: 'output', type: 'dense', w: 'output', label: 'Output' },
];

const WEIGHT_ORDER = [
  ['conv_1_1', [3, 3, 3, 10]], ['conv_1_2', [3, 3, 10, 10]],
  ['conv_2_1', [3, 3, 10, 10]], ['conv_2_2', [3, 3, 10, 10]],
  ['output', [1690, 10]],
];
export const WEIGHT_COUNT = 19920;

// weights.bin (ArrayBuffer or Uint8Array) -> { name: { kernel, bias, shape } }
export function parseWeights(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes.byteLength !== WEIGHT_COUNT * 4) throw new Error(`weights.bin: ${bytes.byteLength} bytes, want ${WEIGHT_COUNT * 4}`);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const all = new Float32Array(WEIGHT_COUNT);
  for (let i = 0; i < WEIGHT_COUNT; i++) all[i] = dv.getFloat32(i * 4, true);
  const W = {}; let o = 0;
  for (const [name, shape] of WEIGHT_ORDER) {
    const n = shape.reduce((a, b) => a * b, 1), nb = shape[shape.length - 1];
    W[name] = { shape, kernel: all.subarray(o, o + n), bias: all.subarray(o + n, o + n + nb) };
    o += n + nb;
  }
  return W;
}

// Output size of a convolution or pool along one axis.
export function outSize(n, k, stride = 1, pad = 0) {
  return Math.floor((n + 2 * pad - k) / stride) + 1;
}

// input HWC (H, W, Cin) -> { data, H, W, C }. kernel [k, k, Cin, Cout].
export function conv2d(input, H, W, Cin, kernel, bias, Cout, { k = 3, stride = 1, pad = 0 } = {}) {
  const Ho = outSize(H, k, stride, pad), Wo = outSize(W, k, stride, pad);
  const out = new Float32Array(Ho * Wo * Cout);
  const acc = new Float64Array(Cout);
  for (let y = 0; y < Ho; y++) for (let x = 0; x < Wo; x++) {
    for (let co = 0; co < Cout; co++) acc[co] = bias ? bias[co] : 0;
    for (let ky = 0; ky < k; ky++) {
      const iy = y * stride + ky - pad; if (iy < 0 || iy >= H) continue;
      for (let kx = 0; kx < k; kx++) {
        const ix = x * stride + kx - pad; if (ix < 0 || ix >= W) continue;
        const ib = (iy * W + ix) * Cin, kb = (ky * k + kx) * Cin;
        for (let ci = 0; ci < Cin; ci++) {
          const v = input[ib + ci]; if (v === 0) continue;
          const kr = (kb + ci) * Cout;
          for (let co = 0; co < Cout; co++) acc[co] += v * kernel[kr + co];
        }
      }
    }
    const ob = (y * Wo + x) * Cout;
    for (let co = 0; co < Cout; co++) out[ob + co] = acc[co];
  }
  return { data: out, H: Ho, W: Wo, C: Cout };
}

export function relu(input) {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = input[i] > 0 ? input[i] : 0;
  return out;
}

export function maxPool(input, H, W, C, { size = 2, stride = 2 } = {}) {
  const Ho = outSize(H, size, stride), Wo = outSize(W, size, stride);
  const out = new Float32Array(Ho * Wo * C);
  for (let y = 0; y < Ho; y++) for (let x = 0; x < Wo; x++) for (let c = 0; c < C; c++) {
    let m = -Infinity;
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) {
      const v = input[((y * stride + dy) * W + (x * stride + dx)) * C + c];
      if (v > m) m = v;
    }
    out[(y * Wo + x) * C + c] = m;
  }
  return { data: out, H: Ho, W: Wo, C };
}

// x [n] . kernel [n, m] + bias [m]
export function dense(x, kernel, bias, m) {
  const out = new Float64Array(m), n = x.length;
  for (let j = 0; j < m; j++) out[j] = bias ? bias[j] : 0;
  for (let i = 0; i < n; i++) { const v = x[i]; if (v === 0) continue; const r = i * m; for (let j = 0; j < m; j++) out[j] += v * kernel[r + j]; }
  return out;
}

export function softmax(z) {
  let mx = -Infinity; for (const v of z) if (v > mx) mx = v;
  const e = Array.from(z, v => Math.exp(v - mx));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map(v => v / s);
}

// RGB bytes (64 * 64 * 3, row major) -> Float32Array in 0..1
export function normalise(rgb) {
  const out = new Float32Array(rgb.length);
  for (let i = 0; i < rgb.length; i++) out[i] = rgb[i] / 255;
  return out;
}

// The whole pass. Returns every activation, so the page can draw them.
export function forward(W, rgb) {
  const x0 = normalise(rgb);
  const layers = [{ name: 'input', type: 'input', H: 64, W: 64, C: 3, data: x0 }];
  let cur = layers[0];
  for (const spec of ARCH.slice(1)) {
    let next;
    if (spec.type === 'conv') {
      const w = W[spec.w], [k, , cin, cout] = w.shape;
      next = conv2d(cur.data, cur.H, cur.W, cin, w.kernel, w.bias, cout, { k });
    } else if (spec.type === 'relu') {
      next = { data: relu(cur.data), H: cur.H, W: cur.W, C: cur.C };
    } else if (spec.type === 'pool') {
      next = maxPool(cur.data, cur.H, cur.W, cur.C);
    } else if (spec.type === 'dense') {
      const w = W[spec.w];
      const logits = dense(cur.data, w.kernel, w.bias, w.shape[1]);
      const probs = softmax(logits);
      next = { data: Float32Array.from(probs), H: 1, W: 1, C: logits.length, logits: Array.from(logits), probs };
    }
    cur = Object.assign({ name: spec.name, type: spec.type }, next);
    layers.push(cur);
  }
  const out = layers[layers.length - 1];
  let top = 0; out.probs.forEach((p, i) => { if (p > out.probs[top]) top = i; });
  return { layers, logits: out.logits, probs: out.probs, top, label: CLASSES[top] };
}

// One channel of a layer as a Float32Array (H * W), and its min and max.
export function channel(layer, c) {
  const n = layer.H * layer.W, out = new Float32Array(n);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { const v = layer.data[i * layer.C + c]; out[i] = v; if (v < lo) lo = v; if (v > hi) hi = v; }
  return { data: out, min: lo, max: hi, H: layer.H, W: layer.W };
}

// The products of one conv unit: for each input channel, the 3x3 window,
// the 3x3 kernel slice and their element-wise products.
export function convTerms(W, layers, li, y, x, co) {
  const spec = ARCH[li], w = W[spec.w], prev = layers[li - 1];
  const [k, , cin, cout] = w.shape;
  const chans = [];
  let sum = 0;
  for (let ci = 0; ci < cin; ci++) {
    const win = [], ker = [], prod = [];
    let s = 0;
    for (let ky = 0; ky < k; ky++) for (let kx = 0; kx < k; kx++) {
      const v = prev.data[((y + ky) * prev.W + (x + kx)) * prev.C + ci];
      const kv = w.kernel[((ky * k + kx) * cin + ci) * cout + co];
      win.push(v); ker.push(kv); prod.push(v * kv); s += v * kv;
    }
    chans.push({ ci, win, ker, prod, sum: s });
    sum += s;
  }
  const bias = w.bias[co];
  return { k, chans, sum, bias, out: sum + bias };
}

// The 2x2 window of one pool unit, and which cell holds the max.
export function poolWindow(layers, li, y, x, c) {
  const prev = layers[li - 1], vals = [];
  let arg = 0;
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const v = prev.data[((y * 2 + dy) * prev.W + (x * 2 + dx)) * prev.C + c];
    vals.push(v); if (v > vals[arg]) arg = vals.length - 1;
  }
  return { vals, arg, max: vals[arg] };
}

// The rectangle of the layer before li that feeds unit (y, x) of layer li,
// as { y0, x0, size } in that layer's grid. Dense units see all of it.
export function sourceWindow(li, y, x) {
  const t = ARCH[li].type;
  if (t === 'conv') return { y0: y, x0: x, size: 3 };
  if (t === 'pool') return { y0: y * 2, x0: x * 2, size: 2 };
  if (t === 'relu') return { y0: y, x0: x, size: 1 };
  return null;
}

// The receptive field of unit (y, x) of layer li in every earlier layer,
// down to the input image: an array of { li, y0, x0, size }.
export function receptiveField(li, y, x) {
  const out = [];
  let y0 = y, x0 = x, size = 1;
  for (let l = li; l > 0; l--) {
    const t = ARCH[l].type;
    if (t === 'dense') return out;
    if (t === 'conv') size += 2;
    else if (t === 'pool') { y0 *= 2; x0 *= 2; size *= 2; }
    out.push({ li: l - 1, y0, x0, size });
  }
  return out;
}
