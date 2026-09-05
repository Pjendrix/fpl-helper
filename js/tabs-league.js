/* Minileague Squad Check — historie miniligy, diferenciály a zranění

   Součást skupiny js/tabs*.js. Ta byla do verze 2.0 jedním souborem
   o 4 200 řádcích a osmi nesouvisejících sekcích; rozdělení je čistě
   mechanické — žádný kód se nepřepisoval, jen přestěhoval.

   Soubory js/ se načítají jako klasické <script> v pevném pořadí a
   sdílejí jeden globální scope: nic se neexportuje ani neimportuje,
   ale hoisting přes hranici souboru neplatí. Pořadí je proto součást
   kontraktu a je vypsané v index.html i v sw.js.
   ============================================================ */

/* ============================================================
   HISTORIE MINILIGY

   Důležité omezení, které stojí za to znát dopředu: FPL **neposílá
   pořadí miniligy za minulé sezóny**. Endpoint standings vrací vždy
   jen tu rozehranou. Co dostat jde, je `past` z entry/{id}/history/ —
   celkové body a celkové pořadí každého manažera za předchozí sezóny.

   Tabulka níž je proto sestavená z celkových bodů členů, kteří jsou
   v lize **dneska**. Není to archiv toho, jak liga tehdy dopadla:
     · kdo mezitím odešel, tu není,
     · kdo se přidal loni, má starší sezóny prázdné,
     · pořadí je přepočítané mezi současnými členy, ne historické.
   Appka to říká i uživateli — tichý nepřesný archiv by byl horší
   než žádný.
   ============================================================ */

const HIST_SEASONS = 6;

/* Poskládá matici sezóna × manažer z `past` jednotlivých členů. */
/* Kdo v dané sezóně za ligu oficiálně nastoupil.

   FPL zná jen celkové body každého manažera — netuší, že se liga
   rozrůstala postupně. Bez tohohle by medaile za ročníky, kdy hráli
   tři lidi, dostávali i ti, kdo tehdy hráli sami za sebe jinde.

   Sezóna, která v CONFIG.officialSeasons není, se počítá pro všechny. */
function matchesMember(key, m){
  return String(key) === String(m.entry) || normName(key) === normName(m.player_name);
}

function officialIn(season, m){
  // Přišel do ligy až později? Starší sezóny se nepočítají.
  // Řetězce „2023/24“ jdou porovnávat přímo — abecední pořadí je tu i to časové.
  const since = Object.entries(CONFIG.memberSince || {})
    .find(([k]) => matchesMember(k, m));
  if(since && season < since[1]) return false;

  // Sezóna s pevně danou soupiskou.
  const list = (CONFIG.officialSeasons || {})[season];
  if(!list) return true;
  return list.some(x => matchesMember(x, m));
}

/* Matice sezóna × manažer plus medaile.

   Medaile se rozdávají jen mezi těmi, kdo v dané sezóně opravdu hráli —
   kdo tehdy nebyl v lize, do pořadí nevstupuje ani nedostane poslední
   místo. */
function buildLeagueHistory(members, pasts){
  const seasons = new Set();
  const rows = [];

  members.forEach((m, i) => {
    const past = (pasts[i] && pasts[i].past) || [];
    const by = {};
    past.forEach(x => {
      if(!x || !x.season_name) return;
      seasons.add(x.season_name);
      by[x.season_name] = {pts: x.total_points, rank: x.rank};
    });
    rows.push({m, by, medals: {1: 0, 2: 0, 3: 0}, played: 0});
  });

  const cols = [...seasons].sort().slice(-HIST_SEASONS);

  const order = {};
  cols.forEach(c => {
    const hrali = rows
      .filter(r => r.by[c] && officialIn(c, r.m))
      .sort((a, b) => b.by[c].pts - a.by[c].pts);

    order[c] = new Map(hrali.map((r, i) => [r.m.entry, i + 1]));
    hrali.forEach((r, i) => { if(i < 3) r.medals[i + 1]++; });
  });

  rows.forEach(r => { r.played = cols.filter(c => r.by[c]).length; });
  return {cols, rows, order};
}

const MEDAL = {1: '🥇', 2: '🥈', 3: '🥉'};

/* Žebříček trofejí. Řadí se zlatem, pak stříbrem, pak bronzem —
   jedno první místo je víc než tři druhá. */
function trophyTable(rows){
  const score = r => r.medals[1] * 10000 + r.medals[2] * 100 + r.medals[3];
  const winners = rows.filter(r => score(r) > 0).sort((a, b) => score(b) - score(a));
  if(!winners.length) return '';

  return `<ol class="trophies">${winners.map((r, i) => `
    <li${r.m.entry === HIST_ME ? ' class="me"' : ''}>
      <span class="pos">${i + 1}</span>
      <span class="nm"><b>${esc(r.m.player_name)}</b></span>
      <span class="mdl">${[1, 2, 3].map(k => r.medals[k]
        ? `<span title="${k}. místo">${MEDAL[k]}<u>${r.medals[k]}</u></span>` : ''
      ).join('')}</span>
    </li>`).join('')}</ol>`;
}

let HIST_ME = null;

