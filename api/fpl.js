// Serverless proxy pro oficialni FPL API.
// Duvod existence: fantasy.premierleague.com neposila CORS hlavicky,
// takze prohlizec na nej primo nedosahne. Tahle funkce bezi na serveru,
// kde CORS neplati, a vysledek preposle strance.

const BASE = "https://fantasy.premierleague.com/api";

// Utrzek upstream odpovedi konci ve vlastnim UI, takze z nej nesmi jit
// nic vykreslit. Apostrof je v seznamu schvalne - staci jeden atribut
// v jednoduchych uvozovkach a chybejici &#39; je dira.
const escHtml = (t) =>
  String(t).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Whitelist - proxy nesmi byt otevrena pro libovolne cile.
const ALLOWED = [
  /^bootstrap-static\/$/,
  /^fixtures\/$/,
  /^fixtures\/\?event=\d+$/,
  /^fixtures\/\?future=1$/,
  /^entry\/\d+\/$/,
  /^entry\/\d+\/history\/$/,
  /^entry\/\d+\/transfers\/$/,
  /^entry\/\d+\/event\/\d+\/picks\/$/,
  /^element-summary\/\d+\/$/,
  /^event\/\d+\/live\/$/,
  // page_standings pro velke ligy, phase pro mesicni tabulky (bootstrap: phases[])
  /^leagues-classic\/\d+\/standings\/(\?(page_standings|phase)=\d+(&(page_standings|phase)=\d+)?)?$/,
];

// Jak dlouho drzet odpoved na edge cache. Live data se meni po minutach,
// sestavy manazeru po kolech, bootstrap jednou denne.
function ttlFor(path) {
  if (/^event\/\d+\/live\/$/.test(path)) return 45;
  if (path.startsWith("entry/")) return 60;
  if (/^leagues-classic\/\d+\/standings\/\?phase=\d+$/.test(path)) return 300;
  if (path.startsWith("leagues-classic/")) return 120;
  if (/^entry\/\d+\/transfers\/$/.test(path)) return 120;
  return 600;
}

// ---------------------------------------------------------------------
// Cloudflare pred FPL API blokuje pozadavky, ktere nevypadaji jako
// prohlizec. Puvodni sada hlavicek prestala stacit - vracelo se 403 i
// na bootstrap-static/, tedy na tom nejmirnejsim endpointu, coz znamena,
// ze blok neni endpointovy, ale ze nas Cloudflare klasifikuje jako bota.
//
// Tri veci, ktere to nejcasteji zpusobuji, a jak se resi:
//
// 1) NESOULAD HLAVICEK. Kdyz se posle Chrome User-Agent, ale chybi
//    sec-ch-ua a sec-fetch-*, je to okamzity signal - skutecny Chrome je
//    posila vzdycky. Radek "Chrome rika, ze je Chrome, ale nechova se
//    jako Chrome" je presne to, co Cloudflare hleda. Cela sada musi
//    sedet dohromady vcetne cisla verze.
//
// 2) ZASTARALA VERZE. UA s Chrome/124 v roce 2026 je verze stara pres
//    rok - to samo o sobe zvedne skore. Verze se drzi v jedne konstante,
//    aby se pri pristi aktualizaci menila na jednom miste.
//
// 3) CHYBEJICI COOKIE. Cloudflare casto pusti az druhy pozadavek, ktery
//    nese cookie z prvniho. Proto se pri 403 nejdriv sahne na domovskou
//    stranku, seberou se cookies a dotaz se zopakuje s nimi.
//
// Origin a X-Requested-With se posilat prestaly zamerne: prohlizec je
// pri obycejnem GET na vlastni API neposila a jejich pritomnost byla
// dalsi nesrovnalost navic.
// ---------------------------------------------------------------------
const CHROME_MAJOR = "137";

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    `(KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`,
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  Referer: "https://fantasy.premierleague.com/",
  "sec-ch-ua": `"Chromium";v="${CHROME_MAJOR}", "Not/A)Brand";v="24", ` +
    `"Google Chrome";v="${CHROME_MAJOR}"`,
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  DNT: "1",
  Connection: "keep-alive",
};

