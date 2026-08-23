import { JSDOM } from 'jsdom';
import fs from 'fs';

// --- falešná data ve tvaru, jaký posílá FPL ---
const teams = [];
const shorts = ['ARS','AVL','BOU','BRE','BHA','BUR','CHE','CRY','EVE','FUL',
                'LEE','LIV','MCI','MUN','NEW','NFO','SUN','TOT','WHU','WOL'];
const fullNames = {MCI:'Man City',MUN:'Man Utd',TOT:'Spurs',NFO:"Nott'm Forest",
                   WOL:'Wolves',NEW:'Newcastle',BHA:'Brighton',BOU:'Bournemouth'};
shorts.forEach((sn,i)=>teams.push({
  id:i+1, name: fullNames[sn] || sn, short_name:sn, code:(i+1)*3,
  strength_overall_home:2+(i%4), strength_overall_away:1+(i%4),
  strength_attack_home:1100+i*10, strength_attack_away:1050+i*10,
  strength_defence_home:1100+i*8, strength_defence_away:1060+i*8,
}));

const events = Array.from({length:38},(_,i)=>({
  id:i+1, finished:i<9, is_current:i===9, is_next:i===10,
  deadline_time:new Date(Date.now()+3*3600e3).toISOString(),
}));

let pid=0;
const elements=[];
for(const t of teams){
  for(const [type,count] of [[1,2],[2,5],[3,5],[4,3]]){
    for(let k=0;k<count;k++){
      pid++;
      elements.push({
        id:pid, team:t.id, element_type:type,
        web_name:'P'+pid, first_name:'Jan', second_name:'Novak'+pid,
        now_cost:45+((pid*7)%80), total_points:(pid*3)%90, form:String((pid%9)/2),
        minutes:200+((pid*37)%700), starts:2+(pid%8), bonus:pid%12,
        status:'a', chance_of_playing_next_round:null,
        selected_by_percent:String(((pid*13)%400)/10),
        expected_goals_per_90:String(((pid*3)%40)/100),
        expected_assists_per_90:String(((pid*5)%30)/100),
        expected_goal_involvements_per_90:String(((pid*7)%60)/100),
        transfers_in_event:(pid*911)%90000, transfers_out_event:(pid*577)%70000,
        penalties_order: k===0&&type===4 ? 1 : null,
        corners_and_indirect_freekicks_order: k===1&&type===3 ? 1 : null,

        // nova pole, ktera cte model a predikce cen
        code: 100000+pid,
        cost_change_start: (pid%7)-3,
        defensive_contribution_per_90: type===1 ? 0 : ((pid*3)%22),
        price_change_percent: String(((pid%40)-20)*4),
        price_change_hourly_rate: ((pid%9)-4)*120,
        price_change_projections: [
          {offset:0, projected_percent:String((pid%40)-20), likelihood:((pid%9)-4)},
          {offset:1, projected_percent:String((pid%40)-15), likelihood:((pid%9)-4)},
          {offset:2, projected_percent:String((pid%40)-10), likelihood:((pid%9)-4)},
        ],
        price_change_locked_until: null,
      });
    }
  }
}

// rozpis: GW11 má blank pro tým 1 a double pro tým 2 — schválně
const fixtures=[];
let fid=0;
for(let gw=1;gw<=20;gw++){
  const pool=teams.map(t=>t.id);
  if(gw===11){ pool.splice(pool.indexOf(1),1); pool.push(2); }
  for(let i=0;i+1<pool.length;i+=2){
    fixtures.push({id:++fid,event:gw,team_h:pool[i],team_a:pool[i+1],
      team_h_difficulty:2+(i%4),team_a_difficulty:2+((i+1)%4)});
  }
}

// mesicni faze a nastaveni hry, jak je posila zivy bootstrap
const phases=[{id:1,name:'Overall',start_event:1,stop_event:38},
              {id:2,name:'Srpen',start_event:1,stop_event:3},
              {id:3,name:'Zari',start_event:4,stop_event:7},
              {id:4,name:'Rijen',start_event:8,stop_event:11},
              {id:5,name:'Kveten',start_event:34,stop_event:38}];

const bootstrap={teams,events,elements,phases,
  game_settings:{max_extra_free_transfers:4},
  game_config:{settings:{price_change_deadlines:[
    new Date(Date.now()+8*3600e3).toISOString()]}}};

const html=fs.readFileSync('index.html','utf8');
const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://x.test/',
  pretendToBeVisual:true});
const w=dom.window;

// stub fetch
w.fetch = async (url)=>{
  const u=String(url);
  const json = u.includes('bootstrap-static') ? bootstrap
    : u.includes('fixtures') ? fixtures
    : {};
  return {ok:true,status:200,headers:{get:()=>'application/json'},json:async()=>json};
};

await new Promise(r=>setTimeout(r,300));

// `let` na nejvyšší úrovni skriptu nevisí na window — musíme dovnitř
w.__boot = bootstrap; w.__fix = fixtures;
w.eval('BOOT = window.__boot; FIX = window.__fix;');

// most k lexikálním bindingům skriptu
const g = new Proxy({}, {get: (_, k) => w.eval(String(k))});

const squad0=new Set();
const check=(name,fn)=>{
  try{ const v=fn(); console.log('✓',name,'→',v); }
  catch(e){ console.log('✗',name,'→',e.message); process.exitCode=1; }
};

check('gwFixtures blank (tým 1, GW11)',()=>g.gwFixtures(1,11).length);
check('gwFixtures double (tým 2, GW11)',()=>g.gwFixtures(2,11).length);
check('gwShape najde blank+double',()=>{
  const sh=g.gwShape(11,1)[0];
  return `blanků ${sh.blanks.length}, doublů ${sh.doubles.length}`;
});
check('projectGw blank = 0',()=>g.projectGw(bootstrap.elements.find(p=>p.team===1),11).toFixed(2));
check('projectGw double > single',()=>{
  const p=bootstrap.elements.find(x=>x.team===2);
  return (g.projectGw(p,11)/Math.max(g.projectGw(p,12),0.01)).toFixed(2)+'×';
});
check('projectRange 5 kol',()=>g.projectRange(bootstrap.elements[40],11,5).toFixed(1));
check('ownFdr v rozsahu 1–5',()=>{
  const vals=[]; for(const t of teams) for(const o of teams) if(t!==o){
    vals.push(g.ownFdr(t.id,o.id,true),g.ownFdr(t.id,o.id,false));}
  return `min ${Math.min(...vals).toFixed(2)}, max ${Math.max(...vals).toFixed(2)}`;
});
check('bestEleven vrací platnou formaci',()=>{
  const squad=[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15].map((_,i)=>{
    const types=[1,1,2,2,2,2,2,3,3,3,3,3,4,4,4];
    const p=bootstrap.elements.find(e=>e.element_type===types[i]&&!squad0.has(e.id));
    squad0.add(p.id); return {p,xp:Math.random()*8};
  });
  const b=w.eval('bestEleven')(squad);
  if(b.xi.length!==11) throw new Error('XI má '+b.xi.length);
  if(b.bench.length!==4) throw new Error('lavička má '+b.bench.length);
  const gk=b.xi.filter(s=>s.p.element_type===1).length;
  if(gk!==1) throw new Error('brankářů '+gk);
  return b.shape+', lavička '+b.bench.length;
});

check('pointsByRound indexuje podle round',()=>{
  const m=g.pointsByRound({current:[{round:5,total_points:50},{round:6,total_points:70}]});
  return m.get(5).total_points+' / '+m.get(6).total_points;
});
check('leagueRanks s manažerem od GW5',()=>{
  const members=[{entry:1},{entry:2}];
  const hists=[{current:[{round:1,total_points:10},{round:2,total_points:20}]},
               {current:[{round:2,total_points:30}]}];
  const r=g.leagueRanks(members,hists);
  return 'gws='+r.gws+', GW2 pořadí '+r.ranks[0][1]+'/'+r.ranks[1][1];
});

check('buildTicker vyrenderuje 20 řádků',()=>{
  const html=g.buildTicker();
  return (html.match(/<tr>/g)||[]).length+' řádků, blank '+/class="fx blank"/.test(html);
});
check('buildShape',()=>g.buildShape().includes('GW11'));
check('buildPrices',()=>g.buildPrices().length>500);
check('playerRows + gwCount',()=>{
  const rows=g.playerRows();
  return rows.length+' hráčů, blanků '+rows.filter(r=>r.gwCount===0).length;
});
check('esc escapuje apostrof i uvozovky',()=>g.esc(`<a href="x" a='b'>&`));

// --- plný průchod render(): kapitán, optimální XI, tvar rozpisu ---
const picksSquad = [];
// 1-4-4-2 v základu, zbytek lavička — jako reálná sestava FPL
const need = [1,2,2,2,2,3,3,3,3,4,4,  1,2,3,4];
const used = new Set();
need.forEach((type, i) => {
  const p = bootstrap.elements.find(e => e.element_type === type && !used.has(e.id));
  used.add(p.id);
  picksSquad.push({element: p.id, position: i + 1,
    multiplier: i < 11 ? 1 : 0, is_captain: i === 3, is_vice_captain: i === 4});
});
const entry = {name:'Testovací tým', player_first_name:'Jan', player_last_name:'Novák',
  summary_overall_points:512, summary_overall_rank:123456};

check('render() proběhne a nakreslí panel', () => {
  w.eval('render')(entry, {picks: picksSquad}, 11);
  const html = w.document.getElementById('out').innerHTML;
  const has = t => html.includes(t);
  if(!has('Nejlehčí los')) throw new Error('chybí blok s losem');
  if(!has('Tvoji tři nejdražší')) throw new Error('chybí nejdražší hráči');
  if(!has('Co tě čeká v rozpisu')) throw new Error('chybí upozornění na blank/double');
  return html.length + ' znaků HTML';
});

check('render() naplní MY_SQUAD', () => w.eval('MY_SQUAD').size);
check('bestEleven nikdy nepřekročí 5 obránců', () => {
  const b = w.eval('bestEleven')(picksSquad.map(pk => ({
    p: bootstrap.elements.find(e => e.id === pk.element), xp: Math.random() * 9})));
  const d = b.xi.filter(s => s.p.element_type === 2).length;
  const m = b.xi.filter(s => s.p.element_type === 3).length;
  const f = b.xi.filter(s => s.p.element_type === 4).length;
  if(d < 3 || d > 5 || m < 2 || m > 5 || f < 1 || f > 3)
    throw new Error(`neplatná formace ${d}-${m}-${f}`);
  return `${d}-${m}-${f}`;
});
check('countdown se vykreslí', () => {
  w.eval('startCountdown')();
  return w.document.getElementById('countdown').textContent;
});

// --- náhrady ---
const owned = new Set(picksSquad.map(p => p.element));
const diop = bootstrap.elements.find(e => e.element_type === 2 && owned.has(e.id));
const it = {p: diop};
w.eval('PLAYERS = playerRows();');
const byId = Object.fromEntries(w.eval('PLAYERS').map(r => [r.p.id, r]));
const find = w.eval('findReplacements');

check('najde náhradu přesně na cenu nejlevnějšího', () => {
  const cheapest = Math.min(...w.eval('PLAYERS')
    .filter(r => r.p.element_type === 2 && !owned.has(r.p.id)).map(r => r.price));
  const res = find(it, cheapest, owned, {}, 11, byId);
  if(!res.cands.length) throw new Error('nic: ' + res.diag.replace(/<[^>]+>/g,' '));
  return res.cands.length + ' kandidátů za ' + cheapest.toFixed(1) + 'm';
});

check('funnel má počet po každém kroku', () => {
  const res = find(it, 0.1, owned, {}, 11, byId);
  if(res.counts.length !== 6) throw new Error('kroků ' + res.counts.length);
  if(res.counts[res.counts.length-1].left !== 0) throw new Error('mělo být 0');
  return res.counts.map(c => c.left).join(' → ');
});

check('při malém rozpočtu řekne, kolik chybí', () => {
  const res = find(it, 0.1, owned, {}, 11, byId);
  const txt = res.diag.replace(/<[^>]+>/g, ' ');
  if(!/Chybí ti/.test(txt)) throw new Error('chybí částka: ' + txt.slice(0,120));
  if(!res.nearMiss.length) throw new Error('žádné near-miss návrhy');
  return res.nearMiss.length + ' near-miss, nejlevnější ' + res.cheapest.toFixed(1) + 'm';
});

