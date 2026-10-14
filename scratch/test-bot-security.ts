import assert from 'node:assert/strict';
import { createLoader } from './test-loader.ts';

async function main() {
  let session:{userId:string;email:string}|null=null;
  const identities:string[]=[];
  const requests:Array<{url:string;body:Record<string,unknown>}>=[];
  const env:Record<string,string>={SESSION_SECRET:'isolated-test-secret-with-at-least-32-characters',TELEGRAM_BOT_TOKEN:'global-secret-bot',TELEGRAM_ADMIN_EMAILS:'admin@example.com'};
  const runtime=createLoader({
    './auth-session':{getSessionFromRequest:async()=>session},
    '@/lib/auth-session':{getSessionFromRequest:async()=>session},
    '@/lib/token-store':{getUserGoogleAuth:async(id:string)=>{identities.push(id);return {refreshToken:'test'};},deleteUserGoogleAuth:async(id:string)=>identities.push(id)},
    './db':{getUserById:async()=>({telegram_bot_token:'personal-secret-bot'})},
  },{process:{env,cwd:()=>'/isolated'},fetch:async(url:string,args:{body:string})=>{
    requests.push({url,body:JSON.parse(args.body)});return Response.json({ok:true,result:{url:'https://example.com/api/telegram?bot_token=do-not-echo&gemini_key=do-not-echo'}});
  }});
  const security=runtime.load<typeof import('../lib/telegram-security')>('lib/telegram-security.ts');
  const setup=runtime.load<typeof import('../app/api/telegram/setup/route')>('app/api/telegram/setup/route.ts');
  const request=(body:unknown,origin='https://example.com')=>({url:'https://example.com/api/telegram/setup',method:'POST',headers:new Headers({origin}),json:async()=>body}) as Parameters<typeof setup.POST>[0];
  assert.equal((await setup.POST(request({action:'set_webhook'}))).status,403);
  session={userId:'owner',email:'owner@example.com'};
  assert.equal((await setup.POST(request({action:'set_webhook',botToken:'global-secret-bot'}))).status,403);
  assert.equal((await setup.POST(request({action:'set_webhook'},'https://evil.example'))).status,403);
  let response=await setup.POST(request({action:'set_webhook',botToken:'personal-secret-bot'}));
  assert.equal(response.status,200);
  const configured=await response.json() as {configuredWebhookUrl:string};
  assert.match(configured.configuredWebhookUrl,/\?bot=[a-f0-9]{24}$/);
  assert.ok(!JSON.stringify(configured).includes('secret-bot'));
  assert.equal(requests.at(-1)!.body.secret_token,security.webhookSecret('personal-secret-bot'));
  assert.ok(!JSON.stringify(requests.at(-1)!.body).includes('gemini_key'));
  assert.deepEqual(requests.at(-1)!.body.allowed_updates,['message','callback_query']);
  response=await setup.POST(request({action:'get_webhook_info'}));
  assert.ok(!JSON.stringify(await response.json()).includes('do-not-echo'));
  const count=requests.length;
  await setup.GET({...request({}),method:'GET',url:'https://example.com/api/telegram/setup?action=set'} as Parameters<typeof setup.GET>[0]);
  assert.equal(requests.length,count,'GET cannot mutate a webhook');
  session={userId:'admin',email:'admin@example.com'};
  assert.equal((await setup.POST(request({action:'set_webhook'}))).status,200);
  const status=runtime.load<typeof import('../app/api/auth/status/route')>('app/api/auth/status/route.ts');
  const forged={url:'https://example.com/api/auth/status?user_id=someone-else',headers:new Headers({origin:'https://example.com'})} as Parameters<typeof status.GET>[0];
  await status.GET(forged);await status.DELETE(forged);
  assert.deepEqual(identities,['admin','admin'],'Query parameters cannot select another account');
  session=null;assert.equal((await status.DELETE(forged)).status,401);

  const binding=await security.createTelegramBinding(123);
  const oauth=await security.createOAuthState(binding);
  assert.equal(await security.consumeOAuthState(oauth.state,'wrong-browser'),null);
  assert.equal((await security.consumeOAuthState(oauth.state,oauth.cookie))?.binding,binding);
  assert.equal(await security.consumeOAuthState(oauth.state,oauth.cookie),null,'OAuth state is single-use');
  assert.equal(await security.consumeTelegramBinding(binding),'123');
  assert.equal(await security.consumeTelegramBinding(binding),null);
  const stored=[...runtime.files.values()].join('');
  assert.ok(!stored.includes('personal-secret-bot') && !stored.includes('global-secret-bot'),'Tokens encrypted at rest');
  const state=runtime.load<typeof import('../lib/telegram-state')>('lib/telegram-state.ts');
  assert.equal(await state.writeBotState('cas','test',{v:1}),true);
  assert.equal(await state.writeBotState('cas','test',{v:2},0),false);
  assert.equal(await state.writeBotState('cas','test',{v:2},1),true);
  assert.equal((await state.readBotState<{v:number}>('cas'))?.value.v,2);
  env.NODE_ENV='production';delete env.DATABASE_URL;
  await assert.rejects(()=>state.readBotState('cas'),/Database persisten/);

  const messages:string[]=[];
  const handlerRuntime=createLoader({}, {fetch:async(_url:string,args:{body:string})=>{messages.push(JSON.parse(args.body).text);return Response.json({ok:true,result:{message_id:1}});}});
  const handler=handlerRuntime.load<typeof import('../lib/telegram-handler')>('lib/telegram-handler.ts');
  await handler.handleTelegramWebhook({update_id:1,message:{message_id:1,chat:{id:123,type:'private'},from:{id:123,is_bot:false,first_name:'Test'},date:0,contact:{phone_number:'08123456789',first_name:'Other',user_id:999}}},'isolated-bot','');
  assert.match(messages.at(-1)||'',/Kontak orang lain/);
  const workflows=handlerRuntime.load<typeof import('../lib/telegram-workflows')>('lib/telegram-workflows.ts');
  await workflows.handleDocumentationAlbum([{update_id:2,message:{message_id:2,chat:{id:-100,type:'group'},from:{id:123,is_bot:false,first_name:'Test'},date:0,media_group_id:'group-album'}}],'isolated-bot','https://example.com');
  assert.match(messages.at(-1)||'',/chat pribadi/);
  console.log('PASS: setup ownership/admin/origin, credential-free webhook URL, GET safety, OAuth browser binding/replay, encrypted state/CAS, production fail-closed and contact ownership');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
