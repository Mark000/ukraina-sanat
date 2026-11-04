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
