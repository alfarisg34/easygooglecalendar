# Design & UI/UX System Document
## EasyCal // Industrial Cockpit & Editorial Precision

### Interaksi bot P0/P1 — Unreleased

Bot menampilkan tombol maksimal dua per baris agar pilihan foto/paginasi nyaman dibaca pada ponsel. Pilihan menampilkan judul dan waktu kegiatan sebelum pengguna memilih nomor. Album menerima satu tujuan dan ringkasan akhir, bukan satu balasan sukses per foto. Foto tanpa bukti waktu tetap ditandai tidak terbaca.

Perubahan kegiatan menampilkan blok **Semula** dan **Menjadi** beserta waktu/tempat, diikuti **Ya, perbarui** atau **Batalkan**. Setelah diterapkan, **Batalkan perubahan terakhir** tersedia selama 15 menit selama versinya belum berubah. Hasil sinkronisasi dan arsip/lampiran tetap dibedakan, dengan tombol pemulihan ketika pengarsipan gagal. Tanggal yang tidak terbaca menampilkan instruksi `/lengkapi` lalu pratinjau sebelum Simpan.

Web menampilkan kesalahan yang dapat ditindaklanjuti untuk `requiresConfirmation`, tanpa kartu hasil atau tautan kalender dengan tanggal tebakan. Pengaturan bot memakai token tersimpan milik pengguna; URL hasil setup tidak menampilkan kredensial. Pengguna tidak diminta mengisi Chat ID secara manual. Daftar perintah dan batas sesi mengikuti [Telegram.md](Telegram.md).

---

## 1. Design Philosophy & Aesthetic Identity

**EasyCal** mengusung filosofi desain visual bertajuk **"Industrial Cockpit & Editorial Precision"**. Desain ini sengaja dirancang untuk menghindari klise tampilan aplikasi SaaS AI generik (seperti gradien ungu berkilau, kartu membulat tanpa karakter, atau efek *glassmorphism* buram yang berlebihan).

Sebaliknya, EasyCal menghadirkan antarmuka instrumen kerja yang:
1. **Taktil & Mekanis (Tactile & Purposeful)**: Tombol dan kartu memiliki sensasi kedalaman fisik instrumen laboratorium atau konsol kendali pesawat (*analog precision*). Tombol memiliki efek tekanan fisik nyata (`translateY(1px)` dan *inner shadow* saat ditekan).
2. **Kepadatan Informasi Terstruktur (High Data-Density)**: Informasi penting (nomor surat, ruang rapat, kredensial Zoom, JP) disajikan secara jelas tanpa banyak ruang kosong yang sia-sia, sangat cocok untuk efisiensi alur kerja birokrasi dan perkantoran.
3. **Telemetri & Status Hidup (Living Telemetry)**: Dilengkapi lampu indikator LED berkedip (*pulsing status LEDs*), bilah kemajuan teknis (*telemetry progress bars*), dan tipografi monospasi untuk angka dan metadata teknis.
4. **Sentuhan Tipografi Editorial**: Judul utama menggunakan huruf bertipe serif anggun (*Instrument Serif*) dipadukan dengan tipografi tubuh yang sangat terbaca (*Plus Jakarta Sans*) dan angka berkarakter teknik (*JetBrains Mono*).

---

## 2. Design Tokens & Color Palette

Seluruh palet warna dikelola melalui variabel CSS (*CSS Custom Properties*) di berkas `app/globals.css`:

### 2.1 Canvas & Chassis Colors (Latar Belakang & Rangka)
| Token CSS | Kode Heksadesimal / Nilai | Peran & Penggunaan |
|---|---|---|
| `--bg-void` | `#090B0D` | Latar belakang kanvas dasar terdalam (*deep dark void*). |
| `--bg-surface` | `#111418` | Latar belakang kartu sasis (*chassis cards*) dan panel utama. |
| `--bg-surface-elevated` | `#181C22` | Panel mengambang, bilah header kartu, dan tombol kendali sekunder. |
| `--bg-inset` | `#0C0E11` | Area masukan teks (*input wells*) dan wadah kode berkedalaman. |
| `--bg-glass` | `rgba(17, 20, 24, 0.85)` | Lapisan semi-transparan dengan *backdrop-blur* untuk navigasi menempel. |

