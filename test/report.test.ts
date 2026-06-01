import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readOfxFile, parseOfx } from "../src/parser.ts";
import { buildDocument } from "../src/model.ts";
import { balances } from "../src/report.ts";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const statements = (name: string) =>
  buildDocument(parseOfx(readOfxFile(join(FIX, name)))).statements;

test("balances carry the correct as-of date (date portion of DTASOF)", () => {
  const b = balances(statements("bank.ofx"));
  assert.equal(b.length, 1);
  const acct = b[0]!;
  assert.equal(acct.account, "1234567890");
  assert.equal(acct.currency, "USD");
  assert.equal(acct.ledger!.amount, 4327.87);
  assert.equal(acct.ledger!.date, "2024-03-31");
  assert.equal(acct.available!.amount, 4200);
  assert.equal(acct.available!.date, "2024-03-31");
});

test("credit-card balance has a date and no available balance", () => {
  const b = balances(statements("creditcard.ofx"));
  const acct = b[0]!;
  assert.equal(acct.accountType, "CREDITCARD");
  assert.equal(acct.ledger!.amount, -352.4);
  assert.equal(acct.ledger!.date, "2024-03-31");
  assert.equal(acct.available, null);
});
