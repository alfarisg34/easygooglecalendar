'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  Calendar, FileText, Image as ImageIcon, MessageSquare, 
  Key, Bot, Code2, Sparkles, Download, Copy, Check, 
  ExternalLink, Trash2, RefreshCw, Clock, MapPin, 
  Video, Users, BookOpen, AlertCircle, Send, CheckCircle2
} from 'lucide-react';
import { CalendarEvent } from '@/lib/types';
import { DateTime } from 'luxon';
import { buildGoogleCalendarUrl, generateICSContent } from '@/lib/calendar-builder';

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
  // Config & BYOK State
  const [apiKey, setApiKey] = useState<string>('');
  const [model, setModel] = useState<string>('gemini-3.6-flash');
  const [engine, setEngine] = useState<'gemini' | 'ocr_service'>('gemini');

  // Input States
  const [activeTab, setActiveTab] = useState<'pdf' | 'image' | 'text'>('pdf');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [inputText, setInputText] = useState<string>('');
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Execution States
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [extractedEvent, setExtractedEvent] = useState<CalendarEvent | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Modals & Popups
  const [isKeyModalOpen, setIsKeyModalOpen] = useState<boolean>(false);
  const [isTelegramModalOpen, setIsTelegramModalOpen] = useState<boolean>(false);
  const [isApiDocsOpen, setIsApiDocsOpen] = useState<boolean>(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  // Telegram Setup State
  const [tgBotToken, setTgBotToken] = useState<string>('');
  const [tgCustomUrl, setTgCustomUrl] = useState<string>('');
  const [tgBotInfo, setTgBotInfo] = useState<any>(null);
  const [tgStatus, setTgStatus] = useState<{ loading: boolean; info?: string; error?: string }>({ loading: false });

  // Google OAuth Web State
  const [googleAccount, setGoogleAccount] = useState<{ connected: boolean; email?: string; name?: string } | null>(null);
  const [autoSyncResult, setAutoSyncResult] = useState<any>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const checkGoogleAuthStatus = async () => {
    try {
      const res = await fetch('/api/auth/status?user_id=web_user');
      const data = await res.json();
      if (data.connected) {
        setGoogleAccount(data);
      } else {
        setGoogleAccount({ connected: false });
      }
    } catch (e) {
      setGoogleAccount({ connected: false });
    }
  };

  // Load stored settings on mount
  useEffect(() => {
    const savedKey = localStorage.getItem('gemini_calendar_api_key');
    if (savedKey) setApiKey(savedKey);
    const savedBotToken = localStorage.getItem('tg_bot_token');
    if (savedBotToken) setTgBotToken(savedBotToken);
    checkGoogleAuthStatus();
  }, []);

  const handleDisconnectGoogle = async () => {
    if (!confirm('Putuskan akun Google Calendar dari aplikasi?')) return;
    try {
      await fetch('/api/auth/status?user_id=web_user', { method: 'DELETE' });
      setGoogleAccount({ connected: false });
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveApiKey = (key: string) => {
    setApiKey(key);
    localStorage.setItem('gemini_calendar_api_key', key);
    setIsKeyModalOpen(false);
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      setSelectedFile(file);
      if (file.name.toLowerCase().endsWith('.pdf')) {
        setActiveTab('pdf');
      } else {
        setActiveTab('image');
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFile(e.target.files[0]);
    }
  };

  // Perform Extraction
  const handleExtract = async () => {
    if (!apiKey) {
      setIsKeyModalOpen(true);
      return;
    }

    if (activeTab === 'text' && !inputText.trim()) {
      alert('Mohon masukkan teks surat atau undangan terlebih dahulu.');
      return;
    }

    if ((activeTab === 'pdf' || activeTab === 'image') && !selectedFile) {
      alert('Mohon pilih atau unggah berkas terlebih dahulu.');
      return;
    }

    setIsLoading(true);
    setErrorMessage('');
    setAutoSyncResult(null);
    setStatusMessage('Menginisialisasi analisis berkas & visual reasoning...');

    try {
      let response: Response;
      const isAutoSync = Boolean(googleAccount?.connected);

      if (activeTab === 'text') {
        setStatusMessage('Menganalisis teks undangan dengan Google Gemini AI...');
        response = await fetch('/api/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey,
            model,
            engine,
            sourceType: 'text',
            text: inputText,
            userId: 'web_user',
            autoSync: isAutoSync
          })
        });
      } else {
        setStatusMessage(
          engine === 'ocr_service'
            ? 'Menjalankan OCR melalui ocr.alfarighilmana.my.id...'
            : 'Mengunggah & menganalisis multimodal visual di Gemini AI...'
        );
        const formData = new FormData();
        if (selectedFile) formData.append('file', selectedFile);
        formData.append('apiKey', apiKey);
        formData.append('model', model);
        formData.append('engine', engine);
        formData.append('userId', 'web_user');
        formData.append('autoSync', isAutoSync ? 'true' : 'false');

        response = await fetch('/api/extract', {
          method: 'POST',
          body: formData
        });
      }

      const data = await response.json();

      if (response.ok && data.success && data.event) {
        setExtractedEvent(data.event);
        if (data.autoSyncResult && data.autoSyncResult.synced) {
          setAutoSyncResult(data.autoSyncResult);
        }
        setStatusMessage('');
      } else {
        setErrorMessage(data.error || 'Gagal mengekstrak agenda dari dokumen.');
      }
    } catch (err: any) {
      setErrorMessage(`Koneksi error: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // 1-Click Action: Download ICS
  const handleDownloadIcs = () => {
    if (!extractedEvent) return;
    const icsString = generateICSContent(extractedEvent);
    const blob = new Blob([icsString], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(extractedEvent.title || 'agenda').replace(/[^a-zA-Z0-9]/g, '_')}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Copy Broadcast Text
  const handleCopyBroadcast = () => {
    if (!extractedEvent) return;
    const startDt = DateTime.fromISO(extractedEvent.start_time).setZone('Asia/Jakarta');
    const endDt = DateTime.fromISO(extractedEvent.end_time).setZone('Asia/Jakarta');

    const formatted = `📅 *${extractedEvent.title}*

🕒 *Waktu*: ${startDt.isValid ? startDt.toFormat('cccc, dd LLLL yyyy | HH:mm') : extractedEvent.start_time} s.d. ${endDt.isValid ? endDt.toFormat('HH:mm') : extractedEvent.end_time} WIB
📍 *Lokasi*: ${extractedEvent.location}
${extractedEvent.jp ? `📚 *Bobot*: ${extractedEvent.jp}\n` : ''}${extractedEvent.meeting_link ? `🔗 *Link Meeting*: ${extractedEvent.meeting_link}\n` : ''}${extractedEvent.meeting_id_pass ? `🔑 *Kredensial*: ${extractedEvent.meeting_id_pass}\n` : ''}${extractedEvent.speakers ? `👥 *Narasumber*: ${extractedEvent.speakers}\n` : ''}
📝 *Agenda & Keterangan*:
${extractedEvent.description}

🔗 *Simpan Langsung ke Google Calendar*:
${extractedEvent.google_calendar_url}`;

    navigator.clipboard.writeText(formatted).then(() => {
      setCopyFeedback('Teks tersalin!');
      setTimeout(() => setCopyFeedback(null), 2000);
    });
  };

  // Telegram Bot Test Token (@BotFather)
  const handleCheckBotInfo = async () => {
    if (!tgBotToken) {
      alert('Mohon masukkan Telegram Bot Token.');
      return;
    }
    setTgStatus({ loading: true, info: undefined, error: undefined });
    try {
      const res = await fetch('/api/telegram/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botToken: tgBotToken,
          action: 'get_me'
        })
      });
      const data = await res.json();
      if (data.ok && data.result) {
        setTgBotInfo(data.result);
        setTgStatus({ loading: false, info: `Bot Valid: @${data.result.username} (${data.result.first_name})` });
      } else {
        setTgStatus({ loading: false, error: data.description || 'Token bot tidak valid.' });
      }
    } catch (err: any) {
      setTgStatus({ loading: false, error: err.message });
    }
  };

  // Telegram Bot Webhook Setter
  const handleSetTelegramWebhook = async () => {
    if (!tgBotToken) {
      alert('Mohon masukkan Telegram Bot Token dari @BotFather');
      return;
    }
    if (!apiKey) {
      alert('Mohon masukkan Google Gemini API Key Anda terlebih dahulu di menu "Set Gemini Key (BYOK)".');
      return;
    }

    setTgStatus({ loading: true, info: undefined, error: undefined });
    localStorage.setItem('tg_bot_token', tgBotToken);

    try {
      let baseOrigin = tgCustomUrl.trim();
      if (!baseOrigin) {
        baseOrigin = window.location.origin;
      }

      // Ensure HTTPS for Telegram
      if (!baseOrigin.startsWith('https://')) {
        setTgStatus({ 
          loading: false, 
          error: 'Telegram mewajibkan URL HTTPS publik (misal: https://your-project.vercel.app atau https://xxxx.ngrok-free.app). Silakan deploy ke Vercel atau masukkan URL HTTPS Anda.' 
        });
        return;
      }

      // Remove trailing slash
      baseOrigin = baseOrigin.replace(/\/$/, '');
      const targetWebhookUrl = `${baseOrigin}/api/telegram/webhook?bot_token=${encodeURIComponent(tgBotToken)}&gemini_key=${encodeURIComponent(apiKey)}`;

      const res = await fetch('/api/telegram/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botToken: tgBotToken,
          webhookUrl: targetWebhookUrl,
          action: 'set_webhook'
        })
      });

      const data = await res.json();
      if (data.ok) {
        setTgStatus({ loading: false, info: data.description || 'Webhook aktif! Bot siap menerima berkas PDF & Poster.' });
      } else {
        setTgStatus({ loading: false, error: data.description || 'Gagal menyetel webhook.' });
      }
    } catch (err: any) {
      setTgStatus({ loading: false, error: err.message });
    }
  };

  // Telegram Delete Webhook
  const handleDeleteTelegramWebhook = async () => {
    if (!tgBotToken) return;
    setTgStatus({ loading: true, info: undefined, error: undefined });
    try {
      const res = await fetch('/api/telegram/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botToken: tgBotToken,
          action: 'delete_webhook'
        })
      });
      const data = await res.json();
      if (data.ok) {
        setTgStatus({ loading: false, info: 'Webhook berhasil dihapus.' });
      } else {
        setTgStatus({ loading: false, error: data.description || 'Gagal menghapus webhook.' });
      }
    } catch (err: any) {
      setTgStatus({ loading: false, error: err.message });
    }
  };

  return (
    <div className="app-container">
      
      {/* Masthead */}
      <header className="masthead">
        <div className="brand-badge">
          <span className="led"></span>
          <a href="#" className="brand-title">EasyCal // Studio</a>
          <span className="brand-sub">Serverless OCR & Gemini Calendar Engine</span>
        </div>

        <div className="masthead-actions">
          {/* Engine Selector */}
          <select 
            className="chassis-select" 
            style={{ width: 'auto', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}
            value={engine}
            onChange={(e) => setEngine(e.target.value as any)}
            title="Pilih Engine Ekstraksi"
          >
            <option value="gemini">⚡ Gemini Multimodal Direct</option>
            <option value="ocr_service">🔬 ocr.alfarighilmana.my.id + AI</option>
          </select>

          {/* Model Selector */}
          <select 
            className="chassis-select" 
            style={{ width: 'auto', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            <option value="gemini-3.6-flash">Gemini 3.6 Flash (Terbaru)</option>
            <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
            <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
            <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
          </select>

          {/* Telegram Connect Button */}
          <button 
            type="button" 
            className="btn-tactile"
            onClick={() => setIsTelegramModalOpen(true)}
            title="Hubungkan Telegram Bot Anda"
          >
            <Bot size={14} /> Telegram Bot
          </button>

          {/* API Docs Button */}
          <button 
            type="button" 
            className="btn-tactile"
            onClick={() => setIsApiDocsOpen(true)}
            title="Dokumentasi REST API & cURL"
          >
            <Code2 size={14} /> API
          </button>

          {/* Google Calendar OAuth Auto-Sync Button */}
          {googleAccount?.connected ? (
            <button 
              type="button" 
              className="btn-tactile"
              style={{ color: 'var(--signal-green)', borderColor: 'rgba(0, 255, 102, 0.3)' }}
              onClick={handleDisconnectGoogle}
              title={`Google Calendar terhubung (${googleAccount.email}). Klik untuk memutuskan koneksi.`}
            >
              <CheckCircle2 size={14} color="var(--signal-green)" /> {googleAccount.email}
            </button>
          ) : (
            <a 
              href="/api/auth/google?user_id=web_user"
              className="btn-tactile"
              title="Hubungkan Akun Google untuk Direct 0-Click Auto-Sync"
            >
              <Calendar size={14} /> Hubungkan Google (0-Click)
            </a>
          )}

          {/* BYOK Button */}
          <button 
            type="button" 
            className={`btn-tactile ${apiKey ? '' : 'btn-primary'}`}
            onClick={() => setIsKeyModalOpen(true)}
          >
            <Key size={14} />
            {apiKey ? 'API Key: Set' : 'Set Gemini Key (BYOK)'}
          </button>
        </div>
      </header>

      {/* Main Split Viewport */}
      <main className="split-viewport">
        
        {/* Left Column: Input Panel */}
        <section className="chassis-card">
          <div className="chassis-header">
            <span>[ 01 / SOURCE INGESTION ]</span>
            <span>Maks: 50 MB</span>
          </div>

          <div className="chassis-body">
            
            {/* Mode Switcher */}
            <div className="mode-segmented">
              <button 
                type="button"
                className={`mode-tab ${activeTab === 'pdf' ? 'active' : ''}`}
                onClick={() => { setActiveTab('pdf'); setSelectedFile(null); }}
              >
                <FileText size={13} /> Dokumen PDF
              </button>
              <button 
                type="button"
                className={`mode-tab ${activeTab === 'image' ? 'active' : ''}`}
                onClick={() => { setActiveTab('image'); setSelectedFile(null); }}
              >
                <ImageIcon size={13} /> Poster Gambar
              </button>
              <button 
                type="button"
                className={`mode-tab ${activeTab === 'text' ? 'active' : ''}`}
                onClick={() => { setActiveTab('text'); setSelectedFile(null); }}
              >
                <MessageSquare size={13} /> Pesan Teks
              </button>
            </div>

            {/* Tab 1 & 2: File Upload (PDF / Image) */}
            {(activeTab === 'pdf' || activeTab === 'image') && (
              <div>
                {!selectedFile ? (
                  <div 
                    className={`chassis-dropzone ${isDragging ? 'dragover' : ''}`}
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleFileDrop}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <span className="dropzone-icon">{activeTab === 'pdf' ? '📄' : '🖼️'}</span>
                    <div className="dropzone-title">
                      Tarik berkas {activeTab === 'pdf' ? 'Surat PDF' : 'Poster Gambar'} ke sini
                    </div>
                    <div className="dropzone-sub">
                      atau klik untuk memilih ({activeTab === 'pdf' ? '.PDF' : '.JPG, .PNG, .WEBP'})
                    </div>
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      style={{ display: 'none' }}
                      accept={activeTab === 'pdf' ? '.pdf' : 'image/jpeg,image/png,image/webp'}
                      onChange={handleFileSelect}
                    />
                  </div>
                ) : (
                  <div className="file-selected-box">
                    <div>
                      <div className="file-meta-name">{selectedFile.name}</div>
                      <div className="file-meta-sub">
                        {(selectedFile.size / 1024 / 1024).toFixed(2)} MB &bull; {selectedFile.type || 'Berkas Dokumen'}
                      </div>
                    </div>
                    <button 
                      type="button" 
                      className="btn-tactile" 
                      onClick={() => setSelectedFile(null)}
                      title="Ganti Berkas"
                    >
                      <Trash2 size={14} color="var(--signal-red)" /> Hapus
                    </button>
                  </div>
                )}

                {/* Quick Example Loaders */}
                <div style={{ marginTop: '1.25rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', alignSelf: 'center' }}>
                    Demo Cepat:
                  </span>
                  <button 
                    type="button" 
                    className="btn-tactile" 
                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
                    onClick={() => {
                      setActiveTab('text');
                      setInputText(SAMPLE_TEXT_LETTER);
                    }}
                  >
                    📄 Teks Surat Dinas
                  </button>
                  <button 
                    type="button" 
                    className="btn-tactile" 
                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
                    onClick={() => {
                      setActiveTab('text');
                      setInputText(SAMPLE_TEXT_POSTER);
                    }}
                  >
                    🖼️ Teks Poster Bimtek
                  </button>
                </div>
              </div>
            )}

            {/* Tab 3: Text Input */}
            {activeTab === 'text' && (
              <div>
                <div className="form-field">
                  <div className="field-label">
                    <span>Tempel Salinan Pesan WhatsApp / Chat Undangan</span>
                    <span>{inputText.length} Karakter</span>
                  </div>
                  <textarea 
                    className="chassis-textarea mono"
                    rows={12}
                    placeholder="Contoh: Yth. Bapak/Ibu, mengundang rapat koordinasi pada hari Kamis 10 September 2026 pukul 09.00 WIB via Zoom..."
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                  />
                </div>

                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button 
                    type="button" 
                    className="btn-tactile" 
                    style={{ fontSize: '0.75rem' }}
                    onClick={() => setInputText(SAMPLE_TEXT_LETTER)}
                  >
                    Muat Contoh Surat Dinas
                  </button>
                  <button 
                    type="button" 
                    className="btn-tactile" 
                    style={{ fontSize: '0.75rem' }}
                    onClick={() => setInputText(SAMPLE_TEXT_POSTER)}
                  >
                    Muat Contoh Poster Zoom
                  </button>
                  <button 
                    type="button" 
                    className="btn-tactile" 
                    style={{ fontSize: '0.75rem', marginLeft: 'auto' }}
                    onClick={() => setInputText('')}
                  >
                    Bersihkan
                  </button>
                </div>
              </div>
            )}

            {/* Submit Action */}
            <div style={{ marginTop: '2rem' }}>
              <button 
                type="button" 
                className="btn-tactile btn-primary"
                style={{ width: '100%', padding: '0.85rem', fontSize: '0.95rem' }}
                disabled={isLoading}
                onClick={handleExtract}
              >
                {isLoading ? (
                  <>
                    <span className="spinner-chassis"></span>
                    <span>{statusMessage || 'Mengekstrak Agenda...'}</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={16} />
                    <span>Ekstrak Jadwal ke Google Calendar</span>
                  </>
                )}
              </button>
            </div>

            {/* Error Message */}
            {errorMessage && (
              <div style={{ 
                marginTop: '1.25rem', 
                padding: '0.85rem 1rem', 
                background: 'rgba(255, 51, 75, 0.1)', 
                border: '1px solid rgba(255, 51, 75, 0.3)',
                borderRadius: '2px',
                color: 'var(--signal-red)',
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <AlertCircle size={16} />
                <span>{errorMessage}</span>
              </div>
            )}

          </div>
        </section>

        {/* Right Column: Event Studio & Live Synchronizer */}
        <section className="chassis-card">
          <div className="chassis-header">
            <span>[ 02 / CALENDAR EVENT STUDIO ]</span>
            {extractedEvent ? (
              <span style={{ color: 'var(--signal-green)' }}>● EKSTRAKSI SUKSES</span>
            ) : (
              <span>MENUNGGU INPUT</span>
            )}
          </div>

          <div className="chassis-body">
            {!extractedEvent ? (
              <div style={{ 
                padding: '4rem 1.5rem', 
                textAlign: 'center', 
                color: 'var(--text-dim)',
                background: 'var(--bg-inset)',
                border: '1px dashed #202732',
                borderRadius: '2px'
              }}>
                <Calendar size={40} style={{ margin: '0 auto 1rem', opacity: 0.35, color: 'var(--signal-amber)' }} />
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', color: 'var(--text-main)', marginBottom: '0.5rem' }}>
                  Belum Ada Agenda yang Diekstrak
                </h3>
                <p style={{ maxWidth: '420px', margin: '0 auto', fontSize: '0.875rem' }}>
                  Unggah berkas surat dinas PDF, gambar flyer kegiatan, atau tempel pesan chat di panel sebelah kiri untuk memproses secara instan.
                </p>
              </div>
            ) : (
              <div>
                
                {/* Auto-Sync Confirmation Banner */}
                {autoSyncResult && autoSyncResult.synced && (
                  <div style={{
                    background: 'rgba(0, 255, 102, 0.08)',
                    border: '1px solid rgba(0, 255, 102, 0.3)',
                    padding: '0.85rem 1rem',
                    borderRadius: '2px',
                    color: 'var(--signal-green)',
                    fontSize: '0.85rem',
                    marginBottom: '1.25rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <CheckCircle2 size={16} color="var(--signal-green)" />
                      <span><strong>Otomatis Tersimpan!</strong> Langsung masuk ke kalender <code>{autoSyncResult.email}</code></span>
                    </div>
                    {autoSyncResult.htmlLink && (
                      <a href={autoSyncResult.htmlLink} target="_blank" rel="noopener noreferrer" style={{ color: '#FFF', textDecoration: 'underline', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                        Buka di Kalender &rarr;
                      </a>
                    )}
                  </div>
                )}

                {/* Event Title */}
                <div className="form-field">
                  <div className="field-label">
                    <span>Judul / Topik Agenda</span>
                    <span className="status-badge-tag badge-online">
                      {extractedEvent.is_online ? '🌐 DARING / ZOOM' : '🏢 LURING / OFFLINE'}
                    </span>
                  </div>
                  <input 
                    type="text" 
                    className="chassis-input"
                    style={{ fontSize: '1.05rem', fontWeight: 600 }}
                    value={extractedEvent.title}
                    onChange={(e) => {
                      const updated = { ...extractedEvent, title: e.target.value };
                      updated.google_calendar_url = buildGoogleCalendarUrl(updated);
                      setExtractedEvent(updated);
                    }}
                  />
                </div>

                {/* Time Matrix */}
                <div className="time-matrix-grid">
                  <div className="matrix-cell">
                    <div className="matrix-label"><Clock size={11} style={{ display: 'inline', marginRight: 4 }} /> Mulai (WIB)</div>
                    <input 
                      type="datetime-local" 
                      className="chassis-input mono"
                      style={{ padding: '0.35rem 0.5rem', fontSize: '0.85rem' }}
                      value={DateTime.fromISO(extractedEvent.start_time).setZone('Asia/Jakarta').toFormat("yyyy-MM-dd'T'HH:mm")}
                      onChange={(e) => {
                        const newIso = DateTime.fromISO(e.target.value, { zone: 'Asia/Jakarta' }).toISO();
                        if (newIso) {
                          const updated = { ...extractedEvent, start_time: newIso };
                          updated.google_calendar_url = buildGoogleCalendarUrl(updated);
                          setExtractedEvent(updated);
                        }
                      }}
                    />
                  </div>

                  <div className="matrix-cell">
                    <div className="matrix-label"><Clock size={11} style={{ display: 'inline', marginRight: 4 }} /> Selesai (WIB)</div>
                    <input 
                      type="datetime-local" 
                      className="chassis-input mono"
                      style={{ padding: '0.35rem 0.5rem', fontSize: '0.85rem' }}
                      value={DateTime.fromISO(extractedEvent.end_time).setZone('Asia/Jakarta').toFormat("yyyy-MM-dd'T'HH:mm")}
                      onChange={(e) => {
                        const newIso = DateTime.fromISO(e.target.value, { zone: 'Asia/Jakarta' }).toISO();
                        if (newIso) {
                          const updated = { ...extractedEvent, end_time: newIso };
                          updated.google_calendar_url = buildGoogleCalendarUrl(updated);
                          setExtractedEvent(updated);
                        }
                      }}
                    />
                  </div>
                </div>

                {/* Location & Meeting */}
                <div className="form-field">
                  <div className="field-label">
                    <span><MapPin size={11} style={{ display: 'inline', marginRight: 4 }} /> Lokasi / Ruang / Platform</span>
                  </div>
                  <input 
                    type="text" 
                    className="chassis-input"
                    value={extractedEvent.location}
                    onChange={(e) => {
                      const updated = { ...extractedEvent, location: e.target.value };
                      updated.google_calendar_url = buildGoogleCalendarUrl(updated);
                      setExtractedEvent(updated);
                    }}
                  />
                </div>

                {/* Zoom Credentials Drawer (if available) */}
                {(extractedEvent.meeting_link || extractedEvent.meeting_id_pass) && (
                  <div style={{ 
                    background: 'var(--bg-inset)', 
                    border: 'var(--border-chassis)', 
                    padding: '0.85rem 1rem', 
                    borderRadius: '2px',
                    marginBottom: '1.25rem'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--signal-blue)', textTransform: 'uppercase' }}>
                        <Video size={11} style={{ display: 'inline', marginRight: 4 }} /> Akses Pertemuan Virtual
                      </span>
                    </div>

                    {extractedEvent.meeting_link && (
                      <div style={{ fontSize: '0.82rem', wordBreak: 'break-all', marginBottom: '0.35rem' }}>
                        <a href={extractedEvent.meeting_link} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--signal-blue)', textDecoration: 'none' }}>
                          {extractedEvent.meeting_link} &rarr;
                        </a>
                      </div>
                    )}

                    {extractedEvent.meeting_id_pass && (
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                        {extractedEvent.meeting_id_pass}
                      </div>
                    )}
                  </div>
                )}

                {/* Badges: JP & Speakers */}
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
                  {extractedEvent.jp && (
                    <div className="status-badge-tag" style={{ background: 'rgba(255, 158, 11, 0.1)', color: 'var(--signal-amber)' }}>
                      <BookOpen size={11} /> {extractedEvent.jp}
                    </div>
                  )}
                  {extractedEvent.speakers && (
                    <div className="status-badge-tag" style={{ background: 'rgba(0, 255, 102, 0.1)', color: 'var(--signal-green)' }}>
                      <Users size={11} /> {extractedEvent.speakers}
                    </div>
                  )}
                </div>

                {/* Description */}
                <div className="form-field">
                  <div className="field-label">
                    <span>Rangkuman Agenda & Nomor Surat</span>
                  </div>
                  <textarea 
                    className="chassis-textarea"
                    rows={4}
                    value={extractedEvent.description}
                    onChange={(e) => {
                      const updated = { ...extractedEvent, description: e.target.value };
                      updated.google_calendar_url = buildGoogleCalendarUrl(updated);
                      setExtractedEvent(updated);
                    }}
                  />
                </div>

                {/* Primary Action Dock */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1.5rem' }}>
                  
                  {/* Big Google Calendar Button */}
                  <a 
                    href={extractedEvent.google_calendar_url || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-tactile btn-primary"
                    style={{ padding: '0.85rem', fontSize: '0.95rem', justifyContent: 'center' }}
                  >
                    <Calendar size={18} />
                    <span>Buka & Simpan di Google Calendar</span>
                    <ExternalLink size={14} />
                  </a>

                  {/* Secondary Export Actions */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <button 
                      type="button" 
                      className="btn-tactile"
                      onClick={handleDownloadIcs}
                    >
                      <Download size={14} /> Unduh File .ICS
                    </button>
                    <button 
                      type="button" 
                      className="btn-tactile"
                      onClick={handleCopyBroadcast}
                    >
                      {copyFeedback ? <Check size={14} color="var(--signal-green)" /> : <Copy size={14} />}
                      {copyFeedback || 'Salin Teks WA'}
                    </button>
                  </div>

                </div>

              </div>
            )}
          </div>
        </section>

      </main>

      {/* BYOK API Key Modal */}
      {isKeyModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsKeyModalOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span>[ KONFIGURASI GOOGLE GEMINI API KEY ]</span>
              <button 
                type="button" 
                style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }}
                onClick={() => setIsKeyModalOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--text-dim)', fontSize: '0.875rem', marginBottom: '1.25rem' }}>
                Layanan ini bersifat <strong>Public Serverless & Free (BYOK)</strong>. Kunci API Anda disimpan secara lokal di browser (localStorage) dan tidak pernah disimpan di database server.
              </p>

              <div className="form-field">
                <label className="field-label">Google Gemini API Key</label>
                <input 
                  type="password"
                  className="chassis-input mono"
                  placeholder="AIzaSy..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '0.5rem' }}>
                  Belum punya API key? <a href="https://aistudio.google.com/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--signal-amber)' }}>Dapatkan gratis di Google AI Studio &rarr;</a>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button 
                type="button" 
                className="btn-tactile"
                onClick={() => setIsKeyModalOpen(false)}
              >
                Batal
              </button>
              <button 
                type="button" 
                className="btn-tactile btn-primary"
                onClick={() => handleSaveApiKey(apiKey)}
              >
                Simpan Kunci
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Telegram Bot Setup Modal */}
      {isTelegramModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsTelegramModalOpen(false)}>
          <div className="modal-dialog" style={{ maxWidth: '640px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span>[ INTEGRASI TELEGRAM BOT WEBHOOK ]</span>
              <button 
                type="button" 
                style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }}
                onClick={() => setIsTelegramModalOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--text-dim)', fontSize: '0.875rem', marginBottom: '1.25rem' }}>
                Jadikan Telegram Bot Anda asisten otomatis: kirim PDF surat dinas, flyer kegiatan, atau pesan chat ke bot Telegram Anda, dan bot akan langsung membalas dengan ringkasan & tombol <strong>Google Calendar</strong>!
              </p>

              {/* Bot Token Input */}
              <div className="form-field">
                <div className="field-label">
                  <span>1. Telegram Bot Token</span>
                  <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--signal-amber)', textDecoration: 'none' }}>
                    Dapatkan di @BotFather &rarr;
                  </a>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input 
                    type="password"
                    className="chassis-input mono"
                    placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz..."
                    value={tgBotToken}
                    onChange={(e) => setTgBotToken(e.target.value)}
                  />
                  <button 
                    type="button" 
                    className="btn-tactile"
                    style={{ whiteSpace: 'nowrap' }}
                    onClick={handleCheckBotInfo}
                  >
                    Verifikasi
                  </button>
                </div>
              </div>

              {/* Public HTTPS Domain / Vercel URL */}
              <div className="form-field" style={{ marginTop: '1rem' }}>
                <div className="field-label">
                  <span>2. Domain Publik HTTPS (Vercel / Ngrok)</span>
                  <span style={{ color: 'var(--signal-amber)' }}>Wajib HTTPS</span>
                </div>
                <input 
                  type="text"
                  className="chassis-input mono"
                  placeholder="https://easygooglecalendar.alfarighilmana.my.id"
                  value={tgCustomUrl}
                  onChange={(e) => setTgCustomUrl(e.target.value)}
                />
                
                {/* Localhost notice */}
                {typeof window !== 'undefined' && window.location.origin.includes('localhost') && (
                  <div style={{ 
                    marginTop: '0.5rem', 
                    padding: '0.65rem 0.85rem', 
                    background: 'rgba(255, 158, 11, 0.08)', 
                    border: '1px solid rgba(255, 158, 11, 0.25)',
                    borderRadius: '2px',
                    fontSize: '0.75rem',
                    color: 'var(--signal-amber)',
                    lineHeight: 1.5
                  }}>
                    ⚠️ <strong>Anda sedang di Localhost (HTTP):</strong> Telegram Bot API mewajibkan URL dengan protokol <code>https://</code> publik. Silakan deploy ke Vercel (contoh: <code>https://project-anda.vercel.app</code>) atau gunakan tunnel (<code>npx ngrok http 3000</code>), lalu masukkan URL HTTPS tersebut di atas.
                  </div>
                )}
              </div>

              {/* Status Message */}
              {tgStatus.error && (
                <div style={{ 
                  marginTop: '1rem', 
                  padding: '0.65rem 0.85rem', 
                  background: 'rgba(255, 51, 75, 0.1)', 
                  border: '1px solid rgba(255, 51, 75, 0.3)',
                  borderRadius: '2px',
                  color: 'var(--signal-red)', 
                  fontSize: '0.8rem' 
                }}>
                  ❌ {tgStatus.error}
                </div>
              )}
              {tgStatus.info && (
                <div style={{ 
                  marginTop: '1rem', 
                  padding: '0.65rem 0.85rem', 
                  background: 'rgba(0, 255, 102, 0.1)', 
                  border: '1px solid rgba(0, 255, 102, 0.3)',
                  borderRadius: '2px',
                  color: 'var(--signal-green)', 
                  fontSize: '0.8rem' 
                }}>
                  ✅ {tgStatus.info}
                </div>
              )}

              <div style={{ 
                background: 'var(--bg-inset)', 
                border: 'var(--border-chassis)', 
                padding: '0.85rem', 
                borderRadius: '2px', 
                marginTop: '1.25rem',
                fontSize: '0.75rem',
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-dim)'
              }}>
                <div style={{ color: 'var(--signal-amber)', marginBottom: '0.25rem' }}>TARGET WEBHOOK ENDPOINT:</div>
                <div style={{ color: 'var(--text-main)', wordBreak: 'break-all' }}>
                  <code>POST {(tgCustomUrl || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '')}/api/telegram/webhook?bot_token=...&gemini_key=...</code>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button 
                type="button" 
                className="btn-tactile"
                onClick={handleDeleteTelegramWebhook}
                style={{ color: 'var(--signal-red)', marginRight: 'auto' }}
                title="Hapus webhook yang terpasang di Telegram"
              >
                Hapus Webhook
              </button>
              <button 
                type="button" 
                className="btn-tactile"
                onClick={() => setIsTelegramModalOpen(false)}
              >
                Tutup
              </button>
              <button 
                type="button" 
                className="btn-tactile btn-primary"
                disabled={tgStatus.loading}
                onClick={handleSetTelegramWebhook}
              >
                {tgStatus.loading ? 'Menghubungkan...' : 'Set Webhook Otomatis'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* API Documentation Modal */}
      {isApiDocsOpen && (
        <div className="modal-backdrop" onClick={() => setIsApiDocsOpen(false)}>
          <div className="modal-dialog" style={{ maxWidth: '720px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span>[ REST API & n8n INTEGRATION GUIDE ]</span>
              <button 
                type="button" 
                style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }}
                onClick={() => setIsApiDocsOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                Endpoint publik serverless ini dapat dipanggil langsung dari cURL, n8n HTTP Request node, Python, atau aplikasi frontend lainnya:
              </p>

              <div style={{ 
                background: 'var(--bg-inset)', 
                border: 'var(--border-chassis)', 
                padding: '1rem', 
                borderRadius: '2px', 
                fontSize: '0.78rem', 
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-main)',
                overflowX: 'auto',
                lineHeight: 1.6
              }}>
                <div style={{ color: 'var(--signal-amber)' }}># 1. Ekstraksi Dokumen PDF / Gambar (Multipart):</div>
                {`curl -X POST "${typeof window !== 'undefined' ? window.location.origin : ''}/api/extract" \\
  -H "x-api-key: YOUR_GEMINI_API_KEY" \\
  -F "file=@/path/to/undangan.pdf"`}

                <div style={{ color: 'var(--signal-amber)', marginTop: '1.25rem' }}># 2. Ekstraksi Pesan Chat Teks (JSON):</div>
                {`curl -X POST "${typeof window !== 'undefined' ? window.location.origin : ''}/api/extract" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: YOUR_GEMINI_API_KEY" \\
  -d '{
    "sourceType": "text",
    "text": "Undangan Rapat Evaluasi pada hari Kamis 10 Sept 2026 jam 09.00 WIB..."
  }'`}
              </div>
            </div>
            <div className="modal-footer">
              <button 
                type="button" 
                className="btn-tactile"
                onClick={() => setIsApiDocsOpen(false)}
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer style={{ 
        marginTop: '4rem', 
        borderTop: 'var(--border-chassis)', 
        paddingTop: '1.5rem', 
        display: 'flex', 
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1rem',
        fontSize: '0.75rem',
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-dim)'
      }}>
        <div>EasyCal // Kemnaker RI &bull; Powered by Google Gemini AI & ocr.alfarighilmana.my.id</div>
        <div>Zero-Retention Serverless Engine &bull; Ready for Vercel Deployment</div>
      </footer>

    </div>
  );
}
