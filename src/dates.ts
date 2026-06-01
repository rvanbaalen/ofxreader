/**
 * OFX datetime helpers.
 *
 * OFX dates look like:  YYYYMMDD[HHMMSS[.SSS]][[+/-OFFSET[:TZNAME]]]
 * Examples:
 *   "20240115"
 *   "20240115120000"
 *   "20240115120000.000"
 *   "20240115120000.000[-5:EST]"
 *   "20240115120000[+5.5:IST]"
 */

const OFX_DATE_RE =
  /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})(?:\.(\d{1,3}))?)?(?:\[\s*([+-]?\d+(?:\.\d+)?)\s*(?::([^\]]*))?\])?$/;

/**
 * Convert an OFX datetime to ISO 8601.
 * Returns a full timestamp when a time component is present, otherwise a
 * date-only string (YYYY-MM-DD). Returns null when the value can't be parsed.
 */
export function ofxToIso(value: string | null | undefined): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  const m = OFX_DATE_RE.exec(raw);
  if (m == null) return null;

  const [, y, mo, d, hh, mm, ss, ms, tz] = m;
  if (hh == null) return `${y}-${mo}-${d}`;

  const millis = ms != null ? `.${ms.padEnd(3, "0")}` : "";
  const offset = tz != null ? formatOffset(tz) : "";
  return `${y}-${mo}-${d}T${hh}:${mm}:${ss}${millis}${offset}`;
}

/** Date-only portion (YYYY-MM-DD) used for inclusive range comparisons. */
export function ofxToDateOnly(value: string | null | undefined): string | null {
  const iso = ofxToIso(value);
  return iso == null ? null : iso.slice(0, 10);
}

function formatOffset(tz: string): string {
  const hours = Number(tz);
  if (Number.isNaN(hours)) return "";
  const sign = hours < 0 ? "-" : "+";
  const abs = Math.abs(hours);
  const wholeHours = Math.floor(abs);
  const minutes = Math.round((abs - wholeHours) * 60);
  const hh = String(wholeHours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}
