#!/usr/bin/env python3
# ============================================================================
#  MOLECULES  ·  build/fetch.py  ·  download the PubChem records of the list
# ----------------------------------------------------------------------------
#  Reads build/list.tsv (category, name, PubChem query, description) and
#  writes the PubChem records to a cache folder. build/build.mjs reads the
#  cache and writes data/library.json. Only the build runs this script: the
#  page and tests.mjs never call PubChem.
#
#    python3 -I build/fetch.py <cache-dir> [list.tsv]
#
#  PubChem (NCBI) data is in the public domain. The PUG-REST usage policy
#  allows at most 5 requests per second. This script sends at most 3, sends
#  CIDs in batches of 100 where the API accepts a list, and keeps every
#  answer in the cache, so a second run sends only the missing requests.
#
#  Cache files
#    name/<query>.txt   the CIDs for a name query (first line is used)
#    prop/<cid>.json    title, formula, weight, SMILES, IUPAC name, charge
#    syn/<cid>.json     the synonym list
#    sdf3d/<cid>.sdf    the first PubChem 3D conformer ("none" if absent)
#    sdf2d/<cid>.sdf    the 2D record (connectivity, charges, PubChem 2D)
#
#  grep -n targets: "def get", "def resolve", "def batch", "def main"
# ============================================================================
import json, os, sys, time, urllib.parse, urllib.request, urllib.error

BASE = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug'
UA = 'davesgames.io molecule library build (static site; cached, batched)'
GAP = 0.34          # seconds between requests: under 3 per second
_last = [0.0]

def get(url, data=None, tries=5):
    """GET (or POST form data) with the rate limit and a retry on 5xx."""
    for k in range(tries):
        wait = _last[0] + GAP - time.time()
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode() if data else None, headers={'User-Agent': UA})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (400, 404):
                return None
            if e.code in (500, 502, 503, 504) and k < tries - 1:
                time.sleep(2 + 3 * k)
                continue
            raise
        except urllib.error.URLError:
            if k < tries - 1:
                time.sleep(2 + 3 * k)
                continue
            raise
    return None

def cached(path, fetch):
    if os.path.exists(path):
        with open(path, 'rb') as f:
            return f.read()
    body = fetch()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(body if body is not None else b'none')
    return body if body is not None else b'none'

def resolve(cache, query):
    """A query is a name or 'cid:<n>'. Returns the CID or None."""
    if query.startswith('cid:'):
        return int(query[4:])
    key = urllib.parse.quote(query.lower(), safe='')
    body = cached(os.path.join(cache, 'name', key + '.txt'),
                  lambda: get(BASE + '/compound/name/cids/TXT', {'name': query}))
    first = body.decode().strip().split('\n')[0].strip()
    return int(first) if first.isdigit() else None

def batch(cache, sub, cids, url_of, split):
    """Fetch the records that are not in the cache, 100 CIDs per request."""
    todo = [c for c in cids if not os.path.exists(os.path.join(cache, sub, '%d.%s' % (c, 'sdf' if sub.startswith('sdf') else 'json')))]
    for i in range(0, len(todo), 100):
        part = todo[i:i + 100]
        body = get(url_of(part))
        found = split(body) if body else {}
        for c in part:
            os.makedirs(os.path.join(cache, sub), exist_ok=True)
            ext = 'sdf' if sub.startswith('sdf') else 'json'
            with open(os.path.join(cache, sub, '%d.%s' % (c, ext)), 'w') as f:
                f.write(found.get(c, 'none'))
        print('  %s %d/%d' % (sub, min(i + 100, len(todo)), len(todo)), file=sys.stderr)

def split_sdf(body):
    out = {}
    for rec in body.decode().split('$$$$\n'):
        if rec.strip():
            cid = int(rec.split('\n', 1)[0].strip())
            out[cid] = rec + '$$$$\n'
    return out

def main():
    cache = sys.argv[1]
    here = os.path.dirname(os.path.abspath(__file__))
    lst = sys.argv[2] if len(sys.argv) > 2 else os.path.join(here, 'list.tsv')
    rows = [l.rstrip('\n').split('\t') for l in open(lst, encoding='utf-8') if l.strip() and not l.startswith('#')]
    cids, bad = [], []
    for r in rows:
        c = resolve(cache, r[2])
        if c is None:
            bad.append(r[2])
        else:
            cids.append(c)
    print('resolved %d of %d queries' % (len(cids), len(rows)), file=sys.stderr)
    for q in bad:
        print('  no CID: ' + q, file=sys.stderr)
    cids = sorted(set(cids))
    props = 'Title,MolecularFormula,MolecularWeight,SMILES,IUPACName,Charge'
    batch(cache, 'prop', cids, lambda p: '%s/compound/cid/%s/property/%s/JSON' % (BASE, ','.join(map(str, p)), props),
          lambda b: {x['CID']: json.dumps(x) for x in json.loads(b)['PropertyTable']['Properties']})
    batch(cache, 'syn', cids, lambda p: '%s/compound/cid/%s/synonyms/JSON' % (BASE, ','.join(map(str, p))),
          lambda b: {x['CID']: json.dumps(x.get('Synonym', [])[:40]) for x in json.loads(b)['InformationList']['Information']})
    batch(cache, 'sdf2d', cids, lambda p: '%s/compound/cid/%s/SDF' % (BASE, ','.join(map(str, p))), split_sdf)
    # 3D: one CID per request. A list request fails as a whole when one CID
    # has no conformer, so the batch form would lose the others.
    n = 0
    for c in cids:
        path = os.path.join(cache, 'sdf3d', '%d.sdf' % c)
        if not os.path.exists(path):
            cached(path, lambda: get('%s/compound/cid/%d/SDF?record_type=3d' % (BASE, c)))
            n += 1
            if n % 50 == 0:
                print('  sdf3d %d new' % n, file=sys.stderr)
    print('done: %d CIDs' % len(cids), file=sys.stderr)

if __name__ == '__main__':
    main()
