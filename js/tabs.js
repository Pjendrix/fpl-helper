/* Minileague Squad Check — nejlehčí los a Top hráči

   První ze skupiny js/tabs*.js. Ta byla do verze 2.0 jedním souborem
   o 4 200 řádcích a osmi nesouvisejících sekcích; rozdělení je čistě
   mechanické — žádný kód se nepřepisoval, jen přestěhoval. Pořadí
   načítání se nemění, takže se nemění ani chování.

   Kde co je:
     tabs.js         nejlehčí los, Top hráči
     tabs-players.js transfery, detail hráče
     tabs-hub.js     Hub ligy: novinky, žebříčky, zdraví, celá liga
     tabs-prices.js  ceny kola, Program, záložka Ceny, watchlist
     tabs-league.js  historie miniligy, diferenciály, měsíce, zranění

   Soubory js/ se načítají jako klasické <script> v pevném pořadí a
   sdílejí jeden globální scope: nic se neexportuje ani neimportuje,
   ale hoisting přes hranici souboru neplatí. Pořadí je proto součást
   kontraktu a je vypsané v index.html.
   ============================================================ */
/* ============================================================
   NEJLEHČÍ LOS

   Nahrazuje doporučení kapitána podle xP. Důvod: `ep_next` od FPL je
   zaokrouhlené na desetinu a u špičkových hráčů vychází skoro stejně
   (Haaland 4.0, Fernandes 4.0), takže z něj pořadí prostě nevznikne —
   appka pak vážně tvrdila „jsou nerozeznatelní“ a byla k ničemu.

   Tenhle blok nic nedoporučuje. Ukáže dva týmy s nejlehčím losem
   v příštím kole, proti komu hrají, spočtenou obtížnost — a koho z těch
   týmů máš v kádru. Rozhodnutí necháme na tobě; tohle je podklad.
   ============================================================ */

/* Obtížnost týmu v daném kole. Double kolo bereme jako průměr obou
   zápasů: dva středně těžké zápasy jsou pro kapitána často lepší než
   jeden lehký, ale nechceme, aby to přebilo skutečně lehký los. */
function teamGwFdr(teamId, gw){
  // gwFixtures vrací už rozbalené {opp, home, d}, ne syrové zápasy.
  const fx = gwFixtures(teamId, gw);
  if(!fx.length) return null;
  const vals = fx.map(f => ownFdr(teamId, f.opp, f.home, f.d));
  return {
    fdr: vals.reduce((a, b) => a + b, 0) / vals.length,
    fixtures: fx,
  };
}

/* Řádek „tým vs soupeř“ s odznaky a barevnou obtížností. */
function fixtureLine(teamId, info){
  const teams = Object.fromEntries(BOOT.teams.map(t => [t.id, t]));
  return info.fixtures.map(f => `<span class="fxpair">
      ${crest(teamId, 'sm')}<b>${esc(teams[teamId].short_name)}</b>
      <span class="vs">${f.home ? 'doma s' : 'venku na'}</span>
      ${crest(f.opp, 'sm')}<b>${esc(teams[f.opp].short_name)}</b>
    </span>`).join('<span class="amp">a</span>');
}

function easiestFixtures(squad, startGw){
  const teams = Object.fromEntries(BOOT.teams.map(t => [t.id, t]));

  const ranked = BOOT.teams
    .map(t => ({t, ...(teamGwFdr(t.id, startGw) || {})}))
    .filter(x => Number.isFinite(x.fdr))
    .sort((a, b) => a.fdr - b.fdr)
    .slice(0, 2);

  if(!ranked.length)
    return '<p class="note">Rozpis na příští kolo zatím není k dispozici.</p>';

  const cards = ranked.map((x, i) => {
    const mine = squad.filter(s => s.p.team === x.t.id)
      .sort((a, b) => b.p.now_cost - a.p.now_cost);

    return `<div class="easy">
      <div class="easyhead">
        <span class="rk">${i + 1}.</span>
        <span class="fx">${fixtureLine(x.t.id, x)}</span>
        <span class="fdr ${fdrClass(x.fdr)}">${x.fdr.toFixed(1)}</span>
      </div>
      ${mine.length
        ? `<div class="easymine">${mine.map(s => `<span class="pl">
             <b>${esc(s.p.web_name)}</b>
             <em>${(s.p.now_cost / 10).toFixed(1)}m</em>
             ${s.starting ? '' : '<u>lavička</u>'}
           </span>`).join('')}</div>`
        : '<p class="easynone">Z tohohle týmu nemáš nikoho.</p>'}
    </div>`;
  }).join('');

  return `<h2>Nejlehčí los na GW${startGw}${info(`Dva týmy, které mají v příštím kole nejlehčí zápas.
      Obtížnost počítám ze síly obou týmů, ne z pevného FDR od FPL, a rozlišuju
      domácí zápas od venkovního. U dvojitého kola beru průměr obou zápasů.
      <b>Není to doporučení na kapitána</b> — lehký los sám o sobě body nedělá.
      Je to podklad: tohle jsou týmy, kde se dá čekat, že se bude hrát na jednu
      branku.`)}</h2>
    <div class="easygrid">${cards}</div>
    `;
}

