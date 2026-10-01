#!/usr/bin/env python3
"""Write the names-only Stella Nova game catalog and its sprite set.

WHAT THIS DOES
--------------
The script reads the working tree of the private game repository. It writes
two outputs into the site:

  stella-nova/lib/game-data/catalog.json   the catalog as data
  stella-nova/lib/game-data/catalog.js     the same catalog as a classic script
                                           that sets window.SN_DATA
  stella-nova/media/sprites/<cat>/<slug>.webp (+ <slug>--2.webp and so on)

The catalog holds names, categories, tier labels, group labels, sprites,
player-visible key bindings, placement footprints of station modules, and
links between entries. It holds no quantity from game code: no cost, count,
ratio, time, rate, probability, stat or threshold. The script reads each
source as text with regular expressions. It runs no game code and copies no
algorithm.

The leak check at the end refuses to write the catalog if a field value
holds a digit. See LEAK CHECK below.

WHAT IS NOT READ
----------------
The script never opens src/ecology, src/doom, assets/doom, the sauron panel,
docs/, pending/, end, steam/, dist/, tools/, src/data, or the translator
settings window. It reads no blurb, fact, section or distance text of the
astro landmarks, and no starsign text. It runs no git command in the game
repository.

USAGE
-----
  python3 tools/wiki-export.py /path/to/barnes-hut

Run it from any directory. The site root is the parent of tools/.
The tool needs the ImageMagick `magick` command on PATH.

GREP REFERENCE
--------------
  grep -n "^def read_resources"      tools/wiki-export.py
  grep -n "^def read_modules"        tools/wiki-export.py
  grep -n "^def read_research"       tools/wiki-export.py
  grep -n "^def read_planets"        tools/wiki-export.py
  grep -n "^def read_landmarks"      tools/wiki-export.py
  grep -n "^def read_citizens"       tools/wiki-export.py
  grep -n "^def read_social"         tools/wiki-export.py
  grep -n "^def read_mind"           tools/wiki-export.py
  grep -n "^def read_flags"          tools/wiki-export.py
  grep -n "^def read_livery"         tools/wiki-export.py
  grep -n "^def read_portraits"      tools/wiki-export.py
  grep -n "^def read_controls"       tools/wiki-export.py
  grep -n "^def leak_check"          tools/wiki-export.py
  grep -n "^CATEGORIES"              tools/wiki-export.py
  grep -n "^VARIANT_CAP"             tools/wiki-export.py
"""
import concurrent.futures
import json
import os
import re
import shutil
import subprocess
import sys
import tomllib
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
SN = SITE / "stella-nova"
OUT_DATA = SN / "lib" / "game-data"
OUT_SPRITES = SN / "media" / "sprites"

# Sprite budget for the whole set, in bytes. The run fails above it.
SPRITE_BUDGET = 15 * 1024 * 1024

# Variants per entry, by category. Categories that are not listed get one.
VARIANT_CAP = {"resources": 6, "planets": 8, "modules": 4}

# Category table: id, label, group. The list order is the display order.
CATEGORIES = [
    ("resources", "Resources", "Economy"),
    ("modules", "Station modules", "Station"),
    ("research", "Research", "Research"),
    ("planets", "Planet types", "Space"),
    ("landmarks", "Deep-sky landmarks", "Space"),
    ("skills", "Skills", "Citizens"),
    ("jobs", "Jobs", "Citizens"),
    ("behaviors", "Behaviors", "Citizens"),
    ("needs", "Needs", "Citizens"),
    ("traits", "Trait axes", "Citizens"),
    ("quirks", "Quirks", "Citizens"),
    ("backstories", "Backstories", "Citizens"),
    ("starsigns", "Starsigns", "Citizens"),
    ("portraits", "Portraits", "Citizens"),
    ("relationship-tiers", "Relationship tiers", "Social"),
    ("rumor-topics", "Rumor topics", "Social"),
    ("gossip-channels", "Gossip channels", "Social"),
    ("gossip-events", "Gossip events", "Social"),
    ("social-pulses", "Social pulses", "Social"),
    ("incidents", "Incidents", "Social"),
    ("incident-categories", "Incident categories", "Social"),
    ("emotions", "Emotion dimensions", "Mind"),
    ("relationship-dimensions", "Relationship dimensions", "Mind"),
    ("flag-emblems", "Flag emblems", "Identity"),
    ("flag-patterns", "Flag patterns", "Identity"),
    ("ship-livery", "Ship livery layers", "Identity"),
]

# Field keys, per category, whose values may hold digits. A landmark
# designation (for example "NGC 1300") and object type (for example
# "Seyfert 2") are real-world catalogue names, not values from game code.
DIGIT_FIELD_KEYS = {"landmarks": {"Designation", "Object type"}}
# Categories whose names may hold digits, for the same reason.
DIGIT_NAME_CATEGORIES = {"landmarks"}


# ═══════════════════════════════════════════════════════════════════════════
#  TEXT HELPERS
# ═══════════════════════════════════════════════════════════════════════════

def die(msg):
    print("wiki-export: " + msg, file=sys.stderr)
    sys.exit(1)


def read(game, rel):
    p = game / rel
    if not p.is_file():
        die("missing source file " + rel)
    return p.read_text(encoding="utf-8")


def find_code(text, anchor):
    """Index of the first `anchor` that is code, not part of a comment line.

    Headers and doc comments quote their own grep targets (for example
    grep -n "pub fn bed_side"), so a plain find() lands in a comment.
    """
    i = text.find(anchor)
    while i >= 0:
        line_start = text.rfind("\n", 0, i) + 1
        prefix = text[line_start:i]
        if "//" not in prefix and not prefix.lstrip().startswith("*"):
            return i
        i = text.find(anchor, i + 1)
    die("anchor not found in code: " + anchor)


def block_after(text, anchor, open_ch="{", close_ch="}", after=None):
    """Return the text between the first open_ch after anchor and its match.

    The scan skips // comments and "..." string literals, so a bracket in a
    comment or a string does not count. When `after` is given, the scan
    starts at the first `after` that follows the anchor (for example "=" to
    step past a type such as [&str; 10]).
    """
    i = find_code(text, anchor)
    k = i + len(anchor)
    if after is not None:
        k = text.find(after, k) + len(after)
    depth, start, n = 0, -1, len(text)
    while k < n:
        c = text[k]
        if c == "/" and text.startswith("//", k):
            k = text.find("\n", k)
            if k < 0:
                break
            continue
        if c == '"':
            k += 1
            while k < n and text[k] != '"':
                k += 2 if text[k] == "\\" else 1
            k += 1
            continue
        if c == open_ch:
            if depth == 0:
                start = k
            depth += 1
        elif c == close_ch and depth > 0:
            depth -= 1
            if depth == 0:
                return text[start + 1:k]
        k += 1
    die("unbalanced block after " + anchor)


