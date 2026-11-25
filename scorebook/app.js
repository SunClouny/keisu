import {ODDS, DEFAULT_SETTINGS, SCHEMA, createGame, totalRounds, parentAt, payout, calculateRound, balances, standings, settle, advance, undo, validateBackup, csv, roundOdds, market} from './engine.js';

const KEY = 'keisu.scorebook.v1';
const app = document.querySelector('#app');
const money = value => new Intl.NumberFormat('ja-JP').format(value);
const fmtOdds = value => new Intl.NumberFormat('ja-JP', {maximumFractionDigits:2}).format(value);
const signed = value => `${value > 0 ? '+' : value < 0 ? '−' : '±'}${money(Math.abs(value))}`;
const esc = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const date = value => new Intl.DateTimeFormat('ja-JP', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
const defaultSetup = () => ({count:4,names:Array.from({length:10},(_,i)=>`プレイヤー${i+1}`),...DEFAULT_SETTINGS});
let state = {game:null,archives:[],setup:defaultSetup(),view:'game'};
let storageError = false, pendingImport = null, audioContext = null, lastBeep = '';
const paths = {
 flag:'M5 21V3m0 1c5-4 9 4 15 0v10c-6 4-10-4-15 0',
 arrow:'M5 12h14m-6-6 6 6-6 6',
 check:'m5 12 4 4L19 6',
 clock:'M12 8v5l3 2m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
 down:'M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5',
 up:'M12 16V4m-5 5 5-5 5 5M5 16v5h14v-5',
 crown:'m3 6 4 4 5-7 5 7 4-4-2 13H5L3 6Zm3 9h12',
 lock:'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5V10Zm7 4v3',
 people:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
 undo:'M3 4v6h6M3 10a9 9 0 1 1 1 9',
 plus:'M12 5v14M5 12h14',
 book:'M4 3h6a3 3 0 0 1 3 3v15a4 4 0 0 0-4-2H4V3Zm9 3a3 3 0 0 1 3-3h5v16h-4a4 4 0 0 0-4 2',
 dots:'M5 12h.01M12 12h.01M19 12h.01'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.flag}"/></svg>`;
const avatar = (player, extra='') => `<span class="avatar avatar-${Number(player.id.slice(1)) % 5} ${extra}" aria-hidden="true">${esc(player.name.slice(0,1))}</span>`;

function pack() { return {app:'keisu',version:SCHEMA,exportedAt:new Date().toISOString(),activeGame:state.game,archives:state.archives,setup:state.setup}; }
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(pack())); storageError=false; }
  catch { storageError=true; toast('このブラウザに保存できません。終了前にJSONバックアップを保存してください。'); }
  updateSaveLabel();
}
function updateSaveLabel() {
  const node=document.querySelector('#save-label');
  if(node) { node.textContent=storageError?'保存できません':'この端末に自動保存'; node.parentElement.classList.toggle('warning',storageError); }
}
function safeSetup(raw) {
  const setup=defaultSetup();
  if(!raw || typeof raw!=='object') return setup;
  if(Number.isInteger(raw.count)&&raw.count>=2&&raw.count<=10) setup.count=raw.count;
  if(Array.isArray(raw.names)) setup.names=setup.names.map((name,i)=>typeof raw.names[i]==='string'?raw.names[i].slice(0,20):name);
  for(const key of ['initialPoints','stake','turns']) if(Number.isSafeInteger(raw[key])) setup[key]=raw[key];
  return setup;
}
try {
  const raw=localStorage.getItem(KEY);
  if(raw) { const data=validateBackup(JSON.parse(raw)); state={game:data.activeGame,archives:data.archives,setup:safeSetup(data.setup),view:'game'}; }
} catch { storageError=true; }

