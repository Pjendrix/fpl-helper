/* Minileague Squad Check — synchronizace nastavení

   Firebase přihlášení a zrcadlení nastavení do Firestore. localStorage
   zůstává zdrojem pravdy, Firestore je záloha slučovaná podle _ts.

   Soubory js/ se načítají jako klasické <script> v pevném pořadí a
   sdílejí jeden globální scope: nic se neexportuje ani neimportuje,
   ale hoisting přes hranici souboru neplatí. Pořadí je proto součást
   kontraktu a je vypsané v index.html.
   ============================================================ */
/* ============================================================
   SYNCHRONIZACE NASTAVENÍ

   Watchlist, prodejní ceny, banka, volné přestupy i téma žily
   v localStorage. Funguje to, dokud člověk používá jeden prohlížeč —
   na telefonu má prázdný watchlist a diví se.

   Firestore tady není databáze appky, jen záloha localStorage.
   Zdrojem pravdy zůstává prohlížeč: appka čte pořád z localStorage
   a funguje i offline, bez přihlášení a bez vyplněného configu.
   Cloud se do toho vloží jen dvakrát — při přihlášení (stáhni a slej)
   a po každé změně (zapiš, se zpožděním).

   Slučování je last-write-wins po jednotlivých klíčích. U dvou
   zařízení téhož člověka je konflikt vzácný a „vyhraje novější
   změna“ je chování, které nikoho nepřekvapí. Časy si držíme sami
   v mapě `_ts`, protože Firestore zná jen čas zápisu celého dokumentu.
   ============================================================ */

/* Zálohujeme jen vlastní klíče. Prefix je zároveň pojistka proti tomu,
   abychom někomu do cloudu nahráli localStorage cizí knihovny. */
const SYNC_PREFIX = 'fpl_';
const TS_KEY = 'fpl_sync_ts';

let FB_USER = null;
let SYNC_TIMER = null;
let SYNC_READY = false;

function syncTimes(){
  try{ return JSON.parse(localStorage.getItem(TS_KEY) || '{}'); }
  catch(e){ return {}; }
}

function markWritten(key){
  const t = syncTimes();
  t[key] = Date.now();
  try{ localStorage.setItem(TS_KEY, JSON.stringify(t)); }catch(e){}
}

/* Zápis do localStorage, který o sobě dá vědět synchronizaci.
   Všechna místa v appce, která něco ukládají, jdou přes tyhle dvě
   funkce — jinak by se změna do cloudu nikdy nedostala. */
function lsSet(key, value){
  try{ localStorage.setItem(key, value); }catch(e){ return; }
  markWritten(key);
  scheduleSync();
}

function lsDel(key){
  try{ localStorage.removeItem(key); }catch(e){ return; }
  markWritten(key);
  scheduleSync();
}

/* Co se má nahrát. Mazání řešíme prázdným řetězcem, ne vynecháním —
   jinak by se smazaný klíč při dalším stažení vrátil z cloudu zpátky. */
function syncPayload(){
  const data = {}, ts = syncTimes();
  for(let i = 0; i < localStorage.length; i++){
    const k = localStorage.key(i);
    if(!k || !k.startsWith(SYNC_PREFIX) || k === TS_KEY) continue;
    data[k] = localStorage.getItem(k);
  }
  // Klíče, které tu byly a už nejsou, musí do cloudu jako smazané.
  Object.keys(ts).forEach(k => { if(!(k in data)) data[k] = ''; });
  return {keys: data, _ts: ts};
}

function scheduleSync(){
  if(!FB_USER || !window.FB || !SYNC_READY) return;
  // Naklikání pěti hvězdiček za sebou má být jeden zápis, ne pět.
  clearTimeout(SYNC_TIMER);
  SYNC_TIMER = setTimeout(pushSync, 1200);
}

async function pushSync(){
  if(!FB_USER || !window.FB) return;
  try{
    await window.FB.write(FB_USER.uid, syncPayload());
    setSyncStatus('uloženo');
  }catch(e){
    setSyncStatus('nepodařilo se uložit');
  }
}

