import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = join(ROOT, "bin", "ofx-mcp.ts");
const BANK = join(ROOT, "test", "fixtures", "bank.ofx");
const V1 = join(ROOT, "test", "fixtures", "v1.ofx");

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const transport = new StdioClientTransport({ command: process.execPath, args: [ENTRY] });
  const client = new Client({ name: "ofxreader-test", version: "0.0.0" });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

function call(client: Client, name: string, args: Record<string, unknown>) {
  return client.callTool({ name, arguments: args });
}

/** Pull the first text block out of a tool result (runtime-narrowed). */
function firstText(res: unknown): string {
  assert.ok(res != null && typeof res === "object" && "content" in res);
  const content = (res as { content: unknown }).content;
  assert.ok(Array.isArray(content) && content.length > 0);
  const block = content[0] as { type?: unknown; text?: unknown };
  assert.ok(block.type === "text" && typeof block.text === "string");
  return block.text;
}

function isError(res: unknown): boolean {
  return (res as { isError?: unknown }).isError === true;
}

test("server advertises one tool per CLI capability", async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, ["ofx_accounts", "ofx_summary", "ofx_transactions"]);
  });
});

test("ofx_summary returns the statement summary", async () => {
  await withClient(async (client) => {
    const data = JSON.parse(firstText(await call(client, "ofx_summary", { path: BANK })));
    assert.equal(data.length, 1);
    assert.equal(data[0].account.id, "1234567890");
    assert.equal(data[0].counts.transactions, 4);
    assert.equal(data[0].totals.credits, 2500);
  });
});

test("ofx_accounts returns the account list", async () => {
  await withClient(async (client) => {
    const data = JSON.parse(firstText(await call(client, "ofx_accounts", { path: BANK })));
    assert.equal(data[0].type, "CHECKING");
    assert.equal(data[0].bankId, "121000248");
  });
});

test("ofx_transactions applies text + type filters", async () => {
  await withClient(async (client) => {
    const data = JSON.parse(
      firstText(await call(client, "ofx_transactions", { path: BANK, type: "debit", search: "amazon" })),
    );
    assert.equal(data.total, 1);
    assert.match(data.transactions[0].name, /AMAZON/);
  });
});

test("ofx_transactions honors limit (total still counts all matches)", async () => {
  await withClient(async (client) => {
    const data = JSON.parse(
      firstText(await call(client, "ofx_transactions", { path: BANK, type: "debit", limit: 2 })),
    );
    assert.equal(data.total, 3);
    assert.equal(data.count, 2);
  });
});

test("errors surface as isError with a structured code", async () => {
  await withClient(async (client) => {
    const res = await call(client, "ofx_summary", { path: V1 });
    assert.equal(isError(res), true);
    assert.equal(JSON.parse(firstText(res)).error.code, "NOT_OFX2");
  });
});

test("invalid arguments are rejected by the input schema", async () => {
  await withClient(async (client) => {
    const res = await call(client, "ofx_transactions", { path: BANK, type: "sideways" });
    assert.equal(isError(res), true);
  });
});
