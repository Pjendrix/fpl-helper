/* Minileague Squad Check — ceny kola, Program a záložka Ceny

   Součást skupiny js/tabs*.js. Ta byla do verze 2.0 jedním souborem
   o 4 200 řádcích a osmi nesouvisejících sekcích; rozdělení je čistě
   mechanické — žádný kód se nepřepisoval, jen přestěhoval.

   Soubory js/ se načítají jako klasické <script> v pevném pořadí a
   sdílejí jeden globální scope: nic se neexportuje ani neimportuje,
   ale hoisting přes hranici souboru neplatí. Pořadí je proto součást
   kontraktu a je vypsané v index.html i v sw.js.
   ============================================================ */

/* ============ CENY KOLA ============

   Čtyři hlavní ceny stojí nad novinkami. Dvě z nich (výherce, smolař)
   vystačí s historií, kterou hub načítá tak jako tak. Kapitánské ceny
   potřebují navíc sestavy kola a body jednotlivých hráčů — obojí se
   dotahuje líně, viz loadNewsGw. Když chybí, karta se prostě vynechá;
   mřížka se tím zúží, ale nezůstane v ní díra s pomlčkou. */

/* Body hráčů daného kola jako mapa id → body. Bez `event/{gw}/live/`
   bychom u kapitána znali jen jméno, ne jeho výkon. */
/* Body hráčů z jedné odpovědi `event/{gw}/live/`.

   Drží se u té odpovědi, ne přepočítává se pokaždé znovu — stejný důvod
   jako u `liveStats()` v core.js. `lavickaRows()` a `capRows()` se volají
   jednou na člena ligy, takže padesátičlenná liga jinak znamená padesát
   průchodů přes sedm set hráčů, a při „Načíst celou sezónu“ ještě
   osmatřicetkrát tolik. */
const IDX_LIVEMAP = new WeakMap();

function liveMap(live){
  if(!live || !Array.isArray(live.elements)) return new Map();
  let m = IDX_LIVEMAP.get(live);
  if(!m){
    m = new Map();
    for(const e of live.elements){
      m.set(e.id, e.stats ? (e.stats.total_points || 0) : 0);
    }
    IDX_LIVEMAP.set(live, m);
  }
  return m;
}

/* Kapitáni kola i s body po zdvojení. Trojnásobný kapitán (TC) má
   multiplier 3, takže se bere z picku a ne natvrdo dvojka. */
function capRows(picksFor, live, gw){
  const picks = picksFor || [];
  const body = liveMap(live);
  const stats = liveStats(live);
  if(!picks.length || !body.size) return [];
  return HUB.members.map((m, i) => {
    const pk = picks[i];
    if(!pk || !pk.picks) return null;

    /* Kapitán, který se doopravdy počítal. Když ten nasazený neodehrál,
       přebral pásku vicekapitán — dřív se v tom případě zdvojovala nula
       a cena šla nesprávnému hráči. */
    const L = resolveLineup(pk, stats, gw != null ? gw : HUB.cur.id);
    const c = L.rows.find(r => r.captain);
    if(!c || !body.has(c.element)) return null;
    const mult = c.mult > 1 ? c.mult : 2;
    return {m, i, pid: c.element, mult, pts: body.get(c.element) * mult,
            raw: body.get(c.element)};
  }).filter(Boolean);
}

/* Hráči, které manažer nechal na lavičce, i s body. */
function lavickaRows(pk, live, gw){
  const body = liveMap(live);
  if(!pk || !pk.picks || !body.size) return [];

  /* Kdo se autosubem dostal do hry, na lavičce neseděl — obviňovat
     manažera z bodů, které nakonec dostal, je horší než cenu neudělit. */
  const L = resolveLineup(pk, liveStats(live), gw != null ? gw : HUB.cur.id);
  const hral = new Set(L.rows.filter(r => r.mult > 0).map(r => r.element));

  return pk.picks
    .filter(p => p.position >= 12 && p.position <= 15 && !hral.has(p.element))
    .map(p => ({pid: p.element, pts: body.get(p.element) || 0}));
}

/* Nejlepší hráč z lavičky. Doplňuje cenu pro smolaře o jméno —
   samotné číslo neřekne, koho to mrzí. */
function nejLavicka(pk, live, gwId){
  const nej = lavickaRows(pk, live, gwId).sort((a, b) => b.pts - a.pts)[0];
  return nej && nej.pts > 0 ? nej : null;
}

/* Body na lavičce pro jeden řádek kola.

   Historie týmu (`entry/{id}/history/`) je nese hotové, ale plní se se
   zpožděním — po prvním kole sezóny tam řádek chvíli není vůbec a body
   se berou z živého pořadí ligy, které lavičku nezná. Dřív to znamenalo,
   že cena pro smolaře v GW1 prostě nebyla. Sestavy a body hráčů přitom
   máme, takže si součet spočítáme sami; z historie se bere jen tehdy,
   když tam je. Vrací null, když se nedá zjistit vůbec — to je pořád
   lepší než tvrdit nulu. */
function lavickaBody(row, pk, live, gwId){
  /* Pořadí zdrojů je obrácené, než by člověk čekal, a je to schválně.

     `points_on_bench` z historie vypadá jako ten správný zdroj, ale
     když sestavy přijdou z archivu, nese archiv `entry_history` tak,
     jak vypadalo ve chvíli zápisu — a to je někdy ještě před dopočtem,
     takže je tam nula. Nula se pak tvářila jako pravda a cena pro
     smolaře zmizela celá, protože maximum ligy vyšlo nula.

     Sestavy a body hráčů jsou přitom u archivovaného kola vždycky po
     ruce a spočítat se z nich dá totéž — a navíc správně, protože se
     z lavičky vyřadí ti, kdo se dostali do hry autosubem. Historie
     zůstává jako záloha pro kola, kde sestavy nemáme. */
  const lav = lavickaRows(pk, live, gwId);
  if(lav.length) return lav.reduce((a, x) => a + x.pts, 0);
  if(row.ev && !row.ev.zeStandings && Number.isFinite(row.ev.points_on_bench)){
    return row.ev.points_on_bench;
  }
  return null;
}

/* Smolař kola: nejvíc bodů nechaných na lavičce. */
/* Smolaři kola: všichni, kdo nechali na lavičce nejvíc bodů.

   Vrací celou skupinu na maximu, ne jen prvního — cena se při shodě
   dělí a nad polovinou ligy propadá, stejně jako u kapitánů. Do počtu
   se berou jen manažeři, u kterých se lavička dá spočítat; kdo má
   `null` (chybí historie i sestavy), do statistiky nepatří. */
function smolari(gw, picksFor, live, gwId){
  const picks = picksFor || [];
  const s = gw.map(x => ({...x, lav: lavickaBody(x, picks[x.i], live, gwId)}))
    .filter(x => Number.isFinite(x.lav));
  if(!s.length) return {vsichni: [], nej: []};
  const max = Math.max(...s.map(x => x.lav));
  return {vsichni: s, nej: max > 0 ? s.filter(x => x.lav === max) : []};
}