check('minutový práh na začátku sezóny je 0', () => {
  const res = find(it, 99, owned, {}, 11, byId);
  return 'práh ' + res.minMinutes + ' min při ' + w.eval('roundsPlayed()') + ' kolech';
});

check('limit 3 z klubu se pozná ve funnelu', () => {
  const full = {};
  bootstrap.teams.forEach(t => full[t.id] = 3);
  const res = find(it, 99, owned, full, 11, byId);
  const step = res.counts.find(c => c.label === 'limit 3 z klubu');
  if(step.left !== 0) throw new Error('nezablokoval');
  return 'zbylo ' + step.left;
});

// --- oficiální projekce FPL a statistiky podle pozice ---
bootstrap.elements.forEach((p, i) => {
  p.ep_next = String(((i * 17) % 90) / 10);
  p.ep_this = String(((i * 11) % 70) / 10);
  p.points_per_game = String(((i * 7) % 60) / 10);
  p.expected_goals_conceded_per_90 = String(((i * 3) % 200) / 100);
  p.saves = i % 40; p.saves_per_90 = String(((i * 5) % 400) / 100);
  p.penalties_saved = 0; p.clean_sheets = i % 6; p.goals_conceded = i % 15;
  p.expected_goal_involvements = String(((i * 13) % 900) / 100);
  p.goals_scored = i % 9; p.assists = i % 7;
  // sezonni souhrny (ne per_90) — ctou je zebricky v Top hracich
  p.expected_goals = String(((i * 19) % 1400) / 100);
  p.expected_assists = String(((i * 7) % 900) / 100);
  p.defensive_contribution = (i * 3) % 90;
  p.ict_index = String(((i * 23) % 2000) / 10);
  p.ict_index_rank_type = (i % 60) + 1;
});
w.eval('PLAYERS = playerRows();');

check('epNext čte ep_next z bootstrapu', () => {
  const p = bootstrap.elements[3];
  const v = w.eval('epNext')(p);
  if(v !== parseFloat(p.ep_next)) throw new Error('dostal ' + v);
  return v;
});

check('epNext vrací null, když pole chybí', () => {
  const v = w.eval('epNext')({});
  if(v !== null) throw new Error('mělo být null, je ' + v);
  return 'null';
});

check('stat() přeskočí chybějící pole', () => {
  const v = w.eval('stat')({b: '2.5'}, 'a', 'b');
  if(v !== 2.5) throw new Error('dostal ' + v);
  return v;
});

check('brankář dostane zákroky, útočník ne', () => {
  const gk = bootstrap.elements.find(p => p.element_type === 1);
  const fw = bootstrap.elements.find(p => p.element_type === 4);
  const ps = w.eval('positionStats');
  const has = (p, label) => ps(p).some(r => r.label === label);
  if(!has(gk, 'Zákroky')) throw new Error('brankáři chybí zákroky');
  if(has(fw, 'Zákroky')) throw new Error('útočník má zákroky');
  return 'GKP ' + ps(gk).length + ' řádků, FWD ' + ps(fw).length;
});

check('xGC mají GKP, DEF i MID, ne FWD', () => {
  const ps = w.eval('positionStats');
  const has = t => ps(bootstrap.elements.find(p => p.element_type === t))
    .some(r => r.label.includes('xGC'));
  if(!has(1) || !has(2) || !has(3)) throw new Error('chybí u obranných pozic');
  if(has(4)) throw new Error('útočník má xGC');
  return 'GKP/DEF/MID ano, FWD ne';
});

check('xGI mají MID a FWD', () => {
  const ps = w.eval('positionStats');
  const has = t => ps(bootstrap.elements.find(p => p.element_type === t))
    .some(r => r.label.includes('xGI'));
  if(!has(3) || !has(4)) throw new Error('chybí');
  return 'ano';
});

check('positionStats vynechá pole, která FPL neposílá', () => {
  const p = {element_type: 4, minutes: 500, starts: 5};
  const rows = w.eval('positionStats')(p);
  if(rows.some(r => String(r.value) === 'NaN')) throw new Error('NaN v tabulce');
  return rows.length + ' řádků bez NaN';
});

check('playerRows nese ep', () => {
  const rows = w.eval('PLAYERS');
  const withEp = rows.filter(r => r.ep !== null).length;
  return withEp + '/' + rows.length + ' hráčů má projekci FPL';
});

check('statGrid nevyrobí NaN ani prázdný blok', () => {
  const html = w.eval('statGrid')(bootstrap.elements.find(p => p.element_type === 2));
  if(html.includes('NaN')) throw new Error('NaN');
  if(!html.includes('pstats')) throw new Error('prázdné');
  return html.length + ' znaků';
});

check('renderTransfers vyrobí rozbalovací karty', () => {
  // bez problémového hráče se karty nevykreslí — jednoho zraníme
  const hurt = bootstrap.elements.find(e => e.id === picksSquad[2].element);
  hurt.status = 'i';
  hurt.chance_of_playing_next_round = 25;
  hurt.news = 'Zranění kolene, návrat neznámý';
  w.eval('PLAYERS = playerRows();');

  w.__picks = {picks: picksSquad, entry_history: {bank: 0}};
  w.__sums = picksSquad.map(() => []);
  w.eval(`TR_STATE = {picks: window.__picks, summaries: window.__sums,
    squad: [], apiBank: 0, startGw: 11}`);
  w.eval('renderTransfers()');
  const html = w.document.getElementById('trout').innerHTML;
  if(!html.includes('<details')) throw new Error('nejsou details');
  if(!html.includes('Rozbalit statistiky')) throw new Error('chybí summary');
  if(html.includes('NaN')) throw new Error('NaN ve výstupu');
  return (html.match(/<details/g) || []).length + ' karet';
});

// --- shoda projekcí u kapitána ---
/* Doporučení kapitána podle xP odešlo: ep_next chodí zaokrouhlené na
   desetinu, takže u špičkových hráčů vycházelo stejně a appka sama psala,
   že doporučit nemá čím. Test hlídá, že se to nevrátí. */
check('appka nedoporučuje kapitána podle projekce', () => {
  const ids = picksSquad.slice(0, 11).map(p => p.element);
  bootstrap.elements.forEach(p => { p.ep_next = ids.includes(p.id) ? '4.0' : '1.0'; });
  w.eval('PLAYERS = playerRows();');
  w.eval('render')(entry, {picks: picksSquad}, 11, null);
  const txt = w.document.getElementById('out').innerHTML.replace(/<[^>]+>/g, ' ');
  if(/s páskou|Kapitánská páska/.test(txt)) throw new Error('xP doporučení je zpátky');
  if(!/Není to doporučení na kapitána/.test(txt))
    throw new Error('chybí upřesnění, že los sám o sobě nic neříká');
  return 'jen podklad, ne rada';
});

check('nejlehčí los vybere dva týmy a spočítá obtížnost', () => {
  const squad = picksSquad.map((pk, i) => ({
    p: bootstrap.elements.find(e => e.id === pk.element),
    starting: i < 11,
  }));
  const html = w.eval('easiestFixtures')(squad, 11);
  const fdrs = [...html.matchAll(/class="fdr f\d">([\d.]+)</g)].map(m => parseFloat(m[1]));
  if(fdrs.length !== 2) throw new Error('týmů: ' + fdrs.length);
  if(fdrs[0] > fdrs[1]) throw new Error('není seřazeno od nejlehčího: ' + fdrs);
  if(!fdrs.every(v => v >= 1 && v <= 5)) throw new Error('mimo stupnici: ' + fdrs);
  return fdrs.join(' a ');
});

check('u týmu bez hráčů v kádru se to řekne', () => {
  // prázdný kádr → ani jeden z těch dvou týmů nemůže mít moje hráče
  const html = w.eval('easiestFixtures')([], 11);
  if(!html.includes('nemáš nikoho')) throw new Error('mlčí místo hlášky');
  return 'poctivá hláška';
});

check('nejdražší tři jsou opravdu nejdražší', () => {
  const squad = picksSquad.map(pk => ({
    p: bootstrap.elements.find(e => e.id === pk.element), starting: true,
  }));
  const html = w.eval('topPriceBlock')(squad, 11);
  const ceny = [...html.matchAll(/class="cost">([\d.]+)m</g)].map(m => parseFloat(m[1]));
  if(ceny.length !== 3) throw new Error('řádků: ' + ceny.length);
  for(let i = 1; i < ceny.length; i++)
    if(ceny[i] > ceny[i - 1]) throw new Error('není seřazeno: ' + ceny);
  const max = Math.max(...squad.map(s => s.p.now_cost)) / 10;
  if(ceny[0] !== max) throw new Error(`nejdražší je ${max}m, ukazuje ${ceny[0]}m`);
  return ceny.join(' / ') + 'm';
});

check('volné kolo u nejdražšího hráče se pozná', () => {
  // tým 1 má v testovacích datech blank v GW11
  const p = bootstrap.elements.find(e => e.team === 1);
  const html = w.eval('topPriceBlock')([{p, starting: true}], 11);
  if(!html.includes('volné kolo')) throw new Error('nepozná blank');
  return 'označeno';
});

// --- živé body ---
const liveMap = new Map(bootstrap.elements.map((p, i) => [p.id, {
  total_points: i % 13, minutes: i % 4 === 0 ? 0 : 90, bonus: 0,
}]));

check('render s živými daty ukáže body místo FDR', () => {
  w.__live = liveMap;
  w.eval('render')(entry, {picks: picksSquad, entry_history: {event_transfers_cost: 4}},
    11, {live: w.__live, gw: 10, finished: false});
  const html = w.document.getElementById('out').innerHTML;
  if(!html.includes('livebar')) throw new Error('chybí pruh se součtem');
  if(!html.includes('bodů v GW10')) throw new Error('chybí popisek kola');
  if(html.includes('NaN')) throw new Error('NaN');
  return 'ok';
});

check('kapitánovy body jsou zdvojené', () => {
  const capPick = picksSquad.find(p => p.is_captain);
  // kapitán musí mít odehrané minuty, jinak se místo bodů zobrazí pomlčka
  liveMap.set(capPick.element, {total_points: 4, minutes: 90, bonus: 0});
  const raw = 4;
  const picks2 = picksSquad.map(p => ({...p, multiplier: p.is_captain ? 2 : (p.position <= 11 ? 1 : 0)}));
  w.eval('render')(entry, {picks: picks2, entry_history: {event_transfers_cost: 0}},
    11, {live: w.__live, gw: 10, finished: false});
  const html = w.document.getElementById('out').innerHTML;
  // kapitánův řádek musí nést zdvojenou hodnotu
  const doubled = raw * 2;
  if(!new RegExp('<b>' + doubled + '</b>').test(html))
    throw new Error('nenašel ' + doubled + ' (základ ' + raw + ')');
  return raw + ' → ' + doubled;
});

check('nehrající hráč má pomlčku, ne nulu', () => {
  const html = w.document.getElementById('out').innerHTML;
  if(!html.includes('zatím nehrál')) throw new Error('chybí rozlišení');
  return 'ok';
});

check('bez živých dat se vrátí FDR', () => {
  w.eval('render')(entry, {picks: picksSquad}, 11, null);
  const html = w.document.getElementById('out').innerHTML;
  if(html.includes('livebar')) throw new Error('pruh tam nemá být');
  if(!html.includes('FDR ')) throw new Error('chybí FDR');
  return 'ok';
});

// --- doporučení výhradně podle vlastnictví ---
bootstrap.elements.forEach((p, i) => {
  p.selected_by_percent = String(((i * 37) % 500) / 10);
  p.event_points = i % 15;
});
w.eval('PLAYERS = playerRows();');

check('kandidáti jsou seřazení podle vlastnictví, ne podle projekce', () => {
  const res = w.eval('findReplacements')(it, 99, owned, {}, 11, byId);
  const own = res.cands.map(c => c.owned);
  const sorted = [...own].sort((a, b) => b - a);
  if(JSON.stringify(own) !== JSON.stringify(sorted))
    throw new Error('není podle vlastnictví: ' + own.join(', '));
  return own.map(o => o.toFixed(1) + '%').join(' > ');
});

check('nejvlastněnější dostupný hráč je první', () => {
  const res = w.eval('findReplacements')(it, 99, owned, {}, 11, byId);
  const best = Math.max(...w.eval('PLAYERS')
    .filter(r => r.p.element_type === it.p.element_type && !owned.has(r.p.id)
      && r.chance >= 75 && r.p.status === 'a')
    .map(r => parseFloat(r.p.selected_by_percent)));
  if(Math.abs(res.cands[0].owned - best) > 0.01)
    throw new Error('první má ' + res.cands[0].owned + ', nejvyšší je ' + best);
  return res.cands[0].owned.toFixed(1) + ' %';
});

