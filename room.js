'use strict';
const SERVER='https://keisu-rooms-yusuke.yutan226.chatgpt.site';
const API=(location.origin===SERVER?location.origin:SERVER)+'/api/rooms';
const screen=document.querySelector('#screen'), errorBox=document.querySelector('#error');
const escapeHtml = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const format = x => Number(x).toLocaleString('ja-JP',{maximumFractionDigits:2});
const formatOdds = x => Number(x).toLocaleString('ja-JP',{maximumFractionDigits:3});
const invite = new URL(location.href).searchParams.get('room')?.toUpperCase();
let mode=invite?'join':'create',room=null,token='',chosen=[],stake=10,busy=false,polling=false;
let savedName='', viewKey='', savedDetails=new Set(),roomCode=invite||'';
let questionDraft='', answerDraft='', lieDraft=false;
let storageWarning=false, lastPresence=0, presencePending=false, listRequest=0;
let revealingKey=null, revealPhase=null, revealTimer=null;
const revealedRounds=new Set();
const storageKey=code=>'keisu.participant.'+code;
const recentKey='keisu.recentRooms.v1';
function newToken(){return [...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('');}
function storeValue(key,value){try{localStorage.setItem(key,value);return true;}catch{return false;}}
function getValue(key){try{return localStorage.getItem(key)||'';}catch{return '';}}
function recentRooms(){
 try{const items=JSON.parse(getValue(recentKey)||'[]');if(!Array.isArray(items))return [];
  const rooms=items.filter(x=>x && /^[A-Z2-9]{12}$/.test(x.code) && typeof x.name==='string' && x.name.length<=20 && Number.isFinite(x.expires) && x.expires>Date.now() && /^[0-9a-f]{64}$/.test(getValue(storageKey(x.code))));
  const known=new Set(items.filter(x=>x && /^[A-Z2-9]{12}$/.test(x.code) && Number.isFinite(x.expires) && x.expires<=Date.now()).map(x=>x.code));
  for(const room of rooms)known.add(room.code);
  for(let i=0;i<localStorage.length && rooms.length<8;i++){
   const key=localStorage.key(i), match=key?.match(/^keisu\.participant\.([A-Z2-9]{12})$/);
   if(match && !known.has(match[1]) && /^[0-9a-f]{64}$/.test(getValue(key))){rooms.push({code:match[1],name:'参加済み',expires:null});known.add(match[1]);}
  }
  return rooms.slice(0,8);
 }catch{return [];}
}
function rememberRoom(data){
 if(!/^[0-9a-f]{64}$/.test(token))return;
 const name=data.members.find(m=>m.id===data.me)?.name;
 if(!name)return;
 const saved=storeValue(storageKey(data.code),token);
 const rooms=[{code:data.code,name,expires:data.expires},...recentRooms().filter(x=>x.code!==data.code)].slice(0,8);
 const listed=storeValue(recentKey,JSON.stringify(rooms));
 storageWarning=!saved||!listed;
}
async function restoreRoom(code,credential){
 let data;
 try{data=await api('state',{},code,credential);}
 catch(error){if(error.status===403)throw Error('別の端末で再入室された可能性があります。表示名と部屋の合言葉で再入室してください。');throw error;}
 token=credential;roomCode=data.code;draw(data);
}
let practice=null;
const practiceItems=[
 {name:'りんご',food:true,alive:false},{name:'ねこ',food:false,alive:true},{name:'えんぴつ',food:false,alive:false},
 {name:'すいか',food:true,alive:false},{name:'いぬ',food:false,alive:true},{name:'ほん',food:false,alive:false},
 {name:'パン',food:true,alive:false},{name:'さかな',food:true,alive:true},{name:'かさ',food:false,alive:false}
];
const practiceQuestions=['5以上ですか？','奇数ですか？','食べ物ですか？','生き物ですか？'];
function practiceScreen(){
 const p=practice, hit=p.picks.includes(p.secret);
 const base=[5,6,7,8,9,10,12,15,20][p.secret-1];
 const bonus=p.picks.length===1?({5:7,6:5,7:3,8:1}[base]??0):0;
 const odds=(base+bonus)/(p.picks.length||1);
 const received=hit?Math.floor(p.stake*odds):0;
 const cards=practiceItems.map((item,i)=>`<button type="button" class="horse" data-act="practice-pick" data-number="${i+1}" aria-pressed="${p.picks.includes(i+1)}" ${p.questions.length<3||p.finished?'disabled':''}><b>${i+1}</b><span>${item.name}</span><small>基本 ${[5,6,7,8,9,10,12,15,20][i]}倍</small></button>`).join('');
 const history=p.questions.map(q=>`<li>${q.text}　CPU：${q.answer?'はい':'いいえ'}</li>`).join('');
 screen.innerHTML=`<h1>1人で練習</h1><p>CPUが親です。質問を3回選び、数字を1つ以上予想します。</p><div class="box"><h2>数字とお題</h2><div class="grid">${cards}</div></div>
 <div class="box"><h2>質問（${p.questions.length}/3回）</h2><ul>${history}</ul>${p.questions.length<3?practiceQuestions.map((q,i)=>`<button type="button" data-act="practice-question" data-example="${i}">${q}</button>`).join(''):''}</div>
 ${p.finished?`<div class="box"><h2>${hit?'的中！':'はずれ'}</h2><p>正解は ${p.secret}　${practiceItems[p.secret-1].name}</p><p>予想 ${p.picks.join('・')} ／ 賭け点 ${p.stake}点</p>${hit?`<p>倍率 ${formatOdds(odds)}倍${bonus?`（単独ボーナス ＋${bonus}倍）`:''}</p>`:''}<p>受取 ${received}点 ／ 収支 ${signedPoints(received-p.stake)}</p></div><button data-act="practice-start">もう一度</button>`:p.questions.length===3?`<div class="box">賭け点　<button data-act="practice-bet" data-delta="-10" ${p.stake<=10?'disabled':''}>−10</button>　<strong>${p.stake}点</strong>　<button data-act="practice-bet" data-delta="10" ${p.stake>=100?'disabled':''}>＋10</button></div><button class="primary" data-act="practice-finish" ${p.picks.length?'':'disabled'}>予想を確定</button>`:''}
 <button data-act="practice-home">開始画面へ</button>`;
}
function say(text){errorBox.textContent=text;}
function memberName(id){return room?.members.find(m=>m.id===id)?.name??'';}
function stakeOptions(selected,limit=100) {
 return Array.from({length:limit/10}, (_,index)=>{
  const points=(index+1)*10;
  return `<option value="${points}" ${points===Number(selected)?'selected':''}>${points}点</option>`;
 }).join('');
}
function stakeStepper(id, label, value, locked=false, limit=100) {
 const points=Number(value);
 return `<div class="stake-control"><label for="${id}">${label}</label><div class="stake-stepper" data-limit="${limit}">
  <button type="button" data-act="stake-down" aria-label="賭け点を10点減らす" ${locked||points<=10?'disabled':''}>−10</button>
  <select id="${id}" name="stake" ${locked?'disabled':''}>${stakeOptions(points,limit)}</select>
  <button type="button" data-act="stake-up" aria-label="賭け点を10点増やす" ${locked||points>=limit?'disabled':''}>＋10</button>
 </div></div>`;
}
function updateStakeControl(select) {
 const value=Number(select.value);
 const controls=select.closest('.stake-stepper');
 controls.querySelector('[data-act="stake-down"]').disabled=select.disabled||value<=10;
 controls.querySelector('[data-act="stake-up"]').disabled=select.disabled||value>=Number(controls.dataset.limit);
 if(select.id==='room-bet'){stake=value;const preview=document.querySelector('.bet-preview');if(preview)preview.outerHTML=wagerPreview();}
}
function wagerPreview(){
 const numbers=room.myBet?.locked?room.myBet.numbers:chosen;
 if(!numbers.length)return '<p class="hint">数字を選ぶと倍率と受取の目安が出ます。</p>';
 const bet=Number(room.myBet?.locked?room.myBet.stake:stake);
 return `<div class="bet-preview"><strong>的中した場合の目安</strong><p class="hint">嘘・わからないの上乗せを除きます。予想人数は確定後に分かります。</p><ul>${numbers.map(n=>{
  const base=room.market[n-1].base,bonus=room.settings.soloBonus&&(room.settings.soloBonus===true||numbers.length===1)?({5:7,6:5,7:3,8:1}[base]??0):0;
  const alone=(base+bonus)/numbers.length,shared=base/(room.popularityOdds===false?1:2)/numbers.length;
  return `<li>${n}：1人なら約${formatOdds(alone)}倍・${format(Math.floor(bet*alone))}点${room.members.length>2?` ／ 2人なら約${formatOdds(shared)}倍・${format(Math.floor(bet*shared))}点`:''}</li>`;
 }).join('')}</ul></div>`;
}
function betField() {
 const locked=room.myBet?.locked, value=locked?room.myBet.stake:stake;
 const disabled=locked?'disabled':'';
 if(room.settings.stakeStep===10){
  return stakeStepper('room-bet','賭け点',value,locked,room.maxStake??100);
 }
 const limit=room.maxStake??1000;
 return `<label>賭け点（1〜${format(limit)}点）<input id="room-bet" type="number" inputmode="numeric" min="1" max="${limit}" value="${escapeHtml(value)}" ${disabled}></label>`;
}
function lobbyForm(){
 const joining=mode==='join';
 screen.innerHTML=`<section class="lobby-hero"><div><h1>数読みダービー</h1><p>お題について親に質問して、親が選んだ数字を当てよう。<br>2〜10人用</p></div><div class="hero-cards" aria-hidden="true"><span>?</span><span>9</span><span>1</span></div></section>
 <nav class="tabs"><button data-act="create-mode" aria-pressed="${mode==='create'}">部屋を作る</button><button data-act="join-mode" aria-pressed="${mode==='join'}">部屋に入る</button></nav>
 ${joining?`<section class="box"><div class="room-list-heading"><h2>参加できる部屋</h2><button type="button" data-act="refresh-rooms">更新</button></div><div id="available-rooms" aria-live="polite"><p class="hint">部屋を探しています…</p></div></section>`:''}
 ${joining?'<div id="recent-rooms"></div>':''}
 <form class="box form" id="entry"><label>あなたの表示名<input required maxlength="20" name="name" value="${escapeHtml(savedName)}" autocomplete="off"></label>
 ${joining?`<label>部屋ID<input name="code" minlength="12" maxlength="16" required value="${escapeHtml(roomCode)}" autocapitalize="characters" spellcheck="false" placeholder="招待リンクから自動入力"></label>`:''}
 <label>合言葉<input name="phrase" type="password" minlength="4" maxlength="64" required autocomplete="off" placeholder="${joining?'作成者が決めた合言葉':'4〜64文字で設定'}"></label>
 ${joining?'<p class="hint">再入室には前と同じ表示名と合言葉を使います。</p>':''}
 ${joining?'':`<div class="columns"><label>初期ポイント<input type="number" name="points" min="1" max="100000" value="300" required></label>${stakeStepper('default-bet','標準の賭け点',10)}<label>親の回数（1人あたり）<input type="number" name="turns" min="1" max="20" value="2" required></label></div>
 <label class="lie-check"><input type="checkbox" name="finalBetBoost">最終ラウンドの上限を150点にする</label><small>最後の親以外が対象になります。</small>
 <fieldset class="mode-choice"><legend>質問の進め方</legend><div class="mode-options"><label><input type="radio" name="questionMode" value="chat" checked><span>💬 チャットで質問</span></label><label><input type="radio" name="questionMode" value="timer"><span>⏱ 制限時間（1分）</span></label></div></fieldset>
 <label class="lie-check" id="auto-question-label"><input type="checkbox" name="autoQuestions">人数に合わせて質問回数を決める</label><small>2〜4人は3回、5〜6人は2回、7〜10人は1回。開始時の人数で決まります。</small>
 <label id="question-count-label">質問回数（子1人あたり）<input type="number" name="questionsPerPlayer" id="question-count" min="1" max="20" value="3" required></label>`}
 <button class="primary">${joining?'参加する':'部屋を作る'}</button></form>
 <p class="hint">部屋の有効期限は作成から24時間です。</p><button type="button" data-act="practice-start">1人で練習する</button>`;
 if(joining)loadRooms();
}
async function api(action,fields={},code=roomCode,credential=token){
 const response=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+credential},body:JSON.stringify({action,code,...fields}),cache:'no-store',signal:AbortSignal.timeout(15000)});
 const text=await response.text();let data;try{data=JSON.parse(text);}catch{throw Error('部屋サーバーに接続できません。少し待って再試行してください。');}
 if(!response.ok){const err=Error(data.error||'通信に失敗しました。');err.status=response.status;throw err;}
 return data;
}
async function loadRooms(){
 const container=document.querySelector('#available-rooms');if(!container)return;
 const request=++listRequest;
 try{
  const data=await api('list',{},'',newToken());
  if(request!==listRequest||!container.isConnected)return;
  const recentContainer=document.querySelector('#recent-rooms'),active=new Set(data.activeCodes||[]),recent=recentRooms().filter(x=>active.has(x.code));
  if(recentContainer)recentContainer.innerHTML=recent.length?`<section class="box"><h2>参加した部屋に戻る</h2><div class="recent-rooms">${recent.map(x=>`<button type="button" data-act="resume" data-code="${x.code}"><b>${escapeHtml(x.name)}</b><small>部屋 ${x.code}</small><span>戻る</span></button>`).join('')}</div></section>`:'';
  container.innerHTML=data.rooms.length?`<div class="recent-rooms">${data.rooms.map(x=>`<button type="button" data-act="select-room" data-code="${escapeHtml(x.code)}"><b>${escapeHtml(x.host)}さんの部屋</b><small>部屋 ${escapeHtml(x.code)} ・ ${Number(x.players)} / 10人</small><span>選ぶ</span></button>`).join('')}</div>`:'<p class="hint">参加できる部屋はありません。</p>';
 }catch(error){if(request===listRequest&&container.isConnected)container.innerHTML='<p class="hint">部屋を読み込めませんでした。更新してください。</p>';}
}
function heartbeat(force=false){
 if(!room||!token||presencePending||(!force&&Date.now()-lastPresence<20000))return;
 presencePending=true;lastPresence=Date.now();
 api('presence').catch(()=>{lastPresence=0;}).finally(()=>{presencePending=false;});
}
function leavePresence(){
 if(!room||!token)return;
 fetch(API,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({action:'leave',code:room.code}),keepalive:true}).catch(()=>{});
 lastPresence=0;
}
function finishReveal(){
 clearTimeout(revealTimer);
 if(revealingKey){revealedRounds.add(revealingKey);try{sessionStorage.setItem('keisu.reveal.v2.'+revealingKey,'1');}catch{}}
 revealingKey=null;revealPhase=null;renderRoom();
}
function showStandings(){
 if(!revealingKey||!room)return;
 clearTimeout(revealTimer);revealPhase='standings';renderRoom();
 const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
 const key=revealingKey,duration=reduced?1000:Math.min(10000,1800+room.standings.length*650);
 revealTimer=setTimeout(()=>{if(revealingKey===key&&revealPhase==='standings')finishReveal();},duration);
}
function draw(data,followChat=false){
 if(room && data.code===room.code && data.revision<room.revision)return;
 const resultKey=data.code+':'+data.round;
 const isResult=data.stage==='result'||data.stage==='finished';
 if(revealingKey && (revealingKey!==resultKey || !isResult)){clearTimeout(revealTimer);revealingKey=null;revealPhase=null;}
 let beginReveal=false;
 if(isResult && !revealedRounds.has(resultKey) && revealingKey!==resultKey){
  let seen=false;try{seen=sessionStorage.getItem('keisu.reveal.v2.'+resultKey)==='1';}catch{}
  if(seen)revealedRounds.add(resultKey);
  else {revealingKey=resultKey;revealPhase='number';beginReveal=true;}
 }
 const nextKey=data.code+'/'+data.round+'/'+data.stage;
 if(viewKey!==nextKey){followChat=true;chosen=[];stake=data.settings.stake;savedDetails.clear();questionDraft='';answerDraft='';lieDraft=false;viewKey=nextKey;}
 room=data;roomCode=data.code;rememberRoom(data);heartbeat();
 if(beginReveal){const duration=window.matchMedia('(prefers-reduced-motion: reduce)').matches?200:3800;
  revealTimer=setTimeout(()=>{if(revealingKey===resultKey&&revealPhase==='number')showStandings();},duration);
 }
 try{const url=new URL(location.href);url.searchParams.set('room',roomCode);history.replaceState(null,'',url);}catch{}
 renderRoom(followChat);
}
function horses(interactive){
 const locked=room.myBet?.locked;
 return '<div class="grid">'+room.market.map((m,i)=>{
  const picked=locked?room.myBet.numbers.includes(m.number):chosen.includes(m.number);
  return `<button class="horse" data-act="pick" data-number="${m.number}" aria-pressed="${picked}" ${interactive&&!locked?'':'disabled'}><b>${m.number}</b><span>${escapeHtml(room.names?.[i])}</span><small>基本 ${format(m.base)}倍</small></button>`;
 }).join('')+'</div>';
}
function questionOptions(){
 return `<section class="box question-options"><h2>数字とお題</h2><div class="grid" role="list">${room.market.map((m,i)=>`<div class="question-option" role="listitem"><b>${m.number}</b><span>${escapeHtml(room.names?.[i])}</span><small>${format(m.adjusted)}倍</small></div>`).join('')}</div></section>`;
}
function panel(id,title,html){return `<details data-panel="${id}" ${savedDetails.has(id)?'open':''}><summary>${title}</summary>${html}</details>`;}
function oddsRules(){
 const popularity=room.popularityOdds!==false;
 const chat=room.settings.questionMode==='chat';
 const solo=room.settings.soloBonus;
 const items=[
  '基本オッズは5・6・7・8・9・10・12・15・20倍です。毎ラウンド数字に割り当てられます。',
  ...(popularity?['同じ正解を予想した人数で、基本オッズを割ります。']:[]),
  ...(solo?[`正解を予想した人が1人だけのとき、基本5・6・7・8倍は12・11・10・9倍に上がります。${solo===2?'数字を1つだけ選んだ場合に適用されます。':''}`]:[]),
  ...(chat?['親の嘘と「わからない」は1回につき0.5倍を上乗せします。上乗せは合計5倍までです。']:[]),
  room.splitBetRules||!chat?'複数の数字を選ぶと、倍率を選んだ数で割ります。':'基本オッズは選んだ数字の数で割ります。嘘・わからないの上乗せは選んだ数では割りません。',
  '賭け点に最終的な倍率を掛けて受取点を計算し、1点未満は切り捨てます。倍率は全員の予想確定後に発表します。'
 ];
 return panel('odds-rules','オッズの変動ルール',`<ul class="odds-rules">${items.map(item=>`<li>${item}</li>`).join('')}</ul>`);
}
function ranking(){return '<ol class="list">'+room.standings.map(p=>`<li><b>${p.rank}位　${escapeHtml(p.name)}</b><span>${format(p.points)}点</span></li>`).join('')+'</ol>';}
function signedPoints(points){return (points>0?'+':'')+format(points)+'点';}
function oddsText(outcome){
 if(!Number.isFinite(outcome.effectiveOdds))return '';
 const base=Number.isFinite(outcome.baseOdds)?outcome.baseOdds:outcome.effectiveOdds;
 const bonus=Number.isFinite(outcome.lieBonus)?outcome.lieBonus:0;
 const solo=Number.isFinite(outcome.soloBonus)?outcome.soloBonus:0;
 if(solo)return `倍率：${formatOdds(outcome.effectiveOdds)}倍（基本 ${formatOdds(base)} ＋ 単独的中 ${formatOdds(solo)}${bonus?' ＋ 嘘・わからない '+formatOdds(bonus):''}）`;
 return bonus?`倍率：${formatOdds(outcome.effectiveOdds)}倍（${formatOdds(base)} ＋ 上乗せ ${formatOdds(bonus)}）`:`倍率：${formatOdds(outcome.effectiveOdds)}倍`;
}
function roundHighlights(r){
 const winners=r.outcomes.filter(o=>o.hit),items=[];
 if(winners.length===1)items.push('単独的中！ '+escapeHtml(memberName(winners[0].playerId)));
 if(winners.some(o=>o.hit&&o.soloBonus>0))items.push('単独ボーナス獲得！');
 if(winners.length>1&&winners.length===r.outcomes.length)items.push('全員的中！');
 if(!winners.length)items.push('親の勝利！');
 const timed=(r.chat??[]).filter(q=>Number.isFinite(q.answerMs));
 if(timed.length){const slow=timed.reduce((a,b)=>a.answerMs>=b.answerMs?a:b);items.push('一番悩んだ質問：'+escapeHtml(slow.question)+'（'+format(slow.answerMs/1000)+'秒）');}
 return items.length?`<div class="box"><h2>このラウンドの見どころ</h2><ul>${items.map(x=>`<li>${x}</li>`).join('')}</ul></div>`:'';
}
function myRoundResult(r){
 if(r.parent===room.me)return `<section class="box my-result my-result-parent"><h2>あなたは親</h2><p>このラウンドの収支</p><strong class="my-result-points">${signedPoints(r.parentDelta)}</strong></section>`;
 const outcome=r.outcomes.find(o=>o.playerId===room.me);
 if(!outcome)return '';
 return `<section class="box my-result ${outcome.hit?'my-result-hit':'my-result-miss'}"><h2>あなたの結果</h2><strong class="my-result-status">${outcome.hit?'🎯 的中！':'はずれ'}</strong><p>あなたの予想：${outcome.numbers.join('・')}　／　正解：${r.answer}</p>${outcome.hit?'<p>'+oddsText(outcome)+'</p>':''}<p>賭け点 ${format(outcome.stake)}点　／　受取 ${format(outcome.received)}点</p><p>このラウンドの収支 <strong class="my-result-points">${signedPoints(outcome.delta)}</strong></p></section>`;
}
function historyRows(r,includeAnswer=true){
 const list=r.outcomes.map(o=>`<li><b>${escapeHtml(memberName(o.playerId))}${o.playerId===room.me?'（あなた）':''} <span class="result-badge ${o.hit?'result-badge-hit':'result-badge-miss'}">${o.hit?'的中':'はずれ'}</span></b><span>${o.numbers.join('・')} ／ ${o.hit?oddsText(o)+' ／ ':''}賭け点 ${format(o.stake)} ／ 受取 ${format(o.received)}点 ／ 収支 ${signedPoints(o.delta)}</span></li>`).join('');
 const chat=r.chat?.length?`<div class="round-chat"><h3>質問と親の回答</h3><ol class="chat-list">${chatRecords(r.chat,true)}</ol></div>`:'';
 const transfers=r.unknownTransfers?.length?`<div class="round-chat"><h3>「わからない」の精算</h3><ul class="list">${r.unknownTransfers.map(t=>`<li><b>${escapeHtml(memberName(t.playerId))}の負担　${signedPoints(-t.amount)}</b><span>${t.shares.length?t.shares.map(share=>`${escapeHtml(memberName(share.playerId))}に${format(share.points)}点`).join('、'):'分配先なし'}${t.amount===0?'（配当の増加なし）':''}</span></li>`).join('')}</ul><p class="hint">質問した子の負担は、親の追加支払いと同額です。</p></div>`:'';
 return `${includeAnswer?`<p>親　${escapeHtml(memberName(r.parent))} ／ 正解 ${r.answer}　${escapeHtml(r.names[r.answer-1])}</p>`: ''}${r.chat?`<p>親の嘘：${r.lieCount??r.chat.filter(q=>q.isLie===true).length}回 ／ わからない：${r.chat.filter(q=>q.isUnknown===true).length}回 ／ ${r.lieBonusTenths===undefined?'嘘の上乗せなし（以前のルール）':`1点予想の上乗せ：${formatOdds(r.lieBonusTenths/10)}倍`}</p>`:''}<ul class="list">${list}</ul><p>親：${escapeHtml(memberName(r.parent))}の収支　${r.parentDelta>0?'+':''}${r.parentDelta}点</p>${transfers}${chat}`;
}
function chatRecords(entries,revealed=false){
 return entries.map((q,index)=>{
  const badge=q.isLie===true?' <span class="lie-badge">嘘</span>':revealed&&q.isLie===null?' <small>嘘の記録なし</small>':'';
  const answer=q.answer===null?'<small class="chat-pending">回答待ち</small>':
   `<div class="chat-answer"><strong>親の回答</strong>${badge}<p>${escapeHtml(q.answer)}</p></div>`;
  return `<li class="chat-entry"><div class="chat-question"><strong>質問 ${index+1} · ${escapeHtml(memberName(q.playerId))}</strong><p>${escapeHtml(q.question)}</p></div>${answer}</li>`;
 }).join('');
}
function chatPanel(parent){
 const chat=room.chat, entries=chat?.entries??[], pending=entries.find(q=>q.answer===null);
 const used=entries.filter(q=>q.playerId===room.me).length, limit=room.settings.questionsPerPlayer;
 const myTurn=chat.asker===room.me;
 const messages=chatRecords(entries);
 let form='';
 if(!chat.complete && parent && pending) form=`<form id="answer-form" class="form"><label>回答<input id="answer-text" name="text" maxlength="160" required value="${escapeHtml(answerDraft)}"></label><label class="lie-check"><input id="answer-lie" type="checkbox" name="isLie" ${lieDraft?'checked':''}>この回答は嘘</label><button class="primary">回答を送る</button><button type="button" data-act="unknown-answer">わからない</button></form>`;
 else if(!chat.complete && !parent && myTurn && !pending) form=`<form id="question-form" class="form"><label>質問<input id="question-text" name="text" maxlength="160" required value="${escapeHtml(questionDraft)}"></label><div class="question-examples" aria-label="質問例">${['5以上ですか？','奇数ですか？','食べ物ですか？','生き物ですか？','家の中にありますか？'].map((q,i)=>`<button type="button" data-act="question-example" data-example="${i}">${q}</button>`).join('')}</div><button class="primary">質問を送る</button></form>`;
 let status;
 if(chat.complete)status=parent||room.myBet?.locked?'質問終了。全員の予想を待っています。':'質問終了。予想を確定してください。';
 else if(pending)status=parent?`${escapeHtml(memberName(pending.playerId))}さんの質問に答えてください。`:'親の回答を待っています。';
 else if(myTurn)status=`あなたの質問の番です。残り${limit-used}回。`;
 else status=`${escapeHtml(memberName(chat.asker))}さんの質問の番です。`;
 const progress=chat.order.map((id,i)=>`<li>${i+1}番　${escapeHtml(memberName(id))}　${entries.filter(q=>q.playerId===id).length}/${limit}回</li>`).join('');
 return `<section class="box chat"><div class="chat-heading"><h2>質問チャット</h2><span>${entries.filter(q=>q.answer!==null).length} / ${limit*(room.members.length-1)}問 回答済み</span></div>
 <p class="chat-status" role="status">${status}</p>
 <ol id="live-chat" class="chat-list" tabindex="0" aria-label="質問と回答">${messages}</ol>
 <button type="button" class="chat-latest" data-act="chat-latest" hidden>最新の質問・回答へ</button>
 ${form}${oddsRules()}${panel('chat-progress','質問の順番と回数',`<ol class="list">${progress}</ol>`)}${panel('chat-rules','嘘と「わからない」のルール',`<p>嘘は何回でも使えます。嘘や「わからない」1回につき、的中時の倍率に0.5倍を足します（合計＋5倍まで）。${room.splitBetRules?'数字をいくつか選ぶと、上乗せ分もその個数で割ります。':''}嘘は結果発表で公開します。</p><p>「わからない」も質問1回分です。質問した子の負担は、親が余分に払った点数と同じです。${room.members.length===2?'2人対戦では質問した子からその点数を引きます。':'その点数をほかの子で分けます。'}的中者がいなければ負担はありません。</p>`)}</section>`;

}
function nearChatEnd(list){
 return list.scrollHeight-list.clientHeight-list.scrollTop<=16;
}
function renderRoom(followChat=false){
 const active=document.activeElement,id=active?.id,pos=active?.selectionStart;
 const oldChat=document.querySelector('#live-chat'),oldChatTop=oldChat?.scrollTop??0;
 const followLatest=followChat||!oldChat||nearChatEnd(oldChat);
 const isHost=room.me===room.host,parent=room.me===room.parent;
 const myName=escapeHtml(memberName(room.me)),parentName=escapeHtml(memberName(room.parent));
 if(revealingKey===room.code+':'+room.round && (room.stage==='result'||room.stage==='finished')){
  if(revealPhase==='standings'){
   const rows=room.standings.map((p,i)=>`<li style="--delay:${(room.standings.length-1-i)*0.65}s"><b>${p.rank}位　${escapeHtml(p.name)}</b><span>${format(p.points)}点</span></li>`).join('');
   screen.innerHTML=`<section class="ranking-reveal" aria-live="polite"><h1>${room.stage==='finished'?'最終順位発表！':'順位発表！'}</h1><ol class="ranking-reveal-list">${rows}</ol><button data-act="ranking-skip">${room.stage==='finished'?'対戦終了画面へ':'ラウンド結果へ'}</button></section>`;
  }else{
   const result=room.history.at(-1);
   screen.innerHTML=`<section class="reveal-stage" aria-live="polite"><h1>結果発表！</h1><div class="reveal-card"><span class="reveal-question" aria-hidden="true">?</span><strong class="reveal-number">${result.answer}</strong></div><p class="reveal-name">${escapeHtml(result.names?.[result.answer-1]??'')}</p><button data-act="reveal-skip">順位を見る</button></section>`;
  }
  return;
 }
 let html=`<div class="row"><strong class="name">${myName}さん</strong><span class="chip">${room.members.length}人</span></div>`;
 if(storageWarning)html+='<p class="storage-warning" role="status">このブラウザに参加情報を保存できません。戻るときは表示名と部屋の合言葉を入力してください。</p>';
 if(room.stage==='lobby'){
  const players=room.members.map((m,i)=>`<li><span>${i+1}　${escapeHtml(m.name)}</span>${m.id===room.host?'<small>部屋の作成者</small>':''}</li>`).join('');
  html+=`<h1>待機室</h1><div class="box"><h2>部屋ID</h2><span class="code">${room.code}</span><p>招待リンクと合言葉を参加者に送ってください。</p><button data-act="copy">招待リンクをコピー</button></div>
  <div class="box"><h2>参加者</h2><ol class="list">${players}</ol><p class="hint">親の順番は抽選で決まります。</p><p class="hint">初期${room.settings.initialPoints}点 ／ 賭け点 ${room.settings.stake}点 ／ 親は各${room.settings.turns}回${room.settings.finalBetBoost?' ／ 最終ラウンド上限150点':''} ／ ${room.settings.questionMode==='chat'?`チャット質問：子1人${room.settings.questionsPerPlayer}回`:'制限時間：1分'}</p></div>
  ${panel('rename','表示名を変更',`<form id="rename" class="form"><label>表示名<input id="rename-name" name="name" required maxlength="20" value="${myName}"></label><button>変更を保存</button></form>`)}
  ${isHost?`<button class="primary wide" data-act="start" ${room.members.length<2?'disabled':''}>このメンバーで開始</button>`:'<p>作成者が開始するのを待っています。</p>'}`;
 }else{
  html+=`<h1>${room.stage==='finished'?'対戦終了':'ラウンド '+(room.round+1)+' / '+room.total}</h1><p>親　<strong>${parentName}</strong></p>`;
  if(room.stage==='secret'){
   html+=`<div class="box"><h2>${parent?'親の秘密の数字を選択':'親が秘密の数字を選んでいます'}</h2>${horses(parent)}</div>`;
   if(parent) html+='<div class="bottom"><button class="primary" data-act="secret" '+(chosen.length?'':'disabled')+'>この数字で確定・質問開始</button></div>';
  }else if(room.stage==='betting'){
   const chatting=room.settings.questionMode==='chat', ready=!chatting||room.chat?.complete;
   if(parent && room.mySecret)html+=`<p class="box">あなたが選んだ数字　<strong>${room.mySecret}　${escapeHtml(room.names[room.mySecret-1])}</strong></p>`;
   html+=chatting?`${ready?chatPanel(parent):`<div class="question-layout">${chatPanel(parent)}${questionOptions()}</div>`}`:`<div class="box hero"><h2>質問タイム</h2><strong class="amount" id="timer">01:00</strong><p>${parent?'質問には嘘で答えてもOKです。':'親に質問し、答えを予想してください。'}</p></div>${oddsRules()}`;
   if(ready) html+=`
   <div class="box"><h2>${parent?'数字とお題':room.myBet?.locked?'あなたの確定予想':'あなたの予想'}</h2><p class="hint">同じ数字を選んだ人数で基本オッズを割ります。${room.settings.soloBonus?'数字を1つだけ選び、1人だけが正解した場合、基本5・6・7・8倍は12・11・10・9倍になります。':''}倍率は全員の確定後に発表します。</p>${horses(!parent)}
   ${parent?'':`${betField()}${wagerPreview()}<small>賭け点は選んだ数字に均等に分けます。${chatting && !room.splitBetRules?'上乗せ分は賭け点の全額にかかります。':''}受取は1点未満を切り捨てます。</small>`}</div>
   <p>予想確定　${room.confirmed.length} / ${room.members.length-1}人　${room.confirmed.map(id=>escapeHtml(memberName(id))).join('、')}</p>`;
   if(ready&&!parent&&!room.myBet?.locked)html+='<div class="bottom"><button class="primary" data-act="bet" '+(chosen.length?'':'disabled')+'>予想を確定</button></div>';
  }else{
   const r=room.history.at(-1); html+=`${roundHighlights(r)}${myRoundResult(r)}<div class="box hero"><h2>正解</h2><strong class="win">${r.answer}　${escapeHtml(r.names[r.answer-1])}</strong></div><div class="box"><h2>今回の精算</h2>${historyRows(r,false)}</div>`;
   if(room.stage==='result')html+=isHost||parent?'<button class="primary wide" data-act="next">次のラウンドへ</button>':'<p>次のラウンドを待っています。</p>';
  }
  if(room.stage==='finished')html+='<div class="box"><h2>最終順位</h2>'+ranking()+'<button data-act="save-result">結果を画像で保存</button></div>';else html+=panel('rank','現在の順位',ranking());
  if(room.history.length)html+=panel('history','対戦履歴',room.history.slice().reverse().map(r=>`<h3>ラウンド ${r.number}</h3>${historyRows(r)}`).join(''));
 }
 html+=panel('invite','部屋情報と招待',`<p>部屋ID <span class="code">${room.code}</span></p><button data-act="copy">招待リンクをコピー</button><p class="hint">「部屋に入る」から同じ表示名と合言葉でも戻れます。</p><button data-act="home">開始画面へ</button>`);
 const draftName=document.querySelector('#rename-name')?.value;
 screen.innerHTML=html;
 const newChat=document.querySelector('#live-chat');
 if(newChat){
  const latest=document.querySelector('[data-act="chat-latest"]');
  const syncLatest=()=>{latest.hidden=nearChatEnd(newChat);};
  newChat.scrollTop=followLatest?newChat.scrollHeight:oldChatTop;
  syncLatest();
  newChat.addEventListener('scroll',syncLatest,{passive:true});
  if(id==='live-chat')newChat.focus({preventScroll:true});
 }
 const renameField=document.querySelector('#rename-name');
 if(id==='rename-name'&&draftName!=null&&renameField)renameField.value=draftName;
 if(id && ['room-bet','rename-name','question-text','answer-text'].includes(id)){const f=document.getElementById(id);if(f&&!f.disabled){f.focus({preventScroll:true});if(f.type==='text'&&pos!=null)f.setSelectionRange(pos,pos);}}
 tick();
}
function tick(){
 const timer=document.querySelector('#timer');if(!timer)return;
 const s=Math.max(0,Math.ceil((room.endsAt-Date.now())/1000));
 timer.textContent=s?Math.floor(s/60)+':'+String(s%60).padStart(2,'0'):'質問終了';
 const betButton=document.querySelector('[data-act="bet"]');
 if(betButton && room.splitBetRules){
  betButton.disabled=s>0 || !chosen.length;
  betButton.textContent=s>0?'質問終了後に確定できます':'予想を確定';
 }
}
async function refresh(){
 if(!room||busy||polling||document.hidden)return;
 const expected=room.code;polling=true;
 try{const data=await api('state');if(room?.code===expected&&!busy&&data.revision>room.revision)draw(data);document.querySelector('#sync').textContent='';}
 catch(e){document.querySelector('#sync').textContent='再接続中';if(e.status===403)say('別の端末で再入室された可能性があります。開始画面から表示名と合言葉を入力してください。');else if([410,404].includes(e.status))say(e.message);}
 finally{polling=false;}
}
async function perform(fn){
 if(busy)return;busy=true;say('');screen.setAttribute('aria-busy','true');
 try{await fn();}catch(e){say(e.message||'通信に失敗しました。');}finally{busy=false;screen.removeAttribute('aria-busy');}
}
screen.addEventListener('toggle',e=>{const id=e.target.dataset.panel;if(id){if(e.target.open)savedDetails.add(id);else savedDetails.delete(id);}},true);
screen.addEventListener('input',e=>{if(e.target.id==='room-bet')stake=e.target.value;if(e.target.name==='name'&&!room)savedName=e.target.value;if(e.target.id==='question-text')questionDraft=e.target.value;if(e.target.id==='answer-text')answerDraft=e.target.value;});
screen.addEventListener('change',e=>{if(e.target.closest('.stake-stepper'))updateStakeControl(e.target);if(e.target.name==='autoQuestions'){document.querySelector('#question-count').disabled=e.target.checked;}if(e.target.name==='questionMode'){const chat=e.target.value==='chat';document.querySelector('#question-count-label').hidden=!chat;document.querySelector('#question-count').disabled=!chat||document.querySelector('input[name=autoQuestions]').checked;document.querySelector('#auto-question-label').hidden=!chat;}if(e.target.id==='answer-lie')lieDraft=e.target.checked;});
screen.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.target);perform(async()=>{
 if(e.target.id==='rename'){draw(await api('rename',{name:f.get('name')}));return;}
 if(e.target.id==='question-form' || e.target.id==='answer-form'){
  const asking=e.target.id==='question-form';
  if(!asking){
   const text=String(f.get('text')).normalize('NFKC');
   const unknown=/^(?:わからない|分からない|わかりません|分かりません|わからん|分からん|知らない|知りません)[。！!？?\s]*$/.test(text);
   const count=room.chat.entries.filter(q=>q.isUnknown===true||q.isLie===true).length;
   const notice=unknown?(count>=10?'「わからない」として回答します。倍率は上限に達しています。':`「わからない」として回答します。親と質問した子の追加負担はそれぞれ0〜${format((room.members.length-1)*(room.maxStake??100)/2)}点が目安です。金額は予想確定後に決まります。`):(f.has('isLie')?'「嘘」として回答します。':'「本当」として回答します。');
   if(!window.confirm(notice+' よろしいですか？'))return;
  }
  const data=await api(asking?'ask':'answer',{round:room.round,entryCount:room.chat.entries.length,text:f.get('text'),...(asking?{}:{isLie:f.has('isLie')})});
  if(asking)questionDraft='';else {answerDraft='';lieDraft=false;}draw(data,true);return;
 }
 const code=String(f.get('code')||'').replace(/[-\s]/g,'').toUpperCase();
 const candidate=newToken();
 const data=await api(mode,{name:f.get('name'),phrase:f.get('phrase'),settings:{initialPoints:Number(f.get('points')),stake:Number(f.get('stake')),turns:Number(f.get('turns')),questionMode:f.get('questionMode')||'timer',questionsPerPlayer:Number(f.get('questionsPerPlayer')||3),finalBetBoost:f.has('finalBetBoost'),autoQuestions:f.has('autoQuestions')}},code,candidate);
 token=candidate;draw(data);
});});
screen.addEventListener('click',event=>{const b=event.target.closest('[data-act]');if(!b||b.disabled||busy)return;
 const a=b.dataset.act;
 if(a==='practice-start'){practice={secret:Math.floor(Math.random()*9)+1,questions:[],picks:[],stake:10,finished:false};practiceScreen();return;}
 if(a==='practice-home'){practice=null;lobbyForm();return;}
 if(a==='practice-pick'){
  const number=Number(b.dataset.number);
  practice.picks=practice.picks.includes(number)?practice.picks.filter(n=>n!==number):[...practice.picks,number];
  practiceScreen();return;
 }
 if(a==='practice-question'){
  const index=Number(b.dataset.example),n=practice.secret,item=practiceItems[n-1];
  practice.questions.push({text:practiceQuestions[index],answer:[n>=5,n%2===1,item.food,item.alive][index]});practiceScreen();return;
 }
 if(a==='practice-bet'){practice.stake=Math.min(100,Math.max(10,practice.stake+Number(b.dataset.delta)));practiceScreen();return;}
 if(a==='practice-finish'){if(!practice.picks.length)return;practice.finished=true;practiceScreen();return;}
 if(a==='question-example'){
  questionDraft=['5以上ですか？','奇数ですか？','食べ物ですか？','生き物ですか？','家の中にありますか？'][Number(b.dataset.example)];
  const field=document.querySelector('#question-text');field.value=questionDraft;field.focus();return;
 }
 if(a==='stake-down'||a==='stake-up'){
  const select=b.closest('.stake-stepper').querySelector('select');
  if(select.disabled)return;
  select.value=String(Math.min(Number(b.closest('.stake-stepper').dataset.limit),Math.max(10,Number(select.value)+(a==='stake-up'?10:-10))));
  updateStakeControl(select);
  return;
 }
 if(a==='chat-latest'){
  const list=document.querySelector('#live-chat');
  list.scrollTop=list.scrollHeight;
  list.focus({preventScroll:true});
  b.hidden=true;
  return;
 }
 if(a==='save-result'){
  const canvas=document.createElement('canvas');canvas.width=900;canvas.height=270+room.standings.length*85;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#151c3d';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#fff';ctx.font='bold 48px sans-serif';ctx.fillText('数読みダービー　対戦結果',50,85);
  ctx.font='30px sans-serif';room.standings.forEach((p,i)=>{ctx.fillText(p.rank+'位　'+p.name,55,170+i*85,600);ctx.fillText(format(p.points)+'点',650,170+i*85,200);});
  const link=document.createElement('a');link.download='数読みダービー結果.png';link.href=canvas.toDataURL('image/png');link.click();return;
 }
 if(a==='refresh-rooms'){loadRooms();return;}
 if(a==='select-room'){roomCode=b.dataset.code;const field=document.querySelector('#entry input[name="code"]');if(field)field.value=roomCode;document.querySelector('#entry input[name="phrase"]')?.focus();return;}
 if(a==='reveal-skip'){showStandings();return;}
 if(a==='ranking-skip'){finishReveal();return;}
 if(a.endsWith('-mode')){mode=a.split('-')[0];say('');lobbyForm();return;}
 if(a==='pick'){const n=Number(b.dataset.number);chosen=room.stage==='secret'?[n]:chosen.includes(n)?chosen.filter(v=>v!==n):[...chosen,n];renderRoom();return;}
 if(a==='home'){leavePresence();clearTimeout(revealTimer);revealingKey=null;revealPhase=null;room=null;token='';chosen=[];viewKey='';savedName='';savedDetails.clear();history.replaceState(null,'',location.pathname);roomCode='';lobbyForm();return;}
 perform(async()=>{
  if(a==='unknown-answer'){
   const count=room.chat.entries.filter(q=>q.isUnknown===true||q.isLie===true).length;
   const extra=count>=10?'上乗せは上限に達しています。':`倍率が0.5倍上がります。親と質問した子の追加負担はそれぞれ0〜${format((room.members.length-1)*(room.maxStake??100)/2)}点が目安です。金額は予想確定後に決まります。`;
   if(!window.confirm('「わからない」と回答しますか？\n'+extra))return;
   const data=await api('answer',{round:room.round,entryCount:room.chat.entries.length,isUnknown:true});answerDraft='';lieDraft=false;draw(data,true);return;}
  if(a==='resume'){
   const code=b.dataset.code,credential=getValue(storageKey(code));
   try{if(!/^[0-9a-f]{64}$/.test(credential))throw Error('表示名と部屋の合言葉を入力してください。');await restoreRoom(code,credential);}
   catch(error){roomCode=code;const previous=recentRooms().find(x=>x.code===code);if(previous && previous.name!=='参加済み')savedName=previous.name;lobbyForm();throw error;}
   return;
  }
  if(a==='copy'){const link=new URL(location.href);link.searchParams.set('room',room.code);try{await navigator.clipboard.writeText(link.href);say('招待リンクをコピーしました。合言葉は別途伝えてください。');}catch{say(link.href);}return;}
  const payload={round:room.round};
  if(a==='secret')payload.number=chosen[0];
  if(a==='bet'){
   payload.numbers=chosen;
   payload.stake=Number(stake);
   if(room.settings.stakeStep===10 && (payload.stake<10 || payload.stake%10!==0))throw Error('賭け点は10点刻みで選んでください。');
   if(!Number.isInteger(payload.stake)||payload.stake<1||payload.stake>(room.maxStake??1000))throw Error(`賭け点は1〜${room.maxStake??1000}点で入力してください。`);
  }
  draw(await api(a,payload));
 });
});
lobbyForm();
if(invite && getValue(storageKey(invite))){const credential=getValue(storageKey(invite));perform(async()=>{try{await restoreRoom(invite,credential);}catch(error){mode='join';lobbyForm();throw error;}});}
setInterval(refresh,2000);setInterval(tick,250);setInterval(()=>{if(room)heartbeat();else if(mode==='join'&&!document.hidden)loadRooms();},15000);document.addEventListener('visibilitychange',()=>{refresh();if(!document.hidden)heartbeat(true);});window.addEventListener('pagehide',leavePresence);window.addEventListener('pageshow',()=>heartbeat(true));
