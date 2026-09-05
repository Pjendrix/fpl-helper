/* Minileague Squad Check — Hub ligy

   Součást skupiny js/tabs*.js. Ta byla do verze 2.0 jedním souborem
   o 4 200 řádcích a osmi nesouvisejících sekcích; rozdělení je čistě
   mechanické — žádný kód se nepřepisoval, jen přestěhoval.

   Soubory js/ se načítají jako klasické <script> v pevném pořadí a
   sdílejí jeden globální scope: nic se neexportuje ani neimportuje,
   ale hoisting přes hranici souboru neplatí. Pořadí je proto součást
   kontraktu a je vypsané v index.html i v sw.js.
   ============================================================ */

/* ============ HUB LIGY ============ */
let HUB = null;
let LEAGUE_OWN = null;   // {owners: {playerId: [jmena]}, n} — plni renderLeague

async function loadHub(){
  $('hubmsg').textContent = 'Načítám ligu…';
  $('hubout').innerHTML = '';
  try{
    if(!BOOT){ [BOOT, FIX] = await Promise.all([api('bootstrap-static/'), api('fixtures/')]); }
    if(!PLAYERS) PLAYERS = playerRows();

    const lid = CONFIG.leagueId || localStorage.getItem('fpl_league');
    if(!lid){ $('hubmsg').textContent = 'Nejdřív si načti ligu v záložce Miniliga.'; return; }

    const cur = BOOT.events.find(e => e.is_current);
    if(!cur){ $('hubmsg').textContent = 'Sezóna ještě nezačala.'; return; }

    const {league, members, truncated} = await fetchStandings(lid,
      n => { $('hubmsg').textContent = 'Načítám pořadí… ' + n + ' týmů'; });
    if(!members.length){ $('hubmsg').textContent = 'Liga nemá členy.'; return; }

    /* Historie je dotaz na člena, takže je to nejdražší část načtení
       Hubu. Archiv ji umí poskládat z dohraných kol — když je má celá,
       ušetří se tolik dotazů, kolik má liga členů. */
    let hists = null;
    try{ hists = await snapHists(members, cur.id); }catch(e){}

    if(!hists){
      // cached() znamená, že po načtení Miniligy je tohle skoro zadarmo —
      // jsou to přesně tytéž adresy.
      hists = await pooled(members, m => cached('entry/' + m.entry + '/history/'),
        5, (d, t) => { $('hubmsg').textContent = `Načítám historii… ${d}/${t}`; });
    }

    const picks = await pooled(members, m => cached('entry/' + m.entry + '/event/' + cur.id + '/picks/'),
      5, (d, t) => { $('hubmsg').textContent = `Načítám sestavy… ${d}/${t}`; });

    /* Sestavy vezou `entry_history` běžícího kola. Bez tohohle kroku by
       poslední řádek historie znal jen body a součet — a sezónní
       žebříčky by z něj četly nulovou hodnotu kádru, nula přestupů
       a prázdnou lavičku. */
    if(typeof snapPatchCurrent === 'function') snapPatchCurrent(hists, picks, cur.id);

    HUB = {st: {league}, members, hists, picks, cur, truncated,
           chybi: [pooledNote(hists, 'historií'), pooledNote(picks, 'sestav')]
             .filter(Boolean).join(' ')};
    renderHub();

    /* Přehled stojí na týchž datech (síň slávy, aktuální kolo v lize),
       ale vykresluje se dřív, než Hub doběhne. Bez tohohle překreslení
       na něm zůstane kostra nebo „zatím žádná data“ i ve chvíli, kdy je
       Hub o kus vedle ukazuje. */
    if(typeof drawHome === 'function') drawHome();

    /* Neúplná data se přiznávají. Dřív `pooled()` neúspěch spolkl jako
       `null` a Hub vykreslil žebříčky, ve kterých prostě někdo chyběl —
       což není vidět jako chyba, jen jako jiná čísla. */
    $('hubmsg').textContent = HUB.chybi || '';
  }catch(e){
    $('hubmsg').innerHTML = errBox(e.message, 't-hub');
  }
}

// poradi v lize po jednotlivych kolech, z kumulativnich bodu
/* Body po kolech, indexované podle čísla kola — ne podle pozice v poli.

   Manažer, který do FPL vstoupil až v GW5, má u current[0] kolo 5.
   Čtení přes current[g] mu proto posunulo celou křivku o čtyři kola doleva. */
function pointsByRound(h){
  const map = new Map();
  if(h && h.current) for(const ev of h.current) map.set(histGw(ev), ev);
  return map;
}

function leagueRanks(members, hists){
  const maps = hists.map(pointsByRound);
  const gws = Math.max(0, ...maps.map(m => m.size ? Math.max(...m.keys()) : 0));
  const ranks = members.map(() => []);

  for(let g = 1; g <= gws; g++){
    const pts = members.map((m, i) => {
      const ev = maps[i].get(g);
      return [i, ev ? ev.total_points : -1];
    }).sort((a, b) => b[1] - a[1]);
    pts.forEach(([i], pos) => ranks[i].push(pos + 1));
  }
  return {ranks, gws};
}

/* Stav kola. FPL přepne `is_current` hned po deadlinu, takže „aktuální
   kolo“ neznamená „odehrané kolo“ — mezi tím je celý víkend, během
   kterého se čísla mění po každém zápase.

   Rozlišujeme tři fáze, protože každá znamená jinou míru důvěry:
     · running   — kolo běží, body se ještě sčítají
     · unchecked — zápasy dohrané, ale bonusy se dopočítávají
     · final     — data_checked, čísla už se nezmění

   `data_checked` je jediné pole, které FPL nastaví až po připsání
   bonusů. `finished` přijde dřív, takže na definitivnost nestačí.

   Jenže obojí je na úrovni celého kola a FPL je přepíná se zpožděním —
   klidně půl dne po posledním zápase, někdy až v úterý ráno. Do té doby
   appka tvrdila „kolo běží“, i když se dávno dohrálo a bonusy byly
   připsané. Proto se ptáme rovnou rozpisu, který se aktualizuje hned:

     · některý zápas ještě neskončil          → running
     · všechny dohrané, bonusy nejsou v datech → unchecked
     · všechny dohrané a bonusy zapsané        → final

   Bonus je ve `stats` každého zápasu položka `bonus`; FPL ji doplní
   ve chvíli, kdy jsou body definitivní. To je přesně ten okamžik, po
   kterém má smysl novinky pustit — nezávisle na tom, kdy se FPL uráčí
   překlopit `data_checked`. */