def strip_line_comments(text):
    return re.sub(r"//[^\n]*", "", text)


def enum_variants(text, name):
    """Variants of `enum name` in order, with the section comment above each."""
    body = block_after(text, "enum " + name + " ")
    out, group = [], None
    for line in body.split("\n"):
        s = line.strip()
        m = re.match(r"//\s*(?:──+\s*)?(.+?)\s*(?:──+)?$", s)
        if m and not s.startswith("///"):
            group = m.group(1).rstrip(".").strip()
            continue
        if s.startswith("#[") or s.startswith("///") or not s:
            continue
        m = re.match(r"([A-Z][A-Za-z0-9]*)\s*(?:[,({]|$)", s)
        if m:
            out.append((m.group(1), group))
    return out


def match_strings(text, fn_anchor, enum):
    """Map Variant -> string literal from the match arms of one fn."""
    body = block_after(text, fn_anchor)
    out = {}
    for m in re.finditer(enum + r"::(\w+)\s*=>\s*\"([^\"]*)\"", body):
        out.setdefault(m.group(1), m.group(2))
    return out


def matches_set(text, fn_anchor):
    """Variant names inside the matches!(...) of one predicate fn."""
    body = block_after(text, fn_anchor)
    return set(re.findall(r"ModuleType::(\w+)", strip_line_comments(body)))


def humanize(ident):
    """CamelCase or snake_case identifier -> 'Title Case' words."""
    s = ident.replace("_", " ")
    s = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", s)
    s = re.sub(r"(?<=[A-Z])(?=[A-Z][a-z])", " ", s)
    return " ".join(w[:1].upper() + w[1:] for w in s.split())


def kebab(ident):
    s = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "-", ident)
    return slugify(s)


def slugify(s):
    s = s.lower().replace("'", "")
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def title_case(s):
    """'close friends' -> 'Close Friends'; 'PASSED ON' -> 'Passed On'."""
    return " ".join(w[:1].upper() + w[1:].lower() for w in s.split())


def sentence_case(s):
    return s[:1].upper() + s[1:]


# ═══════════════════════════════════════════════════════════════════════════
#  CATALOG BUILDER
# ═══════════════════════════════════════════════════════════════════════════

class Catalog:
    def __init__(self):
        self.entries = {}
        self.order = []
        self.jobs = []          # sprite jobs: (entry_id, kind, args)

    def add(self, category, slug, name, tier=None, group=None, fields=None,
            placement=None, credit=None):
        eid = category + "/" + slug
        if eid in self.entries:
            die("duplicate entry id " + eid)
        e = {
            "id": eid, "slug": slug, "category": category, "name": name,
            "tier": tier, "group": group, "sprite": None, "sprites": [],
            "fields": dict(fields or {}),
            "links": {"madeFrom": [], "usedIn": [], "unlockedBy": [],
                      "unlocks": [], "related": []},
        }
        if placement is not None:
            e["placement"] = placement
        if credit is not None:
            e["credit"] = credit
        self.entries[eid] = e
        self.order.append(eid)
        return e

    def link(self, eid, kind, target):
        if eid not in self.entries or target not in self.entries:
            return
        lst = self.entries[eid]["links"][kind]
        if target not in lst and target != eid:
            lst.append(target)

    def sprite(self, eid, kind, *args):
        self.jobs.append((eid, kind, args))


# ═══════════════════════════════════════════════════════════════════════════
#  SPRITE SOURCES
# ═══════════════════════════════════════════════════════════════════════════

def albedo_mask_pairs(folder):
    """(albedo, mask or None) for every image under folder/albedo, sorted."""
    alb = sorted((folder / "albedo").glob("*.png")) if (folder / "albedo").is_dir() else []
    msk = sorted((folder / "mask").glob("*.png")) if (folder / "mask").is_dir() else []
    if len(alb) == len(msk):
        return list(zip(alb, msk))
    by_name = {m.name: m for m in msk}
    out = []
    for a in alb:
        cand = [a.name, a.name.replace("image_", "mask_"),
                a.name.replace("_albedo", "_mask")]
        out.append((a, next((by_name[c] for c in cand if c in by_name), None)))
    return out


def spread(items, cap):
    """Up to cap items, spaced evenly across the list."""
    n = len(items)
    if n <= cap:
        return list(items)
    if cap == 1:
        return [items[0]]
    idx = sorted({round(i * (n - 1) / (cap - 1)) for i in range(cap)})
    return [items[i] for i in idx]


# ═══════════════════════════════════════════════════════════════════════════
#  RESOURCES — src/globals/resources.rs
# ═══════════════════════════════════════════════════════════════════════════

TIER_PLURAL = {
    "Raw ore": "Ores", "Ingot": "Ingots", "Alloy": "Alloys",
    "Component": "Components", "Consumable": "Consumables",
    "Propellant": "Propellants", "Knowledge": "Knowledge",
    "Exotic": "Exotics", "Currency": "Currency",
}


