/**
 * Retry wrapper with exponential backoff for Solana RPC calls.
 *
 * Retries on network errors and 429 rate limits.
 * Does NOT retry on user rejections or program errors.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 500
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const msg = error?.message || error?.toString() || "";

      // Don't retry user rejections or Anchor program errors
      const isBlockhashIssue =
        msg.includes("Blockhash not found") || msg.includes("blockhash not found");
      if (
        !isBlockhashIssue &&
        (msg.includes("User rejected") ||
          msg.includes("Transaction cancelled") ||
          msg.includes("Simulation failed") ||
          msg.includes("custom program error"))
      ) {
        throw error;
      }

      // Retry on network/RPC errors
      const isRetryable =
        msg.includes("failed to fetch") ||
        msg.includes("FetchError") ||
        msg.includes("NetworkError") ||
        msg.includes("ECONNREFUSED") ||
        msg.includes("ETIMEDOUT") ||
        msg.includes("429") ||
        msg.includes("Too Many Requests") ||
        msg.includes("blockhash not found") ||
        msg.includes("503") ||
        msg.includes("502");

      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }

      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 200;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
