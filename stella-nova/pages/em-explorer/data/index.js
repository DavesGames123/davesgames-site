// em-explorer DATA package: public API.
//
// This module streams volume-EM data from public buckets. It reads
// neuroglancer precomputed volumes (sharded v1 and unsharded) and
// OME-Zarr v2 multiscale groups. It decodes JPEG, raw, gzip, zstd and
// blosc-lz4 chunks, keeps them in a byte-capped LRU cache, and builds 2D
// slices for the VIEW package. All fetch and decode work runs in a
// module worker (data/worker.js). Where no module worker is available
// (node tests, old browsers), the same engine runs on the calling thread.
//
// API
//   openVolume(record, opts?) -> Promise<Volume>
//     record: { id, format: 'precomputed' | 'zarr', url }
//       url: https://... or gs://bucket/path (gs:// goes through the GCS
//       JSON API, which sends CORS headers for every public bucket).
//       format is optional: the reader tries `info`, then `.zattrs`.
//       Optional: maxScales (keep the first N scales), name.
//     opts: { worker: true|false, cacheBytes, maxInFlight }
//   setPhone(bool)        cache cap 96 MB (phone) or 256 MB (desktop).
//   setCacheBytes(n)      set the cache cap in bytes.
//
// Volume
//   id, format, dtype ('uint8'), yzOrder ('zy': yz plane is u=z, v=y)
//   scales[i] = { key, size [x,y,z], resolution [nm], chunk [x,y,z],
//                 encoding, voxelOffset [x,y,z] (voxels of this scale) }
//   bounds = { min [nm], max [nm] } of scale 0.
//   getSlice(scaleIndex, plane, index, rect, { signal, priority })
//     -> Promise<{ data: Uint8Array, width, height }>
//     plane 'xy' | 'xz' | 'yz'; (u, v) = xy:(x, y), xz:(x, z), yz:(z, y).
//     index: voxel on the normal axis, this scale. rect [u0, v0, u1, v1)
//     in voxels of this scale, 0-based (voxelOffset is folded in).
//     data is row-major, rows along v. Voxels outside the volume are 0.
//   getChunk(scaleIndex, [cx, cy, cz], { signal, priority })
//     -> Promise<{ data: Uint8Array, shape [x,y,z] }>  (x is fastest)
//   setFocus({ x, y, z })  view centre in nm. Queued requests nearest
//     to the focus go first, when the caller gives no priority.
//   cancelAll()           drop all queued and in-flight requests.
//   stats() -> Promise<{ cacheBytes, cacheCap, chunks, inFlight, queued,
//                        fetched, fetchedBytes, errors }>
//   dispose()             cancel all and release the reader.
//
// Rules: at most 8 fetches in flight; an aborted signal removes its
// requests when no other caller waits for the same chunk. A missing shard,
// minishard entry or zarr chunk gives a chunk of zeros (fill value).
//
// Find things (grep -n):
//   'export async function openVolume'   data/index.js
//   'function createEngine'              data/engine.js
//   'function chunkId'                   data/precomputed.js  (morton)
//   'function readShardedChunk'          data/precomputed.js
//   'function openZarr'                  data/zarr.js
//   'function murmur3_x86_128'           data/hash.js
//   'function decodeBlosc'               data/codecs.js
//   'function lz4Block'                  data/codecs.js
//   'function decodeJpegBrowser'         data/codecs.js
//   'class ByteLRU'                      data/cache.js
//   'class Scheduler'                    data/scheduler.js
//   'function assembleSlice'             data/slice.js
//   'function resolveUrl'                data/urls.js

export const DATA_API_VERSION = 1;

export async function openVolume(record) {
  throw new Error('em-explorer DATA: openVolume is not ready yet (' + (record && record.id) + ')');
}

export function setPhone() {}
export function setCacheBytes() {}
