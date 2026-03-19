// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { VoteQueue, QueuedVote, resetVoteQueue, getVoteQueue } from "../vote-queue";

// ==================== HELPERS ====================

function makeVote(overrides: Partial<Omit<QueuedVote, "id" | "timestamp" | "retryCount">> = {}) {
  return {
    proposalPDA: overrides.proposalPDA ?? "proposal123",
    encryptedChoice: overrides.encryptedChoice ?? [1, 2, 3],
    nonce: overrides.nonce ?? [4, 5, 6],
    voterPubkey: overrides.voterPubkey ?? [7, 8, 9],
    walletPubkey: overrides.walletPubkey ?? "walletABC",
    gateMint: overrides.gateMint ?? "mintXYZ",
    choice: overrides.choice ?? ("yes" as const),
  };
}

// ==================== TESTS ====================

describe("VoteQueue", () => {
  let queue: VoteQueue;

  beforeEach(() => {
    localStorage.clear();
    resetVoteQueue();
    queue = new VoteQueue();
  });

  afterEach(() => {
    queue.stopAutoRetry();
  });

  // ---------- enqueue ----------

  describe("enqueue", () => {
    it("adds a vote to the queue", () => {
      expect(queue.getQueueLength()).toBe(0);
      queue.enqueue(makeVote());
      expect(queue.getQueueLength()).toBe(1);
    });

    it("assigns a unique id, timestamp, and retryCount=0", () => {
      const entry = queue.enqueue(makeVote());
      expect(entry.id).toMatch(/^vq_/);
      expect(entry.timestamp).toBeGreaterThan(0);
      expect(entry.retryCount).toBe(0);
    });

    it("stores the correct vote data", () => {
      const input = makeVote({ proposalPDA: "myProposal", choice: "no" });
      const entry = queue.enqueue(input);
      expect(entry.proposalPDA).toBe("myProposal");
      expect(entry.choice).toBe("no");
      expect(entry.encryptedChoice).toEqual([1, 2, 3]);
    });

    it("supports multiple votes in the queue", () => {
      queue.enqueue(makeVote({ proposalPDA: "p1" }));
      queue.enqueue(makeVote({ proposalPDA: "p2" }));
      queue.enqueue(makeVote({ proposalPDA: "p3" }));
      expect(queue.getQueueLength()).toBe(3);
    });

    it("generates unique IDs for each vote", () => {
      const v1 = queue.enqueue(makeVote());
      const v2 = queue.enqueue(makeVote());
      expect(v1.id).not.toBe(v2.id);
    });
  });

  // ---------- getQueue ----------

  describe("getQueue", () => {
    it("returns a snapshot of all queued votes", () => {
      queue.enqueue(makeVote({ proposalPDA: "a" }));
      queue.enqueue(makeVote({ proposalPDA: "b" }));
      const snapshot = queue.getQueue();
      expect(snapshot.length).toBe(2);
      expect(snapshot[0].proposalPDA).toBe("a");
      expect(snapshot[1].proposalPDA).toBe("b");
    });

    it("returns a copy, not a reference", () => {
      queue.enqueue(makeVote());
      const snapshot = queue.getQueue();
      expect(snapshot.length).toBe(1);
      // Mutating the snapshot should not affect the queue
      (snapshot as QueuedVote[]).pop();
      expect(queue.getQueueLength()).toBe(1);
    });
  });

  // ---------- clearExpiredVotes ----------

  describe("clearExpiredVotes", () => {
    it("removes votes older than the specified age", () => {
      const entry = queue.enqueue(makeVote());
      // Manually backdate the vote
      const items = JSON.parse(localStorage.getItem("mxe_vote_queue")!);
      items[0].timestamp = Date.now() - 2 * 60 * 60 * 1000; // 2 hours ago
      localStorage.setItem("mxe_vote_queue", JSON.stringify(items));

      // Reload queue from storage
      const freshQueue = new VoteQueue();
      const removed = freshQueue.clearExpiredVotes(1 * 60 * 60 * 1000); // 1 hour max age
      expect(removed).toBe(1);
      expect(freshQueue.getQueueLength()).toBe(0);
    });

    it("keeps votes within the age threshold", () => {
      queue.enqueue(makeVote());
      const removed = queue.clearExpiredVotes(24 * 60 * 60 * 1000);
      expect(removed).toBe(0);
      expect(queue.getQueueLength()).toBe(1);
    });

    it("handles mixed ages correctly", () => {
      queue.enqueue(makeVote({ proposalPDA: "fresh" }));

      // Backdate one vote via storage
      const items = JSON.parse(localStorage.getItem("mxe_vote_queue")!);
      items.unshift({
        ...makeVote({ proposalPDA: "stale" }),
        id: "vq_old",
        timestamp: Date.now() - 48 * 60 * 60 * 1000, // 2 days ago
        retryCount: 5,
      });
      localStorage.setItem("mxe_vote_queue", JSON.stringify(items));

      const freshQueue = new VoteQueue();
      expect(freshQueue.getQueueLength()).toBe(2);
      const removed = freshQueue.clearExpiredVotes(24 * 60 * 60 * 1000);
      expect(removed).toBe(1);
      expect(freshQueue.getQueueLength()).toBe(1);
      expect(freshQueue.getQueue()[0].proposalPDA).toBe("fresh");
    });

    it("returns 0 when queue is empty", () => {
      const removed = queue.clearExpiredVotes();
      expect(removed).toBe(0);
    });
  });

  // ---------- localStorage persistence ----------

  describe("localStorage persistence", () => {
    it("persists votes across VoteQueue instances", () => {
      queue.enqueue(makeVote({ proposalPDA: "persisted" }));
      expect(queue.getQueueLength()).toBe(1);

      // Create a new queue instance -- should load from localStorage
      const newQueue = new VoteQueue();
      expect(newQueue.getQueueLength()).toBe(1);
      expect(newQueue.getQueue()[0].proposalPDA).toBe("persisted");
    });

    it("handles corrupt localStorage gracefully", () => {
      localStorage.setItem("mxe_vote_queue", "not valid json {{{");
      const freshQueue = new VoteQueue();
      expect(freshQueue.getQueueLength()).toBe(0);
    });

    it("handles non-array localStorage value gracefully", () => {
      localStorage.setItem("mxe_vote_queue", JSON.stringify({ bad: true }));
      const freshQueue = new VoteQueue();
      expect(freshQueue.getQueueLength()).toBe(0);
    });

    it("updates localStorage when votes are enqueued", () => {
      queue.enqueue(makeVote());
      const stored = JSON.parse(localStorage.getItem("mxe_vote_queue")!);
      expect(stored.length).toBe(1);
    });

    it("updates localStorage when queue is cleared", () => {
      queue.enqueue(makeVote());
      queue.clear();
      const stored = JSON.parse(localStorage.getItem("mxe_vote_queue")!);
      expect(stored.length).toBe(0);
    });
  });

  // ---------- processQueue ----------

  describe("processQueue", () => {
    it("removes successful votes from the queue", async () => {
      queue.enqueue(makeVote({ proposalPDA: "p1" }));
      queue.enqueue(makeVote({ proposalPDA: "p2" }));

      const submitFn = vi.fn().mockResolvedValue(undefined);
      const result = await queue.processQueue(submitFn);

      expect(result.succeeded.length).toBe(2);
      expect(result.failed.length).toBe(0);
      expect(result.remaining).toBe(0);
      expect(queue.getQueueLength()).toBe(0);
      expect(submitFn).toHaveBeenCalledTimes(2);
    });

    it("keeps failed votes and increments retryCount", async () => {
      queue.enqueue(makeVote({ proposalPDA: "fail" }));

      const submitFn = vi.fn().mockRejectedValue(new Error("tx failed"));
      const result = await queue.processQueue(submitFn);

      expect(result.succeeded.length).toBe(0);
      expect(result.failed.length).toBe(1);
      expect(result.remaining).toBe(1);
      expect(queue.getQueueLength()).toBe(1);
      expect(queue.getQueue()[0].retryCount).toBe(1);
    });

    it("handles mixed success and failure", async () => {
      queue.enqueue(makeVote({ proposalPDA: "ok" }));
      queue.enqueue(makeVote({ proposalPDA: "bad" }));

      const submitFn = vi.fn().mockImplementation(async (v: QueuedVote) => {
        if (v.proposalPDA === "bad") throw new Error("fail");
      });

      const result = await queue.processQueue(submitFn);
      expect(result.succeeded.length).toBe(1);
      expect(result.failed.length).toBe(1);
      expect(result.remaining).toBe(1);
      expect(queue.getQueue()[0].proposalPDA).toBe("bad");
    });

    it("passes the correct vote data to submitFn", async () => {
      const input = makeVote({ proposalPDA: "check", choice: "abstain" });
      queue.enqueue(input);

      const submitFn = vi.fn().mockResolvedValue(undefined);
      await queue.processQueue(submitFn);

      const calledWith = submitFn.mock.calls[0][0] as QueuedVote;
      expect(calledWith.proposalPDA).toBe("check");
      expect(calledWith.choice).toBe("abstain");
      expect(calledWith.encryptedChoice).toEqual([1, 2, 3]);
    });

    it("does not run concurrently", async () => {
      queue.enqueue(makeVote());

      let resolveFirst: () => void;
      const firstCall = new Promise<void>((r) => { resolveFirst = r; });
      const submitFn = vi.fn().mockImplementation(() => firstCall);

      // Start first processQueue (will block)
      const p1 = queue.processQueue(submitFn);

      // Second processQueue should return immediately
      const p2 = await queue.processQueue(submitFn);
      expect(p2.succeeded.length).toBe(0);
      expect(p2.remaining).toBe(1);

      // Unblock first
      resolveFirst!();
      const r1 = await p1;
      expect(r1.succeeded.length).toBe(1);
    });

    it("returns empty result when queue is empty", async () => {
      const submitFn = vi.fn();
      const result = await queue.processQueue(submitFn);
      expect(result.succeeded.length).toBe(0);
      expect(result.failed.length).toBe(0);
      expect(result.remaining).toBe(0);
      expect(submitFn).not.toHaveBeenCalled();
    });
  });

  // ---------- onChange ----------

  describe("onChange", () => {
    it("notifies on enqueue", () => {
      const cb = vi.fn();
      queue.onChange(cb);
      queue.enqueue(makeVote());
      expect(cb).toHaveBeenCalledWith(1);
    });

    it("notifies on clear", () => {
      queue.enqueue(makeVote());
      const cb = vi.fn();
      queue.onChange(cb);
      queue.clear();
      expect(cb).toHaveBeenCalledWith(0);
    });

    it("unsubscribe stops notifications", () => {
      const cb = vi.fn();
      const unsub = queue.onChange(cb);
      unsub();
      queue.enqueue(makeVote());
      expect(cb).not.toHaveBeenCalled();
    });
  });

  // ---------- clear ----------

  describe("clear", () => {
    it("removes all votes", () => {
      queue.enqueue(makeVote());
      queue.enqueue(makeVote());
      queue.clear();
      expect(queue.getQueueLength()).toBe(0);
    });
  });

  // ---------- backoff ----------

  describe("getNextBackoffMs", () => {
    it("returns 30s for first retry", () => {
      queue.enqueue(makeVote());
      expect(queue.getNextBackoffMs()).toBe(30_000);
    });

    it("increases with retry count", async () => {
      queue.enqueue(makeVote());

      // Fail the vote once to increment retryCount
      await queue.processQueue(vi.fn().mockRejectedValue(new Error("fail")));
      expect(queue.getNextBackoffMs()).toBe(60_000); // 1m

      await queue.processQueue(vi.fn().mockRejectedValue(new Error("fail")));
      expect(queue.getNextBackoffMs()).toBe(120_000); // 2m

      await queue.processQueue(vi.fn().mockRejectedValue(new Error("fail")));
      expect(queue.getNextBackoffMs()).toBe(300_000); // 5m cap

      // Should stay at 5m
      await queue.processQueue(vi.fn().mockRejectedValue(new Error("fail")));
      expect(queue.getNextBackoffMs()).toBe(300_000);
    });
  });

  // ---------- auto-retry ----------

  describe("auto-retry", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("schedules retry after the backoff delay", () => {
      queue.enqueue(makeVote());
      const submitFn = vi.fn().mockResolvedValue(undefined);
      queue.startAutoRetry(submitFn);
      expect(queue.isRetryScheduled()).toBe(true);
    });

    it("does not schedule when queue is empty", () => {
      const submitFn = vi.fn();
      queue.startAutoRetry(submitFn);
      expect(queue.isRetryScheduled()).toBe(false);
    });

    it("stops auto-retry on stopAutoRetry", () => {
      queue.enqueue(makeVote());
      queue.startAutoRetry(vi.fn());
      queue.stopAutoRetry();
      expect(queue.isRetryScheduled()).toBe(false);
    });
  });

  // ---------- onChange with processQueue ----------

  describe("onChange with processQueue", () => {
    it("notifies after successful processQueue", async () => {
      queue.enqueue(makeVote());
      const cb = vi.fn();
      queue.onChange(cb);
      await queue.processQueue(vi.fn().mockResolvedValue(undefined));
      // Should be called with 0 (vote removed)
      expect(cb).toHaveBeenCalledWith(0);
    });

    it("notifies after failed processQueue", async () => {
      queue.enqueue(makeVote());
      const cb = vi.fn();
      queue.onChange(cb);
      await queue.processQueue(vi.fn().mockRejectedValue(new Error("fail")));
      // Vote stays, so callback called with 1
      expect(cb).toHaveBeenCalledWith(1);
    });

    it("supports multiple subscribers", () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      queue.onChange(cb1);
      queue.onChange(cb2);
      queue.enqueue(makeVote());
      expect(cb1).toHaveBeenCalledWith(1);
      expect(cb2).toHaveBeenCalledWith(1);
    });

    it("notifies on clearExpiredVotes when votes are removed", () => {
      queue.enqueue(makeVote());
      // Backdate the vote
      const items = JSON.parse(localStorage.getItem("mxe_vote_queue")!);
      items[0].timestamp = Date.now() - 48 * 60 * 60 * 1000;
      localStorage.setItem("mxe_vote_queue", JSON.stringify(items));

      const freshQueue = new VoteQueue();
      const cb = vi.fn();
      freshQueue.onChange(cb);
      freshQueue.clearExpiredVotes(24 * 60 * 60 * 1000);
      expect(cb).toHaveBeenCalledWith(0);
    });

    it("does not notify on clearExpiredVotes when nothing is removed", () => {
      queue.enqueue(makeVote());
      const cb = vi.fn();
      queue.onChange(cb);
      queue.clearExpiredVotes(24 * 60 * 60 * 1000);
      expect(cb).not.toHaveBeenCalled();
    });
  });

  // ---------- enqueue edge cases ----------

  describe("enqueue edge cases", () => {
    it("preserves all vote data fields", () => {
      const input = makeVote({
        proposalPDA: "testPDA",
        encryptedChoice: [10, 20, 30],
        nonce: [40, 50, 60],
        voterPubkey: [70, 80, 90],
        walletPubkey: "walletTest123",
        gateMint: "mintTest456",
        choice: "abstain",
      });
      const entry = queue.enqueue(input);
      expect(entry.proposalPDA).toBe("testPDA");
      expect(entry.encryptedChoice).toEqual([10, 20, 30]);
      expect(entry.nonce).toEqual([40, 50, 60]);
      expect(entry.voterPubkey).toEqual([70, 80, 90]);
      expect(entry.walletPubkey).toBe("walletTest123");
      expect(entry.gateMint).toBe("mintTest456");
      expect(entry.choice).toBe("abstain");
    });

    it("timestamp is close to current time", () => {
      const before = Date.now();
      const entry = queue.enqueue(makeVote());
      const after = Date.now();
      expect(entry.timestamp).toBeGreaterThanOrEqual(before);
      expect(entry.timestamp).toBeLessThanOrEqual(after);
    });
  });

  // ---------- getNextBackoffMs edge cases ----------

  describe("getNextBackoffMs edge cases", () => {
    it("returns first backoff value when queue is empty", () => {
      expect(queue.getNextBackoffMs()).toBe(30_000);
    });

    it("uses minimum retryCount across multiple votes", async () => {
      queue.enqueue(makeVote({ proposalPDA: "p1" }));
      queue.enqueue(makeVote({ proposalPDA: "p2" }));

      // Fail only p1 once — p2 stays at retryCount 0
      // processQueue fails both, so both get retryCount 1
      await queue.processQueue(vi.fn().mockRejectedValue(new Error("fail")));
      // Both at retryCount=1, min=1 => 60_000
      expect(queue.getNextBackoffMs()).toBe(60_000);

      // Enqueue a fresh vote (retryCount=0) — min goes back to 0
      queue.enqueue(makeVote({ proposalPDA: "p3" }));
      expect(queue.getNextBackoffMs()).toBe(30_000);
    });
  });

  // ---------- clear edge cases ----------

  describe("clear edge cases", () => {
    it("clearing empty queue is a no-op", () => {
      queue.clear();
      expect(queue.getQueueLength()).toBe(0);
    });

    it("queue is usable after clear", () => {
      queue.enqueue(makeVote());
      queue.clear();
      queue.enqueue(makeVote({ proposalPDA: "afterClear" }));
      expect(queue.getQueueLength()).toBe(1);
      expect(queue.getQueue()[0].proposalPDA).toBe("afterClear");
    });
  });

  // ---------- singleton ----------

  describe("singleton", () => {
    it("getVoteQueue returns the same instance", () => {
      resetVoteQueue();
      const a = getVoteQueue();
      const b = getVoteQueue();
      expect(a).toBe(b);
    });

    it("resetVoteQueue creates a new instance", () => {
      const a = getVoteQueue();
      resetVoteQueue();
      const b = getVoteQueue();
      expect(a).not.toBe(b);
    });
  });
});
