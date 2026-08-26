// Agregator zpravodajstvi pro Squad Check.
//
// Duvod existence je stejny jako u api/fpl.js: cizi weby neposilaji CORS
// hlavicky, takze prohlizec si jejich RSS nestahne. Tohle bezi na serveru,
// kde CORS neplati.
//
// Klicove rozhodnuti: zdroje se stahuji paralelne a KAZDY ma vlastni
// timeout. Kdyz jeden web lezi, vrati se ostatni a u nespravneho se rekne,
// ze se nepovedl. Jeden pomaly server nesmi znamenat prazdnou stranku.

const TIMEOUT_MS = 6000;
const PER_SOURCE = 12; // kolik clanku brat z jednoho zdroje
const EXCERPT = 200; // znaku uryvku; cely clanek nechceme reprodukovat

const SOURCES = [
  { id: "ffs", name: "FFScout", type: "rss", url: "https://fantasyfootballscout.co.uk/feed/" },
  { id: "ff247", name: "FF247", type: "rss", url: "https://fantasyfootball247.co.uk/feed/" },
  // Oficialni The Scout RSS nema. Web si obsah tahá z obsahoveho API
  // Pulselive; je to nezdokumentovane rozhrani, ktere se muze zmenit bez
  // ohlaseni, proto ma vlastni parser a vlastni selhani.
  {
    id: "scout",
    name: "The Scout",
    type: "pulselive",
    url:
      "https://footballapi.pulselive.com/football/content/PremierLeague/text?" +
      "pageSize=12&page=0&tagNames=Fantasy&references=PL_NEWS&type=editorial",
  },
];

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "en-GB,en;q=0.9",
};

// Pulselive kontroluje Origin. Bez nej vraci 403 stejne jako Cloudflare u FPL.
const PULSE_HEADERS = {
  ...BROWSER_HEADERS,
  Accept: "application/json",
  Origin: "https://www.premierleague.com",
  Referer: "https://www.premierleague.com/",
  Account: "premierleague",
};

async function fetchWithTimeout(url, headers) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { headers, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

// --- parsovani ---------------------------------------------------------
//
// Zadny XML parser: potrebujeme peti polozky z dobre znameho tvaru, ne
// obecnou korektnost. Zavislost navic by tady byla drazsi nez uzitek.

// Pojmenovane entity, ktere se ve feedech opravdu objevuji. Britske weby
// pisou o hracich jako Kovacic nebo Doku, takze diakritika neni exotika.
const NAMED = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  hellip: "…", ndash: "–", mdash: "—", lsquo: "'", rsquo: "'",
  ldquo: '"', rdquo: '"', eacute: "é", egrave: "è", ecirc: "ê",
  aacute: "á", agrave: "à", acirc: "â", auml: "ä", aring: "å",
  iacute: "í", oacute: "ó", ouml: "ö", oslash: "ø", uacute: "ú",
  uuml: "ü", ccedil: "ç", ntilde: "ñ", szlig: "ß", scaron: "š",
  ccaron: "č", zcaron: "ž", deg: "°", pound: "£", euro: "€",
};

function decode(s) {
  return (
    String(s || "")
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<[^>]*>/g, " ")
      // Jeden pruchod pres vsechny entity naraz. Retezene .replace() by
      // dekodovalo dvakrat: z &amp;lt; by udelalo &lt; a pak <, takze by
      // se text, ktery ma zobrazit znacku, promenil ve znacku.
      .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (all, ent) => {
        if (ent[0] === "#") {
          const code =
            ent[1] === "x" || ent[1] === "X"
              ? parseInt(ent.slice(2), 16)
              : Number(ent.slice(1));
          return Number.isFinite(code) ? String.fromCodePoint(code) : all;
        }
        const v = NAMED[ent.toLowerCase()];
        return v === undefined ? all : v;
      })
      .replace(/\s+/g, " ")
      .trim()
  );
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : "";
}

function clip(s) {
  if (s.length <= EXCERPT) return s;
  // Rezat uprostred slova vypada jako chyba, ne jako zkraceni.
  const cut = s.slice(0, EXCERPT);
  const space = cut.lastIndexOf(" ");
  return (space > EXCERPT * 0.6 ? cut.slice(0, space) : cut) + "…";
}

function parseRss(xml) {
  const items = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  return items.slice(0, PER_SOURCE).map((it) => ({
    title: decode(tag(it, "title")),
    link: decode(tag(it, "link")),
    date: new Date(decode(tag(it, "pubDate")) || Date.now()).toISOString(),
    excerpt: clip(decode(tag(it, "description") || tag(it, "content:encoded"))),
  }));
}

function parsePulselive(json) {
  const list = Array.isArray(json && json.content) ? json.content : [];
  return list.slice(0, PER_SOURCE).map((c) => ({
    title: decode(c.title),
    // Pulselive vraci jen slug; adresa clanku se sklada na strane webu.
    link: c.id
      ? `https://www.premierleague.com/en/news/${c.id}`
      : "https://www.premierleague.com/en/fantasy-news",
    date: new Date(c.publishFrom || c.date || Date.now()).toISOString(),
    excerpt: clip(decode(c.summary || c.subtitle || c.description)),
  }));
}

async function loadSource(src) {
  const upstream = await fetchWithTimeout(
    src.url,
    src.type === "pulselive" ? PULSE_HEADERS : BROWSER_HEADERS
  );
  if (!upstream.ok) throw new Error(`${upstream.status}`);

  const items =
    src.type === "pulselive"
      ? parsePulselive(await upstream.json())
      : parseRss(await upstream.text());

  // Polozka bez odkazu nebo titulku je k nicemu — nedava se kam kliknout.
  return items
    .filter((i) => i.title && i.link)
    .map((i) => ({ ...i, source: src.id, sourceName: src.name }));
}

export default async function handler(req, res) {
  const results = await Promise.allSettled(SOURCES.map(loadSource));

  const items = [];
  const failed = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") items.push(...r.value);
    else failed.push({ id: SOURCES[i].id, name: SOURCES[i].name, error: String(r.reason).slice(0, 120) });
  });

  // Vsechny zdroje dole = neni co ukazat; at to strana pozna podle statusu.
  if (!items.length) {
    return res.status(502).json({ error: "Žádný ze zdrojů neodpověděl.", failed });
  }

  items.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Zadny cron: cerstvost resi edge cache. stale-while-revalidate znamena,
  // ze pri vypadku zdroje se ukaze posledni znama verze misto chyby.
  res.setHeader(
    "Cache-Control",
    "public, s-maxage=900, stale-while-revalidate=3600"
  );
  return res.status(200).json({
    items,
    failed,
    sources: SOURCES.map((s) => ({ id: s.id, name: s.name })),
    fetched: new Date().toISOString(),
  });
}

// Vnitrnosti pro test.mjs. Parsovani je jediny netrivialni kus tehle
// funkce a jediny, ktery se da testovat bez site.
export const __test = { parseRss, parsePulselive, decode, clip };