function toast(message) {
  const node=document.querySelector('#toast'); node.textContent=message; node.classList.add('visible');
  clearTimeout(toast.timeout); toast.timeout=setTimeout(()=>node.classList.remove('visible'),5500);
}
function confirmAction(title, description, label, action) {
  const dialog=document.querySelector('#confirm-dialog');
  document.querySelector('#dialog-title').textContent=title;
  document.querySelector('#dialog-description').textContent=description;
  document.querySelector('#dialog-confirm').textContent=label;
  dialog.returnValue='';
  dialog.onclose=()=>{ if(dialog.returnValue==='confirm') action(); };
  dialog.showModal();
}
function focusMain() { requestAnimationFrame(()=>{const heading=document.querySelector('main h1');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}window.scrollTo({top:0,behavior:'instant'});}); }
function download(contents, name, type) {
  const url=URL.createObjectURL(new Blob([contents],{type}));
  const link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function backup() { download(JSON.stringify(pack(),null,2),`keisu-backup-${new Date().toISOString().slice(0,10)}.json`,'application/json');toast('バックアップを書き出しました。ファイルを保存してください。'); }

function header() {
  return `<header class="site-header"><div class="header-inner"><button class="brand" data-action="home" aria-label="競数 ホーム"><span class="brand-icon">${icon('flag')}</span><span>競数<small>KEISU SCOREBOOK</small></span></button><div class="header-right"><span class="autosave"><i></i><span id="save-label">この端末に自動保存</span></span><details class="tools-menu"><summary aria-label="データ管理メニュー">${icon('dots')}</summary><div class="menu-content"><button data-action="export">${icon('down')}JSONバックアップ</button><button data-action="import">${icon('up')}JSONから復元</button>${state.game?`<button data-action="csv">${icon('book')}履歴をCSV出力</button><button data-action="new">${icon('plus')}新しい対戦</button>`:''}</div></details></div></div></header>`;
}
function nav() {
  if(!state.game) return '';
  return `<nav class="view-tabs" aria-label="対戦の表示">${[['game','flag','ゲーム'],['ranking','crown','順位'],['history','book','履歴']].map(([view,i,label])=>`<button data-action="tab" data-view="${view}" class="${state.view===view?'active':''}" ${state.view===view?'aria-current="page"':''}>${icon(i)}${label}${view==='history'?`<span>${state.game.rounds.length}</span>`:''}</button>`).join('')}</nav>`;
}
function oddsTable(odds=ODDS, pool=false) {
  return `<div class="odds-grid ${pool?'odds-pool':''}" aria-label="${pool?'抽選する9つの倍率':'今回の基本オッズ'}">${odds.map((value,index)=>`<div class="odds-item ${value>=12?'high':''}"><b>${pool?`${value}<small>倍</small>`:index+1}</b>${pool?'':`<span>${value}<small>倍</small></span>`}</div>`).join('')}</div>`;
}
function marketPanel(round=null) {
  const g=state.game;
  if(g.rulesVersion!==2)return '';
  const entries=market(g,round);
  return `<section class="card market-panel" aria-label="数字ごとの人気とオッズ"><div class="section-title"><h2>${round?'確定したオッズ':'今回のオッズと人気'}</h2><span class="pill">${round?'このラウンドの記録':'予想人数で変動'}</span></div><div class="market-grid">${entries.map(m=>`<div class="market-item ${m.people>1?'popular':''}"><b>${m.number}</b><em class="horse-name">${esc((round??g.draft)?.names?.[m.number-1]??'')}</em><span class="market-base">基本 ${m.base}倍</span><strong>${fmtOdds(m.adjusted)}<small>倍</small></strong><span class="market-people">${m.people}<small>人予想</small></span></div>`).join('')}</div><p class="subnote">表示倍率は基本オッズ ÷ 予想人数（0人は1人扱い）の目安です。受取額はさらに自分の予想数で割り、最後に端数を切り捨てます。${round?'':'全員の予想確定後に配当が決まります。'}</p></section>`;
}
function archiveList() {
  if(!state.archives.length) return '';
  return `<section class="card archive-section"><div class="section-title"><h2>${icon('book')}保存した対戦</h2><span class="muted">${state.archives.length}件</span></div><div class="archive-list">${[...state.archives].reverse().map(g=>`<div class="archive-row"><div><b>${esc(g.players.map(p=>p.name).join('・'))}</b><span>${date(g.createdAt)} · ${g.players.length}人 · ${g.rounds.length}/${totalRounds(g)}ラウンド ${g.completedAt?'· 終了':''}</span></div><button class="button secondary small" data-action="open-archive" data-id="${esc(g.id)}">${g.completedAt?'結果を見る':'再開'}</button></div>`).join('')}</div></section>`;
}
function setupPage() {
  const f=state.setup;
  return `<main id="main" class="container"><div class="page-intro"><div><a class="button primary room-entry" href="https://keisu-rooms-yusuke.yutan226.chatgpt.site/">合言葉でオンライン対戦</a><span class="eyebrow">THE NEXT NUMBER IS YOUR CALL.</span><h1>その予想が、<br class="mobile-only">勝負を変える。</h1><p>読み合いは自由に。計算と記録は、この一台で。</p></div><span class="intro-mark" aria-hidden="true">1<span>—</span>9</span></div><div class="setup-layout"><section class="card setup-card"><div class="section-title"><h2>${icon('people')}新しい対戦</h2><span class="pill">2〜10人対応</span></div><div class="participant-control"><div><label>参加人数</label><p class="muted">対戦開始時に順番をランダムに決めます。</p></div><div class="stepper"><button data-action="count" data-delta="-1" aria-label="参加者を1人減らす" ${f.count<=2?'disabled':''}>−</button><output aria-live="polite">${f.count}<small>人</small></output><button data-action="count" data-delta="1" aria-label="参加者を1人増やす" ${f.count>=10?'disabled':''}>＋</button></div></div><div class="name-grid">${Array.from({length:f.count},(_,i)=>`<label class="name-field"><span class="seat-number">${String(i+1).padStart(2,'0')}</span><span class="sr-only">参加者${i+1}の名前</span><input data-name-index="${i}" maxlength="20" autocomplete="off" value="${esc(f.names[i])}" aria-label="参加者${i+1}の名前" placeholder="名前を入力"></label>`).join('')}</div><div class="divider"></div><div class="settings-grid"><label>初期ポイント<div class="input-with-unit"><input type="number" id="initial-points" min="1" max="100000" step="1" inputmode="numeric" value="${f.initialPoints}"><span>点</span></div></label><label>標準BET<div class="input-with-unit"><input type="number" id="stake" min="1" max="1000" step="1" inputmode="numeric" value="${f.stake}"><span>点</span></div></label><label>1人あたりの親の回数<select id="turns">${Array.from({length:20},(_,i)=>`<option value="${i+1}" ${f.turns===i+1?'selected':''}>${i+1}回ずつ</option>`).join('')}</select></label></div><div class="session-summary"><div><span>予定ラウンド</span><strong id="setup-rounds">${f.count*f.turns}<small>回</small></strong></div><p id="setup-summary">全員が親を${f.turns}回ずつ。質問時間の合計は最大${f.count*f.turns}分です。</p></div><p class="form-error" id="setup-error" role="alert"></p><button class="button primary wide start-button" data-action="start">このメンバーで始める${icon('arrow')}</button><p class="subnote">記録係の端末1台で、全員の予想を入力して使います。</p></section><aside class="setup-aside"><section class="rules-card"><span class="eyebrow">HOW TO PLAY</span><h2>数字を読む。<br>相手を読む。</h2><ol class="rule-steps"><li><span>01</span><p>オッズを<b>毎回ランダム抽選</b>。親は秘密の数字を選ぶ。</p></li><li><span>02</span><p><b>1分間</b>、子は自由に質問。親は嘘をついてもOK。</p></li><li><span>03</span><p><b>予想数・予想人数</b>が多いほど、配当は下がる。</p></li></ol><div class="formula"><span>的中時の受取額</span><strong>BET × 基本オッズ<br>÷ 自分の予想数 ÷ その数字の予想人数</strong><small>小数点以下は最後に切り捨て／外れは0点</small></div></section><section class="card odds-card"><div class="section-title"><h2>毎ラウンドの抽選オッズ</h2><span class="muted">9つの倍率を、1〜9にランダムに割り当て</span></div>${oddsTable(ODDS,true)}<p class="subnote">例：基本20倍の数字を3人が予想し、自分が2個選んだ場合、10点 × 20 ÷ 2 ÷ 3 ＝ 33点を受け取ります。的中しても受取額がBETを下回ることがあります。</p></section></aside></div><div class="fairness-note">${icon('people')}<p><b>最後まで、全員に同じチャンスを。</b>親は子全員のBETを受け取り、的中した子に配当を支払います。残高がマイナスでも続行し、全員が設定回数の親を終えた時点で順位を決めます。</p></div>${archiveList()}<div class="data-footer"><button class="text-button" data-action="import">${icon('up')}バックアップから復元</button><span>データはこのブラウザに保存されます。端末を移すときはJSONをご利用ください。</span></div></main>`;
}
function roundContext() {
  const g=state.game;
  const index=g.draft?g.rounds.length:Math.max(0,g.rounds.length-1);
  return {index,parent:parentAt(g,index),turn:Math.floor(index/g.players.length)+1};
}
function scoreStrip() {
  const g=state.game,points=balances(g),{parent}=roundContext();
  return `<section class="score-strip" aria-label="現在のポイント">${g.players.map(p=>`<div class="mini-score ${p.id===parent.id?'is-parent':''}"><div>${avatar(p)}<span class="mini-name">${esc(p.name)}</span>${p.id===parent.id?'<small class="parent-tag">親</small>':''}</div><b class="${points[p.id]<0?'negative':''}">${money(points[p.id])}<small>pt</small></b></div>`).join('')}</section>`;
}
function roundHeading() {
  const g=state.game,{index,parent,turn}=roundContext();
  return `<div class="game-heading"><div><span class="eyebrow">${g.completedAt?'GAME COMPLETE':'GAME IN PROGRESS'}</span><h1>${g.completedAt?'対戦終了':`ラウンド ${String(index+1).padStart(2,'0')}`}<small>${g.completedAt?`全${totalRounds(g)}回`:` / ${totalRounds(g)}`}</small></h1><p>${g.players.length}人 · 初期${money(g.settings.initialPoints)}点 · BET${money(g.settings.stake)}点</p></div><div class="round-parent">${avatar(parent)}<div><small>今回の親 · ${turn}/${g.settings.turns}回目</small><b>${esc(parent.name)}</b></div></div></div><div class="progress-track" role="progressbar" aria-label="精算済みラウンド" aria-valuemin="0" aria-valuemax="${totalRounds(g)}" aria-valuenow="${g.rounds.length}"><span style="width:${100*g.rounds.length/totalRounds(g)}%"></span></div>`;
}
function stageSteps(stage) {
  return `<ol class="stage-steps">${[['secret','親の数字'],['betting','質問と予想'],['result','公開と精算']].map(([key,label],i)=>`<li class="${stage===key?'current':(stage==='result'||stage==='betting'&&i===0)?'done':''}"><span>${i+1}</span>${label}</li>`).join('')}</ol>`;
}
function secretPage() {
  const d=state.game.draft,{parent}=roundContext(),odds=roundOdds(state.game);
  return `${stageSteps('secret')}<section class="card secret-card"><span class="secret-symbol">${icon('lock')}</span><span class="eyebrow">PARENT'S CHOICE</span><h2>${esc(parent.name)}さん、<br>秘密の数字を選んでください。</h2><p class="muted">今回の基本オッズは抽選済みです。親だけが数字を選び、確定したら画面をみんなに戻します。</p><div class="secret-grid">${odds.map((odds,i)=>`<button class="secret-number ${d.secret===i+1?'selected':''}" data-action="secret" data-number="${i+1}" aria-label="秘密の数字 ${i+1} 基本${odds}倍" aria-pressed="${d.secret===i+1}"><b>${i+1}</b><em class="horse-name">${esc(d.names?.[i]??'')}</em><span>${odds}倍</span></button>`).join('')}</div><button class="button primary secret-lock" data-action="lock-secret" ${d.secret===null?'disabled':''}>${icon('lock')}この数字で確定・画面を隠す</button><p class="subnote">確定後、正解の数字は精算まで表示されません。</p></section>`;
}
function remaining() {
  const timer=state.game?.draft?.timer;
  if(!timer) return 60000;
  return timer.status==='running'?Math.max(0,Math.min(60000,timer.endsAt-Date.now())):timer.remainingMs;
}
function timerCard() {
  const t=state.game.draft.timer;
  return `<aside class="timer-column"><section class="card timer-card"><span class="eyebrow">QUESTION TIME</span><h2>${icon('clock')}質問タイマー</h2><div class="timer-ring" id="timer-ring"><div><span id="timer-display" role="timer" aria-label="残り時間">01:00</span><small id="timer-status">準備ができたら開始</small></div></div><button class="button primary wide" data-action="timer-toggle" id="timer-toggle">${t.status==='running'?'一時停止':t.status==='paused'?'再開':t.status==='finished'?'もう一度1分計る':'1分タイマーを開始'}</button><button class="text-button timer-reset" data-action="timer-reset">タイマーをリセット</button><p class="subnote">時間終了後も予想の記録はできます。全員の予想を確定してから精算してください。</p></section><details class="card compact-odds"><summary>配当の計算方法</summary><p class="subnote formula-help">BET × 抽選した基本オッズ ÷ 自分の予想数 ÷ 的中数字の予想人数。<br>例：10点 × 20倍 ÷ 2個 ÷ 3人 ＝ 33点。<br>小数点以下は最後に切り捨てます。</p></details></aside>`;
}
function bettingCard(player, points) {
  const g=state.game,bet=g.draft.bets[player.id],count=bet.numbers.length,odds=roundOdds(g),entries=market(g);
  const stake=bet.stake ?? g.settings.stake;
  const amounts=bet.numbers.map(n=>payout(stake,n,count,odds,g.rulesVersion===2?Math.max(1,entries[n-1].people):1));
  const range=count?(Math.min(...amounts)===Math.max(...amounts)?`${money(amounts[0])}点`:`${money(Math.min(...amounts))}〜${money(Math.max(...amounts))}点`):'—';
  return `<section class="card bet-card ${player.id===selectedBettor?'mobile-current':''} ${bet.locked?'locked':''}" aria-label="${esc(player.name)}さんの予想"><div class="bet-header"><div class="player-identity">${avatar(player)}<div><h3>${esc(player.name)}</h3><span class="muted">現在 ${money(points[player.id])}点</span></div></div><span class="${bet.locked?'locked-badge':'muted'}">${bet.locked?`${icon('check')}確定済み`:`BET ${stake}点`}</span></div><div class="bet-numbers">${odds.map((base,i)=>`<button class="bet-number ${bet.numbers.includes(i+1)?'selected':''}" data-action="bet-number" data-player="${player.id}" data-number="${i+1}" aria-label="${esc(player.name)}さん ${i+1} 基本${base}倍" aria-pressed="${bet.numbers.includes(i+1)}" ${bet.locked?'disabled':''}><b>${i+1}</b><em class="horse-name">${esc(g.draft.names?.[i]??'')}</em><small>${fmtOdds(entries[i].adjusted)}倍</small></button>`).join('')}</div><label class="stake-input">BET <input type="number" inputmode="numeric" min="1" max="1000" step="1" data-individual-stake="${player.id}" value="${stake}" ${bet.locked?'disabled':''}> 点</label><div class="bet-footer"><p><b>${count}<small>個選択</small></b><span>的中時の受取 <strong>${range}</strong></span></p><button class="button ${bet.locked?'secondary':'primary'} small" data-action="${bet.locked?'unlock-bet':'lock-bet'}" data-player="${player.id}" ${!count?'disabled':''}>${bet.locked?'修正する':'予想を確定'}</button></div></section>`;
}
let selectedBettor = null;
let expandedMarket = false;

function mobilePlayerPicker(children, selected, bets) {
  const choices = children.map(player => {
    const status = bets[player.id].locked ? '確定済み' : '未確定';
    const selectedAttribute = player.id === selected ? ' selected' : '';
    return `<option value="${player.id}"${selectedAttribute}>${esc(player.name)}（${status}）</option>`;
  });
  return `<label class="mobile-picker">予想を入力する人<select id="bettor-picker">${choices.join('')}</select></label>`;
}

function bettingPage() {
  const g=state.game,parent=parentAt(g),children=g.players.filter(p=>p.id!==parent.id),points=balances(g);
  const locked=children.filter(p=>g.draft.bets[p.id].locked).length;
  if (!children.some(player => player.id === selectedBettor)) {
    selectedBettor = (children.find(player => !g.draft.bets[player.id].locked) ?? children[0]).id;
  }
  const picker = mobilePlayerPicker(children, selectedBettor, g.draft.bets);
  const marketToggle = g.rulesVersion === 2
    ? `<button class="mobile-market-toggle button secondary" data-action="toggle-market" aria-expanded="${expandedMarket}" aria-controls="round-market">数字別のオッズと予想人数を${expandedMarket ? '閉じる' : '見る'}</button>`
    : '';

  return `${stageSteps('betting')}${marketToggle}<div id="round-market" class="${expandedMarket?'expanded':''}">${marketPanel()}</div><div class="betting-layout">${timerCard()}<section class="bets-column"><div class="bets-title"><div><h2>子の予想を記録</h2><p class="muted">数字は複数選べます。ほかの人の予想で配当も変わります。</p></div><span class="pill">${locked} / ${children.length}人 確定</span></div>${picker}${children.map(p=>bettingCard(p,points)).join('')}<div class="settle-panel"><div>${icon('lock')}<p>親の数字は確定済みです。<small>${locked===children.length?'全員の予想がそろいました。答えを公開できます。':'全員の予想を確定すると、答えを公開できます。'}</small></p></div><button class="button primary wide" data-action="settle" ${locked!==children.length?'disabled':''}>答えを公開・精算${icon('arrow')}</button></div></section></div>`;
}
function resultTable(round) {
  const g=state.game,result=calculateRound(g,round),before=balances(g,round.index),after=balances(g,round.index+1);
  return `<div class="table-scroll" tabindex="0" role="region" aria-label="精算の詳細"><table class="result-table"><thead><tr><th>参加者</th><th>予想</th><th>BET</th><th>実効倍率</th><th>受取</th><th>収支</th><th>残高</th></tr></thead><tbody>${g.players.map(p=>{
    const isParent=p.id===round.parentId,outcome=result.outcomes.find(o=>o.playerId===p.id),delta=isParent?result.parentDelta:outcome.delta;
    return `<tr><th><span class="table-player">${avatar(p)}<span>${esc(p.name)}${isParent?'<small class="parent-tag">親</small>':''}</span></span></th><td data-label="予想">${isParent?'<span class="muted">親の精算</span>':`<div class="pick-chips">${outcome.numbers.map(n=>`<span class="pick-chip ${n===round.answer?'hit':''}">${n}</span>`).join('')}</div>`}</td><td data-label="BET">${outcome?money(outcome.stake)+'点':'—'}</td><td data-label="実効倍率">${outcome?.hit?`${fmtOdds(outcome.effectiveOdds)}倍`:'<span class="muted">—</span>'}</td><td data-label="受取">${isParent?'<span class="muted">—</span>':`${money(outcome.received)}<small>点</small>${outcome.hit?'<span class="hit-label">的中</span>':''}`}</td><td data-label="収支"><b class="${delta>0?'positive':delta<0?'negative':'muted'}">${signed(delta)}</b></td><td data-label="残高"><b>${money(after[p.id])}</b><small class="before-points">前 ${money(before[p.id])}点</small></td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function resultPage() {
  const g=state.game,round=g.rounds.at(-1),result=calculateRound(g,round),next=parentAt(g,g.rounds.length),entry=market(g,round)[round.answer-1];
  return `${stageSteps('result')}<section class="reveal-banner"><div><span class="eyebrow">THE WINNING NUMBER</span><h2>親が選んだ数字は</h2><p>基本${entry.base}倍 · ${entry.people}人が的中${g.rulesVersion===2?` · 人気補正後 ${fmtOdds(entry.adjusted)}倍`:""}</p></div><div class="winning-number">${round.answer}<em class="horse-name">${esc(round.names?.[round.answer-1]??'')}</em></div><div class="reveal-payout"><span>配当合計</span><b>${money(result.totalPayout)}<small>点</small></b><small>BETの回収 ${money(result.totalStakes)}点</small></div></section><section class="card settlement-card"><div class="section-title"><h2>ラウンド ${round.index+1} の精算</h2><span class="pill">${icon('check')}記録済み</span></div>${resultTable(round)}</section>${marketPanel(round)}<div class="round-actions"><button class="text-button" data-action="undo">${icon('undo')}直前の精算を取り消す</button><button class="button primary" data-action="${g.completedAt?'final-ranking':'next'}">${g.completedAt?'最終順位を見る':`次の親：${esc(next.name)}`}${icon('arrow')}</button></div>${g.completedAt?'<p class="completion-note">全員が設定した回数の親を担当しました。対戦終了です。</p>':''}`;
}
function gamePage() {
  const g=state.game;
  return `<main id="main" class="container">${roundHeading()}${g.rulesVersion!==2?'<p class="legacy-note">この対戦は以前の固定オッズの記録です。新しい対戦ではランダム・人気オッズになります。</p>':''}${scoreStrip()}${g.draft?(g.draft.stage==='secret'?secretPage():bettingPage()):resultPage()}</main>`;
}
function rankingPage() {
  const g=state.game,rows=standings(g),leaders=rows.filter(p=>p.rank===1),done=!!g.completedAt;
  return `<main id="main" class="container"><div class="page-title"><span class="eyebrow">${done?'FINAL RESULT':'LIVE STANDINGS'}</span><h1>${done?'最終順位':'現在の順位'}</h1><p>${g.rounds.length} / ${totalRounds(g)}ラウンド精算済み · 同点は同順位</p></div>${done?`<section class="winner-banner">${icon('crown')}<span>WINNER</span><h2>${leaders.map(p=>esc(p.name)).join('・')}</h2><p>${money(leaders[0].points)}<small>ポイント</small>${leaders.length>1?' · 同点優勝':''}</p></section>`:''}<section class="card rankings-card">${rows.map(p=>`<div class="ranking-row ${p.rank===1?'first':''}"><span class="rank-number">${String(p.rank).padStart(2,'0')}</span>${avatar(p)}<div class="ranking-name"><b>${esc(p.name)}</b><span>親 ${p.parentRounds}/${g.settings.turns}回 · 子で的中 ${p.hits}/${p.childRounds}回</span></div><div class="ranking-points"><b class="${p.points<0?'negative':''}">${money(p.points)}<small>pt</small></b><span class="${p.delta>0?'positive':p.delta<0?'negative':'muted'}">初期から ${signed(p.delta)}点</span></div></div>`).join('')}</section><div class="ranking-total">全員の合計 <b>${money(rows.reduce((s,p)=>s+p.points,0))}点</b><span>配当は参加者間で移動します。</span></div><div class="round-actions"><button class="button secondary" data-action="csv">${icon('down')}履歴をCSV出力</button><button class="button primary" data-action="${done?'new':'tab'}" data-view="game">${done?'新しい対戦を始める':'ゲームに戻る'}${icon('arrow')}</button></div></main>`;
}
function historyPage() {
  const g=state.game;
  return `<main id="main" class="container"><div class="page-title history-title"><div><span class="eyebrow">ROUND HISTORY</span><h1>対戦の記録</h1><p>予想も、配当も、ラウンドごとに。</p></div><button class="button secondary" data-action="csv">${icon('down')}CSV出力</button></div>${!g.rounds.length?`<section class="card empty-state">${icon('book')}<h2>最初の勝負を、ここに。</h2><p>精算が終わると、予想とポイントの移動が記録されます。</p><button class="button primary" data-action="tab" data-view="game">ゲームに戻る${icon('arrow')}</button></section>`:`<div class="history-list">${[...g.rounds].reverse().map((r,i)=>{
    const result=calculateRound(g,r),parent=g.players.find(p=>p.id===r.parentId);
    return `<details class="card history-round" ${i===0?'open':''}><summary><span class="history-round-number">${String(r.index+1).padStart(2,'0')}</span><div><b>親：${esc(parent.name)}</b><span>${date(r.settledAt)} · ${result.outcomes.filter(o=>o.hit).length}人的中</span></div><span class="history-answer">正解<b>${r.answer}</b></span><span class="history-chevron">⌄</span></summary><div class="history-detail">${resultTable(r)}${marketPanel(r)}</div></details>`;
  }).join('')}</div><div class="history-actions"><button class="text-button" data-action="undo">${icon('undo')}直前の精算を取り消す</button><button class="text-button" data-action="export">${icon('down')}全データをJSON保存</button></div>`}${archiveList()}</main>`;
}
function render() {
  app.innerHTML=header()+nav()+(state.game?(state.view==='ranking'?rankingPage():state.view==='history'?historyPage():gamePage()):setupPage())+`<footer class="site-footer"><span>競数 <small>KEISU SCOREBOOK</small></span><p>読み合いを楽しむ、1〜9の数字ゲーム。</p></footer>`;
  updateSaveLabel();updateTimer();
}
function updateSetupSummary() {
  const f=state.setup,total=f.count*f.turns;
  const n=document.querySelector('#setup-rounds');if(n)n.innerHTML=`${total}<small>回</small>`;
  const summary=document.querySelector('#setup-summary');if(summary)summary.textContent=`全員が親を${f.turns}回ずつ。質問時間の合計は最大${total}分です。`;
}
function beep() {
  try {
    if(!audioContext||audioContext.state!=='running')return;
    const osc=audioContext.createOscillator(),gain=audioContext.createGain();
    osc.frequency.value=880;gain.gain.setValueAtTime(0.09,audioContext.currentTime);gain.gain.exponentialRampToValueAtTime(0.001,audioContext.currentTime+0.35);
    osc.connect(gain);gain.connect(audioContext.destination);osc.start();osc.stop(audioContext.currentTime+0.36);
  } catch { /* タイマーの表示は音声機能に依存しない。 */ }
}
function updateTimer() {
  const d=state.game?.draft;if(!d)return;
  const t=d.timer,ms=remaining(),sec=Math.ceil(ms/1000);
  if(t.status==='running'&&ms<=0) {
    t.status='finished';t.endsAt=null;t.remainingMs=0;
    const key=`${state.game.id}:${state.game.rounds.length}`;
    if(lastBeep!==key){lastBeep=key;beep();toast('1分経ちました。全員の予想を確定して精算してください。');}save();
  }
  const display=document.querySelector('#timer-display'),status=document.querySelector('#timer-status'),ring=document.querySelector('#timer-ring'),toggle=document.querySelector('#timer-toggle');
  if(display) { display.textContent=`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;display.setAttribute('aria-label',`残り${sec}秒`); }
  if(status)status.textContent=t.status==='finished'?'質問時間が終了しました':t.status==='running'?'質問・回答は自由です':t.status==='paused'?'一時停止中':'準備ができたら開始';
  if(ring){ring.style.setProperty('--progress',`${ms/60000*360}deg`);ring.classList.toggle('time-up',ms<=10000);}
  if(toggle)toggle.textContent=t.status==='running'?'一時停止':t.status==='paused'?'再開':t.status==='finished'?'もう一度1分計る':'1分タイマーを開始';
}
setInterval(updateTimer,200);
function archiveCurrent() {
  if(!state.game)return;
  if(state.archives.length>=200)throw new Error('保存した対戦が200件に達しました。JSONを出力して記録を保管してください。');
  state.archives=state.archives.filter(g=>g.id!==state.game.id);
  state.archives.push(structuredClone(state.game));state.game=null;
}
function requestUndo() {
  if(!state.game?.rounds.length)return;
  confirmAction('直前の精算を取り消しますか？','直前のラウンドを精算前に戻します。次のラウンドを入力中の場合、その入力は取り消されます。親の数字と予想を修正して再精算できます。','精算を取り消す',()=>{undo(state.game);state.view='game';save();render();focusMain();toast('精算を取り消しました。親の数字と予想を確認してください。');});
}

app.addEventListener('change', event => {
  if (event.target.matches('[data-individual-stake]')) {
    const field = event.target;
    const amount = field.valueAsNumber;
    const bet = state.game?.draft?.bets[field.dataset.individualStake];
    if (!bet || bet.locked) return;
    if (!Number.isInteger(amount) || amount < 1 || amount > 1000) {
      field.value = bet.stake ?? state.game.settings.stake;
      toast('BETは1〜1000点の整数で入力してください。');
      return;
    }
    bet.stake = amount;
    save();
    const card = field.closest('.bet-card');
    const player = state.game.players.find(p => p.id === field.dataset.individualStake);
    const updated = document.createElement('template');
    updated.innerHTML = bettingCard(player, balances(state.game));
    card.querySelector('.bet-footer p').replaceWith(updated.content.querySelector('.bet-footer p'));
    card.querySelector('.bet-header > span').textContent = 'BET ' + amount + '点';
    return;
  }
  if (event.target.id !== 'bettor-picker') return;
  selectedBettor = event.target.value;
  render();
  document.querySelector('#bettor-picker')?.focus({preventScroll: true});
});

app.addEventListener('input',event=>{
  const target=event.target;
  if(target.matches('[data-name-index]'))state.setup.names[Number(target.dataset.nameIndex)]=target.value;
  else if(target.id==='initial-points')state.setup.initialPoints=Number(target.value);
  else if(target.id==='stake')state.setup.stake=Number(target.value);
  else if(target.id==='turns')state.setup.turns=Number(target.value);
  else return;
  updateSetupSummary();save();
});
app.addEventListener('click',event=>{
  const button=event.target.closest('[data-action]');if(!button||button.disabled)return;
  const action=button.dataset.action,g=state.game;
  try {
    switch(action) {
      case 'home':state.view='game';render();focusMain();break;
      case 'count':state.setup.count=Math.max(2,Math.min(10,state.setup.count+Number(button.dataset.delta)));save();render();break;
      case 'start':{
        try {state.game=createGame(state.setup.names.slice(0,state.setup.count),{initialPoints:state.setup.initialPoints,stake:state.setup.stake,turns:state.setup.turns},undefined,true);}
        catch(error){document.querySelector('#setup-error').textContent=error.message;return;}
        state.view='game';save();render();focusMain();break;
      }
      case 'secret':g.draft.secret=Number(button.dataset.number);save();render();break;
      case 'lock-secret':if(g.draft.secret!==null){selectedBettor=null;expandedMarket=false;g.draft.stage='betting';save();render();focusMain();}break;
      case 'bet-number':{
        const bet=g.draft.bets[button.dataset.player];if(bet.locked)return;
        const n=Number(button.dataset.number);bet.numbers=bet.numbers.includes(n)?bet.numbers.filter(x=>x!==n):[...bet.numbers,n].sort((a,b)=>a-b);
        save();render();break;
      }
      case 'toggle-market':
        expandedMarket = !expandedMarket;
        render();
        break;
      case 'lock-bet': {
        const bet = g.draft.bets[button.dataset.player];
        if (!bet.numbers.length) break;
        bet.locked = true;
        const next = g.players.find(player => g.draft.bets[player.id] && !g.draft.bets[player.id].locked);
        selectedBettor = next?.id ?? button.dataset.player;
        save();
        render();
        if (window.matchMedia('(max-width: 600px)').matches) {
          const target = next ? '#bettor-picker' : '[data-action="settle"]';
          document.querySelector(target)?.focus({preventScroll: true});
          document.querySelector(target)?.scrollIntoView({block: 'nearest'});
        }
        break;
      }
      case 'unlock-bet':g.draft.bets[button.dataset.player].locked=false;save();render();break;
      case 'timer-toggle':{
        const t=g.draft.timer;
        if(t.status==='running'){t.remainingMs=remaining();t.endsAt=null;t.status=t.remainingMs>0?'paused':'finished';}
        else {
          if(t.status==='finished'){t.remainingMs=60000;lastBeep='';}
          t.endsAt=Date.now()+t.remainingMs;t.status='running';
          try {audioContext??=new (window.AudioContext||window.webkitAudioContext)();audioContext.resume().catch(()=>{});}catch{}
        }
        save();updateTimer();break;
      }
      case 'timer-reset':g.draft.timer={remainingMs:60000,endsAt:null,status:'idle'};lastBeep='';save();updateTimer();break;
      case 'settle':settle(g);save();render();focusMain();toast('配当を計算し、全員のポイントを記録しました。');break;
      case 'next':advance(g);save();render();focusMain();break;
      case 'tab':state.view=button.dataset.view;render();focusMain();break;
      case 'final-ranking':state.view='ranking';render();focusMain();break;
      case 'undo':requestUndo();break;
      case 'export':backup();break;
      case 'csv':if(g){download(csv(g),`keisu-history-${g.createdAt.slice(0,10)}.csv`,'text/csv;charset=utf-8');toast('対戦履歴をCSVで書き出しました。');}break;
      case 'import':document.querySelector('.tools-menu')?.removeAttribute('open');document.querySelector('#import-file').click();break;
      case 'new':confirmAction('新しい対戦を始めますか？','現在の対戦は「保存した対戦」に残ります。参加者と設定を変更して、別の対戦を始められます。','新しい対戦を準備',()=>{archiveCurrent();state.view='game';save();render();focusMain();});break;
      case 'open-archive':{
        const id=button.dataset.id;
        const open=()=>{
          const target=state.archives.find(a=>a.id===id);if(!target)return;
          state.archives=state.archives.filter(a=>a.id!==id);archiveCurrent();state.game=target;state.view=target.completedAt?'ranking':'game';save();render();focusMain();
        };
        if(g)confirmAction('保存した対戦を開きますか？','現在の対戦は保存されます。選んだ対戦の続き、または結果を表示します。','対戦を開く',open);else open();
        break;
      }
    }
  } catch(error) { toast(error.message||'操作を完了できませんでした。'); }
});

document.querySelector('#import-file').addEventListener('change',async event=>{
  const file=event.target.files[0];event.target.value='';if(!file)return;
  try {
    if(file.size>20*1024*1024)throw new Error('20MB以下のJSONバックアップを選んでください。');
    pendingImport=validateBackup(JSON.parse(await file.text()));
    confirmAction('バックアップから復元しますか？','このブラウザの現在の対戦・保存した対戦を、選択したファイルの内容に置き換えます。必要な記録は先にJSONで保存してください。','置き換えて復元',()=>{
      const data=pendingImport;if(!data)return;
      state={game:data.activeGame,archives:data.archives,setup:safeSetup(data.setup),view:'game'};pendingImport=null;lastBeep='';save();render();focusMain();toast('対戦記録を復元しました。');
    });
  } catch(error) {toast(`読み込めませんでした：${error.message}`);}
});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)updateTimer();});
render();
if(storageError)toast('保存データを読み込めないか、ブラウザ保存が使えません。必要な記録があればJSONから復元してください。');
