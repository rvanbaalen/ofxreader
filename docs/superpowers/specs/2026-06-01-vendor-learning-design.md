# Vendor learning (vendor aliasing) for ofxreader

**Date:** 2026-06-01
**Status:** Approved design — pending implementation plan

## Purpose

Let an end user ask natural questions like *"what did I spend at Jason's Carousel
in April"* and have ofxreader find exactly the right transactions — even though OFX
descriptors are noisy and rarely match the brand name (`SQ *JASONS CARO 0123`,
`TST* JASONSCAROUSEL`, brand vs. legal entity, store numbers, locations).

The tool keeps a persistent **vendor alias store** mapping a canonical vendor name to
the raw descriptors that belong to it. When a descriptor is ambiguous, the agent
(Claude) asks the user for clarification and persists the confirmed mapping so future
queries are deterministic.

## Goals

- Persistent, deterministic vendor → descriptor mappings, learned over time.
- A query by canonical vendor name returns **only confirmed** matches (high precision).
- The same query surfaces **fuzzy candidates** (unconfirmed descriptors) so the agent
  can propose them and, on confirmation, persist them.
- Works from both the MCP server and the CLI (one engine, two front-ends).

## Non-goals (YAGNI for v1)

- No auto-learning without explicit confirmation.
- No `vendor-forget`/delete tool (can be added later).
- No multi-user/concurrent-writer locking (single-user tool).

## 1. Store

Hybrid model: **ofxreader owns the authoritative store**; Claude's memory may hold a
pointer to it but never the source of truth.

- Location: `$XDG_CONFIG_HOME/ofxreader/vendors.json`, falling back to
  `~/.config/ofxreader/vendors.json`. Overridable via env `OFXREADER_VENDORS`
  (used by tests and power users).
- Format:

```json
{
  "version": 1,
  "vendors": {
    "Jason's Carousel": {
      "signatures": ["JASONS CARO"],
      "raw": ["SQ *JASONS CARO 0123", "TST* JASONSCAROUSEL"],
      "updatedAt": "2026-06-01"
    }
  }
}
```

- `signatures`: normalized, confirmed cores used for deterministic matching.
- `raw`: the original confirmed descriptors, kept for provenance/debugging.
- Canonical key: the human display name, matched case-insensitively on lookup.

## 2. Normalization & matching

- `normalizeDescriptor(s)`: uppercase → strip payment-processor prefixes
  (`SQ *`, `TST*`, `PAYPAL *`, `SP *`, `POS`, `CHECKCARD`, `PURCHASE`, …) → remove
  store numbers / long digit runs and punctuation → collapse whitespace → trim.
  Example: `"SQ *JASONS CARO 0123"` → `"JASONS CARO"`.
- **Confirmed match (counts as a result):** a transaction matches vendor V when any
  `signature` of V is a substring of the normalized descriptor built from
  `name + memo + payee`. Deterministic and precise.
- **Fuzzy (suggestion only):** in-house Sørensen–Dice similarity over character
  bigrams (no new dependency) between the query name / V's signatures and the
  remaining, not-yet-confirmed descriptors in the file. Suggestion threshold ≈ 0.6.
  Fuzzy results are **never** silently counted as matches.

## 3. Query & learning flow (single call)

`ofx_transactions(..., vendor: "Jason's Carousel")` returns:

```jsonc
{
  "total": N,
  "count": N,
  "transactions": [ /* CONFIRMED matches only, after the usual from/to/amount filters */ ],
  "vendorCandidates": [
    { "normalized": "JASON CAROUSEL LLC", "examples": ["JASON CAROUSEL LLC 99"], "count": 2, "similarity": 0.71 }
  ]
}
```

- Unknown vendor (empty store): `transactions: []` + candidates ranked against the
  query name, so a brand-new vendor can be bootstrapped. Agent proposes candidates →
  user confirms → `ofx_vendor_learn` → re-query is deterministic.
- Date scope ("in April") reuses the existing `--from`/`--to` filters; no new date
  logic. Vendor resolution is an additional predicate; existing amount/date filters
  still apply.

## 4. Tool & CLI surface

MCP:
- `ofx_transactions` gains an optional `vendor` string parameter. With it, the result
  includes the confirmed `transactions` plus `vendorCandidates`. Without it, behavior
  is unchanged.
- `ofx_vendor_learn(vendor, descriptors[])`: normalizes the confirmed raw descriptors
  into signatures, stores them (creating the vendor if new), persists, returns the
  updated vendor.
- `ofx_vendors()`: lists known vendors with their signatures/raw.

CLI (parity):
- `ofxreader transactions <file> --vendor "Jason's Carousel" [--from … --to …]`
- `ofxreader vendors`
- `ofxreader vendor-learn "Jason's Carousel" "<raw descriptor>" ["<raw2>" …]`

## 5. Architecture (small, isolated modules)

```
src/vendors/
  store.ts       # path resolution (env/XDG), load/save vendors.json, store types
  normalize.ts   # normalizeDescriptor()
  match.ts       # diceSimilarity(), confirmedMatch(), rankCandidates()
  resolve.ts     # resolveVendorQuery(store, statements, vendor, filters) -> { transactions, candidates }
```

`resolve.ts` reuses `query.ts` for date/amount filtering; `mcp.ts` and `cli.ts` only
wire these together. All code stays erasable-only TypeScript (Node native type-strip).

## 6. Data flow

1. `mcp.ts`/`cli.ts` loads the store (`store.load()`), parses the OFX file
   (`parser` → `model`).
2. `resolve.resolveVendorQuery()` resolves the canonical vendor → signatures,
   computes confirmed matches via `match.confirmedMatch()`, applies the existing
   `query.filterTransactions()` (date/amount/limit) to those, and ranks the remaining
   descriptors with `match.rankCandidates()`.
3. Result `{ transactions, vendorCandidates }` is emitted as JSON (CLI) or tool result (MCP).
4. `ofx_vendor_learn` / `vendor-learn` normalizes descriptors → updates store →
   `store.save()`.

## 7. Error handling

- Missing store file = empty store (no error). The first `learn` creates the file and
  parent directory.
- Corrupt store JSON → `OfxError("VENDOR_STORE_ERROR", …)`; never silently overwrite.
- Read-modify-write per learn (single-user; acceptable, documented).
- Same stdout/stderr + exit-code and MCP error contract as the rest of the tool.

## 8. Testing

- `normalize.test`: prefix stripping, digit/punctuation removal, whitespace.
- `match.test`: Dice similarity ordering; `confirmedMatch` substring behavior;
  `rankCandidates` returns expected ranked candidates above threshold.
- `store.test`: missing file → empty store; save+load roundtrip via a temp
  `OFXREADER_VENDORS` path.
- `resolve.test`: with a seeded store + fixture, vendor query returns the confirmed
  transactions and the expected candidates.
- CLI/MCP integration: `--vendor`, `vendors`, `vendor-learn` and the `vendor` tool
  param / `ofx_vendor_learn` / `ofx_vendors`, all against a new messy fixture
  `test/fixtures/vendors.ofx` and a temp store path.

## 9. Privacy

Vendor names and descriptors are stored locally only (the user's machine); nothing is
transmitted.