check('kandidát nese lastWeek a minuty', () => {
  const c = w.eval('findReplacements')(it, 99, owned, {}, 11, byId).cands[0];
  if(c.lastWeek === undefined) throw new Error('chybí lastWeek');
  if(c.p.minutes === undefined) throw new Error('chybí minuty');
  return c.lastWeek + ' b, ' + c.p.minutes + ' min';
});

check('řádek náhrady má šest sloupců a info tlačítko', () => {
  w.__picks = {picks: picksSquad, entry_history: {bank: 0}};
  w.__sums = picksSquad.map(() => []);
  w.eval(`TR_STATE = {picks: window.__picks, summaries: window.__sums,
    squad: [], apiBank: 0, startGw: 11}`);
  w.eval('renderTransfers()');
  const html = w.document.getElementById('trout').innerHTML;
  if(!html.includes('cand2')) throw new Error('chybí řádky');
  if(!html.includes('button class="info"')) throw new Error('chybí info tlačítko');
  if(!html.includes('Vlastní')) throw new Error('chybí sloupec vlastnictví');
  if(html.includes('za 5 kol')) throw new Error('zůstal starý sloupec projekce');
  if(html.includes('NaN')) throw new Error('NaN');
  return (html.match(/cand2/g) || []).length + ' řádků';
});

check('statistiky jsou schované, dokud se neklikne', () => {
  const doc = w.document;
  const pop = doc.querySelector('#trout .statpop');
  if(!pop) throw new Error('chybí panel se statistikami');
  if(!pop.hidden) throw new Error('panel není schovaný');
  const btn = doc.querySelector('#trout button.info');
  btn.dispatchEvent(new w.MouseEvent('click', {bubbles: true}));
  if(doc.getElementById(pop.id).hidden) throw new Error('klik panel neotevřel');
  if(btn.getAttribute('aria-expanded') !== 'true') throw new Error('aria-expanded nesedí');
  return 'otevírá a zavírá';
});

// --- pravidla pro návrh transferu ---
check('hráč v dobré formě se neflaguje kvůli programu', () => {
  const p = bootstrap.elements.find(e => e.element_type === 2);
  p.form = '9.0'; p.points_per_game = '6.0'; p.status = 'a';
  p.chance_of_playing_next_round = null;
  const picks3 = [{element: p.id, position: 1, multiplier: 1,
    is_captain: false, is_vice_captain: false}];
  w.__picks = {picks: picks3, entry_history: {bank: 0}};
  w.__sums = [[{minutes: 90, total_points: 2}, {minutes: 90, total_points: 1},
               {minutes: 90, total_points: 2}]];
  w.eval('PLAYERS = playerRows();');
  w.eval(`TR_STATE = {picks: window.__picks, summaries: window.__sums,
    squad: [], apiBank: 0, startGw: 11}`);
  w.eval('renderTransfers()');
  const html = w.document.getElementById('trout').innerHTML;
  if(html.includes('<details')) throw new Error('flagoval hráče v dobré formě');
  if(!html.includes('ok-box')) throw new Error('nečekaný výstup');
  return 'neflagován';
});

check('zraněný se flaguje bez ohledu na formu', () => {
  const p = bootstrap.elements.find(e => e.element_type === 2);
  p.status = 'i'; p.chance_of_playing_next_round = 0;
  w.eval('PLAYERS = playerRows();');
  w.eval('renderTransfers()');
  const html = w.document.getElementById('trout').innerHTML;
  if(!html.includes('<details')) throw new Error('neflagoval zraněného');
  if(!html.includes('Zraněný')) throw new Error('chybí důvod');
  p.status = 'a'; p.chance_of_playing_next_round = null;
  return 'flagován';
});

// --- percentilové barvy tickeru ---
check('kvintily rozdělí zápasy do všech pěti pásem', () => {
  w.eval('computeFdrCuts(11, 6)');
  const cuts = w.eval('FDR_CUTS');
  if(!cuts || cuts.length !== 4) throw new Error('cuts nejsou');
  const html = w.eval('buildTicker()');
  const used = ['f1','f2','f3','f4','f5'].filter(c => html.includes('class="' + c + '"'));
  if(used.length < 4) throw new Error('použito jen ' + used.length + ' pásem: ' + used);
  return used.length + ' pásem, prahy ' + cuts.map(c => c.toFixed(2)).join('/');
});

