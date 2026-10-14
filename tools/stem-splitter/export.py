#!/usr/bin/env python3
"""Export the HTDemucs network core to ONNX, with the weights left in the
official .th file.

Steps (CONTRACT.md 2.3 and 7.1):
  1. torch.onnx.export of Core (core.py), opset 17, no constant folding, so
     each parameter stays one initializer named "m.<state key>".
  2. Each parameter initializer becomes a float16 initializer
     "m.<key>__f16" with data_location EXTERNAL: location = the .th file
     name, offset and length = the tensor bytes in that file (thzip.py).
     A Cast(to=FLOAT) node gives back the float32 name. Each range is
     checked byte for byte against the state dict.
  3. Static shape fold: the shapes are fixed, so every Shape output is a
     constant. One onnxruntime run reads the value of each Shape output.
     Then each node whose inputs are all constant is computed
     (onnx.reference) and replaced by an initializer, when its output has
     at most FOLD_MAX elements. Dead nodes are removed.
  4. onnx.checker.check_model, then a parity run of the new graph against
     the graph from step 2 (onnxruntime CPU, same input).

Usage:
  python tools/stem-splitter/export.py htdemucs [out.onnx]
  python tools/stem-splitter/export.py htdemucs_6s
Default out: stella-nova/pages/stem-splitter/models/<id>.onnx

GREP MAP
  torch export ............ "def torch_export"
  f16 external rewrite .... "def externalize"
  shape fold .............. "def fold_static"
  dead node removal ....... "def prune"
  main .................... "def main"
"""
import collections
import io
import os
import shutil
import sys
import tempfile
import time

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import core  # noqa: E402
import thzip  # noqa: E402

FOLD_MAX = 1 << 16     # largest folded tensor (elements); shape math is tiny


def torch_export(model):
    import torch
    torch.backends.mha.set_fastpath_enabled(False)
    c = core.make_core(model)
    g = torch.Generator().manual_seed(0)
    mix = torch.randn(1, 2, core.SEG, generator=g) * 0.1
    mag, mix = core.segment_inputs(model, mix)
    buf = io.BytesIO()
    with torch.no_grad():
        torch.onnx.export(c, (mag, mix), buf, input_names=['mag', 'mix'],
                          output_names=['spec_out', 'wave_out'], opset_version=17,
                          dynamo=False, do_constant_folding=False)
    return onnx.load_from_string(buf.getvalue()), mag.numpy(), mix.numpy()


def externalize(g, th_file):
    """Step 2. Returns (matched, unmatched names)."""
    _, tab = thzip.tensor_table(th_file)
    raw = open(th_file, 'rb').read()
    base = os.path.basename(th_file)
    inits, casts, matched, unmatched = [], [], 0, []
    for t in g.graph.initializer:
        k = t.name[2:] if t.name.startswith('m.') else None
        r = tab.get(k)
        if r is None:
            inits.append(t)
            unmatched.append(t.name)
            continue
        arr = numpy_helper.to_array(t)
        if tuple(arr.shape) != r['shape'] or r['elem'] != 2 or r['length'] != arr.size * 2:
            raise ValueError(f'{k}: shape or size does not match the .th')
        f16 = np.frombuffer(raw, dtype='<f2', count=arr.size, offset=r['offset']).reshape(arr.shape)
        if not np.array_equal(f16.astype(np.float32), arr):
            raise ValueError(f'{k}: bytes in the .th are not the state dict value')
        h = TensorProto()
        h.name = t.name + '__f16'
        h.data_type = TensorProto.FLOAT16
        h.dims.extend(arr.shape)
        h.data_location = TensorProto.EXTERNAL
        for kk, vv in (('location', base), ('offset', str(r['offset'])), ('length', str(r['length']))):
            e = h.external_data.add()
            e.key, e.value = kk, vv
        inits.append(h)
        casts.append(helper.make_node('Cast', [h.name], [t.name], to=TensorProto.FLOAT, name=t.name + '__cast'))
        matched += 1
    del g.graph.initializer[:]
    g.graph.initializer.extend(inits)
    nodes = list(g.graph.node)
    del g.graph.node[:]
    g.graph.node.extend(casts + nodes)
    return matched, unmatched, len(tab)


