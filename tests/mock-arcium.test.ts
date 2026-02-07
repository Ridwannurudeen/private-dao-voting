import { expect } from "chai";
import * as crypto from "crypto";
import {
  ArciumClient,
  SharedSecretManager,
  ArcisTestContext,
  VotingState,
} from "../arcium-mock";

describe("Mock Arcium Encryption", () => {
  let ctx: ArcisTestContext;

  beforeEach(async () => {
    ctx = new ArcisTestContext();
    await ctx.initialize();
  });

  describe("Key Derivation", () => {
    it("should derive consistent keys for the same inputs", () => {
      const client = new ArciumClient();
      const compId = crypto.randomBytes(32);
      const key1 = client.deriveKey(compId, "voting_circuit");
      const key2 = client.deriveKey(compId, "voting_circuit");
      expect(Buffer.from(key1).toString("hex")).to.equal(
        Buffer.from(key2).toString("hex")
      );
    });

    it("should derive different keys for different circuit names", () => {
      const client = new ArciumClient();
      const compId = crypto.randomBytes(32);
      const key1 = client.deriveKey(compId, "voting_circuit");
      const key2 = client.deriveKey(compId, "other_circuit");
      expect(Buffer.from(key1).toString("hex")).to.not.equal(
        Buffer.from(key2).toString("hex")
      );
    });

    it("should derive different keys for different computation IDs", () => {
      const client = new ArciumClient();
      const key1 = client.deriveKey(crypto.randomBytes(32), "voting_circuit");
      const key2 = client.deriveKey(crypto.randomBytes(32), "voting_circuit");
      expect(Buffer.from(key1).toString("hex")).to.not.equal(
        Buffer.from(key2).toString("hex")
      );
    });
  });

  describe("Encryption / Decryption", () => {
    it("should round-trip a u8 value", async () => {
      const encrypted = await ctx.encrypt(1);
      const decrypted = await ctx.decrypt<number>(encrypted, "u8");
      expect(decrypted).to.equal(1);
    });

    it("should round-trip a u64 value", async () => {
      const encrypted = await ctx.encrypt(BigInt(123456789));
      const decrypted = await ctx.decrypt<number>(encrypted, "u64");
      expect(decrypted).to.equal(123456789);
    });

    it("should round-trip zero values", async () => {
      const encrypted = await ctx.encrypt(0);
      const decrypted = await ctx.decrypt<number>(encrypted, "u8");
      expect(decrypted).to.equal(0);
    });

    it("should produce different ciphertexts for the same plaintext (random nonce)", async () => {
      const enc1 = await ctx.encrypt(1);
      const enc2 = await ctx.encrypt(1);
      expect(ctx.ciphertextsEqual(enc1, enc2)).to.be.false;
    });

    it("should produce ciphertexts of consistent size", async () => {
      const enc1 = await ctx.encrypt(0);
      const enc2 = await ctx.encrypt(255);
      expect(ctx.ciphertextSize(enc1)).to.equal(ctx.ciphertextSize(enc2));
    });
  });

  describe("SharedSecretManager", () => {
    it("should derive a valid encryption context", async () => {
      const client = new ArciumClient();
      const manager = new SharedSecretManager(client);
      const compId = crypto.randomBytes(32);

      const context = await manager.deriveContext({
        computationId: compId,
        circuitName: "voting_circuit",
        keyType: "Shared",
      });

      expect(context.circuitName).to.equal("voting_circuit");
      expect(context.keyType).to.equal("Shared");
      expect(context.derivedKey.length).to.equal(32);
      expect(Buffer.from(context.computationId).toString("hex")).to.equal(
        Buffer.from(compId).toString("hex")
      );
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

  it("should initialize with zero counts", async () => {
    const result = await state.finalize();
    expect(result.yesVotes).to.equal(0);
    expect(result.noVotes).to.equal(0);
    expect(result.totalVotes).to.equal(0);
  });

  it("should count a single YES vote", async () => {
    const vote = await ctx.encrypt(1); // YES
    await state.castVote(vote);

    const result = await state.finalize();
    expect(result.yesVotes).to.equal(1);
    expect(result.noVotes).to.equal(0);
    expect(result.totalVotes).to.equal(1);
  });

  it("should count a single NO vote", async () => {
    const vote = await ctx.encrypt(0); // NO
    await state.castVote(vote);

    const result = await state.finalize();
    expect(result.yesVotes).to.equal(0);
    expect(result.noVotes).to.equal(1);
    expect(result.totalVotes).to.equal(1);
  });

  it("should count multiple mixed votes correctly", async () => {
    // 3 YES, 2 NO
    await state.castVote(await ctx.encrypt(1));
    await state.castVote(await ctx.encrypt(1));
    await state.castVote(await ctx.encrypt(0));
    await state.castVote(await ctx.encrypt(1));
    await state.castVote(await ctx.encrypt(0));

    const result = await state.finalize();
    expect(result.yesVotes).to.equal(3);
    expect(result.noVotes).to.equal(2);
    expect(result.totalVotes).to.equal(5);
  });

  it("should handle all YES votes", async () => {
    for (let i = 0; i < 10; i++) {
      await state.castVote(await ctx.encrypt(1));
    }

    const result = await state.finalize();
    expect(result.yesVotes).to.equal(10);
    expect(result.noVotes).to.equal(0);
    expect(result.totalVotes).to.equal(10);
  });

  it("should handle all NO votes", async () => {
    for (let i = 0; i < 10; i++) {
      await state.castVote(await ctx.encrypt(0));
    }

    const result = await state.finalize();
    expect(result.yesVotes).to.equal(0);
    expect(result.noVotes).to.equal(10);
    expect(result.totalVotes).to.equal(10);
  });

  it("should maintain correct tally after many votes", async () => {
    const yesCount = 50;
    const noCount = 30;

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