### 2.2 Telemetry Inks (Warna Teks & Tipografi)
| Token CSS | Kode Heksadesimal | Peran & Kontras |
|---|---|---|
| `--text-main` | `#F0F4F8` | Teks utama dengan tingkat keterbacaan tinggi (kontras > 14:1 terhadap void). |
| `--text-dim` | `#8B98A9` | Label sekunder, instruksi pendukung, dan teks deskripsi. |
| `--text-faint` | `#485464` | Garis panduan, placeholder, dan teks metadata terselubung. |

### 2.3 Indicator Spot Accents (Aksen Indikator Status)
| Token CSS | Kode Heksadesimal | Peran & Makna Visual |
|---|---|---|
| `--signal-amber` | `#FF9E0B` | **Aksen Identitas Utama**: Tombol aksi primer, fokus aktif, sorotan teks pilihan (*selection*). |
| `--signal-amber-glow` | `rgba(255, 158, 11, 0.15)` | Pendaran halus di sekitar elemen interaktif aktif. |
| `--signal-green` | `#00FF66` | **Status Sukses / Terhubung**: LED koneksi Google Calendar aktif, notifikasi sinkronisasi berhasil. |
| `--signal-green-glow` | `rgba(0, 255, 102, 0.15)` | Pendaran lampu LED status online. |
| `--signal-blue` | `#00D4FF` | **Status AI / Telemetri**: Indikator pemrosesan Gemini AI, tautan eksternal, mode hybrid. |
| `--signal-red` | `#FF334B` | **Status Kritis / Peringatan**: Kesalahan otentikasi, peringatan duplikasi agenda, tombol hapus riwayat. |

### 2.4 Structural Borders (Batas & Garis Panel)
| Token CSS | Nilai Border | Penggunaan |
|---|---|---|
| `--border-chassis` | `1px solid #202732` | Garis pemisah panel kabin dan kartu sasis dasar. |
| `--border-bright` | `1px solid #313B4A` | Garis batas tombol interaktif dan kartu yang sedang aktif. |
| `--border-subtle` | `1px solid rgba(255, 255, 255, 0.07)` | Pembatas mikro antar kolom data. |

---

## 3. Typography Hierarchy

EasyCal memadukan tiga keluarga tipografi (*font stacks*) secara harmonis:

```mermaid
graph LR
    subgraph Fonts["Tipografi EasyCal"]
        F1["Instrument Serif\n(Display & Brand)"]
        F2["Plus Jakarta Sans\n(Body & UI Controls)"]
        F3["JetBrains Mono\n(Data Telemetry & Code)"]
    end

    F1 -->|"Gaya: Anggun, Berbobot Resmi"| Brand["Header Brand, Hero Title, Judul Rapat"]
    F2 -->|"Gaya: Bersih, Jelas, Sangat Terbaca"| Body["Paragraf, Form Inputs, Tombol Teks, Catatan"]
    F3 -->|"Gaya: Presisi Teknis, Monospace"| Meta["Nomor Surat, Jam, Zoom ID, Token, Badge, Status"]
```

### Panduan Skala Tipografi:
* **Display / Brand Title**: Font size `1.75rem` – `2.25rem`, *weight* 400, *letter-spacing* `-0.01em` (`Instrument Serif`).
* **Section Heading / Cockpit Header**: Font size `0.75rem` – `0.85rem`, *weight* 600, *text-transform* `uppercase`, *letter-spacing* `0.08em` (`JetBrains Mono`).
* **Body Text**: Font size `0.9375rem`, *line-height* 1.6 (`Plus Jakarta Sans`).
* **Telemetry Data & Tags**: Font size `0.75rem` – `0.8125rem`, *weight* 500 (`JetBrains Mono`).

---

## 4. Component Architecture & UI Elements

### 4.1 Masthead & Live Indicator LEDs
Header navigasi teratas menyatukan identitas brand dengan status operasional langsung:
* **Pulsing LED Indicator**: Lingkaran berukuran `8x8px` dengan animasi pendaran `pulseLed` 2.2 detik:
  * Hijau: Database Neon terhubung dan sesi Google Calendar aktif.
  * Kuning: Memproses data / Memerlukan konfigurasi API Key.
  * Merah: Koneksi terputus atau sesi habis.
