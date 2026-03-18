import { describe, it, expect } from "vitest";
import { parseAnchorError, explorerTxUrl } from "../errors";

describe("parseAnchorError", () => {
    it("maps known error names to friendly messages", () => {
        expect(parseAnchorError({ message: "QuorumNotReached" })).toBe(
            "Not enough votes to reveal results. The quorum threshold has not been met."
        );
        expect(parseAnchorError({ message: "VotingEnded" })).toBe(
            "Voting has ended for this proposal."
        );
        expect(parseAnchorError({ message: "ActiveDelegation" })).toBe(
            "You have an active delegation. Revoke it before voting directly."
        );
        expect(parseAnchorError({ message: "VotingStillActive" })).toBe(
            "Voting is still active. Wait for the deadline before revealing."
        );
        expect(parseAnchorError({ message: "NotAuthority" })).toBe(
            "Only the proposal authority can perform this action."
        );
        expect(parseAnchorError({ message: "AlreadyRevealed" })).toBe(
            "Results have already been revealed for this proposal."
        );
        expect(parseAnchorError({ message: "InsufficientBalance" })).toBe(
            "You don't have enough gate tokens to vote on this proposal."
        );
        expect(parseAnchorError({ message: "ArithmeticOverflow" })).toBe(
            "Vote tally arithmetic overflow. Please contact the DAO administrator."
        );
        expect(parseAnchorError({ message: "VoteTallyMismatch" })).toBe(
            "Vote tally mismatch detected. The sum of votes doesn't match the total."
        );
    });

    it("handles string errors with known names", () => {
        expect(parseAnchorError("VotingEnded")).toBe(
            "Voting has ended for this proposal."
        );
    });

    it("passes through unknown error messages", () => {
        expect(parseAnchorError({ message: "Something unexpected" })).toBe(
            "Something unexpected"
        );
    });

    it("handles common Solana errors", () => {
        expect(parseAnchorError({ message: "custom program error: 0x1" })).toBe(
            "Insufficient SOL balance for transaction fees."
        );
        expect(parseAnchorError({ message: "already in use" })).toBe(
            "This action has already been completed."
        );
        expect(parseAnchorError({ message: "blockhash not found" })).toBe(
            "Transaction expired. Please try again."
        );
        expect(parseAnchorError({ message: "User rejected the request" })).toBe(
            "Transaction was cancelled."
        );
    });

    it("does not false-positive on 0x10, 0x1a, 0x100, etc.", () => {
        // These should NOT match the 0x1 SOL-fee error
        expect(parseAnchorError({ message: "custom program error: 0x10" })).not.toBe(
            "Insufficient SOL balance for transaction fees."
        );
        expect(parseAnchorError({ message: "custom program error: 0x1a" })).not.toBe(
            "Insufficient SOL balance for transaction fees."
        );
        expect(parseAnchorError({ message: "custom program error: 0x100" })).not.toBe(
            "Insufficient SOL balance for transaction fees."
        );
    });

    it("truncates long error messages", () => {
        const longMsg = "A".repeat(200);
        const result = parseAnchorError({ message: longMsg });
        expect(result.length).toBeLessThanOrEqual(123); // 120 + "..."
        expect(result.endsWith("...")).toBe(true);
    });

    it("returns 'Unknown error' for null/undefined", () => {
        expect(parseAnchorError(null)).toBe("Unknown error");
        expect(parseAnchorError(undefined)).toBe("Unknown error");
    });

    it("handles empty string errors", () => {
        // Empty string is falsy, so parseAnchorError treats it as no error
        expect(parseAnchorError("")).toBe("Unknown error");
    });

    it("handles error objects with no message", () => {
        // Object with no message/msg/toString produces empty msg, falls to JSON.stringify
        const result = parseAnchorError({ code: 42 });
        expect(typeof result).toBe("string");
        expect(result.length).toBeGreaterThan(0);
    });

    it("handles Unknown action errors with logs containing known error", () => {
        const error = {
            message: "Unknown action 'undefined'",
            logs: [
                "Program invoked: dao",
                "Program log: Error Number: 6001. Error Message: VotingEnded.",
            ],
        };
        const result = parseAnchorError(error);
        expect(result).toBe("Voting has ended for this proposal.");
    });

    it("handles Unknown action errors with unrecognized log errors", () => {
        const error = {
            message: "Unknown action 'undefined'",
            logs: [
                "Program log: AnchorError thrown in programs/dao/src/lib.rs",
                "Program invoked: system_program",
            ],
        };
        const result = parseAnchorError(error);
        // First log matches "Error", but no known error name, so returns cleaned log line
        expect(result).toBe("AnchorError thrown in programs/dao/src/lib.rs");
    });

    it("handles Unknown action errors without logs", () => {
        const error = { message: "Unknown action 'undefined'" };
        const result = parseAnchorError(error);
        expect(result).toBe(
            "Transaction failed. Check your token balance and try again."
        );
    });
});

describe("explorerTxUrl", () => {
    it("builds devnet explorer URL from signature", () => {
        const sig = "abc123";
        expect(explorerTxUrl(sig)).toBe(
            "https://explorer.solana.com/tx/abc123?cluster=devnet"
        );
    });
});