/* Tři nejdražší hráči v kádru a co je čeká.

   Nejdražší hráči jsou ti, na kterých sezóna stojí — a taky ti, u kterých
   se nejvíc vyplatí vědět, jestli je čeká lehký nebo těžký zápas. */
function topPriceBlock(squad, startGw){
  const teams = Object.fromEntries(BOOT.teams.map(t => [t.id, t]));
  const top = [...squad]
    .sort((a, b) => b.p.now_cost - a.p.now_cost)
    .slice(0, 3);

  if(!top.length) return '';

  return `<h2>Tvoji tři nejdražší${info(`Nejdražší hráči v kádru a co je čeká v GW${startGw}.
      Číslo vpravo je obtížnost zápasu na stupnici 1–5.`)}</h2>
    <div class="pricetop">${top.map(s => {
      const info = teamGwFdr(s.p.team, startGw);
      return `<div class="ptrow">
        <span class="who">${crest(s.p.team, 'sm')}
          <b>${esc(s.p.web_name)}</b>
          <em class="sub">${esc(teams[s.p.team].short_name)}</em></span>
        <span class="cost">${(s.p.now_cost / 10).toFixed(1)}m</span>
        <span class="fx">${info
          ? fixtureLine(s.p.team, info)
          : '<span class="blankfx">volné kolo</span>'}</span>
        <span class="fdr ${info ? fdrClass(info.fdr) : 'blank'}">${
          info ? info.fdr.toFixed(1) : '–'}</span>
      </div>`;
    }).join('')}</div>
    `;
}

/* ============================================================
   TOP HRÁČI

   Dřív to byla filtrovatelná tabulka všech ~700 hráčů. Fungovala,
   ale odpovídala na otázku „najdi mi konkrétního hráče“ — a tu si
   člověk položí zřídka. Častější je „kdo je letos nejlepší v X“,
   a na to se z jedné dlouhé tabulky odpovídalo řazením a klikáním.

   Teď jsou to žebříčky: každá kategorie jeden box, top 10 v každém.
   Pod nimi porovnání dvou libovolných hráčů vedle sebe.
   ============================================================ */

/* Kategorie: [klíč, nadpis, popisek, formát čísla, povolené pozice].

   Pole se čtou přes stat(), takže když je FPL v dané sezóně neposílá,
   box to řekne místo aby ukazoval samé nuly. */
/* Řádek 1: body podle pozice. Nejčastější otázka na začátku sezóny
   nezní „kdo dal nejvíc gólů“, ale „kdo je letos nejlepší záložník“ —
   a na tu se z gólové tabulky odpovídá špatně, protože obránce
   s pěti čistými konty v ní vůbec není. */
const TOP_POINTS = [
  ['total_points', 'Brankáři', 'nejvíc bodů za sezónu', v => v, [1]],
  ['total_points', 'Obránci', 'nejvíc bodů za sezónu', v => v, [2]],
  ['total_points', 'Záložníci', 'nejvíc bodů za sezónu', v => v, [3]],
  ['total_points', 'Útočníci', 'nejvíc bodů za sezónu', v => v, [4]],
];

/* Řádky 2 a 3: osm kategorií, mřížka je čtyřsloupcová, takže se
   zalomí přesně na čtyři a čtyři. Pořadí není náhodné — nahoře to,
   co se opravdu stalo, dole očekávané hodnoty. */
