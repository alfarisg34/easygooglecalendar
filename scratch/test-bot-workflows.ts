import assert from 'node:assert/strict';
import path from 'node:path';
import { createLoader } from './test-loader.ts';
import type { ExtractedEventRecord } from '../lib/db';
import type { TelegramUpdate,CalendarEvent } from '../lib/types';

async function main() {
  const owner={userId:'owner',email:'owner@example.com',telegramChatId:'123'};
  const fixture:ExtractedEventRecord={id:'event',user_id:'owner',title:'Rapat Koordinasi Nasional',start_time:'2099-10-20T09:00:00.000+07:00',end_time:'2099-10-20T11:00:00.000+07:00',location:'Ruang A',created_at:'2026-10-14T00:00:00Z',google_event_id:'keep-event',google_calendar_id:'team',synced_to_calendar:true,gdrive_folder_id:'keep-folder',gdrive_folder_url:'https://drive.google.com/drive/folders/keep-folder'};
  const messages:Array<{text:string;inlineButtons?:Array<{text:string;callback_data?:string}>}>=[];
  let patches=0,uploads=0,attachments=0,photos=0,docs=0,creates=0,attachmentFailure=false;
  const eventsPath=path.join('/isolated','.user_events.json');
  const runtime=createLoader({
    './telegram-handler':{sendTelegramMessage:async(message:typeof messages[number])=>{messages.push(message);return {ok:true};},downloadTelegramFile:async()=>({base64Data:Buffer.from('original-source').toString('base64'),mimeType:'application/pdf'}),processAndDispatchEvent:async(args:{event:CalendarEvent;ownerConfirmed:boolean})=>{creates++;assert.equal(args.ownerConfirmed,true);assert.ok(args.event.start_time);}},
    './token-store':{getUserGoogleAuth:async()=>({refreshToken:'test',userId:'owner'}),saveUserGoogleAuth:async()=>{}},
    './google-auth':{getGoogleOAuth2Client:()=>({setCredentials:()=>{},on:()=>{}})},
    googleapis:{google:{calendar:()=>({events:{get:async()=>({data:{id:'keep-event',etag:'one',summary:'Rapat Koordinasi Nasional'}}),patch:async(args:{eventId:string})=>{assert.equal(args.eventId,'keep-event');patches++;return {data:{}};}}})}},
    './google-calendar-api':{attachDriveFileToCalendarEvent:async(args:{eventId:string;file:{fileId:string}})=>{attachments++;assert.equal(args.eventId,'keep-event');assert.equal(args.file.fileId,'revision-file');return {attached:!attachmentFailure,error:'simulated'};}},
    './google-drive-api':{buildEventFolderName:()=>'',createDriveFolder:async()=>{throw new Error('Must reuse existing event folder');},uploadFileToDrive:async(args:{folderId:string;buffer:Buffer;deduplicationKey:string})=>{uploads++;assert.equal(args.folderId,'keep-folder');assert.equal(args.buffer.toString(),'original-source');assert.ok(args.deduplicationKey);return {success:true,fileId:'revision-file',fileUrl:'https://drive.google.com/file/d/revision-file/view'};},uploadDocumentationPhotoToDrive:async(args:{event:ExtractedEventRecord;takenAtIso?:string})=>{photos++;assert.equal(args.event.id,'event');assert.equal(args.takenAtIso,undefined);return {success:true,fileId:`photo-${photos}`,fileUrl:'https://drive.google.com/file/photo',folderUrl:fixture.gdrive_folder_url};}},
    './db':{initDatabase:async()=>true,updateUserGoogleTokens:async()=>{},saveEventDocumentation:async(args:{taken_at?:string})=>{assert.equal(args.taken_at,undefined);docs++;},getUserExtractedEvents:async()=>({events:[current()],total:1,totalPages:1}),updateEventGdriveFolder:async()=>{},getUserByTelegram:async()=>({id:'owner'})},
  },{fetch:async()=>Response.json({ok:true})});
  runtime.files.set(eventsPath,JSON.stringify([fixture]));
  function current():ExtractedEventRecord {return JSON.parse(runtime.files.get(eventsPath)!)[0] as ExtractedEventRecord;}
  const workflow=runtime.load<typeof import('../lib/telegram-workflows')>('lib/telegram-workflows.ts');
  const params={botToken:'bot',chatId:123,userId:123,owner};
  const user={id:'owner',email:'owner@example.com'};
  const callback=(data:string,actor=123)=>workflow.handleWorkflowInput({...params,userId:actor,user,hostOrigin:'https://example.com',update:{update_id:1,callback_query:{id:'tap',data,from:{id:actor,is_bot:false,first_name:'Test'}}}});
  await workflow.offerUpdateConfirmation({...params,record:fixture,update:{start_clock:'13:00',location:'Ruang B'},sources:[{sourceType:'pdf',fileId:'pdf-file',fileName:'surat_revisi.pdf',mimeType:'application/pdf'}]});
  assert.equal(patches,0);assert.equal(current().location,'Ruang A');assert.match(messages.at(-1)!.text,/Semula:[\s\S]*Menjadi:/);
  const confirm=messages.at(-1)!.inlineButtons![0].callback_data!;
  await callback(confirm,999);assert.equal(patches,0);
  await callback(confirm);assert.equal(patches,1);assert.equal(current().location,'Ruang B');assert.equal(current().gdrive_folder_id,'keep-folder');
  assert.equal(uploads,1);assert.equal(attachments,1);
  const undo=messages.find(m=>m.inlineButtons?.some(b=>b.text==='Batalkan perubahan terakhir'))!.inlineButtons![0].callback_data!;
  await callback(confirm);assert.equal(patches,1,'A repeated callback cannot apply twice');
  await callback(undo);assert.equal(patches,2);assert.equal(current().location,'Ruang A');assert.equal(Date.parse(current().start_time),Date.parse(fixture.start_time));
  const history=current() as ExtractedEventRecord & {lifecycle_history:Array<{reason:string}>};
  assert.ok(history.lifecycle_history.some(entry=>entry.reason.includes('→')),'Before/after audit recorded');

  attachmentFailure=true;
  const recovery=await workflow.registerArchiveRecovery({...params,record:current(),source:{sourceType:'pdf',fileId:'pdf-file'},uploaded:{fileId:'revision-file',fileUrl:'https://drive.google.com/file/d/revision-file/view'}});
  await callback(recovery.callback_data);assert.equal(uploads,1,'Attachment retry must not upload again');
  const retry=messages.at(-1)!.inlineButtons![0].callback_data!;attachmentFailure=false;await callback(retry);assert.equal(uploads,1);assert.match(messages.at(-1)!.text,/event Calendar yang sama/);
  await workflow.offerPhotoSelection({...params,sources:[{sourceType:'image',fileId:'photo-a'},{sourceType:'image',fileId:'photo-b'}],reason:'Waktu tidak terbaca'});
  const choose=messages.at(-1)!.inlineButtons![0].callback_data!;
  const photoToken=choose.split(':')[1];
  await workflow.handleWorkflowInput({...params,user,hostOrigin:'https://example.com',update:{update_id:2,message:{message_id:2,from:{id:123,is_bot:false,first_name:'Test'},chat:{id:123,type:'private'},date:0,text:`/pilih ${photoToken} Rapat`}}});
  const freshChoice=messages.at(-1)!.inlineButtons![0].callback_data!;
  await callback(choose);assert.equal(photos,0,'Old-page buttons cannot select a new-page event');
  await callback(freshChoice);assert.equal(photos,2);assert.equal(docs,2);assert.match(messages.at(-1)!.text,/2 foto dokumentasi berhasil/);assert.equal(patches,2);
  await callback(freshChoice);assert.equal(photos,2);
  const gemini=runtime.load<typeof import('../lib/gemini')>('lib/gemini.ts');
  const incomplete=gemini.normalizeCalendarEvent({title:'Undangan tanpa tanggal'});
  assert.equal(incomplete.start_time,'');assert.equal(incomplete.end_time,'');assert.equal(incomplete.needs_confirmation,true);
  assert.equal(gemini.normalizeCalendarEvent({start_time:'2026-02-30T09:00:00+07:00'}).start_time,'');
  assert.equal(gemini.normalizeCalendarEvent({start_time:'2026-10-20'}).start_time,'');
  assert.equal(gemini.normalizeCalendarEvent({...fixture,needs_confirmation:true,validation_warnings:['Jam selesai diasumsikan dari s.d. selesai.']}).needs_confirmation,true);
  const updateService=runtime.load<typeof import('../lib/event-update')>('lib/event-update.ts');
  const overnight=updateService.mergeEventUpdate(fixture,{date:'2099-10-20',end_date:'2099-10-21',start_clock:'23:00:00',end_clock:'01:00:00',location:''},true);
  assert.ok(Date.parse(overnight.end_time)>Date.parse(overnight.start_time));assert.equal(overnight.location,'');
  await workflow.offerCreateConfirmation({...params,event:incomplete,sources:[{sourceType:'text',textContent:'Undangan tanpa tanggal'}]});
  const cancel=messages.at(-1)!.inlineButtons![0].callback_data!;const token=cancel.split(':')[1];
  const update:TelegramUpdate={update_id:99,message:{message_id:99,chat:{id:123,type:'private'},from:{id:123,is_bot:false,first_name:'Test'},date:0,text:`/lengkapi ${token} 2099-10-21 09:00 11:00`}};
  await workflow.handleWorkflowInput({...params,user,hostOrigin:'https://example.com',update});assert.equal(creates,0);
  await callback(messages.at(-1)!.inlineButtons![0].callback_data!);assert.equal(creates,1);
  console.log('PASS: update preview/confirmation/ownership/replay/undo/audit, revision archival, attachment retry without reupload, manual album selection/one result, missing-date completion before creation');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
