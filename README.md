# Ukrainan sanat

Sanatreeni Ukrainan kielen jatkokurssi 1:n (Tampereen kesäyliopisto, syksy 2026, oppikirja *Яблуко*) sanastolle.

**Sovellus:** https://mark000.github.io/ukraina-sanat/

- Molemmat suunnat (UA → FI, FI → UA), kortit / monivalinta / kirjoitus
- Välitoisto (SM-2-tyyppinen): vaikeat sanat tulevat useammin, osatut harvemmin
- Jokainen vastaus tallennetaan; tulokset synkronoidaan yksityiseen GitHub Gistiin (asetuksista)
- Ääntäminen selaimen puhesynteesillä (jos laitteessa on ukrainankielinen ääni)

## Sanaston lisääminen

Sanat ovat tiedostossa `data/words.tsv` (ukraina, suomi, huomio sarkaimella erotettuna).
`@ID<TAB>otsikko` aloittaa uuden osion. Edistyminen on sidottu ukrainankieliseen tekstiin.

## Analyysi

```
python3 tools/analyze.py
```

Hakee tulokset Gististä `gh`-komennolla ja tulostaa yhteenvedon (päivät, osiot, vaikeimmat sanat).

## Työkalut

- `tools/merge_words.py lisäykset.tsv` lisää sanoja ilman kaksoiskappaleita (`SECTION<TAB>uk<TAB>fi<TAB>huomio`).
- `tools/sort_by_freq.py` järjestää osioiden sanat yleisyyden mukaan (`data/freq.tsv`; pymorphy3 parantaa tarkkuutta, jos asennettu).