const TOP_FIELD = [
  ['goals_scored', 'Góly', 'branky za sezónu', v => v, null],
  ['assists', 'Asistence', 'nahrávky na gól', v => v, null],
  ['defensive_contribution', 'DEFCON',
    'defenzivní příspěvky · 2 body za práh', v => v, null],
  ['bonus', 'Bonusy', 'bonusové body z BPS', v => v, null],
  ['expected_goals', 'xG', 'očekávané góly z kvality šancí',
    v => v.toFixed(2), null],
  ['expected_assists', 'xA', 'očekávané asistence',
    v => v.toFixed(2), null],
  ['expected_goal_involvements', 'xGI', 'xG a xA dohromady',
    v => v.toFixed(2), null],
  ['expected_goal_involvements_per_90', 'xGI / 90',
    'očekávané zapojení na 90 minut', v => v.toFixed(2), null],
];

const TOP_GK = [
  ['clean_sheets', 'Čistá konta', 'zápasy bez inkasovaného gólu', v => v, [1]],
  ['saves', 'Zákroky', 'bod za každé tři', v => v, [1]],
  ['saves_per_90', 'Zákroky / 90', 'vytíženost brankáře', v => v.toFixed(2), [1]],
  ['bonus', 'Bonusy brankářů', 'bonusové body z BPS', v => v, [1]],
];

/* Jeden žebříček. `types` omezí pozice — brankářské kategorie nemá smysl
   počítat přes hráče v poli a góly zase přes brankáře. */
function topBoard([key, title, cap, fmt, types]){
  const teams = Object.fromEntries(BOOT.teams.map(t => [t.id, t]));

  const pool = BOOT.elements.filter(p => {
    if(types) return types.includes(p.element_type) && stat(p, key) !== null;
    return p.element_type !== 1 && stat(p, key) !== null;
  });

  const rows = pool
    .map(p => ({p, v: stat(p, key)}))
    .filter(x => x.v > 0)
    .sort((a, b) => b.v - a.v || b.p.total_points - a.p.total_points)
    .slice(0, 10);

  if(!rows.length)
    return `<div class="tbox">
      <h4>${esc(title)}</h4><p class="cap">${esc(cap)}</p>
      <p class="tempty">Tuhle statistiku FPL zatím neposílá, nebo ji nikdo
        nemá nenulovou.</p></div>`;

  /* Trofej u prvních tří — stejné medaile jako v žebříčku historických
     sezón, ať appka nemá dva různé způsoby, jak říct „třetí místo“.
     Medaile nahrazuje pořadové číslo, nepřidává se k němu. */
  return `<div class="tbox">
    <h4>${esc(title)}${info(`Top 10 za celou sezónu. Klikni na jméno pro detail
      hráče. Zvýrazněné řádky jsou hráči z tvé sestavy.`)}</h4><p class="cap">${esc(cap)}</p>
    <ol class="tlist">${rows.map((x, i) => `<li class="${
        MY_SQUAD && MY_SQUAD.has(x.p.id) ? 'me' : ''}">
      ${i < 3 ? `<i class="tmdl" title="${i + 1}. místo">${MEDAL[i + 1]}</i>` : ''}
      <button type="button" class="tname" data-pid="${x.p.id}">
        ${crest(x.p.team, 'sm')}
        <b>${esc(x.p.web_name)}</b>
        <em>${esc(teams[x.p.team].short_name)}</em>
      </button>
      <span class="tval">${esc(String(fmt(x.v)))}</span>
    </li>`).join('')}</ol>
  </div>`;
}

/* ------------------------------------------------------------
   Porovnání dvou hráčů.

   Nejčastější otázka v FPL nezní „kdo je nejlepší“, ale „koho
   z těch dvou“. Dřív se hráči vybírali tlačítkem v dlouhé tabulce;
   teď jsou to dva seznamy s hledáním, takže jde porovnat kdokoli
   s kýmkoli bez lovení řádku.
   ------------------------------------------------------------ */
let CMP_A = null, CMP_B = null;

function comparePickers(){
  const teams = Object.fromEntries(BOOT.teams.map(t => [t.id, t]));
  const opts = sel => BOOT.elements
    .slice()
    .sort((a, b) => b.total_points - a.total_points)
    .map(p => `<option value="${p.id}"${String(sel) === String(p.id) ? ' selected' : ''}>${
      POS[p.element_type]} · ${esc(p.web_name)} · ${esc(teams[p.team].short_name)} · ${
      p.total_points} b</option>`).join('');

  return `<div class="cmpbar">
    <label>První hráč
      <input type="search" id="cmpqa" placeholder="Hledej podle jména…" autocomplete="off">
      <select id="cmpa"><option value="">Vyber hráče…</option>${opts(CMP_A)}</select>
    </label>
    <span class="cmpvs">vs</span>
    <label>Druhý hráč
      <input type="search" id="cmpqb" placeholder="Hledej podle jména…" autocomplete="off">
      <select id="cmpb"><option value="">Vyber hráče…</option>${opts(CMP_B)}</select>
    </label>
  </div>`;
}

