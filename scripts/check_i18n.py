#!/usr/bin/env python3
"""Checks the UI strings registered with addStrings({ en: {...}, ar: {...} }) across js/ and background.js.

Reports, per file:
  - keys that have English but no Arabic (and the reverse)
  - literal t('key') / tr('key') calls whose key is registered nowhere in English (dotted keys only)
Exit code 1 when anything is missing.  usage: python3 scripts/check_i18n.py [--quiet]
"""
import glob, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
KEY = re.compile(r"""\s*(?:'((?:[^'\\]|\\.)+)'|"((?:[^"\\]|\\.)+)"|([A-Za-z_$][\w$]*))\s*:""")


def block(src, start):
    """Text of the {...} object whose opening brace is at or after start (strings respected)."""
    i = src.index('{', start)
    depth, j, q = 0, i, None
    while j < len(src):
        c = src[j]
        if q:
            if c == '\\':
                j += 2
                continue
            if c == q:
                q = None
        elif c in '\'"`':
            q = c
        elif c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return src[i + 1:j]
        j += 1
    return src[i + 1:]


def keys_of(obj):
    """Top-level keys of an object literal body (handles several keys per line and nested values)."""
    out, depth, j, q, expect = set(), 0, 0, None, True
    while j < len(obj):
        c = obj[j]
        if q:
            if c == '\\':
                j += 2
                continue
            if c == q:
                q = None
            j += 1
            continue
        if c == '/' and obj[j:j + 2] == '//':
            j = obj.find('\n', j)
            if j < 0:
                break
            continue
        if c == '/' and obj[j:j + 2] == '/*':
            j = obj.find('*/', j)
            if j < 0:
                break
            j += 2
            continue
        if depth == 0 and expect and not c.isspace():
            m = KEY.match(obj, j)
            if m:
                out.add(m.group(1) or m.group(2) or m.group(3))
                j = m.end()
                expect = False
                continue
            expect = False
        if c in '\'"`':
            q = c
        elif c in '{[(':
            depth += 1
        elif c in '}])':
            depth -= 1
        elif c == ',' and depth == 0:
            expect = True
        j += 1
    return out


def langs_in(call):
    res = {}
    for lang in ('en', 'ar'):
        m = re.search(r'(?:^|[\s{,])' + lang + r'\s*:\s*\{', call)
        if m:
            res[lang] = keys_of(block(call, m.end() - 1))
    return res


files = sorted(glob.glob('js/**/*.js', recursive=True)) + ['background.js']
all_en, problems, used = set(), [], []
for f in files:
    src = open(f, encoding='utf-8').read()
    for m in re.finditer(r'\baddStrings\(\s*\{', src):
        call = block(src, m.end() - 1)
        langs = langs_in(call)
        en, ar = langs.get('en', set()), langs.get('ar', set())
        all_en |= en | ar if not en else en
        for k in sorted(en - ar):
            problems.append(f'{f}: no Arabic for {k!r}')
        for k in sorted(ar - en):
            problems.append(f'{f}: Arabic only (no English) for {k!r}')
    code = '\n'.join(l for l in src.split('\n') if not l.lstrip().startswith(('//', '*', '/*')))
    for m in re.finditer(r"""\b(?:t|tr)\(\s*'([a-z][\w-]*(?:\.[\w-]+)+)'""", code):
        used.append((f, m.group(1)))

for f, k in used:
    if k not in all_en:
        problems.append(f'{f}: t({k!r}) is not registered in any addStrings English table')

seen = set()
problems = [p for p in problems if not (p in seen or seen.add(p))]
if '--quiet' not in sys.argv:
    print('\n'.join(problems))
print(f'{len(all_en)} English keys, {len(problems)} problems')
sys.exit(1 if problems else 0)
