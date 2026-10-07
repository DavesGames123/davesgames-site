# Weight-only compression of the fp32 ONNX cores. Compute stays fp32.
#   int8: each MatMul/Gemm weight -> int8 + per-output-channel scale ->
#         DequantizeLinear (symmetric, zero point 0)
#   fp16: each large float initializer -> fp16 + Cast to fp32
# ORT folds both at session load, so every EP (WebGPU, WASM) runs fp32 kernels.
import sys
import numpy as np
import onnx
from onnx import numpy_helper, helper, TensorProto

src, dst, mode = sys.argv[1], sys.argv[2], sys.argv[3]
m = onnx.load(src)
g = m.graph
inits = {i.name: i for i in g.initializer}
uses = {}
for n in g.node:
    for k, x in enumerate(n.input):
        uses.setdefault(x, []).append((n, k))

new_inits, new_nodes, drop = [], [], set()
for name, init in inits.items():
    if init.data_type != TensorProto.FLOAT:
        continue
    w = numpy_helper.to_array(init)
    if w.size < 4096:
        continue
    us = uses.get(name, [])
    if not us:
        continue
    if mode == 'int8':
        if w.ndim != 2 or not all(n.op_type in ('MatMul', 'Gemm') and k == 1 for n, k in us):
            continue
        n0 = us[0][0]
        transB = any(a.name == 'transB' and a.i == 1 for a in n0.attribute) if n0.op_type == 'Gemm' else False
        axis = 0 if transB else 1  # output channel
        amax = np.abs(w).max(axis=1 - axis)
        sc = np.where(amax > 0, amax / 127.0, 1.0).astype(np.float32)
        q = np.clip(np.round(w / (sc[:, None] if axis == 0 else sc[None, :])), -127, 127).astype(np.int8)
        new_inits += [numpy_helper.from_array(q, name + '_q'), numpy_helper.from_array(sc, name + '_s'),
                      numpy_helper.from_array(np.zeros_like(sc, dtype=np.int8), name + '_z')]
        new_nodes.append(helper.make_node('DequantizeLinear', [name + '_q', name + '_s', name + '_z'], [name], axis=axis,
                                          name=name + '_dq'))
    else:
        new_inits.append(numpy_helper.from_array(w.astype(np.float16), name + '_h'))
        new_nodes.append(helper.make_node('Cast', [name + '_h'], [name], to=TensorProto.FLOAT, name=name + '_cast'))
    drop.add(name)

keep = [i for i in g.initializer if i.name not in drop]
del g.initializer[:]
g.initializer.extend(keep + new_inits)
nodes = list(g.node)
del g.node[:]
g.node.extend(new_nodes + nodes)
m.producer_name = 'davesgames market-forecast quant.py (' + mode + ')'
onnx.checker.check_model(m)
onnx.save(m, dst)
import os
print(dst, os.path.getsize(dst) / 1e6, 'MB', 'replaced', len(drop))
