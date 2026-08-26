/* Minileague Squad Check — Přestupový poradce

   Diagnostika kádru a návrhy přestupů postavené na podkladových
   metrikách, které FPL API u každého hráče vrací: expected_goals,
   expected_assists, expected_goal_involvements, expected_goals_conceded
   a složky ICT. Dodavatelem těch dat je Opta, takže se nikam nescrapuje
   a nepřidává se ani jeden dotaz navíc — všechno je v BOOT.elements,
   který se stahuje při startu appky.

   Co ve veřejných datech NENÍ a nedá se tedy slíbit: sequence
   involvement, samostatné pressures a tackles, open play key passes,
   střely v pokutovém území a Opta Power Rankings. Kdo to chce, musí
   na placené rozhraní Stats Performu.

   Soubory js/ se načítají jako klasické <script> v pevném pořadí a
   sdílejí jeden globální scope: nic se neexportuje ani neimportuje,
   ale hoisting přes hranici souboru neplatí. Pořadí je proto součást
   kontraktu a je vypsané v index.html.
   ============================================================ */

/* Práh odehraných minut.

   Bez něj vyhraje každý žebříček někdo, kdo odehrál dvacet minut a
   jednou vystřelil z penalty. xG po dvou zápasech je šum — dvě kola
   po 90 minutách je minimum, u kterého má smysl vůbec něco tvrdit.

   Jenže pevných 180 minut znamená, že poradce v prvních dvou kolech
   nemá co říct — a to je přesně doba, kdy se v kádru hrabe nejvíc.
   Práh proto roste s odehranými koly: 60 po prvním, 120 po druhém a
   od třetího už těch 180, kde zůstane po zbytek sezóny.

   Že hráč prahem projde, ale neznamená, že jeho čísla něco znamenají —
   od toho je shrinkage níž. Práh rozhoduje, kdo se do tabulky dostane,
   shrinkage rozhoduje, jak vysoko. */
const ADV_MIN_MINUTES = 180;

function advMinMinutes(){
  const done = ((BOOT && BOOT.events) || []).filter(e => e.finished).length;
  return Math.min(ADV_MIN_MINUTES, Math.max(60, done * 60));
}

/* Stažení k průměru pozice (shrinkage).

   Per-90 metrika z jednoho zápasu má obrovský rozptyl: kdo jednou
   vystřelil z dobré pozice, vyskočí nad všechny opory. Místo surové
   hodnoty se proto řadí podle váženého průměru hráčova čísla a průměru
   jeho pozice, kde váha roste s odehranými minutami:

     váha = minuty / (minuty + 180)

   Po dvou celých zápasech je hráč z poloviny sám sebou a z poloviny
   normálním hráčem svojí pozice. V GW20 je váha přes 90 % a shrinkage
   se vytratí sám — není co vypínat.

   Používá se JEN na řazení a na výběr tipů. V tabulce zůstává surové
   číslo, protože to je to, co člověk uvidí na oficiálním webu FPL;
   zobrazit stažené číslo by vypadalo jako chyba v appce. */
const ADV_SHRINK_K = 180;

function advShrink(hodnota, minuty, prumer){
  const w = minuty / (minuty + ADV_SHRINK_K);
  return w * hodnota + (1 - w) * prumer;
}

// Kolik tipů. Tři je počet, který se dá přečíst; deset už je seznam.
const ADV_TIPS = 3;

let ADV_POS = null;   // vybraná pozice pro tipy, null = automaticky

const ADV_NAMES = {1: 'Brankáři', 2: 'Obránci', 3: 'Záložníci', 4: 'Útočníci'};

const num = v => parseFloat(v) || 0;

/* ------------------------------------------------------------
   Metriky

   Pro každou pozici jiná sada. Brankáři a obránci se neposuzují podle
   xG — jejich práce je jinde, a řadit stopery podle očekávaných gólů
   je způsob, jak doporučit útočícího krajního obránce z týmu, který
   dostává tři góly za zápas.
   ------------------------------------------------------------ */
