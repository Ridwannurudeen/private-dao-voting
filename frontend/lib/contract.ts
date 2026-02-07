import { PublicKey, SystemProgram } from "@solana/web3.js";
import { Program, AnchorProvider, BN, Idl } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";

// Deployed program ID
export const PROGRAM_ID = new PublicKey("71tbXM3A2j5pKHfjtu1LYgY8jfQWuoZtHecDu6F6EPJH");

// Default gate mint from devnet setup (env-configurable)
export const DEFAULT_GATE_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_GATE_MINT || "6JeDjgobNYjSzuUUyEaiNnzphBDgVYcwf3u9HLNtPu17"
);

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
  minBalance: BN
): Promise<{ tx: string; proposalId: BN; proposalPDA: PublicKey }> {
  const proposalId = new BN(Date.now());
  const [proposalPDA] = findProposalPDA(proposalId);
  const votingEndsAt = new BN(Math.floor(Date.now() / 1000) + durationSeconds);

  const tx = await program.methods
    .devCreateProposal(proposalId, title, description, votingEndsAt, gateMint, minBalance)
    .accounts({
      authority,
      proposal: proposalPDA,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  return { tx, proposalId, proposalPDA };
}

// Dev mode: Initialize tally for a proposal
export async function devInitTally(
  program: Program,
  authority: PublicKey,
  proposalPDA: PublicKey
): Promise<string> {
  const [tallyPDA] = findTallyPDA(proposalPDA);

  return await program.methods
    .devInitTally()
    .accounts({
      authority,
      proposal: proposalPDA,
      tally: tallyPDA,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
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

  return await program.methods
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
    .rpc();
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

  return await program.methods
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
    .rpc();
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
  return await program.methods
    .devRevealResults(yesCount, noCount, abstainCount)
    .accounts({
      authority,
      proposal: proposalPDA,
    })
    .rpc();
}

// Fetch all proposals
export async function fetchAllProposals(program: Program): Promise<any[]> {
  const all = await (program.account as any).proposal.all();
  return all.map((p: any) => ({ publicKey: p.publicKey, ...p.account }));
}

// Check if user has voted on a proposal
export async function hasUserVoted(
  program: Program,
  proposalPDA: PublicKey,
  voter: PublicKey
): Promise<boolean> {
  const [voteRecordPDA] = findVoteRecordPDA(proposalPDA, voter);
  try {
    await (program.account as any).voteRecord.fetch(voteRecordPDA);
    return true;
  } catch {
    return false;
  }
}
