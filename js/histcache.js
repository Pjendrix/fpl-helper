/* Minileague Squad Check — archiv dohraných kol

   Sestavy a body dohraného kola se už nikdy nezmění. Přesto se
   stahovaly znovu při každém otevření appky: jeden dotaz na kolo za
   body hráčů plus jeden za každého člena ligy za sestavu. U desetičlenné
   ligy to je jedenáct dotazů za kolo, a při deseti kolech víc než sto —
   pokaždé, kdy si někdo klikne na starší kolo v Hubu.

   Odtud pramení i hláška „Za tohle kolo se nepodařilo dopočítat ani
   ceny, ani zprávy“: stačí, aby FPL API na jeden z těch dotazů
   neodpovědělo, a kolo, které je dávno dohrané, zmizí.

   Řešení je archiv. Jakmile se dohrané kolo jednou povede načíst,
   uloží se jeho podstata na dvě místa:

     1. localStorage — okamžitý a bez přihlášení, ale jen v tomhle
        prohlížeči a mizí s vymazáním dat.
     2. Firestore, `leagues/{lid}/gw/{gw}` — sdílené celou ligou.
        Kdo se na kolo podívá první, uloží ho pro ostatní; ti pak
        nesáhnou na FPL API vůbec.

   Zápis do Firestore je jednorázový (`create` bez `update`, stejně
   jako u zamrazených H2H kol). Dohrané kolo je fakt, ne názor —
   kdyby šlo přepsat, byla by to jediná cesta, jak si do historie ligy
   něco propašovat.

   Ukládá se jen to, co ceny a zprávy opravdu potřebují, a v komprimované
   podobě: sestavy jako `element:pozice:násobič:příznak` a body hráčů
   jako `id:body:minuty`. Firestore neumí pole v poli, takže řetězec
   je zároveň jediný rozumný tvar. Kolo desetičlenné ligy vyjde
   zhruba na pět kilobajtů.

   Neukládá se rozehrané ani na bonusy čekající kolo. Tam se čísla
   ještě mění a archiv by z nich udělal nepravdu, která navíc nejde
   přepsat.
   ============================================================ */

/* Verze 2 přidala do snímku řádek historie (`h`). Verze se zvyšuje
   proto, že `create` bez `update` znamená nevratnost: kdyby se ve
   snímcích našla chyba, jediná cesta ven je nechat appku starou verzi
   ignorovat. Snímky v1 se pro sestavy pořád použijí, jen z nich nejde
   poskládat historie. */
/* Verze 3 je oprava, ne nová funkce.

   Ve v2 se snímek dal přebalit sám sebou: `unpackPicks` z něj vytáhlo
   jen `event_transfers_cost` a `points`, ale `packPicks` z toho ohryzku
   zase složilo celý řádek historie — a co v něm chybělo, doplnilo
   nulami. Stačilo, aby snímek jednou prošel povýšením verze nebo
   doplněním chybějícího člena, a v archivu zůstal řádek tvaru
   `body:0:0:0:0:daň:0:0:0`. Sezónní žebříčky z něj pak počítaly nulovou
   lavičku, nula přestupů a nulovou hodnotu kádru — a vypadalo to, že se
   sčítá jen poslední kolo.

   Číslo verze se zvyšuje proto, že to poškození nejde z dat poznat
   zpětně u každého pole: nula je platná hodnota. Snímky v2 se pro
   sestavy pořád použijí (to je ta drahá část), historie se z nich ale
   neskládá — ta se dobere z API a zapíše se znovu už jako v3. */
const ARCH_V = 3;
const ARCH_KEY = 'sc:gwsnap:';

/* ID ligy, pod kterým archiv leží. Sestavy jsou sice per manažer, ale
   snímek je vždycky snímek celé ligy — jiná liga má jiné členy. */
function snapLid(){
  try{ return String(CONFIG.leagueId || localStorage.getItem('fpl_league') || ''); }
  catch(e){ return String(CONFIG.leagueId || ''); }
}

