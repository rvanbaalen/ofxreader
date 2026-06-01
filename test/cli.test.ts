import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "bin", "ofxreader.ts");
const BANK = join(ROOT, "test", "fixtures", "bank.ofx");
const COMBINED = join(ROOT, "test", "fixtures", "combined.ofx");
const V1 = join(ROOT, "test", "fixtures", "v1.ofx");
const VENDORS = join(ROOT, "test", "fixtures", "vendors.ofx");

type Run = { code: number; stdout: string; stderr: string };

function cli(args: string[], env?: Record<string, string>): Run {
  try {
    const stdout = execFileSync(process.execPath, [BIN, ...args], {
      encoding: "utf8",
      env: env ? { ...process.env, ...env } : process.env,
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      code: e.status ?? 1,
      stdout: e.stdout?.toString() ?? "",
      stderr: e.stderr?.toString() ?? "",
    };
  }
}

function tmpStore(): string {
  return join(tmpdir(), `ofx-cli-vendors-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
}

test("summary returns one statement object per statement", () => {
  const r = cli(["summary", BANK]);
  assert.equal(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(Array.isArray(out), true);
  assert.equal(out.length, 1);
  assert.equal(out[0].account.id, "1234567890");
  assert.equal(out[0].counts.transactions, 4);
  assert.equal(out[0].totals.credits, 2500);
});

test("accounts dedupes across statements", () => {
  const r = cli(["accounts", COMBINED]);
  assert.equal(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.length, 2);
  assert.deepEqual(
    out.map((a: { type: string }) => a.type).sort(),
    ["CHECKING", "CREDITCARD"],
  );
});

test("transactions: type filter", () => {
  const r = cli(["transactions", BANK, "--type", "debit"]);
  assert.equal(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.total, 3);
  assert.equal(out.count, 3);
});

test("transactions: text search", () => {
  const out = JSON.parse(cli(["transactions", BANK, "--search", "amazon"]).stdout);
  assert.equal(out.total, 1);
  assert.match(out.transactions[0].name, /AMAZON/);
});

test("transactions: inclusive date range", () => {
  const out = JSON.parse(
    cli(["transactions", BANK, "--from", "2024-02-01", "--to", "2024-03-15"]).stdout,
  );
  assert.equal(out.total, 2);
});

test("transactions: negative amount via = form", () => {
  const out = JSON.parse(cli(["transactions", BANK, "--min=-50"]).stdout);
  assert.equal(out.total, 2); // 2500 and -8.75 are >= -50
});

test("transactions: limit caps rows, total still counts all", () => {
  const out = JSON.parse(cli(["transactions", BANK, "--type", "debit", "--limit", "2"]).stdout);
  assert.equal(out.total, 3);
  assert.equal(out.count, 2);
});

test("--pretty indents the JSON", () => {
  const r = cli(["transactions", BANK, "--limit", "1", "--pretty"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /\n {2}"total"/);
});

test("--llm prints the usage guide", () => {
  const r = cli(["--llm"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /ofxreader/);
  assert.match(r.stdout, /OUTPUT CONTRACT/);
  assert.match(r.stdout, /TRANSACTION FILTERS/);
});

test("--version prints a semver string", () => {
  const r = cli(["--version"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test("missing file argument is a USAGE error (exit 2)", () => {
  const r = cli(["summary"]);
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.stderr).error.code, "USAGE");
});

test("unknown command is a USAGE error (exit 2)", () => {
  const r = cli(["explode", BANK]);
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.stderr).error.code, "USAGE");
});

test("nonexistent file is FILE_NOT_FOUND (exit 1)", () => {
  const r = cli(["summary", join(ROOT, "nope.ofx")]);
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.stderr).error.code, "FILE_NOT_FOUND");
});

test("OFX 1.x file is NOT_OFX2 (exit 1)", () => {
  const r = cli(["summary", V1]);
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.stderr).error.code, "NOT_OFX2");
});

test("bad --type value is a USAGE error", () => {
  const r = cli(["transactions", BANK, "--type", "spam"]);
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.stderr).error.code, "USAGE");
});

test("vendor flow: candidates -> learn -> list -> deterministic query", () => {
  const store = tmpStore();
  const env = { OFXREADER_VENDORS: store };
  try {
    // Unknown vendor: no confirmed matches, but candidates surface.
    const q0 = JSON.parse(cli(["transactions", VENDORS, "--vendor", "Jason's Carousel"], env).stdout);
    assert.equal(q0.resolved, false);
    assert.equal(q0.total, 0);
    assert.ok(q0.vendorCandidates.length >= 1);

    // Learn two confirmed descriptors.
    const learned = JSON.parse(
      cli(["vendor-learn", "Jason's Carousel", "SQ *JASONS CARO 0123", "TST* JASONSCAROUSEL"], env).stdout,
    );
    assert.equal(learned.vendor, "Jason's Carousel");
    assert.ok(learned.signatures.includes("JASONS CARO"));

    // It now appears in the vendor list.
    const vendors = JSON.parse(cli(["vendors"], env).stdout);
    assert.ok(vendors["Jason's Carousel"]);

    // Query for April is now deterministic: the two April transactions.
    const q1 = JSON.parse(
      cli(["transactions", VENDORS, "--vendor", "Jason's Carousel", "--from", "2024-04-01", "--to", "2024-04-30"], env).stdout,
    );
    assert.equal(q1.resolved, true);
    assert.equal(q1.total, 2);
    assert.deepEqual(q1.transactions.map((t: { id: string }) => t.id).sort(), ["v-1", "v-2"]);
  } finally {
    if (existsSync(store)) rmSync(store);
  }
});

test("vendor-learn without descriptors is a USAGE error", () => {
  const r = cli(["vendor-learn", "Jason's Carousel"], { OFXREADER_VENDORS: tmpStore() });
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.stderr).error.code, "USAGE");
});
