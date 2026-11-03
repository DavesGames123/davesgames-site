#!/usr/bin/env python3
# ============================================================================
#  ARTICRAFT PLAYGROUND  ·  tools/select.py — pick the records to ship
# ----------------------------------------------------------------------------
#  This script reads the dataset manifest and writes tools/selection.tsv.
#  It uses only the Python standard library. Run it with python3 -I.
#
#  Two stages:
#    pool   ... rating-5 records, a quota per group, a round robin over the
#               categories of each group, four times the quota. Writes
#               tools/pool.txt (sparse-checkout paths for the pool).
#    rank   ... after compile.sh --fetch-pool, read model.py and prompt.txt of
#               each pool record. Drop brand, product and weapon words. Count
#               the joints. Write tools/selection.tsv, primary rows first and
#               then reserve rows, per group.
#
#  GREP MAP
#    QUOTA .............. objects per group
#    BANNED_WORDS ....... brand, product and weapon words (whole word match)
#    BANNED_CATEGORIES .. categories that are not shipped
#    def pool_stage ..... stage 1
#    def rank_stage ..... stage 2
#    def joint_count .... joint count from model.py text
#
#  Usage:  python3 -I tools/select.py pool|rank <S>
#          S is the scratch folder that holds data/ (see CONTRACT.md).
# ============================================================================
import json, os, random, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SEED = 20261103

QUOTA = {
    'robotic_arms_and_manipulators': 12,
    'kinematic_chains': 5,
    'linear_stages_and_gantries': 6,
    'primitive_joints_and_modules': 4,
    'mounts_and_positioning': 5,
    'tools_and_workshop': 5,
    'household_appliances': 6,
    'furniture_and_storage': 4,
    'electronics_and_optics': 4,
    'vehicles_and_mobility': 4,
    'doors_gates_and_access': 3,
    'buildings_and_infrastructure': 3,
    'outdoor_and_recreation': 4,
    'commercial_coinop_and_vending': 1,
}
POOL_FACTOR = 4

# Brand names, product names and trademarks. Also weapon words: the military
# group is not shipped, and a weapon in another group is not shipped either.
BANNED_WORDS = [
    'zippo', 'roland', 'cdj', 'pioneer', 'technics', 'bakelite', 'bluetooth', 'wi-fi', 'wifi',
    'apple', 'iphone', 'ipad', 'imac', 'macbook', 'airpods', 'samsung', 'sony', 'playstation',
    'nintendo', 'xbox', 'microsoft', 'dell', 'lenovo', 'thinkpad', 'nvidia', 'geforce', 'intel',
    'amd', 'ryzen', 'raspberry', 'arduino', 'canon', 'nikon', 'leica', 'hasselblad', 'gopro',
    'polaroid', 'kodak', 'fender', 'gibson', 'yamaha', 'moog', 'korg', 'akai', 'dyson',
    'kitchenaid', 'nespresso', 'keurig', 'vitamix', 'weber', 'ikea', 'herman', 'aeron', 'eames',
    'vespa', 'segway', 'jeep', 'tesla', 'ferrari', 'porsche', 'harley', 'honda', 'toyota',
    'ford', 'volkswagen', 'vw', 'bmw', 'mercedes', 'boeing', 'airbus', 'cessna', 'dji', 'lego',
    'rubik', 'kuka', 'fanuc', 'abb', 'universal robots', 'ur5', 'ur10', 'franka', 'panda',
    'kinova', 'stanley', 'dewalt', 'makita', 'bosch', 'milwaukee', 'leatherman', 'swiss army',
    'victorinox', 'stihl', 'black & decker', 'xerox', 'hp', 'epson', 'brother', 'olivetti',
    'remington', 'underwood', 'singer', 'rolex', 'omega', 'casio', 'seiko', 'game boy',
    'walkman', 'thermos', 'tupperware', 'pez', 'gumball', 'pac-man', 'pacman', 'atari',
    'coca-cola', 'pepsi', 'ferris', 'big ben', 'eiffel', 'brompton', 'razor', 'trek',
    'peloton', 'sega', 'wurlitzer', 'jukebox', 'zeiss', 'swarovski', 'celestron', 'meade',
    'hubble', 'arri', 'red one', 'steadicam', 'jacuzzi', 'formica', 'velcro', 'dumpster',
    'taser', 'segway', 'bobcat', 'caterpillar', 'john deere', 'otis', 'kone', 'schindler',
    # weapons
    'cannon', 'gun', 'guns', 'rifle', 'pistol', 'missile', 'launcher', 'turret', 'artillery',
    'howitzer', 'mortar', 'torpedo', 'weapon', 'weapons', 'military', 'tank', 'war', 'warship',
    'grenade', 'bomb', 'catapult', 'trebuchet', 'ballista', 'crossbow', 'bayonet', 'sword',
    'napoleonic', 'regimental', 'battle', 'combat', 'army',
]
BANNED_RE = re.compile(r'(?<![a-z0-9])(' + '|'.join(re.escape(w) for w in BANNED_WORDS) + r')(?![a-z0-9])', re.I)
# Product codes such as "TR-808", "XR500" or "MK2". Paper sizes and ratios pass.
CODE_RE = re.compile(r'\b(?:[A-Z]{2,4}-?\d{2,4}[A-Z]?|MK\s?[IVX0-9]+|Mark\s+(?:II|III|IV|V))\b')
CODE_OK = {'A3', 'A4', 'A5'}
BANNED_CATEGORIES = {'zippo_lighter', 'casino_machine', 'cannon', 'missile_launcher', 'remote_weapon_station'}