function snapKey(g){ return ARCH_KEY + snapLid() + ':' + g; }

/* ---------- komprese ---------- */

/* Řádek historie kola. Pochází z `entry_history` uvnitř sestav, které
   stahujeme tak jako tak — takže archiv historie nestojí ani jeden
   dotaz navíc, jen pár set bajtů na kolo.

   Pořadí polí je dané a nesmí se měnit; nová se smějí přidávat jen na
   konec, jinak by starší snímky četly čísla posunutá o jedno místo. */
/* Je ten řádek vůbec možný?

   FPL nemá kolo, ve kterém by hodnota kádru byla nula — startuje se na
   100.0 a nikdy neklesne na dno. A `total_points` je součet od začátku
   sezóny, takže nemůže být menší než body toho kola. Řádek, který
   tohle porušuje, nevznikl v FPL: vznikl u nás přebalením neúplných
   dat. Sčítat ho jako nuly znamená tvrdit, že se v tom kole nic nestalo
   — a to je horší než přiznat, že data nemáme. */
function histCredible(h){
  if(!h) return false;
  if(!(Number(h.value) > 0)) return false;
  if(!(Number(h.total_points) >= Number(h.points))) return false;
  return true;
}

/* Vrací prázdný řetězec, když se řádek složit nedá. Prázdné pole `h`
   je poctivé „nevím“; devět nul je lež, kterou nikdo nepozná. */
function packHist(eh){
  if(!histCredible(eh)) return '';
  return [
    eh.points || 0,
    eh.total_points || 0,
    eh.rank || 0,
    eh.overall_rank || 0,
    eh.event_transfers || 0,
    eh.event_transfers_cost || 0,
    eh.points_on_bench || 0,
    eh.value || 0,
    eh.bank || 0,
  ].join(':');
}

function unpackHist(str, gw){
  const n = String(str || '').split(':').map(Number);
  if(n.length < 9) return null;
  if(n.some(x => !Number.isFinite(x))) return null;
  const row = {
    round: gw, event: gw,
    points: n[0], total_points: n[1], rank: n[2], overall_rank: n[3],
    event_transfers: n[4], event_transfers_cost: n[5],
    points_on_bench: n[6], value: n[7], bank: n[8],
  };
  // Řádek poškozený starým přebalením se tváří jako platný — pozná se
  // jen podle toho, že takhle FPL data nikdy neposlalo.
  return histCredible(row) ? row : null;
}

function packPicks(pk){
  const eh = pk.entry_history || {};
  return {
    c: pk.active_chip || '',
    k: eh.event_transfers_cost || 0,
    b: eh.points || 0,
    h: packHist(eh),
    p: (pk.picks || []).map(x => [
      x.element, x.position, x.multiplier,
      (x.is_captain ? 1 : 0) | (x.is_vice_captain ? 2 : 0),
    ].join(':')).join(','),
  };
}

/* Rozbalení musí být inverzní k zabalení, jinak je snímek jednosměrný.

   Tady byla ta chyba: `entry_history` se rekonstruovalo ze dvou polí
   (`k`, `b`), ačkoli celý řádek historie leží vedle v `h`. Kdo pak
   snímek jen prohnal tam a zpátky — povýšení verze, doplnění chybějícího
   člena — uložil místo historie devět nul a sezónní žebříčky ztratily
   lavičku, přestupy i hodnotu kádru.

   `gw` je potřeba, protože řádek nese číslo kola až od nadřazeného
   snímku; bez něj by se historie nedala zařadit. */
function unpackPicks(v, gw){
  const h = unpackHist(v.h, gw);
  const eh = h
    ? {event: gw, points: h.points, total_points: h.total_points,
       rank: h.rank, overall_rank: h.overall_rank,
       event_transfers: h.event_transfers,
       event_transfers_cost: h.event_transfers_cost,
       points_on_bench: h.points_on_bench, value: h.value, bank: h.bank}
    : {event_transfers_cost: v.k || 0, points: v.b || 0};

  return {
    active_chip: v.c || null,
    entry_history: eh,
    picks: String(v.p || '').split(',').filter(Boolean).map(s => {
      const [el, pos, mult, fl] = s.split(':').map(Number);
      return {
        element: el, position: pos, multiplier: mult,
        is_captain: Boolean(fl & 1), is_vice_captain: Boolean(fl & 2),
      };
    }),
  };
}

