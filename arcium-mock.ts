/**
 * Mock Arcium Client for Testing
 *
 * This module provides a mock implementation of the Arcium SDK
 * for testing purposes. It simulates encryption/decryption operations
 * locally without requiring a real MXE connection.
 */

import { Keypair, PublicKey } from "@solana/web3.js";
import * as crypto from "crypto";

// Types matching the real Arcium SDK interface
export interface EncryptionContext {
  computationId: Uint8Array;
  circuitName: string;
  keyType: "Shared" | "Private";
  derivedKey: Uint8Array;
}

export interface MXEConfig {
  endpoint?: string;
  mxeClusterKey?: PublicKey;
}

export interface ComputationId {
  bytes: Uint8Array;
}

export interface RequiredAccounts {
  stateAccount: PublicKey;
  computationAccount: PublicKey;
}

/**
 * Mock Arcium Client
 *
 * Simulates the Arcium SDK behavior for local testing.
 * Uses AES-256-GCM for encryption (same as real implementation).
 */
export class MockArciumClient {
  private config: MXEConfig;
  private mockMasterKey: Uint8Array;

  constructor(config: MXEConfig = {}) {
    this.config = config;
    // Generate a deterministic mock master key for testing
    this.mockMasterKey = crypto
      .createHash("sha256")
      .update("mock-arcium-master-key-for-testing")
      .digest();
  }

  /**
   * Derive encryption key for a computation
   */
  deriveKey(computationId: Uint8Array, circuitName: string): Uint8Array {
    const combined = Buffer.concat([
      this.mockMasterKey,
      computationId,
      Buffer.from(circuitName),
    ]);
    return crypto.createHash("sha256").update(combined).digest();
  }

  /**
   * Encrypt data using the derived key
   */
  async encrypt(params: {
    data: Uint8Array;
    context: EncryptionContext;
    dataType: string;
  }): Promise<Uint8Array> {
    const { data, context } = params;

    // Generate a random nonce (12 bytes for GCM)
    const nonce = crypto.randomBytes(12);

    // Create cipher
    const cipher = crypto.createCipheriv(
      "aes-256-gcm",
      context.derivedKey,
      nonce
    );

    // Add computation ID as AAD (Additional Authenticated Data)
    cipher.setAAD(Buffer.from(context.computationId));

    // Encrypt
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Return: nonce (12) + ciphertext + authTag (16)
    return Buffer.concat([nonce, encrypted, authTag]);
  }

  /**
   * Decrypt data using the derived key
   */
  async decrypt(params: {
    encryptedData: Uint8Array;
    context: EncryptionContext;
    dataType: string;
  }): Promise<Uint8Array> {
    const { encryptedData, context } = params;
    const buffer = Buffer.from(encryptedData);

    // Extract components
    const nonce = buffer.subarray(0, 12);
    const authTag = buffer.subarray(buffer.length - 16);
    const ciphertext = buffer.subarray(12, buffer.length - 16);

    // Create decipher
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      context.derivedKey,
      nonce
    );

    // Set AAD and auth tag
    decipher.setAAD(Buffer.from(context.computationId));
    decipher.setAuthTag(authTag);

    // Decrypt
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  /**
   * Get mock required accounts for testing
   */
  async getRequiredAccounts(): Promise<RequiredAccounts> {
    return {
      stateAccount: Keypair.generate().publicKey,
      computationAccount: Keypair.generate().publicKey,
    };
  }
}

/**
 * Mock Shared Secret Manager
 */
export class MockSharedSecretManager {
  private client: MockArciumClient;

  constructor(client: MockArciumClient) {
    this.client = client;
  }

  /**
   * Derive encryption context for a computation
   */
  async deriveContext(params: {
    computationId: ComputationId | Uint8Array;
    circuitName: string;
    keyType: "Shared" | "Private";
  }): Promise<EncryptionContext> {
    const computationId =
      params.computationId instanceof Uint8Array
        ? params.computationId
        : params.computationId.bytes;

    const derivedKey = this.client.deriveKey(computationId, params.circuitName);

    return {
      computationId,
      circuitName: params.circuitName,
      keyType: params.keyType,
      derivedKey,
    };
  }
}

/**
 * Mock Arcis Test Context for Rust-like testing in TypeScript
 *
 * Simulates the encrypted computation environment for testing
 * the voting circuit logic.
 */
export class MockArcisTestContext {
  private client: MockArciumClient;
  private secretManager: MockSharedSecretManager;
  private computationId: Uint8Array;
  private encryptionContext: EncryptionContext | null = null;

  constructor() {
    this.client = new MockArciumClient();
    this.secretManager = new MockSharedSecretManager(this.client);
    this.computationId = crypto.randomBytes(32);
  }