// Cookies z domovske stranky. Drzi se v pameti instance - Vercel funkce
// zije mezi pozadavky nekolik minut, takze se homepage netaha pokazde.
let COOKIE_JAR = null;
let COOKIE_AT = 0;
const COOKIE_TTL = 5 * 60 * 1000;

async function getCookies(force) {
  const fresh = COOKIE_JAR && Date.now() - COOKIE_AT < COOKIE_TTL;
  if (fresh && !force) return COOKIE_JAR;

  try {
    const r = await fetch("https://fantasy.premierleague.com/", {
      headers: {
        ...BROWSER_HEADERS,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
      },
      redirect: "follow",
    });

    // getSetCookie() je novejsi a vraci vsechny hlavicky zvlast; starsi
    // runtime umi jen slepenou verzi pres get().
    const raw = typeof r.headers.getSetCookie === "function"
      ? r.headers.getSetCookie()
      : [r.headers.get("set-cookie")].filter(Boolean);

    COOKIE_JAR = raw.map((c) => String(c).split(";")[0]).join("; ") || null;
    COOKIE_AT = Date.now();
  } catch (e) {
    COOKIE_JAR = null;
  }
  return COOKIE_JAR;
}

/* Je tahle odpověď blok od Cloudflare?

   Dřív se to poznávalo podle `status === 403`. To přestalo platit:
   Cloudflare odmítá i pod 404, a od "ten endpoint neexistuje" to jde
   rozeznat jen podle tvaru odpovědi. Následek byl tichý a nepříjemný —
   cookies ani objížďka přes Worker se vůbec nespustily, protože se
   čekalo na jiné číslo.

   Rozhoduje proto obsah, ne status: FPL API vrací i chyby jako JSON,
   kdežto Cloudflare posílá HTML stránku a hlásí se v `server`. Číslo,
   které si k tomu vybere, je jeho věc a může ho zítra změnit zas. */
function jeBlok(res) {
  if (res.ok) return false;
  const ctype = res.headers.get("content-type") || "";
  if (ctype.includes("json")) return false;   // poctivá chyba od FPL
  const server = (res.headers.get("server") || "").toLowerCase();
  return res.status === 403 || server.includes("cloudflare");
}

// Cloudflare blokuje nahodne i systematicky. Postup je proto
// stupnovity: cisty dotaz, pak dotaz s cookie, pak dotaz s cerstvou
// cookie. Kdyz neprojde ani treti, je blok skutecny a nema smysl
// bombardovat dal.
async function fetchUpstream(path) {
  const url = `${BASE}/${path}`;
  const pokus = (cookie) =>
    fetch(url, {
      headers: cookie ? { ...BROWSER_HEADERS, Cookie: cookie } : BROWSER_HEADERS,
      cache: "no-store",
      redirect: "follow",
    });

  let upstream = await pokus(COOKIE_JAR);
  if (!jeBlok(upstream)) return upstream;

  await new Promise((r) => setTimeout(r, 350));
  upstream = await pokus(await getCookies(false));
  if (!jeBlok(upstream)) return upstream;

  await new Promise((r) => setTimeout(r, 700));
  upstream = await pokus(await getCookies(true));
  if (!jeBlok(upstream)) return upstream;

  // Ani třetí pokus neprošel - blok tedy není náhodný a je na IP, ne na
  // chování. Cookies ani hlavičky s tím nehnou, protože nás FPL odmítá
  // dřív, než se na ně podívá. Poslední možnost je jít odjinud:
  // Worker běží na cizí IP, kterou Cloudflare nemá proč odmítat.
  const pres = await presWorker(path);
  return pres || upstream;
}