/* Z bodů kola stačí body a minuty — víc z `event/{gw}/live/` nikdo
   nečte (resolveLineup potřebuje minuty kvůli střídáním, zbytek body).
   Hráči s nulou v obojím se vynechají: mapa je stejně vrací jako nulu
   a je jich většina soupisky. */
function packLive(live){
  const out = [];
  for(const e of (live && live.elements) || []){
    const s = e.stats || {};
    const tp = s.total_points || 0, mn = s.minutes || 0;
    if(tp || mn) out.push(e.id + ':' + tp + ':' + mn);
  }
  return out.join(',');
}

function unpackLive(str){
  return {elements: String(str || '').split(',').filter(Boolean).map(s => {
    const [id, tp, mn] = s.split(':').map(Number);
    return {id, stats: {total_points: tp || 0, minutes: mn || 0}};
  })};
}

/* Snímek se klíčuje podle entry ID, ne podle pořadí v lize. Pořadí se
   mezi koly mění a někdo může do ligy přibýt — index by pak ukázal na
   cizí sestavu. */
function packSnap(g, members, picks, live){
  const P = {};
  members.forEach((m, i) => {
    const pk = picks && picks[i];
    if(!pk || !Array.isArray(pk.picks) || !pk.picks.length) return;
    P[String(m.entry)] = packPicks(pk);
  });
  return {v: ARCH_V, gw: g, picks: P, live: packLive(live)};
}

/* Vrací sestavy zarovnané na aktuální členy ligy a seznam těch, které
   snímek nezná — ty se doberou z API. Kdo do ligy přibyl až po zápisu
   snímku, v něm být nemůže, a to není důvod zahodit zbytek. */
/* Starší snímek se pro sestavy použije dál — jen z něj nejde poskládat
   historie, protože řádek `h` ve v1 chybí. Odmítnout ho úplně by
   znamenalo znovu stahovat kola, která už archivované máme. */
function unpackSnap(snap, members){
  if(!snap || !(snap.v <= ARCH_V) || !snap.picks) return null;
  const byEntry = new Map(Object.entries(snap.picks)
    .map(([e, v]) => [Number(e), unpackPicks(v, snap.gw)]));
  const picks = members.map(m => byEntry.get(m.entry) || null);
  const chybi = members.filter((m, i) => !picks[i]);
  return {picks, live: unpackLive(snap.live), chybi};
}

/* ---------- localStorage ---------- */

function snapLocalRead(g){
  try{
    const raw = localStorage.getItem(snapKey(g));
    return raw ? JSON.parse(raw) : null;
  }catch(e){ return null; }
}

function snapLocalWrite(g, snap){
  try{
    localStorage.setItem(snapKey(g), JSON.stringify(snap));
  }catch(e){
    /* Plná kvóta. Archiv je pohodlí, ne nutnost — zahodíme ho celý
       a příště se to povede. Mazat po jednom nemá cenu: snímky jsou
       stejně velké, takže by se to opakovalo za dvě kola znovu. */
    try{
      for(const k of Object.keys(localStorage))
        if(k.startsWith(ARCH_KEY)) localStorage.removeItem(k);
      localStorage.setItem(snapKey(g), JSON.stringify(snap));
    }catch(e2){}
  }
}

/* Archiv patří lize, ne uživateli — při přepnutí na jiné entry ID
   v téže lize nemá co mizet. Volá se jen z odhlášení. */
function snapClear(){
  try{
    for(const k of Object.keys(localStorage))
      if(k.startsWith(ARCH_KEY)) localStorage.removeItem(k);
  }catch(e){}
}

