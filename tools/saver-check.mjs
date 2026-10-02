// ============================================================================
//  SAVER CHECK  ·  tools/saver-check.mjs — run one page in screensaver mode
// ----------------------------------------------------------------------------
//  Starts its own headless Chrome, opens the shell, plays one page through
//  lib/screensaver.js, and writes two screenshots and an optional recording.
//  Use it to check a window.snSaver hook before you commit it.
//
//    node tools/saver-check.mjs <key> [--port 9500] [--server http://127.0.0.1:8963]
//        [--out <dir>] [--calm 0.7] [--seconds 20] [--record] [--width 1280 --height 800]
//
//  A static server must already serve the repo root at --server, for example:
//    python3 -m http.server 8963 --bind 127.0.0.1
//  Each parallel run needs its own --port (Chrome debug port) and --out.
//
//  Output (stdout, one JSON line): mode (hook or generic), the status line,
//  page exceptions, console errors, and a motion score: the mean absolute
//  pixel change between the two screenshots, 0..255 (0 = frozen). The
//  screenshots are <out>/<key>-a.png and <key>-b.png, taken 4 s and
//  (seconds - 4) s after the page shows. With --record, the video goes to
//  <out>/dl/.
//
//  grep -n targets: "function launch", "async function main", "function motion"
// ============================================================================
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const argv = process.argv.slice(2);
const key = argv[0];
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };
const flag = n => argv.includes('--' + n);
if (!key || key.startsWith('--')) { console.error('usage: node tools/saver-check.mjs <key> [--port N] [--out dir] [--record]'); process.exit(2); }
const PORT = +opt('port', 9500);
const SERVER = opt('server', 'http://127.0.0.1:8963');
const OUT = path.resolve(opt('out', `/tmp/saver-check-${key}`));
const SECONDS = +opt('seconds', 20);
const CALM = +opt('calm', 0.7);
const W = +opt('width', 1280), H = +opt('height', 800);
const RECORD = flag('record');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(path.join(OUT, 'dl'), { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

function launch() {
  const prof = path.join(OUT, 'profile');
  const p = spawn(CHROME, ['--headless=new', '--enable-unsafe-webgpu', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
  return p;
}

// Decode an 8-bit RGB or RGBA PNG (what Chrome writes) to raw pixels.
function decodePng(buf) {
  let o = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), type = buf.toString('ascii', o + 4, o + 8), d = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; }
    if (type === 'IDAT') idat.push(d);
    o += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0, b = y ? px[(y - 1) * stride + x] : 0, c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[y * stride + x] = v & 255;
    }
  }
  return { w, h, bpp, px };
}
function motion(a, b) {
  const A = decodePng(a), B = decodePng(b);
  let s = 0, n = 0, lit = 0;
  for (let i = 0; i < A.px.length; i += A.bpp * 7) {
    for (let k = 0; k < 3; k++) s += Math.abs(A.px[i + k] - B.px[i + k]);
    if (B.px[i] + B.px[i + 1] + B.px[i + 2] > 30) lit++;
    n++;
  }
  return { motion: +(s / (n * 3)).toFixed(2), litFraction: +(lit / n).toFixed(3) };
}

async function main() {
  const chrome = launch();
  let ws;
  try {
    let list = null;
    for (let i = 0; i < 40 && !list; i++) { try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch (e) { await sleep(250); } }
    if (!list) throw new Error('chrome did not start on port ' + PORT);
    ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
    let id = 0; const pend = new Map(); const exc = [], errs = [];
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m.error); pend.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') exc.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').split('\n').slice(0, 2).join(' | '));
      if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) errs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    };
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r && r.result ? r.result.value : r; };
    const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); const b = Buffer.from(r.data, 'base64'); fs.writeFileSync(path.join(OUT, name), b); return b; };
    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: path.join(OUT, 'dl') });
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    const settings = { pages: [key], seconds: SECONDS, fade: 0.5, calm: CALM, display: 'window', record: RECORD, recordWarmup: 2, loop: false, caption: false, wakeLock: false };
    // lib/screensaver.js reads 'sn-saver-settings-v2' (the v2 key dropped older saved choices); write both keys
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{for(const k of ['sn-saver-settings','sn-saver-settings-v2'])localStorage.setItem(k, ${JSON.stringify(JSON.stringify(settings))})}catch(e){}` });
    await send('Page.navigate', { url: `${SERVER}/stella-nova/#home` });
    // The shell head waits for the Google Fonts stylesheet (near 3 s under
    // load), so poll for the controller instead of one fixed wait.
    let ok = false;
    for (let i = 0; i < 60 && ok !== true; i++) { await sleep(250); ok = await ev(`typeof snScreensaver === 'object'`); }
    if (ok !== true) throw new Error('window.snScreensaver missing in the shell');
    await ev(`snScreensaver.start(), 1`);
    // Wait until the status line names the page (it is set when the page shows).
    let hud = '';
    for (let i = 0; i < 80; i++) { hud = await ev(`(document.getElementById('sn-saver-hud')||{}).textContent||''`); if (/· (hook|generic)/.test(hud)) break; await sleep(250); }
    await sleep(4000);
    const a = await shot(`${key}-a.png`);
    await sleep(Math.max(1000, (SECONDS - 8) * 1000));
    const b = await shot(`${key}-b.png`);
    const frame = await ev(`(() => { const f = document.querySelector('#frame-wrap iframe'); const w = f && f.contentWindow; return w ? { hasHook: !!w.snSaver, generic: w.document.documentElement.classList.contains('sn-saver'), canvases: w.document.querySelectorAll('canvas').length } : null; })()`);
    await sleep(6000);
    const running = await ev(`snScreensaver.running`);
    const dl = fs.readdirSync(path.join(OUT, 'dl')).filter(f => /\.(mp4|webm)$/.test(f));
    console.log(JSON.stringify({ key, mode: (hud.match(/· (hook|generic)/) || [])[1] || 'none', hud, frame, ...motion(a, b), stoppedAtEnd: running === false, downloads: dl, exceptions: exc, consoleErrors: errs.slice(0, 12), shots: [path.join(OUT, `${key}-a.png`), path.join(OUT, `${key}-b.png`)] }));
  } finally {
    try { ws && ws.close(); } catch (e) {}
    chrome.kill('SIGKILL');
  }
}
main().catch(e => { console.log(JSON.stringify({ key, error: String(e && e.stack || e) })); process.exit(1); });