const ADV_METRICS = {
  1: [
    {key: 'expected_goals_conceded_per_90', label: 'xGC / 90', lower: true},
    {key: 'saves_per_90', label: 'zákroky / 90'},
  ],
  2: [
    {key: 'expected_goals_conceded_per_90', label: 'xGC / 90', lower: true},
    {key: 'defensive_contribution_per_90', label: 'def. zapojení / 90'},
    {key: 'expected_goal_involvements_per_90', label: 'xGI / 90'},
  ],
  3: [
    {key: 'expected_goal_involvements_per_90', label: 'xGI / 90'},
    {key: 'creativity', label: 'creativity', per90: true},
    {key: 'threat', label: 'threat', per90: true},
  ],
  4: [
    {key: 'expected_goals_per_90', label: 'xG / 90'},
    {key: 'expected_goal_involvements_per_90', label: 'xGI / 90'},
    {key: 'threat', label: 'threat', per90: true},
  ],
};

/* creativity a threat jsou sezónní součty, ne průměry. Bez přepočtu na
   90 minut by vyhrál každý, kdo hrál nejvíc — což není informace. */
function advValue(p, m){
  const raw = num(p[m.key]);
  if(!m.per90) return raw;
  return p.minutes ? raw / (p.minutes / 90) : 0;
}

function advPool(pos){
  return (BOOT.elements || []).filter(p =>
    p.element_type === pos &&
    p.minutes >= advMinMinutes() &&
    p.status !== 'u');           // 'u' = hráč už v Premier League není
}

function advAvg(list, m){
  if(!list.length) return 0;
  return list.reduce((s, p) => s + advValue(p, m), 0) / list.length;
}

/* Základ pro shrinkage. Vážený minutami schválně: prostý průměr by
   stáhli dolů náhradníci, kteří prahem prošli o vlásek, a k takovému
   základu by se pak stahovali i ti, kdo hrají všechno. */
function advBase(list, m){
  const minuty = list.reduce((s, p) => s + p.minutes, 0);
  if(!minuty) return advAvg(list, m);
  return list.reduce((s, p) => s + advValue(p, m) * p.minutes, 0) / minuty;
}

/* Hodnota, podle které se řadí. Surovou vrací advValue(). */
function advRank(p, m, base){
  return advShrink(advValue(p, m), p.minutes, base);
}

/* ------------------------------------------------------------
   Diagnostika kádru

   Porovnává se s ligovým průměrem na dané pozici, ne s absolutním
   číslem. „Tvoji útočníci mají 0.31 xG/90, průměr je 0.44“ je
   informace; „máš nízké xG“ není nic.
   ------------------------------------------------------------ */
function advDiagnose(squad){
  return [1, 2, 3, 4].map(pos => {
    const moji = squad.filter(p => p.element_type === pos);
    const liga = advPool(pos);
    const merene = moji.filter(p => p.minutes >= advMinMinutes());

    return {
      pos,
      pocet: moji.length,
      merene: merene.length,
      radky: ADV_METRICS[pos].map(m => {
        const muj = advAvg(merene, m);
        const prumer = advAvg(liga, m);
        // U xGC je lepší menší číslo. Bez tohohle by appka chválila
        // obranu, která inkasuje nejvíc v lize.
        const lepsi = m.lower ? muj < prumer : muj > prumer;
        return {m, muj, prumer, lepsi, rozdil: prumer ? (muj - prumer) / prumer : 0};
      }),
    };
  });
}

/* Nejslabší místo kádru: pozice s nejhorším odstupem od průměru přes
   všechny své metriky. Tam se pak hledají tipy. */
function advWeakest(diag){
  const hodnotitelne = diag.filter(d => d.merene > 0);
  if(!hodnotitelne.length) return null;

  return hodnotitelne
    .map(d => ({
      pos: d.pos,
      // Znaménko se otáčí u metrik, kde je lepší méně.
      skore: d.radky.reduce((s, r) =>
        s + (r.m.lower ? -r.rozdil : r.rozdil), 0) / d.radky.length,
    }))
    .sort((a, b) => a.skore - b.skore)[0];
}

/* ------------------------------------------------------------
   Nadvýkon a podvýkon

   Rozdíl mezi tím, co hráč nasbíral, a tím, co říká podklad.

   Kladné číslo neznamená dobrého hráče — znamená, že měl štěstí a
   nejspíš se to srovná dolů. Záporné číslo je hráč, kterého si má
   člověk nechat, i když zrovna nedává body. To je nejužitečnější
   věc, kterou tenhle nástroj umí říct, a je proti instinktu.
   ------------------------------------------------------------ */
function advDelta(p){
  return (p.goals_scored + p.assists) - num(p.expected_goal_involvements);
}

/* Průměrné FDR na další tři kola. Los se do tipu nepromítá jako
   koeficient — ukazuje se vedle metrik, ať si závěr udělá člověk. */
