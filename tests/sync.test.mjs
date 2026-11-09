import test from 'node:test';
import assert from 'node:assert/strict';
import {localDb} from '../scripts/local-db.mjs';
import {getRecord,putRecord,callTool,completion,parsePlan,today} from '../server/core.mjs';
import {handle,openapi} from '../server/index.mjs';
const date='2026-11-10',plan='07:00 朝の支度\n水を飲む 00:30 コップ1杯\n歯を磨く 03:00\n\n09:00-12:00 研究';
test('GPT writes plan; two devices read the same revision; stale edits cannot overwrite',async()=>{
  const db=localDb();
  try {
    const current=await callTool(db,'get_day',{date});assert.equal(current.revision,0);
    const saved=await callTool(db,'write_day',{date,text:plan,revision:0});assert.equal(saved.revision,1);
    const [a,b]=await Promise.all([getRecord(db,'day:'+date),getRecord(db,'day:'+date)]);assert.deepEqual(a,b);
    await putRecord(db,'day:'+date,{text:plan+'\n\n読書\n読む 05:00'},a.revision);
    await assert.rejects(()=>putRecord(db,'day:'+date,{text:plan},b.revision),e=>e.status===409 && e.details.revision===2);
  }finally{db.close();}
});
test('GPT appends routines without dropping existing ones or accepting stale revisions',async()=>{
  const db=localDb();try{
    await callTool(db,'add_routines',{text:'朝\n水 00:30',revision:0});
    await callTool(db,'add_routines',{text:'夜\n歯磨き 03:00',revision:1});
    assert.equal((await callTool(db,'get_routines')).value.routines.length,2);
    await assert.rejects(()=>callTool(db,'add_routines',{text:'作業\n整理 01:00',revision:1}),e=>e.status===409);
  }finally{db.close();}
});
test('timer elapsed, user confirmation, duplicate device completion and stopped runs remain distinct',async()=>{
  const db=localDb(),r={id:'run-test',date,name:'朝',steps:[{name:'水',sec:30}],state:'timer_finished',confirmedAt:null};try{
    await putRecord(db,'result:'+r.id,r,0);
    let result=await completion(db,date);assert.equal(result.confirmed,0);assert.equal(result.timerFinishedUnconfirmed,1);
    await putRecord(db,'result:'+r.id,{...r,state:'done',confirmedAt:new Date().toISOString()},0);
    await putRecord(db,'result:'+r.id,r,0); // stale second device cannot undo user confirmation.
    result=await completion(db,date);assert.equal(result.results.length,1);assert.equal(result.confirmed,1);assert.equal(result.timerFinishedUnconfirmed,0);
    await putRecord(db,'result:stopped',{...r,id:'stopped',state:'stopped'},0);
    assert.equal((await completion(db,date)).confirmed,1);
  }finally{db.close();}
});
test('invalid dates, timer indices, keys, times, and malformed payloads are rejected before writing',async()=>{
  const db=localDb();try{
    for(const text of ['タイトル\n水 00:99','タイトル\n水 00:00','空タイトル'])assert.throws(()=>parsePlan(text));
    await assert.rejects(()=>callTool(db,'get_day',{date:'2026-02-30'}));
    await assert.rejects(()=>putRecord(db,'arbitrary',{},0));
    await assert.rejects(()=>putRecord(db,'timer:map',{id:'x',date,steps:[{name:'x',sec:10}],i:5,endAt:Date.now(),left:0},0));
    assert.equal(parsePlan('朝\n水 ００：３０ コップ1杯')[0].steps[0].sec,30);
  }finally{db.close();}
});
test('MCP discovery and tool invocation, API conflicts and cross-origin protection',async()=>{
  const db=localDb(),env={DB:db};
  const rpc=async(method,params)=>handle(new Request('https://example.test/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),env,{});
  try{
    const discovery=await(await rpc('server/discover')).json();assert.deepEqual(discovery.result.supportedVersions,['2026-07-28']);
    assert.equal((await(await rpc('tools/list')).json()).result.tools.length,5);
    assert.equal((await(await rpc('tools/call',{name:'write_day',arguments:{date,text:plan,revision:0}})).json()).result.isError,false);
    const conflict=await(await rpc('tools/call',{name:'write_day',arguments:{date,text:plan,revision:0}})).json();assert.equal(conflict.result.isError,true);
    const req=new Request('https://example.test/api/records/'+encodeURIComponent('day:'+date),{method:'PUT',headers:{Origin:'https://evil.test'},body:JSON.stringify({value:{text:plan},revision:1})});
    assert.equal((await handle(req,env,{})).status,403);
    assert.equal(Object.keys(openapi('https://example.test').paths).length,5);
  }finally{db.close();}
});
