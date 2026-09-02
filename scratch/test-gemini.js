const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

// Read .env.local or .env
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

async function check() {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!dbUrl) {
    console.log('No DB URL');
    return;
  }
  const sql = neon(dbUrl);
  const users = await sql`SELECT id, email, gemini_api_key, model_name FROM users WHERE gemini_api_key IS NOT NULL LIMIT 5`;
  console.log('Users found:', users.length);
  for (const u of users) {
    console.log('User:', u.email, 'Model in DB:', u.model_name, 'Key prefix:', u.gemini_api_key ? u.gemini_api_key.substring(0, 10) + '...' : 'none');
    if (u.gemini_api_key) {
      const key = u.gemini_api_key.replace(/^["']|["']$/g, '').trim();
      
      // Test v1beta models list
      const resV1Beta = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
      console.log('v1beta ListModels HTTP status:', resV1Beta.status);
      const dataBeta = await resV1Beta.json();
      if (dataBeta.models) {
        const available = dataBeta.models
          .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
          .map(m => m.name);
        console.log('v1beta available generateContent models count:', available.length);
        console.log('v1beta models:', available);
      } else {
        console.log('v1beta error response:', JSON.stringify(dataBeta));
      }

      // Test a minimal generateContent call
      if (dataBeta.models) {
        const testModel = dataBeta.models[0].name.replace(/^models\//, '');
        console.log('Testing generateContent with:', testModel);
        const testRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${testModel}:generateContent?key=${encodeURIComponent(key)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Hello, reply with OK' }] }]
          })
        });
        console.log('Test call HTTP status:', testRes.status);
        const testData = await testRes.json();
        console.log('Test response:', JSON.stringify(testData).substring(0, 200));
      }
    }
  }
}
check().catch(console.error);
