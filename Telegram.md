# Bot Telegram EasyCal — P0 dan P1

Panduan mencakup rilis Git **1.3.1** (2026-10-15); fitur dasar P0/P1 tersedia sejak 1.3.0. Keberhasilan tag/push tidak membuktikan deployment atau layanan produksi sudah terverifikasi. Panduan ini melengkapi [README](README.md), [Architecture](Architecture.md), dan [Schema](Schema.md).

## Persiapan dan migrasi webhook

1. Konfigurasikan `DATABASE_URL`, `SESSION_SECRET` acak yang kuat, serta kredensial Google. Produksi menolak antrean/OAuth jika database persisten atau rahasia sesi tidak tersedia. Jangan mengganti `SESSION_SECRET` tanpa rencana migrasi: sesi, rahasia webhook, dan state terenkripsi lama akan tidak berlaku.
2. Simpan token bot pribadi melalui Pengaturan dengan akun pemiliknya. Pengelolaan token global memerlukan email pada `TELEGRAM_ADMIN_EMAILS` (dipisahkan koma). Endpoint setup memerlukan sesi login dan Origin yang sama untuk POST; GET tidak mengubah konfigurasi.
3. Klik sinkronisasi webhook di web. Backend membuat URL `/api/telegram?bot=<identitas-hash>` tanpa token bot/Gemini, memasang `secret_token`, dan mendaftarkan `message` serta `callback_query`. URL webhook kustom dari request diabaikan. Webhook lama yang memakai `bot_token`, `token`, `gemini_key`, atau `key` tidak lagi memberi otorisasi; sinkronkan ulang setelah penerapan.
4. Ketik `/connect` dari chat pribadi. Tautan penautan berlaku 10 menit dan sekali pakai; OAuth state juga sekali pakai dan harus sesuai cookie browser. Parameter `user_id=tg_...` lama tidak lagi menautkan akun. Penautan akun Google berbeda melepas penautan Telegram lama secara transaksional. Produksi memakai ikatan `telegram_chat_id` eksplisit dan token akun Google kanonis; cache/ID Telegram lama tanpa ikatan tidak memberi akses otomatis. Berbagi kontak harus kontak pengirim sendiri (`contact.user_id == from.id`), nomor cocok tepat satu akun, dan tidak mengambil alih akun yang terikat Telegram lain. ID Telegram tidak dapat diubah melalui API pengaturan web.
5. Isi `CRON_SECRET`. Webhook menyimpan pekerjaan sebelum merespons 200; `after()` mencoba menjalankan worker segera. `/api/telegram/worker` menerima GET/POST dengan `Authorization: Bearer <CRON_SECRET>` untuk memulihkan backlog/lease kedaluwarsa.

