#!/usr/bin/env python3
"""Luo ääntämistiedostot (mp3) kaikille sanoille ja esimerkkilauseille Microsoftin neuroäänellä (edge-tts).

Käyttö: python3 tools/make_audio.py [--voice uk-UA-PolinaNeural] [--force]
Vaatii: pip install edge-tts (venvissä). Tiedosto audio/<sha1(teksti)[:16]>.mp3, jossa teksti on täsmälleen
se, mitä sovellus ääntää (sana tai esimerkkilause ilman *tähtiä*). Olemassa olevia ei luoda uudelleen,
joten skriptin voi ajaa aina sanojen lisäämisen jälkeen. Sovellus käyttää selaimen puhesynteesiä,
jos tiedostoa ei ole.
"""
import asyncio, hashlib, sys
from pathlib import Path
import edge_tts

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "audio"


def audio_name(text):
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:16] + ".mp3"


def texts():
    out, seen = [], set()
    for line in (ROOT / "data/words.tsv").read_text().splitlines():
        if not line.strip() or line.startswith(("#", "@")):
            continue
        uk = line.split("\t")[0].strip()
        if uk and uk not in seen:
            seen.add(uk); out.append(uk)
    for line in (ROOT / "data/examples.tsv").read_text().splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        p = line.split("\t")
        if len(p) > 1 and p[1].strip():
            ex = p[1].strip().replace("*", "")
            if ex not in seen:
                seen.add(ex); out.append(ex)
    return out


async def make(text, voice, sem, stats):
    path = OUT / audio_name(text)
    async with sem:
        for attempt in range(4):
            try:
                await edge_tts.Communicate(text, voice).save(str(path))
                stats["ok"] += 1
                return
            except Exception as e:  # palvelu rajoittaa välillä nopeutta: odota ja yritä uudelleen
                if path.exists(): path.unlink()
                if attempt == 3:
                    stats["fail"].append((text, str(e)))
                await asyncio.sleep(2 * (attempt + 1))


async def main():
    voice = sys.argv[sys.argv.index("--voice") + 1] if "--voice" in sys.argv else "uk-UA-PolinaNeural"
    OUT.mkdir(exist_ok=True)
    todo = [t for t in texts() if "--force" in sys.argv or not (OUT / audio_name(t)).exists()]
    print(f"luodaan {len(todo)} äänitiedostoa ({voice})")
    sem, stats = asyncio.Semaphore(6), {"ok": 0, "fail": []}
    await asyncio.gather(*(make(t, voice, sem, stats) for t in todo))
    print(f"valmis: {stats['ok']} luotu, {len(stats['fail'])} epäonnistui")
    for t, e in stats["fail"][:20]:
        print("  EPÄONNISTUI:", t, "–", e)


if __name__ == "__main__":
    asyncio.run(main())
