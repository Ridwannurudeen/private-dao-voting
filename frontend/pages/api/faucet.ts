import type { NextApiRequest, NextApiResponse } from "next";
import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

// Rate limiting: max 3 claims per wallet per 10 minutes
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const MAX_CLAIMS = 3;
const claimLog: Map<string, number[]> = new Map();

function isRateLimited(wallet: string): boolean {
  const now = Date.now();
  const claims = claimLog.get(wallet) || [];
  const recent = claims.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  claimLog.set(wallet, recent);
  if (recent.length >= MAX_CLAIMS) return true;
  recent.push(now);
  claimLog.set(wallet, recent);
  return false;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { walletAddress } = req.body;
  if (!walletAddress || typeof walletAddress !== "string") {
    return res.status(400).json({ error: "walletAddress is required" });
  }

  if (isRateLimited(walletAddress)) {
    return res.status(429).json({ error: "Rate limited. Max 3 claims per 10 minutes." });
  }

  const authoritySecret = process.env.GATE_MINT_AUTHORITY;
  if (!authoritySecret) {
    return res.status(500).json({ error: "Faucet not configured: missing GATE_MINT_AUTHORITY" });
  }

  const gateMintStr = process.env.NEXT_PUBLIC_GATE_MINT;
  if (!gateMintStr) {
    return res.status(500).json({ error: "Faucet not configured: missing NEXT_PUBLIC_GATE_MINT" });
  }

  try {
    // Support both formats:
    // 1. Raw JSON array from keypair file: [174,47,154,...]
    // 2. Base64-encoded JSON array
    const keyString = authoritySecret.trimStart().startsWith("[")
      ? authoritySecret
      : Buffer.from(authoritySecret, "base64").toString("utf-8");
    const secretKey = Uint8Array.from(JSON.parse(keyString));
    const mintAuthority = Keypair.fromSecretKey(secretKey);
    const gateMint = new PublicKey(gateMintStr);
    const recipient = new PublicKey(walletAddress);

    const connection = new Connection(
      process.env.NEXT_PUBLIC_SOLANA_RPC || clusterApiUrl("devnet"),
      "confirmed"
    );

    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      mintAuthority,
      gateMint,
      recipient
    );

    const txSignature = await mintTo(
      connection,
      mintAuthority,
      gateMint,
      tokenAccount.address,
      mintAuthority,
      10 // mint 10 tokens
    );

    return res.status(200).json({
      success: true,
      tokenAccount: tokenAccount.address.toBase58(),
      txSignature,
    });
  } catch (error: any) {
    console.error("Faucet error:", error);
    return res.status(500).json({
      error: error.message || "Failed to mint tokens",
    });
  }
}
