# 📅 EasyCal // Serverless OCR & Gemini Calendar Studio

Layanan publik **Serverless OCR & Multimodal AI** untuk mengekstrak dokumen surat dinas (PDF), poster kegiatan (JPG/PNG), dan pesan broadcast chat ke **Google Calendar** secara instan (1-Click) dengan model **Bring Your Own Key (BYOK)** yang aman dan siap di-deploy ke **Vercel**.

Terintegrasi langsung dengan layanan OCR custom di [`https://ocr.alfarighilmana.my.id/`](https://ocr.alfarighilmana.my.id/) dan Google Gemini Flash AI.

---

## 🌟 Fitur Utama

1. **📄 Ekstraksi Multi-Format**:
   - **Dokumen Surat PDF**: Membaca surat dinas resmi, nomor surat, tanggal rapat, tempat, dan lampiran rundown.
   - **Poster / Flyer Gambar**: Membaca flyer webinar, bimtek, workshop, link meeting, Meeting ID, dan Passcode Zoom.
   - **Pesan Chat / Broadcast WhatsApp**: Salinan teks undangan langsung dianalisis dalam hitungan detik.
2. **📅 1-Click Google Calendar & `.ics`**:
   - Membuka halaman pembuatan event Google Calendar secara otomatis dengan data yang sudah terisi lengkap (Judul, Jam Mulai/Selesai WIB, Lokasi, Narasumber, dan Deskripsi).
   - Unduh file kalender standar `.ICS` untuk Apple Calendar, Outlook, atau Google Calendar.
3. **🤖 Integrasi Telegram Bot Webhook Serverless (`/api/telegram/webhook`)**:
   - Hubungkan bot Telegram Anda sendiri dengan memasukkan bot token di antarmuka web.
   - Setiap pengguna mengirim PDF/Poster/Teks ke bot, bot otomatis membalas dengan ringkasan dan tombol inline *Tambahkan ke Google Calendar*.
4. **🔒 100% Privacy-First & BYOK (Bring Your Own Key)**:
   - Tidak memerlukan database backend. Kunci API Gemini disimpan lokal di browser pengguna (`localStorage`).
5. **🎨 Desain Khusus & Responsif (`anti-template-ui`)**:
   - Mengusung tema *Industrial Cockpit & Editorial Precision* dengan kontrol taktil, indikator status LED, dan tipografi berbobot (*Instrument Serif*, *Plus Jakarta Sans*, *JetBrains Mono*).

---

## 🚀 Cara Menjalankan Secara Lokal

```bash
# 1. Masuk ke direktori proyek
cd easygooglecalendar

# 2. Install dependensi
npm install

# 3. Jalankan development server
npm run dev
```

Buka [http://localhost:3000](http://localhost:3000) di browser Anda.

---

## ☁️ Cara Deploy ke Vercel (1-Click)

### Opsi A: Menggunakan Vercel CLI
```bash
npm install -g vercel
vercel
```

### Opsi B: Menggunakan GitHub & Vercel Dashboard
1. Push repository ini ke GitHub.
2. Buka [https://vercel.com/new](https://vercel.com/new) dan import repository Anda.
3. Klik **Deploy**. Vercel akan otomatis mengenali Next.js dan konfigurasi serverless functions di `vercel.json`.

---

## 🔌 Dokumentasi REST API

### 1. Ekstraksi Dokumen (Multipart Upload)
```bash
curl -X POST "https://your-domain.vercel.app/api/extract" \
  -H "x-api-key: YOUR_GEMINI_API_KEY" \
  -F "file=@/path/to/undangan.pdf"
```

### 2. Ekstraksi Pesan Chat Teks (JSON)
```bash
curl -X POST "https://your-domain.vercel.app/api/extract" \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_GEMINI_API_KEY" \
  -d '{
    "sourceType": "text",
    "text": "Undangan Rapat Evaluasi Sistem pada hari Kamis 10 Sept 2026 jam 09.00 WIB di Kemnaker..."
  }'
```

### 3. Telegram Webhook Endpoint
```
POST https://your-domain.vercel.app/api/telegram/webhook?bot_token=YOUR_BOT_TOKEN&gemini_key=YOUR_GEMINI_KEY
```