def read_resources(game, cat):
    src = read(game, "src/globals/resources.rs")
    body = block_after(src, "pub static RESOURCE_MAP", "[", "]", after="Lazy::new(")
    # Tier label per id band, from resource_tier_label().
    tl = block_after(src, "pub fn resource_tier_label")
    bands = [(int(a), int(b), lab) for a, b, lab in
             re.findall(r"(\d+)\.\.=(\d+)\s*=>\s*\"([^\"]+)\"", tl)]

    def tier_of(k):
        for a, b, lab in bands:
            if a <= k <= b:
                return TIER_PLURAL.get(lab, lab)
        return None

    kinds = {}          # kind id (internal only) -> entry id
    group = None
    for line in body.split("\n"):
        s = line.strip()
        if "TIER" in s and s.startswith("//"):
            group = None
            continue
        m = re.match(r"//\s*──+\s*([A-Z][A-Z ]+?)\s*\(", s)
        if m:
            group = title_case(m.group(1))
            continue
        m = re.match(r"//\s*(COMMON|UNCOMMON|RARE|EXOTIC)\b", s)
        if m:
            group = title_case(m.group(1))
            continue
        m = re.match(r"\((\d+),\s*\(\"([^\"]+)\"\.to_string\(\),\s*\"([^\"]+)\"", s)
        if not m:
            continue
        kind, name, abbr = int(m.group(1)), m.group(2), m.group(3)
        if re.search(r"\d", name):
            # Stellae denominations carry their face value in the name.
            continue
        tier = tier_of(kind)
        e = cat.add("resources", slugify(name), name, tier=tier,
                    group=group if tier in ("Ores", "Ingots", "Alloys", "Components") else None,
                    fields={"Symbol": abbr})
        kinds[kind] = e["id"]

    # Crafting links: inputs and outputs only. No count, time or recipe name.
    rb = block_after(src, "pub static CRAFTING_RECIPES", "[", "]", after="Lazy::new(")
    rb = strip_line_comments(rb)
    for m in re.finditer(r"inputs:\s*vec!\[(.*?)\]\s*,\s*output:\s*\((\d+)", rb, re.S):
        out_k = int(m.group(2))
        ins = [int(x) for x in re.findall(r"\((\d+)\s*,", m.group(1))]
        for k in ins:
            if k in kinds and out_k in kinds:
                cat.link(kinds[out_k], "madeFrom", kinds[k])
                cat.link(kinds[k], "usedIn", kinds[out_k])

    # Sprite folders, from app_atlas.rs. Index in each table = kind - base.
    atlas = read(game, "src/app_atlas.rs")
    tables = [("RAW_ORES", "RAW_ORE_BASE"), ("REFINED_RESOURCES", "REFINED_BASE"),
              ("MATERIALS", "MATERIAL_BASE"), ("FOOD", "FOOD_BASE"),
              ("MUNITIONS", "MUNITIONS_BASE"), ("PROPELLANTS", "PROPELLANT_BASE"),
              ("BASIC_RESEARCH", "BASIC_RESEARCH_BASE"),
              ("ADVANCED_RESEARCH", "ADVANCED_RESEARCH_BASE")]
    for arr, base_name in tables:
        base = int(re.search(r"pub const " + base_name + r":\s*u32\s*=\s*(\d+)", atlas).group(1))
        body2 = block_after(atlas, "pub const " + arr + ":", "[", "]", after="=")
        dirs = re.findall(r"\"([^\"]+)\"", strip_line_comments(body2))
        for i, d in enumerate(dirs):
            k = base + i
            if k in kinds:
                cat.sprite(kinds[k], "item", game / "src/assets" / d, VARIANT_CAP["resources"])
    return kinds


# ═══════════════════════════════════════════════════════════════════════════
#  STATION MODULES — station_layout/types.rs, footprint.rs, construction.rs
# ═══════════════════════════════════════════════════════════════════════════

def read_modules(game, cat, en, kinds):
    types = read(game, "src/player/automata/station_layout/types.rs")
    foot = read(game, "src/player/automata/station_layout/footprint.rs")
    strip = read(game, "src/gui/windows/station_management/grid_editor/toolbar/strip.rs")
    keys = read(game, "src/i18n/keys.rs")
    constr = read(game, "src/globals/construction.rs")
    atlas = read(game, "src/app_atlas.rs")

    enum_body = block_after(types, "pub enum ModuleType")
    variants = [v for v, _ in enum_variants(types, "ModuleType")]
    # Status markers that the code writes into the variant doc comments.
    legacy, reserved = set(), set()
    doc = []
    for line in enum_body.split("\n"):
        s = line.strip()
        if s.startswith("///"):
            doc.append(s)
            continue
        m = re.match(r"([A-Z]\w*),", s)
        if m:
            d = " ".join(doc)
            if "LEGACY TOMBSTONE" in d:
                legacy.add(m.group(1))
            if "RESERVED" in d and "NOT BUILDABLE" in d:
                reserved.add(m.group(1))
            doc = []

    structural = matches_set(types, "pub fn is_structural")
    thruster = matches_set(types, "pub fn is_thruster")
    turret = matches_set(types, "pub fn is_turret")
    docking = matches_set(types, "pub fn is_docking")
    exterior = matches_set(types, "pub fn requires_exterior_placement")
    interior = matches_set(types, "pub fn requires_interior_placement")
    manufacturing = matches_set(types, "pub fn is_manufacturing")
    research_st = matches_set(types, "pub fn is_research_station")
    directional = matches_set(types, "pub fn is_directional") | research_st | turret
    flags = matches_set(types, "pub fn flies_a_flag")
    bed_body = block_after(types, "pub fn bed_side")
    bed_side = {v: int(n) for v, n in re.findall(r"ModuleType::(\w+)\s*=>\s*Some\((\d+)\)", bed_body)}
    furniture = set(bed_side)

    def const(name):
        return int(re.search(r"pub const " + name + r":\s*i32\s*=\s*(\d+)", foot).group(1))

    def footprint(v):
        if v in bed_side:
            w = h = bed_side[v]
        elif v in thruster:
            w = h = const("THRUSTER_SIDE")
        elif v in turret:
            w = h = const("TURRET_SIDE")
        elif v == "ResearchBench":
            w, h = const("RESEARCH_DEPTH"), const("BENCH_LENGTH")
        elif v == "ResearchLab":
            w, h = const("RESEARCH_DEPTH"), const("LAB_LENGTH")
        elif v in manufacturing:
            w = h = 2
        else:
            w = h = 1
        return [[x, y] for y in range(h) for x in range(w)]

    # Names: i18n key -> en.toml path.
    name_key = {}
    for var, path in re.findall(r"Module(\w+)Name\s*=>\s*\"([^\"]+)\"", keys):
        name_key[var] = path

    def en_get(path):
        node = en
        for p in path.split("."):
            node = node.get(p, {}) if isinstance(node, dict) else {}
        return node if isinstance(node, str) else None

    # Palette sections: the only path to a buildable module.
    pal_body = block_after(strip, "pub(super) const SECTIONS", "[", "]", after="=")
    palette = {}
    for m in re.finditer(r"PaletteCategory(\w+)\s*,(.*?)(?=PaletteCategory|\Z)", pal_body, re.S):
        sect = title_case(en_get("palette.category_" + slugify(humanize(m.group(1))).replace("-", "_")) or m.group(1))
        for v in re.findall(r"ModuleType::(\w+)", strip_line_comments(m.group(2))):
            palette.setdefault(v, sect)
    removed_names = set()
    flat = re.sub(r"\n\s*//\s*", " ", strip)
    m = re.search(r"the ([a-z ,]+?) were removed", flat)
    if m:
        removed_names = {slugify(x) for x in re.split(r",\s*|\s+and\s+", m.group(1)) if x.strip()}

    # Symbols, I/O labels.
    symbols = match_strings(types, "pub fn symbol", "ModuleType")
    io_body = block_after(types, "pub fn io_info")
    io = {v: (a, b) for v, a, b in re.findall(
        r"ModuleType::(\w+)\s*=>\s*Some\(\(\"([^\"]+)\",\s*\d+,\s*\"([^\"]+)\"", io_body)}

    # Build inputs: MODULE_RECIPES[atlas_index], kinds only.
    ai_body = block_after(types, "pub fn atlas_index")
    atlas_idx = {v: int(n) for v, n in re.findall(r"ModuleType::(\w+)\s*=>\s*(\d+)", strip_line_comments(ai_body))}
    rec_body = block_after(constr, "pub static MODULE_RECIPES", "[", "]", after="Lazy::new(")
    rec_body = strip_line_comments(rec_body)
    recipes = []
    for vm in re.finditer(r"vec!\[(.*?)\]", rec_body, re.S):
        recipes.append([int(x) for x in re.findall(r"\((\d+)\s*,", vm.group(1))])

    # Sprite folders: STATION_MODULES by atlas index, plus the prop tables.
    sm_body = block_after(atlas, "pub const STATION_MODULES:", "[", "]", after="=")
    sm_dirs = re.findall(r"\"([^\"]+)\"", strip_line_comments(sm_body))

    def prop_dir(const_name):
        b = block_after(atlas, "pub const " + const_name + ":", "[", "]", after="=")
        return re.findall(r"\"([^\"]+)\"", strip_line_comments(b))[0]

    mods = {}
    for v in variants:
        slug = kebab(v)
        if v in legacy:
            name = humanize(v)
        else:
            name = en_get(name_key.get(v, "")) or humanize(v)
        if v in palette:
            status = "Buildable"
        elif v in legacy:
            status = "Legacy"
        elif v in reserved:
            status = "Reserved"
        elif slugify(name) in removed_names:
            status = "Removed"
        else:
            status = "Not in build palette"
        fields = {"Status": status}
        if v in palette:
            fields["Palette section"] = palette[v]
        if v in symbols:
            fields["Symbol"] = symbols[v]
        if v in io:
            fields["Input"], fields["Output"] = io[v]
        placement = {
            "footprint": footprint(v),
            "structural": v in structural,
            "furniture": v in furniture,
            "turret": v in turret,
            "thruster": v in thruster,
            "docking": v in docking,
            "interior": v in interior,
            "exterior": v in exterior,
            "directional": v in directional,
            "flag": v in flags,
        }
        group = palette.get(v)
        e = cat.add("modules", slug, name, tier=None, group=group,
                    fields=fields, placement=placement)
        mods[v] = e["id"]
        idx = atlas_idx.get(v)
        if idx is not None and idx < len(recipes):
            for k in recipes[idx]:
                if k in kinds:
                    cat.link(e["id"], "madeFrom", kinds[k])
                    cat.link(kinds[k], "usedIn", e["id"])
        # Sprites.
        cap = VARIANT_CAP["modules"]
        if v in legacy:
            continue
        if v in bed_side:
            cat.sprite(e["id"], "pick", game / "src/assets" / prop_dir("HYDROPONICS_BASE"),
                       bed_side[v] - 2)
        elif v == "ResearchBench":
            cat.sprite(e["id"], "item", game / "src/assets" / prop_dir("RESEARCH_BENCH"), cap)
        elif idx is not None and idx < len(sm_dirs):
            d = game / "src/assets" / sm_dirs[idx]
            if (d / "albedo").is_dir():
                cat.sprite(e["id"], "item", d, cap)
    return mods


