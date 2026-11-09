#!/usr/bin/env python3
"""Lukee sanatreenin tulokset yksityisestä Gististä (gh-komennolla) ja tulostaa yhteenvedon.

Käyttö:  python3 tools/analyze.py            # hakee Gistin
         python3 tools/analyze.py file.json  # lukee vientitiedoston
"""
import json, subprocess, sys, datetime as dt
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DAY = 86400000
GIST_DESC, GIST_FILE = "ukraina-sanat progress", "progress.json"


def load_events():
    if len(sys.argv) > 1:
        return json.loads(Path(sys.argv[1]).read_text())["events"]
    gists = json.loads(subprocess.check_output(["gh", "api", "/gists?per_page=100"]))
    g = next((x for x in gists if x["description"] == GIST_DESC and GIST_FILE in x["files"]), None)
    if not g:
        sys.exit("Gistiä ei löytynyt – onko synkronointi otettu käyttöön sovelluksessa?")
    raw = subprocess.check_output(["gh", "api", f"/gists/{g['id']}", "--jq", f'.files["{GIST_FILE}"].content'])
    return json.loads(raw)["events"]


def load_words():
    words, lessons, lesson, rows = {}, {}, None, []
    for line in (ROOT / "data/words.tsv").read_text().splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        if line.startswith("@"):
            lid, title = (line[1:].split("\t") + [""])[:2]
            lesson = lid.strip(); lessons[lesson] = title.strip(); continue
        parts = line.split("\t")
        rows.append((lesson, parts[0].strip(), parts[1].strip() if len(parts) > 1 else ""))
    for lesson, uk, fi in rows:  # käännöksellinen rivi luo sanan, viiterivi (pelkkä uk) liittää sen toiseen osioon
        if fi and uk not in words:
            words[uk] = {"fi": fi, "lesson": lesson, "lessons": set()}
    for lesson, uk, fi in rows:
        if uk in words:
            words[uk]["lessons"].add(lesson)
    return words, lessons


def apply(c, g, t):  # sama algoritmi kuin app.js:ssä
    c["n"] += 1; c["ok"] += g >= 1; c["last"] = t; c["lastG"] = g
    if g == 0:
        c["lapses"] += c["reps"] > 0; c["reps"] = 0; c["ivl"] = 0
        c["ease"] = max(1.3, c["ease"] - 0.2); c["due"] = t + 60000
    else:
        if g == 1: c["ivl"] = 0.5 if c["reps"] == 0 else max(1, c["ivl"] * 1.2); c["ease"] = max(1.3, c["ease"] - 0.15)
        if g == 2: c["ivl"] = 1 if c["reps"] == 0 else 3 if c["reps"] == 1 else c["ivl"] * c["ease"]
        if g == 3: c["ivl"] = 3 if c["reps"] == 0 else max(4, c["ivl"] * c["ease"] * 1.3); c["ease"] += 0.15
        c["reps"] += 1; c["due"] = t + c["ivl"] * DAY


def status(c):
    if not c or not c["n"]: return "uusi"
    return "opettelussa" if c["ivl"] < 3 else "osattu" if c["ivl"] < 21 else "vahva"


def main():
    events = sorted(load_events(), key=lambda e: e["t"])
    words, lessons = load_words()
    cards = defaultdict(lambda: dict(n=0, ok=0, reps=0, ivl=0, ease=2.5, due=0, lapses=0, last=0, lastG=-1))
    for e in events:
        apply(cards[(e["w"], e["d"])], e["g"], e["t"])
    now = dt.datetime.now().timestamp() * 1000
    day = lambda t: dt.datetime.fromtimestamp(t / 1000).date()

    print(f"Vastauksia yhteensä {len(events)}, ensimmäinen {day(events[0]['t']) if events else '-'}, viimeisin {day(events[-1]['t']) if events else '-'}")
    days = defaultdict(lambda: [0, 0])
    for e in events:
        d = days[day(e["t"])]; d[0] += 1; d[1] += e["g"] >= 1
    print("\nPäivittäin (vastauksia / oikein-%):")
    for d in sorted(days)[-14:]:
        n, ok = days[d]; print(f"  {d}  {n:4d}  {round(100*ok/n):3d}%")

    print("\nOsioittain (kortit: uusi / opettelussa / osattu / vahva):")
    for lid, title in lessons.items():
        cnt = defaultdict(int)
        for w, info in words.items():
            if lid in info["lessons"]:
                for d in ("uf", "fu"): cnt[status(cards.get((w, d)))] += 1
        print(f"  {title[:48]:48s} {cnt['uusi']:3d} {cnt['opettelussa']:3d} {cnt['osattu']:3d} {cnt['vahva']:3d}")

    for d, name in (("uf", "UA→FI"), ("fu", "FI→UA")):
        es = [e for e in events if e["d"] == d]
        if es: print(f"\n{name}: {len(es)} vastausta, oikein {round(100*sum(e['g']>=1 for e in es)/len(es))}%")

    hard = sorted(((k, c) for k, c in cards.items() if c["n"] >= 2), key=lambda kc: (kc[1]["ok"] / kc[1]["n"], -kc[1]["lapses"]))
    print("\nVaikeimmat (oikein/yritykset, unohdukset):")
    for (w, d), c in hard[:20]:
        print(f"  {w:28s} {words.get(w, {}).get('fi', '?')[:30]:30s} {d}  {c['ok']}/{c['n']}  unohdettu {c['lapses']}x")
    due = sum(1 for c in cards.values() if c["n"] and c["due"] <= now)
    print(f"\nKerrattavana nyt: {due} korttia · nähty {sum(1 for c in cards.values() if c['n'])}/{len(words)*2} korttia")


if __name__ == "__main__":
    main()
