import {NOUNS, LEGACY_NOUNS, drawNames} from './nouns.js';
export const ODDS = Object.freeze([5, 6, 7, 8, 9, 10, 12, 15, 20]);
export const SCHEMA = 1;
export const DEFAULT_SETTINGS = Object.freeze({initialPoints: 300, stake: 10, turns: 2});

export function randomOdds(random = Math.random) {
  const odds = [...ODDS];
  for (let i = odds.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [odds[i], odds[j]] = [odds[j], odds[i]];
  }
  return odds;
}
export function roundOdds(game, round = null) { return round?.odds ?? game.draft?.odds ?? ODDS; }
export function popularity(game, round = null) {
  const bets = round ? round.bets : Object.values(game.draft?.bets ?? {});
  return Array.from({length: 9}, (_, i) => bets.filter(bet => bet.numbers.includes(i + 1)).length);
}
export function market(game, round = null) {
  const odds = roundOdds(game, round), people = popularity(game, round);
  return odds.map((base, i) => ({number: i + 1, base, people: people[i],
    adjusted: base / (game.rulesVersion === 2 ? Math.max(1, people[i]) : 1)}));
}
function validateOdds(odds) {
  if (!Array.isArray(odds) || odds.length !== 9 || new Set(odds).size !== 9 || odds.some(n => !ODDS.includes(n))) fail('抽選オッズの記録が不正です。');
}

