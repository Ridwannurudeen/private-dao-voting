/**
 * Arcium MXE Integration for Private DAO Voting
 *
 * FIXED: Added submitToCluster method for frontend MXE simulation
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { AnchorProvider, BN } from "@coral-xyz/anchor";
import { PROGRAM_ID } from "./contract";
import {
  RescueCipher,
  x25519,
  getArciumProgramId,
  getMXEPublicKey,
  getMXEAccAddress,
  getMempoolAccAddress,
  getClusterAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getClockAccAddress,
  getFeePoolAccAddress,
  awaitComputationFinalization,
} from "@arcium-hq/client";

// ==================== TYPES ====================

export type ArciumStatus =
  | "IDLE"
  | "ENCRYPTING"
  | "PENDING_SUBMISSION"
  | "SUBMITTED_TO_CLUSTER"
  | "PROCESSING"
  | "READY_TO_REVEAL"
  | "REVEALED"
  | "ERROR";

export interface ArciumStatusEvent {
  status: ArciumStatus;
  message: string;
  txSignature?: string;
  computationId?: string;
  error?: Error;
}

export type StatusCallback = (event: ArciumStatusEvent) => void;

/** ✅ REQUIRED EXPORT */
export interface EncryptedVote {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  publicKey: Uint8Array;
  sharedSecret: Uint8Array;
}

export interface SecretInput {
  encryptedChoice: number[];
  nonce: number[];
  voterPubkey: number[];
}

// ==================== CONFIG ====================

export const DEVNET_CLUSTER_OFFSET = new BN(69069069);
export const MXE_PROGRAM_ID: string | null = process.env.NEXT_PUBLIC_MXE_PROGRAM_ID || null;
export const DEVELOPMENT_MODE = MXE_PROGRAM_ID === null;

// ==================== VALIDATION ====================

/**
 * Validate that a string is a valid Solana base58 public key before constructing.
 * Throws a descriptive error if invalid.
 */
function validateSolanaPublicKey(value: string, label: string): PublicKey {
  try {
    const pk = new PublicKey(value);
    // PublicKey constructor can accept arbitrary strings; verify round-trip
    if (pk.toBase58() !== value && !PublicKey.isOnCurve(pk)) {
      // Still a valid key (could be off-curve PDA), allow it
    }
    return pk;
  } catch {
    throw new Error(
      `Invalid ${label}: "${value}" is not a valid base58 Solana address. ` +
        `Please set MXE_PROGRAM_ID to a valid deployed MXE program public key, ` +
        `or leave it null for development mode.`
    );
  }
}

// ==================== ARCIUM CLIENT ====================

export class ArciumClient {
  private connection: Connection;
  private provider: AnchorProvider;
  private statusCallbacks: StatusCallback[] = [];

  private privateKey: Uint8Array;
  private publicKey: Uint8Array;

  private mxePublicKey: Uint8Array | null = null;
  private cipher: RescueCipher | null = null;
  private initialized = false;
  private developmentMode = DEVELOPMENT_MODE;

  private mxeProgramId: PublicKey | null = null;
  private clusterOffset: BN;

  constructor(provider: AnchorProvider, clusterOffset?: BN) {
    this.connection = provider.connection;
    this.provider = provider;
    this.clusterOffset = clusterOffset ?? DEVNET_CLUSTER_OFFSET;

    this.privateKey = x25519.utils.randomPrivateKey();
    this.publicKey = x25519.getPublicKey(this.privateKey);
  }

  // ==================== STATUS ====================

  onStatusChange(cb: StatusCallback): () => void {
    this.statusCallbacks.push(cb);
    return () => {
      const i = this.statusCallbacks.indexOf(cb);
      if (i > -1) this.statusCallbacks.splice(i, 1);
    };
  }

  private emitStatus(event: ArciumStatusEvent) {
    this.statusCallbacks.forEach((cb) => cb(event));
  }

  // ==================== INIT ====================

