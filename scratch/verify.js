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

async function verifyLiveExtraction() {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  const sql = neon(dbUrl);
  const users = await sql`SELECT id, email, gemini_api_key, model_name FROM users WHERE gemini_api_key IS NOT NULL LIMIT 1`;
  const key = users[0].gemini_api_key.replace(/^["']|["']$/g, '').trim();

  console.log('Testing extraction with text using default model...');

  const { extractEventFromSource } = require('../lib/gemini.ts');
  // Or test fetch directly
}
