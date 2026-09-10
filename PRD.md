# Product Requirements Document (PRD)
## EasyCal // Serverless OCR & Gemini Calendar Studio

---

## 1. Executive Summary & Product Vision

### 1.1 Overview
**EasyCal** adalah platform otomasi produktivitas cerdas berbasis **Serverless Multimodal AI (Google Gemini)** yang dirancang untuk mengeliminasi friksi pencatatan agenda kedinasan, webinar, bimbingan teknis (bimtek), dan rapat dinas. Sistem ini mentransformasi dokumen surat dinas formal (PDF), poster flyer kegiatan (JPG/PNG/WebP), maupun salinan teks obrolan (*broadcast chat* WhatsApp/Telegram) menjadi entri kalender terstruktur yang otomatis tersinkronisasi ke **Google Calendar** dan terarsip rapi di **Google Drive** secara *realtime* (0-Click Sync).

### 1.2 Problem Statement
Di lingkungan instansi pemerintah (khususnya birokrasi kementerian/lembaga) dan korporasi:
1. **Beban Administrasi Manual**: Pegawai harus membaca naskah surat dinas dinas berlembar-lembar secara manual hanya untuk mencatat nomor surat, tanggal, jam pelaksanaan, narasumber, ruang rapat, tautan Zoom, dan kredensial meeting.
2. **Kesalahan Penginputan Kredensial Rapat**: Meeting ID (9–11 digit) dan Passcode Zoom sering salah ketik saat dipindahkan secara manual, menyebabkan keterlambatan menghadiri rapat dinas penting.
3. **Agenda Duplikat & Penumpukan Jadwal**: Surat undangan yang sama sering kali disebarkan dalam beberapa format berbeda (misalnya salinan PDF dari tata usaha, flyer visual dari grup panitia, dan broadcast WhatsApp dari pimpinan), menyebabkan pencatatan berulang di kalender.
4. **Dokumen Tersebar Tanpa Pengarsipan Terstruktur**: File surat undangan dan dokumentasi kegiatan sering tercecer di berbagai ruang penyimpanan tanpa keterhubungan dengan agenda di kalender.
5. **Keterbatasan Aksesibilitas**: Tidak semua staf membuka laptop setiap saat. Diperlukan jalur cepat via ponsel melalui bot perpesanan (*messaging bot*) yang mampu memproses berkas secara langsung.

### 1.3 Solution & Value Proposition
EasyCal menyediakan solusi terintegrasi:
* **Multimodal AI Reasoning**: Membaca tata letak surat resmi, tabel rundown, kop instansi, dan visual poster menggunakan Google Gemini Flash generasi terbaru dengan pemahaman konteks bahasa administratif Indonesia.
* **0-Click Calendar Injection**: Begitu dokumen diproses, agenda langsung masuk ke Google Calendar pengguna tanpa perlu mengunduh berkas `.ics` atau mengisi formulir manual.
* **Automated Google Drive Archiving**: Berkas asli (PDF, gambar, atau salinan teks `.txt`) otomatis diunggah ke sub-folder Google Drive berformat kronologis (`YYYY-MM-DD - [Judul Kegiatan]`).
* **Cross-Modality Smart Duplicate Detection**: Sistem mendeteksi kemiripan naskah surat vs flyer vs broadcast menggunakan kamus akronim birokrasi dan metrik kesamaan teks canggih untuk mencegah duplikasi entri kalender.
* **Multi-Channel Experience**: Tersedia antarmuka web modern bergaya *Industrial Cockpit* untuk workstation dan Bot Telegram serverless untuk mobilitas via smartphone.
* **Model BYOK (Bring Your Own Key)**: Menjaga privasi dan skalabilitas publik dengan mengizinkan setiap pengguna membawa API Key Google Gemini sendiri secara terisolasi.

---

## 2. User Personas & Target Audience

