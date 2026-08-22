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
  /^entry\/\d+\/event\/\d+\/picks\/$/,
  /^element-summary\/\d+\/$/,
  /^event\/\d+\/live\/$/,
  /^leagues-classic\/\d+\/standings\/(\?page_standings=\d+)?$/,
];

// Jak dlouho drzet odpoved na edge cache. Live data se meni po minutach,
// sestavy manazeru po kolech, bootstrap jednou denne.
function ttlFor(path) {
  if (/^event\/\d+\/live\/$/.test(path)) return 45;
  if (path.startsWith("entry/")) return 60;
  if (path.startsWith("leagues-classic/")) return 120;
  return 600;
}

export default async function handler(req, res) {
  const path = String(req.query.path || "");

  if (!ALLOWED.some((re) => re.test(path))) {
    return res.status(403).json({ error: "Tahle cesta není povolená." });
  }

  try {
    const upstream = await fetch(`${BASE}/${path}`, {
      headers: { "User-Agent": "fpl-squad-check/1.0" },
    });

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
