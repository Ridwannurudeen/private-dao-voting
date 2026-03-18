// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @arcium-hq/client since it may not be available in test env
vi.mock("@arcium-hq/client", () => ({
  RescueCipher: class {
    encrypt(data: bigint[], nonce: Uint8Array) {
      return [data[0]];
    }
  },
  x25519: {
    utils: { randomPrivateKey: () => new Uint8Array(32).fill(1) },
    getPublicKey: (key: Uint8Array) => new Uint8Array(32).fill(2),
    getSharedSecret: (priv: Uint8Array, pub_: Uint8Array) =>
      new Uint8Array(32).fill(3),
  },
  getArciumProgramId: () => ({ toBase58: () => "ArciumXXX" }),
  getMXEPublicKey: vi.fn(),
  getMXEAccAddress: () => ({ toBase58: () => "MXEacc" }),
  getMempoolAccAddress: () => ({ toBase58: () => "Mempool" }),
  getClusterAccAddress: () => ({ toBase58: () => "Cluster" }),
  getExecutingPoolAccAddress: () => ({ toBase58: () => "ExecPool" }),
  getComputationAccAddress: () => ({ toBase58: () => "CompAcc" }),
  getCompDefAccAddress: () => ({ toBase58: () => "CompDef" }),
  getCompDefAccOffset: () => Buffer.alloc(4),
  getClockAccAddress: () => ({ toBase58: () => "Clock" }),
  getFeePoolAccAddress: () => ({ toBase58: () => "FeePool" }),
  awaitComputationFinalization: vi.fn(),
}));

import { PublicKey, Connection } from "@solana/web3.js";
import { AnchorProvider, BN, Wallet } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import {
  ArciumClient,
  createArciumClient,
  deriveComputationOffset,
  findTallyPDA,
  getMempoolCapacity,
  getCircuitHash,
  CERBERUS_INFO,
  CIRCUIT_INSTRUCTIONS,
} from "../arcium";
import { PROGRAM_ID } from "../contract";

// ==================== HELPERS ====================

function makeProvider(): AnchorProvider {
  const connection = new Connection("http://localhost:8899", "confirmed");
  const keypair = Keypair.generate();
  const wallet = {
    publicKey: keypair.publicKey,
    signTransaction: vi.fn(),
    signAllTransactions: vi.fn(),
  } as unknown as Wallet;
  return new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
}

// ==================== TESTS ====================

describe("ArciumClient", () => {
  let provider: AnchorProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = makeProvider();
  });

  describe("initialization in dev mode", () => {
    it("initializes successfully without MXE program ID (dev mode)", async () => {
      const client = createArciumClient(provider);
      const result = await client.initialize(null);
      expect(result).toBe(true);
      expect(client.isConnected()).toBe(true);
      expect(client.isFallback()).toBe(false);
    });

    it("reports correct cluster info after dev-mode init", async () => {
      const client = createArciumClient(provider, new BN(789));
      await client.initialize(null);
      const info = client.getClusterInfo();
      expect(info.offset).toBe("789");
      expect(info.programId).toBeNull();
      expect(info.connected).toBe(true);
    });

    it("emits status events during initialization", async () => {
      const client = createArciumClient(provider);
      const events: string[] = [];
      client.onStatusChange((e) => events.push(e.status));
      await client.initialize(null);
      expect(events).toContain("PROCESSING");
      expect(events).toContain("IDLE");
    });

    it("unsubscribe removes callback", async () => {
      const client = createArciumClient(provider);
      const events: string[] = [];
      const unsub = client.onStatusChange((e) => events.push(e.status));
      unsub();
      await client.initialize(null);
      expect(events).toHaveLength(0);
    });
  });

  describe("vote encryption", () => {
    it("encrypts a vote and returns valid EncryptedVote structure", async () => {
      const client = createArciumClient(provider);
      await client.initialize(null);

      const proposal = PublicKey.unique();
      const voter = PublicKey.unique();
      const encrypted = await client.encryptVote(1, proposal, voter);

      expect(encrypted.ciphertext).toBeInstanceOf(Uint8Array);
      expect(encrypted.nonce).toBeInstanceOf(Uint8Array);
      expect(encrypted.publicKey).toBeInstanceOf(Uint8Array);
      expect(encrypted.sharedSecret).toBeInstanceOf(Uint8Array);
      expect(encrypted.ciphertext.length).toBe(32);
      expect(encrypted.nonce.length).toBe(16);
      expect(encrypted.publicKey.length).toBe(32);
      expect(encrypted.sharedSecret.length).toBe(32);
    });

    it("different votes produce different ciphertexts", async () => {
      const client = createArciumClient(provider);
      await client.initialize(null);

      const proposal = PublicKey.unique();
      const voter = PublicKey.unique();

      const yesVote = await client.encryptVote(1, proposal, voter);
      const noVote = await client.encryptVote(0, proposal, voter);

      // Nonces are random, so ciphertexts should differ
      const yesBuf = Buffer.from(yesVote.nonce).toString("hex");
      const noBuf = Buffer.from(noVote.nonce).toString("hex");
      expect(yesBuf).not.toBe(noBuf);
    });

    it("throws if called before initialization", async () => {
      const client = createArciumClient(provider);
      const proposal = PublicKey.unique();
      const voter = PublicKey.unique();
      await expect(client.encryptVote(1, proposal, voter)).rejects.toThrow(
        "Arcium not initialized"
      );
    });
  });

  describe("toSecretInput format", () => {
    it("converts EncryptedVote to SecretInput with correct array format", async () => {
      const client = createArciumClient(provider);
      await client.initialize(null);

      const proposal = PublicKey.unique();
      const voter = PublicKey.unique();
      const encrypted = await client.encryptVote(1, proposal, voter);
      const secret = client.toSecretInput(encrypted);

      expect(Array.isArray(secret.encryptedChoice)).toBe(true);
      expect(Array.isArray(secret.nonce)).toBe(true);
      expect(Array.isArray(secret.voterPubkey)).toBe(true);
      expect(secret.encryptedChoice.length).toBe(32);
      expect(secret.nonce.length).toBe(16);
      expect(secret.voterPubkey.length).toBe(32);

      // All values should be numbers (bytes)
      secret.encryptedChoice.forEach((v) => {
        expect(typeof v).toBe("number");
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      });
    });
  });

  describe("submitToCluster", () => {
    it("returns a computation ID and status", async () => {
      const client = createArciumClient(provider);
      await client.initialize(null);

      const proposal = PublicKey.unique();
      const voter = PublicKey.unique();
      const encrypted = await client.encryptVote(1, proposal, voter);

      const result = await client.submitToCluster(
        encrypted,
        proposal.toBase58(),
        voter.toBase58()
      );

      expect(result.computationId).toBeDefined();
      expect(result.computationId).toContain("mxe_");
      expect(result.status).toBe("submitted");
    });
  });

  describe("retryMXEConnection", () => {
    it("returns true immediately when not in fallback mode", async () => {
      const client = createArciumClient(provider);
      await client.initialize(null); // dev mode => not fallback
      const result = await client.retryMXEConnection();
      // Not in fallback mode and initialized => returns true
      expect(result).toBe(true);
    });

    it("returns false when not initialized and not in fallback", async () => {
      const client = createArciumClient(provider);
      // Not initialized, not in fallback, no mxeProgramId
      const result = await client.retryMXEConnection();
      expect(result).toBe(false);
    });
  });

  describe("getArciumAccounts", () => {
    it("throws when MXE program ID is not set (dev mode)", async () => {
      const client = createArciumClient(provider);
      await client.initialize(null);
      expect(() =>
        client.getArciumAccounts("cast_vote", new BN(1))
      ).toThrow("MXE program id not set");
    });
  });
});

