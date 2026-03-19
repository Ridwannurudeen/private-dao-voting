/**
 * Mock Arcium client for unit testing without a real MXE.
 * Uses Node.js crypto (AES-256-GCM) for realistic encrypt/decrypt.
 */

import * as crypto from "crypto";

export interface EncryptionContext {
  key: Uint8Array;
  computationId: Uint8Array;
  circuitName: string;
}

export class ArciumClient {
  deriveKey(computationId: Uint8Array, circuitName: string): Uint8Array {
    const hash = crypto.createHash("sha256");
    hash.update(Buffer.from(computationId));
    hash.update(circuitName);
    return new Uint8Array(hash.digest());
  }

  async encrypt({
    data,
    context,
  }: {
    data: Uint8Array;
    context: EncryptionContext;
    dataType: string;
  }): Promise<Uint8Array> {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(
      "aes-256-gcm",
      Buffer.from(context.key),
      iv
    );
    const encrypted = Buffer.concat([
      cipher.update(Buffer.from(data)),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    // Format: iv (12) + authTag (16) + ciphertext
    return new Uint8Array(Buffer.concat([iv, authTag, encrypted]));
  }

  async decrypt({
    encryptedData,
    context,
  }: {
    encryptedData: Uint8Array;
    context: EncryptionContext;
    dataType: string;
  }): Promise<Uint8Array> {
    const buf = Buffer.from(encryptedData);
    const iv = buf.subarray(0, 12);
    const authTag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      Buffer.from(context.key),
      iv
    );
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return new Uint8Array(decrypted);
  }
}

export class SharedSecretManager {
  private client: ArciumClient;

  constructor(client: ArciumClient) {
    this.client = client;
  }

  async deriveContext({
    computationId,
    circuitName,
  }: {
    computationId: Uint8Array;
    circuitName: string;
    keyType: string;
  }): Promise<EncryptionContext> {
    const key = this.client.deriveKey(computationId, circuitName);
    return { key, computationId, circuitName };
  }
}

export class ArcisTestContext {
  private client: ArciumClient;
  private secretManager: SharedSecretManager;
  private context!: EncryptionContext;

  constructor() {
    this.client = new ArciumClient();
    this.secretManager = new SharedSecretManager(this.client);
  }

  async initialize(): Promise<void> {
    this.context = await this.secretManager.deriveContext({
      computationId: new Uint8Array(32).fill(1),
      circuitName: "test_voting",
      keyType: "Shared",
    });
  }

  async encrypt(value: number | bigint): Promise<Uint8Array> {
    let data: Uint8Array;
    if (typeof value === "bigint") {
      const buf = Buffer.alloc(8);
      buf.writeBigUInt64LE(value);
      data = new Uint8Array(buf);
    } else {
      data = new Uint8Array([value]);
    }
    return this.client.encrypt({
      data,
      context: this.context,
      dataType: typeof value === "bigint" ? "u64" : "u8",
    });
  }

  async decrypt<T>(encrypted: Uint8Array, dataType: string): Promise<T> {
    const decrypted = await this.client.decrypt({
      encryptedData: encrypted,
      context: this.context,
      dataType,
    });
    if (dataType === "u64") {
      const buf = Buffer.from(decrypted);
      return Number(buf.readBigUInt64LE(0)) as unknown as T;
    }
    return decrypted[0] as unknown as T;
  }

  ciphertextsEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    return Buffer.from(a).equals(Buffer.from(b));
  }

  ciphertextSize(ct: Uint8Array): number {
    return ct.length;
  }
}

export class VotingState {
  private ctx: ArcisTestContext;
  private votes: Uint8Array[] = [];

  constructor(ctx: ArcisTestContext) {
    this.ctx = ctx;
  }

  async initialize(): Promise<void> {
    this.votes = [];
  }

  async castVote(encryptedVote: Uint8Array): Promise<void> {
    this.votes.push(encryptedVote);
  }

  async finalize(): Promise<{
    yesVotes: number;
    noVotes: number;
    totalVotes: number;
  }> {
    let yesVotes = 0;
    let noVotes = 0;
    for (const vote of this.votes) {
      const value = await this.ctx.decrypt<number>(vote, "u8");
      if (value === 1) yesVotes++;
      else noVotes++;
    }
    return { yesVotes, noVotes, totalVotes: this.votes.length };
  }
}
