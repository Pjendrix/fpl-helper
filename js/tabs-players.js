/* Minileague Squad Check — transfery a detail hráče

   Součást skupiny js/tabs*.js. Ta byla do verze 2.0 jedním souborem
   o 4 200 řádcích a osmi nesouvisejících sekcích; rozdělení je čistě
   mechanické — žádný kód se nepřepisoval, jen přestěhoval.

   Soubory js/ se načítají jako klasické <script> v pevném pořadí a
   sdílejí jeden globální scope: nic se neexportuje ani neimportuje,
   ale hoisting přes hranici souboru neplatí. Pořadí je proto součást
   kontraktu a je vypsané v index.html i v sw.js.
   ============================================================ */

/* ============ TRANSFERY ============
   Postup:
     1. načti sestavu a stav banky
     2. priorita 1 — zranění, suspenze, nebo 3 zápasy v řadě s FDR 4+
     3. priorita 2 — 3 a více zápasů po sobě pod 3 body
     4. ke každému problému najdi náhrady, které se vejdou do rozpočtu
*/

function nextFixtures(teamId, startGw, n){
  const out = [];
  for(const f of FIX){
    if(f.event === null || f.event < startGw) continue;
    if(f.team_h === teamId) out.push({gw: f.event, opp: f.team_a, home: true, d: f.team_h_difficulty});
    else if(f.team_a === teamId) out.push({gw: f.event, opp: f.team_h, home: false, d: f.team_a_difficulty});
  }
  return out.sort((a, b) => a.gw - b.gw).slice(0, n);
}

async function analyzeTransfers(){
  $('trmsg').textContent = 'Načítám sestavu…';
  $('trout').innerHTML = '<div class="skel"><i></i><i></i><i></i><i></i><i></i></div>';
  try{
    if(!BOOT){ [BOOT, FIX] = await Promise.all([api('bootstrap-static/'), api('fixtures/')]); }
    if(!PLAYERS) PLAYERS = playerRows();

    const entryId = CONFIG.entryId || localStorage.getItem('fpl_entry');
    if(!entryId){ $('trmsg').textContent = 'Nejdřív si načti sestavu v záložce Sestava.'; return; }

    const cur = BOOT.events.find(e => e.is_current);
    const nxt = BOOT.events.find(e => e.is_next);
    const startGw = nxt ? nxt.id : (cur ? cur.id + 1 : 1);

    if(!cur){
      $('trmsg').textContent = 'Sezóna ještě nezačala — analýza dává smysl až po prvním kole.';
      return;
    }

    const picks = await api('entry/' + entryId + '/event/' + cur.id + '/picks/');
    const bank = (picks.entry_history.bank || 0) / 10;

    // Nákupní ceny. Když endpoint selže, spadneme na cenu na začátku sezóny —
    // to je pořád lepší než ruční zadávání, jen to nezachytí pozdější nákupy.
    try{
      BUY_COST = buildBuyCost(await cached('entry/' + entryId + '/transfers/'));
    }catch(e){
      BUY_COST = null;
    }

    $('trmsg').textContent = 'Procházím ' + picks.picks.length + ' hráčů…';

    // historie kazdeho hrace v kadru — kvuli bodum za posledni zapasy
    const summaries = (await pooled(picks.picks,
      pk => cached('element-summary/' + pk.element + '/').then(r => r.history || []),
      5, (d, t) => { $('trmsg').textContent = `Procházím kádr… ${d}/${t}`; })).map(x => x || []);

    const els0 = Object.fromEntries(BOOT.elements.map(p => [p.id, p]));
    const squad = picks.picks.map(pk => ({p: els0[pk.element], pick: pk})).filter(x => x.p);

    // ulozime si to, aby slo prepocitat po rucni uprave cen bez novych dotazu
    TR_STATE = {picks, summaries, squad, apiBank: bank, startGw};
    renderTransfers();
    $('trmsg').textContent = '';
  }catch(e){
    $('trmsg').innerHTML = errBox(e.message, null, () => analyzeTransfers());
  }
}

