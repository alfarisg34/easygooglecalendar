# Development Guidelines & Engineering Rules
## EasyCal // Engineering Handbook & Standards

### Ketentuan P0/P1 bot

- Webhook wajib memvalidasi secret header sebelum menyimpan pekerjaan. Setup memerlukan pemilik token/admin dan Origin yang sesuai; jangan memasukkan bot token/Gemini key pada URL webhook atau log. Mutasi pengaturan tidak boleh lewat GET.
- Binding Telegram harus berasal dari kontak pengirim sendiri atau token OAuth sekali pakai dengan state/cookie browser yang valid. Jangan menerima perubahan Chat ID lewat pengaturan web atau identitas pemilik unggahan dari input request.
- Antrean/OAuth produksi wajib persisten dan state bot terenkripsi; jangan fallback ke file lokal saat database gagal. Klaim pekerjaan/aksi harus atomik, ber-lease, dan memiliki batas percobaan. Operasi eksternal harus memakai identitas stabil/deduplikasi yang sesuai; jangan mengklaim transaksi exactly-once lintas layanan.
- Waktu mulai yang hilang tidak boleh diisi besok. Nilai waktu yang diasumsikan perlu konfirmasi. Perubahan waktu/tempat wajib menampilkan semula/menjadi dan memeriksa kepemilikan/versi saat konfirmasi; arsip revisi serta status lampirannya dipisahkan dari keberhasilan perubahan kalender.
- Album dokumentasi harus memiliki satu pilihan tujuan/ringkasan, dengan batas penampungan dan penjelasan anggota terlambat. Foto tanpa waktu tidak boleh memakai waktu unggah sebagai bukti pengambilan.
- Jalankan `npm run lint`, `npm test`, `npm run typecheck`, build, dan diff check. Suite harus terisolasi dari kredensial/layanan produksi; perubahan kontrak harus memperbarui tes perilaku yang relevan. ESLint CLI memakai preset Next.js Core Web Vitals; pemeriksaan tipe tetap dilakukan terpisah.

Konfigurasi dan batas implementasi mengikuti [Telegram.md](Telegram.md).

---

## 1. General Development Philosophy

Proyek **EasyCal** mematuhi standar rekayasa perangkat lunak modern untuk aplikasi *serverless* berkinerja tinggi. Setiap kontributor atau agen pengembang yang memodifikasi basis kode ini **wajib** mengikuti aturan-aturan berikut:

1. **Prinsip Kesederhanaan & Keandalan (KISS & Robustness)**: Hindari ketergantungan paket (*dependencies*) yang tidak perlu. Lebih baik menggunakan pustaka standar yang teruji daripada menambahkan pustaka baru yang membebani *cold start* fungsi serverless.
2. **Preservasi Dokumentasi & Komentar**: Pertahankan integritas dokumentasi dan *JSDoc comments* yang sudah ada di setiap berkas.
3. **Resilience by Design**: Setiap panggilan ke layanan eksternal (Google Gemini, Google APIs, Neon DB, Telegram) harus memiliki penanganan galat (*error handling*) dan strategi *fallback* yang jelas, tidak boleh membiarkan aplikasi mengalami *unhandled rejection*.

---

## 2. TypeScript & Coding Standards

* **Strict Typing**: Seluruh berkas baru atau yang diubah wajib menggunakan TypeScript (`.ts` atau `.tsx`) dengan tipe data eksplisit.
* **Hindari `any` Tanpa Justifikasi**: Gunakan antarmuka (*interface*) dari `lib/types.ts` atau `lib/db.ts`. Jika tipe objek dinamis dari pihak ketiga terpaksa digunakan, lakukan validasi bentuk (*shape checking*) atau batasi cakupannya.
* **Konvensi Penamaan**:
  * Berkas modul utilitas / service: `kebab-case.ts` (contoh: `duplicate-detector.ts`, `google-drive-api.ts`).
  * Komponen React: `PascalCase.tsx`.
  * Variabel & Fungsi: `camelCase` (contoh: `extractEventFromSource`, `normalizeCalendarEvent`).
  * Antarmuka & Tipe: `PascalCase` (contoh: `CalendarEvent`, `ExtractedEventRecord`).
  * Konstanta Global / Enum: `UPPER_SNAKE_CASE` (contoh: `GEMINI_API_URL`, `ACRONYM_MAP`).

