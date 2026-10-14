// Optional worker for hosts without a minute-level scheduler. Reads secrets from environment only.
const origin=process.env.NEXT_PUBLIC_APP_URL;
const secret=process.env.CRON_SECRET;
if(!origin||!secret)throw new Error('Set NEXT_PUBLIC_APP_URL dan CRON_SECRET pada environment worker.');
const endpoint=new URL('/api/telegram/worker',origin);
while(true) {
  try {
    const response=await fetch(endpoint,{method:'POST',headers:{authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(65000)});
    console.log(new Date().toISOString(),response.ok?'Worker selesai':'Worker belum tersedia',response.status);
  } catch {console.error('Worker belum dapat dihubungi.');}
  await new Promise(resolve=>setTimeout(resolve,10000));
}
