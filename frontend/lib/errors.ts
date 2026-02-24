const ERROR_MAP: Record<string, string> = {
  QuorumNotReached: "Not enough votes to reveal results. The quorum threshold has not been met.",
  ActiveDelegation: "You have an active delegation. Revoke it before voting directly.",
  VotingEnded: "Voting has ended for this proposal.",
  VotingStillActive: "Voting is still active. Wait for the deadline before revealing.",
  NotAuthority: "Only the proposal authority can perform this action.",
  AlreadyRevealed: "Results have already been revealed for this proposal.",
  InsufficientBalance: "You don't have enough gate tokens to vote on this proposal.",
  ArithmeticOverflow: "Vote tally arithmetic overflow. Please contact the DAO administrator.",
  VoteTallyMismatch: "Vote tally mismatch detected. The sum of votes doesn't match the total.",
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
  if (msg.includes("0x1")) return "Insufficient SOL balance for transaction fees.";
  if (msg.includes("already in use") || msg.includes("already been processed"))
    return "This action has already been completed.";
  if (msg.includes("blockhash not found"))
    return "Transaction expired. Please try again.";
  if (msg.includes("User rejected"))
    return "Transaction was cancelled.";

  // Truncate long error messages
  if (msg.length > 120) return msg.slice(0, 120) + "...";
  return msg;
}

export function explorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}
