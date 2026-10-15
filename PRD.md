# Product Requirements Document (PRD)
## EasyCal // Serverless OCR & Gemini Calendar Studio

### Perluasan P0/P1 — Unreleased

| Kebutuhan | Perilaku yang tersedia |
|---|---|
| Keamanan bot/akun | Setup hanya pemilik/admin, pemeriksaan Origin, secret webhook, kontak milik pengirim, binding dan OAuth state sekali pakai; identitas akun pada endpoint web berasal dari sesi. |
| Ketahanan | Antrean persisten terenkripsi, deduplikasi update, lease worker/chat, percobaan ulang terbatas, ID Calendar/Drive/riwayat stabil, status dan kuota pengguna. Pemulihan tanpa pesan baru memerlukan penjadwal worker. |
| Validasi ekstraksi | Waktu mulai tidak diketahui tetap kosong. Asumsi waktu akhir memerlukan pemeriksaan. Bot menyediakan pelengkapan dan konfirmasi; web menahan penyimpanan dan meminta koreksi sumber. |
| Foto/album | Pilih kegiatan di Telegram, cari/paginasi kandidat, satu tujuan/ringkasan album; waktu pengambilan yang tidak diketahui tetap kosong. |
| Perubahan | Pratinjau semula → menjadi, konfirmasi, pemeriksaan versi, audit perubahan dan undo terakhir; sumber revisi diarsipkan/dilampirkan pada kegiatan yang sama. |
| Arsip | Tombol pemulihan unggah/lampiran dan `/arsip <nomor>`; tidak membuat event baru atau mengunggah ulang file yang sudah diketahui. |
| Masukan/pencarian/status | Gambar sebagai document dan TXT; `/cari`, `/lampau`, rentang tanggal, `/hariini`, `/besok`, `/minggu`, `/status`, `/status cek`. |

Batas dan kriteria operasional terdapat di [Telegram.md](Telegram.md). Notifikasi Telegram terjadwal, ekstraksi banyak event, deteksi bentrok, dan percakapan lewat balasan pesan tetap di luar P0/P1 ini. Perubahan belum dianggap teruji pada produksi hanya karena tes offline lulus.

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
* **FR-CAL-01 (Direct 0-Click Sync)**: Apabila akun Google terhubung dan waktu valid tanpa asumsi yang perlu diperiksa, agenda hasil ekstraksi otomatis di-insert. Waktu tidak terbaca/default memerlukan pemeriksaan dan konfirmasi.
* **FR-CAL-02 (Target Calendar ID)**: Pengguna dapat mengarahkan agenda ke kalender `primary` atau kalender bersama dengan menyetel Calendar ID di panel pengaturan.
* **FR-CAL-03 (Format Deskripsi Lengkap)**: Agenda kalender memuat metadata rapi: nomor surat, link rapat, kredensial meeting, daftar narasumber, dan tautan folder Google Drive.
* **FR-CAL-04 (Universal `.ICS` Export)**: Menyediakan generator berkas `.ics` standar RFC 5545 yang dapat diunduh langsung untuk pengguna Outlook / Apple Calendar.
* **FR-CAL-05 (1-Click Google Calendar Link)**: Tombol generator URL `calendar.google.com/calendar/render` dengan parameter pre-filled sebagai alternatif manual.

* **FR-CAL-06 (Lampiran Berkas Sumber)**: Setelah event baru dibuat dan sumber diunggah ke Drive, web dan Telegram memasang lampiran PDF, gambar undangan, atau salinan TXT pada event Google yang sama. Status lampiran dilaporkan terpisah dari keberhasilan penyimpanan event.
* **FR-CAL-07 (Ketahanan Lampiran)**: Kegagalan Drive atau pemasangan lampiran tidak menggagalkan event dan tidak membuat event ulang. Lampiran lama dipertahankan, berkas sama dicegah duplikasinya, batas 25 lampiran diperiksa, dan konflik perubahan kalender dilaporkan.
* **FR-CAL-08 (Izin & Batas Cakupan)**: Hak akses berkas mengikuti izin Drive tanpa berbagi publik otomatis. Event lama tidak diisi massal; foto dokumentasi, ICS, dan tautan pembuatan manual tidak memperoleh lampiran baru secara otomatis; surat revisi terkonfirmasi di bot diarsipkan dan dilampirkan pada event yang sama. Perubahan waktu/tempat tidak menghapus lampiran yang sudah ada.

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
* **FR-TG-01 (Multi-Modal Chat Parsing)**: Bot menerima PDF/TXT/gambar sebagai `msg.document`, poster/foto sebagai `msg.photo`, dan teks obrolan `msg.text`.
* **FR-TG-02 (Progress Bar Animasi)**: Memperbarui pesan secara periodik dengan bilah kemajuan dinamis (`■■■□□□□□□□`) dan teks tahapan pemindaian.
* **FR-TG-03 (1-Tap Contact Sharing)**: Mendukung verifikasi cepat melalui tombol balasan *request_contact* Telegram untuk menautkan nomor ponsel dengan akun web.
* **FR-TG-04 (Daftar Perintah Mandiri)**: Mendukung `/start`, `/connect`, `/status`, `/disconnect`, `/setdrive`, `/gdrive`, `/apikey`, dan `/help`.
* **FR-TG-05 (Inline Action Buttons)**: Menyertakan tombol inline untuk membuka agenda di Google Calendar dan folder arsip di Google Drive.

