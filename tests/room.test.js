import test from 'node:test';
import assert from 'node:assert/strict';
import {handleAPI} from '../worker/api.js';
import {NOUNS} from '../worker/nouns.js';
import {calculateRound,validateStake,stakeLimit} from '../worker/engine.js';

function setup(){
  const entries=new Map();let sequence=0;
  const bucket={
    async get(path){const entry=entries.get(path);return entry&&{etag:entry.etag,json:async()=>JSON.parse(entry.body)};},
    async put(path,body,options={}){const old=entries.get(path),condition=options.onlyIf;
      if(condition?.etagDoesNotMatch==='*'&&old)return null;
      if(condition?.etagMatches&&old?.etag!==condition.etagMatches)return null;
      const entry={etag:String(++sequence),body};entries.set(path,entry);return entry;},
    async list({prefix}){return {objects:[...entries.keys()].filter(key=>key.startsWith(prefix)).map(key=>({key})),truncated:false};}
  };
  let code='';
  async function call(id,action,fields={},status=200){
    const req=new Request('https://example.invalid/api/rooms',{method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer '+id.repeat(64)},body:JSON.stringify({action,code,...fields})});
    const res=await handleAPI(req,bucket),data=await res.json();assert.equal(res.status,status,JSON.stringify(data));return data;
  }
  return {call,setCode:value=>{code=value;}};
}
const pass='試験合言葉',names={a:'あき',b:'はる',c:'なつ'};
async function createThree(settings){
  const env=setup(),{call,setCode}=env;
  setCode((await call('a','create',{name:names.a,phrase:pass,settings},201)).code);
  await call('b','join',{name:names.b,phrase:'異なる合言葉'},403);
  await Promise.all(['b','c'].map(id=>call(id,'join',{name:names[id],phrase:pass})));
  await call('b','start',{},403);
  const started=await call('a','start');
  const keys=Object.fromEntries(started.members.map(member=>[member.id,Object.keys(names).find(key=>names[key]===member.name)]));
  const parent=keys[started.parent],children=started.standings.slice(1).map(p=>keys[p.id]);
  return {...env,started,keys,parent,children};
}

test('random order preserves identities, private choices and correct settlement',async(t)=>{
  assert.equal(new Set(NOUNS).size,587);
  const {call,started,parent,children,keys}=await createThree({initialPoints:300,stake:10,turns:1});
  assert.equal(new Set(started.names).size,9);
  await call(children[0],'secret',{round:0,number:1},403);
  const betting=await call(parent,'secret',{round:0,number:1});
  assert.equal(betting.stage,'betting');assert.equal('secret' in betting,false);
  assert.equal(betting.mySecret,1);
  assert.equal('mySecret' in await call(children[0],'state'),false);
  assert.equal(betting.maxStake,100);
  t.mock.method(Date,'now',()=>betting.endsAt-1);
  await call(children[0],'bet',{round:0,stake:10,numbers:[1]},409);
  Date.now.mock.mockImplementation(()=>betting.endsAt);
  await call(children[0],'bet',{round:0,stake:31,numbers:[1]},400);
  await call(children[0],'bet',{round:0,stake:0,numbers:[1]},400);
  const base=betting.market[0].base;
  await Promise.all([call(children[0],'bet',{round:0,stake:10,numbers:[1]}),call(children[1],'bet',{round:0,stake:30,numbers:[1,3]})]);
  const ended=await call(parent,'state'),round=ended.history[0];
  assert.equal(ended.stage,'result');assert.equal(round.parent,started.parent);assert.equal(round.totalStakes,40);
  assert.equal(round.totalPayout,Math.floor(10*base/2)+Math.floor(30*base/4));
  assert.equal(ended.standings.reduce((n,p)=>n+p.points,0),900);
  assert.deepEqual(round.names,started.names);
  const next=await call('a','next',{round:0});assert.equal(next.parent,started.standings[1].id);assert.equal(next.stage,'secret');
  assert.notEqual(keys[next.parent],parent);
});

test('chat permits repeated lies and applies capped bonus to every correct bet',async()=>{
  const {call,parent,children}=await createThree({initialPoints:300,stake:40,turns:1,questionMode:'chat',questionsPerPlayer:6});
  const betting=await call(parent,'secret',{round:0,number:2});
  for(let i=0;i<12;i++){
    const child=children[i%2];await call(child,'ask',{round:0,text:`質問${i}`});
    if(i===0)await call(children[1],'ask',{round:0,text:'まだ？'},409);
    await call(parent,'answer',{round:0,text:'はい',isLie:true});
    if(i===0){const childView=await call(child,'state');assert.equal('isLie' in childView.chat.entries[0],false);}
  }
  await call(children[0],'bet',{round:0,numbers:[2],stake:100});
  const result=await call(children[1],'bet',{round:0,numbers:[2],stake:80}),round=result.history[0];
  assert.equal(result.stage,'result');assert.equal(round.lieCount,12);assert.equal(round.lieBonusTenths,50);
  assert.ok(round.chat.every(q=>q.isLie));
  const base=betting.market[1].base/2;
  assert.deepEqual(round.outcomes.map(o=>o.received).sort((a,b)=>a-b),[Math.floor(80*(base+5)),Math.floor(100*(base+5))].sort((a,b)=>a-b));
  assert.ok(round.outcomes.every(o=>o.baseOdds===base && o.lieBonus===5 && o.effectiveOdds===base+5));
  assert.equal(round.parentDelta,-round.outcomes.reduce((sum,o)=>sum+o.delta,0));
});

test('three lies add 1.5 to each winning multiplier',async()=>{
  const {call,parent,children}=await createThree({initialPoints:300,stake:40,turns:1,questionMode:'chat',questionsPerPlayer:2});
  const betting=await call(parent,'secret',{round:0,number:1});
  for(let i=0;i<4;i++){
    await call(children[i%2],'ask',{round:0,text:`質問${i}`});
    await call(parent,'answer',{round:0,text:'はい',isLie:i<3});
  }
  await call(children[0],'bet',{round:0,numbers:[1],stake:100});
  const result=await call(children[1],'bet',{round:0,numbers:[1],stake:100}),round=result.history[0];
  assert.equal(round.lieCount,3);assert.equal(round.lieBonusTenths,15);
  assert.ok(round.outcomes.every(o=>o.lieBonus===1.5&&o.received===Math.floor(100*(betting.market[0].base/2+1.5))));
});

test('lie bonus uses exact final rounding and old rounds keep their historical payouts',()=>{
  const game={rulesVersion:2,settings:{stake:10}},round={answer:1,odds:[5,6,7,8,9,10,12,15,20],bets:[{playerId:'p2',stake:7,numbers:[1,2,3]}]};
  const previous=calculateRound(game,round).outcomes[0];
  const current=calculateRound(game,{...round,lieBonusTenths:3}).outcomes[0];
  assert.equal(previous.received,11);assert.equal(previous.lieBonus,0);
  assert.equal(current.received,13);assert.equal(current.lieBonus,0.3);
  const miss=calculateRound(game,{...round,answer:9,lieBonusTenths:3}).outcomes[0];assert.equal(miss.received,0);assert.equal(miss.delta,-7);
});

test('unknown increases parent risk and transfers the same amount from asker to other children',async()=>{
  const {call,started,parent,children,keys}=await createThree({initialPoints:300,stake:40,turns:1,questionMode:'chat',questionsPerPlayer:1});
  const betting=await call(parent,'secret',{round:0,number:1});
  await call(children[0],'ask',{round:0,text:'難しい？'});
  await call(children[1],'answer',{round:0,isUnknown:true},403);
  const answered=await call(parent,'answer',{round:0,isUnknown:true});
  assert.equal(answered.chat.entries[0].answer,'わからない');assert.equal(answered.chat.entries[0].isUnknown,true);
  await call(children[1],'ask',{round:0,text:'やさしい？'});await call(parent,'answer',{round:0,text:'はい',isLie:false});
  await call(children[0],'bet',{round:0,numbers:[1],stake:100});
  const result=await call(children[1],'bet',{round:0,numbers:[1],stake:100}),r=result.history[0];
  assert.equal(r.lieCount,0);assert.equal(r.lieBonusTenths,5);
  const id=started.members.find(m=>keys[m.id]===children[0]).id,other=started.members.find(m=>keys[m.id]===children[1]).id;
  assert.deepEqual(r.unknownTransfers,[{playerId:id,amount:100,shares:[{playerId:other,points:100}]}]);
  const asker=r.outcomes.find(o=>o.playerId===id),recipient=r.outcomes.find(o=>o.playerId===other);
  const baseline=Math.floor(100*betting.market[0].base/2);
  assert.equal(asker.received,baseline+50);assert.equal(asker.delta,asker.received-100-100);
  assert.equal(recipient.delta,recipient.received-100+100);
  assert.equal(r.parentDelta,-(asker.received-100)-(recipient.received-100));
  assert.equal(result.standings.reduce((sum,p)=>sum+p.points,0),900);
});

test('a typed unknown answer uses the same rules as the button',async()=>{
  const {call,parent,children}=await createThree({initialPoints:300,stake:40,turns:1,questionMode:'chat',questionsPerPlayer:1});
  await call(parent,'secret',{round:0,number:1});await call(children[0],'ask',{round:0,text:'質問'});
  const answer=await call(parent,'answer',{round:0,text:'分かりません。',isLie:true});
  assert.equal(answer.chat.entries[0].answer,'わからない');assert.equal(answer.chat.entries[0].isUnknown,true);assert.equal(answer.chat.entries[0].isLie,false);
});

test('two players have no recipient and a miss causes no extra loss',()=>{
  const game={rulesVersion:2,settings:{stake:10},players:[{id:'p1'},{id:'p2'}]},round={index:0,parentId:'p1',answer:1,odds:[5,6,7,8,9,10,12,15,20],lieBonusTenths:5,unknownTransferVersion:1,chat:[{playerId:'p2',isUnknown:true}],bets:[{playerId:'p2',stake:100,numbers:[1]}]};
  const hit=calculateRound(game,round);assert.deepEqual(hit.unknownTransfers,[{playerId:'p2',amount:50,shares:[]}]);assert.equal(hit.outcomes[0].delta,400);assert.equal(hit.parentDelta,-450);
  const miss=calculateRound(game,{...round,answer:2});assert.equal(miss.unknownTransfers[0].amount,0);assert.equal(miss.outcomes[0].delta,-100);
});

test('distribution keeps remainders and respects the multiplier cap',()=>{
  const game={rulesVersion:2,settings:{stake:10},players:[{id:'p1'},{id:'p2'},{id:'p3'},{id:'p4'},{id:'p5'}]},round={index:0,parentId:'p1',answer:1,odds:[5,6,7,8,9,10,12,15,20],lieBonusTenths:5,unknownTransferVersion:1,chat:[{playerId:'p2',isUnknown:true}],bets:[{playerId:'p2',stake:11,numbers:[1]},{playerId:'p3',stake:3,numbers:[2]},{playerId:'p4',stake:3,numbers:[2]},{playerId:'p5',stake:3,numbers:[2]}]};
  const r=calculateRound(game,round),transfer=r.unknownTransfers[0];assert.equal(transfer.amount,5);assert.equal(transfer.shares.reduce((n,p)=>n+p.points,0),5);assert.deepEqual(transfer.shares.map(p=>p.points).sort(),[1,2,2]);assert.equal(r.outcomes.reduce((sum,o)=>sum+o.delta,0)+r.parentDelta,0);
  const afterCap=calculateRound(game,{...round,lieBonusTenths:50,chat:[...Array.from({length:10},()=>({isLie:true})),{playerId:'p2',isUnknown:true}]});assert.equal(afterCap.unknownTransfers[0].amount,0);
});

test('reentry keeps identity and active room listing hides empty or started rooms',async()=>{
  const {call,setCode}=setup(),settings={initialPoints:300,stake:10,turns:1};
  const created=await call('a','create',{name:'あき',phrase:pass,settings},201);setCode(created.code);
  assert.equal((await call('b','list')).rooms.length,0);
  await call('a','presence');assert.equal((await call('b','list')).rooms.length,1);
  await call('b','join',{name:'はる',phrase:pass});
  await call('c','join',{name:'あき',phrase:'異なる合言葉'},403);
  const rejoined=await call('c','join',{name:'あき',phrase:pass});assert.equal(rejoined.me,created.me);
  await call('a','state',{},403);
  assert.equal((await call('b','list')).rooms.length,0);
  await call('c','presence');assert.equal((await call('b','list')).rooms.length,1);
  await call('c','leave');assert.equal((await call('b','list')).rooms.length,0);
  await call('c','presence');await call('c','start');
  const listing=await call('b','list');assert.equal(listing.rooms.length,0);assert.ok(listing.activeCodes.includes(created.code));
});


test('split bets divide the bonus across picks and share the exact extra payout at every table size',()=>{
  const odds=[5,6,7,8,9,10,12,15,20];
  for(let size=2;size<=10;size++){
    const players=Array.from({length:size},(_,i)=>({id:'p'+(i+1)}));
    const game={rulesVersion:2,splitBetRules:true,players,settings:{stake:10}};
    for(let picks=1;picks<=9;picks++){
      const bets=players.slice(1).map((p,i)=>({playerId:p.id,stake:11+i,numbers:Array.from({length:picks},(_,n)=>n+1)}));
      const round={index:0,parentId:'p1',answer:1,odds,bets,chat:[{playerId:'p2',isUnknown:true}],unknownTransferVersion:1,lieBonusTenths:5};
      const result=calculateRound(game,round);
      const baseline=calculateRound(game,{...round,chat:[],lieBonusTenths:0});
      const [transfer]=result.unknownTransfers;
      assert.equal(transfer.amount,baseline.parentDelta-result.parentDelta);
      assert.equal(transfer.shares.reduce((sum,v)=>sum+v.points,0),size===2?0:transfer.amount);
      assert.equal(result.outcomes.reduce((sum,o)=>sum+o.delta,result.parentDelta),size===2 && transfer.amount ? -transfer.amount : 0);
      for(const outcome of result.outcomes){
        assert.equal(outcome.lieBonus,0.5/picks);
        assert.equal(outcome.received,Math.floor(outcome.stake*(10+size-1)/(2*picks*(size-1))));
      }
      const legacy=calculateRound({...game,splitBetRules:undefined},round);
      assert.equal(legacy.outcomes[0].lieBonus,0.5);
    }
  }
});

test('two players can finish a match, take one parent turn each and rejoin at the final ranking',async()=>{
  const {call,setCode}=setup();
  const created=await call('a','create',{name:names.a,phrase:pass,settings:{initialPoints:300,stake:10,turns:1,questionMode:'chat',questionsPerPlayer:1}},201);
  setCode(created.code);
  await call('b','join',{name:names.b,phrase:pass});
  let view=await call('a','start');
  const firstParent=view.parent;
  for(let round=0;round<2;round++){
    const parent=view.parent===created.me?'a':'b', child=parent==='a'?'b':'a';
    await call(parent,'secret',{round,number:1});
    await call(child,'ask',{round,text:'食べられる？'});
    await call(parent,'answer',{round,isUnknown:true});
    view=await call(child,'bet',{round,numbers:[1,2,3],stake:30});
    assert.equal(view.history.at(-1).unknownTransfers[0].amount,5);
    if(round===0){
      assert.equal(view.stage,'result');
      view=await call('a','next',{round});
      assert.notEqual(view.parent,firstParent);
    }
  }
  assert.equal(view.stage,'finished');
  assert.equal(view.standings.reduce((sum,p)=>sum+p.points,0),590);
  const rejoined=await call('c','join',{name:names.a,phrase:pass});
  assert.equal(rejoined.me,created.me);
  assert.deepEqual(rejoined.standings,view.standings);
});


test('new rooms accept only the ten available stakes; old games keep their own limits',async()=>{
  const {call}=setup();
  const settings={initialPoints:300,stake:75,turns:1};
  await call('a','create',{name:names.a,phrase:pass,settings},400);
  const created=await call('a','create',{name:names.a,phrase:pass,settings:{...settings,stake:100}},201);
  assert.equal(created.settings.stakeStep,10);
  for(let points=10;points<=100;points+=10) assert.equal(validateStake(points,10,100),points);
  for(const points of [0,1,9,75,101,110]) assert.throws(()=>validateStake(points,10,100));
  const oldLimit=stakeLimit({splitBetRules:true,settings:{stake:25}});
  assert.equal(oldLimit,75);
  assert.equal(validateStake(73,undefined,oldLimit),73);
  assert.throws(()=>validateStake(76,undefined,oldLimit));
});


test('children take repeated turns after the parent, across reentry and parent rotation',async()=>{
 const {call,started,parent,children,keys}=await createThree({initialPoints:300,stake:10,turns:1,questionMode:'chat',questionsPerPlayer:2});
 let state=await call(parent,'secret',{round:0,number:1});
 const [first,second]=state.chat.order;
 assert.deepEqual([first,second],started.standings.slice(1).map(p=>p.id));
 const rejoined=await call('d','join',{name:names[children[0]],phrase:pass});
 assert.equal(rejoined.chat.asker,first);
 for(let i=0;i<4;i++){
   const current=i%2===0?'d':children[1],other=i%2===0?children[1]:'d';
   assert.equal(state.chat.asker,i%2===0?first:second);
   await call(other,'ask',{round:0,entryCount:i,text:'先に質問'},409);
   const asking=await call(current,'ask',{round:0,entryCount:i,text:'質問'});
   assert.equal(asking.chat.asker,null);assert.equal(asking.chat.complete,false);
   await call(other,'ask',{round:0,text:'回答待ち'},409);
   await call(parent,'answer',{round:0,entryCount:i,text:'古い回答'},409);
   state=await call(parent,'answer',{round:0,entryCount:i+1,text:'はい'});
 }
 assert.equal(state.chat.complete,true);assert.equal(state.chat.asker,null);
 for(const child of ['d',children[1]])await call(child,'bet',{round:0,stake:10,numbers:[1]});
 const next=await call(parent,'next',{round:0});assert.equal(next.parent,first);
 const again=await call('d','secret',{round:1,number:1});
 assert.deepEqual(again.chat.order,[second,started.parent]);assert.equal(again.chat.asker,second);
});
