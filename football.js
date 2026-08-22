// Proxy na API-Football (api-sports.io).
//
// Duvod existence je stejny jako u fpl.js (CORS), ale pribyvaji dva dalsi:
//
//  1. API klic nesmi nikdy do prohlizece. Kdyby byl v index.html, kdokoli si ho
//     precte ve zdrojaku a vycerpa kvotu. Zije tedy jen tady, jako promenna prostredi.
//
//  2. Kvota free planu je 100 dotazu DENNE a adresa teto stranky je verejna.
//     Bez limitu staci, aby si nekdo napsal smycku, a do minuty je den u konce.
//     Proto je tu jednoduchy limiter na IP a denni strop pres celou funkci.
//
// Nastaveni na Vercelu: Settings -> Environment Variables -> APIFOOTBALL_KEY

const BASE = "https://v3.football.api-sports.io";

// Premier League ma v API-Football id 39.
const PL = "39";

// ---------------------------------------------------------------------------
// Limity. Stav zije v pameti instance funkce - po uspani se vynuluje.
// Neni to tvrda zaruka, je to brzda: zastavi to smycku i omylem otevrenych
// dvaceti panelu, coz je presne ten pripad, ktery kvotu vycerpa.
// ---------------------------------------------------------------------------

const PER_IP = { windowMs: 60_000, max: 20 };   // 20 dotazu za minutu na IP
const DAILY_BUDGET = 70;                        // strop z denni kvoty 100, zbytek rezerva

const ipHits = new Map();     // ip -> number[] (casy dotazu)
let dayKey = "";
let daySpent = 0;

function clientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "");
  return fwd.split(",")[0].trim() || req.headers["x-real-ip"] || "unknown";
}

function overIpLimit(ip) {
  const now = Date.now();
  const hits = (ipHits.get(ip) || []).filter((t) => now - t < PER_IP.windowMs);
  hits.push(now);
  ipHits.set(ip, hits);

  // uklid, at mapa neroste donekonecna
  if (ipHits.size > 500) {
    for (const [k, v] of ipHits) {
      if (!v.length || now - v[v.length - 1] > PER_IP.windowMs) ipHits.delete(k);
    }
  }
  return hits.length > PER_IP.max;
}

function overDailyBudget() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dayKey) { dayKey = today; daySpent = 0; }
  if (daySpent >= DAILY_BUDGET) return true;
  daySpent++;
  return false;
}

// ---------------------------------------------------------------------------
// Sezona. API-Football znaci sezonu rokem, ve kterem zacala - 2026/27 je "2026"
// jeste v breznu 2027. Podle kalendarniho roku by to od ledna do cervna lhalo.
// ---------------------------------------------------------------------------
function currentSeason() {
  const d = new Date();
  return String(d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1);
}

function season(q) {
  return /^\d{4}$/.test(q.season || "") ? q.season : currentSeason();
}

// Whitelist: jen to, co stranka opravdu potrebuje, a jen pro Premier League.
// Kazdy zaznam si sam zvaliduje parametry - proxy nesmi pustit libovolny dotaz.
const ROUTES = {
  // Zapasy pro dane datum. Pouzivame k zjisteni, ktere zapasy dnes hraji.
  fixtures: (q) => {
    const date = q.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return null;
    return { path: `/fixtures?league=${PL}&season=${season(q)}&date=${date}`, ttl: 900 };
  },

  // Potvrzena sestava konkretniho zapasu. Objevi se cca hodinu pred vykopem.
  lineups: (q) => {
    if (!/^\d+$/.test(q.fixture || "")) return null;
    return { path: `/fixtures/lineups?fixture=${q.fixture}`, ttl: 120 };
  },

  // Zraneni v cele lize pro danou sezonu.
  injuries: (q) => ({ path: `/injuries?league=${PL}&season=${season(q)}`, ttl: 3600 }),
};

export default async function handler(req, res) {
  const key = process.env.APIFOOTBALL_KEY;
  if (!key) {
    return res.status(503).json({
      error: "Chybí APIFOOTBALL_KEY. Nastav ji ve Vercelu v Environment Variables.",
      setup: true,
    });
  }

  const build = ROUTES[String(req.query.route || "")];
  if (!build) return res.status(403).json({ error: "Neznámý route." });

  const spec = build(req.query);
  if (!spec) return res.status(400).json({ error: "Neplatné parametry." });

  if (overIpLimit(clientIp(req))) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({
      error: "Moc dotazů za sebou. Počkej minutu a zkus to znovu.",
    });
  }

  if (overDailyBudget()) {
    return res.status(429).json({
      error: "Denní kvóta API-Football je vyčerpaná. Obnoví se o půlnoci UTC.",
    });
  }

  try {
    const upstream = await fetch(`${BASE}${spec.path}`, {
      headers: { "x-apisports-key": key },
    });

    const data = await upstream.json();

    // API-Football vraci chyby v tele se statusem 200 - musime se na ne podivat.
    if (data.errors && Object.keys(data.errors).length) {
      const first = Object.values(data.errors)[0];
      return res.status(502).json({ error: `API-Football: ${first}` });
    }

    res.setHeader(
      "Cache-Control",
      `public, s-maxage=${spec.ttl}, stale-while-revalidate=${spec.ttl * 2}`
    );

    // Kolik kvoty zbyva - hodi se pri ladeni.
    const left = upstream.headers.get("x-ratelimit-requests-remaining");
    if (left) res.setHeader("X-Quota-Remaining", left);

    return res.status(200).json(data);
  } catch (err) {
    return res.status(502).json({ error: "API-Football je nedostupné." });
  }
}