---

## 3. Frontend & Styling Rules (Bespoke Vanilla CSS)

* **STRICT NO TAILWIND**: Jangan menambahkan atau menggunakan utilitas Tailwind CSS. Seluruh penataan gaya antarmuka **wajib** menggunakan Vanilla CSS terstruktur di `app/globals.css`.
* **Gunakan Token Desain Terpusat**: Selalu gunakan variabel CSS yang sudah didefinisikan (`var(--signal-amber)`, `var(--bg-surface)`, `var(--border-chassis)`, dll.). Dilarang menggunakan nilai warna *hardcoded* acak.
* **Pertahankan Estetika "Industrial Cockpit"**:
  * Desain wajib mempertahankan nuansa taktil, telemetris, dan berdensitas data tinggi.
  * Tombol harus memiliki sensasi mekanis (`:hover` naik 1px, `:active` turun 1px dengan bayangan dalam).
  * Pertahankan hierarki tipografi: `Instrument Serif` untuk judul utama/brand, `Plus Jakarta Sans` untuk teks umum, dan `JetBrains Mono` untuk angka, kode, dan telemetri status.
* **Aksesibilitas & Feedback Pengguna**: Setiap aksi pemrosesan harus memberikan umpan balik visual langsung (misal: *loading spinner*, *progress bar*, teks status dinamis).

---

## 4. Next.js App Router & Serverless Execution Rules

* **Serverless Execution Timeout**: Karena proses multimodal AI pada berkas PDF besar dapat memakan waktu hingga 20–30 detik, setiap Route Handler yang memproses AI wajib menyertakan konfigurasi durasi maksimum:
  ```typescript
  export const maxDuration = 60; // 60 detik batas timeout serverless
  ```
* **Pemisahan Client vs Server Component**:
  * Komponen antarmuka yang memerlukan hooks reaktif (`useState`, `useEffect`, `useRef`) wajib diawali direktif `'use client';` di baris pertama.
  * Hindari pemanggilan library server (seperti `neon`, `googleapis`, `fs`) secara langsung dari Client Component; selalu lewati Route Handler `/api/*`.
* **Path Aliasing**: Gunakan alias `@/` untuk mengimpor modul dari akar proyek (contoh: `import { CalendarEvent } from '@/lib/types';`).

---

## 5. Google APIs & OAuth 2.0 Integration Rules

* **Offline Access Wajib**: Pembangkitan URL otorisasi Google OAuth harus selalu menyertakan:
  ```typescript
  access_type: 'offline',
  prompt: 'consent'
  ```
  Hal ini krusial untuk menjamin diterbitkannya `refresh_token` yang dapat disimpan di basis data.
* **Penyegaran Token Otomatis**: Jangan pernah berasumsi bahwa `access_token` selalu aktif. Gunakan *event listener* `oauth2Client.on('tokens', ...)` untuk memperbarui token di database secara otomatis saat terjadi rotasi token.
* **Toleransi Kegagalan Google Drive**:
  * Saat membuat folder kegiatan di Google Drive, jika folder induk (`parentFolderId`) yang ditentukan pengguna tidak dapat diakses atau tidak memiliki izin, sistem **wajib** melakukan *retry* dengan membuat folder di root Google Drive pengguna.
  * Jangan biarkan kegagalan izin Drive menggagalkan inserksi jadwal ke Google Calendar.

---

Lampiran Calendar wajib memakai metadata berkas yang berhasil diunggah oleh backend ke Drive. PATCH lampiran harus menyertakan supportsAttachments: true, mempertahankan daftar lampiran lama, mencegah duplikasi dan melampaui 25 berkas, serta memakai ETag untuk menghindari penimpaan perubahan bersamaan. Kegagalan arsip/lampiran tidak boleh memicu pembuatan ulang event yang sudah tersimpan. Jangan mengubah izin berbagi Drive menjadi publik secara otomatis.