### 3.7 Riwayat Agenda & Manajemen Data
* **FR-HIST-01 (Paginasi Riwayat)**: Menampilkan riwayat agenda per pengguna dengan sistem paginasi (default 4–5 entri per halaman), diurutkan dari yang terbaru (`created_at DESC`).
* **FR-HIST-02 (Hapus Riwayat)**: Pengguna dapat menghapus entri riwayat dari database.
* **FR-HIST-03 (Re-Export & Re-Download)**: Pengguna dapat mengunduh ulang file `.ics` atau membuka tautan kalender/Drive dari daftar riwayat kapan saja.

### 3.8 Pengarsipan Foto Dokumentasi Kegiatan (Smart Photo Ingestion)
* **FR-DOC-01 (Foto Dokumentasi Kegiatan Fisik)**: Menerima berkas foto kegiatan fisik (.jpg, .jpeg, .png, .webp) melalui tab khusus "Foto Dokumentasi" di Web Cockpit dan Bot Telegram (caption `#foto` / `#dokumentasi`).
* **FR-DOC-02 (Ekstraksi EXIF `DateTimeOriginal`)**: Membaca metadata waktu pengambilan foto dan informasi perangkat kamera HP langsung dari header EXIF berkas.
* **FR-DOC-03 (Pencocokan Agenda Otomatis)**: Mencocokkan waktu foto terhadap rentang waktu agenda (`start_time - 1 jam` s.d. `end_time + 2 jam`) pada akun pengguna untuk menentukan folder Google Drive yang tepat.
* **FR-DOC-04 (Fallback Watermark Timestamp OCR)**: Memindai stempel waktu visual dari aplikasi *GPS Map Camera* / *Timestamp Camera* menggunakan AI Vision jika metadata EXIF terhapus akibat kompresi perpesanan.
* **FR-DOC-05 (Pengarsipan Langsung ke Google Drive)**: Mengunggah foto ke sub-folder Google Drive agenda terkait tanpa membuat agenda baru di Google Calendar, mencatat relasi di tabel `event_documentations`.
* **FR-DOC-06 (Pencegahan Tertukar dengan Poster)**: Menggunakan verifikasi metadata kamera dan/atau klasifikasi visual AI untuk memastikan foto dokumentasi tidak diproses sebagai poster undangan acara.

---

* **FR-DOC-07 (Bukti Waktu Foto)**: Pencocokan otomatis hanya menggunakan tanggal dan jam yang valid dari EXIF atau watermark. Waktu unggah tidak boleh dipakai untuk menebak kegiatan. OCR watermark memakai model pilihan pengguna dan fallback; tanggal/jam yang tidak terbaca tidak diisi nilai default.
* **FR-DOC-08 (Pemilihan Manual)**: Tanpa waktu foto, tanpa kandidat dalam toleransi start - 1 jam sampai end + 2 jam, atau dengan beberapa kandidat, pengguna memilih kegiatan lewat tombol dan pencarian di Telegram atau menu Foto Dokumentasi di web. Bot tidak mengunggah ke folder kegiatan atau membuat folder terpisah sebelum kegiatan diketahui. Kesamaan tanggal saja tidak cukup untuk auto-filing.
* **FR-DOC-09 (Transparansi Waktu)**: Telegram menampilkan waktu foto dan sumber EXIF/watermark pada hasil unggahan. Web menampilkan waktu tidak terbaca untuk pilihan manual tanpa bukti waktu; metadata taken_at tetap kosong. Album memakai satu pilihan tujuan dan ringkasan akhir; caption poster diprioritaskan.

### 3.9 Pembaruan Kegiatan & Pemulihan Otorisasi Google