function renderLeagueHistory(members, pasts, myId){
  HIST_ME = myId;
  const {cols, rows, order} = buildLeagueHistory(members, pasts);

  if(!cols.length)
    return `<p class="note">Nikdo z členů ligy nemá v FPL zaznamenanou
      předchozí sezónu.</p>`;

  const sorted = rows.slice().sort((a, b) =>
    (b.medals[1] - a.medals[1]) || (b.played - a.played) ||
    cols.reduce((x, c) => x + (b.by[c] ? b.by[c].pts : 0), 0) -
    cols.reduce((x, c) => x + (a.by[c] ? a.by[c].pts : 0), 0));

  /* Buňka nese jen body a medaili. Pořadí a celkový rank šly do title —
     dřív pod každým číslem stály dva řádky drobného textu a tabulka se
     kvůli tomu nedala přečíst napříč. */
  const cell = (r, c) => {
    const v = r.by[c];
    if(!v) return '<td class="n empty">·</td>';
    const pos = order[c].get(r.m.entry);
    const host = !pos;   // hrál FPL, ale ne za tuhle ligu
    const tip = `${v.pts} bodů · ${host ? 'mimo ligu'
      : pos + '. v lize'}${v.rank ? ' · ' + v.rank.toLocaleString('cs-CZ') + '. celkově' : ''}`;
    return `<td class="n${host ? ' guest' : ''}" title="${esc(tip)}">
      ${pos && pos <= 3 ? `<i class="m">${MEDAL[pos]}</i>` : ''}${v.pts}</td>`;
  };

  const off = Object.keys(CONFIG.officialSeasons || {});
  const late = Object.entries(CONFIG.memberSince || {});

  return `${trophyTable(rows)}
    <table class="hist">
      <thead><tr><th>Manažer</th>${cols.map(c =>
        `<th class="n">${esc(c.replace('20', ''))}</th>`).join('')}</tr></thead>
      <tbody>${sorted.map(r => `<tr${r.m.entry === myId ? ' class="me"' : ''}>
        <td><b>${esc(r.m.player_name)}</b></td>
        ${cols.map(c => cell(r, c)).join('')}
      </tr>`).join('')}</tbody>
    </table>
    <p class="note">Čísla jsou celkové body za sezónu; najetím myší uvidíš
      pořadí. Medaile se počítají jen mezi těmi, kdo v dané sezóně za ligu
      nastoupili${off.length
        ? ` — v ročnících ${esc(off.join(', '))} to byli jen ${
            esc((CONFIG.officialSeasons[off[0]] || []).join(', '))}`
        : ''}${late.length
        ? `. Později se přidali ${esc(late.map(([k, v]) => k + ' (' + v + ')').join(', '))}`
        : ''}. Šedé číslo znamená, že člověk tu sezónu hrál FPL, ale mimo
      tuhle ligu. Tečka, že nehrál vůbec.</p>
    <p class="note">FPL neposílá pořadí miniligy za minulé sezóny, jen celkové
      body každého manažera — tabulka je proto dopočtená z lidí, kteří jsou
      v lize dneska.</p>`;
}

async function loadLeagueHistory(members, myId){
  const box = $('histbox');
  if(!box) return;
  box.innerHTML = '<div class="skel"><i></i><i></i><i></i><i></i></div>';

  try{
    // Jeden dotaz na člena. U velkých lig by to bylo moc, tak bereme
    // prvních padesát — víc se stejně do tabulky rozumně nevejde.
    const subset = members.slice(0, 50);
    const pasts = await pooled(subset,
      m => cached('entry/' + m.entry + '/history/'), 5,
      (done, total) => {
        box.innerHTML = `<p class="note">Načítám historii… ${done}/${total}</p>`;
      });

    const ok = pasts.filter(Boolean).length;
    if(!ok){ box.innerHTML = '<p class="note">Historii se nepodařilo načíst.</p>'; return; }

    box.innerHTML = (ok < subset.length
        ? `<p class="note">U ${subset.length - ok} členů se historie nenačetla,
           v tabulce chybí.</p>`
        : '')
      + renderLeagueHistory(subset, pasts, myId);
  }catch(e){
    box.innerHTML = `<p class="note">Historii se nepodařilo načíst: ${esc(e.message)}</p>`;
  }
}

/* ============================================================
   DIFERENCIÁLY

   Diferenciál je hráč, kterého skoro nikdo nemá a přitom nosí body.
   Obojí musí platit zároveň — nízké vlastnictví samo o sobě není
   přednost, většina nevlastněných hráčů je nevlastněná právem.

   Skóre proto stavíme na dvou složkách:

     výnos    = projekce mého modelu na příštích 5 kol (počítá rozpis,
                minutovou jistotu, defenzivní příspěvky i doubly)
     páka     = jak moc se ti to promítne do pořadí

   Páka není lineární. Rozdíl mezi 2 % a 12 % vlastnictví je pro tvůj
   posun v lize mnohem větší než mezi 40 % a 50 %, protože v druhém
   případě se s tebou hýbe skoro celé pole. Používáme proto
   1 / sqrt(vlastnictví), useknuté zdola, ať extrémně neznámí hráči
   s jednou dobrou statistikou neutečou nahoru.

   Nejde o „kup tohohle“. Je to seznam, kde se dívat.
   ============================================================ */

const DIFF_GWS = 5;

/* Postupně volnější stropy vlastnictví.

   Původně to byl jeden pevný strop 12 % a tvrdý filtr na minuty. Když se
   do něj nikdo nevešel, appka napsala „nikdo neprošel filtrem“ a skončila —
   což je ta nejméně užitečná odpověď, jakou mohla dát. Na začátku sezóny,
   kdy má většina hráčů pár odehraných minut, se to stávalo skoro vždycky.

   Teď se strop uvolňuje, dokud se nenajde aspoň pět jmen, a appka řekne,
   o kolik musela slevit. Prázdný seznam je horší než seznam s výhradou. */
const DIFF_TIERS = [
  {max: 6,   label: 'pod 6 % vlastnictví'},
  {max: 12,  label: 'pod 12 % vlastnictví'},
  {max: 20,  label: 'pod 20 % vlastnictví'},
  {max: 35,  label: 'pod 35 % vlastnictví'},
  {max: 101, label: 'bez omezení vlastnictví'},
];

/* Jistota minut jako číslo 0–1, ne ano/ne.

   Tvrdá podmínka na odehrané minuty nefunguje první měsíc sezóny: kdo
   odehrál dvě kola, má jich málo ze své podstaty, ne proto, že by nehrál.
   Bereme proto starty vůči odehraným kolům, a když ještě žádné nejsou,
   opřeme se o cenu — drahý hráč nesedí na lavičce. */
function minuteConfidence(p, gwPlayed){
  if(p.status === 'u' || p.status === 'n') return 0;      // odešel, nehraje
  if(p.status === 'i' || p.status === 's') return 0;      // zraněný, stopka

  const chance = p.chance_of_playing_next_round;
  const chanceMul = chance === null || chance === undefined ? 1 : chance / 100;
  if(chanceMul < 0.5) return 0;

  if(gwPlayed < 1){
    // Sezóna nezačala: minuty ani starty nic neříkají. Cena je hrubý,
    // ale jediný signál, který v tu chvíli existuje.
    return chanceMul * Math.max(0, Math.min(1, (p.now_cost / 10 - 3.8) / 2.5));
  }

  const startRate = (p.starts || 0) / gwPlayed;
  const minRate = p.minutes / (gwPlayed * 90);

  // Starty váží víc než minuty: kdo nastupuje a je střídán, je pořád jistota.
  const base = Math.min(1, startRate * 0.65 + minRate * 0.55);
  return chanceMul * base;
}