/* Stažení a sloučení. Volá se jednou, hned po přihlášení. */
async function pullSync(){
  if(!FB_USER || !window.FB) return;
  setSyncStatus('načítám…');
  try{
    const remote = await window.FB.read(FB_USER.uid);
    if(remote && remote.keys){
      const mine = syncTimes();
      const theirs = remote._ts || {};
      let changed = 0;

      Object.entries(remote.keys).forEach(([k, v]) => {
        if(!k.startsWith(SYNC_PREFIX) || k === TS_KEY) return;
        // Novější vyhrává. Když čas nikde není, bereme cloud jako
        // výchozí — na čerstvém zařízení je localStorage stejně prázdný.
        if((theirs[k] || 0) <= (mine[k] || 0)) return;
        if(v === '') localStorage.removeItem(k);
        else localStorage.setItem(k, v);
        mine[k] = theirs[k];
        changed++;
      });

      if(changed){
        try{ localStorage.setItem(TS_KEY, JSON.stringify(mine)); }catch(e){}
        // Watchlist i sestava se čtou do paměti při startu — po slití
        // z cloudu je musíme zahodit, aby se načetly znovu.
        WATCH = null;
        drawHome();
        if(TAB_DONE.has('t-prices')){ TAB_DONE.delete('t-prices'); loadPrices(); }
      }
      setSyncStatus(changed ? changed + ' položek staženo' : 'aktuální');
    } else {
      setSyncStatus('aktuální');
    }
    SYNC_READY = true;
    // První nahrání po přihlášení: cloud ještě nemusí mít nic.
    await pushSync();
  }catch(e){
    SYNC_READY = true;
    setSyncStatus('nepodařilo se načíst');
  }
}

function setSyncStatus(txt){
  const el = $('syncmsg');
  if(el){ el.textContent = txt; el.hidden = !txt; }
}

/* Věta o tom, kde data leží. Používá se všude, kde si appka něco
   pamatuje — watchlist, prodejní ceny, plánovač. Jedna funkce proto,
   aby se znění nerozešlo: jakmile by na třech místech stálo něco
   trochu jiného, přestane tomu člověk věřit.

   Text se mění podle stavu, ne podle místa. Nepřihlášený se musí
   dozvědět, že o data přijde s vymazáním prohlížeče; přihlášený,
   že se mu zálohují a kam. */
function storageNote(co){
  const vec = co || 'Tenhle seznam';

  if(!window.FB)
    return `<p class="note store">${esc(vec)} se ukládá jen v tomhle prohlížeči.
      Na jiném zařízení ho neuvidíš a smazáním dat prohlížeče o něj přijdeš.</p>`;

  if(FB_USER)
    return `<p class="note store ok">${esc(vec)} se zálohuje na tvůj účet
      <b>${esc(FB_USER.email || FB_USER.displayName || 'Google')}</b>, takže ho
      máš i na telefonu. Změny se ukládají samy pár vteřin po úpravě.</p>`;

  return `<p class="note store">${esc(vec)} se ukládá jen v tomhle prohlížeči —
    na telefonu ho neuvidíš a smazáním dat prohlížeče o něj přijdeš.
    <button type="button" class="lnkbtn inline" data-signin>Přihlas se přes Google</button>
    a bude se zálohovat na tvůj účet.</p>`;
}

/* Přihlášení jde vyvolat i odjinud než z hlavičky — typicky z poznámky
   u watchlistu, kde se o něm člověk poprvé dozví. */
document.addEventListener('click', ev => {
  if(!ev.target.closest('button[data-signin]')) return;
  const btn = $('gauth');
  if(btn && !btn.hidden) btn.click();
});