/* Zpětně kompatibilní jednička — používá ji síň slávy, kde se počítá
   jen to, kdo cenu dostal. */
function smolar(gw, picksFor, live, gwId){
  const {nej} = smolari(gw, picksFor, live, gwId);
  return nej.length ? nej[0] : null;
}

/* Diagnostika kapitánských cen.

   Ceny se počítají ze dvou zdrojů (sestavy + body hráčů kola) a když
   jeden z nich přijde v nečekaném tvaru, karta prostě není. Tohle
   vypíše, kde se řetěz trhá, aby se to nemuselo hádat z toho, co na
   stránce chybí. Volá se ručně z konzole: debugCeny(1). */
window.debugCeny = function(gw){
  const g = gw || NEWS_GW || (HUB && HUB.cur.id);
  if(!HUB){ console.log('HUB není načtený — otevři nejdřív Hub ligy.'); return; }
  const picks = NEWS_PICKS.get(g), live = NEWS_LIVE.get(g);
  const body = liveMap(live);
  console.log('kolo', g, '· fáze', gwPhase(g));
  console.log('členů ligy:', HUB.members.length);
  console.log('sestav:', picks ? picks.length : '(nenačteno)',
    '· z toho prázdných:', picks ? picks.filter(p => !p || !p.picks).length : '-');
  console.log('hráčů v mapě bodů:', body.size,
    '· live:', live ? 'objekt' : String(live));
  const caps = capRows(picks, live, g);
  console.log('spárovaných kapitánů:', caps.length);
  console.table(caps.map(c => ({
    manazer: c.m.player_name, kapitan: c.pid, raw: c.raw,
    mult: c.mult, body: c.pts,
  })));
  const bezBodu = (picks || []).map((pk, i) => {
    if(!pk || !pk.picks) return null;
    const c = pk.picks.find(x => x.is_captain);
    if(!c) return HUB.members[i].player_name + ': žádný is_captain';
    if(!body.has(c.element)) return HUB.members[i].player_name
      + ': kapitán ' + c.element + ' není v mapě bodů';
    return null;
  }).filter(Boolean);
  if(bezBodu.length) console.log('nespárováno:', bezBodu);

  /* Lavička zvlášť: cena pro smolaře mizí tiše, když maximum ligy vyjde
     nula. Tabulka ukáže, jestli je nula spočítaná ze sestav, nebo jen
     opsaná z historie (kde bývá zamrzlá z doby před dopočtem kola). */
  console.table(gwRows(g).map(r => ({
    manazer: r.m.player_name,
    ze_sestav: lavickaRows(picks && picks[r.i], live, g)
      .reduce((a, x) => a + x.pts, 0),
    z_historie: r.ev && Number.isFinite(r.ev.points_on_bench)
      ? r.ev.points_on_bench : '—',
    zdroj_radku: r.ev && r.ev.zeStandings ? 'pořadí ligy'
      : r.ev && r.ev.zeSestav ? 'sestavy' : 'historie',
    pouzito: lavickaBody(r, picks && picks[r.i], live, g),
  })));
  console.log('ceny:', buildAwards(g, picks, live).map(a => a.key).join(', ') || '(žádné)');
};

const AWARD_META = {
  win:   {cls: 'a-win',   emoji: '🏆', title: 'Výherce kola'},
  bench: {cls: 'a-bench', emoji: '🪑', title: 'Smolař kola'},
  cap:   {cls: 'a-cap',   emoji: '👑', title: 'Kapitán týdne'},
  flop:  {cls: 'a-flop',  emoji: '🤡', title: 'Kapitánský propadák'},
};

/* Vrátí pole cen ve tvaru {key, who, val, sub}. Prázdné pole znamená,
   že za kolo zatím nejsou žádná data — panel to řekne místo mřížky. */
