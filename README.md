# Minileague Squad Check

Pomocná appka k Fantasy Premier League. Jedna HTML stránka, dvě serverless
funkce, žádný build. Nasadíš na Vercel a běží.

Nic se nestahuje, dokud nezadáš ID svého týmu. Každá záložka si data tahá
sama, až když na ni přijde řada.

## Co umí

| Záložka | K čemu je |
|---|---|
| **Sestava** | Kádr **seskupený podle pozic** s rozpisem na tři kola, živé body během kola, zranění a otazníky, doporučení kapitána, optimální jedenáctka z tvých patnácti, upozornění na blanky a doubly |
| **Miniliga** | Pořadí, **průběžné body během kola**, vývoj pozic v grafu, hráči, které máš jen ty nebo naopak nemáš, kdo koho vlastní |
| **Hub ligy** | Novinky po kole, sezónní žebříčky (daň za transfery, zmrzlá lavička), zdraví kádrů, kapitánská mapa a efekt šablony |
| **Hráči** | Filtrovatelná tabulka všech hráčů s projekcí, detail s rozpisem kolo po kole, **porovnání dvou hráčů vedle sebe** |
| **Transfery** | Najde problémové hráče a navrhne náhrady do rozpočtu, seřazené podle vlastnictví; statistiky pod tlačítkem **i** |
| **Program** | Rozpis na šest kol s vlastní obtížností, blanky a doubly, oficiální predikce změn cen, plánovač čipů |
| **Plánovač** | Přestupy na čtyři kola dopředu — banka, volné přestupy a hity spočítané kolo po kole |

V hlavičce běží odpočet do nejbližšího deadlinu a pod ní **kolejnice sezóny**:
38 čárek, jedna na kolo. Odehraná plná, aktuální se plní do deadlinu, budoucí
vlásek. Kolo, ve kterém má někdo z tvého kádru volno, dostane červenou tečku,
dvojité kolo mátovou. Je to jediné místo, kde je celá sezóna vidět naráz.

Appka umí připomenout deadline dvě hodiny předem přes notifikaci prohlížeče.

## Nasazení

1. Nahraj repozitář na GitHub a naimportuj ho ve Vercelu. Žádná konfigurace
   buildu není potřeba — funkce v `api/` se detekují samy.
2. Otevři stránku a zadej ID svého týmu (najdeš ho v URL na `fantasy.premierleague.com`,
   `/entry/60480/…`). ID miniligy je volitelné.

Nechceš-li zadávat ID pokaždé, vyplň `CONFIG` na začátku `<script>` v `index.html`
a vstupní obrazovka se přeskočí.

## Soubory

```
index.html              celá aplikace: rozvržení, styly, logika
api/fpl.js              proxy na oficiální FPL API (řeší CORS)
api/badge.js            odznaky klubů z CDN Premier League, převedené na WebP
sw.js                   service worker — skořápka a odznaky, data nikdy
club-marks.svg          záložní barevné značky 20 klubů (sprite)
manifest.webmanifest    PWA manifest
icon.svg, favicon.svg   ikona aplikace a favicon
brand/                  logo, zdroje značky, mockup redesignu
vercel.json             bezpečnostní hlavičky včetně CSP
test.mjs                87 smoke testů nad falešnými daty FPL
```

### Odznaky klubů

Klíčem je `teams[].code` z bootstrapu, **ne `id`** — `code` přežívá mezi
sezónami, zatímco `id` se každý srpen přehazuje podle abecedy.

`api/badge.js` stáhne oficiální PNG z CDN Premier League, převede ho na WebP
a nechá na edge cache rok. Jde to přes vlastní doménu proto, že CSP má
`img-src 'self'` a cizí zdroj by se neprokreslil. Konverze potřebuje `sharp`
(`npm i sharp`); bez něj funkce vrátí původní PNG a obrázek se zobrazí taky,
jen o pár kB větší.

Když odznak na CDN není — typicky u čerstvého nováčka — spadne se na barevnou
značku z `club-marks.svg`: klubová barva, vzor dresu a zkratka. Žádná ochranná
známka se v repozitáři neukládá.

