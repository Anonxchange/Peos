const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("../artifacts/pexo/node_modules/typescript");
const viem = require("../artifacts/pexo/node_modules/viem");
const solanaSdk = require("../artifacts/pexo/node_modules/@solana/web3.js");
const bitcoin = require("../artifacts/pexo/node_modules/bitcoinjs-lib");
const tronSdk = require("../artifacts/pexo/node_modules/tronweb");
const solanaId = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const tronId = "tron:0x2b6653dc";
const solFrom = "11111111111111111111111111111111";
const solTo = "Vote111111111111111111111111111111111111111";
const btcFrom = bitcoin.payments.p2wpkh({ hash: new Uint8Array(20).fill(1) }).address;
const btcTo = bitcoin.payments.p2wpkh({ hash: new Uint8Array(20).fill(2) }).address;
const trxFrom = bitcoin.address.toBase58Check(new Uint8Array(20).fill(3), 0x41);
const trxTo = bitcoin.address.toBase58Check(new Uint8Array(20).fill(4), 0x41);

function load(file, dependencies) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(`${__dirname}/../artifacts/pexo/src/${file}`, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, console, Uint8Array, AbortController, structuredClone, fetch: () => {
    throw new Error("Tests must never call a network or broadcast a transaction");
  }, require: name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  } });
  return module.exports;
}
const helpers = load("lib/wallet-assets.ts", { viem });

function tronTransaction(from, to, amount) {
  const transaction = {
    visible: false,
    raw_data: {
      contract: [{
        parameter: { type_url: "type.googleapis.com/protocol.TransferContract", value: {
          owner_address: tronSdk.TronWeb.address.toHex(from), to_address: tronSdk.TronWeb.address.toHex(to), amount,
        } },
        type: "TransferContract",
      }],
      ref_block_bytes: "1234", ref_block_hash: "0011223344556677",
      timestamp: 1700000000000, expiration: 1700000060000,
    },
  };
  const protobuf = tronSdk.utils.transaction.txJsonToPb(transaction);
  transaction.raw_data_hex = tronSdk.utils.transaction.txPbToRawDataHex(protobuf);
  transaction.txID = tronSdk.utils.transaction.txPbToTxID(protobuf).replace(/^0x/, "");
  return transaction;
}
function tronSender(sent, { unexpectedRecipient = false, timeout = false } = {}) {
  let input;
  class TronWeb {
    static address = tronSdk.TronWeb.address;
    constructor() {
      this.transactionBuilder = { sendTrx: async (to, amount, from) => {
        input = { from, to, value: String(amount) };
        return tronTransaction(from, unexpectedRecipient ? trxFrom : to, amount);
      } };
      this.trx = { sendRawTransaction: async transaction => {
        sent.push({ namespace: "tron", input, transaction });
        if (timeout) throw new Error("Simulated timeout after submission");
        return { result: true };
      } };
    }
  }
  return load("lib/send-tron.ts", { tronweb: { __esModule: true, TronWeb, utils: tronSdk.utils } });
}

function asset(symbol = "USDT", networkId = "eip155:1", balanceStatus = "ready", balance = 0) {
  return { id: `${networkId}:${symbol}`, symbol, name: symbol, namespace: "eip155", networkId, chainName: networkId,
    balanceStatus, balance, usdPrice: 1, usdValue: balanceStatus === "ready" ? balance : null, decimals: 6, isNative: false };
}

test("one row per coin combines balances without hiding zero-balance or disconnected coins", () => {
  const coins = helpers.groupWalletCoins([
    asset("ETH", "eip155:1", "ready", 1), asset("ETH", "eip155:8453", "ready", 2),
    asset("USDT", "eip155:1"), asset("USDT", "eip155:56"),
    ...helpers.extraCoins.map(coin => ({ ...coin, balance: 0, balanceStatus: "disconnected", usdValue: null, usdPrice: null, isNative: true })),
    asset("USDC", "eip155:1"),
  ]);
  assert.equal(coins.length, 6);
  assert.equal(coins.find(coin => coin.symbol === "ETH").balance, 3);
  assert.equal(coins.find(coin => coin.symbol === "USDT").networks.length, 2);
  assert.deepEqual(Array.from(coins, coin => coin.symbol), ["USDT", "USDC", "ETH", "BTC", "SOL", "TRX"]);
  for (const symbol of ["BTC", "SOL", "TRX"]) {
    assert.equal(coins.find(coin => coin.symbol === symbol).balanceStatus, "disconnected");
    assert.equal(coins.find(coin => coin.symbol === symbol).usdValue, null);
  }
});