| Persona | Peran / Latar Belakang | Kebutuhan Utama | Poin Friksi |
|---|---|---|---|
| **Pegawai Negeri / ASN (Pemerintah)** | Staf fungsional/pelaksana di kementerian (misal: Kemnaker, dinas tenaga kerja daerah). | Ekstraksi surat dinas PDF bernomor, mendeteksi bobot Jam Pelajaran (JP), ruang rapat, dan narasumber. | Banyak surat dinas masuk setiap hari dengan lampiran rundown berlembar-lembar. |
| **Sekretariat / Asisten Pimpinan** | Pengelola jadwal pimpinan / direktur. | Penjadwalan cepat ke kalender bersama (*Shared Calendar ID*), mencegah jadwal tabrakan (*overlap*). | Harus memindahkan jadwal dari broadcast WhatsApp pimpinan secara terburu-buru. |
| **Peserta Diklat & Webinar** | Profesional yang sering mengikuti pelatihan daring / sertifikasi. | Menangkap Meeting ID, Passcode, link registrasi, dan materi flyer tanpa manual retype. | Flyer kegiatan memuat banyak teks padat yang sulit disalin dari gambar. |
| **Pengguna Mobile / Lapangan** | Pegawai yang sedang tugas luar kota atau di perjalanan. | Menjadwalkan rapat cukup dengan *forward* PDF/chat ke bot Telegram. | Sulit membuka laptop untuk sinkronisasi kalender saat mobilitas tinggi. |

---

## 3. Scope & Functional Requirements

### 3.1 Otentikasi, Akun & Keamanan (Auth & Identity)
* **FR-AUTH-01 (Google SSO)**: Sistem harus menyediakan otentikasi Single Sign-On menggunakan Google OAuth 2.0 dengan permintaan hak akses (*offline access*) untuk mendapatkan `refresh_token`.
* **FR-AUTH-02 (Scope Google API)**: Izin otorisasi mencakup:
  * Google Calendar (`/auth/calendar`, `/auth/calendar.events`)
  * Google Drive (`/auth/drive`, `/auth/drive.file`)
  * Profil Pengguna (`/auth/userinfo.email`, `/auth/userinfo.profile`, `openid`)
* **FR-AUTH-03 (Session Management)**: Sesi web dikelola menggunakan enkripsi cookie HTTP-only berbasis JSON Web Token (JWT) via pustaka `jose` dengan masa kedaluwarsa terukur.
* **FR-AUTH-04 (BYOK Multi-Tenancy)**: Setiap pengguna dapat menyimpan Google Gemini API Key miliknya sendiri (`gemini_api_key`), terisolasi per akun di database Neon PostgreSQL.

### 3.2 Ekstraksi Dokumen Multimodal (AI Ingestion Engine)
* **FR-EXT-01 (Masukan PDF)**: Menerima unggahan berkas surat dinas PDF hingga batas ukuran wajar serverless, mengubah berkas menjadi base64 inline data untuk dikirim ke Gemini Vision API.
* **FR-EXT-02 (Masukan Gambar)**: Menerima berkas gambar poster/flyer berekstensi `.jpg`, `.jpeg`, `.png`, dan `.webp`.
* **FR-EXT-03 (Masukan Teks Obrolan)**: Menerima teks salinan mentah (*raw text*) dari broadcast obrolan.
* **FR-EXT-04 (Ekstraksi Entitas Terstruktur)**: Mesin AI wajib mengembalikan format data JSON murni dengan entitas:
  * `title`: Judul spesifik agenda kegiatan (bukan sekadar kata "Undangan" atau "Webinar").
  * `start_time`: Waktu mulai standar ISO 8601 dengan zona waktu Indonesia (+07:00).
  * `end_time`: Waktu selesai standar ISO 8601 (+07:00). Jika tertulis "s.d. selesai", otomatis diberi durasi default 2 jam.
  * `is_online`: Boolean (true jika daring/hybrid, false jika luring).
  * `location`: Lokasi fisik (gedung, lantai, alamat) atau keterangan platform daring ("Zoom Meeting").
  * `meeting_link`: Tautan Zoom, Google Meet, Teams, YouTube Live, atau registrasi.
  * `meeting_id_pass`: Nomor Meeting ID (10/11 digit) dan Passcode.
  * `jp`: Nilai Jam Pelajaran sertifikat (contoh: `3 JP`, `32 JP`).
  * `speakers`: Daftar narasumber / pembicara / pejabat pembuka acara.
  * `description`: Rangkuman komprehensif nomor surat, perihal, susunan acara, dan daftar undangan.