function buildAwards(gwId, picksFor, liveFor){
  const id = gwId != null ? gwId : HUB.cur.id;
  const gw = gwRows(id);
  const out = [];
  if(!gw.length) return out;

  const els = Object.fromEntries(BOOT.elements.map(p => [p.id, p]));
  const jmeno = pid => esc(els[pid] ? els[pid].web_name : '?');

  // vyherce
  const sorted = gw.slice().sort((a, b) => b.ev.points - a.ev.points);
  const top = sorted[0], second = sorted[1];
  const delici = sorted.filter(x => x.ev.points === top.ev.points);
  out.push({
    key: 'win',
    who: delici.length > 1
      ? delici.map(x => esc(x.m.player_name)).join(' & ')
      : esc(top.m.player_name),
    whoHtml: (delici.length > 1 ? delici : [top])
      .map(x => squadBtn(x.m.entry, id, x.m.player_name, x.m.entry_name)).join(' & '),
    val: top.ev.points + ' b',
    sub: delici.length > 1
      ? 'O první místo se dělí na stejných bodech.'
      : second
        ? (top.ev.points - second.ev.points >= 15
            ? `Náskok <b>${top.ev.points - second.ev.points} bodů</b> — to už není náhoda.`
            : `O <b>${top.ev.points - second.ev.points}</b> před ${esc(second.m.player_name)}.`)
        : '',
  });

  /* Smolař — nejvíc bodů na lavičce. Platí tu totéž pravidlo jako
     u kapitánů: cena je odlišení, takže se při polovině ligy a víc
     neuděluje. Deset lidí se stejnou lavičkou není smolař, to je kolo. */
  const {vsichni: lavVsichni, nej: lavNej} = smolari(gw, picksFor, liveFor, id);
  if(lavNej.length){
    const vsichniStejne = lavNej.length === lavVsichni.length;
    const vetsinaLav = lavNej.length * 2 >= lavVsichni.length;
    /* `who` zůstává prostým textem — čte ho síň slávy i testy. Klikatelná
       varianta jde vedle jako `whoHtml`, takže karta může odkazovat na
       sestavu, aniž by se text ceny stal HTML. */
    const jmenaLav = list => list.length <= 3
      ? list.map(c => esc(c.m.player_name)).join(', ')
      : esc(list[0].m.player_name) + ' a další ' + (list.length - 1);

    if(vsichniStejne && lavVsichni.length > 1){
      out.push({
        key: 'bench', who: 'Nikdo se neodlišil', val: lavNej[0].lav + ' b',
        sub: `Všech ${lavVsichni.length} manažerů nechalo na lavičce stejně.`,
      });
    }else if(vetsinaLav){
      out.push({
        key: 'bench', who: 'Bez ceny', val: '—',
        sub: `Stejně bodů na lavičce nechala většina ligy `
          + `(${lavNej.length} z ${lavVsichni.length}) — cena se za tohle kolo neuděluje.`,
      });
    }else{
      const kdo = lavNej[0];
      const nej = lavNej.length === 1 ? nejLavicka((picksFor || [])[kdo.i], liveFor, id) : null;
      out.push({
        key: 'bench',
        who: jmenaLav(lavNej),
        whoHtml: lavNej.length <= 3
          ? lavNej.map(c => squadBtn(c.m.entry, id, c.m.player_name, c.m.entry_name)).join(', ')
          : null,
        val: kdo.lav + ' b',
        sub: lavNej.length > 1
          ? 'Na lavičce nechali stejně — o cenu se dělí.'
          : nej
            ? `Nechal na lavičce — <b>${jmeno(nej.pid)}</b> za ${nej.pts} bodů.`
            : 'Body, které měl v týmu a nedostal je.',
      });
    }
  }

  // kapitanske ceny
  /* Kapitánské ceny.

     Cena má smysl jen jako odlišení. Když se na krajní hodnotě sejde
     polovina ligy nebo víc, není to výkon, ale průměr kola — cena se
     tehdy neuděluje a karta to řekne. Práh je ostrý na polovině:
     4 z 10 cenu ještě dostanou, 5 z 10 už ne.

     Obě strany se posuzují zvlášť. Když devět lidí vsadí na stejného
     kapitána a jeden ne, kapitánská cena propadne, ale ten jeden pořád
     může dostat propadáka — a naopak. */
  const caps = capRows(picksFor, liveFor, id);
  if(caps.length >= 2){
    const dle = caps.slice().sort((a, b) => b.pts - a.pts);
    const nej = dle[0], nic = dle[dle.length - 1];
    const vitezove = dle.filter(c => c.pts === nej.pts);
    const posledni = dle.filter(c => c.pts === nic.pts);
    const vetsina = list => list.length * 2 >= caps.length;

    const jmena = list => list.length <= 3
      ? list.map(c => esc(c.m.player_name)).join(', ')
      : esc(list[0].m.player_name) + ' a další ' + (list.length - 1);

    /* Když skupina drží jednoho hráče, řekneme to jménem — je to
       konkrétnější než „dopadli stejně“. */
    const duvod = list => list.every(c => c.pid === list[0].pid)
      ? `Stejného kapitána (${jmeno(list[0].pid)}) měla většina ligy`
      : 'Většina ligy skončila na stejných bodech';

    if(nej.pts === nic.pts){
      /* Celá liga na jednom čísle — dělit ani vyhlašovat není co.
         Karty ale zůstanou obě: kdyby jedna zmizela, vypadalo by to,
         že se propadák z nějakého důvodu nepočítal. */
      out.push({
        key: 'cap',
        who: 'Nikdo se neodlišil',
        val: nej.pts + ' b',
        sub: `Všech ${caps.length} kapitánů dalo stejně. `
          + 'Kolo se rozhodlo jinde než na páskách.',
      });
      out.push({
        key: 'flop',
        who: 'Nikdo se neodlišil',
        val: nic.pts + ' b',
        sub: 'Nikdo nepropadl víc než ostatní — všichni na stejných bodech.',
      });
    }else{
      out.push(vetsina(vitezove)
        ? {key: 'cap', who: 'Bez ceny', val: '—',
           sub: `${duvod(vitezove)} — cena se za tohle kolo neuděluje.`}
        : {key: 'cap', who: jmena(vitezove), val: nej.pts + ' b',
           whoHtml: vitezove.length <= 3 ? vitezove.map(c =>
             squadBtn(c.m.entry, id, c.m.player_name, c.m.entry_name)).join(', ') : null,
           sub: `${jmeno(nej.pid)} (${nej.raw} × ${nej.mult})`
             + (vitezove.length > 1 ? ' — o cenu se dělí.'
               : caps.filter(c => c.pid === nej.pid).length === 1
                 ? ' — jako jediný v lize.' : '.')});

      out.push(vetsina(posledni)
        ? {key: 'flop', who: 'Bez ceny', val: '—',
           sub: `${duvod(posledni)} — cena se za tohle kolo neuděluje.`}
        : {key: 'flop', who: jmena(posledni), val: nic.pts + ' b',
           whoHtml: posledni.length <= 3 ? posledni.map(c =>
             squadBtn(c.m.entry, id, c.m.player_name, c.m.entry_name)).join(', ') : null,
           sub: `${jmeno(nic.pid)} (${nic.raw} × ${nic.mult})`
             + (posledni.length > 1 ? ' — a nebyl v tom sám.' : '.')});
    }
  }

  return out;
}

/* ------------------------------------------------------------
   Síň slávy: kolikrát kdo které ceny získal za celou sezónu.

   Výhry a lavička se dopočítají z historie, kterou hub drží — nula
   dotazů navíc. Kapitánské sloupce potřebují sestavy a body kola;
   ty jsou jen pro kola, která už někdo otevřel, nebo pro všechna
   po stisku „Načíst celou sezónu“. `pokryto` proto vrací počet kol,
   ze kterých kapitánské sloupce vznikly, aby se dalo poznat, že jsou
   neúplné, místo aby tabulka tiše lhala.
   ------------------------------------------------------------ */
function hallOfFame(){
  const rows = HUB.members.map(m => ({
    m, win: 0, bench: 0, cap: 0, flop: 0,
  }));
  const podleEntry = new Map(rows.map(r => [r.m.entry, r]));
  let kol = 0, pokryto = 0;
  // Nejnižší a nejvyšší dopočítané kolo — aby tabulka uměla říct,
  // z čeho vlastně je. Počet kol na to nestačí: sezóna může začínat
  // jinde než u GW1, když se liga založila později.
  let prvni = null, posl = null;

  for(const g of newsGws()){
    /* Do bilance sezóny jde jen dopočítané kolo. Rozehrané se mění po
       každém zápase a u čekajícího na bonusy může tříbodový bonus otočit
       vítěze i propadáka — tabulka by pak přepisovala historii. */
    if(gwPhase(g) !== 'final') continue;
    const gw = gwRows(g);
    if(!gw.length) continue;
    kol++;
    if(prvni === null || g < prvni) prvni = g;
    if(posl === null || g > posl) posl = g;

    const sorted = gw.slice().sort((a, b) => b.ev.points - a.ev.points);
    const max = sorted[0].ev.points;
    sorted.filter(x => x.ev.points === max).forEach(x => {
      const r = podleEntry.get(x.m.entry); if(r) r.win++;
    });

    const lav = smolar(gw, NEWS_PICKS.get(g), NEWS_LIVE.get(g), g);
    if(lav){
      const r = podleEntry.get(lav.m.entry); if(r) r.bench++;
    }

    const caps = capRows(NEWS_PICKS.get(g), NEWS_LIVE.get(g), g);
    if(caps.length >= 2){
      const dle = caps.slice().sort((a, b) => b.pts - a.pts);
      if(dle[0].pts !== dle[dle.length - 1].pts){
        pokryto++;
        const a = podleEntry.get(dle[0].m.entry); if(a) a.cap++;
        const b = podleEntry.get(dle[dle.length - 1].m.entry); if(b) b.flop++;
      }
    }
  }

  rows.sort((a, b) => b.win - a.win || a.flop - b.flop || b.cap - a.cap
    || a.m.player_name.localeCompare(b.m.player_name, 'cs'));
  return {rows, kol, pokryto, prvni, posl};
}

