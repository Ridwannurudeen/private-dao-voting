// @vitest-environment node
import { describe, it, expect } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import {
    findProposalPDA,
    findTallyPDA,
    findVoteRecordPDA,
    findDelegationPDA,
    findComputationOffsetPDA,
    PROGRAM_ID,
} from "../contract";

describe("PDA derivation", () => {
    it("derives consistent proposal PDAs", () => {
        const id = new BN(12345);
        const [pda1] = findProposalPDA(id);
        const [pda2] = findProposalPDA(id);
        expect(pda1.equals(pda2)).toBe(true);
    });

    it("derives different PDAs for different proposal IDs", () => {
        const [pda1] = findProposalPDA(new BN(1));
        const [pda2] = findProposalPDA(new BN(2));
        expect(pda1.equals(pda2)).toBe(false);
    });

    it("derives tally PDA from proposal pubkey", () => {
        const proposal = PublicKey.unique();
        const [tally] = findTallyPDA(proposal);
        expect(PublicKey.isOnCurve(tally)).toBe(false);
    });

    it("derives unique vote record per voter", () => {
        const proposal = PublicKey.unique();
        const voter1 = PublicKey.unique();
        const voter2 = PublicKey.unique();
        const [vr1] = findVoteRecordPDA(proposal, voter1);
        const [vr2] = findVoteRecordPDA(proposal, voter2);
        expect(vr1.equals(vr2)).toBe(false);
    });

    it("derives delegation PDA from delegator", () => {
        const delegator = PublicKey.unique();
        const [pda] = findDelegationPDA(delegator);
        expect(pda).toBeInstanceOf(PublicKey);
    });

    it("computation offset PDA is deterministic", () => {
        const [pda1] = findComputationOffsetPDA();
        const [pda2] = findComputationOffsetPDA();
        expect(pda1.equals(pda2)).toBe(true);
    });
});