test("partial totals never treat failed or disconnected network reads as confirmed zeros", () => {
  const [coin] = helpers.groupWalletCoins([
    asset("USDT", "eip155:1", "ready", 12), asset("USDT", "eip155:56", "error", 500),
  ]);
  assert.equal(coin.balance, 12);
  assert.equal(coin.usdValue, 12);
  assert.equal(coin.partial, true);
});

test("transaction amounts preserve satoshis, lamports and sun exactly and reject excess precision", () => {
  assert.equal(helpers.transferUnits("0.00000001", 8), 1n);
  assert.equal(helpers.transferUnits("1.23456789", 9), 1234567890n);
  assert.equal(helpers.transferUnits("0.000001", 6), 1n);
  for (const [value, decimals] of [["0", 8], ["-1", 6], ["1e-8", 8], ["0.000000001", 8], ["1.0000001", 6]]) {
    assert.throws(() => helpers.transferUnits(value, decimals));
  }
});

function extraWallet({ bitcoinAccount = btcFrom, wrongNetwork = false } = {}) {
  const sent = [];
  const configuredAccounts = {
    solana: { isConnected: true, address: solFrom, caipAddress: `${wrongNetwork ? "solana:devnet" : solanaId}:${solFrom}` },
    tron: { isConnected: true, address: trxFrom, caipAddress: `${wrongNetwork ? "tron:testnet" : tronId}:${trxFrom}` },
  };
  const connection = {
    getLatestBlockhash: async () => ({ blockhash: solFrom }),
    getBalance: async () => 1250000000,
  };
  const result = load("lib/extra-wallet-provider.tsx", {
    "react/jsx-runtime": { jsx: (type, props) => ({ type, props }) },
    react: { memo: component => component,
      useEffect: effect => { effect(); }, useState: () => [btcFrom, () => {}] },
    "@reown/appkit/react": {
      useAppKit: () => ({ open: async () => {} }),
      useAppKitAccount: ({ namespace }) => configuredAccounts[namespace],
      useAppKitNetwork: () => ({ switchNetwork: async () => {} }),
      useDisconnect: () => ({ disconnect: async () => {} }),
      useAppKitProvider: namespace => ({ walletProvider: namespace === "solana"
        ? { sendTransaction: async transaction => { sent.push({ namespace, transaction }); return "test-solana-transaction"; } }
        : { type: "INJECTED", request: async ({ method, params }) => {
          assert.equal(method, "tron_sendTransaction");
          return { ...params.transaction, signature: ["c".repeat(130)] };
        } } }),
    },
    "@reown/appkit-adapter-solana/react": { useAppKitConnection: () => ({ connection }) },
    "@reown/appkit/networks": { solana: { caipNetworkId: solanaId }, tronMainnet: { caipNetworkId: tronId } },
    "@solana/web3.js": solanaSdk, "bitcoinjs-lib": bitcoin,
    "./reown-config": { isReownConfigured: true },
    "./wallet-assets": helpers,
    "./send-tron": tronSender(sent),
    "sats-connect": { __esModule: true, AddressPurpose: { Payment: "payment" }, default: {
      request: async (method, input) => {
        if (method === "getAccounts") return { status: "success", result: [{ address: bitcoinAccount, purpose: "payment" }] };
        assert.equal(method, "sendTransfer");
        sent.push({ namespace: "bitcoin", input });
        return { status: "success", result: { txid: "b".repeat(64) } };
      },
      addListener: () => () => {}, disconnect: async () => {},
    } },
  });
  let wallet;
  result.ExtraWalletRuntime({ onChange: value => { wallet = value; } });
  return { wallet, sent };
}
const native = (namespace, address) => ({ ...helpers.extraCoins.find(coin => coin.namespace === namespace), address, isNative: true });

test("Bitcoin transfers use a payment address and exact integer satoshis", async () => {
  const { wallet, sent } = extraWallet();
  await wallet.send(native("bitcoin", btcFrom), btcTo, "0.01234567");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].input.recipients[0].address, btcTo);
  assert.equal(sent[0].input.recipients[0].amount, 1234567);
});