/* Zpětně kompatibilní tvrdá varianta. */
function minutesSecure(p, gwPlayed){
  return minuteConfidence(p, gwPlayed) >= 0.6;
}

function diffScore(p, startGw, ownPct, conf){
  const xp = projectRange(p, startGw, DIFF_GWS);
  const own = Math.max(1.5, ownPct);        // páka useknutá zdola
  const c = conf === undefined ? 1 : conf;
  return {xp, conf: c, leverage: 1 / Math.sqrt(own), score: (xp / Math.sqrt(own)) * c};
}

/* Vybere pět jmen a řekne, jak volný strop na to potřebovala.
   `ownOf` vrací vlastnictví v procentech — globální, nebo v rámci ligy. */
function diffRows(pool, startGw, ownOf, gwPlayed, tiers){
  const scored = pool
    .map(p => {
      const conf = minuteConfidence(p, gwPlayed === undefined ? 0 : gwPlayed);
      return {p, own: ownOf(p), ...diffScore(p, startGw, ownOf(p), conf)};
    })
    .filter(x => x.conf > 0 && x.xp > 0);

  const list = tiers || DIFF_TIERS;
  const last = list[list.length - 1];
  let rows = [];
  let used = last;

  for(const tier of list){
    const fit = scored.filter(x => x.own <= tier.max)
      .sort((a, b) => b.score - a.score);

    if(fit.length >= 5 || tier === last){
      rows = fit.slice(0, 5);
      used = tier;
      break;
    }
    // Neúplný výsledek si schováme, kdyby žádný strop nestačil.
    if(fit.length > rows.length){ rows = fit.slice(0, 5); used = tier; }
  }

  return {rows, tier: used};
}

function confLabel(c){
  return c >= 0.85 ? '<span class="ok-t">jistá</span>'
       : c >= 0.6  ? 'slušná'
       : c >= 0.35 ? '<span class="warn-t">kolísá</span>'
       : '<span class="bad-t">riziko</span>';
}

function diffTable(res, ownLabel){
  const rows = res.rows || res;
  if(!rows.length)
    return `<p class="note">V datech zatím není nikdo s nenulovou projekcí —
      to se stává jen před prvním kolem sezóny.</p>`;

  const teams = Object.fromEntries(BOOT.teams.map(t => [t.id, t]));

  return `<table><thead><tr>
      <th>Hráč</th><th class="n">Cena</th><th class="n">${esc(ownLabel)}</th>
      <th class="n">Projekce ${DIFF_GWS} kol</th><th class="n">xGI/90</th>
      <th class="n">Minuty</th></tr></thead>
    <tbody>${rows.map(r => {
      const mine = MY_SQUAD && MY_SQUAD.has(r.p.id);
      const xgi = stat(r.p, 'expected_goal_involvements_per_90');
      return `<tr${mine ? ' class="me"' : ''}>
        <td><span class="who">${crest(r.p.team, 'sm')}<b>${esc(r.p.web_name)}</b>
          <em class="sub">${esc(teams[r.p.team].short_name)}</em>
          ${mine ? '<span class="badge dif">máš</span>' : ''}</span></td>
        <td class="n">${(r.p.now_cost / 10).toFixed(1)}m</td>
        <td class="n">${r.own.toFixed(1)} %</td>
        <td class="n"><b>${r.xp.toFixed(1)}</b></td>
        <td class="n">${xgi === null ? '–' : xgi.toFixed(2)}</td>
        <td class="n">${confLabel(r.conf)}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
}

function buildDifferentials(){
  const startGw = planStartGw();
  const gwPlayed = BOOT.events.filter(e => e.finished).length;

  // --- globální ---
  const g = diffRows(BOOT.elements, startGw,
    p => parseFloat(p.selected_by_percent) || 0, gwPlayed);

  let out = `<h3>Top 5 diferenciálů · celé FPL${info(`Hráči ${esc(g.tier.label)} s nejvyšší projekcí na příštích
      ${DIFF_GWS} kol.${g.tier.max > 12
        ? ' <b>Strop jsem musel povolit</b> — pod dvanácti procenty se pět jmen'
          + ' s rozumnou projekcí nenašlo.'
        : ''}`)}</h3>
    
    ${diffTable(g, 'Vlastní')}`;

  // --- v rámci miniligy ---
  out += '<h3>Top 5 diferenciálů · tvoje miniliga</h3>';

  if(!LEAGUE_OWN){
    out += `<p class="note">Sestavy soupeřů se zatím nenačetly, takže nevím,
      koho v lize kdo vlastní. Zkus <b>Načíst data znovu</b> v hlavičce.</p>`;
  }else{
    const {owners, n} = LEAGUE_OWN;
    const ownPct = p => ((owners[p.id] || []).length / n) * 100;

    /* V lize se strop měří v lidech, ne v procentech: nejdřív koho nemá
       nikdo, pak koho má jeden, pak dva. Procenta by u desetičlenné ligy
       skákala po deseti a stropy by neodpovídaly ničemu srozumitelnému. */
    const tiers = [0, 1, 2, 3].map(k => ({
      max: (k / n) * 100 + 0.01,
      label: k === 0 ? 'které nemá nikdo v lize'
           : k === 1 ? 'které má nejvýš jeden soupeř'
           : `které mají nejvýš ${k} lidi v lize`,
    }));
    tiers.push({max: 101, label: 'bez ohledu na vlastnictví v lize'});

    const l = diffRows(BOOT.elements, startGw, ownPct, gwPlayed, tiers);

    /* Druhá pětice: pod polovinou ligy.

       Ostré diferenciály (nikdo / jeden soupeř) jsou často hráči, které
       nikdo nemá z dobrého důvodu. Pod polovinou ligy je mírnější kategorie:
       pořád na nich proti půlce soupeřů získáváš, ale výběr je širší
       a jména známější. Jedno bez druhého dává zkreslený obrázek. */
    const half = [{max: 50 - 0.01, label: 'které má míň než polovina ligy'}];
    const h = diffRows(BOOT.elements, startGw, ownPct, gwPlayed, half);

    out += `<div class="subnav" role="tablist">
        <button class="sub-btn" role="tab" aria-selected="true" data-diff="0">Ostré</button>
        <button class="sub-btn" role="tab" aria-selected="false" data-diff="1">Pod polovinou ligy</button>
      </div>
      <div class="sec" id="diff-0">
        <p class="note">Hráči, ${esc(l.tier.label)} (${n} manažerů).
          Tady se pořadí láme nejvíc — na hráči, kterého má celá liga, proti ní
          nezískáš nic, i kdyby dal hattrick.</p>
        ${diffTable(l, 'V lize')}
      </div>
      <div class="sec" id="diff-1" hidden>
        <p class="note">Hráči, které má míň než polovina ligy. Mírnější
          kategorie — proti půlce soupeřů pořád získáváš, ale výběr je širší
          a rizika menší než u těch, které nemá nikdo.</p>
        ${diffTable(h, 'V lize')}
      </div>`;
  }

  out += `<p class="note">Řadím podle projekce dělené odmocninou vlastnictví
    a násobené jistotou minut. Odmocnina proto, že rozdíl mezi 2 % a 12 %
    znamená pro tvůj posun mnohem víc než mezi 40 % a 50 % — tam se s tebou
    hýbe skoro celé pole. Sloupec „Minuty“ říká, jak jistý je nástup:
    hráč s vysokou projekcí, který kolísá, je sázka, ne plán.
    Není to pokyn ke koupi, je to seznam, kde se dívat.</p>`;

  return out;
}

