/* Tvary, které posílá FPL API.

   Nejsou úplné a být nemají — jsou tu jen pole, která appka opravdu
   čte. Doplňovat zbytek by znamenalo udržovat kopii cizí dokumentace,
   která se mění bez ohlášení, a to je práce navíc bez užitku.

   Volitelnost (`?`) a `| null` jsou tu informace, ne opatrnost:
   `chance_of_playing_next_round` opravdu bývá null a `active_chip`
   u cizích manažerů opravdu chybí. Kde je hodnota jistá, typ to říká.

   Soubor je `.d.ts`, takže se nikam nenačítá ani nenasazuje — vidí ho
   jen `tsc --noEmit` (viz jsconfig.json).
   ============================================================ */

/** Hráč z bootstrap-static/ → elements[] */
interface FplElement {
  id: number;
  code: number;
  team: number;
  /** 1 GKP, 2 DEF, 3 MID, 4 FWD */
  element_type: 1 | 2 | 3 | 4;
  web_name: string;
  first_name: string;
  second_name: string;
  /** V desetinách milionu: 45 = 4.5m */
  now_cost: number;
  total_points: number;
  minutes: number;
  form: string;
  /** a dostupný, d pochybný, i zraněný, s suspendovaný, u nedostupný, n neregistrovaný */
  status: 'a' | 'd' | 'i' | 's' | 'u' | 'n';
  chance_of_playing_next_round: number | null;
  selected_by_percent: string;
  cost_change_start: number;
  transfers_in_event?: number;
  transfers_out_event?: number;
}

/** Klub z bootstrap-static/ → teams[] */
interface FplTeam {
  id: number;
  /** Přežívá mezi sezonami, na rozdíl od `id` — proto se klíčují odznaky. */
  code: number;
  name: string;
  short_name: string;
  strength_overall_home?: number;
  strength_overall_away?: number;
}

/** Kolo z bootstrap-static/ → events[] */
interface FplEvent {
  id: number;
  deadline_time: string;
  finished: boolean;
  /** Přepne se až po dopočtu bonusů — `finished` přijde dřív. */
  data_checked?: boolean;
  is_current?: boolean;
  is_next?: boolean;
  is_previous?: boolean;
}

/** Zápas z fixtures/. `event` je null u zápasu bez termínu (odložený). */
interface FplFixture {
  id: number;
  event: number | null;
  team_h: number;
  team_a: number;
  team_h_difficulty?: number;
  team_a_difficulty?: number;
  finished?: boolean;
  finished_provisional?: boolean;
  stats?: Array<{ identifier: string; h: unknown[]; a: unknown[] }>;
}

/** Řádek kola z entry/{id}/history/ → current[] */
interface FplEntryHistoryRow {
  /** FPL posílá `event`; archiv i appka dopočítávají `round`. */
  event: number;
  round?: number;
  points: number;
  /** Kumulativní součet od začátku sezóny — nikdy menší než `points`. */
  total_points: number;
  rank?: number | null;
  overall_rank?: number | null;
  event_transfers: number | null;
  event_transfers_cost: number | null;
  points_on_bench: number | null;
  /** Hodnota kádru v desetinách milionu. Nikdy 0 — startuje se na 1000. */
  value: number | null;
  bank?: number | null;
  /** Náš příznak: řádek pochází z pořadí ligy a nezná přestupy ani lavičku. */
  zeStandings?: boolean;
  /** Náš příznak: řádek dopočítaný ze sestav a bodů hráčů. */
  zeSestav?: boolean;
}

interface FplChipPlay {
  name: 'wildcard' | 'freehit' | 'bboost' | '3xc' | 'manager' | string;
  event: number;
}

interface FplEntryHistory {
  current: FplEntryHistoryRow[];
  chips: FplChipPlay[];
  past: Array<{ season_name: string; total_points: number; rank: number }>;
}

/** Jeden hráč v sestavě z entry/{id}/event/{gw}/picks/ */
interface FplPick {
  element: number;
  /** 1–11 základ, 12–15 lavička; 12 je náhradní brankář. */
  position: number;
  /** 0 lavička, 1 hraje, 2 kapitán, 3 triple captain. */
  multiplier: number;
  is_captain: boolean;
  is_vice_captain: boolean;
}

interface FplPicks {
  active_chip: string | null;
  entry_history: FplEntryHistoryRow;
  picks: FplPick[];
}

/** Člen miniligy z leagues-classic/{id}/standings/ → standings.results[] */
interface FplStandingsMember {
  entry: number;
  entry_name: string;
  player_name: string;
  rank: number;
  last_rank?: number;
  total: number;
  /** Body za probíhající kolo. Aktualizuje se živě, na rozdíl od history/. */
  event_total: number;
}

/** Statistiky hráče z event/{gw}/live/ → elements[].stats */
interface FplLiveStats {
  minutes: number;
  total_points: number;
  bonus?: number;
}

interface FplLive {
  elements: Array<{ id: number; stats: FplLiveStats }>;
}

/* ============================================================
   PRAGMATICKÁ UVOLNĚNÍ

   Následující deklarace nejsou popis pravdy, ale rozhodnutí o tom, co
   má kontrola hlídat. Bez nich tvoří přes sto hlášek šum kolem DOM —
   `ev.target.closest`, `$('x').value`, `el.dataset` — a v tom šumu
   zapadnou ty dvě tři hlášky, kvůli kterým kontrola existuje: překlep
   v názvu pole z FPL API nebo čtení vlastnosti, kterou objekt nemá.

   Kdyby appka jednou dostala build step a přepis do TypeScriptu, tenhle
   blok je první, co se maže.
   ============================================================ */

/** `ev.target` je typově EventTarget; v téhle appce je to vždycky prvek. */
interface EventTarget {
  closest?(selector: string): HTMLElement | null;
  value?: string;
}

/** `querySelectorAll` vrací Element; sáháme na ně jako na HTML prvky. */
interface Element {
  dataset?: DOMStringMap;
  value?: string;
  disabled?: boolean;
  media?: string;
  hidden?: boolean;
  focus?(): void;
  offsetParent?: Element | null;
}

/* Most k modulu js/firebase.js. Ten se načítá jako ESM z CDN, takže na
   jeho lexikální vazby zbytek appky nedosáhne — komunikuje se přes
   window. Tady je to sepsané, aby kontrola věděla, co na window je. */
interface Window {
  /* Podpisy schválně `any`: js/firebase.js se načítá dynamicky z CDN
     a jeho rozhraní se mění spolu s Firebase SDK. Přepisovat je sem by
     znamenalo udržovat druhou kopii, která se rozejde — a hodnota téhle
     kontroly je jinde, u struktur z FPL API. */
  FB?: Record<string, any>;
  FB_USER?: unknown;
  /** Nastavuje js/topbar.js zevnitř IIFE. */
  drawChip?: () => void;
  /** Konzolové pomůcky pro živou diagnostiku. */
  debugCeny?: (gw: number) => unknown;
  debugArchiv?: () => unknown;
}
