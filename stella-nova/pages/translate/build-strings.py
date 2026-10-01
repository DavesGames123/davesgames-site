#!/usr/bin/env python3
# ============================================================================
#  TRANSLATION TOOL  ·  pages/translate/build-strings.py — string exporter
# ----------------------------------------------------------------------------
#  Reads the shipped language tables of the game repository and writes the
#  classic-script data files that the Translation Tool page loads.
#
#  USAGE
#    python3 build-strings.py /path/to/barnes-hut [--legacy old-main.js]
#
#  SOURCES (all are compiled into the game binary, see src/i18n/mod.rs)
#    lang/en.toml                     English UI strings (EMBEDDED_TABLES)
#    lang/{title,tutorial,narrative}/en.toml
#                                     English supplementary strings
#                                     (EMBEDDED_SUPPLEMENTARY)
#    lang/<code>.toml                 the shipped translations, one per
#                                     language in EMBEDDED_TABLES
#
#  OUTPUT (next to this script)
#    strings/en.js      SN_TR.keys, SN_TR.en, SN_TR.langs, SN_TR.changedSinceV4
#    strings/<code>.js  SN_TR.game[<code>] = values parallel to SN_TR.keys
#
#  TRADE-SECRET FILTER  (the site must not publish numbers from game code)
#    1. Keys under minigame.doom are left out (the doom port is excluded).
#    2. Object descriptions and research effects are left out:
#       module.*.desc, constructable.*.desc, research.tech.*.effect.
#    3. A key is left out when its English value has a digit outside a
#       {placeholder}, or a number word (two, three, half, twice and so on).
#    The same key set applies to every language file. A translated value
#    with a digit outside a {placeholder} is dropped from that file only.
#
#  GREP TARGETS  (grep -n "<target>" build-strings.py)
#    language list ....... "LANGS ="
#    exclusion rules ..... "def excluded"
#    toml flatten ........ "def flatten"
#    legacy diff ......... "def legacy_changed"
#    file writer ......... "def write_js"
# ============================================================================
import json
import os
import re
import sys
import tomllib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'strings')

# code, native name, English name, flag, picker mode label from the game.
LANGS = [
    ('en', 'English', 'English', '\U0001F1EC\U0001F1E7', None),
    ('de', 'Deutsch', 'German', '\U0001F1E9\U0001F1EA', None),
    ('fr', 'Français', 'French', '\U0001F1EB\U0001F1F7', None),
    ('es', 'Español', 'Spanish', '\U0001F1EA\U0001F1F8', None),
    ('it', 'Italiano', 'Italian', '\U0001F1EE\U0001F1F9', None),
    ('pt', 'Português', 'Portuguese', '\U0001F1F5\U0001F1F9', None),
    ('pl', 'Polski', 'Polish', '\U0001F1F5\U0001F1F1', None),
    ('ru', 'Русский', 'Russian', '\U0001F1F7\U0001F1FA', 'Mayka mode'),
    ('ja', '日本語', 'Japanese', '\U0001F1EF\U0001F1F5', None),
    ('zh-CN', '简体中文', 'Simplified Chinese', '\U0001F1E8\U0001F1F3', None),
    ('ko', '한국어', 'Korean', '\U0001F1F0\U0001F1F7', None),
    ('nl', 'Nederlands', 'Dutch', '\U0001F1F3\U0001F1F1', None),
    ('pt-BR', 'Português BR', 'Brazilian Portuguese', '\U0001F1E7\U0001F1F7', 'Leandro mode'),
    ('ga', 'Gaeilge', 'Irish', '\U0001F1EE\U0001F1EA', 'Ramm mode'),
    ('tlh', 'tlhIngan Hol', 'Klingon', '\U0001F596', None),
    ('mt', 'Malti', 'Maltese', '\U0001F1F2\U0001F1F9', 'Nightsman mode'),
    ('hi', 'हिन्दी', 'Hindi', '\U0001F1EE\U0001F1F3', None),
    ('hu', 'Magyar', 'Hungarian', '\U0001F1ED\U0001F1FA', 'GenX George mode'),
]

NUMBER_WORDS = re.compile(
    r'\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|'
    r'fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|'
    r'fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|half|halves|'
    r'double|doubles|triple|twice|thrice|percent|quarter)\b', re.I)
