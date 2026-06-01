import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { readOfxFile, parseOfx, OfxError } from "./parser.ts";
import { buildDocument } from "./model.ts";
import type { OfxDocument, Statement } from "./model.ts";
import { summaries, uniqueAccounts, balances } from "./report.ts";
import type { BalancePoint } from "./report.ts";
import { filterTransactions } from "./query.ts";
import type { TransactionFilters } from "./query.ts";
import { getVersion } from "./version.ts";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function load(path: string): OfxDocument {
  return buildDocument(parseOfx(readOfxFile(path)));
}

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function fail(err: unknown): ToolResult {
  const code = err instanceof OfxError ? err.code : "INTERNAL";
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text", text: JSON.stringify({ error: { code, message } }) }],
    isError: true,
  };
}

const PATH_FIELD = z
  .string()
  .describe("Path to an OFX 2.x (XML) file, e.g. /Users/me/statement.ofx");

/** Build the ofxreader MCP server with one tool per CLI capability. */
export function createServer(): McpServer {
  const server = new McpServer({ name: "ofxreader", version: getVersion() });

  server.registerTool(
    "ofx_summary",
    {
      title: "Summarize OFX statements",
      description:
        "Summarize each statement in an OFX 2.x (XML) bank or credit-card file: account, " +
        "currency, statement period, ledger & available balance, transaction counts, and " +
        "totals (credits, debits, net). Use this for any .ofx file.",
      inputSchema: { path: PATH_FIELD },
    },
    async ({ path }) => {
      try {
        return ok(summaries(load(path).statements));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "ofx_accounts",
    {
      title: "List OFX accounts",
      description:
        "List the accounts found in an OFX 2.x (XML) file: id, type (CHECKING, SAVINGS, " +
        "CREDITCARD, ...), bankId, and branchId.",
      inputSchema: { path: PATH_FIELD },
    },
    async ({ path }) => {
      try {
        return ok(uniqueAccounts(load(path).statements));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "ofx_transactions",
    {
      title: "Query OFX transactions",
      description:
        "Read transactions from an OFX 2.x (XML) file with optional filters: posted-date " +
        "range, signed-amount range, debit/credit direction, case-insensitive text or regex " +
        "search over name+memo+payee, single account, and a row limit. Returns " +
        "{ total, count, transactions[] } where total is the match count and count is the " +
        "number of rows returned. Use this to find or extract specific transactions.",
      inputSchema: {
        path: PATH_FIELD,
        from: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Inclusive start date, YYYY-MM-DD"),
        to: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Inclusive end date, YYYY-MM-DD"),
        min: z.number().optional().describe("Minimum signed amount (negative = money out)"),
        max: z.number().optional().describe("Maximum signed amount"),
        type: z
          .enum(["debit", "credit"])
          .optional()
          .describe("debit = amount < 0 (money out); credit = amount > 0 (money in)"),
        search: z
          .string()
          .optional()
          .describe("Case-insensitive match over name + memo + payee"),
        regex: z
          .boolean()
          .optional()
          .describe("Treat search as a JavaScript regular expression"),
        account: z.string().optional().describe("Restrict to a single account id"),
        limit: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("Maximum rows to return (total still reports all matches)"),
      },
    },
    async ({ path, regex, search, from, to, min, max, type, account, limit }) => {
      try {
        if (regex && search == null) {
          return fail(new OfxError("USAGE", "regex requires search."));
        }
        const filters: TransactionFilters = {
          from,
          to,
          min,
          max,
          type,
          account,
          limit,
          search,
          regex,
        };
        const all = load(path).statements.flatMap((s) => s.transactions);
        return ok(filterTransactions(all, filters));
      } catch (err) {
        return fail(err);
      }
    },
  );

  // Resource: statement balances for an OFX file, each stated with its as-of date.
  // Read URI: ofx:/absolute/path/to/file.ofx
  server.registerResource(
    "ofx-balances",
    new ResourceTemplate("ofx:{+path}", { list: undefined }),
    {
      title: "OFX statement balances",
      description:
        "Ledger and available balances for each account in an OFX 2.x file, each stated " +
        'with its as-of date (e.g. "Balance at 2024-03-31 is 4327.87 USD"). ' +
        "Read it with the URI ofx:/absolute/path/to/file.ofx",
      mimeType: "text/plain",
    },
    async (uri, variables) => {
      const rawPath = Array.isArray(variables.path) ? variables.path[0] : variables.path;
      const path = decodeURIComponent(rawPath ?? "");
      const doc = load(path); // throws OfxError -> surfaced as a read error
      return {
        contents: [{ uri: uri.href, mimeType: "text/plain", text: formatBalances(doc.statements) }],
      };
    },
  );

  return server;
}

/** Human-readable balance report: one block per statement, each balance dated. */
function formatBalances(statements: Statement[]): string {
  const accounts = balances(statements);
  if (accounts.length === 0) return "No statements found in this OFX file.";

  return accounts
    .map((a) => {
      const cur = a.currency ? ` ${a.currency}` : "";
      const header = `Account ${a.account} — ${a.accountType}${a.currency ? ` (${a.currency})` : ""}`;
      const lines = [header];
      if (a.ledger) lines.push(`  ${balanceLine("Balance", a.ledger, cur)}`);
      if (a.available) lines.push(`  ${balanceLine("Available balance", a.available, cur)}`);
      if (!a.ledger && !a.available) lines.push("  No balance reported.");
      return lines.join("\n");
    })
    .join("\n\n");
}

function balanceLine(label: string, point: BalancePoint, currency: string): string {
  const amount = Number.isFinite(point.amount) ? point.amount.toFixed(2) : "unknown";
  return point.date != null
    ? `${label} at ${point.date} is ${amount}${currency}`
    : `${label} is ${amount}${currency} (as-of date unknown)`;
}
