import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const nativeRequire = createRequire(import.meta.url);
function load<T>(file: string, mocks: Record<string, unknown>): T {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX
  } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports,
    require: (id: string) => id in mocks ? mocks[id] : nativeRequire(id), console, process }, { filename: file });
  return module.exports as T;
}

const parser = load<typeof import('../lib/changelog')>('lib/changelog.ts', {});
const fixture = '# Changelog\r\n## [Unreleased]\r\n## [1.2.3] - 2026-10-14\r\n### Added\r\n- First item\r\n  continued\r\n### Fixed\r\n- Second item\r\n';
const parsed = parser.parseChangelog(fixture);
assert.equal(parsed.length, 1, 'Empty Unreleased should not appear as an empty card');
assert.equal(parsed[0].version, '1.2.3');
assert.equal(parsed[0].date, '2026-10-14');
assert.equal(parsed[0].sections[0].items[0], 'First item continued');
assert.equal(parsed[0].sections[1].title, 'Fixed');

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { version: string };
const link = ({ children, ...props }: React.ComponentProps<'a'>) => React.createElement('a', props, children);
const footer = load<typeof import('../app/AppFooter')>('app/AppFooter.tsx', { 'next/link': link, '@/package.json': pkg });
const footerHtml = renderToStaticMarkup(React.createElement(footer.default));
assert.match(footerHtml, /href="\/changelog"/);
assert.ok(footerHtml.includes(`Versi ${pkg.version}`));

const pageMocks = { 'next/link': link, '@/app/AppFooter': footer, '@/lib/changelog': parser, '@/package.json': pkg };
const page = load<typeof import('../app/changelog/page')>('app/changelog/page.tsx', pageMocks);
const html = renderToStaticMarkup(React.createElement(page.default));
const releases = parser.parseChangelog(fs.readFileSync('CHANGELOG.md', 'utf8'));
for (const release of releases) {
  assert.ok(html.includes(release.version === 'Unreleased' ? 'Dalam pengembangan' : `v${release.version}`));
  for (const section of release.sections) assert.ok(section.items.length > 0);
}
assert.match(html, /Versi saat ini/);
assert.equal(html.includes('class="changelog-badge">Belum dirilis</span>'), releases.some(release => release.version === 'Unreleased'));
assert.match(html, /href="\/"/);

const untrusted = load<typeof import('../app/changelog/page')>('app/changelog/page.tsx', {
  ...pageMocks, 'node:fs': { readFileSync: () => '## [Unreleased]\n### Added\n- <script>alert(1)</script> **safe** `code` [link](https://example.com) [unsafe](javascript:alert(1))' }
});
const safeHtml = renderToStaticMarkup(React.createElement(untrusted.default));
assert.ok(!safeHtml.includes('<script>'));
assert.match(safeHtml, /&lt;script&gt;/);
assert.match(safeHtml, /<strong>safe<\/strong>/);
assert.match(safeHtml, /<code>code<\/code>/);
assert.ok(!safeHtml.includes('href="javascript:'));
console.log('PASS: changelog headings/continuations, package version/footer link, repository releases, and escaped Markdown rendering');