/* --- rucni korekce cen -------------------------------------------------
   FPL veřejně nedává prodejní cenu (při zdražení vrací jen polovinu zisku),
   takže odhad z aktuální ceny bývá o desetinu vedle. Uživatel si ji může
   přepsat podle toho, co vidí ve své sestavě na FPL; ukládá se do prohlížeče.
*/
let TR_STATE = null;

/* Ruční prodejní ceny a banka patří ke konkrétnímu týmu, ne k prohlížeči.
   Dřív byly klíče sdílené, takže po přepnutí na jiné ID se objevily cizí
   částky u cizí sestavy. Klíčujeme proto podle entry ID. */
const SELL_KEY = () => 'fpl_sell:' + (ENTRY_ID || '0');
const BANK_KEY = () => 'fpl_bank:' + (ENTRY_ID || '0');

function loadSell(){
  try { return JSON.parse(localStorage.getItem(SELL_KEY()) || '{}'); }
  catch(e){ return {}; }
}
function saveSell(o){ lsSet(SELL_KEY(), JSON.stringify(o)); }

/* ------------------------------------------------------------
   Nákupní ceny z entry/{id}/transfers/.

   Dřív se prodejní ceny zadávaly ručně, protože FPL je v picks
   neposílá. Endpoint transfers/ ale posílá u každého přestupu
   `element_in_cost` — nákupní cenu v desetinách milionu.

   Hráč, kterého jsi nikdy nekupoval, je z původního kádru: jeho
   nákupní cena je `now_cost - cost_change_start`.

   Klíčem je poslední přestup dovnitř. Když hráče prodáš a za tři
   kola koupíš zpátky dráž, platí ta novější cena.
   ------------------------------------------------------------ */
let BUY_COST = null;   // {playerId: cena v desetinách} nebo null = nenačteno

function buildBuyCost(transfers){
  const map = {};
  const byPlayer = {};
  for(const t of (transfers || [])){
    const prev = byPlayer[t.element_in];
    // event může chybět u přestupů udělaných před prvním kolem
    const ev = Number.isFinite(t.event) ? t.event : 0;
    if(!prev || ev >= prev.ev) byPlayer[t.element_in] = {ev, cost: t.element_in_cost};
  }
  for(const [pid, v] of Object.entries(byPlayer))
    if(Number.isFinite(v.cost)) map[pid] = v.cost;
  return map;
}

/* Nákupní cena v desetinách. Vrací null, když ji nedokážeme určit. */
function buyCost(p){
  if(BUY_COST && Number.isFinite(BUY_COST[p.id])) return BUY_COST[p.id];
  // Hráč z původního kádru: odečteme celkový pohyb ceny od začátku sezóny.
  const start = p.now_cost - (p.cost_change_start || 0);
  return Number.isFinite(start) && start > 0 ? start : null;
}

/* Pravidlo FPL: ze zisku dostaneš zpátky polovinu, zaokrouhlenou dolů
   na desetinu milionu. Ztráta se naopak promítne celá. */
function sellFromBuy(nowCost, buy){
  if(!Number.isFinite(buy)) return nowCost;
  if(nowCost <= buy) return nowCost;
  return buy + Math.floor((nowCost - buy) / 2);
}

/* Ruční přepis prodejní ceny zmizel spolu se záložkou Transfery, kde
   se editoval. Nákupní ceny z transfers/ jsou přesnější než cokoli,
   co by člověk psal ručně, takže tu nic nechybí — jen se přestal číst
   starý localStorage, kde komu zůstaly staré přepisy. */
function sellPrice(p){
  return sellFromBuy(p.now_cost, buyCost(p)) / 10;
}

/* Odkud číslo je: 'manual' | 'api' | 'start'. Řídí popisek v UI —
   „upraveno“ a „spočítáno z nákupní ceny“ nejsou totéž. */
function sellSource(p){
  const v = parseFloat(loadSell()[p.id]);
  if(Number.isFinite(v) && v > 0) return 'manual';
  if(BUY_COST && Number.isFinite(BUY_COST[p.id])) return 'api';
  return 'start';
}
function isOverridden(p){ return sellSource(p) === 'manual'; }
function bankValue(){
  const v = parseFloat(localStorage.getItem(BANK_KEY()));
  return Number.isFinite(v) && v >= 0 ? v : (TR_STATE ? TR_STATE.apiBank : 0);
}


