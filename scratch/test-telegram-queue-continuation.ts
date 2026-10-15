import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createLoader } from './test-loader.ts';
import type { TelegramUpdate } from '../lib/types';

async function main() {
  let now=Date.now();
  const env:Record<string,string>={NEXT_PUBLIC_APP_URL:'https://example.com',TELEGRAM_BOT_TOKEN:'bot-A',SESSION_SECRET:'isolated-session-key'};
  class Clock extends Date {static now(){return now;}}
  const callbacks:Array<()=>Promise<void>>=[];
  const calls:number[]=[];
  const requests:Array<{jobId:string;wakeToken:string}>=[];
  const failures=new Set<number>();
  let networkDown=false;
  let slept=false;
  let release:(()=>void)|undefined;
  let started:(()=>void)|undefined;
  const busyStarted=new Promise<void>(resolve=>{started=resolve;});
  let worker:typeof import('../app/api/telegram/worker/route');
  const runtime=createLoader({
    'next/server':{NextResponse:{json:(body:unknown,init?:ResponseInit)=>Response.json(body,init)},after:(fn:()=>Promise<void>)=>callbacks.push(fn)},
    './telegram-handler':{handleTelegramWebhook:async(update:TelegramUpdate)=>{
      assert.equal(slept,false,'An invocation that waits must hand off before running a job');
      calls.push(update.update_id);
      if(update.update_id===100){started!();await new Promise<void>(resolve=>{release=resolve;});}
      if(failures.delete(update.update_id))throw new Error('temporary outage');
    },sendTelegramMessage:async()=>({ok:true})},
    './telegram-workflows':{handleDocumentationAlbum:async(updates:TelegramUpdate[])=>{calls.push(...updates.map(u=>u.update_id));}}
  },{Date:Clock,process:{env,cwd:()=>'/isolated'},
    setTimeout:(fn:()=>void,ms:number)=>{now+=ms;slept=true;fn();return 0;},
    fetch:async(url:URL,options:{body:string;redirect:string})=>{
      assert.equal(String(url),'https://example.com/api/telegram/worker');assert.equal(options.redirect,'error');
      const body=JSON.parse(options.body);requests.push(body);
      assert.deepEqual(Object.keys(body).sort(),['jobId','wakeToken']);
      if(networkDown)return new Response('',{status:503});
      return worker.POST(new Request(String(url),{method:'POST',body:options.body}) as Parameters<typeof worker.POST>[0]);
    }});
  const queue=runtime.load<typeof import('../lib/telegram-queue')>('lib/telegram-queue.ts');
  const state=runtime.load<typeof import('../lib/telegram-state')>('lib/telegram-state.ts');
  const wake=runtime.load<typeof import('../lib/telegram-queue-wake')>('lib/telegram-queue-wake.ts');
  worker=runtime.load<typeof import('../app/api/telegram/worker/route')>('app/api/telegram/worker/route.ts');
  const make=(id:number,user=id):TelegramUpdate=>({update_id:id,message:{message_id:id,chat:{id:user,type:'private'},from:{id:user,is_bot:false,first_name:'Test'},date:0,text:'/status'}});
  const enqueue=async(id:number,user=id,bot='bot-A')=>{const update=make(id,user);await queue.enqueueTelegramUpdate(update,bot,'https://example.com');return queue.telegramJobId(update,bot);};
  const pump=async()=>{let count=0;while(callbacks.length){assert.ok(++count<150,'Continuation must be bounded');slept=false;await callbacks.shift()!();}slept=false;};

  const old=await enqueue(1);const fresh=await enqueue(2,2,'bot-B');
  await queue.drainTelegramQueue(fresh);assert.deepEqual(calls,[2],'A new webhook must not consume an unrelated older job instead');
  assert.ok(callbacks.length);await pump();assert.deepEqual(calls,[2,1],'Backlog continues without a new Telegram message');
  assert.equal((await state.readBotState<import('../lib/telegram-queue').TelegramJob>(old))?.value.status,'done');

  const retry=await enqueue(3);failures.add(3);await queue.drainTelegramQueue(retry);
  assert.equal((await state.readBotState<import('../lib/telegram-queue').TelegramJob>(retry))?.value.status,'pending');
  const retryAt=now;await pump();assert.ok(now-retryAt>=30000);assert.deepEqual(calls.slice(-2),[3,3]);
  assert.equal((await state.readBotState<import('../lib/telegram-queue').TelegramJob>(retry))?.value.attempts,2);

  const first=await enqueue(100,500);const second=await enqueue(101,500);
  const running=queue.drainTelegramQueue(first);await busyStarted;
  await queue.drainTelegramQueue(second);assert.equal(calls.filter(id=>id===101).length,0,'Same-chat work cannot overlap');
  release!();await running;await pump();assert.equal(calls.filter(id=>id===101).length,1,'Busy-chat handoff must resume after unlock without another message');

  const albumOne=make(110,600),albumTwo=make(111,600);albumOne.message!.media_group_id=albumTwo.message!.media_group_id='album';
  await queue.enqueueTelegramUpdate(albumOne,'bot-A','https://example.com');await queue.enqueueTelegramUpdate(albumTwo,'bot-A','https://example.com');
  await queue.drainTelegramQueue(queue.telegramJobId(albumOne,'bot-A'));
  assert.ok(!calls.includes(110),'Album is not processed before collection window');await pump();assert.ok(calls.includes(110)&&calls.includes(111));

  const late=make(112,600);late.message!.media_group_id='album';
  await queue.enqueueTelegramUpdate(late,'bot-A','https://example.com');
  await queue.drainTelegramQueue(queue.telegramJobId(late,'bot-A'));await pump();
  assert.equal(calls.filter(id=>id===112).length,1,'A late album member rerouted to a singleton job is not lost');

  const only=await enqueue(120);const before=callbacks.length;
  await Promise.all([queue.continueTelegramJob(only),queue.continueTelegramJob(only)]);
  assert.equal(callbacks.length,before+1,'Concurrent continuation triggers share one active capability');
  const capability=requests.at(-1)!;
  const post=(body:unknown,authorization?:string)=>worker.POST(new Request('https://example.com/api/telegram/worker',{method:'POST',headers:authorization?{authorization}:{},body:JSON.stringify(body)}) as Parameters<typeof worker.POST>[0]);
  assert.equal((await post(capability)).status,202);assert.equal(callbacks.length,before+1,'Replay is acknowledged but never scheduled twice');
  assert.equal((await post({...capability,wakeToken:'0'.repeat(64)})).status,403);
  assert.equal((await post({...capability,jobId:old})).status,403,'Capability cannot authorize a different job');
  assert.equal((await post({jobId:only})).status,403);
  await pump();assert.equal(calls.filter(id=>id===120).length,1);
  now+=61000;assert.equal((await post(capability)).status,403,'Expired capabilities are rejected');
  assert.equal((await post({value:'x'.repeat(2100)})).status,413);
  assert.equal((await worker.POST(new Request('https://example.com/api/telegram/worker',{method:'POST',body:'{'}) as Parameters<typeof worker.POST>[0])).status,400);
  assert.equal((await worker.GET(new Request('https://example.com/api/telegram/worker') as Parameters<typeof worker.GET>[0])).status,403);
  env.CRON_SECRET='external-worker-secret';assert.equal((await post({},'Bearer wrong')).status,403);
  assert.equal((await worker.GET(new Request('https://example.com/api/telegram/worker',{headers:{authorization:'Bearer external-worker-secret'}}) as Parameters<typeof worker.GET>[0])).status,200);

  const outage=await enqueue(130);networkDown=true;assert.equal(await queue.continueTelegramJob(outage),false);
  assert.equal((await state.readBotState<import('../lib/telegram-queue').TelegramJob>(outage))?.value.status,'pending','Network failure must leave durable work recoverable');
  networkDown=false;await queue.continueTelegramJob(outage);await pump();assert.equal(calls.filter(id=>id===130).length,1);

  const capped=await enqueue(140);await queue.continueTelegramJob(capped);await pump();
  const wakeId='queue-wake:'+createHash('sha256').update(capped).digest('hex');
  const cap=await state.readBotState<{attempt:number;hops:number;validUntil:number}>(wakeId);assert.ok(cap);
  await state.writeBotState(cap.id,cap.kind,{...cap.value,hops:40,validUntil:0},cap.version,now,cap.expires);
  assert.equal(await wake.scheduleTelegramQueueWake(capped,now,0),false,'Per-attempt hop ceiling prevents unbounded request chains');
  env.NEXT_PUBLIC_APP_URL='http://untrusted.example';assert.equal(await wake.scheduleTelegramQueueWake(capped,now,1),false);
  env.NEXT_PUBLIC_APP_URL='https://user:password@example.com';assert.equal(await wake.scheduleTelegramQueueWake(capped,now,1),false);
  delete env.NEXT_PUBLIC_APP_URL;assert.equal(await wake.scheduleTelegramQueueWake(capped,now,1),false);

  env.NEXT_PUBLIC_APP_URL='https://example.com';
  const stale=await enqueue(201);
  const webhook=runtime.load<typeof import('../lib/telegram-webhook')>('lib/telegram-webhook.ts');
  const security=runtime.load<typeof import('../lib/telegram-security')>('lib/telegram-security.ts');
  const beforeWebhook=calls.length;
  const response=await webhook.telegramWebhook(new Request('https://example.com/api/telegram',{method:'POST',headers:{'x-telegram-bot-api-secret-token':security.webhookSecret('bot-A')},body:JSON.stringify(make(202))}) as Parameters<typeof webhook.telegramWebhook>[0]);
  assert.equal(response.status,200);await pump();
  assert.deepEqual(calls.slice(beforeWebhook),[202,201],'Real webhook after() targets its accepted update then continues prior backlog');
  assert.equal((await state.readBotState<import('../lib/telegram-queue').TelegramJob>(stale))?.value.status,'done');

  console.log('PASS: targeted jobs/backlog, busy-chat continuation, scheduled retry/album without incoming messages, fresh execution budgets, scoped one-use capabilities, replay/expiry/auth/body guards, handoff outage recovery and bounded hops');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