function renderAuth(){
  const btn = $('gauth');
  if(!btn) return;

  if(!window.FB){
    // Nevyplněný config není chyba, jen vypnutá funkce.
    btn.hidden = true;
    return;
  }
  btn.hidden = false;
  btn.textContent = FB_USER
    ? (FB_USER.displayName || FB_USER.email || 'Odhlásit')
    : 'Přihlásit';
  btn.title = FB_USER
    ? 'Přihlášen jako ' + (FB_USER.email || FB_USER.displayName) + ' — kliknutím odhlásit'
    : 'Přihlásit se přes Google a synchronizovat watchlist mezi zařízeními';
  btn.classList.toggle('on', Boolean(FB_USER));

  /* Poznámky o ukládání znějí jinak pro přihlášeného a nepřihlášeného,
     takže po změně stavu musí ven ty staré. Překreslujeme jen to, co je
     zrovna vidět — celý panel by zbytečně blikl. */
  if(BOOT){
    drawHome();
    if(TAB_DONE.has('t-prices') && !$('p-prices').hidden) loadPrices();
  }
}

/* Slib, který se splní, jakmile Firebase dořeší, kdo je přihlášený.

   Obnovení session je asynchronní: chvíli po startu stránky je FB_USER
   ještě null, i když se člověk přihlásil minule. Kdokoli, kdo se ptá
   „jsem přihlášen?“ dřív, dostane falešné ne — a v případě archivu to
   znamenalo, že se kolo tiše neuložilo do sdíleného úložiště, protože
   pravidla nepřihlášeného odmítnou.

   `onUser` se zavolá i pro nepřihlášeného, jen s null. Je to tedy
   spolehlivý signál „už se ví“, ne „někdo je přihlášen“. */
let AUTH_HOTOVO = null;

function authReady(){
  if(!window.FB) return Promise.resolve(null);
  return AUTH_HOTOVO || Promise.resolve(FB_USER);
}

function initAuth(){
  renderAuth();
  if(!window.FB) return;

  let hotovo;
  AUTH_HOTOVO = new Promise(res => { hotovo = res; });

  window.FB.onUser(user => {
    if(hotovo){ hotovo(user || null); hotovo = null; }
    FB_USER = user || null;
    SYNC_READY = false;
    /* Archiv kol je pro nepřihlášeného nečitelný, takže po přihlášení
       musí jít dotaz znovu — jinak by v paměti zůstalo prázdno. */
    SNAP_CLOUD = null;
    /* Členství visí na účtu, takže po přihlášení i odhlášení se musí
       zjistit znovu — jinak by se odemčený box nabízel dál. */
    LIGA_STAV = null;
    LIGA_CHYBA = '';
    renderAuth();
    if(FB_USER) pullSync();
    else setSyncStatus('');
  });

  $('gauth').addEventListener('click', async () => {
    try{
      if(FB_USER){
        // Odhlášení nechává localStorage být — data zůstanou v prohlížeči,
        // jen se přestanou zálohovat. Mazat cizí watchlist při odhlášení
        // by bylo překvapivé.
        await window.FB.signOut();
      } else {
        setSyncStatus('přihlašuji…');
        await window.FB.signIn();
      }
    }catch(e){
      setSyncStatus(e && e.code === 'auth/popup-closed-by-user'
        ? '' : 'přihlášení se nepovedlo');
    }
  });
}

// Modul s Firebase se načítá asynchronně, takže na něj musíme počkat.
if(window.FB) initAuth();
else window.addEventListener('fb-ready', initAuth, {once: true});

/* ============================================================
   KÓD LIGY

   Sdílený archiv (losování H2H a dohraná kola) je pro celou ligu, ne
   pro jednoho člověka. Pravidla Firestore se proto musí ptát „patříš
   do téhle ligy?“ — a na to neumějí odpovědět sama: čtou jen Firestore,
   na FPL API nedosáhnou.

   Odpověď tedy vkládá člověk. Majitel ligy jednou založí v konzoli
   Firebase dokument s kódem a rozešle ho; každý člen ho jednou zadá
   a tím si založí členství. Od té chvíle se kód nikde nedrží ani
   neposílá — pravidla se ptají jen na existenci toho členství.

   Není to autentizace, je to zámek na chatě. Data jsou stejně veřejná;
   chrání se možnost je poškodit, protože zamrazené kolo nejde přepsat
   ničím jiným než novější verzí.

   Stavy:
     null       — ještě se neptalo
     'nelze'    — bez Firebase nebo bez ID ligy; není o čem mluvit
     'anonym'   — Firebase je, ale nikdo není přihlášen
     'zamceno'  — přihlášen a členství nemá; tady se nabízí kód
     'clen'     — hotovo
   ============================================================ */
