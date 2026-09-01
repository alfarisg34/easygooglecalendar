import { DateTime } from 'luxon';
import { CalendarEvent } from './types';

/**
 * Converts ISO 8601 date string to Google Calendar URL date format (YYYYMMDDTHHMMSSZ or YYYYMMDDTHHMMSS)
 */
export function formatGoogleCalendarDates(startTimeISO: string, endTimeISO: string): string {
  try {
    let startDt = DateTime.fromISO(startTimeISO, { setZone: true });
    let endDt = DateTime.fromISO(endTimeISO, { setZone: true });

    if (!startDt.isValid) {
      startDt = DateTime.now().setZone('Asia/Jakarta').plus({ days: 1 }).set({ hour: 9, minute: 0, second: 0 });
    }
    if (!endDt.isValid || endDt <= startDt) {
      endDt = startDt.plus({ hours: 2 });
    }

    // Use UTC format YYYYMMDDTHHmmssZ for absolute reliability across all user timezones
    const startFormatted = startDt.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
    const endFormatted = endDt.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");

    return `${startFormatted}/${endFormatted}`;
  } catch (err) {
    const fallbackStart = DateTime.now().toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
    const fallbackEnd = DateTime.now().plus({ hours: 2 }).toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
    return `${fallbackStart}/${fallbackEnd}`;
  }
}

/**
 * Builds the direct 1-click Google Calendar Event Creation URL
 */
export function buildGoogleCalendarUrl(event: CalendarEvent): string {
  const dates = formatGoogleCalendarDates(event.start_time, event.end_time);
  const title = encodeURIComponent(event.title || 'Agenda Kegiatan / Rapat');
  
  // Format descriptive details
  let detailsText = '';
  if (event.jp) {
    detailsText += `📚 Bobot: ${event.jp}\n`;
  }
  if (event.meeting_link) {
    detailsText += `🔗 Link Meeting: ${event.meeting_link}\n`;
  }
  if (event.meeting_id_pass) {
    detailsText += `🔑 Kredensial: ${event.meeting_id_pass}\n`;
  }
  if (event.speakers) {
    detailsText += `👥 Narasumber / Pengisi Acara:\n${event.speakers}\n\n`;
  }
  if (event.description) {
    detailsText += `📝 Rangkuman & Agenda:\n${event.description}`;
  }

  const details = encodeURIComponent(detailsText.trim());
  const location = encodeURIComponent(event.location || (event.is_online ? 'Zoom Meeting' : ''));

  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dates}&details=${details}&location=${location}&ctz=Asia/Jakarta`;
}

/**
 * Generates an RFC 5545 compliant .ics iCalendar file content string
 */
export function generateICSContent(event: CalendarEvent): string {
  let startDt = DateTime.fromISO(event.start_time, { setZone: true });
  let endDt = DateTime.fromISO(event.end_time, { setZone: true });

  if (!startDt.isValid) {
    startDt = DateTime.now().setZone('Asia/Jakarta').plus({ days: 1 }).set({ hour: 9, minute: 0, second: 0 });
  }
  if (!endDt.isValid || endDt <= startDt) {
    endDt = startDt.plus({ hours: 2 });
  }

  const startUtc = startDt.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
  const endUtc = endDt.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
  const nowUtc = DateTime.now().toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
  const uid = `easycal-${Date.now()}-${Math.random().toString(36).substring(2, 9)}@easygooglecalendar`;

  // Escape special ICS characters (\, ;, ,, \n)
  const sanitizeIcs = (str: string) => {
    return (str || '')
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  };

  let descriptionLines = [];
  if (event.jp) descriptionLines.push(`Bobot: ${event.jp}`);
  if (event.meeting_link) descriptionLines.push(`Link Meeting: ${event.meeting_link}`);
  if (event.meeting_id_pass) descriptionLines.push(`Kredensial: ${event.meeting_id_pass}`);
  if (event.speakers) descriptionLines.push(`Narasumber: ${event.speakers}`);
  if (event.description) descriptionLines.push(`\n${event.description}`);

  const fullDescription = sanitizeIcs(descriptionLines.join('\n'));
  const summary = sanitizeIcs(event.title || 'Agenda Kegiatan');
  const location = sanitizeIcs(event.location || (event.is_online ? 'Zoom Meeting' : ''));

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//EasyGoogleCalendar//IDN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${nowUtc}`,
    `DTSTART:${startUtc}`,
    `DTEND:${endUtc}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${fullDescription}`,
    `LOCATION:${location}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
}
