# Squadcheck

Pomocná appka k Fantasy Premier League. Jedna HTML stránka, dvě serverless
funkce, žádný build. Nasadíš na Vercel a běží.

Nic se nestahuje, dokud nezadáš ID svého týmu. Každá záložka si data tahá
sama, až když na ni přijde řada.

## Co umí

| Záložka | K čemu je |
|---|---|
| **Sestava** | Kádr, zranění a otazníky, doporučení kapitána, optimální jedenáctka z tvých patnácti, upozornění na blanky a doubly v dalších šesti kolech |
| **Miniliga** | Pořadí, **průběžné body během kola**, vývoj pozic v grafu, hráči, které máš jen ty nebo naopak nemáš, kdo koho vlastní |
| **Hub ligy** | Novinky po kole, sezónní žebříčky (daň za transfery, zmrzlá lavička), zdraví kádrů, kapitánská mapa a efekt šablony |
| **Hráči** | Filtrovatelná tabulka všech hráčů s projekcí, detail s rozpisem kolo po kole, **porovnání dvou hráčů vedle sebe** |
| **Transfery** | Najde problémové hráče a navrhne náhrady do rozpočtu, včetně zisku za pět kol a pravidla „max 3 z klubu“ |
| **Program** | Rozpis na šest kol s vlastní obtížností, blanky a doubly, predikce změn cen, plánovač čipů |
| **Před deadlinem** | Porovná potvrzené sestavy s tím, koho vlastní tvoje miniliga |

V hlavičce běží odpočet do nejbližšího deadlinu.

## Nasazení

1. Nahraj repozitář na GitHub a naimportuj ho ve Vercelu. Žádná konfigurace
   buildu není potřeba — funkce v `api/` se detekují samy.
2. Otevři stránku a zadej ID svého týmu (najdeš ho v URL na `fantasy.premierleague.com`,
   `/entry/60480/…`). ID miniligy je volitelné.

Nechceš-li zadávat ID pokaždé, vyplň `CONFIG` na začátku `<script>` v `index.html`
a vstupní obrazovka se přeskočí.

### Volitelně: záložka Před deadlinem

Potřebuje účet u API-Football (free plán 100 dotazů denně):

1. Registrace na `dashboard.api-football.com`, zkopíruj API klíč.
2. Ve Vercelu: **Settings → Environment Variables** → `APIFOOTBALL_KEY`.
3. **Deployments → poslední → Redeploy**, aby se proměnná načetla.

Klíč nikdy neputuje do prohlížeče — zůstává na serveru v `api/football.js`.

## Soubory

```
index.html              celá aplikace: rozvržení, styly, logika
api/fpl.js              proxy na oficiální FPL API (řeší CORS)
api/football.js         proxy na API-Football (CORS, skrytí klíče, limity)
sw.js                   service worker — offline skořápka, data nikdy
manifest.webmanifest    PWA manifest
icon.svg                ikona
vercel.json             bezpečnostní hlavičky včetně CSP
test.mjs                smoke testy nad falešnými daty FPL
```

## Testy

```bash
npm install
npm test
```

Testy postaví falešný bootstrap i rozpis (včetně kola s blankem a doublem),
načtou stránku v jsdom a projdou kritické funkce: párování klubů, projekci
bodů, optimální jedenáctku, indexaci historie podle čísla kola a vykreslení
panelu Sestava. Nesahají na síť.

## Poznámky k provozu

**Limity API.** Miniliga o padesáti členech znamená sto dotazů na FPL. Chodí
frontou po pěti, s opakováním při 429, a odpovědi se v rámci stránky cachují —
Hub po načtení Miniligy proto nic nového nestahuje. Ligy nad 50 členů se
stránkují, strop je 200.

API-Football má tvrdou denní kvótu a adresa stránky je veřejná, takže
`api/football.js` má limit 20 dotazů za minutu na IP a denní strop 70 dotazů.
Sestavy se navíc tahají jen pro zápasy, které začínají do dvou hodin — dřív
stejně nejsou zveřejněné.

**Párování klubů.** FPL píše `Man Utd`, API-Football `Manchester United`.
Převodní tabulka je konstanta `CLUB_MAP` v `index.html`, klíčovaná podle
`short_name` (ten se mezi sezónami nemění, na rozdíl od `team.id`). Po
postupu nových týmů do Premier League je potřeba ji doplnit; do té doby
appka u nespárovaného klubu nemlčí, ale řekne to nahlas.

**Projekce bodů** je hrubý model, ne předpověď. Počítá zápas po zápase, takže
double kolo dostane zhruba dvojnásobek a blank nulu. Staví na xG a xA za 90
minut, podílu startů, obtížnosti soupeře a exekutorech standardek.

**Obtížnost soupeře** v záložce Program se nepočítá z FDR, které FPL nastaví
v srpnu a pak už nemění, ale z útočné a obranné síly obou týmů z bootstrapu.

**Sezóna pro API-Football** se odvozuje z měsíce, ne z kalendářního roku —
sezóna 2026/27 má hodnotu `2026` i v březnu 2027.

**Google Fonts** se načítají z CDN. Pro provoz v EU je čistší si ty čtyři
rodiny (Inter, Oswald, Space Mono, Dancing Script) stáhnout do repozitáře,
nahradit `<link>` vlastním `@font-face` a z CSP v `vercel.json` odstranit
`fonts.googleapis.com` a `fonts.gstatic.com`.

## Co appka nedělá

Nepřihlašuje se za tebe do FPL, takže nemůže provádět transfery ani měnit
sestavu — pracuje jen s veřejnými daty. Prodejní cenu hráče FPL veřejně
nedává, proto si ji v záložce Transfery můžeš ručně přepsat; uloží se
v prohlížeči zvlášť pro každé ID týmu.
