import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {localDb} from '../scripts/local-db.mjs';
import {handle} from '../server/index.mjs';
import {getRecord,putRecord} from '../server/core.mjs';
const source=readFileSync(new URL('../src/cloud.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function settle(){for(let i=0;i<8;i++)await tick();}
function client(db,local=new Map()) {
  const storage={getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,v)};
  const timeouts=new Map();let seq=0;
  const context={crypto,console,localStorage:storage,sessionStorage:{getItem:()=>null,setItem(){}},navigator:{onLine:true},window:{},document:{visibilityState:'visible',getElementById:()=>null},addEventListener(){},setInterval(){},setTimeout(cb){timeouts.set(++seq,cb);return seq;},clearTimeout(id){timeouts.delete(id);},fetch:async(path,opts)=>handle(new Request('https://tsugi.test'+path,opts),{DB:db},{})};
  vm.runInNewContext(source,context);
  return {cloud:context.window.TsugiCloud,context,local,async flush(){for(const [id,cb] of timeouts){timeouts.delete(id);cb();}await settle();}};
}
test('isolated browser clients sync GPT plans, edits, timer pause and offline changes',async()=>{
  const db=localDb();try{
    const a=client(db),b=client(db),seenA={},seenB={};
    a.cloud.watch(['day:2026-11-10','timer:app'],(k,v)=>seenA[k]=v);b.cloud.watch(['day:2026-11-10','timer:app'],(k,v)=>seenB[k]=v);await settle();
    a.cloud.set('day:2026-11-10',{text:'朝\n水 00:30'});await a.flush();await b.cloud.sync();assert.equal(seenB['day:2026-11-10'].text,'朝\n水 00:30');
    const run={id:'timer-test',date:'2026-11-10',steps:[{name:'水',sec:30}],i:0,endAt:null,left:15000};
    a.cloud.set('timer:app',run);await a.flush();await b.cloud.sync();assert.equal(seenB['timer:app'].left,15000);assert.equal(seenB['timer:app'].endAt,null);
    b.context.navigator.onLine=false;b.cloud.set('day:2026-11-10',{text:'夜\n歯磨き 03:00'});await b.flush();assert.equal((await getRecord(db,'day:2026-11-10')).value.text,'朝\n水 00:30');
    b.context.navigator.onLine=true;await b.cloud.sync();await a.cloud.sync();assert.equal(seenA['day:2026-11-10'].text,'夜\n歯磨き 03:00');
  }finally{db.close();}
});
test('offline conflicting edit remains durable and does not overwrite GPT update',async()=>{
  const db=localDb();try{
    await putRecord(db,'day:2026-11-10',{text:'朝\n水 00:30'},0);
    const a=client(db);a.cloud.watch(['day:2026-11-10'],()=>{});await settle();
    a.context.navigator.onLine=false;a.cloud.set('day:2026-11-10',{text:'端末の変更\n水 01:00'});
    await putRecord(db,'day:2026-11-10',{text:'GPTの変更\n水 02:00'},1);
    a.context.navigator.onLine=true;await a.cloud.sync();
    assert.equal((await getRecord(db,'day:2026-11-10')).value.text,'GPTの変更\n水 02:00');
    assert.match([...a.local.values()].join(''),/端末の変更/);
  }finally{db.close();}
});