function fixtureBonusDone(f){
  const s = (f.stats || []).find(x => x.identifier === 'bonus');
  if(!s) return false;
  return (s.h && s.h.length > 0) || (s.a && s.a.length > 0);
}

function gwPhaseFromFixtures(gwId){
  if(!Array.isArray(FIX)) return null;
  const fs = FIX.filter(f => f.event === gwId);
  if(!fs.length) return null;
  // Rozpis smí fázi jen posunout dopředu, nikdy zpátky: když v něm zápasy
  // dohrané nejsou, rozhodnou dál příznaky kola.
  if(!fs.every(f => f.finished || f.finished_provisional)) return null;
  return fs.every(f => f.finished && fixtureBonusDone(f)) ? 'final' : 'unchecked';
}

function gwPhase(gwId){
  const ev = BOOT.events.find(e => e.id === gwId);
  if(!ev) return 'running';
  if(ev.data_checked) return 'final';
  const zRozpisu = gwPhaseFromFixtures(gwId);
  if(zRozpisu) return zRozpisu;
  if(ev.finished) return 'unchecked';
  return 'running';
}

/* Kola, která má smysl nabídnout k prohlížení: všechna zahájená,
   od prvního po aktuální. Historie se bere z `hists`, takže starší
   kola nestojí ani jeden dotaz navíc — kromě kapitánů, viz níže. */
function newsGws(){
  const cur = HUB.cur;
  const out = [];
  for(let g = 1; g <= cur.id; g++){
    const ev = BOOT.events.find(e => e.id === g);
    if(ev && (ev.finished || ev.is_current || ev.data_checked)) out.push(g);
  }
  return out;
}

/* Novinky za konkrétní kolo.

   `picksFor` jsou sestavy toho kola. Pro aktuální kolo je má HUB
   načtené; pro starší se dotahují na kliknutí (viz loadNewsGw), aby
   otevření hubu nestálo dotaz za každé kolo sezóny. Když nejsou,
   kapitánská novinka se prostě vynechá — je to jediná, která je
   potřebuje. */
/* Řádky kola pro každého člena ligy.

   Primární zdroj je historie týmu (`entry/{id}/history/`). Ta se ale
   plní se zpožděním — po prvním kole sezóny tam řádek chvíli není
   vůbec, takže hub hlásil „za tohle kolo zatím nejsou data“ i ve
   chvíli, kdy se dávno dohrálo.

   Pořadí ligy přitom nese `event_total` a je živé: aktualizuje se
   průběžně během kola. Použijeme ho jako záložní zdroj pro aktuální
   kolo. Průběžný řádek je označený (`zeStandings`), protože nese jen
   body a součet — ne přestupy ani lavičku, takže zprávy, které je
   potřebují, se u něj vynechají místo aby hlásily nuly. */
function gwRows(gwId){
  const {members, hists} = HUB;

  /* Třetí zdroj: sestavy a body hráčů toho kola.

     Historie chybí nejen u běžícího kola — na začátku sezóny nemá FPL
     řádek ani pro dohrané GW1, a pořadí ligy zná jen kolo aktuální.
     Archiv starších kol pak hlásil „za tohle kolo zatím nejsou data“,
     přestože sestavy i body appka kvůli cenám stejně stahuje. Když
     jsou, spočítá se kolo z nich; jinak se nedělá nic. */
  const picks = NEWS_PICKS.get(gwId);
  const live = NEWS_LIVE.get(gwId);
  const zeSestav = (i) => {
    const pk = picks && picks[i];
    if(!pk || !pk.picks || !live) return null;
    const L = resolveLineup(pk, liveStats(live), gwId);
    return {round: gwId, points: L.total, total_points: null, zeSestav: true};
  };

  return members.map((m, i) => {
    const h = hists[i];
    let ev = h && h.current.find(x => histGw(x) === gwId);
    if(!ev && gwId === HUB.cur.id && Number.isFinite(m.event_total)){
      ev = {round: gwId, points: m.event_total, total_points: m.total,
            zeStandings: true};
    }
    if(!ev) ev = zeSestav(i);
    return {m, i, ev};
  }).filter(x => x.ev);
}

