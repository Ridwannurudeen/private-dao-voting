import type { AppProps } from "next/app";
import dynamic from "next/dynamic";
import Head from "next/head";
import { ErrorBoundary } from "../components/ErrorBoundary";
import "../styles/globals.css";

// Dynamically import wallet providers to avoid hydration errors
const WalletProviderWrapper = dynamic(
  () => import("../components/WalletProvider"),
  { ssr: false }
);

export default function App({ Component, pageProps }: AppProps) {
  return (
    <ErrorBoundary>
      <Head>
        <title>Private DAO Voting | Confidential Governance on Solana</title>
        <meta name="description" content="Token-gated private voting on Solana powered by Arcium MXE. Votes are encrypted end-to-end via multi-party computation — individual choices are never revealed." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />

        {/* Open Graph */}
        <meta property="og:type" content="website" />
        <meta property="og:title" content="Private DAO Voting | Confidential Governance on Solana" />
        <meta property="og:description" content="Encrypted voting powered by Arcium MXE. Individual votes stay secret — only aggregate results are revealed with correctness proofs." />
        <meta property="og:url" content="https://privatedao-arcium.vercel.app" />
        <meta property="og:site_name" content="Private DAO Voting" />

        {/* Twitter Card */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Private DAO Voting" />
        <meta name="twitter:description" content="Encrypted governance on Solana. Votes tallied via Arcium MPC — no one sees how you voted." />

        {/* Theme */}
        <meta name="theme-color" content="#0a0a1a" />
      </Head>
      <WalletProviderWrapper>
        <Component {...pageProps} />
      </WalletProviderWrapper>
    </ErrorBoundary>
  );
}
