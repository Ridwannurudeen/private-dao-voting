import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair, Connection } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

const PROGRAM_ID = new PublicKey(
  "71tbXM3A2j5pKHfjtu1LYgY8jfQWuoZtHecDu6F6EPJH"
);

async function main() {
  // Setup connection and wallet
  const connection = new Connection(
    "https://api.devnet.solana.com",
    "confirmed"
  );
  const walletPath = os.homedir() + "/.config/solana/id.json";
  const secretKey = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
  const payer = Keypair.fromSecretKey(Uint8Array.from(secretKey));
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  // Load IDL and create program
  const idl = JSON.parse(
    fs.readFileSync("./target/idl/private_dao_voting.json", "utf-8")
  );
  const program = new anchor.Program(idl, provider);

  console.log("=== Private DAO Voting - Devnet Setup ===\n");
  console.log("Wallet:", payer.publicKey.toString());
  const balance = await connection.getBalance(payer.publicKey);
  console.log("Balance:", balance / 1e9, "SOL\n");

  // ── Step 1: Initialize Computation Offset PDA ──
  console.log("--- Step 1: Initialize Computation Offset PDA ---");

  const [computationOffsetPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("computation_offset")],
    PROGRAM_ID
  );
  console.log("PDA:", computationOffsetPda.toString());

  const existing = await connection.getAccountInfo(computationOffsetPda);
  if (existing) {
    console.log("Already initialized! Skipping.\n");
  } else {
    try {
      const tx = await program.methods
        .initComputationOffset()
        .accounts({
          payer: payer.publicKey,
          computationOffsetAccount: computationOffsetPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer])
        .rpc();
      console.log("TX:", tx);
      console.log("Initialized successfully!\n");
    } catch (err: any) {
      console.error("Failed:", err.message, "\n");
    }
  }

  // ── Step 2: Create SPL Token for Vote Gating ──
  console.log("--- Step 2: Create SPL Token for Vote Gating ---");

  try {
    // Create a new token mint
    const mintAuthority = payer;
    const mint = await createMint(
      connection,
      payer,
      mintAuthority.publicKey, // mint authority
      null, // freeze authority
      0 // 0 decimals (whole tokens only)
    );
    console.log("Token Mint:", mint.toString());

    // Create token account for the payer (test voter)
    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mint,
      payer.publicKey
    );
    console.log("Token Account:", tokenAccount.address.toString());

    // Mint 100 tokens to the payer for testing
    const mintTx = await mintTo(
      connection,
      payer,
      mint,
      tokenAccount.address,
      mintAuthority,
      100
    );
    console.log("Minted 100 tokens. TX:", mintTx);

    console.log("\n=== Setup Complete ===\n");
    console.log("Save these values for your frontend/tests:");
    console.log("  PROGRAM_ID:", PROGRAM_ID.toString());
    console.log("  GATE_MINT:", mint.toString());
    console.log("  TOKEN_ACCOUNT:", tokenAccount.address.toString());
    console.log("  COMPUTATION_OFFSET_PDA:", computationOffsetPda.toString());
  } catch (err: any) {
    console.error("Token creation failed:", err.message);
  }
}

main().catch(console.error);