function buildNews(gwId, picksFor){
  const {members, hists} = HUB;
  const cur = {id: gwId != null ? gwId : HUB.cur.id};
  const picks = picksFor || [];
  const els = Object.fromEntries(BOOT.elements.map(p => [p.id, p]));
  const news = [];
  const phase = gwPhase(cur.id);

  const gw = gwRows(cur.id);

  if(!gw.length) return news;

  const sorted = gw.slice().sort((a, b) => b.ev.points - a.ev.points);
  const top = sorted[0], second = sorted[1], bottom = sorted[sorted.length - 1];
  const gap = second ? top.ev.points - second.ev.points : 0;

  news.push({
    cls: 'good', kicker: 'Kolo ' + cur.id,
    head: esc(top.m.player_name) + ' vyhrál kolo s ' + top.ev.points + ' body',
    body: second
      ? (gap >= 15
          ? `Náskok <b>${gap} bodů</b> na druhého — to už není náhoda, to je jiná liga.`
          : gap === 0
            ? `O první místo se dělí s <b>${esc(second.m.player_name)}</b>.`
            : `Druhý <b>${esc(second.m.player_name)}</b> zaostal o ${gap} bodů.`)
      : '',
  });

  if(bottom !== top){
    news.push({
      cls: 'bad', kicker: 'Průšvih kola',
      head: esc(bottom.m.player_name) + ' zvládl jen ' + bottom.ev.points + ' bodů',
      body: `O <b>${top.ev.points - bottom.ev.points}</b> méně než vítěz kola.`,
    });
  }

  // kapitani
  const caps = members.map((m, i) => {
    const pk = picks[i];
    if(!pk) return null;
    const c = pk.picks.find(x => x.is_captain);
    return c ? {m, pid: c.element} : null;
  }).filter(Boolean);

  if(caps.length){
    const count = {};
    caps.forEach(c => count[c.pid] = (count[c.pid] || 0) + 1);
    const popular = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
    const popId = parseInt(popular[0], 10);

    const rebels = caps.filter(c => c.pid !== popId);
    if(rebels.length && rebels.length <= Math.ceil(caps.length / 2)){
      /* Body rebela se berou ze stejné mapy jako zbytek novinek — tedy
         i z živého pořadí. Dřív se sahalo přímo do historie, takže při
         běžícím kole novinka tiše zmizela, i když všechno ostatní šlo. */
      const evPodleTymu = new Map(gw.map(x => [x.m.entry, x.ev]));
      const best = rebels
        .map(r => ({...r, ev: evPodleTymu.get(r.m.entry)}))
        .filter(r => r.ev)
        .sort((a, b) => b.ev.points - a.ev.points)[0];
      if(best){
        news.push({
          cls: 'warn', kicker: 'Kapitánská volba',
          head: `${popular[1]} z ${caps.length} manažerů vsadilo na ${esc(els[popId] ? els[popId].web_name : '?')}`,
          body: `Proti proudu šel <b>${esc(best.m.player_name)}</b> s kapitánem
            <b>${esc(els[best.pid] ? els[best.pid].web_name : '?')}</b> a udělal ${best.ev.points} bodů.`,
        });
      }
    }
  }

  // dan za transfery
  const taxed = gw.filter(x => !x.ev.zeStandings && x.ev.event_transfers_cost > 0)
    .sort((a, b) => b.ev.event_transfers_cost - a.ev.event_transfers_cost);
  if(taxed.length){
    const t = taxed[0];
    news.push({
      cls: 'warn', kicker: 'Netrpělivost',
      head: `${esc(t.m.player_name)} zaplatil ${t.ev.event_transfers_cost} bodů za transfery`,
      body: `Udělal <b>${t.ev.event_transfers}</b> přesunů a skončil na ${t.ev.points} bodech.
        Bez trestu by měl ${t.ev.points + t.ev.event_transfers_cost}.`,
    });
  }

  // lavicka
  const bench = gw.filter(x => !x.ev.zeStandings)
    .sort((a, b) => b.ev.points_on_bench - a.ev.points_on_bench)[0];
  if(bench && bench.ev.points_on_bench >= 8){
    news.push({
      cls: 'bad', kicker: 'Lavička hanby',
      head: `${esc(bench.m.player_name)} nechal ${bench.ev.points_on_bench} bodů na lavičce`,
      body: 'Body, které měl v týmu a nedostal je.',
    });
  }

  /* Průměr kola. Vystačí s body, takže funguje i z živého pořadí —
     a v prvním kole sezóny, kdy ještě není s čím srovnávat pořadí,
     je to jediná novinka, která dává lize kontext. */
  if(gw.length >= 3){
    const soucet = gw.reduce((a, x) => a + x.ev.points, 0);
    const prumer = Math.round(soucet / gw.length);
    const nad = gw.filter(x => x.ev.points > prumer).length;
    news.push({
      cls: 'warn', kicker: 'Průměr kola',
      head: `Liga dala v průměru ${prumer} bodů`,
      body: `Nad průměrem skončilo <b>${nad}</b> z ${gw.length} manažerů. `
        + `Rozpětí od ${bottom.ev.points} do ${top.ev.points} bodů.`,
    });
  }

  /* Nejtěsnější souboj. Zajímavá je dvojice, která se v kole minula
     o pár bodů — v malé lize je to obvykle ten příběh, o kterém se
     pak píše do chatu. */
  if(gw.length >= 3){
    let nej = null;
    for(let i = 1; i < sorted.length; i++){
      const d = sorted[i - 1].ev.points - sorted[i].ev.points;
      if(nej === null || d < nej.d) nej = {d, a: sorted[i - 1], b: sorted[i], poz: i};
    }
    if(nej && nej.d <= 3 && nej.poz > 1){
      news.push({
        cls: 'warn', kicker: 'O fous',
        head: nej.d === 0
          ? `${esc(nej.a.m.player_name)} a ${esc(nej.b.m.player_name)} skončili na stejných bodech`
          : `${esc(nej.a.m.player_name)} přeskočil ${esc(nej.b.m.player_name)} o ${nej.d} body`,
        body: `Oba kolem <b>${nej.a.ev.points}</b> bodů — nejtěsnější souboj kola.`,
      });
    }
  }

  /* V čele celkově. Body za kolo a celkové pořadí jsou dvě různé zprávy;
     vítěz kola nemusí vést ligu a naopak. */
  const celkem = gw.filter(x => Number.isFinite(x.ev.total_points))
    .sort((a, b) => b.ev.total_points - a.ev.total_points);
  if(celkem.length >= 2){
    const lidr = celkem[0], druhy = celkem[1];
    const naskok = lidr.ev.total_points - druhy.ev.total_points;
    news.push({
      cls: 'good', kicker: 'V čele ligy',
      head: `${esc(lidr.m.player_name)} vede s ${lidr.ev.total_points} body`,
      body: lidr.m.entry === top.m.entry
        ? `Vyhrál kolo a zároveň vede tabulku — náskok <b>${naskok}</b> bodů na `
          + `${esc(druhy.m.player_name)}.`
        : `Kolo sice vyhrál ${esc(top.m.player_name)}, tabulku ale drží `
          + `<b>${esc(lidr.m.player_name)}</b> s náskokem ${naskok} bodů.`,
    });
  }

  /* Pohyb v tabulce.

     Tohle je jediná novinka, která se během rozehraného kola nedá
     ukázat ani s výhradou: porovnávala by rozehraný stav s posledním
     dokončeným, takže by hlásila skoky, které se do neděle několikrát
     otočí. Radši ji vynecháme, než abychom ji opravovali každou hodinu. */
  const {ranks, gws} = leagueRanks(members, hists);
  const idx = cur.id;   // pořadí po tomhle kole je na indexu id-1
  if(gws >= 2 && idx >= 2 && phase !== 'running'){
    const moves = members.map((m, i) => ({
      m, delta: ranks[i][idx - 2] - ranks[i][idx - 1],
      from: ranks[i][idx - 2], to: ranks[i][idx - 1],
    })).filter(x => Number.isFinite(x.delta));
    const up = moves.slice().sort((a, b) => b.delta - a.delta)[0];
    const down = moves.slice().sort((a, b) => a.delta - b.delta)[0];
    if(up && up.delta >= 2){
      news.push({
        cls: 'good', kicker: 'Skok kola',
        head: `${esc(up.m.player_name)} vyskočil o ${up.delta} míst`,
        body: `Z <b>${up.from}.</b> na <b>${up.to}. místo</b>.`,
      });
    }
    if(down && down.delta <= -2){
      news.push({
        cls: 'bad', kicker: 'Pád kola',
        head: `${esc(down.m.player_name)} spadl o ${-down.delta} míst`,
        body: `Z <b>${down.from}.</b> na <b>${down.to}. místo</b>.`,
      });
    }
  }

  return news;
}