# ═══════════════════════════════════════════════════════════════════════════
#  RESEARCH — src/gui/windows/research/data.rs
# ═══════════════════════════════════════════════════════════════════════════

def read_research(game, cat, en, kinds, mods):
    src = read(game, "src/gui/windows/research/data.rs")
    keys = read(game, "src/i18n/keys.rs")
    lab_body = block_after(src, "pub fn label(self)")
    cat_label = {}
    for var, rhs in re.findall(r"TechCategory::(\w+)\s*=>\s*([^,\n]+)", lab_body):
        rhs = rhs.strip()
        m = re.search(r"L10n::(\w+)", rhs)
        if m:
            km = re.search(m.group(1) + r"\s*=>\s*\"([^\"]+)\"", keys)
            node = en
            for p in km.group(1).split("."):
                node = node.get(p, {})
            cat_label[var] = title_case(node) if isinstance(node, str) else var
        else:
            cat_label[var] = title_case(rhs.strip('"'))
    table = src
    techs = []
    for m in re.finditer(
            r"TechNode\s*\{\s*id:\s*\"(\w+)\",\s*title:\s*\"([^\"]+)\",\s*category:\s*(\w+),"
            r"\s*tier:\s*(\d+),.*?prereqs:\s*&\[(.*?)\],\s*unlocks:\s*&\[(.*?)\],"
            r"\s*unlocks_modules:\s*&\[(.*?)\]\s*\}", table, re.S):
        tid, title, tcat, tier, pre, unl, unm = m.groups()
        en_title = en.get("research", {}).get("tech", {}).get(tid, {}).get("title")
        techs.append({
            "id": tid, "title": en_title or title, "cat": tcat, "tier": int(tier),
            "pre": re.findall(r"\"(\w+)\"", pre),
            "unl": [int(x) for x in re.findall(r"\d+", unl)],
            "unm": re.findall(r"ModuleType::(\w+)", unm),
        })
    if not techs:
        die("no research nodes parsed")
    ids = {}
    for t in techs:
        e = cat.add("research", slugify(t["id"]), t["title"],
                    tier="Tier " + str(t["tier"]),
                    group=cat_label.get(t["cat"], t["cat"]),
                    fields={"Discipline": cat_label.get(t["cat"], t["cat"])})
        ids[t["id"]] = e["id"]
    for t in techs:
        me = ids[t["id"]]
        for p in t["pre"]:
            cat.link(me, "unlockedBy", ids.get(p, ""))
            cat.link(ids.get(p, ""), "unlocks", me)
        for k in t["unl"]:
            if k in kinds:
                cat.link(me, "unlocks", kinds[k])
                cat.link(kinds[k], "unlockedBy", me)
        for v in t["unm"]:
            if v in mods:
                cat.link(me, "unlocks", mods[v])
                cat.link(mods[v], "unlockedBy", me)
    return ids


# ═══════════════════════════════════════════════════════════════════════════
#  PLANETS — src/assets/planets/manifest.txt
# ═══════════════════════════════════════════════════════════════════════════

def read_planets(game, cat):
    man = read(game, "src/assets/planets/manifest.txt")
    by_type = {}
    for line in man.splitlines():
        parts = line.split()
        if len(parts) >= 2:
            by_type.setdefault(parts[1], []).append(parts[0])
    adir = game / "src/assets/planets/albedo"
    for ptype, idxs in by_type.items():
        e = cat.add("planets", slugify(ptype), title_case(ptype))
        files = [adir / ("image_" + i + "_.png") for i in idxs]
        files = [f for f in files if f.is_file()]
        cat.sprite(e["id"], "planet", spread(files, VARIANT_CAP["planets"]))