// --- kádr po pozicích ---
check('kádr je seskupený podle pozic s rozpisem', () => {
  bootstrap.elements.forEach(p => { p.status = 'a'; p.chance_of_playing_next_round = null; });
  w.eval('PLAYERS = playerRows();');
  w.eval('render')(entry, {picks: picksSquad}, 11, null);
  const html = w.document.getElementById('out').innerHTML;
  ['Brankáři','Obránci','Záložníci','Útočníci','Lavička'].forEach(g => {
    if(!html.includes(g)) throw new Error('chybí skupina ' + g);
  });
  if(!html.includes('tick3')) throw new Error('chybí rozpis na 3 kola');
  if(!html.includes('fdrleg')) throw new Error('chybí legenda');
  if(html.includes('NaN')) throw new Error('NaN');
  return (html.match(/class="prow/g) || []).length + ' řádků hráčů';
});

check('blank v rozpisu je označený', () => {
  const html = w.document.getElementById('out').innerHTML;
  if(!html.includes('>bl<')) throw new Error('blank není označený');
  return 'ok';
});

check('vlastnictví pod 5 % dostane značku diferenciál', () => {
  bootstrap.elements.find(e => e.id === picksSquad[5].element).selected_by_percent = '1.2';
  w.eval('PLAYERS = playerRows();');
  w.eval('render')(entry, {picks: picksSquad}, 11, null);
  const html = w.document.getElementById('out').innerHTML;
  if(!html.includes('diferenciál')) throw new Error('chybí značka');
  return 'ok';
});

// --- ownFdr při nevyplněných silách týmů ---
/* Nulové strength_attack_* nejsou důvod zahodit i strength_overall_*.
   V živých datech jsou attack/defence celý začátek sezóny nuly, zatímco
   overall vyplněné je — dřív se v tu chvíli spadlo na statické FDR. */
check('při nulových attack/defence se použije strength_overall', () => {
  const saved = bootstrap.teams.map(t => ({...t}));
  bootstrap.teams.forEach(t => {
    t.strength_attack_home = 0; t.strength_attack_away = 0;
    t.strength_defence_home = 0; t.strength_defence_away = 0;
  });
  const v = w.eval('ownFdr')(1, 2, true, 4);
  const usable = w.eval('strengthsUsable()');
  const ready = w.eval('strengthsReady()');
  bootstrap.teams.forEach((t, i) => Object.assign(t, saved[i]));

  if(v === 4) throw new Error('spadl na statické FDR místo overall');
  if(!(v >= 1 && v <= 5)) throw new Error('mimo stupnici: ' + v);
  if(!usable) throw new Error('strengthsUsable má být true');
  if(ready) throw new Error('strengthsReady má být false — data jsou hrubší');
  return v.toFixed(2) + ' · usable ano, ready ne';
});

/* Teprve když chybí i overall, nezbývá než oficiální FDR. */
check('bez overall se vrátí oficiální FDR', () => {
  const saved = bootstrap.teams.map(t => ({...t}));
  bootstrap.teams.forEach(t => {
    t.strength_attack_home = 0; t.strength_attack_away = 0;
    t.strength_defence_home = 0; t.strength_defence_away = 0;
    t.strength_overall_home = 0; t.strength_overall_away = 0;
  });
  const v = w.eval('ownFdr')(1, 2, true, 4);
  const usable = w.eval('strengthsUsable()');
  bootstrap.teams.forEach((t, i) => Object.assign(t, saved[i]));
  if(v !== 4) throw new Error('vrátil ' + v + ', čekal zálohu 4');
  if(usable) throw new Error('strengthsUsable má být false');
  return 'záloha ' + v;
});

check('strengthsReady pozná nevyplněná data', () => {
  const saved = bootstrap.teams.map(t => ({...t}));
  bootstrap.teams.forEach(t => { t.strength_attack_home = 0; });
  const bad = w.eval('strengthsReady()');
  bootstrap.teams.forEach((t, i) => Object.assign(t, saved[i]));
  const good = w.eval('strengthsReady()');
  if(bad !== false || good !== true) throw new Error(`bad=${bad} good=${good}`);
  return 'false → true';
});

check('rozpis v kádru nepoužije jednu barvu pro všechno', () => {
  const saved = bootstrap.teams.map(t => ({...t}));
  bootstrap.teams.forEach(t => {
    t.strength_attack_home = 0; t.strength_attack_away = 0;
    t.strength_defence_home = 0; t.strength_defence_away = 0;
  });
  w.eval('PLAYERS = playerRows();');
  w.eval('render')(entry, {picks: picksSquad}, 11, null);
  const html = w.document.getElementById('out').innerHTML;
  bootstrap.teams.forEach((t, i) => Object.assign(t, saved[i]));

  const tick = html.slice(html.indexOf('squadlist'));
  const used = ['f1','f2','f3','f4','f5'].filter(c => tick.includes('class="' + c + '"'));
  if(used.length < 2) throw new Error('jen ' + used.length + ' barva: ' + used);
  if(!html.includes('celkové síly'))
    throw new Error('neřekl, ze kterého zdroje obtížnost počítá');
  return used.length + ' pásem + poctivá hláška o zdroji';
});

check('kvintily se nepoužijí při nulovém rozptylu', () => {
  const flat = w.eval('FDR_CUTS');
  if(!flat) throw new Error('cuts nejsou');
  return 'prahy ' + flat.map(c => c.toFixed(1)).join('/');
});

/* ================= defenzivní příspěvky v projekci ================= */

check('DefCon zvedne projekci záložníka', () => {
  const base = bootstrap.elements.find(p => p.element_type === 3 && p.minutes > 400);
  const saved = base.defensive_contribution_per_90;

  base.defensive_contribution_per_90 = 0;
  const bez = w.eval('perMatchXp')(base, 3, true);
  base.defensive_contribution_per_90 = 24;      // dvojnásobek prahu
  const s = w.eval('perMatchXp')(base, 3, true);
  base.defensive_contribution_per_90 = saved;

  if(!(s > bez)) throw new Error(`bez=${bez.toFixed(2)} s=${s.toFixed(2)}`);
  if(s - bez > 2.1) throw new Error('přidal víc než maximum 2 body: ' + (s - bez));
  return `+${(s - bez).toFixed(2)} b`;
});

check('brankář z DefCon nic nedostane', () => {
  const gk = bootstrap.elements.find(p => p.element_type === 1 && p.minutes > 400);
  const saved = gk.defensive_contribution_per_90;
  gk.defensive_contribution_per_90 = 0;
  const bez = w.eval('perMatchXp')(gk, 3, true);
  gk.defensive_contribution_per_90 = 30;
  const s = w.eval('perMatchXp')(gk, 3, true);
  gk.defensive_contribution_per_90 = saved;
  if(Math.abs(s - bez) > 1e-9) throw new Error('brankáři se projekce změnila');
  return 'beze změny';
});

check('DefCon roste plynule, ne skokem na prahu', () => {
  const p = bootstrap.elements.find(x => x.element_type === 2 && x.minutes > 400);
  const saved = p.defensive_contribution_per_90;
  const at = v => { p.defensive_contribution_per_90 = v; return w.eval('perMatchXp')(p, 3, true); };
  const a = at(9), b = at(10), c = at(11);
  p.defensive_contribution_per_90 = saved;
  if(!(a < b && b < c)) throw new Error(`${a.toFixed(3)} / ${b.toFixed(3)} / ${c.toFixed(3)}`);
  if(c - a > 0.9) throw new Error('skok kolem prahu je moc ostrý: ' + (c - a).toFixed(2));
  return 'monotónní, bez skoku';
});

/* ================= prodejní ceny z transfers/ ================= */

check('sellFromBuy vrací jen polovinu zisku', () => {
  const f = w.eval('sellFromBuy');
  // koupeno za 5.0, teď 5.4 → zisk 4 desetiny, vrátí se 2 → 5.2
  if(f(54, 50) !== 52) throw new Error('54/50 → ' + f(54, 50));
  // lichý zisk se zaokrouhluje dolů: 5.0 → 5.3 dá 5.1
  if(f(53, 50) !== 51) throw new Error('53/50 → ' + f(53, 50));
  return '5.4/5.0 → 5.2 · 5.3/5.0 → 5.1';
});

check('při zlevnění se ztráta promítne celá', () => {
  const f = w.eval('sellFromBuy');
  if(f(46, 50) !== 46) throw new Error('46/50 → ' + f(46, 50));
  if(f(50, 50) !== 50) throw new Error('50/50 → ' + f(50, 50));
  return 'ztráta celá, beze změny nic';
});

check('buildBuyCost bere poslední nákup, ne první', () => {
  const m = w.eval('buildBuyCost')([
    {element_in: 7, element_in_cost: 50, event: 3},
    {element_in: 7, element_in_cost: 58, event: 9},   // koupen zpátky dráž
    {element_in: 8, element_in_cost: 45, event: 5},
  ]);
  if(m[7] !== 58) throw new Error('hráč 7 → ' + m[7] + ', čekal 58');
  if(m[8] !== 45) throw new Error('hráč 8 → ' + m[8]);
  return '7→5.8m, 8→4.5m';
});

check('hráč z původního kádru: cena ze startu sezóny', () => {
  w.eval('BUY_COST = null;');
  const p = bootstrap.elements.find(x => x.cost_change_start !== 0);
  const got = w.eval('buyCost')(p);
  const want = p.now_cost - p.cost_change_start;
  if(got !== want) throw new Error(`${got} ≠ ${want}`);
  if(w.eval('sellSource')(p) !== 'start') throw new Error('špatný zdroj');
  return `${(want / 10).toFixed(1)}m`;
});

check('nákup z transfers přebije cenu ze startu', () => {
  const p = bootstrap.elements[12];
  w.eval(`BUY_COST = {${p.id}: 41};`);
  if(w.eval('buyCost')(p) !== 41) throw new Error('nevzal cenu z API');
  if(w.eval('sellSource')(p) !== 'api') throw new Error('špatný zdroj');
  w.eval('BUY_COST = null;');
  return 'api > start';
});

/* ================= oficiální predikce cen ================= */

check('priceMoves rozdělí hráče na vzestup a pokles', () => {
  const mv = w.eval('priceMoves()');
  if(!mv.ok) throw new Error('nic nenačetl');
  if(!mv.up.length || !mv.down.length)
    throw new Error(`up=${mv.up.length} down=${mv.down.length}`);
  if(!mv.up.every(x => x.likeToday > 0 || x.like3 > 0))
    throw new Error('mezi zdražujícími je někdo bez kladné predikce');
  if(!mv.down.every(x => x.likeToday < 0 || x.like3 < 0))
    throw new Error('mezi zlevňujícími je někdo bez záporné predikce');
  return `${mv.up.length} nahoru, ${mv.down.length} dolů`;
});

check('nejjistější zdražení je první', () => {
  const up = w.eval('priceMoves()').up;
  for(let i = 1; i < up.length; i++)
    if(up[i].likeToday > up[i - 1].likeToday)
      throw new Error('pořadí není podle jistoty');
  return 'jistota ' + up[0].likeToday;
});

check('bez projekcí to appka řekne místo hádání', () => {
  const saved = bootstrap.elements.map(p => p.price_change_projections);
  bootstrap.elements.forEach(p => { p.price_change_projections = []; });
  const html = w.eval('buildPrices()');
  bootstrap.elements.forEach((p, i) => { p.price_change_projections = saved[i]; });
  if(!html.includes('price_change_projections'))
    throw new Error('neřekl, že data chybí');
  return 'poctivá hláška';
});

check('buildPrices ukáže čas příští změny cen', () => {
  const html = w.eval('buildPrices()');
  if(!html.includes('Nejbližší změna cen')) throw new Error('chybí deadline z game_config');
  return 'ok';
});

/* ================= kolejnice sezóny ================= */

check('kolejnice má 38 čárek a jednu aktuální', () => {
  w.eval('drawRail()');
  const track = w.document.getElementById('railTrack');
  const all = track.querySelectorAll('.gw');
  const now = track.querySelectorAll('.gw.now');
  if(all.length !== 38) throw new Error('čárek: ' + all.length);
  if(now.length !== 1) throw new Error('aktuálních kol: ' + now.length);
  return '38 čárek, aktuální ' + now[0].dataset.gw;
});

check('kolejnice označí blank v kádru tečkou', () => {
  // tým 1 má v testovacích datech blank v GW11, tým 2 double
  w.eval('MY_SQUAD = new Set(BOOT.elements.filter(p => p.team === 1 || p.team === 2).map(p => p.id));');
  w.eval('drawRail()');
  const track = w.document.getElementById('railTrack');
  const gw11 = track.querySelectorAll('.gw')[10];
  if(!gw11.querySelector('b')) throw new Error('GW11 nemá tečku');
  if(!gw11.title.includes('volno')) throw new Error('popisek neříká volno: ' + gw11.title);
  return gw11.title;
});

check('bez načteného kádru kolejnice tečky nemá', () => {
  w.eval('MY_SQUAD = null;');
  w.eval('drawRail()');
  const dots = w.document.getElementById('railTrack').querySelectorAll('.gw b');
  if(dots.length) throw new Error('tečky bez kádru: ' + dots.length);
  return 'žádné tečky';
});

/* ================= odznaky klubů ================= */

check('crest klíčuje podle code, ne podle id', () => {
  const t = bootstrap.teams[4];          // id 5, code 15
  const html = w.eval('crest')(t.id);
  if(!html.includes('code=' + t.code))
    throw new Error('nepoužil code: ' + html.slice(0, 90));
  if(html.includes('code=' + t.id) && t.id !== t.code)
    throw new Error('použil id místo code');
  return 'code=' + t.code;
});

check('crest má záložní značku pro chybějící odznak', () => {
  const html = w.eval('crest')(1);
  if(!html.includes('onerror')) throw new Error('chybí fallback');
  if(!html.includes('#club-')) throw new Error('fallback neukazuje na sprite');
  if(!html.includes('loading="lazy"')) throw new Error('chybí lazy loading');
  return 'onerror → sprite';
});

check('crest neznámého týmu nic nevyrobí', () => {
  if(w.eval('crest')(999) !== '') throw new Error('vyrobil značku pro neexistující tým');
  return 'prázdno';
});

/* ================= plánovač přestupů ================= */

check('plánovač spočítá hit za přestup nad rámec volných', () => {
  const squad = [1, 2, 3, 4, 5].map(i => ({p: bootstrap.elements[i]}));
  w.__pl = {startGw: 11, squad, bank: 2.0, free: 1};
  w.eval('PLANNER = window.__pl;');

  const jeden = w.eval('simulatePlan')([
    {gw: 11, out: squad[0].p.id, in: bootstrap.elements[80].id}]);
  if(jeden.hits !== 0) throw new Error('jeden tah nesmí být hit');

  const dva = w.eval('simulatePlan')([
    {gw: 11, out: squad[0].p.id, in: bootstrap.elements[80].id},
    {gw: 11, out: squad[1].p.id, in: bootstrap.elements[81].id}]);
  if(dva.hits !== 1) throw new Error('dva tahy v jednom kole → hitů ' + dva.hits);
  return '1 tah = 0, 2 tahy = −4';
});

check('rozložení tahů do dvou kol hit ušetří', () => {
  const squad = [1, 2, 3, 4, 5].map(i => ({p: bootstrap.elements[i]}));
  w.__pl = {startGw: 11, squad, bank: 2.0, free: 1};
  w.eval('PLANNER = window.__pl;');
  const r = w.eval('simulatePlan')([
    {gw: 11, out: squad[0].p.id, in: bootstrap.elements[80].id},
    {gw: 12, out: squad[1].p.id, in: bootstrap.elements[81].id}]);
  if(r.hits !== 0) throw new Error('hitů ' + r.hits + ', čekal 0');
  return 'bez hitu';
});

/* Řádek ukazuje počet PRO dané kolo, ne po něm. Dřív se ukládala až
   hodnota po navýšení, takže karta prvního kola hlásila číslo platné
   pro to druhé — přesně to, čeho si všiml uživatel s jedním volným
   přestupem, kterému appka nabízela dva. */
check('řádek ukazuje volné přestupy pro dané kolo, ne pro příští', () => {
  const squad = [1, 2, 3].map(i => ({p: bootstrap.elements[i]}));
  w.__pl = {startGw: 11, squad, bank: 2.0, free: 1};
  w.eval('PLANNER = window.__pl;');
  const r = w.eval('simulatePlan')([]);
  if(r.rows[0].free !== 1)
    throw new Error('první kolo hlásí ' + r.rows[0].free + ', čekal 1');
  if(r.rows[0].freeNext !== 2)
    throw new Error('příští kolo má být 2, je ' + r.rows[0].freeNext);
  return r.rows.map(x => x.free).join(' → ');
});

check('volné přestupy se kumulují a nepřerostou strop', () => {
  const squad = [1, 2, 3].map(i => ({p: bootstrap.elements[i]}));
  w.__pl = {startGw: 11, squad, bank: 2.0, free: 1};
  w.eval('PLANNER = window.__pl;');
  const r = w.eval('simulatePlan')([]);
  const cap = 1 + bootstrap.game_settings.max_extra_free_transfers;
  const rada = r.rows.map(x => x.free);
  if(rada.join(',') !== '1,2,3,4') throw new Error('řada: ' + rada);
  if(rada.some(v => v > cap)) throw new Error('přerostlo strop ' + cap);
  return rada.join(' → ') + ' (strop ' + cap + ')';
});

check('při jednom volném přestupu je druhý tah hit', () => {
  const squad = [1, 2, 3, 4].map(i => ({p: bootstrap.elements[i]}));
  w.__pl = {startGw: 11, squad, bank: 30, free: 1};
  w.eval('PLANNER = window.__pl;');
  const r = w.eval('simulatePlan')([
    {gw: 11, out: squad[0].p.id, in: bootstrap.elements[90].id},
    {gw: 11, out: squad[1].p.id, in: bootstrap.elements[91].id}]);
  if(r.rows[0].paid !== 1) throw new Error('placených tahů: ' + r.rows[0].paid);
  if(r.hits !== 1) throw new Error('hitů: ' + r.hits);
  return '−4 body';
});

/* ================= dopočet volných přestupů ================= */

check('bez odehraných přestupů má člověk jeden volný', () => {
  if(w.eval('deriveFreeTransfers')([], [], 2) !== 1) throw new Error('nesedí GW2');
  return '1';
});

check('nevyužité přestupy se kumulují', () => {
  const f = w.eval('deriveFreeTransfers');
  // nic neuděláno v GW2 ani GW3 → do GW4 jdou tři
  if(f([], [], 4) !== 3) throw new Error('GW4 → ' + f([], [], 4));
  return 'GW4 → 3';
});

check('spotřebovaný přestup se z počítadla odečte', () => {
  const f = w.eval('deriveFreeTransfers');
  // v GW2 jeden přestup → do GW3 jde zase jen jeden
  if(f([{event: 2}], [], 3) !== 1) throw new Error('GW3 → ' + f([{event: 2}], [], 3));
  // dva přestupy v GW2 (jeden za hit) → zbytek 0, do GW3 jeden
  if(f([{event: 2}, {event: 2}], [], 3) !== 1) throw new Error('hit špatně');
  return 'odečteno';
});

check('dopočet nepřeroste strop ani po dlouhé pauze', () => {
  const cap = 1 + bootstrap.game_settings.max_extra_free_transfers;
  const v = w.eval('deriveFreeTransfers')([], [], 30);
  if(v !== cap) throw new Error(v + ' místo stropu ' + cap);
  return 'strop ' + cap;
});

check('wildcard resetuje počítadlo na jeden', () => {
  const f = w.eval('deriveFreeTransfers');
  // bez čipu jdou do GW5 tři (GW2→1, GW3→2, GW4→3, GW5→4)
  if(f([], [], 5) !== 4) throw new Error('kontrola bez čipu: ' + f([], [], 5));
  if(f([], [{name: 'wildcard', event: 4}], 5) !== 1)
    throw new Error('po wildcardu: ' + f([], [{name: 'wildcard', event: 4}], 5));
  if(f([], [{name: 'freehit', event: 4}], 5) !== 1) throw new Error('po free hitu');
  // ostatní čipy počítadlo nemažou
  if(f([], [{name: 'bboost', event: 4}], 5) !== 4) throw new Error('bench boost resetoval');
  return '4 → 1';
});

check('přestupy z prvního kola se nepočítají', () => {
  const f = w.eval('deriveFreeTransfers');
  // před prvním deadlinem jsou přestupy neomezené
  if(f([{event: 1}, {event: 1}, {event: 1}], [], 2) !== 1)
    throw new Error('GW1 přestupy ubraly volné');
  return 'ignorováno';
});

check('počet volných přestupů jde přepsat ručně', () => {
  w.localStorage.clear();
  w.eval('ENTRY_ID = 60480;');
  if(w.eval('ftOverride()') !== null) throw new Error('bez zápisu vrací hodnotu');
  w.localStorage.setItem('fpl_ft:60480', '3');
  if(w.eval('ftOverride()') !== 3) throw new Error('nepřečetl přepis');
  // nesmysly mimo rozsah se ignorují, ať se plán nerozbije
  w.localStorage.setItem('fpl_ft:60480', '99');
  if(w.eval('ftOverride()') !== null) throw new Error('vzal hodnotu nad strop');
  w.localStorage.clear();
  return 'přepis i kontrola rozsahu';
});

check('český tvar podle počtu', () => {
  const f = w.eval('ftLabel');
  if(!f(1).includes('volný přestup')) throw new Error(f(1));
  if(!f(3).includes('volné přestupy')) throw new Error(f(3));
  if(!f(5).includes('volných přestupů')) throw new Error(f(5));
  if(!f(0).includes('volných přestupů')) throw new Error(f(0));
  return '1 / 2–4 / 5+';
});

check('plánovač pozná, že rozpočet nevychází', () => {
  const levny = bootstrap.elements.reduce((a, b) => a.now_cost < b.now_cost ? a : b);
  const drahy = bootstrap.elements
    .filter(p => p.element_type === levny.element_type)
    .reduce((a, b) => a.now_cost > b.now_cost ? a : b);
  w.__pl = {startGw: 11, squad: [{p: levny}], bank: 0, free: 1};
  w.eval('PLANNER = window.__pl;');
  const r = w.eval('simulatePlan')([{gw: 11, out: levny.id, in: drahy.id}]);
  if(r.bank >= 0) throw new Error('banka ' + r.bank.toFixed(1) + 'm, čekal minus');
  return r.bank.toFixed(1) + 'm';
});

check('čistý zisk odečte hity od projekce', () => {
  const squad = [1, 2, 3, 4].map(i => ({p: bootstrap.elements[i]}));
  w.__pl = {startGw: 11, squad, bank: 20, free: 1};
  w.eval('PLANNER = window.__pl;');
  const r = w.eval('simulatePlan')([
    {gw: 11, out: squad[0].p.id, in: bootstrap.elements[80].id},
    {gw: 11, out: squad[1].p.id, in: bootstrap.elements[81].id}]);
  if(Math.abs(r.net - (r.gain - r.hits * 4)) > 1e-9)
    throw new Error('net nesedí: ' + r.net + ' vs ' + (r.gain - r.hits * 4));
  return `zisk ${r.gain.toFixed(1)} − hit ${r.hits * 4} = ${r.net.toFixed(1)}`;
});

check('plánovač upozorní na tah s hráčem, kterého nemáš', () => {
  const squad = [1, 2].map(i => ({p: bootstrap.elements[i]}));
  w.__pl = {startGw: 11, squad, bank: 20, free: 1};
  w.eval('PLANNER = window.__pl;');
  const cizi = bootstrap.elements[150];
  const r = w.eval('simulatePlan')([{gw: 11, out: cizi.id, in: bootstrap.elements[151].id}]);
  if(!r.rows[0].err) throw new Error('mlčky to spolkl');
  return r.rows[0].err;
});

/* ================= snapshoty miniligy ================= */

check('snapshot se neuloží dvakrát pro stejné kolo', () => {
  w.localStorage.clear();
  const a = [{entry: 1, rank: 3, total: 100}, {entry: 2, rank: 1, total: 140}];
  w.eval('saveSnap')(9, a);
  w.eval('saveSnap')(9, [{entry: 1, rank: 9, total: 999}]);
  const all = w.eval('loadSnaps()');
  if(all[9].length !== 2) throw new Error('přepsal starý snapshot');
  if(all[9][0].r !== 3) throw new Error('data se změnila');
  return 'první zápis platí';
});

check('posun v tabulce se počítá proti staršímu kolu', () => {
  w.localStorage.clear();
  w.eval('saveSnap')(8, [{entry: 42, rank: 6, total: 300}]);
  const before = w.eval('rankDelta')(42, 10);
  if(before !== 6) throw new Error('našel ' + before);
  const chip = w.eval('deltaChip')(2, before);      // z 6. na 2. = postup o 4
  if(!chip.includes('▲4')) throw new Error(chip);
  const dolu = w.eval('deltaChip')(9, before);
  if(!dolu.includes('▼3')) throw new Error(dolu);
  return '▲4 / ▼3';
});

check('bez staršího snapshotu se posun neukazuje', () => {
  w.localStorage.clear();
  if(w.eval('rankDelta')(42, 10) !== null) throw new Error('vymyslel si posun');
  if(w.eval('deltaChip')(2, null) !== '') throw new Error('vykreslil prázdný posun');
  return 'nic';
});

check('snapshotů se drží nejvýš osm kol', () => {
  w.localStorage.clear();
  for(let g = 1; g <= 12; g++) w.eval('saveSnap')(g, [{entry: 1, rank: g, total: g * 10}]);
  const keys = Object.keys(w.eval('loadSnaps()')).map(Number).sort((a, b) => a - b);
  if(keys.length !== 8) throw new Error('kol: ' + keys.length);
  if(keys[0] !== 5) throw new Error('nejstarší je GW' + keys[0] + ', čekal GW5');
  return 'GW' + keys[0] + '–GW' + keys[keys.length - 1];
});

/* ================= design tokeny ================= */

check('stupnice obtížnosti je jedna sada proměnných', () => {
  const css = fs.readFileSync('index.html', 'utf8');
  const style = css.slice(css.indexOf('<style>'), css.indexOf('</style>'));
  for(const lit of ['#8fe0b0', '#cdeed9', '#f7cac5', '#eb9a92', '#d99400'])
    if(style.toLowerCase().includes(lit)) throw new Error('zůstal literál ' + lit);
  for(const v of ['--f1:', '--f2:', '--f3:', '--f4:', '--f5:'])
    if(!style.includes(v)) throw new Error('chybí token ' + v);
  return '5 tokenů, 0 literálů';
});

check('responzivita má jeden blok na podmínku', () => {
  const css = fs.readFileSync('index.html', 'utf8');
  const style = css.slice(css.indexOf('<style>'), css.indexOf('</style>'));
  const conds = [...style.matchAll(/@media\s*\(([^)]*)\)/g)]
    .map(m => m[1].replace(/\s/g, ''));
  const dup = conds.filter((c, i) => conds.indexOf(c) !== i);
  if(dup.length) throw new Error('duplicitní podmínky: ' + [...new Set(dup)].join(', '));
  return conds.length + ' bloků, žádný dvakrát';
});

check('Dancing Script je pryč', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  if(html.includes('Dancing')) throw new Error('pořád se načítá');
  if(html.includes('--f-cur')) throw new Error('zůstala proměnná --f-cur');
  return 'ok';
});

