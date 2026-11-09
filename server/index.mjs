import { HttpError, getRecord, putRecord, recordKey, tools, callTool } from './core.mjs';
export const json = (value, status = 200) => new Response(JSON.stringify(value), {status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
async function body(request) {
  if (+request.headers.get('Content-Length') > 200000) throw new HttpError(413,'データが大きすぎます');
  const text = await request.text();
  if (text.length > 200000) throw new HttpError(413,'データが大きすぎます');
  try { return JSON.parse(text); } catch { throw new HttpError(400,'JSON形式で送信してください'); }
}
export async function handle(request, env, assets) {
  try {
    const url = new URL(request.url), path = url.pathname;
    // Sites dispatch authenticates every route of this owner-private Site. Never publish this single-owner app to a shared audience.
    const origin = request.headers.get('Origin');
    if (!['GET','HEAD','OPTIONS'].includes(request.method) && origin && origin !== url.origin) throw new HttpError(403,'別のサイトからは変更できません');
    if (path === '/health') return json({ok:!!env.DB});
    if (path === '/openapi.json') return json(openapi(url.origin));
    if (path === '/mcp') {
      if (request.method === 'GET') return new Response(null,{status:405,headers:{Allow:'POST'}});
      if (request.method === 'DELETE') return new Response(null,{status:204});
      if (request.method !== 'POST') throw new HttpError(405,'POSTを使用してください');
      const rpc = await body(request);
      if (!rpc || rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string') return json({jsonrpc:'2.0',id:rpc?.id??null,error:{code:-32600,message:'Invalid Request'}},400);
      if (rpc.id === undefined) return new Response(null,{status:202});
      let result;
      if (rpc.method === 'server/discover') result = {supportedVersions:['2026-07-28'],capabilities:{tools:{}}};
      else if (rpc.method === 'initialize') result = {protocolVersion:['2026-07-28','2025-11-25','2025-06-18','2025-03-26','2024-11-05'].includes(rpc.params?.protocolVersion)?rpc.params.protocolVersion:'2026-07-28',capabilities:{tools:{}},serverInfo:{name:'tsugi',version:'2.0.0'},instructions:'予定の変更前に読み取り、revisionを使って保存。timer_finishedを本人の実施完了と断定しない。'};
      else if (rpc.method === 'ping') result = {};
      else if (rpc.method === 'tools/list') result = {tools};
      else if (rpc.method === 'tools/call') {
        try { const data = await callTool(env.DB,rpc.params?.name,rpc.params?.arguments); result={content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data,isError:false}; }
        catch(e) { result={content:[{type:'text',text:JSON.stringify({error:e.message,status:e.status||500,latest:e.details})}],isError:true}; }
      } else return json({jsonrpc:'2.0',id:rpc.id,error:{code:-32601,message:'Method not found'}});
      return json({jsonrpc:'2.0',id:rpc.id,result});
    }
    if (path === '/api/records') {
      if (request.method !== 'GET') throw new HttpError(405,'GETを使用してください');
      const keys=(url.searchParams.get('keys')||'').split(','); if(keys.length>25) throw new HttpError(400,'一度に25件まで取得できます');
      return json({records:await Promise.all(keys.map(key=>getRecord(env.DB,recordKey(key))))});
    }
    if (path.startsWith('/api/records/')) {
      const key=recordKey(decodeURIComponent(path.slice(13)));
      if(request.method==='GET') return json(await getRecord(env.DB,key));
      if(request.method==='PUT') { const b=await body(request); return json(await putRecord(env.DB,key,b.value,b.revision)); }
      throw new HttpError(405,'GETまたはPUTを使用してください');
    }
    if (path.startsWith('/api/tools/')) {
      if(request.method!=='POST') throw new HttpError(405,'POSTを使用してください');
      return json(await callTool(env.DB,path.slice(11),await body(request)));
    }
    if(request.method!=='GET' && request.method!=='HEAD') throw new HttpError(405,'GETを使用してください');
    const asset=assets[path === '/' ? '/index.html' : path === '/map/' || path === '/map' ? '/map/index.html' : path];
    if(!asset) throw new HttpError(404,'ページがありません');
    const bytes=asset.base64 ? Uint8Array.from(atob(asset.body),c=>c.charCodeAt(0)) : asset.body;
    return new Response(request.method==='HEAD'?null:bytes,{headers:{'Content-Type':asset.type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'}});
  } catch(e) { return json({error:e.status?e.message:'保存先に接続できません。しばらくしてから再試行してください',latest:e.details},e.status||500); }
}
export function openapi(origin) {
  const paths={};
  for(const tool of tools) paths['/api/tools/'+tool.name]={post:{operationId:tool.name,summary:tool.description,'x-openai-isConsequential':!tool.annotations.readOnlyHint,requestBody:{required:true,content:{'application/json':{schema:tool.inputSchema}}},responses:{200:{description:'成功。保存結果のrevisionまたは実行記録。',content:{'application/json':{schema:{type:'object',additionalProperties:true}}}},409:{description:'競合。最新の予定を再取得し、変更を再検討する。'}}}};
  return {openapi:'3.1.0',info:{title:'ツギ',version:'2.0.0',description:'本人専用の予定・ルーティン・実行記録。Sitesの認証が必要。'},servers:[{url:origin}],security:[{SitesServiceAccess:[]}],components:{securitySchemes:{SitesServiceAccess:{type:'apiKey',in:'header',name:'OAI-Sites-Authorization',description:'Sitesのサービスアクセストークン。値は Bearer に続けて半角空白とトークン。'}}},paths};
}