* **User Profile Chip**: Blok kompak di sudut kanan atas yang merangkum foto profil akun Google, nama, dan alamat email aktif.

### 4.2 Tactile Buttons (`.btn-tactile`)
Tombol dirancang dengan respon mekanis taktil:
* **Default State**: Background `--bg-surface-elevated`, border `--border-bright`, font monospasi berbobot `600`.
* **Hover State**: Mengangkat 1px ke atas (`translateY(-1px)`) dengan sedikit perubahan saturasi border.
* **Active (Click) State**: Menekan ke bawah 1px (`translateY(1px)`) dengan bayangan dalam (`inset 0 2px 4px rgba(0, 0, 0, 0.4)`), mensimulasikan tombol instrumen fisik yang tertekan.
* **Varian**:
  * `.btn-primary`: Warna latar `--signal-amber` dengan teks hitam tegas untuk aksi konversi utama.
  * `.btn-success`: Warna latar `--signal-green` untuk aksi buka Google Calendar atau simpan pengaturan.
  * `.btn-danger`: Warna latar merah transparan halus untuk aksi hapus riwayat agenda.

### 4.3 Split-Viewport Cockpit Layout
Ruang kerja pengguna terbagi menjadi dua kolom asimetris seimbang:
* **Kolom Kiri (Input Station - 1fr)**:
  * Tab pemilih sumber masukan: PDF, Gambar Poster, atau Teks Obrolan.
  * Zona Drag & Drop interaktif dengan garis putus-putus (*dashed border*) yang menyala kuning saat berkas diseret di atasnya.
  * Tombol Preset Contoh Undangan (Surat Resmi Kemnaker & Flyer Webinar) untuk pengujian instan.
* **Kolom Kanan (Telemetry Results - 1.15fr)**:
  * Panel hasil ekstraksi terstruktur.
  * Blok kredensial rapat (Zoom ID & Passcode) dengan tombol salin instan (*1-tap copy*).
  * Kartu indikator duplikat jika agenda serupa pernah terdaftar.
  * Tombol aksi cepat: *Buka di Google Calendar*, *Unduh File .ICS*, dan *Buka Folder Google Drive*.

### 4.4 Telemetry Progress Bar
Saat proses AI berlangsung (antara 8–20 detik), sistem menyajikan bilah telemetri animasi:
* Jalur track gelap berkedalaman (`--bg-inset`) dengan pengisi bilah berwarna aksen menyala (*amber-to-blue glow*).
* Teks tahapan yang berganti secara dinamis:
  1. `Mengunduh & memvalidasi berkas dokumen...`
  2. `Mendeteksi tata letak naskah & nomor dinas...`
  3. `Menganalisis isi surat dengan Google Gemini AI...`
  4. `Mengekstrak tanggal, jam rapat (WIB), dan durasi...`
  5. `Mendeteksi Meeting ID Zoom, Passcode, & Bobot JP...`
  6. `Menyiapkan sinkronisasi 0-Click Google Calendar...`

### 4.5 Duplicate Alert Card
Komponen penahan kesalahan (*error prevention banner*) jika dokumen yang diproses terindikasi sudah pernah diinput sebelumnya:
* Border bertema peringatan merah/oranye dengan ikon peringatan (`AlertTriangle`).
* Menyajikan ringkasan agenda sebelumnya yang cocok: judul terdaftar, jam, serta tanggal riwayat pemrosesan.
* Menyediakan tombol alternatif **"Tetap Simpan ke Kalender (Force Sync)"** jika pengguna mengonfirmasi bahwa acara tersebut memang sengaja dijadwalkan ulang.