/* ------------------------------------------------------------
   Panel novinek: přepínač kol + stav + samotné zprávy.

   Sestavy starších kol držíme v NEWS_PICKS, aby druhé kliknutí na
   totéž kolo nic nestahovalo. cached() by to zvládl taky, ale takhle
   je vidět, co panel drží.
   ------------------------------------------------------------ */
let NEWS_GW = null;
const NEWS_PICKS = new Map();
const NEWS_LIVE = new Map();
let HALL_ALL = false;   // stiskl někdo „Načíst celou sezónu“?

const PHASE_NOTE = {
  running: ['wn', 'Kolo běží',
    'Body se ještě sčítají a pořadí se po každém zápase mění. Definitivní '
    + 'čísla budou po dopočtu bonusů.'],
  unchecked: ['wn', 'Čeká se na bonusy',
    'Zápasy jsou dohrané, ale bonusové body FPL ještě potvrzuje. Čísla se '
    + 'můžou o kousek posunout.'],
  final: ['ok', 'Konečné výsledky',
    'Bonusy jsou připsané, čísla už se nezmění.'],
};

function newsPanel(){
  const gws = newsGws();
  const sel = NEWS_GW || HUB.cur.id;
  const phase = gwPhase(sel);
  const [cls, titulek, popis] = PHASE_NOTE[phase];

  const prepinac = gws.length > 1
    ? `<div class="gwnav" role="tablist" aria-label="Kolo novinek">
        ${gws.map(g => {
          const p = gwPhase(g);
          return `<button type="button" role="tab" data-newsgw="${g}"
            aria-selected="${g === sel}"
            title="${p === 'final' ? 'Konečné výsledky'
              : p === 'unchecked' ? 'Čeká se na bonusy' : 'Kolo běží'}"
            >GW${g}${p === 'running' ? '<i class="dot live"></i>'
              : p === 'unchecked' ? '<i class="dot wait"></i>' : ''}</button>`;
        }).join('')}
      </div>`
    : '';

  const stav = `<p class="note store ${cls === 'ok' ? 'ok' : ''} phase">
    <b>${titulek}</b> — ${popis}</p>`;

  /* Vítěz kola a lavička mají vlastní cenu nahoře — v seznamu zpráv
     by to byla tatáž věta podruhé. */
  const news = buildNews(sel, NEWS_PICKS.get(sel))
    .filter(x => !/^Kolo \d+$|^Lavička hanby$/.test(x.kicker));
  const zpravy = news.map(x => `<div class="news ${x.cls}">
      <div class="kicker">${esc(x.kicker)}</div>
      <div class="head">${x.head}</div>
      ${x.body ? `<div class="body">${x.body}</div>` : ''}
    </div>`).join('');

  const awards = buildAwards(sel, NEWS_PICKS.get(sel), NEWS_LIVE.get(sel));
  if(!awards.length && !news.length){
    /* Prázdné kolo neznamená prázdný panel: síň slávy je součet celé
       sezóny a s vybraným kolem nemá nic společného. Dřív mizela spolu
       s cenami a vypadalo to, že se ztratila. */
    const cekame = !NEWS_PICKS.has(sel) || !NEWS_LIVE.has(sel);
    return prepinac + stav
      + `<p class="note">${cekame
          ? 'Načítám sestavy a body tohohle kola…'
          : 'Za tohle kolo se nepodařilo dopočítat ani ceny, ani zprávy.'}</p>`
      + hallPanel();
  }

  /* Dokud se kolo nedopočítá, jsou ceny průběžné. Ať je to vidět na
     kartě, ne jen v hlášce nad panelem — tabulka síně slávy je bere
     až po dopočtu bonusů. */
  const zive = phase !== 'final'
    ? `<span class="livetag">${phase === 'running' ? 'živě' : 'čeká na bonusy'}</span>`
    : '';

  const ceny = awards.length
    ? `<div class="secline"><h4>Ceny kola</h4>${zive}</div>
       <div class="awards">${awards.map(a => {
         const meta = AWARD_META[a.key];
         const bez = a.val === '—' ? ' bezceny' : '';
         return `<div class="award ${meta.cls}${bez}">
           <div class="medal" aria-hidden="true">${meta.emoji}</div>
           <div class="txt">
             <div class="title">${meta.title}</div>
             <div class="who">${a.whoHtml || a.who}</div>
             ${a.sub ? `<div class="sub">${a.sub}</div>` : ''}
           </div>
           <div class="val">${a.val}</div>
         </div>`;
       }).join('')}</div>`
    : '';

  /* Kapitánské ceny potřebují sestavy a body kola. Když chybí, řekneme
     to místo toho, abychom tiše ukázali o dvě ceny míň — a rozlišíme,
     jestli se ještě načítají, nebo jestli dotaz selhal. */
  const maPicks = NEWS_PICKS.has(sel) && (NEWS_PICKS.get(sel) || []).length;
  const maLive = NEWS_LIVE.has(sel) && NEWS_LIVE.get(sel);
  const chybiPicks = awards.some(a => a.key === 'cap') ? ''
    : (!NEWS_PICKS.has(sel) || !NEWS_LIVE.has(sel))
      ? '<p class="note">Kapitánské ceny dopočítám po načtení sestav…</p>'
      : (!maPicks || !maLive)
        ? `<p class="note">Kapitánské ceny teď nejdou spočítat — nepodařilo se
            načíst ${!maPicks ? 'sestavy' : 'body hráčů'} tohohle kola.
            Zkus <b>⟳</b> v hlavičce.</p>`
        : '';

  const zbytek = zpravy
    ? `<div class="secline"><h4>Co se ještě stalo</h4></div>` + zpravy
    : '';

  return prepinac + stav + ceny + chybiPicks + zbytek + hallPanel();
}

/* Tabulka cen za celou sezónu. Kapitánské sloupce se počítají jen
   z kol, pro která máme sestavy — tlačítko je dotáhne pro všechna.

   Tělo je oddělené od obalu, protože tatáž tabulka visí na dvou
   místech: v Hubu pod cenami kola a na Přehledu mezi aktuálním kolem
   a Zpravodajem. Kdyby si každé místo skládalo vlastní HTML, rozešly
   by se při první úpravě sloupců. */