# ═══════════════════════════════════════════════════════════════════════════
#  LANDMARKS — src/globals/astro_landmarks.rs + src/assets/astro
# ═══════════════════════════════════════════════════════════════════════════

def clean_credit(text):
    """Credit text from PROVENANCE.json, cut at the first HTML fragment."""
    if not text:
        return None
    t = re.split(r"<", text)[0]
    t = re.sub(r"^\s*(Credit|Image|IMAGE)\s*:\s*", "", t).strip()
    t = t.replace("en:", "")
    if t.count("(") > t.count(")"):
        t = t[:t.rfind("(")]
    t = re.sub(r"[\s,;(]*(\band\b)?[\s,;(]*$", "", t).strip()
    t = re.sub(r"\s+,", ",", t)
    return t if len(t) > 2 and t.lower() not in ("image", "credit") else None


def landmark_class(otype):
    """A broad class for filters: galaxy, nebula, remnant, cluster, other."""
    o = otype.lower()
    if "supernova" in o or "remnant" in o:
        return "Supernova remnant"
    if "galax" in o:
        return "Galaxy"
    if "cluster" in o:
        return "Star cluster"
    if "nebula" in o:
        return "Nebula"
    return "Other"


def read_landmarks(game, cat):
    src = read(game, "src/globals/astro_landmarks.rs")
    table = src[find_code(src, "const LANDMARKS"):]
    prov = json.loads(read(game, "src/assets/astro/PROVENANCE.json"))
    prov_by_index = {p.get("index"): p for p in prov.get("images", [])}
    astro = game / "src/assets/astro"
    for m in re.finditer(
            r"Landmark\s*\{.*?variant:\s*(\d+),\s*name:\s*\"([^\"]+)\",\s*designation:\s*\"([^\"]*)\","
            r"\s*object_type:\s*\"([^\"]*)\",\s*constellation:\s*\"([^\"]*)\"", table, re.S):
        variant, name, desig, otype, const = m.groups()
        p = prov_by_index.get(int(variant), {})
        credit = None
        if p.get("license") or p.get("credit"):
            credit = {"text": clean_credit(p.get("credit")), "license": p.get("license"),
                      "source": p.get("source")}
        group = landmark_class(otype)
        e = cat.add("landmarks", slugify(name), name, group=group,
                    fields={"Designation": desig, "Object type": otype,
                            "Constellation": const},
                    credit=credit)
        fn = "image_%05d_.png" % int(variant)
        a, mk = astro / "albedo" / fn, astro / "mask" / fn
        if a.is_file():
            cat.sprite(e["id"], "single", a, mk if mk.is_file() else None)


# ═══════════════════════════════════════════════════════════════════════════
#  CITIZENS — src/player/
# ═══════════════════════════════════════════════════════════════════════════

def read_citizens(game, cat, en):
    skills_src = read(game, "src/player/skills.rs")
    names = match_strings(skills_src, "pub fn name", "Skill")
    symbols = match_strings(skills_src, "pub fn symbol", "Skill")
    skill_body = block_after(skills_src, "pub enum Skill ")
    skill_behavior = dict(re.findall(r"(\w+),\s*//\s*(\w+)", skill_body))
    skills = {}
    for v, _ in enum_variants(skills_src, "Skill"):
        e = cat.add("skills", slugify(names.get(v, v)), names.get(v, humanize(v)),
                    fields={"Symbol": symbols[v]} if v in symbols else {})
        skills[v] = e["id"]

    # Behaviors: one entry per module under src/player/ai/behaviors.
    bdir = game / "src/player/ai/behaviors"
    behaviors = {}
    for p in sorted(bdir.iterdir()):
        stem = p.stem if p.is_file() else p.name
        if p.is_file() and p.suffix != ".rs":
            continue
        if stem in ("mod", "shared") or stem in behaviors:
            continue
        e = cat.add("behaviors", slugify(stem), humanize(stem))
        behaviors[stem] = e["id"]
    for v, stem in skill_behavior.items():
        if v in skills and stem in behaviors:
            cat.link(skills[v], "related", behaviors[stem])
            cat.link(behaviors[stem], "related", skills[v])

    # Jobs: JobKind, labelled by the crew panel task strings.
    jobs_src = read(game, "src/player/player/jobs.rs")
    task = en.get("crew_panel", {}).get("task", {})
    tip = en.get("crew_panel", {}).get("task_tooltip", {})
    # The task and tooltip tables list the jobs in one order. The tooltip
    # keys are the job names, and the task strings are the button labels.
    label_of = dict(zip(list(tip.keys()), list(task.values())))
    for v, _ in enum_variants(jobs_src, "JobKind"):
        e = cat.add("jobs", slugify(v), label_of.get(v.lower(), humanize(v)))
        stem = v.lower()
        if stem in behaviors:
            cat.link(e["id"], "related", behaviors[stem])
            cat.link(behaviors[stem], "related", e["id"])
        for sv, sstem in skill_behavior.items():
            if sstem == stem and sv in skills:
                cat.link(e["id"], "related", skills[sv])
                cat.link(skills[sv], "related", e["id"])

    # Needs: the citizen bars on the crew panel, except the work bar.
    for k, label in en.get("crew_panel", {}).get("bar", {}).items():
        if k == "work":
            continue
        cat.add("needs", slugify(label), label)

    # Trait axes, with both pole names and the word lists.
    tr = read(game, "src/player/traits.rs")
    axis_names = match_strings(tr, "pub fn name", "Axis")
    words_body = block_after(tr, "pub fn words")
    for v, _ in enum_variants(tr, "Axis"):
        m = re.search(r"Axis::" + v + r"\s*=>\s*&\[(.*?)\]", words_body, re.S)
        words = re.findall(r"\"([^\"]+)\"", m.group(1)) if m else []
        fields = {}
        if len(words) >= 2:
            fields = {"Pole A": words[0], "Pole B": words[1],
                      "Pole A words": ", ".join(words[0::2]),
                      "Pole B words": ", ".join(words[1::2])}
        cat.add("traits", slugify(axis_names.get(v, v)), axis_names.get(v, humanize(v)),
                fields=fields)

    # Quirks.
    q = read(game, "src/player/quirks.rs")
    qnames = match_strings(q, "pub fn name", "Quirk")
    for v, grp in enum_variants(q, "Quirk"):
        cat.add("quirks", slugify(qnames.get(v, v)), qnames.get(v, humanize(v)),
                group=sentence_case(grp) if grp else None)

    # Backstories.
    bs = read(game, "src/player/backstory.rs")
    bnames = match_strings(read(game, "src/player/backstory/presentation.rs"), "pub fn name", "Backstory")
    for v, _ in enum_variants(bs, "Backstory"):
        cat.add("backstories", slugify(bnames.get(v, v)), bnames.get(v, humanize(v)))

    # Starsigns: name and symbol only.
    ss = read(game, "src/player/starsign.rs")
    snames = match_strings(ss, "pub fn name", "Starsign")
    ssym = match_strings(ss, "pub fn symbol", "Starsign")
    for v, _ in enum_variants(ss, "Starsign"):
        cat.add("starsigns", slugify(snames.get(v, v)), snames.get(v, humanize(v)),
                fields={"Symbol": ssym[v]} if v in ssym else {})


