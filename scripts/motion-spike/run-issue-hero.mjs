#!/usr/bin/env node
/** Isolated D05 probe. Bundles the real wrapper; no product route binding or API mutation. */
import assert from 'node:assert/strict';
import { mkdtemp,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { startServer } from '../csp-spike/server.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=process.env.ISSUE_HERO_OUTPUT??join(tmpdir(),'issue-hero-spike.raw.json');
const pageDir=await mkdtemp(join(tmpdir(),'issue-hero-page-'));
await build({entryPoints:[join(root,'scripts/motion-spike/issue-hero/probe.ts')],outdir:pageDir,bundle:true,splitting:true,format:'esm',minify:true,define:{'process.env.NODE_ENV':'"production"','import.meta.env.DEV':'false','import.meta.env.PROD':'true','import.meta.env.VITE_ISSUE_HERO_SPIKE':'"track-o-release1"'},logLevel:'error'});
await writeFile(join(pageDir,'index.html'),'<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>O D05 isolated probe</title><link rel="stylesheet" href="/probe.css"><link rel="stylesheet" href="/layout.css"><script type="module" src="/probe.js"></script></head><body><main><h1>Ключ задачи: D05</h1></main></body></html>');
await writeFile(join(pageDir,'layout.css'),'body{font-family:system-ui;margin:40px;background:#fafafa;color:#171717}main{margin-top:40px}button,input{padding:12px}button:focus-visible,h2:focus{outline:2px solid blue}h2{margin-top:80px}html.vt-nav::view-transition-old(root),html.vt-nav::view-transition-new(root){animation-duration:150ms}');
const {server,url,csp}=await startServer({root:pageDir,floatingUiNodeModules:null});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH});
const results=[],failures=[];
try{
 for(const mode of ['warm','deliberate','cold','panel','top-layer','foreign','wrong-key','system','personal','no-api']){
  const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:mode==='system'?'reduce':'no-preference'});
  const page=await context.newPage(),errors=[],api=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))api.push(r.url());});
  try{
   const response=await page.goto(url+'?case='+mode);assert.equal(response.headers()['content-security-policy'],csp);
   await page.getByRole('button',{name:'Открыть CORP-1'}).click();
   if(mode==='warm'){await page.waitForFunction(()=>window.__hero.ready||window.__hero.skipped);await page.screenshot({path:output+'.warm.png'});}
   await page.waitForFunction(()=>window.__hero.done);
   const result=await page.evaluate(()=>{const {transition,...result}=window.__hero;return result;});
   assert.deepEqual(errors,[]);assert.deepEqual(api,[]);assert.deepEqual(result.violations,[]);assert.deepEqual(result.before,result.after);assert.equal(result.vtNav,false);assert.equal(result.targetName,'');assert.equal(result.sourceName,mode==='foreign'?'another-owner':'');
   assert.equal(result.active,mode==='deliberate'?'other':'heading');
   if(['system','personal','no-api'].includes(mode))assert.equal(result.nativeCalls,0);
   if(['warm','deliberate'].includes(mode)){assert.deepEqual(result.ready?.names,['CORP-1']);assert.equal(result.ready.duration,'0.2s');assert.ok(result.ready.animations.some(a=>(a.pseudo??'').includes('issue-hero')||(a.name??'').includes('issue-hero')),'actual native named-group animation must exist');}
   if(['cold','wrong-key'].includes(mode))assert.ok(result.skipped,'missing/mismatching warm target must skip');
   results.push({...result,pageErrors:errors,apiRequests:api});console.log(mode+' PASS');
  }catch(error){failures.push({mode,error:String(error),state:await page.evaluate(()=>{const {transition,...state}=window.__hero??{};return state;}).catch(()=>null)});console.log(mode+' FAIL '+error.message);}
  finally{await context.close();}
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
await writeFile(output,JSON.stringify({browser:browser.version(),csp,results,failures},null,2));
console.log(output);if(failures.length)process.exitCode=1;
