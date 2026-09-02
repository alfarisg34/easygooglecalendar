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

async function test36() {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  const sql = neon(dbUrl);
  const users = await sql`SELECT id, email, gemini_api_key, model_name FROM users WHERE gemini_api_key IS NOT NULL LIMIT 1`;
  const key = users[0].gemini_api_key.replace(/^["']|["']$/g, '').trim();

  const models = ['gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-flash-latest', 'gemini-3.5-flash'];

  for (const m of models) {
    console.log(`\n--- Testing ${m} ---`);
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Respond with JSON: {"status":"OK"}' }] }],
        generationConfig: { responseMimeType: 'application/json' }
      })
    });
    console.log(`Status:`, res.status);
    const data = await res.json();
    console.log('Result:', JSON.stringify(data).substring(0, 300));
  }
}
test36().catch(console.error);