### 4.6 Photo Documentation Cockpit UI (`.photo-preview-card` & Candidate Picker)
Ruang kerja khusus untuk pengunggahan dan auto-filing foto dokumentasi fisik kegiatan:
* **Tab Switcher `[📸 Foto Dokumentasi]`**: Menampilkan badge kamera kuning yang mengalihkan zona input ke mode pemindaian foto kegiatan.
* **Photo Preview Card (`.photo-preview-card`)**:
  * Thumbnail citra terunggah dengan rasio aspek terjaga dan border sasis berkedalaman.
  * Tag telemetri metadata (`.photo-meta-tag`): Indikator waktu pengambilan (`DateTimeOriginal`), merk & tipe kamera (`Make`/`Model`), status deteksi GPS, atau label *Watermark OCR*.
* **Candidate Event Picker (`.candidate-event-item`)**:
  * Ditampilkan secara otomatis jika terdapat lebih dari satu kegiatan dalam jendela waktu yang berdekatan.
  * Menampilkan judul kegiatan, jam mulai, selisih waktu dari foto (misal: *+15 menit dari awal acara*), dan badge tingkat kecocokan (*Tinggi / Sedang*).
* **Flyer Guardrail Warning (`.photo-match-alert`)**:
  * Peringatan bersinyal merah jika citra terdeteksi sebagai poster promosi atau selebaran, dilengkapi tombol pintasan untuk memindahkan berkas ke tab **Poster (Gambar)** guna diekstrak kalendernya.
* **Event Card Quick Action (`+ Foto Dok`)**:
  * Tombol pintas taktil kuning pada setiap kartu agenda di kolom riwayat kanan, memungkinkan pengguna langsung mengunggah foto ke folder Google Drive kegiatan tersebut dalam 1 klik.

---

### 4.7 Waktu Foto Tidak Terbaca & Hasil Pengarsipan

- Tanpa EXIF/watermark tanggal dan jam yang valid, web menampilkan pemilihan kegiatan manual. Setelah unggahan berhasil, label waktu foto menyebut **Tidak terbaca (kegiatan dipilih manual)**, bukan waktu unggah.
- Telegram menampilkan pemberitahuan foto belum diunggah serta tombol **Pilih Kegiatan di Web** jika waktu tidak terbaca, kegiatan tidak cocok dalam rentang toleransi, atau kandidat ambigu.
- Balasan foto yang berhasil menampilkan kegiatan, waktu acara, waktu foto, sumber EXIF/watermark, alasan pencocokan, dan tautan folder. Setiap foto dalam album diproses sendiri sehingga jumlah balasan mengikuti jumlah foto.

## 5. Responsive Design & Breakpoints

Pada layar hingga 640px, pemilih sumber agenda (Surat Dinas, Poster, Teks, Foto Dokumentasi) menggunakan grid dua kolom × dua baris. Ikon berada di atas label, tinggi tombol minimal 64px, dan teks dapat membungkus sehingga semua pilihan terlihat tanpa terpotong atau perlu digeser horizontal. Pada layar lebih lebar, keempat tombol tetap berjajar dalam satu baris.

Lebar dashboard mengikuti viewport. Kolom grid memakai batas minimum nol agar teks panjang tidak mendorong lebar halaman. Pada mobile, tautan bot memakai label **Bot Telegram** / **Buka Bot Telegram**, email profil membungkus, header panel dapat berpindah baris, filter riwayat ditumpuk selebar panel, dan nomor pagination membungkus agar tombol Next tetap terjangkau. Lokasi kegiatan dapat membungkus; overflow tidak disembunyikan pada seluruh halaman. Navigasi utama tetap memiliki area scroll horizontal tersendiri.

| Breakpoint | Penyesuaian Tata Letak |
|---|---|
| **Desktop (> 1024px)** | Layout grid 2 kolom penuh (`split-viewport: 1fr 1.15fr`), padding kontainer luas. |
| **Tablet (768px – 1024px)** | Grid berganti menjadi kolom tunggal bertumpuk (*stacked vertical*). Kolom input di atas, hasil ekstraksi di bawah. |
| **Mobile (< 768px)** | Header masthead membungkus item (*flex-wrap*), bilah tab cockpit dapat digulir horizontal (*overflow-x: auto*), padding disesuaikan ke `1rem`. |

---

## 6. Micro-Interactions & Animation Constants

