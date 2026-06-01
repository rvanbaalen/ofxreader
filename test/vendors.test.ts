import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { readOfxFile, parseOfx } from "../src/parser.ts";
import { buildDocument } from "../src/model.ts";
import type { Transaction } from "../src/model.ts";
import { normalizeDescriptor } from "../src/vendors/normalize.ts";
import { confirmedMatch, diceSimilarity, rankCandidates } from "../src/vendors/match.ts";
import { load, save, learn, findVendorKey } from "../src/vendors/store.ts";
import type { VendorStore } from "../src/vendors/store.ts";
import { resolveVendorQuery } from "../src/vendors/resolve.ts";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function tx(over: Partial<Transaction>): Transaction {
  return {
    account: "A1",
    id: "x",
    date: "2024-04-10",
    amount: -10,
    trnType: "DEBIT",
    name: "",
    memo: null,
    payee: null,
    checkNumber: null,
    ...over,
  };
}

function tmpStorePath(label: string): string {
  return join(tmpdir(), `ofxreader-vendors-${label}-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
}

// --- normalize ---

test("normalize strips processor prefixes, digits and punctuation", () => {
  assert.equal(normalizeDescriptor("SQ *JASONS CARO 0123"), "JASONS CARO");
  assert.equal(normalizeDescriptor("TST* JASONSCAROUSEL"), "JASONSCAROUSEL");
  assert.equal(normalizeDescriptor("POS PURCHASE WHOLEFDS #123"), "WHOLEFDS");
  assert.equal(normalizeDescriptor("Jason's Carousel"), "JASON S CAROUSEL");
  assert.equal(normalizeDescriptor(""), "");
  assert.equal(normalizeDescriptor(null), "");
});

// --- match ---

test("diceSimilarity ranks closer strings higher", () => {
  const close = diceSimilarity("JASON CAROUSEL LLC", "JASON S CAROUSEL");
  const far = diceSimilarity("NETFLIX", "JASON S CAROUSEL");
  assert.ok(close > far);
  assert.equal(diceSimilarity("ABC", "ABC"), 1);
});

test("confirmedMatch is signature-substring of the normalized descriptor", () => {
  const t = tx({ name: "SQ *JASONS CARO 0123" });
  assert.equal(confirmedMatch(t, ["JASONS CARO"]), true);
  assert.equal(confirmedMatch(t, ["NETFLIX"]), false);
  assert.equal(confirmedMatch(t, []), false);
});

test("rankCandidates returns similar descriptors above threshold, sorted", () => {
  const txns = [
    tx({ id: "1", name: "JASON CAROUSEL LLC 99" }),
    tx({ id: "2", name: "NETFLIX.COM" }),
    tx({ id: "3", name: "AMAZON MARKETPLACE" }),
  ];
  const candidates = rankCandidates(txns, ["JASON S CAROUSEL"], 0.6);
  assert.ok(candidates.length >= 1);
  assert.equal(candidates[0]!.normalized, "JASON CAROUSEL LLC");
  assert.ok(candidates.every((c) => c.normalized !== "NETFLIX COM"));
});

// --- store ---

test("missing store file loads as empty", () => {
  const path = tmpStorePath("missing");
  const store = load(path);
  assert.deepEqual(store, { version: 1, vendors: {} });
});

test("learn + save + load roundtrips and normalizes signatures", () => {
  const path = tmpStorePath("roundtrip");
  try {
    const store: VendorStore = { version: 1, vendors: {} };
    learn(store, "Jason's Carousel", ["SQ *JASONS CARO 0123", "TST* JASONSCAROUSEL"], "2026-06-01");
    save(store, path);
    assert.ok(existsSync(path));

    const reloaded = load(path);
    const key = findVendorKey(reloaded, "jason's carousel"); // case-insensitive
    assert.ok(key);
    const vendor = reloaded.vendors[key]!;
    assert.deepEqual(vendor.signatures.sort(), ["JASONS CARO", "JASONSCAROUSEL"]);
    assert.equal(vendor.raw.length, 2);
    assert.equal(vendor.updatedAt, "2026-06-01");
  } finally {
    if (existsSync(path)) rmSync(path);
  }
});

// --- resolve (end to end over a fixture) ---

function statementsOf(name: string) {
  return buildDocument(parseOfx(readOfxFile(join(FIX, name)))).statements;
}

test("resolveVendorQuery: confirmed matches count, fuzzy returned as candidates", () => {
  const statements = statementsOf("vendors.ofx");
  const store: VendorStore = { version: 1, vendors: {} };
  learn(store, "Jason's Carousel", ["SQ *JASONS CARO 0123", "TST* JASONSCAROUSEL"], "2026-06-01");

  // April only -> the two April Jason's transactions (the March one is excluded).
  const r = resolveVendorQuery(store, statements, "Jason's Carousel", {
    from: "2024-04-01",
    to: "2024-04-30",
  });
  assert.equal(r.resolved, true);
  assert.equal(r.total, 2);
  assert.deepEqual(r.transactions.map((t) => t.id).sort(), ["v-1", "v-2"]);

  // "JASON CAROUSEL LLC 99" is not confirmed -> surfaces as a candidate.
  assert.ok(r.vendorCandidates.some((c) => c.normalized === "JASON CAROUSEL LLC"));
  assert.ok(r.vendorCandidates.every((c) => c.normalized !== "NETFLIX COM"));
});

test("resolveVendorQuery: unknown vendor returns no confirmed matches but offers candidates", () => {
  const statements = statementsOf("vendors.ofx");
  const store: VendorStore = { version: 1, vendors: {} };

  const r = resolveVendorQuery(store, statements, "Jason's Carousel", {});
  assert.equal(r.resolved, false);
  assert.equal(r.total, 0);
  assert.ok(r.vendorCandidates.length >= 1);
  // The Jason variants should be among the suggestions.
  assert.ok(r.vendorCandidates.some((c) => c.normalized.includes("JASON")));
});
