// em-explorer CATALOG package: public API.
//
// The catalog holds what the page knows about its data, as plain records.
// It does no fetching. CORE reads it at boot, DATA opens volumes from its
// dataset records, and SAVER flies between its bookmarks.
//
// API
//   DATASETS        array of dataset records (catalog/datasets.js):
//     { id, name, short, organism, tissue, method, blurb,
//       voxel [nm x,y,z], size [x,y,z] voxels of scale 0,
//       format 'precomputed' | 'zarr', url (https:// or gs://),
//       home { x, y, z, zoom, plane }  first view (VIEW units),
//       licence, licenceUrl, credit, links [{ label, href }] }
//   BOOKMARKS       array of places (catalog/bookmarks.js):
//     { id, dataset, x, y, z (voxels of scale 0, 0-based), zoom (CSS px
//       per scale-0 voxel), plane 'xy'|'xz'|'yz', title, caption, source,
//       found 'annotation'|'groundtruth'|'survey' }
//   ABOUT           { title, paragraphs, sections: [{ title, paragraphs }] }
//   SCALE_FACTS     [{ name, nm, text, source }]
//   DEFAULT_DATASET id of the first dataset to open
//   datasetById(id) -> record | null
//   bookmarksFor(id) -> the bookmarks of one dataset, in catalog order
//   bookmarkById(id) -> bookmark | null
//   homeView(id)    -> { x, y, z, zoom, plane } (the record's home, or the
//                      volume centre at a whole-volume zoom)
//   nmOf(bookmark)  -> { x, y, z } in nm (scale-0 voxel x voxel size)
//
// All text is plain text. CORE must set it with textContent.
//
// Find things (grep -n):
//   'export const DATASETS'   catalog/datasets.js
//   'export const BOOKMARKS'  catalog/bookmarks.js
//   'export const ABOUT'      catalog/about.js
//   'export function homeView' catalog/index.js

import { DATASETS, DEFAULT_DATASET } from './datasets.js';
import { BOOKMARKS } from './bookmarks.js';
import { ABOUT, SCALE_FACTS } from './about.js';

export { DATASETS, DEFAULT_DATASET, BOOKMARKS, ABOUT, SCALE_FACTS };

export const CATALOG_API_VERSION = 1;

export function datasetById(id) {
  return DATASETS.find((d) => d.id === id) || null;
}

export function bookmarksFor(id) {
  return BOOKMARKS.filter((b) => b.dataset === id);
}

export function bookmarkById(id) {
  return BOOKMARKS.find((b) => b.id === id) || null;
}

export function homeView(id) {
  const d = datasetById(id);
  if (!d) return null;
  if (d.home) return { ...d.home };
  const [sx, sy, sz] = d.size;
  return { x: Math.floor(sx / 2), y: Math.floor(sy / 2), z: Math.floor(sz / 2), zoom: 900 / Math.max(sx, sy), plane: 'xy' };
}

export function nmOf(b) {
  const d = datasetById(b && b.dataset);
  if (!d) return null;
  return { x: b.x * d.voxel[0], y: b.y * d.voxel[1], z: b.z * d.voxel[2] };
}
