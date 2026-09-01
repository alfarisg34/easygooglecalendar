'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  Calendar, FileText, Image as ImageIcon, MessageSquare, 
  Key, Bot, Code2, Sparkles, Download, Copy, Check, 
  ExternalLink, Trash2, RefreshCw, Clock, MapPin, 
  Video, Users, BookOpen, AlertCircle, Send, CheckCircle2,
  LogOut, Shield, Database, Settings, ArrowRight, Eye, EyeOff,
  CalendarCheck, Cpu, ChevronLeft, ChevronRight
} from 'lucide-react';
import { CalendarEvent } from '@/lib/types';
import { DateTime } from 'luxon';
import { buildGoogleCalendarUrl, generateICSContent } from '@/lib/calendar-builder';

interface ExtractedEventItem {
  id: string;
  user_id: string;
  title: string;
  start_time: string;
  end_time: string;
  is_online?: boolean;
  location?: string;
  meeting_link?: string;
  meeting_id_pass?: string;
  jp?: string;
  speakers?: string;
  description?: string;
  google_calendar_url?: string;
  google_event_id?: string;
  synced_to_calendar?: boolean;
  source_type?: string; // 'pdf' | 'image' | 'text' | 'telegram'
  file_name?: string;
  created_at: string;
}

interface UserSession {
  id: string;
  email: string;
  name?: string;
  picture?: string;
  hasGoogleCalendar: boolean;
  settings: {
    geminiApiKey: string;
    modelName: string;
    ocrEngine: string;
    ocrServiceUrl: string;
    calendarId: string;
    telegramBotToken: string;
    telegramChatId: string;
  };
}

interface DbStatus {
  connected: boolean;
  provider: string;
  message: string;
}

const SAMPLE_TEXT_LETTER = `KEMENTERIAN KETENAGAKERJAAN REPUBLIK INDONESIA
DIREKTORAT JENDERAL PEMBINAAN PENEMPATAN TENAGA KERJA
DAN PERLUASAN KESEMPATAN KERJA

Nomor    : 3.1/2356/PR.01.00/VIII/2026
Sifat    : Segera / Penting
Lampiran : 1 (satu) Berkas
Hal      : Undangan Rapat Evaluasi Capaian Sistem Aplikasi dan Pelaporan Data Ketenagakerjaan

Yth.
1. Kepala Balai Besar Pelatihan Vokasi dan Produktivitas
2. Kepala Balai Perluasan Kesempatan Kerja
3. Para Koordinator dan Sub Koordinator Lingkup Ditjen Binapenta & PKK

Dalam rangka percepatan integrasi data ketenagakerjaan satu pintu, kami mengundang Bapak/Ibu untuk hadir pada rapat dinas yang akan diselenggarakan pada:

Hari / Tanggal : Kamis, 10 September 2026
Waktu          : Pukul 09.00 - 16.30 WIB
Tempat         : Ruang Rapat Tridharma Lt. 5, Gedung Kemnaker RI, Jl. Gatot Subroto Kav. 51, Jakarta Selatan
Agenda         : Evaluasi Capaian dan Integrasi Modul Pelaporan Data Ketenagakerjaan Nasional
Narasumber     : 
1. Direktur Jenderal Binapenta & PKK (Keynote Speech)
2. Kepala Pusdatik Kemnaker RI
Bobot          : 8 JP (Tersedia E-Sertifikat)

Mengingat pentingnya agenda tersebut, dimohon hadir tepat waktu. Informasi lebih lanjut dapat menghubungi Sdr. Alfari (0812-3456-7890).`;

const SAMPLE_TEXT_POSTER = `📢 WEBINAR & SHARING SESSION NASIONAL 2026
"Mainstreaming Gender & AI dalam Pelatihan Vokasi Masa Depan"

🗓️ HARI / TANGGAL:
Jumat, 11 September 2026

⏰ WAKTU:
08.30 - 11.30 WIB

📍 PLATFORM:
Zoom Meeting & Live Streaming YouTube Pusdiklat Kemnaker
🔗 Link Registrasi: https://bit.ly/vokasi-gender-2026
🔑 Meeting ID: 892 4512 0019
🔐 Passcode: vokasi2026

🎙️ NARASUMBER SPESIAL:
1. Prof. Dr. Siti Rahmawati, M.Sc (Pakar Kebijakan Publik UI)
2. Bambang Suryono, S.T., M.Kom (Senior AI Architect Kemnaker)

📚 FASILITAS:
- E-Sertifikat Bernilai 4 JP
- Materi Presentasi Eksklusif
- Doorprize Menarik

GRATIS & TERBUKA UNTUK UMUM!`;

