'use strict';
const SERVER='https://keisu-rooms-yusuke.yutan226.chatgpt.site';
const API=(location.origin===SERVER?location.origin:SERVER)+'/api/rooms';
const screen=document.querySelector('#screen'), errorBox=document.querySelector('#error');
const escapeHtml = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const format = x => Number(x).toLocaleString('ja-JP',{maximumFractionDigits:2});
const invite = new URL(location.href).searchParams.get('room')?.toUpperCase();
let mode=invite?'join':'create',room=null,token='',chosen=[],stake=10,busy=false,polling=false;
let savedName='', viewKey='', savedDetails=new Set(),roomCode=invite||'';
let questionDraft='', answerDraft='', lieDraft=false;
const storageKey=code=>'keisu.participant.'+code;
function newToken(){return [...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('');}
function storeValue(key,value){try{localStorage.setItem(key,value);}catch{}}
function getValue(key){try{return localStorage.getItem(key)||'';}catch{return '';}}
function say(text){errorBox.textContent=text;}
function memberName(id){return room?.members.find(m=>m.id===id)?.name??'';}
function lobbyForm(){
 const joining=mode==='join';
 screen.innerHTML=`<h1>合言葉で対戦</h1><p>2〜10人。それぞれの端末で同じ部屋に参加します。</p>
 <nav class="tabs"><button data-act="create-mode" aria-pressed="${!joining}">部屋を作る</button><button data-act="join-mode" aria-pressed="${joining}">部屋に入る</button></nav>
 <form class="box form" id="entry"><label>あなたの表示名<input required maxlength="20" name="name" value="${escapeHtml(savedName)}" autocomplete="off"></label>
 ${joining?`<label>部屋ID<input name="code" minlength="12" maxlength="16" required value="${escapeHtml(roomCode)}" autocapitalize="characters" spellcheck="false" placeholder="招待リンクから自動入力"></label>`:''}
 <label>合言葉<input name="phrase" type="password" minlength="4" maxlength="64" required autocomplete="off" placeholder="${joining?'作成者が決めた合言葉':'4〜64文字で設定'}"></label>
 ${joining?'':`<div class="columns"><label>初期ポイント<input type="number" name="points" min="1" max="100000" value="300" required></label><label>標準BET<input type="number" name="stake" min="1" max="1000" value="10" required></label><label>親の回数（1人あたり）<input type="number" name="turns" min="1" max="20" value="2" required></label></div>
 <label>質問の進め方<select name="questionMode" id="question-mode"><option value="timer">制限時間（1分）</option><option value="chat">チャットで質問</option></select></label>
 <label id="question-count-label" hidden>質問回数（子1人あたり、全員共通）<input type="number" name="questionsPerPlayer" id="question-count" min="1" max="20" value="3" disabled required><small class="hint">親が嘘をつけるのは、子全員の質問総数の3分の1を切り上げた回数です。</small></label>`}
 <button class="primary">${joining?'この名前で参加':'この名前で部屋を作る'}</button></form>
 <p class="hint">作成者から招待リンクと合言葉を共有してください。部屋は作成から24時間利用できます。</p>`;
}
async function api(action,fields={},code=roomCode,credential=token){
 const response=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+credential},body:JSON.stringify({action,code,...fields}),cache:'no-store',signal:AbortSignal.timeout(15000)});
 const text=await response.text();let data;try{data=JSON.parse(text);}catch{throw Error('部屋サーバーに接続できません。少し待って再試行してください。');}
 if(!response.ok){const err=Error(data.error||'通信に失敗しました。');err.status=response.status;throw err;}
 return data;
}
function draw(data){
 if(room && data.code===room.code && data.revision<room.revision)return;
 const nextKey=data.code+'/'+data.round+'/'+data.stage;
 if(viewKey!==nextKey){chosen=[];stake=data.settings.stake;savedDetails.clear();questionDraft='';answerDraft='';lieDraft=false;viewKey=nextKey;}
 room=data;roomCode=data.code;
 try{const url=new URL(location.href);url.searchParams.set('room',roomCode);history.replaceState(null,'',url);}catch{}
 renderRoom();
}
function horses(interactive){
 const locked=room.myBet?.locked;
 return '<div class="grid">'+room.market.map((m,i)=>{
  const picked=locked?room.myBet.numbers.includes(m.number):chosen.includes(m.number);
  return `<button class="horse" data-act="pick" data-number="${m.number}" aria-pressed="${picked}" ${interactive&&!locked?'':'disabled'}><b>${m.number}</b><span>${escapeHtml(room.names?.[i])}</span><small>${format(m.adjusted)}倍 · ${m.people}人</small></button>`;
 }).join('')+'</div>';
}
function questionOptions(){
 return `<section class="box question-options"><h2>質問の選択肢</h2><div class="grid" role="list">${room.market.map((m,i)=>`<div class="question-option" role="listitem"><b>${m.number}</b><span>${escapeHtml(room.names?.[i])}</span><small>${format(m.adjusted)}倍</small></div>`).join('')}</div></section>`;
}
function panel(id,title,html){return `<details data-panel="${id}" ${savedDetails.has(id)?'open':''}><summary>${title}</summary>${html}</details>`;}
function ranking(){return '<ol class="list">'+room.standings.map(p=>`<li><b>${p.rank}位　${escapeHtml(p.name)}</b><span>${format(p.points)}点</span></li>`).join('')+'</ol>';}
function historyRows(r){
 const list=r.outcomes.map(o=>`<li><b>${escapeHtml(memberName(o.playerId))}</b><span>${o.numbers.join('・')} ／ BET ${o.stake} ／ 受取 ${o.received}点</span></li>`).join('');
 const chat=r.chat?.length?`<div class="round-chat"><h3>質問と親の回答</h3><ol class="chat-list">${chatRecords(r.chat,true)}</ol></div>`:'';
 return `<p>親　${escapeHtml(memberName(r.parent))} ／ 正解 ${r.answer}　${escapeHtml(r.names[r.answer-1])}</p><ul class="list">${list}</ul><p>親の収支　${r.parentDelta>0?'+':''}${r.parentDelta}点</p>${chat}`;
}
function chatRecords(entries,revealed=false){
 return entries.map(q=>`<li class="chat-entry"><strong>${escapeHtml(memberName(q.playerId))}の質問</strong><p>${escapeHtml(q.question)}</p>${q.answer===null?'<small>親の回答待ち</small>':`<strong>親の回答</strong>${q.isLie===true?' <span class="lie-badge">嘘</span>':revealed&&q.isLie===null?' <small>嘘の記録なし</small>':''}<p>${escapeHtml(q.answer)}</p>`}</li>`).join('');
}
function chatPanel(parent){
 const chat=room.chat, entries=chat?.entries??[], pending=entries.find(q=>q.answer===null);
 const used=entries.filter(q=>q.playerId===room.me).length, limit=room.settings.questionsPerPlayer;
 const messages=chatRecords(entries);
 const remaining=parent?Math.max(0,chat.lieLimit-chat.liesUsed):null;
 let form='';
 if(!chat.complete && parent && pending) form=`<form id="answer-form" class="form"><label>回答<input id="answer-text" name="text" maxlength="160" required value="${escapeHtml(answerDraft)}" placeholder="回答を入力"></label><label class="lie-check"><input id="answer-lie" type="checkbox" name="isLie" ${lieDraft&&remaining>0?'checked':''} ${remaining===0?'disabled':''}>この回答は嘘</label><button class="primary">回答を送る</button></form>`;
 else if(!chat.complete && !parent && used<limit && !pending) form=`<form id="question-form" class="form"><label>質問<input id="question-text" name="text" maxlength="160" required value="${escapeHtml(questionDraft)}" placeholder="親への質問を入力"></label><button class="primary">質問を送る</button></form>`;
 let status=chat.complete?'全員の質問と回答が終わりました。':parent?(pending?'質問に回答してください。':'子からの質問を待っています。'):(used>=limit?'あなたの質問は終了しました。':pending?'親の回答を待っています。':`あなたの残り質問回数：${limit-used}回`);
 const progress=room.members.filter(m=>m.id!==room.parent).map(m=>`${escapeHtml(m.name)}：${entries.filter(q=>q.playerId===m.id).length}/${limit}回`).join(' ／ ');
 return `<section class="box chat"><h2>質問チャット</h2><p>${status}</p><p class="hint">${progress}</p><p class="hint">親が嘘をつける回数：${chat.lieLimit}回${parent?`（残り${remaining}回）`:''}。嘘の内容は精算後に表示されます。</p><ol class="chat-list" aria-label="質問と回答">${messages}</ol>${form}</section>`;
}
function renderRoom(){
 const active=document.activeElement,id=active?.id,pos=active?.selectionStart;
 const isHost=room.me===room.host,parent=room.me===room.parent;
 const myName=escapeHtml(memberName(room.me)),parentName=escapeHtml(memberName(room.parent));
 let html=`<div class="row"><strong class="name">${myName}さん</strong><span class="chip">${room.members.length}人</span></div>`;
 if(room.stage==='lobby'){
  const players=room.members.map((m,i)=>`<li><span>${i+1}　${escapeHtml(m.name)}</span>${m.id===room.host?'<small>部屋の作成者</small>':''}</li>`).join('');
  html+=`<h1>待機室</h1><div class="box"><h2>部屋ID</h2><span class="code">${room.code}</span><p>招待リンクと、作成時に決めた合言葉を参加者に伝えてください。</p><button data-act="copy">招待リンクをコピー</button></div>
  <div class="box"><h2>参加者</h2><ol class="list">${players}</ol><p class="hint">対戦開始時に順番をランダムに決めます。</p><p class="hint">初期${room.settings.initialPoints}点 ／ 標準BET ${room.settings.stake} ／ 親は各${room.settings.turns}回 ／ ${room.settings.questionMode==='chat'?`チャット質問：子1人${room.settings.questionsPerPlayer}回 ／ 嘘は親1人につき1ラウンド${Math.ceil((room.members.length-1)*room.settings.questionsPerPlayer/3)}回まで`:'制限時間：1分'}</p></div>
  ${panel('rename','表示名を変更',`<form id="rename" class="form"><label>表示名<input id="rename-name" name="name" required maxlength="20" value="${myName}"></label><button>変更を保存</button></form>`)}
  ${isHost?`<button class="primary wide" data-act="start" ${room.members.length<2?'disabled':''}>このメンバーで開始</button>`:'<p>作成者が開始するのを待っています。</p>'}`;
 }else{
  html+=`<h1>${room.stage==='finished'?'対戦終了':'ラウンド '+(room.round+1)+' / '+room.total}</h1><p>親　<strong>${parentName}</strong></p>`;
  if(room.stage==='secret'){
   html+=`<div class="box"><h2>${parent?'親の秘密の数字を選択':'親が秘密の数字を選んでいます'}</h2>${horses(parent)}</div>`;
   if(parent) html+='<div class="bottom"><button class="primary" data-act="secret" '+(chosen.length?'':'disabled')+'>この数字で確定・質問開始</button></div>';
  }else if(room.stage==='betting'){
   const chatting=room.settings.questionMode==='chat', ready=!chatting||room.chat?.complete;
   html+=chatting?`${ready?'':questionOptions()}${chatPanel(parent)}`:`<div class="box hero"><h2>質問タイム</h2><strong class="amount" id="timer">01:00</strong><p>${parent?'質問には嘘で答えてもOKです。':'親に質問し、答えを予想してください。'}</p></div>`;
   if(ready) html+=`
   <div class="box"><h2>${parent?'現在のオッズ':room.myBet?.locked?'あなたの確定予想':'あなたの予想'}</h2>${horses(!parent)}
   ${parent?'':`<label>BET（1〜1,000点）<input id="room-bet" type="number" inputmode="numeric" min="1" max="1000" value="${escapeHtml(room.myBet?.locked?room.myBet.stake:stake)}" ${room.myBet?.locked?'disabled':''}></label><small>的中時は BET × 基本オッズ ÷ 自分の予想数 ÷ その数字の予想人数。端数は切り捨てます。</small>`}</div>
   <p>予想確定　${room.confirmed.length} / ${room.members.length-1}人　${room.confirmed.map(id=>escapeHtml(memberName(id))).join('、')}</p>`;
   if(ready&&!parent&&!room.myBet?.locked)html+='<div class="bottom"><button class="primary" data-act="bet" '+(chosen.length?'':'disabled')+'>予想とBETを確定</button></div>';
  }else{
   const r=room.history.at(-1); html+=`<div class="box hero"><h2>正解</h2><strong class="win">${r.answer}　${escapeHtml(r.names[r.answer-1])}</strong></div><div class="box"><h2>今回の精算</h2>${historyRows(r)}</div>`;
   if(room.stage==='result')html+=isHost||parent?'<button class="primary wide" data-act="next">次のラウンドへ</button>':'<p>次のラウンドを待っています。</p>';
  }
  if(room.stage==='finished')html+='<div class="box"><h2>最終順位</h2>'+ranking()+'</div>';else html+=panel('rank','現在の順位',ranking());
  if(room.history.length)html+=panel('history','対戦履歴',room.history.slice().reverse().map(r=>`<h3>ラウンド ${r.number}</h3>${historyRows(r)}`).join(''));
 }
 html+=panel('invite','部屋情報と招待',`<p>部屋ID <span class="code">${room.code}</span></p><button data-act="copy">招待リンクをコピー</button><p class="hint">同じブラウザで招待リンクを開くと再接続できます。</p><button data-act="home">開始画面へ</button>`);
 const draftName=document.querySelector('#rename-name')?.value;
 screen.innerHTML=html;
 if(id==='rename-name'&&draftName!=null)document.querySelector('#rename-name').value=draftName;
 if(id && ['room-bet','rename-name','question-text','answer-text'].includes(id)){const f=document.getElementById(id);if(f&&!f.disabled){f.focus({preventScroll:true});if(f.type==='text'&&pos!=null)f.setSelectionRange(pos,pos);}}
 tick();
}
function tick(){
 const timer=document.querySelector('#timer');if(!timer)return;
 const s=Math.max(0,Math.ceil((room.endsAt-Date.now())/1000));
 timer.textContent=s?Math.floor(s/60)+':'+String(s%60).padStart(2,'0'):'質問終了';
}
async function refresh(){
 if(!room||busy||polling||document.hidden)return;
 const expected=room.code;polling=true;
 try{const data=await api('state');if(room?.code===expected&&!busy&&data.revision>room.revision)draw(data);document.querySelector('#sync').textContent='接続中';}
 catch(e){document.querySelector('#sync').textContent='再接続中';if([403,410,404].includes(e.status))say(e.message);}
 finally{polling=false;}
}
async function perform(fn){
 if(busy)return;busy=true;say('');screen.setAttribute('aria-busy','true');
 try{await fn();}catch(e){say(e.message||'通信に失敗しました。');}finally{busy=false;screen.removeAttribute('aria-busy');}
}
screen.addEventListener('toggle',e=>{const id=e.target.dataset.panel;if(id){if(e.target.open)savedDetails.add(id);else savedDetails.delete(id);}},true);
screen.addEventListener('input',e=>{if(e.target.id==='room-bet')stake=e.target.value;if(e.target.name==='name'&&!room)savedName=e.target.value;if(e.target.id==='question-text')questionDraft=e.target.value;if(e.target.id==='answer-text')answerDraft=e.target.value;});
screen.addEventListener('change',e=>{if(e.target.id==='question-mode'){const chat=e.target.value==='chat';document.querySelector('#question-count-label').hidden=!chat;document.querySelector('#question-count').disabled=!chat;}if(e.target.id==='answer-lie')lieDraft=e.target.checked;});
screen.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.target);perform(async()=>{
 if(e.target.id==='rename'){draw(await api('rename',{name:f.get('name')}));return;}
 if(e.target.id==='question-form' || e.target.id==='answer-form'){
  const asking=e.target.id==='question-form';const data=await api(asking?'ask':'answer',{round:room.round,text:f.get('text'),...(asking?{}:{isLie:f.has('isLie')})});
  if(asking)questionDraft='';else {answerDraft='';lieDraft=false;}draw(data);return;
 }
 const code=String(f.get('code')||'').replace(/[-\s]/g,'').toUpperCase();
 const candidate=(mode==='join'&&getValue(storageKey(code)))||newToken();
 const data=await api(mode,{name:f.get('name'),phrase:f.get('phrase'),settings:{initialPoints:Number(f.get('points')),stake:Number(f.get('stake')),turns:Number(f.get('turns')),questionMode:f.get('questionMode')||'timer',questionsPerPlayer:Number(f.get('questionsPerPlayer')||3)}},code,candidate);
 token=candidate;storeValue(storageKey(data.code),token);storeValue('keisu.displayName',f.get('name'));draw(data);
});});
screen.addEventListener('click',event=>{const b=event.target.closest('[data-act]');if(!b||b.disabled||busy)return;
 const a=b.dataset.act;
 if(a.endsWith('-mode')){mode=a.split('-')[0];say('');lobbyForm();return;}
 if(a==='pick'){const n=Number(b.dataset.number);chosen=room.stage==='secret'?[n]:chosen.includes(n)?chosen.filter(v=>v!==n):[...chosen,n];renderRoom();return;}
 if(a==='home'){room=null;token='';chosen=[];viewKey='';savedName='';savedDetails.clear();history.replaceState(null,'',location.pathname);roomCode='';lobbyForm();return;}
 perform(async()=>{
  if(a==='copy'){const link=new URL(location.href);link.searchParams.set('room',room.code);try{await navigator.clipboard.writeText(link.href);say('招待リンクをコピーしました。合言葉は別途伝えてください。');}catch{say(link.href);}return;}
  const payload={round:room.round};
  if(a==='secret')payload.number=chosen[0];
  if(a==='bet'){payload.numbers=chosen;payload.stake=Number(stake);if(!Number.isInteger(payload.stake)||payload.stake<1||payload.stake>1000)throw Error('BETは1〜1000点の整数で入力してください。');}
  draw(await api(a,payload));
 });
});
lobbyForm();
if(invite && getValue(storageKey(invite))){token=getValue(storageKey(invite));perform(async()=>draw(await api('state')));}
setInterval(refresh,2000);setInterval(tick,250);document.addEventListener('visibilitychange',refresh);
