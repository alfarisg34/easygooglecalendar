# 📅 EasyCal // Serverless OCR & Gemini Calendar Studio

Versi rilis: **1.1.1**. Lihat [catatan rilis](CHANGELOG.md) untuk perubahan dan batas verifikasi.


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

## Waktu foto dokumentasi & pemilihan kegiatan

Foto dicocokkan memakai waktu pengambilan dari EXIF atau watermark kamera, bukan waktu saat dikirim ke bot. Misalnya, stempel 12 Oktober pukul 10.18 harus dicocokkan ke kegiatan pada waktu tersebut walaupun foto diunggah tanggal 13 Oktober.

Jika tanggal/jam tidak terbaca, tidak ada kegiatan dalam toleransi satu jam sebelum sampai dua jam sesudah kegiatan, atau beberapa kegiatan cocok, bot belum mengunggah foto. Buka menu **Foto Dokumentasi** di web, unggah foto, lalu pilih kegiatan yang benar secara manual. Kesamaan tanggal saja menjadi saran, bukan dasar pengarsipan otomatis. Untuk pemilihan manual tanpa waktu pengambilan, waktu tersebut disimpan kosong; prefix nama berkas dapat memakai waktu unggah.

Balasan berhasil menampilkan waktu foto dan sumber waktunya. Album diproses per foto sehingga tiga foto dapat menghasilkan tiga balasan. Caption `#poster` tetap memilih ekstraksi agenda meskipun dikirim dalam album.

Verifikasi tanpa layanan nyata: `node --experimental-strip-types scratch/test-photo-timestamp.ts`.

## Memperbarui waktu atau tempat melalui Telegram

- Kirim surat PDF atau teks perubahan yang menyebut judul kegiatan. AI membaca nilai baru pada narasi **semula ... menjadi ...**, ralat, atau perubahan jadwal/tempat. Pembaruan otomatis hanya dilakukan jika satu kegiatan aktif cocok dengan judul dan tanggal semula (jika tersedia).
- Jika kegiatan belum dapat ditentukan, ketik `/agenda`, lalu `/update 1 jam menjadi 13.00` atau `/update 1 tempat menjadi Ruang B`. Nomor merujuk ke daftar terakhir dan berlaku 15 menit. Untuk surat gambar, gunakan caption `#poster` agar masuk alur ekstraksi agenda.
- Perubahan jam saja mempertahankan tanggal dan durasi lama; perubahan tempat saja mempertahankan waktu. Jika jam akhir baru disebutkan, jam tersebut digunakan. Perubahan menggunakan event Google Calendar dan folder dokumentasi yang sama.
- Jika Google Calendar gagal diperbarui, jadwal baru disimpan di EasyCal. Ketik `/agenda` lagi, lalu `sinkron 1` sesuai nomor kegiatan untuk mencoba ulang. Pemilihan yang kedaluwarsa atau ambigu tidak membuat agenda baru.
- Hasil update atau pesan kegagalannya mengganti pesan progress. Jika Telegram menolak edit, hasil dikirim sebagai pesan baru. Balasan sukses menunjukkan pembaruan sudah selesai; persentase animasi merupakan indikator menunggu, bukan ukuran sinkronisasi Google.

Verifikasi penutupan progress tanpa chat nyata: `node --experimental-strip-types scratch/test-telegram-progress.ts`.

## Mengatasi `invalid_grant` pada Google Drive

Token Google yang kedaluwarsa atau dicabut perlu otorisasi ulang. Ketik `/connect`, tekan **Hubungkan Ulang Google**, pilih akun yang sama, lalu kirim ulang foto. Pembacaan token mengutamakan database agar login ulang tidak tertimpa cache lama.

Jika masalah berulang setiap tujuh hari, periksa status publikasi OAuth di Google Cloud: aplikasi eksternal dengan status **Testing** menerbitkan refresh token yang berlaku tujuh hari untuk izin Calendar/Drive. Atur status produksi sesuai konfigurasi aplikasi, lalu otorisasi ulang. Lihat [dokumentasi Google OAuth](https://developers.google.com/identity/protocols/oauth2#expiration).

Verifikasi tanpa memanggil layanan nyata: `node --experimental-strip-types scratch/test-google-auth-recovery.ts`.

## Dokumentasi & aturan perubahan

- [PRD.md](PRD.md): kebutuhan dan perilaku produk.
- [Architecture.md](Architecture.md): komponen dan alur integrasi.
- [Schema.md](Schema.md): penyimpanan dan kontrak data.
- [Design.md](Design.md): desain antarmuka dan interaksi.
- [Rules.md](Rules.md): standar teknis pengembangan.
- [AGENTS.md](AGENTS.md): aturan kerja, pembaruan dokumentasi, dan format catatan rilis.
- [CHANGELOG.md](CHANGELOG.md): perubahan yang belum dirilis dan riwayat rilis.

Setiap perubahan wajib memperbarui changelog dan seluruh dokumen yang terdampak sebelum pekerjaan dinyatakan selesai atau dilakukan commit, push, maupun deploy.
