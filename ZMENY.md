# Opravy z code review (09/2026) — verze statiky v34, archiv v4

## Co nahrát (rozbal do kořene repa, přepiš)
sw.js · index.html · vercel.json · firestore.rules · test.mjs · .gitignore
api/fpl.js · api/news.js · api/badge.js
css/mobile.css · assets/mark.webp
js/core.js · js/status.js · js/histcache.js · js/h2h.js · js/tabs-hub.js
js/tabs-prices.js · js/tabs-league.js · js/tabs-players.js · js/tabs.js
js/advisor.js · js/ui.js · js/mobile.js · js/sync.js · js/firebase.js · js/types.d.ts

## Co smazat ručně (ZIP mazat neumí)
- `app.css` v kořeni (stará kopie css/app.css, veřejně servírovaná)
- `news.js` v kořeni (kopie api/news.js servírovaná jako statika)
- `download` v kořeni (obsah .gitignore pod špatným jménem — nahrazuje ho `.gitignore`)

## Po nasazení
1. **Firestore rules** nahrát do konzole (`firestore.rules` se změnil: `gw == ID dokumentu`).
2. Nic dalšího — cache v34 se propíše sama.

## Co se změnilo (kódy z review)
- F1  `refreshRound()` v core.js: rozpis běžícího kola se obnovuje každou minutu
      (status tick + H2H timer), bootstrap jednou za hodinu, po návratu na kartu
      po >5 min plný refresh. Vlastní sestava se tiše přenačte jednou za 5 min
      (bez kostry).
- F2  Archiv: snímek nese `ck` (data_checked). Do Firestore jde až zkontrolované
      kolo; předběžný lokální snímek se po kontrole zahodí a stáhne znovu.
      ARCH_V 3 → 4, aby šly staré cloudové snímky přepsat.
- F3  Autosub nepřeskakuje náhradníka, jehož zápas ještě neskončil — čeká.
- F4  Pořadí střídání je pořadí lavičky (jako FPL), ne pořadí základu.
- F5  „ještě nehrálo“ nepočítá hráče, kteří dohráli s nulou.
- F6  `pooled(…, 2)` všude (bylo 5 na šesti místech). Hlídá test.
- F7  Proxy: odstávka FPL = 503 + Retry-After 60; klient opakuje jen 429/503.
- F8  Hráč mimo bootstrap sestavu neshodí — vynechá se a je v Upozorněních.
- F9  `leagueRanks`: `total_points: null` se řadí jako neznámý, ne jako nula.
- F10 `api/news.js`: nevalidní pubDate už neshodí celý zdroj.
- F11 `ttlFor`: transfers/ = 120 s (dřív mrtvá větev).
- U1  Livebar sestavy ukazuje „stav k HH:MM“.
- U4  Po konci kola „nehrál“ místo „zatím nehrál“.
- U5  Neexistující ID týmu: srozumitelná hláška místo surové cesty API.
- U6  Chybějící sestava: tři různé hlášky (před deadlinem / tým v kole
      neexistoval / výpadek FPL s tlačítkem Zkusit znovu).
- U3  Mobil: popisky lišty 10.5px, tlačítka v hlavičce 40×40, focus-visible
      pro spodní lištu a plachtu.
- U7  `mark.webp` 256px → 60px (30 kB → 3,7 kB).
- T1  `esc()` na názvu týmu v mobilní plachtě.
- T2  Inline `onerror` u odznaků nahrazen delegovaným posluchačem;
      `'unsafe-inline'` je ze `script-src` pryč.
- T3  `test.mjs`: asynchronní testy se awaitují, selhání shodí běh.
- T4  Plná kvóta localStorage: nejdřív se maže záloha bootstrapu, archiv až pak.
- T5  `bootReady()` — jeden sdílený slib místo osmi `if(!BOOT)`.
- T6  Sync: značky smazání starší 30 dnů se z `_ts` pročistí.
- T7  Service worker necachuje chybové odpovědi.
- T8  `sharp` z badge.js pryč (nikdy se nenainstaloval), mrtvé soubory viz výše.
- T9  `liveMap` = pohled na `liveStats`; `render()` a `buildNews()` používají `elsById()`.
- T10 VOLATILE: FDR_CUTS, ADV_MINS/SQUAD/BANK, LAST_LIVE_TOTAL.
- T11 Pravidla: `string(gw) == ID dokumentu`; komentář ve firebase.js opraven.
- T12 Klientský fetch má 15 s timeout, chyby nesou `status`.
- Typecheck: `debugSin` v types.d.ts → 0 chyb.

## Neřešeno záměrně
- U2 (Sestava/Miniliga pod „Více“) — návrhové rozhodnutí, na Přehledu je živý
  součet i upozornění; kdyby chyběl dres, přesuň `t-squad` do PRIMARY v mobile.js.
- U8 (sjednocení „sestava/kádr/tým“, „Hub/Miniliga“) — potřebuje rozhodnutí o slovech.
- U7 fonty: přesun Google Fonts na neblokující načtení by vyžadoval inline
  `onload`, což by vrátilo `unsafe-inline`. Řešení je self-host fontů.

Testy: 525 ✓ / 0 ✗ · `tsc -p jsconfig.json`: 0 chyb.