function advFdr(p, gws = 3){
  const cur = BOOT.events.find(e => e.is_current);
  const nxt = BOOT.events.find(e => e.is_next);
  const od = nxt ? nxt.id : (cur ? cur.id + 1 : 1);

  const zapasy = (FIX || []).filter(f =>
    f.event != null && f.event >= od && f.event < od + gws &&
    (f.team_h === p.team || f.team_a === p.team));

  if(!zapasy.length) return null;
  const soucet = zapasy.reduce((s, f) =>
    s + (f.team_h === p.team ? f.team_h_difficulty : f.team_a_difficulty), 0);
  return soucet / zapasy.length;
}

/* ------------------------------------------------------------
   Tipy

   Ven jde ten, kdo je na své pozici nejhorší podle hlavní metriky a
   zároveň nedrží svůj bodový zisk podkladem. Dovnitř ten, kdo je
   nejlepší z těch, na které jsou peníze.
   ------------------------------------------------------------ */
function advCandidates(squad, pos, bank){
  const hlavni = ADV_METRICS[pos][0];
  const mam = new Set(squad.map(p => p.id));
  const liga = advPool(pos);
  const base = advBase(liga, hlavni);
  const hod = p => advRank(p, hlavni, base);

  const moji = squad
    .filter(p => p.element_type === pos && p.minutes >= advMinMinutes())
    .sort((a, b) => hlavni.lower
      ? hod(b) - hod(a)    // nejvyšší xGC první
      : hod(a) - hod(b));  // nejnižší xGI první

  const tipy = [];
  for(const ven of moji){
    const rozpocet = advSell(ven) + bank;

    const dovnitr = liga
      .filter(p => !mam.has(p.id) && advPrice(p) <= rozpocet && p.status === 'a')
      .sort((a, b) => hlavni.lower ? hod(a) - hod(b) : hod(b) - hod(a))[0];

    if(!dovnitr) continue;

    // Návrh, který nic nezlepší, není návrh. Porovnává se stažená
    // hodnota — jinak by tip vyhrál jeden šťastný výstřel.
    const zlepseni = hlavni.lower
      ? hod(ven) - hod(dovnitr)
      : hod(dovnitr) - hod(ven);
    if(zlepseni <= 0) continue;

    tipy.push({ven, dovnitr, pos, rozpocet});
    if(tipy.length >= ADV_TIPS) break;
  }
  return tipy;
}

/* Ceny se v celém souboru počítají v milionech, ne v desetinách.
   FPL vrací now_cost v desetinách (55 = 5.5m), ale sellPrice() a
   bankValue() z js/tabs.js vracejí miliony. Míchat obojí znamená
   rozpočet desetkrát vedle — a tipy na hráče, na které nejsou peníze. */
const advPrice = p => p.now_cost / 10;

/* Prodejní cena je u zdraženého hráče nižší než aktuální. Tip, který
   si to nehlídá, doporučí přestup, na který člověk nemá. */
function advSell(p){
  if(typeof sellPrice === 'function'){
    const v = sellPrice(p);
    if(Number.isFinite(v) && v > 0) return v;
  }
  return advPrice(p);
}

/* Zkratka klubu. teams[] je v bootstrapu vedle hráčů. */
function advTeam(id){
  const t = (BOOT.teams || []).find(x => x.id === id);
  return t ? t.short_name : '';
}

/* ============================================================
   VYKRESLENÍ
   ============================================================ */

function advFmt(v, m){
  if(v == null) return '–';
  return m && m.per90 ? v.toFixed(1) : v.toFixed(2);
}

function advDiagCard(d){
  if(!d.merene){
    return `<div class="advbox">
      <h4>${ADV_NAMES[d.pos]}</h4>
      <p class="note">Nikdo z nich zatím neodehrál ${advMinMinutes()} minut.</p>
    </div>`;
  }
  return `<div class="advbox">
    <h4>${ADV_NAMES[d.pos]}<span>${d.merene} z ${d.pocet}</span></h4>
    ${d.radky.map(r => `<div class="advrow ${r.lepsi ? 'ok' : 'bad'}">
      <span class="k">${r.m.label}</span>
      <b>${advFmt(r.muj, r.m)}</b>
      <span class="v">liga ${advFmt(r.prumer, r.m)}</span>
    </div>`).join('')}
  </div>`;
}