const fail = message => { throw new Error(message); };
const integer = (value, min, max, label) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${label}は${min}〜${max}の整数にしてください。`);
  return value;
};
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const stamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

export function validateSettings(settings) {
  if (!record(settings)) fail('対戦設定を読み取れません。');
  integer(settings.initialPoints, 1, 100000, '初期ポイント');
  integer(settings.stake, 1, 1000, 'BET');
  integer(settings.turns, 1, 20, '1人あたりの親の回数');
  const questionMode = settings.questionMode ?? 'timer';
  if (!['timer', 'chat'].includes(questionMode)) fail('質問モードの設定が不正です。');
  const questionsPerPlayer = settings.questionsPerPlayer ?? 3;
  integer(questionsPerPlayer, 1, 20, '質問回数');
  return {...settings, questionMode, questionsPerPlayer};
}

export function stakeLimit(game) {
  return game.splitBetRules ? Math.min(1000, game.settings.stake * 3) : 1000;
}

export function totalRounds(game) { return game.players.length * game.settings.turns; }
export function parentAt(game, index = game.rounds.length) { return game.players[index % game.players.length]; }
export function payout(stake, answer, count, odds = ODDS, people = 1) {
  integer(stake, 1, 1000, 'BET');
  integer(answer, 1, 9, '正解の数字');
  integer(count, 1, 9, '予想数');
  integer(people, 1, 9, '予想人数');
  return Math.floor(stake * odds[answer - 1] / (count * people));
}

export function validNumbers(numbers, allowEmpty = false) {
  if (!Array.isArray(numbers) || numbers.length > 9 || (!allowEmpty && numbers.length === 0)) fail('予想する数字を1〜9個選んでください。');
  if (new Set(numbers).size !== numbers.length || numbers.some(n => !Number.isInteger(n) || n < 1 || n > 9)) fail('予想の数字に重複または範囲外の値があります。');
  return [...numbers].sort((a, b) => a - b);
}

export function createDraft(game) {
  const parent = parentAt(game);
  return {
    stage: 'secret', secret: null, names: drawNames(), odds: game.rulesVersion === 2 ? randomOdds() : [...ODDS],
    bets: Object.fromEntries(game.players.filter(p => p.id !== parent.id).map(p => [p.id, {numbers: [], locked: false}])),
    timer: {remainingMs: 60000, endsAt: null, status: 'idle'}
  };
}

export function createGame(names, settings, id = globalThis.crypto.randomUUID(), randomizeOrder = false) {
  validateSettings(settings);
  if (!Array.isArray(names) || names.length < 2 || names.length > 10) fail('参加者は2〜10人で設定してください。');
  const clean = names.map(name => typeof name === 'string' ? name.trim() : '');
  if (clean.some(name => !name || name.length > 20)) fail('名前は1〜20文字で入力してください。');
  if (new Set(clean).size !== clean.length) fail('参加者の名前は重複しないようにしてください。');
  const game = {schemaVersion: SCHEMA, rulesVersion: 2, splitBetRules: true, id, createdAt: new Date().toISOString(), completedAt: null,
    players: clean.map((name, index) => ({id: `p${index + 1}`, name})), settings: {...settings}, rounds: [], draft: null};
  if (randomizeOrder) {
    for (let i = game.players.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [game.players[i], game.players[j]] = [game.players[j], game.players[i]];
    }
  }
  game.draft = createDraft(game);
  return game;
}

function validateNames(names) {
  if (names === undefined) return;
  if (!Array.isArray(names) || names.length !== 9 || new Set(names).size !== 9 || names.some(n => !NOUNS.includes(n) && !LEGACY_NOUNS.includes(n))) fail('馬名の記録が不正です。');
}
function validateRound(game, round, index) {
  if (!record(round) || round.index !== index || round.parentId !== parentAt(game, index).id || !stamp(round.settledAt)) fail('ラウンドの順番または親の記録が不正です。');
  integer(round.answer, 1, 9, '正解の数字');
  validateNames(round.names);
  if (game.rulesVersion === 2) validateOdds(round.odds);
  if (round.lieBonusTenths !== undefined) integer(round.lieBonusTenths,0,50,'嘘による倍率');
  const children = game.players.filter(p => p.id !== round.parentId);
  if (!Array.isArray(round.bets) || round.bets.length !== children.length) fail('参加者の予想記録が不足しています。');
  const ids = new Set();
  for (const bet of round.bets) {
    if (!record(bet) || !children.some(p => p.id === bet.playerId) || ids.has(bet.playerId)) fail('予想した参加者の記録が不正です。');
    if (bet.stake !== undefined) integer(bet.stake,1,1000,'BET');
    ids.add(bet.playerId); validNumbers(bet.numbers);
  }
}

export function calculateRound(game, round) {
  const odds = roundOdds(game, round);
  const people = game.rulesVersion === 2 ? Math.max(1, popularity(game, round)[round.answer - 1]) : 1;
  const bonusTenths = round.lieBonusTenths ?? 0;
  const winningsAt = (bet,extra) => {
    if (!bet.numbers.includes(round.answer)) return 0;
    const stake=bet.stake ?? game.settings.stake, divisor=bet.numbers.length*people;
    return Math.floor(stake*(odds[round.answer-1]*10+extra*(game.splitBetRules ? people : divisor))/(10*divisor));
  };
  const outcomes = round.bets.map(bet => {
    const stake=bet.stake ?? game.settings.stake, hit=bet.numbers.includes(round.answer);
    const divisor=bet.numbers.length*people,baseOdds=odds[round.answer-1]/divisor,lieBonus=bonusTenths/(10*(game.splitBetRules ? bet.numbers.length : 1));
    const received=winningsAt(bet,bonusTenths);
    return {playerId:bet.playerId,numbers:[...bet.numbers],hit,stake,received,delta:received-stake,
      baseOdds,lieBonus,effectiveOdds:baseOdds+lieBonus,popularity:people};
  });
  const parentDelta=-outcomes.reduce((sum,outcome)=>sum+outcome.delta,0);
  const unknownTransfers=[];
  if(round.unknownTransferVersion===1 && Array.isArray(round.chat)){
    let riskAnswers=0;
    for(const [index,entry] of round.chat.entries()){
      if(entry.isLie!==true && entry.isUnknown!==true)continue;
      const before=Math.min(50,riskAnswers*5),after=Math.min(50,(riskAnswers+1)*5);riskAnswers++;
      if(entry.isUnknown!==true)continue;
      const amount=round.bets.reduce((sum,bet)=>sum+winningsAt(bet,after)-winningsAt(bet,before),0);
      const recipients=game.players.filter(p=>p.id!==round.parentId&&p.id!==entry.playerId);
      const rotated=recipients.length?recipients.slice((round.index+index)%recipients.length).concat(recipients.slice(0,(round.index+index)%recipients.length)):[];
      const shares=rotated.map((p,i)=>({playerId:p.id,points:Math.floor(amount/rotated.length)+(i<amount%rotated.length?1:0)}));
      const payer=outcomes.find(o=>o.playerId===entry.playerId);if(payer)payer.delta-=amount;
      for(const share of shares){const recipient=outcomes.find(o=>o.playerId===share.playerId);if(recipient)recipient.delta+=share.points;}
      unknownTransfers.push({playerId:entry.playerId,amount,shares});
    }
  }
  return {outcomes,parentDelta,unknownTransfers,
    totalPayout:outcomes.reduce((sum,outcome)=>sum+outcome.received,0),
    totalStakes:outcomes.reduce((sum,o)=>sum+o.stake,0)};
}

export function balances(game, through = game.rounds.length) {
  const result = Object.fromEntries(game.players.map(p => [p.id, game.settings.initialPoints]));
  for (const round of game.rounds.slice(0, through)) {
    const calculated = calculateRound(game, round);
    result[round.parentId] += calculated.parentDelta;
    for (const outcome of calculated.outcomes) result[outcome.playerId] += outcome.delta;
  }
  return result;
}

export function standings(game, results = game.rounds.map(round => calculateRound(game, round))) {
  const points = Object.fromEntries(game.players.map(p => [p.id, game.settings.initialPoints]));
  for (const [i, result] of results.entries()) {
    points[game.rounds[i].parentId] += result.parentDelta;
    for (const outcome of result.outcomes) points[outcome.playerId] += outcome.delta;
  }
  return game.players.map((p, order) => {
    const childResults = results.flatMap(r => r.outcomes.filter(o => o.playerId === p.id));
    return {...p, order, points: points[p.id], delta: points[p.id] - game.settings.initialPoints,
      hits: childResults.filter(o => o.hit).length, childRounds: childResults.length,
      parentRounds: game.rounds.filter(r => r.parentId === p.id).length};
  }).sort((a, b) => b.points - a.points || a.order - b.order)
    .map((p, index, rows) => ({...p, rank: 1 + rows.filter(other => other.points > p.points).length}));
}

export function settle(game) {
  const d = game.draft;
  if (!d || d.stage !== 'betting' || game.rounds.length >= totalRounds(game)) fail('精算できるラウンドがありません。');
  integer(d.secret, 1, 9, '親の数字');
  const children = game.players.filter(p => p.id !== parentAt(game).id);
  const bets = children.map(p => {
    if (!d.bets[p.id]?.locked) fail('全員の予想を確定してください。');
    return {playerId: p.id, stake: integer(d.bets[p.id].stake ?? game.settings.stake, 1, 1000, 'BET'), numbers: validNumbers(d.bets[p.id].numbers)};
  });
  const round = {index: game.rounds.length, parentId: parentAt(game).id, answer: d.secret, names: d.names, odds: [...(d.odds ?? ODDS)], bets, settledAt: new Date().toISOString()};
  validateRound(game, round, round.index);
  game.rounds.push(round); game.draft = null;
  game.completedAt = game.rounds.length === totalRounds(game) ? new Date().toISOString() : null;
  return round;
}

export function advance(game) {
  if (game.draft || !game.rounds.length || game.rounds.length >= totalRounds(game)) fail('次のラウンドへ進めません。');
  game.draft = createDraft(game);
}

export function undo(game) {
  if (!game.rounds.length) fail('取り消せる精算がありません。');
  const round = game.rounds.pop(); game.completedAt = null; game.draft = createDraft(game);
  game.draft.secret = round.answer;
  game.draft.names = round.names;
  game.draft.odds = [...(round.odds ?? ODDS)];
  game.draft.bets = Object.fromEntries(round.bets.map(b => [b.playerId, {numbers: [...b.numbers], stake: b.stake ?? game.settings.stake, locked: true}]));
  game.draft.timer = {remainingMs: 0, endsAt: null, status: 'finished'};
}

export function validateGame(game) {
  if (!record(game) || game.schemaVersion !== SCHEMA || typeof game.id !== 'string' || game.id.length > 100 || !stamp(game.createdAt)) fail('数読みダービーの対戦データではありません。');
  if (game.rulesVersion !== undefined && game.rulesVersion !== 2) fail('対応していない配当ルールです。');
  validateSettings(game.settings);
  if (!Array.isArray(game.players) || game.players.length < 2 || game.players.length > 10) fail('参加人数が不正です。');
  const ids = new Set(), names = new Set();
  for (const player of game.players) {
    if (!record(player) || typeof player.id !== 'string' || !/^p(?:[1-9]|10)$/.test(player.id) || ids.has(player.id) || typeof player.name !== 'string' || !player.name.trim() || player.name.length > 20 || names.has(player.name)) fail('参加者のデータが不正です。');
    ids.add(player.id); names.add(player.name);
  }
  if (!Array.isArray(game.rounds) || game.rounds.length > totalRounds(game)) fail('ラウンド数が不正です。');
  game.rounds.forEach((round, index) => validateRound(game, round, index));
  const finished = game.rounds.length === totalRounds(game);
  if (finished && (!stamp(game.completedAt) || game.draft !== null)) fail('終了した対戦の記録が不正です。');
  if (!finished && game.completedAt !== null) fail('対戦の終了状態が不正です。');
  if (!game.draft && !game.rounds.length) fail('進行中のラウンドがありません。');
  if (game.draft) {
    const d = game.draft;
    if (finished || !record(d) || !['secret', 'betting'].includes(d.stage)) fail('進行状態が不正です。');
    if (d.secret !== null) integer(d.secret, 1, 9, '親の数字');
    validateNames(d.names);
    if (game.rulesVersion === 2) validateOdds(d.odds);
    if (d.stage === 'betting' && d.secret === null) fail('親の数字が未設定です。');
    const children = game.players.filter(p => p.id !== parentAt(game).id);
    if (!record(d.bets) || Object.keys(d.bets).length !== children.length) fail('予想の入力状態が不正です。');
    for (const p of children) {
      const b = d.bets[p.id];
      if (!record(b) || typeof b.locked !== 'boolean') fail('予想の入力状態が不正です。');
      if (b.stake !== undefined) integer(b.stake,1,1000,'BET');
      validNumbers(b.numbers, !b.locked);
    }
    const timer = d.timer;
    if (!record(timer) || !['idle', 'running', 'paused', 'finished'].includes(timer.status) || !Number.isFinite(timer.remainingMs) || timer.remainingMs < 0 || timer.remainingMs > 60000 || (timer.status === 'running' ? !Number.isFinite(timer.endsAt) || timer.endsAt <= 0 : timer.endsAt !== null)) fail('タイマーの記録が不正です。');
  }
  return game;
}

export function validateBackup(data) {
  if (!record(data) || data.app !== 'keisu' || data.version !== SCHEMA || !Array.isArray(data.archives) || data.archives.length > 200) fail('対応している数読みダービーのバックアップを選んでください。');
  if (data.activeGame !== null) validateGame(data.activeGame);
  const ids = new Set(data.activeGame ? [data.activeGame.id] : []);
  for (const g of data.archives) { validateGame(g); if (ids.has(g.id)) fail('対戦の記録が重複しています。'); ids.add(g.id); }
  return data;
}

export function csv(game) {
  const rows = [['ラウンド', '親', '正解', '正解の馬名', '正解の基本オッズ', '正解の予想人数', '人気補正後倍率', '参加者', '役割', '予想', '実効倍率', 'BET', '受取額', '収支', '精算前ポイント', '精算後ポイント', '精算日時']];
  const points = Object.fromEntries(game.players.map(p => [p.id, game.settings.initialPoints]));
  for (const round of game.rounds) {
    const result = calculateRound(game, round), parent = game.players.find(p => p.id === round.parentId);
    for (const player of game.players) {
      const outcome = result.outcomes.find(o => o.playerId === player.id);
      const delta = player.id === parent.id ? result.parentDelta : outcome.delta;
      const m = market(game, round)[round.answer - 1];
      rows.push([round.index + 1, parent.name, round.answer, round.names?.[round.answer-1] ?? '', m.base, m.people, m.adjusted, player.name, player.id === parent.id ? '親' : '子',
        outcome?.numbers.join('・') ?? '', outcome?.effectiveOdds ?? '', outcome ? outcome.stake : '', outcome?.received ?? '', delta,
        points[player.id], points[player.id] + delta, round.settledAt]);
      points[player.id] += delta;
    }
  }
  const cell = value => {
    let text = String(value);
    if (typeof value === 'string' && /^[\s]*[=+@\-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return '\ufeff' + rows.map(row => row.map(cell).join(',')).join('\r\n');
}