# ═══════════════════════════════════════════════════════════════════════════
#  SOCIAL — relationships, gossip, pulses, incidents
# ═══════════════════════════════════════════════════════════════════════════

def read_social(game, cat):
    rel = read(game, "src/player/life_events/relationship.rs")
    disp = match_strings(rel, "fn fmt", "RelationshipTier")
    for v, grp in enum_variants(rel, "RelationshipTier"):
        g = "Positive"
        if grp:
            g = sentence_case(grp.replace(" path", ""))
        cat.add("relationship-tiers", kebab(v), title_case(disp.get(v, humanize(v))), group=g)

    rum = read(game, "src/player/gossip/rumor.rs")
    tlabels = match_strings(rum, "pub fn label", "RumorTopic")
    for v, grp in enum_variants(rum, "RumorTopic"):
        g = None
        if grp:
            g = "Positive" if grp.lower().startswith("positive") else "Negative"
        cat.add("rumor-topics", slugify(v), sentence_case(tlabels.get(v, humanize(v))), group=g)
    chan_src = rum[find_code(rum, "pub enum RumorChannel"):]
    clabels = match_strings(chan_src, "pub fn label", "RumorChannel")
    for v, _ in enum_variants(rum, "RumorChannel"):
        cat.add("gossip-channels", kebab(v), sentence_case(clabels.get(v, humanize(v))))

    feed = read(game, "src/player/gossip/feed.rs")
    flabels = match_strings(feed, "pub fn label", "GossipEventKind")
    for v, _ in enum_variants(feed, "GossipEventKind"):
        cat.add("gossip-events", kebab(v), title_case(flabels.get(v, humanize(v))))

    pulse = read(game, "src/player/social_pulse.rs")
    for v, _ in enum_variants(pulse, "PulseKind"):
        cat.add("social-pulses", kebab(v), humanize(v))

    # Incidents: only the kinds with a shipped definition in ALL_DEFS.
    inc_mod = read(game, "src/globals/incident/mod.rs")
    defs = re.findall(r"&(\w+)::([A-Z_]+)",
                      strip_line_comments(block_after(inc_mod, "static ALL_DEFS", "[", "]", after="=")))
    cats_used = {}
    kinds_found = []
    for module, _const in defs:
        msrc = read(game, "src/globals/incident/" + module + ".rs")
        k = re.search(r"fn kind\(&self\)\s*->\s*IncidentKind\s*\{\s*IncidentKind::(\w+)", msrc)
        c = re.search(r"fn category\(&self\)\s*->\s*IncidentCategory\s*\{\s*IncidentCategory::(\w+)", msrc)
        if k:
            kinds_found.append((k.group(1), c.group(1) if c else None))
    types = read(game, "src/globals/incident/types.rs")
    all_cats = [v for v, _ in enum_variants(types, "IncidentCategory")]
    for v in all_cats:
        if any(c == v for _, c in kinds_found):
            e = cat.add("incident-categories", kebab(v), humanize(v))
            cats_used[v] = e["id"]
    for kv, cv in kinds_found:
        e = cat.add("incidents", kebab(kv), humanize(kv), group=humanize(cv) if cv else None)
        if cv in cats_used:
            cat.link(e["id"], "related", cats_used[cv])
            cat.link(cats_used[cv], "related", e["id"])


# ═══════════════════════════════════════════════════════════════════════════
#  MIND — emogine dimension names only
# ═══════════════════════════════════════════════════════════════════════════

def read_mind(game, cat):
    schema = read(game, "src/player/emogine/core/schema.rs")
    for v, _ in enum_variants(schema, "EmotionDimension"):
        cat.add("emotions", kebab(v), humanize(v))
    for v, _ in enum_variants(schema, "RelationshipDimension"):
        cat.add("relationship-dimensions", kebab(v), humanize(v))


# ═══════════════════════════════════════════════════════════════════════════
#  FLAGS — emblem set and pattern names
# ═══════════════════════════════════════════════════════════════════════════

def read_flags(game, cat):
    kind = read(game, "src/gui/ship_designer/emblem/kind.rs")
    body = block_after(kind, "pub(crate) const EMBLEMS", "[", "]", after="=")
    seen = set()
    pirate = False
    for line in body.split("\n"):
        s = line.strip()
        if s.startswith("//") and "Pirate" in s:
            pirate = True
        m = re.match(r"Emblem::Glyph\(\"\\u\{([0-9A-Fa-f]+)\}\"\),\s*//\s*(.+)$", s)
        if m:
            glyph, name, group = chr(int(m.group(1), 16)), sentence_case(m.group(2).strip()), "Glyph"
        else:
            m = re.match(r"Emblem::Vector\(Vector::(\w+)\)", s)
            if not m:
                continue
            glyph, name, group = None, humanize(m.group(1)), "Pirate" if pirate else "Vector"
        slug = slugify(name)
        if slug in seen:
            slug = slug + "-" + slugify(group)
        seen.add(slug)
        cat.add("flag-emblems", slug, name, group=group,
                fields={"Glyph": glyph} if glyph else {})

    pat = read(game, "src/gui/ship_designer/flag/pattern.rs")
    mbody = block_after(pat, "match pat")
    comment = []
    for line in mbody.split("\n"):
        s = line.strip()
        if s.startswith("//"):
            t = s.lstrip("/").strip()
            if t.startswith("──"):
                comment = []
                continue
            comment.append(t)
            continue
        m = re.match(r"(\d+)\s*=>", s)
        if m and comment:
            text = " ".join(comment)
            name = None
            for clause in text.split(" — "):
                c = re.split(r"[:,.]", clause)[0].strip()
                c = re.sub(r"^the\s+", "", c, flags=re.I)
                if c and not re.search(r"\d", c):
                    name = sentence_case(c)
                    break
            if name:
                cat.add("flag-patterns", slugify(name), name)
        if not s.startswith("//"):
            comment = []


# ═══════════════════════════════════════════════════════════════════════════
#  SHIP LIVERY AND PORTRAITS — galleries with sprites
# ═══════════════════════════════════════════════════════════════════════════

