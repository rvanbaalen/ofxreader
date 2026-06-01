import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Read the package version from package.json (single source of truth). */
export function getVersion(): string {
  const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
  return pkg.version ?? "0.0.0";
}
