export class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
const assert = (ok, message) => { if (!ok) throw new HttpError(400, message); };
export const today = () => new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10); // Asia/Tokyo, day begins at 04:00.
export function dateKey(date) {
  assert(typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date, '日付は YYYY-MM-DD で指定してください');
  return date;
}
export function recordKey(key) {
  assert(typeof key === 'string' && /^(library|timer:(app|map)|(day|status):\d{4}-\d{2}-\d{2}|result:[a-zA-Z0-9-]{1,80})$/.test(key), '不明なデータの種類です');
  if (key.startsWith('day:') || key.startsWith('status:')) dateKey(key.split(':')[1]);
  return key;
}
export async function getRecord(db, key) {
  recordKey(key);
  const row = await db.prepare('SELECT key, value, revision, updated_at FROM records WHERE key = ?').bind(key).first();
  return row ? { key, value: JSON.parse(row.value), revision: row.revision, updatedAt: row.updated_at } : { key, value: null, revision: 0, updatedAt: null };
}
export async function putRecord(db, key, value, revision) {
  recordKey(key); validateValue(key, value);
  assert(Number.isSafeInteger(revision) && revision >= 0, '読み取った revision が必要です');
  // A second device observing the same timer ending must not downgrade a confirmed result.
  if (key.startsWith('result:')) {
    const previous = await getRecord(db, key);
    if (previous.value) {
      if (previous.value.state === 'done' || previous.value.state === value.state) return previous;
      if (previous.value.state === 'timer_finished' && value.state === 'done') revision = previous.revision;
    }
  }
  const updatedAt = new Date().toISOString();
  const raw = JSON.stringify(value);
  assert(raw.length <= 150000, 'データが大きすぎます');
  const q = revision === 0
    ? db.prepare('INSERT INTO records (key,value,revision,updated_at) VALUES (?,?,1,?) ON CONFLICT(key) DO NOTHING').bind(key, raw, updatedAt)
    : db.prepare('UPDATE records SET value = ?, revision = revision + 1, updated_at = ? WHERE key = ? AND revision = ?').bind(raw, updatedAt, key, revision);
  const result = await q.run();
  if (!result.meta.changes) throw new HttpError(409, '別の端末またはGPTが更新しました。最新の内容を確認してください', await getRecord(db, key));
  // Return the value of this successful write, never a later concurrent writer's value.
  return { key, value, revision: revision + 1, updatedAt };
}
export function parsePlan(text) {
  assert(typeof text === 'string' && text.length <= 50000, '予定は50,000文字以内で入力してください');
  const blocks = []; let current;
  const normalized = text.replace(/\r/g, '').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/：/g, ':');
  for (const [i, raw] of normalized.split('\n').entries()) {
    const line = raw.trim(); if (line.startsWith('```')) continue;
    if (!line) { current = null; continue; }
    if (!current) {
      const title = line.replace(/^#+\s*/, '');
      const m = title.match(/^(\d{1,2}):(\d{2})(?:\s*[-~〜ー–−]\s*(\d{1,2}):(\d{2}))?[\s　]+(.+)$/);
      if (m) {
        assert(+m[1] <= 29 && +m[2] <= 59 && (!m[3] || (+m[3] <= 29 && +m[4] <= 59)), `${i + 1}行目の時刻を確認してください`);
        if (m[3]) { const minutes = (h,s) => (+h < 4 ? +h + 24 : +h) * 60 + +s; const start=minutes(m[1],m[2]); let end=minutes(m[3],m[4]); if(end<start)end+=1440; assert(end>start && end<1800, `${i + 1}行目の終了時刻を確認してください。一日は朝4時で区切ります`); }
      }
      current = { name: m ? m[5] : title, time: m ? `${m[1]}:${m[2]}` : null, steps: [] }; blocks.push(current);
    } else {
      const tokens = line.replace(/^(?:[-*][\s　]+|[・•][\s　]*|\d+[.)][\s　]+)/, '').split(/[\s　]+/);
      let at = tokens.findIndex((t, n) => n > 0 && /^\d{1,3}:\d{1,2}$/.test(t));
      if (at < 1) at = tokens.findIndex((t, n) => n > 0 && /^(\d{1,3}|(?:(\d{1,3})分)?(?:(\d{1,2})秒)?)$/.test(t));
      assert(at > 0, `${i + 1}行目に mm:ss の時間が必要です`);
      const t = tokens[at], m = t.match(/^(\d{1,3}):(\d{1,2})$/), j = t.match(/^(?:(\d{1,3})分)?(?:(\d{1,2})秒)?$/);
      const sec = m ? +m[1] * 60 + +m[2] : /^\d+$/.test(t) ? +t * 60 : +(j[1] || 0) * 60 + +(j[2] || 0);
      assert(sec > 0 && sec <= 59999 && (!m || +m[2] <= 59), `${i + 1}行目の時間を確認してください`);
      current.steps.push({ name: tokens.slice(0, at).join(' '), sec, note: tokens.slice(at + 1).join(' ') });
    }
  }
  for (const b of blocks) assert(b.time || b.steps.length, `「${b.name}」にタスクがありません`);
  return blocks;
}
function stepsValid(steps) {
  return Array.isArray(steps) && steps.length <= 300 && steps.every(s => s && typeof s.name === 'string' && s.name.length <= 500 && Number.isFinite(s.sec) && s.sec >= 0 && s.sec <= 59999 && (!s.note || typeof s.note === 'string'));
}
export function validateValue(key, value) {
  if (key === 'library') {
    assert(value && Array.isArray(value.routines) && value.routines.length <= 300 && value.routines.every(r => typeof r.id === 'string' && typeof r.name === 'string' && stepsValid(r.steps)), 'ルーティンの形式が正しくありません');
  } else if (key.startsWith('day:')) {
    assert(value && typeof value.text === 'string', '予定の本文が必要です'); parsePlan(value.text);
  } else if (key.startsWith('status:')) {
    assert(value && typeof value.entries === 'object' && value.entries !== null && !Array.isArray(value.entries) && Object.values(value.entries).every(s => s && ['done','skip'].includes(s.state) && (s.state !== 'done' || Number.isFinite(s.start) && Number.isFinite(s.end))), '完了記録の形式が正しくありません');
  } else if (key.startsWith('timer:')) {
    assert(value === null || value && typeof value.id === 'string' && typeof value.date === 'string' && stepsValid(value.steps) && value.steps.length && value.steps.every(s => s.sec > 0) && Number.isInteger(value.i) && value.i >= 0 && value.i < value.steps.length && (value.endAt === null || Number.isFinite(value.endAt)) && Number.isFinite(value.left), 'タイマーの形式が正しくありません');
    if (value) dateKey(value.date);
  } else if (key.startsWith('result:')) {
    assert(value && value.id === key.slice(7) && ['done','timer_finished','stopped'].includes(value.state) && typeof value.name === 'string' && stepsValid(value.steps), '実行結果の形式が正しくありません'); dateKey(value.date);
  }
}
const prop = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
export const tools = [
  { name:'get_day', description:'ツギの指定日の予定を取得する。日付省略時は日本時間の今日（朝4時区切り）。編集前に必ず取得する。', inputSchema:prop({ date:{ type:'string', description:'YYYY-MM-DD' } }), annotations:{ readOnlyHint:true, openWorldHint:false } },
  { name:'write_day', description:'ツギに指定日の予定を保存する。タイトル行＋「タスク名 mm:ss コメント」、空行で複数ブロック。get_dayで取得したrevisionを使う。既存予定を保持して編集する。', inputSchema:prop({date:{type:'string'},text:{type:'string'},revision:{type:'integer',minimum:0}},['date','text','revision']), annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:false} },
  { name:'get_routines', description:'ツギの保存済みルーティンとrevisionを取得する。', inputSchema:prop({}), annotations:{readOnlyHint:true,openWorldHint:false} },
  { name:'add_routines', description:'ツギにテキスト形式のルーティンを追加する。空行で区切る。get_routinesのrevisionを使い既存ルーティンを保持する。', inputSchema:prop({text:{type:'string'},revision:{type:'integer',minimum:0}},['text','revision']), annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false} },
  { name:'get_completion', description:'ツギの実行結果と実行中タイマーを読む。doneは本人が完了ボタンを押した記録。timer_finishedは時間経過のみで本人の完了は未確認。記録なしを未実施と断定しない。', inputSchema:prop({date:{type:'string'}}), annotations:{readOnlyHint:true,openWorldHint:false} }
];
export async function completion(db, date) {
  dateKey(date);
  const rows = await db.prepare("SELECT value,updated_at FROM records WHERE key LIKE 'result:%' AND json_extract(value,'$.date') = ? ORDER BY updated_at DESC LIMIT 200").bind(date).all();
  const results = rows.results.map(r => ({...JSON.parse(r.value),syncedAt:r.updated_at}));
  const timers = await Promise.all(['app','map'].map(k => getRecord(db,'timer:'+k)));
  return {date,results,active:timers.filter(r => r.value && r.value.date === date).map(r => {const t=r.value,remaining=t.endAt==null?t.left:t.endAt-Date.now();return {...t,state:t.endAt==null?'paused':remaining+t.steps.slice(t.i+1).reduce((n,s)=>n+s.sec*1000,0)<=0?'time_elapsed_unconfirmed':'running',syncedAt:r.updatedAt};}),confirmed:results.filter(r => r.state === 'done').length,timerFinishedUnconfirmed:results.filter(r => r.state === 'timer_finished').length,note:'doneは本人による完了確認。timer_finishedはタイマー終了のみ。記録がない場合は未確認です。'};
}
export async function callTool(db, name, args = {}) {
  assert(args && typeof args === 'object' && !Array.isArray(args), '引数はJSONオブジェクトで指定してください');
  if (name === 'get_day') return getRecord(db,'day:'+dateKey(args.date || today()));
  if (name === 'write_day') return putRecord(db,'day:'+dateKey(args.date),{text:args.text},args.revision);
  if (name === 'get_routines') return getRecord(db,'library');
  if (name === 'add_routines') {
    const blocks = parsePlan(args.text); assert(blocks.length && blocks.every(b => b.steps.length), 'ルーティンにはタスクが必要です');
    const current = await getRecord(db,'library');
    if (current.revision !== args.revision) throw new HttpError(409,'ルーティンが更新されています。再取得してください',current);
    return putRecord(db,'library',{routines:[...(current.value?.routines || []),...blocks.map(b => ({id:crypto.randomUUID(),name:b.name,auto:true,steps:b.steps.map(s => ({...s,id:crypto.randomUUID()}))}))]},args.revision);
  }
  if (name === 'get_completion') return completion(db,args.date || today());
  throw new HttpError(404,'不明なツールです');
}