## Testy

```bash
npm install
npm test
```

Testy postaví falešný bootstrap i rozpis (včetně kola s blankem a doublem),
načtou stránku v jsdom a projdou kritické funkce: projekci bodů včetně
defenzivních příspěvků, optimální jedenáctku, prodejní ceny, predikce cen,
kolejnici sezóny, plánovač přestupů, snapshoty miniligy a vykreslení panelu
Sestava. Několik testů hlídá i CSS — že stupnice obtížnosti zůstala jednou
sadou proměnných a že žádná media query není definovaná dvakrát. Nesahají
na síť.

## Poznámky k provozu

**Limity API.** Miniliga o padesáti členech znamená sto dotazů na FPL. Chodí
frontou po pěti, s opakováním při 429, a odpovědi se v rámci stránky cachují —
Hub po načtení Miniligy proto nic nového nestahuje. Ligy nad 50 členů se
stránkují, strop je 200.

**Projekce bodů.** Hlavní číslo v přehledech je `ep_next` — oficiální projekce,
kterou počítá samo FPL a posílá ji v bootstrapu. V rozhraní je označená jako
**xP FPL**.

Vlastní model (`perMatchXp` → `projectGw` → `projectRange`) zůstal jen tam, kde
FPL nic nedává: výhled na pět a šest kol dopředu a double kola. `ep_next` je
totiž vždy za jedno kolo bez ohledu na to, kolik zápasů tým reálně hraje —
v doublu proto beru vyšší z obou čísel a v rozhraní to označím.

**Živé body.** Dokud kolo běží, na hřišti i v tabulce kádru jsou body, které
hráči skutečně mají (`event/{gw}/live/`), ne projekce na příští kolo — kapitánovy
už zdvojené. Pomlčka znamená „ještě nenastoupil“, což je jiná zpráva než nula.
Po uzavření kola se zobrazení vrátí k FDR a projekcím.

**Kdy appka navrhne transfer.** Priorita 1: hráč je zraněný, suspendovaný nebo
nedostupný; šance nastoupit je 50 % a méně; nebo ho čeká blok tří zápasů
s průměrnou obtížností 4.3+. Priorita 2: šance nastoupit 51–99 %; průměrná
obtížnost bloku 3.9+; nebo tři a víc zápasů po sobě pod 3 body (počítáno jen
ze zápasů s 60+ minutami).

Dvě pojistky proti planým poplachům: obtížnost se počítá přes `ownFdr()`, která
zohledňuje sílu vlastního týmu — hráč Arsenalu už není trestaný za to, že hraje
proti jiným silným klubům. A hráč s formou 4+ nebo 4.5+ body na zápas se
neflaguje kvůli programu ani suchu vůbec: kdo boduje, ten se neprodává.

**Doporučení náhrad** se řadí **výhradně podle `selected_by_percent`** — kolik
procent hráčů FPL daného hráče vlastní. Do pořadí nevstupuje projekce, forma
ani rozpis. Je to vědomá volba: vysoké vlastnictví drží tvůj tým s polem, takže
když hráč zaboduje, neztrácíš. Náskok se tímhle způsobem ale nezískává —
kdo chce jít proti proudu, najde nízké vlastnictví v záložce Hub ligy.

Řádek náhrady ukazuje jméno, tým, cenu, vlastnictví, body za minulé kolo
a odehrané minuty. Všechno ostatní je pod tlačítkem **i** (ne hover — na
dotykovém displeji by tooltip byl nedostupný).

**Statistiky u hráče** se řídí jeho pozicí: brankář dostane zákroky, chycené
penalty a xGC; obránce čistá konta, xGC a defenzivní příspěvky; záložník
xGI i xGC, protože bere body z obou stran; útočník xGI, xG a xA. Pole, která
FPL v dané sezóně neposílá, se prostě nezobrazí — funkce `stat()` vrací `null`
místo `NaN`.

**Obtížnost soupeře** se nepočítá z FDR, které FPL nastaví v srpnu a pak už
nemění, ale z útočné a obranné síly obou týmů z bootstrapu (`ownFdr()`).

