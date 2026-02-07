import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair, Connection } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import {
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

const PROGRAM_ID = new PublicKey(
  "71tbXM3A2j5pKHfjtu1LYgY8jfQWuoZtHecDu6F6EPJH"
);

// From setup-devnet.ts output
const GATE_MINT = new PublicKey(
  "6JeDjgobNYjSzuUUyEaiNnzphBDgVYcwf3u9HLNtPu17"
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

  console.log("=== Private DAO Voting - Devnet Full Flow Test ===\n");
  console.log("Wallet:", payer.publicKey.toString());
  const balance = await connection.getBalance(payer.publicKey);
  console.log("Balance:", balance / 1e9, "SOL\n");

  // Use a unique proposal ID based on timestamp
  const proposalId = new anchor.BN(Date.now());

  // ── Step 1: Create Proposal (dev mode) ──
  console.log("--- Step 1: Create Proposal (dev mode) ---");

  const [proposalPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("proposal"), proposalId.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  );
  console.log("Proposal PDA:", proposalPda.toString());

  // Voting ends 20 seconds from now (short window for testing)
  const votingEndsAt = new anchor.BN(Math.floor(Date.now() / 1000) + 20);

  try {
    const tx = await program.methods
      .devCreateProposal(
        proposalId,
        "Test Proposal #1",
        "Should we adopt the new governance framework?",
        votingEndsAt,
        GATE_MINT,
        new anchor.BN(1) // min 1 token to vote
      )
      .accounts({
        authority: payer.publicKey,
        proposal: proposalPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([payer])
      .rpc();

    console.log("TX:", tx);
    console.log("Proposal created!\n");
  } catch (err: any) {
    console.error("Failed:", err.message);
    if (err.logs) console.error("Logs:", err.logs.join("\n"));
    return;
  }

  // ── Step 2: Initialize Tally (dev mode) ──
  console.log("--- Step 2: Initialize Tally (dev mode) ---");

  const [tallyPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("tally"), proposalPda.toBuffer()],
    PROGRAM_ID
  );
  console.log("Tally PDA:", tallyPda.toString());

  try {
    const tx = await program.methods
      .devInitTally()
      .accounts({
        authority: payer.publicKey,
        proposal: proposalPda,
        tally: tallyPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([payer])
      .rpc();

    console.log("TX:", tx);
    console.log("Tally initialized!\n");
  } catch (err: any) {
    console.error("Failed:", err.message);
    if (err.logs) console.error("Logs:", err.logs.join("\n"));
    return;
  }

  // ── Step 3: Cast Vote (dev mode) ──
  console.log("--- Step 3: Cast Vote (dev mode) ---");

  const [voteRecordPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("vote_record"),
      proposalPda.toBuffer(),
      payer.publicKey.toBuffer(),
    ],
    PROGRAM_ID
  );
  console.log("VoteRecord PDA:", voteRecordPda.toString());

  // Get the voter's token account for the gate mint
  const tokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    GATE_MINT,
    payer.publicKey
  );
  console.log("Token Account:", tokenAccount.address.toString());
  console.log("Token Balance:", tokenAccount.amount.toString());

  // Simulated encrypted vote (YES = 1)
  const encryptedChoice = new Uint8Array(32);
  encryptedChoice[0] = 1; // YES vote
  const nonce = new Uint8Array(16);
  crypto.getRandomValues(nonce);
  const voterPubkey = payer.publicKey.toBytes();

  try {
    const tx = await program.methods
      .devCastVote(
        Array.from(encryptedChoice),
        Array.from(nonce),
        Array.from(voterPubkey)
      )
      .accounts({
        voter: payer.publicKey,
        proposal: proposalPda,
        tally: tallyPda,
        voterTokenAccount: tokenAccount.address,
        voteRecord: voteRecordPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([payer])
      .rpc();

    console.log("TX:", tx);
    console.log("Vote cast!\n");
  } catch (err: any) {
    console.error("Failed:", err.message);
    if (err.logs) console.error("Logs:", err.logs.join("\n"));
    return;
  }

  // ── Step 4: Verify On-Chain State ──
  console.log("--- Step 4: Verify On-Chain State ---");

  try {
    const proposalData = await (program.account as any).proposal.fetch(proposalPda);
    console.log("Proposal title:", proposalData.title);
    console.log("Proposal active:", proposalData.isActive);
    console.log("Total votes:", proposalData.totalVotes);
    console.log("Gate mint:", proposalData.gateMint.toString());
    console.log("Min balance:", proposalData.minBalance.toString());

    const tallyData = await (program.account as any).tally.fetch(tallyPda);
    console.log("Tally proposal:", tallyData.proposal.toString());

    const voteRecordData = await (program.account as any).voteRecord.fetch(
      voteRecordPda
    );
    console.log("VoteRecord voter:", voteRecordData.voter.toString());
    console.log("VoteRecord voted_at:", voteRecordData.votedAt.toString());
    console.log("");
  } catch (err: any) {
    console.error("Failed to fetch:", err.message);
    return;
  }

  // ── Step 5: Test Double-Vote Prevention ──
  console.log("--- Step 5: Test Double-Vote Prevention ---");

  try {
    await program.methods
      .devCastVote(
        Array.from(new Uint8Array(32)),
        Array.from(new Uint8Array(16)),
        Array.from(payer.publicKey.toBytes())
      )
      .accounts({
        voter: payer.publicKey,
        proposal: proposalPda,
        tally: tallyPda,
        voterTokenAccount: tokenAccount.address,
        voteRecord: voteRecordPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([payer])
      .rpc();

    console.error("ERROR: Double vote should have been rejected!");
  } catch (err: any) {
    console.log("Double-vote correctly rejected:", err.message.slice(0, 80));
    console.log("");
  }

  // ── Step 6: Wait for Voting to End, Then Reveal ──
  console.log("--- Step 6: Reveal Results (dev mode) ---");

  const now = Math.floor(Date.now() / 1000);
  const endsAt = votingEndsAt.toNumber();
  const waitTime = endsAt - now;

  if (waitTime > 0) {
    console.log(`Waiting ${waitTime + 2} seconds for voting period to end...`);
    await new Promise((resolve) =>
      setTimeout(resolve, (waitTime + 2) * 1000)
    );
  }

  try {
    const tx = await program.methods
      .devRevealResults(1, 0, 0) // 1 yes, 0 no, 0 abstain
      .accounts({
        authority: payer.publicKey,
        proposal: proposalPda,
      })
      .signers([payer])
      .rpc();

    console.log("TX:", tx);
    console.log("Results revealed!\n");
  } catch (err: any) {
    console.error("Failed:", err.message);
    if (err.logs) console.error("Logs:", err.logs.join("\n"));
    return;
  }

  // ── Step 7: Verify Final State ──
  console.log("--- Step 7: Final State ---");

  try {
    const finalProposal = await (program.account as any).proposal.fetch(proposalPda);
    console.log("Proposal revealed:", finalProposal.isRevealed);
    console.log("Proposal active:", finalProposal.isActive);
    console.log("YES votes:", finalProposal.yesVotes);
    console.log("NO votes:", finalProposal.noVotes);
    console.log("Abstain:", finalProposal.abstainVotes);
    console.log("Total votes:", finalProposal.totalVotes);
    console.log("");
  } catch (err: any) {
    console.error("Failed to fetch:", err.message);
    return;
  }

  console.log("=== ALL TESTS PASSED ===");
  console.log("\nDevnet values:");
  console.log("  PROGRAM_ID:", PROGRAM_ID.toString());
  console.log("  GATE_MINT:", GATE_MINT.toString());
  console.log("  PROPOSAL_PDA:", proposalPda.toString());
  console.log("  TALLY_PDA:", tallyPda.toString());
}

main().catch(console.error);