/* Do které poloviny sezóny kolo patří.

   Hranice je deadline GW19: čipy první sady se po něm ztrácejí a od
   GW20 dostane každý sadu novou. Je to jediné místo, kde se to číslo
   vyskytuje — kdyby FPL hranici posunulo, mění se tady. */
const CHIP_HALF_GW = 20;
function chipHalf(gw){ return Number(gw) >= CHIP_HALF_GW ? 2 : 1; }
function chipHalfName(h){ return h === 1 ? '1. polovina sezóny' : '2. polovina sezóny'; }

/* ------------------------------------------------------------
   SEZÓNNÍ ŽEBŘÍČKY

   Všechno, co je tady, je součet OD ZAČÁTKU SEZÓNY — ne poslední kolo.
   Původní verze to tak myslela, ale sčítala `x.event_transfers` a spol.
   bez ptaní, a `undefined + 0` je NaN, kdežto `null`/chybějící pole se
   přes `reduce` protáhly jako nuly. Když se do historie dostal jediný
   neúplný řádek (běžící kolo z pořadí ligy, poškozený archiv), tabulky
   tvrdily „nula přestupů, prázdná lavička, nulová hodnota kádru“ —
   a vypadalo to, jako by se sezóna resetovala.

   Odteď platí tři pravidla:
     · sčítá se jen z řádků, které tu položku opravdu znají,
     · hodnota kádru se bere z posledního řádku, který ji zná,
     · pod tabulkami je vidět, kolik kol se do součtu vešlo.

   Když se do součtu nevejde nic, píše se pomlčka. Prázdno je poctivé;
   nula je tvrzení.
   ------------------------------------------------------------ */
function buildBoards(){
  const {members, hists, cur} = HUB;
  const myId = parseInt(CONFIG.entryId || localStorage.getItem('fpl_entry') || '0', 10);

  // Číslo je použitelné jen tehdy, když to opravdu je číslo. `null`
  // znamená „tenhle řádek to neví“, ne nulu.
  const num = v => (v === null || v === undefined || v === '' ? null
                    : (Number.isFinite(Number(v)) ? Number(v) : null));

  let pokryto = 0;      // nejvíc kol, ze kterých se povedlo sečíst

  const stats = members.map((m, i) => {
    const h = hists[i];
    const cs = (h && Array.isArray(h.current)) ? h.current : [];

    /* Součet přes kola, která tu položku znají. Vrací i počet kol,
       ze kterých se sčítalo — bez něj by „0“ znamenala jak „nikdo nic
       neudělal“, tak „nemám data“. */
    const sum = key => {
      let a = 0, n = 0;
      for(const x of cs){
        const v = num(x[key]);
        if(v === null) continue;
        a += v; n++;
      }
      return {v: n ? a : null, n};
    };

    const tax   = sum('event_transfers_cost');
    const moves = sum('event_transfers');
    const bench = sum('points_on_bench');
    pokryto = Math.max(pokryto, tax.n, moves.n, bench.n);

    const pts = cs.map(x => num(x.points)).filter(v => v !== null);
    const mean = pts.length ? pts.reduce((a, b) => a + b, 0) / pts.length : 0;
    const sd = pts.length > 1
      ? Math.sqrt(pts.reduce((a, b) => a + (b - mean) ** 2, 0) / pts.length) : null;

    /* Hodnota kádru: poslední kolo, které ji zná. Dřív to byl prostě
       poslední řádek — a když to byl ten z pořadí ligy, vyšla nula
       a s ní nulová efektivita pro celou ligu. */
    let value = null;
    for(let k = cs.length - 1; k >= 0; k--){
      const v = num(cs[k].value);
      if(v !== null && v > 0){ value = v / 10; break; }
    }

    /* Celkové body: autoritativní je pořadí ligy (`m.total`), protože
       to je živé a nepotřebuje historii vůbec. */
    let total = num(m.total);
    if(total === null) for(let k = cs.length - 1; k >= 0; k--){
      const v = num(cs[k].total_points);
      if(v !== null){ total = v; break; }
    }

    return {
      m,
      tax: tax.v, moves: moves.v, bench: bench.v,
      sd, mean, value, total,
      chips: (h && h.chips) ? h.chips : [],
    };
  });

  const board = (title, cap, arr, fmt, asc) => {
    // Kdo hodnotu nemá, do žebříčku nepatří — jinak by se s nulou
    // usadil na kraji tabulky a vypadal jako výsledek.
    const rows = arr.filter(r => r.v !== null && Number.isFinite(r.v))
      .sort((a, b) => asc ? a.v - b.v : b.v - a.v).slice(0, 5);
    const body = rows.length
      ? `<ol>${rows.map(r => `<li class="${r.id === myId ? 'me' : ''}">${esc(r.n)}
          <span>${fmt(r.v)}</span></li>`).join('')}</ol>`
      : '<p class="cap" style="margin:0">Zatím není z čeho počítat.</p>';
    return `<div class="board">
      <h4>${esc(title)}</h4>
      <p class="cap">${esc(cap)}</p>
      ${body}
    </div>`;
  };

  const pick = f => stats.map(s => ({n: s.m.player_name, id: s.m.entry, v: f(s)}));

  /* Rozsah, ze kterého se sčítalo. Uživatel se ptal přesně na tohle —
     „je to za celou sezónu, nebo jen za poslední kolo?“ — a tabulka
     na to dosud neuměla odpovědět. */
  const doKola = cur ? cur.id : pokryto;
  const rozsah = !pokryto ? 'Zatím není z čeho počítat.'
    : pokryto === 1 ? 'Součet za GW' + doKola + '.'
    : `Součet za ${pokryto} kol sezóny (GW1–${doKola}).`;

  /* Žolíky se dělí na dvě sady.

     Od sezóny 2024/25 musí čipy první poloviny padnout do deadlinu
     GW19; do druhé poloviny se nepřenáší nic a od GW20 má každý sadu
     znovu. Bez tohohle rozdělení tabulka v březnu tvrdila „Wildcard
     GW2“ a člověk z toho přečetl „wildcard nemám“ — přestože ho měl
     od Vánoc zase k dispozici.

     Ukazuje se proto jen probíhající polovina.

     Řez je po žolíku, ne po hráči. Otázka, kvůli které se sem člověk
     dívá, zní „je Bench Boost v lize ještě ve hře?“ — a na tu seznam
     jmen s vypsanými čipy u každého odpovídal až po sečtení hlavou.
     Proužek navíc unese i stav, kdy čip spálilo devět z deseti: tam
     se formulace obrátí na „zbývá jen X“, takže nejhorší případ je
     ten nejkratší. */
  const chipNames = {wildcard: 'Wildcard', '3xc': 'Triple captain',
                     bboost: 'Bench boost', freehit: 'Free hit', manager: 'Manager'};
  const SADA = ['wildcard', 'freehit', 'bboost', '3xc'];
  const tedPolovina = chipHalf(cur ? cur.id : 1);
  const vsech = stats.length;

  const chipRows = SADA.map(key => {
    const uzili = stats.filter(s => (s.chips || []).some(
      c => c.name === key && chipHalf(c.event) === tedPolovina));
    const n = uzili.length;
    const jmeno = s => `<span class="${s.m.entry === myId ? 'me' : ''}">${
      esc(s.m.player_name)}</span>`;

    /* Tři tvary popisku podle toho, čeho je míň — jmen, co spálila,
       nebo jmen, co zbývají. Vypsat devět jmen a nechat čtenáře
       dopočítat desáté je práce navíc za nic. */
    let kdo;
    if(!n) kdo = '<span class="mute">zatím nikdo</span>';
    else if(n === vsech) kdo = 'všichni';
    else if(vsech - n <= 2 && vsech > 4){
      const zbyli = stats.filter(s => !uzili.includes(s));
      kdo = '<span class="mute">zbývá' + (zbyli.length === 1 ? ' jen ' : ' ')
        + '</span>' + zbyli.map(jmeno).join(', ');
    }
    else kdo = uzili.map(jmeno).join(', ');

    const podil = vsech ? Math.round(n / vsech * 100) : 0;
    return `<div class="chiprow"><span class="nm">${esc(chipNames[key] || key)}</span>
      <span class="bar"><i style="width:${podil}%"></i></span>
      <span class="ct">${n}/${vsech}</span></div>
      <p class="chipwho">${kdo}</p>`;
  }).join('');

  return `<p class="boardsnote">${esc(rozsah)}</p>
  <div class="boards">
    ${board('Daň za transfery', 'Body odevzdané za přesuny', pick(s => s.tax), v => '−' + v)}
    ${board('Zmrzlá lavička', 'Body, co protekly na lavičce', pick(s => s.bench), v => v)}
    ${board('Nejaktivnější', 'Počet transferů za sezónu', pick(s => s.moves), v => v)}
    ${board('Nejstabilnější', 'Nejmenší rozptyl bodů po kolech', pick(s => s.sd),
            v => v.toFixed(1), true)}
    ${board('Efektivita kádru', 'Body na milion hodnoty týmu',
            pick(s => (s.value && s.total !== null) ? s.total / s.value : null),
            v => v.toFixed(1))}
    <div class="board">
      <h4>Žolíky</h4>
      <p class="cap">${esc('Kdo už co použil · ' + chipHalfName(tedPolovina))}</p>
      <div class="chips-board">${chipRows}</div>
    </div>
  </div>`;
}