Barvy jsou **relativní**: prahy se počítají jako kvintily napříč všemi zápasy
v zobrazeném okně, takže každé pásmo dostane zhruba pětinu buněk. Pevné hranice
tohle nezvládly — síly týmů se u většiny klubů liší málo a ticker vycházel celý
stejně zelený. Když je rozptyl hodnot menší než 0,4, kvintily se nepoužijí
a nastoupí pevná stupnice: jednobarevná mřížka nenese žádnou informaci.

**Záloha na začátku sezóny — tři úrovně.** `strength_attack_*`
a `strength_defence_*` jsou v bootstrapu nuly, dokud je FPL po několika kolech
nedopočítá. `strength_overall_home/away` (stupnice 1–5) ale vyplněné **jsou**
od začátku, takže `teamStrengths()` sáhne po nich: pořád to rozliší domácí
zápas od venkovního, jen hruběji. Teprve když chybí i ty, vrací `ownFdr()`
oficiální FDR z rozpisu.

Rozhraní o tom nemlčí: `strengthsReady()` říká „máme ostrá data“,
`strengthsUsable()` „aspoň něco spočítat jde“, a text pod tabulkou podle toho
pojmenuje zdroj. Bez téhle pojistky vycházela obtížnost všech zápasů 1.0
(poměr sil 0 → vzorec pod stupnicí → `Math.max(1, …)`) a celá liga vypadala
jako samé lehké zápasy.

**Defenzivní příspěvky.** Za dosažení prahu (10 akcí u obránců, 12 u záložníků
a útočníků) dávají 2 body; brankáři je nedostávají. Model je nepočítá skokem —
sezónní průměr přesně na prahu neznamená „vždycky“, takže pravděpodobnost
zásahu jde přes logistickou křivku kolem prahu. Bez tohohle model systematicky
podhodnocoval defenzivní záložníky.

**Prodejní ceny.** Nákupní cenu bere appka z `entry/{id}/transfers/` — u každého
přestupu je `element_in_cost`. Hráč, kterého jsi nikdy nekupoval, je z původního
kádru, takže jeho nákupní cena je `now_cost − cost_change_start`. Prodejní cena
se pak dopočítá podle pravidla FPL: ze zisku dostaneš zpátky polovinu
zaokrouhlenou dolů na desetinu. Ruční přepis zůstal, ale už jen jako výjimka —
UI u každého čísla říká, odkud je.

**Změny cen.** Appka si směr nedomýšlí z čistého přílivu transferů. FPL dnes
posílá `price_change_projections` s pravděpodobností na tři dny dopředu,
`price_change_percent` jako naplněnost ukazatele a
`game_config.settings.price_change_deadlines` jako přesné časy změn. Bereme
oficiální číslo, když existuje — stejně jako u `ep_next`. Když projekce
v datech nejsou (bývá to před prvním kolem), appka to řekne místo aby hádala.

**Google Fonts** se načítají z CDN. Pro provoz v EU je čistší si ty tři
rodiny (Archivo, Inter, Space Mono) stáhnout do repozitáře,
nahradit `<link>` vlastním `@font-face` a z CSP v `vercel.json` odstranit
`fonts.googleapis.com` a `fonts.gstatic.com`.

## Co appka nedělá

Nepřihlašuje se za tebe do FPL, takže nemůže provádět transfery ani měnit
sestavu — pracuje jen s veřejnými daty. Plánovač je počítadlo, ne ovladač:
samotné přestupy pořád uděláš na webu FPL.

Snapshoty miniligy a plán přestupů se ukládají do `localStorage`, tedy jen
v tom prohlížeči, kde je vytvoříš. Na jiném zařízení začínáš s prázdnou
historií. Sdílené úložiště (Vercel KV) je logický další krok, ale tohle
funguje hned a bez dalšího účtu.

Naplánovaná upozornění na deadline stojí na Notification Triggers, které
zatím neumí každý prohlížeč. Když chybí, appka to napíše rovnou místo aby
slibovala připomínku, která nepřijde.
