import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
export function localDb(path=':memory:') {
  const sql=new DatabaseSync(path);
  if(!sql.prepare("SELECT name FROM sqlite_master WHERE name='records'").get())sql.exec(readFileSync(new URL('../drizzle/0000_sync.sql',import.meta.url),'utf8'));
  return {close:()=>sql.close(),prepare(query){let args=[];return{bind(...values){args=values;return this;},async first(){return sql.prepare(query).get(...args)||null;},async all(){return{results:sql.prepare(query).all(...args)};},async run(){const r=sql.prepare(query).run(...args);return{meta:{changes:r.changes}};}};}};
}