let LIGA_STAV = null;
let LIGA_CHYBA = '';
let LIGA_CEKA = null;   // rozdělaný dotaz, ať se neptáme třikrát naráz

function ligaId(){
  return String(CONFIG.leagueId || localStorage.getItem(LEAGUE_KEY) || '');
}

/* Zjistí stav a překreslí, když se změnil. Vrací se `LIGA_STAV`, ale
   volající ho většinou nepotřebuje — jde o ten překreslený box. */
async function ligaZjisti(){
  const puvodni = LIGA_STAV;
  const lid = ligaId();

  if(!window.FB || !window.FB.ligaClen || !lid) LIGA_STAV = 'nelze';
  else {
    if(typeof authReady === 'function') await authReady();
    if(!FB_USER) LIGA_STAV = 'anonym';
    else if(LIGA_CEKA) return LIGA_CEKA;
    else {
      LIGA_CEKA = (async () => {
        try{
          LIGA_STAV = await window.FB.ligaClen(lid, FB_USER.uid) ? 'clen' : 'zamceno';
        }catch(e){
          /* Vlastní dokument členství smí číst každý přihlášený, takže
             tohle není „nemáš právo“ — spíš spadlá síť. Chovat se k tomu
             jako k zámku by znamenalo nabízet kód někomu, kdo ho už
             zadal. */
          LIGA_STAV = 'zamceno';
          LIGA_CHYBA = 'Stav členství se nepodařilo ověřit.';
        }finally{ LIGA_CEKA = null; }
        return LIGA_STAV;
      })();
      await LIGA_CEKA;
    }
  }

  if(LIGA_STAV !== puvodni && BOOT && typeof drawHome === 'function') drawHome();
  return LIGA_STAV;
}

/* Box s polem na kód. Vrací prázdno vždycky, když není co řešit —
   proto se dá zavolat bezpodmínečně z `drawHome()` a nemusí se nikde
   větvit. */
function ligaNote(){
  if(!window.FB || !ligaId()) return '';

  // První průchod se jen zeptá; překreslí se, až bude vědět.
  if(LIGA_STAV === null){ ligaZjisti(); return ''; }
  if(LIGA_STAV === 'clen' || LIGA_STAV === 'nelze' || LIGA_STAV === 'anonym') return '';

  return `<div class="hbox ligakod">
    <h3><i class="hi">🔑</i>Archiv ligy je zamčený</h3>
    <p class="note">Losování H2H a dohraná kola se sdílejí s ligou, takže
      appka potřebuje vědět, že do ní patříš. Zadej kód, který ti přišel —
      stačí jednou na tomhle účtu.</p>
    <p class="ligarow">
      <input id="ligakod" type="text" autocomplete="off" spellcheck="false"
        placeholder="kód ligy" aria-label="Kód ligy">
      <button type="button" class="small" data-ligaodemkni>Odemknout</button>
    </p>
    ${LIGA_CHYBA ? `<p class="note bad" role="alert">${esc(LIGA_CHYBA)}</p>` : ''}
    <p class="note">Bez kódu appka funguje dál: dvojice se dopočítají
      v prohlížeči a kola se ukládají lokálně. Nesdílí se jen napříč ligou.</p>
  </div>`;
}