/* ============================================================
   AKTUÁLNÍ GAMEWEEK V LIZE

   Krátký odstavec o tom, co se v lize děje v právě otevřeném kole:
   kdo spálil čip, na koho vsadila většina pásku a kdo si vzal mínusy.
   Jsou to tři věci, kvůli kterým se člověk po deadlinu chodí dívat do
   ligy — a dosud pro ně musel projít Hub, Miniligu a sestavy jednu po
   druhé.

   Data jsou zadarmo: sestavy kola (`entry/{gw}/picks/`) si Hub stahuje
   tak jako tak. Nic dalšího tahle sekce nepotřebuje, takže nepřidává
   ani jeden dotaz.

   Proč právě `is_current`: sestavy jsou veřejné až po deadlinu.
   Před ním by sekce mohla ukázat leda tipy — a tipovat, co kdo nasadí,
   není informace. Dokud další kolo nezačalo, mluví se tedy o tom
   posledním a je to v poznámce pod odstavcem napsané.
   ============================================================ */

const GWL_CHIPS = {
  wildcard: {veta: 'wildcard',             pill: 'Wildcard'},
  bboost:   {veta: 'bench boost',          pill: 'Bench boost'},
  '3xc':    {veta: 'triple kapitána',      pill: 'Triple captain'},
  freehit:  {veta: 'free hit',             pill: 'Free hit'},
  manager:  {veta: 'asistenta manažera',   pill: 'Asistent manažera'},
};

/* Křestní jméno je čitelnější než celé, ale jen dokud je v lize jediné.
   Adam Marko a Adam Vrzal v jedné lize znamenají, že věta „Adam zahrál
   wildcard“ je nepoužitelná — u takového jména se proto píše celé. */
function gwlJmena(members){
  const prvni = (members || []).map(m =>
    String(m.player_name || '').trim().split(/\s+/)[0] || '?');
  const kolik = new Map();
  prvni.forEach(f => kolik.set(f, (kolik.get(f) || 0) + 1));
  return (members || []).map((m, i) => kolik.get(prvni[i]) === 1
    ? prvni[i]
    : (String(m.player_name || '').trim() || prvni[i]));
}

/* Čeština má tři tvary počítaného podstatného jména. Věta, která je
   plete („2 manažerů zahrálo“), vypadá jako strojový překlad a čtenář
   pak nevěří ani číslům v ní. */
function gwlTvar(n, jedna, dva, pet){
  const a = Math.abs(n) % 10, b = Math.abs(n) % 100;
  if(a === 1 && b !== 11) return jedna;
  if(a >= 2 && a <= 4 && (b < 12 || b > 14)) return dva;
  return pet;
}
const gwlManazeru = n => n + ' ' + gwlTvar(n, 'manažer', 'manažeři', 'manažerů');
/* Čtvrtý pád. „Až na 3 manažeři“ je věta, u které čtenář ztratí důvěru
   i v čísla kolem ní — a přitom je to jediné místo v odstavci, kde se
   počítaný tvar neskloňuje v prvním pádě. */
const gwlManazery = n => n + ' ' + gwlTvar(n, 'manažera', 'manažery', 'manažerů');
const gwlBodu     = n => gwlTvar(n, 'bod', 'body', 'bodů');
const gwlPrestupu = n => gwlTvar(n, 'přestup', 'přestupy', 'přestupů');

function gwlSeznam(xs){
  if(!xs || !xs.length) return '';
  if(xs.length === 1) return xs[0];
  return xs.slice(0, -1).join(', ') + ' a ' + xs[xs.length - 1];
}

