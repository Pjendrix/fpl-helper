// Proxy na API-Football (api-sports.io).
//
// Duvod existence je stejny jako u fpl.js (CORS), ale pribyva druhy, dulezitejsi:
// API klic nesmi nikdy do prohlizece. Kdyby byl v index.html, kdokoli si ho
// precte ve zdrojaku a vycerpa kvotu. Zije tedy jen tady, jako promenna prostredi.
//
// Nastaveni na Vercelu: Settings -> Environment Variables -> APIFOOTBALL_KEY

const BASE = "https://v3.football.api-sports.io";

// Premier League ma v API-Football id 39.
const PL = "39";

// Whitelist: jen to, co stranka opravdu potrebuje, a jen pro Premier League.
// Kazdy zaznam si sam zvaliduje parametry - proxy nesmi pustit libovolny dotaz,
// jinak by nam nekdo cizi projedl kvotu.
const ROUTES = {
  // Zapasy pro dane datum. Pouzivame k zjisteni, ktere zapasy dnes hraji.
  fixtures: (q) => {
    const date = q.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return null;
    const season = /^\d{4}$/.test(q.season || "") ? q.season : String(new Date().getFullYear());
    return `/fixtures?league=${PL}&season=${season}&date=${date}`;
  },

  // Potvrzena sestava konkretniho zapasu. Objevi se cca hodinu pred vykopem.
  lineups: (q) => {
    if (!/^\d+$/.test(q.fixture || "")) return null;
    return `/fixtures/lineups?fixture=${q.fixture}`;
  },

  // Zraneni v cele lize pro danou sezonu.
  injuries: (q) => {
    const season = /^\d{4}$/.test(q.season || "") ? q.season : String(new Date().getFullYear());
    return `/injuries?league=${PL}&season=${season}`;
  },
};

export default async function handler(req, res) {
  const key = process.env.APIFOOTBALL_KEY;
  if (!key) {
    return res.status(503).json({
      error: "Chybí APIFOOTBALL_KEY. Nastav ji ve Vercelu v Environment Variables.",
      setup: true,
    });
  }

  const route = ROUTES[String(req.query.route || "")];
  if (!route) return res.status(403).json({ error: "Neznámý route." });

  const path = route(req.query);
  if (!path) return res.status(400).json({ error: "Neplatné parametry." });

  try {
    const upstream = await fetch(`${BASE}${path}`, {
      headers: { "x-apisports-key": key },
    });

    const data = await upstream.json();

    // API-Football vraci chyby v tele se statusem 200 - musime se na ne podivat.
    if (data.errors && Object.keys(data.errors).length) {
      const first = Object.values(data.errors)[0];
      return res.status(502).json({ error: `API-Football: ${first}` });
    }

    // Sestavy se pred vykopem meni, zraneni ne tak casto.
    const ttl = req.query.route === "lineups" ? 120 : 900;
    res.setHeader("Cache-Control", `public, s-maxage=${ttl}, stale-while-revalidate=${ttl * 2}`);

    // Kolik kvoty zbyva - hodi se pri ladeni.
    const left = upstream.headers.get("x-ratelimit-requests-remaining");
    if (left) res.setHeader("X-Quota-Remaining", left);

    return res.status(200).json(data);
  } catch (err) {
    return res.status(502).json({ error: "API-Football je nedostupné." });
  }
}