/* Přepínač mezi ostrými a mírnějšími ligovými diferenciály.
   Delegovaně, protože blok se překresluje s celou záložkou Transfery. */
document.addEventListener('click', ev => {
  const btn = ev.target.closest('button[data-diff]');
  if(!btn) return;
  const host = btn.closest('.diffs') || document;
  host.querySelectorAll('button[data-diff]').forEach(b =>
    b.setAttribute('aria-selected', String(b === btn)));
  host.querySelectorAll('[id^="diff-"]').forEach(sec => {
    sec.hidden = sec.id !== 'diff-' + btn.dataset.diff;
  });
});

/* ============================================================
   ZÁLOŽKA CENY

   Dřív to byla jedna ze čtyř sekcí v Programu a zapadalo to.
   Cena je přitom jediná věc v FPL, která se mění každou noc a na
   kterou se dá reagovat jen dopředu — zaslouží si vlastní místo.

   Tři pohledy:
     · kdo dnes v noci zdraží nebo zlevní (oficiální projekce),
     · komu se cena pohnula za poslední kolo (cost_change_event),
     · největší pohyb od začátku sezóny (cost_change_start).
   ============================================================ */

/* ------------------------------------------------------------
   WATCHLIST

   Sledovaní hráči jsou ti, které ještě nemám, ale chci vědět, kdy
   se jim pohne cena. Bez toho se na ně člověk musí každý den ptát
   ručně — a zdražení se pozná až podle toho, že už je pozdě.

   Držíme jen pole ID v localStorage pod klíčem s entry ID, takže
   po přepnutí týmu má každý svůj seznam. Žádný server, žádný účet.
   ------------------------------------------------------------ */
const WATCH_KEY = () => 'fpl_watch:' + (ENTRY_ID || '0');
let WATCH = null;

function loadWatch(){
  if(WATCH) return WATCH;
  try{
    const raw = JSON.parse(localStorage.getItem(WATCH_KEY()) || '[]');
    WATCH = new Set(Array.isArray(raw) ? raw.map(Number).filter(Number.isFinite) : []);
  }catch(e){ WATCH = new Set(); }
  return WATCH;
}

function saveWatch(){
  lsSet(WATCH_KEY(), JSON.stringify([...loadWatch()]));
}

function isWatched(id){ return loadWatch().has(Number(id)); }

function toggleWatch(id){
  const w = loadWatch();
  id = Number(id);
  if(w.has(id)) w.delete(id); else w.add(id);
  saveWatch();
  return w.has(id);
}

/* Hvězdička k libovolnému hráči. Obsluha je delegovaná, takže přežije
   překreslení tabulky. */
function watchStar(id){
  const on = isWatched(id);
  return `<button type="button" class="star${on ? ' on' : ''}" data-watch="${id}"
    aria-pressed="${on}" title="${on ? 'Odebrat ze sledovaných' : 'Sledovat hráče'}"
    aria-label="${on ? 'Odebrat ze sledovaných' : 'Sledovat hráče'}">${on ? '★' : '☆'}</button>`;
}

/* Stav sledovaného hráče v jedné větě — to samé, co potřebuje homepage. */
function watchRows(){
  const teams = Object.fromEntries(BOOT.teams.map(t => [t.id, t]));
  const projFor = (p, offset) =>
    (p.price_change_projections || []).find(x => x.offset === offset) || null;

  return [...loadWatch()]
    .map(id => BOOT.elements.find(p => p.id === id))
    .filter(Boolean)
    .map(p => {
      const today = projFor(p, 0);
      const pct = parseFloat(p.price_change_percent);
      const like = today ? (today.likelihood || 0) : 0;
      return {p, team: teams[p.team], like,
              pct: Number.isFinite(pct) ? pct : 0,
              chance: p.chance_of_playing_next_round};
    })
    .sort((a, b) => Math.abs(b.like) - Math.abs(a.like)
                 || Math.abs(b.pct) - Math.abs(a.pct));
}