function hallBody(){
  const {rows, kol, pokryto, prvni, posl} = hallOfFame();
  if(kol < 1 || rows.length < 2) return null;

  const SLOUPCE = [
    ['win', '🏆', 'Výhry'], ['bench', '🪑', 'Smůla'],
    ['cap', '👑', 'Kapitán'], ['flop', '🤡', 'Propadák'],
  ];
  const max = {};
  SLOUPCE.forEach(([k]) => max[k] = Math.max(...rows.map(r => r[k])));

  const hlavicka = SLOUPCE.map(([, e, t]) =>
    `<th class="c"><span aria-hidden="true">${e}</span>${t}</th>`).join('');

  const telo = rows.map(r => `<tr>
      <td class="name">${HUB && HUB.cur
        ? squadBtn(r.m.entry, HUB.cur.id, r.m.player_name, r.m.entry_name)
        : esc(r.m.player_name)}</td>
      ${SLOUPCE.map(([k]) => {
        const v = r[k];
        const tridy = ['c', v > 0 ? 'has' : '', v > 0 && v === max[k] ? 'lead' : ''];
        return `<td class="${tridy.filter(Boolean).join(' ')}"><i>${v}</i></td>`;
      }).join('')}
    </tr>`).join('');

  /* Z jakých kol tabulka je. Samotné „ze 3 kol“ neřekne, jestli chybí
     začátek, nebo běžící konec sezóny — a přesně na tohle se člověk
     ptá, když čísla nesedí s tím, co si pamatuje. */
  const rozsah = kol === 1 ? 'GW' + posl
    : (posl - prvni + 1 === kol ? `GW${prvni}–${posl}`
       : `${kol} kol do GW${posl}`);

  const chybi = kol - pokryto;
  const pozn = chybi > 0
    ? `<p class="note">Data ${rozsah}. Kapitánské sloupce mám z ${pokryto} z ${kol} kol —
        zbytek potřebuje sestavy. ${HALL_ALL ? ''
          : `<button type="button" class="hallmore" data-hallall="1">Načíst celou sezónu</button>`}</p>`
    : `<p class="note">Data ${rozsah}, ze všech ${kol} dopočítaných kol sezóny.
        Zlatě je maximum ve sloupci.</p>`;

  const tabulka = `<div class="hall"><table>
      <thead><tr><th>Manažer</th>${hlavicka}</tr></thead>
      <tbody>${telo}</tbody>
    </table></div>`;

  return {tabulka, pozn, rozsah, kol, posl};
}

function hallPanel(){
  const h = hallBody();
  if(!h) return '';
  return `<div class="secline"><h4>Síň slávy</h4></div>${h.tabulka}${h.pozn}`;
}

/* Tatáž tabulka na Přehledu, mezi aktuálním kolem a Zpravodajem.
   Stojí čistě na datech Hubu, takže nepřidává jediný dotaz — když se
   Hub ještě nenačetl, drží se výška kostrou jako u sousedních boxů. */
function homeHall(){
  const box = (inner, rozsah) => `<div class="hbox hhall">
    <h3><i class="hi">🏅</i>Síň slávy${rozsah ? ' · ' + esc(rozsah) : ''}
      <button type="button" class="lnkbtn" data-goto="t-hub">Hub ligy</button></h3>
    ${inner}</div>`;

  const lid = CONFIG.leagueId || localStorage.getItem('fpl_league');
  if(!lid) return '';

  if(typeof HUB === 'undefined' || !HUB){
    const cekani = typeof homeHubPending === 'function' ? homeHubPending() : null;
    return box(cekani || '<div class="skel"><i></i><i></i></div>');
  }

  const h = hallBody();
  if(!h){
    return box(`<p class="note">Síň slávy se počítá z dopočítaných kol —
      zatím žádné takové není.</p>`);
  }
  return box(h.tabulka + h.pozn, h.rozsah);
}

/* Přepnutí kola. Sestavy starších kol se stahují až teď — otevření
   hubu by jinak stálo dotaz za každé kolo sezóny krát počet členů. */
async function loadNewsGw(g){
  NEWS_GW = g;
  const host = $('hs-0');
  if(host) host.innerHTML = newsPanel();

  await nactiKolo(g);
  if(NEWS_GW === g && $('hs-0')) $('hs-0').innerHTML = newsPanel();
}

/* Sestavy a body jednoho kola. `live` je jeden dotaz na kolo, sestavy
   jeden na člena — proto se tohle nedělá při otevření hubu. */
async function nactiKolo(g){
  /* Dohrané kolo se nemění, takže ho stačí načíst jednou za život
     ligy — archiv ho vrátí bez jediného dotazu na FPL API. Rozehrané
     kolo se archivem nikdy nezdržuje. */
  const konecne = gwPhase(g) === 'final';
  if(konecne && !(NEWS_PICKS.has(g) && NEWS_LIVE.get(g))){
    try{ if(await snapLoad(g, HUB.members)) return; }
    catch(e){ /* archiv je pohodlí, ne podmínka — jde se na API */ }
  }

  if(!NEWS_PICKS.has(g)){
    try{
      NEWS_PICKS.set(g, await pooled(HUB.members,
        m => cached('entry/' + m.entry + '/event/' + g + '/picks/'), 5));
    }catch(e){
      // Bez sestav prostě nebudou kapitánské ceny. Zbytek panelu
      // je na nich nezávislý, takže tohle není důvod nic hlásit.
      NEWS_PICKS.set(g, []);
    }
  }
  if(!NEWS_LIVE.has(g)){
    /* Rozlišujeme „ještě nenačteno“ (klíč v mapě není) od „nepovedlo se“
       (klíč je, hodnota null). Dřív se ukládalo null v obou případech,
       takže `has()` vrátilo true a panel schoval i hlášku, která měla
       říct, proč kapitánské ceny nejsou. */
    try{ NEWS_LIVE.set(g, await cached('event/' + g + '/live/')); }
    catch(e){ NEWS_LIVE.set(g, null); }
  }

  /* Kolo je dohrané a povedlo se celé — ať se příště nestahuje znovu.
     Ukládá se až tady, protože dřív není jisté, že máme obojí. */
  if(konecne) snapSave(g, HUB.members, NEWS_PICKS.get(g), NEWS_LIVE.get(g));
}

/* Dotáhne sestavy všech dohraných kol, aby síň slávy měla i kapitány.
   Je to počet kol × počet členů dotazů, takže to jde jen na kliknutí. */
async function nactiCelouSezonu(btn){
  HALL_ALL = true;
  if(btn){ btn.disabled = true; btn.textContent = 'Načítám…'; }
  const kola = newsGws().filter(g => gwPhase(g) === 'final');
  for(const g of kola){
    await nactiKolo(g);
    if(btn) btn.textContent = `Načítám… ${kola.indexOf(g) + 1}/${kola.length}`;
  }
  if($('hs-0')) $('hs-0').innerHTML = newsPanel();
}

document.addEventListener('click', ev => {
  const btn = ev.target.closest('button[data-newsgw]');
  if(btn) loadNewsGw(Number(btn.dataset.newsgw));
  const vse = ev.target.closest('button[data-hallall]');
  if(vse) nactiCelouSezonu(vse);
});

