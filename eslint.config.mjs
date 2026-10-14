import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';

export default defineConfig([
  ...nextVitals,
  globalIgnores([
    '.next/**', 'out/**', 'build/**', 'coverage/**', 'node_modules/**',
    'next-env.d.ts', 'context/**', '.cache/**', '.npm/**', 'scratch/local/**',
    'scratch/test-36.js', 'scratch/test-models.js', 'scratch/test-gemini.js', 'scratch/verify.js',
  ]),
]);
