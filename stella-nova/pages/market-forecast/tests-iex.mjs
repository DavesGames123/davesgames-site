// ============================================================================
//  TESTS · market-forecast/tests-iex.mjs — the IEX snapshot path, no network
// ----------------------------------------------------------------------------
//  1. tools/iex-tops.mjs reads a pcapng stream that this test builds with
//     the TOPS byte layout (SHB, IDB, EPB, Ethernet/IPv4/UDP, IEX-TP, Trade
//     Report). The stream is cut at odd places to check the block carry.
//  2. tradesToBars: session filter, odd lots, extended hours, gap fill.
//  3. snapshot merge(): the session window and the daily bars.
//  4. providers.js iexSeries(): a snapshot JSON in the committed format
//     becomes a valid Series with the IEX citation in the label.
//  Run: node stella-nova/pages/market-forecast/tests-iex.mjs (exit 1 on fail)
// ============================================================================
import { createTopsReader, tradesToBars } from './tools/iex-tops.mjs';
import { merge } from './tools/snapshot.mjs';
import { iexSeries } from './providers.js';
import { etLocalToUtc } from './synth.js';

let fails = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('FAIL ' + m); } else console.log('PASS ' + m); };

function block(type, body) {
  const len = 12 + body.length + ((4 - (body.length % 4)) % 4);
  const b = Buffer.alloc(len); b.writeUInt32LE(type, 0); b.writeUInt32LE(len, 4); body.copy(b, 8); b.writeUInt32LE(len, len - 4); return b;
}
function trade(sym, tMs, px, size, flags = 0) {
  const m = Buffer.alloc(38); m[0] = 0x54; m[1] = flags; m.writeBigInt64LE(BigInt(tMs) * 1000000n, 2);
  m.write(sym.padEnd(8, ' '), 10, 'latin1'); m.writeUInt32LE(size, 18); m.writeBigInt64LE(BigInt(Math.round(px * 1e4)), 22); m.writeBigInt64LE(1n, 30); return m;
}
function packet(msgs) {
  const body = Buffer.concat(msgs.flatMap(m => { const l = Buffer.alloc(2); l.writeUInt16LE(m.length); return [l, m]; }));
  const tp = Buffer.alloc(40); tp[0] = 1; tp.writeUInt16LE(0x8003, 2); tp.writeUInt16LE(body.length, 12); tp.writeUInt16LE(msgs.length, 14);
  const eth = Buffer.alloc(14); eth.writeUInt16BE(0x0800, 12);
  const ip = Buffer.alloc(20); ip[0] = 0x45; ip[9] = 17;
  const frame = Buffer.concat([eth, ip, Buffer.alloc(8), tp, body]);
  const hdr = Buffer.alloc(20); hdr.writeUInt32LE(frame.length, 12); hdr.writeUInt32LE(frame.length, 16);
  return block(6, Buffer.concat([hdr, frame]));
}

const open = etLocalToUtc(2026, 10, 5, 9, 30);
const shbBody = Buffer.alloc(16); shbBody.writeUInt32LE(0x1A2B3C4D, 0);
const idbBody = Buffer.alloc(8); idbBody.writeUInt16LE(1, 0);
const stream = Buffer.concat([
  block(0x0A0D0D0A, shbBody), block(1, idbBody),
  packet([trade('SPY', open - 60000, 700, 100, 0x40), trade('AAPL', open + 1000, 330.25, 100)]),
  packet([trade('SPY', open + 2000, 701.5, 200), trade('XYZ', open + 3000, 5, 10), trade('SPY', open + 4000, 702, 30, 0x20)]),
  packet([trade('SPY', open + 650000, 703.25, 50), trade('BRK.B', open + 7000, 480.5, 5)]),
]);
let last = 0;
const r = createTopsReader({ symbols: ['SPY', 'AAPL', 'BRK.B'], onAnyTrade: t => { last = Math.max(last, t); } });
for (let o = 0; o < stream.length; o += 37) r.push(stream.subarray(o, Math.min(stream.length, o + 37)));
const { trades, stats } = r.end();
ok(stats.packets === 3 && stats.tradeMsgs === 7, `reader: 3 packets, 7 trade reports (got ${stats.packets}, ${stats.tradeMsgs}) across 37-byte cuts`);
ok(trades.get('SPY').length === 4 && trades.get('AAPL').length === 1 && trades.get('BRK.B').length === 1, 'reader: keeps only the asked symbols (XYZ dropped), BRK.B with its dot');
ok(trades.get('AAPL')[0][1] === 330.25 && trades.get('AAPL')[0][0] === open + 1000, 'reader: price with 4 implied decimals and the ns timestamp to ms');
ok(last === open + 650000, 'reader: onAnyTrade sees every trade (max time 09:40:50)');

const bars = tradesToBars(trades.get('SPY'), open);
ok(bars.length === 3, `bars: 3 slots, the empty middle slot filled (got ${bars.length})`);
ok(bars[0][1] === 701.5 && bars[0][4] === 701.5 && bars[0][5] === 230, 'bars: extended-hours trade dropped, odd lot adds volume (230) but not the price');
ok(bars[1][5] === 0 && bars[1][4] === 701.5, 'bars: a gap slot repeats the last close with zero volume');
ok(bars[2][4] === 703.25 && bars[2][0] === open + 600000, 'bars: third slot at 09:40 ET');

const s1 = { date: '2026-10-05', open, bars: { SPY: bars } };
const S = merge(null, [s1], { keep: 20, keepDaily: 400, symbols: ['SPY'] });
ok(S.sessions.length === 1 && S.symbols.SPY.daily.length === 1, 'merge: one session, one daily bar');
const d = S.symbols.SPY.daily[0];
ok(d[1] === 701.5 && d[2] === 703.25 && d[4] === 703.25 && d[5] === 280, 'merge: daily open/high/close/volume from the 5-min bars');
const open2 = etLocalToUtc(2026, 10, 6, 9, 30);
const S2 = merge(S, [{ date: '2026-10-06', open: open2, bars: { SPY: tradesToBars([[open2 + 1000, 710, 10, 0]], open2) } }], { keep: 1, keepDaily: 400, symbols: ['SPY'] });
ok(S2.sessions.join() === '2026-10-06' && S2.symbols.SPY.daily.length === 2, 'merge: window keeps the newest session; daily bars carry forward');

S2.file = 'data/sample/iex.json';
const ser = iexSeries(S2, 'SPY', '5min');
ok(ser.c.length === 1 && ser.source.id === 'iex' && !ser.source.synthetic, 'iexSeries: a valid real Series');
ok(/Data provided for free by IEX/.test(ser.source.label) && /committed sample/.test(ser.source.label), 'iexSeries: label cites IEX and marks the committed sample');
let threw = false; try { iexSeries(S2, 'ZZZZ', '5min'); } catch (e) { threw = /not in the IEX snapshot/.test(e.message); }
ok(threw, 'iexSeries: an unknown ticker names the key-based providers');

console.log(`${n - fails} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
