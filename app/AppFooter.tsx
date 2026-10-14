import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { version } from '@/package.json';

export default function AppFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <p>EasyCal <span aria-hidden="true">·</span> Agenda &amp; dokumentasi kegiatan</p>
        <Link href="/changelog" className="site-footer-version" aria-label={`Versi ${version}, lihat catatan perubahan`}>
          <span>Versi {version}</span>
          <ArrowUpRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </footer>
  );
}