// Objížďka přes Cloudflare Worker (worker.js). Vrací null, když není
// nastavená - appka pak běží jako dřív a spadne na původní chybu.
/* Proč objížďka nevyšla. Vracet jen `null` byl omyl: nenastavená
   proměnná, rozejité tokeny a nedostupný Worker vypadaly navenek
   úplně stejně, takže se v odpovědi objevilo `via: "vercel"` a nedalo
   se poznat, kterou ze tří věcí spravit. */
let WORKER_LAST = null;

async function presWorker(path) {
  const url = process.env.FPL_WORKER_URL;
  const token = process.env.FPL_WORKER_TOKEN;
  if (!url || !token) {
    WORKER_LAST = "chybi promenne";
    return null;
  }

  try {
    const r = await fetch(
      `${url.replace(/\/$/, "")}/?path=${encodeURIComponent(path)}`,
      { headers: { "x-proxy-token": token }, cache: "no-store" }
    );

    // 401 znamená rozejité tokeny mezi Vercelem a Workerem. Vracet to
    // dál by vypadalo jako chyba FPL a hledalo by se to na špatném
    // místě, takže radši původní blok — ale ať je aspoň vidět proč.
    if (r.status === 401) {
      WORKER_LAST = "401 - token ve Vercelu nesedi s PROXY_TOKEN ve Workeru";
      return null;
    }

    WORKER_LAST = `worker odpovedel ${r.status}`;
    return r;
  } catch (e) {
    // Nejčastěji špatná adresa nebo Worker, který vůbec neběží.
    WORKER_LAST = `worker nedostupny: ${String(e && e.message || e).slice(0, 120)}`;
    return null;
  }
}

// ---------------------------------------------------------------------
// K6 - OMEZENI CETNOSTI
//
// Whitelist cest resi jinou hrozbu: brani pouzit proxy na libovolny cil,
// nebrani pouzit ji na FPL prilis casto. A prave to je ta situace, ktera
// opravdu nastane - zacykleny klient, otevrena karta s auto-refreshem
// nebo nekdo, kdo si adresu proxy ulozil do skriptu.
//
// Nejhorsi kombinace je `fixtures/` behem bloku od Cloudflare: tri
// pokusy plus 38 dotazu po kolech = 41 dotazu na FPL z jednoho
// pozadavku. Nasledek neni napadena appka, ale zablokovana IP Vercelu -
// a s ni prestane appka fungovat vsem v lize.
//
// Limit je v pameti instance. Neresi odhodlaneho utocnika: instanci je
// vic a pamet se s nimi nesdili. Na to je Cloudflare pred domenou, ne
// slozitejsi kod tady.
// ---------------------------------------------------------------------
const OKNO_MS = 60_000;
const LIMIT = 90;        // dotazu za minutu na IP
const LIMIT_DRAHE = 3;   // fixtures/ bez parametru za minutu na IP
const HITS = new Map();  // ip -> {n, drahe, do}

function pustit(ip, drahaCesta) {
  const ted = Date.now();
  let z = HITS.get(ip);
  if (!z || ted > z.do) {
    z = { n: 0, drahe: 0, do: ted + OKNO_MS };
    HITS.set(ip, z);
  }

  // Uklid, at mapa neroste donekonecna v dlouho zijici instanci.
  if (HITS.size > 5000) for (const [k, v] of HITS) if (ted > v.do) HITS.delete(k);

  z.n++;
  if (drahaCesta) z.drahe++;
  const za = Math.max(1, Math.ceil((z.do - ted) / 1000));
  if (z.drahe > LIMIT_DRAHE) return { ok: false, za };
  if (z.n > LIMIT) return { ok: false, za };
  return { ok: true };
}