/* Nominovaný kapitán, ne ten, kterému nakonec připadla páska. Věta
   mluví o rozhodnutí manažera před deadlinem — přesun pásky na
   náhradníka je věc autosubů a patří do sestavy, ne sem. */
function gwlKapitan(pk){
  const c = ((pk && pk.picks) || []).find(x => x.is_captain);
  return c ? c.element : null;
}

function gwlCena(pk){
  const v = Number(pk && pk.entry_history && pk.entry_history.event_transfers_cost);
  return Number.isFinite(v) ? v : 0;
}

function gwlPresuny(pk){
  const v = Number(pk && pk.entry_history && pk.entry_history.event_transfers);
  return Number.isFinite(v) ? v : 0;
}

/* Fakta o kole jako čistá funkce nad daty — bez DOM, bez globálů.
   Jenom tak se dají odchytat všechny ty kombinace (nikdo/jeden/většina/
   remíza) testem místo čekáním na to správné kolo v sezóně.

   Vrací `{vety, pily}`, nebo `null`, když sestavy k dispozici nejsou. */
/**
 * @param {FplStandingsMember[]} members
 * @param {Array<FplPicks|null>} picks
 * @param {Record<number, FplElement>} els
 * @returns {{vety: string[], pily: Array<{cls: string, t: string}>}|null}
 */
function gwLeagueFacts(members, picks, els){
  const jmena = gwlJmena(members);
  const rows = (members || []).map((m, i) => ({m, jm: jmena[i], pk: picks && picks[i]}))
    .filter(r => r.pk && Array.isArray(r.pk.picks) && r.pk.picks.length);
  if(rows.length < 2) return null;

  const jmeno = id => {
    const p = els && els[id];
    return p ? (p.web_name || '?') : '?';
  };
  const uv = s => '„' + s + '“';

  const vety = [], pily = [];

  /* ---------- 1. čipy ---------- */
  const podleCipu = new Map();
  rows.forEach(r => {
    const c = r.pk.active_chip;
    if(!c) return;
    if(!podleCipu.has(c)) podleCipu.set(c, []);
    podleCipu.get(c).push(r);
  });

  if(!podleCipu.size){
    vety.push('Nikdo v lize nezahrál žádný chip.');
  } else {
    // Nejdřív to nejdražší rozhodnutí, pak zbytek. Pořadí je dané, aby
    // odstavec vypadal pokaždé stejně a dal se přečíst po diagonále.
    const poradi = ['3xc', 'bboost', 'freehit', 'wildcard', 'manager'];
    const klice = [...podleCipu.keys()].sort((a, b) =>
      ((poradi.indexOf(a) + 1) || 99) - ((poradi.indexOf(b) + 1) || 99));

    for(const k of klice){
      const kdo = podleCipu.get(k);
      const nazev = (GWL_CHIPS[k] && GWL_CHIPS[k].veta) || k;

      /* Triple kapitán bez jména kapitána je půlka zprávy — trojnásobná
         sázka je právě o tom, na koho padla. */
      if(k === '3xc'){
        kdo.forEach(r => {
          const c = gwlKapitan(r.pk);
          vety.push(r.jm + ' zahrál triple kapitána'
            + (c ? ' s kapitánem ' + uv(jmeno(c)) : '') + '.');
        });
      } else if(kdo.length === 1){
        vety.push(kdo[0].jm + ' zahrál ' + nazev + '.');
      } else {
        vety.push(gwlManazeru(kdo.length) + ' (' + gwlSeznam(kdo.map(r => r.jm))
          + ') zahráli ' + nazev + '.');
      }

      pily.push({cls: 'chip', t: ((GWL_CHIPS[k] && GWL_CHIPS[k].pill) || k)
        + (kdo.length > 1 ? ' ×' + kdo.length : '')});
    }

    // Uzavření seznamu dává smysl jen u jediného druhu; u tří čipů už
    // je z odstavce zřejmé, co se hrálo.
    if(klice.length === 1) vety.push('Nikdo nezahrál žádný jiný chip.');
  }

  /* ---------- 2. kapitáni ---------- */
  const sKap = rows.filter(r => gwlKapitan(r.pk) !== null);
  if(!sKap.length){
    vety.push('Kapitáni se z dat tohohle kola vyčíst nedají.');
  } else {
    const pocty = new Map();
    sKap.forEach(r => {
      const id = gwlKapitan(r.pk);
      pocty.set(id, (pocty.get(id) || 0) + 1);
    });
    const serazeno = [...pocty.entries()].sort((a, b) => b[1] - a[1]);
    const topN = serazeno[0][1];
    const naVrcholu = serazeno.filter(([, n]) => n === topN).map(([id]) => id);
    const topId = naVrcholu[0];

    if(naVrcholu.length === 1 && topN === sKap.length){
      vety.push('Kapitánem zvolila celá liga ' + uv(jmeno(topId)) + '.');
      pily.push({cls: 'cap', t: 'C · ' + jmeno(topId) + ' ' + topN + '/' + sKap.length});

    } else if(naVrcholu.length === 1 && topN * 2 > sKap.length){
      const jini = sKap.filter(r => gwlKapitan(r.pk) !== topId);
      /* Jména zůstávají v prvním pádě. „Kromě Adam Marko“ i „kromě
         Kryštof“ jsou tvary, které v češtině neexistují, a skloňovat
         cizí i domácí jména strojově se nedá spolehlivě — tak je věta
         postavená tak, aby to nebylo potřeba. */
      if(jini.length === 1){
        vety.push('Jako kapitán je u většiny manažerů ' + uv(jmeno(topId))
          + '. Jinak volil jen ' + jini[0].jm + ', který má '
          + uv(jmeno(gwlKapitan(jini[0].pk))) + '.');
      } else {
        vety.push('Jako kapitána zvolila většina manažerů ' + uv(jmeno(topId))
          + ' — až na ' + gwlManazery(jini.length)
          + ' (' + gwlSeznam(jini.map(r => r.jm)) + '), kteří volili jinak.');
      }
      pily.push({cls: 'cap', t: 'C · ' + jmeno(topId) + ' ' + topN + '/' + sKap.length});

    } else {
      /* Většina se nenašla — buď je pole roztříštěné, nebo je na špici
         remíza. Obojí je zpráva sama o sobě: v malé lize to znamená, že
         se kolo rozhodne na kapitánovi.

         Vyjmenovat se dají tři jména; při širší remíze by z věty byl
         seznam, který nikdo nedočte. */
      let v = 'Žádný hráč nebyl jako kapitán zvolen u více než poloviny manažerů';
      if(naVrcholu.length === 1){
        v += '; nejčastěji (' + topN + '×) padla volba na ' + uv(jmeno(topId)) + '.';
      } else if(naVrcholu.length <= 3){
        v += '; nejčastěji, ' + topN + '× každý, na '
          + gwlSeznam(naVrcholu.map(id => uv(jmeno(id)))) + '.';
      } else {
        v += ' — na špici je remíza ' + naVrcholu.length + ' hráčů po '
          + topN + ' hlasech.';
      }
      vety.push(v);
      pily.push({cls: 'cap', t: 'C · bez většiny'});
    }
  }

  /* ---------- 3. daň za přestupy ---------- */
  const platici = rows.filter(r => gwlCena(r.pk) > 0)
    .sort((a, b) => gwlCena(b.pk) - gwlCena(a.pk));

  if(!platici.length){
    vety.push('Za přestupy v tomto kole nikdo neutratil žádné body navíc.');
  } else if(platici.length === 1){
    const c = gwlCena(platici[0].pk);
    vety.push('Za přestupy utratil ' + platici[0].jm + ' −' + c + ' ' + gwlBodu(c) + '.');
  } else if(platici.every(r => gwlCena(r.pk) === gwlCena(platici[0].pk))){
    const c = gwlCena(platici[0].pk);
    vety.push('Za přestupy utratili ' + gwlManazeru(platici.length)
      + ' (' + gwlSeznam(platici.map(r => r.jm)) + ') −' + c + ' ' + gwlBodu(c) + '.');
  } else {
    const celkem = platici.reduce((a, r) => a + gwlCena(r.pk), 0);
    vety.push('Za přestupy zaplatili ' + gwlManazeru(platici.length) + ': '
      + gwlSeznam(platici.map(r => r.jm + ' (−' + gwlCena(r.pk) + ')'))
      + ' — dohromady −' + celkem + ' ' + gwlBodu(celkem) + '.');
  }

  const danCelkem = rows.reduce((a, r) => a + gwlCena(r.pk), 0);
  if(danCelkem > 0) pily.push({cls: 'bad', t: 'celkem −' + danCelkem + ' za přestupy'});

  /* ---------- 4. objem přestupů ---------- */
  const presuny = rows.reduce((a, r) => a + gwlPresuny(r.pk), 0);
  if(presuny > 0){
    /* Wildcard a free hit počítají do `event_transfers` celou přestavbu
       kádru. Bez téhle poznámky vypadá „27 přestupů“ v sedmičlenné lize
       jako chyba výpočtu. Jmenuje se jen to, co se opravdu hrálo —
       zmínka o free hitu v kole, kde ho nikdo nezahrál, je taky chyba,
       jen míň nápadná. */
    const prestavba = ['wildcard', 'freehit'].filter(k => podleCipu.has(k))
      .map(k => GWL_CHIPS[k].veta);
    vety.push('Dohromady liga udělala ' + presuny + ' ' + gwlPrestupu(presuny)
      + (prestavba.length ? ', včetně tahů na ' + gwlSeznam(prestavba) + '.' : '.'));
    pily.push({cls: '', t: presuny + ' ' + gwlPrestupu(presuny)});
  }

  return {vety, pily};
}

