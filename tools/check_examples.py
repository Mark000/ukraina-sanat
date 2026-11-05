#!/usr/bin/env python3
"""Tarkistaa data/examples.tsv:n: puuttuvat esimerkit, ylimääräiset rivit ja *merkinnät*.
Tulostaa sanat, joilta esimerkki puuttuu, muodossa SECTION<TAB>uk<TAB>fi<TAB>huomio (sopii suoraan generointiin)."""
import os, re, sys
root = os.path.join(os.path.dirname(__file__), '..', 'data')
words, sec = [], None
for line in open(os.path.join(root, 'words.tsv'), encoding='utf-8'):
    line = line.rstrip('\r\n')
    if not line.strip() or line.startswith('#'): continue
    if line.startswith('@'): sec = line[1:].split('\t')[0]; continue
    p = line.split('\t')
    if len(p) >= 2 and p[0].strip(): words.append((sec, p[0].strip(), p[1].strip(), p[2].strip() if len(p) > 2 else ''))
ex = {}
for line in open(os.path.join(root, 'examples.tsv'), encoding='utf-8'):
    line = line.rstrip('\r\n')
    if not line.strip() or line.startswith('#'): continue
    p = line.split('\t')
    ex[p[0]] = p
known = {w[1] for w in words}
bad = [p[0] for p in ex.values() if len(p) != 3 or len(re.findall(r'\*[^*]+\*', p[1])) != 1]
extra = [k for k in ex if k not in known]
missing = [w for w in words if w[1] not in ex]
print(f'{len(words)} sanaa, {len(ex)} esimerkkiä, {len(missing)} puuttuu, {len(extra)} ylimääräistä, {len(bad)} viallista', file=sys.stderr)
for k in bad: print('VIALLINEN:', k, file=sys.stderr)
for k in extra: print('YLIMÄÄRÄINEN:', k, file=sys.stderr)
for w in missing: print('\t'.join(w))