LIVERY_LAYERS = [("hull", "Hull"), ("cockpit", "Cockpit"), ("accents", "Accents")]


def read_livery(game, cat):
    d = game / "src/assets/ship_livery"
    pairs = albedo_mask_pairs(d)
    if len(pairs) != len(LIVERY_LAYERS):
        die("ship_livery: expected %d layers" % len(LIVERY_LAYERS))
    for (slug, name), (a, m) in zip(LIVERY_LAYERS, pairs):
        e = cat.add("ship-livery", slug, name, group="Layer")
        cat.sprite(e["id"], "livery", a, m)


def read_portraits(game, cat, cap=24):
    img = game / "src/assets/character_system/images"
    msk = game / "src/assets/character_system/masks"
    sets = []
    for sub in sorted(p.name for p in img.iterdir() if p.is_dir()):
        sets.append((sub, sorted((img / sub).glob("*.png"))))
    per = cap // max(1, len(sets))
    n = 0
    for sub, files in sets:
        for f in spread(files, per):
            n += 1
            e = cat.add("portraits", "portrait-%02d" % n, "Citizen portrait", group=None)
            m = msk / sub / f.name
            cat.sprite(e["id"], "single", f, m if m.is_file() else None)


# ═══════════════════════════════════════════════════════════════════════════
#  CONTROLS — src/input_actions.rs CATALOG
# ═══════════════════════════════════════════════════════════════════════════

KEY_NAMES = {
    "RBracket": "]", "LBracket": "[", "Grave": "`", "Backslash": "\\",
    "Period": ".", "Comma": ",", "Back": "Backspace", "Delete": "Delete",
    "Space": "Space", "Tab": "Tab", "Up": "Up", "Down": "Down",
    "Left": "Left", "Right": "Right",
}
MOD_NAMES = {"CTRL": "Ctrl", "LOGO": "Cmd", "SHIFT": "Shift", "ALT": "Alt"}


def chord_text(c):
    m = re.match(r"Chord::key\(K::(\w+)\)", c)
    if m:
        return key_text(m.group(1))
    m = re.match(r"Chord::keyed\(K::(\w+),\s*Mods::(\w+)\)", c)
    if m:
        return MOD_NAMES.get(m.group(2), m.group(2).title()) + "+" + key_text(m.group(1))
    m = re.match(r"Chord::mouse\(MouseZone::(\w+)\)", c)
    if m:
        return m.group(1) + " click"
    return c


def key_text(k):
    if k in KEY_NAMES:
        return KEY_NAMES[k]
    m = re.match(r"Key(\d)$", k)
    return m.group(1) if m else k


def read_controls(game):
    src = read(game, "src/input_actions.rs")
    groups = dict(re.findall(r"const (G_\w+):\s*&str\s*=\s*\"([^\"]+)\"", src))
    ctxs = dict(re.findall(r"const (CTX_\w+):\s*&str\s*=\s*\"([^\"]+)\"", src))
    chords = {}
    for name, body in re.findall(r"static (D_\w+):\s*&\[Chord\]\s*=\s*&\[(.*?)\];", src):
        chords[name] = [chord_text(c.strip()) for c in re.findall(r"Chord::\w+\([^)]*\)", body)]
    table = block_after(src, "static CATALOG: &[Action]", "[", "]", after="=")
    out = []
    for m in re.finditer(r"Action::(\w+)\(\s*\"([^\"]+)\",\s*\"([^\"]+)\",\s*(G_\w+),(.*?)(D_\w+),?\s*\)",
                         table, re.S):
        _ctor, aid, label, g, mid, d = m.groups()
        cm = re.search(r"(CTX_\w+)", mid)
        cs = chords.get(d, [])
        out.append({"id": aid, "label": label, "group": groups.get(g, g),
                    "context": ctxs.get(cm.group(1)) if cm else None,
                    "chord": " / ".join(cs), "chords": cs})
    if not out:
        die("no controls parsed")
    return out


# ═══════════════════════════════════════════════════════════════════════════
#  SPRITE WRITER — magick, webp, trim, fit 256
# ═══════════════════════════════════════════════════════════════════════════

def magick_cut(albedo, mask, out, size=256, trim=True):
    cmd = ["magick", str(albedo)]
    if mask is not None:
        cmd += ["(", str(mask), "-colorspace", "Gray", "-alpha", "off", ")",
                "-alpha", "off", "-compose", "CopyOpacity", "-composite"]
    cmd += ["-background", "none"]
    if trim:
        cmd += ["-trim", "+repage"]
    cmd += ["-resize", "%dx%d>" % (size, size), "-strip",
            "-define", "webp:alpha-quality=90", "-quality", "82", str(out)]
    subprocess.run(cmd, check=True, capture_output=True)


def magick_planet(albedo, out):
    subprocess.run(["magick", str(albedo), "-resize", "512x256>", "-strip",
                    "-quality", "82", str(out)], check=True, capture_output=True)


def magick_mask_layer(mask, out, size=512):
    """White layer whose alpha is the mask, for tinting in a canvas."""
    subprocess.run(["magick", str(mask), "-colorspace", "Gray", "-alpha", "off",
                    "-resize", "%dx%d" % (size, size), "-write", "mpr:m", "+delete",
                    "-size", "%dx%d" % (size, size), "xc:white", "mpr:m",
                    "-alpha", "off", "-compose", "CopyOpacity", "-composite",
                    "-strip", "-define", "webp:alpha-quality=90", "-quality", "82",
                    str(out)], check=True, capture_output=True)


def plan_sprites(cat):
    """Turn sprite jobs into (entry_id, [(kind, src, mask, out_rel)])."""
    plans = []
    for eid, kind, args in cat.jobs:
        e = cat.entries[eid]
        c, slug = e["category"], e["slug"]
        cap = VARIANT_CAP.get(c, 1)
        srcs = []
        if kind == "item":
            folder, cap = args[0], min(args[1], cap)
            srcs = [("cut", a, m) for a, m in spread(albedo_mask_pairs(folder), cap)]
        elif kind == "pick":
            pairs = albedo_mask_pairs(args[0])
            if 0 <= args[1] < len(pairs):
                srcs = [("cut", pairs[args[1]][0], pairs[args[1]][1])]
        elif kind == "planet":
            srcs = [("planet", a, None) for a in args[0]]
        elif kind == "single":
            srcs = [("cut", args[0], args[1])]
        elif kind == "livery":
            srcs = [("livery", args[0], None)]
            if args[1] is not None:
                srcs.append(("mask", args[1], None))
        outs = []
        for i, (k, a, m) in enumerate(srcs):
            if kind == "livery" and k == "mask":
                rel = "media/sprites/%s/%s-mask.webp" % (c, slug)
            else:
                rel = "media/sprites/%s/%s%s.webp" % (c, slug, "" if i == 0 else "--%d" % (i + 1))
            outs.append((k, a, m, rel))
        plans.append((eid, outs))
    return plans


