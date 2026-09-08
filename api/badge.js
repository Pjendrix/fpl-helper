// Odznaky klubu (PNG z CDN Premier League), servirovane z vlastni domeny.
//
// Proc to jde pres proxy a ne primo <img src="https://resources...">:
//   1. CSP v vercel.json ma img-src 'self' — cizi domena by se neprokreslila.
//   3. Odznaky se meni jednou za sezonu (postup/sestup), tak at je edge cache
//      drzi rok a nechodi se pro ne pri kazdem nacteni.
//
// Klic je `code` z bootstrap-static (teams[].code), NE `id`. Kody prezivaji
// mezi sezonami, id se prehazuje podle abecedy — proto code.
//   Arsenal 3, Man Utd 1, Liverpool 14, Man City 43, Spurs 6, …
//
const CDN = "https://resources.premierleague.com/premierleague/badges";

// Nejvetsi rozumna velikost, ktera na CDN existuje pro vsechny kluby.
const SIZES = new Set(["25", "50", "70"]);


export default async function handler(req, res) {
  const code = String(req.query.code || "");
  const size = SIZES.has(String(req.query.size)) ? String(req.query.size) : "70";

  // Whitelist tvarem, ne seznamem: kody novacku neznam dopredu.
  if (!/^\d{1,4}$/.test(code)) {
    return res.status(400).json({ error: "Neplatný kód klubu." });
  }

  try {
    const upstream = await fetch(`${CDN}/${size}/t${code}.png`, {
      headers: { "User-Agent": "minileague-squad-check/1.0" },
    });

    // 404 tu neni chyba, ale informace: novacek, ktery jeste odznak nema.
    // Frontend na to reaguje tim, ze ukaze vlastni barevnou znacku.
    if (!upstream.ok) {
      return res.status(404).json({ error: `Odznak pro kód ${code} na CDN není.` });
    }

    // Puvodne se tu prekodovavalo do WebP pres `sharp`, ktery ale nebyl
    // v package.json - na Vercelu se tedy nikdy nenainstaloval a vzdy sel
    // PNG. Kod, ktery se nikdy nespustil, je pryc; PNG z CDN staci.
    const body = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=31536000, immutable");
    return res.status(200).send(body);
  } catch {
    return res.status(502).json({ error: "Odznak se nepodařilo načíst." });
  }
}
