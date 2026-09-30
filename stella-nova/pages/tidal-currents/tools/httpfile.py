import urllib.request, io
class HttpFile(io.RawIOBase):
    """Read-only file-like object over HTTP Range requests with a block cache."""
    def __init__(self, url, block=1<<18):
        self.url, self.block, self.pos, self.cache, self.nreq, self.nbytes = url, block, 0, {}, 0, 0
        req = urllib.request.Request(url, method='HEAD')
        self.size = int(urllib.request.urlopen(req, timeout=60).headers['Content-Length'])
    def readable(self): return True
    def seekable(self): return True
    def tell(self): return self.pos
    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos
    def _fetch(self, a, b):
        for t in range(5):
            try:
                req = urllib.request.Request(self.url, headers={'Range': f'bytes={a}-{b-1}'})
                d = urllib.request.urlopen(req, timeout=120).read()
                self.nreq += 1; self.nbytes += len(d); return d
            except Exception as e:
                err = e
        raise err
    def readinto(self, buf):
        n = min(len(buf), self.size - self.pos)
        if n <= 0: return 0
        a, b = self.pos, self.pos + n
        if n > 4 * self.block:  # large read: fetch directly
            d = self._fetch(a, b)
        else:
            b0, b1 = a // self.block, (b - 1) // self.block
            missing = [i for i in range(b0, b1 + 1) if i not in self.cache]
            if missing:
                lo, hi = missing[0], missing[-1]
                d = self._fetch(lo * self.block, min(self.size, (hi + 1) * self.block))
                for i in range(lo, hi + 1):
                    self.cache[i] = d[(i - lo) * self.block:(i - lo + 1) * self.block]
            d = b''.join(self.cache[i] for i in range(b0, b1 + 1))[a - b0 * self.block:][:n]
        buf[:n] = d; self.pos += n; return n