/* Řádek porovnání: [popisek, text A, text B, číslo A, číslo B, je vyšší lepší?].
   U ceny a inkasovaných gólů je lepší nižší — proto ten poslední příznak. */
function compareRows(a, b){
  const num = (p, k) => stat(p, k) || 0;
  const both = (label, fn, fmt, higher = true) =>
    [label, fmt(fn(a)), fmt(fn(b)), fn(a), fn(b), higher];

  const rows = [
    both('Body celkem', p => p.total_points, v => v),
    both('Body za zápas', p => parseFloat(p.points_per_game) || 0, v => v.toFixed(1)),
    both('Forma', p => parseFloat(p.form) || 0, v => v.toFixed(1)),
    both('Projekce FPL · příští kolo', p => epNext(p) || 0, v => v.toFixed(1)),
    both('Cena', p => p.now_cost / 10, v => v.toFixed(1) + 'm', false),
    both('Body za milion', p => p.total_points / (p.now_cost / 10), v => v.toFixed(1)),
    both('Minuty', p => p.minutes, v => v),
    both('Starty', p => p.starts || 0, v => v),
    both('Vlastní %', p => parseFloat(p.selected_by_percent) || 0, v => v.toFixed(1) + ' %'),
    both('Bonusové body', p => p.bonus || 0, v => v),
  ];

  // Brankáře a hráče v poli soudíme podle jiných věcí.
  if(a.element_type === 1 && b.element_type === 1){
    rows.push(both('Čistá konta', p => num(p, 'clean_sheets'), v => v));
    rows.push(both('Zákroky', p => num(p, 'saves'), v => v));
    rows.push(both('Zákroky / 90', p => num(p, 'saves_per_90'), v => v.toFixed(2)));
    rows.push(both('Inkasované góly', p => num(p, 'goals_conceded'), v => v, false));
  }else{
    rows.push(both('Góly', p => p.goals_scored || 0, v => v));
    rows.push(both('Asistence', p => p.assists || 0, v => v));
    rows.push(both('xG', p => num(p, 'expected_goals'), v => v.toFixed(2)));
    rows.push(both('xA', p => num(p, 'expected_assists'), v => v.toFixed(2)));
    rows.push(both('xGI / 90', p => num(p, 'expected_goal_involvements_per_90'),
      v => v.toFixed(2)));
    rows.push(both('DEFCON', p => num(p, 'defensive_contribution'), v => v));
  }

  rows.push(both('ICT index', p => num(p, 'ict_index'), v => v.toFixed(1)));
  return rows;
}

