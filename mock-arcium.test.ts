/**
 * Mock Arcium and Voting Circuit Tests
 *
 * These tests verify the mock implementation behaves correctly
 * and can be used to test the voting logic without a real MXE.
 */

import { expect } from "chai";
import {
  ArciumClient,
  SharedSecretManager,
  ArcisTestContext,
  VotingState,
  EncryptionContext,
} from "./mocks/arcium-mock";

describe("Mock Arcium Client Tests", () => {
  let client: ArciumClient;
  let secretManager: SharedSecretManager;

  beforeEach(() => {
    client = new ArciumClient();
    secretManager = new SharedSecretManager(client);
  });

  describe("Key Derivation", () => {
    it("should derive consistent keys for same inputs", () => {
      const computationId = new Uint8Array(32).fill(1);
      const circuitName = "test_circuit";

      const key1 = client.deriveKey(computationId, circuitName);
      const key2 = client.deriveKey(computationId, circuitName);

      expect(Buffer.from(key1).toString("hex")).to.equal(
        Buffer.from(key2).toString("hex")
      );
    });

    it("should derive different keys for different computation IDs", () => {
      const computationId1 = new Uint8Array(32).fill(1);
      const computationId2 = new Uint8Array(32).fill(2);
      const circuitName = "test_circuit";

      const key1 = client.deriveKey(computationId1, circuitName);
      const key2 = client.deriveKey(computationId2, circuitName);

      expect(Buffer.from(key1).toString("hex")).to.not.equal(
        Buffer.from(key2).toString("hex")
      );
    });

    it("should derive different keys for different circuit names", () => {
      const computationId = new Uint8Array(32).fill(1);

      const key1 = client.deriveKey(computationId, "circuit_a");
      const key2 = client.deriveKey(computationId, "circuit_b");

      expect(Buffer.from(key1).toString("hex")).to.not.equal(
        Buffer.from(key2).toString("hex")
      );
    });
  });

  describe("Encryption/Decryption", () => {
    let context: EncryptionContext;

    beforeEach(async () => {
      context = await secretManager.deriveContext({
        computationId: new Uint8Array(32).fill(42),
        circuitName: "voting_circuit",
        keyType: "Shared",
      });
    });

    it("should encrypt and decrypt single byte correctly", async () => {
      const original = new Uint8Array([1]);
      
      const encrypted = await client.encrypt({
        data: original,
        context,
        dataType: "u8",
      });
      
      const decrypted = await client.decrypt({
        encryptedData: encrypted,
        context,
        dataType: "u8",
      });

      expect(decrypted[0]).to.equal(original[0]);
    });

    it("should encrypt and decrypt zero correctly", async () => {
      const original = new Uint8Array([0]);
      
      const encrypted = await client.encrypt({
        data: original,
        context,
        dataType: "u8",
      });
      
      const decrypted = await client.decrypt({
        encryptedData: encrypted,
        context,
        dataType: "u8",
      });

      expect(decrypted[0]).to.equal(0);
    });

    it("should produce different ciphertexts for same plaintext (due to random nonce)", async () => {
      const original = new Uint8Array([1]);
      
      const encrypted1 = await client.encrypt({
        data: original,
        context,
        dataType: "u8",
      });
      
      const encrypted2 = await client.encrypt({
        data: original,
        context,
        dataType: "u8",
      });

      // Ciphertexts should be different
      expect(Buffer.from(encrypted1).toString("hex")).to.not.equal(
        Buffer.from(encrypted2).toString("hex")
      );
    });

    it("should produce same size ciphertexts for 0 and 1", async () => {
      const encrypted0 = await client.encrypt({
        data: new Uint8Array([0]),
        context,
        dataType: "u8",
      });
      
      const encrypted1 = await client.encrypt({
        data: new Uint8Array([1]),
        context,
        dataType: "u8",
      });

      expect(encrypted0.length).to.equal(encrypted1.length);
    });

    it("should fail decryption with wrong key", async () => {
      const encrypted = await client.encrypt({
        data: new Uint8Array([1]),
        context,
        dataType: "u8",
      });

      // Create a different context with different key
      const wrongContext = await secretManager.deriveContext({
        computationId: new Uint8Array(32).fill(99),
        circuitName: "voting_circuit",
        keyType: "Shared",
      });

      try {
        await client.decrypt({
          encryptedData: encrypted,
          context: wrongContext,
          dataType: "u8",
        });
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.message).to.include("Unsupported state");
      }
    });
  });
});