PLACEHOLDER = re.compile(r'\{[^}]*\}')
DROP_KEY = [
    re.compile(r'^minigame\.doom\.'),
    re.compile(r'^module\.[^.]+\.desc$'),
    re.compile(r'^constructable\.[^.]+\.desc$'),
    re.compile(r'^research\.tech\.[^.]+\.effect$'),
]


def flatten(d, prefix=''):
    out = {}
    for k, v in d.items():
        key = prefix + '.' + k if prefix else k
        if isinstance(v, dict):
            out.update(flatten(v, key))
        elif isinstance(v, str):
            out[key] = v
    return out


def load(path):
    with open(path, 'rb') as f:
        return flatten(tomllib.load(f))


def excluded(key, value):
    if any(r.search(key) for r in DROP_KEY):
        return 'family'
    bare = PLACEHOLDER.sub('', value)
    if re.search(r'\d', bare):
        return 'digit'
    if NUMBER_WORDS.search(bare):
        return 'number-word'
    return None


def legacy_changed(path, en):
    """Keys of the v4 page whose English text differs now, or that are gone."""
    src = open(path, encoding='utf-8').read()
    k = json.loads(re.search(r'const K=(\[.*?\]);', src, re.S).group(1))
    v = json.loads(re.search(r'const EV=(\[.*?\]);', src, re.S).group(1))
    return sorted(key for key, val in zip(k, v) if key in en and en[key] != val)


def write_js(name, header, body):
    path = os.path.join(OUT, name)
    with open(path, 'w', encoding='utf-8') as f:
        f.write('/* ' + header + '\n   GENERATED by pages/translate/build-strings.py. Do not edit. */\n')
        f.write(body)
    return os.path.getsize(path)


def main():
    if len(sys.argv) < 2:
        sys.exit('usage: build-strings.py /path/to/barnes-hut [--legacy old-main.js]')
    game = sys.argv[1]
    lang = os.path.join(game, 'lang')
    en = load(os.path.join(lang, 'en.toml'))
    for sub in ('title', 'tutorial', 'narrative'):
        en.update(load(os.path.join(lang, sub, 'en.toml')))

    keys, drops = [], {}
    for key in en:
        why = excluded(key, en[key])
        if why:
            drops[why] = drops.get(why, 0) + 1
        else:
            keys.append(key)
    keys.sort()

    changed = []
    if '--legacy' in sys.argv:
        changed = legacy_changed(sys.argv[sys.argv.index('--legacy') + 1], en)
        changed = [k for k in changed if k in set(keys)]

    os.makedirs(OUT, exist_ok=True)
    langs, total = [], 0
    for code, native, english, flag, mode in LANGS:
        row = {'code': code, 'name': native, 'english': english, 'flag': flag, 'toml': code + '.toml'}
        if mode:
            row['mode'] = mode
        if code != 'en':
            table = load(os.path.join(lang, code + '.toml'))
            # A shipped value with a digit outside a placeholder is dropped
            # too (for example a counter word written as a digit).
            vals = [table.get(k) for k in keys]
            vals = [None if v and re.search(r'\d', PLACEHOLDER.sub('', v)) else v for v in vals]
            row['gameDone'] = sum(1 for k, v in zip(keys, vals) if v and v != en[k])
            total += write_js(code + '.js', 'Translation Tool: shipped ' + english + ' strings.',
                              'window.SN_TR=window.SN_TR||{};SN_TR.game=SN_TR.game||{};\nSN_TR.game[' +
                              json.dumps(code) + ']=' + json.dumps(vals, ensure_ascii=False) + ';\n')
        langs.append(row)

    body = ('window.SN_TR=window.SN_TR||{};\n'
            'SN_TR.langs=' + json.dumps(langs, ensure_ascii=False) + ';\n'
            'SN_TR.keys=' + json.dumps(keys, ensure_ascii=False) + ';\n'
            'SN_TR.en=' + json.dumps([en[k] for k in keys], ensure_ascii=False) + ';\n'
            'SN_TR.changedSinceV4=' + json.dumps(changed) + ';\n')
    total += write_js('en.js', 'Translation Tool: English source strings and the language list.', body)

    print('english keys in game ....', len(en))
    print('keys exported ...........', len(keys))
    for why in sorted(drops):
        print('left out (%s) %s' % (why, '.' * max(1, 12 - len(why))), drops[why])
    print('changed since v4 page ...', len(changed))
    print('languages ...............', len(langs))
    print('bytes written ...........', total)


if __name__ == '__main__':
    main()
