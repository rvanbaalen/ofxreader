import { test } from "node:test";
import assert from "node:assert/strict";
import { filterTransactions } from "../src/query.ts";
import type { Transaction } from "../src/model.ts";

function tx(over: Partial<Transaction>): Transaction {
  return {
    account: "A1",
    id: "x",
    date: "2024-02-15",
    amount: -10,
    trnType: "DEBIT",
    name: "",
    memo: null,
    payee: null,
    checkNumber: null,
    ...over,
  };
}

const txns: Transaction[] = [
  tx({ id: "1", date: "2024-01-10", amount: -52.13, name: "AMAZON MARKETPLACE", memo: "Order" }),
  tx({ id: "2", date: "2024-02-01", amount: 2500, name: "ACME CORP PAYROLL", memo: "deposit" }),
  tx({ id: "3", date: "2024-03-10", amount: -120, name: "Check 1042", checkNumber: "1042" }),
  tx({ id: "4", date: "2024-03-28", amount: -8.75, name: "STARBUCKS", memo: "Coffee", account: "A2" }),
];

const ids = (r: { transactions: Transaction[] }) => r.transactions.map((t) => t.id);

test("no filters returns everything", () => {
  const r = filterTransactions(txns, {});
  assert.equal(r.total, 4);
  assert.equal(r.count, 4);
});

test("inclusive date range", () => {
  const r = filterTransactions(txns, { from: "2024-02-01", to: "2024-03-15" });
  assert.deepEqual(ids(r), ["2", "3"]);
});

test("min on signed amount", () => {
  const r = filterTransactions(txns, { min: 0 });
  assert.deepEqual(ids(r), ["2"]);
});

test("max on signed amount (negatives)", () => {
  const r = filterTransactions(txns, { max: -50 });
  assert.deepEqual(ids(r), ["1", "3"]);
});

test("type debit / credit by sign", () => {
  assert.deepEqual(ids(filterTransactions(txns, { type: "debit" })), ["1", "3", "4"]);
  assert.deepEqual(ids(filterTransactions(txns, { type: "credit" })), ["2"]);
});

test("case-insensitive substring search", () => {
  assert.deepEqual(ids(filterTransactions(txns, { search: "amazon" })), ["1"]);
  assert.deepEqual(ids(filterTransactions(txns, { search: "coffee" })), ["4"]);
});

test("regex search", () => {
  assert.deepEqual(ids(filterTransactions(txns, { search: "^ACME", regex: true })), ["2"]);
});

test("account filter", () => {
  assert.deepEqual(ids(filterTransactions(txns, { account: "A2" })), ["4"]);
});

test("limit caps rows but total counts all matches", () => {
  const r = filterTransactions(txns, { type: "debit", limit: 2 });
  assert.equal(r.total, 3);
  assert.equal(r.count, 2);
  assert.deepEqual(ids(r), ["1", "3"]);
});

test("filters combine", () => {
  const r = filterTransactions(txns, { type: "debit", from: "2024-03-01", search: "starbucks" });
  assert.deepEqual(ids(r), ["4"]);
});
