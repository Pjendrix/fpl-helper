/* Minileague Squad Check — start

   Předvyplnění formuláře, spuštění appky a registrace service workeru.
   Načítá se poslední, protože volá kód ze všech ostatních souborů.

   Soubory js/ se načítají jako klasické <script> v pevném pořadí a
   sdílejí jeden globální scope: nic se neexportuje ani neimportuje,
   ale hoisting přes hranici souboru neplatí. Pořadí je proto součást
   kontraktu a je vypsané v index.html.
   ============================================================ */
// předvyplnění z minula i z CONFIG nahoře v souboru
$('eid').value = CONFIG.entryId || localStorage.getItem(ENTRY_KEY) || '';
$('lid').value = CONFIG.leagueId || localStorage.getItem(LEAGUE_KEY) || '';

// když je všechno vyplněné v CONFIG, přeskoč vstupní obrazovku
if(CONFIG.entryId) enterApp(CONFIG.entryId, CONFIG.leagueId);
else bootstrapGate();

/* Service worker drží skořápku appky offline. Data se nikdy necachují —
   zastaralé pořadí ligy je horší než chybová hláška. */
if('serviceWorker' in navigator && location.protocol === 'https:'){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
