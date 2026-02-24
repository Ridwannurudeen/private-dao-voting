import { PublicKey, SystemProgram } from "@solana/web3.js";
import { Program, AnchorProvider, BN, Idl } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { withRetry } from "./retry";

// Deployed program ID
export const PROGRAM_ID = new PublicKey("71tbXM3A2j5pKHfjtu1LYgY8jfQWuoZtHecDu6F6EPJH");

// Default gate mint from devnet setup (env-configurable)
export const DEFAULT_GATE_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_GATE_MINT || "6JeDjgobNYjSzuUUyEaiNnzphBDgVYcwf3u9HLNtPu17"
);

const TX_OPTS = { commitment: "confirmed" as const };

// Anchor 0.32 calls `new SendTransactionError(msg, logs)` (positional),
// but @solana/web3.js >=1.95 expects `{ action, signature, transactionMessage, logs }`.
// This mismatch produces "Unknown action 'undefined'" and loses the real error.
// Wrapper to catch and re-throw with the original error info preserved.
async function rpcWithErrorFix<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    const msg = err?.message || "";
    const logs: string[] | undefined = err?.logs || err?.transactionLogs;
    if (msg.includes("Unknown action")) {
      // Extract meaningful error from transaction logs
      const logError = logs?.find((l: string) =>
        l.includes("Error") || l.includes("failed") || l.includes("custom program error")
      );
      const wrapped = new Error(
        logError?.replace(/^Program log: /, "") ||
        err?.transactionMessage ||
        "Transaction failed on-chain. Check account state and token balance."
      );
      (wrapped as any).logs = logs;
      throw wrapped;
    }
    // Attach logs to any error for better debugging
    if (logs && !err.logs) err.logs = logs;
    throw err;
  }
}

// PDA helpers
export function findProposalPDA(proposalId: BN): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("proposal"), proposalId.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  );
}

export function findTallyPDA(proposal: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("tally"), proposal.toBuffer()],
    PROGRAM_ID
  );
}

export function findVoteRecordPDA(proposal: PublicKey, voter: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vote_record"), proposal.toBuffer(), voter.toBuffer()],
    PROGRAM_ID
  );
}

export function findComputationOffsetPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("computation_offset")],
    PROGRAM_ID
  );
}

// Get program instance from the generated IDL
export function getProgram(provider: AnchorProvider, idl: Idl): Program {
  return new Program(idl, provider);
}

// Dev mode: Create proposal (no Arcium accounts needed)
export async function devCreateProposal(
  program: Program,
  authority: PublicKey,
  title: string,
  description: string,
  durationSeconds: number,
  gateMint: PublicKey,
  minBalance: BN,
  quorum: BN = new BN(0),
  thresholdBps: number = 5001,
  privacyLevel: number = 0,
  discussionUrl: string = "",
  executionDelay: number = 0
): Promise<{ tx: string; proposalId: BN; proposalPDA: PublicKey }> {
  const proposalId = new BN(Date.now());
  const [proposalPDA] = findProposalPDA(proposalId);
  const votingEndsAt = new BN(Math.floor(Date.now() / 1000) + durationSeconds);

  const tx = await rpcWithErrorFix(() =>
    program.methods
      .devCreateProposal(
        proposalId,
        title,
        description,
        votingEndsAt,
        gateMint,
        minBalance
      )
      .accounts({
        authority,
        proposal: proposalPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc(TX_OPTS)
  );

  return { tx, proposalId, proposalPDA };
}

// Delegation helpers
export function findDelegationPDA(delegator: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("delegation"), delegator.toBuffer()],
    PROGRAM_ID
  );
}

