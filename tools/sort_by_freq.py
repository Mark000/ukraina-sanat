#!/usr/bin/env python3
"""Järjestää kunkin osion sanat yleisyyden mukaan (yleisimmät ensin).

Osioiden järjestys säilyy. Perussanasto-osiot (P*) ovat jo valmiiksi taajuusjärjestyksessä,
joten niitä ei kosketa. Fraasin sijoitus = sen harvinaisimman sisältösanan sijoitus.
Perusmuodot haetaan pymorphy3:lla, jos se on asennettu (pip install pymorphy3 pymorphy3-dicts-uk);
muuten käytetään sanaa sellaisenaan.
"""
import re
from pathlib import Path
from merge_words import load, save

ROOT = Path(__file__).resolve().parent.parent
UNKNOWN = 60000

ranks = {}
for line in (ROOT / "data/freq.tsv").read_text().splitlines():
    if line and not line.startswith("#"):
        w, r = line.split("\t")
        ranks[w] = int(r)

try:
    import pymorphy3
    morph = pymorphy3.MorphAnalyzer(lang="uk")
    lemma = lambda w: morph.parse(w)[0].normal_form
except ImportError:
    lemma = lambda w: w


def word_rank(w):
    w = w.lower().replace("’", "'")
    return min(ranks.get(w, UNKNOWN), ranks.get(lemma(w), UNKNOWN))


def entry_rank(uk):
    toks = re.findall(r"[а-щьюяєіїґ']+", uk.lower())
    rs = [word_rank(t) for t in toks if t.strip("'")]
    content = [r for r in rs if r > 60]  # ohita hyvin yleiset pikkusanat (і, на, у…)
    return max(content or rs or [UNKNOWN])


def main():
    header, sections = load()
    for s in sections:
        if s["id"].startswith("P"):
            continue
        s["rows"].sort(key=lambda r: entry_rank(r[0]))  # stable: samanarvoiset pysyvät alkuperäisessä järjestyksessä
    save(header, sections)
    print("järjestetty", sum(1 for s in sections if not s["id"].startswith("P")), "osiota")


if __name__ == "__main__":
    main()
