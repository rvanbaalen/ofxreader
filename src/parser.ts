import { readFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";

/** Structured error carrying a machine-readable code for the CLI's JSON output. */
export class OfxError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "OfxError";
    this.code = code;
  }
}

const HEADER_SCAN_LEN = 1024;

/**
 * Sniff which OFX generation a file is.
 *   "2"  -> OFX 2.x (XML)            (supported)
 *   "1"  -> OFX 1.x (SGML)           (rejected)
 *   null -> not recognizable as OFX
 */
export function detectOfxVersion(text: string): "1" | "2" | null {
  const head = text.slice(0, HEADER_SCAN_LEN);
  // OFX 2.x carries an XML processing instruction: <?OFX OFXHEADER="200" ...?>
  if (/<\?OFX[^>]*OFXHEADER\s*=\s*"\s*2\d*\s*"/i.test(head)) return "2";
  // Some 2.x exports drop the <?OFX?> PI but are still XML with an <OFX> root.
  if (/<\?xml[\s?]/i.test(head) && /<OFX[\s>]/i.test(text)) return "2";
  // OFX 1.x uses a colon-delimited SGML header: OFXHEADER:100
  if (/OFXHEADER\s*:\s*\d+/i.test(head)) return "1";
  return null;
}

/** Read a file from disk, mapping fs errors to OfxError codes. */
export function readOfxFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      throw new OfxError("FILE_NOT_FOUND", `File not found: ${path}`);
    }
    if (e.code === "EISDIR") {
      throw new OfxError("READ_ERROR", `Path is a directory, not a file: ${path}`);
    }
    throw new OfxError("READ_ERROR", `Could not read file ${path}: ${e.message}`);
  }
}

/** Parse OFX 2.x text into a raw nested object. Throws OfxError on any problem. */
export function parseOfx(text: string): unknown {
  const version = detectOfxVersion(text);
  if (version === "1") {
    throw new OfxError(
      "NOT_OFX2",
      "File looks like OFX 1.x (SGML). This tool only supports OFX 2.x (XML).",
    );
  }
  if (version == null) {
    throw new OfxError("NOT_OFX2", "File is not recognizable as OFX 2.x (XML).");
  }

  // Strip every processing instruction (<?xml?>, <?OFX?>) so the parser only
  // ever sees the <OFX> element tree.
  const cleaned = text.replace(/<\?[\s\S]*?\?>/g, "");

  const parser = new XMLParser({
    ignoreAttributes: true,
    ignoreDeclaration: true,
    parseTagValue: false, // keep amounts/dates/ids as raw strings; we normalize ourselves
    trimValues: true,
    processEntities: true,
  });

  let raw: unknown;
  try {
    raw = parser.parse(cleaned);
  } catch (err) {
    throw new OfxError("PARSE_ERROR", `Failed to parse OFX XML: ${(err as Error).message}`);
  }

  if (raw == null || typeof raw !== "object" || !("OFX" in (raw as object))) {
    throw new OfxError("PARSE_ERROR", "Parsed file has no <OFX> root element.");
  }
  return raw;
}
