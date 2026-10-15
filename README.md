# 📅 EasyCal // Serverless OCR & Gemini Calendar Studio

Versi rilis: **1.3.1**. Lihat [catatan rilis](CHANGELOG.md) untuk perubahan dan batas verifikasi.

Fitur P0/P1 bot dan lampiran Calendar tersedia dalam rilis Git **1.3.0**. Lihat [panduan bot, migrasi webhook, konfigurasi worker, dan perintah baru](Telegram.md). Setelah penerapan, webhook lama wajib disinkronkan ulang melalui Pengaturan oleh pemilik bot/admin. Siapkan database persisten, `SESSION_SECRET`, `TELEGRAM_ADMIN_EMAILS` untuk bot global, serta `CRON_SECRET` untuk pemulihan antrean.

Validasi lokal: `npm run lint`, `npm test` (12 suite offline), `npm run typecheck`, `npm run build`, dan `git diff --check`. Lint memakai ESLint CLI dan `eslint.config.mjs` dengan preset Next.js Core Web Vitals, menggantikan `next lint`. Hasil migrasi: 0 error dan 6 warning font/gambar/navigasi; pemeriksaan tipe tetap terpisah. `npm run telegram:worker` tersedia untuk host persisten yang membutuhkan pemicu antrean lebih sering dari cron harian bawaan. Pengujian offline tidak memverifikasi layanan produksi.


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
   - Simpan Telegram Bot Token untuk bot pribadi; tautkan identitas Telegram melalui /connect atau kontak milik pengirim.
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
- Setelah penerapan keamanan P0, sinkronkan ulang webhook melalui Pengaturan Web. Hanya setup terautentikasi yang memasang secret header dan callback; membuka daftar agenda tidak mengubah webhook.
- Fitur ini mengelola agenda EasyCal tanpa peserta undangan Google. Event yang sudah dihapus di Google Calendar perlu dipulihkan di Google Calendar sebelum sinkronisasi ulang.

Verifikasi tanpa mengubah kegiatan nyata: `node --experimental-strip-types scratch/test-event-lifecycle.ts`.

## Lampiran berkas sumber di Google Calendar

Agenda baru yang dibuat otomatis melalui web atau Telegram melampirkan berkas sumber yang berhasil diunggah ke Drive: surat PDF, gambar undangan, atau salinan teks sebagai salinan_undangan.txt. Buka detail event Google Calendar untuk mengakses lampirannya. Izin akses berkas tetap mengikuti Google Drive; aplikasi tidak mengubahnya menjadi publik.

