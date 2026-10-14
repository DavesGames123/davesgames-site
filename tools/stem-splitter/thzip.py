#!/usr/bin/env python3
"""Find the bytes of each state tensor inside an official Demucs .th file.

A Demucs .th file is a torch zip ("archive/data.pkl" + "archive/data/<key>").
Every entry is ZIP_STORED, so a tensor is a plain byte range of the file.
This module reads the pickle with a stub unpickler (no torch needed) and
returns, for each state key: the storage key, the byte offset in the file,
the byte length, the shape and the dtype size. The ONNX export uses the
offsets to point each float16 weight at the official file, unchanged.

Port note: the pickle layout follows torch.serialization (_rebuild_tensor_v2,
persistent_load ('storage', type, key, location, numel)). Demucs package
layout ({'klass', 'args', 'kwargs', 'state'}) follows demucs/states.py
(Demucs, MIT, Copyright (c) Meta Platforms, Inc. and affiliates).

Usage:
  python3 tools/stem-splitter/thzip.py <file.th>     print a summary

GREP MAP
  stub unpickler ......... "class _Unpickler"
  zip data offset ........ "def data_offset"
  tensor table ........... "def tensor_table"
"""
import collections
import fractions
import pickle
import sys
import zipfile

# torch storage class name -> bytes per element
_ELEM = {'HalfStorage': 2, 'FloatStorage': 4, 'BFloat16Storage': 2, 'DoubleStorage': 8,
         'LongStorage': 8, 'IntStorage': 4, 'BoolStorage': 1, 'ByteStorage': 1}


class _Stub:
    def __init__(self, *a, **k):
        pass

    def __setstate__(self, st):
        pass


class _StorageType:
    def __init__(self, name):
        self.name = name


def _rebuild(storage, offset, size, stride, *rest):
    return {'storage': storage, 'offset': offset, 'shape': tuple(size), 'stride': tuple(stride)}


class _Unpickler(pickle.Unpickler):
    def find_class(self, mod, name):
        if name == '_rebuild_tensor_v2':
            return _rebuild
        if name.endswith('Storage'):
            return _StorageType(name)
        if mod == 'collections' and name == 'OrderedDict':
            return collections.OrderedDict
        if mod == 'fractions' and name == 'Fraction':
            return fractions.Fraction
        return _Stub

    def persistent_load(self, pid):
        # ('storage', storage_type, key, location, numel)
        st = pid[1]
        return {'key': pid[2], 'type': st.name if isinstance(st, _StorageType) else str(st), 'numel': pid[4]}


def data_offset(raw, info):
    """Byte offset of the data of a ZIP_STORED entry (after its local header)."""
    h = info.header_offset
    if raw[h:h + 4] != b'PK\x03\x04':
        raise ValueError(f'{info.filename}: no local header at {h}')
    n = int.from_bytes(raw[h + 26:h + 28], 'little')
    e = int.from_bytes(raw[h + 28:h + 30], 'little')
    return h + 30 + n + e


def _contiguous(shape, stride):
    want, acc = [], 1
    for d in reversed(shape):
        want.append(acc)
        acc *= d
    return tuple(reversed(want)) == tuple(stride) or acc <= 1


def tensor_table(path):
    """Return (package, {state key: record}). Record: key, offset, length,
    shape, elem (bytes per element), type. Raises if a tensor is not a whole,
    contiguous, stored storage."""
    raw = open(path, 'rb').read()
    z = zipfile.ZipFile(path)
    names = z.namelist()
    prefix = names[0].split('/')[0]
    pkg = _Unpickler(z.open(f'{prefix}/data.pkl')).load()
    out = collections.OrderedDict()
    for k, t in pkg['state'].items():
        st = t['storage']
        elem = _ELEM[st['type']]
        info = z.getinfo(f'{prefix}/data/{st["key"]}')
        if info.compress_type != zipfile.ZIP_STORED:
            raise ValueError(f'{k}: entry is compressed')
        numel = 1
        for d in t['shape']:
            numel *= d
        if not _contiguous(t['shape'], t['stride']):
            raise ValueError(f'{k}: not contiguous')
        if t['offset'] != 0 or numel != st['numel'] or info.file_size != numel * elem:
            raise ValueError(f'{k}: does not own its whole storage')
        out[k] = {'key': st['key'], 'offset': data_offset(raw, info), 'length': numel * elem,
                  'shape': t['shape'], 'elem': elem, 'type': st['type']}
    return pkg, out


if __name__ == '__main__':
    pkg, tab = tensor_table(sys.argv[1])
    types = collections.Counter(r['type'] for r in tab.values())
    print('tensors', len(tab), 'types', dict(types),
          'bytes', sum(r['length'] for r in tab.values()))
    print('kwargs', {k: pkg['kwargs'][k] for k in ('samplerate', 'audio_channels', 'segment', 'nfft', 'cac', 'sources') if k in pkg['kwargs']})
