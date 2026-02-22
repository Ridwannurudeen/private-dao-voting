const ERROR_MAP: Record<string, string> = {
  QuorumNotReached: "Not enough votes to reveal results. The quorum threshold has not been met.",
  ActiveDelegation: "You have an active delegation. Revoke it before voting directly.",
  VotingEnded: "Voting has ended for this proposal.",
  VotingStillActive: "Voting is still active. Wait for the deadline before revealing.",
  NotAuthority: "Only the proposal authority can perform this action.",
  AlreadyRevealed: "Results have already been revealed for this proposal.",
  InsufficientBalance: "You don't have enough gate tokens to vote on this proposal.",
};

export function parseAnchorError(error: any): string {
  const msg = error?.message || error?.toString() || "Unknown error";

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
