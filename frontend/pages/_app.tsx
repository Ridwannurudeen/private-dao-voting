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
        <meta name="viewport" content="width=device-width, initial-scale=1" />

        {/* Open Graph */}
        <meta property="og:type" content="website" />
        <meta property="og:title" content="Private DAO Voting | Confidential Governance on Solana" />
        <meta property="og:description" content="Encrypted voting powered by Arcium MXE. Individual votes stay secret — only aggregate results are revealed with correctness proofs." />
        <meta property="og:url" content="https://privatedao-arcium.vercel.app" />
        <meta property="og:site_name" content="Private DAO Voting" />
        <meta property="og:image" content="https://privatedao-arcium.vercel.app/og-image.png" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />

        {/* Twitter Card */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Private DAO Voting" />
        <meta name="twitter:description" content="Encrypted governance on Solana. Votes tallied via Arcium MPC — no one sees how you voted." />
        <meta name="twitter:image" content="https://privatedao-arcium.vercel.app/og-image.png" />
      </Head>
      <WalletProviderWrapper>
        <Component {...pageProps} />
      </WalletProviderWrapper>
    </ErrorBoundary>
  );
}
