// URL stores for the em-explorer DATA package.
//
// A store maps a path inside a dataset to a fetchable https URL.
// gs://bucket/prefix goes through the GCS JSON API, because that API
// sends CORS headers for every public bucket (the plain
// storage.googleapis.com/<bucket>/ path does so only when the bucket
// owner set a CORS policy; h01-release has none).
// s3://bucket/prefix maps to https://bucket.s3.amazonaws.com/prefix.

export function resolveUrl(url) {
  let u = String(url || '').trim();
  u = u.replace(/^(precomputed|zarr|zarr2|n5):\/\//, '');
  u = u.replace(/\/+$/, '');
  if (u.startsWith('gs://')) {
    const rest = u.slice(5);
    const i = rest.indexOf('/');
    const bucket = i < 0 ? rest : rest.slice(0, i);
    const prefix = i < 0 ? '' : rest.slice(i + 1);
    return {
      base: u,
      url(path) {
        const key = [prefix, path].filter(Boolean).join('/');
        return 'https://storage.googleapis.com/storage/v1/b/' + bucket +
          '/o/' + encodeURIComponent(key) + '?alt=media';
      },
    };
  }
  if (u.startsWith('s3://')) {
    const rest = u.slice(5);
    const i = rest.indexOf('/');
    const bucket = i < 0 ? rest : rest.slice(0, i);
    const prefix = i < 0 ? '' : rest.slice(i + 1);
    u = 'https://' + bucket + '.s3.amazonaws.com' + (prefix ? '/' + prefix : '');
  }
  if (!/^https?:\/\//.test(u)) throw new Error('em-explorer DATA: unsupported URL ' + url);
  return {
    base: u,
    url(path) { return path ? u + '/' + path : u; },
  };
}
