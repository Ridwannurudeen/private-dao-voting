import { useMemo, ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";

interface Props {
  children: ReactNode;
}

export default function WalletProviderWrapper({ children }: Props) {
  const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.devnet.solana.com";
  const wallets = useMemo(() => [], []);
  const connectionConfig = useMemo(
    () => ({
      commitment: "confirmed" as const,
      confirmTransactionInitialTimeout: 60000,
      wsEndpoint: endpoint.replace("https://", "wss://"),
    }),
    [endpoint]
  );

  return (
    <ConnectionProvider endpoint={endpoint} config={connectionConfig}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}