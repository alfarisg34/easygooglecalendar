'use client';

import { useEffect, useRef, useState } from 'react';
import { DateTime } from 'luxon';

export interface LifecycleFields {
  activity_status?: 'active' | 'cancelled';
  lifecycle_version?: number;
  lifecycle_sync?: 'synced' | 'processing' | 'error' | 'local';
  lifecycle_error?: string;
  lifecycle_channel?: 'web' | 'telegram';
  cancellation_reason?: string;
  cancelled_at?: string;
  google_calendar_id?: string;
}

export default function EventLifecycleDialog(props: {
  event: LifecycleFields & { title: string; start_time: string; end_time: string };
  busy: boolean; error: string; onClose: () => void; onConfirm: (reason: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState('');
  const restoring = props.event.activity_status === 'cancelled';
  useEffect(() => { dialog.current?.showModal(); }, []);
  return (
    <dialog ref={dialog} className="lifecycle-dialog" aria-labelledby="lifecycle-title"
      onCancel={e => { e.preventDefault(); if (!props.busy) props.onClose(); }}>
      <form onSubmit={e => { e.preventDefault(); if (!props.busy) props.onConfirm(reason); }}>
        <h2 id="lifecycle-title">{restoring ? 'Aktifkan kembali kegiatan?' : 'Batalkan kegiatan?'}</h2>
        <p className="lifecycle-event-title">{props.event.title}</p>
        <p>{DateTime.fromISO(props.event.start_time).setZone('Asia/Jakarta').toFormat('dd MMM yyyy, HH:mm')}–{DateTime.fromISO(props.event.end_time).setZone('Asia/Jakarta').toFormat('HH:mm')} WIB</p>
        <p>Kalender: {props.event.google_calendar_id || 'Kalender kegiatan yang tersimpan'}</p>
        <p>{restoring ? 'Judul, pengingat, dan ketersediaan kalender sebelum pembatalan akan dipulihkan.' : 'Kegiatan, undangan, dan dokumentasi tetap tersimpan. Setelah sinkronisasi berhasil, pengingat Google Calendar dimatikan dan waktunya ditandai tersedia.'}</p>
        {restoring && Date.parse(props.event.end_time) < Date.now() && <p className="lifecycle-warning">Jadwal kegiatan sudah lewat.</p>}
        {!restoring && <label className="lifecycle-reason">Alasan pembatalan (opsional)
          <textarea autoFocus value={reason} onChange={e => setReason(e.target.value)} maxLength={500} disabled={props.busy} rows={3} />
        </label>}
        {props.error && <p role="alert" className="lifecycle-warning">{props.error}</p>}
        <div className="lifecycle-actions">
          <button type="button" className="btn-tactile" onClick={props.onClose} disabled={props.busy}>Kembali</button>
          <button autoFocus={restoring} type="submit" className={`btn-tactile ${restoring ? 'btn-primary' : 'btn-danger'}`} disabled={props.busy}>
            {props.busy ? 'Memperbarui kegiatan…' : restoring ? 'Ya, aktifkan kembali' : 'Ya, batalkan kegiatan'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