/* Tma je vědomě přepínač, ne automatika: uživatel s tmavým systémem
   by jinak dostal variantu, o kterou si neřekl. */
check('výchozí je světlo, tma jen na přání', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  // Hledáme media query, ne zmínku — komentář o tom, proč to tak není,
  // je v pořádku a testu nemá vadit.
  if(/@media[^{]*prefers-color-scheme/.test(html))
    throw new Error('tma se pořád zapíná automaticky');
  if(!html.includes('[data-theme="dark"]')) throw new Error('chybí tmavá varianta');
  if(w.document.documentElement.getAttribute('data-theme') !== 'light')
    throw new Error('start není světlý');
  return 'light → přepínač';
});

check('přepínač tématu si volbu pamatuje', () => {
  w.localStorage.clear();
  w.eval('applyTheme')('dark');
  if(w.document.documentElement.getAttribute('data-theme') !== 'dark')
    throw new Error('nepřepnul');
  const meta = w.document.querySelector('meta[name="theme-color"]').content;
  if(meta === '#37003C') throw new Error('theme-color zůstal světlý');
  w.document.getElementById('theme').click();
  if(w.localStorage.getItem('fpl_theme') !== 'light')
    throw new Error('neuložil: ' + w.localStorage.getItem('fpl_theme'));
  return 'dark → light, uloženo';
});

/* Klasická past: [hidden] má display:none, ale .railkey{display:flex}
   ho přebije. Legenda kolejnice se pak zobrazovala pořád. */
check('atribut hidden přebije i display:flex', () => {
  const css = fs.readFileSync('index.html', 'utf8');
  if(!/\[hidden\]\{display:none!important\}/.test(css))
    throw new Error('chybí globální pravidlo pro [hidden]');
  return 'ok';
});

check('legenda kolejnice neukazuje syrovou šablonu', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const i = html.indexOf('id="railKey"');
  if(html.slice(i, i + 400).includes('{n}'))
    throw new Error('zůstal nevyplněný zástupný text {n}');
  return 'ok';
});

check('.who má flex, aby odznak nelezl na jméno', () => {
  const css = fs.readFileSync('index.html', 'utf8');
  const style = css.slice(css.indexOf('<style>'), css.indexOf('</style>'));
  if(!/(^|\n)\.who\{[^}]*flex/.test(style))
    throw new Error('základní .who není flex — odznak se překryje s textem');
  return 'ok';
});

/* ================= záložka Ceny ================= */

check('recentMovers rozdělí pohyby za poslední kolo', () => {
  const saved = bootstrap.elements.map(p => p.cost_change_event);
  bootstrap.elements.forEach((p, i) => {
    p.cost_change_event = i % 5 === 0 ? 1 : (i % 7 === 0 ? -1 : 0);
  });
  const mv = w.eval('recentMovers()');
  bootstrap.elements.forEach((p, i) => { p.cost_change_event = saved[i]; });

  if(!mv.up.length || !mv.down.length)
    throw new Error(`up=${mv.up.length} down=${mv.down.length}`);
  if(mv.up.some(p => p.cost_change_event <= 0)) throw new Error('mezi zdraženími je pokles');
  if(mv.down.some(p => p.cost_change_event >= 0)) throw new Error('mezi poklesy je zdražení');
  return `${mv.up.length} nahoru, ${mv.down.length} dolů`;
});

check('bez pohybu cen to appka řekne', () => {
  const saved = bootstrap.elements.map(p => p.cost_change_event);
  bootstrap.elements.forEach(p => { p.cost_change_event = 0; });
  const html = w.eval('buildMoved()');
  bootstrap.elements.forEach((p, i) => { p.cost_change_event = saved[i]; });
  if(!html.includes('nikdo nezdražil')) throw new Error('mlčí místo hlášky');
  return 'poctivá hláška';
});

check('sezónní pohyb ukáže cenu na startu i teď', () => {
  const html = w.eval('buildSeason()');
  if(!html.includes('Největší růst') || !html.includes('Největší propad'))
    throw new Error('chybí jedna ze stran');
  return 'ok';
});

check('Ceny mají vlastní záložku a čipy jsou pryč', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  if(!html.includes('id="t-prices"')) throw new Error('chybí tlačítko Ceny');
  if(html.includes('buildChips')) throw new Error('čipy zůstaly v kódu');
  const tabs = w.eval('TABS').map(t => t[0]);
  if(!tabs.includes('t-prices')) throw new Error('záložka není v TABS: ' + tabs);
  return tabs.length + ' záložek';
});

/* ================= plánovač: seznam hráčů a rozvržení ================= */

check('nabídka příchozích není osekaná na 40 jmen', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const i = html.indexOf('const fillIn =');
  const j = html.indexOf('q.querySelectorAll(`select[data-out', i);
  const blok = html.slice(i, i > 0 ? i + 2600 : 0);
  if(/\.slice\(0,\s*\d+\)/.test(blok))
    throw new Error('seznam se pořád ořezává napevno');
  if(!blok.includes('data-search'))
    throw new Error('chybí hledání ve jménech');
  return 'celý seznam + hledání';
});