document.addEventListener('click', async ev => {
  const btn = ev.target.closest('[data-ligaodemkni]');
  if(!btn) return;

  const pole = $('ligakod');
  /* Kód chodí do chatu, kde ho lidi kopírují i s mezerou navíc, a psaní
     malým písmem je běžnější než velkým. Normalizuje se proto tady —
     pravidla porovnávají přesně a poradit si s tím nemůžou. */
  const kod = ((pole && pole.value) || '').trim().toUpperCase();
  if(!kod){ LIGA_CHYBA = 'Kód je prázdný.'; drawHome(); return; }

  btn.disabled = true;
  btn.textContent = 'Odemykám…';
  LIGA_CHYBA = '';

  try{
    await window.FB.ligaOdemkni(ligaId(), FB_USER.uid, kod);
    LIGA_STAV = 'clen';
    SNAP_CLOUD = null;         // archiv byl nečitelný, teď se má načíst
    H2H_FROZEN_LID = null;     // totéž pro zamrazená kola
    drawHome();
  }catch(e){
    /* Pravidla vrátí permission-denied jak na špatný kód, tak na ligu,
       kterou majitel ještě nezaložil. Zvenku je to k nerozeznání, takže
       hláška musí připustit obojí — tvrdit „špatný kód“ někomu, kdo ho
       má správný, je horší než přiznat, že to appka neví. */
    LIGA_CHYBA = 'Nepovedlo se. Buď kód nesedí, nebo liga v databázi '
      + 'ještě není založená — zeptej se toho, kdo ti kód poslal.';
    drawHome();
  }
});

/* ============ VSTUPNÍ OBRAZOVKA ============
   Nic se nestahuje, dokud uživatel nezadá ID. Jednotlivé záložky si
   pak data tahají samy, až když na ně přijde řada.
*/
const ENTRY_KEY = 'fpl_entry';
const LEAGUE_KEY = 'fpl_league';

/* Kompletní úklid při přepnutí týmu.

   Bez tohohle zůstaly v paměti sestava, vlastnictví v lize i rozpracovaná
   analýza přestupů z předchozího ID — nový tým pak viděl cizí čísla. */
function resetState(){
  /* Společná část je v `resetVolatile()` v core.js — cache, záložky,
     Hub, zpravodaj, H2H a příznaky. Tady zůstává jen to, co je vlastní
     přepnutí týmu: kádr, kolejnice, watchlist a vyprázdnění panelů. */
  resetVolatile();

  if(RAIL_TIMER){ clearInterval(RAIL_TIMER); RAIL_TIMER = null; }
  const rail = $('rail'); if(rail) rail.hidden = true;
  const rk = $('railKey'); if(rk) rk.hidden = true;

  MY_SQUAD = null;
  HOME = null;
  WATCH = null;          // watchlist je per entry ID, nový tým má svůj
  SNAP_CLOUD = null;     // archiv kol se čte podle ligy, ne podle týmu
  CMP_A = CMP_B = null;

  /* Všechny výstupní kontejnery, ne jen některé. Poradce, H2H,
     Zpravodaj a Zranění tady dřív chyběly, takže po přepnutí týmu
     chvíli svítila diagnóza cizího kádru — než si nová záložka
     sáhla na data, koukal člověk na výsledky předchozího ID. */
  ['hmout','out','msg','lout','lmsg','hubout','hubmsg','pout','pmsg','pdetail',
   'trout','trmsg','plout','plmsg','prout','prmsg',
   'plnout','plnmsg','pcompare',
   'advout','advmsg','h2hout','h2hmsg','newsout','newsmsg',
   'injout','injmsg'].forEach(id => {
    const el = $(id);
    if(el) el.innerHTML = '';
  });
}

/* Sprite s barevnými značkami klubů. Slouží jako záloha, když odznak
   na CDN chybí (typicky čerstvý nováček). Načítáme ho až po vstupu
   do appky — na vstupní obrazovce by byl k ničemu. */
let MARKS_LOADED = false;
async function loadClubMarks(){
  if(MARKS_LOADED) return;
  MARKS_LOADED = true;
  try{
    const r = await fetch('/club-marks.svg');
    if(!r.ok) return;
    const host = document.createElement('div');
    host.hidden = true;
    host.innerHTML = await r.text();
    document.body.appendChild(host);
  }catch(e){
    // Bez spritu se u chybějícího odznaku prostě nic nezobrazí.
    // Není to důvod cokoli hlásit uživateli.
  }
}

