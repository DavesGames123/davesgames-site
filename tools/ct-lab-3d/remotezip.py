"""remotezip.py - read members of a large remote ZIP file with HTTP range requests.

CT Lab 3D data tool. The walnut data set (Der Sarkissian et al. 2019) is in
6 GB ZIP files on Zenodo. We need only some reconstruction slices, so this
module reads the ZIP central directory and the wanted members with HTTP
Range requests. It never downloads the whole file.

Usage as a module:
    from remotezip import RemoteZip
    z = RemoteZip(url)
    names = z.namelist()
    data = z.read(name)

Usage as a script (list the members):
    python3 -I tools/ct-lab-3d/remotezip.py URL

grep handles: class RangeFile, class RemoteZip, def namelist, def read
"""
import io
import sys
import urllib.request
import zipfile

BLOCK = 1 << 18  # 256 KiB read blocks


class RangeFile(io.RawIOBase):
    """A seekable, read-only file object over HTTP Range requests, with a block cache."""

    def __init__(self, url, cache_blocks=64):
        self.url = url
        self.pos = 0
        self.cache = {}
        self.order = []
        self.cache_blocks = cache_blocks
        self.fetched = 0
        req = urllib.request.Request(url, headers={'Range': 'bytes=0-0'})
        with urllib.request.urlopen(req, timeout=120) as r:
            cr = r.headers.get('Content-Range')
            if not cr:
                raise IOError('server does not support Range: ' + url)
            self.size = int(cr.split('/')[-1])

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        if whence == 0:
            self.pos = off
        elif whence == 1:
            self.pos += off
        else:
            self.pos = self.size + off
        return self.pos

    def _block(self, b):
        if b in self.cache:
            return self.cache[b]
        lo = b * BLOCK
        hi = min(self.size, lo + BLOCK) - 1
        req = urllib.request.Request(self.url, headers={'Range': f'bytes={lo}-{hi}'})
        for attempt in range(5):
            try:
                with urllib.request.urlopen(req, timeout=180) as r:
                    data = r.read()
                break
            except Exception:
                if attempt == 4:
                    raise
        self.fetched += len(data)
        self.cache[b] = data
        self.order.append(b)
        if len(self.order) > self.cache_blocks:
            old = self.order.pop(0)
            self.cache.pop(old, None)
        return data

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        n = max(0, min(n, self.size - self.pos))
        out = bytearray()
        while n > 0:
            b, o = divmod(self.pos, BLOCK)
            blk = self._block(b)
            take = min(n, len(blk) - o)
            out += blk[o:o + take]
            self.pos += take
            n -= take
        return bytes(out)

    def readinto(self, buf):
        d = self.read(len(buf))
        buf[:len(d)] = d
        return len(d)


class RemoteZip:
    """zipfile.ZipFile over a RangeFile."""

    def __init__(self, url):
        self.f = RangeFile(url)
        self.z = zipfile.ZipFile(self.f)

    def namelist(self):
        return self.z.namelist()

    def info(self, name):
        return self.z.getinfo(name)

    def read(self, name):
        return self.z.read(name)

    @property
    def fetched(self):
        return self.f.fetched


if __name__ == '__main__':
    z = RemoteZip(sys.argv[1])
    for i in z.z.infolist():
        print(i.filename, i.file_size, i.compress_size)
    print('fetched bytes:', z.fetched, file=sys.stderr)