function renderHub(){
  // Sestavy aktuálního kola už HUB načetl — ať se nestahují znovu.
  if(!NEWS_PICKS.has(HUB.cur.id)) NEWS_PICKS.set(HUB.cur.id, HUB.picks);
  if(NEWS_GW === null) NEWS_GW = HUB.cur.id;

  /* Body hráčů aktuálního kola hub sám o sobě nepotřebuje — dotáhnou
     se na pozadí a panel se překreslí, až kapitánské ceny půjdou spočítat. */
  if(!NEWS_LIVE.has(HUB.cur.id)){
    nactiKolo(HUB.cur.id).then(() => {
      if(NEWS_GW === HUB.cur.id && $('hs-0')) $('hs-0').innerHTML = newsPanel();
    });
  }

  const SECS = [
    ['Novinky', newsPanel()],
    ['Žebříčky', buildBoards()],
    ['Zdraví kádrů', buildHealth()],
    ['Celá liga', buildCollective()],
  ];

  $('hubout').innerHTML = `
    <h2>${esc(CONFIG.leagueName || HUB.st.league.name)} · po ${HUB.cur.id}. kole${info(`${strengthsReady()
      ? 'Obtížnost počítám z útočné a obranné síly obou týmů, ne z pevného FDR, které '
        + 'FPL nastaví v srpnu a pak už nemění. Barvy jsou <b>relativní</b> — každé pásmo '
        + 'dostane zhruba pětinu zápasů.'
      : strengthsUsable()
      ? 'Útočná a obranná síla zatím v datech není, tak počítám z <b>celkové síly týmů</b> '
        + '(stupnice 1–5) — pořád to rozliší domácí zápas od venkovního, jen hruběji. '
        + 'Barvy jsou relativní, každé pásmo dostane zhruba pětinu zápasů.'
      : '<b>Zdroj obtížnosti: oficiální FDR od FPL.</b> Síly týmů, ze kterých počítám '
        + 'vlastní hodnocení, zatím v datech nejsou vyplněné — FPL je doplní po několika '
        + 'odehraných kolech a čísla se pak zjemní.'}
    <b>VELKÁ</b> písmena znamenají domácí zápas,
    <b>malá</b> venkovní. Dvě zkratky v jednom políčku je double, pomlčka blank.
    Tabulka je seřazená od nejpříznivějšího programu.`)}</h2>
    ${HUB.truncated ? `<p class="note">Liga je větší než ${LEAGUE_CAP} členů — pracuju
      s prvními ${LEAGUE_CAP} podle pořadí, takže žebříčky i Zdraví kádrů mluví
      jen o nich.</p>` : ''}
    <div class="subnav" role="tablist">
      ${SECS.map((s, i) => `<button class="sub-btn" role="tab"
        aria-selected="${i === 0}" data-hs="${i}">${esc(s[0])}</button>`).join('')}
    </div>
    ${SECS.map((s, i) => `<div class="sec" id="hs-${i}"${i ? ' hidden' : ''}>${s[1]}</div>`).join('')}`;

  $('hubout').querySelectorAll('.sub-btn').forEach(b => {
    b.addEventListener('click', () => {
      $('hubout').querySelectorAll('.sub-btn').forEach(x =>
        x.setAttribute('aria-selected', x === b));
      SECS.forEach((_, i) => { $('hs-' + i).hidden = String(i) !== b.dataset.hs; });
    });
  });
}

