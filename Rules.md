# Development Guidelines & Engineering Rules
## EasyCal // Engineering Handbook & Standards

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
* **Durasi Default "s.d. Selesai"**: Jika dokumen menuliskan jam akhir "s.d. selesai", otomatis tetapkan durasi default 2 jam setelah waktu mulai.
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
* **Pemberhentian Timer Animasi**: Setiap instance animasi progress bar Telegram (`startTelegramProgressBar`) wajib dipanggil fungsi `.stop()`-nya segera setelah proses AI selesai atau ketika error tertangkap dalam blok `try...finally`.
* **1-Tap Contact Verification**: Saat menerima `msg.contact`, nomor telepon harus dinormalisasi (contoh: `+62812...` atau `0812...` -> `62812...`) sebelum dicocokkan ke database.

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
* **Penanganan Foto Kompresi Pesan Singkat (Watermark Fallback)**:
  * Aplikasi perpesanan seperti WhatsApp secara agresif menghapus (*strip*) metadata EXIF.
  * Jika EXIF kosong, sistem wajib menggunakan Vision OCR untuk mendeteksi cap stempel watermark tanggal, jam, atau koordinat lokasi (misalnya dari aplikasi *GPS Map Camera* atau *Timestamp Camera*).
* **Konvensi Penamaan Berkas & Folder**:
  * Sub-folder kegiatan di Google Drive wajib berformat: `YYYY-MM-DD - [Judul Kegiatan]`.
  * Berkas foto dokumentasi wajib disimpan dengan prefix waktu pengambilan: `DOK_YYYYMMDD_HHMMSS_[nama_asli].jpg`.

---

## 10. Checklist Verifikasi Sebelum Commit & Deploy

Sebelum mengajukan perubahan kode:
1. Jalankan `npm run lint` untuk memastikan tidak ada kesalahan linter atau sintaks TypeScript.
2. Jalankan `npm run build` untuk memverifikasi bahwa *type checking* lolos dan seluruh Route Handler dapat di-bundle tanpa error.
3. Uji alur ekstraksi utama dengan contoh naskah surat dinas dan pastikan entitas tanggal, lokasi, serta nomor dinas terbaca akurat.
4. Uji alur pengunggahan foto dokumentasi dan pastikan foto tersimpan di sub-folder Google Drive yang tepat tanpa menduplikasi agenda kalender.
5. Verifikasi bahwa tidak ada file kredensial rahasia yang masuk ke dalam *staging area* Git.