/* Box na Přehledu. Skládá se ze stejných dílů jako ostatní: hlavička
   s odkazem do Hubu, obsah, případně kostra, dokud se liga načítá. */
function homeGwLeague(){
  const box = (inner, gw) => `<div class="hbox hgwl">
    <h3><i class="hi">📋</i>Aktuální gameweek v lize${gw ? ' · GW' + gw : ''}
      <button type="button" class="lnkbtn" data-goto="t-hub">Hub ligy</button></h3>
    ${inner}</div>`;

  const lid = CONFIG.leagueId || localStorage.getItem('fpl_league');
  if(!lid){
    return box(`<p class="note">Sekce se počítá ze sestav miniligy — zadej
      si její ID v záložce Miniliga.</p>`);
  }

  // Data si tahá Hub. Když se ještě nenačetl, spustíme totéž, co ceny
  // kola, a do té doby držíme výšku kostrou místo prázdna. Když se
  // nepovedl, ukáže se důvod a tlačítko — ne věčná kostra.
  if(typeof HUB === 'undefined' || !HUB){
    const cekani = typeof homeHubPending === 'function' ? homeHubPending() : null;
    return box(cekani || '<div class="skel"><i></i><i></i></div>');
  }

  const els = Object.fromEntries((BOOT.elements || []).map(p => [p.id, p]));
  const f = gwLeagueFacts(HUB.members, HUB.picks, els);
  if(!f){
    return box('<p class="note">Sestavy tohohle kola zatím nejsou k dispozici.</p>',
               HUB.cur.id);
  }

  const faze = gwPhase(HUB.cur.id);
  const nxt = (BOOT.events || []).find(e => e.is_next);

  /* Mezi koncem kola a dalším deadlinem sekce mluví o dohraném kole.
     Kdyby to neřekla, vypadala by jako zastaralá — a člověk by hledal
     tlačítko na obnovení, které by nic nezměnilo. */
  const pozn = (faze === 'final' && nxt)
    ? `Kolo je dohrané. Co kdo nasadí v GW${nxt.id}, bude vidět až po deadlinu.`
    : '';

  const stitek = faze === 'final' ? ''
    : `<span class="livetag">${faze === 'running' ? 'živě' : 'čeká na bonusy'}</span>`;

  return box(`${stitek}
    <p class="gwltext">${f.vety.map(esc).join(' ')}</p>
    ${f.pily.length ? `<div class="gwlpills">${f.pily.map(p =>
      `<span class="gwlpill ${p.cls}">${esc(p.t)}</span>`).join('')}</div>` : ''}
    ${pozn ? `<p class="gwlnote">${esc(pozn)}</p>` : ''}`, HUB.cur.id);
}