/* ------------------------------------------------------------
   Hledání náhrad.

   Filtry se aplikují v pořadí od nejtvrdšího po nejměkčí a průběžně se
   počítá, kolik hráčů kde vypadlo. Když nezbude nikdo, víme přesně proč
   a můžeme to říct — dřív appka v každém případě tvrdila „nevejde se do
   rozpočtu“, i když skutečnou příčinou byl minutový práh.

   Minutový práh se navíc škáluje podle toho, kolik kol se odehrálo.
   Pevných 180 minut znamenalo, že v prvních dvou kolech neprošel nikdo
   a záložka byla k ničemu přesně v době, kdy se transfery řeší nejvíc.
   ------------------------------------------------------------ */
function findReplacements(it, budget, owned, clubCount, startGw, byId){
  const rounds = roundsPlayed();

  // Po dvou kolech chceme 40 minut, po devíti 180. Nikdy víc než 180.
  // Pevných 180 znamenalo, že na začátku sezóny neprošel nikdo.
  const minMinutes = Math.min(180, Math.max(0, rounds - 1) * 20);

  /* Pořadí návrhů určuje jedno jediné číslo: kolik procent hráčů v FPL
     daného hráče vlastní. Žádná projekce, žádná forma, žádný rozpis.

     Je to vědomá volba, ne zjednodušení z lenosti. Vysoké vlastnictví
     znamená, že se od zbytku pole neodchýlíš — když ten hráč zaboduje,
     zabodujou i ostatní a ty neztrácíš. Opačná strana mince: takhle se
     náskok nezískává, jen nepropadá. Statistiky zůstávají dostupné pod
     tlačítkem, ale do pořadí nemluví. */
  const enrich = r => ({
    ...r,
    f3: nextFixtures(r.p.team, startGw, 3),
    owned: parseFloat(r.p.selected_by_percent) || 0,
    lastWeek: r.p.event_points,
  });

  const steps = [
    ['stejná pozice',        r => r.p.element_type === it.p.element_type],
    ['nemáš ho v kádru',     r => !owned.has(r.p.id)],
    ['limit 3 z klubu',      r => (clubCount[r.p.team] || 0) < 3],
    ['zdravý a k dispozici', r => r.chance >= 75 && r.p.status === 'a'],
    ['odehrané minuty',      r => r.p.minutes >= minMinutes],
    ['vejde se do rozpočtu', r => r.price <= budget + 0.001],
  ];

  // Počty po každém kroku — bez nich se nedá poznat, který filtr škrtí.
  const counts = [];
  let pool = PLAYERS;

  for(const [label, fn] of steps){
    pool = pool.filter(fn);
    counts.push({label, left: pool.length});
  }

  const cands = pool.map(enrich)
    .sort((a, b) => b.owned - a.owned)
    .slice(0, 5);

  // Kdo prošel vším kromě ceny — a o kolik peněz jde. Tohle je odpověď
  // na otázku „a kdybych sehnal ještě půl milionu?“, kterou si člověk
  // v tuhle chvíli stejně položí.
  const affordable = steps.slice(0, -1)
    .reduce((acc, [, fn]) => acc.filter(fn), PLAYERS);

  const nearMiss = affordable
    .filter(r => r.price > budget + 0.001)
    .map(enrich)
    .sort((a, b) => b.owned - a.owned)
    .slice(0, 3)
    .map(r => ({...r, missing: r.price - budget}));

  const cheapest = affordable.length
    ? Math.min(...affordable.map(r => r.price)) : null;

  return {
    cands, pool, counts, nearMiss, cheapest, minMinutes,
    diag: cands.length ? '' : explainNoCandidates(
      {counts, cheapest, nearMiss, budget, minMinutes, pos: it.p.element_type}),
  };
}