* **Kurva Transisi Snappy**: `--ease-snappy: cubic-bezier(0.16, 1, 0.3, 1)` memberikan akselerasi awal cepat dan perlambatan halus (*ultra-crisp feel*).
* **Durasi Cepat**: `--duration-fast: 150ms` untuk respon hover dan klik instan tanpa lag visual.
* **Tekstur Noise Halus**: Latar belakang seluruh halaman dilapisi SVG fractal noise ber-opacity `0.025` yang memberikan tekstur kertas taktil mikro pada monitor modern beresolusi tinggi.


## 7. Interaksi Telegram untuk Perubahan & Reconnect

- Panduan bot menjelaskan pengiriman surat perubahan atau pemilihan kegiatan lewat `/agenda` dan `/update 1 jam menjadi 13.00` / `/update 1 tempat menjadi Ruang B`. Nomor mengikuti daftar terakhir dan berlaku 15 menit.
- Pembaruan berhasil menampilkan judul, waktu mulai dalam WIB, tempat, dan hasil sinkronisasi. Jika kegiatan ambigu atau versi daftar sudah berubah, bot meminta pengguna memuat daftar dan memilih kembali.
- Hasil update mengganti pesan progress awal, termasuk ketika pemilihan atau pembaruan gagal. Indikator tunggu ditutup sebelum hasil ditampilkan; timer tidak memberi persentase atau menyatakan sinkronisasi Calendar. Jika Telegram menolak edit, hasil tampil sebagai pesan baru.
- Jika jadwal tersimpan di EasyCal tetapi Google Calendar belum diperbarui, pesan membedakan kedua status tersebut dan memberikan langkah `/agenda` lalu `sinkron <nomor>`.
- Pada `/connect`, akun yang masih terhubung tetap memperoleh tombol **Hubungkan Ulang Google** serta **Buka Pengaturan Web**. Kegagalan invalid_grant mengarahkan pengguna login ulang dengan akun yang sama lalu mengirim ulang berkas.
- Pembaruan surat/pesan ini adalah interaksi Telegram; tidak ada formulir pembaruan jadwal baru pada web. Folder dokumentasi dan identitas event kalender dipertahankan.


## 8. Footer & Halaman Changelog

Footer tampil di bagian bawah halaman utama sebelum/sesudah login serta halaman changelog. Identitas EasyCal berada di kiri dan tautan **Versi X.Y.Z** di kanan; keduanya dapat berpindah baris pada layar sempit. Nomor versi berasal dari package.json dan dapat diklik menuju /changelog.

Halaman changelog mengikuti token desain Industrial Cockpit: judul serif, versi/tanggal monospasi, kartu rilis bersasis gelap, dan badge amber. Bagian **Dalam pengembangan / Belum dirilis** dan versi saat ini terbuka secara default; rilis sebelumnya memakai kontrol details/summary yang dapat dioperasikan dengan keyboard. Setiap kategori ditampilkan sebagai daftar perubahan, termasuk hasil verifikasi dan keterbatasannya. Tombol **Kembali ke EasyCal** menuju halaman utama.

## 9. Umpan Balik Lampiran Calendar

Hasil ekstraksi web menampilkan pesan **Berkas undangan terlampir di event Google Calendar** dengan warna signal-green setelah pemasangan berhasil. Jika event tersimpan tetapi lampiran gagal, pesan berwarna signal-amber menjelaskan kegagalan secara terpisah; tautan event/folder yang tersedia tetap dapat dibuka. Pesan menggunakan role=status dan membungkus pada mobile. Bot Telegram menyampaikan hasil lampiran pada balasan agenda yang sama.

### Feedback timeout dan retry (v1.3.1)

Pesan awal menyatakan pemrosesan dimulai. Selama ekstraksi, indikator menyatakan menunggu hasil AI; status kalender dilaporkan pada hasil akhir. Gagal sementara pada percobaan 1–2 menyatakan pekerjaan menunggu worker, tidak perlu mengirim ulang, dan mengarahkan ke /status tanpa janji waktu lanjut. Hasil baru membalas pesan asal melalui [ReplyParameters Telegram](https://core.telegram.org/bots/api#replyparameters) agar respons lama tidak tampak sebagai jawaban perintah baru. Galat permanen dan batas percobaan tetap dinyatakan gagal.