ALLOWED_IMPORT = re.compile(r'^\s*(?:from\s+(cadquery|math|sdk|numpy|typing|dataclasses|__future__)(?:\.\w+)*\s+import|import\s+(cadquery|math|numpy|typing|dataclasses)(?:\s+as\s+\w+)?\s*$)')


def banned_text(text):
    m = BANNED_RE.search(text)
    if m: return m.group(1)
    for c in CODE_RE.findall(text):
        if c not in CODE_OK: return c
    return None


def load(S):
    sc = json.load(open(os.path.join(S, 'data', 'supercategories.json')))['supercategories']
    c2g = {c: s['slug'] for s in sc for c in s['category_slugs']}
    recs = []
    for line in open(os.path.join(S, 'data', 'records_manifest.jsonl')):
        j = json.loads(line)
        if j.get('rating') != 5 or j.get('run_status') != 'success': continue
        g = c2g.get(j.get('category_slug'))
        if g not in QUOTA or j['category_slug'] in BANNED_CATEGORIES: continue
        if banned_text((j.get('title') or '') + ' ' + (j.get('prompt_preview') or '')): continue
        j['group'] = g
        recs.append(j)
    return sc, recs


def paths_for(j):
    r, rev = j['record_id'], j['active_revision_id']
    return [f'/records/{r}/record.json', f'/records/{r}/revisions/{rev}/model.py', f'/records/{r}/revisions/{rev}/prompt.txt']


def pool_stage(S):
    _, recs = load(S)
    rnd = random.Random(SEED)
    pool = []
    for g, q in QUOTA.items():
        bycat = {}
        for j in recs:
            if j['group'] == g: bycat.setdefault(j['category_slug'], []).append(j)
        cats = sorted(bycat)
        rnd.shuffle(cats)
        for c in cats: rnd.shuffle(bycat[c])
        want, picked, i = q * POOL_FACTOR, [], 0
        while len(picked) < want and any(bycat[c] for c in cats):
            c = cats[i % len(cats)]; i += 1
            if bycat[c]: picked.append(bycat[c].pop())
        pool += picked
        print(f'{g:34s} quota {q:2d} pool {len(picked):3d} from {len(cats)} categories')
    with open(os.path.join(HERE, 'pool.txt'), 'w') as f:
        for j in pool: f.write(f"{j['group']}\t{j['record_id']}\t{j['active_revision_id']}\n")
    with open(os.path.join(S, 'pool-paths.txt'), 'w') as f:
        for j in pool: f.write('\n'.join(paths_for(j)) + '\n')
    print(f'pool {len(pool)} records -> tools/pool.txt')


def joint_count(src):
    # One model.articulation(...) call is one joint. A call in a loop makes
    # more joints, so a "for" before the call counts as two joints at least.
    n = len(re.findall(r'ArticulationType\.(?:REVOLUTE|CONTINUOUS|PRISMATIC)', src))
    return n


def unsafe(src):
    for line in src.splitlines():
        s = line.strip()
        if re.match(r'^(import|from)\s', s) and not ALLOWED_IMPORT.match(line): return 'import: ' + s[:60]
    m = re.search(r'open\(|subprocess|\bos\.|socket|\beval\(|\bexec\(|__import__', src)
    return ('call: ' + m.group(0)) if m else None


def rank_stage(S):
    _, recs = load(S)
    byid = {j['record_id']: j for j in recs}
    rows, dropped = [], {}
    for line in open(os.path.join(HERE, 'pool.txt')):
        g, r, rev = line.rstrip('\n').split('\t')
        j = byid[r]
        base = os.path.join(S, 'data', 'records', r, 'revisions', rev)
        try:
            src = open(os.path.join(base, 'model.py')).read()
            prompt = open(os.path.join(base, 'prompt.txt')).read().strip()
        except OSError:
            dropped[r] = 'not fetched'; continue
        why = banned_text(prompt) or None
        if why: dropped[r] = 'word: ' + why; continue
        u = unsafe(src)
        if u: dropped[r] = u; continue
        n = joint_count(src)
        if n < 1: dropped[r] = 'no joints'; continue
        # several joints are best; very many joints make a slow, busy object
        score = (min(n, 6) if n <= 10 else 6 - (n - 10) * 0.5) - len(src) / 60000
        rows.append((g, r, rev, n, score, j['category_slug']))
    out = []
    for g, q in QUOTA.items():
        cand = sorted([x for x in rows if x[0] == g], key=lambda x: -x[4])
        primary, seen = [], {}
        # first pass: one per category, best score; then fill with the rest
        for x in cand:
            if len(primary) < q and x[5] not in seen: primary.append(x); seen[x[5]] = 1
        for x in cand:
            if len(primary) < q and x not in primary and seen.get(x[5], 0) < 2: primary.append(x); seen[x[5]] = seen.get(x[5], 0) + 1
        reserve = [x for x in cand if x not in primary]
        for x in primary: out.append((x, 'primary'))
        for x in reserve: out.append((x, 'reserve'))
        print(f'{g:34s} primary {len(primary):2d}/{q:2d} reserve {len(reserve):3d}  joints {[x[3] for x in primary]}')
    with open(os.path.join(HERE, 'selection.tsv'), 'w') as f:
        f.write('# group\trecord\trevision\tjoints_in_model_py\tcategory\trole\n')
        for x, role in out: f.write(f'{x[0]}\t{x[1]}\t{x[2]}\t{x[3]}\t{x[5]}\t{role}\n')
    print(f'dropped {len(dropped)}: ' + ', '.join(sorted(set(dropped.values())))[:400])
    print('wrote tools/selection.tsv')


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] not in ('pool', 'rank'): sys.exit(__doc__ or 'usage: select.py pool|rank <S>')
    (pool_stage if sys.argv[1] == 'pool' else rank_stage)(sys.argv[2])
