import { describe, it, expect, vi, beforeEach } from "vitest";
import { withRetry } from "../retry";

describe("withRetry", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("returns the value on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on network errors and succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("failed to fetch"))
      .mockResolvedValue("recovered");
    const result = await withRetry(fn, 3, 10);
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on 429 rate limit errors", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("429 Too Many Requests"))
      .mockResolvedValue("done");
    const result = await withRetry(fn, 3, 10);
    expect(result).toBe("done");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on 502/503 errors", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("503 Service Unavailable"))
      .mockResolvedValue("back");
    const result = await withRetry(fn, 3, 10);
    expect(result).toBe("back");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on ECONNREFUSED", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValue("reconnected");
    const result = await withRetry(fn, 3, 10);
    expect(result).toBe("reconnected");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on ETIMEDOUT", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("ETIMEDOUT"))
      .mockResolvedValue("ok");
    const result = await withRetry(fn, 3, 10);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on blockhash not found", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("blockhash not found"))
      .mockResolvedValue("ok");
    const result = await withRetry(fn, 3, 10);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on Blockhash not found (capital B)", async () => {
    // NOTE: "Blockhash not found" (capital B) passes the non-retry filter
    // Both "Blockhash not found" (capital B) and "blockhash not found"
    // (lowercase) are in the isRetryable list and should be retried.
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("Blockhash not found"))
      .mockResolvedValue("ok");
    const result = await withRetry(fn, 3, 10);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry on User rejected", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("User rejected the request"));
    await expect(withRetry(fn, 3, 10)).rejects.toThrow("User rejected");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on Transaction cancelled", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("Transaction cancelled"));
    await expect(withRetry(fn, 3, 10)).rejects.toThrow("Transaction cancelled");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on Simulation failed", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("Simulation failed"));
    await expect(withRetry(fn, 3, 10)).rejects.toThrow("Simulation failed");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on custom program error (non-blockhash)", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("custom program error: 0x6"));
    await expect(withRetry(fn, 3, 10)).rejects.toThrow("custom program error");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws after exhausting all retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("NetworkError"));
    await expect(withRetry(fn, 2, 10)).rejects.toThrow("NetworkError");
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("does not retry non-retryable unknown errors", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("some random error"));
    await expect(withRetry(fn, 3, 10)).rejects.toThrow("some random error");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on FetchError", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("FetchError: network issue"))
      .mockResolvedValue("ok");
    const result = await withRetry(fn, 3, 10);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("respects maxRetries parameter", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("NetworkError"));
    await expect(withRetry(fn, 0, 10)).rejects.toThrow("NetworkError");
    // maxRetries=0 means only the initial attempt, no retries
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("handles functions that return different types", async () => {
    const fnNum = vi.fn().mockResolvedValue(42);
    expect(await withRetry(fnNum)).toBe(42);

    const fnObj = vi.fn().mockResolvedValue({ key: "value" });
    expect(await withRetry(fnObj)).toEqual({ key: "value" });

    const fnNull = vi.fn().mockResolvedValue(null);
    expect(await withRetry(fnNull)).toBeNull();
  });

  it("blockhash not found (lowercase) bypasses custom program error filter and retries", async () => {
    // "blockhash not found" is both isBlockhashIssue (skips non-retry filter)
    // AND in isRetryable list, so it retries successfully.
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("blockhash not found"))
      .mockResolvedValue("ok");
    const result = await withRetry(fn, 3, 10);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries multiple times before succeeding", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("failed to fetch"))
      .mockRejectedValueOnce(new Error("failed to fetch"))
      .mockResolvedValue("finally");
    const result = await withRetry(fn, 3, 10);
    expect(result).toBe("finally");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