* **FR-EXT-05 (Multi-Model Resilience & Fallback)**: Sistem harus memiliki rantai fallback model aktif (misal: `gemini-3.6-flash` -> `gemini-3.5-flash` -> `gemini-3.1-flash-lite`) saat menghadapi status HTTP 404, 429 (*quota exceeded*), atau 503.
* **FR-EXT-06 (Dukungan Engine OCR Alternatif)**: Menyediakan pilihan engine ekstraksi `gemini`, `ocr_service`, atau `hybrid`.

### 3.3 Sinkronisasi Google Calendar & Ekspor
* **FR-CAL-01 (Direct 0-Click Sync)**: Apabila akun Google terhubung, agenda hasil ekstraksi otomatis langsung di-insert ke Google Calendar tanpa aksi lanjutan.
* **FR-CAL-02 (Target Calendar ID)**: Pengguna dapat mengarahkan agenda ke kalender `primary` atau kalender bersama dengan menyetel Calendar ID di panel pengaturan.
* **FR-CAL-03 (Format Deskripsi Lengkap)**: Agenda kalender memuat metadata rapi: nomor surat, link rapat, kredensial meeting, daftar narasumber, dan tautan folder Google Drive.
* **FR-CAL-04 (Universal `.ICS` Export)**: Menyediakan generator berkas `.ics` standar RFC 5545 yang dapat diunduh langsung untuk pengguna Outlook / Apple Calendar.
* **FR-CAL-05 (1-Click Google Calendar Link)**: Tombol generator URL `calendar.google.com/calendar/render` dengan parameter pre-filled sebagai alternatif manual.

### 3.4 Pengarsipan Digital Google Drive
* **FR-DRV-01 (Setelan Root Folder)**: Pengguna dapat mengonfigurasi tautan folder induk di Google Drive melalui web atau Telegram (`/setdrive`).
* **FR-DRV-02 (Pembuatan Folder Otomatis)**: Membuat folder kegiatan khusus di dalam folder induk dengan pola penamaan: `YYYY-MM-DD - [Judul Kegiatan]`.
* **FR-DRV-03 (Unggah Berkas Asli)**: Mengunggah dokumen PDF dan gambar flyer asli ke folder kegiatan terkait.
* **FR-DRV-04 (Konversi Teks ke Berkas `.txt`)**: Masukan teks broadcast otomatis diformat dan diunggah sebagai berkas `salinan_undangan.txt` ke dalam folder Google Drive kegiatan.
* **FR-DRV-05 (Fallback Root Drive)**: Jika folder induk yang ditentukan tidak valid atau tidak memiliki izin tulis, sistem membuat folder di root Google Drive pengguna.

### 3.5 Deteksi Anti-Duplikasi Lintas Format (Cross-Modality Detection)
* **FR-DUP-01 (Kamus Akronim Birokrasi)**: Sistem menormalisasi istilah dinas (seperti `rakor`, `bimtek`, `sosialisasi`, `monev`, `diseminasi`, `gmeet`, `zoom`) ke bentuk baku.
* **FR-DUP-02 (Kombinasi Algoritma Kesamaan)**:
  * *Jaccard Similarity* dan *Containment Score* pada token kata judul.
  * *Dice's Bigram Coefficient* untuk menangani variasi penulisan dan saltik.
  * *Meeting ID Extraction*: Membandingkan kecocokan 9–11 digit Zoom ID / Google Meet code.
  * *Waktu & Tanggal*: Memverifikasi kesamaan tanggal dan toleransi perbedaan waktu pelaksanaan.
* **FR-DUP-03 (Intersepsi Duplikat)**: Mencegah inserksi otomatis jika terdeteksi duplikat, memberikan laporan alasan kesamaan, riwayat tanggal input sebelumnya, dan tautan agenda terdaftar.
* **FR-DUP-04 (Force Sync Override)**: Memberikan kebebasan kepada pengguna untuk memaksakan sinkronisasi (*Force Sync*) jika memang menginginkannya.

