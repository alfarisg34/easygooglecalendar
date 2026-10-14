import assert from 'node:assert/strict';
import { createLoader } from './test-loader.ts';
import type { CalendarEvent } from '../lib/types';
import type { drive_v3,calendar_v3 } from 'googleapis';

async function main() {
  const events=new Map<string,calendar_v3.Schema$Event>();const files:drive_v3.Schema$File[]=[];
  let inserted=0,uploaded=0,folders=0;
  const runtime=createLoader({
    './token-store':{getUserGoogleAuth:async()=>({userId:'owner',refreshToken:'test'}),saveUserGoogleAuth:async()=>{}},
    './google-auth':{getGoogleOAuth2Client:()=>({setCredentials:()=>{},on:()=>{}})},'./db':{updateUserGoogleTokens:async()=>{}},
    googleapis:{google:{calendar:()=>({events:{
      insert:async(args:{requestBody:calendar_v3.Schema$Event})=>{const id=args.requestBody.id!;if(events.has(id))throw Object.assign(new Error('conflict'),{code:409});inserted++;events.set(id,{...args.requestBody,etag:'v1'});return {data:events.get(id)};},
      get:async(args:{eventId:string})=>({data:events.get(args.eventId)}),
      patch:async(args:{eventId:string;requestBody:calendar_v3.Schema$Event})=>{Object.assign(events.get(args.eventId)!,args.requestBody);return {data:events.get(args.eventId)};}
    }}),drive:()=>({files:{
      list:async(args:{q:string})=>{const marker=/value='([^']+)'/.exec(args.q)?.[1];return {data:{files:files.filter(file=>file.appProperties?.easycal_key===marker)}};},
      create:async(args:{requestBody:drive_v3.Schema$File;media?:{body:AsyncIterable<Buffer>}})=>{
        const id=`file-${files.length+1}`;if(args.media){uploaded++;for await(const _part of args.media.body){/* consume original bytes */}}else folders++;
        const file={...args.requestBody,id,webViewLink:`https://drive.google.com/file/d/${id}/view`};files.push(file);return {data:file};
      }
    }})}}
  });
  const service=runtime.load<typeof import('../lib/google-calendar-api')>('lib/google-calendar-api.ts');
  const context=runtime.load<typeof import('../lib/telegram-context')>('lib/telegram-context.ts');
  const event:CalendarEvent={title:'Rapat',start_time:'2099-10-20T09:00:00+07:00',end_time:'2099-10-20T11:00:00+07:00',location:'A',is_online:false,meeting_link:'',meeting_id_pass:'',jp:'',speakers:'',description:''};
  const run=(operationId:string)=>context.telegramContext.run({operationId},()=>service.syncGoogleCalendarEventWithSource({userId:'owner',calendarId:'team',event,fileData:{sourceType:'pdf',base64Data:Buffer.from('source').toString('base64'),fileName:'source.pdf',mimeType:'application/pdf'}}));
  const first=await run('job-one');const second=await run('job-one');
  assert.equal(first.insertResult.eventId,second.insertResult.eventId);assert.equal(inserted,1);assert.equal(folders,1);assert.equal(uploaded,1);
  assert.equal(second.attachmentResult.attached,true);assert.equal(events.get(first.insertResult.eventId!)?.attachments?.length,1);
  await run('job-two');assert.equal(inserted,2,'Different source operations retain distinct event identities');
  console.log('PASS: Calendar stable identity/409 recovery, Drive folder/file markers, preserving attachments and no repeated upload on job retry');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
