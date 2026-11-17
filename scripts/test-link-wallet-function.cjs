const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const ts = require("../artifacts/pexo/node_modules/typescript");
const viem = require("../artifacts/pexo/node_modules/viem");
const { createSiweMessage, parseSiweMessage } = require("../artifacts/pexo/node_modules/viem/siwe");
const { privateKeyToAccount } = require("../artifacts/pexo/node_modules/viem/accounts");

// Public, deterministic test-only keys. Never funded or used outside these tests.
const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
const otherAccount = privateKeyToAccount(`0x${"2".repeat(64)}`);
const previewOrigin = "https://preview.example.test";
const source = ts.transpileModule(fs.readFileSync(
  `${__dirname}/../supabase/functions/link-wallet/index.ts`, "utf8",
), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function gateway() {
  let handler;
  let clientCalls = 0;
  const nonces = new Map();
  const linked = [];
  const createClient = (_url, _key, options) => {
    clientCalls++;
    return {
      auth: {
        getUser: async () => options?.global?.headers?.Authorization === "Bearer test-session"
          ? { data: { user: { id: "test-user" } }, error: null }
          : { data: { user: null }, error: { message: "Invalid test session" } },
      },
      from: table => {
        assert.equal(table, "auth_nonces");
        return {
          insert: async row => { nonces.set(row.nonce, { ...row, id: row.nonce }); return { error: null }; },
          delete: () => {
            const filters = [];
            const builder = {
              lt: async () => ({ error: null }),
              eq: (field, value) => { filters.push(row => row[field] === value); return builder; },
              is: (field, value) => { filters.push(row => row[field] === value); return builder; },
              gt: (field, value) => { filters.push(row => row[field] > value); return builder; },
              select: () => builder,
              maybeSingle: async () => {
                const match = [...nonces.values()].find(row => filters.every(filter => filter(row)));
                if (match) nonces.delete(match.nonce);
                return { data: match ? { id: match.id } : null, error: null };
              },
            };
            return builder;
          },
        };
      },
      rpc: async (name, params) => {
        assert.equal(name, "set_verified_user_wallet");
        linked.push(params);
        return { error: null };
      },
    };
  };
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports, Request, Response, URL, Date, crypto: webcrypto,
    console: { error: () => {} },
    Deno: {
      serve: callback => { handler = callback; },
      env: { get: name => {
        assert.notEqual(name, "SIWE_ALLOWED_ORIGINS", "Development must not need an origin secret");
        return name === "SUPABASE_URL" ? "https://supabase.example.invalid" : "test-only-not-a-credential";
      } },
    },
    require: name => {
      if (name === "npm:@supabase/supabase-js@2") return { createClient };
      if (name === "npm:viem@2") return viem;
      if (name === "npm:viem@2/siwe") return { parseSiweMessage };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  return {
    nonces, linked, clientCalls: () => clientCalls,
    invoke: (body, { origin = previewOrigin, method = "POST", session = "test-session", headers = {} } = {}) =>
      handler(new Request("https://functions.example.invalid/link-wallet", {
        method,
        headers: { ...(origin ? { Origin: origin } : {}), ...(session ? { Authorization: `Bearer ${session}` } : {}), "Content-Type": "application/json", ...headers },
        ...(method === "POST" ? { body: JSON.stringify({ walletAddress: account.address, ...body }) } : {}),
      })),
  };
}

async function signedChallenge(edge, { purpose = "link", messageOrigin = previewOrigin, signer = account } = {}) {
  const response = await edge.invoke({ action: "nonce", purpose });
  assert.equal(response.status, 200);
  const { nonce } = await response.json();
  const issuedAt = new Date();
  const message = createSiweMessage({
    address: account.address, chainId: 1, domain: new URL(messageOrigin).host,
    nonce, uri: `${messageOrigin}/`, version: "1",
    statement: "Link this wallet to your Pexly account. This message does not authorize a transaction.",
    issuedAt, expirationTime: new Date(issuedAt.getTime() + 4 * 60_000),
  });
  return { action: "link", message, signature: await signer.signMessage({ message }) };
}

test("configured preview preflight permits current Supabase headers without touching authentication or data", async () => {
  const edge = gateway();
  const requested = [
    "authorization", "apikey", "content-type", "x-client-info",
    "x-supabase-client-platform", "x-supabase-client-platform-version",
    "x-supabase-client-runtime", "x-supabase-client-runtime-version",
  ];
  const response = await edge.invoke({}, { method: "OPTIONS", headers: {
    "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": requested.join(","),
  } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  const allowed = response.headers.get("Access-Control-Allow-Headers").split(",").map(value => value.trim());
  requested.forEach(header => assert.ok(allowed.includes(header), header));
  assert.equal(response.headers.get("Vary"), "Origin");
  assert.equal(edge.clientCalls(), 0);
});

test("development accepts all browser origins and requests without Origin", async () => {
  for (const origin of [null, "https://untrusted.replit.dev", "https://preview.example.test.attacker.invalid"]) {
    const edge = gateway();
    const response = await edge.invoke({}, { method: "OPTIONS", origin });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
    assert.equal(edge.clientCalls(), 0);
  }
});

test("production and arbitrary development origins work without allowlist configuration", async () => {
  const edge = gateway();
  for (const origin of ["https://pexly.app", previewOrigin, "https://second.example.test"]) {
    const response = await edge.invoke({}, { method: "OPTIONS", origin });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  }
});

test("a valid signed challenge links once and cannot be replayed", async () => {
  const edge = gateway();
  const body = await signedChallenge(edge);
  const response = await edge.invoke(body);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  assert.equal(edge.linked.length, 1);
  assert.equal(edge.linked[0].p_user_id, "test-user");
  assert.equal(edge.linked[0].p_wallet_address, account.address.toLowerCase());
  assert.equal((await edge.invoke(body)).status, 401);
  assert.equal(edge.linked.length, 1);
});

test("a different wallet's signature is rejected without linking or consuming the challenge", async () => {
  const edge = gateway();
  const response = await edge.invoke(await signedChallenge(edge, { signer: otherAccount }));
  assert.equal(response.status, 403);
  assert.equal(edge.linked.length, 0);
  assert.equal(edge.nonces.size, 1);
});

test("a message signed for another origin is rejected", async () => {
  const edge = gateway();
  const response = await edge.invoke(await signedChallenge(edge, { messageOrigin: "https://other.example.test" }));
  assert.equal(response.status, 400);
  assert.equal(edge.linked.length, 0);
});

test("link challenges still require an authenticated user", async () => {
  for (const session of [null, "invalid-session"]) {
    const edge = gateway();
    const response = await edge.invoke({ action: "nonce", purpose: "link" }, { session });
    assert.equal(response.status, 401);
    assert.equal(edge.nonces.size, 0);
  }
});

test("expired nonces cannot be consumed", async () => {
  const edge = gateway();
  const body = await signedChallenge(edge);
  for (const row of edge.nonces.values()) row.expires_at = new Date(Date.now() - 60_000).toISOString();
  assert.equal((await edge.invoke(body)).status, 401);
  assert.equal(edge.linked.length, 0);
});

test("a sign-in challenge cannot be used to link a wallet", async () => {
  const edge = gateway();
  const body = await signedChallenge(edge, { purpose: "sign-in" });
  assert.equal((await edge.invoke(body)).status, 401);
  assert.equal(edge.linked.length, 0);
});