$('hubgo').addEventListener('click', async () => {
  $('hubgo').disabled = true;
  dropCached(/^(leagues-classic|entry)\//);
  await loadHub();
  $('hubgo').disabled = false;
});


/* ============ PROGRAM: rozpis, ceny, čipy ============

   Čtyři pohledy na to, co teprve přijde. Všechny stojí na `fixtures/`
   a `bootstrap-static/`, takže je to zadarmo — data už máme.
*/

const PLAN_GWS = 6;

function planStartGw(){
  const nxt = BOOT.events.find(e => e.is_next);
  const cur = BOOT.events.find(e => e.is_current);
  return nxt ? nxt.id : (cur ? cur.id + 1 : 1);
}

/* --- 1. Ticker: mřížka klubů × kol, obarvená podle obtížnosti ---

   FDR z FPL je statické — nastaví se před sezónou a nemění se, i když
   tým mezitím spadne na dno. Počítáme proto vlastní z útočné a obranné
   síly obou týmů, které bootstrap poskytuje a nikdo je nepoužívá. */
/* Vrací null, dokud FPL síly týmů nedopočítá.

   Na začátku sezóny jsou `strength_attack_*` a `strength_defence_*` nuly.
   Poměr sil pak vyšel 0, vzorec spadl hluboko pod stupnici a `Math.max(1, …)`
   všechno srovnal na 1.0 — celá liga vypadala jako samé lehké zápasy.
   Tichý nesmysl, který vypadal jako platné číslo. */
function teamStrengths(t, home){
  const att = home ? t.strength_attack_home : t.strength_attack_away;
  const def = home ? t.strength_defence_home : t.strength_defence_away;
  const a = parseFloat(att), d = parseFloat(def);
  if(Number.isFinite(a) && Number.isFinite(d) && a > 0 && d > 0) return {att: a, def: d};

  // Záloha: strength_overall_* na stupnici 1–5. FPL je vyplňuje i v době,
  // kdy jsou strength_attack_* a strength_defence_* ještě nuly — což platí
  // celý začátek sezóny. Dřív se v tu chvíli zahodila i tahle čísla a appka
  // spadla na statické FDR, které nerozliší domácí zápas od venkovního.
  const o = parseFloat(home ? t.strength_overall_home : t.strength_overall_away);
  if(!Number.isFinite(o) || o <= 0) return null;

  // Převod na stejné měřítko jako strength_attack_* (kolem 1000–1400),
  // aby poměr sil v ownFdr() vycházel ve stejném řádu jako s ostrými daty.
  const scaled = 1000 + (o - 3) * 110;
  return {att: scaled, def: scaled, approx: true};
}

/* Máme ostrá čísla útoku a obrany, nebo jedeme na hrubší náhradě?
   Rozlišujeme to proto, že hláška pod rozpisem má říkat pravdu. */
function strengthsReady(){
  return BOOT.teams.every(t => {
    const h = teamStrengths(t, true), a = teamStrengths(t, false);
    return h && a && !h.approx && !a.approx;
  });
}

/* Dá se z toho vůbec počítat vlastní FDR? Stačí i hrubá záloha. */
function strengthsUsable(){
  return BOOT.teams.every(t => teamStrengths(t, true) && teamStrengths(t, false));
}

/* `fallback` je oficiální FDR z rozpisu. Použije se, dokud nejsou k dispozici
   síly týmů — statická trojka od FPL je pořád lepší než vymyšlená jednička. */
function ownFdr(teamId, oppId, home, fallback){
  const t = BOOT.teams.find(x => x.id === teamId);
  const o = BOOT.teams.find(x => x.id === oppId);
  const fb = Number.isFinite(fallback) ? fallback : 3;
  if(!t || !o) return fb;

  // Jak silný je soupeř proti nám: jeho obrana brzdí náš útok a naopak.
  const me = teamStrengths(t, home);
  const opp = teamStrengths(o, !home);
  if(!me || !opp) return fb;

  // Poměr sil kolem 1.0 = vyrovnaný zápas. Škálujeme na známou stupnici 1–5.
  const ratio = ((opp.def / me.att) + (opp.att / me.def)) / 2;
  const raw = 3 + (ratio - 1) * 7 + (home ? -0.35 : 0.35);
  if(!Number.isFinite(raw)) return fb;
  return Math.max(1, Math.min(5, raw));
}

/* Prahy pro obarvení se počítají z rozdělení, ne z pevných čísel.

   Pevné hranice (pod 2.2 zelená, nad 4.1 červená) fungovaly jen náhodou.
   Síly týmů v bootstrapu se u většiny klubů liší málo, takže se skoro
   všechny zápasy vešly do jednoho pásma a ticker byl celý stejně zelený.
   Barevné kódování, které nerozlišuje, je horší než žádné.

   Kvintily napříč všemi zápasy v zobrazeném okně zaručí, že každé pásmo
   dostane zhruba pětinu buněk — obtížnost je tím pádem vždy relativní
   k tomu, co se v daných kolech reálně hraje. */
let FDR_CUTS = null;

function computeFdrCuts(startGw, n){
  const all = [];
  for(const t of BOOT.teams)
    for(let gw = startGw; gw < startGw + n; gw++)
      for(const f of gwFixtures(t.id, gw))
        all.push(ownFdr(t.id, f.opp, f.home, f.d));

  const DEFAULT_CUTS = [1.5, 2.5, 3.5, 4.5];
  if(all.length < 10){ FDR_CUTS = DEFAULT_CUTS; return FDR_CUTS; }

  all.sort((a, b) => a - b);

  // Když se všechny hodnoty rovnají, kvintily nemají co rozdělit a celá
  // mřížka by vyšla jednobarevně. Radši pevná stupnice než falešné odstíny.
  if(all[all.length - 1] - all[0] < 0.4){ FDR_CUTS = DEFAULT_CUTS; return FDR_CUTS; }

  const q = p => all[Math.min(all.length - 1, Math.floor(all.length * p))];
  FDR_CUTS = [q(0.2), q(0.4), q(0.6), q(0.8)];
  return FDR_CUTS;
}

function fdrClass(d){
  const c = FDR_CUTS || [2.2, 2.8, 3.4, 4.1];
  if(d <= c[0]) return 'f1';
  if(d <= c[1]) return 'f2';
  if(d <= c[2]) return 'f3';
  if(d <= c[3]) return 'f4';
  return 'f5';
}

function buildTicker(){
  const start = planStartGw();
  const teams = Object.fromEntries(BOOT.teams.map(t => [t.id, t]));
  computeFdrCuts(start, PLAN_GWS);

  const rows = BOOT.teams.map(t => {
    const cells = [];
    let sum = 0, count = 0;

    for(let gw = start; gw < start + PLAN_GWS; gw++){
      const fx = gwFixtures(t.id, gw);

      if(!fx.length){
        cells.push('<td class="fx blank"><span>–</span></td>');
        sum += 5; count++;     // blank je pro plánování to nejhorší
        continue;
      }

      const inner = fx.map(f => {
        const d = ownFdr(t.id, f.opp, f.home, f.d);
        sum += d; count++;
        const opp = teams[f.opp].short_name;
        return `<span class="${fdrClass(d)}">${esc(f.home ? opp.toUpperCase() : opp.toLowerCase())}</span>`;
      }).join('');

      cells.push(`<td class="fx${fx.length > 1 ? ' dbl' : ''}">${inner}</td>`);
    }

    return {t, cells, avg: count ? sum / count : 5};
  });

  rows.sort((a, b) => a.avg - b.avg);

  const head = Array.from({length: PLAN_GWS}, (_, i) => `<th>${start + i}</th>`).join('');
  const body = rows.map(r =>
    `<tr><td class="tn">${esc(r.t.name)}</td>${r.cells.join('')}<td class="num">${r.avg.toFixed(2)}</td></tr>`
  ).join('');

  return `<table class="ticker">
      <thead><tr><th>Klub</th>${head}<th>Ø</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
    `;
}

/* --- 2. Blanky a doubly --- */
function buildShape(){
  const start = planStartGw();
  const shape = gwShape(start, PLAN_GWS).filter(x => x.blanks.length || x.doubles.length);

  if(!shape.length)
    return `<p class="note">Následujících ${PLAN_GWS} kol je bez blanků a doublů —
      každý klub hraje přesně jednou.</p>`;

  const mine = MY_SQUAD;

  const cards = shape.map(x => {
    const affected = list => {
      const names = list.map(t => esc(t.short_name)).join(', ');
      if(!mine) return names;
      const hit = list.filter(t => BOOT.elements.some(p => p.team === t.id && mine.has(p.id)));
      return names + (hit.length
        ? ` <b>· týká se tvých: ${hit.map(t => esc(t.short_name)).join(', ')}</b>`
        : '');
    };

    return `<div class="shape">
      <h3>GW${x.gw}</h3>
      ${x.blanks.length ? `<p class="bl"><b>Blank</b> ${affected(x.blanks)}</p>` : ''}
      ${x.doubles.length ? `<p class="db"><b>Double</b> ${affected(x.doubles)}</p>` : ''}
    </div>`;
  }).join('');

  return cards + ``;
}

/* --- 3. Predikce změn cen ---

   FPL nezveřejňuje algoritmus, ale směr je spolehlivý: rozhoduje čistý
   příliv převodů vážený tím, kolik lidí hráče drží. Přesný práh neznáme,
   tak ukazujeme pořadí tlaku, ne jistotu. */
/* Oficiální predikce zdražení a zlevnění.

   Dřív se směr odhadoval z čistého přílivu transferů dělených vlastnictvím.
   Byla to rozumná aproximace, ale FPL to dneska počítá samo a posílá to
   v bootstrapu:

     price_change_percent        naplněnost ukazatele v procentech
     price_change_hourly_rate    jak rychle se plní právě teď
     price_change_projections    [{offset, projected_percent, likelihood}]
                                 offset 0/1/2 = dnes / zítra / pozítří,
                                 likelihood −5…+5 = jistota pohybu
     price_change_locked_until   hráč se do daného času hýbat nemůže

   Bereme oficiální číslo, když existuje — stejně jako u ep_next. */
function priceMoves(){
  const projFor = (p, offset) =>
    (p.price_change_projections || []).find(x => x.offset === offset) || null;

  const scored = BOOT.elements.map(p => {
    const now = parseFloat(p.price_change_percent);
    const today = projFor(p, 0);
    const in3 = projFor(p, 2);
    if(!Number.isFinite(now) || !today) return null;

    return {
      p,
      pct: now,
      rate: p.price_change_hourly_rate || 0,
      likeToday: today.likelihood || 0,
      like3: in3 ? (in3.likelihood || 0) : (today.likelihood || 0),
      pct3: in3 ? parseFloat(in3.projected_percent) : now,
      locked: p.price_change_locked_until || null,
    };
  }).filter(Boolean);

  const up = scored.filter(x => x.likeToday > 0 || x.like3 > 0)
    .sort((a, b) => (b.likeToday - a.likeToday) || (b.pct - a.pct)).slice(0, 10);
  const down = scored.filter(x => x.likeToday < 0 || x.like3 < 0)
    .sort((a, b) => (a.likeToday - b.likeToday) || (a.pct - b.pct)).slice(0, 10);

  return {up, down, ok: scored.length > 0};
}

/* Jistota pohybu ceny.

   FPL posílá likelihood v rozsahu −5…+5. Dřív se kreslila jako řada
   teček, což byl problém hned dvakrát: pět teček vedle čtyř nikdo na
   první pohled nerozezná a nikde nebylo řečeno, co ta čísla znamenají.
   Slovo přečteš i koutkem oka.

   Procenta by tady lhala — likelihood není pravděpodobnost, je to
   pořadí tlaku na stupnici, kterou FPL nezveřejňuje. Převádíme ho
   proto na slova, ne na „80 %“. Naplněnost v procentech vedle už
   v tabulce je a ta procenta jsou skutečná. */
const LIKE_WORDS = {5: 'jisté', 4: 'skoro jisté', 3: 'pravděpodobné',
                    2: 'možné', 1: 'nejisté'};

function likeChip(v, kind){
  const n = Math.min(5, Math.abs(v || 0));
  if(!n) return '<span class="lk none">–</span>';
  const dir = v > 0 ? 'up' : 'down';
  const sipka = v > 0 ? '▲' : '▼';
  const slovo = LIKE_WORDS[n];
  return `<span class="lk ${dir} l${n}" title="${
    (v > 0 ? 'Zdražení' : 'Zlevnění')} ${kind || ''} — jistota ${n} z 5 podle FPL"
    ><i aria-hidden="true">${sipka}</i>${esc(slovo)}</span>`;
}

/* Ukazatel naplněnosti. 100 % = pohyb dnes v noci. */
function priceMeter(pct, dir){
  const w = Math.max(3, Math.min(100, Math.abs(pct)));
  return `<span class="meter ${dir}" role="img"
    aria-label="naplněno ${Math.round(Math.abs(pct))} procent"><i style="width:${w}%"></i></span>`;
}

function buildPrices(){
  const teams = Object.fromEntries(BOOT.teams.map(t => [t.id, t]));
  const mv = priceMoves();

  // Prázdný stav není vysvětlivka — patří na stránku, ne pod „i“.
  if(!mv.ok) return `<h3>Pohyby cen</h3>
    <p class="note">FPL zatím predikce cen neposílá — pole
    <code>price_change_projections</code> je v datech prázdné. Objeví se
    obvykle po prvním kole.</p>`;

  const dl = (BOOT.game_config && BOOT.game_config.settings
              && BOOT.game_config.settings.price_change_deadlines) || [];
  const nextDl = dl.map(d => new Date(d)).filter(d => d > new Date()).sort((a, b) => a - b)[0];

  const row = (x, dir) => {
    const mine = MY_SQUAD && MY_SQUAD.has(x.p.id);
    const lock = x.locked && new Date(x.locked) > new Date();
    return `<tr${mine ? ' class="me"' : ''}>
      <td>${watchStar(x.p.id)}</td>
      <td>${esc(x.p.web_name)}<span class="sub">${esc(teams[x.p.team].short_name)}</span></td>
      <td class="n">${(x.p.now_cost / 10).toFixed(1)}m</td>
      <td>${priceMeter(x.pct, dir)}<span class="sub">${x.pct.toFixed(0)} %${
        lock ? ' · zamčeno' : ''}</span></td>
      <td>${likeChip(x.likeToday, 'dnes v noci')}</td>
      <td class="hide-s">${likeChip(x.like3, 'do tří dnů')}</td>
    </tr>`;
  };

  const tbl = (rows, dir, title, note) => `
    <h3>${title}</h3>
    ${rows.length
      ? `<table><thead><tr><th></th><th>Hráč</th><th class="n">Cena</th><th>Ukazatel</th>
         <th>Dnes v noci</th><th class="hide-s">Do 3 dnů</th></tr></thead>
         <tbody>${rows.map(x => row(x, dir)).join('')}</tbody></table>`
      : '<p class="note">Nic výrazného.</p>'}
    <p class="note">${note}</p>`;

  return tbl(mv.up, 'up', 'Nejblíž ke zdražení',
      'Když ho chceš, kup ho dřív — po zdražení zaplatíš o 0,1m víc a při prodeji '
      + 'dostaneš zpátky jen půlku zisku.')
    + tbl(mv.down, 'down', 'Nejblíž ke zlevnění',
      'Zlevnění ti sebere z hodnoty týmu. Pokud ho stejně plánuješ pustit, udělej to teď.')
    + `<p class="note">Sloupec <b>Dnes v noci</b> je jistota pohybu podle FPL
       (pětistupňová škála, „jisté“ je nejvyšší), ukazatel vedle je skutečná
       naplněnost cenového měřidla v procentech. Zvýrazněné řádky jsou hráči z tvé sestavy.${
       nextDl ? ' Nejbližší změna cen: <b>' + nextDl.toLocaleString('cs-CZ',
         {weekday: 'short', hour: '2-digit', minute: '2-digit'}) + '</b>.' : ''}</p>`;
}


async function loadPlan(){
  $('plmsg').textContent = 'Načítám rozpis…';
  try{
    if(!BOOT){ [BOOT, FIX] = await Promise.all([api('bootstrap-static/'), api('fixtures/')]); }
    startCountdown();

    const start = planStartGw();
    // Ceny mají od téhle verze vlastní záložku — v Programu se v nich
    // nedalo vyznat. Doporučení čipů odešlo úplně: potřebovalo načtený
    // kádr z jiné záložky a když ho nemělo, ukazovalo jen výzvu.
    const SECTIONS = [
      ['Rozpis', buildTicker()],
      ['Blanky a doubly', buildShape()],
    ];

    $('plout').innerHTML = `
      <h2>GW${start}–${start + PLAN_GWS - 1}</h2>
      <div class="subnav" role="tablist">
        ${SECTIONS.map((x, i) =>
          `<button class="sub-btn" role="tab" aria-selected="${i === 0}" data-sec="${i}">${esc(x[0])}</button>`
        ).join('')}
      </div>
      ${SECTIONS.map((x, i) =>
        `<div class="sec" id="pl-${i}"${i ? ' hidden' : ''}>${x[1]}</div>`
      ).join('')}`;

    $('plout').querySelectorAll('.sub-btn').forEach(b => {
      b.addEventListener('click', () => {
        $('plout').querySelectorAll('.sub-btn').forEach(x =>
          x.setAttribute('aria-selected', x === b));
        SECTIONS.forEach((_, i) => { $('pl-' + i).hidden = String(i) !== b.dataset.sec; });
      });
    });

    $('plmsg').textContent = '';
  }catch(e){
    $('plmsg').innerHTML = errBox(e.message, 't-plan');
  }
}