check('plánovač počítá s kádrem po předchozích tazích', () => {
  const squad = [1, 2, 3, 4].map(i => ({p: bootstrap.elements[i]}));
  const prichozi = bootstrap.elements.find(p =>
    p.element_type === squad[0].p.element_type && !squad.some(x => x.p.id === p.id));
  w.__pl = {startGw: 11, squad, bank: 20, free: 1};
  w.eval('PLANNER = window.__pl;');

  // prodám hráče v GW11 a v GW12 ho zkusím prodat znovu — to nesmí projít
  const r = w.eval('simulatePlan')([
    {gw: 11, out: squad[0].p.id, in: prichozi.id},
    {gw: 12, out: squad[0].p.id, in: bootstrap.elements[120].id}]);
  if(!r.rows[1].err) throw new Error('spolkl prodej hráče, kterého už nemám');
  return r.rows[1].err;
});

check('kola jsou pod sebou, ne ve čtyřech sloupcích', () => {
  const css = fs.readFileSync('index.html', 'utf8');
  const style = css.slice(css.indexOf('<style>'), css.indexOf('</style>'));
  if(style.includes('.plan-grid'))
    throw new Error('zůstalo mřížkové rozvržení');
  if(!/\.plan-rows\{[^}]*flex-direction:column/.test(style))
    throw new Error('kola nejsou pod sebou');
  return 'svislý seznam';
});

check('formuláře v plánovači jsou zabalené', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  if(!html.includes('id="padd-${r.gw}" hidden'))
    throw new Error('formulář se rozbaluje rovnou');
  if(!html.includes('data-open='))
    throw new Error('chybí tlačítko na rozbalení');
  return 'na kliknutí';
});

check('plánovač vysvětlí, k čemu je', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const i = html.indexOf('id="p-planner"');
  const uvod = html.slice(i, i + 900);
  if(!uvod.includes('K čemu to je'))
    throw new Error('chybí vysvětlení účelu');
  return 'ok';
});

/* ================= proxy: 403 od Cloudflare ================= */

check('proxy se nehlásí botím User-Agentem', () => {
  const js = fs.readFileSync('api/fpl.js', 'utf8');
  if(js.includes('"fpl-squad-check/1.0"'))
    throw new Error('pořád posílá botí UA — Cloudflare vrací 403');
  if(!js.includes('Mozilla/5.0')) throw new Error('chybí hlavičky prohlížeče');
  if(!js.includes('Referer')) throw new Error('chybí Referer');
  return 'hlavičky prohlížeče';
});

check('proxy zkusí 403 ještě jednou', () => {
  const js = fs.readFileSync('api/fpl.js', 'utf8');
  if(!js.includes('fetchUpstream')) throw new Error('chybí opakování');
  if(!/status !== 403/.test(js)) throw new Error('403 se neopakuje');
  return 'dva pokusy';
});

check('fixtures/ zůstává na whitelistu', () => {
  const js = fs.readFileSync('api/fpl.js', 'utf8');
  const re = /\^fixtures\\\/\$/;
  if(!re.test(js)) throw new Error('fixtures/ z whitelistu zmizel');
  return 'ok';
});

/* ================= Hráči: hlasitá chyba místo prázdna ================= */

check('Hráči bez rozpisu neselžou potichu', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const i = html.indexOf('async function loadPlayers()');
  const fn = html.slice(i, html.indexOf('function drawPlayers()', i));
  if(!fn.includes('catch')) throw new Error('chybí zachycení chyby');
  if(!fn.includes("$('pmsg')")) throw new Error('chybu nemá kam napsat');
  if(!fn.includes("api('fixtures/')")) throw new Error('nedotáhne si rozpis sám');
  return 'chyba se zobrazí';
});

