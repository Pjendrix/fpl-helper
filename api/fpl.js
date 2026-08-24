// Serverless proxy pro oficialni FPL API.
// Duvod existence: fantasy.premierleague.com neposila CORS hlavicky,
// takze prohlizec na nej primo nedosahne. Tahle funkce bezi na serveru,
// kde CORS neplati, a vysledek preposle strance.

const BASE = "https://fantasy.premierleague.com/api";

// Whitelist - proxy nesmi byt otevrena pro libovolne cile.
const ALLOWED = [
  /^bootstrap-static\/$/,
  /^fixtures\/$/,
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

// Cloudflare pred FPL API blokuje bot-like User-Agenty. Nejcasteji na
// /fixtures/, ktere je jediny endpoint, co jede pres prisnejsi pravidlo.
// Poctivy vlastni UA teto appky tedy dostaval 403, zatimco hlavicky
// bezneho prohlizece projdou. Referer je soucasti kontroly - bez nej
// to Cloudflare bere jako primy pristup na API a taky odmitne.
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-GB,en;q=0.9",
  Referer: "https://fantasy.premierleague.com/",
  Origin: "https://fantasy.premierleague.com",
  "X-Requested-With": "XMLHttpRequest",
};

// Cloudflare vraci 403 i nahodne, ne jen systematicky. Jedno opakovani
// spolehlive chyti vetsinu tech nahodnych - vic nema smysl, protoze
// systematicky blok by se opakoval donekonecna.
async function fetchUpstream(path) {
  const url = `${BASE}/${path}`;
  let upstream = await fetch(url, { headers: BROWSER_HEADERS });

  if (upstream.status !== 403) return upstream;

  await new Promise((r) => setTimeout(r, 400));
  upstream = await fetch(url, { headers: BROWSER_HEADERS, cache: "no-store" });
  return upstream;
}

export default async function handler(req, res) {
  const path = String(req.query.path || "");

  if (!ALLOWED.some((re) => re.test(path))) {
    return res.status(403).json({ error: "Tahle cesta není povolená." });
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
      return res
        .status(upstream.status)
        .json({ error: `FPL API vrátilo ${upstream.status} pro ${path}.` });
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