function buildWatch(){
  const rows = watchRows();

  /* Přidávat jde ze seznamu všech hráčů seřazených podle bodů — stejný
     vzor jako u porovnání dvou hráčů, jen bez druhého selectu. */
  const opts = BOOT.elements
    .slice()
    .sort((a, b) => b.total_points - a.total_points)
    .map(p => `<option value="${p.id}">${POS[p.element_type]} · ${esc(p.web_name)} · ${
      esc(BOOT.teams.find(t => t.id === p.team).short_name)} · ${
      (p.now_cost / 10).toFixed(1)}m</option>`).join('');

  const adder = `<div class="watchadd">
    <label>Přidat hráče
      <input type="search" id="wq" placeholder="Hledej podle jména…" autocomplete="off"
             role="combobox" aria-expanded="false" aria-controls="wsug"
             aria-autocomplete="list">
      <div class="wsug" id="wsug" role="listbox" hidden></div>
    </label>
    <label>Nebo vyber ze seznamu
      <select id="wsel"><option value="">Vyber hráče…</option>${opts}</select>
    </label>
  </div>`;

  if(!rows.length) return `<h3>Watchlist</h3>${adder}
    <p class="note">Zatím nikoho nesleduješ. Přidej hráče výš, nebo klikni na
    hvězdičku u kohokoli v tabulkách pohybů cen — pak se ti tady i na úvodní
    stránce ukáže, jak blízko je jeho cena ke změně.</p>
    ${storageNote('Watchlist')}`;

  const dirClass = l => l > 0 ? 'up' : l < 0 ? 'down' : '';
  const stateText = r => {
    if(r.p.status === 'i') return ['al', 'zraněný'];
    if(r.p.status === 's') return ['al', 'suspendovaný'];
    if(r.p.status === 'u' || r.p.status === 'n') return ['al', 'nedostupný'];
    if(r.chance !== null && r.chance < 100) return ['wn', r.chance + ' %'];
    return ['ok', 'v pořádku'];
  };

  return `<h3>Watchlist${info(`Hráči, které sleduješ. Ukazatel je naplněnost
    cenového měřidla podle FPL, sloupec „Dnes v noci“ říká, jak jistý je
    pohyb ceny při nejbližší změně.`)}</h3>
    ${adder}
    <table><thead><tr><th></th><th>Hráč</th><th class="n">Cena</th>
      <th>Ukazatel</th><th>Dnes v noci</th><th class="hide-s">Stav</th></tr></thead>
    <tbody>${rows.map(r => {
      const [cls, txt] = stateText(r);
      return `<tr${MY_SQUAD && MY_SQUAD.has(r.p.id) ? ' class="me"' : ''}>
        <td>${watchStar(r.p.id)}</td>
        <td>${esc(r.p.web_name)}<span class="sub">${esc(r.team.short_name)}</span></td>
        <td class="n">${(r.p.now_cost / 10).toFixed(1)}m</td>
        <td>${priceMeter(r.pct, dirClass(r.like) || 'up')}<span class="sub">${
          r.pct.toFixed(0)} %</span></td>
        <td>${likeChip(r.like, 'dnes v noci')}</td>
        <td class="hide-s ${cls}">${txt}</td>
      </tr>`;
    }).join('')}</tbody></table>
    <p class="note">Zvýrazněné řádky jsou hráči, které už máš v kádru.</p>
    ${storageNote('Watchlist')}`;
}

/* Jedna delegovaná obsluha pro všechny hvězdičky v appce. */
document.addEventListener('click', ev => {
  const btn = ev.target.closest('button[data-watch]');
  if(!btn) return;
  const on = toggleWatch(btn.dataset.watch);

  // Překreslíme všechny hvězdičky téhož hráče, ne jen tu kliknutou —
  // stejný hráč bývá zároveň v tabulce pohybů i ve watchlistu.
  document.querySelectorAll(`button[data-watch="${btn.dataset.watch}"]`)
    .forEach(b => {
      b.textContent = on ? '★' : '☆';
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });

  const sec = $('pr-3');
  if(sec && !sec.hidden) sec.innerHTML = buildWatch(), wireWatch();

  /* Ve Zraněních může hvězdička řádek rovnou vyhodit ze seznamu
     (zobrazení Sledovaní), takže tabulku překreslíme celou. */
  if($('p-inj') && !$('p-inj').hidden && $('injtbl')) drawInj();

  drawHome();
});

/* Vyhledávání a select pro přidání do watchlistu. */
/* Nabídka jmen pod vyhledávacím polem.

   Dřív se hráč přidával rovnou při psaní: po třetím znaku se vzal
   nejlepší shoda a strčila do watchlistu. Kdo hledal Fernandese, dostal
   po napsání „fer“ Wieffera a ani se ho nikdo nezeptal.

   Teď se shody jen nabídnou. Přidá se ta, na kterou člověk klikne nebo
   kterou potvrdí Enterem — a dokud nepotvrdí, nestane se nic. */
function watchMatches(text){
  const needle = normName(text || '');
  if(needle.length < 2) return [];

  return BOOT.elements
    .map(p => {
      const jmeno = normName(p.web_name);
      const cele = normName(p.first_name + ' ' + p.second_name);
      // Shoda na začátku jména je skoro vždycky ta hledaná; shoda
      // uprostřed („fer“ ve „Wieffer“) je až poslední možnost.
      const rank = jmeno.startsWith(needle) ? 0
        : cele.split(' ').some(w => w.startsWith(needle)) ? 1
        : (jmeno + ' ' + cele).includes(needle) ? 2 : null;
      return rank === null ? null : {p, rank};
    })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank || b.p.total_points - a.p.total_points)
    .slice(0, 8);
}

function watchRedraw(){
  const sec = $('pr-3');
  if(sec) sec.innerHTML = buildWatch();
  else if($('watchbox')) $('watchbox').innerHTML = buildWatch();
  wireWatch();
  drawHome();
}

function wireWatch(){
  const q = $('wq'), sel = $('wsel'), sug = $('wsug');

  if(sel) sel.addEventListener('change', () => {
    if(!sel.value) return;
    toggleWatch(sel.value);
    watchRedraw();
  });

  if(!q || !sug) return;

  let vyber = -1;   // index zvýrazněné nabídky pro ovládání klávesnicí

  const zavri = () => {
    sug.hidden = true;
    sug.innerHTML = '';
    q.setAttribute('aria-expanded', 'false');
    vyber = -1;
  };

  const kresli = () => {
    const hits = watchMatches(q.value).filter(h => !isWatched(h.p.id));
    if(!hits.length){ zavri(); return; }

    const teams = Object.fromEntries(BOOT.teams.map(t => [t.id, t]));
    sug.innerHTML = hits.map((h, i) => `<button type="button" role="option"
      aria-selected="${i === vyber}" data-add="${h.p.id}">
      <b>${esc(h.p.web_name)}</b>
      <span>${esc((teams[h.p.team] || {}).short_name || '')} ·
        ${POS[h.p.element_type]} · ${(h.p.now_cost / 10).toFixed(1)}m</span>
    </button>`).join('');
    sug.hidden = false;
    q.setAttribute('aria-expanded', 'true');
  };

  q.addEventListener('input', () => { vyber = -1; kresli(); });

  q.addEventListener('keydown', ev => {
    const opts = [...sug.querySelectorAll('button[data-add]')];
    if(ev.key === 'Escape'){ zavri(); return; }
    if(!opts.length) return;

    if(ev.key === 'ArrowDown' || ev.key === 'ArrowUp'){
      ev.preventDefault();
      vyber = ev.key === 'ArrowDown'
        ? (vyber + 1) % opts.length
        : (vyber - 1 + opts.length) % opts.length;
      opts.forEach((b, i) => b.setAttribute('aria-selected', String(i === vyber)));
      return;
    }

    /* Enter bez vybrané nabídky bere první — ale jen když člověk
       opravdu zmáčkl Enter. Samo se nikdy nic nepřidá. */
    if(ev.key === 'Enter'){
      ev.preventDefault();
      const b = opts[vyber >= 0 ? vyber : 0];
      if(b){ toggleWatch(b.dataset.add); watchRedraw(); }
    }
  });

  sug.addEventListener('click', ev => {
    const b = ev.target.closest('button[data-add]');
    if(!b) return;
    toggleWatch(b.dataset.add);
    watchRedraw();
  });

  q.addEventListener('blur', () => setTimeout(zavri, 150));
}

