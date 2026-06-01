import type { Account, Money, Statement } from "./model.ts";

export type Summary = {
  account: Account;
  currency: string | null;
  period: { start: string | null; end: string | null };
  balance: Money | null;
  available: Money | null;
  counts: { transactions: number; credits: number; debits: number };
  totals: { credits: number; debits: number; net: number };
};

/** One summary object per statement. */
export function summaries(statements: Statement[]): Summary[] {
  return statements.map(summarize);
}

/** Accounts across all statements, deduplicated by type + id. */
export function uniqueAccounts(statements: Statement[]): Account[] {
  const seen = new Map<string, Account>();
  for (const s of statements) {
    const key = `${s.account.type}:${s.account.id}`;
    if (!seen.has(key)) seen.set(key, s.account);
  }
  return [...seen.values()];
}

function summarize(stmt: Statement): Summary {
  let credits = 0;
  let debits = 0;
  let creditSum = 0;
  let debitSum = 0;
  for (const t of stmt.transactions) {
    if (t.amount > 0) {
      credits++;
      creditSum += t.amount;
    } else if (t.amount < 0) {
      debits++;
      debitSum += t.amount;
    }
  }
  return {
    account: stmt.account,
    currency: stmt.currency,
    period: stmt.period,
    balance: stmt.balance,
    available: stmt.available,
    counts: { transactions: stmt.transactions.length, credits, debits },
    totals: {
      credits: round2(creditSum),
      debits: round2(debitSum),
      net: round2(creditSum + debitSum),
    },
  };
}

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type BalancePoint = {
  amount: number;
  asOf: string | null; // full ISO 8601 timestamp from DTASOF
  date: string | null; // the as-of date only (YYYY-MM-DD)
};

export type AccountBalances = {
  account: string;
  accountType: string;
  currency: string | null;
  ledger: BalancePoint | null; // LEDGERBAL
  available: BalancePoint | null; // AVAILBAL
};

/** Ledger and available balances per statement, each carrying its as-of date. */
export function balances(statements: Statement[]): AccountBalances[] {
  return statements.map((s) => ({
    account: s.account.id,
    accountType: s.account.type,
    currency: s.currency,
    ledger: toPoint(s.balance),
    available: toPoint(s.available),
  }));
}

function toPoint(b: Money | null): BalancePoint | null {
  if (b == null) return null;
  return { amount: b.amount, asOf: b.asOf, date: b.asOf == null ? null : b.asOf.slice(0, 10) };
}
