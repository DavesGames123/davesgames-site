// ============================================================================
//  MODELS  ·  stem-splitter/models.js — the Demucs models the page can run
// ----------------------------------------------------------------------------
//  Written by the MODEL role from tools/stem-splitter/export.py output.
//  ES module, no DOM, importable in node.
//
//  Each model has two files, both relative to the page folder:
//    graph    models/<id>.onnx: the HTDemucs network core (no STFT), opset
//             17, made by tools/stem-splitter/export.py. It holds no weights.
//    weights  the official Demucs checkpoint (.th), unchanged. Each graph
//             weight is an external float16 initializer whose location is
//             weights.name, at a byte range inside this file. The deploy
//             fetches it (tools/stem-splitter/fetch.mjs); it is not in git.
//  bytes are for progress only. sha256 is checked after each download.
//  Graph I/O (float32, batch 1, fixed): inputs mag [1,4,2048,336] (CaC
//  spectrogram: L.re, L.im, R.re, R.im) and mix [1,2,343980]; outputs
//  spec_out [1,S,4,2048,336] and wave_out [1,S,2,343980]. Source order =
//  stems. See CONTRACT.md 2.3 and 3.
//  Licence and sources of every file: NOTICE in this folder.
//
//  GREP MAP
//    format version ....... "export const MODEL_FORMAT"
//    audio constants ...... "export const AUDIO"
//    model table .......... "export const MODELS"
//    default model ........ "export const DEFAULT_MODEL"
// ============================================================================

export const MODEL_FORMAT = 1;

export const AUDIO = { sampleRate: 44100, channels: 2, segment: 343980, nfft: 4096, hop: 1024, bins: 2048, frames: 336, overlap: 0.25 };

export const MODELS = {
  htdemucs: {
    id: 'htdemucs', label: '4 stems', note: 'Demucs v4 (htdemucs), the default model',
    stems: ['drums', 'bass', 'other', 'vocals'],
    graph: { file: 'models/htdemucs.onnx', bytes: 6469436,
             sha256: 'e9bdea7e706cacd2ec75b84e8c3cb577e30fea18fa9becd8cff26fe4fcde8c31' },
    weights: { file: 'models/955717e8-8726e21a.th', name: '955717e8-8726e21a.th', bytes: 84141911,
               sha256: '8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4',
               source: 'https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/955717e8-8726e21a.th' },
    inputs: { mag: [1, 4, 2048, 336], mix: [1, 2, 343980] },
    outputs: { spec_out: [1, 4, 4, 2048, 336], wave_out: [1, 4, 2, 343980] },
  },
  htdemucs_6s: {
    id: 'htdemucs_6s', label: '6 stems (adds guitar, piano)',
    note: 'Demucs v4 6-source model (htdemucs_6s). Upstream says the piano stem is not working great.',
    stems: ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'],
    graph: { file: 'models/htdemucs_6s.onnx', bytes: 5000199,
             sha256: '792568d1efb79451c92695199fdc4225c37dddea115348ef80e13677fdedf7d9' },
    weights: { file: 'models/5c90dfd2-34c22ccb.th', name: '5c90dfd2-34c22ccb.th', bytes: 54996327,
               sha256: '34c22ccb381c6f9fdbf324f04e1e2fe21aaaf293f5ded163a162697ff9a02ddd',
               source: 'https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/5c90dfd2-34c22ccb.th' },
    inputs: { mag: [1, 4, 2048, 336], mix: [1, 2, 343980] },
    outputs: { spec_out: [1, 6, 4, 2048, 336], wave_out: [1, 6, 2, 343980] },
  },
};

export const DEFAULT_MODEL = 'htdemucs';
