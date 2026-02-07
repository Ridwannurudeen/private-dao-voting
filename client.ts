/**
 * Private DAO Voting - TypeScript Client
 *
 * This module provides the client-side logic for:
 * 1. Generating/retrieving shared secrets for vote encryption
 * 2. Encrypting votes before submission
 * 3. Interacting with the Solana program and Arcium MXE
 */

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { Program, AnchorProvider, BN, Idl } from "@coral-xyz/anchor";
import {
  ArciumClient,
  SharedSecretManager,
  EncryptionContext,
  MXEConfig,
} from "@arcium/sdk";
import * as crypto from "crypto";

// Program IDs
const VOTING_PROGRAM_ID = new PublicKey(
  "VotingDAO11111111111111111111111111111111111"
);
const ARCIUM_MXE_PROGRAM_ID = new PublicKey(
  "ArciumMXE1111111111111111111111111111111111"
);

// PDA Seeds
const PROPOSAL_SEED = Buffer.from("proposal");
const TALLY_SEED = Buffer.from("voting_tally");
const VOTER_RECORD_SEED = Buffer.from("voter_record");

/**
 * Configuration for the voting client
 */
export interface VotingClientConfig {
  connection: Connection;
  wallet: AnchorProvider["wallet"];
  arciumEndpoint?: string;
  mxeClusterKey?: PublicKey;
}

/**
 * Proposal data structure
 */
export interface ProposalData {
  authority: PublicKey;
  proposalId: BN;
  title: string;
  description: string;
  votingEndSlot: BN;
  isFinalized: boolean;
}

/**
 * Tally data structure (after reveal)
 */
export interface TallyData {
  proposal: PublicKey;
  encryptedStateInitialized: boolean;
  finalYesVotes: BN;
  finalNoVotes: BN;
  finalTotalVotes: BN;
  isRevealed: boolean;
}

/**
 * Vote type enum
 */
export enum Vote {
  No = 0,
  Yes = 1,
}

/**
 * Private DAO Voting Client
 *
 * Handles all client-side operations for private voting including
 * encryption of votes using the Arcium shared secret.
 */
export class PrivateVotingClient {
  private connection: Connection;
  private provider: AnchorProvider;
  private program: Program;
  private arciumClient: ArciumClient;
  private sharedSecretManager: SharedSecretManager;

  constructor(config: VotingClientConfig) {
    this.connection = config.connection;
    this.provider = new AnchorProvider(config.connection, config.wallet, {
      commitment: "confirmed",
    });

    // Initialize Arcium client for encrypted operations
    this.arciumClient = new ArciumClient({
      endpoint: config.arciumEndpoint || "https://mxe.arcium.network",
      mxeClusterKey: config.mxeClusterKey,
    });

    // Initialize shared secret manager
    this.sharedSecretManager = new SharedSecretManager(this.arciumClient);
  }

  // ===========================================================================
  // SHARED SECRET GENERATION & MANAGEMENT
  // ===========================================================================

  /**
   * Get or generate the shared secret for a proposal's encrypted computation.
   *
   * ## How Shared Secret Generation Works:
   *
   * 1. **MXE Cluster Key**: The Arcium MXE (Multi-party Execution Environment)
   *    operates a cluster of nodes that collectively hold a shared secret key.
   *    No single node knows the full key (threshold cryptography).
   *
   * 2. **Computation-Specific Keys**: For each encrypted computation (voting
   *    proposal), a unique symmetric key is derived from:
   *    - The MXE cluster's master key
   *    - The computation ID (unique to this proposal)
   *    - The circuit identifier ("voting_circuit")
   *
   * 3. **Client Key Derivation**: Clients can derive the encryption key using:
   *    - The MXE's public parameters
   *    - The computation ID from the on-chain TallyAccount
   *
   * ## Security Properties:
   *
   * - Individual votes encrypted with this key cannot be decrypted by anyone
   * - Only the MXE cluster can process encrypted data
   * - The key is the same for all voters in a proposal (shared key)
   * - Results are only revealed through the official callback mechanism
   *
   * @param proposalPubkey - The proposal's public key
   * @returns The shared encryption context for this proposal
   */
  async getEncryptionContext(
    proposalPubkey: PublicKey
  ): Promise<EncryptionContext> {
    // Get the tally account to retrieve computation ID
    const [tallyPda] = this.findTallyPda(proposalPubkey);
    const tallyAccount = await this.program.account.tallyAccount.fetch(
      tallyPda
    );

    if (!tallyAccount.encryptedStateInitialized) {
      throw new Error(
        "Encrypted state not initialized. Call initializeEncryptedState first."
      );
    }

    // Derive the shared encryption context from MXE parameters
    const encryptionContext = await this.sharedSecretManager.deriveContext({
      computationId: tallyAccount.computationId,
      circuitName: "voting_circuit",
      keyType: "Shared", // This maps to Enc<Shared, T> in Arcis
    });

    return encryptionContext;
  }

