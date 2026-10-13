# Changelog

Semua perubahan penting pada proyek **EasyCal** didokumentasikan dalam berkas ini.

Format mengikuti [Keep a Changelog](https://keepachangelog.com/id/1.0.0/) dan susunan changelog proyek Excel File Processor V3. Penomoran rilis mengikuti [Semantic Versioning](https://semver.org/lang/id/). Perubahan yang belum dirilis dicatat pada `Unreleased`.

---

## [Unreleased]

## [1.1.1] - 2026-10-13

### Fixed

- Hasil pembaruan kegiatan dan kegagalannya kini mengganti pesan progress Telegram, sehingga progress 93% tidak tertinggal setelah hasil diterima. Animasi menunggu edit yang sedang berlangsung sebelum hasil akhir dikirim.
- Kegagalan edit pesan Telegram kini diperiksa sampai respons percobaan ulang. Jika pesan progress tidak dapat diedit, hasil update dikirim sebagai pesan baru.
- Pencocokan foto dokumentasi tidak lagi menggunakan waktu unggah ketika EXIF/watermark gagal dibaca. Foto tanpa bukti waktu, tanpa kegiatan dalam rentang toleransi, atau dengan beberapa kandidat diarahkan ke pemilihan kegiatan manual.
- OCR watermark memakai model pilihan pengguna dan rantai model cadangan dengan batas delapan detik per panggilan. Tanggal/jam divalidasi; jam yang hilang tidak lagi diisi 10.00 secara otomatis.
- Telegram tidak lagi membuat folder dokumentasi terpisah ketika kegiatan tidak cocok. Caption `#poster` tetap mengarahkan album ke ekstraksi agenda. Balasan berhasil menampilkan waktu foto dan sumber EXIF/watermark.
- Web meminta pemilihan kegiatan saat waktu foto tidak terbaca. Pengunggahan manual tetap tersedia; waktu pengambilan yang tidak diketahui disimpan kosong, bukan diganti waktu unggah, dan ditampilkan sebagai tidak terbaca.

### Added

- Tes regresi penutupan progress pada update berhasil/gagal, pembacaan riwayat gagal, edit animasi yang masih berjalan, dan fallback pengiriman hasil di `scratch/test-telegram-progress.ts`.
- Tes regresi watermark, model fallback, foto 12 Oktober yang diunggah pada hari lain, kandidat ambigu, serta alur Telegram dan pemilihan manual web di `scratch/test-photo-timestamp.ts`.

### Changed

- Versi paket, lockfile, README, dan catatan rilis diselaraskan ke 1.1.1. Folder context diabaikan Git untuk mempertahankan gambar pengujian lokal tanpa memasukkannya ke repository.

### Validation

- Pemeriksaan akhir rilis 1.1.1: build produksi (termasuk TypeScript), keempat suite regresi, keselarasan versi paket/lockfile/README, delapan dokumen, sembilan tautan Markdown lokal, dan git diff --check lulus. npm run lint tetap gagal karena next lint tidak kompatibel dengan Next.js terpasang.

- Build dan tes progress Telegram, foto, lifecycle, serta pemulihan otorisasi lulus setelah perbaikan penutupan progress. Tes memakai layanan tiruan; perubahan ini belum diuji pada chat Telegram produksi.
- Tiga foto pada folder context diperiksa secara visual: stempel 12 Oktober 2026 pukul 10.18. Pemeriksaan exifr tidak menemukan metadata tanggal atau perangkat kamera pada ketiganya. Respons produksi sebelumnya belum diaudit melalui log server; kegagalan OCR pada request asli belum diketahui secara spesifik.
- Tes foto, lifecycle kegiatan, dan pemulihan otorisasi lulus dengan layanan tiruan. OCR langsung ke Gemini dan pemindahan berkas yang telanjur salah folder belum dilakukan. Deployment produksi perlu diverifikasi setelah push; berkas yang telanjur salah folder tidak dipindahkan oleh rilis ini.
- `npm run build` lulus setelah perubahan handler foto, endpoint dokumentasi, UI, dan penyimpanan metadata. Pemeriksaan dokumentasi serta `git diff --check` lulus; keterbatasan skrip lint pada rilis 1.1.0 tetap berlaku.

## [1.1.0] - 2026-10-13

### Added

- Pembaruan waktu dan tempat kegiatan melalui bot Telegram dari surat PDF, gambar pada alur ekstraksi agenda, atau pesan perubahan, termasuk narasi semula menjadi. Pemilihan eksplisit tersedia melalui `/agenda` lalu `/update <nomor> <perubahan>` dengan masa berlaku daftar 15 menit.
- Validasi tanggal dan jam, pemeliharaan data yang tidak diubah, serta percobaan ulang sinkronisasi jadwal melalui `sinkron <nomor>` jika Google Calendar gagal diperbarui.
- Aturan di `AGENTS.md` dan `Rules.md` yang mewajibkan pembaruan seluruh dokumen terdampak dan changelog pada setiap perubahan, sebelum pekerjaan selesai, commit, push, atau deploy.
- `CHANGELOG.md` dengan format `Unreleased`, kategori perubahan, dan catatan verifikasi, mengacu pada proyek `excel-processor-v3`.

### Changed

- Rilis 1.1.0 menyelaraskan versi pada package.json, package-lock.json, README, dan catatan rilis.

- Perubahan kegiatan diproses sebelum pemeriksaan duplikat pada bot Telegram. Pembaruan otomatis memerlukan satu kegiatan aktif yang cocok; pilihan yang ambigu diarahkan ke `/agenda` dan `/update`.
- Jadwal baru disimpan di riwayat EasyCal dan diterapkan pada event Google Calendar yang sama. Identitas event serta folder dan dokumentasi kegiatan dipertahankan. Perubahan jam saja mempertahankan tanggal dan durasi lama jika jam akhir baru tidak disebutkan; perubahan tempat saja mempertahankan waktu.
- README, PRD, arsitektur, kontrak data, dan panduan desain interaksi Telegram diperbarui untuk alur perubahan kegiatan dan pemulihan otorisasi Google.

### Fixed

- Pembacaan token Google mengutamakan database agar cache lama tidak digunakan setelah login ulang. Penyimpanan pada callback OAuth menggunakan identitas akun Google dan mempertahankan refresh token efektif dari database.
- Kegagalan `invalid_grant` pada unggahan Drive dan operasi kalender memberikan petunjuk otorisasi ulang. Kegagalan otorisasi saat membuat folder tidak memicu percobaan pembuatan folder di root Drive.
- Perintah `/connect` menyediakan tombol **Hubungkan Ulang Google** meskipun akun masih tercatat terhubung.

### Validation

- Versi package.json, package-lock.json, README, dan changelog diselaraskan ke 1.1.0. Delapan dokumen, sembilan tautan Markdown lokal, blok kode, dan `git diff --check` diperiksa dan lulus. Berkas token dan konfigurasi rahasia tidak disertakan dalam rilis.

- Pemeriksaan akhir rilis: `npm run build` versi 1.1.0 lulus, termasuk pemeriksaan TypeScript dan seluruh route. Kedua suite regresi dijalankan ulang dan lulus.
- `node --experimental-strip-types scratch/test-event-lifecycle.ts` lulus: pembatalan/pemulihan, kepemilikan, versi, perubahan jam/tempat/tanggal, pencocokan ambigu, identitas event/folder, dan percobaan ulang sinkronisasi.
- `node --experimental-strip-types scratch/test-google-auth-recovery.ts` lulus: pembacaan token setelah reconnect, penanganan `invalid_grant`, pemilihan kegiatan bernomor, pencegahan agenda baru saat perubahan gagal terbaca, dan tombol reconnect.
- `npm run lint` gagal karena skrip `next lint` tidak kompatibel dengan Next.js yang terpasang. Pengujian memakai layanan tiruan; unggahan foto, pembacaan surat oleh Gemini, dan perubahan kalender pada akun Google nyata belum diuji. Status deployment produksi perlu diverifikasi setelah push; tag rilis tidak membuktikan deployment berhasil.
