import { createAppKit } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { SolanaAdapter } from "@reown/appkit-adapter-solana";
import { TronAdapter } from "@reown/appkit-adapter-tron";
import { TronLinkAdapter } from "@tronweb3/tronwallet-adapter-tronlink";
import {
  arbitrum,
  avalanche,
  base,
  bsc,
  mainnet,
  optimism,
  polygon,
  solana,
  tronMainnet,
  type AppKitNetwork,
} from "@reown/appkit/networks";
import { createConfig, http } from "wagmi";

export const evmNetworks: [
  typeof mainnet,
  typeof polygon,
  typeof bsc,
  typeof arbitrum,
  typeof base,
  typeof optimism,
  typeof avalanche,
] = [
  mainnet,
  polygon,
  bsc,
  arbitrum,
  base,
  optimism,
  avalanche,
];

export const evmNetworkById = new Map<number, { id: number; name: string }>(
  evmNetworks.map(
    (network): [number, { id: number; name: string }] => [
      network.id,
      network,
    ],
  ),
);

const explorerByChainId = new Map<number, string>([
  [1, "https://etherscan.io"],
  [10, "https://optimistic.etherscan.io"],
  [56, "https://bscscan.com"],
  [137, "https://polygonscan.com"],
  [42161, "https://arbiscan.io"],
  [8453, "https://basescan.org"],
  [43114, "https://snowtrace.io"],
]);

export function transactionExplorerUrl(chainId: number, hash: string): string | undefined {
  const explorer = explorerByChainId.get(chainId);
  return explorer ? `${explorer}/tx/${hash}` : undefined;
}

const projectId = import.meta.env.VITE_REOWN_PROJECT_ID?.trim();

// Non-EVM network metadata must not carry optional Viem EVM action types:
// those may differ between the SDK's network and controller dependencies.
export const solanaWalletNetwork: AppKitNetwork = {
  id: solana.id, name: solana.name, nativeCurrency: solana.nativeCurrency,
  rpcUrls: solana.rpcUrls, blockExplorers: solana.blockExplorers,
  chainNamespace: "solana", caipNetworkId: solana.caipNetworkId,
};
export const tronWalletNetwork: AppKitNetwork = {
  id: tronMainnet.id, name: tronMainnet.name, nativeCurrency: tronMainnet.nativeCurrency,
  rpcUrls: tronMainnet.rpcUrls, blockExplorers: tronMainnet.blockExplorers,
  chainNamespace: "tron", caipNetworkId: tronMainnet.caipNetworkId,
};

export const wagmiAdapter = projectId
  ? new WagmiAdapter({
      networks: evmNetworks,
      projectId,
    })
  : null;

if (projectId && wagmiAdapter) {
  createAppKit({
    adapters: [
      wagmiAdapter, new SolanaAdapter(),
      new TronAdapter({ walletAdapters: [new TronLinkAdapter({
        openUrlWhenWalletNotFound: false, checkTimeout: 3000,
      })] }),
    ],
    networks: [...evmNetworks, solanaWalletNetwork, tronWalletNetwork],
    projectId,
    defaultNetwork: mainnet,
    metadata: {
      name: "Pexly",
      description: "Pexly non-custodial wallet",
      url:
        typeof window === "undefined"
          ? "https://pexly.com"
          : window.location.origin,
      icons: [],
    },
    features: {
      analytics: false,
      email: true,
      socials: ["google"],
    },
  });
}

export const isReownConfigured = Boolean(wagmiAdapter);
const readOnlyWagmiConfig = createConfig({
  chains: evmNetworks,
  connectors: [],
  transports: {
    [mainnet.id]: http(),
    [polygon.id]: http(),
    [bsc.id]: http(),
    [arbitrum.id]: http(),
    [base.id]: http(),
    [optimism.id]: http(),
    [avalanche.id]: http(),
  },
});

export const wagmiConfig = wagmiAdapter?.wagmiConfig ?? readOnlyWagmiConfig;