  /**
   * Encrypt a vote value using the shared secret.
   *
   * ## Encryption Process:
   *
   * 1. The vote (0 or 1) is converted to a u8 byte
   * 2. The byte is encrypted using AES-256-GCM with:
   *    - Key: derived shared secret
   *    - Nonce: randomly generated (included in output)
   *    - AAD: computation ID (binds ciphertext to this proposal)
   * 3. The output includes: nonce + ciphertext + auth tag
   *
   * ## Why This Is Secure:
   *
   * - Even though all voters use the same key, each vote has a unique nonce
   * - The MXE processes votes in encrypted form (homomorphic-like addition)
   * - No party ever sees individual decrypted votes
   * - Only the aggregate is revealed through the callback
   *
   * @param vote - The vote (Yes = 1, No = 0)
   * @param encryptionContext - The shared encryption context
   * @returns Encrypted vote bytes ready for on-chain submission
   */
  async encryptVote(
    vote: Vote,
    encryptionContext: EncryptionContext
  ): Promise<Uint8Array> {
    // Validate vote value
    if (vote !== Vote.No && vote !== Vote.Yes) {
      throw new Error("Vote must be 0 (No) or 1 (Yes)");
    }

    // Convert vote to bytes using Arcis serialization
    const voteBytes = new Uint8Array([vote]);

    // Encrypt using the shared context
    // This uses the .to_arcis() pattern from the Arcis framework
    const encryptedVote = await this.arciumClient.encrypt({
      data: voteBytes,
      context: encryptionContext,
      dataType: "u8",
    });

    return encryptedVote;
  }

  // ===========================================================================
  // PROPOSAL MANAGEMENT
  // ===========================================================================

