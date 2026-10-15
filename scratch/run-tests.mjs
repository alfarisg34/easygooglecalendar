import { spawnSync } from 'node:child_process';
const suites=['test-gemini-resilience.ts','test-bot-security.ts','test-bot-queue.ts','test-bot-workflows.ts','test-bot-ingestion.ts','test-bot-idempotency.ts','test-calendar-attachments.ts',
  'test-event-lifecycle.ts','test-photo-timestamp.ts','test-google-auth-recovery.ts','test-telegram-progress.ts','test-changelog.ts'];
for(const suite of suites) {
  const result=spawnSync(process.execPath,['--experimental-strip-types',`scratch/${suite}`],{encoding:'utf8',timeout:60000,env:process.env});
  process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');
  if(result.status!==0 || !result.stdout.includes('PASS:')) {console.error(`FAIL: ${suite}${result.error?` (${result.error.message})`:''}`);process.exit(1);}
}
console.log(`PASS: ${suites.length} offline suites. Tidak ada panggilan ke layanan produksi.`);
