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

const ARCH_V = 1;
const ARCH_KEY = 'sc:gwsnap:';

/* ID ligy, pod kterým archiv leží. Sestavy jsou sice per manažer, ale
   snímek je vždycky snímek celé ligy — jiná liga má jiné členy. */
function snapLid(){
  try{ return String(CONFIG.leagueId || localStorage.getItem('fpl_league') || ''); }
  catch(e){ return String(CONFIG.leagueId || ''); }
}

function snapKey(g){ return ARCH_KEY + snapLid() + ':' + g; }

/* ---------- komprese ---------- */

function packPicks(pk){
  const eh = pk.entry_history || {};
  return {
    c: pk.active_chip || '',
    k: eh.event_transfers_cost || 0,
    b: eh.points || 0,
    p: (pk.picks || []).map(x => [
      x.element, x.position, x.multiplier,
      (x.is_captain ? 1 : 0) | (x.is_vice_captain ? 2 : 0),
    ].join(':')).join(','),
  };
}

function unpackPicks(v){
  return {
    active_chip: v.c || null,
    entry_history: {event_transfers_cost: v.k || 0, points: v.b || 0},
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
function unpackSnap(snap, members){
  if(!snap || snap.v !== ARCH_V || !snap.picks) return null;
  const byEntry = new Map(Object.entries(snap.picks)
    .map(([e, v]) => [Number(e), unpackPicks(v)]));
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

  // Co cloud věděl, ať ví i tenhle prohlížeč — příště bez dotazu.
  if(zCloudu) snapLocalWrite(g, snap);

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