### 3.6 Bot Telegram Serverless
* **FR-TG-01 (Multi-Modal Chat Parsing)**: Bot menerima dokumen PDF (`msg.document`), gambar poster (`msg.photo`), dan teks obrolan (`msg.text`).
* **FR-TG-02 (Progress Bar Animasi)**: Memperbarui pesan secara periodik dengan bilah kemajuan dinamis (`■■■□□□□□□□`) dan teks tahapan pemindaian.
* **FR-TG-03 (1-Tap Contact Sharing)**: Mendukung verifikasi cepat melalui tombol balasan *request_contact* Telegram untuk menautkan nomor ponsel dengan akun web.
* **FR-TG-04 (Daftar Perintah Mandiri)**: Mendukung `/start`, `/connect`, `/status`, `/disconnect`, `/setdrive`, `/gdrive`, `/apikey`, dan `/help`.
* **FR-TG-05 (Inline Action Buttons)**: Menyertakan tombol inline untuk membuka agenda di Google Calendar dan folder arsip di Google Drive.

### 3.7 Riwayat Agenda & Manajemen Data
* **FR-HIST-01 (Paginasi Riwayat)**: Menampilkan riwayat agenda per pengguna dengan sistem paginasi (default 4–5 entri per halaman), diurutkan dari yang terbaru (`created_at DESC`).
* **FR-HIST-02 (Hapus Riwayat)**: Pengguna dapat menghapus entri riwayat dari database.
* **FR-HIST-03 (Re-Export & Re-Download)**: Pengguna dapat mengunduh ulang file `.ics` atau membuka tautan kalender/Drive dari daftar riwayat kapan saja.

---

## 4. Non-Functional Requirements (NFR)

### 4.1 Performance & Latency
* **NFR-PERF-01**: Waktu pemrosesan ekstraksi teks tidak melebihi 10 detik.
* **NFR-PERF-02**: Waktu pemrosesan dokumen PDF/Gambar via Gemini Multimodal Vision berada di rentang 8–25 detik.
* **NFR-PERF-03**: Serverless Function Execution Timeout disetel pada `maxDuration = 60` detik untuk mengakomodasi pemrosesan dokumen besar di Vercel.

### 4.2 Security & Data Privacy
* **NFR-SEC-01**: Token akses dan refresh token Google disimpan secara aman di Neon PostgreSQL.
* **NFR-SEC-02**: Kunci API pengguna (BYOK) dienkripsi dalam transit dan tidak pernah dibagikan antar akun.
* **NFR-SEC-03**: Sesi autentikasi web menggunakan cookie `SameSite=Lax`, `HttpOnly`, dan `Secure` pada lingkungan produksi.
* **NFR-SEC-04**: Sanitasi input teks JSON sebelum diproses untuk mencegah serangan injeksi.

### 4.3 Reliability & Availability
* **NFR-REL-01 (Zero-Cold-Start Storage)**: Menggunakan driver `@neondatabase/serverless` berbasis koneksi HTTP/WebSocket teroptimasi untuk arsitektur serverless.
* **NFR-REL-02 (Fallback Local Storage)**: Menyediakan mekanisme fallback otomatis ke file lokal (`.user_tokens.json`, `.user_events.json`) saat dijalankan di lingkungan pengujian tanpa database Neon.
* **NFR-REL-03 (Telegram Markdown Fallback)**: Jika pengiriman pesan Telegram gagal akibat kegagalan parsing markdown, sistem otomatis mengirim ulang dalam format teks biasa (*plain text*).

---

## 5. Success Metrics & Key Performance Indicators (KPI)
1. **Extraction Accuracy**: Tingkat akurasi pembacaan tanggal, jam, dan Zoom ID mencapai > 95% pada dokumen surat dinas standar.
2. **Duplicate Prevention Rate**: Berhasil mengidentifikasi minimal 90% broadcast duplikat lintas kanal (WhatsApp vs PDF).
3. **Time-to-Schedule**: Mengurangi waktu pencatatan agenda dari rata-rata 3–5 menit (manual) menjadi < 15 detik (otomatis).
4. **Zero-Click Adoption**: Lebih dari 80% agenda berhasil disinkronisasi langsung ke Google Calendar tanpa penyesuaian manual.
