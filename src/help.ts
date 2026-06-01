export const HELP_TEXT = `ofxreader — read & query OFX 2.x (XML) files. JSON in, JSON out.

USAGE
  ofxreader <command> <file.ofx> [options]
  ofxreader --llm        # full machine-readable usage guide (for LLMs/agents)
  ofxreader --version
  ofxreader --help

COMMANDS
  summary <file>        Per-statement overview (account, period, balances, totals)
  accounts <file>       Accounts found in the file
  transactions <file>   Transactions, with optional filters

TRANSACTION FILTERS
  --from YYYY-MM-DD  --to YYYY-MM-DD   posted-date range (inclusive)
  --min N            --max N           signed-amount range (e.g. --min=-100)
  --type debit|credit                  debit = money out, credit = money in
  --search TEXT      --regex           match name + memo + payee
  --account ACCTID                     restrict to one account
  --limit N                            cap rows returned

GLOBAL
  --pretty                             indent JSON (default: compact)

Run "ofxreader --llm" for output shapes, exit codes, and examples.`;

export const LLM_INSTRUCTIONS = `ofxreader — instructions for LLM/agent use
==========================================

PURPOSE
  Parse a bank or credit-card OFX 2.x (XML) export and return structured JSON for
  accounts, balances, statement periods, and transactions — optionally filtered.
  Output is deterministic JSON on stdout, so you can parse it directly.

INVOCATION
  ofxreader <command> <file.ofx> [options]

COMMANDS
  summary <file>
      Per-statement overview. Returns a JSON array, one object per statement:
        {
          "account":   { "id", "type", "bankId", "branchId" },
          "currency":  "USD" | null,
          "period":    { "start": ISO8601|null, "end": ISO8601|null },
          "balance":   { "amount": number, "asOf": ISO8601|null } | null,
          "available": { "amount": number, "asOf": ISO8601|null } | null,
          "counts":    { "transactions": int, "credits": int, "debits": int },
          "totals":    { "credits": number, "debits": number, "net": number }
        }

  accounts <file>
      JSON array of the accounts in the file:
        { "id", "type", "bankId", "branchId" }

  transactions <file> [filters]
      JSON object:
        { "total": int, "count": int, "transactions": [ Transaction, ... ] }
      "total" = matches found; "count" = rows returned (differs when --limit is set).
      Transaction:
        {
          "account": acctid, "id": fitid, "date": ISO8601|null,
          "amount": number,           // signed; negative = money out
          "trnType": "DEBIT"|"CREDIT"|"CHECK"|"POS"|"FEE"|...,  // raw OFX type
          "name": string, "memo": string|null,
          "payee": string|null, "checkNumber": string|null
        }

TRANSACTION FILTERS (transactions command only; all optional, all combinable)
  --from YYYY-MM-DD    posted on/after this date (inclusive)
  --to   YYYY-MM-DD    posted on/before this date (inclusive)
  --min  N             signed amount >= N   (use = for negatives, e.g. --min=-100)
  --max  N             signed amount <= N   (e.g. --max=-0.01 for outflows only)
  --type debit|credit  debit = amount < 0 (money out); credit = amount > 0 (money in)
  --search TEXT        case-insensitive substring over name + memo + payee
  --regex              treat --search as a JavaScript regular expression
  --account ACCTID     restrict to a single account (id from "accounts"/"summary")
  --limit N            return at most N rows ("total" still reports all matches)

GLOBAL OPTIONS
  --pretty             indent JSON for humans (default is compact, token-efficient)
  --llm                print this guide
  --version            print version
  --help               print short usage

OUTPUT CONTRACT
  Success: JSON on stdout, exit code 0.
  Failure: JSON on stderr as {"error":{"code","message"}}, non-zero exit code.
    USAGE          (exit 2)  bad/unknown arguments or missing file
    FILE_NOT_FOUND (exit 1)  path does not exist
    READ_ERROR     (exit 1)  path unreadable / is a directory
    NOT_OFX2       (exit 1)  not an OFX 2.x XML file (OFX 1.x SGML is rejected)
    PARSE_ERROR    (exit 1)  malformed XML / no <OFX> root
  Notes: amounts are signed numbers; dates are ISO 8601 strings; flags accept
  both "--flag value" and "--flag=value" (use the "=" form for negative numbers).

EXAMPLES
  ofxreader summary statement.ofx
  ofxreader accounts statement.ofx --pretty
  ofxreader transactions statement.ofx --from 2024-01-01 --to 2024-03-31
  ofxreader transactions statement.ofx --type debit --search amazon
  ofxreader transactions statement.ofx --min=-50 --max=-0.01        # small outflows
  ofxreader transactions statement.ofx --search "^ACME" --regex --limit 50
  ofxreader transactions statement.ofx --account 1234567890`;