// ---------------------------------------------------------------------
// FPL odmita `fixtures/` bez parametru castěji nez ostatni endpointy -
// je to nejvetsi odpoved v celem API (vsech 380 zapasu sezony) a z IP
// datacentra ji casto vrati 403, i kdyz `bootstrap-static/` projde.
//
// Appka ale cely rozpis potrebuje (ticker, FDR, gwPhaseFromFixtures).
// Slozime ho proto z dotazu po jednotlivych kolech, ktere blokovane
// nejsou. Deje se to jen kdyz plna cesta selze, a vysledek se drzi na
// edge cache, takze 38 dotazu padne nanejvys jednou za nekolik minut.
// ---------------------------------------------------------------------
/* Druhy soubezny pozadavek se priveze na tom prvnim.

   Bez tohohle znamenaji dva klienti ve stejnou vterinu 76 dotazu na
   FPL - tedy presne to chovani, kvuli kteremu blok vznikl. Limit vyse
   to nechyti: kazdy z nich ma jinou IP. */
let FIXTURES_INFLIGHT = null;

function fixturesByEvent() {
  if (FIXTURES_INFLIGHT) return FIXTURES_INFLIGHT;
  FIXTURES_INFLIGHT = fixturesByEventRun()
    .finally(() => { FIXTURES_INFLIGHT = null; });
  return FIXTURES_INFLIGHT;
}

async function fixturesByEventRun() {
  const cisla = Array.from({ length: 38 }, (_, i) => i + 1);
  const out = [];

  // Po peti najednou. Vic paralelnich dotazu je presne to chovani,
  // ktere si u FPL vyslouzi rate limit.
  for (let i = 0; i < cisla.length; i += 5) {
    const davka = cisla.slice(i, i + 5);
    const casti = await Promise.all(
      davka.map(async (ev) => {
        const r = await fetchUpstream(`fixtures/?event=${ev}`);
        if (!r.ok) return null;
        const ctype = r.headers.get("content-type") || "";
        if (!ctype.includes("json")) return null;
        return r.json().catch(() => null);
      })
    );
    for (const c of casti) if (Array.isArray(c)) out.push(...c);
  }

  // Prazdny vysledek znamena, ze selhalo i tohle - at to zavolajici
  // pozna a vrati puvodni chybu misto prazdneho rozpisu.
  return out.length ? out : null;
}