describe("Arcis Test Context", () => {
  let ctx: ArcisTestContext;

  beforeEach(async () => {
    ctx = new ArcisTestContext();
    await ctx.initialize();
  });

  describe("Encryption Operations", () => {
    it("should encrypt and decrypt u8 values", async () => {
      const encrypted = await ctx.encrypt(42);
      const decrypted = await ctx.decrypt<number>(encrypted, "u8");
      
      expect(decrypted).to.equal(42);
    });

    it("should encrypt and decrypt vote values (0 and 1)", async () => {
      const encryptedNo = await ctx.encrypt(0);
      const encryptedYes = await ctx.encrypt(1);
      
      const decryptedNo = await ctx.decrypt<number>(encryptedNo, "u8");
      const decryptedYes = await ctx.decrypt<number>(encryptedYes, "u8");
      
      expect(decryptedNo).to.equal(0);
      expect(decryptedYes).to.equal(1);
    });

    it("should encrypt and decrypt u64 values", async () => {
      const encrypted = await ctx.encrypt(BigInt(1000000));
      const decrypted = await ctx.decrypt<number>(encrypted, "u64");
      
      expect(decrypted).to.equal(1000000);
    });

    it("should encrypt and decrypt large u64 values", async () => {
      const largeValue = BigInt("9007199254740991"); // Max safe integer
      const encrypted = await ctx.encrypt(largeValue);
      const decrypted = await ctx.decrypt<number>(encrypted, "u64");
      
      expect(decrypted).to.equal(Number(largeValue));
    });
  });

  describe("Ciphertext Properties", () => {
    it("should produce different ciphertexts for same value", async () => {
      const encrypted1 = await ctx.encrypt(1);
      const encrypted2 = await ctx.encrypt(1);
      
      expect(ctx.ciphertextsEqual(encrypted1, encrypted2)).to.be.false;
    });

    it("should produce same size ciphertexts", async () => {
      const encrypted0 = await ctx.encrypt(0);
      const encrypted1 = await ctx.encrypt(1);
      
      expect(ctx.ciphertextSize(encrypted0)).to.equal(ctx.ciphertextSize(encrypted1));
    });
  });
});

describe("Mock Voting State", () => {
  let ctx: ArcisTestContext;
  let state: VotingState;

  beforeEach(async () => {
    ctx = new ArcisTestContext();
    await ctx.initialize();
    state = new VotingState(ctx);
    await state.initialize();
  });

  describe("Initialization", () => {
    it("should initialize with zero votes", async () => {
      const result = await state.finalize();
      
      expect(result.yesVotes).to.equal(0);
      expect(result.noVotes).to.equal(0);
      expect(result.totalVotes).to.equal(0);
    });
  });

  describe("Casting Votes", () => {
    it("should count a single yes vote", async () => {
      const encryptedYes = await ctx.encrypt(1);
      await state.castVote(encryptedYes);
      
      const result = await state.finalize();
      
      expect(result.yesVotes).to.equal(1);
      expect(result.noVotes).to.equal(0);
      expect(result.totalVotes).to.equal(1);
    });

    it("should count a single no vote", async () => {
      const encryptedNo = await ctx.encrypt(0);
      await state.castVote(encryptedNo);
      
      const result = await state.finalize();
      
      expect(result.yesVotes).to.equal(0);
      expect(result.noVotes).to.equal(1);
      expect(result.totalVotes).to.equal(1);
    });

    it("should count multiple yes votes", async () => {
      for (let i = 0; i < 5; i++) {
        const encryptedYes = await ctx.encrypt(1);
        await state.castVote(encryptedYes);
      }
      
      const result = await state.finalize();
      
      expect(result.yesVotes).to.equal(5);
      expect(result.noVotes).to.equal(0);
      expect(result.totalVotes).to.equal(5);
    });

    it("should count multiple no votes", async () => {
      for (let i = 0; i < 3; i++) {
        const encryptedNo = await ctx.encrypt(0);
        await state.castVote(encryptedNo);
      }
      
      const result = await state.finalize();
      
      expect(result.yesVotes).to.equal(0);
      expect(result.noVotes).to.equal(3);
      expect(result.totalVotes).to.equal(3);
    });

    it("should count mixed votes correctly", async () => {
      // Cast 7 yes votes
      for (let i = 0; i < 7; i++) {
        const encryptedYes = await ctx.encrypt(1);
        await state.castVote(encryptedYes);
      }
      
      // Cast 3 no votes
      for (let i = 0; i < 3; i++) {
        const encryptedNo = await ctx.encrypt(0);
        await state.castVote(encryptedNo);
      }
      
      const result = await state.finalize();
      
      expect(result.yesVotes).to.equal(7);
      expect(result.noVotes).to.equal(3);
      expect(result.totalVotes).to.equal(10);
    });

    it("should handle 100 votes", async () => {
      const yesCount = 60;
      const noCount = 40;
      
      for (let i = 0; i < yesCount; i++) {
        await state.castVote(await ctx.encrypt(1));
      }
      
      for (let i = 0; i < noCount; i++) {
        await state.castVote(await ctx.encrypt(0));
      }
      
      const result = await state.finalize();
      
      expect(result.yesVotes).to.equal(yesCount);
      expect(result.noVotes).to.equal(noCount);
      expect(result.totalVotes).to.equal(yesCount + noCount);
    });
  });

  describe("Vote Privacy", () => {
    it("should not reveal vote value from ciphertext size", async () => {
      const encryptedYes = await ctx.encrypt(1);
      const encryptedNo = await ctx.encrypt(0);
      
      expect(ctx.ciphertextSize(encryptedYes)).to.equal(ctx.ciphertextSize(encryptedNo));
    });

    it("should produce unique ciphertexts for each vote", async () => {
      const votes: Uint8Array[] = [];
      
      for (let i = 0; i < 10; i++) {
        votes.push(await ctx.encrypt(1));
      }
      
      // Check all pairs are different
      for (let i = 0; i < votes.length; i++) {
        for (let j = i + 1; j < votes.length; j++) {
          expect(ctx.ciphertextsEqual(votes[i], votes[j])).to.be.false;
        }
      }
    });
  });
});

