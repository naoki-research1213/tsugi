import {createServer} from 'node:http';
import {readFileSync,mkdirSync} from 'node:fs';
import {localDb} from './local-db.mjs';
import worker from '../dist/server/index.js';
mkdirSync('.sites-runtime',{recursive:true});
const db=localDb('.sites-runtime/preview.sqlite');
const server=createServer(async(req,res)=>{
  const chunks=[];for await(const c of req)chunks.push(c);
  const method=req.method,headers=req.headers;
  const request=new Request('http://127.0.0.1:4173'+req.url,{method,headers,...(!['GET','HEAD'].includes(method)?{body:Buffer.concat(chunks)}:{})});
  try{const response=await worker.fetch(request,{DB:db});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch(e){res.writeHead(500);res.end(e.message);}
});
server.listen(4173,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:4173 (local data, production authentication is provided by Sites)'));
