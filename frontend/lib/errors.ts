const ERROR_MAP: Record<string, string> = {
  QuorumNotReached: "Not enough votes have been cast to reach quorum.",
  ActiveDelegation: "You have an active delegation. Revoke it before voting directly.",
  VotingEnded: "Voting has ended for this proposal.",
  VotingNotEnded: "Voting is still in progress. You can reveal results after the voting period ends.",
  VotingStillActive: "Voting is still active. Wait for the deadline before revealing.",
  NotAuthority: "Only the proposal authority can perform this action.",
  AlreadyRevealed: "Results have already been revealed for this proposal.",
  AlreadyVoted: "You've already cast your vote on this proposal.",
  InsufficientBalance: "You don't have enough gate tokens to vote on this proposal.",
  InsufficientTokenBalance: "You need more governance tokens to vote.",
  InvalidDelegationAccount: "There's an issue with your delegation status. Please check your delegation settings.",
  InvalidDelegateForDelegation: "You are not authorized to vote on behalf of this delegator.",
  ArithmeticOverflow: "Vote tally arithmetic overflow. Please contact the DAO administrator.",
  VoteTallyMismatch: "Vote tally mismatch detected. The sum of votes doesn't match the total.",
  CannotCancelAfterVotes: "This proposal cannot be cancelled because votes have been cast and the voting period has ended.",
};

export function parseAnchorError(error: any): string {
  if (!error) return "Unknown error";
  const msg = typeof error === "string"
    ? error
    : error.message || error.msg || (typeof error.toString === "function" && error.toString() !== "[object Object]" ? error.toString() : "");
  if (!msg) {
    try { return JSON.stringify(error).slice(0, 200); } catch { return "Transaction failed (unknown error)"; }
  }

  // Anchor 0.32 + web3.js 1.98 API mismatch: SendTransactionError constructor
  // receives positional args but expects an object, producing "Unknown action 'undefined'".
  // Try to extract the real error from logs or the original error.
  if (msg.includes("Unknown action")) {
    // Check if the error has transaction logs attached
    const logs: string[] | undefined = error?.logs || error?.transactionLogs;
    if (logs && logs.length > 0) {
      const programError = logs.find((l: string) =>
        l.includes("Error") || l.includes("failed") || l.includes("custom program error")
      );
      if (programError) {
        // Try to match known errors from the log line
        for (const [key, friendly] of Object.entries(ERROR_MAP)) {
          if (programError.includes(key)) return friendly;
        }
        return programError.replace(/^Program log: /, "").slice(0, 120);
      }
    }
    return "Transaction failed. Check your token balance and try again.";
  }

  // Check for known Anchor error names
  for (const [key, friendly] of Object.entries(ERROR_MAP)) {
    if (msg.includes(key)) return friendly;
  }

  // Check for common Solana errors
  if (/custom program error: 0x1\b/.test(msg)) return "You don't have enough SOL to pay for this transaction.";
  if (msg.includes("Account not found"))
    return "This proposal hasn't been created yet. Please try refreshing.";
  if (msg.includes("Insufficient funds"))
    return "You don't have enough SOL to pay for this transaction.";
  if (msg.includes("Token account not found") || msg.includes("could not find account"))
    return "You need governance tokens to vote. Use the faucet to get test tokens.";
  if (msg.includes("already in use") || msg.includes("already been processed"))
    return "You've already voted on this proposal.";
  if (msg.includes("Signature verification failed"))
    return "Transaction signing was cancelled or failed. Please try again.";
  if (msg.includes("blockhash not found") || msg.includes("Blockhash not found") || msg.includes("block height exceeded"))
    return "Transaction expired. Please try again.";
  if (msg.includes("User rejected") || msg.includes("User denied"))
    return "Transaction was cancelled.";

  // Truncate long error messages
  if (msg.length > 120) return msg.slice(0, 120) + "...";
  return msg;
}

const cluster = process.env.NEXT_PUBLIC_NETWORK || "devnet";

export function explorerTxUrl(signature: string): string {
  // Solana tx signatures are base58-encoded (alphanumeric, no special chars).
  // Sanitize to prevent URL injection via crafted signature strings.
  const sanitized = signature.replace(/[^A-Za-z0-9]/g, "");
  return `https://explorer.solana.com/tx/${encodeURIComponent(sanitized)}?cluster=${encodeURIComponent(cluster)}`;
}
