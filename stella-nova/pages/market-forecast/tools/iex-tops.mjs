// ============================================================================
//  IEX TOPS READER  ·  market-forecast/tools/iex-tops.mjs (node only)
// ----------------------------------------------------------------------------
//  IEX Exchange publishes each session's TOPS feed as one gzipped pcapng
//  file (HIST, T+1, free; https://www.iex.io/products/market-data-
//  connectivity/hist-terms). This module reads such a stream and keeps
//  only the trade reports of a short symbol list, as 5-minute bars of the
//  regular session (09:30-16:00 ET).
//
//  Layers, outer to inner:
//    pcapng blocks     Enhanced Packet Block (type 6) holds one frame
//    Ethernet/IPv4/UDP the IEX-TP payload starts after the UDP header
//    IEX-TP header     40 bytes; message protocol 0x8003 = TOPS
//    messages          2-byte length, then the message
//    Trade Report      type 0x54: flags u8, timestamp i64 ns, symbol 8
//                      ASCII, size u32, price i64 (4 decimals), trade id
//  Sale condition flags: 0x40 extended hours, 0x20 odd lot. The bars keep
//  regular-session trades only. An odd lot adds volume but does not set
//  the open, high, low or close (the consolidated tape rule). A 5-min slot
//  with no trade between two traded slots repeats the last close with
//  zero volume; slots before the first and after the last trade are cut.
//
//  The bars are IEX-venue trades only: real prices, but IEX volume is a
//  small part of the consolidated volume. The page says so on each chart.
//
//  API
//    createTopsReader({ symbols, onTrade?, onAnyTrade? }) -> { push(buf), end(), stats }
//      onAnyTrade(tMs) sees every trade report (all symbols): the caller
//      uses it to stop after the close
//    tradesToBars(trades, sessionOpenMs, barMs = 300000) -> bars
//    readTopsStream(readable, opts) -> Promise<{ trades, stats }>
//  grep -n targets: "function createTopsReader", "function tradesToBars"
// ============================================================================

const SHB = 0x0A0D0D0A, IDB = 1, EPB = 6, SPB = 3;

export function createTopsReader({ symbols, onTrade, onAnyTrade } = {}) {
  const want = new Map();
  for (const s of symbols) want.set(s.padEnd(8, ' '), s);
  const trades = new Map();     // sym -> [tNs(Number ms), price, size, flags]
  for (const s of symbols) trades.set(s, []);
  const stats = { blocks: 0, packets: 0, messages: 0, tradeMsgs: 0, kept: 0, bytes: 0, le: true };
  let carry = null;
  let linkType = 1;

  function frame(d) {
    // Ethernet (with an optional 802.1Q tag), IPv4, UDP
    let o = 12, et = d.readUInt16BE(o); o += 2;
    if (et === 0x8100) { et = d.readUInt16BE(o + 2); o += 4; }
    if (et !== 0x0800) return;
    const ihl = (d[o] & 0x0f) * 4;
    if (d[o + 9] !== 17) return;
    o += ihl + 8;
    if (d.length < o + 40) return;
    const proto = d.readUInt16LE(o + 2);
    if (proto !== 0x8003) return;
    const plen = d.readUInt16LE(o + 12), count = d.readUInt16LE(o + 14);
    let m = o + 40; const end = Math.min(d.length, m + plen);
    for (let k = 0; k < count && m + 2 <= end; k++) {
      const len = d.readUInt16LE(m); m += 2;
      stats.messages++;
      if (d[m] === 0x54 && len >= 38) {
        stats.tradeMsgs++;
        if (onAnyTrade) onAnyTrade(Number(d.readBigInt64LE(m + 2) / 1000000n));
        const key = d.toString('latin1', m + 10, m + 18), sym = want.get(key);
        if (sym) {
          const flags = d[m + 1];
          const tNs = d.readBigInt64LE(m + 2), size = d.readUInt32LE(m + 18), px = Number(d.readBigInt64LE(m + 22)) / 1e4;
          const t = Number(tNs / 1000000n);
          trades.get(sym).push([t, px, size, flags]);
          stats.kept++;
          if (onTrade) onTrade(sym, t, px, size, flags);
        }
      }
      m += len;
    }
  }

  function push(buf) {
    stats.bytes += buf.length;
    let b = carry ? Buffer.concat([carry, buf]) : buf, o = 0;
    while (b.length - o >= 12) {
      const type = stats.le ? b.readUInt32LE(o) : b.readUInt32BE(o);
      if (type === SHB) { const bom = b.readUInt32LE(o + 8); stats.le = bom === 0x1A2B3C4D; }
      const total = stats.le ? b.readUInt32LE(o + 4) : b.readUInt32BE(o + 4);
      if (total < 12 || total % 4) throw new Error('pcapng: bad block length ' + total + ' at ' + (stats.bytes - b.length + o));
      if (b.length - o < total) break;
      stats.blocks++;
      if (type === IDB) linkType = stats.le ? b.readUInt16LE(o + 8) : b.readUInt16BE(o + 8);
      else if (type === EPB && linkType === 1) {
        const cap = stats.le ? b.readUInt32LE(o + 20) : b.readUInt32BE(o + 20);
        stats.packets++;
        frame(b.subarray(o + 28, o + 28 + cap));
      } else if (type === SPB && linkType === 1) {
        const len = total - 16; stats.packets++;
        frame(b.subarray(o + 12, o + 12 + len));
      }
      o += total;
    }
    carry = o < b.length ? Buffer.from(b.subarray(o)) : null;
  }
  return { push, end() { return { trades, stats }; }, stats, trades };
}

// trades: [[tMs, price, size, flags]] sorted by time. Regular session
// only: 09:30 <= t < 16:00 ET (open given as UTC ms).
export function tradesToBars(trades, openMs, barMs = 300000) {
  const n = Math.round(390 * 60000 / barMs), bars = [];
  const slot = Array.from({ length: n }, () => null);
  for (const [t, px, size, flags] of trades) {
    if (flags & 0x40) continue;
    const k = Math.floor((t - openMs) / barMs);
    if (k < 0 || k >= n) continue;
    let b = slot[k];
    if (!b) b = slot[k] = { o: NaN, h: -Infinity, l: Infinity, c: NaN, v: 0 };
    b.v += size;
    if (flags & 0x20) continue;
    if (Number.isNaN(b.o)) b.o = px;
    b.h = Math.max(b.h, px); b.l = Math.min(b.l, px); b.c = px;
  }
  let last = NaN, lastK = -1;
  for (let k = 0; k < n; k++) if (slot[k] && !Number.isNaN(slot[k].o)) lastK = k;
  // fill gaps between trades only: a half day (13:00 close) stops at its
  // last trade, not with flat bars to 16:00
  for (let k = 0; k <= lastK; k++) {
    const b = slot[k];
    if (b && !Number.isNaN(b.o)) { last = b.c; bars.push([openMs + k * barMs, b.o, b.h, b.l, b.c, b.v]); }
    else if (!Number.isNaN(last)) bars.push([openMs + k * barMs, last, last, last, last, b ? b.v : 0]);
  }
  return bars;
}

export async function readTopsStream(readable, opts) {
  const r = createTopsReader(opts);
  for await (const chunk of readable) r.push(chunk);
  return r.end();
}
