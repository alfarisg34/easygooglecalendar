interface TelegramResponse {ok:boolean;result?:{message_id?:number};error_code?:number;description?:string;parameters?:{retry_after?:number}}
/** Read each response once, redact transport errors, and retry only parsing/flood-control failures. */
export async function telegramCall(token:string,method:string,payload:Record<string,unknown>):Promise<TelegramResponse> {
  let body={...payload};
  for(let attempt=0;attempt<3;attempt++) {
    try {
      const response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
      const data=await response.json() as TelegramResponse;
      if(data.ok)return data;
      if(data.error_code===400 && /parse entities|can't parse|unsupported start tag/i.test(data.description||'') && body.parse_mode) {delete body.parse_mode;continue;}
      if(data.error_code===429 && (data.parameters?.retry_after||0)<=5) {await new Promise(resolve=>setTimeout(resolve,Math.max(1,data.parameters?.retry_after||1)*1000));continue;}
      return {ok:false,error_code:data.error_code};
    } catch { return {ok:false}; }
  }
  return {ok:false};
}
