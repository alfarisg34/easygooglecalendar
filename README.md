# 📅 EasyCal // Serverless OCR & Gemini Calendar Studio

Layanan publik **Serverless OCR & Multimodal AI** untuk mengekstrak dokumen surat dinas (PDF), poster kegiatan (JPG/PNG), dan pesan broadcast chat ke **Google Calendar** secara instan dengan otentikasi **Google OAuth 2.0**, manajemen pengaturan kredensial (BYOK), dan integrasi basis data **Neon PostgreSQL** di **Vercel**.

---

## 🌟 Alur Aplikasi & Fitur Utama

1. **🔑 Halaman Utama Berbasis Google Login**:
   - Pengunjung disambut dengan landing page modern bertema *Industrial Cockpit*.
   - Masuk menggunakan akun Google (Google Sign-In) untuk mengamankan sesi dan mengaktifkan otorisasi Google Calendar secara langsung.
2. **⚙️ Panel Pengaturan Kredensial & Kustomisasi**:
   - Simpan Google Gemini API Key (BYOK) yang terisolasi per akun pengguna.
   - Pilih model AI: `gemini-3.6-flash`, `gemini-2.5-flash`, atau `gemini-1.5-pro`.
   - Konfigurasi Target Google Calendar ID (`primary` atau kalender bersama tim).
   - Simpan Telegram Bot Token dan User Chat ID untuk integrasi bot Telegram pribadi.
3. **🐘 Penyimpanan Terkelola Neon PostgreSQL (Vercel)**:
   - Data profil pengguna, token OAuth refresh, dan preferensi pengaturan tersimpan secara persisten dan aman di Neon PostgreSQL serverless.
   - Mendukung auto-migration skema database saat aplikasi berjalan.
4. **📄 Ekstraksi Agenda Presisi Tinggi**:
   - **Surat Dinas (PDF)**: Mengenali Nomor Surat, Sifat, Hal, Tanggal/Waktu (WIB/WITA/WIT), Ruang Rapat, dan Bobot JP.
   - **Poster Flyer (Gambar)**: Mengekstrak tautan Zoom, Meeting ID, Passcode, dan daftar Narasumber.
   - **Pesan Chat / WhatsApp**: Menganalisis broadcast undangan dalam hitungan detik.
5. **📅 0-Click Realtime Calendar Sync**:
   - Agenda yang diekstrak otomatis tersimpan langsung ke Google Calendar pengguna secara instan tanpa perlu import manual.
   - Tersedia tombol buka langsung di Google Calendar, unduh file `.ICS`, dan salin teks agenda.
6. **🤖 Bot Telegram Serverless**:
   - Hubungkan bot Telegram Anda sendiri untuk menjadwalkan agenda cukup dengan mengirim file atau pesan chat dari aplikasi Telegram.

---

## 🚀 Panduan Konfigurasi & Menjalankan Lokal

### 1. Salin Environment Variables
Salin berkas `.env.example` menjadi `.env.local`:
```bash
cp .env.example .env.local
```

Isi variabel environment penting:
- `DATABASE_URL`: Connection string Neon PostgreSQL (atau Vercel Postgres).
- `SESSION_SECRET`: Kunci acak untuk enkripsi JWT sesi login.
- `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET`: Kredensial OAuth dari Google Cloud Console.
- `GOOGLE_REDIRECT_URI`: `http://localhost:3000/api/auth/callback` (atau domain Vercel Anda).

### 2. Jalankan Aplikasi
```bash
npm install
npm run dev
```

Buka [http://localhost:3000](http://localhost:3000) di browser Anda.

---

## ☁️ Cara Deploy ke Vercel

1. Hubungkan repository GitHub ke **Vercel**.
2. Pada Vercel Dashboard, buka menu **Storage** -> Buat **Postgres (Neon)** -> Sambungkan (*Connect*) ke project Anda.
3. Tambahkan environment variables `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, dan `SESSION_SECRET` di project settings Vercel.
4. Deploy! Neon PostgreSQL akan otomatis diinisialisasi tabelnya saat pertama kali digunakan.

## Membatalkan dan memulihkan kegiatan

- Web: pada kartu riwayat, pilih **Batalkan kegiatan**, isi alasan opsional, lalu konfirmasi. Filter **Dibatalkan** menyediakan **Aktifkan kembali**.
- Telegram: ketik `/agenda`, pilih nomor dengan `batal 1` (atau `batal 1 alasan`), lalu tekan **Ya, batalkan**. Ketik `/dibatalkan` dan `aktifkan 1` untuk memulihkan.
- Nomor Telegram merujuk ke daftar terakhir per pengguna/chat dan berlaku 15 menit. Gunakan `/agenda 2` atau `/dibatalkan 2` untuk halaman berikutnya.
- Pembatalan mempertahankan riwayat, undangan, dan dokumentasi. Event Google yang sama diberi judul `[DIBATALKAN]`, pengingat dinonaktifkan, dan waktunya ditandai tersedia. Pemulihan mengembalikan konfigurasi sebelumnya.
- Kegagalan sinkronisasi ditampilkan secara eksplisit; gunakan **Coba sinkronisasi lagi** di web atau `sinkron 1` pada daftar Telegram terbaru.
- Skema tambahan dimigrasikan otomatis melalui `initDatabase`. Sesi daftar Telegram disimpan di Neon; mode lokal menggunakan file yang diabaikan Git.
- Webhook lama otomatis ditambahkan `callback_query` ketika `/agenda` atau `/dibatalkan` digunakan pada endpoint EasyCal yang sama. Jika Telegram menolak pembaruan, sinkronkan webhook melalui Pengaturan Web.
- Fitur ini mengelola agenda EasyCal tanpa peserta undangan Google. Event yang sudah dihapus di Google Calendar perlu dipulihkan di Google Calendar sebelum sinkronisasi ulang.

Verifikasi tanpa mengubah kegiatan nyata: `node --experimental-strip-types scratch/test-event-lifecycle.ts`.