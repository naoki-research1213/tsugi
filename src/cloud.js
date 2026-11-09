/* Same-origin, revision-checked sync. Secrets never enter the browser bundle. */
(() => {
  let device;try { device=sessionStorage.getItem('tsugi.session') || crypto.randomUUID();sessionStorage.setItem('tsugi.session',device); }catch {device=crypto.randomUUID();}
  const cacheKey='tsugi.cloud.queue.v1';
  let pending={}; try {pending=JSON.parse(localStorage.getItem(cacheKey)||'{}');} catch {}
  const revisions=new Map(), values=new Map(), listeners=new Set(), conflicts=new Map();
  let ready=false,busy=false,timer, watched=[],status='接続しています',blocked=false;
  const clone=v=>JSON.parse(JSON.stringify(v));
  const keep=()=>{try{localStorage.setItem(cacheKey,JSON.stringify(pending));}catch{status='端末に保存できません。画面を閉じずに同期してください';}};
  function paint() {
    const el=document.getElementById('cloud-state'); if(!el) return;
    const quiet=['同期済み','接続しています','保存しています','端末に保存済み・同期待ち','端末に保存済み・オンライン復帰後に同期'];
    // Only problems reach the screen. Routine sync stays out of sight.
    el.hidden=!conflicts.size && quiet.includes(status);
    el.replaceChildren();
    const label=document.createElement('span');label.textContent=conflicts.size?'別の端末で変更されています。選択するまでこの端末の変更を保持します':status;el.append(label);
    if(conflicts.size) for(const [key] of conflicts) {
      const p=document.createElement('p');p.textContent=key;
      for(const [name,local] of [['共有データを使う',false],['この端末の変更を保存',true]]) {
        const b=document.createElement('button');b.textContent=name;b.onclick=()=>resolve(key,local);p.append(b);
      } el.append(p);
    }
  }
  function emit(key,value) { for(const cb of listeners) cb(key,clone(value)); }
  function accept(r) {revisions.set(r.key,r.revision);values.set(r.key,JSON.stringify(r.value));emit(r.key,r.value);}
  async function request(path,options) {
    const r=await fetch(path,{...options,cache:'no-store',headers:{'Content-Type':'application/json',...options?.headers}});
    if(r.redirected || r.status===401 || r.status===403) {blocked=true;throw new Error('ログインを確認して再読み込みしてください');}
    let b;try{b=await r.json();}catch{throw new Error('接続できません。ログインを確認してください');}
    if(!r.ok){const e=new Error(b.error||'同期できません');e.status=r.status;e.latest=b.latest;throw e;}return b;
  }
  async function poll() {
    if(busy||blocked||!navigator.onLine) return;
    busy=true;
    try{
      const keys=[...new Set([...watched,...Object.keys(pending)])];
      const res=await request('/api/records?keys='+keys.map(encodeURIComponent).join(','));
      for(const r of res.records) {
        if(pending[r.key]) {
          if(pending[r.key].revision===null) pending[r.key].revision=0;
          if(pending[r.key].revision!==r.revision && JSON.stringify(pending[r.key].value)!==JSON.stringify(r.value)) conflicts.set(r.key,r);
          else if(JSON.stringify(pending[r.key].value)===JSON.stringify(r.value)) {delete pending[r.key];accept(r);}
          else revisions.set(r.key,r.revision);
        }else if(values.get(r.key)!==JSON.stringify(r.value) || !revisions.has(r.key)) accept(r);
        else revisions.set(r.key,r.revision);
      }
      ready=true;keep();status='同期済み';
    }catch(e){status=e.message;}finally{busy=false;paint();}
    if(ready) await flush();
  }
  async function flush() {
    if(!ready||busy||blocked||!navigator.onLine)return;
    busy=true;
    try {
      for(const key of Object.keys(pending)) {
        if(conflicts.has(key))continue;
        const item=pending[key];
        // Keep this snapshot separate: input may change while the request is in flight.
        const sent=JSON.stringify(item.value),revision=item.revision;
        try {
          const r=await request('/api/records/'+encodeURIComponent(key),{method:'PUT',body:JSON.stringify({value:JSON.parse(sent),revision})});
          revisions.set(key,r.revision);values.set(key,sent);
          if(pending[key]===item && JSON.stringify(item.value)===sent) delete pending[key];
          else if(pending[key]) pending[key].revision=r.revision;
          keep();
        }catch(e){
          if(e.status===409 && e.latest && JSON.stringify(e.latest.value)===sent) {revisions.set(key,e.latest.revision);values.set(key,sent);delete pending[key];}
          else if(e.status===409 && e.latest) conflicts.set(key,e.latest);
          else status=e.message;
          keep();if(e.status!==409)break;
        }
      }
      if(!Object.keys(pending).length)status='同期済み';else if(!conflicts.size && status==='同期済み')status='端末に保存済み・同期待ち';
    }finally{busy=false;paint();}
  }
  function set(key,value,expectedRevision) {
    const raw=JSON.stringify(value);if(values.get(key)===raw && !pending[key]) return;
    if(pending[key] && JSON.stringify(pending[key].value)===raw)return;
    pending[key]={value:clone(value),revision:expectedRevision??pending[key]?.revision??revisions.get(key)??null};keep();
    status=navigator.onLine?'保存しています':'端末に保存済み・オンライン復帰後に同期';paint();
    clearTimeout(timer);timer=setTimeout(flush,350);
  }
  function resolve(key,local) {
    const remote=conflicts.get(key);if(!remote)return;
    try{localStorage.setItem('tsugi.cloud.backup.'+Date.now(),JSON.stringify({key,local:pending[key]?.value,remote}));}catch{}
    conflicts.delete(key);revisions.set(key,remote.revision);
    if(local)pending[key].revision=remote.revision;
    else {delete pending[key];accept(remote);}
    keep();paint();flush();
  }
  const cloud=window.TsugiCloud={set,device,watch(keys,callback){watched=keys;listeners.add(callback);poll();},revision:key=>revisions.get(key)??0,isReady:()=>ready,
    result(run,state){if(!run.id)return;set('result:'+run.id,{id:run.id,date:run.date,name:run.name,steps:run.steps,state,finishedAt:new Date().toISOString(),confirmedAt:state==='done'?new Date().toISOString():null,spent:run.spent});},
    date:()=>new Date(Date.now()+5*3600000).toISOString().slice(0,10),sync:poll};
  addEventListener('online',()=>{status='接続しています';poll();});
  addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')poll();});
  addEventListener('DOMContentLoaded',()=>{
    const style=document.createElement('style');style.textContent='#cloud-state{position:fixed;z-index:20;top:0;left:0;right:0;background:#17161c;color:#ff9fa8;font:700 13px/1.5 "Zen Maru Gothic","Noto Sans JP",sans-serif;padding:calc(10px + env(safe-area-inset-top,0px)) 16px 10px}#cloud-state p{margin:6px 0 0;color:#fff}#cloud-state button{margin:6px 6px 0 0;min-height:40px;padding:0 12px;border:0;border-radius:10px;color:#000;background:#fff;font:inherit}#cloud-nav{display:flex;gap:4px;font:700 14px "Zen Maru Gothic","Noto Sans JP",sans-serif;padding:calc(8px + env(safe-area-inset-top,0px)) max(16px,env(safe-area-inset-right,0px)) 0 max(16px,env(safe-area-inset-left,0px));background:#000}#cloud-nav a{display:flex;align-items:center;min-height:38px;padding:0 12px;border-radius:10px;color:#a09eaa;text-decoration:none}#cloud-nav a[aria-current=page]{background:#fff;color:#000}@media (min-width:900px) and (orientation:landscape){body:has(.shell){display:flex;flex-direction:column}body:has(.shell) .shell{height:auto;flex:1;min-height:0}}';document.head.append(style);
    const bar=document.createElement('div');bar.id='cloud-state';bar.setAttribute('role','status');document.body.prepend(bar);
    const nav=document.createElement('nav');nav.id='cloud-nav';const here=location.pathname.startsWith('/map')?'map':'home';nav.innerHTML=`<a href="/" ${here==='home'?'aria-current="page"':''}>ルーティン</a><a href="/map/" ${here==='map'?'aria-current="page"':''}>予定の地図</a>`;document.body.insertBefore(nav,bar.nextSibling);paint();
  });
  setInterval(()=>{if(document.visibilityState==='visible')poll();},5000);
})();