def _place(th_file, work):
    """Copy the .th next to the graphs in work (deleted at the end).
    onnx.checker refuses a symlink and a file with more than one hard link."""
    link = os.path.join(work, os.path.basename(th_file))
    if not os.path.exists(link):
        shutil.copyfile(th_file, link)
    return link


def _session(g, th_file, work, outputs=None):
    import onnxruntime as ort
    m = onnx.ModelProto()
    m.CopyFrom(g)
    if outputs:
        for o in outputs:
            m.graph.output.append(helper.make_empty_tensor_value_info(o))
    p = os.path.join(work, 'g.onnx')
    onnx.save(m, p)
    _place(th_file, work)
    so = ort.SessionOptions()
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
    return ort.InferenceSession(p, so, providers=['CPUExecutionProvider'])


def _const_of(node):
    a = node.attribute[0]
    if a.name == 'value':
        return numpy_helper.to_array(a.t)
    if a.name == 'value_float':
        return np.array(a.f, np.float32)
    if a.name == 'value_floats':
        return np.array(list(a.floats), np.float32)
    if a.name == 'value_int':
        return np.array(a.i, np.int64)
    if a.name == 'value_ints':
        return np.array(list(a.ints), np.int64)
    return None


def _eval(node, vals, opset):
    from onnx.reference import ReferenceEvaluator
    ins = [n for n in node.input if n]
    gi = [helper.make_tensor_value_info(n, helper.np_dtype_to_tensor_dtype(vals[n].dtype), vals[n].shape) for n in ins]
    go = [helper.make_empty_tensor_value_info(o) for o in node.output if o]
    m = helper.make_model(helper.make_graph([node], 'n', gi, go), opset_imports=[helper.make_opsetid('', opset)])
    res = ReferenceEvaluator(m).run(None, {n: vals[n] for n in ins})
    return dict(zip([o for o in node.output if o], res))


def fold_static(g, th_file, feeds, work):
    """Step 3. Returns the number of nodes folded."""
    opset = [o.version for o in g.opset_import if o.domain in ('', 'ai.onnx')][0]
    shape_outs = [n.output[0] for n in g.graph.node if n.op_type == 'Shape']
    sess = _session(g, th_file, work, shape_outs)
    got = sess.run(shape_outs, feeds)
    vals = dict(zip(shape_outs, got))
    ext = {t.name for t in g.graph.initializer if t.data_location == TensorProto.EXTERNAL}
    for t in g.graph.initializer:
        if t.name not in ext:
            vals[t.name] = numpy_helper.to_array(t)
    folded = set()   # node indices (protobuf wrappers have no stable id())
    nodes = list(g.graph.node)
    for ix, n in enumerate(nodes):
        if n.op_type == 'Shape':
            folded.add(ix)
            continue
        if n.op_type == 'Constant':
            v = _const_of(n)
            if v is not None and v.size <= FOLD_MAX:
                vals[n.output[0]] = v
                folded.add(ix)
            elif v is not None:
                vals[n.output[0]] = v   # big constant: known, but its node stays
            continue
        ins = [i for i in n.input if i]
        if n.op_type == 'Cast' and ins and ins[0] in ext:
            continue
        if not ins or not all(i in vals for i in ins):
            continue
        if any(vals[i].size > FOLD_MAX for i in ins):
            continue
        out = _eval(n, vals, opset)
        if any(np.asarray(v).size > FOLD_MAX for v in out.values()):
            continue
        for k, v in out.items():
            vals[k] = np.asarray(v)
        folded.add(ix)
    # Rebuild: drop folded nodes; add an initializer for each folded value
    # that a kept node or a graph output reads.
    kept = [n for ix, n in enumerate(nodes) if ix not in folded]
    produced_by_folded = {o for ix in folded for o in nodes[ix].output}
    need = {i for n in kept for i in n.input} | {o.name for o in g.graph.output}
    new_inits = []
    for name in sorted(need & produced_by_folded):
        new_inits.append(numpy_helper.from_array(np.ascontiguousarray(vals[name]), name))
    nf = len(nodes) - len(kept)
    del g.graph.node[:]
    g.graph.node.extend(kept)
    g.graph.initializer.extend(new_inits)
    return nf


