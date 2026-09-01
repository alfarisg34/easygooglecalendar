import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'EasyCal // Serverless OCR & AI Agenda to Google Calendar',
  description: 'Ekstraksi dokumen surat dinas PDF, poster kegiatan, dan broadcast chat ke Google Calendar secara otomatis menggunakan Google Gemini AI dan OCR Service.',
  keywords: ['Google Calendar', 'OCR', 'PDF to Calendar', 'Gemini Multimodal', 'Telegram Bot', 'Kemnaker', 'Bimtek', 'Agenda Rapat'],
  authors: [{ name: 'Alfari Ghilmana' }]
};

export const viewport = {
  width: 'device-width',
  initialScale: 1
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