/* ---------- Firestore ---------- */

/* Sdílená kola se čtou najednou, jedním dotazem na celou kolekci.
   Cache v paměti proto, že Hub se ptá po každém přepnutí kola. */
let SNAP_CLOUD = null;

async function snapCloudAll(){
  const lid = snapLid();
  if(!lid || !window.FB || !window.FB.gwRead) return {};
  if(SNAP_CLOUD) return SNAP_CLOUD;
  if(typeof authReady === 'function') await authReady();
  try{
    SNAP_CLOUD = await window.FB.gwRead(lid);
  }catch(e){
    // Nepřihlášený uživatel dostane permission-denied. Není to chyba,
    // jen si archiv ligy nepřečte a půjde na API.
    SNAP_CLOUD = {};
  }
  return SNAP_CLOUD;
}

/* Poslední výsledek zápisu do cloudu, k přečtení z konzole přes
   `debugArchiv()`. Původně tahle funkce polykala každou chybu s
   odůvodněním, že „už tam je“ ani „nepřihlášený“ nemá koho zajímat.
   To byla chyba: tím se zahodily i chyby, které zajímají hodně —
   chybějící pravidlo, špatné ID ligy, vadný tvar dokumentu — a zvenku
   byly všechny k nerozeznání od úspěchu.

   Uživatele to pořád neotravuje. Archiv je pohodlí, ne funkce, a když
   selže, appka jede dál z API. Ale ten důvod se dá zjistit. */
let SNAP_LAST = 'zatím se nezapisovalo';

async function snapCloudWrite(g, snap){
  const lid = snapLid();
  if(!lid){ SNAP_LAST = 'není ID ligy'; return; }
  if(!window.FB || !window.FB.gwWrite){ SNAP_LAST = 'Firebase není načtený'; return; }

  /* Počkat, až Firebase dořeší session. Bez toho se zápis odehraje
     dřív, než se obnoví přihlášení, pravidla ho odmítnou a archiv se
     do sdíleného úložiště nedostane — přestože je člověk přihlášený a
     v hlavičce to tak vypadá. */
  if(typeof authReady === 'function') await authReady();
  if(!window.FB_USER && typeof FB_USER !== 'undefined' && !FB_USER){
    SNAP_LAST = 'nepřihlášen — kolo zůstalo jen lokálně';
    return;
  }

  try{
    await window.FB.gwWrite(lid, g, snap);
    if(SNAP_CLOUD) SNAP_CLOUD[String(g)] = snap;
    SNAP_LAST = 'GW' + g + ' zapsáno do ligy ' + lid;
  }catch(e){
    SNAP_LAST = 'GW' + g + ' selhalo: ' + (e && e.code || e);
  }
}

/* Co archiv právě dělá. Bez tohohle se stav dá zjistit jen hádáním,
   protože všechny cesty selhávají tiše. */
function debugArchiv(){
  const lokalni = Object.keys(localStorage).filter(k => k.startsWith(ARCH_KEY));
  return {
    liga: snapLid() || '(prázdné!)',
    prihlasen: Boolean(window.FB_USER),
    lokalneUlozeno: lokalni,
    cloudVPameti: SNAP_CLOUD ? Object.keys(SNAP_CLOUD) : '(ještě nečteno)',
    posledniZapis: SNAP_LAST,
  };
}

/* ---------- veřejné rozhraní ---------- */

/* Zkusí kolo poskládat z archivu. Vrací true, když se to povedlo
   natolik, že se na API nemusí sáhnout vůbec. */