export default async function handler(req, res) {
  const path = String(req.query.path || "");

  if (!ALLOWED.some((re) => re.test(path))) {
    return res.status(403).json({ error: "Tahle cesta není povolená." });
  }

  /* Klic je IP z x-forwarded-for. Da se podvrhnout, ale kdo ji
     podvrhuje, tomu uz zadny limit v pameti nepomuze. */
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "?";
  const brzda = pustit(ip, path === "fixtures/");
  if (!brzda.ok) {
    // Klient na 429 uz umi cekat a zkusit to znovu (viz api() v js/core.js),
    // takze se na strane appky nemeni nic.
    res.setHeader("Retry-After", String(brzda.za));
    return res.status(429).json({ error: "Moc dotazů. Zkus to za chvíli." });
  }

  try {
    const upstream = await fetchUpstream(path);

    if (upstream.status === 429) {
      // Frontend na tenhle status umi cekat a zkusit to znovu.
      const retry = upstream.headers.get("retry-after") || "3";
      res.setHeader("Retry-After", retry);
      return res.status(429).json({ error: "FPL API omezuje počet dotazů. Zkusím to za chvíli." });
    }

    if (!upstream.ok) {
      // Edge cache smi pri chybe pustit starou odpoved. Bez tohohle
      // znamena kazdy vypadek FPL prazdnou stranku, i kdyz je na edge
      // odpoved z pred deseti minut, ktera by poslouzila.
      //
      // stale-if-error rekne CDN: kdyz origin vrati chybu, servisni
      // posledni znamou verzi az 24 hodin. Plati jen pro data, ktera
      // mezi koly stoji - ziva cisla kola se tim krotit nesmi, protoze
      // stara cisla vydavana za aktualni jsou horsi nez poctiva chyba.
      if (!/^event\/\d+\/live\/$/.test(path)) {
        res.setHeader(
          "Cache-Control",
          "public, s-maxage=0, stale-if-error=86400, stale-while-revalidate=600"
        );
      }

      // Plny rozpis ma zalozni cestu - viz fixturesByEvent().
      // Podminka je zamerne stejna jako v fetchUpstream: kdyz se blok
      // pozna podle tvaru tam, nesmi se tady vracet zpatky ke statusu.
      if (jeBlok(upstream) && path === "fixtures/") {
        const slozeno = await fixturesByEvent();
        if (slozeno) {
          res.setHeader(
            "Cache-Control",
            "public, s-maxage=600, stale-while-revalidate=1800"
          );
          return res.status(200).json(slozeno);
        }
      }

      // U 403 se hodi vedet, co presne Cloudflare rekl - cf-ray se da
      // dohledat a prvni radky tela prozradi, jestli slo o challenge
      // stranku, nebo o tvrdy blok. Bez toho se hada.
      //
      // Puvodne se posilalo jen u 403, protoze blok od Cloudflare se
      // cekal pod timhle statusem. Jenze Cloudflare umi odmitnout i pod
      // 404 - a to uz je k nerozeznani od "ten endpoint neexistuje",
      // coz posle hledani uplne jinam. Rozhodne hlavicka `server` a
      // zacatek tela: FPL vraci JSON, Cloudflare HTML stranku.
      //
      // Plati proto pro kazdou chybu. Diagnostika, ktera se zapina jen
      // u statusu, o kterem uz predem vim, ze nastane, nepomuze prave
      // tehdy, kdyz nastane neco jineho.
      /* K7 - diagnostika se posila jen na vyzadani.

         Duvod, proc tu vubec je, plati dal: chyba bez duvodu se ladi
         hadanim. Ale odpoved, kterou dostane kazdy, neni misto pro stav
         promennych prostredi ani pro tri sta znaku cizi HTML stranky -
         tu navic vykreslujeme ve vlastnim UI.

         Do konzole se dostanes pres ?debug=1, coz je presne ta situace,
         kdy tahle cisla nekdo opravdu chce. */
      const ladeni = String(req.query.debug || "") === "1";

      const detail = ladeni ? {
        cfRay: upstream.headers.get("cf-ray") || null,
        cfMitigated: upstream.headers.get("cf-mitigated") || null,
        server: upstream.headers.get("server") || null,
        // Kudy se šlo. "worker" znamena, ze objizdka bezi a odmitnuti
        // prislo az za ni; prazdno znamena, ze se na ni vubec nedoslo
        // nebo neni nastavena. Bez toho jsou obe situace k nerozeznani.
        via: upstream.headers.get("x-via") || "vercel",
        upstreamServer: upstream.headers.get("x-upstream-server") || null,
        workerLast: WORKER_LAST,
        workerUrl: process.env.FPL_WORKER_URL ? "nastaveno" : "chybi",
        workerToken: process.env.FPL_WORKER_TOKEN ? "nastaveno" : "chybi",
        // Utrzek cizi stranky se escapuje, at se neda vykreslit ani
        // v rezimu ladeni - vypisujeme ho ve vlastnim UI.
        snippet: escHtml((await upstream.text().catch(() => "")).slice(0, 300)),
      } : null;

      return res.status(upstream.status).json({
        error: `FPL API vrátilo ${upstream.status} pro ${path}.`,
        ...(detail ? { detail } : {}),
      });
    }

    // FPL obcas vrati HTML (udrzba, rate limit stranka) se statusem 200.
    const ctype = upstream.headers.get("content-type") || "";
    if (!ctype.includes("json")) {
      return res
        .status(502)
        .json({ error: "FPL API nevrátilo JSON — pravděpodobně dočasná odstávka." });
    }

    const data = await upstream.json();

    const ttl = ttlFor(path);
    res.setHeader(
      "Cache-Control",
      `public, s-maxage=${ttl}, stale-while-revalidate=${ttl * 3}`
    );

    return res.status(200).json(data);
  } catch (err) {
    return res.status(502).json({ error: "FPL API je nedostupné." });
  }
}