Jika arsip atau pemasangan lampiran gagal, event tetap tersimpan dan web/bot menampilkan kegagalan lampiran secara terpisah. Lampiran yang sudah ada dipertahankan; maksimal 25 lampiran per event sesuai [Google Calendar API](https://developers.google.com/workspace/calendar/api/v3/reference/events). Fitur ini berlaku pada pembuatan agenda baru, tanpa pengisian massal event lama. Update waktu/tempat mempertahankan lampiran lama; surat revisi yang dikonfirmasi di bot ikut diarsipkan dan dilampirkan, sedangkan foto dokumentasi tidak otomatis menjadi lampiran baru. Ekspor ICS dan tautan pembuatan event manual tidak berubah.

Verifikasi tanpa akun Google nyata: `node --experimental-strip-types scratch/test-calendar-attachments.ts`.

## Waktu foto dokumentasi & pemilihan kegiatan


Foto dicocokkan memakai waktu pengambilan dari EXIF atau watermark kamera, bukan waktu saat dikirim ke bot. Misalnya, stempel 12 Oktober pukul 10.18 harus dicocokkan ke kegiatan pada waktu tersebut walaupun foto diunggah tanggal 13 Oktober.

Jika tanggal/jam tidak terbaca, tidak ada kegiatan dalam toleransi satu jam sebelum sampai dua jam sesudah kegiatan, atau beberapa kegiatan cocok, bot belum mengunggah foto. Pilih kegiatan melalui tombol Telegram, atau gunakan menu **Foto Dokumentasi** di web. Kesamaan tanggal saja menjadi saran, bukan dasar pengarsipan otomatis. Untuk pemilihan manual tanpa waktu pengambilan, waktu tersebut disimpan kosong; prefix nama berkas dapat memakai waktu unggah.

Balasan berhasil menampilkan waktu foto dan sumber waktunya. Album dikumpulkan sekitar empat detik dan memperoleh satu pilihan tujuan serta ringkasan hasil. Anggota yang terlambat dapat menjadi pekerjaan terpisah. Caption `#poster` tetap memilih ekstraksi agenda meskipun dikirim dalam album.

Verifikasi tanpa layanan nyata: `node --experimental-strip-types scratch/test-photo-timestamp.ts`.

## Memperbarui waktu atau tempat melalui Telegram

- Kirim surat PDF atau teks perubahan yang menyebut judul kegiatan. AI membaca nilai baru pada narasi **semula ... menjadi ...**, ralat, atau perubahan jadwal/tempat. Bot memilih calon kegiatan bila judul dan tanggal semula (jika tersedia) cocok secara unik, lalu meminta konfirmasi semula ? menjadi sebelum menerapkan perubahan.
- Jika kegiatan belum dapat ditentukan, ketik `/agenda`, lalu `/update 1 jam menjadi 13.00` atau `/update 1 tempat menjadi Ruang B`. Nomor merujuk ke daftar terakhir dan berlaku 15 menit. Untuk surat gambar, gunakan caption `#poster` agar masuk alur ekstraksi agenda.
- Perubahan jam saja mempertahankan tanggal dan durasi lama; perubahan tempat saja mempertahankan waktu. Jika jam akhir baru disebutkan, jam tersebut digunakan. Perubahan menggunakan event Google Calendar dan folder dokumentasi yang sama.
- Jika Google Calendar gagal diperbarui, jadwal baru disimpan di EasyCal. Ketik `/agenda` lagi, lalu `sinkron 1` sesuai nomor kegiatan untuk mencoba ulang. Pemilihan yang kedaluwarsa atau ambigu tidak membuat agenda baru.
- Hasil update atau pesan kegagalannya mengganti pesan progress. Jika Telegram menolak edit, hasil dikirim sebagai pesan baru. Setelah pratinjau dikonfirmasi, balasan sukses menunjukkan pembaruan sudah selesai; indikator menunggu AI tidak memakai persentase atau mengklaim sinkronisasi sebelum hasil tersedia.

Verifikasi penutupan progress tanpa chat nyata: `node --experimental-strip-types scratch/test-telegram-progress.ts`.

## Mengatasi `invalid_grant` pada Google Drive

Token Google yang kedaluwarsa atau dicabut perlu otorisasi ulang. Ketik `/connect`, tekan **Hubungkan Ulang Google**, pilih akun yang sama, lalu kirim ulang foto. Pembacaan token mengutamakan database agar login ulang tidak tertimpa cache lama.

Jika masalah berulang setiap tujuh hari, periksa status publikasi OAuth di Google Cloud: aplikasi eksternal dengan status **Testing** menerbitkan refresh token yang berlaku tujuh hari untuk izin Calendar/Drive. Atur status produksi sesuai konfigurasi aplikasi, lalu otorisasi ulang. Lihat [dokumentasi Google OAuth](https://developers.google.com/identity/protocols/oauth2#expiration).

Verifikasi tanpa memanggil layanan nyata: `node --experimental-strip-types scratch/test-google-auth-recovery.ts`.

## Dokumentasi & aturan perubahan

Footer halaman utama menampilkan nomor versi aplikasi. Klik **Versi** untuk membuka halaman publik `/changelog`, melihat perubahan yang belum dirilis serta catatan tiap versi, lalu kembali ke EasyCal. Versi footer mengikuti package.json dan isi halaman mengikuti CHANGELOG.md saat aplikasi dibangun.

Pada mobile, empat pilihan sumber agenda tampil dalam grid 2×2. Header, banner Telegram, dan riwayat mengikuti lebar layar; filter ditumpuk dan nomor halaman dapat berpindah baris. Geser bilah navigasi utama untuk membuka pengaturan, integrasi Telegram, atau panduan API.

- [PRD.md](PRD.md): kebutuhan dan perilaku produk.
- [Architecture.md](Architecture.md): komponen dan alur integrasi.
- [Schema.md](Schema.md): penyimpanan dan kontrak data.
- [Design.md](Design.md): desain antarmuka dan interaksi.
- [Rules.md](Rules.md): standar teknis pengembangan.
- [AGENTS.md](AGENTS.md): aturan kerja, pembaruan dokumentasi, dan format catatan rilis.
- [CHANGELOG.md](CHANGELOG.md): perubahan yang belum dirilis dan riwayat rilis.

Setiap perubahan wajib memperbarui changelog dan seluruh dokumen yang terdampak sebelum pekerjaan dinyatakan selesai atau dilakukan commit, push, maupun deploy.

Permintaan **push Git** mencakup rilis aplikasi: perbarui dokumentasi yang terdampak, tinjau/perbarui `.gitignore`, selaraskan versi dan catatan rilis, jalankan pemeriksaan, lalu commit dan push branch/tag sesuai [AGENTS.md](AGENTS.md). Menambahkan aturan ini tidak memulai push.

Tes regresi, runner, loader, dan worker dalam `scratch/` tetap disertakan karena dipakai pengujian/CI dan operasional. Percobaan baru ditempatkan di `scratch/local/`; empat skrip percobaan lama `test-36.js`, `test-gemini.js`, `test-models.js`, serta `verify.js` tidak lagi dilacak, dengan salinan lokal tetap tersedia. `.gitignore` juga melindungi environment/kredensial lokal, cache, build, laporan pemeriksaan dan file sementara; `.env.example` tetap disertakan. Hindari mengabaikan seluruh scratch atau menghapus tes yang masih diperlukan.

## Ketahanan timeout Gemini (v1.3.1)

Ekstraksi agenda memakai batas 25 detik per model dan total 40 detik untuk rangkaian Gemini, termasuk pembacaan respons. Model berikutnya memakai sisa waktu; batas ini tidak mencakup unduhan, OCR alternatif, database, atau operasi Google lainnya dan tidak menjamin seluruh request selesai dalam 60 detik. Hasil AI Telegram yang sudah berhasil (termasuk revisi) disimpan terenkripsi tujuh hari sebelum dispatch dan dipakai kembali oleh retry pekerjaan yang sama. Balasan menunjuk pesan asal agar hasil yang terlambat tidak tertukar dengan perintah baru. Kegagalan sementara pada percobaan 1–2 menjelaskan bahwa pekerjaan menunggu worker; pengaturan scheduler tetap diperlukan. Lihat [Telegram.md](Telegram.md) untuk diagnostik dan batas verifikasi.
