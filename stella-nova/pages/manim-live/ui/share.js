// ============================================================================
//  SHARE  ·  code <-> URL hash  (pure, browser and node 18+)
// ----------------------------------------------------------------------------
//  The hash is "#code=<data>&scene=<name>&q=<quality>". <data> is the
//  UTF-8 code, compressed with CompressionStream('deflate') and written
//  as base64url with the prefix "z". Where CompressionStream is absent,
//  <data> is plain base64url with the prefix "u". decodeShare reads both.
//
//  EXPORTS   (grep -n "export" share.js)
//    b64urlEncode / b64urlDecode   bytes <-> base64url text
//    encodeShare({code, scene, quality}) -> "#code=..."
//    decodeShare(hash) -> {code, scene, quality} or null
// ============================================================================

export function b64urlEncode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(text) {
  const b = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b + '='.repeat((4 - b.length % 4) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes, stream) {
  const body = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

export async function encodeShare({ code, scene, quality } = {}) {
  const raw = new TextEncoder().encode(code || '');
  let data;
  if (typeof CompressionStream === 'function') data = 'z' + b64urlEncode(await pipe(raw, new CompressionStream('deflate')));
  else data = 'u' + b64urlEncode(raw);
  const parts = [`code=${data}`];
  if (scene) parts.push(`scene=${encodeURIComponent(scene)}`);
  if (quality) parts.push(`q=${encodeURIComponent(quality)}`);
  return '#' + parts.join('&');
}

export async function decodeShare(hash) {
  const h = String(hash || '').replace(/^#/, '');
  if (!h) return null;
  const params = new Map(h.split('&').map(kv => {
    const i = kv.indexOf('=');
    return i < 0 ? [kv, ''] : [kv.slice(0, i), kv.slice(i + 1)];
  }));
  const data = params.get('code');
  if (!data) return null;
  let code;
  try {
    const kind = data[0], body = b64urlDecode(data.slice(1));
    if (kind === 'z') {
      if (typeof DecompressionStream !== 'function') return null;
      code = new TextDecoder().decode(await pipe(body, new DecompressionStream('deflate')));
    } else if (kind === 'u') code = new TextDecoder().decode(body);
    else return null;
  } catch { return null; }
  const dec = v => { try { return v ? decodeURIComponent(v) : null; } catch { return null; } };
  return { code, scene: dec(params.get('scene')), quality: dec(params.get('q')) };
}
