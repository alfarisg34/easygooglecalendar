import assert from 'node:assert/strict';
import { createLoader } from './test-loader.ts';
import type { CalendarEvent, ExtractionRequest, ExtractionResponse } from '../lib/types';

const event: CalendarEvent = {title:'Rapat Uji',start_time:'2026-10-16T13:00:00+07:00',end_time:'2026-10-16T14:00:00+07:00',location:'Ruang B',is_online:false,meeting_link:'',meeting_id_pass:'',jp:'',speakers:'',description:'',update:{start_clock:'13:00',end_clock:'14:00',location:'Ruang B'}};
const request: ExtractionRequest = {apiKey:'private-test-key',model:'gemini-3.6-flash',sourceType:'text',text:'private invitation content'};
async function main() {
  let now=0;
  let mode='slow';
  const limits:number[]=[];
  const logs:unknown[][]=[];
  let calls=0;
  class Clock extends Date { static now() {return now;} }
  const runtime=createLoader({}, {Date:Clock,AbortSignal:{timeout:(ms:number)=>{limits.push(ms);return AbortSignal.timeout(ms);}},
    console:{...console,info:(...args:unknown[])=>logs.push(args)},
    fetch:async()=>{
      calls++;
      if(mode==='slow') {now+=limits.at(-1)!;throw Object.assign(new Error('private-test-key'),{name:'TimeoutError'});}
      if(mode==='body-timeout')return {ok:true,json:async()=>{now+=limits.at(-1)!;throw Object.assign(new Error('timeout'),{name:'TimeoutError'});}};
      if(mode==='fallback-success'&&calls===1) {now+=200;return Response.json({error:{message:'temporarily unavailable'}},{status:503});}
      if(mode==='auth'&&calls===1) {now+=100;throw Object.assign(new Error('timeout'),{name:'TimeoutError'});}
      if(mode==='auth')return Response.json({error:{message:'permission denied'}},{status:403});
      if(mode==='unavailable')return Response.json({error:{message:'model missing'}},{status:404});
      now+=19000; // A valid answer taking more than the previous 18-second limit.
      return Response.json({candidates:[{content:{parts:[{text:JSON.stringify(event)}]}}]});
    }});
  const service=runtime.load<typeof import('../lib/gemini')>('lib/gemini.ts');
  const context=runtime.load<typeof import('../lib/telegram-context')>('lib/telegram-context.ts');
  const state={operationId:'private-job-identity',retryableFailure:false};
  let result=await context.telegramContext.run(state,()=>service.extractEventFromSource(request));
  assert.equal(result.success,false);assert.equal(now,40000);assert.deepEqual(limits,[25000,15000]);assert.equal(state.retryableFailure,true);
  assert.match(result.error||'',/batas waktu/);
  now=0;calls=0;limits.length=0;mode='body-timeout';
  await context.telegramContext.run(state,()=>service.extractEventFromSource(request));
  assert.equal(now,40000,'Response body parsing shares the attempt timeout');
  now=0;calls=0;limits.length=0;mode='fallback-success';
  result=await context.telegramContext.run(state,()=>service.extractEventFromSource(request));
  assert.equal(result.success,true);assert.equal(result.modelUsed,'gemini-3.5-flash');assert.equal(state.retryableFailure,false);
  assert.equal(result.event?.update?.location,'Ruang B');assert.equal(calls,2);
  now=0;calls=0;limits.length=0;mode='auth';
  await context.telegramContext.run(state,()=>service.extractEventFromSource(request));
  assert.equal(calls,2);assert.equal(state.retryableFailure,false,'Permanent permission errors must not inherit a previous timeout retry flag');
  now=0;calls=0;limits.length=0;mode='unavailable';
  await context.telegramContext.run(state,()=>service.extractEventFromSource(request));
  assert.equal(calls,3,'Fast model-unavailable responses still traverse the fallback chain');assert.equal(state.retryableFailure,false);
  const diagnostics=JSON.stringify(logs);
  for(const privateValue of [request.apiKey!,request.text!,'private-job-identity'])assert.ok(!diagnostics.includes(privateValue));
  assert.match(diagnostics,/elapsedMs/);assert.match(diagnostics,/timeout/);

  let aiCalls=0;let succeeds=true;
  const cacheRuntime=createLoader({'./gemini':{extractEventFromSource:async():Promise<ExtractionResponse>=>{aiCalls++;return succeeds?{success:true,event:structuredClone(event)}:{success:false,error:'timeout'};}}});
  const extractor=cacheRuntime.load<typeof import('../lib/telegram-extraction')>('lib/telegram-extraction.ts');
  const cacheContext=cacheRuntime.load<typeof import('../lib/telegram-context')>('lib/telegram-context.ts');
  const cachedState={operationId:'one-update',managedRetry:true,attempt:1,retryableFailure:false};
  const extract=(owner='owner',input=request)=>cacheContext.telegramContext.run(cachedState,()=>extractor.extractTelegramEvent(input,owner));
  const first=await extract();first.event!.location='mutated';
  cachedState.retryableFailure=true;const second=await extract();
  assert.equal(aiCalls,1,'A retry reuses persisted successful extraction, including updates');assert.equal(second.event?.location,'Ruang B');assert.equal(cachedState.retryableFailure,false);
  await extract('different-owner');assert.equal(aiCalls,2);
  await extract('owner',{...request,text:'different input'});assert.equal(aiCalls,3);
  succeeds=false;cachedState.operationId='failed-update';await extract();await extract();assert.equal(aiCalls,5,'Transient failures are not cached');
  cachedState.retryableFailure=true;
  assert.match(cacheContext.telegramContext.run(cachedState,()=>extractor.extractionFailureNotice('timeout')),/menunggu percobaan ulang/);
  cachedState.attempt=3;assert.doesNotMatch(cacheContext.telegramContext.run(cachedState,()=>extractor.extractionFailureNotice('timeout')),/menunggu percobaan ulang/);
  const offline=createLoader({'./telegram-state':{readBotState:async()=>null,writeBotState:async()=>{throw new Error('database down');}},'./gemini':{extractEventFromSource:async()=>({success:true,event})}});
  const offlineExtractor=offline.load<typeof import('../lib/telegram-extraction')>('lib/telegram-extraction.ts');
  const offlineContext=offline.load<typeof import('../lib/telegram-context')>('lib/telegram-context.ts');
  const offlineState={operationId:'write-failed',retryableFailure:false};
  const held=await offlineContext.telegramContext.run(offlineState,()=>offlineExtractor.extractTelegramEvent(request,'owner'));
  assert.equal(held.success,false,'Successful AI results must not reach dispatch when durable result storage fails');assert.equal(offlineState.retryableFailure,true);
  console.log('PASS: Gemini total/attempt timeout, body timeout, >18s success, fallback, terminal auth, private diagnostics, cached update extraction and retry feedback');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
