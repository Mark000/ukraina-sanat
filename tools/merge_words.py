#!/usr/bin/env python3
"""Lisää sanoja data/words.tsv:hen ilman kaksoiskappaleita.

Käyttö: python3 tools/merge_words.py [--link] additions.tsv [--section ID "otsikko" on|off AFTER_ID] ...
additions.tsv: SECTION<TAB>uk<TAB>fi[<TAB>note]. Uusi osio luodaan, jos sitä ei ole
(sijoitetaan --after-kohdan perään tai loppuun). Sana ohitetaan, jos sama ukrainankielinen
teksti (normalisoituna) on jo jossain osiossa. --link: ohittamisen sijaan olemassa oleva sana
liitetään myös tähän osioon viiterivillä (pelkkä ukrainankielinen sana; käännös ja edistyminen yhteiset).
"""
import re, sys
from pathlib import Path

WORDS = Path(__file__).resolve().parent.parent / "data/words.tsv"


def norm(s):
    s = s.lower().replace("’", "'").replace("ʼ", "'")
    return re.sub(r"[.…!?]+$", "", s).strip()


def load():
    header, sections, cur = [], [], None
    for line in WORDS.read_text().splitlines():
        if line.startswith("@"):
            parts = line[1:].split("\t")
            cur = {"id": parts[0], "title": parts[1] if len(parts) > 1 else parts[0],
                   "flag": parts[2] if len(parts) > 2 else "", "rows": []}
            sections.append(cur)
        elif cur is None:
            header.append(line)
        elif line.strip() and not line.startswith("#"):
            cur["rows"].append(line.split("\t"))
    return header, sections


def save(header, sections):
    out = list(header)
    while out and not out[-1].strip():
        out.pop()
    for s in sections:
        out += ["", "\t".join(["@" + s["id"], s["title"]] + ([s["flag"]] if s["flag"] else []))]
        out += ["\t".join(r).rstrip("\t") for r in s["rows"]]
    WORDS.write_text("\n".join(out) + "\n")


def main():
    args = sys.argv[1:]
    titles, after = {}, {}
    files, link = [], False
    i = 0
    while i < len(args):
        if args[i] == "--link":
            link = True; i += 1
        elif args[i] == "--section":  # --section ID "title" off|on AFTER_ID
            titles[args[i + 1]] = (args[i + 2], "" if args[i + 3] == "on" else "off")
            after[args[i + 1]] = args[i + 4]
            i += 5
        else:
            files.append(args[i]); i += 1
    header, sections = load()
    by_id = {s["id"]: s for s in sections}
    seen = {norm(r[0]): r[0] for s in sections for r in s["rows"] if len(r) > 1}
    added, linked, skipped = 0, 0, []
    for f in files:
        for line in Path(f).read_text().splitlines():
            if not line.strip() or line.startswith("#"):
                continue
            p = line.split("\t")
            sec, uk, fi = p[0].strip(), p[1].strip(), p[2].strip()
            note = p[3].strip() if len(p) > 3 else ""
            if sec not in by_id:
                title, flag = titles.get(sec, (sec, ""))
                s = {"id": sec, "title": title, "flag": flag, "rows": []}
                pos = next((k + 1 for k, x in enumerate(sections) if x["id"] == after.get(sec)), len(sections))
                sections.insert(pos, s); by_id[sec] = s
            if norm(uk) in seen:
                if link and not any(norm(r[0]) == norm(uk) for r in by_id[sec]["rows"]):
                    by_id[sec]["rows"].append([seen[norm(uk)]]); linked += 1
                else:
                    skipped.append(uk)
                continue
            seen[norm(uk)] = uk
            by_id[sec]["rows"].append([uk, fi] + ([note] if note else []))
            added += 1
    save(header, sections)
    print(f"lisätty {added}, liitetty {linked}, ohitettu {len(skipped)} (jo olemassa)")
    if skipped:
        print("ohitetut:", ", ".join(skipped))


if __name__ == "__main__":
    main()