export default function HomePage() {
  // Auth & Session State
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [user, setUser] = useState<UserSession | null>(null);
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  // Active View Tab in Authenticated Mode
  const [activeView, setActiveView] = useState<'extract' | 'settings' | 'telegram' | 'docs'>('extract');

  // Extraction Workspace State
  const [inputTab, setInputTab] = useState<'pdf' | 'image' | 'text'>('pdf');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [inputText, setInputText] = useState<string>('');
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [extractedEvent, setExtractedEvent] = useState<CalendarEvent | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [autoSyncResult, setAutoSyncResult] = useState<any>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  // Settings Form State
  const [settingsForm, setSettingsForm] = useState({
    geminiApiKey: '',
    modelName: 'gemini-3.6-flash',
    ocrEngine: 'gemini',
    ocrServiceUrl: '',
    calendarId: 'primary',
    telegramBotToken: '',
    telegramChatId: ''
  });
  const [showApiKey, setShowApiKey] = useState<boolean>(false);
  const [isSavingSettings, setIsSavingSettings] = useState<boolean>(false);
  const [settingsStatus, setSettingsStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Telegram Webhook Setup State
  const [tgStatus, setTgStatus] = useState<{ loading: boolean; info?: string; error?: string }>({ loading: false });

  // Events History (Paginated & Sorted by created_at DESC)
  const [eventsList, setEventsList] = useState<ExtractedEventItem[]>([]);
  const [eventsPage, setEventsPage] = useState<number>(1);
  const [eventsLimit] = useState<number>(4);
  const [eventsTotal, setEventsTotal] = useState<number>(0);
  const [eventsTotalPages, setEventsTotalPages] = useState<number>(1);
  const [eventsLoading, setEventsLoading] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchEventsHistory = async (page: number = 1) => {
    try {
      setEventsLoading(true);
      const res = await fetch(`/api/events?page=${page}&limit=${eventsLimit}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setEventsList(data.events || []);
          setEventsTotal(data.total || 0);
          setEventsPage(data.page || 1);
          setEventsTotalPages(data.totalPages || 1);
        }
      }
    } catch (err) {
      console.error('Failed to fetch events history:', err);
    } finally {
      setEventsLoading(false);
    }
  };

  const handleDeleteHistoryEvent = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Hapus riwayat agenda ini?')) return;
    try {
      const res = await fetch(`/api/events?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchEventsHistory(eventsPage);
      }
    } catch (err) {
      console.error('Failed to delete event:', err);
    }
  };

  const handleDownloadSpecificICS = (event: ExtractedEventItem) => {
    const icsString = generateICSContent(event as any);
    const blob = new Blob([icsString], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${(event.title || 'agenda').replace(/[^a-zA-Z0-9]/g, '_')}.ics`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Check auth on load
  const fetchSession = async () => {
    try {
      setAuthLoading(true);
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const errParam = params.get('auth_error');
        if (errParam) {
          setAuthError(decodeURIComponent(errParam));
        }
      }
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      if (data.authenticated && data.user) {
        setUser(data.user);
        setSettingsForm({
          geminiApiKey: data.user.settings?.geminiApiKey || '',
          modelName: data.user.settings?.modelName || 'gemini-3.6-flash',
          ocrEngine: data.user.settings?.ocrEngine || 'gemini',
          ocrServiceUrl: data.user.settings?.ocrServiceUrl || '',
          calendarId: data.user.settings?.calendarId || 'primary',
          telegramBotToken: data.user.settings?.telegramBotToken || '',
          telegramChatId: data.user.settings?.telegramChatId || ''
        });
      } else {
        setUser(null);
      }
      if (data.dbStatus) {
        setDbStatus(data.dbStatus);
      }
    } catch (err) {
      console.error('Failed to fetch session:', err);
      setUser(null);
    } finally {
      setAuthLoading(false);
    }
  };

  useEffect(() => {
    fetchSession();
  }, []);

  useEffect(() => {
    if (user) {
      fetchEventsHistory(1);
    }
  }, [user]);

  const handleLogout = async () => {
    if (!confirm('Apakah Anda yakin ingin keluar dari akun?')) return;
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setUser(null);
      setActiveView('extract');
    } catch (e) {
      window.location.href = '/api/auth/logout';
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSettings(true);
    setSettingsStatus(null);
    try {
      const res = await fetch('/api/user/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingsForm)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSettingsStatus({ type: 'success', message: data.message || 'Pengaturan berhasil disimpan ke database Neon!' });
        // Update user state
        if (user) {
          setUser({
            ...user,
            settings: data.settings
          });
        }
      } else {
        setSettingsStatus({ type: 'error', message: data.error || 'Gagal menyimpan pengaturan.' });
      }
    } catch (err: any) {
      setSettingsStatus({ type: 'error', message: `Gagal menyimpan: ${err.message}` });
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      setSelectedFile(file);
      if (file.name.toLowerCase().endsWith('.pdf')) {
        setInputTab('pdf');
      } else {
        setInputTab('image');
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleExtract = async () => {
    setErrorMessage('');
    setExtractedEvent(null);
    setAutoSyncResult(null);

    // Validate API Key
    const effectiveKey = settingsForm.geminiApiKey;
    if (!effectiveKey) {
      setErrorMessage('Google Gemini API Key belum dikonfigurasi. Silakan isi di tab "Pengaturan & Kredensial".');
      setActiveView('settings');
      return;
    }

    if (inputTab === 'text') {
      if (!inputText.trim()) {
        setErrorMessage('Mohon masukkan teks atau pesan undangan yang ingin diekstrak.');
        return;
      }
    } else {
      if (!selectedFile) {
        setErrorMessage(`Mohon pilih berkas ${inputTab === 'pdf' ? 'PDF' : 'Gambar/Poster'} terlebih dahulu.`);
        return;
      }
    }

    setIsLoading(true);
    setStatusMessage('Menginisialisasi pemindaian AI...');

    try {
      const formData = new FormData();
      formData.append('apiKey', effectiveKey);
      formData.append('model', settingsForm.modelName);
      formData.append('engine', settingsForm.ocrEngine);
      formData.append('calendarId', settingsForm.calendarId || 'primary');
      formData.append('autoSync', user?.hasGoogleCalendar ? 'true' : 'false');
      if (user?.id) formData.append('userId', user.id);

      if (inputTab === 'text') {
        formData.append('text', inputText);
        setStatusMessage('Mengekstrak entitas jadwal & agenda dari teks...');
      } else if (selectedFile) {
        formData.append('file', selectedFile);
        setStatusMessage(`Memproses ${selectedFile.name} melalui OCR & Gemini Vision...`);
      }

      const res = await fetch('/api/extract', {
        method: 'POST',
        body: formData
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal mengekstrak informasi agenda.');
      }

      setExtractedEvent(data.event);
      if (data.autoSyncResult) {
        setAutoSyncResult(data.autoSyncResult);
      }
      fetchEventsHistory(1);
    } catch (err: any) {
      setErrorMessage(err.message || 'Terjadi kesalahan sistem saat mengekstrak.');
    } finally {
      setIsLoading(false);
      setStatusMessage('');
    }
  };

  const handleDownloadICS = () => {
    if (!extractedEvent) return;
    const icsString = generateICSContent(extractedEvent);
    const blob = new Blob([icsString], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${(extractedEvent.title || 'agenda').replace(/[^a-zA-Z0-9]/g, '_')}.ics`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCopyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopyFeedback(label);
    setTimeout(() => setCopyFeedback(null), 2500);
  };

  const handleSetupTelegramWebhook = async () => {
    if (!settingsForm.telegramBotToken.trim()) {
      alert('Mohon isi Telegram Bot Token terlebih dahulu di form Pengaturan.');
      setActiveView('settings');
      return;
    }
    setTgStatus({ loading: true, info: undefined, error: undefined });
    try {
      const cleanToken = settingsForm.telegramBotToken.trim();
      const origin = window.location.origin;
      const webhookUrl = `${origin}/api/telegram?bot_token=${encodeURIComponent(cleanToken)}${settingsForm.geminiApiKey ? `&gemini_key=${encodeURIComponent(settingsForm.geminiApiKey.trim())}` : ''}`;

      const res = await fetch('/api/telegram/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botToken: cleanToken,
          webhookUrl,
          action: 'set_webhook'
        })
      });
      const data = await res.json();
      if (data.ok) {
        setTgStatus({ 
          loading: false, 
          info: `🎉 Webhook Telegram Berhasil Dipasang!\n\n🔗 URL: ${webhookUrl}\n\nSekarang buka bot Telegram Anda dan ketik /start untuk mulai menggunakan!` 
        });
      } else {
        setTgStatus({ 
          loading: false, 
          error: `Gagal menyetel webhook: ${data.description || data.error || 'Token tidak valid'}` 
        });
      }
    } catch (e: any) {
      setTgStatus({ loading: false, error: e.message });
    }
  };

  const handleCheckTelegramWebhook = async () => {
    if (!settingsForm.telegramBotToken.trim()) {
      alert('Mohon isi Telegram Bot Token terlebih dahulu di form Pengaturan.');
      setActiveView('settings');
      return;
    }
    setTgStatus({ loading: true, info: undefined, error: undefined });
    try {
      const cleanToken = settingsForm.telegramBotToken.trim();
      const res = await fetch('/api/telegram/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botToken: cleanToken,
          action: 'get_webhook_info'
        })
      });
      const data = await res.json();
      if (data.ok) {
        const info = data.result;
        setTgStatus({
          loading: false,
          info: `📡 Status Webhook Telegram Saat Ini:\n\n• URL: ${info.url || '(Belum disetel / Kosong)'}\n• Pending Updates: ${info.pending_update_count}\n• Last Error: ${info.last_error_message || 'Tidak ada error (OK)'}`
        });
      } else {
        setTgStatus({ loading: false, error: data.description || 'Gagal memeriksa status webhook.' });
      }
    } catch (e: any) {
      setTgStatus({ loading: false, error: e.message });
    }
  };

  // ----------------------------------------------------
  // RENDER: LOADING STATE
  // ----------------------------------------------------
  if (authLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-void)' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="spinner-chassis amber" style={{ width: 36, height: 36, borderWidth: 3, margin: '0 auto 1.5rem' }}></div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--text-dim)', letterSpacing: '0.1em' }}>
            MEMERIKSA SESI & KONEKSI TELEMETRI...
          </div>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // RENDER: UNAUTHENTICATED / GOOGLE LOGIN LANDING PAGE
  // ----------------------------------------------------
  if (!user) {
    return (
      <main className="app-container">
        {/* Masthead Header */}
        <header className="masthead">
          <div className="brand-badge">
            <span className="led amber" title="System Ready"></span>
            <span className="brand-title">EasyCal</span>
            <span className="brand-sub">AI Agenda & OCR Cockpit</span>
          </div>

          <div className="masthead-actions">
            <div className="status-badge-tag badge-online">
              <Database size={13} />
              <span>{dbStatus?.connected ? 'Neon PostgreSQL Ready' : 'Database Ready'}</span>
            </div>
            <a href="/api/auth/google" className="btn-tactile btn-primary">
              <Users size={14} />
              <span>Masuk dengan Google</span>
            </a>
          </div>
        </header>

        {/* Hero Section */}
        <section className="landing-hero-container">
          {/* Auth Error Diagnosis Banner */}
          {authError && (
            <div style={{ background: 'rgba(255, 51, 75, 0.1)', border: '1px solid rgba(255, 51, 75, 0.4)', borderRadius: 6, padding: '1.25rem 1.5rem', marginBottom: '2.5rem', color: '#FFF' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--signal-red)', fontWeight: 700, fontSize: '1rem', marginBottom: '0.5rem' }}>
                <AlertCircle size={20} />
                <span>Otorisasi Google Gagal: {authError}</span>
              </div>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: '0.75rem' }}>
                {authError === 'invalid_client' 
                  ? 'Error "invalid_client" biasanya terjadi karena Google Client ID & Secret belum diisi di Vercel Environment Variables, atau Redirect URI belum didaftarkan di Google Cloud Console.' 
                  : `Detail error: ${authError}`}
              </p>
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.75rem 1rem', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--signal-amber)' }}>
                💡 <strong>Solusi:</strong> Pastikan di Google Cloud Console &rarr; Credentials &rarr; Authorized redirect URIs terdapat:
                <br />
                <code style={{ color: '#FFF', display: 'inline-block', marginTop: 4 }}>
                  {typeof window !== 'undefined' ? `${window.location.origin}/api/auth/callback` : 'https://easygooglecalendar.alfarighilmana.my.id/api/auth/callback'}
                </code>
              </div>
            </div>
          )}

          <div className="hero-grid">
            <div>
              <div className="hero-eyebrow">
                <Sparkles size={14} />
                <span>BYOK ARCHITECTURE // AI VISION & NEON DB</span>
              </div>
              <h1 className="hero-headline">
                Ekstraksi Surat Dinas & Undangan Otomatis ke <em>Google Calendar</em>.
              </h1>
              <p className="hero-desc">
                Konversi dokumen PDF nota dinas dinas, flyer poster bimtek/webinar, dan chat broadcast secara instan menjadi event kalender terstruktur dengan kecerdasan Google Gemini AI.
              </p>

              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <a href="/api/auth/google" className="google-btn-cockpit" style={{ maxWidth: '320px' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                  </svg>
                  <span>Masuk dengan Google</span>
                </a>
              </div>
            </div>

            {/* Login Prompt Cockpit Card */}
            <div>
              <div className="google-login-box">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--signal-amber)', fontWeight: 600 }}>
                    [ AUTHENTICATION GATE ]
                  </span>
                  <span className="status-badge-tag badge-success">
                    <Shield size={12} />
                    <span>OAuth 2.0 Secure</span>
                  </span>
                </div>

                <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem', color: '#FFF' }}>
                  Otorisasi Akun Google
                </h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)', marginBottom: '1.5rem', lineHeight: 1.6 }}>
                  Masuk untuk mengaktifkan sinkronisasi otomatis kalender, mengatur API Key Gemini (BYOK), memilih Target Calendar ID, dan menghubungkan Bot Telegram Anda.
                </p>

                <a href="/api/auth/google" className="google-btn-cockpit">
                  <svg width="20" height="20" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                  </svg>
                  <span>Lanjutkan dengan Google</span>
                </a>

                <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', color: 'var(--text-faint)' }}>
                  <Database size={13} color="var(--signal-amber)" />
                  <span>Kredensial disimpan terisolasi di database Neon PostgreSQL Vercel.</span>
                </div>
              </div>
            </div>
          </div>

          {/* Feature Cards Grid */}
          <div className="feature-grid-cockpit">
            <div className="feature-card-cockpit">
              <div className="feature-icon-badge">
                <FileText size={22} />
              </div>
              <h4 className="feature-card-title">Format Standar Dinas Indonesia</h4>
              <p className="feature-card-desc">
                Mengenali struktur surat dinas: Nomor Surat, Sifat, Hal, Lampiran, Waktu (WIB/WITA/WIT), Ruang Rapat, Narasumber, dan Bobot JP (Jam Pelajaran).
              </p>
            </div>

            <div className="feature-card-cockpit">
              <div className="feature-icon-badge">
                <CalendarCheck size={22} />
              </div>
              <h4 className="feature-card-title">0-Click Realtime Calendar Sync</h4>
              <p className="feature-card-desc">
                Setiap event yang diekstrak langsung tersimpan ke Google Calendar Anda secara realtime, lengkap dengan deskripsi terstruktur dan pengingat.
              </p>
            </div>

            <div className="feature-card-cockpit">
              <div className="feature-icon-badge">
                <Bot size={22} />
              </div>
              <h4 className="feature-card-title">Telegram Bot Gateway</h4>
              <p className="feature-card-desc">
                Cukup kirimkan file PDF atau forward poster dari Telegram, bot langsung memproses dan menjadwalkan ke Google Calendar Anda.
              </p>
            </div>

            <div className="feature-card-cockpit">
              <div className="feature-icon-badge">
                <Cpu size={22} />
              </div>
              <h4 className="feature-card-title">BYOK & AI Multimodal</h4>
              <p className="feature-card-desc">
                Gunakan API Key Gemini Anda sendiri tanpa batasan kuota server bersama, didukung model Gemini 3.6 Flash & Gemini Pro.
              </p>
            </div>
          </div>
        </section>
      </main>
    );
  }

  // ----------------------------------------------------
  // RENDER: AUTHENTICATED DASHBOARD WORKSPACE
  // ----------------------------------------------------
  return (
    <main className="app-container">
      {/* Top Cockpit Masthead */}
      <header className="masthead">
        <div className="brand-badge">
          <span className="led" title="Authenticated & Active"></span>
          <span className="brand-title">EasyCal</span>
          <span className="brand-sub">Workspace</span>
        </div>

        {/* User Profile & Action Bar */}
        <div className="masthead-actions">
          {/* Google Calendar Connected Status Badge */}
          {user.hasGoogleCalendar ? (
            <div className="status-badge-tag badge-success">
              <CalendarCheck size={13} />
              <span>Calendar: Connected</span>
            </div>
          ) : (
            <a href="/api/auth/google" className="status-badge-tag badge-offline" style={{ textDecoration: 'none' }}>
              <AlertCircle size={13} />
              <span>Calendar: Re-link Google</span>
            </a>
          )}

          {/* Database Status Badge */}
          <div className="status-badge-tag badge-online" title={dbStatus?.message || 'Neon DB'}>
            <Database size={13} />
            <span>Neon DB: {dbStatus?.connected ? 'Online' : 'Fallback'}</span>
          </div>

          {/* User Profile Info Chip */}
          <div className="user-profile-chip">
            {user.picture ? (
              <img src={user.picture} alt={user.name || 'User'} className="user-avatar" />
            ) : (
              <div className="user-avatar-fallback">
                {(user.name || user.email || 'U').charAt(0).toUpperCase()}
              </div>
            )}
            <div className="user-info-text">
              <span className="user-name">{user.name || 'User'}</span>
              <span className="user-email">{user.email}</span>
            </div>
          </div>

          {/* Logout Button */}
          <button onClick={handleLogout} className="btn-tactile btn-danger" title="Keluar dari akun">
            <LogOut size={14} />
            <span>Keluar</span>
          </button>
        </div>
      </header>

      {/* Navigation Tabs Bar */}
      <nav className="cockpit-tabs-bar">
        <button 
          onClick={() => setActiveView('extract')} 
          className={`cockpit-tab-btn ${activeView === 'extract' ? 'active' : ''}`}
        >
          <Calendar size={15} />
          <span>Ekstraktor Agenda</span>
        </button>

        <button 
          onClick={() => setActiveView('settings')} 
          className={`cockpit-tab-btn ${activeView === 'settings' ? 'active' : ''}`}
        >
          <Settings size={15} />
          <span>Pengaturan & Kredensial</span>
          {!settingsForm.geminiApiKey && (
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--signal-amber)', display: 'inline-block' }}></span>
          )}
        </button>

        <button 
          onClick={() => setActiveView('telegram')} 
          className={`cockpit-tab-btn ${activeView === 'telegram' ? 'active' : ''}`}
        >
          <Bot size={15} />
          <span>Integrasi Bot Telegram</span>
        </button>

        <button 
          onClick={() => setActiveView('docs')} 
          className={`cockpit-tab-btn ${activeView === 'docs' ? 'active' : ''}`}
        >
          <Code2 size={15} />
          <span>Panduan API</span>
        </button>
      </nav>

      {/* ----------------------------------------------------
          TAB 1: EKSTRAKTOR AGENDA (WORKSPACE)
          ---------------------------------------------------- */}
      {activeView === 'extract' && (
        <div>
          {/* Missing API Key Alert */}
          {!settingsForm.geminiApiKey && (
            <div style={{ background: 'rgba(255, 158, 11, 0.1)', border: '1px solid rgba(255, 158, 11, 0.3)', padding: '1rem 1.25rem', borderRadius: 4, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Key size={18} color="var(--signal-amber)" />
                <span style={{ fontSize: '0.875rem', color: '#FFF' }}>
                  <strong>Google Gemini API Key belum diatur.</strong> Tambahkan API Key di Pengaturan agar ekstraksi AI dapat berjalan lancar.
                </span>
              </div>
              <button onClick={() => setActiveView('settings')} className="btn-tactile btn-primary">
                <Settings size={14} />
                <span>Buka Pengaturan</span>
              </button>
            </div>
          )}

          <div className="split-viewport">
            {/* Input & Upload Column */}
            <div className="chassis-card">
              <div className="chassis-header">
                <div className="chassis-title">
                  <FileText size={14} color="var(--signal-amber)" />
                  <span>Input Sumber Agenda</span>
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-dim)' }}>
                  Target: {settingsForm.calendarId || 'primary'}
                </div>
              </div>

              <div className="chassis-body">
                {/* Media Type Switcher */}
                <div className="tab-switcher">
                  <button 
                    type="button"
                    onClick={() => { setInputTab('pdf'); setSelectedFile(null); }}
                    className={`tab-btn ${inputTab === 'pdf' ? 'active' : ''}`}
                  >
                    <FileText size={14} />
                    <span>Surat Dinas (PDF)</span>
                  </button>
                  <button 
                    type="button"
                    onClick={() => { setInputTab('image'); setSelectedFile(null); }}
                    className={`tab-btn ${inputTab === 'image' ? 'active' : ''}`}
                  >
                    <ImageIcon size={14} />
                    <span>Poster (Gambar)</span>
                  </button>
                  <button 
                    type="button"
                    onClick={() => setInputTab('text')}
                    className={`tab-btn ${inputTab === 'text' ? 'active' : ''}`}
                  >
                    <MessageSquare size={14} />
                    <span>Teks / Broadcast</span>
                  </button>
                </div>

                {/* File Dropzone for PDF / Image */}
                {inputTab !== 'text' ? (
                  <div>
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      onChange={handleFileSelect} 
                      accept={inputTab === 'pdf' ? '.pdf,application/pdf' : '.jpg,.jpeg,.png,.webp,image/*'}
                      style={{ display: 'none' }} 
                    />
                    
                    <div 
                      className={`dropzone ${isDragging ? 'dragging' : ''}`}
                      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={handleFileDrop}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {selectedFile ? (
                        <div>
                          <CheckCircle2 size={36} color="var(--signal-green)" style={{ margin: '0 auto 0.75rem' }} />
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', fontWeight: 600, color: '#FFF' }}>
                            {selectedFile.name}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: 4 }}>
                            {(selectedFile.size / 1024).toFixed(1)} KB &bull; Klik untuk mengganti berkas
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div className="dropzone-icon">
                            {inputTab === 'pdf' ? <FileText size={36} /> : <ImageIcon size={36} />}
                          </div>
                          <div style={{ fontWeight: 600, color: '#FFF', marginBottom: 4 }}>
                            Tarik berkas {inputTab === 'pdf' ? 'PDF Surat Dinas' : 'Poster Flyer'} ke sini
                          </div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                            atau klik untuk memilih dari komputer Anda (Maksimal 10MB)
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div>
                    {/* Text Input Area */}
                    <div className="form-group">
                      <div className="form-label">
                        <span>Pesan Chat / Broadcast Undangan</span>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button 
                            type="button" 
                            onClick={() => setInputText(SAMPLE_TEXT_LETTER)} 
                            style={{ background: 'none', border: 'none', color: 'var(--signal-amber)', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', cursor: 'pointer' }}
                          >
                            Contoh Surat
                          </button>
                          <button 
                            type="button" 
                            onClick={() => setInputText(SAMPLE_TEXT_POSTER)} 
                            style={{ background: 'none', border: 'none', color: 'var(--signal-amber)', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', cursor: 'pointer' }}
                          >
                            Contoh Poster
                          </button>
                        </div>
                      </div>
                      <textarea 
                        className="form-control"
                        rows={10}
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        placeholder="Tempelkan isi surat dinas, flyer kegiatan, atau broadcast pesan WhatsApp di sini..."
                        style={{ resize: 'vertical' }}
                      />
                    </div>
                  </div>
                )}

                {/* Error Banner */}
                {errorMessage && (
                  <div style={{ marginTop: '1rem', background: 'rgba(255, 51, 75, 0.1)', border: '1px solid rgba(255, 51, 75, 0.3)', padding: '0.85rem 1rem', borderRadius: 3, display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--signal-red)', fontSize: '0.8125rem' }}>
                    <AlertCircle size={16} />
                    <span>{errorMessage}</span>
                  </div>
                )}

                {/* Extract Action Button */}
                <div style={{ marginTop: '1.5rem' }}>
                  <button 
                    onClick={handleExtract}
                    disabled={isLoading}
                    className="btn-tactile btn-primary"
                    style={{ width: '100%', padding: '0.85rem 1rem', fontSize: '0.9rem' }}
                  >
                    {isLoading ? (
                      <>
                        <span className="spinner-chassis"></span>
                        <span>{statusMessage || 'Mengekstrak Agenda...'}</span>
                      </>
                    ) : (
                      <>
                        <Sparkles size={16} />
                        <span>Mulai Ekstraksi AI & Jadwalkan</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Extracted Calendar Output Column / Events History List */}
            <div className="chassis-card">
              <div className="chassis-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="chassis-title">
                  <Calendar size={14} color="var(--signal-green)" />
                  <span>Riwayat Agenda & Google Calendar</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="status-badge-tag badge-online">
                    <span>{eventsTotal} Agenda</span>
                  </span>
                  <button 
                    onClick={() => fetchEventsHistory(eventsPage)}
                    title="Muat Ulang Riwayat"
                    className="btn-tactile"
                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                  >
                    <RefreshCw size={12} className={eventsLoading ? 'spin-anim' : ''} />
                  </button>
                </div>
              </div>

              <div className="chassis-body">
                {/* Auto Sync Notification Banner for Newly Extracted Item */}
                {autoSyncResult?.synced && (
                  <div style={{ background: 'rgba(0, 255, 102, 0.1)', border: '1px solid rgba(0, 255, 102, 0.3)', padding: '0.85rem 1rem', borderRadius: 3, marginBottom: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <CheckCircle2 size={16} color="var(--signal-green)" />
                      <span style={{ fontSize: '0.8125rem', color: '#FFF' }}>
                        Agenda terbaru otomatis tersimpan ke Google Calendar <strong>({autoSyncResult.email})</strong>
                      </span>
                    </div>
                    {autoSyncResult.htmlLink && (
                      <a 
                        href={autoSyncResult.htmlLink} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="btn-tactile btn-success"
                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', textDecoration: 'none' }}
                      >
                        <ExternalLink size={12} />
                        <span>Buka Event</span>
                      </a>
                    )}
                  </div>
                )}

                {eventsLoading && eventsList.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '3.5rem 1.5rem', color: 'var(--text-dim)' }}>
                    <span className="spinner-chassis" style={{ width: 28, height: 28, margin: '0 auto 1rem' }}></span>
                    <div style={{ fontSize: '0.85rem' }}>Memuat riwayat agenda...</div>
                  </div>
                ) : eventsList.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '4rem 1.5rem', color: 'var(--text-faint)' }}>
                    <Calendar size={48} style={{ opacity: 0.3, margin: '0 auto 1rem' }} />
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--text-dim)', marginBottom: '0.5rem' }}>
                      BELUM ADA AGENDA DIEKSTRAK
                    </div>
                    <p style={{ fontSize: '0.8125rem', maxWidth: 360, margin: '0 auto', lineHeight: 1.6 }}>
                      Unggah surat dinas PDF, poster flyer, atau kirimkan pesan ke <strong>Bot Telegram</strong> untuk melihat riwayat agenda tersinkronisasi otomatis di sini.
                    </p>
                  </div>
                ) : (
                  <div>
                    {/* List of Agenda Items */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      {eventsList.map((item) => {
                        const startDt = DateTime.fromISO(item.start_time).setZone('Asia/Jakarta');
                        const endDt = DateTime.fromISO(item.end_time).setZone('Asia/Jakarta');
                        const createdDt = DateTime.fromISO(item.created_at).setZone('Asia/Jakarta');

                        return (
                          <div 
                            key={item.id}
                            style={{
                              background: 'var(--bg-inset)',
                              border: '1px solid rgba(255, 255, 255, 0.08)',
                              borderRadius: 4,
                              padding: '1rem',
                              transition: 'all 0.2s ease',
                              position: 'relative'
                            }}
                          >
                            {/* Meta Header Row */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem', flexWrap: 'wrap', gap: '0.4rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                                {/* Source Tag Badge */}
                                {item.source_type === 'telegram' ? (
                                  <span className="status-badge-tag" style={{ background: 'rgba(0, 136, 204, 0.15)', color: '#0088cc', border: '1px solid rgba(0, 136, 204, 0.3)', fontSize: '0.7rem', padding: '0.15rem 0.45rem' }}>
                                    <Bot size={11} />
                                    <span>Telegram Bot</span>
                                  </span>
                                ) : item.source_type === 'pdf' ? (
                                  <span className="status-badge-tag" style={{ background: 'rgba(255, 51, 75, 0.15)', color: 'var(--signal-red)', border: '1px solid rgba(255, 51, 75, 0.3)', fontSize: '0.7rem', padding: '0.15rem 0.45rem' }}>
                                    <FileText size={11} />
                                    <span>Surat PDF</span>
                                  </span>
                                ) : item.source_type === 'image' ? (
                                  <span className="status-badge-tag" style={{ background: 'rgba(168, 85, 247, 0.15)', color: '#a855f7', border: '1px solid rgba(168, 85, 247, 0.3)', fontSize: '0.7rem', padding: '0.15rem 0.45rem' }}>
                                    <Sparkles size={11} />
                                    <span>Poster Flyer</span>
                                  </span>
                                ) : (
                                  <span className="status-badge-tag" style={{ background: 'rgba(0, 255, 102, 0.15)', color: 'var(--signal-green)', border: '1px solid rgba(0, 255, 102, 0.3)', fontSize: '0.7rem', padding: '0.15rem 0.45rem' }}>
                                    <MessageSquare size={11} />
                                    <span>Teks Undangan</span>
                                  </span>
                                )}

                                {/* Input Timestamp Badge */}
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                                  Input: {createdDt.isValid ? createdDt.toFormat('dd MMM yyyy, HH:mm') : item.created_at} WIB
                                </span>
                              </div>

                              {/* Delete Button */}
                              <button 
                                onClick={(e) => handleDeleteHistoryEvent(item.id, e)}
                                title="Hapus dari riwayat"
                                style={{ background: 'transparent', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', padding: '0.2rem', display: 'flex', alignItems: 'center', transition: 'color 0.2s' }}
                                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--signal-red)')}
                                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-faint)')}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>

                            {/* Event Title */}
                            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#FFF', marginBottom: '0.6rem', lineHeight: 1.35 }}>
                              {item.title}
                            </h3>

                            {/* Schedule & Venue Specs */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.45rem', fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '0.75rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                <Clock size={13} color="var(--signal-amber)" />
                                <span>
                                  {startDt.isValid ? startDt.toFormat('dd MMM yyyy, HH:mm') : item.start_time} - {endDt.isValid ? endDt.toFormat('HH:mm') : item.end_time} WIB
                                </span>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                <MapPin size={13} color="var(--signal-blue)" />
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {item.location || (item.is_online ? 'Daring (Zoom/Meet)' : 'Tidak tercantum')}
                                </span>
                              </div>

                              {item.jp && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                  <BookOpen size={13} color="var(--signal-green)" />
                                  <span>Bobot: <strong>{item.jp}</strong></span>
                                </div>
                              )}
                            </div>

                            {/* Virtual Meeting Details if present */}
                            {item.is_online && (item.meeting_link || item.meeting_id_pass) && (
                              <div style={{ background: 'rgba(0, 102, 255, 0.08)', border: '1px solid rgba(0, 102, 255, 0.2)', padding: '0.5rem 0.75rem', borderRadius: 3, marginBottom: '0.75rem', fontSize: '0.78rem' }}>
                                {item.meeting_link && (
                                  <div style={{ wordBreak: 'break-all', marginBottom: item.meeting_id_pass ? 3 : 0 }}>
                                    <span style={{ color: 'var(--text-faint)' }}>Link: </span>
                                    <a href={item.meeting_link} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--signal-blue)' }}>
                                      {item.meeting_link}
                                    </a>
                                  </div>
                                )}
                                {item.meeting_id_pass && (
                                  <div style={{ color: '#FFF' }}>
                                    <span style={{ color: 'var(--text-faint)' }}>Kredensial: </span>
                                    {item.meeting_id_pass}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Speakers */}
                            {item.speakers && (
                              <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginBottom: '0.75rem' }}>
                                <span style={{ color: 'var(--text-faint)', textTransform: 'uppercase', fontSize: '0.68rem', display: 'block', marginBottom: 2 }}>Narasumber / Keynote</span>
                                {item.speakers}
                              </div>
                            )}

                            {/* Action Buttons Row */}
                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', paddingTop: '0.5rem', borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
                              <a 
                                href={item.google_calendar_url || buildGoogleCalendarUrl(item as any)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn-tactile btn-primary"
                                style={{ padding: '0.35rem 0.65rem', fontSize: '0.75rem', textDecoration: 'none' }}
                              >
                                <Calendar size={12} />
                                <span>Buka di Google Calendar</span>
                              </a>

                              <button 
                                onClick={() => handleDownloadSpecificICS(item)}
                                className="btn-tactile"
                                style={{ padding: '0.35rem 0.65rem', fontSize: '0.75rem' }}
                              >
                                <Download size={12} />
                                <span>.ICS</span>
                              </button>

                              <button 
                                onClick={() => handleCopyText(`${item.title}\nWaktu: ${startDt.isValid ? startDt.toFormat('dd MMM yyyy, HH:mm') : item.start_time} WIB\nLokasi: ${item.location || '-'}\n${item.description || ''}`, item.id)}
                                className="btn-tactile"
                                style={{ padding: '0.35rem 0.65rem', fontSize: '0.75rem' }}
                              >
                                {copyFeedback === item.id ? <Check size={12} color="var(--signal-green)" /> : <Copy size={12} />}
                                <span>{copyFeedback === item.id ? 'Disalin!' : 'Salin'}</span>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Pagination Controls */}
                    {eventsTotalPages > 1 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid rgba(255, 255, 255, 0.08)', flexWrap: 'wrap', gap: '0.75rem' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                          Halaman {eventsPage} dari {eventsTotalPages} ({eventsTotal} total)
                        </div>

                        <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                          <button 
                            onClick={() => fetchEventsHistory(eventsPage - 1)}
                            disabled={eventsPage <= 1 || eventsLoading}
                            className="btn-tactile"
                            style={{ padding: '0.35rem 0.65rem', fontSize: '0.75rem' }}
                          >
                            <ChevronLeft size={13} />
                            <span>Prev</span>
                          </button>

                          {Array.from({ length: eventsTotalPages }, (_, i) => i + 1).map((pg) => (
                            <button
                              key={pg}
                              onClick={() => fetchEventsHistory(pg)}
                              disabled={eventsLoading}
                              className={`btn-tactile ${pg === eventsPage ? 'btn-primary' : ''}`}
                              style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem', minWidth: 28, textAlign: 'center' }}
                            >
                              {pg}
                            </button>
                          ))}

                          <button 
                            onClick={() => fetchEventsHistory(eventsPage + 1)}
                            disabled={eventsPage >= eventsTotalPages || eventsLoading}
                            className="btn-tactile"
                            style={{ padding: '0.35rem 0.65rem', fontSize: '0.75rem' }}
                          >
                            <span>Next</span>
                            <ChevronRight size={13} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------
          TAB 2: PENGATURAN & KREDENSIAL (SETTINGS)
          ---------------------------------------------------- */}
      {activeView === 'settings' && (
        <div style={{ maxWidth: 840, margin: '0 auto' }}>
          <div className="chassis-card">
            <div className="chassis-header">
              <div className="chassis-title">
                <Settings size={14} color="var(--signal-amber)" />
                <span>Pengaturan Akun & Kredensial (Neon PostgreSQL)</span>
              </div>
              <div className="status-badge-tag badge-online">
                <Database size={12} />
                <span>{dbStatus?.connected ? 'Neon DB Terhubung' : 'Penyimpanan Lokal'}</span>
              </div>
            </div>

            <div className="chassis-body">
              {/* Settings Notification */}
              {settingsStatus && (
                <div style={{ 
                  background: settingsStatus.type === 'success' ? 'rgba(0, 255, 102, 0.1)' : 'rgba(255, 51, 75, 0.1)',
                  border: `1px solid ${settingsStatus.type === 'success' ? 'rgba(0, 255, 102, 0.3)' : 'rgba(255, 51, 75, 0.3)'}`,
                  color: settingsStatus.type === 'success' ? 'var(--signal-green)' : 'var(--signal-red)',
                  padding: '0.875rem 1.25rem',
                  borderRadius: 3,
                  marginBottom: '1.5rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem',
                  fontSize: '0.875rem'
                }}>
                  {settingsStatus.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                  <span>{settingsStatus.message}</span>
                </div>
              )}

              <form onSubmit={handleSaveSettings}>
                {/* 1. Google Gemini API Key */}
                <div className="form-group">
                  <div className="form-label">
                    <span>Google Gemini API Key (BYOK) *</span>
                    <a 
                      href="https://aistudio.google.com/app/apikey" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      style={{ color: 'var(--signal-amber)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      <span>Dapatkan API Key Gratis</span>
                      <ExternalLink size={11} />
                    </a>
                  </div>
                  <div style={{ position: 'relative' }}>
                    <input 
                      type={showApiKey ? 'text' : 'password'}
                      className="form-control"
                      value={settingsForm.geminiApiKey}
                      onChange={(e) => setSettingsForm({ ...settingsForm, geminiApiKey: e.target.value })}
                      placeholder="AIzaSy..."
                      style={{ paddingRight: '2.5rem' }}
                    />
                    <button 
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }}
                    >
                      {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-faint)', marginTop: 4 }}>
                    API Key tersimpan aman di database Neon PostgreSQL dan hanya digunakan untuk akun Anda.
                  </div>
                </div>

                {/* 2. Model Selection & OCR Engine */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <div className="form-label">
                      <span>Model AI Gemini</span>
                    </div>
                    <select 
                      className="form-control"
                      value={settingsForm.modelName}
                      onChange={(e) => setSettingsForm({ ...settingsForm, modelName: e.target.value })}
                    >
                      <option value="gemini-3.6-flash">Gemini 3.6 Flash (Direkomendasikan)</option>
                      <option value="gemini-2.5-flash">Gemini 2.5 Flash (Cepat)</option>
                      <option value="gemini-1.5-pro">Gemini 1.5 Pro (Penalaran Kompleks)</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <div className="form-label">
                      <span>OCR Engine Pipeline</span>
                    </div>
                    <select 
                      className="form-control"
                      value={settingsForm.ocrEngine}
                      onChange={(e) => setSettingsForm({ ...settingsForm, ocrEngine: e.target.value })}
                    >
                      <option value="gemini">Gemini Multimodal Vision (Bawaan)</option>
                      <option value="ocr_service">Custom OCR Endpoint</option>
                    </select>
                  </div>
                </div>

                {/* 3. Target Calendar ID */}
                <div className="form-group">
                  <div className="form-label">
                    <span>Target Google Calendar ID</span>
                  </div>
                  <input 
                    type="text"
                    className="form-control"
                    value={settingsForm.calendarId}
                    onChange={(e) => setSettingsForm({ ...settingsForm, calendarId: e.target.value })}
                    placeholder="primary atau c_xxxx@group.calendar.google.com"
                  />
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-faint)', marginTop: 4 }}>
                    Gunakan <code>primary</code> untuk kalender utama akun Anda, atau masukkan Calendar ID kalender tim/kantor.
                  </div>
                </div>

                {/* 4. Telegram Bot Token */}
                <div className="form-group">
                  <div className="form-label">
                    <span>Telegram Bot Token (Opsional)</span>
                    <span style={{ color: 'var(--text-faint)' }}>Dari @BotFather</span>
                  </div>
                  <input 
                    type="text"
                    className="form-control"
                    value={settingsForm.telegramBotToken}
                    onChange={(e) => setSettingsForm({ ...settingsForm, telegramBotToken: e.target.value })}
                    placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                  />
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-faint)', marginTop: 4 }}>
                    Diperlukan jika Anda ingin bot Telegram sendiri yang langsung terhubung ke aplikasi Anda.
                  </div>
                </div>

                {/* Save Button */}
                <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end' }}>
                  <button 
                    type="submit" 
                    disabled={isSavingSettings}
                    className="btn-tactile btn-primary"
                    style={{ padding: '0.85rem 1.75rem', fontSize: '0.9rem' }}
                  >
                    {isSavingSettings ? (
                      <>
                        <span className="spinner-chassis"></span>
                        <span>Menyimpan ke Database...</span>
                      </>
                    ) : (
                      <>
                        <Check size={16} />
                        <span>Simpan Konfigurasi</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------
          TAB 3: INTEGRASI TELEGRAM BOT
          ---------------------------------------------------- */}
      {activeView === 'telegram' && (
        <div style={{ maxWidth: 840, margin: '0 auto' }}>
          <div className="chassis-card">
            <div className="chassis-header">
              <div className="chassis-title">
                <Bot size={14} color="var(--signal-blue)" />
                <span>Integrasi Bot Telegram & Webhook</span>
              </div>
            </div>

            <div className="chassis-body">
              <p style={{ fontSize: '0.875rem', color: 'var(--text-dim)', marginBottom: '1.5rem', lineHeight: 1.6 }}>
                Dengan menghubungkan Bot Telegram, Anda cukup mengirim dokumen surat dinas PDF, foto poster, atau meneruskan pesan chat undangan ke bot di Telegram. Agenda akan otomatis diekstrak dan dijadwalkan ke Google Calendar Anda secara <strong>0-Click</strong>.
              </p>

              <div style={{ background: 'var(--bg-inset)', border: 'var(--border-chassis)', padding: '1.25rem', borderRadius: 4, marginBottom: '1.5rem' }}>
                <h4 style={{ fontSize: '0.9rem', fontWeight: 600, color: '#FFF', marginBottom: '0.75rem' }}>
                  Langkah-Langkah Pemasangan:
                </h4>
                <ol style={{ paddingLeft: '1.25rem', fontSize: '0.85rem', color: 'var(--text-dim)', lineHeight: 1.8 }}>
                  <li>Buka Telegram dan buat bot baru melalui <strong>@BotFather</strong> dengan perintah <code>/newbot</code>.</li>
                  <li>Salin <strong>HTTP API Bot Token</strong> dan tempelkan ke form di tab <strong>Pengaturan & Kredensial</strong>.</li>
                  <li>Klik tombol <strong>"Pasang Webhook Otomatis"</strong> di bawah ini.</li>
                  <li>Mulai chat dengan bot Anda dan ketik <code>/connect</code> untuk menghubungkan akun Google Calendar Anda!</li>
                </ol>
              </div>

              {/* Webhook Status */}
              {tgStatus.info && (
                <div style={{ background: 'rgba(0, 255, 102, 0.1)', border: '1px solid rgba(0, 255, 102, 0.3)', padding: '0.85rem 1rem', borderRadius: 3, marginBottom: '1.25rem', color: 'var(--signal-green)', fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>
                  {tgStatus.info}
                </div>
              )}
              {tgStatus.error && (
                <div style={{ background: 'rgba(255, 51, 75, 0.1)', border: '1px solid rgba(255, 51, 75, 0.3)', padding: '0.85rem 1rem', borderRadius: 3, marginBottom: '1.25rem', color: 'var(--signal-red)', fontSize: '0.85rem' }}>
                  {tgStatus.error}
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <button 
                  onClick={handleSetupTelegramWebhook}
                  disabled={tgStatus.loading}
                  className="btn-tactile btn-primary"
                >
                  {tgStatus.loading ? <span className="spinner-chassis"></span> : <Send size={14} />}
                  <span>Pasang Webhook Otomatis</span>
                </button>

                <button 
                  onClick={handleCheckTelegramWebhook}
                  disabled={tgStatus.loading}
                  className="btn-tactile"
                >
                  <RefreshCw size={14} />
                  <span>Periksa Status Webhook</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------
          TAB 4: PANDUAN & DOKUMENTASI API
          ---------------------------------------------------- */}
      {activeView === 'docs' && (
        <div style={{ maxWidth: 840, margin: '0 auto' }}>
          <div className="chassis-card">
            <div className="chassis-header">
              <div className="chassis-title">
                <Code2 size={14} color="var(--signal-amber)" />
                <span>Dokumentasi API & Integrasi Eksternal</span>
              </div>
            </div>

            <div className="chassis-body" style={{ fontSize: '0.875rem', color: 'var(--text-dim)', lineHeight: 1.7 }}>
              <h4 style={{ color: '#FFF', fontSize: '1rem', marginBottom: '0.5rem' }}>
                1. Endpoint Ekstraksi Agenda (POST <code>/api/extract</code>)
              </h4>
              <p style={{ marginBottom: '1rem' }}>
                Mendukung <code>multipart/form-data</code> (unggah file PDF / Gambar) dan <code>application/json</code> (teks undangan).
              </p>

              <pre style={{ background: 'var(--bg-inset)', border: 'var(--border-chassis)', padding: '1rem', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--signal-amber)', overflowX: 'auto', marginBottom: '1.5rem' }}>
{`curl -X POST "${typeof window !== 'undefined' ? window.location.origin : ''}/api/extract" \\
  -F "file=@surat_undangan.pdf" \\
  -F "apiKey=YOUR_GEMINI_API_KEY" \\
  -F "autoSync=true"`}
              </pre>

              <h4 style={{ color: '#FFF', fontSize: '1rem', marginBottom: '0.5rem' }}>
                2. Endpoint Status Otorisasi (GET <code>/api/auth/me</code>)
              </h4>
              <p>
                Mengembalikan status sesi autentikasi, detail profil user Google, status kalender, dan koneksi database Neon PostgreSQL.
              </p>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
