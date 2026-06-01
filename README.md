# ofxreader

[![release-please](https://github.com/rvanbaalen/ofxreader/actions/workflows/release-please.yml/badge.svg)](https://github.com/rvanbaalen/ofxreader/actions/workflows/release-please.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

A command-line tool **and MCP server** for reading and querying **OFX 2.x (XML)**
financial files (bank and credit-card statement exports). Built for LLM/agent
use: deterministic JSON output, composable filters, structured errors, and a
self-documenting `--llm` mode.

> Package name: **`@rvanbaalen/ofxreader`** — published to GitHub Packages.

## Requirements

- **Node.js ≥ 24** (uses native TypeScript type-stripping — no build step).
  Works on Node ≥ 22.18 too. An `.nvmrc` pins the project to Node 24: `nvm use`.

## Install

### From GitHub Packages

The package is published to GitHub Packages as `@rvanbaalen/ofxreader`. Point the
`@rvanbaalen` scope at the GitHub registry and authenticate with a token that has
the `read:packages` scope (GitHub Packages requires auth even for public
packages):

```sh
# ~/.npmrc
@rvanbaalen:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

```sh
npm install -g @rvanbaalen/ofxreader   # installs the `ofxreader` and `ofx-mcp` bins
ofxreader --llm
```

### From source

```sh
git clone https://github.com/rvanbaalen/ofxreader.git
cd ofxreader
nvm use                     # Node 24 (see .nvmrc)
npm install                 # deps: fast-xml-parser, MCP SDK, zod

# Symlink `ofxreader` into /usr/local/bin so you can run it anywhere.
# /usr/local/bin usually needs sudo on macOS:
sudo npm run install-cli

# ...or install into a writable directory of your choice:
OFXREADER_BIN_DIR="$HOME/.local/bin" npm run install-cli

npm run uninstall-cli       # remove the symlink
```

Without installing, run it directly: `node bin/ofxreader.ts <command> <file>`.

## Usage

```sh
ofxreader <command> <file.ofx> [options]
ofxreader --llm            # full machine-readable usage guide (for LLMs/agents)
ofxreader --help           # short usage
ofxreader --version
```

### Commands

| Command                | Output |
|------------------------|--------|
| `summary <file>`       | JSON array — one object per statement: account, currency, statement period, ledger & available balance, transaction counts, and totals (credits / debits / net). |
| `accounts <file>`      | JSON array of accounts (`id`, `type`, `bankId`, `branchId`). |
| `transactions <file>`  | `{ total, count, transactions: [...] }` — `total` is matches found, `count` is rows returned (differs when `--limit` is set). |
| `vendors`              | List learned vendor aliases (no file argument). |
| `vendor-learn "<vendor>" "<descriptor>" […]` | Teach raw descriptors for a vendor (no file argument). |

### Transaction filters

| Flag | Meaning |
|------|---------|
| `--from YYYY-MM-DD` / `--to YYYY-MM-DD` | Posted-date range (inclusive). |
| `--min N` / `--max N` | Signed-amount range. Use the `=` form for negatives: `--min=-100`. |
| `--type debit\|credit` | `debit` = amount < 0 (money out); `credit` = amount > 0 (money in). |
| `--search TEXT` | Case-insensitive match over name + memo + payee. |
| `--regex` | Treat `--search` as a JavaScript regular expression. |
| `--account ACCTID` | Restrict to one account. |
| `--vendor "Name"` | Resolve a learned vendor alias. Result holds only confirmed matches, plus a `vendorCandidates` list (fuzzy, unconfirmed) to learn from. See [Vendor learning](#vendor-learning). |
| `--limit N` | Return at most N rows. |
| `--pretty` | Indent JSON (default is compact). |

### Examples

```sh
ofxreader summary statement.ofx --pretty
ofxreader transactions statement.ofx --from 2024-01-01 --to 2024-03-31
ofxreader transactions statement.ofx --type debit --search amazon
ofxreader transactions statement.ofx --search "^ACME" --regex --limit 50
```

### Output contract

- **Success** → JSON on **stdout**, exit `0`.
- **Failure** → `{"error":{"code","message"}}` on **stderr**, non-zero exit.
  Codes: `USAGE` (2), `FILE_NOT_FOUND` (1), `READ_ERROR` (1),
  `NOT_OFX2` (1 — OFX 1.x SGML is rejected), `PARSE_ERROR` (1).

Amounts are signed numbers; dates are ISO 8601 strings.

## Vendor learning

OFX descriptors are noisy and rarely equal the brand name (`SQ *JASONS CARO 0123`,
`TST* JASONSCAROUSEL`). ofxreader keeps a local **vendor alias store** mapping a
canonical vendor name to the descriptors that belong to it, so a question like
*"what did I spend at Jason's Carousel in April"* resolves to exactly the right records.

- A `--vendor` query returns **only confirmed** matches, plus a `vendorCandidates` list
  (fuzzy, unconfirmed descriptors) ranked by similarity.
- Confirm a candidate with the user, persist it, and future queries are deterministic.

```sh
# 1. Ask — confirmed matches + candidates to confirm
ofxreader transactions statement.ofx --vendor "Jason's Carousel" --from 2024-04-01 --to 2024-04-30

# 2. Teach the confirmed descriptors
ofxreader vendor-learn "Jason's Carousel" "SQ *JASONS CARO 0123" "TST* JASONSCAROUSEL"

# 3. Re-run step 1 — now deterministic
```

The store lives at `$OFXREADER_VENDORS`, else `$XDG_CONFIG_HOME/ofxreader/vendors.json`
(fallback `~/.config/ofxreader/vendors.json`). It is the source of truth; nothing is
sent anywhere.

## Use as an MCP server

The same parser is exposed as a local [Model Context Protocol](https://modelcontextprotocol.io)
server (stdio transport) so Claude can work with OFX files directly. It registers
these tools covering every CLI capability:

| Tool | Input | Returns |
|------|-------|---------|
| `ofx_summary` | `path` | per-statement summaries |
| `ofx_accounts` | `path` | account list |
| `ofx_transactions` | `path` + filters (`from`, `to`, `min`, `max`, `type`, `search`, `regex`, `account`, `limit`, `vendor`) | `{ total, count, transactions[] }` (plus `vendorCandidates` when `vendor` is set) |
| `ofx_vendor_learn` | `vendor`, `descriptors[]` | the updated vendor entry |
| `ofx_vendors` | — | learned vendor aliases |

It also exposes one **resource** template:

| Resource | URI | Returns |
|----------|-----|---------|
| `ofx-balances` | `ofx:/absolute/path/to/file.ofx` | Ledger & available balance per account, each stated with its as-of date — e.g. `Balance at 2024-03-31 is 4327.87 USD` |

Run it directly with `npm run mcp` (or `node bin/ofx-mcp.ts`).

### Claude Desktop

Add it to `~/Library/Application Support/Claude/claude_desktop_config.json`, then
restart Claude Desktop. Use an **absolute** path to a Node ≥ 24 binary — the
desktop app launches with a minimal PATH that won't include an nvm-managed `node`:

```json
{
  "mcpServers": {
    "ofxreader": {
      "command": "/Users/robin/.nvm/versions/node/v24.13.1/bin/node",
      "args": ["/Users/robin/Sites/projects/ofxreader/bin/ofx-mcp.ts"]
    }
  }
}
```

### Claude Code

```sh
claude mcp add ofxreader -- /Users/robin/.nvm/versions/node/v24.13.1/bin/node \
  /Users/robin/Sites/projects/ofxreader/bin/ofx-mcp.ts
```

## Development

```sh
npm test          # node:test suite (runs .ts directly)
npm run typecheck # tsc --noEmit (type-check only; never emits)
```
