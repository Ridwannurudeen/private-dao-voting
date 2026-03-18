import { PublicKey, SystemProgram } from "@solana/web3.js";
import { Program, AnchorProvider, BN, Idl } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { withRetry } from "./retry";
import { parseAnchorError } from "./errors";

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
      const rawMessage =
        logError?.replace(/^Program log: /, "") ||
        err?.transactionMessage ||
        "Transaction failed on-chain. Check account state and token balance.";
      const wrapped = new Error(parseAnchorError(rawMessage));
      (wrapped as any).logs = logs;
      throw wrapped;
    }
    // Attach logs to any error for better debugging
    if (logs && !err.logs) err.logs = logs;
    // Map the error message to a friendly one before re-throwing
    const friendly = parseAnchorError(err);
    if (friendly !== msg) {
      const mapped = new Error(friendly);
      (mapped as any).logs = err.logs;
      throw mapped;
    }
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

export function findProgramConfigPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("program_config")],
    PROGRAM_ID
  );
}

export function findDaoConfigPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("dao_config")],
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

  const [programConfigPDA] = findProgramConfigPDA();

  const tx = await rpcWithErrorFix(() =>
    program.methods
      .devCreateProposal(
        proposalId,
        title,
        description,
        votingEndsAt,
        gateMint,
        minBalance,
        quorum,
        thresholdBps,
        privacyLevel,
        discussionUrl,
        new BN(executionDelay)
      )
      .accounts({
        authority,
        proposal: proposalPDA,
        programConfig: programConfigPDA,
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
  const [programConfigPDA] = findProgramConfigPDA();

  return await rpcWithErrorFix(() =>
    program.methods
      .devCastVote(encryptedChoice, nonce, voterPubkey)
      .accounts({
        voter,
        proposal: proposalPDA,
        tally: tallyPDA,
        voterTokenAccount,
        voteRecord: voteRecordPDA,
        delegationAccount: findDelegationPDA(voter)[0],
        programConfig: programConfigPDA,
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
        delegationAccount: findDelegationPDA(voter)[0],
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

// Production mode: Reveal results with full Arcium MXE accounts
export async function revealResultsWithArcium(
  program: Program,
  authority: PublicKey,
  proposalPDA: PublicKey,
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
  const [computationOffsetPDA] = findComputationOffsetPDA();

  return await rpcWithErrorFix(() =>
    program.methods
      .revealResults()
      .accounts({
        authority,
        proposal: proposalPDA,
        tally: tallyPDA,
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
        computationOffsetAccount: computationOffsetPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc(TX_OPTS)
  );
}

// Cancel a proposal (authority only, before voting ends or if no votes cast)
export async function cancelProposal(
  program: Program,
  authority: PublicKey,
  proposalPDA: PublicKey
): Promise<string> {
  return await rpcWithErrorFix(() =>
    program.methods
      .cancelProposal()
      .accounts({
        authority,
        proposal: proposalPDA,
      })
      .rpc(TX_OPTS)
  );
}

// Dev mode: Reveal results (permissionless after voting ends)
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
      .devRevealResults(new BN(yesCount), new BN(noCount), new BN(abstainCount))
      .accounts({
        authority,
        proposal: proposalPDA,
        tally: findTallyPDA(proposalPDA)[0],
      })
      .rpc(TX_OPTS)
  );
}

// Fetch proposals with pagination support.
// Anchor's .all() loads every account — this wrapper adds sorting and slicing
// so callers can request a specific page without processing the full set themselves.
export async function fetchProposals(
  program: Program,
  opts?: {
    page?: number;
    perPage?: number;
  }
): Promise<{ proposals: any[]; total: number }> {
  const page = opts?.page ?? 1;
  const perPage = opts?.perPage ?? 10;

  const all: any[] = await withRetry(() => (program.account as any).proposal.all());
  const sorted = all
    .map((p: any) => ({ publicKey: p.publicKey, ...p.account }))
    .sort((a: any, b: any) => {
      // Sort by creation time descending (newest first)
      const aTime = a.createdAt?.toNumber?.() ?? a.created_at?.toNumber?.() ?? 0;
      const bTime = b.createdAt?.toNumber?.() ?? b.created_at?.toNumber?.() ?? 0;
      return bTime - aTime;
    });

  const total = sorted.length;
  const start = (page - 1) * perPage;
  const proposals = sorted.slice(start, start + perPage);

  return { proposals, total };
}

// Fetch all proposals sorted by creation time (newest first).
// For large sets, prefer fetchProposals() with pagination.
/** @deprecated Use fetchProposals() with pagination instead */
export async function fetchAllProposals(program: Program): Promise<any[]> {
  const all: any[] = await withRetry(() => (program.account as any).proposal.all());
  return all
    .map((p: any) => ({ publicKey: p.publicKey, ...p.account }))
    .sort((a: any, b: any) => {
      const aTime = a.createdAt?.toNumber?.() ?? a.created_at?.toNumber?.() ?? 0;
      const bTime = b.createdAt?.toNumber?.() ?? b.created_at?.toNumber?.() ?? 0;
      return bTime - aTime;
    });
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

// ==================== PROGRAM CONFIG (MAINNET READINESS) ====================

export interface ProgramConfigData {
  authority: PublicKey;
  isFrozen: boolean;
  createdAt: number;
}

// Initialize ProgramConfig PDA (one-time setup)
export async function initProgramConfig(
  program: Program,
  authority: PublicKey
): Promise<string> {
  const [programConfigPDA] = findProgramConfigPDA();

  return await rpcWithErrorFix(() =>
    program.methods
      .initProgramConfig()
      .accounts({
        authority,
        programConfig: programConfigPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc(TX_OPTS)
  );
}

// Transfer program authority to a new address (e.g., Squads multisig)
export async function transferAuthority(
  program: Program,
  authority: PublicKey,
  newAuthority: PublicKey
): Promise<string> {
  const [programConfigPDA] = findProgramConfigPDA();

  return await rpcWithErrorFix(() =>
    program.methods
      .transferAuthority(newAuthority)
      .accounts({
        authority,
        programConfig: programConfigPDA,
      })
      .rpc(TX_OPTS)
  );
}

// Freeze the program (authority only)
export async function freezeProgram(
  program: Program,
  authority: PublicKey
): Promise<string> {
  const [programConfigPDA] = findProgramConfigPDA();

  return await rpcWithErrorFix(() =>
    program.methods
      .freezeProgram()
      .accounts({
        authority,
        programConfig: programConfigPDA,
      })
      .rpc(TX_OPTS)
  );
}

// Unfreeze the program (authority only)
export async function unfreezeProgram(
  program: Program,
  authority: PublicKey
): Promise<string> {
  const [programConfigPDA] = findProgramConfigPDA();

  return await rpcWithErrorFix(() =>
    program.methods
      .unfreezeProgram()
      .accounts({
        authority,
        programConfig: programConfigPDA,
      })
      .rpc(TX_OPTS)
  );
}

// Fetch ProgramConfig data (returns null if not initialized)
export async function fetchProgramConfig(
  program: Program
): Promise<ProgramConfigData | null> {
  const [programConfigPDA] = findProgramConfigPDA();
  try {
    const data: any = await withRetry(() =>
      (program.account as any).programConfig.fetch(programConfigPDA)
    );
    return {
      authority: data.authority,
      isFrozen: data.isFrozen ?? data.is_frozen ?? false,
      createdAt: data.createdAt?.toNumber?.() ?? data.created_at?.toNumber?.() ?? 0,
    };
  } catch {
    return null;
  }
}

// ==================== DAO CONFIG (COMMUNITY GOVERNANCE) ====================

export interface DaoConfigData {
  authority: PublicKey;
  depositMint: PublicKey;
  proposalDeposit: number;
  treasury: PublicKey;
  slashIfNoQuorum: boolean;
  governanceMint: PublicKey;
  minProposerBalance: number;
}

// Initialize DaoConfig PDA (one-time setup by deployer/admin)
export async function initDaoConfig(
  program: Program,
  authority: PublicKey,
  depositMint: PublicKey,
  proposalDeposit: BN,
  treasury: PublicKey,
  slashIfNoQuorum: boolean,
  governanceMint: PublicKey,
  minProposerBalance: BN
): Promise<string> {
  const [daoConfigPDA] = findDaoConfigPDA();

  return await rpcWithErrorFix(() =>
    program.methods
      .initDaoConfig(
        depositMint,
        proposalDeposit,
        treasury,
        slashIfNoQuorum,
        governanceMint,
        minProposerBalance
      )
      .accounts({
        authority,
        daoConfig: daoConfigPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc(TX_OPTS)
  );
}

// Update DaoConfig (admin only, all fields optional)
export async function updateDaoConfig(
  program: Program,
  authority: PublicKey,
  updates: {
    depositMint?: PublicKey | null;
    proposalDeposit?: BN | null;
    treasury?: PublicKey | null;
    slashIfNoQuorum?: boolean | null;
    governanceMint?: PublicKey | null;
    minProposerBalance?: BN | null;
  }
): Promise<string> {
  const [daoConfigPDA] = findDaoConfigPDA();

  return await rpcWithErrorFix(() =>
    program.methods
      .updateDaoConfig(
        updates.depositMint ?? null,
        updates.proposalDeposit ?? null,
        updates.treasury ?? null,
        updates.slashIfNoQuorum ?? null,
        updates.governanceMint ?? null,
        updates.minProposerBalance ?? null
      )
      .accounts({
        authority,
        daoConfig: daoConfigPDA,
      })
      .rpc(TX_OPTS)
  );
}

// Fetch DaoConfig data (returns null if not initialized)
export async function fetchDaoConfig(
  program: Program
): Promise<DaoConfigData | null> {
  const [daoConfigPDA] = findDaoConfigPDA();
  try {
    const data: any = await withRetry(() =>
      (program.account as any).daoConfig.fetch(daoConfigPDA)
    );
    return {
      authority: data.authority,
      depositMint: data.depositMint ?? data.deposit_mint,
      proposalDeposit: (data.proposalDeposit ?? data.proposal_deposit)?.toNumber?.() ?? 0,
      treasury: data.treasury,
      slashIfNoQuorum: data.slashIfNoQuorum ?? data.slash_if_no_quorum ?? false,
      governanceMint: data.governanceMint ?? data.governance_mint,
      minProposerBalance: (data.minProposerBalance ?? data.min_proposer_balance)?.toNumber?.() ?? 0,
    };
  } catch {
    return null;
  }
}

// Community proposal creation: any wallet with sufficient governance tokens
// can create a proposal. Requires DaoConfig to be initialized.
export async function communityCreateProposal(
  program: Program,
  proposer: PublicKey,
  title: string,
  description: string,
  durationSeconds: number,
  gateMint: PublicKey,
  minBalance: BN,
  governanceMint: PublicKey,
  quorum: BN = new BN(0),
  thresholdBps: number = 5001,
  privacyLevel: number = 0,
  discussionUrl: string = "",
  executionDelay: number = 0
): Promise<{ tx: string; proposalId: BN; proposalPDA: PublicKey }> {
  const proposalId = new BN(Date.now());
  const [proposalPDA] = findProposalPDA(proposalId);
  const [daoConfigPDA] = findDaoConfigPDA();
  const votingEndsAt = new BN(Math.floor(Date.now() / 1000) + durationSeconds);
  const proposerTokenAccount = getAssociatedTokenAddressSync(governanceMint, proposer);

  const tx = await rpcWithErrorFix(() =>
    program.methods
      .communityCreateProposal(
        proposalId,
        title,
        description,
        votingEndsAt,
        gateMint,
        minBalance,
        quorum,
        thresholdBps,
        privacyLevel,
        discussionUrl,
        new BN(executionDelay)
      )
      .accounts({
        proposer,
        proposal: proposalPDA,
        daoConfig: daoConfigPDA,
        proposerTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc(TX_OPTS)
  );

  return { tx, proposalId, proposalPDA };
}
