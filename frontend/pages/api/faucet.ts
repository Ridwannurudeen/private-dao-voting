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

function isRateLimited(key: string): boolean {
  // Evict expired entries if map grows too large
  if (claimLog.size > 10000) {
    const now = Date.now();
    for (const [k, timestamps] of claimLog) {
      const valid = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
      if (valid.length === 0) claimLog.delete(k);
      else claimLog.set(k, valid);
    }
  }

  const now = Date.now();
  const claims = claimLog.get(key) || [];
  const recent = claims.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  claimLog.set(key, recent);
  if (recent.length >= MAX_CLAIMS) return true;
  recent.push(now);
  claimLog.set(key, recent);
  return false;
}

function recordClaim(key: string): void {
  const now = Date.now();
  const claims = claimLog.get(key) || [];
  claims.push(now);
  claimLog.set(key, claims);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const origin = req.headers.origin || req.headers.referer || "";
  const allowedOrigins = ["http://localhost:3000", "https://privatedao-arcium.vercel.app"];
  if (!allowedOrigins.some(o => origin.startsWith(o))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  // gateMint is intentionally server-controlled, not client-supplied
  const { walletAddress } = req.body;
  if (!walletAddress || typeof walletAddress !== "string") {
    return res.status(400).json({ error: "walletAddress is required" });
  }

  const clientIP = (req.headers["x-forwarded-for"]?.toString().split(",")[0] || req.socket.remoteAddress || "unknown").trim();
  if (isRateLimited(`ip:${clientIP}`)) {
    return res.status(429).json({ error: "Too many requests. Please try again later." });
  }

  if (isRateLimited(walletAddress)) {
    return res.status(429).json({ error: "Rate limited. Max 3 claims per 10 minutes." });
  }

  recordClaim(`ip:${clientIP}`);

  const authoritySecret = process.env.GATE_MINT_AUTHORITY;
  if (!authoritySecret) {
    return res.status(500).json({ error: "Faucet is temporarily unavailable." });
  }

  // Always use the configured gate mint — the authority keypair can only mint this token
  const gateMintStr = process.env.NEXT_PUBLIC_GATE_MINT;
  if (!gateMintStr) {
    return res.status(500).json({ error: "Faucet is temporarily unavailable." });
  }

  // Validate the gate mint is a valid public key
  try {
    new PublicKey(gateMintStr);
  } catch {
    return res.status(400).json({ error: "Invalid gate mint address" });
  }

  // Validate walletAddress is a valid Solana public key before proceeding
  let recipient: PublicKey;
  try {
    recipient = new PublicKey(walletAddress);
    // Reject zero address and system program
    if (recipient.equals(PublicKey.default)) {
      return res.status(400).json({ error: "Invalid wallet address" });
    }
  } catch {
    return res.status(400).json({ error: "Invalid wallet address: not a valid base58 public key" });
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

    const connection = new Connection(
      process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.devnet.solana.com",
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
      error: "Failed to mint tokens. Please try again later.",
    });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "1kb",
    },
  },
};
