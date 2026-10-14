# Aturan kerja proyek EasyCal

## Wajib pada setiap perubahan

1. Tinjau seluruh perubahan dalam lingkup pekerjaan, termasuk perubahan dari tugas sebelumnya yang belum dicatat.
2. Perbarui `CHANGELOG.md` pada pekerjaan yang sama. Gunakan bagian `Unreleased` jika versi rilis belum ditentukan; jangan mencatat ulang perubahan yang sudah terdokumentasi.
3. Tinjau dokumentasi yang ada dan perbarui semua dokumen yang terdampak agar sesuai dengan implementasi terbaru: `README.md`, `PRD.md`, `Architecture.md`, `Schema.md`, `Design.md`, `Rules.md`, `AGENTS.md`, serta dokumen lain yang relevan. Jangan mengubah dokumen yang tidak terdampak hanya untuk mengganti tanggal.
4. Ikuti standar teknis di `Rules.md`. Dokumentasikan perubahan perilaku, perintah, API, konfigurasi, kontrak data, dan batas operasional pada dokumen yang sesuai.
5. Catat pengujian yang benar-benar dilakukan, hasilnya, pemeriksaan yang dilewati atau gagal, serta keterbatasan yang masih ada. Jangan menyatakan pengujian dengan layanan tiruan sebagai verifikasi layanan produksi.
6. Jalankan pemeriksaan yang sesuai dengan perubahan serta `git diff --check`. Untuk perubahan dokumentasi saja, periksa konsistensi isi, tautan lokal, contoh, dan format; pengujian aplikasi tidak perlu diulang jika kode tidak berubah.
7. Selesaikan pembaruan dokumentasi dan changelog sebelum menyatakan pekerjaan selesai, serta sebelum commit, push, atau deploy. Sertakan pembaruan tersebut bersama perubahan implementasinya. Jika ada hambatan, jelaskan hambatan dan pemeriksaan yang belum selesai.

Aturan ini berlaku untuk fitur, perbaikan kecil, tampilan, konfigurasi, dependensi, pengujian, dan dokumentasi. Aturan ini sendiri tidak memulai commit, push, atau deploy. Permintaan eksplisit pengguna untuk push Git mencakup rilis terkait sesuai alur di bawah; ikuti instruksi dan batasan pengguna dalam sesi.

## Format changelog dan rilis

- `CHANGELOG.md` menjadi sumber catatan perubahan proyek. Format mengikuti referensi `excel-processor-v3`: judul `Changelog`, pengantar, bagian `[Unreleased]`, lalu rilis terbaru terlebih dahulu dengan judul `## [X.Y.Z] - YYYY-MM-DD`.
- Kelompokkan catatan dalam `Added`, `Changed`, `Fixed`, `Removed`, `Deprecated`, atau `Security` sesuai kebutuhan. Gunakan `Validation` untuk hasil pemeriksaan dan batas verifikasi; jangan menambahkan bagian kosong.
- Tulis poin dalam bahasa Indonesia yang menjelaskan perubahan dan dampaknya bagi pengguna atau pengelola. Catatan yang belum dirilis tidak boleh diberi tanggal atau versi rilis seolah sudah dipublikasikan.
- Saat menyiapkan rilis, pindahkan catatan terkait dari `Unreleased` ke versi rilis yang disepakati. Jika versi dinaikkan, selaraskan `package.json`, `package-lock.json`, dan label versi atau tampilan changelog aplikasi jika tersedia.
- Jika aplikasi menyediakan halaman changelog, tampilkan versi, tanggal, judul, kategori, dan uraian yang konsisten dengan `CHANGELOG.md`; ikuti desain EasyCal dalam `Design.md` dan `Rules.md`.

## Wajib ketika pengguna meminta push Git

Permintaan **push git**, **git push**, atau ungkapan setara mencakup persiapan dan penerbitan rilis aplikasi untuk perubahan terkait, bukan sekadar menjalankan perintah push. Jalankan urutan berikut tanpa meminta ulang izin rutin yang sudah tercakup dalam permintaan tersebut:

1. Tinjau perubahan yang akan dirilis, termasuk pekerjaan sebelumnya yang belum dirilis. Jangan memasukkan perubahan pengguna yang tidak terkait atau rahasia lokal.
2. Tinjau dan perbarui seluruh dokumentasi yang terdampak agar menggambarkan implementasi final. Jangan mengubah dokumen yang tidak terdampak hanya untuk mengganti tanggal.
3. Tinjau `.gitignore` dan perbarui pola yang diperlukan untuk cache, build, laporan, percobaan lokal, serta kredensial. Periksa juga file yang sudah dilacak: pola ignore saja tidak menghentikan pelacakannya. Pertahankan tes, worker, template konfigurasi tanpa rahasia, dan artefak proyek yang memang diperlukan.
4. Siapkan versi rilis. Gunakan versi yang ditentukan pengguna; jika tidak disebutkan, tentukan kenaikan SemVer berdasarkan perubahan aktual. Selaraskan `package.json`, `package-lock.json`, label versi, README, dan tampilan changelog yang terkait.
5. Pindahkan catatan perubahan terkait dari `Unreleased` ke bagian versi baru dengan tanggal rilis sebenarnya. Sertakan hasil validasi dan keterbatasan; jangan menghilangkan catatan atau menduplikasi catatan yang telah dirilis.
6. Jalankan pemeriksaan yang sesuai, termasuk lint, pemeriksaan tipe, pengujian, build bila kode/dependensi berubah, konsistensi dokumentasi/versi, serta `git diff --check`. Untuk rilis dokumentasi saja, ikuti pengecualian pengujian pada aturan perubahan di atas. Laporkan kegagalan atau hambatan secara jujur sebelum menyatakan rilis siap.
7. Periksa isi staging, lalu commit perubahan implementasi beserta dokumentasi/changelog/konfigurasi rilis. Buat tag versi dan push branch serta tag terkait. Jangan melewati pembatasan akses, branch protection, atau pemeriksaan wajib.
8. Laporkan versi, commit/tag dan hasil push yang benar-benar terverifikasi. Jika deployment mengikuti pipeline yang sudah dikonfigurasi, bedakan status push, rilis Git, dan deployment; jangan menyatakan produksi berhasil hanya karena push/tag berhasil.

Penambahan atau perubahan aturan ini bukan permintaan push saat itu juga. Mulai alur tersebut hanya ketika pengguna benar-benar meminta push/rilis.