function enterApp(entryId, leagueId){
  resetState();
  ENTRY_ID = parseInt(entryId, 10);
  CONFIG.entryId = entryId;
  CONFIG.leagueId = leagueId || '';
  lsSet(ENTRY_KEY, entryId);
  if(leagueId) lsSet(LEAGUE_KEY, leagueId);
  else lsDel(LEAGUE_KEY);

  $('landing').hidden = true;
  $('app').hidden = false;
  // Než dorazí entry/{id}/, je ID jediné, co o týmu víme. load() ho
  // vzápětí přepíše na název týmu a iniciály přes setWhoName().
  $('whoName').textContent = '#' + entryId;
  // V režimu jedné ligy má smysl mít v hlavičce její název, ne obecný nadpis.
  const bt = $('brandTop');
  if(bt && CONFIG.leagueName){
    bt.textContent = CONFIG.leagueName;
    // Dlouhý název se sází menším písmem, aby se vešel do dvou řádků
    // vedle segmentu; krátký zůstane velký.
    bt.classList.toggle('long', CONFIG.leagueName.length > 18);
    bt.title = CONFIG.leagueName + ' · Squad Check';
  }

  // ligové záložky nedávají smysl bez ID ligy
  const hasLeague = Boolean(leagueId);
  ['t-league','t-hub'].forEach(id => {
    $(id).disabled = !hasLeague;
    $(id).title = hasLeague ? '' : 'Zadej ID miniligy';
  });

  loadClubMarks();
  /* Odkaz typu `#h2h/gw7` otevře rovnou to, na co míří — ale až po
     načtení sestavy, protože dřív nemá záložka co zobrazit. */
  load(entryId).then(() => { if(typeof applyHash === 'function') applyHash(); });
  window.scrollTo(0, 0);
}

/* ------------------------------------------------------------------
   Vstupní obrazovka ve dvou režimech.

   S vyplněným CONFIG.leagueId si stáhneme soupisku a nabídneme seznam
   jmen — nikdo pak nemusí hledat svoje entry ID v adrese FPL. Ruční
   zadání zůstává schované pod odkazem, protože do ligy může někdo
   přibýt dřív, než se soupiska přenačte.

   Bez leagueId se chová appka jako dřív, se dvěma poli.
   ------------------------------------------------------------------ */
let GATE_MEMBERS = null;
let MANUAL_MODE = !CONFIG.leagueId;

function setGateMode(manual){
  MANUAL_MODE = manual;
  $('manualFields').hidden = !manual;
  $('pickField').hidden = manual || !CONFIG.leagueId;
  const t = $('manualToggle');
  if(t) t.textContent = manual && CONFIG.leagueId
    ? '← Zpět na seznam členů ligy'
    : 'Nejsem na seznamu — zadám ID ručně';
}

