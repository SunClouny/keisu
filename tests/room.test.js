import test from 'node:test';
import assert from 'node:assert/strict';
import {handleAPI} from '../worker/api.js';
import {NOUNS} from '../worker/nouns.js';
test('private choices, simultaneous individual BETs, settlement and rotating parent',async()=>{
  const entries=new Map();
  const bucket={
    async get(path){const entry=entries.get(path);return entry&&{etag:entry.etag,json:async()=>JSON.parse(entry.body)};},
    async put(path,body,{onlyIf}){const old=entries.get(path);if(onlyIf.etagDoesNotMatch==='*'?old:old?.etag!==onlyIf.etagMatches)return null;
      const entry={etag:crypto.randomUUID(),body};entries.set(path,entry);return entry;}
  };
  let code='';
  async function call(id,action,fields={},status=200){
    const req=new Request('https://example.invalid/api/rooms',{method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer '+id.repeat(64)},body:JSON.stringify({action,code,...fields})});
    const res=await handleAPI(req,bucket),data=await res.json();assert.equal(res.status,status,JSON.stringify(data));return data;
  }
  assert.equal(new Set(NOUNS).size,1000);
  const pass='試験競数', settings={initialPoints:300,stake:10,turns:1};
  code=(await call('a','create',{name:'親役',phrase:pass,settings},201)).code;
  await call('b','join',{name:'子一',phrase:'異なる合言葉'},403);
  await Promise.all([call('b','join',{name:'子一',phrase:pass}),call('c','join',{name:'子二',phrase:pass})]);
  await call('b','start',{},403);
  const started=await call('a','start');
  assert.equal(new Set(started.names).size,9);
  await call('b','secret',{round:0,number:1},403);
  const betting=await call('a','secret',{round:0,number:1});
  assert.equal(betting.stage,'betting');assert.equal('secret' in betting,false);
  await call('b','bet',{round:0,stake:0,numbers:[1]},400);
  const base=betting.market[0].base;
  await Promise.all([call('b','bet',{round:0,stake:13,numbers:[1]}),call('c','bet',{round:0,stake:27,numbers:[1,3]})]);
  const ended=await call('b','state'),r=ended.history[0];
  assert.equal(ended.stage,'result');assert.equal(r.totalStakes,40);
  assert.equal(r.totalPayout,Math.floor(13*base/2)+Math.floor(27*base/4));
  assert.equal(ended.standings.reduce((n,p)=>n+p.points,0),900);
  assert.deepEqual(r.names,started.names);
  const next=await call('a','next',{round:0});assert.equal(next.parent,'p2');assert.equal(next.stage,'secret');
});
