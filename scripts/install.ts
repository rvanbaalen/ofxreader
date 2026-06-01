#!/usr/bin/env node
/**
 * Install (or remove) a symlink so `ofxreader` is runnable from anywhere.
 *
 *   node scripts/install.ts [dir]            # install   (default dir: /usr/local/bin)
 *   node scripts/install.ts uninstall [dir]  # uninstall
 *
 * The link target dir can also be set via OFXREADER_BIN_DIR.
 * Invoked via `npm run install-cli` / `npm run uninstall-cli`.
 */
import {
  chmodSync,
  existsSync,
  lstatSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const BIN_NAME = "ofxreader";
const DEFAULT_DIR = "/usr/local/bin";

function main(argv: string[]): number {
  const mode: "install" | "uninstall" = argv.includes("uninstall") ? "uninstall" : "install";
  const dirArg = argv.find((a) => a !== "install" && a !== "uninstall");
  const targetDir = resolve(dirArg ?? process.env.OFXREADER_BIN_DIR ?? DEFAULT_DIR);
  const linkPath = join(targetDir, BIN_NAME);

  const here = dirname(fileURLToPath(import.meta.url)); // .../scripts
  const source = resolve(here, "..", "bin", "ofxreader.ts"); // .../bin/ofxreader.ts

  return mode === "uninstall"
    ? uninstall(linkPath, source)
    : install(linkPath, source, targetDir);
}

function install(linkPath: string, source: string, targetDir: string): number {
  if (!existsSync(source)) return fail(`Cannot find CLI entry point: ${source}`);
  if (!existsSync(targetDir)) return fail(`Target directory does not exist: ${targetDir}`);

  try {
    chmodSync(source, 0o755); // ensure the shebang entry is executable
  } catch {
    /* non-fatal */
  }

  const existing = lstatSafe(linkPath);
  if (existing != null) {
    if (!existing.isSymbolicLink()) {
      return fail(`Refusing to overwrite existing non-symlink at ${linkPath}.`);
    }
    unlinkSync(linkPath);
  }

  try {
    symlinkSync(source, linkPath);
  } catch (err) {
    if (isPermission(err)) {
      return fail(
        `Permission denied writing ${linkPath}.\n` +
          `Re-run with elevated permissions, e.g.:\n  sudo npm run install-cli`,
      );
    }
    throw err;
  }

  process.stdout.write(`Linked ${linkPath} -> ${source}\nNow run:  ${BIN_NAME} --llm\n`);
  return 0;
}

function uninstall(linkPath: string, source: string): number {
  const existing = lstatSafe(linkPath);
  if (existing == null) {
    process.stdout.write(`Nothing to remove at ${linkPath}\n`);
    return 0;
  }
  if (!existing.isSymbolicLink()) {
    return fail(`${linkPath} is not a symlink; leaving it untouched.`);
  }
  const target = resolve(dirname(linkPath), readlinkSync(linkPath));
  if (target !== source) {
    return fail(`${linkPath} points to ${target}, not this project; leaving it untouched.`);
  }
  try {
    unlinkSync(linkPath);
  } catch (err) {
    if (isPermission(err)) return fail(`Permission denied removing ${linkPath}. Try sudo.`);
    throw err;
  }
  process.stdout.write(`Removed ${linkPath}\n`);
  return 0;
}

function lstatSafe(path: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function isPermission(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === "EACCES" || code === "EPERM";
}

function fail(message: string): number {
  process.stderr.write(message + "\n");
  return 1;
}

process.exitCode = main(process.argv.slice(2));
