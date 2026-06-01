import type { Transaction } from "../model.ts";
import { normalizeDescriptor } from "./normalize.ts";

export type Candidate = {
  normalized: string;
  examples: string[]; // up to 3 raw descriptors that normalized to this
  count: number; // how many transactions share this normalized descriptor
  similarity: number; // Dice similarity to the query (0..1, 2 decimals)
};

/** The raw descriptor we treat as the vendor identity: name + memo + payee. */
export function descriptorOf(t: Transaction): string {
  return [t.name, t.memo, t.payee].filter((x) => x != null && x !== "").join(" ");
}

/** Confirmed match: a stored signature is a substring of the normalized descriptor. */
export function confirmedMatch(t: Transaction, signatures: string[]): boolean {
  if (signatures.length === 0) return false;
  const norm = normalizeDescriptor(descriptorOf(t));
  return signatures.some((sig) => sig !== "" && norm.includes(sig));
}

/** Sørensen–Dice similarity over character bigrams (0..1). No dependency. */
export function diceSimilarity(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 || B.size === 0) return a === b ? 1 : 0;
  let intersection = 0;
  for (const [gram, countA] of A) {
    const countB = B.get(gram);
    if (countB != null) intersection += Math.min(countA, countB);
  }
  return (2 * intersection) / (sum(A) + sum(B));
}

/**
 * Rank distinct normalized descriptors among `transactions` by their best Dice
 * similarity to any of `queryTerms`, keeping those at or above `threshold`.
 */
export function rankCandidates(
  transactions: Transaction[],
  queryTerms: string[],
  threshold: number,
  limit = 10,
): Candidate[] {
  const groups = new Map<string, { examples: Set<string>; count: number }>();
  for (const t of transactions) {
    const raw = descriptorOf(t);
    const norm = normalizeDescriptor(raw);
    if (norm === "") continue;
    const g = groups.get(norm) ?? { examples: new Set<string>(), count: 0 };
    if (raw !== "" && g.examples.size < 3) g.examples.add(raw);
    g.count += 1;
    groups.set(norm, g);
  }

  const terms = queryTerms.filter((x) => x !== "");
  const out: Candidate[] = [];
  for (const [norm, g] of groups) {
    let sim = 0;
    for (const term of terms) sim = Math.max(sim, diceSimilarity(norm, term));
    if (sim >= threshold) {
      out.push({ normalized: norm, examples: [...g.examples], count: g.count, similarity: round2(sim) });
    }
  }
  out.sort((a, b) => b.similarity - a.similarity || b.count - a.count);
  return out.slice(0, limit);
}

function bigrams(s: string): Map<string, number> {
  const t = s.replace(/\s+/g, " ").trim();
  const m = new Map<string, number>();
  for (let i = 0; i < t.length - 1; i++) {
    const gram = t.slice(i, i + 2);
    m.set(gram, (m.get(gram) ?? 0) + 1);
  }
  return m;
}

function sum(m: Map<string, number>): number {
  let n = 0;
  for (const v of m.values()) n += v;
  return n;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