check('plátno je ve světlém režimu opravdu světlé', () => {
  const css = fs.readFileSync('index.html', 'utf8');
  const style = css.slice(css.indexOf('<style>'), css.indexOf('</style>'));
  const root = style.slice(style.indexOf(':root{'), style.indexOf('}', style.indexOf(':root{')));
  const sky = (root.match(/--sky:\s*(#[0-9a-fA-F]{6})/) || [])[1];
  if(!sky) throw new Error('--sky není definovaná');

  const lum = h => {
    const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(1 + i, 3 + i), 16) / 255);
    const f = c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  // Tmavé plátno by z appky udělalo tmavý web s bílými okny bez ohledu
  // na to, co říká data-theme.
  if(lum(sky) < 0.5) throw new Error('plátno ' + sky + ' je tmavé');
  return sky;
});

/* ================= normName ================= */

check('normName přežil odstranění staré záložky', () => {
  // Zmizel spolu s panelem „Před deadlinem“, ale volají ho tři jiná místa.
  // Projevilo se to až po napsání do vyhledávacího pole.
  const f = w.eval('normName');
  if(f('Dúbravka') !== 'dubravka') throw new Error(f('Dúbravka'));
  if(f("O'Brien Jr.") !== 'obrien jr') throw new Error(f("O'Brien Jr."));
  return 'diakritika i interpunkce pryč';
});

/* ================= vstupní obrazovka ================= */

check('vstupní obrazovka má tmavé pozadí pod světlý text', () => {
  const css = fs.readFileSync('index.html', 'utf8');
  const style = css.slice(css.indexOf('<style>'), css.indexOf('</style>'));
  const blok = style.slice(style.indexOf('#landing{'),
                           style.indexOf('}', style.indexOf('#landing{')));
  // Bílý text v kartě dává smysl jen na tmavém podkladu.
  if(!/var\(--night/.test(blok))
    throw new Error('landing nestojí na půlnočních tokenech');
  if(!/--night:#0B0B24/.test(style)) throw new Error('chybí token --night');
  if(!/--gold:#CC9C48/.test(style)) throw new Error('chybí token --gold');
  return 'půlnoční modř + zlato';
});

check('formulář je vedle nadpisu, ne pod ním', () => {
  const css = fs.readFileSync('index.html', 'utf8');
  const style = css.slice(css.indexOf('<style>'), css.indexOf('</style>'));
  if(!/#landing \.wrap\{[^}]*grid-template-columns/.test(style))
    throw new Error('není dvousloupcový');
  if(/\.hero\{padding:80px/.test(style))
    throw new Error('zůstalo staré odsazení, které tlačí formulář pod ohyb');
  return 'dva sloupce';
});

/* ================= Top hráči ================= */

check('žebříčky pokrývají všechny zadané kategorie', () => {
  const keys = w.eval('TOP_FIELD').map(x => x[0]).concat(w.eval('TOP_GK').map(x => x[0]));
  const want = ['goals_scored', 'assists', 'defensive_contribution', 'bonus',
                'expected_goals', 'expected_assists', 'expected_goal_involvements',
                'clean_sheets', 'saves'];
  const chybi = want.filter(k => !keys.includes(k));
  if(chybi.length) throw new Error('chybí: ' + chybi.join(', '));
  return keys.length + ' kategorií';
});

check('brankářské žebříčky obsahují jen brankáře', () => {
  const html = w.eval('topBoard')(w.eval('TOP_GK')[0]);
  const ids = [...html.matchAll(/data-pid="(\d+)"/g)].map(m => Number(m[1]));
  if(!ids.length) throw new Error('prázdný žebříček');
  const els = Object.fromEntries(bootstrap.elements.map(p => [p.id, p]));
  const cizi = ids.filter(id => els[id].element_type !== 1);
  if(cizi.length) throw new Error(cizi.length + ' nebrankářů v tabulce čistých kont');
  return ids.length + ' brankářů';
});

check('žebříčky hráčů v poli brankáře vynechají', () => {
  const html = w.eval('topBoard')(w.eval('TOP_FIELD')[0]);
  const ids = [...html.matchAll(/data-pid="(\d+)"/g)].map(m => Number(m[1]));
  const els = Object.fromEntries(bootstrap.elements.map(p => [p.id, p]));
  if(ids.some(id => els[id].element_type === 1))
    throw new Error('brankář v tabulce střelců');
  return ids.length + ' hráčů v poli';
});

check('žebříček je seřazený sestupně a má nejvýš 10', () => {
  const html = w.eval('topBoard')(w.eval('TOP_FIELD')[0]);
  const vals = [...html.matchAll(/class="tval">([\d.]+)</g)].map(m => parseFloat(m[1]));
  if(vals.length > 10) throw new Error('řádků: ' + vals.length);
  for(let i = 1; i < vals.length; i++)
    if(vals[i] > vals[i - 1]) throw new Error('není seřazeno: ' + vals.join(','));
  return vals.length + ' řádků, ' + vals[0] + ' nahoře';
});

check('chybějící statistiku žebříček přizná', () => {
  const saved = bootstrap.elements.map(p => p.defensive_contribution);
  bootstrap.elements.forEach(p => { delete p.defensive_contribution; });
  const html = w.eval('topBoard')(
    w.eval('TOP_FIELD').find(x => x[0] === 'defensive_contribution'));
  bootstrap.elements.forEach((p, i) => { p.defensive_contribution = saved[i]; });
  if(!html.includes('neposílá')) throw new Error('mlčí místo hlášky');
  return 'poctivá hláška';
});

check('žebříček označí hráče z tvé sestavy', () => {
  // Vybíráme někoho, kdo v žebříčku opravdu je. Řadit si vlastní kopii
  // podle jednoho kritéria nestačí — topBoard při shodě rozhoduje ještě
  // podle celkových bodů, takže „první podle gólů“ může skončit mimo top 10.
  const bez = w.eval('topBoard')(w.eval('TOP_FIELD')[0]);
  const vidit = [...bez.matchAll(/data-pid="(\d+)"/g)].map(m => Number(m[1]));
  if(!vidit.length) throw new Error('žebříček je prázdný');

  w.eval(`MY_SQUAD = new Set([${vidit[2]}]);`);
  const html = w.eval('topBoard')(w.eval('TOP_FIELD')[0]);
  w.eval('MY_SQUAD = null;');

  const oznaceno = (html.match(/class="me"/g) || []).length;
  if(oznaceno !== 1) throw new Error('označených řádků: ' + oznaceno);
  return 'právě jeden řádek';
});

/* ================= porovnání dvou hráčů ================= */

check('u ceny vyhrává nižší číslo, u bodů vyšší', () => {
  const els = bootstrap.elements;
  const levny = els.reduce((a, b) => a.now_cost < b.now_cost ? a : b);
  const drahy = els.reduce((a, b) => a.now_cost > b.now_cost ? a : b);
  const rows = w.eval('compareRows')(levny, drahy);

  const cena = rows.find(r => r[0] === 'Cena');
  if(cena[5] !== false) throw new Error('u ceny se cení vyšší číslo');
  const body = rows.find(r => r[0] === 'Body celkem');
  if(body[5] !== true) throw new Error('u bodů se cení nižší číslo');
  return 'cena níž, body výš';
});

check('dva brankáři dostanou brankářské řádky', () => {
  const gks = bootstrap.elements.filter(p => p.element_type === 1);
  const labels = w.eval('compareRows')(gks[0], gks[1]).map(r => r[0]);
  if(!labels.includes('Zákroky')) throw new Error('chybí zákroky');
  if(labels.includes('xG')) throw new Error('brankářům se ukazuje xG');
  return labels.length + ' řádků';
});

check('hráči v poli dostanou útočné řádky', () => {
  const fw = bootstrap.elements.filter(p => p.element_type === 4);
  const labels = w.eval('compareRows')(fw[0], fw[1]).map(r => r[0]);
  if(!labels.includes('xG') || !labels.includes('DEFCON'))
    throw new Error('chybí xG nebo DEFCON');
  if(labels.includes('Zákroky')) throw new Error('hráčům v poli se ukazují zákroky');
  return labels.length + ' řádků';
});

check('porovnání dvou pozic na rozdíl v bodování upozorní', () => {
  const gk = bootstrap.elements.find(p => p.element_type === 1);
  const fw = bootstrap.elements.find(p => p.element_type === 4);
  w.eval(`CMP_A = ${gk.id}; CMP_B = ${fw.id};`);
  w.eval('drawCompare()');
  const html = w.document.getElementById('pcompare').innerHTML;
  if(!html.includes('různé pozice')) throw new Error('neupozornil');
  return 'upozornil';
});

check('stejný hráč dvakrát se odmítne', () => {
  const p = bootstrap.elements[30];
  w.eval(`CMP_A = ${p.id}; CMP_B = ${p.id};`);
  w.eval('drawCompare()');
  const html = w.document.getElementById('pcompare').innerHTML;
  if(!html.includes('ten samý')) throw new Error('porovnal hráče se sebou');
  w.eval('CMP_A = CMP_B = null;');
  return 'odmítnuto';
});

check('bez výběru porovnání jen vyzve', () => {
  w.eval('CMP_A = CMP_B = null;');
  w.eval('drawCompare()');
  const html = w.document.getElementById('pcompare').innerHTML;
  if(!html.includes('Vyber dva hráče')) throw new Error(html.slice(0, 120));
  if(!html.includes('id="cmpa"')) throw new Error('chybí výběr hráčů');
  return 'výzva + oba výběry';
});

check('vítěz řádku se zvýrazní jen na jedné straně', () => {
  const els = bootstrap.elements.filter(p => p.element_type === 3);
  const a = els.reduce((x, y) => x.total_points > y.total_points ? x : y);
  const b = els.reduce((x, y) => x.total_points < y.total_points ? x : y);
  w.eval(`CMP_A = ${a.id}; CMP_B = ${b.id};`);
  w.eval('drawCompare()');
  const doc = w.document.getElementById('pcompare');
  const rows = [...doc.querySelectorAll('.ctab tr')];
  if(!rows.length) throw new Error('žádné řádky');
  const oba = rows.filter(tr => tr.querySelectorAll('td.win').length > 1);
  if(oba.length) throw new Error(oba.length + ' řádků má vítěze na obou stranách');
  w.eval('CMP_A = CMP_B = null;');
  return rows.length + ' řádků';
});

check('záložka se jmenuje Top hráči a stará tabulka je pryč', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  if(!html.includes('>Top hráči</button>')) throw new Error('starý název');
  if(html.includes('function drawPlayers')) throw new Error('stará tabulka zůstala');
  if(html.includes('id="fsort"')) throw new Error('staré filtry zůstaly');
  return 'ok';
});

/* ================= diferenciály ================= */

/* Jistota minut je teď číslo 0–1, ne ano/ne. Tvrdý filtr nefungoval
   první měsíc sezóny — kdo odehrál dvě kola, měl málo minut ze své
   podstaty, ne proto, že by nehrál. */
check('jistota minut je škála, ne ano/ne', () => {
  const f = w.eval('minuteConfidence');
  const zaklad = {...bootstrap.elements[5], status: 'a',
                  chance_of_playing_next_round: 100};

  const stalice = f({...zaklad, minutes: 900, starts: 10}, 10);
  const strídající = f({...zaklad, minutes: 200, starts: 1}, 10);

  if(stalice < 0.85) throw new Error('stálice má nízkou jistotu: ' + stalice);
  if(strídající >= 0.5) throw new Error('střídající má vysokou jistotu: ' + strídající);
  if(!(stalice > strídající)) throw new Error('nerozlišuje');
  return `stálice ${stalice.toFixed(2)}, střídající ${strídající.toFixed(2)}`;
});

check('nedostupný hráč má nulovou jistotu', () => {
  const f = w.eval('minuteConfidence');
  const p = {...bootstrap.elements[5], minutes: 900, starts: 10,
             chance_of_playing_next_round: 100};
  for(const st of ['i', 'u', 'n', 's'])
    if(f({...p, status: st}, 10) !== 0) throw new Error('vzal status ' + st);
  if(f({...p, status: 'a', chance_of_playing_next_round: 25}, 10) !== 0)
    throw new Error('vzal hráče s 25% šancí');
  return 'nula';
});

check('před prvním kolem se jistota bere z ceny', () => {
  const f = w.eval('minuteConfidence');
  const zaklad = {status: 'a', minutes: 0, starts: 0,
                  chance_of_playing_next_round: null};
  const drahy = f({...zaklad, now_cost: 130}, 0);
  const levny = f({...zaklad, now_cost: 40}, 0);
  // Bez odehraných kol neříkají minuty nic — drahý hráč nesedí na lavičce.
  if(!(drahy > levny)) throw new Error(`drahý ${drahy}, levný ${levny}`);
  if(drahy <= 0) throw new Error('i drahý hráč vyšel na nulu');
  return `13.0m → ${drahy.toFixed(2)}, 4.0m → ${levny.toFixed(2)}`;
});

check('žebříček diferenciálů není nikdy prázdný', () => {
  // I s nesmyslně přísným prvním stropem musí něco vypadnout
  const res = w.eval('diffRows')(bootstrap.elements, 11,
    () => 90, 9, [{max: 0.1, label: 'nemožný'}, {max: 101, label: 'vše'}]);
  if(!res.rows.length) throw new Error('vrátil prázdno');
  if(res.tier.label !== 'vše') throw new Error('nepovolil strop: ' + res.tier.label);
  return res.rows.length + ' hráčů, strop povolen';
});

check('appka řekne, když musela strop povolit', () => {
  const html = w.eval('buildDifferentials()');
  if(!/Top 5 diferenciálů · celé FPL/.test(html)) throw new Error('chybí globální blok');
  if(/Nikdo neprošel filtrem/.test(html)) throw new Error('pořád může skončit prázdně');
  return 'ok';
});

check('nižší vlastnictví zvedne skóre při stejné projekci', () => {
  const f = w.eval('diffScore');
  const p = bootstrap.elements[7];
  const vzacny = f(p, 11, 2, 1), bezny = f(p, 11, 40, 1);
  if(vzacny.xp !== bezny.xp) throw new Error('projekce se liší, test nic neměří');
  if(!(vzacny.score > bezny.score))
    throw new Error(`2 % → ${vzacny.score.toFixed(2)}, 40 % → ${bezny.score.toFixed(2)}`);
  return `2 % je ${(vzacny.score / bezny.score).toFixed(1)}× výš`;
});

check('extrémně nízké vlastnictví neuteče do nekonečna', () => {
  const f = w.eval('diffScore');
  const p = bootstrap.elements[7];
  // 0,1 % a 0 % musí dát totéž — páka je useknutá zdola
  if(f(p, 11, 0.1, 1).score !== f(p, 11, 0, 1).score)
    throw new Error('nulové vlastnictví se neusekává');
  return 'useknuto';
});

check('diferenciály vrátí nejvýš pět hráčů seřazených podle skóre', () => {
  const pool = bootstrap.elements.filter(p => p.element_type !== 1).slice(0, 60);
  const {rows} = w.eval('diffRows')(pool, 11,
    p => parseFloat(p.selected_by_percent), 9);
  if(rows.length > 5) throw new Error('řádků: ' + rows.length);
  for(let i = 1; i < rows.length; i++)
    if(rows[i].score > rows[i - 1].score) throw new Error('není seřazeno');
  return rows.length + ' hráčů';
});

check('bez načtené miniligy to diferenciály přiznají', () => {
  w.eval('LEAGUE_OWN = null;');
  const html = w.eval('buildDifferentials()');
  if(!html.includes('celé FPL')) throw new Error('chybí globální část');
  if(!html.includes('Miniliga</b>')) throw new Error('neřekl, že chybí liga');
  return 'poctivá hláška';
});

check('s načtenou miniligou se počítá i ligové vlastnictví', () => {
  const els = bootstrap.elements;
  // deset manažerů, jeden hráč u všech, jiný u jednoho
  w.eval(`LEAGUE_OWN = {n: 10, owners: {
    ${els[3].id}: ['a','b','c','d','e','f','g','h','i','j'],
    ${els[4].id}: ['a']
  }};`);
  const html = w.eval('buildDifferentials()');
  w.eval('LEAGUE_OWN = null;');
  if(!html.includes('10 manažerů')) throw new Error('nezmínil velikost ligy');
  if(html.includes('Miniliga</b>')) throw new Error('pořád si stěžuje na chybějící ligu');
  return 'ligová část vykreslena';
});

/* ================= historie miniligy ================= */

// Sezony mimo CONFIG.officialSeasons, at fixture netestuje dve veci naraz.
const pastFixture = [
  {past: [{season_name: '2023/24', total_points: 2100, rank: 500000},
          {season_name: '2024/25', total_points: 2300, rank: 200000},
          {season_name: '2025/26', total_points: 2500, rank: 90000}]},
  {past: [{season_name: '2024/25', total_points: 2400, rank: 150000},
          {season_name: '2025/26', total_points: 2200, rank: 400000}]},
  {past: []},
];
const histMembers = [
  {entry: 1, player_name: 'Adam', entry_name: 'A'},
  {entry: 2, player_name: 'Bob', entry_name: 'B'},
  {entry: 3, player_name: 'Cyril', entry_name: 'C'},
];

check('historie poskládá sezóny ze všech členů', () => {
  const h = w.eval('buildLeagueHistory')(histMembers, pastFixture);
  if(h.cols.join(',') !== '2023/24,2024/25,2025/26')
    throw new Error('sloupce: ' + h.cols);
  return h.cols.length + ' sezón';
});

check('historie drží nejvýš šest sezón', () => {
  const many = [{past: Array.from({length: 10}, (_, i) => ({
    season_name: `20${10 + i}/${11 + i}`, total_points: 2000 + i, rank: 1000}))}];
  const h = w.eval('buildLeagueHistory')([histMembers[0]], many);
  if(h.cols.length !== 6) throw new Error('sloupců: ' + h.cols.length);
  if(h.cols[5] !== '2019/20') throw new Error('nedrží ty nejnovější: ' + h.cols);
  return 'posledních 6';
});

check('kdo sezónu nehrál, nedostane poslední místo', () => {
  const h = w.eval('buildLeagueHistory')(histMembers, pastFixture);
  // 2023/24 hrál jen Adam → je první a nikdo jiný v pořadí není
  if(h.order['2023/24'].size !== 1) throw new Error('do pořadí se dostal někdo, kdo nehrál');
  if(h.order['2023/24'].get(1) !== 1) throw new Error('Adam není první');
  // 2024/25 hráli dva, Bob má víc bodů → je první
  if(h.order['2024/25'].get(2) !== 1) throw new Error('Bob měl vyhrát 2024/25');
  if(h.order['2024/25'].get(1) !== 2) throw new Error('Adam měl být druhý');
  return 'pořadí jen z těch, kdo hráli';
});

/* ================= oficiální sezóny a trofeje ================= */

check('medaile dostanou jen ti, kdo za ligu tehdy nastoupili', () => {
  // 2021/22 je v CONFIG omezená na tři jména; Adam ani Bob mezi ně nepatří
  const rane = [
    {past: [{season_name: '2021/22', total_points: 2400, rank: 100}]},
    {past: [{season_name: '2021/22', total_points: 2300, rank: 200}]},
    {past: [{season_name: '2021/22', total_points: 1000, rank: 900}]},
  ];
  const h = w.eval('buildLeagueHistory')(histMembers, rane);
  if(h.order['2021/22'].size !== 0)
    throw new Error('rozdal medaile lidem mimo ligu: ' + h.order['2021/22'].size);
  if(h.rows.some(r => r.medals[1])) throw new Error('někdo dostal zlato');
  return 'nikdo neoprávněně';
});

check('oficiální člen medaili v rané sezóně dostane', () => {
  const clenove = [
    {entry: 11, player_name: 'Krystof Benka', entry_name: 'Prague Patriots'},
    {entry: 12, player_name: 'Filip Buddeus', entry_name: 'Debils'},
    {entry: 13, player_name: 'Cizinec', entry_name: 'X'},
  ];
  const data = [
    {past: [{season_name: '2021/22', total_points: 2430, rank: 234483}]},
    {past: [{season_name: '2021/22', total_points: 2100, rank: 999999}]},
    {past: [{season_name: '2021/22', total_points: 2900, rank: 10}]},   // mimo ligu
  ];
  const h = w.eval('buildLeagueHistory')(clenove, data);
  const benka = h.rows.find(r => r.m.entry === 11);
  const cizi = h.rows.find(r => r.m.entry === 13);
  if(benka.medals[1] !== 1)
    throw new Error('Benka nedostal zlato, i když měl nejvíc z oficiálních');
  if(cizi.medals[1] || cizi.medals[2] || cizi.medals[3])
    throw new Error('cizinec s nejvyššími body dostal medaili');
  return 'Benka zlato, cizinec nic';
});

check('jméno se páruje bez ohledu na diakritiku', () => {
  const f = w.eval('officialIn');
  if(!f('2021/22', {entry: 1, player_name: 'Kryštof Benka'}))
    throw new Error('nespároval Kryštof/Krystof');
  if(f('2021/22', {entry: 1, player_name: 'Někdo Jiný'}))
    throw new Error('pustil cizí jméno');
  if(!f('2026/27', {entry: 1, player_name: 'Kdokoli'}))
    throw new Error('neomezená sezóna má pustit všechny');
  return 'diakritika i neomezené sezóny';
});

check('žebříček trofejí řadí zlatem před stříbrem', () => {
  const rows = [
    {m: {entry: 1, player_name: 'Jedno zlato'}, medals: {1: 1, 2: 0, 3: 0}},
    {m: {entry: 2, player_name: 'Tři stříbra'}, medals: {1: 0, 2: 3, 3: 0}},
    {m: {entry: 3, player_name: 'Nic'}, medals: {1: 0, 2: 0, 3: 0}},
  ];
  const html = w.eval('trophyTable')(rows);
  if(html.indexOf('Jedno zlato') > html.indexOf('Tři stříbra'))
    throw new Error('tři stříbra přeskočila zlato');
  if(html.includes('Nic')) throw new Error('vypsal někoho bez medaile');
  return 'zlato > stříbro';
});

check('historie neukazuje dva řádky drobného textu v každé buňce', () => {
  const html = w.eval('renderLeagueHistory')(histMembers, pastFixture, 1);
  if(html.includes('celkově</u>'))
    throw new Error('pořadí je pořád vypsané v buňce místo v title');
  if(!html.includes('title=')) throw new Error('detail se nikam neschoval');
  return 'detail v title';
});

check('nehraná sezóna se ukáže tečkou, ne nulou', () => {
  const html = w.eval('renderLeagueHistory')(histMembers, pastFixture, 1);
  if(!html.includes('empty')) throw new Error('chybí prázdná buňka');
  if(/class="n">0</.test(html)) throw new Error('vyrobil nulu tam, kde chybí data');
  return 'tečka';
});

check('historie přizná, že pořadí miniligy z API není', () => {
  const html = w.eval('renderLeagueHistory')(histMembers, pastFixture, 1);
  if(!html.includes('neposílá pořadí miniligy'))
    throw new Error('tváří se to jako skutečný archiv ligy');
  return 'omezení uvedeno';
});

check('bez historie u kohokoli to appka řekne', () => {
  const html = w.eval('renderLeagueHistory')([histMembers[2]], [{past: []}], 3);
  if(!html.includes('nemá v FPL zaznamenanou')) throw new Error(html.slice(0, 100));
  return 'poctivá hláška';
});

/* ================= zisk z projekce ================= */

check('plánovač ukáže zisk u každého tahu zvlášť', () => {
  const squad = [1, 2, 3, 4].map(i => ({p: bootstrap.elements[i]}));
  w.__pl = {startGw: 11, squad, bank: 30, free: 2, derived: 2, manual: false};
  w.eval('PLANNER = window.__pl;');
  const r = w.eval('simulatePlan')([
    {gw: 11, out: squad[0].p.id, in: bootstrap.elements[95].id}]);
  const d = r.rows[0].detail[0];
  if(!Number.isFinite(d.gain)) throw new Error('tah nenese vlastní zisk');
  if(Math.abs(d.gain - r.gain) > 1e-9)
    throw new Error('součet nesedí s jediným tahem: ' + d.gain + ' vs ' + r.gain);
  return d.gain.toFixed(1) + ' b';
});

check('plánovač vysvětlí, odkud se zisk bere', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  if(!html.includes('Co je „zisk z projekce“'))
    throw new Error('chybí vysvětlení');
  if(!html.includes('můj odhad, ne oficiální číslo FPL'))
    throw new Error('nerozlišuje vlastní model od projekce FPL');
  return 'vysvětleno';
});

/* ================= režim jedné miniligy ================= */

check('vstup nabídne seznam členů místo pole na ID', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  if(!html.includes('id="whoami"')) throw new Error('chybí rozbalovací seznam');
  if(!html.includes('id="manualToggle"')) throw new Error('chybí únikový odkaz na ruční zadání');
  if(!/leagueId:\s*'\d+'/.test(html)) throw new Error('CONFIG.leagueId není předvyplněné');
  return 'seznam + záloha';
});

check('ruční zadání jde pořád otevřít', () => {
  const d = w.document;
  w.eval('setGateMode(true)');
  if(d.getElementById('manualFields').hidden) throw new Error('ruční pole zůstala schovaná');
  if(!d.getElementById('pickField').hidden) throw new Error('seznam se neschoval');
  w.eval('setGateMode(false)');
  if(!d.getElementById('manualFields').hidden) throw new Error('nevrátilo se to zpět');
  return 'přepíná se';
});

check('odpočet je dvouřádkový a ne drobný monospace', () => {
  w.eval('startCountdown')();
  const el = w.document.getElementById('countdown');
  if(!el.querySelector('.lbl') || !el.querySelector('.val'))
    throw new Error('chybí popisek nebo hodnota');
  const css = fs.readFileSync('index.html', 'utf8');
  if(!/\.cd \.val\{[^}]*font-size:16px/.test(css))
    throw new Error('hodnota není dost velká');
  return el.querySelector('.val').textContent.trim();
});

check('odpočet zkracuje jednotky podle zbývajícího času', () => {
  const el = w.document.getElementById('countdown');
  w.eval('startCountdown')();
  const txt = el.textContent;
  // fixture má deadline za ~3 h, takže hodiny a minuty, ne dny
  if(/\d+ d /.test(txt)) throw new Error('ukazuje dny, i když zbývají hodiny: ' + txt);
  if(!/h \d\d min/.test(txt)) throw new Error('čekal hodiny a minuty: ' + txt);
  return txt.replace(/\s+/g, ' ').trim();
});

check('logo v hlavičce je obrázek, ne inline SVG', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const i = html.indexOf('class="brand"');
  const blok = html.slice(i, i + 320);
  if(!/\/assets\/(mark|logo-transp)\.webp/.test(blok)) throw new Error('logo se nepoužívá');
  if(blok.includes('<svg')) throw new Error('zůstalo inline SVG');
  return 'obrázek z /assets';
});

check('vstupní obrazovka používá plakát', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  if(!html.includes('/assets/headline.webp')) throw new Error('plakát chybí');
  if(!/class="poster"/.test(html)) throw new Error('plakát nemá vlastní styl');
  return 'headline.webp';
});

/* ================= pozdější příchod do ligy ================= */

check('kdo přišel později, nemá medaile ze starších sezón', () => {
  const f = w.eval('officialIn');
  const marko = {entry: 77, player_name: 'Adam Marko'};
  if(f('2023/24', marko)) throw new Error('počítá ho v 2023/24');
  if(f('2024/25', marko)) throw new Error('počítá ho v 2024/25');
  if(!f('2025/26', marko)) throw new Error('nepočítá ho od 2025/26');
  if(!f('2026/27', marko)) throw new Error('nepočítá ho v aktuální sezóně');
  return 'oficiální až od 2025/26';
});

check('ostatní členy pozdější příchod neomezí', () => {
  const f = w.eval('officialIn');
  const kdokoli = {entry: 78, player_name: 'Daniel Fábry'};
  if(!f('2023/24', kdokoli)) throw new Error('omezil někoho, kdo v memberSince není');
  return 'bez omezení';
});

check('obě pravidla platí zároveň', () => {
  const f = w.eval('officialIn');
  // 2021/22 má pevnou soupisku i pozdější příchod — obojí musí zabrat
  if(f('2021/22', {entry: 77, player_name: 'Adam Marko'}))
    throw new Error('pustil ho do sezóny s pevnou soupiskou');
  if(!f('2021/22', {entry: 79, player_name: 'Filip Buddeus'}))
    throw new Error('nepustil člena z pevné soupisky');
  return 'soupiska i datum příchodu';
});

check('pozdější příchod sebere medaili, ne řádek', () => {
  const clenove = [
    {entry: 11, player_name: 'Krystof Benka', entry_name: 'A'},
    {entry: 77, player_name: 'Adam Marko', entry_name: 'B'},
  ];
  const data = [
    {past: [{season_name: '2024/25', total_points: 2000, rank: 100}]},
    {past: [{season_name: '2024/25', total_points: 2900, rank: 5}]},
  ];
  const h = w.eval('buildLeagueHistory')(clenove, data);
  const marko = h.rows.find(r => r.m.entry === 77);
  if(marko.medals[1]) throw new Error('dostal zlato za sezónu před příchodem');
  if(h.order['2024/25'].get(11) !== 1) throw new Error('Benka není první');

  // ale body v tabulce zůstanou, jen šedě
  const html = w.eval('renderLeagueHistory')(clenove, data, 11);
  if(!html.includes('2900')) throw new Error('smazal mu body úplně');
  if(!html.includes('guest')) throw new Error('neoznačil je jako mimo ligu');
  return 'body šedě, medaile ne';
});

/* ================= čitelnost vstupní obrazovky ================= */

check('položky rozbalené nabídky nejsou bílé na bílém', () => {
  const css = fs.readFileSync('index.html', 'utf8');
  const style = css.slice(css.indexOf('<style>'), css.indexOf('</style>'));
  // <option> kreslí OS na bílém a dědí color z .gate select
  if(!/\.gate select option\{[^}]*color:#1F0A24/.test(style))
    throw new Error('option nemá vlastní tmavou barvu textu');
  return 'tmavý text na bílé';
});

check('hlavička používá oříznutý pohár, ne celé logo', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const i = html.indexOf('class="brand"');
  const blok = html.slice(i, i + 300);
  if(!blok.includes('/assets/mark.webp'))
    throw new Error('v hlavičce je pořád logo s textem');
  return 'mark.webp';
});

/* ================= automatické načtení ligových záložek ================= */

check('ligové záložky se načtou samy při otevření', () => {
  const init = w.eval('Object.keys(TAB_INIT)');
  for(const t of ['t-league', 't-hub'])
    if(!init.includes(t)) throw new Error(t + ' není v TAB_INIT');
  return init.length + ' záložek se inicializuje samo';
});

check('načítá se při otevření záložky, ne při startu appky', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  // TAB_INIT se volá ze selectTab, tedy až když na záložku někdo přepne.
  if(!/TAB_INIT\[tid\]\s*&&\s*!TAB_DONE\.has\(tid\)/.test(html))
    throw new Error('chybí spouštění přes selectTab');
  return 'lazy';
});

check('každá záložka se spustí jen jednou', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  if(!html.includes('TAB_DONE.add(tid)')) throw new Error('chybí pojistka proti opakování');
  if(!html.includes('TAB_DONE.clear()'))
    throw new Error('po přepnutí týmu by zůstalo, že už je načteno');
  return 'jednou, a po přepnutí týmu znovu';
});

