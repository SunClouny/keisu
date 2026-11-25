import test from 'node:test';
import assert from 'node:assert/strict';
import {handleAPI} from '../worker/api.js';
import {NOUNS} from '../worker/nouns.js';

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
  const parent=keys[started.parent],children=['a','b','c'].filter(id=>id!==parent);
  return {...env,started,keys,parent,children};
}

test('random order preserves identities, private choices and correct settlement',async()=>{
  assert.equal(new Set(NOUNS).size,587);
  const {call,started,parent,children,keys}=await createThree({initialPoints:300,stake:10,turns:1});
  assert.equal(new Set(started.names).size,9);
  await call(children[0],'secret',{round:0,number:1},403);
  const betting=await call(parent,'secret',{round:0,number:1});
  assert.equal(betting.stage,'betting');assert.equal('secret' in betting,false);
  await call(children[0],'bet',{round:0,stake:0,numbers:[1]},400);
  const base=betting.market[0].base;
  await Promise.all([call(children[0],'bet',{round:0,stake:13,numbers:[1]}),call(children[1],'bet',{round:0,stake:27,numbers:[1,3]})]);
  const ended=await call(parent,'state'),round=ended.history[0];
  assert.equal(ended.stage,'result');assert.equal(round.parent,started.parent);assert.equal(round.totalStakes,40);
  assert.equal(round.totalPayout,Math.floor(13*base/2)+Math.floor(27*base/4));
  assert.equal(ended.standings.reduce((n,p)=>n+p.points,0),900);
  assert.deepEqual(round.names,started.names);
  const next=await call('a','next',{round:0});assert.equal(next.parent,started.standings[1].id);assert.equal(next.stage,'secret');
  assert.notEqual(keys[next.parent],parent);
});

test('chat questions, lie limits and answers are revealed after settlement',async()=>{
  const {call,parent,children}=await createThree({initialPoints:300,stake:10,turns:1,questionMode:'chat',questionsPerPlayer:2});
  await call(parent,'secret',{round:0,number:2});
  await call(children[0],'ask',{round:0,text:'ひとつめ？'});
  await call(children[1],'ask',{round:0,text:'まだ？'},409);
  await call(parent,'answer',{round:0,text:'はい',isLie:true});
  let childView=await call(children[0],'state');assert.equal('isLie' in childView.chat.entries[0],false);
  await call(children[1],'ask',{round:0,text:'ふたつめ？'});
  await call(parent,'answer',{round:0,text:'いいえ',isLie:true});
  await call(children[0],'ask',{round:0,text:'みっつめ？'});
  await call(parent,'answer',{round:0,text:'はい',isLie:true},409);
  await call(parent,'answer',{round:0,text:'はい',isLie:false});
  await call(children[1],'bet',{round:0,numbers:[2],stake:10},409);
  await call(children[1],'ask',{round:0,text:'よっつめ？'});
  await call(parent,'answer',{round:0,text:'いいえ',isLie:false});
  await call(children[0],'bet',{round:0,numbers:[2],stake:10});
  const result=await call(children[1],'bet',{round:0,numbers:[3],stake:10});
  assert.equal(result.stage,'result');assert.deepEqual(result.history[0].chat.map(q=>q.isLie),[true,true,false,false]);
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
