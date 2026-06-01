import type { Transaction } from "./model.ts";

export type TransactionFilters = {
  from?: string; // YYYY-MM-DD inclusive lower bound on posted date
  to?: string; // YYYY-MM-DD inclusive upper bound
  min?: number; // signed amount >=
  max?: number; // signed amount <=
  type?: "debit" | "credit"; // debit: amount < 0, credit: amount > 0
  search?: string; // matched against name + memo + payee
  regex?: boolean; // treat search as a RegExp
  account?: string; // restrict to one ACCTID
  limit?: number; // cap returned rows (matches still counted in `total`)
};

export type QueryResult = {
  total: number; // matches before --limit
  count: number; // rows returned after --limit
  transactions: Transaction[];
};

export function filterTransactions(
  txns: Transaction[],
  filters: TransactionFilters,
): QueryResult {
  const matcher = buildMatcher(filters);

  const matched = txns.filter((t) => {
    if (filters.account != null && t.account !== filters.account) return false;

    const date = t.date == null ? null : t.date.slice(0, 10);
    if (filters.from != null && (date == null || date < filters.from)) return false;
    if (filters.to != null && (date == null || date > filters.to)) return false;

    if (filters.min != null && !(t.amount >= filters.min)) return false;
    if (filters.max != null && !(t.amount <= filters.max)) return false;

    if (filters.type === "debit" && !(t.amount < 0)) return false;
    if (filters.type === "credit" && !(t.amount > 0)) return false;

    if (matcher != null) {
      const haystack = `${t.name} ${t.memo ?? ""} ${t.payee ?? ""}`;
      if (!matcher.test(haystack)) return false;
    }
    return true;
  });

  const transactions =
    filters.limit != null ? matched.slice(0, filters.limit) : matched;

  return { total: matched.length, count: transactions.length, transactions };
}

function buildMatcher(filters: TransactionFilters): RegExp | null {
  if (filters.search == null || filters.search === "") return null;
  const source = filters.regex ? filters.search : escapeRegExp(filters.search);
  return new RegExp(source, "i");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