def prune(g):
    """Remove nodes and initializers that no graph output depends on."""
    need = {o.name for o in g.graph.output}
    keep = []
    for n in reversed(list(g.graph.node)):
        if any(o in need for o in n.output):
            keep.append(n)
            need.update(i for i in n.input if i)
    keep.reverse()
    removed = len(g.graph.node) - len(keep)
    del g.graph.node[:]
    g.graph.node.extend(keep)
    inits = [t for t in g.graph.initializer if t.name in need]
    removed_i = len(g.graph.initializer) - len(inits)
    del g.graph.initializer[:]
    g.graph.initializer.extend(inits)
    del g.graph.value_info[:]
    return removed, removed_i


def ops(g):
    return collections.Counter(n.op_type for n in g.graph.node)


def main():
    model_id = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(core.PAGE, 'models', model_id + '.onnx')
    th_file = core.th_path(model_id)
    t0 = time.time()
    model = core.load_model(model_id)
    g, mag, mix = torch_export(model)
    print(f'{model_id}: torch export {time.time() - t0:.1f} s, nodes {len(g.graph.node)}, initializers {len(g.graph.initializer)}')
    matched, unmatched, total = externalize(g, th_file)
    print(f'{model_id}: external float16 parameters {matched}/{total}, unmapped initializers {len(unmatched)}'
          + (f' {unmatched[:6]}' if unmatched else ''))
    if matched != total:
        raise SystemExit('not every state tensor is a graph parameter')
    before = ops(g)
    feeds = {'mag': mag, 'mix': mix}
    work = tempfile.mkdtemp(prefix='stem-export-', dir=core.SCRATCH if os.path.isdir(core.SCRATCH) else None)
    try:
        ref = _session(g, th_file, work).run(None, feeds)
        nf = fold_static(g, th_file, feeds, work)
        rn, ri = prune(g)
        after = ops(g)
        print(f'{model_id}: folded {nf} nodes, pruned {rn} nodes and {ri} initializers, nodes {len(g.graph.node)}')
        gone = sorted(set(before) - set(after))
        print(f'{model_id}: ops removed by the fold: {" ".join(gone) or "none"}')
        print(f'{model_id}: ops left: ' + ' '.join(f'{k}:{v}' for k, v in sorted(after.items(), key=lambda x: -x[1])))
        pc = os.path.join(work, 'check.onnx')
        onnx.save(g, pc)
        _place(th_file, work)
        onnx.checker.check_model(pc, full_check=True)
        print(f'{model_id}: onnx.checker.check_model ok')
        new = _session(g, th_file, work).run(None, feeds)
        for name, a, b in zip(('spec_out', 'wave_out'), ref, new):
            print(f'{model_id}: fold parity {name} SDR {core.sdr(a, b):.1f} dB, max abs {float(np.abs(a - b).max()):.3g}')
    finally:
        shutil.rmtree(work, ignore_errors=True)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    onnx.save(g, out)
    import hashlib
    data = open(out, 'rb').read()
    print(f'{model_id}: wrote {os.path.relpath(out, core.ROOT)} {len(data)} B sha256 {hashlib.sha256(data).hexdigest()}')


if __name__ == '__main__':
    main()
