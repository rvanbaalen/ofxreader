import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { OfxError } from "../parser.ts";
import { normalizeDescriptor } from "./normalize.ts";

export type Vendor = {
  signatures: string[]; // normalized, confirmed cores (for deterministic matching)
  raw: string[]; // original confirmed descriptors (provenance)
  updatedAt?: string; // YYYY-MM-DD
};

export type VendorStore = {
  version: number;
  vendors: Record<string, Vendor>;
};

/** Resolve the vendor store path: $OFXREADER_VENDORS, else $XDG_CONFIG_HOME, else ~/.config. */
export function storePath(): string {
  const override = process.env.OFXREADER_VENDORS;
  if (override != null && override !== "") return override;
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg != null && xdg.trim() !== "" ? xdg : join(homedir(), ".config");
  return join(base, "ofxreader", "vendors.json");
}

/** Load the store. A missing file is an empty store; corrupt JSON is an error. */
export function load(path = storePath()): VendorStore {
  if (!existsSync(path)) return { version: 1, vendors: {} };
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw new OfxError("VENDOR_STORE_ERROR", `Could not read vendor store ${path}: ${(err as Error).message}`);
  }
  try {
    const data = JSON.parse(text) as Partial<VendorStore>;
    if (data == null || typeof data !== "object" || typeof data.vendors !== "object") {
      throw new Error("expected an object with a `vendors` map");
    }
    return { version: data.version ?? 1, vendors: data.vendors as Record<string, Vendor> };
  } catch (err) {
    throw new OfxError("VENDOR_STORE_ERROR", `Vendor store ${path} is not valid: ${(err as Error).message}`);
  }
}

/** Persist the store, creating the parent directory if needed. */
export function save(store: VendorStore, path = storePath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(store, null, 2) + "\n");
}

/** Case-insensitive lookup of a vendor's canonical key. */
export function findVendorKey(store: VendorStore, name: string): string | null {
  const lower = name.toLowerCase();
  for (const key of Object.keys(store.vendors)) {
    if (key.toLowerCase() === lower) return key;
  }
  return null;
}

/**
 * Add confirmed raw descriptors to a vendor (creating it if new), deriving
 * normalized signatures. Mutates and returns the updated vendor entry.
 */
export function learn(
  store: VendorStore,
  name: string,
  rawDescriptors: string[],
  today: string,
): Vendor {
  const key = findVendorKey(store, name) ?? name;
  const existing = store.vendors[key] ?? { signatures: [], raw: [] };
  const signatures = new Set(existing.signatures);
  const raw = new Set(existing.raw);

  for (const descriptor of rawDescriptors) {
    const trimmed = (descriptor ?? "").trim();
    if (trimmed === "") continue;
    raw.add(trimmed);
    const signature = normalizeDescriptor(trimmed);
    if (signature !== "") signatures.add(signature);
  }

  const vendor: Vendor = { signatures: [...signatures], raw: [...raw], updatedAt: today };
  store.vendors[key] = vendor;
  return vendor;
}

/** Today's date as YYYY-MM-DD (for `updatedAt`). */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