async function bootstrapGate(){
  if(CONFIG.leagueName) $('gateTitle').textContent = CONFIG.leagueName;

  if(!CONFIG.leagueId){ setGateMode(true); return; }

  setGateMode(false);
  $('manualToggle').hidden = false;

  try{
    const st = await api('leagues-classic/' + CONFIG.leagueId + '/standings/');
    GATE_MEMBERS = (st.standings && st.standings.results) || [];
    if(!CONFIG.leagueName && st.league) $('gateTitle').textContent = st.league.name;

    if(!GATE_MEMBERS.length){
      $('whoami').innerHTML = '<option value="">Liga je zatím prázdná</option>';
      setGateMode(true);
      return;
    }

    const last = localStorage.getItem(ENTRY_KEY);
    $('whoami').innerHTML = '<option value="">Vyber se ze seznamu…</option>'
      + GATE_MEMBERS.map(m => `<option value="${m.entry}"${
          String(m.entry) === String(last) ? ' selected' : ''
        }>${esc(m.player_name)} — ${esc(m.entry_name)}</option>`).join('');

    $('gateSub').textContent =
      `${GATE_MEMBERS.length} manažerů. Vyber se a uvidíš svůj kádr, ligu i přestupy.`;
  }catch(e){
    // Když se soupiska nenačte, není důvod nikoho blokovat — jen přepneme
    // na ruční zadání a řekneme proč.
    //
    // Tohle je obrazovka, na kterou člověk kouká jako první, takže se tu
    // nesmí objevit jen technická hláška: bez tlačítka „Zkusit znovu“
    // zbyde nabídka, která nic nedělá, a jediné řešení je refresh — což
    // nikdo neuhodne.
    $('gatemsg').innerHTML =
      'Seznam členů ligy se teď nenačetl. FPL API občas chvíli neodpovídá. '
      + '<button type="button" class="lnk" id="gateRetry">Zkusit znovu</button>';
    const btn = $('gateRetry');
    if(btn) btn.addEventListener('click', () => {
      $('gatemsg').textContent = 'Zkouším to znovu…';
      // Cache si drží i neúspěch, takže bez tohohle by se druhý pokus
      // vrátil stejně rychle a stejně marně.
      dropCached(/^leagues-classic\//);
      bootstrapGate();
    });
    setGateMode(true);
  }
}

$('manualToggle').addEventListener('click', () => {
  $('gatemsg').textContent = '';
  setGateMode(!MANUAL_MODE);
});

$('enter').addEventListener('click', () => {
  if(!MANUAL_MODE){
    const v = $('whoami').value;
    if(!v){
      $('gatemsg').textContent = 'Vyber se ze seznamu.';
      $('whoami').focus();
      return;
    }
    $('gatemsg').textContent = '';
    enterApp(v, CONFIG.leagueId);
    return;
  }

  const e = $('eid').value.trim();
  const l = $('lid').value.trim() || CONFIG.leagueId;
  if(!/^\d+$/.test(e)){
    $('gatemsg').textContent = 'ID týmu musí být číslo.';
    $('eid').focus();
    return;
  }
  if(l && !/^\d+$/.test(l)){
    $('gatemsg').textContent = 'ID ligy musí být číslo, nebo nech pole prázdné.';
    $('lid').focus();
    return;
  }
  $('gatemsg').textContent = '';
  enterApp(e, l);
});


['eid','lid'].forEach(id => {
  $(id).addEventListener('input', () => { $('gatemsg').textContent = ''; });
  $(id).addEventListener('keydown', ev => { if(ev.key === 'Enter') $('enter').click(); });
});

$('logout').addEventListener('click', () => {
  resetState();
  ENTRY_ID = null;
  CONFIG.entryId = '';
  CONFIG.leagueId = '';

  /* Uložené ID musí pryč taky. Dokud se start appky díval jen do CONFIG,
     bylo to jedno — teď by po refreshi vrátilo dovnitř toho, kdo právě
     odešel, a ze vstupní obrazovky by nešlo odejít. */
  lsDel(ENTRY_KEY);
  lsDel(LEAGUE_KEY);
  // Archiv patří lize, ze které člověk právě odešel.
  snapClear();

  stopCountdown();

  $('app').hidden = true;
  $('landing').hidden = false;
  $('gatemsg').textContent = '';
  window.scrollTo(0, 0);
});

$('lgo').addEventListener('click', async () => {
  const lid = CONFIG.leagueId || localStorage.getItem(LEAGUE_KEY);
  if(!lid){ $('lmsg').textContent = 'Nemáš zadané ID miniligy.'; return; }
  $('lgo').disabled = true;
  // Pořadí, historie i sestavy členů — jinak by se překreslila stará data.
  dropCached(/^(leagues-classic|entry)\//);
  const box = $('histbox');
  if(box) delete box.dataset.loaded;
  await loadLeague(lid);
  $('lgo').disabled = false;
});
/* Členství v lize je vlastnost ligy, ne týmu — po přepnutí na jinou se
   musí zjistit znovu, jinak by appka tvrdila, že do ní patříš. */
volatile('sync', () => {
  LIGA_STAV = null;
  LIGA_CHYBA = '';
});