/* Hráči, kterým se cena pohnula za poslední kolo.
   cost_change_event je v desetinách milionu a resetuje se s kolem. */
function recentMovers(){
  const moved = BOOT.elements
    .filter(p => (p.cost_change_event || 0) !== 0)
    .sort((a, b) => Math.abs(b.cost_change_event) - Math.abs(a.cost_change_event)
                 || parseFloat(b.selected_by_percent) - parseFloat(a.selected_by_percent));
  return {
    up: moved.filter(p => p.cost_change_event > 0),
    down: moved.filter(p => p.cost_change_event < 0),
  };
}

function movedTable(list, dir, empty){
  if(!list.length) return `<p class="note">${empty}</p>`;
  const teams = Object.fromEntries(BOOT.teams.map(t => [t.id, t]));
  return `<table><thead><tr><th>Hráč</th><th class="n">Cena teď</th>
      <th class="n">Změna</th><th class="n">Vlastní</th></tr></thead>
    <tbody>${list.slice(0, 25).map(p => {
      const d = p.cost_change_event / 10;
      return `<tr${MY_SQUAD && MY_SQUAD.has(p.id) ? ' class="me"' : ''}>
        <td><span class="who">${crest(p.team, 'sm')}<b>${esc(p.web_name)}</b>
          <em class="sub">${esc(teams[p.team].short_name)}</em></span></td>
        <td class="n">${(p.now_cost / 10).toFixed(1)}m</td>
        <td class="n ${dir}">${d > 0 ? '+' : ''}${d.toFixed(1)}m</td>
        <td class="n">${parseFloat(p.selected_by_percent).toFixed(1)} %</td>
      </tr>`;
    }).join('')}</tbody></table>`;
}

function buildMoved(){
  const mv = recentMovers();
  return `<h3>Zdražili</h3>
    ${movedTable(mv.up, 'up', 'Za poslední kolo nikdo nezdražil.')}
    <h3>Zlevnili${info(`Změna je za <b>poslední kolo</b> (<code>cost_change_event</code>),
      ne za celou sezónu. Zvýrazněné řádky jsou hráči z tvé sestavy — u těch,
      kteří zlevnili, ti klesá hodnota týmu.`)}</h3>
    ${movedTable(mv.down, 'down', 'Za poslední kolo nikdo nezlevnil.')}
    `;
}

function buildSeason(){
  const teams = Object.fromEntries(BOOT.teams.map(t => [t.id, t]));

  /* Dřív se bralo prvních a posledních patnáct z jednoho seřazeného
     seznamu. Dokud se hýbalo míň než třicet cen, obě tabulky si sáhly
     do stejné hromádky a v „růstu“ pak seděli hráči, kteří zlevnili —
     jen proto, že klesli nejmíň.

     Každá tabulka si proto filtruje po svém. Když hráčů není deset,
     zbytek zůstane prázdný: prázdný řádek je poctivější než cizí. */
  const TOP = 10;
  const rostli = BOOT.elements
    .filter(p => (p.cost_change_start || 0) > 0)
    .sort((a, b) => b.cost_change_start - a.cost_change_start)
    .slice(0, TOP);
  const padali = BOOT.elements
    .filter(p => (p.cost_change_start || 0) < 0)
    .sort((a, b) => a.cost_change_start - b.cost_change_start)
    .slice(0, TOP);

  const prazdny = `<tr class="empty"><td colspan="4">—</td></tr>`;

  const tbl = list => `<table><thead><tr><th>Hráč</th><th class="n">Start</th>
      <th class="n">Teď</th><th class="n">Změna</th></tr></thead>
    <tbody>${list.map(p => {
      const d = p.cost_change_start / 10;
      return `<tr${MY_SQUAD && MY_SQUAD.has(p.id) ? ' class="me"' : ''}>
        <td><span class="who">${crest(p.team, 'sm')}<b>${esc(p.web_name)}</b>
          <em class="sub">${esc(teams[p.team].short_name)}</em></span></td>
        <td class="n">${((p.now_cost - p.cost_change_start) / 10).toFixed(1)}m</td>
        <td class="n">${(p.now_cost / 10).toFixed(1)}m</td>
        <td class="n ${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : ''}${d.toFixed(1)}m</td>
      </tr>`;
    }).join('') + prazdny.repeat(Math.max(0, TOP - list.length))}</tbody></table>`;

  if(!rostli.length && !padali.length)
    return '<p class="note">Od začátku sezóny se zatím žádná cena nepohnula.</p>';

  return `<h3>Největší růst</h3>${tbl(rostli)}
    <h3>Největší propad${info(`Růst hodnoty týmu je dlouhá hra: každé zdražení hráče,
      kterého držíš, ti přidá 0,1m do rozpočtu — ale při prodeji dostaneš
      zpátky jen polovinu zisku.`)}</h3>${tbl(padali)}
    `;
}