function buildHealth(){
  const {members, picks, cur} = HUB;
  const els = Object.fromEntries(BOOT.elements.map(p => [p.id, p]));
  const teams = Object.fromEntries(BOOT.teams.map(t => [t.id, t]));
  const nxt = BOOT.events.find(e => e.is_next);
  const startGw = nxt ? nxt.id : cur.id + 1;

  const rows = members.map((m, i) => {
    const pk = picks[i];
    if(!pk) return null;
    const squad = pk.picks.map(x => els[x.element]).filter(Boolean);

    /* Dvě různé zprávy, ne dvě čtení téže.

       Původně sloupec „Nehraje“ počítal nedostupné hráče a „Pod otazníkem“
       úplně všechny označené — tedy včetně těch nedostupných. Yates se
       statusem `i` se tak objevil v obou sloupcích a vypadalo to, že má
       Kryštof problémy dva. Kategorie proto musí být disjunktní: kdo je
       v `out`, do otazníků už nepatří. */
    const isOut = p => p.status === 'i' || p.status === 's' || p.status === 'u'
      || p.status === 'n' || p.chance_of_playing_next_round === 0;

    const out = squad.filter(isOut);
    const doubt = squad.filter(p => !isOut(p) &&
      (p.status !== 'a' ||
       (p.chance_of_playing_next_round !== null &&
        p.chance_of_playing_next_round < 100)));
    const flagged = out.concat(doubt);
    const fdrs = squad.map(p => {
      const f = nextFixtures(p.team, startGw, 3);
      return f.length ? f.reduce((a, x) => a + x.d, 0) / f.length : 3;
    });
    const avgFdr = fdrs.reduce((a, b) => a + b, 0) / (fdrs.length || 1);
    return {m, flagged, out, doubt, avgFdr,
            names: flagged.map(p => p.web_name + ' (' + teams[p.team].short_name + ')'
              + (isOut(p) ? '' : ' ?'))};
  }).filter(Boolean);

  rows.sort((a, b) => b.out.length - a.out.length || b.doubt.length - a.doubt.length);

  return `<table>
    <thead><tr><th>Manažer</th><th class="n">Nehraje</th><th class="n">Pod otazníkem</th>
      <th class="n">FDR kádru</th><th class="hide-s">Kdo</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td><b>${HUB && HUB.cur
        ? squadBtn(r.m.entry, HUB.cur.id, r.m.player_name, r.m.entry_name)
        : esc(r.m.player_name)}</b></td>
      <td class="n ${r.out.length >= 3 ? 'al' : r.out.length ? 'wn' : ''}">${r.out.length}</td>
      <td class="n ${r.doubt.length ? 'wn' : ''}">${r.doubt.length}</td>
      <td class="n ${r.avgFdr >= 3.6 ? 'al' : r.avgFdr <= 2.6 ? 'ok' : ''}">${r.avgFdr.toFixed(2)}</td>
      <td class="hide-s" style="color:var(--mute);font-size:12px">${esc(r.names.join(', ')) || '—'}</td>
    </tr>`).join('')}</tbody></table>
  <p class="note">Sloupce se nepřekrývají: kdo nehraje, do otazníků se
  už nepočítá. Otazníkem je hráč s šancí nastoupit 25–75 %; ve sloupci
  „Kdo“ ho pozná podle otazníku za jménem. FDR kádru je průměrná obtížnost
  dalších tří zápasů přes všech 15 hráčů — nižší je lepší.</p>`;
}

function buildCollective(){
  const {members, picks, cur} = HUB;
  const els = Object.fromEntries(BOOT.elements.map(p => [p.id, p]));
  const teams = Object.fromEntries(BOOT.teams.map(t => [t.id, t]));

  const valid = picks.filter(Boolean);
  const n = valid.length;
  if(!n) return '<p class="note">Sestavy zatím nejsou dostupné.</p>';

  // kapitanska mapa
  const capCount = {};
  members.forEach((m, i) => {
    const pk = picks[i];
    if(!pk) return;
    const c = pk.picks.find(x => x.is_captain);
    if(c) (capCount[c.element] = capCount[c.element] || []).push(m.player_name);
  });
  const capRows = Object.entries(capCount)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([pid, list]) => {
      const p = els[pid];
      return `<div class="row2">
        <span class="nm2">${esc(p ? p.web_name : '?')}</span>
        <span class="bar2"><i style="width:${Math.round(list.length / n * 100)}%"></i></span>
        <span class="ct2">${list.length}/${n}</span>
      </div>`;
    }).join('');

  // sablona: jak moc jsou si sestavy podobne
  const own = {};
  members.forEach((m, i) => {
    const pk = picks[i];
    if(!pk) return;
    pk.picks.forEach(x => own[x.element] = (own[x.element] || 0) + 1);
  });
  const core = Object.entries(own).filter(([, c]) => c >= Math.ceil(n * 0.5));
  const universal = Object.entries(own).filter(([, c]) => c === n);
  const templatePct = Math.round(core.length / 15 * 100);

  // liga proti proudu: kde se vlastnictvi lisi od globalu
  const contrarian = Object.entries(own)
    .map(([pid, c]) => {
      const p = els[pid];
      if(!p) return null;
      return {p, local: c / n * 100, global: parseFloat(p.selected_by_percent)};
    })
    .filter(Boolean)
    .map(x => ({...x, diff: x.local - x.global}))
    .sort((a, b) => b.diff - a.diff)
    .slice(0, 6);

  return `
    <h2>Kapitánská mapa · GW${cur.id}</h2>
    <div class="capmap">${capRows}</div>

    <h2>Efekt šablony${info(`${
      templatePct >= 60
        ? 'Liga hraje skoro stejný tým — rozhodne se to na pár rozdílných hráčích a kapitánovi.'
        : templatePct >= 35
          ? 'Sestavy se překrývají zhruba z třetiny. Prostor odlišit se tu pořád je.'
          : 'Každý si jede po svém — tabulka se může házet kolo od kola.'}`)}</h2>
    <div class="kpis">
      <div><div class="k">Jádro ligy</div><div class="v">${core.length}</div></div>
      <div><div class="k">Má každý</div><div class="v">${universal.length}</div></div>
      <div><div class="k">Shoda</div><div class="v">${templatePct} %</div></div>
    </div>
    

    <h2>Liga proti proudu${info(`Kde je tvoje liga jinde než zbytek světa. Kladný rozdíl znamená,
    že vy na hráče věříte víc než ostatní.`)}</h2>
    <table>
      <thead><tr><th>Hráč</th><th class="hide-s">Tým</th>
        <th class="n">V lize</th><th class="n">Globálně</th><th class="n">Rozdíl</th></tr></thead>
      <tbody>${contrarian.map(x => `<tr>
        <td><b>${esc(x.p.web_name)}</b></td>
        <td class="hide-s">${esc(teams[x.p.team].short_name)}</td>
        <td class="n">${x.local.toFixed(0)} %</td>
        <td class="n">${x.global.toFixed(1)} %</td>
        <td class="n ${x.diff > 0 ? 'ok' : 'al'}">${x.diff > 0 ? '+' : ''}${x.diff.toFixed(0)}</td>
      </tr>`).join('')}</tbody>
    </table>
    `;
}