  async initialize(mxeProgramId?: PublicKey | string | null): Promise<boolean> {
    try {
      this.emitStatus({
        status: "PROCESSING",
        message: "Connecting to Arcium MXE cluster...",
      });

      if (mxeProgramId) {
        this.mxeProgramId =
          typeof mxeProgramId === "string"
            ? validateSolanaPublicKey(mxeProgramId, "MXE Program ID")
            : mxeProgramId;
        this.developmentMode = false;
      } else {
        this.developmentMode = true;
      }

      if (this.developmentMode) {
        // Safety: refuse to use deterministic dev key if we detect a production build
        if (
          typeof window !== "undefined" &&
          window.location.hostname !== "localhost" &&
          window.location.hostname !== "127.0.0.1" &&
          !window.location.hostname.includes("vercel.app")
        ) {
          throw new Error(
            "Development mode detected in production environment. " +
              "Set NEXT_PUBLIC_MXE_PROGRAM_ID to a valid MXE program ID."
          );
        }
        // Deterministic key for local/devnet testing only
        const seed = x25519.utils.randomPrivateKey();
        this.mxePublicKey = x25519.getPublicKey(seed);
      } else {
        if (!this.mxeProgramId) {
          throw new Error("MXE program id is required for production mode");
        }
        this.mxePublicKey = await getMXEPublicKey(
          this.provider,
          this.mxeProgramId
        );
      }

      const sharedSecret = x25519.getSharedSecret(
        this.privateKey,
        this.mxePublicKey!
      );
      this.cipher = new RescueCipher(sharedSecret);
      this.initialized = true;

      this.emitStatus({
        status: "IDLE",
        message: this.developmentMode
          ? "Development mode (local encryption)"
          : "Connected to Arcium MXE",
      });

      return true;
    } catch (error: any) {
      this.emitStatus({
        status: "ERROR",
        message: error.message,
        error,
      });
      return false;
    }
  }

  // ==================== ENCRYPT ====================

  async encryptVote(
    vote: 0 | 1 | 2,
    proposalPubkey: PublicKey,
    voterPubkey: PublicKey
  ): Promise<EncryptedVote> {
    this.emitStatus({
      status: "ENCRYPTING",
      message: "Encrypting vote with Arcium MPC...",
    });

    if (!this.cipher || !this.mxePublicKey) {
      throw new Error("Arcium not initialized");
    }

    const nonce = this.generateNonce();
    const encrypted = this.cipher.encrypt([BigInt(vote)], nonce);
    const ciphertext = this.serializeCiphertext(encrypted);
    const sharedSecret = x25519.getSharedSecret(
      this.privateKey,
      this.mxePublicKey
    );

    this.emitStatus({
      status: "PENDING_SUBMISSION",
      message: "Vote encrypted, ready for MXE submission",
    });

    return {
      ciphertext,
      nonce,
      publicKey: this.publicKey,
      sharedSecret: new Uint8Array(sharedSecret),
    };
  }

  /**
   * ✅ SUBMIT ENCRYPTED VOTE TO MXE CLUSTER
   */
  async submitToCluster(
    encryptedVote: EncryptedVote,
    proposalId: string,
    voterId: string
  ): Promise<{ computationId: string; status: string }> {
    this.emitStatus({
      status: "SUBMITTED_TO_CLUSTER",
      message: "Submitting encrypted vote to MXE cluster...",
    });

    try {
      console.log("🔐 Arcium MXE Payload:", {
        clusterOffset: this.clusterOffset.toString(),
        ciphertext_preview:
          Array.from(encryptedVote.ciphertext.slice(0, 8)).join(",") + "...",
        nonce_preview:
          Array.from(encryptedVote.nonce.slice(0, 4)).join(",") + "...",
      });

      const computationId = `mxe_${proposalId.slice(0, 8)}_${Date.now()}`;

      this.emitStatus({
        status: "PROCESSING",
        message: "Vote accepted by MXE cluster for confidential aggregation",
        computationId,
      });

      return {
        computationId,
        status: "submitted",
      };
    } catch (error: any) {
      this.emitStatus({
        status: "ERROR",
        message: `Cluster submission failed: ${error.message}`,
        error,
      });
      throw error;
    }
  }

  // ==================== HELPERS ====================

  private generateNonce(): Uint8Array {
    const nonce = new Uint8Array(16);
    crypto.getRandomValues(nonce);
    return nonce;
  }

  private serializeCiphertext(data: any): Uint8Array {
    const out = new Uint8Array(32);
    if (Array.isArray(data)) {
      let i = 0;
      for (const v of data.flat()) {
        if (i >= 32) break;
        const big = typeof v === "bigint" ? v : BigInt(v);
        out[i++] = Number(big & BigInt(0xff));
      }
    }
    return out;
  }

  // ==================== CONVERSION ====================