/* Když nic nenajdeme, musí být z výstupu jasné proč — jinak si uživatel
   domyslí špatnou příčinu a jde uvolňovat peníze, které nejsou problém.
   Dřív appka v každém případě tvrdila „nevejde se do rozpočtu“. */
function explainNoCandidates({counts, cheapest, nearMiss, budget, minMinutes, pos}){
  // První krok, po kterém nezbyl nikdo.
  const dead = counts.find(c => c.left === 0);

  let lead;
  if(!dead){
    lead = 'Něco je špatně v samotném hledání — filtry prošly, ale seznam je prázdný.';
  } else if(dead.label === 'vejde se do rozpočtu'){
    lead = cheapest !== null
      ? `Nejlevnější použitelný ${POS[pos]} stojí <b>${cheapest.toFixed(1)}m</b>,
         ty máš <b>${budget.toFixed(1)}m</b>. Chybí ti
         <b>${(cheapest - budget).toFixed(1)}m</b>.`
      : `Za ${budget.toFixed(1)}m na téhle pozici nikdo není.`;
  } else if(dead.label === 'odehrané minuty'){
    lead = `Kandidáti do rozpočtu existují, ale nikdo z nich zatím neodehrál
      ${minMinutes} minut.`;
  } else if(dead.label === 'zdravý a k dispozici'){
    lead = 'Do rozpočtu se vejdou jen hráči, kteří jsou zranění nebo pod otazníkem.';
  } else if(dead.label === 'limit 3 z klubu'){
    lead = 'Zbývající hráči jsou z klubů, odkud už máš tři — víc FPL nedovolí.';
  } else {
    lead = `Filtr „${dead.label}“ nenechal nikoho.`;
  }

  const near = nearMiss.length
    ? `<div class="near">
        <b>Kdybys uvolnil víc peněz:</b>
        ${nearMiss.map(r => `<span class="chip">
          <b>${esc(r.p.web_name)}</b>
          <span class="ct">${esc(r.team.short_name)} · ${r.price.toFixed(1)}m
            · vlastní ${r.owned.toFixed(1)} % · chybí ${r.missing.toFixed(1)}m</span></span>`).join('')}
      </div>` : '';

  const table = `<details class="why">
    <summary>Proč nic nenašlo</summary>
    <table class="funnel"><tbody>
      ${counts.map(c => `<tr><td>${esc(c.label)}</td>
        <td class="n ${c.left ? '' : 'al'}">${c.left}</td></tr>`).join('')}
    </tbody></table>
    <p class="note">Kolik hráčů zbylo po každém kroku. Nula ukazuje, kde se to zaseklo.</p>
  </details>`;

  return `<p class="note">${lead}</p>${near}${table}`;
}

