import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {webcrypto} from 'node:crypto';

function ui(){
  let chatList=null,html='';
  const screen={set innerHTML(value){html=value;const match=value.match(/<ol class="chat-list" aria-label="質問と回答">([\s\S]*?)<\/ol>/);
    chatList=match?{children:Array.from(match[1].matchAll(/class="chat-entry"/g)),scrollTop:0,get scrollHeight(){return this.children.length*120;}}:null;},
    get innerHTML(){return html;},setAttribute(){},removeAttribute(){},addEventListener(){}};
  const store=new Map(),storage={setItem:(k,v)=>store.set(k,String(v)),getItem:k=>store.get(k)||null,key:i=>[...store.keys()][i],get length(){return store.size;}};
  const timers=new Map();let timerId=0;
  const context=vm.createContext({
    document:{activeElement:null,hidden:false,querySelector(selector){return selector==='#screen'?screen:selector==='#error'?{textContent:''}:selector==='.chat > .chat-list'?chatList:null;},getElementById(){return null;},addEventListener(){}},
    window:{matchMedia:()=>({matches:false}),addEventListener(){}},localStorage:storage,sessionStorage:storage,crypto:webcrypto,
    location:{href:'https://test.invalid/',origin:'https://test.invalid',pathname:'/'},history:{replaceState(){}},URL,AbortSignal,
    fetch:async()=>({ok:true,text:async()=>'{"ok":true}'}),setTimeout(fn){const id=++timerId;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},setInterval(){},console,
  });
  const publicSource=new URL('../public/room.js',import.meta.url),rootSource=new URL('../room.js',import.meta.url);
  vm.runInContext(fs.readFileSync(fs.existsSync(publicSource)?publicSource:rootSource,'utf8'),context);
  return {draw(data){context.input=data;vm.runInContext('draw(input)',context);},run(code){return vm.runInContext(code,context);},get chat(){return chatList;},get html(){return html;}};
}
const members=[{id:'p1',name:'あき'},{id:'p2',name:'はる'}];
function betting(entries){return {code:'ABCDEFGH2345',me:'p1',host:'p1',members,settings:{stake:10,questionMode:'chat',questionsPerPlayer:5},stage:'betting',round:0,total:2,parent:'p1',revision:entries.length+1,expires:Date.now()+100000,chat:{entries,complete:false,lieLimit:2,liesUsed:0},market:Array.from({length:9},(_,i)=>({number:i+1,base:5,adjusted:5})),names:Array(9).fill('ねこ'),history:[],standings:[],confirmed:[]};}
const question=n=>({playerId:'p2',question:`質問${n}`,answer:n<4?'はい':null});

test('new questions scroll to the bottom; ordinary redraws preserve the reading position',()=>{
 const page=ui(),entries=[question(1),question(2),question(3)];
 page.draw(betting(entries));assert.equal(page.chat.scrollTop,page.chat.scrollHeight);
 page.chat.scrollTop=65;
 page.draw({...betting(entries),revision:5});assert.equal(page.chat.scrollTop,65);
 page.draw({...betting([...entries,question(4)]),revision:6});assert.equal(page.chat.scrollTop,page.chat.scrollHeight);
});

test('ranking appears after the result and before the final screen, with the parent name',()=>{
 const page=ui(),base=betting([]);
 const result={...base,stage:'finished',revision:10,standings:[{rank:1,name:'あき',points:310},{rank:2,name:'はる',points:290}],history:[{number:1,parent:'p1',answer:1,names:Array(9).fill('ねこ'),outcomes:[{playerId:'p2',numbers:[1],stake:10,received:0}],parentDelta:10}]};
 page.draw(result);assert.match(page.html,/結果発表/);assert.doesNotMatch(page.html,/対戦終了<\/h1>/);
 page.run('showStandings()');assert.match(page.html,/最終順位発表/);assert.doesNotMatch(page.html,/<h1>対戦終了<\/h1>/);
 page.run('finishReveal()');assert.match(page.html,/<h1>対戦終了<\/h1>/);assert.match(page.html,/親：あきの収支/);
});

test('each player sees their hit or miss and actual net change; parents see their own balance',()=>{
 const base=betting([]),round={number:1,parent:'p1',answer:1,names:Array(9).fill('ねこ'),outcomes:[{playerId:'p2',numbers:[1,2],hit:true,stake:10,received:7,delta:-3}],parentDelta:3};
 const result={...base,stage:'result',revision:10,standings:[{rank:1,name:'あき',points:303},{rank:2,name:'はる',points:297}],history:[round]};
 const child=ui();child.draw({...result,me:'p2'});child.run('finishReveal()');
 assert.match(child.html,/的中！/);assert.match(child.html,/あなたの予想：1・2/);assert.match(child.html,/収支 <strong class="my-result-points">-3点/);
 const miss=ui();miss.draw({...result,me:'p2',history:[{...round,outcomes:[{...round.outcomes[0],numbers:[2],hit:false,received:0,delta:-10}]}]});miss.run('finishReveal()');
 assert.match(miss.html,/<strong class="my-result-status">はずれ/);assert.match(miss.html,/>-10点<\/strong>/);
 const parent=ui();parent.draw(result);parent.run('finishReveal()');
 assert.match(parent.html,/<h2>あなたは親<\/h2>/);assert.match(parent.html,/>\+3点<\/strong>/);
});


test('round results show base odds, lie bonus and final odds',()=>{
 const page=ui(),base=betting([]),round={number:1,parent:'p1',answer:1,names:Array(9).fill('ねこ'),chat:[{playerId:'p2',question:'質問',answer:'はい',isLie:true}],lieCount:1,lieBonusTenths:5,outcomes:[{playerId:'p2',numbers:[1],hit:true,stake:100,received:550,delta:450,baseOdds:5,lieBonus:0.5,effectiveOdds:5.5}],parentDelta:-450};
 page.draw({...base,me:'p2',stage:'result',revision:10,standings:[{rank:1,name:'はる',points:710},{rank:2,name:'あき',points:-110}],history:[round]});page.run('finishReveal()');
 assert.match(page.html,/倍率：5.5倍（5 ＋ 上乗せ 0.5）/);
 assert.match(page.html,/親の嘘：1回/);assert.match(page.html,/1点予想の上乗せ：0.5倍/);
});


test('parent can choose unknown and the settlement shows distributions',()=>{
 const page=ui(),base=betting([{playerId:'p2',question:'質問',answer:null}]);
 page.draw(base);assert.match(page.html,/data-act="unknown-answer">わからない/);
 const result={...base,stage:'result',revision:10,standings:[{rank:1,name:'あき',points:300},{rank:1,name:'はる',points:300}],history:[{number:1,parent:'p1',answer:1,names:Array(9).fill('ねこ'),chat:[{playerId:'p2',question:'質問',answer:'わからない',isUnknown:true,isLie:false}],lieCount:0,lieBonusTenths:5,unknownTransfers:[{playerId:'p2',amount:5,shares:[]}],outcomes:[{playerId:'p2',numbers:[1],hit:true,stake:10,received:55,delta:40,baseOdds:5,lieBonus:0.5,effectiveOdds:5.5}],parentDelta:-45}]};
 page.draw(result);page.run('finishReveal()');assert.match(page.html,/「わからない」の精算/);assert.match(page.html,/はるの負担　-5点/);assert.match(page.html,/分配先なし/);
});
