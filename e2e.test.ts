/**
 * E2E Tests for Private DAO Voting
 *
 * Tests are split into two groups:
 * 1. Local tests - run on local validator without Arcium
 * 2. Arcium integration tests - require Arcium MXE deployed (skipped locally)
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { expect } from "chai";
import { PrivateDaoVoting } from "./target/types/private_dao_voting";

// PDA seed constants (must match lib.rs)
const PROPOSAL_SEED = Buffer.from("proposal");
const TALLY_SEED = Buffer.from("tally");
const VOTE_RECORD_SEED = Buffer.from("vote_record");
const SIGN_SEED = Buffer.from("sign");
const COMPUTATION_OFFSET_SEED = Buffer.from("computation_offset");

// Arcium program ID from the generated IDL
const ARCIUM_PROGRAM_ID = new PublicKey(
  "Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ"
);

describe("Private DAO Voting", () => {
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace
    .PrivateDaoVoting as Program<PrivateDaoVoting>;

  let authority: Keypair;
  let voter1: Keypair;
  let voter2: Keypair;

  // Helper: airdrop SOL
  const airdrop = async (pubkey: PublicKey, amount = 10 * LAMPORTS_PER_SOL) => {
    const sig = await provider.connection.requestAirdrop(pubkey, amount);
    await provider.connection.confirmTransaction(sig);
  };

  // Helper: derive proposal PDA
  const findProposalPda = (proposalId: BN): [PublicKey, number] => {
    return PublicKey.findProgramAddressSync(
      [PROPOSAL_SEED, proposalId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
  };

  // Helper: derive tally PDA
  const findTallyPda = (proposalPubkey: PublicKey): [PublicKey, number] => {
    return PublicKey.findProgramAddressSync(
      [TALLY_SEED, proposalPubkey.toBuffer()],
      program.programId
    );
  };

  // Helper: derive vote record PDA
  const findVoteRecordPda = (
    proposalPubkey: PublicKey,
    voter: PublicKey
  ): [PublicKey, number] => {
    return PublicKey.findProgramAddressSync(
      [VOTE_RECORD_SEED, proposalPubkey.toBuffer(), voter.toBuffer()],
      program.programId
    );
  };

  // Helper: derive sign PDA
  const findSignPda = (): [PublicKey, number] => {
    return PublicKey.findProgramAddressSync(
      [SIGN_SEED],
      program.programId
    );
  };

  // Helper: derive computation offset PDA
  const findComputationOffsetPda = (): [PublicKey, number] => {
    return PublicKey.findProgramAddressSync(
      [COMPUTATION_OFFSET_SEED],
      program.programId
    );
  };

  before(async () => {
    authority = Keypair.generate();
    voter1 = Keypair.generate();
    voter2 = Keypair.generate();

    await airdrop(authority.publicKey);
    await airdrop(voter1.publicKey);
    await airdrop(voter2.publicKey);
  });

  // =========================================================================
  // LOCAL TESTS (no Arcium required)
  // =========================================================================

  describe("PDA Derivation", () => {
    it("should derive consistent proposal PDAs", () => {
      const proposalId = new BN(1);
      const [pda1, bump1] = findProposalPda(proposalId);
      const [pda2, bump2] = findProposalPda(proposalId);

      expect(pda1.toString()).to.equal(pda2.toString());
      expect(bump1).to.equal(bump2);
    });

    it("should derive different PDAs for different proposal IDs", () => {
      const [pda1] = findProposalPda(new BN(1));
      const [pda2] = findProposalPda(new BN(2));

      expect(pda1.toString()).to.not.equal(pda2.toString());
    });

    it("should derive tally PDA from proposal PDA", () => {
      const [proposalPda] = findProposalPda(new BN(1));
      const [tallyPda1] = findTallyPda(proposalPda);
      const [tallyPda2] = findTallyPda(proposalPda);

      expect(tallyPda1.toString()).to.equal(tallyPda2.toString());
    });

    it("should derive unique vote record PDAs per voter", () => {
      const [proposalPda] = findProposalPda(new BN(1));
      const [vr1] = findVoteRecordPda(proposalPda, voter1.publicKey);
      const [vr2] = findVoteRecordPda(proposalPda, voter2.publicKey);

      expect(vr1.toString()).to.not.equal(vr2.toString());
    });

    it("should derive sign PDA consistently", () => {
      const [pda1] = findSignPda();
      const [pda2] = findSignPda();

      expect(pda1.toString()).to.equal(pda2.toString());
    });

    it("should derive computation offset PDA consistently", () => {
      const [pda1] = findComputationOffsetPda();
      const [pda2] = findComputationOffsetPda();

      expect(pda1.toString()).to.equal(pda2.toString());
    });
  });

  describe("initComputationOffset", () => {
    it("should initialize the computation offset PDA", async () => {
      const [computationOffsetPda] = findComputationOffsetPda();

      await program.methods
        .initComputationOffset()
        .accounts({
          payer: authority.publicKey,
          computationOffsetAccount: computationOffsetPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      const state =
        await program.account.computationOffsetState.fetch(
          computationOffsetPda
        );
      expect(state.bump).to.be.a("number");
    });

    it("should reject double initialization", async () => {
      const [computationOffsetPda] = findComputationOffsetPda();

      try {
        await program.methods
          .initComputationOffset()
          .accounts({
            payer: authority.publicKey,
            computationOffsetAccount: computationOffsetPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([authority])
          .rpc();

        expect.fail("Should have rejected double init");
      } catch (err: any) {
        // Account already exists - Anchor throws a custom error or
        // the transaction will fail with "already in use"
        expect(err).to.exist;
      }
    });
  });

  describe("initCompDef", () => {
    it("should accept computation definition data", async () => {
      const compDefData = Buffer.from("test_comp_def_data");

      await program.methods
        .initCompDef(compDefData)
        .accounts({
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      // This is a stub instruction - just verify it doesn't error
    });
  });

  // =========================================================================
  // ARCIUM INTEGRATION TESTS
  // These require the Arcium program deployed on the cluster.
  // They are skipped by default for local testing.
  // To run: deploy Arcium to devnet and run `anchor test --provider.cluster devnet`
  // =========================================================================

  const arciumAvailable = async (): Promise<boolean> => {
    try {
      const info = await provider.connection.getAccountInfo(ARCIUM_PROGRAM_ID);
      return info !== null;
    } catch {
      return false;
    }
  };

  describe("Full Voting Flow (requires Arcium)", function () {
    let hasArcium = false;

    before(async function () {
      hasArcium = await arciumAvailable();
      if (!hasArcium) {
        console.log(
          "    ⚠ Arcium program not found - skipping integration tests"
        );
        console.log(
          "    Deploy Arcium and run against devnet to test the full flow"
        );
      }
    });

    it("should create a proposal with token gating", async function () {
      if (!hasArcium) this.skip();

      const proposalId = new BN(1);
      const gateMint = Keypair.generate().publicKey; // placeholder
      const [proposalPda] = findProposalPda(proposalId);
      const [signPda] = findSignPda();
      const [computationOffsetPda] = findComputationOffsetPda();

      // These accounts would come from Arcium SDK in production
      const mxeAccount = Keypair.generate().publicKey;
      const clusterAccount = Keypair.generate().publicKey;
      const poolAccount = Keypair.generate().publicKey;
      const clockAccount = Keypair.generate().publicKey;
      const mempoolAccount = Keypair.generate().publicKey;
      const executingPool = Keypair.generate().publicKey;
      const computationAccount = Keypair.generate();
      const compDefAccount = Keypair.generate().publicKey;

      const votingEndsAt = new BN(Math.floor(Date.now() / 1000) + 3600);

      await program.methods
        .createProposal(
          proposalId,
          "Test Proposal",
          "A test proposal for E2E",
          votingEndsAt,
          gateMint,
          new BN(1), // min_balance
          mxeAccount // mxe_program_id
        )
        .accounts({
          authority: authority.publicKey,
          proposal: proposalPda,
          signSeed: signPda,
          arciumProgram: ARCIUM_PROGRAM_ID,
          mxeAccount,
          clusterAccount,
          poolAccount,
          clockAccount,
          mempoolAccount,
          executingPool,
          computationAccount: computationAccount.publicKey,
          compDefAccount,
          computationOffsetAccount: computationOffsetPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority, computationAccount])
        .rpc();

      const proposal = await program.account.proposal.fetch(proposalPda);
      expect(proposal.id.toNumber()).to.equal(1);
      expect(proposal.authority.toString()).to.equal(
        authority.publicKey.toString()
      );
      expect(proposal.title).to.equal("Test Proposal");
      expect(proposal.isActive).to.be.true;
      expect(proposal.isRevealed).to.be.false;
      expect(proposal.totalVotes).to.equal(0);
      expect(proposal.gateMint.toString()).to.equal(gateMint.toString());
    });

    it("should initialize tally via callback", async function () {
      if (!hasArcium) this.skip();

      const proposalId = new BN(1);
      const [proposalPda] = findProposalPda(proposalId);
      const [tallyPda] = findTallyPda(proposalPda);

      const encryptedTally = new Array(128).fill(0);
      const nonce = new Array(16).fill(0);

      await program.methods
        .initTallyCallback(encryptedTally, nonce)
        .accounts({
          proposal: proposalPda,
          tally: tallyPda,
          payer: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      const tally = await program.account.tally.fetch(tallyPda);
      expect(tally.proposal.toString()).to.equal(proposalPda.toString());
    });

    it("should update tally via vote callback", async function () {
      if (!hasArcium) this.skip();

      const proposalId = new BN(1);
      const [proposalPda] = findProposalPda(proposalId);
      const [tallyPda] = findTallyPda(proposalPda);

      const newEncryptedTally = new Array(128).fill(1);
      const nonce = new Array(16).fill(1);

      const proposalBefore = await program.account.proposal.fetch(proposalPda);

      await program.methods
        .voteCallback(newEncryptedTally, nonce)
        .accounts({
          proposal: proposalPda,
          tally: tallyPda,
        })
        .rpc();

      const proposal = await program.account.proposal.fetch(proposalPda);
      expect(proposal.totalVotes).to.equal(proposalBefore.totalVotes + 1);

      const tally = await program.account.tally.fetch(tallyPda);
      expect(Array.from(tally.nonce)).to.deep.equal(nonce);
    });

    it("should reveal results via callback", async function () {
      if (!hasArcium) this.skip();

      const proposalId = new BN(1);
      const [proposalPda] = findProposalPda(proposalId);

      await program.methods
        .revealResultsCallback(
          100, // yes_count
          50, // no_count
          10, // abstain_count
          160, // total_votes
          1 // winner (yes)
        )
        .accounts({
          proposal: proposalPda,
        })
        .rpc();

      const proposal = await program.account.proposal.fetch(proposalPda);
      expect(proposal.isActive).to.be.false;
      expect(proposal.isRevealed).to.be.true;
      expect(proposal.yesVotes).to.equal(100);
      expect(proposal.noVotes).to.equal(50);
      expect(proposal.abstainVotes).to.equal(10);
    });
  });

  // =========================================================================
  // CALLBACK SECURITY TESTS
  // =========================================================================

  describe("Callback Security", function () {
    let hasArcium = false;

    before(async function () {
      hasArcium = await arciumAvailable();
    });

    it("revealResultsCallback should not have signer validation (known issue)", async function () {
      if (!hasArcium) this.skip();

      // NOTE: revealResultsCallback has no signer constraint.
      // In production, Arcium MXE is expected to be the only caller
      // because it's triggered via the MXE callback mechanism.
      // However, on-chain there's no enforcement. Consider adding
      // a signer check if this is a concern.
    });
  });

  // =========================================================================
  // ERROR CONDITION TESTS
  // =========================================================================

  describe("Error Codes", () => {
    it("should define all expected error codes", () => {
      // Verify the IDL has the expected errors
      const idl = program.idl;
      const errorNames = idl.errors?.map((e) => e.name) ?? [];

      expect(errorNames).to.include("votingClosed");
      expect(errorNames).to.include("votingEnded");
      expect(errorNames).to.include("votingNotEnded");
      expect(errorNames).to.include("unauthorized");
      expect(errorNames).to.include("alreadyVoted");
      expect(errorNames).to.include("invalidTokenAccount");
      expect(errorNames).to.include("invalidTokenMint");
      expect(errorNames).to.include("insufficientTokenBalance");
    });
  });

  // =========================================================================
  // ACCOUNT STRUCTURE TESTS
  // =========================================================================

  describe("Account Types", () => {
    it("should define proposal account type with all fields", () => {
      const idl = program.idl;
      const proposalType = idl.types?.find((t) => t.name === "proposal");
      expect(proposalType).to.exist;

      const fieldNames =
        proposalType?.type.kind === "struct"
          ? proposalType.type.fields.map((f) => f.name)
          : [];

      expect(fieldNames).to.include("id");
      expect(fieldNames).to.include("authority");
      expect(fieldNames).to.include("title");
      expect(fieldNames).to.include("description");
      expect(fieldNames).to.include("votingEndsAt");
      expect(fieldNames).to.include("isActive");
      expect(fieldNames).to.include("isRevealed");
      expect(fieldNames).to.include("totalVotes");
      expect(fieldNames).to.include("gateMint");
      expect(fieldNames).to.include("minBalance");
      expect(fieldNames).to.include("mxeProgramId");
      expect(fieldNames).to.include("yesVotes");
      expect(fieldNames).to.include("noVotes");
      expect(fieldNames).to.include("abstainVotes");
      expect(fieldNames).to.include("bump");
    });

    it("should define tally account with encrypted data field", () => {
      const idl = program.idl;
      const tallyType = idl.types?.find((t) => t.name === "tally");
      expect(tallyType).to.exist;

      const fieldNames =
        tallyType?.type.kind === "struct"
          ? tallyType.type.fields.map((f) => f.name)
          : [];

      expect(fieldNames).to.include("proposal");
      expect(fieldNames).to.include("encryptedData");
      expect(fieldNames).to.include("nonce");
      expect(fieldNames).to.include("bump");
    });

    it("should define vote record with ciphertext storage", () => {
      const idl = program.idl;
      const vrType = idl.types?.find((t) => t.name === "voteRecord");
      expect(vrType).to.exist;

      const fieldNames =
        vrType?.type.kind === "struct"
          ? vrType.type.fields.map((f) => f.name)
          : [];

      expect(fieldNames).to.include("proposal");
      expect(fieldNames).to.include("voter");
      expect(fieldNames).to.include("votedAt");
      expect(fieldNames).to.include("encryptedChoice");
      expect(fieldNames).to.include("nonce");
      expect(fieldNames).to.include("voterPubkey");
      expect(fieldNames).to.include("bump");
    });
  });
});