function renderTransfers(){
  const {picks, summaries, startGw} = TR_STATE;
  const bank = bankValue();
  const els = Object.fromEntries(BOOT.elements.map(p => [p.id, p]));
  const teams = Object.fromEntries(BOOT.teams.map(t => [t.id, t]));
  const owned = new Set(picks.picks.map(pk => pk.element));
  const byId = Object.fromEntries(PLAYERS.map(r => [r.p.id, r]));

  const issues = [];

  picks.picks.forEach((pk, i) => {
    const p = els[pk.element];
    if(!p) return;
    const hist = summaries[i];
    const fx = nextFixtures(p.team, startGw, 3);
    const chance = p.chance_of_playing_next_round === null ? 100 : p.chance_of_playing_next_round;
    const reasons = [];
    let prio = 0;

    // --- priorita 1: dostupnost ---
    if(p.status === 's'){ reasons.push('Suspendovaný'); prio = 1; }
    else if(p.status === 'i'){ reasons.push('Zraněný'); prio = 1; }
    else if(p.status === 'u' || p.status === 'n'){ reasons.push('Nedostupný'); prio = 1; }
    else if(chance < 100){
      reasons.push('Šance nastoupit jen ' + chance + ' %');
      prio = chance <= 50 ? 1 : Math.max(prio, 2);
    }

    /* --- program ---

       Dvě věci, na kterých staré pravidlo padalo:

       1) Používalo statické FDR od FPL, které je symetrické — Arsenal
          proti Chelsea má stejnou čtyřku jako Burnley proti Chelsea.
          Pro Arsenal je to ale vyrovnaný zápas. `ownFdr()` počítá sílu
          obou týmů, takže hráč silného klubu už není trestaný za to,
          že hraje proti jiným silným klubům.

       2) Práh „dva ze tří těžkých“ flagoval prakticky každého hráče
          špičkového týmu. Teď rozhoduje průměr přes celý blok, ne počet
          jednotlivých zápasů — a musí být opravdu zlý. */
    const withOwn = fx.map(f => ({...f, od: ownFdr(p.team, f.opp, f.home, f.d)}));
    const avgOwn = withOwn.length
      ? withOwn.reduce((a2, f) => a2 + f.od, 0) / withOwn.length : 3;

    const fxText = withOwn.map(f =>
      (teams[f.opp] ? teams[f.opp].short_name : '?')
      + (f.home ? ' (D)' : ' (V)') + ' ' + f.od.toFixed(1)).join(', ');

    /* Hráč, který boduje, se neprodává kvůli rozpisu. Forma i body na
       zápas jsou naměřená čísla od FPL — když jsou dobrá, program musí
       být opravdu brutální, aby to přebilo. */
    const form = parseFloat(p.form) || 0;
    const ppg = parseFloat(p.points_per_game) || 0;
    const performing = form >= 4 || ppg >= 4.5;

    if(withOwn.length === 3 && avgOwn >= 4.3 && !performing){
      reasons.push('Velmi těžký blok: ' + fxText);
      prio = Math.max(prio, 1);
    } else if(withOwn.length === 3 && avgOwn >= 3.9 && !performing){
      reasons.push('Náročný program: ' + fxText);
      prio = Math.max(prio, 2);
    }

    /* --- bodová sucha ---
       Sucho počítáme jen ze zápasů, kde hráč reálně hrál. Tři pětiminutová
       střídání nejsou bodová krize, ale nedostatek příležitosti. */
    const played = hist.filter(h => h.minutes >= 60);
    let dry = 0;
    for(let k = played.length - 1; k >= 0; k--){
      if(played[k].total_points <= 3) dry++; else break;
    }
    if(dry >= 3 && !performing){
      const pts = played.slice(-dry).map(h => h.total_points).join(', ');
      reasons.push('Poslední ' + dry + ' zápasy pod 3 body (' + pts + ')');
      prio = prio === 1 ? 1 : 2;
    }

    if(prio) issues.push({p, pk, prio, reasons, fx: withOwn, dry, chance, avgOwn});
  });

  if(!issues.length){
    $('trout').innerHTML = `<div class="ok-box">
      <b>Sestava je v pořádku.</b>
      <p class="note">Nikdo není zraněný ani suspendovaný, nikoho nečeká vyloženě zlý
      blok zápasů a nikdo netrpí bodovým suchem. Hráči, kteří bodují, se neflagují —
      dobrá forma přebije i těžký program. V bance máš ${bank.toFixed(1)}m.</p>
    </div>
    <div class="diffs">${buildDifferentials()}</div>`;
    return;
  }

  issues.sort((a, b) => a.prio - b.prio || b.dry - a.dry);

  const blocks = issues.map(it => {
    const sell = sellPrice(it.p);
    const budget = bank + sell;
    const edited = isOverridden(it.p);

    // FPL dovoluje nejvýš tři hráče z jednoho klubu. Po odchodu tohohle
    // hráče se počty přepočítají — jinak by appka klidně navrhla čtvrtého
    // Arsenalisty a transfer by nešel provést.
    const clubCount = {};
    picks.picks.forEach(x => {
      if(x.element === it.p.id) return;
      const q = els[x.element];
      if(q) clubCount[q.team] = (clubCount[q.team] || 0) + 1;
    });

    const {cands, diag} = findReplacements(it, budget, owned, clubCount, startGw, byId);

    const candHtml = cands.length ? `
      <div class="candhead">
        <span>Hráč</span><span>Tým</span><span class="n">Cena</span>
        <span class="n">Vlastní</span><span class="n">Body min. kolo</span>
        <span class="n">Minuty</span><span></span>
      </div>
      ${cands.map(c => `<div class="cand2">
        <span class="nm"><b>${esc(c.p.web_name)}</b></span>
        <span class="tm">${esc(c.team.short_name)}</span>
        <span class="n" data-l="Cena">${c.price.toFixed(1)}m</span>
        <span class="n own" data-l="Vlastní"><b>${c.owned.toFixed(1)}&nbsp;%</b></span>
        <span class="n" data-l="Min. kolo">${c.lastWeek} b</span>
        <span class="n" data-l="Minut">${c.p.minutes}</span>
        <span class="n">
          <button class="info" type="button" aria-expanded="false"
                  data-stats="${it.p.id}-${c.p.id}"
                  aria-label="Statistiky hráče ${esc(c.p.web_name)}">i</button>
        </span>
      </div>
      <div class="statpop" id="stats-${it.p.id}-${c.p.id}" hidden>
        <h5>${esc(c.p.web_name)} · ${esc(c.team.short_name)} · ${POS[c.p.element_type]}</h5>
        ${statGrid(c.p)}
        <p class="note">Program: ${c.f3.map(f =>
          (teams[f.opp] ? esc(teams[f.opp].short_name) : '?') + ' ' + f.d).join(' · ') || '–'}
          · projekce FPL ${c.ep === null ? '–' : c.ep.toFixed(1)}</p>
      </div>`).join('')}
      <p class="note">Seřazeno <b>výhradně podle vlastnictví</b> — kolik procent
      hráčů FPL je má v týmu. Statistiky jsou pod tlačítkem <b>i</b> a do pořadí
      nemluví. Vysoké vlastnictví tě drží s polem; náskok se takhle nezískává.</p>`
      : diag;

    /* Karta je složená: v zavřeném stavu jen jméno, zařazení a důvod.
       Statistiky a návrhy náhrad se rozbalí až na vyžádání — patnáct
       rozbalených karet pod sebou nikdo nepřečte. */
    const mineEp = byId[it.p.id] ? byId[it.p.id].ep : null;

    return `<details class="issue p${it.prio}">
      <summary>
        <div class="hdr">
          <b>${esc(it.p.web_name)}</b>
          <span class="tag">${esc(teams[it.p.team].short_name)} · ${POS[it.p.element_type]}
            · ${(it.p.now_cost / 10).toFixed(1)}m</span>
          <span class="tag">${it.prio === 1 ? 'Priorita 1' : 'Priorita 2'}</span>
          <span class="tag ep">xP FPL ${mineEp === null ? '–' : mineEp.toFixed(1)}</span>
        </div>
        <p class="why">${it.reasons.map(r => '• ' + esc(r)).join('<br>')}</p>
        <span class="more">Rozbalit statistiky a náhrady</span>
      </summary>

      <div class="issue-body">
        <div class="candhead">
          <span>Hráč</span><span>Tým</span><span class="n">Cena</span>
          <span class="n">Vlastní</span><span class="n">Body min. kolo</span>
          <span class="n">Minuty</span><span></span>
        </div>
        <div class="cand2 own-row">
          <span class="nm"><b>${esc(it.p.web_name)}</b></span>
          <span class="tm">${esc(teams[it.p.team].short_name)}</span>
          <span class="n" data-l="Cena">${(it.p.now_cost / 10).toFixed(1)}m</span>
          <span class="n own" data-l="Vlastní"><b>${parseFloat(it.p.selected_by_percent).toFixed(1)}&nbsp;%</b></span>
          <span class="n" data-l="Min. kolo">${it.p.event_points} b</span>
          <span class="n" data-l="Minut">${it.p.minutes}</span>
          <span class="n">
            <button class="info" type="button" aria-expanded="false"
                    data-stats="self-${it.p.id}"
                    aria-label="Statistiky hráče ${esc(it.p.web_name)}">i</button>
          </span>
        </div>
        <div class="statpop" id="stats-self-${it.p.id}" hidden>
          <h5>${esc(it.p.web_name)} · ${POS[it.p.element_type]}</h5>
          ${statGrid(it.p)}
        </div>

        <div class="budget">
          <label>Prodejní cena
            <input class="pin" type="number" step="0.1" min="0" max="20"
                   data-pid="${it.p.id}" value="${sell.toFixed(1)}">m
          </label>
          + banka ${bank.toFixed(1)}m = <b>${budget.toFixed(1)}m</b>
          ${{manual: '<span class="edited">upraveno ručně</span>',
             api:    '<span class="est">z nákupní ceny ' +
                     (buyCost(it.p) / 10).toFixed(1) + 'm</span>',
             start:  '<span class="est">z ceny na startu sezóny</span>'
            }[sellSource(it.p)]}
        </div>

        <h4>Možné náhrady</h4>
        ${candHtml}
      </div>
    </details>`;
  });

  const p1 = issues.filter(i => i.prio === 1).length;
  const bankEdited = Number.isFinite(parseFloat(localStorage.getItem(BANK_KEY())));

  $('trout').innerHTML = `
    <h2>Nalezeno ${issues.length} problémů · ${p1} akutních${info(`${BUY_COST
      ? 'Prodejní ceny počítám z <b>tvých skutečných nákupních cen</b> (endpoint '
        + 'transfers/). Ze zisku ti FPL vrací polovinu zaokrouhlenou dolů — to je '
        + 'v čísle zahrnuté. Přepsat je můžeš, ale většinou nebudeš muset.'
      : '<b>Historii přestupů se nepodařilo načíst</b>, takže počítám z ceny na '
        + 'začátku sezóny. U hráčů koupených během sezóny to bude vedle — přepiš je '
        + 'ručně.'}`)}</h2>
    <div class="budget" style="border-top:0;padding-top:0">
      <label>V bance
        <input class="pin" id="bankin" type="number" step="0.1" min="0" max="100"
               value="${bank.toFixed(1)}">m
      </label>
      ${bankEdited ? `<span class="edited">upraveno</span>
        <button class="lnk" id="bankreset">vrátit ${TR_STATE.apiBank.toFixed(1)}m z FPL</button>` : ''}
    </div>
    
    ${blocks.join('')}
    <button class="lnk" id="sellreset" style="margin-top:14px">Zahodit ruční přepisy</button>
    ${storageNote('Ruční přepis cen a banky')}
    <div class="diffs">${buildDifferentials()}</div>`;

  /* Tlačítko „i“ místo hover tooltipu — na dotykovém displeji se hover
     nedá vyvolat a tooltip by tam byl nedostupný. */
  $('trout').querySelectorAll('button.info').forEach(btn => {
    btn.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      const box = $('stats-' + btn.dataset.stats);
      if(!box) return;
      const show = box.hidden;
      box.hidden = !show;
      btn.setAttribute('aria-expanded', String(show));
      btn.classList.toggle('on', show);
    });
  });

  // prepocet po uprave — bez novych dotazu na API
  $('trout').querySelectorAll('input.pin[data-pid]').forEach(inp => {
    inp.addEventListener('change', () => {
      const o = loadSell();
      const v = parseFloat(inp.value);
      if(Number.isFinite(v) && v > 0) o[inp.dataset.pid] = v;
      else delete o[inp.dataset.pid];
      saveSell(o);
      renderTransfers();
    });
  });

  $('bankin').addEventListener('change', () => {
    const v = parseFloat($('bankin').value);
    if(Number.isFinite(v) && v >= 0) lsSet(BANK_KEY(), String(v));
    else lsDel(BANK_KEY());
    renderTransfers();
  });

  const br = $('bankreset');
  if(br) br.addEventListener('click', () => {
    lsDel(BANK_KEY());
    renderTransfers();
  });

  $('sellreset').addEventListener('click', () => {
    lsDel(SELL_KEY());
    lsDel(BANK_KEY());
    renderTransfers();
  });
}

$('trgo').addEventListener('click', async () => {
  $('trgo').disabled = true;
  await analyzeTransfers();
  $('trgo').disabled = false;
});