  /**
   * Create a new voting proposal
   */
  async createProposal(
    proposalId: BN,
    title: string,
    description: string,
    votingDurationSlots: number
  ): Promise<string> {
    const authority = this.provider.wallet.publicKey;
    const currentSlot = await this.connection.getSlot();
    const votingEndSlot = new BN(currentSlot + votingDurationSlots);

    const [proposalPda] = this.findProposalPda(authority, proposalId);
    const [tallyPda] = this.findTallyPda(proposalPda);

    const tx = await this.program.methods
      .initializeProposal(proposalId, title, description, votingEndSlot)
      .accounts({
        authority,
        proposal: proposalPda,
        tallyAccount: tallyPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  }

  /**
   * Initialize the encrypted state on Arcium MXE
   */
  async initializeEncryptedState(proposalPubkey: PublicKey): Promise<string> {
    const [tallyPda] = this.findTallyPda(proposalPubkey);
    const arciumAccounts = await this.arciumClient.getRequiredAccounts();

    const tx = await this.program.methods
      .initializeEncryptedState()
      .accounts({
        payer: this.provider.wallet.publicKey,
        tallyAccount: tallyPda,
        arciumState: arciumAccounts.stateAccount,
        computationAccount: arciumAccounts.computationAccount,
        arciumProgram: ARCIUM_MXE_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  }

  // ===========================================================================
  // VOTING
  // ===========================================================================

  /**
   * Cast an encrypted vote on a proposal
   *
   * @param proposalPubkey - The proposal to vote on
   * @param vote - Your vote (Yes or No)
   * @returns Transaction signature
   */
  async castVote(proposalPubkey: PublicKey, vote: Vote): Promise<string> {
    // Get encryption context for this proposal
    const encryptionContext = await this.getEncryptionContext(proposalPubkey);

    // Encrypt the vote
    const encryptedVote = await this.encryptVote(vote, encryptionContext);

    // Get required accounts
    const proposal = await this.program.account.proposal.fetch(proposalPubkey);
    const [tallyPda] = this.findTallyPda(proposalPubkey);
    const [voterRecordPda] = this.findVoterRecordPda(
      proposalPubkey,
      this.provider.wallet.publicKey
    );
    const arciumAccounts = await this.arciumClient.getRequiredAccounts();

    // Submit the encrypted vote
    const tx = await this.program.methods
      .castVote(Buffer.from(encryptedVote))
      .accounts({
        voter: this.provider.wallet.publicKey,
        proposal: proposalPubkey,
        tallyAccount: tallyPda,
        voterRecord: voterRecordPda,
        arciumState: arciumAccounts.stateAccount,
        computationAccount: arciumAccounts.computationAccount,
        arciumProgram: ARCIUM_MXE_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  }

  /**
   * Finalize voting and trigger result revelation
   *
   * Can only be called by the proposal authority after voting ends
   */
  async finalizeVoting(proposalPubkey: PublicKey): Promise<string> {
    const proposal = await this.program.account.proposal.fetch(proposalPubkey);
    const [tallyPda] = this.findTallyPda(proposalPubkey);
    const arciumAccounts = await this.arciumClient.getRequiredAccounts();

    const tx = await this.program.methods
      .finalizeVoting()
      .accounts({
        authority: this.provider.wallet.publicKey,
        proposal: proposalPubkey,
        tallyAccount: tallyPda,
        arciumState: arciumAccounts.stateAccount,
        computationAccount: arciumAccounts.computationAccount,
        arciumProgram: ARCIUM_MXE_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  }

  // ===========================================================================
  // QUERIES
  // ===========================================================================

  /**
   * Get proposal data
   */
  async getProposal(proposalPubkey: PublicKey): Promise<ProposalData> {
    return await this.program.account.proposal.fetch(proposalPubkey);
  }

  /**
   * Get tally data (including revealed results if available)
   */
  async getTally(proposalPubkey: PublicKey): Promise<TallyData> {
    const [tallyPda] = this.findTallyPda(proposalPubkey);
    return await this.program.account.tallyAccount.fetch(tallyPda);
  }

  /**
   * Check if the current user has voted on a proposal
   */
  async hasVoted(proposalPubkey: PublicKey): Promise<boolean> {
    const [voterRecordPda] = this.findVoterRecordPda(
      proposalPubkey,
      this.provider.wallet.publicKey
    );

    try {
      const record = await this.program.account.voterRecord.fetch(
        voterRecordPda
      );
      return record.hasVoted;
    } catch {
      return false;
    }
  }

  /**
   * Wait for voting results to be revealed
   */
  async waitForResults(
    proposalPubkey: PublicKey,
    timeoutMs: number = 60000
  ): Promise<TallyData> {
    const startTime = Date.now();
    const [tallyPda] = this.findTallyPda(proposalPubkey);

    while (Date.now() - startTime < timeoutMs) {
      const tally = await this.program.account.tallyAccount.fetch(tallyPda);

      if (tally.isRevealed) {
        return tally;
      }

      // Wait 2 seconds before checking again
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    throw new Error("Timeout waiting for voting results");
  }

  // ===========================================================================
  // PDA HELPERS
  // ===========================================================================

  findProposalPda(authority: PublicKey, proposalId: BN): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [PROPOSAL_SEED, authority.toBuffer(), proposalId.toArrayLike(Buffer, "le", 8)],
      VOTING_PROGRAM_ID
    );
  }

  findTallyPda(proposalPubkey: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [TALLY_SEED, proposalPubkey.toBuffer()],
      VOTING_PROGRAM_ID
    );
  }

  findVoterRecordPda(
    proposalPubkey: PublicKey,
    voter: PublicKey
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [VOTER_RECORD_SEED, proposalPubkey.toBuffer(), voter.toBuffer()],
      VOTING_PROGRAM_ID
    );
  }
}

// ===========================================================================
// EXAMPLE USAGE
// ===========================================================================

/**
 * Example: Complete voting flow
 */
async function exampleVotingFlow() {
  // Setup
  const connection = new Connection("https://api.devnet.solana.com");
  const wallet = Keypair.generate(); // In practice, use user's wallet

  const client = new PrivateVotingClient({
    connection,
    wallet: {
      publicKey: wallet.publicKey,
      signTransaction: async (tx) => {
        tx.sign(wallet);
        return tx;
      },
      signAllTransactions: async (txs) => {
        txs.forEach((tx) => tx.sign(wallet));
        return txs;
      },
    },
  });

  // 1. Create a proposal (authority only)
  const proposalId = new BN(1);
  await client.createProposal(
    proposalId,
    "Increase Treasury Allocation",
    "Proposal to increase monthly treasury allocation from 10% to 15%",
    43200 // ~2 days in slots
  );

  // 2. Initialize encrypted state
  const [proposalPda] = client.findProposalPda(wallet.publicKey, proposalId);
  await client.initializeEncryptedState(proposalPda);

  // 3. Cast an encrypted vote
  await client.castVote(proposalPda, Vote.Yes);

  // 4. After voting period ends, finalize
  // await client.finalizeVoting(proposalPda);

  // 5. Wait for and retrieve results
  // const results = await client.waitForResults(proposalPda);
  // console.log(`Yes: ${results.finalYesVotes}, No: ${results.finalNoVotes}`);
}

export { VOTING_PROGRAM_ID, ARCIUM_MXE_PROGRAM_ID };