* **FR-UPD-01 (Surat/Pesan Perubahan Telegram)**: Bot membaca waktu/tempat baru dari surat perubahan, ralat, atau narasi semula menjadi. Perubahan diproses sebelum penolakan duplikat dan tidak membuat event kalender baru.
* **FR-UPD-02 (Pemilihan Kegiatan)**: Calon pembaruan dipilih jika satu kegiatan aktif cocok dengan judul ternormalisasi (Jaccard minimal 0,8; minimal dua kata kunci) dan tanggal semula jika tersedia, dalam 50 riwayat terbaru. Jika tidak ditemukan atau ambigu, pengguna memilih lewat `/agenda` lalu `/update <nomor> <perubahan>`; nomor berlaku 15 menit dan versi kegiatan diperiksa kembali.
* **FR-UPD-03 (Perubahan Parsial)**: Perubahan jam saja mempertahankan tanggal dan durasi sebelumnya jika jam akhir baru tidak disebutkan. Perubahan tempat saja mempertahankan waktu. Nilai lama pada bagian semula tidak dipakai sebagai jadwal baru; tanggal/jam yang tidak valid ditolak.
* **FR-UPD-04 (Identitas & Retry)**: Pembaruan mempertahankan identitas event Calendar dan folder dokumentasi. Jadwal yang diinginkan disimpan di EasyCal sebelum sinkronisasi. Kegagalan Google dilaporkan dan dapat dicoba ulang lewat daftar `/agenda` terbaru lalu `sinkron <nomor>`.
* **FR-UPD-05 (Batas Implementasi)**: Pembaruan dari surat/pesan tersedia melalui Telegram. Kegiatan yang dibatalkan harus diaktifkan kembali; sinkronisasi sebelumnya yang gagal harus diselesaikan terlebih dahulu. Event dengan peserta undangan atau yang dihapus di Google Calendar memerlukan penanganan di Google Calendar. Surat revisi diarsipkan setelah konfirmasi pengguna; nama folder lama tidak diubah.
* **FR-UPD-06 (Penutupan Progress Telegram)**: Hasil pembaruan berhasil maupun gagal mengganti pesan progress awal. Animasi berhenti sebelum hasil ditampilkan. Jika edit pesan ditolak, hasil dikirim sebagai pesan baru; indikator tunggu tidak boleh memberi persentase atau mengklaim sinkronisasi kalender berdasarkan timer.
* **FR-AUTH-05 (Pemulihan invalid_grant)**: Kesalahan otorisasi Google menampilkan petunjuk login ulang dengan akun yang sama. `/connect` tetap menyediakan tombol Hubungkan Ulang Google untuk akun yang tercatat terhubung. Token dibaca dari database sebelum cache; pengguna mengirim ulang foto setelah otorisasi berhasil.

---

### 3.10 Informasi Versi & Catatan Rilis

* **FR-REL-01 (Footer Versi)**: Halaman utama sebelum/sesudah login menampilkan footer dengan identitas EasyCal dan nomor versi dari package.json. Tautan versi menuju /changelog dan tetap terbaca pada mobile.
* **FR-REL-02 (Halaman Publik)**: /changelog dapat diakses tanpa login dan menampilkan versi, tanggal, kategori, daftar perubahan, serta verifikasi dari CHANGELOG.md. Unreleased ditandai belum dirilis tanpa tanggal rilis; versi paket saat ini diberi penanda tersendiri.
* **FR-REL-03 (Navigasi & Sumber Data)**: Catatan versi dapat dibuka/tutup melalui keyboard dan tersedia tautan kembali ke halaman utama. Versi dan catatan tidak disalin ke daftar UI terpisah; pembaruan isi diterapkan melalui build/deployment aplikasi.

---

## 4. Non-Functional Requirements (NFR)


### 4.1 Performance & Latency
* **NFR-PERF-01**: Target respons ekstraksi teks normal di bawah 10 detik, bukan jaminan latensi layanan AI. Rangkaian generateContent memiliki batas total 40 detik dan maksimum 25 detik per model; fallback memakai sisa waktu. Unduhan/OCR/database/Calendar berada di luar anggaran AI ini.
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

### Penanganan timeout (v1.3.1)

Hasil ekstraksi Telegram yang berhasil, termasuk perubahan, disimpan sebelum dispatch dan digunakan ulang saat retry operasi yang sama. Kegagalan sementara membedakan menunggu worker dari kegagalan final; hasil handler membalas pesan asal agar keterlambatan tidak disalahartikan sebagai respons perintah terbaru. Indikator menunggu AI tidak menyatakan progres Calendar. Batas tiga percobaan dan kebutuhan scheduler tetap berlaku.