check('bez ID ligy se auto-načtení jen ozve', () => {
  w.localStorage.removeItem('fpl_league');
  const saved = w.eval('CONFIG.leagueId');
  w.eval("CONFIG.leagueId = '';");
  w.eval('autoLoadLeague()');
  const msg = w.document.getElementById('lmsg').textContent;
  w.eval(`CONFIG.leagueId = '${saved}';`);
  if(!msg.includes('ID miniligy')) throw new Error('mlčí: ' + msg);
  return 'poctivá hláška';
});

check('dropCached zahodí jen odpovídající klíče', () => {
  w.eval("API_CACHE.set('leagues-classic/1/standings/', 'A')");
  w.eval("API_CACHE.set('entry/60480/history/', 'B')");
  w.eval("API_CACHE.set('bootstrap-static/', 'C')");
  w.eval('dropCached(/^(leagues-classic|entry)\\//)');
  if(w.eval("API_CACHE.has('leagues-classic/1/standings/')")) throw new Error('nechal standings');
  if(w.eval("API_CACHE.has('entry/60480/history/')")) throw new Error('nechal historii');
  if(!w.eval("API_CACHE.has('bootstrap-static/')"))
    throw new Error('zahodil i bootstrap, který se měnit nemusí');
  w.eval("API_CACHE.delete('bootstrap-static/')");
  return 'ligové pryč, bootstrap zůstal';
});

check('tlačítko Aktualizovat cache opravdu zneplatní', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const i = html.indexOf("$('lgo').addEventListener");
  const blok = html.slice(i, i + 500);
  // Bez zneplatnění by se jen překreslila tatáž data z paměti.
  if(!blok.includes('dropCached'))
    throw new Error('tlačítko by vrátilo stará data z cache');
  const j = html.indexOf("$('hubgo').addEventListener");
  if(!html.slice(j, j + 300).includes('dropCached'))
    throw new Error('hub neaktualizuje');
  return 'obě tlačítka';
});

// jsdom drzi bezici setInterval odpoctu; bez tohohle proces nikdy neskonci
w.close();
process.exit(0);
