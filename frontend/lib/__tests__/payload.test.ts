// @vitest-environment node
import { describe, it, expect } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import {
  findPayloadPDA,
  serializeTreasuryTransfer,
  PROGRAM_ID,
} from "../contract";

describe("Payload PDA derivation", () => {
  it("derives deterministic payload PDAs", () => {
    const proposal = PublicKey.unique();
    const [pda1] = findPayloadPDA(proposal);
    const [pda2] = findPayloadPDA(proposal);
    expect(pda1.equals(pda2)).toBe(true);
  });

  it("derives different PDAs for different proposals", () => {
    const proposal1 = PublicKey.unique();
    const proposal2 = PublicKey.unique();
    const [pda1] = findPayloadPDA(proposal1);
    const [pda2] = findPayloadPDA(proposal2);
    expect(pda1.equals(pda2)).toBe(false);
  });

  it("payload PDA is off-curve", () => {
    const proposal = PublicKey.unique();
    const [pda] = findPayloadPDA(proposal);
    expect(PublicKey.isOnCurve(pda)).toBe(false);
  });
});

describe("serializeTreasuryTransfer", () => {
  it("produces 72-byte buffer with correct layout", () => {
    const recipient = PublicKey.unique();
    const mint = PublicKey.unique();
    const amount = new BN(1_000_000);

    const buf = serializeTreasuryTransfer(recipient, mint, amount);
    expect(buf.length).toBe(72);

    // Check recipient at bytes 0-31
    const recipientBytes = buf.slice(0, 32);
    expect(Buffer.from(recipientBytes).equals(recipient.toBuffer())).toBe(true);

    // Check mint at bytes 32-63
    const mintBytes = buf.slice(32, 64);
    expect(Buffer.from(mintBytes).equals(mint.toBuffer())).toBe(true);

    // Check amount at bytes 64-71 (u64 LE)
    const amountBytes = buf.slice(64, 72);
    const decoded = new BN(Buffer.from(amountBytes), "le");
    expect(decoded.eq(amount)).toBe(true);
  });

  it("handles zero amount", () => {
    const recipient = PublicKey.unique();
    const mint = PublicKey.unique();
    const amount = new BN(0);

    const buf = serializeTreasuryTransfer(recipient, mint, amount);
    const amountBytes = buf.slice(64, 72);
    expect(Buffer.from(amountBytes).equals(Buffer.alloc(8))).toBe(true);
  });

  it("handles large amounts", () => {
    const recipient = PublicKey.unique();
    const mint = PublicKey.unique();
    // u64 max value representable in BN
    const amount = new BN("18446744073709551615");

    const buf = serializeTreasuryTransfer(recipient, mint, amount);
    const amountBytes = buf.slice(64, 72);
    const decoded = new BN(Buffer.from(amountBytes), "le");
    expect(decoded.eq(amount)).toBe(true);
  });
});
