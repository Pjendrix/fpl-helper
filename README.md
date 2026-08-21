# Squad Check — FPL

Zadáš ID svého Fantasy Premier League týmu a uvidíš rozestavení, kdo je zraněný
nebo suspendovaný, a jak těžký program mají tvoji hráči na dalších 5 kol.

Data z oficiálního FPL API (`fantasy.premierleague.com/api`). Žádné přihlašování,
žádné API klíče.

## Soubory

```
index.html      celá stránka — HTML, CSS i JS v jednom souboru
package.json    říká Vercelu, že api/fpl.js je ES modul (bez toho se funkce nenasadí)
vercel.json     bezpečnostní hlavičky
api/fpl.js      serverless proxy na FPL API
.gitignore
```

Nic se nebuilduje. Žádné závislosti, žádné `npm install`.

## Proč je tam proxy

FPL API je veřejné, ale neposílá CORS hlavičky — z prohlížeče na něj přímo nesáhneš.
`api/fpl.js` běží na serveru, kde CORS neplatí, zavolá API a odpověď pošle stránce.

Přijímá jen cesty z whitelistu (`bootstrap-static/`, `fixtures/`, `entry/{id}/`,
`entry/{id}/event/{gw}/picks/`, `element-summary/{id}/`). Bez toho by to byla otevřená
proxy, kterou by kdokoli mohl použít jako relay na cizí adresy.

## Nahrání na GitHub

```bash
cd fpl-squad
git init
git add .
git commit -m "Squad Check"
git branch -M main
git remote add origin https://github.com/<uzivatel>/<repo>.git
git push -u origin main
```

Repo si předtím založ na github.com — bez README, .gitignore i licence, máš je tady.

Zkontroluj, že se nahrála i složka `api/`.

## Nasazení z GitHubu na Vercel

1. vercel.com → Add New → Project
2. Import Git Repository → vyber svoje repo
3. Framework Preset: **Other**
4. Root Directory: `./`
5. Build a Output Settings nech prázdné
6. Deploy

Každý další `git push` do `main` nasadí novou verzi sám.

## Když se něco pokazí

Otevři si v prohlížeči přímo `https://<tvoje-adresa>/api/fpl?path=fixtures/`.

- Vrátí se JSON → proxy funguje, problém je jinde
- Vrátí se Vercel 404 stránka → funkce se nenasadila. Zkontroluj v projektu
  Deployments → poslední deploy → Functions, jestli je tam `api/fpl`. Když ne,
  chybí `package.json` nebo se nenahrála složka `api/`.

## Limity

Sestava se čte z posledního odehraného kola — endpoint `entry/{id}/event/{gw}/picks/`
pro nezačaté kolo neexistuje. Rozpracované transfery před deadlinem se tedy neprojeví;
na ty by byl potřeba autentizovaný endpoint `/api/my-team/{id}/`, který vyžaduje
přihlašovací cookie a do veřejné stránky nepatří.

Adresa bude veřejná a kdokoli s odkazem si může zadat libovolné ID týmu. Jsou to
stejně veřejná data z FPL, ale kdyby ti to vadilo, v nastavení projektu jde zapnout
Vercel Authentication.
