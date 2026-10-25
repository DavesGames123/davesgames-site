// URL stores for the em-explorer DATA package.
//
// A store maps a path inside a dataset to a fetchable https URL.
// gs://bucket/prefix goes through the GCS JSON API, because that API
// sends CORS headers for every public bucket (the plain
// storage.googleapis.com/<bucket>/ path does so only when the bucket
// owner set a CORS policy; h01-release has none).
// s3://bucket/prefix maps to https://bucket.s3.amazonaws.com/prefix.
//
// Host sharding (round 2, PERF). S3 speaks HTTP/1.1 only, so a browser
// opens at most 6 connections to one host name. For the S3 buckets in
// S3_SHARDS (region checked with x-amz-bucket-region, CORS "*" checked on
// each name on 2026-10-25), chunk paths spread over three host names of
// the same bucket: 18 connections in place of 6. A path always maps to
// the same name, so the HTTP cache stays useful. Metadata files (info,
// .zattrs, .zarray, .zgroup) stay on the first name.
//   hostOf(url) -> host name; isHttp1Host(host) -> true for S3 names.

const S3_SHARDS = {
  'janelia-cosem-datasets': 'us-east-1',
  'bossdb-open-data': 'us-east-1',
};
const META = /(^|\/)(info|\.zattrs|\.zarray|\.zgroup)$/;

function hashPath(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export function hostOf(url) {
  const m = /^https?:\/\/([^/]+)/.exec(String(url));
  return m ? m[1].toLowerCase() : '';
}

export function isHttp1Host(host) { return /(^|\.)amazonaws\.com$/.test(host); }

// The host names of one sharded S3 bucket, or null.
export function s3ShardHosts(u) {
  const m = /^https:\/\/([a-z0-9.-]+)\.s3\.amazonaws\.com(\/|$)/.exec(u);
  const region = m && S3_SHARDS[m[1]];
  if (!region) return null;
  const b = m[1];
  return [b + '.s3.amazonaws.com', b + '.s3.' + region + '.amazonaws.com', b + '.s3.dualstack.' + region + '.amazonaws.com'];
}

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
  const shards = s3ShardHosts(u);
  if (shards) {
    const rest = u.replace(/^https:\/\/[^/]+/, '');
    return {
      base: u,
      url(path) {
        if (!path) return u;
        if (META.test(path)) return u + '/' + path;
        return 'https://' + shards[hashPath(path) % shards.length] + rest + '/' + path;
      },
    };
  }
  return {
    base: u,
    url(path) { return path ? u + '/' + path : u; },
  };
}
