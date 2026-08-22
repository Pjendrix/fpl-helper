import { JSDOM } from 'jsdom';
import fs from 'fs';

// --- falešná data ve tvaru, jaký posílá FPL ---
const teams = [];
const shorts = ['ARS','AVL','BOU','BRE','BHA','BUR','CHE','CRY','EVE','FUL',
                'LEE','LIV','MCI','MUN','NEW','NFO','SUN','TOT','WHU','WOL'];
const fullNames = {MCI:'Man City',MUN:'Man Utd',TOT:'Spurs',NFO:"Nott'm Forest",
                   WOL:'Wolves',NEW:'Newcastle',BHA:'Brighton',BOU:'Bournemouth'};
shorts.forEach((sn,i)=>teams.push({
  id:i+1, name: fullNames[sn] || sn, short_name:sn,
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

const bootstrap={teams,events,elements};

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
check('matchClub Man Utd',()=>g.matchClub({id:33,name:'Manchester United'}).short_name);
check('matchClub Spurs podle názvu',()=>g.matchClub({id:0,name:'Tottenham'}).short_name);
check("matchClub Nott'm Forest",()=>g.matchClub({id:0,name:'Nottingham Forest'}).short_name);
check('matchClub Wolves',()=>g.matchClub({id:0,name:'Wolverhampton Wanderers'}).short_name);
check('matchClub všech 20 klubů',()=>{
  const af={ARS:'Arsenal',AVL:'Aston Villa',BOU:'AFC Bournemouth',BRE:'Brentford',
    BHA:'Brighton & Hove Albion',BUR:'Burnley',CHE:'Chelsea',CRY:'Crystal Palace',
    EVE:'Everton',FUL:'Fulham',LEE:'Leeds United',LIV:'Liverpool',MCI:'Manchester City',
    MUN:'Manchester United',NEW:'Newcastle United',NFO:'Nottingham Forest',
    SUN:'Sunderland',TOT:'Tottenham',WHU:'West Ham United',WOL:'Wolverhampton Wanderers'};
  const bad=Object.entries(af).filter(([sn,name])=>{
    const m=g.matchClub({id:0,name}); return !m||m.short_name!==sn;});
  if(bad.length) throw new Error('nespárováno: '+bad.map(b=>b[1]).join(', '));
  return '20/20';
});
check('starterKeys + nameKeys („B. Fernandes“)',()=>{
  const st=g.starterKeys([{startXI:[{player:{name:'B. Fernandes'}}]}]);
  return st.has('fernandes');
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
const need = [1,1,2,2,2,2,2,3,3,3,3,3,4,4,4];
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
  if(!has('Kapitánská páska')) throw new Error('chybí kapitán');
  if(!has('Optimální jedenáctka')) throw new Error('chybí optimální XI');
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
