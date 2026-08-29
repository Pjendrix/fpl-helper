/* Cloudflare Worker — objížďka k FPL API.
 *
 * K čemu to je: Vercel běží z IP adres datacentra a Cloudflare, který
 * stojí před FPL API, je plošně odmítá. Nejde o chování ani o hlavičky —
 * odmítne nás dřív, než se na ně podívá — takže s tím žádná sada
 * hlaviček ani cookies nehnou. Jediná cesta ven vede odjinud.
 *
 * Worker běží na okraji sítě Cloudflare, tedy na IP, kterou Cloudflare
 * nemá důvod považovat za robota. Volá se až tehdy, když v `api/fpl.js`
 * selžou všechny tři pokusy — normální provoz sem nechodí.
 *
 * Bezpečnost: bez tokenu by tohle byla otevřená proxy, kterou by kdokoli
 * mohl použít k bombardování FPL pod tvým jménem. Token je proto povinný
 * a whitelist cest je tu schválně podruhé — Worker nesmí věřit tomu, že
 * ho volá jen naše funkce.
 */

const BASE = "https://fantasy.premierleague.com/api";

// Musí zůstat v souladu s ALLOWED v api/fpl.js. Záměrná duplicita:
// Worker má vlastní veřejnou adresu, takže se musí bránit sám.
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
  /^leagues-classic\/\d+\/standings\/(\?(page_standings|phase)=\d+(&(page_standings|phase)=\d+)?)?$/,
];

const CHROME_MAJOR = "137";

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    `(KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`,
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
  Referer: "https://fantasy.premierleague.com/",
  "sec-ch-ua": `"Chromium";v="${CHROME_MAJOR}", "Not/A)Brand";v="24", ` +
    `"Google Chrome";v="${CHROME_MAJOR}"`,
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
};

export default {
  async fetch(request, env) {
    // Token se srovnává vždycky celý, i když je hned první znak jiný.
    // Porovnání, které skončí na první neshodě, prozrazuje délkou svého
    // běhu, kolik znaků sedělo.
    const dany = request.headers.get("x-proxy-token") || "";
    const cekany = env.PROXY_TOKEN || "";
    if (!cekany || !bezpecneRovno(dany, cekany)) {
      return json({ error: "Neplatný token." }, 401);
    }

    const path = new URL(request.url).searchParams.get("path") || "";
    if (!ALLOWED.some((re) => re.test(path))) {
      return json({ error: "Tahle cesta není povolená." }, 403);
    }

    try {
      const upstream = await fetch(`${BASE}/${path}`, {
        headers: BROWSER_HEADERS,
        cf: { cacheTtl: 30, cacheEverything: false },
      });

      // Cloudflare umí odmítnout HTML stránkou pod ledajakým statusem.
      // Pustit ji dál by vypadalo jako odpověď FPL a hledalo by se to
      // na špatném místě — viz `jeBlok` v api/fpl.js.
      const ctype = upstream.headers.get("content-type") || "";
      if (!upstream.ok && !ctype.includes("json")) {
        return new Response(
          JSON.stringify({
            error: `Upstream vrátil ${upstream.status} bez JSON.`,
            via: "worker",
            server: upstream.headers.get("server") || null,
            snippet: (await upstream.text().catch(() => "")).slice(0, 300),
          }),
          {
            status: upstream.status,
            headers: { "content-type": "application/json", "x-via": "worker" },
          }
        );
      }

      /* Značka, kudy odpověď přišla. Bez ní vypadá odmítnutí z Workeru
         v logu úplně stejně jako odmítnutí z Vercelu, a nejde poznat,
         jestli objížďka vůbec běží, nebo běží a je blokovaná taky. */
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          "content-type": ctype || "application/json",
          "cache-control": "no-store",
          "x-via": "worker",
          "x-upstream-server": upstream.headers.get("server") || "",
        },
      });
    } catch (e) {
      return json({ error: "FPL API je z Workeru nedostupné." }, 502);
    }
  },
};

function bezpecneRovno(a, b) {
  if (a.length !== b.length) return false;
  let rozdil = 0;
  for (let i = 0; i < a.length; i++) rozdil |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return rozdil === 0;
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}