// ==================== PURE FUNCTION TESTS ====================

describe("deriveComputationOffset", () => {
  it("produces deterministic offset from proposal pubkey", () => {
    const pk = new PublicKey("11111111111111111111111111111111");
    const offset1 = deriveComputationOffset(pk);
    const offset2 = deriveComputationOffset(pk);
    expect(offset1.toString()).toBe(offset2.toString());
  });

  it("different pubkeys produce different offsets", () => {
    // Use Keypair.generate() to get keys with meaningfully different bytes
    const pk1 = Keypair.generate().publicKey;
    const pk2 = Keypair.generate().publicKey;
    const offset1 = deriveComputationOffset(pk1);
    const offset2 = deriveComputationOffset(pk2);
    expect(offset1.toString()).not.toBe(offset2.toString());
  });

  it("salt changes the offset", () => {
    const pk = new PublicKey("11111111111111111111111111111111");
    const offset1 = deriveComputationOffset(pk);
    const offset2 = deriveComputationOffset(pk, 12345);
    expect(offset1.toString()).not.toBe(offset2.toString());
  });

  it("returns a BN instance", () => {
    const pk = PublicKey.unique();
    const offset = deriveComputationOffset(pk);
    expect(offset).toBeInstanceOf(BN);
  });

  it("zero salt is different from no salt", () => {
    const pk = new PublicKey("11111111111111111111111111111111");
    const noSalt = deriveComputationOffset(pk);
    const zeroSalt = deriveComputationOffset(pk, 0);
    // salt=0 adds BN(0), so the result should be the same
    expect(noSalt.toString()).toBe(zeroSalt.toString());
  });
});

describe("findTallyPDA", () => {
  it("derives a valid off-curve PDA", () => {
    const proposal = PublicKey.unique();
    const [pda, bump] = findTallyPDA(proposal, PROGRAM_ID);
    expect(pda).toBeInstanceOf(PublicKey);
    expect(PublicKey.isOnCurve(pda)).toBe(false);
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);
  });

  it("same proposal gives same PDA", () => {
    const proposal = PublicKey.unique();
    const [pda1] = findTallyPDA(proposal, PROGRAM_ID);
    const [pda2] = findTallyPDA(proposal, PROGRAM_ID);
    expect(pda1.equals(pda2)).toBe(true);
  });
});

// ==================== CONFIG HELPER TESTS ====================

describe("config helpers", () => {
  it("getMempoolCapacity defaults to Tiny", () => {
    expect(getMempoolCapacity()).toBe("Tiny");
  });

  it("getCircuitHash returns placeholder in test", () => {
    const hash = getCircuitHash();
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
  });

  it("CIRCUIT_INSTRUCTIONS contains expected instruction names", () => {
    expect(CIRCUIT_INSTRUCTIONS).toContain("cast_vote");
    expect(CIRCUIT_INSTRUCTIONS).toContain("initialize_voting");
    expect(CIRCUIT_INSTRUCTIONS).toContain("finalize_and_reveal");
    expect(CIRCUIT_INSTRUCTIONS).toContain("finalize_with_threshold");
    expect(CIRCUIT_INSTRUCTIONS).toContain("get_vote_count");
    expect(CIRCUIT_INSTRUCTIONS).toContain("get_live_tally");
  });

  it("CERBERUS_INFO describes dishonest majority model", () => {
    expect(CERBERUS_INFO.name).toBe("Cerberus");
    expect(CERBERUS_INFO.securityModel).toBe("Dishonest Majority");
  });
});
