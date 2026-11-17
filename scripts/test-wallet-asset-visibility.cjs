const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("../artifacts/pexo/node_modules/typescript");

function walletData({ connected = false, failed = false, loading = false, funded = false } = {}) {
  let reads = 0;
  const refetch = async () => { reads++; };
  const module = { exports: {} };
  const source = fs.readFileSync(`${__dirname}/../artifacts/pexo/src/hooks/use-evm-wallet-data.ts`, "utf8");
  const imports = {
    react: { useMemo: fn => fn(), useCallback: fn => fn },
    viem: { zeroAddress: "0x0000000000000000000000000000000000000000", formatUnits: (value, decimals) => String(Number(value) / 10 ** decimals) },
    wagmi: {
      useBalance: ({ chainId }) => ({
        data: failed || loading ? undefined : { formatted: funded && chainId === 1 ? "2" : "0" },
        isError: failed, isLoading: loading, refetch,
      }),
      useReadContracts: ({ contracts }) => ({
        data: failed || loading ? undefined : contracts.map(() => ({ status: "success", result: 0n })),
        isError: failed, isLoading: loading, refetch,
      }),
    },
    "@/lib/crypto-prices": { useCryptoPrices: () => ({ data: { ETH: { current_price: 100 } }, refetch }) },
    "@/lib/wallet-networks": { evmNetworkById: new Map() },
    "@/lib/wallet-provider": { useEvmWallet: () => ({ configured: true, isConnected: connected, address: connected ? "0x1111111111111111111111111111111111111111" : undefined }) },
  };
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module, exports: module.exports,
    require: name => {
      assert.ok(name in imports, `Unexpected dependency ${name}`);
      return imports[name];
    },
  });
  return { ...module.exports.useEvmWalletData(), reads: () => reads };
}

test("all configured coins remain visible while disconnected without inventing balances", () => {
  const data = walletData();
  assert.equal(data.assets.length, 19);
  assert.equal(new Set(data.assets.map(asset => asset.id)).size, 19);
  assert.ok(data.assets.every(asset => asset.balanceStatus === "disconnected" && asset.usdValue === null));
});

test("connected zero-balance wallets still show every coin with confirmed zero balances", () => {
  const data = walletData({ connected: true });
  assert.equal(data.assets.length, 19);
  assert.ok(data.assets.every(asset => asset.balanceStatus === "ready" && asset.balance === 0));
});

test("funded wallets retain all zero-balance coins", () => {
  const data = walletData({ connected: true, funded: true });
  assert.equal(data.assets.length, 19);
  assert.equal(data.assets.find(asset => asset.id === "ethereum:eth").balance, 2);
  assert.equal(data.totalUsd, 200);
});

test("loading and failed network reads retain every coin without claiming zero balances", () => {
  for (const [options, status] of [[{ loading: true }, "loading"], [{ failed: true }, "error"]]) {
    const data = walletData({ connected: true, ...options });
    assert.equal(data.assets.length, 19);
    assert.ok(data.assets.every(asset => asset.balanceStatus === status && asset.usdValue === null));
  }
});

test("disconnect ignores previously cached positive balances and prevents manual network reads", async () => {
  const data = walletData({ funded: true });
  assert.ok(data.assets.every(asset => asset.balance === 0 && asset.balanceStatus === "disconnected"));
  await data.refetch();
  assert.equal(data.reads(), 0);
});

test("the asset table does not hide coins behind connection, zero-balance, or loading gates", () => {
  const source = fs.readFileSync(`${__dirname}/../artifacts/pexo/src/components/wallet/AssetList.tsx`, "utf8");
  assert.match(source, /assets\.map/);
  assert.doesNotMatch(source, /hideZero|assets\.filter|if \(!isAnyConnected\)|asset-skeleton/);
});
