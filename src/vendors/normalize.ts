/**
 * Normalize a raw OFX transaction descriptor into a stable, comparable core.
 *
 *   "SQ *JASONS CARO 0123"  -> "JASONS CARO"
 *   "TST* JASONSCAROUSEL"   -> "JASONSCAROUSEL"
 *   "POS PURCHASE WHOLEFDS" -> "WHOLEFDS"
 *
 * Heuristic by design: confirmed signatures are exact substrings derived from real
 * descriptors, so perfect normalization is not required — it mainly removes payment-
 * processor noise so fuzzy candidate matching and substring matching behave sensibly.
 */

// Leading payment-processor "XX *" token, e.g. "SQ *", "TST*", "PP*", "IZ *".
const STAR_PREFIX = /^[A-Z0-9]{2,5}\s*\*\s*/;

// Conservative leading noise words (kept short to avoid clipping real names).
const LEADING_NOISE = /^(POS|PURCHASE|DEBIT|CREDIT|CHECKCARD|RECURRING|ACH|WWW)\b[\s.]*/;

export function normalizeDescriptor(input: string | null | undefined): string {
  let s = (input ?? "").toUpperCase();

  s = s.replace(STAR_PREFIX, " ").trimStart();

  let prev = "";
  while (s !== prev) {
    prev = s;
    s = s.replace(LEADING_NOISE, " ").trimStart();
  }

  // Drop digits and punctuation (store numbers, "#123", locations like "CA"
  // survive as letters but rarely hurt substring matching).
  s = s.replace(/[^A-Z\s]/g, " ");

  return s.replace(/\s+/g, " ").trim();
}