async function loadPrices(){
  $('prmsg').textContent = 'Načítám…';
  $('prout').innerHTML = '<div class="skel"><i></i><i></i><i></i><i></i></div>';
  try{
    if(!BOOT) BOOT = await api('bootstrap-static/');

    const SECTIONS = [
      ['Dnes v noci', buildPrices()],
      ['Změnili za kolo', buildMoved()],
      ['Za sezónu', buildSeason()],
      ['Watchlist', buildWatch()],
    ];

    $('prout').innerHTML = `
      <div class="subnav" role="tablist">
        ${SECTIONS.map((x, i) =>
          `<button class="sub-btn" role="tab" aria-selected="${i === 0}" data-sec="${i}">${esc(x[0])}</button>`
        ).join('')}
      </div>
      ${SECTIONS.map((x, i) =>
        `<div class="sec" id="pr-${i}"${i ? ' hidden' : ''}>${x[1]}</div>`
      ).join('')}`;

    $('prout').querySelectorAll('.sub-btn').forEach(b => {
      b.addEventListener('click', () => {
        $('prout').querySelectorAll('.sub-btn').forEach(x =>
          x.setAttribute('aria-selected', x === b));
        SECTIONS.forEach((_, i) => { $('pr-' + i).hidden = String(i) !== b.dataset.sec; });
      });
    });
    wireWatch();
    $('prmsg').textContent = '';
  }catch(e){
    $('prmsg').innerHTML = errBox(e.message, 't-prices');
    $('prout').innerHTML = '';
  }
}

/* ============================================================
   MĚSÍČNÍ TABULKY MINILIGY

   Bootstrap posílá `phases[]` — Overall a pak jednotlivé měsíce
   s rozsahem kol. Standings endpoint na ně umí filtrovat přes
   ?phase=N.

   Proč to stojí za to: v lize, kterou někdo vede o dvě stě bodů,
   dá měsíční pořadí ostatním důvod hrát dál. Implementačně je to
   jeden dotaz navíc.
   ============================================================ */
function mountPhases(leagueId, cur, myId){
  const box = $('phasebox');
  if(!box || !BOOT.phases) return;

  // Overall (id 1) přeskakujeme — to je tabulka v sekci Pořadí.
  // A měsíce, které ještě nezačaly, taky: prázdná tabulka nikomu nepomůže.
  const done = (BOOT.phases || []).filter(ph =>
    ph.id !== 1 && cur && ph.start_event <= cur.id);

  if(!done.length){
    box.innerHTML = '<p class="note">Měsíční tabulky se objeví po prvním dohraném měsíci.</p>';
    return;
  }

  const cache = {};
  const draw = async (ph) => {
    box.innerHTML = nav(ph.id)
      + '<div class="skel"><i></i><i></i><i></i><i></i></div>';

    try{
      if(!cache[ph.id])
        cache[ph.id] = await cached(
          'leagues-classic/' + leagueId + '/standings/?phase=' + ph.id);

      const rows = ((cache[ph.id].standings || {}).results || []);
      box.innerHTML = nav(ph.id) + (rows.length
        ? `<table><thead><tr><th class="n">#</th><th>Manažer</th>
             <th class="hide-s">Tým</th><th class="n">Body za měsíc</th></tr></thead>
           <tbody>${rows.map(m => `<tr${m.entry === myId ? ' class="me"' : ''}>
             <td class="n">${m.rank}</td>
             <td><b>${esc(m.player_name)}</b></td>
             <td class="hide-s" style="color:var(--mute)">${esc(m.entry_name)}</td>
             <td class="n">${m.total}</td></tr>`).join('')}</tbody></table>
           <p class="note">${esc(ph.name)} = kola ${ph.start_event}–${ph.stop_event}.
             Body jsou jen za tenhle úsek, ne od začátku sezóny.</p>`
        : '<p class="note">Pro tenhle měsíc zatím žádná data nejsou.</p>');
    }catch(e){
      box.innerHTML = nav(ph.id)
        + `<p class="note">Měsíční tabulku se nepodařilo načíst: ${esc(e.message)}</p>`;
    }
    bind();
  };

  const nav = sel => `<div class="phasenav" role="tablist">${done.map(ph =>
    `<button class="sub-btn" role="tab" aria-selected="${ph.id === sel}"
      data-ph="${ph.id}">${esc(ph.name)}</button>`).join('')}</div>`;

  const bind = () => box.querySelectorAll('button[data-ph]').forEach(b =>
    b.addEventListener('click', () =>
      draw(done.find(x => x.id === Number(b.dataset.ph)))));

  draw(done[done.length - 1]);   // výchozí je poslední rozehraný měsíc
}

/* ============================================================
   ZRANĚNÍ

   Vlastní záložka pro jedinou otázku, kterou si člověk klade
   nejčastěji před deadlinem: kdo z mých hráčů je pod otazníkem
   a koho z ostatních to sundalo.

   Data jsou celá v bootstrapu (status, chance_of_playing_next_round,
   news) — žádný dotaz navíc, takže záložka není v TAB_INIT a kreslí
   se z toho, co už appka má.

   Stav (které zobrazení, hledaný text, řazení) drží INJ. Vstupní
   pole se překresluje jen jednou při otevření záložky; při psaní se
   mění pouze tabulka, jinak by po každém písmenu utekl kurzor.
   ============================================================ */
const INJ_VIEWS = [['all', 'Celá liga'], ['squad', 'Můj kádr'],
                   ['watch', 'Sledovaní']];

let INJ = {view: 'all', q: '', key: 'chance', dir: 1};

/* Řádky pro tabulku. Bereme jen hráče, u kterých je co říct:
   nehrající status nebo šance pod 100 %. Hráč se stoprocentní
   šancí a poznámkou „returned from injury“ do seznamu zraněných
   nepatří — ten je zdravý. */