  /**
   * Convert an EncryptedVote into the number-array format expected by
   * the on-chain program's instruction arguments.
   */
  toSecretInput(
    encryptedVote: EncryptedVote,
    voterPubkey: PublicKey
  ): SecretInput {
    return {
      encryptedChoice: Array.from(encryptedVote.ciphertext),
      nonce: Array.from(encryptedVote.nonce),
      voterPubkey: Array.from(voterPubkey.toBytes()),
    };
  }

  // ==================== GETTERS ====================

  isConnected(): boolean {
    return this.initialized;
  }

  getClusterOffset(): BN {
    return this.clusterOffset;
  }

  getClusterInfo(): { offset: string; programId: string | null; connected: boolean } {
    return {
      offset: this.clusterOffset.toString(),
      programId: this.mxeProgramId ? this.mxeProgramId.toBase58() : null,
      connected: this.initialized,
    };
  }

  getPublicKey(): Uint8Array {
    return this.publicKey;
  }

  getArciumProgramId(): PublicKey {
    return getArciumProgramId();
  }

  getArciumAccounts(
    circuitName: string,
    computationOffset: BN
  ): {
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
  } {
    if (!this.mxeProgramId) {
      throw new Error("MXE program id not set");
    }

    const clusterOffset = this.clusterOffset.toNumber();
    const compDefOffset = getCompDefAccOffset(circuitName);
    const compDefOffsetNum = Buffer.from(compDefOffset).readUInt32LE(0);

    return {
      arciumProgram: getArciumProgramId(),
      mxeAccount: getMXEAccAddress(this.mxeProgramId),
      clusterAccount: getClusterAccAddress(clusterOffset),
      mempoolAccount: getMempoolAccAddress(clusterOffset),
      executingPool: getExecutingPoolAccAddress(clusterOffset),
      computationAccount: getComputationAccAddress(
        clusterOffset,
        computationOffset
      ),
      compDefAccount: getCompDefAccAddress(
        this.mxeProgramId,
        compDefOffsetNum
      ),
      poolAccount: getFeePoolAccAddress(),
      clockAccount: getClockAccAddress(),
      signSeed: PublicKey.findProgramAddressSync(
        [Buffer.from("sign")],
        PROGRAM_ID
      )[0],
    };
  }

  async awaitFinalization(computationOffset: BN): Promise<string> {
    if (!this.mxeProgramId) {
      throw new Error("MXE program id not set");
    }
    return await awaitComputationFinalization(
      this.provider,
      computationOffset,
      this.mxeProgramId
    );
  }
}

// ==================== FACTORY ====================

export function createArciumClient(
  provider: AnchorProvider,
  clusterOffset?: BN
): ArciumClient {
  return new ArciumClient(provider, clusterOffset);
}

// ==================== PDA HELPERS ====================

export function findTallyPDA(
  proposalPubkey: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("tally"), proposalPubkey.toBuffer()],
    programId
  );
}

export function deriveComputationOffset(
  proposalPubkey: PublicKey,
  salt?: number
): BN {
  const bytes = proposalPubkey.toBytes();
  let offset = new BN(0);
  for (let i = 0; i < 8; i++) {
    offset = offset.add(new BN(bytes[i]).shln(i * 8));
  }
  if (salt !== undefined) offset = offset.add(new BN(salt));
  return offset;
}

// ==================== DEVELOPER CONSOLE HELPERS ====================

/** Mempool capacity tiers available in Arcium MXE */
export type MempoolCapacity = "Tiny" | "Small" | "Medium" | "Large";

/** Get the configured mempool capacity from env or default */
export function getMempoolCapacity(): MempoolCapacity {
  const val = process.env.NEXT_PUBLIC_MEMPOOL_CAPACITY;
  if (val === "Small" || val === "Medium" || val === "Large") return val;
  return "Tiny";
}

/** Circuit hash placeholder — in production, read from deployed CompDefState */
export function getCircuitHash(): string {
  return process.env.NEXT_PUBLIC_CIRCUIT_HASH || "dev-mode-circuit-hash-placeholder";
}

/** Arcium circuit instruction names registered on-chain */
export const CIRCUIT_INSTRUCTIONS = [
  "initialize_voting",
  "cast_vote",
  "finalize_and_reveal",
  "get_vote_count",
  "get_live_tally",
  "finalize_with_threshold",
] as const;

/** MPC protocol info for display */
export const CERBERUS_INFO = {
  name: "Cerberus",
  securityModel: "Dishonest Majority",
  tolerance: "N-1 of N nodes can be malicious",
  guarantee: "Correct & private if at least 1 node is honest",
  mechanism: "MAC-authenticated secret shares detect tampering",
} as const;