function advTipCard(t, i){
  const ven = t.ven, dov = t.dovnitr;
  const metriky = ADV_METRICS[t.pos];
  const dVen = advDelta(ven), dDov = advDelta(dov);

  const radek = (label, a, b, lepsiVic) => {
    const lepsi = a === b ? '' : (lepsiVic ? (b > a) : (b < a)) ? 'in' : 'out';
    return `<tr class="${lepsi}"><td>${a}</td><th>${label}</th><td>${b}</td></tr>`;
  };

  const fdrVen = advFdr(ven), fdrDov = advFdr(dov);

  return `<div class="advtip">
    <div class="advhead">
      <span class="badge">tip ${i + 1}</span>
      <span class="mute">${ADV_NAMES[t.pos].toLowerCase()} · rozpočet ${
        t.rozpocet.toFixed(1)}m</span>
    </div>
    <div class="advswap">
      <div><b>${esc(ven.web_name)}</b><em>${esc(advTeam(ven.team))} · ${
        advPrice(ven).toFixed(1)}m</em></div>
      <i aria-hidden="true">→</i>
      <div class="r"><b>${esc(dov.web_name)}</b><em>${esc(advTeam(dov.team))} · ${
        advPrice(dov).toFixed(1)}m</em></div>
    </div>
    <table class="advcmp">
      ${metriky.map(m => radek(advFmt(advValue(ven, m), m), m.label,
          advFmt(advValue(dov, m), m), !m.lower)).join('')}
      ${radek(fdrVen == null ? '–' : fdrVen.toFixed(1), 'FDR příští 3',
              fdrDov == null ? '–' : fdrDov.toFixed(1), false)}
      ${radek(String(ven.minutes), 'odehrané minuty', String(dov.minutes), true)}
      ${radek((dVen > 0 ? '+' : '') + dVen.toFixed(1), 'body nad podklad',
              (dDov > 0 ? '+' : '') + dDov.toFixed(1), false)}
    </table>
    <p class="advwhy">${advReason(ven, dov, t.pos, dVen, dDov)}</p>
  </div>`;
}

/* Odůvodnění se skládá z toho, co v datech opravdu je. Věta, která
   zní chytře, ale neodkazuje na žádné číslo z tabulky nad ní, je
   horší než žádná. */
function advReason(ven, dov, pos, dVen, dDov){
  const casti = [];
  const hlavni = ADV_METRICS[pos][0];
  const a = advValue(ven, hlavni), b = advValue(dov, hlavni);

  if(hlavni.lower){
    casti.push(`${esc(dov.web_name)} má ${hlavni.label} ${advFmt(b, hlavni)}
      proti ${advFmt(a, hlavni)}, tedy měkčí obranný profil soupeřů.`);
  }else{
    const nasobek = a > 0.01 ? (b / a).toFixed(1) : null;
    casti.push(`${esc(dov.web_name)} má ${hlavni.label} ${advFmt(b, hlavni)}
      proti ${advFmt(a, hlavni)}${nasobek ? ` — ${nasobek}×` : ''}.`);
  }

  if(dVen > 1.5){
    casti.push(`${esc(ven.web_name)} zároveň nasbíral o ${dVen.toFixed(1)}
      gólového zapojení víc, než odpovídá jeho podkladu; takový náskok
      se obvykle srovná dolů.`);
  }else if(dVen < -1.5){
    casti.push(`Pozor: ${esc(ven.web_name)} naopak zaostává za vlastním
      podkladem o ${Math.abs(dVen).toFixed(1)} — může se to obrátit
      a pak jde o předčasný prodej.`);
  }

  const f1 = advFdr(ven), f2 = advFdr(dov);
  if(f1 != null && f2 != null && f2 < f1 - 0.4){
    casti.push(`Los na tři kola je taky snazší (${f2.toFixed(1)} vs ${f1.toFixed(1)}).`);
  }

  return casti.join(' ');
}