function injAll(){
  if(!BOOT) return [];
  const teams = Object.fromEntries(BOOT.teams.map(t => [t.id, t]));

  return BOOT.elements
    .filter(p => p.status !== 'a'
      || (p.chance_of_playing_next_round !== null
          && p.chance_of_playing_next_round < 100))
    .map(p => {
      const chance = p.chance_of_playing_next_round === null
        ? (p.status === 'a' ? 100 : 0) : p.chance_of_playing_next_round;
      // „Ankle injury - Expected back 14 Sep“ → 14 Sep
      const m = /expected back\s*[:\-]?\s*([^.(]+)/i.exec(p.news || '');
      return {p, team: teams[p.team] || {short_name: '?', name: '?'},
              chance,
              own: parseFloat(p.selected_by_percent) || 0,
              back: m ? m[1].trim() : '',
              mine: !!(MY_SQUAD && MY_SQUAD.has(p.id))};
    });
}

function injFiltered(){
  const rows = injAll().filter(r =>
    INJ.view === 'all' ? true
    : INJ.view === 'watch' ? isWatched(r.p.id)
    : r.mine);

  const needle = normName(INJ.q || '');
  const hit = needle
    ? rows.filter(r => normName(r.p.web_name + ' ' + r.p.second_name
        + ' ' + r.team.short_name + ' ' + r.team.name).includes(needle))
    : rows;

  const dir = INJ.dir;
  const cmp = {
    name:   (a, b) => a.p.web_name.localeCompare(b.p.web_name, 'cs'),
    team:   (a, b) => a.team.short_name.localeCompare(b.team.short_name),
    own:    (a, b) => a.own - b.own,
    chance: (a, b) => a.chance - b.chance,
  }[INJ.key] || ((a, b) => a.chance - b.chance);

  // Sekundární klíč je vždycky vlastnictví: při shodě šance je
  // zajímavější ten, koho má půlka ligy.
  return hit.sort((a, b) => (cmp(a, b) * dir) || (b.own - a.own));
}

function injTable(){
  const rows = injFiltered();

  if(!rows.length){
    const proc = INJ.q ? 'Hledání nic nenašlo.'
      : INJ.view === 'squad' ? 'Nikdo z tvého kádru není hlášený. Zatím.'
      : INJ.view === 'watch' ? 'Ze sledovaných hráčů nikoho nic netrápí.'
      : 'V celé lize není nikdo hlášený — to se stává jen v létě.';
    return `<p class="note">${esc(proc)}</p>`;
  }

  const th = (key, text, cls) =>
    `<th class="${cls || ''} sortable" data-sort="${key}"
      aria-sort="${INJ.key === key ? (INJ.dir === 1 ? 'ascending' : 'descending') : 'none'}"
      >${esc(text)}${INJ.key === key ? (INJ.dir === 1 ? ' ▲' : ' ▼') : ''}</th>`;

  return `<table>
    <thead><tr>
      <th></th>
      ${th('name', 'Hráč')}
      ${th('team', 'Tým', 'hide-s')}
      <th>Poz</th>
      ${th('own', 'Vlastní %', 'n hide-s')}
      ${th('chance', 'Šance', 'n')}
      <th>Stav</th>
      <th class="hide-s">Zpráva</th>
    </tr></thead>
    <tbody>${rows.map(r => `<tr${r.mine ? ' class="me"' : ''}>
      <td>${watchStar(r.p.id)}</td>
      <td><b>${esc(r.p.web_name)}</b>${r.back
        ? `<span class="injback">zpět ${esc(r.back)}</span>` : ''}</td>
      <td class="hide-s">${esc(r.team.short_name)}</td>
      <td>${POS[r.p.element_type]}</td>
      <td class="n hide-s">${r.own.toFixed(1)}</td>
      <td class="n ${r.chance === 0 ? 'al' : r.chance < 100 ? 'wn' : 'ok'}">${r.chance} %</td>
      <td class="st ${(S[r.p.status] || S.u)[1]}">${(S[r.p.status] || S.u)[0]}</td>
      <td class="hide-s" style="color:var(--mute);font-size:12.5px">${esc(r.p.news || '—')}</td>
    </tr>`).join('')}</tbody></table>
    <p class="note">Zvýrazněné řádky jsou hráči z tvého kádru. Hvězdičkou
      si kohokoli přidáš mezi sledované — objeví se pak i na Přehledu
      a v Cenách.</p>`;
}

/* Souhrn nad tabulkou: kolik z kádru je mimo a kolik pod otazníkem.
   Tohle je ta věta, kvůli které sem člověk chodí. */
function injSummary(){
  const mine = injAll().filter(r => r.mine);
  const out = mine.filter(r => r.chance === 0).length;
  const dbt = mine.filter(r => r.chance > 0 && r.chance < 100).length;

  if(!MY_SQUAD) return '<p class="note">Zadej ID týmu a uvidíš i svůj kádr.</p>';
  if(!mine.length) return `<p class="note ok">Tvůj kádr je čistý — nikdo hlášený.</p>`;

  return `<p class="note ${out ? 'wn' : ''}">Z tvého kádru ${
    out ? `<b>${out}</b> ${out === 1 ? 'nehraje' : out < 5 ? 'nehrají' : 'nehraje'}` : 'nikdo nechybí'
  }${dbt ? ` a <b>${dbt}</b> pod otazníkem` : ''}.</p>`;
}

function drawInj(){
  const box = $('injtbl');
  if(box) box.innerHTML = injTable();
  const sum = $('injsum');
  if(sum) sum.innerHTML = injSummary();
}

function loadInjuries(){
  const out = $('injout');
  if(!out) return;

  if(!BOOT){
    $('injmsg').textContent = 'Data se ještě načítají. Zkus to za chvilku.';
    return;
  }
  $('injmsg').textContent = '';

  out.innerHTML = `
    <div class="subnav" role="tablist">
      ${INJ_VIEWS.map(([k, t]) =>
        `<button class="sub-btn" role="tab" aria-selected="${k === INJ.view}"
          data-inj="${k}">${esc(t)}</button>`).join('')}
    </div>
    <div id="injsum"></div>
    <input type="search" id="injq" class="injq" placeholder="Hledej hráče nebo tým…"
      aria-label="Hledat hráče nebo tým" value="${esc(INJ.q)}">
    <div id="injtbl"></div>`;

  out.querySelectorAll('button[data-inj]').forEach(b =>
    b.addEventListener('click', () => {
      INJ.view = b.dataset.inj;
      out.querySelectorAll('button[data-inj]').forEach(x =>
        x.setAttribute('aria-selected', String(x === b)));
      drawInj();
    }));

  $('injq').addEventListener('input', ev => {
    INJ.q = ev.target.value;
    drawInj();
  });

  /* Řazení je delegované — hlavičky se překreslují s tabulkou. */
  $('injtbl').addEventListener('click', ev => {
    const th = ev.target.closest('th[data-sort]');
    if(!th) return;
    const key = th.dataset.sort;
    // Druhé kliknutí na tentýž sloupec otočí směr.
    if(INJ.key === key) INJ.dir = -INJ.dir;
    else { INJ.key = key; INJ.dir = key === 'own' ? -1 : 1; }
    drawInj();
  });

  drawInj();
}
/* Úklid stavu, který patří téhle sekci. Registruje se u proměnných,
   kterých se týká — viz VOLATILE v js/core.js. */
volatile('tabs', () => {
  LEAGUE_OWN = null;
  TR_STATE = null;
  BUY_COST = null;

  // Zpravodaj a novinky po kole.
  NEWS_GW = null;
  NEWS_PICKS.clear();
  NEWS_LIVE.clear();
  HALL_ALL = false;
});