def run_sprite(job):
    k, a, m, rel = job
    out = SN / rel
    out.parent.mkdir(parents=True, exist_ok=True)
    if k == "cut":
        magick_cut(a, m, out)
    elif k == "planet":
        magick_planet(a, out)
    elif k == "livery":
        magick_cut(a, None, out, size=512, trim=False)
    elif k == "mask":
        magick_mask_layer(a, out)
    return rel


# ═══════════════════════════════════════════════════════════════════════════
#  LEAK CHECK
#  A field value may hold no digit (except DIGIT_FIELD_KEYS). A name may hold
#  no digit (except DIGIT_NAME_CATEGORIES). The only number-typed values are
#  the catalog version, category order, and placement footprint cells. Every
#  digit elsewhere must sit in an id, slug, path or link.
# ═══════════════════════════════════════════════════════════════════════════

def leak_check(data):
    problems = []

    def walk_numbers(node, path):
        if isinstance(node, bool) or node is None:
            return
        if isinstance(node, (int, float)):
            ok = (path == "version" or re.fullmatch(r"categories\[\d+\]\.order", path)
                  or re.search(r"\.placement\.footprint", path))
            if not ok:
                problems.append("number at " + path)
        elif isinstance(node, dict):
            for k, v in node.items():
                walk_numbers(v, path + "." + k if path else k)
        elif isinstance(node, list):
            for i, v in enumerate(node):
                walk_numbers(v, "%s[%d]" % (path, i))

    walk_numbers(data, "")
    for e in data["entries"]:
        for k, v in e["fields"].items():
            if not isinstance(v, str):
                problems.append("%s: field %s is not a string" % (e["id"], k))
            elif re.search(r"\d", v) and k not in DIGIT_FIELD_KEYS.get(e["category"], ()):
                problems.append("%s: field %s holds a digit: %r" % (e["id"], k, v))
        if re.search(r"\d", e["name"]) and e["category"] not in DIGIT_NAME_CATEGORIES:
            problems.append("%s: name holds a digit: %r" % (e["id"], e["name"]))
        for k in ("tier", "group"):
            v = e.get(k)
            if v and re.search(r"\d", v) and not (k == "tier" and re.fullmatch(r"Tier \d+", v)):
                problems.append("%s: %s holds a digit: %r" % (e["id"], k, v))
    if problems:
        print("LEAK CHECK FAILED:", file=sys.stderr)
        for p in problems[:50]:
            print("  " + p, file=sys.stderr)
        sys.exit(2)
    return True


# ═══════════════════════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════════════════════

JS_HEADER = """/*
 * ═══════════════════════════════════════════════════════════════════════════
 *  lib/game-data/catalog.js — the names-only Stella Nova game catalog
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  GENERATED FILE. Do not edit. tools/wiki-export.py writes this file and
 *  catalog.json from the game working tree. The two files hold the same data.
 *
 *  This script sets window.SN_DATA. Load it as a classic script:
 *    <script src="../../lib/game-data/catalog.js"></script>
 *
 *  The catalog holds names, labels, sprites, links and key bindings only. It
 *  holds no quantity from game code. Sprite paths are relative to stella-nova/.
 *
 *  GREP REFERENCE
 *  --------------
 *    grep -n "window.SN_DATA"      catalog.js
 *    grep -n "def leak_check"      ../../../tools/wiki-export.py
 * ═══════════════════════════════════════════════════════════════════════════
 */
"""


def main():
    if len(sys.argv) != 2:
        die("usage: python3 tools/wiki-export.py /path/to/barnes-hut")
    game = Path(sys.argv[1]).expanduser().resolve()
    if not (game / "src/globals/resources.rs").is_file():
        die("not a game working tree: " + str(game))
    if shutil.which("magick") is None:
        die("the ImageMagick 'magick' command is not on PATH")
    en = tomllib.loads(read(game, "lang/en.toml"))

    cat = Catalog()
    kinds = read_resources(game, cat)
    mods = read_modules(game, cat, en, kinds)
    read_research(game, cat, en, kinds, mods)
    read_planets(game, cat)
    read_landmarks(game, cat)
    read_citizens(game, cat, en)
    read_portraits(game, cat)
    read_social(game, cat)
    read_mind(game, cat)
    read_flags(game, cat)
    read_livery(game, cat)
    controls = read_controls(game)

    # Sprites: clear the category folders, then write every job.
    for cid, _, _ in CATEGORIES:
        d = OUT_SPRITES / cid
        if d.is_dir():
            shutil.rmtree(d)
    plans = plan_sprites(cat)
    jobs = [o for _, outs in plans for o in outs]
    with concurrent.futures.ThreadPoolExecutor(max_workers=os.cpu_count() or 4) as ex:
        list(ex.map(run_sprite, jobs))
    for eid, outs in plans:
        e = cat.entries[eid]
        paths = [rel for _, _, _, rel in outs if (SN / rel).is_file()]
        e["sprites"] = paths
        e["sprite"] = paths[0] if paths else None

    entries = [cat.entries[i] for i in cat.order]
    data = {
        "version": 1,
        "source": "Stella Nova game repository",
        "categories": [{"id": c, "label": l, "group": g, "order": i}
                       for i, (c, l, g) in enumerate(CATEGORIES)],
        "entries": entries,
        "controls": controls,
    }
    leak_check(data)

    OUT_DATA.mkdir(parents=True, exist_ok=True)
    (OUT_DATA / "catalog.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    (OUT_DATA / "catalog.js").write_text(
        JS_HEADER + "window.SN_DATA = " +
        json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8")

    # Summary.
    total_bytes = sum(p.stat().st_size for p in OUT_SPRITES.rglob("*.webp"))
    files = sum(1 for _ in OUT_SPRITES.rglob("*.webp"))
    print("wiki-export: %d entries, %d controls" % (len(entries), len(controls)))
    for cid, label, _ in CATEGORIES:
        es = [e for e in entries if e["category"] == cid]
        ws = sum(1 for e in es if e["sprite"])
        print("  %-24s %4d entries  %4d with sprites" % (cid, len(es), ws))
    print("sprites: %d files, %d bytes (%.2f MB)" % (files, total_bytes, total_bytes / 1048576))
    print("leak check: passed")
    if total_bytes > SPRITE_BUDGET:
        die("sprite set is over the %d byte budget" % SPRITE_BUDGET)


if __name__ == "__main__":
    main()