describe("Voting Circuit Simulation", () => {
  let ctx: ArcisTestContext;
  let state: VotingState;

  beforeEach(async () => {
    ctx = new ArcisTestContext();
    await ctx.initialize();
    state = new VotingState(ctx);
    await state.initialize();
  });

  describe("Full Voting Flow", () => {
    it("should simulate complete proposal lifecycle", async () => {
      // 1. Initialize (already done in beforeEach)
      let result = await state.finalize();
      expect(result.totalVotes).to.equal(0);
      
      // 2. Voting period - cast votes
      const voters = [
        { vote: 1 }, // Yes
        { vote: 1 }, // Yes
        { vote: 0 }, // No
        { vote: 1 }, // Yes
        { vote: 0 }, // No
        { vote: 1 }, // Yes
        { vote: 1 }, // Yes
      ];
      
      for (const voter of voters) {
        const encryptedVote = await ctx.encrypt(voter.vote);
        await state.castVote(encryptedVote);
      }
      
      // 3. Finalize and reveal
      result = await state.finalize();
      
      expect(result.yesVotes).to.equal(5);
      expect(result.noVotes).to.equal(2);
      expect(result.totalVotes).to.equal(7);
    });

    it("should handle unanimous yes vote", async () => {
      for (let i = 0; i < 50; i++) {
        await state.castVote(await ctx.encrypt(1));
      }
      
      const result = await state.finalize();
      
      expect(result.yesVotes).to.equal(50);
      expect(result.noVotes).to.equal(0);
      expect(result.totalVotes).to.equal(50);
    });

    it("should handle unanimous no vote", async () => {
      for (let i = 0; i < 50; i++) {
        await state.castVote(await ctx.encrypt(0));
      }
      
      const result = await state.finalize();
      
      expect(result.yesVotes).to.equal(0);
      expect(result.noVotes).to.equal(50);
      expect(result.totalVotes).to.equal(50);
    });

    it("should handle tie vote", async () => {
      for (let i = 0; i < 25; i++) {
        await state.castVote(await ctx.encrypt(1));
        await state.castVote(await ctx.encrypt(0));
      }
      
      const result = await state.finalize();
      
      expect(result.yesVotes).to.equal(25);
      expect(result.noVotes).to.equal(25);
      expect(result.totalVotes).to.equal(50);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty proposal (no votes)", async () => {
      const result = await state.finalize();
      
      expect(result.yesVotes).to.equal(0);
      expect(result.noVotes).to.equal(0);
      expect(result.totalVotes).to.equal(0);
    });

    it("should handle single voter", async () => {
      await state.castVote(await ctx.encrypt(1));
      
      const result = await state.finalize();
      
      expect(result.yesVotes).to.equal(1);
      expect(result.noVotes).to.equal(0);
      expect(result.totalVotes).to.equal(1);
    });
  });
});