  /**
   * Initialize the encryption context
   */
  async initialize(circuitName: string = "voting_circuit"): Promise<void> {
    this.encryptionContext = await this.secretManager.deriveContext({
      computationId: this.computationId,
      circuitName,
      keyType: "Shared",
    });
  }

  /**
   * Encrypt a value (simulates .to_arcis())
   */
  async encrypt<T>(value: T): Promise<Uint8Array> {
    if (!this.encryptionContext) {
      await this.initialize();
    }

    // Serialize value to bytes
    let bytes: Uint8Array;
    if (typeof value === "number") {
      if (Number.isInteger(value) && value >= 0 && value <= 255) {
        bytes = new Uint8Array([value]);
      } else {
        // For larger numbers, use 8 bytes (u64)
        const buffer = Buffer.alloc(8);
        buffer.writeBigUInt64LE(BigInt(value));
        bytes = buffer;
      }
    } else if (typeof value === "bigint") {
      const buffer = Buffer.alloc(8);
      buffer.writeBigUInt64LE(value);
      bytes = buffer;
    } else {
      throw new Error(`Unsupported type for encryption: ${typeof value}`);
    }

    return this.client.encrypt({
      data: bytes,
      context: this.encryptionContext!,
      dataType: typeof value,
    });
  }

  /**
   * Decrypt a value (simulates .from_arcis())
   */
  async decrypt<T>(encryptedData: Uint8Array, type: "u8" | "u64" = "u8"): Promise<T> {
    if (!this.encryptionContext) {
      throw new Error("Context not initialized");
    }

    const decrypted = await this.client.decrypt({
      encryptedData,
      context: this.encryptionContext,
      dataType: type,
    });

    if (type === "u8") {
      return decrypted[0] as T;
    } else {
      const buffer = Buffer.from(decrypted);
      return Number(buffer.readBigUInt64LE()) as T;
    }
  }

  /**
   * Check if two ciphertexts have the same size
   */
  ciphertextSize(ciphertext: Uint8Array): number {
    return ciphertext.length;
  }

  /**
   * Check if ciphertexts are equal (they shouldn't be due to random nonces)
   */
  ciphertextsEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
}

/**
 * Mock Voting State for testing
 */
export class MockVotingState {
  totalYesVotes: Uint8Array;
  totalNoVotes: Uint8Array;
  totalVotesCast: Uint8Array;
  isActive: Uint8Array;

  private ctx: MockArcisTestContext;

  constructor(ctx: MockArcisTestContext) {
    this.ctx = ctx;
    this.totalYesVotes = new Uint8Array();
    this.totalNoVotes = new Uint8Array();
    this.totalVotesCast = new Uint8Array();
    this.isActive = new Uint8Array();
  }

  /**
   * Initialize state with encrypted zeros
   */
  async initialize(): Promise<void> {
    this.totalYesVotes = await this.ctx.encrypt(BigInt(0));
    this.totalNoVotes = await this.ctx.encrypt(BigInt(0));
    this.totalVotesCast = await this.ctx.encrypt(BigInt(0));
    this.isActive = await this.ctx.encrypt(1);
  }

  /**
   * Cast a vote (encrypted)
   */
  async castVote(encryptedVote: Uint8Array): Promise<void> {
    // Decrypt current state
    const currentYes = await this.ctx.decrypt<number>(this.totalYesVotes, "u64");
    const currentNo = await this.ctx.decrypt<number>(this.totalNoVotes, "u64");
    const currentTotal = await this.ctx.decrypt<number>(this.totalVotesCast, "u64");
    
    // Decrypt vote
    const vote = await this.ctx.decrypt<number>(encryptedVote, "u8");
    
    // Update counts
    const newYes = vote === 1 ? currentYes + 1 : currentYes;
    const newNo = vote === 0 ? currentNo + 1 : currentNo;
    const newTotal = currentTotal + 1;
    
    // Re-encrypt
    this.totalYesVotes = await this.ctx.encrypt(BigInt(newYes));
    this.totalNoVotes = await this.ctx.encrypt(BigInt(newNo));
    this.totalVotesCast = await this.ctx.encrypt(BigInt(newTotal));
  }

  /**
   * Finalize and get results
   */
  async finalize(): Promise<{ yesVotes: number; noVotes: number; totalVotes: number }> {
    const yesVotes = await this.ctx.decrypt<number>(this.totalYesVotes, "u64");
    const noVotes = await this.ctx.decrypt<number>(this.totalNoVotes, "u64");
    const totalVotes = await this.ctx.decrypt<number>(this.totalVotesCast, "u64");
    
    return { yesVotes, noVotes, totalVotes };
  }
}

// Export for testing
export {
  MockArciumClient as ArciumClient,
  MockSharedSecretManager as SharedSecretManager,
  MockArcisTestContext as ArcisTestContext,
  MockVotingState as VotingState,
};