async function snapLoad(g, members){
  let snap = snapLocalRead(g);
  let zCloudu = false;

  if(!snap){
    const all = await snapCloudAll();
    snap = all && all[String(g)];
    zCloudu = Boolean(snap);
  }

  const u = snap && unpackSnap(snap, members);
  if(!u || !u.live.elements.length) return false;

  /* Data mezi lokálem a cloudem musí téct oběma směry.

     Dřív tekla jen jedním: co bylo v cloudu, doplnilo se do lokálu.
     Opačně nic — a protože `nactiKolo` se po úspěšném `snapLoad` hned
     vrací, `snapSave` už se nezavolal. Kolo, které se jednou uložilo
     lokálně, se tak do cloudu nedostalo nikdy. Zvenku to vypadalo, že
     zápis do Firestore selhává, ale on se prostě nespouštěl. */
  if(zCloudu){
    snapLocalWrite(g, snap);
  } else {
    // Snímek je z lokálu. Když ho cloud nemá, patří tam — ostatní v
    // lize si ho pak nestáhnou z FPL vůbec.
    const vCloudu = await snapCloudAll();
    const tam = vCloudu && vCloudu[String(g)];
    if(!tam) await snapCloudWrite(g, snap);
  }

  /* Starý snímek se povýší na aktuální verzi. Data pro to jsou po ruce
     — sestavy nesou `entry_history`, ze kterého se řádek historie
     skládá — takže povýšení nestojí ani jeden dotaz navíc. Bez něj by
     kolo archivované starší verzí appky zůstalo bez historie napořád. */
  if(snap.v < ARCH_V && u.picks.every(Boolean)){
    const novy = packSnap(g, members, u.picks, u.live);
    snapLocalWrite(g, novy);
    await snapCloudWrite(g, novy);
  }

  NEWS_LIVE.set(g, u.live);

  /* Chybějící členy dobereme jednotlivě. Sdílený snímek nepřepisujeme —
     je záměrně jednorázový — ale lokální kopii ano, aby se to podruhé
     neopakovalo. */
  if(u.chybi.length){
    const dopl = await pooled(u.chybi,
      m => cached('entry/' + m.entry + '/event/' + g + '/picks/'), 5);
    u.chybi.forEach((m, j) => {
      const i = members.indexOf(m);
      if(i >= 0 && dopl[j] && dopl[j].picks) u.picks[i] = dopl[j];
    });
    if(u.picks.every(Boolean))
      snapLocalWrite(g, packSnap(g, members, u.picks, u.live));
  }

  NEWS_PICKS.set(g, u.picks);
  return true;
}

/* Historie ligy poskládaná z archivu.

   Tohle je tam, kde se archiv vyplatí nejvíc. `entry/{id}/history/` je
   dotaz NA ČLENA — deset členů znamená deset dotazů při každém otevření
   Hubu i Miniligy, u stočlenné ligy sto. Přitom všechna dohraná kola
   jsou v archivu a to běžící umí dodat pořadí ligy, které je stažené
   tak jako tak.

   Vrací null, když archiv nestačí. Raději poctivě sáhnout na API než
   vykreslit tabulku s dírami — chybějící kolo v historii totiž není
   vidět jako chyba, jen jako jiná čísla.

   Nedodává `past` (minulé sezóny). Ty archiv nezná a ani znát nemůže,
   takže tabulka sezónní historie si o svoje data musí říct sama. */
