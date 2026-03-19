import * as anchor from "@coral-xyz/anchor";
const { Program, BN } = anchor;
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

const idl = JSON.parse(
  fs.readFileSync(
    path.join(process.cwd(), "frontend/idl/private_dao_voting.json"),
    "utf-8"
  )
);

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

function findPayloadPDA(proposal: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("payload"), proposal.toBuffer()],
    PROGRAM_ID
  );
}

function findProgramConfigPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("program_config")],
    PROGRAM_ID
  );
}

// Serialize a treasury transfer payload: recipient (32) + mint (32) + amount (8)
function serializeTreasuryTransfer(recipient: PublicKey, mint: PublicKey, amount: BN): Buffer {
  const buf = Buffer.alloc(72);
  recipient.toBuffer().copy(buf, 0);
  mint.toBuffer().copy(buf, 32);
  amount.toArrayLike(Buffer, "le", 8).copy(buf, 64);
  return buf;
}

describe("Execution Engine", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = new Program(idl, provider);
  const authority = provider.wallet;

  let gateMint: PublicKey;
  let mintAuthority: Keypair;

  before(async () => {
    mintAuthority = Keypair.generate();

    const sig = await provider.connection.requestAirdrop(
      mintAuthority.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig, "confirmed");

    gateMint = await createMint(
      provider.connection,
      mintAuthority,
      mintAuthority.publicKey,
      null,
      0
    );

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
      100
    );

    // Ensure ProgramConfig exists
    const [programConfigPDA] = findProgramConfigPDA();
    try {
      await (program.account as any).programConfig.fetch(programConfigPDA);
    } catch {
      await program.methods
        .initProgramConfig()
        .accounts({
          authority: authority.publicKey,
          programConfig: programConfigPDA,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }
  });

  // Helper: create a proposal with execution delay
  async function createProposal(
    durationSec: number,
    executionDelay: number = 0,
  ): Promise<{ proposalId: BN; proposalPDA: PublicKey }> {
    const proposalId = new BN(Date.now() + Math.floor(Math.random() * 100000));
    const [proposalPDA] = findProposalPDA(proposalId);
    const votingEndsAt = new BN(Math.floor(Date.now() / 1000) + durationSec);
    const [programConfigPDA] = findProgramConfigPDA();

    await program.methods
      .devCreateProposal(
        proposalId,
        "Exec Test",
        "Execution engine test proposal",
        votingEndsAt,
        gateMint,
        new BN(1),
        new BN(0), // no quorum
        5001,       // simple majority threshold
        0,          // full privacy
        "",         // no discussion URL
        new BN(executionDelay)
      )
      .accounts({
        authority: authority.publicKey,
        proposal: proposalPDA,
        programConfig: programConfigPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Init tally
    const [tallyPDA] = findTallyPDA(proposalPDA);
    await program.methods
      .initTallyDirect()
      .accounts({
        authority: authority.publicKey,
        proposal: proposalPDA,
        tally: tallyPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return { proposalId, proposalPDA };
  }

  // Helper: cast a vote
  async function castVote(proposalPDA: PublicKey): Promise<void> {
    const [tallyPDA] = findTallyPDA(proposalPDA);
    const [voteRecordPDA] = findVoteRecordPDA(proposalPDA, authority.publicKey);
    const voterTokenAccount = getAssociatedTokenAddressSync(gateMint, authority.publicKey);
    const [delegationPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("delegation"), authority.publicKey.toBuffer()],
      PROGRAM_ID
    );
    const [programConfigPDA] = findProgramConfigPDA();

    await program.methods
      .devCastVote(Array(32).fill(0), Array(16).fill(0), Array(32).fill(0))
      .accounts({
        voter: authority.publicKey,
        proposal: proposalPDA,
        tally: tallyPDA,
        voterTokenAccount,
        voteRecord: voteRecordPDA,
        delegationAccount: delegationPDA,
        programConfig: programConfigPDA,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  describe("attach_payload", () => {
    it("creates payload PDA correctly", async () => {
      const { proposalPDA } = await createProposal(3600);
      const [payloadPDA] = findPayloadPDA(proposalPDA);

      const recipient = Keypair.generate().publicKey;
      const plaintext = serializeTreasuryTransfer(recipient, gateMint, new BN(50));
      const hash = crypto.createHash("sha256").update(plaintext).digest();

      await program.methods
        .attachPayload(1, plaintext, Array.from(hash))
        .accounts({
          authority: authority.publicKey,
          proposal: proposalPDA,
          executionPayload: payloadPDA,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const payload = await (program.account as any).executionPayload.fetch(payloadPDA);
      expect(payload.proposal.toString()).to.equal(proposalPDA.toString());
      expect(payload.isDecrypted).to.be.false;
      expect(payload.executed).to.be.false;
      expect(Buffer.from(payload.payloadHash).toString("hex")).to.equal(hash.toString("hex"));
    });

    it("fails for non-authority", async () => {
      const { proposalPDA } = await createProposal(3600);
      const [payloadPDA] = findPayloadPDA(proposalPDA);

      const fakeAuth = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        fakeAuth.publicKey,
        anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig, "confirmed");

      const plaintext = serializeTreasuryTransfer(fakeAuth.publicKey, gateMint, new BN(10));
      const hash = crypto.createHash("sha256").update(plaintext).digest();

      try {
        const fakeProvider = new anchor.AnchorProvider(
          provider.connection,
          new anchor.Wallet(fakeAuth),
          { commitment: "confirmed" }
        );
        const fakeProgram = new Program(idl, fakeProvider);

        await fakeProgram.methods
          .attachPayload(1, plaintext, Array.from(hash))
          .accounts({
            authority: fakeAuth.publicKey,
            proposal: proposalPDA,
            executionPayload: payloadPDA,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown — not the authority");
      } catch (err: any) {
        expect(err).to.exist;
      }
    });

    it("fails after votes are cast", async () => {
      const { proposalPDA } = await createProposal(3600);

      // Cast a vote first
      await castVote(proposalPDA);

      const [payloadPDA] = findPayloadPDA(proposalPDA);
      const plaintext = serializeTreasuryTransfer(authority.publicKey, gateMint, new BN(10));
      const hash = crypto.createHash("sha256").update(plaintext).digest();

      try {
        await program.methods
          .attachPayload(1, plaintext, Array.from(hash))
          .accounts({
            authority: authority.publicKey,
            proposal: proposalPDA,
            executionPayload: payloadPDA,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown — votes already cast");
      } catch (err: any) {
        expect(err).to.exist;
      }
    });

    it("fails with oversized data", async () => {
      const { proposalPDA } = await createProposal(3600);
      const [payloadPDA] = findPayloadPDA(proposalPDA);

      const oversized = Buffer.alloc(1233); // 1 byte over limit
      const hash = crypto.createHash("sha256").update(oversized).digest();

      try {
        await program.methods
          .attachPayload(1, oversized, Array.from(hash))
          .accounts({
            authority: authority.publicKey,
            proposal: proposalPDA,
            executionPayload: payloadPDA,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown — payload too large");
      } catch (err: any) {
        expect(err).to.exist;
      }
    });
  });

  describe("dev_reveal_with_execution", () => {
    it("stores decrypted payload when passed", async () => {
      // Create proposal that ends immediately
      const { proposalPDA } = await createProposal(-10, 0);
      const [payloadPDA] = findPayloadPDA(proposalPDA);

      // Attach payload
      const recipient = Keypair.generate().publicKey;
      const plaintext = serializeTreasuryTransfer(recipient, gateMint, new BN(25));
      const hash = crypto.createHash("sha256").update(plaintext).digest();

      await program.methods
        .attachPayload(1, plaintext, Array.from(hash))
        .accounts({
          authority: authority.publicKey,
          proposal: proposalPDA,
          executionPayload: payloadPDA,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Cast a vote
      await castVote(proposalPDA);

      // Reveal with passing results (1 yes, 0 no = passes simple majority)
      const [tallyPDA] = findTallyPDA(proposalPDA);
      await program.methods
        .devRevealWithExecution(new BN(1), new BN(0), new BN(0), plaintext)
        .accounts({
          authority: authority.publicKey,
          proposal: proposalPDA,
          tally: tallyPDA,
          executionPayload: payloadPDA,
        })
        .rpc();

      const payload = await (program.account as any).executionPayload.fetch(payloadPDA);
      expect(payload.isDecrypted).to.be.true;
      expect(Buffer.from(payload.decryptedData).slice(0, 72).equals(plaintext)).to.be.true;

      const proposal = await (program.account as any).proposal.fetch(proposalPDA);
      expect(proposal.passed).to.be.true;
      expect(proposal.isRevealed).to.be.true;
    });

    it("does NOT store payload when failed", async () => {
      const { proposalPDA } = await createProposal(-10, 0);
      const [payloadPDA] = findPayloadPDA(proposalPDA);

      const recipient = Keypair.generate().publicKey;
      const plaintext = serializeTreasuryTransfer(recipient, gateMint, new BN(25));
      const hash = crypto.createHash("sha256").update(plaintext).digest();

      await program.methods
        .attachPayload(1, plaintext, Array.from(hash))
        .accounts({
          authority: authority.publicKey,
          proposal: proposalPDA,
          executionPayload: payloadPDA,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await castVote(proposalPDA);

      // Reveal with failing results (0 yes, 1 no = fails majority)
      const [tallyPDA] = findTallyPDA(proposalPDA);
      await program.methods
        .devRevealWithExecution(new BN(0), new BN(1), new BN(0), plaintext)
        .accounts({
          authority: authority.publicKey,
          proposal: proposalPDA,
          tally: tallyPDA,
          executionPayload: payloadPDA,
        })
        .rpc();

      const payload = await (program.account as any).executionPayload.fetch(payloadPDA);
      // Payload should NOT be decrypted since proposal failed
      expect(payload.isDecrypted).to.be.false;

      const proposal = await (program.account as any).proposal.fetch(proposalPDA);
      expect(proposal.passed).to.be.false;
    });
  });

  describe("execute_proposal", () => {
    it("fails if proposal not passed", async () => {
      const { proposalPDA } = await createProposal(-10, 0);
      const [payloadPDA] = findPayloadPDA(proposalPDA);

      const recipient = Keypair.generate().publicKey;
      const plaintext = serializeTreasuryTransfer(recipient, gateMint, new BN(10));
      const hash = crypto.createHash("sha256").update(plaintext).digest();

      await program.methods
        .attachPayload(1, plaintext, Array.from(hash))
        .accounts({
          authority: authority.publicKey,
          proposal: proposalPDA,
          executionPayload: payloadPDA,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await castVote(proposalPDA);

      // Reveal with failing results
      const [tallyPDA] = findTallyPDA(proposalPDA);
      await program.methods
        .devRevealWithExecution(new BN(0), new BN(1), new BN(0), plaintext)
        .accounts({
          authority: authority.publicKey,
          proposal: proposalPDA,
          tally: tallyPDA,
          executionPayload: payloadPDA,
        })
        .rpc();

      // Try to execute — should fail because proposal didn't pass
      const treasuryAta = getAssociatedTokenAddressSync(gateMint, proposalPDA, true);
      const recipientAta = getAssociatedTokenAddressSync(gateMint, recipient);

      try {
        await program.methods
          .executeProposal()
          .accounts({
            executor: authority.publicKey,
            proposal: proposalPDA,
            executionPayload: payloadPDA,
            treasuryTokenAccount: treasuryAta,
            recipientTokenAccount: recipientAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        expect.fail("Should have thrown — proposal not passed");
      } catch (err: any) {
        expect(err).to.exist;
      }
    });
  });

  describe("Backward compatibility", () => {
    it("proposals without payloads work unchanged", async () => {
      const { proposalPDA } = await createProposal(-10);

      await castVote(proposalPDA);

      // Reveal with standard dev_reveal_results (no payload)
      await program.methods
        .devRevealResults(new BN(1), new BN(0), new BN(0))
        .accounts({
          authority: authority.publicKey,
          proposal: proposalPDA,
          tally: findTallyPDA(proposalPDA)[0],
        })
        .rpc();

      const proposal = await (program.account as any).proposal.fetch(proposalPDA);
      expect(proposal.isRevealed).to.be.true;
      expect(proposal.passed).to.be.true;
      expect(proposal.executed).to.be.false;

      // No payload PDA should exist
      const [payloadPDA] = findPayloadPDA(proposalPDA);
      try {
        await (program.account as any).executionPayload.fetch(payloadPDA);
        expect.fail("Should have thrown — no payload exists");
      } catch (err: any) {
        expect(err).to.exist;
      }
    });
  });
});
