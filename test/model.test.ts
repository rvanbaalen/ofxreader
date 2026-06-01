import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readOfxFile, parseOfx, OfxError } from "../src/parser.ts";
import { buildDocument } from "../src/model.ts";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const doc = (name: string) => buildDocument(parseOfx(readOfxFile(join(FIX, name))));

test("bank statement normalizes account, balances, period and transactions", () => {
  const { statements } = doc("bank.ofx");
  assert.equal(statements.length, 1);
  const s = statements[0]!;

  assert.deepEqual(s.account, {
    id: "1234567890",
    type: "CHECKING",
    bankId: "121000248",
    branchId: null,
  });
  assert.equal(s.currency, "USD");
  assert.equal(s.balance?.amount, 4327.87);
  assert.equal(s.available?.amount, 4200);
  assert.equal(s.period.start, "2024-01-01T00:00:00.000-05:00");
  assert.equal(s.transactions.length, 4);

  const first = s.transactions[0]!;
  assert.equal(first.amount, -52.13);
  assert.equal(first.trnType, "DEBIT");
  assert.equal(first.name, "AMAZON MARKETPLACE");
  assert.equal(first.memo, "Order #123-456");
  assert.equal(first.date?.slice(0, 10), "2024-01-15");

  const check = s.transactions[2]!;
  assert.equal(check.checkNumber, "1042");
});

test("credit-card statement uses CREDITCARD type and null available balance", () => {
  const { statements } = doc("creditcard.ofx");
  assert.equal(statements.length, 1);
  const s = statements[0]!;
  assert.equal(s.account.type, "CREDITCARD");
  assert.equal(s.account.id, "4111111111111111");
  assert.equal(s.account.bankId, null);
  assert.equal(s.balance?.amount, -352.4);
  assert.equal(s.available, null);
  assert.equal(s.transactions.length, 2);
});

test("combined file yields one bank and one credit-card statement", () => {
  const { statements } = doc("combined.ofx");
  assert.equal(statements.length, 2);
  const types = statements.map((s) => s.account.type).sort();
  assert.deepEqual(types, ["CHECKING", "CREDITCARD"]);
});

test("OFX 1.x (SGML) is rejected with NOT_OFX2", () => {
  assert.throws(
    () => doc("v1.ofx"),
    (err: unknown) => err instanceof OfxError && err.code === "NOT_OFX2",
  );
});

test("missing <OFX> root yields PARSE_ERROR", () => {
  assert.throws(
    () => doc("notofx.ofx"),
    (err: unknown) => err instanceof OfxError && err.code === "PARSE_ERROR",
  );
});

test("missing file yields FILE_NOT_FOUND", () => {
  assert.throws(
    () => doc("does-not-exist.ofx"),
    (err: unknown) => err instanceof OfxError && err.code === "FILE_NOT_FOUND",
  );
});