function advPanel(){
  const squad = ADV_SQUAD;
  if(!squad || !squad.length){
    return '<p class="note">Nejdřív si nech načíst sestavu v záložce Sestava.</p>';
  }

  const diag = advDiagnose(squad);
  const merene = diag.reduce((s, d) => s + d.merene, 0);

  /* Málo dat neznamená prázdnou obrazovku. Znamená větu, která řekne
     proč — jinak to vypadá jako rozbitá appka. */
  const prah = advMinMinutes();
  const malo = merene < squad.length / 2 || prah < ADV_MIN_MINUTES
    ? `<p class="note wn">Zatím je odehráno málo minut, takže čísla nesou
       hodně náhody. Do žebříčků teď pouštím hráče od ${prah} minut a
       jejich čísla stahuju k průměru pozice, aby tabulce nevládl jeden
       šťastný výstřel. Spolehlivé to začne být kolem
       ${ADV_MIN_MINUTES} minut na hráče — do té doby ber tipy jako
       orientační.</p>`
    : '';

  const slabina = advWeakest(diag);
  const pos = ADV_POS || (slabina ? slabina.pos : 3);
  const bank = bankValue();
  const tipy = advCandidates(squad, pos, bank);

  const prepinac = `<div class="subnav" role="tablist" aria-label="Pozice">
    ${[1, 2, 3, 4].map(p => `<button type="button" role="tab" data-advpos="${p}"
      aria-selected="${p === pos}">${ADV_NAMES[p]}</button>`).join('')}
  </div>`;

  return `${malo}
    <div class="secline"><h4>Diagnostika kádru</h4>${slabina
      ? `<span class="livetag wn">slabina: ${ADV_NAMES[slabina.pos].toLowerCase()}</span>`
      : ''}</div>
    <div class="advgrid">${diag.map(advDiagCard).join('')}</div>

    <div class="secline"><h4>Tipy na přestup</h4>
      <span class="livetag">banka ${bank.toFixed(1)}m</span></div>
    ${prepinac}
    ${tipy.length
      ? tipy.map(advTipCard).join('')
      : `<p class="note">Na téhle pozici nemám co doporučit — buď na lepšího
         hráče nejsou peníze, nebo tvoji hráči nikoho lepšího nemají.</p>`}

    <p class="advfoot">Metriky pocházejí z FPL API, jehož dodavatelem dat je
      Opta. Sequence involvement, pressures ani Power Rankings ve veřejných
      datech nejsou — kdo je chce, musí na placené rozhraní Stats Performu.</p>`;
}

let ADV_SQUAD = null;

function renderAdvisor(){
  $('advout').innerHTML = `<h2>Přestupový poradce${info(`Poradce porovnává
    tvůj kádr s ligovým průměrem na každé pozici a hledá hráče, jehož
    podkladová čísla nedrží jeho bodový zisk.<br><br>
    <b>xGI</b> je očekávané gólové zapojení (xG + xA). <b>Body nad podklad</b>
    je rozdíl mezi tím, co hráč nasbíral, a tím, co říkají jeho očekávané
    hodnoty — kladné číslo znamená štěstí, které se obvykle srovná dolů,
    záporné hráče, kterého se vyplatí podržet.<br><br>
    Počítá se jen z hráčů s alespoň ${advMinMinutes()} odehranými minutami.
    Bez toho by žebříčkům vládl každý, kdo odehrál dvacet minut a jednou
    vystřelil. V prvních kolech je práh nižší (60 po prvním kole, 120 po
    druhém), jinak by poradce neměl co říct zrovna ve chvíli, kdy se
    kádr staví.<br><br>
    U hráčů s málo odehranými minutami se čísla při řazení stahují
    k průměru pozice — po dvou celých zápasech se počítají zpola za
    vlastní, zpola za průměrné. V tabulkách se pořád ukazuje surová
    hodnota z FPL, stažená se používá jen na pořadí tipů.<br><br>
    Přínos se neslučuje do jednoho čísla. Vedle sebe jsou metriky, los i
    odehrané minuty — závěr si udělej sám, protože jakékoli jediné číslo
    by předstíralo přesnost, kterou ta data nemají.`)}</h2>
    ${advPanel()}`;
}

async function loadAdvisor(){
  $('advmsg').textContent = '';
  if(!ENTRY_ID){ $('advmsg').textContent = 'Nejdřív zadej ID týmu.'; return; }

  try{
    if(!BOOT){ [BOOT, FIX] = await Promise.all([api('bootstrap-static/'), api('fixtures/')]); }

    const cur = BOOT.events.find(e => e.is_current);
    const gw = cur ? cur.id : 1;
    const picks = await cached('entry/' + ENTRY_ID + '/event/' + gw + '/picks/');
    ADV_SQUAD = (picks.picks || [])
      .map(pk => BOOT.elements.find(e => e.id === pk.element))
      .filter(Boolean);

    renderAdvisor();
  }catch(e){
    $('advmsg').textContent = e.message;
  }
}

document.addEventListener('click', ev => {
  const b = ev.target.closest('button[data-advpos]');
  if(b){ ADV_POS = Number(b.dataset.advpos); renderAdvisor(); }
});