function drawCompare(){
  const box = $('pcompare');
  if(!box) return;

  const a = CMP_A ? BOOT.elements.find(p => p.id === CMP_A) : null;
  const b = CMP_B ? BOOT.elements.find(p => p.id === CMP_B) : null;
  const teams = Object.fromEntries(BOOT.teams.map(t => [t.id, t]));

  let body;
  if(!a || !b){
    body = ``;
  }else if(a.id === b.id){
    body = '<p class="note">To je dvakrát ten samý hráč — vyber dva různé.</p>';
  }else{
    const rows = compareRows(a, b).map(([label, va, vb, na, nb, higher]) => {
      const aw = higher ? na > nb : na < nb;
      const bw = higher ? nb > na : nb < na;
      return `<tr>
        <td class="${aw ? 'win' : ''}">${esc(String(va))}</td>
        <td class="lbl">${esc(label)}</td>
        <td class="${bw ? 'win' : ''}">${esc(String(vb))}</td>
      </tr>`;
    }).join('');

    /* Verdikt počítám z projekce na pět kol dopředu, ne ze sezónních
       součtů. Ty říkají, kdo byl lepší — ne kdo bude, a to je otázka,
       kterou si člověk u porovnání klade. */
    const start = planStartGw();
    const xa = projectRange(a, start, 5), xb = projectRange(b, start, 5);
    const diff = Math.abs(xa - xb);
    const lead = xa > xb ? a : b, other = xa > xb ? b : a;
    const dPrice = (lead.now_cost - other.now_cost) / 10;

    body = `<div class="chead">
        <div><b>${esc(a.web_name)}</b><span>${esc(teams[a.team].short_name)} ·
          ${POS[a.element_type]} · ${(a.now_cost / 10).toFixed(1)}m</span></div>
        <div class="vs">vs</div>
        <div><b>${esc(b.web_name)}</b><span>${esc(teams[b.team].short_name)} ·
          ${POS[b.element_type]} · ${(b.now_cost / 10).toFixed(1)}m</span></div>
      </div>
      <table class="ctab"><tbody>${rows}</tbody></table>
      <p class="note">${diff < 1.5
        ? `Přes příštích pět kol jsou prakticky nerozeznatelní (rozdíl
           ${diff.toFixed(1)} bodu). Rozhodni podle ceny nebo podle toho,
           koho má tvoje miniliga.`
        : `Přes příštích pět kol vede <b>${esc(lead.web_name)}</b> o
           ${diff.toFixed(1)} bodu. ${dPrice > 0
             ? `Stojí ale o ${dPrice.toFixed(1)}m víc — ptej se, jestli ten
                rozdíl jinde v sestavě nevyužiješ líp.`
             : dPrice < 0 ? 'A je zároveň levnější.' : 'Za stejné peníze.'}`}
        ${a.element_type !== b.element_type
          ? '<br><b>Pozor:</b> porovnáváš různé pozice, takže se liší i bodování — '
            + 'čisté konto dá obránci 4 body, záložníkovi 1 a útočníkovi žádný.'
          : ''}</p>`;
  }

  box.innerHTML = `<h2>Porovnání dvou hráčů${info(`Vyber dva hráče a porovnám je
      vedle sebe. Zelené pole ukazuje, kdo v daném ukazateli vede. Sada řádků se
      mění podle pozice: dva brankáři dostanou zákroky a inkasované góly, hráči
      v poli xG, xA a defenzivní příspěvky. U ceny a inkasovaných gólů vyhrává
      nižší číslo. Verdikt dole počítám z projekce na pět kol dopředu, ne ze
      sezónních součtů — ty říkají, kdo byl lepší, ne kdo bude.`)}</h2>${comparePickers()}
    <div class="cmpout">${body}</div>`;

  /* Hledání seznam nefiltruje, ale vybere nejlepší shodu. Filtrovat
     <select> znamená mazat a znovu stavět stovky <option> při každém
     stisku klávesy — tohle je rychlejší a hlavně ti pod rukama nezmizí
     hráč, kterého jsi právě vybral. */
  const wire = (qid, sid, set) => {
    const sel = $(sid), q = $(qid);
    sel.addEventListener('change', () => {
      set(sel.value ? Number(sel.value) : null);
      drawCompare();
    });
    q.addEventListener('input', () => {
      const needle = normName(q.value);
      if(!needle) return;
      const hit = BOOT.elements
        .filter(p => normName(p.web_name + ' ' + p.second_name).includes(needle))
        .sort((x, y) => y.total_points - x.total_points)[0];
      if(hit){ set(hit.id); drawCompare(); }
    });
  };
  wire('cmpqa', 'cmpa', v => { CMP_A = v; });
  wire('cmpqb', 'cmpb', v => { CMP_B = v; });
}

function drawTopPlayers(){
  $('pout').innerHTML = [
    `<h2>Nejvíc bodů podle pozice${info(`Top 10 v každé řadě za celou sezónu.
      Zvýrazněné řádky jsou hráči z tvé sestavy — kádr si nech načíst v záložce
      Sestava. Klikni na jméno pro detail hráče.`)}</h2>`,
    `<div class="tgrid">${TOP_POINTS.map(topBoard).join('')}</div>`,
    '<h2>Hráči v poli</h2>',
    `<div class="tgrid">${TOP_FIELD.map(topBoard).join('')}</div>`,
    '<h2>Brankáři</h2>',
    `<div class="tgrid">${TOP_GK.map(topBoard).join('')}</div>`,
  ].join('');

  $('pout').querySelectorAll('button.tname').forEach(btn =>
    btn.addEventListener('click', () => showPlayer(Number(btn.dataset.pid))));

  drawCompare();
}