## 6. Google Gemini Multimodal Prompting Rules

* **Strict JSON Response**: Parameter konfigurasi pemanggilan Gemini AI harus selalu mengaktifkan:
  ```json
  "generationConfig": {
    "responseMimeType": "application/json",
    "temperature": 0.1
  }
  ```
* **Sanitasi Output AI**: Gunakan fungsi `parseGeminiJson` untuk membersihkan *code fence* (` ```json `) atau teks penjelasan pengantar sebelum melakukan `JSON.parse()`.
* **Standarisasi Zona Waktu**: Seluruh waktu pelaksanaan wajib dinormalisasi ke format ISO 8601 dengan offset Indonesia (+07:00 / `Asia/Jakarta`).
* **Durasi Default "s.d. Selesai"**: Jika jam akhir tidak terbaca atau dokumen menuliskan "s.d. selesai", tetapkan durasi 2 jam sebagai asumsi yang wajib dikonfirmasi sebelum penyimpanan. Tanggal/jam mulai yang tidak valid tetap kosong, tidak diganti besok.
* **Model Fallback Chain**: Jika model primer gagal dengan status HTTP 404, 429, atau 503, pemanggilan wajib otomatis dialihkan ke model berikutnya dalam daftar cadangan (`gemini-3.6-flash` -> `gemini-3.5-flash` -> `gemini-3.1-flash-lite`).

---

## 7. Security & Environment Variables

* **Jangan Commit Kredensial**: Berkas `.env.local`, file token lokal (`.user_tokens.json`, `.user_events.json`), dan private keys tidak boleh di-commit ke Git (`.gitignore` harus dijaga).
* **Isolasi BYOK (Bring Your Own Key)**:
  * Kunci API Gemini milik pengguna disimpan terpisah di baris data pengguna pada tabel `users`.
  * Jangan mengekspos API Key pengguna lain dalam respon API publik.
* **Cookie Sesi Aman**: Cookie sesi web wajib disetel dengan bendera `HttpOnly`, `SameSite=Lax`, dan `Secure` di lingkungan produksi.

---

## 8. Telegram Bot Engineering Rules

* **Markdown Parsing Fallback**: Jika pemanggilan `sendMessage` atau `editMessageText` dengan `parse_mode: 'Markdown'` menghasilkan error dari Telegram (biasanya karena karakter khusus `_`, `*`, `[` di dalam teks judul rapat), sistem **wajib** secara otomatis mencoba kirim ulang (*retry*) tanpa `parse_mode` (sebagai teks biasa).
* **Pemberhentian Timer Animasi**: Setiap instance animasi progress bar Telegram (`startTelegramProgressBar`) wajib ditutup dengan `await progressTracker.stop()` segera setelah proses AI selesai atau ketika error tertangkap. Tunggu edit progress yang sedang berlangsung sebelum menulis hasil akhir agar animasi tidak menimpanya. Alur berhasil, gagal, dan pemilihan yang tidak valid harus menyelesaikan pesan progress; jika edit ditolak Telegram, kirim hasil sebagai pesan baru.
* **1-Tap Contact Verification**: Saat menerima `msg.contact`, hanya chat pribadi dan kontak dengan `contact.user_id === msg.from.id` yang boleh diproses. Nomor telepon harus dinormalisasi (contoh: `+62812...` atau `0812...` -> `62812...`) sebelum dicocokkan ke database.

---

## 9. Smart Photo Documentation & Anti-Flyer Ingestion Rules

* **Dilarang Membuat Agenda Kalender Baru dari Foto Dokumentasi**: Foto kegiatan adalah bukti kehadiran/pelaksanaan kegiatan fisik, **BUKAN** surat undangan. Endpoint `/api/documentation` dan handler foto Telegram dilarang keras menginjeksi entri kegiatan baru ke Google Calendar; tugasnya murni mengarsipkan foto ke folder Google Drive kegiatan yang relevan.
* **Guardrail Pemisah Poster Flyer vs Foto Fisik**:
  * Sistem wajib mendeteksi metadata hardware kamera asli (`Make`/`Model` di EXIF).
  * Jika metadata kamera tidak ada (misal gambar hasil ekspor aplikasi desain Canva/Photoshop), sistem wajib mengevaluasi kemungkinan poster via klasifikasi citra.
  * Bila dicurigai poster flyer acara, sistem wajib memblokir auto-filing dokumentasi dan mengarahkan pengguna ke tab Ekstraksi Agenda agar jadwalnya dapat dicatat ke kalender.
* **Pencocokan Temporal & Toleransi Waktu**:
  * Pencocokan waktu foto terhadap kegiatan di kalender menggunakan rentang toleransi: `start_time - 1 jam` s.d. `end_time + 2 jam`.
  * Jika terdapat lebih dari 1 agenda dalam rentang waktu yang sama (*ambiguous match*), sistem **wajib** melibatkan pengguna (*human-in-the-loop*) untuk memilih kegiatan yang tepat sebelum mengunggah.
* **Bukti Waktu Pengambilan Wajib untuk Auto-Filing**:
  * Jangan mengganti EXIF/watermark yang hilang dengan waktu saat unggah untuk memilih kegiatan. Tanggal dan jam harus valid; jam OCR yang tidak terbaca tidak boleh diisi jam default.
  * Jika waktu tidak diketahui, tidak ada kandidat dalam toleransi, atau kandidat ambigu, arahkan ke pemilihan kegiatan manual. Kesamaan tanggal saja tidak cukup untuk auto-filing dan bot tidak membuat folder terpisah untuk kegiatan yang belum diketahui.
  * Pilihan manual web boleh mengunggah tanpa waktu foto, tetapi taken_at harus kosong dan UI harus menyatakan waktu pengambilan tidak terbaca. created_at merekam waktu pencatatan; prefix nama berkas boleh memakai waktu unggah jika waktu pengambilan tidak diketahui.
* **Penanganan Foto Kompresi Pesan Singkat (Watermark Fallback)**:
  * Aplikasi perpesanan seperti WhatsApp secara agresif menghapus (*strip*) metadata EXIF.
  * Jika EXIF kosong, sistem wajib menggunakan Vision OCR untuk mendeteksi cap stempel watermark tanggal, jam, atau koordinat lokasi (misalnya dari aplikasi *GPS Map Camera* atau *Timestamp Camera*).
* **Konvensi Penamaan Berkas & Folder**:
  * Sub-folder kegiatan di Google Drive wajib berformat: `YYYY-MM-DD - [Judul Kegiatan]`.
  * Berkas foto dokumentasi wajib disimpan dengan prefix waktu pengambilan: `DOK_YYYYMMDD_HHMMSS_[nama_asli].jpg`.

---

## 10. Checklist Verifikasi Sebelum Commit & Deploy

Pembaruan dokumentasi dan changelog pada bagian 11 wajib diselesaikan sebelum commit atau deploy.

Sebelum mengajukan perubahan kode:
1. Jalankan `npm run lint` melalui ESLint CLI dengan konfigurasi `eslint.config.mjs`, serta `npm run typecheck` untuk pemeriksaan tipe. Jangan memakai `next lint` yang sudah dihapus pada Next.js 16.
2. Jalankan `npm run build` untuk memverifikasi bahwa *type checking* lolos dan seluruh Route Handler dapat di-bundle tanpa error.
3. Uji alur ekstraksi utama dengan contoh naskah surat dinas dan pastikan entitas tanggal, lokasi, serta nomor dinas terbaca akurat.
4. Uji alur pengunggahan foto dokumentasi dan pastikan foto tersimpan di sub-folder Google Drive yang tepat tanpa menduplikasi agenda kalender.
5. Verifikasi bahwa tidak ada file kredensial rahasia yang masuk ke dalam *staging area* Git.

---

## 11. Dokumentasi & Changelog Wajib pada Setiap Perubahan

1. Setiap perubahan fitur, perbaikan, tampilan, konfigurasi, dependensi, pengujian, maupun dokumentasi wajib disertai pembaruan `CHANGELOG.md` pada pekerjaan yang sama.
2. Tinjau dan perbarui semua dokumen yang terdampak, termasuk `README.md`, `PRD.md`, `Architecture.md`, `Schema.md`, `Design.md`, `Rules.md`, dan `AGENTS.md`. Pertahankan dokumen yang tidak terdampak tanpa perubahan tanggal kosmetik.
3. Ikuti format changelog dan aturan rilis di [AGENTS.md](AGENTS.md): bagian `Unreleased`, kategori perubahan yang relevan, serta `Validation` berisi hasil pemeriksaan yang benar-benar dilakukan dan batas verifikasinya.
4. Dokumentasi harus menggambarkan implementasi yang tersedia. Bedakan perilaku web dan Telegram, pengujian tiruan dan layanan nyata, serta perubahan lokal dan rilis yang sudah di-deploy.
5. Jalankan pemeriksaan yang sesuai serta `git diff --check`. Jika pemeriksaan gagal atau belum dilakukan, catat secara eksplisit; jangan menyatakannya lulus.
6. Selesaikan pembaruan ini sebelum pekerjaan dinyatakan selesai dan sebelum commit, push, atau deploy. Saat tindakan tersebut diizinkan pengguna, sertakan dokumentasi dan changelog bersama perubahan kode.

### Permintaan push berarti rilis

Ketika pengguna meminta push Git, ikuti [alur wajib di AGENTS.md](AGENTS.md): tinjau perubahan, perbarui dokumentasi yang terdampak dan `.gitignore`, tentukan/selaraskan versi, siapkan catatan rilis dari `Unreleased`, jalankan pemeriksaan, lalu commit serta push branch/tag rilis. Periksa staging agar tidak menyertakan kredensial, cache, laporan, atau percobaan lokal. Permintaan tersebut mencakup langkah rilis terkait; tidak perlu meminta ulang izin rutin. Aturan ini tidak memulai push tanpa permintaan pengguna dan tidak menjadikan keberhasilan push sebagai bukti deployment produksi.

### Berkas yang disertakan dalam Git

Pertahankan tes regresi `scratch/test-*.ts`, loader, runner, worker dan tes unit lain yang diperlukan; jangan mengabaikan seluruh folder scratch. Tempatkan percobaan baru di `scratch/local/` dan hasil pemeriksaan di lokasi laporan/cache yang diabaikan. Empat percobaan lama `test-36.js`, `test-gemini.js`, `test-models.js`, dan `verify.js` tetap boleh ada secara lokal tetapi tidak dilacak. Kredensial/state lokal, environment selain `.env.example`, cache, build, laporan QA dan file sementara mengikuti `.gitignore`. Jika file sudah dilacak, hentikan pelacakannya tanpa menghapus salinan lokal ketika memang tidak diperlukan dalam repositori.


### Ketahanan permintaan AI dan korelasi pesan

Ekstraksi agenda Gemini wajib memakai anggaran total 40 detik (fetch dan pembacaan body), maksimum 25 detik per model, dan fallback sesuai sisa waktu. Jangan menaikkan timeout setiap model tanpa memperhitungkan total durasi serverless serta operasi lain. Hasil AI Telegram yang berhasil harus disimpan terenkripsi sebelum dispatch, termasuk perubahan; retry memakai hasil tersebut untuk operasi/pemilik/sumber yang sama. Indikator menunggu tidak boleh mengklaim progres Calendar berdasarkan timer. Balasan handler mengacu ke pesan asal, dan kegagalan sementara menjelaskan status retry/scheduler. Diagnostik model hanya memuat metadata model/durasi/status/outcome dan hash operasi, tanpa sumber undangan, keluaran AI atau kredensial. Capture browser lokal .playwright-mcp wajib diabaikan Git.
