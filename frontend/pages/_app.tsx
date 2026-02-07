import type { AppProps } from "next/app";
import dynamic from "next/dynamic";
import "../styles/globals.css";

// Dynamically import wallet providers to avoid hydration errors
const WalletProviderWrapper = dynamic(
  () => import("../components/WalletProvider"),
  { ssr: false }
);

export default function App({ Component, pageProps }: AppProps) {
  return (
    <WalletProviderWrapper>
      <Component {...pageProps} />
    </WalletProviderWrapper>
  );
}