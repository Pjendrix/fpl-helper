// Serverless proxy pro oficialni FPL API.
// Duvod existence: fantasy.premierleague.com neposila CORS hlavicky,
// takze prohlizec na nej primo nedosahne. Tahle funkce bezi na serveru,
// kde CORS neplati, a vysledek preposle stranky.

const BASE = "https://fantasy.premierleague.com/api";

// Whitelist - proxy nesmi byt otevrena pro libovolne cile.
const ALLOWED = [
  /^bootstrap-static\/$/,
  /^fixtures\/$/,
  /^entry\/\d+\/$/,
  /^entry\/\d+\/history\/$/,
  /^entry\/\d+\/event\/\d+\/picks\/$/,
  /^element-summary\/\d+\/$/,
  /^leagues-classic\/\d+\/standings\/(\?page_standings=\d+)?$/,
];

export default async function handler(req, res) {
  const path = String(req.query.path || "");

  if (!ALLOWED.some((re) => re.test(path))) {
    return res.status(403).json({ error: "Tahle cesta není povolená." });
  }

  try {
    const upstream = await fetch(`${BASE}/${path}`, {
      headers: { "User-Agent": "fpl-squad-check/1.0" },
    });

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

    // bootstrap-static a fixtures se meni po kolech - cachuj je na okraji site.
    const ttl = path.startsWith("entry/") ? 60 : 600;
    res.setHeader(
      "Cache-Control",
      `public, s-maxage=${ttl}, stale-while-revalidate=${ttl * 3}`
    );

    return res.status(200).json(data);
  } catch (err) {
    return res.status(502).json({ error: "FPL API je nedostupné." });
  }
}