`vercel.json` menyediakan pemicu harian 00.00 UTC agar kompatibel dengan Hobby. Untuk pemulihan cepat saat tidak ada pesan masuk, gunakan penjadwal setiap menit pada paket yang mendukungnya, penjadwal eksternal, atau proses `npm run telegram:worker` di host persisten dengan `NEXT_PUBLIC_APP_URL` dan `CRON_SECRET`. Worker mandiri memanggil endpoint setiap 10 detik setelah pemanggilan sebelumnya selesai. Jangan menaruh rahasia pada URL atau argument command line. Batas jadwal dapat diperiksa di [Vercel](https://vercel.com/docs/cron-jobs/usage-and-pricing); `after()` tetap tunduk pada [batas durasi route](https://nextjs.org/docs/app/api-reference/functions/after).

## Perintah dan perilaku pengguna

| Perintah/aksi | Perilaku |
|---|---|
| Kirim PDF, foto/poster, gambar sebagai document, atau berkas TXT | Ekstraksi agenda; TXT maksimal 50.000 karakter. Caption `#poster` memilih alur undangan. |
| `/agenda`, `/agenda 2` | Daftar kegiatan aktif mendatang; nomor 1–10 berlaku 15 menit. |
| `/hariini`, `/besok`, `/minggu` | Agenda hari ini, besok, atau tujuh hari mulai hari ini, menurut WIB. |
| `/lampau` | Kegiatan aktif yang sudah selesai. |
| `/cari learning series` | Cari judul pada riwayat aktif, termasuk kegiatan lampau. |
| `/agenda 2026-10-01 2026-10-31` | Cari kegiatan yang beririsan dengan rentang tanggal; tanggal akhir termasuk. Satu tanggal berarti satu hari. |
| `--halaman 2` | Paginasi tambahan untuk perintah pencarian; bot menampilkan contoh berikutnya. |
| `/update 1 jam menjadi 13.00` atau surat revisi | Tampilkan semula → menjadi. Perubahan baru diterapkan setelah tombol konfirmasi. |
| Batalkan perubahan terakhir | Mengembalikan jadwal/tempat sebelum perubahan bila versi kegiatan masih sama. Berlaku 15 menit; tidak menghapus arsip revisi atau lampiran. |
| `/lengkapi <token> YYYY-MM-DD HH:mm HH:mm` | Lengkapi waktu hasil yang tidak terbaca; lalu periksa pratinjau dan klik Simpan. Token disediakan bot, milik pengguna/chat/bot tersebut. |
| Foto `#foto` dengan waktu ambigu/tidak diketahui | Pilih kegiatan melalui tombol di Telegram; pencarian `/pilih <token> <judul>` dan paginasi tersedia. Pilihan berlaku 60 menit. Waktu foto yang tidak terbaca tetap kosong. |
| Album foto | Ditampung selama sekitar 4 detik, maksimal 10 foto. Satu tujuan dan ringkasan hasil untuk album; tidak membuat agenda baru. Foto terlambat dapat menjadi pekerjaan terpisah. Tanpa EXIF yang cocok seragam, seluruh album memerlukan satu pilihan manual; OCR watermark per foto tetap tersedia pada unggahan foto tunggal. |
| `/arsip 1` | Dari daftar terakhir, coba pasang sumber yang sudah ada di Drive ke event Calendar yang sama. |
| Coba arsip/lampiran lagi | Pulihkan unggahan atau pemasangan lampiran yang gagal, berlaku 24 jam. Jika file sudah ada, pemasangan ulang tidak mengunggah ulang file. |
| `/status` | Konfigurasi akun, kuota jam berjalan, batas berkas, dan hasil pekerjaan terakhir. Bukan klaim izin layanan sudah diuji. |
| `/status cek` | Pemeriksaan baca Calendar, Drive, daftar model Gemini, dan database dengan timeout. Tidak membuat kegiatan; akses daftar model bukan bukti kuota/model ekstraksi berhasil. |

Perintah sebelumnya `/help`, `/connect`, `/disconnect`, `/setdrive`, `/gdrive`, `/apikey`, `/dibatalkan`, `batal`, `aktifkan`, dan `sinkron` tetap tersedia. `sinkron` memperbaiki perubahan lifecycle/jadwal; pemulihan sumber/lampiran memakai tombol arsip atau `/arsip`. Pengelolaan bot dilakukan dalam chat pribadi.

## Validasi, revisi, dan pemulihan

- Tanggal mulai yang tidak terbaca/invalid tetap kosong, tidak diganti besok. Jam selesai yang hilang/invalid diasumsikan dua jam tetapi wajib diperiksa. Bot menyediakan pelengkapan/pratinjau. Web mengembalikan `requiresConfirmation: true`, tidak menyimpan, tidak mengekspor ICS, dan meminta sumber diperbaiki/diproses kembali atau konfirmasi melalui bot.
- Pembaruan memeriksa kepemilikan, versi dan status aktif. Nilai parsial mempertahankan nilai lama; snapshot undo dapat memulihkan tanggal selesai lintas hari. Jadwal yang diinginkan diklaim dan disimpan sebelum PATCH Calendar. Riwayat lifecycle menyimpan uraian waktu/tempat sebelum dan sesudah. Event dengan attendees atau yang dihapus tetap memerlukan penanganan di Google Calendar.
- Setelah perubahan dikonfirmasi, sumber PDF/gambar/TXT diarsipkan ke folder kegiatan yang sama dan ditambahkan sebagai lampiran pada event yang sama. Folder tanpa arsip dapat dibuat sekali; folder lama tidak diganti namanya. Foto dokumentasi tidak otomatis menjadi lampiran Calendar. Berkas asli riwayat tidak ditimpa oleh revisi; metadata revisi juga disimpan sebagai state `source-archive` selama satu tahun.
- Lampiran mempertahankan lampiran lama, ETag, deduplikasi dan batas 25; tidak membuka izin Drive ke publik. `/arsip` hanya bekerja jika sumber sudah tercatat di Drive. Tidak ada pengisian massal event lama.
- Identitas pekerjaan memakai bot + `update_id`; album memakai bot + chat + `media_group_id`. Worker menggunakan klaim versi dan lease lima menit, satu pekerjaan per chat secara bersamaan. Pekerjaan terputus atau kegagalan sementara yang ditandai dicoba paling banyak tiga kali. Penolakan otorisasi/validasi disampaikan untuk ditindaklanjuti pengguna, bukan diulang tanpa batas.
- ID event Calendar ditentukan dari identitas pekerjaan. Konflik insert 409 mengambil event yang sama; Drive mencari penanda `appProperties` sebelum membuat folder/file. Riwayat event/foto memakai ID stabil. Ini mengurangi pengulangan efek saat retry, tetapi bukan transaksi atomik lintas Google dan PostgreSQL: respons Telegram bisa terulang setelah proses mati, dan balapan di luar klaim aplikasi/indeks Drive yang belum terlihat tetap perlu diperhatikan.

## Batas operasional dan pemeriksaan

`TELEGRAM_HOURLY_LIMIT` default 60 pekerjaan pemrosesan per pengguna/bot/jam; satu album dihitung satu pekerjaan. Perintah navigasi/status/koneksi dan callback dikecualikan. `TELEGRAM_MAX_FILE_BYTES` default 8 MiB, maksimal 20 MiB; metadata diperiksa sebelum unduhan dan jumlah byte saat streaming tetap dibatasi. Web membatasi sumber 8 MiB. Batas platform request/serverless dapat lebih kecil dan perlu disesuaikan dengan hosting.

State bot dienkripsi AES-256-GCM menggunakan kunci turunan `SESSION_SECRET`. Retensi pekerjaan/status/admission/hasil ekstraksi (`extraction` dan `ai-result`) tujuh hari; aksi 15 menit, foto 60 menit, arsip retry 24 jam; binding/OAuth 10 menit. Pembersihan dijalankan worker. JSON lokal `.telegram_state.json` hanya untuk pengembangan, diabaikan Git dan tidak menjadi fallback ketika database produksi gagal. Tabel kredensial `users` yang sudah ada belum dimigrasikan ke format enkripsi baru; perlindungan state ini tidak boleh diklaim sebagai enkripsi seluruh database.

Jalankan `npm run lint`, `npm test`, `npm run typecheck`, `npm run build`, dan `git diff --check`. ESLint CLI menggantikan skrip next lint; tes dan worker tetap disertakan dalam Git, sementara percobaan lokal/laporan/cache diabaikan. Test runner menolak suite yang tidak menghasilkan PASS atau melampaui batas waktu. GitHub Actions menjalankan pemeriksaan yang sama. Seluruh suite offline memakai layanan tiruan dan filesystem terisolasi. Verifikasi akun Google/Telegram, transaksi Neon, scheduler hosting, serta skenario gangguan proses nyata perlu dilakukan sesudah konfigurasi lingkungan penerapan; hasil offline tidak membuktikan layanan produksi.

## Penelusuran timeout Gemini (v1.3.1)

- Ekstraksi agenda melalui Gemini memberi tiap model maksimal 25 detik, dengan anggaran total 40 detik termasuk pembacaan body respons. Fallback memakai sisa anggaran; tidak dimulai jika sisa kurang dari 3 detik. Respons 404, 429 dan 5xx mencoba model berikutnya selama waktu tersedia. Penolakan 400/401/403 berhenti tanpa retry otomatis meskipun model sebelumnya timeout.
- Anggaran ini hanya untuk rangkaian generateContent, bukan unduhan Telegram, OCR alternatif, klasifikasi/watermark foto, operasi database atau Calendar/Drive. Batas route 60 detik tetap berlaku; fungsi masih dapat terputus saat layanan lain lambat. OCR watermark mempertahankan batas delapan detik per model.
- Log `Gemini attempt` memuat model, nomor percobaan model, timeoutMs, elapsedMs, totalMs, outcome dan status HTTP, serta hash operasi Telegram 12 karakter (web memakai penanda web). Outcome timeout mencakup abort saat fetch maupun pembacaan body. Log tidak memuat sumber undangan, keluaran AI atau API key. Nomor percobaan model berbeda dari percobaan pekerjaan pada /status.
- `telegram-extraction.ts` menyimpan hasil sukses sebelum dispatch sebagai state `ai-result`, termasuk metadata update parsial. Retry operasi yang sama memakai hasil tersimpan; sumber atau pemilik berbeda tidak berbagi cache. Gagal AI tidak dicache. Respons database gagal menahan dispatch untuk dicoba ulang. Cache hasil AI yang berhasil tidak menghilangkan pemeriksaan kepemilikan/versi/konfirmasi.
- Progres menampilkan menunggu hasil AI; tidak naik ke persentase/sinkronisasi Calendar berdasarkan timer. Timeout sementara pada percobaan pekerjaan 1–2 menampilkan status menunggu retry dan meminta pengguna tidak mengirim ulang sumber. Kelanjutan bergantung pada worker/scheduler; percobaan ketiga tetap dapat berakhir gagal.
- Pesan hasil baru dari handler membalas message_id sumber dengan reply_parameters; callback membalas pesan tombol yang ditekan. Jika sumber telah dihapus, pesan tetap boleh dikirim tanpa reply. Ini tidak menambahkan fitur mengedit agenda melalui reply pengguna.
- Jika timeout berulang, cari log `Gemini attempt` pada waktu kejadian dan kelompokkan hash operasi, model, outcome serta durasinya. Periksa /status sebelum mengirim ulang. Keberhasilan /status cek hanya membuktikan akses daftar model, bukan kuota atau latensi generateContent.
