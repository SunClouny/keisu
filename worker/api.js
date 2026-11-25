import {createGame, validateSettings, totalRounds, parentAt, balances, market, calculateRound, standings, settle, advance, validNumbers} from './engine.js';

const lifetime = 24 * 60 * 60 * 1000;
const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const encoder = new TextEncoder();
function requireValue(test, message, status = 400) {
  if (!test) throw Object.assign(new Error(message), {status});
}
const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
const keyHash = async text => hex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
function cleanName(value) {
  const name = typeof value === 'string' ? value.normalize('NFKC').trim() : '';
  requireValue(name.length >= 1 && name.length <= 20 && !/[\u0000-\u001f\u007f]/.test(name), '表示名は1〜20文字で入力してください。');
  return name;
}
function phrase(value) {
  requireValue(typeof value === 'string', '合言葉を入力してください。');
  const result = value.normalize('NFKC').trim();
  requireValue(result.length >= 4 && result.length <= 64, '合言葉は4〜64文字で入力してください。');
  return result;
}
async function phraseHash(value, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(value), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',iterations:50000,salt:encoder.encode(salt)},key,256));
}
function uniqueName(room, name, self) {
  requireValue(!room.members.some(m => m.id !== self && m.name === name), 'その表示名は登録済みです。別の名前を入力してください。',409);
}
function chatComplete(room) {
  if (room.settings.questionMode !== 'chat') return true;
  const chat = room.chat;
  if (!chat || chat.round !== room.game.rounds.length) return false;
  const parent = parentAt(room.game).id;
  return room.members.filter(m => m.id !== parent).every(m =>
    chat.entries.filter(q => q.playerId === m.id && q.answer !== null).length >= room.settings.questionsPerPlayer);
}
function lieLimit(room) {
  return Math.ceil((room.members.length - 1) * room.settings.questionsPerPlayer / 3);
}
function chatText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  requireValue(text.length >= 1 && text.length <= 160 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text), '質問と回答は1〜160文字で入力してください。');
  return text;
}
function view(room, self) {
  const g=room.game, base={code:room.code, me:self, host:room.members[0].id, settings:room.settings,
    revision:room.revision, expires:room.expires, members:room.members.map(({id,name})=>({id,name}))};
  if (!g) return {...base, stage:'lobby'};
  const current=g.draft, round=current?g.rounds.length:g.rounds.length-1;
  const parent=parentAt(g,round).id;
  const history=g.rounds.map(r=>({number:r.index+1,parent:r.parentId,answer:r.answer,names:r.names,odds:r.odds,...calculateRound(g,r),...(r.chat?{chat:r.chat}:{})}));
  const chat=room.settings.questionMode==='chat' && room.chat?.round===round ? {
    round:room.chat.round,
    entries:room.chat.entries.map(({playerId,question,answer,isLie}) => ({playerId,question,answer,...(self===parent || !current ? {isLie:typeof isLie==='boolean'?isLie:null} : {})})),
    complete:current ? chatComplete(room) : true,
    lieLimit:lieLimit(room),
    ...(self===parent && current ? {liesUsed:room.chat.entries.filter(q=>q.isLie===true).length} : {})
  } : null;
  return {...base,stage:current?.stage ?? (g.completedAt?'finished':'result'),round,total:totalRounds(g),parent:parentAt(g,round).id,
    standings:standings(g), history, names:current?.names??g.rounds.at(-1)?.names,
    market:current?market(g).map(m=>({...m,people:0,adjusted:m.base})):market(g,g.rounds.at(-1)), endsAt:room.endsAt,
    confirmed:current?Object.keys(current.bets).filter(id=>current.bets[id].locked):[],
    myBet:current?.bets[self]??null,
    chat};
}
function update(room, action, b, member) {
  const g=room.game, host=room.members[0].id===member.id;
  if(action==='rename'){
    requireValue(!g,'開始後は表示名を変更できません。',409);
    const name=cleanName(b.name); uniqueName(room,name,member.id);member.name=name;return;
  }
  if(action==='start'){
    requireValue(host,'部屋を作った人が開始してください。',403);
    requireValue(!g&&room.members.length>=2,'2人以上の待機室で開始できます。',409);
    room.game=createGame(room.members.map(m=>m.name),room.settings,undefined,true);return;
  }
  requireValue(g && Number.isInteger(b.round) && b.round===(g.draft?g.rounds.length:g.rounds.length-1),'画面を更新して現在のラウンドを確認してください。',409);
  const parent=parentAt(g,b.round).id===member.id;
  if(action==='secret'){
    requireValue(parent && g.draft?.stage==='secret','今回の親だけが数字を確定できます。',403);
    requireValue(Number.isInteger(b.number)&&b.number>=1&&b.number<=9,'1〜9の数字を選んでください。');
    g.draft.secret=b.number;g.draft.stage='betting';
    if(room.settings.questionMode==='chat') {room.chat={round:b.round, entries:[]};room.endsAt=null;}
    else room.endsAt=Date.now()+60000;
    return;
  }
  if(action==='ask' || action==='answer'){
    requireValue(room.settings.questionMode==='chat' && g.draft?.stage==='betting' && room.chat?.round===b.round,'今はチャットを利用できません。',409);
    const entries=room.chat.entries, pending=entries.find(q=>q.answer===null);
    if(action==='ask'){
      requireValue(!parent,'親は質問できません。',403);
      requireValue(!pending,'親が前の質問に回答するまでお待ちください。',409);
      requireValue(entries.filter(q=>q.playerId===member.id).length < room.settings.questionsPerPlayer,'質問回数を使い切りました。',409);
      entries.push({playerId:member.id, question:chatText(b.text), answer:null});
    }else{
      requireValue(parent,'今回の親だけが回答できます。',403);
      requireValue(!!pending,'回答待ちの質問がありません。',409);
      requireValue(b.isLie===undefined || typeof b.isLie==='boolean','嘘の指定を確認してください。');
      const isLie=b.isLie===true;
      requireValue(!isLie || entries.filter(q=>q.isLie===true).length < lieLimit(room),'嘘をつける回数を使い切りました。',409);
      pending.answer=chatText(b.text);pending.isLie=isLie;
    }
    return;
  }
  if(action==='bet'){
    requireValue(!parent && g.draft?.stage==='betting','子の予想を受け付ける時間ではありません。',409);
    requireValue(chatComplete(room),'全員の質問と親の回答が終わるまでお待ちください。',409);
    const bet=g.draft.bets[member.id];
    requireValue(!bet.locked,'予想は確定済みです。',409);
    requireValue(Number.isInteger(b.stake)&&b.stake>=1&&b.stake<=1000,'BETは1〜1000点の整数です。');
    bet.stake=b.stake;bet.numbers=validNumbers(b.numbers);bet.locked=true;
    if(Object.values(g.draft.bets).every(x=>x.locked)){
      const settled=settle(g);
      if(room.settings.questionMode==='chat' && room.chat?.round===b.round)
        settled.chat=room.chat.entries.map(({playerId,question,answer,isLie})=>({playerId,question,answer,isLie:typeof isLie==='boolean'?isLie:null}));
      room.endsAt=null;
    }
    return;
  }
  if(action==='next'){
    requireValue(parent||host,'親または部屋を作った人が進めてください。',403);
    requireValue(!g.draft&&!g.completedAt,'今は次に進めません。',409);
    advance(g);room.endsAt=null;return;
  }
  requireValue(false,'操作を確認してください。',404);
}
export async function handleAPI(request, bucket) {
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'POST, OPTIONS'};
  const reply=(body,status=200)=>new Response(JSON.stringify(body),{headers,status});
  if(request.method==='OPTIONS')return new Response(null,{headers,status:204});
  try {
    requireValue(request.method==='POST','POSTで送信してください。',405);
    requireValue(request.headers.get('content-type')?.startsWith('application/json'),'JSONを送信してください。',415);
    requireValue(Number(request.headers.get('content-length')??0)<16000,'入力内容が長すぎます。',413);
    const raw=await request.text();requireValue(raw.length<3500,'入力内容が長すぎます。',413);
    let b;try{b=JSON.parse(raw);}catch{requireValue(false,'入力形式が不正です。');}
    requireValue(b && typeof b==='object','入力形式が不正です。');
    const token=(request.headers.get('Authorization')??'').replace(/^Bearer /,'');
    requireValue(/^[0-9a-f]{64}$/.test(token),'端末の参加情報を確認してください。',401);
    const key=await keyHash(token);
    if(b.action==='list'){
      let cursor,objects=[];
      do {
        const page=await bucket.list({prefix:'rooms/',limit:1000,...(cursor?{cursor}:{})});
        objects.push(...page.objects);cursor=page.truncated?page.cursor:null;
      } while(cursor);
      const rooms=[],activeCodes=[];
      for(let i=0;i<objects.length;i+=20){
        const batch=await Promise.all(objects.slice(i,i+20).map(async item=>{
          const object=await bucket.get(item.key);if(!object)return null;
          const r=await object.json();
          if(r.expires<=Date.now())return null;
          const presence=await Promise.all(r.members.map(m=>bucket.get(`presence/${r.code}/${m.id}`)));
          const records=await Promise.all(presence.map(o=>o?o.json():null));
          const connected=records.filter((v,j)=>v && v.key===r.members[j].key && v.seen>Date.now()-90000).length;
          return connected?{code:r.code,host:r.members[0].name,players:r.members.length,connected,expires:r.expires,open:!r.game&&r.members.length<10}:null;
        }));
        for(const room of batch.filter(Boolean)){activeCodes.push(room.code);if(room.open)rooms.push(room);}
      }
      rooms.sort((a,b)=>b.expires-a.expires);
      return reply({rooms,activeCodes});
    }
    if(b.action==='create'){
      const name=cleanName(b.name),password=phrase(b.phrase),settings=validateSettings(b.settings);
      const code=Array.from(crypto.getRandomValues(new Uint8Array(12)),n=>alphabet[n%alphabet.length]).join('');
      const salt=crypto.randomUUID(),room={code,salt,proof:await phraseHash(password,salt),settings,
        members:[{id:'p1',name,key}],game:null,revision:1,expires:Date.now()+lifetime,endsAt:null};
      const saved=await bucket.put('rooms/'+code,JSON.stringify(room),{onlyIf:{etagDoesNotMatch:'*'}});
      requireValue(saved,'もう一度作成してください。',409);return reply(view(room,'p1'),201);
    }
    requireValue(typeof b.code==='string'&&/^[A-Z2-9]{12}$/.test(b.code),'部屋IDを確認してください。');
    const path='rooms/'+b.code;
    for(let attempt=0;attempt<8;attempt++){
      const obj=await bucket.get(path);requireValue(obj,'部屋が見つかりません。',404);
      const room=await obj.json();requireValue(room.expires>Date.now(),'この部屋の利用期限が終了しました。',410);
      let member=room.members.find(m=>m.key===key);
      if(b.action==='join'||b.action==='rejoin'){
        requireValue(await phraseHash(phrase(b.phrase),room.salt)===room.proof,'合言葉が違います。',403);
        const name=cleanName(b.name),existing=room.members.find(m=>m.name===name);
        if(existing){
          requireValue(!member||member.id===existing.id,'この端末の参加情報を確認してください。',409);
          if(existing.key===key)return reply(view(room,existing.id));
          existing.key=key;member=existing;
        }else{
          requireValue(b.action!=='rejoin','その名前の参加者が見つかりません。表示名を確認してください。',404);
          requireValue(!member,'この端末の参加情報を確認してください。',409);
          requireValue(!room.game&&room.members.length<10,'対戦開始済み、または満室です。',409);
          member={id:'p'+(room.members.length+1),name,key};room.members.push(member);
        }
      } else {
        requireValue(member,'この端末から部屋に参加してください。',403);
        if(b.action==='presence'){
          await bucket.put(`presence/${room.code}/${member.id}`,JSON.stringify({key,seen:Date.now()}));
          return reply({ok:true});
        }
        if(b.action==='leave'){
          const presencePath=`presence/${room.code}/${member.id}`, previous=await bucket.get(presencePath);
          if(previous){const record=await previous.json();if(record.key===key)await bucket.put(presencePath,JSON.stringify({key,seen:0}),{onlyIf:{etagMatches:previous.etag}});}
          return reply({ok:true});
        }
        if(b.action==='state')return reply(view(room,member.id));
        update(room,b.action,b,member);
      }
      room.revision++;
      const saved=await bucket.put(path,JSON.stringify(room),{onlyIf:{etagMatches:obj.etag}});
      if(saved)return reply(view(room,member.id));
    }
    return reply({error:'操作が重なりました。もう一度お試しください。'},409);
  } catch(error){
    const inputError = /予想|BET|数字|初期ポイント|親の回数|設定/.test(error.message);
    const status = error.status ?? (inputError ? 400 : 500);
    return reply({error: status < 500 ? error.message : '接続を確認して、もう一度お試しください。'}, status);
  }
}
