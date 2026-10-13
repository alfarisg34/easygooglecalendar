# Aturan kerja proyek EasyCal

## Wajib pada setiap perubahan

1. Tinjau seluruh perubahan dalam lingkup pekerjaan, termasuk perubahan dari tugas sebelumnya yang belum dicatat.
2. Perbarui `CHANGELOG.md` pada pekerjaan yang sama. Gunakan bagian `Unreleased` jika versi rilis belum ditentukan; jangan mencatat ulang perubahan yang sudah terdokumentasi.
3. Tinjau dokumentasi yang ada dan perbarui semua dokumen yang terdampak agar sesuai dengan implementasi terbaru: `README.md`, `PRD.md`, `Architecture.md`, `Schema.md`, `Design.md`, `Rules.md`, `AGENTS.md`, serta dokumen lain yang relevan. Jangan mengubah dokumen yang tidak terdampak hanya untuk mengganti tanggal.
4. Ikuti standar teknis di `Rules.md`. Dokumentasikan perubahan perilaku, perintah, API, konfigurasi, kontrak data, dan batas operasional pada dokumen yang sesuai.
5. Catat pengujian yang benar-benar dilakukan, hasilnya, pemeriksaan yang dilewati atau gagal, serta keterbatasan yang masih ada. Jangan menyatakan pengujian dengan layanan tiruan sebagai verifikasi layanan produksi.
6. Jalankan pemeriksaan yang sesuai dengan perubahan serta `git diff --check`. Untuk perubahan dokumentasi saja, periksa konsistensi isi, tautan lokal, contoh, dan format; pengujian aplikasi tidak perlu diulang jika kode tidak berubah.
7. Selesaikan pembaruan dokumentasi dan changelog sebelum menyatakan pekerjaan selesai, serta sebelum commit, push, atau deploy. Sertakan pembaruan tersebut bersama perubahan implementasinya. Jika ada hambatan, jelaskan hambatan dan pemeriksaan yang belum selesai.

Aturan ini berlaku untuk fitur, perbaikan kecil, tampilan, konfigurasi, dependensi, pengujian, dan dokumentasi. Aturan ini tidak memberikan izin otomatis untuk commit, push, atau deploy; ikuti instruksi pengguna dalam sesi.

## Format changelog dan rilis

- `CHANGELOG.md` menjadi sumber catatan perubahan proyek. Format mengikuti referensi `excel-processor-v3`: judul `Changelog`, pengantar, bagian `[Unreleased]`, lalu rilis terbaru terlebih dahulu dengan judul `## [X.Y.Z] - YYYY-MM-DD`.
- Kelompokkan catatan dalam `Added`, `Changed`, `Fixed`, `Removed`, `Deprecated`, atau `Security` sesuai kebutuhan. Gunakan `Validation` untuk hasil pemeriksaan dan batas verifikasi; jangan menambahkan bagian kosong.
- Tulis poin dalam bahasa Indonesia yang menjelaskan perubahan dan dampaknya bagi pengguna atau pengelola. Catatan yang belum dirilis tidak boleh diberi tanggal atau versi rilis seolah sudah dipublikasikan.
- Saat menyiapkan rilis, pindahkan catatan terkait dari `Unreleased` ke versi rilis yang disepakati. Jika versi dinaikkan, selaraskan `package.json`, `package-lock.json`, dan label versi atau tampilan changelog aplikasi jika tersedia.
- Jika aplikasi menyediakan halaman changelog, tampilkan versi, tanggal, judul, kategori, dan uraian yang konsisten dengan `CHANGELOG.md`; ikuti desain EasyCal dalam `Design.md` dan `Rules.md`.