async function snapHists(members, curId){
  if(!members || !members.length || !curId) return null;

  const cloud = await snapCloudAll();
  const snapy = new Map();

  for(let g = 1; g < curId; g++){
    if(gwPhase(g) !== 'final') continue;      // rozehrané kolo archiv nemá
    const snap = snapLocalRead(g) || (cloud && cloud[String(g)]);
    // Jedno chybějící nebo staré kolo shodí celou úsporu. Je to tvrdé,
    // ale míchat archiv s API po kolech by znamenalo stejně tolik dotazů.
    if(!snap || snap.v !== ARCH_V || !snap.picks) return null;
    snapy.set(g, snap);
  }
  if(!snapy.size) return null;

  /* Smyčka, ne `members.map`. V mapě se `return null` týkal jen jednoho
     člena: pole se vrátilo s dírou, volající viděl „archiv stačil“ a
     tomu jednomu se sečetly nuly. Chybějící historie musí shodit celou
     cestu, jinak je to zase tichá chyba. */
  const out = [];
  for(const m of members){
    const current = [], chips = [];

    for(const [g, snap] of snapy){
      const v = snap.picks[String(m.entry)];
      if(!v) continue;                        // do ligy přibyl později
      const row = unpackHist(v.h, g);
      if(!row) return null;                   // snímek bez historie
      current.push(row);
      if(v.c) chips.push({name: v.c, event: g});
    }

    /* Běžící kolo v archivu není a být nesmí. Pořadí ligy ale jeho body
       zná — je to tentýž údaj, který používá gwRows, když historie od
       FPL ještě nedoběhla.

       Co pořadí ligy NEZNÁ, se sem nepíše jako nula. Dřív tu stálo
       `event_transfers: 0, points_on_bench: 0, value: 0` a sezónní
       žebříčky to sečetly jako fakt — hodnota kádru z posledního řádku
       vyšla nula, takže „Efektivita kádru“ hlásila 0.0 celé lize.
       Chybějící údaj je `null`; `zeStandings` říká proč. Doplní ho
       `snapPatchCurrent()` ze sestav, které se stahují tak jako tak. */
    if(Number.isFinite(m.event_total))
      current.push({round: curId, event: curId, points: m.event_total,
                    total_points: m.total, rank: null, overall_rank: null,
                    event_transfers: null, event_transfers_cost: null,
                    points_on_bench: null, value: null, bank: null,
                    zeStandings: true});

    current.sort((a, b) => a.round - b.round);
    out.push({current, chips, past: []});
  }
  return out;
}

/* Doplní běžící kolo do historie ze sestav.

   `entry/{gw}/picks/` nese `entry_history` — tentýž řádek, jaký by
   přišel z `entry/{id}/history/`, jen za jedno kolo. Hub i Miniliga si
   sestavy stahují tak jako tak, takže tohle nestojí ani jeden dotaz
   navíc a přitom je to jediná cesta, jak se do sezónních součtů dostane
   lavička, přestupy a hodnota kádru z rozehraného kola.

   Sahá se jen na řádek označený `zeStandings` — ten je náš. Řádek od
   FPL se nepřepisuje: co přišlo z historie, je autoritativní.

   Nemutuje vstup naslepo: když sestavy chybí nebo nemají
   `entry_history`, nechá řádek být i s jeho `null` poli. */
function snapPatchCurrent(hists, picks, curId){
  if(!Array.isArray(hists) || !Array.isArray(picks)) return hists;

  hists.forEach((h, i) => {
    if(!h || !Array.isArray(h.current)) return;
    const row = h.current.find(x => x.round === curId && x.zeStandings);
    if(!row) return;

    const eh = picks[i] && picks[i].entry_history;
    if(!eh) return;

    const num = v => (Number.isFinite(Number(v)) ? Number(v) : null);
    row.event_transfers      = num(eh.event_transfers);
    row.event_transfers_cost = num(eh.event_transfers_cost);
    row.points_on_bench      = num(eh.points_on_bench);
    row.value                = num(eh.value);
    row.bank                 = num(eh.bank);

    /* Body z pořadí ligy jsou živější než z `entry_history`, takže se
       nepřepisují. Součet ale ano, když ho standings neznaly. */
    if(!Number.isFinite(row.total_points)) row.total_points = num(eh.total_points);

    // Řádek už není jen z pořadí — ví o sobě všechno, co ostatní.
    if(row.event_transfers !== null && row.points_on_bench !== null)
      delete row.zeStandings;
  });

  return hists;
}

/* Uloží kolo do archivu. Volá se až po úspěšném načtení z API a jen
   pro kolo, které je celé dopočítané — jinak by se zamrazila čísla,
   která se ještě pohnou. */
function snapSave(g, members, picks, live){
  if(!live || !(live.elements || []).length) return;
  if(!picks || !picks.length || !picks.every(p => p && p.picks && p.picks.length)) return;

  const snap = packSnap(g, members, picks, live);
  snapLocalWrite(g, snap);
  snapCloudWrite(g, snap);
}
