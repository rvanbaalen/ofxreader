import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = join(ROOT, "bin", "ofx-mcp.ts");
const BANK = join(ROOT, "test", "fixtures", "bank.ofx");
const V1 = join(ROOT, "test", "fixtures", "v1.ofx");
const VENDORS = join(ROOT, "test", "fixtures", "vendors.ofx");

async function withClient<T>(
  fn: (client: Client) => Promise<T>,
  env?: Record<string, string>,
): Promise<T> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [ENTRY],
    env: { ...(process.env as Record<string, string>), ...(env ?? {}) },
  });
  const client = new Client({ name: "ofxreader-test", version: "0.0.0" });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

function tmpStore(): string {
  return join(tmpdir(), `ofx-mcp-vendors-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
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

function resourceText(res: unknown): string {
  const contents = (res as { contents?: Array<{ text?: string }> }).contents;
  assert.ok(Array.isArray(contents) && contents.length > 0);
  const text = contents[0]?.text;
  assert.ok(typeof text === "string");
  return text;
}

test("server advertises a tool per CLI capability plus the vendor tools", async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "ofx_accounts",
      "ofx_summary",
      "ofx_transactions",
      "ofx_vendor_learn",
      "ofx_vendors",
    ]);
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

test("balances resource template is advertised", async () => {
  await withClient(async (client) => {
    const { resourceTemplates } = await client.listResourceTemplates();
    const tpl = resourceTemplates.find((r) => r.name === "ofx-balances");
    assert.ok(tpl, "ofx-balances resource template should be registered");
    assert.match(tpl.uriTemplate, /^ofx:/);
  });
});

test("reading the balances resource states each balance with its as-of date", async () => {
  await withClient(async (client) => {
    const text = resourceText(await client.readResource({ uri: `ofx:${BANK}` }));
    assert.match(text, /Account 1234567890 — CHECKING \(USD\)/);
    assert.match(text, /Balance at 2024-03-31 is 4327\.87 USD/);
    assert.match(text, /Available balance at 2024-03-31 is 4200\.00 USD/);
  });
});

test("reading the balances resource for a non-OFX2 file errors", async () => {
  await withClient(async (client) => {
    await assert.rejects(client.readResource({ uri: `ofx:${V1}` }));
  });
});

test("ofx_vendor_learn persists and ofx_transactions(vendor) resolves deterministically", async () => {
  const store = tmpStore();
  try {
    await withClient(async (client) => {
      const learned = JSON.parse(
        firstText(
          await call(client, "ofx_vendor_learn", {
            vendor: "Jason's Carousel",
            descriptors: ["SQ *JASONS CARO 0123", "TST* JASONSCAROUSEL"],
          }),
        ),
      );
      assert.equal(learned.vendor, "Jason's Carousel");

      const vendors = JSON.parse(firstText(await call(client, "ofx_vendors", {})));
      assert.ok(vendors["Jason's Carousel"]);

      const res = JSON.parse(
        firstText(
          await call(client, "ofx_transactions", {
            path: VENDORS,
            vendor: "Jason's Carousel",
            from: "2024-04-01",
            to: "2024-04-30",
          }),
        ),
      );
      assert.equal(res.resolved, true);
      assert.equal(res.total, 2);
    }, { OFXREADER_VENDORS: store });
  } finally {
    if (existsSync(store)) rmSync(store);
  }
});

test("ofx_transactions(vendor) on an unknown vendor returns fuzzy candidates", async () => {
  const store = tmpStore();
  try {
    await withClient(async (client) => {
      const res = JSON.parse(
        firstText(await call(client, "ofx_transactions", { path: VENDORS, vendor: "Jason's Carousel" })),
      );
      assert.equal(res.resolved, false);
      assert.equal(res.total, 0);
      assert.ok(res.vendorCandidates.length >= 1);
    }, { OFXREADER_VENDORS: store });
  } finally {
    if (existsSync(store)) rmSync(store);
  }
});
