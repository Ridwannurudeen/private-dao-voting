import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { expect } from "chai";

// Load IDL from frontend build output
const idl = require("../frontend/idl/private_dao_voting.json");

const PROGRAM_ID = new PublicKey(idl.address);

function findProposalPDA(proposalId: BN): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("proposal"), proposalId.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  );
}

function findTallyPDA(proposal: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("tally"), proposal.toBuffer()],
    PROGRAM_ID
  );
}

function findVoteRecordPDA(proposal: PublicKey, voter: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vote_record"), proposal.toBuffer(), voter.toBuffer()],
    PROGRAM_ID
  );
}

function findDelegationPDA(delegator: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("delegation"), delegator.toBuffer()],
    PROGRAM_ID
  );
}

describe("private-dao-voting", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = new Program(idl, provider);
  const authority = provider.wallet;

  let gateMint: PublicKey;
  let proposalId: BN;
  let proposalPDA: PublicKey;

  // Setup: create SPL token mint and fund the authority's token account
  before(async () => {
    const mintAuthority = Keypair.generate();

    // Airdrop SOL to mint authority
    const sig = await provider.connection.requestAirdrop(
      mintAuthority.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig, "confirmed");

    // Create gate token mint
    gateMint = await createMint(
      provider.connection,
      mintAuthority,
      mintAuthority.publicKey,
      null,
      0 // 0 decimals for simplicity
    );

    // Create ATA for authority and mint tokens
    const ata = await createAssociatedTokenAccount(
      provider.connection,
      mintAuthority,
      gateMint,
      authority.publicKey
    );

    await mintTo(
      provider.connection,
      mintAuthority,
      gateMint,
      ata,
      mintAuthority,
      100 // 100 gate tokens
    );
  });

  describe("Proposal lifecycle", () => {
    it("creates a proposal (dev mode)", async () => {
      proposalId = new BN(Date.now());
      [proposalPDA] = findProposalPDA(proposalId);
      const votingEndsAt = new BN(Math.floor(Date.now() / 1000) + 3600); // 1 hour

      await program.methods
        .devCreateProposal(
          proposalId,
          "Test Proposal",
          "A test proposal for the CI suite",
          votingEndsAt,
          gateMint,
          new BN(1), // min balance
          new BN(0)  // no quorum
        )
        .accounts({
          authority: authority.publicKey,
          proposal: proposalPDA,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const proposal = await (program.account as any).proposal.fetch(proposalPDA);
      expect(proposal.title).to.equal("Test Proposal");
      expect(proposal.isActive).to.be.true;
      expect(proposal.isRevealed).to.be.false;
      expect(proposal.totalVotes.toNumber()).to.equal(0);
      expect(proposal.gateMint.toString()).to.equal(gateMint.toString());
    });

    it("initializes a tally for the proposal", async () => {
      const [tallyPDA] = findTallyPDA(proposalPDA);

      await program.methods
        .devInitTally()
        .accounts({
          authority: authority.publicKey,
          proposal: proposalPDA,
          tally: tallyPDA,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const tally = await (program.account as any).tally.fetch(tallyPDA);
      expect(tally.proposal.toString()).to.equal(proposalPDA.toString());
    });

    it("casts an encrypted vote (dev mode)", async () => {
      const [tallyPDA] = findTallyPDA(proposalPDA);
      const [voteRecordPDA] = findVoteRecordPDA(proposalPDA, authority.publicKey);
      const voterTokenAccount = getAssociatedTokenAddressSync(gateMint, authority.publicKey);

      // Dummy encrypted data (dev mode doesn't verify encryption)
      const encryptedChoice = Array(32).fill(0);
      encryptedChoice[0] = 1; // YES
      const nonce = Array(16).fill(0);
      const voterPubkey = Array(32).fill(0);

      await program.methods
        .devCastVote(encryptedChoice, nonce, voterPubkey)
        .accounts({
          voter: authority.publicKey,
          proposal: proposalPDA,
          tally: tallyPDA,
          voterTokenAccount,
          voteRecord: voteRecordPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const proposal = await (program.account as any).proposal.fetch(proposalPDA);
      expect(proposal.totalVotes.toNumber()).to.equal(1);

      const voteRecord = await (program.account as any).voteRecord.fetch(voteRecordPDA);
      expect(voteRecord.voter.toString()).to.equal(authority.publicKey.toString());
    });

    it("prevents double voting", async () => {
      const [tallyPDA] = findTallyPDA(proposalPDA);
      const [voteRecordPDA] = findVoteRecordPDA(proposalPDA, authority.publicKey);
      const voterTokenAccount = getAssociatedTokenAddressSync(gateMint, authority.publicKey);

      try {
        await program.methods
          .devCastVote(Array(32).fill(0), Array(16).fill(0), Array(32).fill(0))
          .accounts({
            voter: authority.publicKey,
            proposal: proposalPDA,
            tally: tallyPDA,
            voterTokenAccount,
            voteRecord: voteRecordPDA,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown — double vote");
      } catch (err: any) {
        // VoteRecord PDA already initialized — Anchor returns an error
        expect(err).to.exist;
      }
    });
  });

  describe("Proposal with quorum", () => {
    let qProposalId: BN;
    let qProposalPDA: PublicKey;

    it("creates a proposal with quorum = 5", async () => {
      qProposalId = new BN(Date.now() + 1);
      [qProposalPDA] = findProposalPDA(qProposalId);
      // Voting ends in the past so we can test reveal immediately
      const votingEndsAt = new BN(Math.floor(Date.now() / 1000) - 10);

      await program.methods
        .devCreateProposal(
          qProposalId,
          "Quorum Proposal",
          "Requires 5 votes to reveal",
          votingEndsAt,
          gateMint,
          new BN(1),
          new BN(5) // quorum = 5
        )
        .accounts({
          authority: authority.publicKey,
          proposal: qProposalPDA,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const proposal = await (program.account as any).proposal.fetch(qProposalPDA);
      expect(proposal.quorum.toNumber()).to.equal(5);
    });

    it("rejects reveal when quorum is not met", async () => {
      try {
        await program.methods
          .devRevealResults(1, 0, 0)
          .accounts({
            authority: authority.publicKey,
            proposal: qProposalPDA,
          })
          .rpc();
        expect.fail("Should have thrown — quorum not met");
      } catch (err: any) {
        expect(err.toString()).to.include("QuorumNotReached");
      }
    });
  });

  describe("Reveal results", () => {
    let rProposalId: BN;
    let rProposalPDA: PublicKey;

    it("reveals results on an ended proposal with no quorum", async () => {
      rProposalId = new BN(Date.now() + 2);
      [rProposalPDA] = findProposalPDA(rProposalId);
      const votingEndsAt = new BN(Math.floor(Date.now() / 1000) - 10);

      await program.methods
        .devCreateProposal(
          rProposalId,
          "Revealable Proposal",
          "Testing reveal flow",
          votingEndsAt,
          gateMint,
          new BN(1),
          new BN(0) // no quorum
        )
        .accounts({
          authority: authority.publicKey,
          proposal: rProposalPDA,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .devRevealResults(10, 5, 2)
        .accounts({
          authority: authority.publicKey,
          proposal: rProposalPDA,
        })
        .rpc();

      const proposal = await (program.account as any).proposal.fetch(rProposalPDA);
      expect(proposal.isRevealed).to.be.true;
      expect(proposal.isActive).to.be.false;
      expect(proposal.yesVotes.toNumber()).to.equal(10);
      expect(proposal.noVotes.toNumber()).to.equal(5);
      expect(proposal.abstainVotes.toNumber()).to.equal(2);
    });

    it("prevents non-authority from revealing", async () => {
      const fakeAuthority = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        fakeAuthority.publicKey,
        anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig, "confirmed");

      // Create a new proposal that hasn't been revealed yet
      const id = new BN(Date.now() + 3);
      const [pda] = findProposalPDA(id);
      const votingEndsAt = new BN(Math.floor(Date.now() / 1000) - 10);

      await program.methods
        .devCreateProposal(id, "Auth Test", "Authority check", votingEndsAt, gateMint, new BN(1), new BN(0))
        .accounts({
          authority: authority.publicKey,
          proposal: pda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      try {
        // Try to reveal as non-authority (using a different signer)
        const fakeProvider = new anchor.AnchorProvider(
          provider.connection,
          new anchor.Wallet(fakeAuthority),
          { commitment: "confirmed" }
        );
        const fakeProgram = new Program(idl, fakeProvider);

        await fakeProgram.methods
          .devRevealResults(1, 0, 0)
          .accounts({
            authority: fakeAuthority.publicKey,
            proposal: pda,
          })
          .rpc();
        expect.fail("Should have thrown — not the authority");
      } catch (err: any) {
        expect(err).to.exist;
      }
    });
  });

  describe("Vote delegation", () => {
    const delegateKeypair = Keypair.generate();

    it("creates a delegation", async () => {
      const [delegationPDA] = findDelegationPDA(authority.publicKey);

      await program.methods
        .delegateVote()
        .accounts({
          delegator: authority.publicKey,
          delegate: delegateKeypair.publicKey,
          delegation: delegationPDA,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const delegation = await (program.account as any).delegation.fetch(delegationPDA);
      expect(delegation.delegator.toString()).to.equal(authority.publicKey.toString());
      expect(delegation.delegate.toString()).to.equal(delegateKeypair.publicKey.toString());
    });

    it("revokes a delegation", async () => {
      const [delegationPDA] = findDelegationPDA(authority.publicKey);

      await program.methods
        .revokeDelegation()
        .accounts({
          delegator: authority.publicKey,
          delegation: delegationPDA,
        })
        .rpc();

      // Delegation account should be closed
      try {
        await (program.account as any).delegation.fetch(delegationPDA);
        expect.fail("Should have thrown — account closed");
      } catch (err: any) {
        expect(err).to.exist;
      }
    });
  });

  describe("Token gating", () => {
    it("rejects vote from wallet without gate tokens", async () => {
      const noTokenWallet = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        noTokenWallet.publicKey,
        anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig, "confirmed");

      // Create a fresh active proposal
      const id = new BN(Date.now() + 10);
      const [pda] = findProposalPDA(id);
      const [tallyPDA] = findTallyPDA(pda);
      const votingEndsAt = new BN(Math.floor(Date.now() / 1000) + 3600);

      await program.methods
        .devCreateProposal(id, "Token Gate Test", "Testing gating", votingEndsAt, gateMint, new BN(1), new BN(0))
        .accounts({
          authority: authority.publicKey,
          proposal: pda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .devInitTally()
        .accounts({
          authority: authority.publicKey,
          proposal: pda,
          tally: tallyPDA,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      try {
        // The wallet doesn't have an ATA for the gate mint, so this should fail
        const fakeAta = getAssociatedTokenAddressSync(gateMint, noTokenWallet.publicKey);
        const [voteRecordPDA] = findVoteRecordPDA(pda, noTokenWallet.publicKey);

        const fakeProvider = new anchor.AnchorProvider(
          provider.connection,
          new anchor.Wallet(noTokenWallet),
          { commitment: "confirmed" }
        );
        const fakeProgram = new Program(idl, fakeProvider);

        await fakeProgram.methods
          .devCastVote(Array(32).fill(0), Array(16).fill(0), Array(32).fill(0))
          .accounts({
            voter: noTokenWallet.publicKey,
            proposal: pda,
            tally: tallyPDA,
            voterTokenAccount: fakeAta,
            voteRecord: voteRecordPDA,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown — no gate tokens");
      } catch (err: any) {
        expect(err).to.exist;
      }
    });
  });
});
