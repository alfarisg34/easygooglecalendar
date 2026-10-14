import assert from 'node:assert/strict';
import path from 'node:path';
import { createLoader } from './test-loader.ts';
import type { TelegramUpdate,ExtractionRequest } from '../lib/types';

async function main() {
  const extractions:ExtractionRequest[]=[];const messages:string[]=[];let inserts=0;let downloads=0;let fileContent='Undangan rapat pada tanggal 20 Oktober 2099 pukul 09.00 sampai 11.00 di Ruang A.';
  const env:Record<string,string>={};
  const runtime=createLoader({
    './telegram-agenda':{handleTelegramAgenda:async()=>false},'./telegram-workflows':{handleWorkflowInput:async()=>false,currentSource:()=>[]},
    './db':{getUserByTelegram:async()=>({id:'owner',calendar_id:'team'}),getBotAdminSettings:async()=>null,getRecentExtractedEventsForUser:async()=>[],saveExtractedEvent:async(args:unknown)=>args},
    './token-store':{getUserGoogleAuth:async()=>({userId:'owner',email:'owner@example.com',refreshToken:'test'})},
    './gemini':{extractEventFromSource:async(args:ExtractionRequest)=>{extractions.push(args);return {success:true,event:{title:'Rapat',start_time:'2099-10-20T09:00:00+07:00',end_time:'2099-10-20T11:00:00+07:00',location:'A'}};}},
    './photo-matcher':{extractPhotoMetadata:async()=>({hasCameraExif:false})},
    './duplicate-detector':{findDuplicateEvent:()=>({isDuplicate:false})},
    './google-calendar-api':{syncGoogleCalendarEventWithSource:async(args:{calendarId:string})=>{assert.equal(args.calendarId,'team');inserts++;return {insertResult:{success:true,eventId:'same-event'},gdriveResult:{success:true},attachmentResult:{attached:true}};}},
  },{process:{env,cwd:()=>'/isolated'},fetch:async(url:string,args?:{body:string})=>{
    if(url.includes('/getFile'))return Response.json({ok:true,result:{file_path:'raw.bin'}});
    if(url.includes('/file/')){downloads++;return new Response(fileContent);}
    if(args?.body)messages.push(JSON.parse(args.body).text||'');
    return Response.json({ok:true,result:{message_id:1}});
  }});
  const handler=runtime.load<typeof import('../lib/telegram-handler')>('lib/telegram-handler.ts');
  const make=(id:number):TelegramUpdate=>({update_id:id,message:{message_id:id,from:{id:123,is_bot:false,first_name:'Test'},chat:{id:123,type:'private'},date:0}});
  const image=make(1);image.message!.document={file_id:'png',file_name:'undangan.png',mime_type:'image/png'};image.message!.caption='#poster';
  await handler.handleTelegramWebhook(image,'test-bot','test-key','https://example.com');
  assert.equal(extractions.at(-1)?.sourceType,'image');assert.equal(extractions.at(-1)?.mimeType,'image/png');assert.ok(image.message!.document,'Input queue payload must remain intact');
  const txt=make(2);txt.message!.document={file_id:'txt',file_name:'undangan.txt',mime_type:'text/plain'};
  await handler.handleTelegramWebhook(txt,'test-bot','test-key','https://example.com');
  assert.equal(extractions.at(-1)?.sourceType,'text');assert.equal(extractions.at(-1)?.text,fileContent);assert.equal(inserts,2);
  const large=make(3);large.message!.document={file_id:'huge',file_name:'huge.pdf',mime_type:'application/pdf',file_size:30*1024*1024};
  const before=downloads;await handler.handleTelegramWebhook(large,'test-bot','test-key','https://example.com');assert.equal(downloads,before);assert.match(messages.at(-1)||'',/terlalu besar/);
  env.TELEGRAM_MAX_FILE_BYTES='1024';fileContent='x'.repeat(2000);
  await assert.rejects(()=>handler.downloadTelegramFile({botToken:'test-bot',fileId:'unknown-size'}),/melampaui batas/);

  const storeRuntime=createLoader();
  const store=storeRuntime.load<typeof import('../lib/event-lifecycle-store')>('lib/event-lifecycle-store.ts');
  storeRuntime.files.set(path.join('/isolated','.user_events.json'),JSON.stringify([
    {id:'one',user_id:'owner',title:'Rapat Lampau',start_time:'2020-01-01T09:00:00+07:00',end_time:'2020-01-01T11:00:00+07:00'},
    {id:'two',user_id:'owner',title:'Learning Series',start_time:'2099-10-21T09:00:00+07:00',end_time:'2099-10-21T11:00:00+07:00'},
    {id:'other',user_id:'other',title:'Rapat Lampau',start_time:'2020-01-01T09:00:00+07:00',end_time:'2020-01-01T11:00:00+07:00'}]));
  assert.equal((await store.listOwnedAgenda({userId:'owner'},'active',1,{past:true})).events[0].id,'one');
  assert.equal((await store.listOwnedAgenda({userId:'owner'},'active',1,{search:'Lampau'})).total,1);
  assert.equal((await store.listOwnedAgenda({userId:'owner'},'active',1,{from:'2099-10-21T00:00:00+07:00',to:'2099-10-22T00:00:00+07:00'})).events[0].id,'two');
  assert.equal((await store.listOwnedAgenda({userId:'owner'},'active')).total,1);
  const api=runtime.load<typeof import('../lib/telegram-api')>('lib/telegram-api.ts');
  assert.equal((await api.telegramCall('test-bot','sendMessage',{text:'test'})).ok,true);
  console.log('PASS: image-as-document/TXT ingestion, original MIME/input preservation, per-user Calendar target, early and streaming size limits, past/search/date-range ownership');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
