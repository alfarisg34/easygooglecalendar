import { randomBytes, createHash } from 'crypto';
import { DateTime } from 'luxon';
import { CalendarEvent, EventUpdate, TelegramUpdate } from './types';
import { TelegramSource, telegramContext } from './telegram-context';
import { BotState, botIdentity, readBotState, writeBotState } from './telegram-state';
import { EventOwner, findOwnedEvent, ownerIds, readAgendaSession, writeAgendaSession } from './event-lifecycle-store';
import { mergeEventUpdate, updateExistingEvent } from './event-update';
import { changeEventLifecycle, resolveCalendarIdentity } from './event-lifecycle';
import { ExtractedEventRecord, UserRecord, getRecentExtractedEventsForUser, getUserByTelegram, getUserExtractedEvents, saveEventDocumentation, updateEventGdriveFolder } from './db';
import { attachDriveFileToCalendarEvent } from './google-calendar-api';
import { createDriveFolder, buildEventFolderName, uploadDocumentationPhotoToDrive, uploadFileToDrive } from './google-drive-api';
import { extractPhotoMetadata, detectWatermarkTimestamp, resolvePhotoTimestamp, matchPhotoToUserEvents } from './photo-matcher';
import { buildGoogleCalendarUrl } from './calendar-builder';

interface PhotoSource extends TelegramSource { takenAt?:string; method?:string }
interface Workflow {
  type:'photo'|'update'|'undo'|'create'|'archive'; actor:number; chat:number; bot:string; owner:EventOwner;
  event?:CalendarEvent; eventId?:string; version?:number; update?:EventUpdate; before?:EventUpdate;
  sources:PhotoSource[]; ids?:string[]; page?:number; search?:string; consumed?:boolean;
  processingUntil?:number;
  planned?:Pick<ExtractedEventRecord,'start_time'|'end_time'|'location'>;
  uploaded?:{fileId:string;fileUrl:string;fileName?:string;mimeType?:string};
}
interface WorkflowParams { botToken:string;chatId:number;userId:number;owner:EventOwner }
type Buttons=Array<{text:string;callback_data?:string;url?:string}>;
const tokenFor = () => randomBytes(12).toString('hex');
const scope=(params:WorkflowParams)=>({actor:params.userId,chat:params.chatId,bot:botIdentity(params.botToken),owner:params.owner});
const stamp=(iso:string)=>DateTime.fromISO(iso).setZone('Asia/Jakarta').toFormat('dd MMM yyyy HH:mm');
async function send(botToken:string,chatId:number,text:string,inlineButtons?:Buttons) {
  const {sendTelegramMessage}=await import('./telegram-handler');
  return sendTelegramMessage({botToken,chatId,text,inlineButtons});
}
async function saveAction(value:Workflow,ttl=15*60000):Promise<string> {
  const token=tokenFor();
  await writeBotState(`action:${token}`,'action',value,0,Date.now(),Date.now()+ttl);
  return token;
}
export async function sourceData(botToken:string,source:TelegramSource) {
  if(source.fileId) {
    const {downloadTelegramFile}=await import('./telegram-handler');
    const data=await downloadTelegramFile({botToken,fileId:source.fileId});
    return {...source,base64Data:data.base64Data,mimeType:source.mimeType||data.mimeType};
  }
  return {...source};
}
export function currentSource(fallback?:TelegramSource):TelegramSource[] {
  const source=telegramContext.getStore()?.source||fallback;
  return source?[source]:[];
}
export async function offerCreateConfirmation(params:WorkflowParams & {event:CalendarEvent;sources:TelegramSource[]}):Promise<void> {
  const token=await saveAction({...scope(params),type:'create',event:params.event,sources:params.sources});
  const valid=Boolean(params.event.start_time && params.event.end_time);
  await send(params.botToken,params.chatId,`Periksa agenda: ${params.event.title}\n${params.event.validation_warnings?.join('\n')||''}\n${valid?`Waktu: ${stamp(params.event.start_time)} WIB\nTempat: ${params.event.location}\nTekan Simpan jika sudah benar.`:`Lengkapi tanggal/jam dengan:\n/lengkapi ${token} YYYY-MM-DD HH:mm HH:mm\nContoh: /lengkapi ${token} 2026-10-20 09:00 11:00`}\nTidak ada agenda yang dibuat sebelum konfirmasi.`,
    valid?[{text:'Simpan agenda',callback_data:`tg:${token}:yes`},{text:'Batalkan',callback_data:`tg:${token}:no`}]:[{text:'Batalkan',callback_data:`tg:${token}:no`}]);
}
export async function offerUpdateConfirmation(params:WorkflowParams & {record:ExtractedEventRecord;update:EventUpdate;sources:TelegramSource[]}):Promise<void> {
  const next=mergeEventUpdate(params.record,params.update);
  const oldStart=DateTime.fromISO(params.record.start_time).setZone('Asia/Jakarta');const oldEnd=DateTime.fromISO(params.record.end_time).setZone('Asia/Jakarta');
  const token=await saveAction({...scope(params),type:'update',eventId:params.record.id,version:params.record.lifecycle_version||0,update:params.update,sources:params.sources,
    before:{date:oldStart.toISODate()!,end_date:oldEnd.toISODate()!,start_clock:oldStart.toFormat('HH:mm:ss'),end_clock:oldEnd.toFormat('HH:mm:ss'),location:params.record.location||''},planned:{start_time:next.start_time,end_time:next.end_time,location:next.location}});
  await send(params.botToken,params.chatId,`Perubahan ${params.record.title}\n\nSemula: ${stamp(params.record.start_time)}–${DateTime.fromISO(params.record.end_time).setZone('Asia/Jakarta').toFormat('HH:mm')} WIB\nTempat: ${params.record.location||'-'}\n\nMenjadi: ${stamp(next.start_time)}–${DateTime.fromISO(next.end_time).setZone('Asia/Jakarta').toFormat('HH:mm')} WIB\nTempat: ${next.location||'-'}\n\nKonfirmasi perubahan?`,[{text:'Ya, perbarui',callback_data:`tg:${token}:yes`},{text:'Batalkan',callback_data:`tg:${token}:no`}]);
}
async function photoPage(params:WorkflowParams,token:string,row:BotState<Workflow>,page:number,search='') {
  const result=await getUserExtractedEvents({userId:params.owner.userId,email:params.owner.email,telegramChatId:params.owner.telegramChatId,page,limit:5,status:'active',search});
  const value={...row.value,ids:result.events.map(e=>e.id),page,search};
  if(!await writeBotState(row.id,row.kind,value,row.version,Date.now(),row.expires))throw new Error('Daftar berubah. Coba pilih kembali.');
  await send(params.botToken,params.chatId,`Pilih kegiatan untuk ${value.sources.length} foto. Halaman ${page}/${Math.max(1,result.totalPages)}.\n${result.events.map((e,i)=>`${i+1}. ${e.title.slice(0,110)}\n${stamp(e.start_time)} WIB`).join('\n\n')}\n\nCari kegiatan: /pilih ${token} kata pencarian`,[
    ...result.events.map((_,i)=>({text:`${i+1}`,callback_data:`tg:${token}:${row.version+1}_${i}`})),
    ...(page>1?[{text:'Sebelumnya',callback_data:`tg:${token}:prev`}]:[]),
    ...(page<result.totalPages?[{text:'Berikutnya',callback_data:`tg:${token}:next`}]:[]),
    {text:'Batalkan',callback_data:`tg:${token}:no`}
  ]);
}
export async function offerPhotoSelection(params:WorkflowParams & {sources:PhotoSource[];reason:string}) {
  const token=await saveAction({...scope(params),type:'photo',sources:params.sources},60*60000);
  await send(params.botToken,params.chatId,params.reason);
  const row=await readBotState<Workflow>(`action:${token}`);
  if(row)await photoPage(params,token,row,1);
}
async function uploadPhotos(params:WorkflowParams,record:ExtractedEventRecord,sources:PhotoSource[],user:UserRecord|null):Promise<void> {
  let successful=0;
  for(const source of sources) {
    const data=await sourceData(params.botToken,source);
    if(!('base64Data' in data)||!data.base64Data)throw new Error('Berkas foto tidak tersedia.');
    const buffer=Buffer.from(data.base64Data,'base64');
    const result=await uploadDocumentationPhotoToDrive({userId:params.owner.userId,event:record,parentFolderId:user?.gdrive_root_folder_id,
      buffer,originalFileName:source.fileName||'foto_telegram.jpg',mimeType:source.mimeType||'image/jpeg',takenAtIso:source.takenAt,
      deduplicationKey:`photo:${params.owner.userId}:${record.id}:${source.fileId}`});
    if(!result.success || !result.fileId)throw new Error('Unggah foto belum berhasil. Periksa /status dan coba kembali.');
    if(result.folderId && !record.gdrive_folder_id) {
      await updateEventGdriveFolder({eventId:record.id,folderId:result.folderId,folderUrl:result.folderUrl||''});
      record.gdrive_folder_id=result.folderId;record.gdrive_folder_url=result.folderUrl;
    }
    await saveEventDocumentation({event_id:record.id,user_id:params.owner.userId,gdrive_file_id:result.fileId,gdrive_file_url:result.fileUrl||'',
      file_name:result.fileName,file_size:buffer.length,mime_type:source.mimeType||'image/jpeg',taken_at:source.takenAt,match_method:source.method||'manual_selection'});
    successful++;
  }
  await send(params.botToken,params.chatId,`${successful} foto dokumentasi berhasil diarsipkan.\nKegiatan: ${record.title}\n${stamp(record.start_time)} WIB\n${sources.some(s=>!s.takenAt)?'Waktu pengambilan sebagian foto tidak terbaca; tujuan dipilih manual.':''}`,
    record.gdrive_folder_url?[{text:'Buka folder kegiatan',url:record.gdrive_folder_url}]:undefined);
}
export async function handleDocumentationAlbum(updates:TelegramUpdate[],botToken:string,origin:string) {
  const first=updates[0].message;if(!first)return;
  if(first.chat.type!=='private') {await send(botToken,first.chat.id,'Kirim album melalui chat pribadi dengan bot agar akun dan kegiatan Anda tetap privat.');return;}
  const user=await getUserByTelegram({tgUserId:first.from.id});
  if(!user) {await send(botToken,first.chat.id,'Hubungkan akun dengan /connect sebelum mengarsipkan foto.');return;}
  const params={botToken,chatId:first.chat.id,userId:first.from.id,owner:{userId:user.id,email:user.email,telegramChatId:String(first.from.id)}};
  const sources:PhotoSource[]=updates.flatMap(update=>{
    const msg=update.message;const file=msg?.photo?.at(-1);
    return file?[{fileId:file.file_id,fileName:'foto_album.jpg',mimeType:'image/jpeg',sourceType:'image' as const}]:[];
  });
  await send(botToken,first.chat.id,`Menerima ${sources.length} foto. Memeriksa waktu dan kegiatan tujuan…`);
  const records=await getRecentExtractedEventsForUser(ownerIds(params.owner),50);
  let chosen:string|undefined;
  for(const source of sources) {
    const data=await sourceData(botToken,source);
    if(!('base64Data' in data))continue;
    const metadata=await extractPhotoMetadata(Buffer.from(data.base64Data,'base64'));
    // Albums use EXIF when present; otherwise one manual selection avoids repeated slow OCR calls.
    source.takenAt=metadata.takenAt||undefined;source.method=metadata.takenAt?'exif_timestamp':'manual_selection';
    const match=source.takenAt?matchPhotoToUserEvents({photoTimeIso:source.takenAt,events:records}):null;
    if(!match?.bestMatch || (chosen && chosen!==match.bestMatch.id)) {chosen=undefined;break;}
    chosen=match.bestMatch.id;
  }
  const record=chosen?await findOwnedEvent(params.owner,chosen):null;
  if(record)await uploadPhotos(params,record,sources,user);
  else await offerPhotoSelection({...params,sources,reason:'Pilih satu kegiatan tujuan untuk seluruh album. Foto belum diunggah.'});
}
/** Persist only Telegram file references/text, never entire downloaded binaries. */
export async function registerArchiveRecovery(params:WorkflowParams & {record:ExtractedEventRecord;source:TelegramSource;uploaded?:Workflow['uploaded']}):Promise<{text:string;callback_data:string}> {
  const token=await saveAction({...scope(params),type:'archive',eventId:params.record.id,sources:[params.source],uploaded:params.uploaded},86400000);
  return {text:'Coba arsip/lampiran lagi',callback_data:`tg:${token}:yes`};
}
async function archiveRevision(params:WorkflowParams,record:ExtractedEventRecord,source:TelegramSource,user:UserRecord|null,uploaded?:Workflow['uploaded']) {
  let file=uploaded;
  if(!file) {
    let folder=record.gdrive_folder_id;
    if(!folder) {
      const created=await createDriveFolder({userId:params.owner.userId,folderName:buildEventFolderName(record as CalendarEvent),parentFolderId:user?.gdrive_root_folder_id,deduplicationKey:`event:${record.id}`});
      if(!created.success||!created.folderId)throw new Error('Folder arsip belum tersedia.');
      folder=created.folderId;
      await updateEventGdriveFolder({eventId:record.id,folderId:folder,folderUrl:created.folderUrl||''});
    }
    const data=await sourceData(params.botToken,source);
    const buffer='base64Data' in data?Buffer.from(data.base64Data,'base64'):Buffer.from(source.textContent||'','utf8');
    const result=await uploadFileToDrive({userId:params.owner.userId,folderId:folder,buffer,fileName:source.fileName||'revisi_undangan.txt',mimeType:source.mimeType||'text/plain',
      deduplicationKey:`source:${record.id}:${createHash('sha256').update(source.fileId||source.textContent||'').digest('hex')}`});
    if(!result.success||!result.fileId||!result.fileUrl)throw new Error('Unggah sumber belum berhasil.');
    file={fileId:result.fileId,fileUrl:result.fileUrl,fileName:result.fileName,mimeType:result.mimeType};
  }
  if(!record.synced_to_calendar)throw new Error('Event belum terhubung ke Google Calendar.');
  const identity=resolveCalendarIdentity(record,user?.calendar_id||'primary');
  const auditId=`source-archive:${record.id}:${file.fileId}`;
  const previous=await readBotState<{eventId:string}>(auditId);
  await writeBotState(auditId,'source-archive',{eventId:record.id,userId:params.owner.userId,file,recordedAt:new Date().toISOString()},previous?.version||0,Date.now(),Date.now()+365*86400000);
  const result=await attachDriveFileToCalendarEvent({userId:params.owner.userId,eventId:identity.eventId,calendarId:identity.calendarId,file});
  if(!result.attached) {
    const button=await registerArchiveRecovery({...params,record,source,uploaded:file});
    await send(params.botToken,params.chatId,'Berkas tersimpan di Drive; lampiran Calendar belum terpasang. Coba kembali setelah memeriksa koneksi.',[button]);
  } else await send(params.botToken,params.chatId,'Berkas sumber tersimpan di folder kegiatan dan terlampir di event Calendar yang sama.');
}
export async function handleWorkflowInput(params:WorkflowParams & {update:TelegramUpdate;user:UserRecord|null;hostOrigin:string}):Promise<boolean> {
  const text=params.update.message?.text||'';
  const callback=params.update.callback_query;
  const parts=callback?.data?.split(':');
  const archive=/^\/arsip\s+(\d+)\s*$/i.exec(text);
  if(archive) {
    const session=await readAgendaSession(`${createHash('sha256').update(params.botToken).digest('hex').slice(0,16)}:${params.chatId}:${params.userId}:${params.owner.userId}`);
    const record=await findOwnedEvent(params.owner,session?.ids[Number(archive[1])-1]||'');
    if(!record?.gdrive_file_id||!record.gdrive_file_url)await send(params.botToken,params.chatId,'Sumber belum tersedia pada riwayat ini. Gunakan tombol Coba arsip/lampiran lagi pada hasil unggahan yang gagal (berlaku 24 jam). Untuk event lama, unggah sumber revisi melalui alur /update.');
    else {
      const button=await registerArchiveRecovery({...params,record,source:{sourceType:(record.source_type==='image'?'image':record.source_type==='text'?'text':'pdf'),fileName:record.file_name},
        uploaded:{fileId:record.gdrive_file_id,fileUrl:record.gdrive_file_url,fileName:record.file_name}});
      await send(params.botToken,params.chatId,`Pasang kembali berkas sumber pada event ${record.title}?`,[button]);
    }
    return true;
  }
  const complete=/^\/lengkapi\s+([a-f0-9]{24})\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+(\d{2}:\d{2})\s*$/i.exec(text);
  const search=/^\/pilih\s+([a-f0-9]{24})\s+(.{1,150})$/i.exec(text);
  if(parts?.[0]!=='tg' && !complete && !search)return false;
  if(callback)await fetch(`https://api.telegram.org/bot${params.botToken}/answerCallbackQuery`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({callback_query_id:callback.id}),signal:AbortSignal.timeout(5000)}).catch(()=>{});
  const token=complete?.[1]||search?.[1]||parts?.[1];
  const row=await readBotState<Workflow>(`action:${token}`);
  if(!row || row.value.consumed || row.value.actor!==params.userId || row.value.chat!==params.chatId || row.value.bot!==botIdentity(params.botToken)||row.value.owner.userId!==params.owner.userId) {
    await send(params.botToken,params.chatId,'Pilihan tidak berlaku, sudah digunakan, atau bukan milik akun ini. Mulai kembali dari /agenda.');return true;
  }
  const value=row.value;const action=complete?'yes':parts?.[2];
  if(value.type!=='photo' && !complete && !['yes','no'].includes(action||''))return true;
  if(value.processingUntil && value.processingUntil>Date.now()) {await send(params.botToken,params.chatId,'Pilihan sedang diproses. Tunggu hasilnya.');return true;}
  if(value.type==='photo' && (search || action==='next'||action==='prev')) {
    await photoPage(params,token!,row,search?1:Math.max(1,(value.page||1)+(action==='next'?1:-1)),search?.[2]||value.search);return true;
  }
  if(complete && value.type==='create' && value.event) {
    const start=DateTime.fromISO(`${complete[2]}T${complete[3]}`,{zone:'Asia/Jakarta'});
    const end=DateTime.fromISO(`${complete[2]}T${complete[4]}`,{zone:'Asia/Jakarta'});
    if(!start.isValid||!end.isValid||end<=start) {await send(params.botToken,params.chatId,'Tanggal/jam tidak valid. Waktu selesai harus setelah mulai.');return true;}
    value.event={...value.event,start_time:start.toISO()!,end_time:end.toISO()!,needs_confirmation:false,validation_warnings:[]};
    value.event.google_calendar_url=buildGoogleCalendarUrl(value.event);
    // Completing a date shows a preview before the subsequent save click.
    await writeBotState(row.id,row.kind,value,row.version,Date.now(),row.expires);
    await send(params.botToken,params.chatId,`${value.event.title}\n${stamp(value.event.start_time)}–${complete[4]} WIB\n${value.event.location}\nSimpan agenda ini?`,[{text:'Simpan agenda',callback_data:`tg:${token}:yes`},{text:'Batalkan',callback_data:`tg:${token}:no`}]);return true;
  }
  let record=value.eventId?await findOwnedEvent(params.owner,value.eventId):null;
  if(action!=='no') {
    if(value.type==='photo') {
      const selected=/^(\d+)_(\d+)$/.exec(action||'');
      if(!selected || Number(selected[1])!==row.version) {await send(params.botToken,params.chatId,'Pilihan berasal dari daftar lama. Gunakan tombol pada daftar terbaru.');return true;}
      record=await findOwnedEvent(params.owner,value.ids?.[Number(selected[2])]||'');
      if(!record || record.activity_status==='cancelled') {await send(params.botToken,params.chatId,'Kegiatan tidak tersedia. Cari dan pilih kegiatan kembali.');return true;}
    } else if(value.type!=='create' && (!record || (value.version!==undefined && (record.lifecycle_version||0)!==value.version
      && !(value.planned && (record.lifecycle_version||0)<=(value.version+2) && record.start_time===value.planned.start_time && record.end_time===value.planned.end_time && (record.location||'')===(value.planned.location||''))))) {
      await send(params.botToken,params.chatId,'Kegiatan sudah berubah. Ketik /agenda dan pilih kembali.');return true;
    }
  }
  if(!await writeBotState(row.id,row.kind,{...value,processingUntil:Date.now()+300000},row.version,Date.now(),row.expires))return true;
  if(action==='no') {
    await writeBotState(row.id,row.kind,{...value,consumed:true},row.version+1,Date.now(),row.expires);
    await send(params.botToken,params.chatId,'Dibatalkan. Tidak ada perubahan.');return true;
  }
  try {
    if(value.type==='photo' && record)await uploadPhotos(params,record,value.sources,params.user);
    else if((value.type==='update'||value.type==='undo') && record && value.update) {
      const oldStart=DateTime.fromISO(record.start_time).setZone('Asia/Jakarta');const oldEnd=DateTime.fromISO(record.end_time).setZone('Asia/Jakarta');
      const result=(record.lifecycle_version||0)===(value.version||0)
        ?await updateExistingEvent({owner:params.owner,eventId:record.id,expectedVersion:value.version||0,update:value.update,calendarId:params.user?.calendar_id,restoring:value.type==='undo'})
        :record.lifecycle_sync==='processing'||record.lifecycle_sync==='error'
          ?await changeEventLifecycle({owner:params.owner,eventId:record.id,expectedVersion:record.lifecycle_version||0,action:'retry',channel:'telegram',calendarId:params.user?.calendar_id})
          :{event:record,message:'Perubahan sebelumnya sudah tersimpan. Melanjutkan pengarsipan sumber.'};
      const undo=await saveAction({...scope(params),type:'undo',eventId:result.event.id,version:result.event.lifecycle_version||0,sources:[],
        update:value.before||{date:oldStart.toISODate()!,end_date:oldEnd.toISODate()!,start_clock:oldStart.toFormat('HH:mm:ss'),end_clock:oldEnd.toFormat('HH:mm:ss'),location:record.location||''},
        before:{date:DateTime.fromISO(result.event.start_time).setZone('Asia/Jakarta').toISODate()!,end_date:DateTime.fromISO(result.event.end_time).setZone('Asia/Jakarta').toISODate()!,start_clock:DateTime.fromISO(result.event.start_time).setZone('Asia/Jakarta').toFormat('HH:mm:ss'),end_clock:DateTime.fromISO(result.event.end_time).setZone('Asia/Jakarta').toFormat('HH:mm:ss'),location:result.event.location||''}});
      await send(params.botToken,params.chatId,result.message,[{text:'Batalkan perubahan terakhir',callback_data:`tg:${undo}:yes`}]);
      if(value.sources[0]) {
        const button=await registerArchiveRecovery({...params,record:result.event,source:value.sources[0]});
        try {await archiveRevision(params,result.event,value.sources[0],params.user);}
        catch {await send(params.botToken,params.chatId,'Perubahan tersimpan; arsip surat revisi belum selesai.',[button]);}
      }
    } else if(value.type==='archive'&&record&&value.sources[0])await archiveRevision(params,record,value.sources[0],params.user,value.uploaded);
    else if(value.type==='create' && value.event) {
      if(!value.event.start_time||!value.event.end_time)throw new Error('Lengkapi tanggal/jam terlebih dahulu.');
      const {processAndDispatchEvent}=await import('./telegram-handler');
      const {getUserGoogleAuth}=await import('./token-store');
      const source=value.sources[0];
      const context=telegramContext.getStore();
      if(context) {context.operationId=`action:${token}`;context.source=source;}
      await processAndDispatchEvent({botToken:params.botToken,chatId:params.chatId,userId:params.userId,ownerConfirmed:true,event:{...value.event,needs_confirmation:false},hostOrigin:params.hostOrigin,
        dbUser:params.user,userAuth:await getUserGoogleAuth(params.owner.userId),sourceType:source?.sourceType||'text',fileName:source?.fileName,fileData:source?await sourceData(params.botToken,source):undefined});
    }
    const latest=await readBotState<Workflow>(row.id);
    if(latest)await writeBotState(latest.id,latest.kind,{...latest.value,consumed:true,processingUntil:0},latest.version,Date.now(),latest.expires);
  } catch {
    // Reopen a recoverable action with CAS. Version checks still protect completed schedule changes.
    const latest=await readBotState<Workflow>(row.id);
    if(latest)await writeBotState(latest.id,latest.kind,{...value,consumed:false,processingUntil:0},latest.version,Date.now(),latest.expires);
    await send(params.botToken,params.chatId,'Tindakan belum selesai. Periksa /status lalu coba tombol kembali. Perubahan kalender yang sudah tersimpan tidak dibuat ulang.');
  }
  return true;
}
