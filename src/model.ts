import { ofxToIso } from "./dates.ts";

export type Account = {
  id: string;
  type: string; // CHECKING | SAVINGS | CREDITCARD | MONEYMRKT | ...
  bankId: string | null;
  branchId: string | null;
};

export type Money = {
  amount: number;
  asOf: string | null; // ISO 8601
};

export type Transaction = {
  account: string; // owning ACCTID
  id: string; // FITID
  date: string | null; // ISO 8601 (from DTPOSTED)
  amount: number; // signed (TRNAMT); negative = outflow
  trnType: string; // raw OFX TRNTYPE (DEBIT, CREDIT, CHECK, POS, FEE, ...)
  name: string;
  memo: string | null;
  payee: string | null;
  checkNumber: string | null;
};

export type Statement = {
  account: Account;
  currency: string | null;
  period: { start: string | null; end: string | null };
  balance: Money | null; // LEDGERBAL
  available: Money | null; // AVAILBAL
  transactions: Transaction[];
};

export type OfxDocument = {
  statements: Statement[];
};

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = any;

function toArray<T>(x: T | T[] | null | undefined): T[] {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

/** Coerce a parsed node value to a trimmed string, or null when empty/absent. */
function str(v: unknown): string | null {
  if (v == null || typeof v === "object") return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** Coerce a parsed node value to a number; NaN when absent or non-numeric. */
function num(v: unknown): number {
  const s = str(v);
  return s == null ? NaN : Number(s);
}

/** Normalize a raw parsed OFX object into the canonical document model. */
export function buildDocument(raw: Raw): OfxDocument {
  const ofx: Raw = raw?.OFX ?? {};
  const statements: Statement[] = [];

  for (const trnrs of toArray<Raw>(ofx.BANKMSGSRSV1?.STMTTRNRS)) {
    for (const stmt of toArray<Raw>(trnrs?.STMTRS)) {
      statements.push(bankStatement(stmt));
    }
  }
  for (const trnrs of toArray<Raw>(ofx.CREDITCARDMSGSRSV1?.CCSTMTTRNRS)) {
    for (const stmt of toArray<Raw>(trnrs?.CCSTMTRS)) {
      statements.push(creditCardStatement(stmt));
    }
  }

  return { statements };
}

function bankStatement(stmt: Raw): Statement {
  const acct: Raw = stmt?.BANKACCTFROM ?? {};
  const account: Account = {
    id: str(acct.ACCTID) ?? "",
    type: str(acct.ACCTTYPE) ?? "UNKNOWN",
    bankId: str(acct.BANKID),
    branchId: str(acct.BRANCHID),
  };
  return assemble(stmt, account);
}

function creditCardStatement(stmt: Raw): Statement {
  const acct: Raw = stmt?.CCACCTFROM ?? {};
  const account: Account = {
    id: str(acct.ACCTID) ?? "",
    type: "CREDITCARD",
    bankId: null,
    branchId: null,
  };
  return assemble(stmt, account);
}

function assemble(stmt: Raw, account: Account): Statement {
  const tranlist: Raw = stmt?.BANKTRANLIST ?? {};
  const transactions = toArray<Raw>(tranlist.STMTTRN).map((t) => transaction(t, account.id));
  return {
    account,
    currency: str(stmt?.CURDEF),
    period: {
      start: ofxToIso(str(tranlist.DTSTART)),
      end: ofxToIso(str(tranlist.DTEND)),
    },
    balance: balance(stmt?.LEDGERBAL),
    available: balance(stmt?.AVAILBAL),
    transactions,
  };
}

function balance(node: Raw): Money | null {
  if (node == null) return null;
  return { amount: num(node.BALAMT), asOf: ofxToIso(str(node.DTASOF)) };
}

function transaction(t: Raw, accountId: string): Transaction {
  const payee =
    t?.PAYEE != null && typeof t.PAYEE === "object" ? str(t.PAYEE.NAME) : str(t?.PAYEE);
  return {
    account: accountId,
    id: str(t?.FITID) ?? "",
    date: ofxToIso(str(t?.DTPOSTED)),
    amount: num(t?.TRNAMT),
    trnType: str(t?.TRNTYPE) ?? "OTHER",
    name: str(t?.NAME) ?? "",
    memo: str(t?.MEMO),
    payee,
    checkNumber: str(t?.CHECKNUM),
  };
}