export async function delegateVote(
  program: Program,
  delegator: PublicKey,
  delegate: PublicKey
): Promise<string> {
  const [delegationPDA] = findDelegationPDA(delegator);
  return await rpcWithErrorFix(() =>
    program.methods
      .delegateVote()
      .accounts({
        delegator,
        delegate,
        delegation: delegationPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc(TX_OPTS)
  );
}

export async function revokeDelegation(
  program: Program,
  delegator: PublicKey
): Promise<string> {
  const [delegationPDA] = findDelegationPDA(delegator);
  return await rpcWithErrorFix(() =>
    program.methods
      .revokeDelegation()
      .accounts({
        delegator,
        delegation: delegationPDA,
      })
      .rpc(TX_OPTS)
  );
}

export async function getDelegation(
  program: Program,
  delegator: PublicKey
): Promise<{ delegate: PublicKey; createdAt: number } | null> {
  const [delegationPDA] = findDelegationPDA(delegator);
  try {
    const data: any = await withRetry(() => (program.account as any).delegation.fetch(delegationPDA));
    return { delegate: data.delegate, createdAt: data.createdAt?.toNumber() ?? 0 };
  } catch {
    return null;
  }
}

// Dev mode: Initialize tally for a proposal
export async function devInitTally(
  program: Program,
  authority: PublicKey,
  proposalPDA: PublicKey
): Promise<string> {
  const [tallyPDA] = findTallyPDA(proposalPDA);

  return await rpcWithErrorFix(() =>
    program.methods
      .devInitTally()
      .accounts({
        authority,
        proposal: proposalPDA,
        tally: tallyPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc(TX_OPTS)
  );
}

/**
 * Ensure the tally account exists for a proposal. If missing, initialize it.
 * Any signer can pay for the account creation.
 */
export async function ensureTallyInitialized(
  program: Program,
  payer: PublicKey,
  proposalPDA: PublicKey
): Promise<void> {
  const [tallyPDA] = findTallyPDA(proposalPDA);
  const info = await program.provider.connection.getAccountInfo(tallyPDA);
  if (!info) {
    await devInitTally(program, payer, proposalPDA);
  }
}

// Dev mode: Cast vote (token gating still enforced)
export async function devCastVote(
  program: Program,
  voter: PublicKey,
  proposalPDA: PublicKey,
  gateMint: PublicKey,
  encryptedChoice: number[],
  nonce: number[],
  voterPubkey: number[],
): Promise<string> {
  const [tallyPDA] = findTallyPDA(proposalPDA);
  const [voteRecordPDA] = findVoteRecordPDA(proposalPDA, voter);
  const voterTokenAccount = getAssociatedTokenAddressSync(gateMint, voter);

  return await rpcWithErrorFix(() =>
    program.methods
      .devCastVote(encryptedChoice, nonce, voterPubkey)
      .accounts({
        voter,
        proposal: proposalPDA,
        tally: tallyPDA,
        voterTokenAccount,
        voteRecord: voteRecordPDA,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc(TX_OPTS)
  );
}

// Production mode: Cast vote with full Arcium MXE accounts
export async function castVoteWithArcium(
  program: Program,
  voter: PublicKey,
  proposalPDA: PublicKey,
  gateMint: PublicKey,
  encryptedChoice: number[],
  nonce: number[],
  voterPubkey: number[],
  arciumAccounts: {
    arciumProgram: PublicKey;
    mxeAccount: PublicKey;
    clusterAccount: PublicKey;
    mempoolAccount: PublicKey;
    executingPool: PublicKey;
    computationAccount: PublicKey;
    compDefAccount: PublicKey;
    poolAccount: PublicKey;
    clockAccount: PublicKey;
    signSeed: PublicKey;
  }
): Promise<string> {
  const [tallyPDA] = findTallyPDA(proposalPDA);
  const [voteRecordPDA] = findVoteRecordPDA(proposalPDA, voter);
  const voterTokenAccount = getAssociatedTokenAddressSync(gateMint, voter);
  const [computationOffsetPDA] = findComputationOffsetPDA();

  return await rpcWithErrorFix(() =>
    program.methods
      .castVote(encryptedChoice, nonce, voterPubkey)
      .accounts({
        voter,
        proposal: proposalPDA,
        tally: tallyPDA,
        voterTokenAccount,
        voteRecord: voteRecordPDA,
        computationOffsetAccount: computationOffsetPDA,
        signSeed: arciumAccounts.signSeed,
        arciumProgram: arciumAccounts.arciumProgram,
        mxeAccount: arciumAccounts.mxeAccount,
        clusterAccount: arciumAccounts.clusterAccount,
        mempoolAccount: arciumAccounts.mempoolAccount,
        executingPool: arciumAccounts.executingPool,
        computationAccount: arciumAccounts.computationAccount,
        compDefAccount: arciumAccounts.compDefAccount,
        poolAccount: arciumAccounts.poolAccount,
        clockAccount: arciumAccounts.clockAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc(TX_OPTS)
  );
}

// Dev mode: Reveal results (authority only, after voting ends)
export async function devRevealResults(
  program: Program,
  authority: PublicKey,
  proposalPDA: PublicKey,
  yesCount: number,
  noCount: number,
  abstainCount: number
): Promise<string> {
  return await rpcWithErrorFix(() =>
    program.methods
      .devRevealResults(yesCount, noCount, abstainCount)
      .accounts({
        authority,
        proposal: proposalPDA,
      })
      .rpc(TX_OPTS)
  );
}

// Fetch all proposals (with retry)
export async function fetchAllProposals(program: Program): Promise<any[]> {
  const all: any[] = await withRetry(() => (program.account as any).proposal.all());
  return all.map((p: any) => ({ publicKey: p.publicKey, ...p.account }));
}

// Check if user has voted on a proposal (with retry)
export async function hasUserVoted(
  program: Program,
  proposalPDA: PublicKey,
  voter: PublicKey
): Promise<boolean> {
  const [voteRecordPDA] = findVoteRecordPDA(proposalPDA, voter);
  try {
    await withRetry(() => (program.account as any).voteRecord.fetch(voteRecordPDA));
    return true;
  } catch {
    return false;
  }
}
