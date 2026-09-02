const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const parts = line.split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const val = parts.slice(1).join('=').trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}
loadEnv();

async function testAll() {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  const sql = neon(dbUrl);
  const users = await sql`SELECT id, email, gemini_api_key, model_name FROM users WHERE gemini_api_key IS NOT NULL LIMIT 1`;
  const key = users[0].gemini_api_key.replace(/^["']|["']$/g, '').trim();

  const models = [
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.1-flash-lite',
    'gemini-flash-latest',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite'
  ];

  for (const m of models) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      const start = Date.now();
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Respond with JSON: {"status":"OK"}' }] }],
          generationConfig: { responseMimeType: 'application/json' }
        }),
        signal: controller.signal
      });
      clearTimeout(timer);
      const elapsed = Date.now() - start;
      const data = await res.json();
      console.log(`[${m}] HTTP ${res.status} (${elapsed}ms):`, res.ok ? JSON.stringify(data.candidates?.[0]?.content?.parts?.[0]?.text) : data.error?.message);
    } catch (e) {
      console.log(`[${m}] Error:`, e.name === 'AbortError' ? 'TIMEOUT (12s)' : e.message);
    }
  }
}
testAll().catch(console.error);
