# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`ofxreader` is a Node.js CLI that parses **OFX 2.x (XML)** bank/credit-card
statement files and emits **deterministic JSON** for programmatic (LLM/agent)
consumption. Only OFX 2.x is supported — OFX 1.x (SGML) is intentionally
rejected with a `NOT_OFX2` error.

## Commands

Use Node ≥ 24 (`nvm use` reads `.nvmrc`). All scripts run TypeScript directly —
there is **no build step**.

```sh
npm test                      # full node:test suite (test/*.test.ts)
node --test test/cli.test.ts  # run a single test file
npm run typecheck             # tsc --noEmit — type-check only (never emits JS)
node bin/ofxreader.ts --llm   # run the CLI directly during development
npm run mcp                   # run the MCP server (stdio) during development
npm run install-cli           # symlink ofxreader -> /usr/local/bin (sudo on macOS)
```

## Native TypeScript — hard constraint

The tool runs `.ts` files directly via Node's native type-stripping (Node
≥ 22.18 / 24). `tsc` is used **only** for type-checking, never to build. Because
type-stripping erases types but does not transform runtime syntax, all code must
be **erasable-only**: no `enum`, no `namespace`, no constructor parameter
properties. `tsconfig.json` enforces this with `erasableSyntaxOnly: true`, and
relative imports must include the `.ts` extension (`allowImportingTsExtensions`,
`verbatimModuleSyntax`). If you add TypeScript that needs codegen, `npm run
typecheck` and `npm test` will both fail — keep it erasable.

## Architecture

A linear pipeline; each module has one job and is unit-tested in isolation:

```
bin/ofxreader.ts  → thin CLI entry; calls cli.run() and sets process.exitCode
bin/ofx-mcp.ts    → thin MCP entry; wires createServer() to a stdio transport
src/cli.ts        → util.parseArgs dispatch; builds filters; shapes output; maps errors→exit codes
src/mcp.ts        → MCP server: ofx_summary/ofx_accounts/ofx_transactions tools (zod schemas) + the ofx-balances resource (ofx:{+path}, dated balance report)
src/parser.ts     → reads file, sniffs OFX version, strips <?...?> PIs, XML-parses (fast-xml-parser)
src/model.ts      → normalizes the raw XML object tree into the canonical OfxDocument model
src/query.ts      → applies transaction filters (date/amount/type/text/account/limit)
src/report.ts     → summaries(), uniqueAccounts(), balances() — shared report builders (CLI + MCP)
src/dates.ts      → OFX datetime (YYYYMMDDHHMMSS[.SSS][[±tz:NAME]]) → ISO 8601
src/output.ts     → JSON emit (compact/--pretty) to stdout; error envelope to stderr
src/help.ts       → HELP_TEXT and the LLM_INSTRUCTIONS string printed by --llm
src/version.ts    → reads version from package.json (used by --version and the MCP server)
```

Data flow: `readOfxFile → parseOfx → buildDocument` produces an `OfxDocument`
(`{ statements: Statement[] }`); both the CLI (`cli.ts`) and the MCP server
(`mcp.ts`) then map/filter that model via the **shared** `report.ts` + `query.ts`
— there is one implementation of each capability, two front-ends. Keep it that
way: new capabilities go in the shared modules, not duplicated per front-end.

Runtime dependencies: `fast-xml-parser` (Node has no built-in XML parser) and
`@modelcontextprotocol/sdk` + `zod` (MCP server only). The MCP SDK accepts
`zod ^3.25 || ^4.0`; keep zod deduped to a single instance or tool schemas break.

### Conventions that matter

- **Error handling is code-driven, not exception-leaking.** `parser.ts` throws
  `OfxError(code, message)`; `cli.run()` catches it, writes the JSON error
  envelope to **stderr**, and returns the exit code. Success always goes to
  **stdout**. Preserve this stdout/stderr + exit-code contract — agents depend
  on it (see the `OUTPUT CONTRACT` section in `src/help.ts`).
- **`amount` is signed** (negative = outflow). `--type debit|credit` filters by
  sign, while the raw OFX type is preserved separately as `trnType`.
- **Parsing keeps values as strings** (`parseTagValue: false`); normalization in
  `model.ts` decides what becomes a number/date. Don't move that into parsing.
- Both bank (`STMTRS`/`BANKACCTFROM`) and credit-card (`CCSTMTRS`/`CCACCTFROM`)
  statements normalize into the same `Statement` shape; a file may contain many.

## When adding a feature

- New query filter: extend `TransactionFilters` + the `filterTransactions`
  predicate in `query.ts`, parse/validate the flag in `cli.ts` `buildFilters`,
  and document it in **both** `HELP_TEXT` and `LLM_INSTRUCTIONS` in `help.ts`.
- New output field: add it to the model type in `model.ts`, populate it during
  normalization, and update the shape documented in `help.ts`.
- Always add a fixture-backed test under `test/` (hand-written OFX 2.x fixtures
  live in `test/fixtures/`).
