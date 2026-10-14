import fs from 'node:fs';
import path from 'node:path';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import AppFooter from '@/app/AppFooter';
import { parseChangelog } from '@/lib/changelog';
import { version } from '@/package.json';

export const metadata: Metadata = {
  title: 'Riwayat Perubahan | EasyCal',
  description: 'Catatan rilis, perbaikan, dan perkembangan terbaru EasyCal.'
};

const categoryLabels: Record<string, string> = {
  Added: 'Ditambahkan', Changed: 'Diubah', Fixed: 'Diperbaiki', Removed: 'Dihapus',
  Deprecated: 'Akan dihentikan', Security: 'Keamanan', Validation: 'Verifikasi'
};

/** Render inline formatting as React nodes; source text is never inserted as HTML. */
function InlineText({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^)]+\))/g);
  return <>{parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/.exec(part);
    if (link) return <a key={index} href={link[2]} target="_blank" rel="noopener noreferrer">{link[1]}</a>;
    return part;
  })}</>;
}

export default function ChangelogPage() {
  const releases = parseChangelog(fs.readFileSync(path.join(process.cwd(), 'CHANGELOG.md'), 'utf8'));

  return (
    <main className="app-container app-page changelog-page">
      <header className="changelog-header">
        <div>
          <p className="changelog-eyebrow">EASYCAL / CATATAN RILIS</p>
          <h1>Riwayat Perubahan</h1>
          <p className="changelog-intro">Perbaikan, fitur baru, dan perkembangan EasyCal dari waktu ke waktu.</p>
        </div>
        <Link href="/" className="btn-tactile"><ArrowLeft size={14} aria-hidden="true" /> Kembali ke EasyCal</Link>
      </header>

      <div className="changelog-releases">
        {releases.map(release => {
          const unreleased = release.version === 'Unreleased';
          const current = release.version === version;
          return (
            <details className="changelog-release" key={release.version} open={unreleased || current}>
              <summary className="changelog-release-summary">
                <div className="changelog-release-heading">
                  <h2>{unreleased ? 'Dalam pengembangan' : `v${release.version}`}</h2>
                  {(unreleased || current) && <span className="changelog-badge">{unreleased ? 'Belum dirilis' : 'Versi saat ini'}</span>}
                </div>
                <div className="changelog-release-date">
                  {release.date && <time dateTime={release.date}>{new Intl.DateTimeFormat('id-ID', {
                    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
                  }).format(new Date(`${release.date}T00:00:00Z`))}</time>}
                  <ChevronDown size={16} className="changelog-chevron" aria-hidden="true" />
                </div>
              </summary>
              <div className="changelog-release-body">
                {release.sections.map((section, index) => (
                  <section className="changelog-section" key={`${section.title}-${index}`}>
                    <h3>{categoryLabels[section.title] || section.title}</h3>
                    <ul>{section.items.map((item, itemIndex) => <li key={itemIndex}><InlineText text={item} /></li>)}</ul>
                  </section>
                ))}
              </div>
            </details>
          );
        })}
      </div>
      <AppFooter />
    </main>
  );
}
