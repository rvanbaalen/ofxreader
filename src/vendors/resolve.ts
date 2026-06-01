import type { Statement } from "../model.ts";
import { filterTransactions } from "../query.ts";
import type { TransactionFilters, QueryResult } from "../query.ts";
import { confirmedMatch, rankCandidates } from "./match.ts";
import type { Candidate } from "./match.ts";
import { normalizeDescriptor } from "./normalize.ts";
import { findVendorKey } from "./store.ts";
import type { VendorStore } from "./store.ts";

const SUGGEST_THRESHOLD = 0.6;

export type VendorQueryResult = QueryResult & {
  vendor: string; // canonical name (resolved key, or the query verbatim)
  resolved: boolean; // was the vendor found in the store?
  vendorCandidates: Candidate[]; // fuzzy, unconfirmed descriptors to propose
};

/**
 * Resolve a vendor query: confirmed matches become the result (after the usual
 * date/amount filters); the remaining descriptors are ranked as fuzzy candidates.
 */
export function resolveVendorQuery(
  store: VendorStore,
  statements: Statement[],
  vendor: string,
  filters: TransactionFilters,
): VendorQueryResult {
  const all = statements.flatMap((s) => s.transactions);
  const key = findVendorKey(store, vendor);
  const signatures = key != null ? (store.vendors[key]?.signatures ?? []) : [];

  const confirmed = all.filter((t) => confirmedMatch(t, signatures));
  const confirmedSet = new Set(confirmed);
  const result = filterTransactions(confirmed, filters);

  const remaining = all.filter((t) => !confirmedSet.has(t));
  const queryTerms = [normalizeDescriptor(vendor), ...signatures];
  const vendorCandidates = rankCandidates(remaining, queryTerms, SUGGEST_THRESHOLD);

  return { ...result, vendor: key ?? vendor, resolved: key != null, vendorCandidates };
}
