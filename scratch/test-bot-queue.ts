import assert from 'node:assert/strict';
import { createLoader } from './test-loader.ts';
import type { TelegramUpdate } from '../lib/types';

async function main() {
  let calls=0;let fail=false;let albums=0;
  const env={TELEGRAM_HOURLY_LIMIT:'2'};
  const runtime=createLoader({'./telegram-handler':{handleTelegramWebhook:async()=>{calls++;if(fail)throw new Error('outage');},sendTelegramMessage:async()=>({ok:true})},
    './telegram-workflows':{handleDocumentationAlbum:async(updates:TelegramUpdate[])=>{albums++;assert.equal(updates.length,2);}}},
    {process:{env,cwd:()=>'/isolated'}});
  const queue=runtime.load<typeof import('../lib/telegram-queue')>('lib/telegram-queue.ts');
  const state=runtime.load<typeof import('../lib/telegram-state')>('lib/telegram-state.ts');
  const make=(id:number,user=123):TelegramUpdate=>({update_id:id,message:{message_id:id,chat:{id:user,type:'private'},from:{id:user,is_bot:false,first_name:'Test'},date:0,text:'Undangan kegiatan yang harus dianalisis'}});
  assert.equal(await queue.enqueueTelegramUpdate(make(1),'bot','https://example.com'),'queued');
  assert.equal(await queue.enqueueTelegramUpdate(make(1),'bot','https://example.com'),'duplicate');
  await Promise.all([queue.drainTelegramQueue(),queue.drainTelegramQueue()]);
  assert.equal(calls,1,'Parallel workers claim one job once');
  assert.equal(await queue.enqueueTelegramUpdate(make(1),'bot','https://example.com'),'duplicate');
  fail=true;await queue.enqueueTelegramUpdate(make(2),'bot','https://example.com');await queue.drainTelegramQueue();
  const jobId=`job:${state.botIdentity('bot')}:2`;
  let row=await state.readBotState<import('../lib/telegram-queue').TelegramJob>(jobId);
  assert.equal(row?.value.status,'pending');assert.equal(row?.value.attempts,1);
  fail=false;assert.ok(row);await state.writeBotState(row.id,row.kind,row.value,row.version,Date.now(),row.expires);
  await queue.drainTelegramQueue();row=await state.readBotState(jobId);assert.equal((row?.value as {status:string}).status,'done');
  assert.equal(await queue.enqueueTelegramUpdate(make(3),'bot','https://example.com'),'limited');
  const status=make(4);status.message!.text='/status';assert.equal(await queue.enqueueTelegramUpdate(status,'bot','https://example.com'),'queued');await queue.drainTelegramQueue();
  const one=make(10,456),two=make(11,456);one.message!.media_group_id=two.message!.media_group_id='album';
  await Promise.all([queue.enqueueTelegramUpdate(one,'bot','https://example.com'),queue.enqueueTelegramUpdate(two,'bot','https://example.com')]);
  const albumUsage=await state.readBotState<{count:number}>(`quota:${state.botIdentity('bot')}:456:${Math.floor(Date.now()/3600000)}`);
  assert.equal(albumUsage?.value.count,1,'Concurrent album arrivals share one quota admission');
  const albumId=`job:${state.botIdentity('bot')}:album:456:album`;
  const album=await state.readBotState<import('../lib/telegram-queue').TelegramJob>(albumId);assert.ok(album);
  assert.equal(album.value.updates.length,2);await state.writeBotState(album.id,album.kind,album.value,album.version,Date.now(),album.expires);
  await queue.drainTelegramQueue();assert.equal(albums,1);
  await queue.enqueueTelegramUpdate(make(30,789),'bot','https://example.com');
  const interrupted=await state.readBotState<import('../lib/telegram-queue').TelegramJob>(`job:${state.botIdentity('bot')}:30`);assert.ok(interrupted);
  await state.writeBotState(interrupted.id,interrupted.kind,{...interrupted.value,status:'processing',attempts:3,leaseUntil:0},interrupted.version,Date.now(),interrupted.expires);
  const beforeHardLimit=calls;await queue.drainTelegramQueue();assert.equal(calls,beforeHardLimit);
  assert.equal((await state.readBotState<import('../lib/telegram-queue').TelegramJob>(interrupted.id))?.value.status,'failed','Interrupted third attempt cannot start a fourth');

  const callbacks:Array<()=>Promise<void>>=[];
  const webhookRuntime=createLoader({'next/server':{NextResponse:{json:(body:unknown,init?:ResponseInit)=>Response.json(body,init)},after:(fn:()=>Promise<void>)=>callbacks.push(fn)},
    './telegram-queue':{enqueueTelegramUpdate:async()=>{calls++;return 'queued';},drainTelegramQueue:async()=>0}},
    {process:{env:{TELEGRAM_BOT_TOKEN:'bot'},cwd:()=>'/isolated'}});
  const webhook=webhookRuntime.load<typeof import('../lib/telegram-webhook')>('lib/telegram-webhook.ts');
  const security=webhookRuntime.load<typeof import('../lib/telegram-security')>('lib/telegram-security.ts');
  const req=(secret:string)=>({url:'https://example.com/api/telegram',headers:new Headers({'x-telegram-bot-api-secret-token':secret}),text:async()=>JSON.stringify(make(1))}) as Parameters<typeof webhook.telegramWebhook>[0];
  const before=calls;assert.equal((await webhook.telegramWebhook(req('wrong'))).status,403);assert.equal(calls,before);
  assert.equal((await webhook.telegramWebhook(req(security.webhookSecret('bot')))).status,200);assert.equal(callbacks.length,1);
  console.log('PASS: webhook secret/authentication and durable acceptance, duplicate updates, concurrent claims, retries, quota/status exemption, album aggregation');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
