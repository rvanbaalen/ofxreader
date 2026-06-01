import { parseArgs } from "node:util";

import { readOfxFile, parseOfx, OfxError } from "./parser.ts";
import { buildDocument } from "./model.ts";
import { filterTransactions } from "./query.ts";
import type { TransactionFilters } from "./query.ts";
import { summaries, uniqueAccounts } from "./report.ts";
import { emit, emitError } from "./output.ts";
import { HELP_TEXT, LLM_INSTRUCTIONS } from "./help.ts";
import { getVersion } from "./version.ts";

const COMMANDS = ["summary", "accounts", "transactions"] as const;

const OPTIONS = {
  from: { type: "string" },
  to: { type: "string" },
  min: { type: "string" },
  max: { type: "string" },
  type: { type: "string" },
  search: { type: "string" },
  regex: { type: "boolean" },
  account: { type: "string" },
  limit: { type: "string" },
  pretty: { type: "boolean" },
  llm: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const;

/** Run the CLI. Returns the process exit code. */
export function run(argv: string[]): number {
  let values: Record<string, string | boolean | undefined>;
  let positionals: string[];
  try {
    const parsed = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (err) {
    emitError("USAGE", (err as Error).message);
    return 2;
  }

  const pretty = values.pretty === true;

  if (values.version === true) {
    process.stdout.write(getVersion() + "\n");
    return 0;
  }
  if (values.llm === true) {
    process.stdout.write(LLM_INSTRUCTIONS + "\n");
    return 0;
  }
  if (values.help === true) {
    process.stdout.write(HELP_TEXT + "\n");
    return 0;
  }

  const command = positionals[0];
  if (command == null) {
    process.stderr.write(HELP_TEXT + "\n");
    return 2;
  }
  if (!(COMMANDS as readonly string[]).includes(command)) {
    emitError(
      "USAGE",
      `Unknown command "${command}". Expected: ${COMMANDS.join(" | ")}. Run --llm for help.`,
    );
    return 2;
  }

  const file = positionals[1];
  if (file == null) {
    emitError("USAGE", `Missing file argument. Usage: ofxreader ${command} <file.ofx>`);
    return 2;
  }

  try {
    const doc = buildDocument(parseOfx(readOfxFile(file)));

    if (command === "summary") {
      emit(summaries(doc.statements), pretty);
    } else if (command === "accounts") {
      emit(uniqueAccounts(doc.statements), pretty);
    } else {
      const filters = buildFilters(values);
      const all = doc.statements.flatMap((s) => s.transactions);
      emit(filterTransactions(all, filters), pretty);
    }
    return 0;
  } catch (err) {
    if (err instanceof OfxError) {
      emitError(err.code, err.message);
      return err.code === "USAGE" ? 2 : 1;
    }
    emitError("INTERNAL", (err as Error).message);
    return 1;
  }
}

function buildFilters(values: Record<string, string | boolean | undefined>): TransactionFilters {
  const f: TransactionFilters = {};

  if (typeof values.from === "string") f.from = checkDate(values.from, "--from");
  if (typeof values.to === "string") f.to = checkDate(values.to, "--to");
  if (typeof values.min === "string") f.min = parseNum(values.min, "--min");
  if (typeof values.max === "string") f.max = parseNum(values.max, "--max");

  if (typeof values.type === "string") {
    if (values.type !== "debit" && values.type !== "credit") {
      throw new OfxError("USAGE", `--type must be "debit" or "credit", got "${values.type}".`);
    }
    f.type = values.type;
  }

  if (typeof values.search === "string") f.search = values.search;
  if (values.regex === true) f.regex = true;
  if (typeof values.account === "string") f.account = values.account;

  if (typeof values.limit === "string") {
    const n = parseNum(values.limit, "--limit");
    if (!Number.isInteger(n) || n < 0) {
      throw new OfxError("USAGE", `--limit must be a non-negative integer, got "${values.limit}".`);
    }
    f.limit = n;
  }

  if (f.regex && f.search == null) {
    throw new OfxError("USAGE", "--regex requires --search.");
  }
  return f;
}

function parseNum(value: string, flag: string): number {
  const n = Number(value);
  if (Number.isNaN(n)) throw new OfxError("USAGE", `${flag} must be a number, got "${value}".`);
  return n;
}

function checkDate(value: string, flag: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new OfxError("USAGE", `${flag} must be YYYY-MM-DD, got "${value}".`);
  }
  return value;
}
