import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const digits=read('docs/index.html').match(/data:font\/woff2;base64,[A-Za-z0-9+/=]+/)[0];
const assets={};
for(const [src,dest,cut] of [['src/app.html','/index.html','<div id="app">'],['src/map.html','/map/index.html','<div class="shell">']]) {
  let html=read(src).replaceAll('__DIGITS__',digits).replace(/<meta name="claude:[^>]+>\s*/g,'');
  const i=html.indexOf(cut);
  html='<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="theme-color" content="#000"><link rel="icon" href="/icon-192.png"><link rel="manifest" href="/manifest.webmanifest">'+html.slice(0,i)+'<script src="/cloud.js"></script></head><body>'+html.slice(i)+'</body></html>';
  assets[dest]={type:'text/html; charset=utf-8',body:html};
}
assets['/cloud.js']={type:'application/javascript; charset=utf-8',body:read('src/cloud.js')};
assets['/connect']={type:'text/html; charset=utf-8',body:read('src/connect.html')};
assets['/manifest.webmanifest']={type:'application/manifest+json',body:JSON.stringify({name:'ツギ',short_name:'ツギ',lang:'ja',start_url:'/',display:'standalone',background_color:'#000',theme_color:'#000',icons:[{src:'/icon-192.png',sizes:'192x192',type:'image/png'},{src:'/icon-512.png',sizes:'512x512',type:'image/png'}]})};
for(const size of [192,512])assets['/icon-'+size+'.png']={type:'image/png',base64:true,body:readFileSync(new URL('../docs/icon-'+size+'.png',import.meta.url)).toString('base64')};
let core=read('server/core.mjs').replace(/export /g,''),server=read('server/index.mjs').replace(/^import .*;\n/,'').replace(/export /g,'');
mkdirSync('dist/server',{recursive:true});mkdirSync('dist/.openai',{recursive:true});
writeFileSync('dist/server/index.js',core+'\n'+server+'\nconst assets='+JSON.stringify(assets)+';\nexport default {fetch(request,env){return handle(request,env,assets);}};\n');
writeFileSync('dist/.openai/hosting.json',read('.openai/hosting.json'));
console.log('Built worker with '+Object.keys(assets).length+' embedded assets');