test("Solana transfers retain the selected sender, recipient and exact lamports", async () => {
  const { wallet, sent } = extraWallet();
  await wallet.send(native("solana", solFrom), solTo, "1.23456789");
  const transfer = solanaSdk.SystemInstruction.decodeTransfer(sent[0].transaction.instructions[0]);
  assert.equal(transfer.fromPubkey.toBase58(), solFrom);
  assert.equal(transfer.toPubkey.toBase58(), solTo);
  assert.equal(transfer.lamports, 1234567890n);
});

test("TRON transfers use a distinct Base58Check address and exact sun", async () => {
  const { wallet, sent } = extraWallet();
  await wallet.send(native("tron", trxFrom), trxTo, "12.345678");
  assert.equal(sent[0].input.from, trxFrom);
  assert.equal(sent[0].input.to, trxTo);
  assert.equal(sent[0].input.value, "12345678");
  assert.ok(tronSdk.utils.transaction.txCheck(sent[0].transaction));
});

test("TRON rejects altered node transactions before requesting a wallet signature", async () => {
  const sent = [];
  const helper = tronSender(sent, { unexpectedRecipient: true });
  let signs = 0;
  await assert.rejects(helper.sendTronNative({ type: "INJECTED", request: async () => { signs++; } }, trxFrom, trxTo, 1n));
  assert.equal(signs, 0);
  assert.equal(sent.length, 0);
});

test("TRON submission timeouts preserve the transaction ID and warn against duplicate sends", async () => {
  const sent = [];
  const helper = tronSender(sent, { timeout: true });
  const provider = { type: "INJECTED", request: async ({ params }) => ({ ...params.transaction, signature: ["d".repeat(130)] }) };
  await assert.rejects(helper.sendTronNative(provider, trxFrom, trxTo, 10n), error => {
    assert.ok(error instanceof helper.WalletSubmissionUnknownError);
    assert.match(error.transactionHash, /^[a-f0-9]{64}$/i);
    return true;
  });
  assert.equal(sent.length, 1);
});

test("TRON supports both WalletConnect signing payload formats without using Reown RPC", async () => {
  for (const version of ["v1", "v2"]) {
    const sent = [];
    const helper = tronSender(sent);
    const provider = { type: "WALLET_CONNECT", provider: {
      session: { sessionProperties: { tron_method_version: version } },
      request: async ({ method, params }, chain) => {
        assert.equal(method, "tron_signTransaction");
        assert.equal(chain, tronId);
        assert.equal(params.address, trxFrom);
        const transaction = version === "v1" ? params.transaction : params.transaction.transaction;
        assert.ok(transaction.txID);
        return { ...transaction, signature: ["e".repeat(130)] };
      },
    } };
    const hash = await helper.sendTronNative(provider, trxFrom, trxTo, 15n);
    assert.match(hash, /^[a-f0-9]{64}$/i);
    assert.equal(sent.length, 1);
  }
});

test("non-EVM transfers reject EVM recipients, changed accounts and unsupported networks", async () => {
  const { wallet, sent } = extraWallet();
  const evmAddress = `0x${"a".repeat(40)}`;
  for (const namespace of ["bitcoin", "solana", "tron"]) {
    await assert.rejects(wallet.send(native(namespace, wallet.addresses[namespace]), evmAddress, "1"));
  }
  await assert.rejects(wallet.send(native("bitcoin", btcTo), btcTo, "1"));
  const changed = extraWallet({ bitcoinAccount: btcTo });
  await assert.rejects(changed.wallet.send(native("bitcoin", btcFrom), btcTo, "1"));
  assert.equal(sent.length, 0);
  assert.equal(changed.sent.length, 0);
  const wrong = extraWallet({ wrongNetwork: true });
  assert.equal(wrong.wallet.addresses.solana, undefined);
  assert.equal(wrong.wallet.addresses.tron, undefined);
  await assert.rejects(wrong.wallet.send(native("solana", solFrom), solTo, "1"));
  assert.equal(wrong.sent.length, 0);
});

test("explorers use the selected network, never the wallet's last active EVM chain", () => {
  assert.match(helpers.walletExplorer(native("bitcoin", btcFrom), "hash", true), /mempool\.space\/tx\/hash/);
  assert.match(helpers.walletExplorer(native("solana", solFrom), "hash", true), /solscan\.io\/tx\/hash/);
  assert.match(helpers.walletExplorer(native("tron", trxFrom), "hash", true), /tronscan\.org\/#\/transaction\/hash/);
});
