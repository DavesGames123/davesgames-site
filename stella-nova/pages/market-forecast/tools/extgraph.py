# Re-export a core with constant folding off, so the graph initializers are
# the raw torch parameters, then point each one at its byte range in the
# official Hugging Face model.safetensors (ONNX external data). The graph
# file keeps only small derived constants. usage: extgraph.py <out> <key>
import sys, os, json, struct, hashlib
import numpy as np
import torch
import onnx
from onnx import numpy_helper, TensorProto
from huggingface_hub import hf_hub_download, HfApi

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import export as ex

OUT, key = sys.argv[1], sys.argv[2]
repo = {'bolt-tiny': 'amazon/chronos-bolt-tiny', 'bolt-mini': 'amazon/chronos-bolt-mini',
        'c2-small': 'autogluon/chronos-2-small'}[key]

from chronos import BaseChronosPipeline
kw = {'attn_implementation': 'eager'} if key.startswith('c2') else {}
pipe = BaseChronosPipeline.from_pretrained(repo, device_map='cpu', torch_dtype=torch.float32, **kw)
m = pipe.model.eval()
if key.startswith('c2'):
    for mod in m.modules():
        if hasattr(mod, 'config') and hasattr(mod.config, '_attn_implementation'):
            mod.config._attn_implementation = 'eager'
P = 16
tmp = f'{OUT}/{key}.nofold.onnx'
with torch.no_grad():
    if key.startswith('bolt'):
        core = ex.BoltCore(m).eval()
        args = (torch.randn(2, 8, 2 * P), torch.ones(2, 8))
        names = ['patched', 'attn']
        dyn = {'patched': {0: 'B', 1: 'N'}, 'attn': {0: 'B', 1: 'N'}, 'quantiles': {0: 'B'}}
    else:
        core = ex.C2Core(m).eval()
        args = (torch.randn(3, 8, 3 * P), torch.ones(3, 8), torch.randn(3, 2, 3 * P), torch.tensor([0, 0, 1]))
        names = ['ctx', 'ctx_mask', 'fut', 'group_ids']
        dyn = {'ctx': {0: 'B', 1: 'Nc'}, 'ctx_mask': {0: 'B', 1: 'Nc'}, 'fut': {0: 'B', 1: 'Nf'},
               'group_ids': {0: 'B'}, 'quantiles': {0: 'B', 2: 'H'}}
    torch.onnx.export(core, args, tmp, input_names=names, output_names=['quantiles'], dynamic_axes=dyn,
                      opset_version=17, dynamo=False, do_constant_folding=False)

info = HfApi().model_info(repo)
sha = info.sha
st = hf_hub_download(repo, 'model.safetensors', revision=sha)
raw = open(st, 'rb').read()
hlen = struct.unpack('<Q', raw[:8])[0]
hdr = json.loads(raw[8:8 + hlen])
base = 8 + hlen
by_hash = {}
for name, t in hdr.items():
    if name == '__metadata__' or t['dtype'] != 'F32':
        continue
    a, b = t['data_offsets']
    by_hash.setdefault(hashlib.sha1(raw[base + a:base + b]).hexdigest(), (base + a, b - a, name))

g = onnx.load(tmp)
mapped, kept, kept_bytes = 0, [], 0
for init in g.graph.initializer:
    if init.data_type != TensorProto.FLOAT:
        kept.append(init.name); continue
    arr = numpy_helper.to_array(init).astype('<f4')
    h = hashlib.sha1(arr.tobytes()).hexdigest()
    if h in by_hash and arr.size >= 64:
        off, ln, src = by_hash[h]
        init.ClearField('raw_data'); del init.float_data[:]
        init.data_location = TensorProto.EXTERNAL
        del init.external_data[:]
        for k, v in (('location', 'model.safetensors'), ('offset', str(off)), ('length', str(ln))):
            e = init.external_data.add(); e.key = k; e.value = v
        mapped += 1
    else:
        kept.append(init.name); kept_bytes += arr.nbytes
dst = f'{OUT}/{key}.hf.onnx'
onnx.save(g, dst)
print(dst, os.path.getsize(dst) / 1e3, 'kB; mapped', mapped, 'kept', len(kept), kept_bytes / 1e3, 'kB')
print('kept:', kept[:20])
json.dump({'repo': repo, 'revision': sha, 'file': 'model.safetensors', 'bytes': len(raw),
           'sha256': hashlib.sha256(raw).hexdigest()}, open(f'{OUT}/{key}.hf.json', 'w'), indent=1)
print(open(f'{OUT}/{key}.hf.json').read())
os.remove(tmp)
