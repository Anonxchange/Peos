import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { useEvmWallet } from "@/lib/evm-wallet-provider";
import { useEvmWalletData } from "@/hooks/use-evm-wallet-data";
import { CoinIcon } from "@/components/trading/CoinIcon";
import { ArrowDownToLine, ExternalLink, RefreshCw, Send } from "@/lib/icons";

function explorerUrl(namespace: string, chainId: number, value: string) {
  if (namespace === "solana") return `https://solscan.io/account/${value}`;
  if (namespace === "bitcoin") return `https://mempool.space/address/${value}`;
  if (namespace === "tron") return `https://tronscan.org/#/address/${value}`;
  const hosts: Record<number, string> = {
    1: "https://etherscan.io", 10: "https://optimistic.etherscan.io", 56: "https://bscscan.com",
    137: "https://polygonscan.com", 42161: "https://arbiscan.io", 8453: "https://basescan.org",
    43114: "https://snowtrace.io",
  };
  const host = hosts[chainId];
  return host ? `${host}/address/${value}` : undefined;
}

export function AssetList({ onSend, onReceive }: { onSend?: (symbol: string) => void; onReceive?: () => void }) {
  const wallet = useEvmWallet();
  const { assets, error, refetch } = useEvmWalletData();

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-bold">Wallet assets</h2>
          <p className="mt-1 text-xs text-muted-foreground">{wallet.isConnected ? "All supported coins, including zero balances" : "All supported coins · Connect your wallet to see balances"}</p>
        </div>
        <div className="flex items-center justify-between gap-4 sm:justify-end">
          <Button variant="ghost" size="sm" disabled={!wallet.isConnected} onClick={() => void refetch()} className="h-8 gap-1.5 text-xs"><RefreshCw className="h-3.5 w-3.5" />Refresh</Button>
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error instanceof Error ? error.message : "Balances could not be loaded. The supported coin list is still shown."}</p>}
      <div className="rounded-xl border border-[#e7ede2] overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#f8faf4] hover:bg-[#f8faf4]">
              <TableHead>Asset</TableHead>
              <TableHead className="hidden sm:table-cell">Price</TableHead>
              <TableHead>Balance</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {assets.map((asset) => {
              const namespace = "eip155";
              const accountAddress = wallet.address;
              const explorer = accountAddress
                ? explorerUrl(namespace, asset.chainId, accountAddress)
                : undefined;
              const canSend = namespace === "eip155" && wallet.isConnected && !!onSend;
              const networkName = asset.chainName;
              return (
                <TableRow key={asset.id} data-testid={`row-asset-${asset.id}`}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <CoinIcon symbol={asset.symbol.toUpperCase()} className="h-9 w-9" />
                       <div className="min-w-0"><div className="truncate font-semibold">{asset.name}</div><div className="text-xs text-muted-foreground">{asset.symbol.toUpperCase()} · {networkName}</div>{accountAddress && <div className="truncate font-mono text-[10px] text-muted-foreground/80">{accountAddress.slice(0, 7)}…{accountAddress.slice(-5)}</div>}</div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell font-medium">{asset.usdPrice == null ? "—" : `$${asset.usdPrice.toLocaleString("en-US", { maximumFractionDigits: 6 })}`}</TableCell>
                  <TableCell>
                    <div className="font-bold tabular-nums">{asset.balanceStatus === "ready" ? <>{asset.balance.toLocaleString("en-US", { maximumFractionDigits: Math.min(asset.decimals, 8) })} <span className="text-xs font-medium text-muted-foreground">{asset.symbol.toUpperCase()}</span></> : "—"}</div>
                    <div className="text-xs text-muted-foreground">{asset.balanceStatus === "disconnected" ? "Not connected" : asset.balanceStatus === "loading" ? "Loading balance…" : asset.balanceStatus === "error" ? "Balance unavailable" : asset.usdValue == null ? "Value unavailable" : `$${asset.usdValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-1">
                      {explorer && <Button asChild variant="ghost" size="icon" className="h-8 w-8" title="View address on block explorer"><a href={explorer} target="_blank" rel="noreferrer" aria-label="View on block explorer"><ExternalLink className="h-4 w-4" /></a></Button>}
                      {onReceive && <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Receive ${asset.symbol}`} onClick={onReceive}><ArrowDownToLine className="h-4 w-4" /></Button>}
                      {canSend && <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Send ${asset.symbol}`} onClick={() => onSend(asset.symbol)}><Send className="h-4 w-4" /></Button>}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">Balances are read-only data reported for connected accounts. Sending is available only for supported EVM assets; non-EVM assets are view-only here.</p>
    </div>
  );
}
