# Changelog

Semua perubahan penting pada proyek **EasyCal** didokumentasikan dalam berkas ini.

Format mengikuti [Keep a Changelog](https://keepachangelog.com/id/1.0.0/) dan susunan changelog proyek Excel File Processor V3. Penomoran rilis mengikuti [Semantic Versioning](https://semver.org/lang/id/). Perubahan yang belum dirilis dicatat pada `Unreleased`.

---

## [Unreleased]

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