async function loadPlayers(){
  $('pmsg').textContent = '';
  try{
    /* Rozpis je potřeba kvůli projekci ve verdiktu porovnání. Dřív se sem
       došlo s BOOT načteným a FIX null, funkce spadla a záložka zůstala
       prázdná bez jediného slova. Tichá chyba je horší než hlasitá. */
    if(!BOOT) BOOT = await api('bootstrap-static/');
    if(!FIX) FIX = await api('fixtures/');
    if(!PLAYERS){
      $('pout').innerHTML = '<div class="skel"><i></i><i></i><i></i><i></i><i></i></div>';
      PLAYERS = playerRows();
    }
    drawTopPlayers();
  }catch(e){
    $('pmsg').innerHTML = errBox(e.message, 't-players');
    $('pout').innerHTML = '';
  }
}

async function showPlayer(pid){
  const row = PLAYERS.find(r => r.p.id === pid);
  $('pdetail').innerHTML = '<div class="detail"><p class="note">Načítám historii…</p></div>';
  $('pdetail').scrollIntoView({behavior: 'smooth', block: 'nearest'});

  let sum;
  try { sum = await api('element-summary/' + pid + '/'); }
  catch(e){ $('pdetail').innerHTML = `<div class="detail"><p class="note">${esc(e.message)}</p></div>`; return; }

  const teams = Object.fromEntries(BOOT.teams.map(t => [t.id, t]));
  const hist = sum.history || [];
  const last5 = hist.slice(-5);

  const agg = last5.reduce((a, h) => ({
    pts: a.pts + h.total_points, min: a.min + h.minutes,
    g: a.g + h.goals_scored, as: a.as + h.assists,
    xg: a.xg + parseFloat(h.expected_goals || 0),
    xa: a.xa + parseFloat(h.expected_assists || 0),
    bps: a.bps + h.bonus,
  }), {pts: 0, min: 0, g: 0, as: 0, xg: 0, xa: 0, bps: 0});

  const pillCls = v => v >= 7 ? 'p-hi' : v >= 3 ? 'p-md' : 'p-lo';

  const pills = last5.length
    ? `<div class="pills">${last5.map(h => `<span class="pill ${pillCls(h.total_points)}">
        ${h.total_points}<small>GW${h.round}</small></span>`).join('')}</div>`
    : '<p class="note">Zatím žádné odehrané zápasy v této sezóně.</p>';

  const season = hist.reduce((a, h) => ({
    pts: a.pts + h.total_points, min: a.min + h.minutes,
    g: a.g + h.goals_scored, as: a.as + h.assists,
  }), {pts: 0, min: 0, g: 0, as: 0});

  const upcoming = (sum.fixtures || []).slice(0, 5).map(f => {
    const opp = teams[f.is_home ? f.team_a : f.team_h];
    return `${opp ? opp.short_name : '?'}${f.is_home ? ' (D)' : ' (V)'} · ${f.difficulty}`;
  }).join(' | ');

  const table = hist.length ? `<table style="margin-top:14px">
    <thead><tr><th>GW</th><th class="hide-s">Soupeř</th><th class="n">Min</th>
      <th class="n">G</th><th class="n">A</th><th class="n hide-s">xG</th>
      <th class="n hide-s">xA</th><th class="n">Bon</th><th class="n">Body</th></tr></thead>
    <tbody>${hist.slice().reverse().slice(0, 12).map(h => {
      const opp = teams[h.opponent_team];
      return `<tr>
        <td>${h.round}</td>
        <td class="hide-s">${opp ? esc(opp.short_name) : '–'}${h.was_home ? ' (D)' : ' (V)'}</td>
        <td class="n">${h.minutes}</td>
        <td class="n">${h.goals_scored}</td>
        <td class="n">${h.assists}</td>
        <td class="n hide-s">${parseFloat(h.expected_goals || 0).toFixed(2)}</td>
        <td class="n hide-s">${parseFloat(h.expected_assists || 0).toFixed(2)}</td>
        <td class="n">${h.bonus}</td>
        <td class="n"><b>${h.total_points}</b></td>
      </tr>`;
    }).join('')}</tbody></table>` : '';

  // Předchozí sezóny — jediná obrana proti malému vzorku u hráče,
  // který letos odehrál pár set minut.
  const past = (sum.history_past || []).slice(-4).reverse();
  const pastHtml = past.length ? `
    <h2>Předchozí sezóny</h2>
    <table>
      <thead><tr><th>Sezóna</th><th class="n">Body</th><th class="n">Minuty</th>
        <th class="n hide-s">Cena start</th><th class="n hide-s">Cena konec</th></tr></thead>
      <tbody>${past.map(x => `<tr>
        <td>${esc(x.season_name)}</td>
        <td class="n"><b>${x.total_points}</b></td>
        <td class="n">${x.minutes}</td>
        <td class="n hide-s">${(x.start_cost / 10).toFixed(1)}</td>
        <td class="n hide-s">${(x.end_cost / 10).toFixed(1)}</td>
      </tr>`).join('')}</tbody>
    </table>`
    : '<p class="note">V Premier League zatím neodehrál žádnou předchozí sezónu.</p>';

  $('pdetail').innerHTML = `<div class="detail">
    <button class="close" id="pclose" aria-label="Zavřít">×</button>
    <h3>${esc(row.p.first_name)} ${esc(row.p.second_name)}</h3>
    <div class="who">${esc(row.team.name)} · ${POS[row.p.element_type]} · ${row.price.toFixed(1)}m</div>

    <div class="kpis eprow">
      <div><div class="k">Projekce FPL · příští kolo</div>
        <div class="v big">${row.ep === null ? '–' : row.ep.toFixed(1)}</div></div>
      <div><div class="k">Projekce FPL · toto kolo</div>
        <div class="v">${epThis(row.p) === null ? '–' : epThis(row.p).toFixed(1)}</div></div>
      <div><div class="k">Body za zápas</div><div class="v">${row.p.points_per_game}</div></div>
      <div><div class="k">Forma</div><div class="v">${row.p.form}</div></div>
    </div>

    <h2>Statistiky podle pozice${info(`Všechno naměřená čísla z FPL, nic dopočítaného.
    ${row.p.element_type === 1 ? 'U brankáře rozhodují zákroky a čistá konta.'
      : row.p.element_type === 2 ? 'U obránce sleduj xGC — kolik jeho tým očekávaně inkasuje.'
      : row.p.element_type === 3 ? 'Záložník bere body z obou stran: zapojení do gólů i čisté konto.'
      : 'U útočníka je podstatné xGI — jak často se dostává ke gólovým situacím.'}`)}</h2>
    ${statGrid(row.p)}
    

    <h2 style="margin-top:16px">Posledních 5 kol</h2>
    ${pills}
    <div class="kpis">
      <div><div class="k">Body</div><div class="v">${agg.pts}</div></div>
      <div><div class="k">Minuty</div><div class="v">${agg.min}</div></div>
      <div><div class="k">G + A</div><div class="v">${agg.g}+${agg.as}</div></div>
      <div><div class="k">xG + xA</div><div class="v">${(agg.xg + agg.xa).toFixed(2)}</div></div>
      <div><div class="k">Bonus</div><div class="v">${agg.bps}</div></div>
    </div>
    ${last5.length ? `<p class="note">${
      (agg.g + agg.as) > (agg.xg + agg.xa) + 1
        ? 'Skóruje nad očekávání — část bodů je štěstí a nemusí vydržet.'
        : (agg.xg + agg.xa) > (agg.g + agg.as) + 1
          ? 'Šance si vytváří, ale nepromítly se do bodů — může se to obrátit.'
          : 'Body zhruba odpovídají vytvořeným šancím.'}</p>` : ''}

    <h2>Celá sezóna</h2>
    <div class="kpis">
      <div><div class="k">Body</div><div class="v">${season.pts}</div></div>
      <div><div class="k">Zápasy</div><div class="v">${hist.length}</div></div>
      <div><div class="k">Minuty</div><div class="v">${season.min}</div></div>
      <div><div class="k">G + A</div><div class="v">${season.g}+${season.as}</div></div>
      <div><div class="k">Vlastní %</div><div class="v">${row.p.selected_by_percent}</div></div>
      <div><div class="k">Model · 5 kol</div><div class="v">${row.xp5.toFixed(1)}</div></div>
    </div>
    ${upcoming ? `<p class="note">Program: ${esc(upcoming)}</p>` : ''}
    ${pastHtml}
    ${table}
  </div>`;

  $('pclose').addEventListener('click', () => { $('pdetail').innerHTML = ''; });
}


$('t-players').addEventListener('click', () => { loadPlayers(); });
