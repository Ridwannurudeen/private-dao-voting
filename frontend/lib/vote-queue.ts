/**
 * MXE Fallback Vote Queue
 *
 * When the Arcium MXE cluster is unavailable, votes are queued in localStorage
 * and automatically retried with exponential backoff when MXE reconnects.
 * The queue survives page refreshes.
 */

// ==================== TYPES ====================

export interface QueuedVote {
  /** Proposal PDA as base58 string */
  proposalPDA: string;
  /** Encrypted vote choice bytes */
  encryptedChoice: number[];
  /** Encryption nonce bytes */
  nonce: number[];
  /** Voter's Arcium public key bytes */
  voterPubkey: number[];
  /** Voter's Solana wallet pubkey as base58 */
  walletPubkey: string;
  /** Gate mint pubkey as base58 */
  gateMint: string;
  /** Vote choice for local dev tally tracking */
  choice: "yes" | "no" | "abstain";
  /** Unix timestamp (ms) when the vote was queued */
  timestamp: number;
  /** Number of retry attempts so far */
  retryCount: number;
  /** Unique ID for this queued vote */
  id: string;
}

export interface ProcessResult {
  succeeded: string[];
  failed: string[];
  remaining: number;
}

export type QueueChangeCallback = (length: number) => void;

// ==================== CONSTANTS ====================

const STORAGE_KEY = "mxe_vote_queue";
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Backoff schedule in milliseconds: 30s, 1m, 2m, 5m */
const BACKOFF_SCHEDULE_MS = [
  30 * 1000,
  60 * 1000,
  2 * 60 * 1000,
  5 * 60 * 1000,
];

// ==================== VOTE QUEUE ====================

export class VoteQueue {
  private queue: QueuedVote[] = [];
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private processing = false;
  private changeCallbacks: QueueChangeCallback[] = [];

  constructor() {
    this.loadFromStorage();
  }

  // ==================== PERSISTENCE ====================

  private loadFromStorage(): void {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.queue = parsed;
        }
      }
    } catch {
      // Corrupt data -- start fresh
      this.queue = [];
    }
  }

  private saveToStorage(): void {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.queue));
    } catch {
      // localStorage full or unavailable -- votes stay in memory
      console.warn("VoteQueue: failed to persist queue to localStorage");
    }
  }

  // ==================== CHANGE NOTIFICATIONS ====================

  onChange(cb: QueueChangeCallback): () => void {
    this.changeCallbacks.push(cb);
    return () => {
      const i = this.changeCallbacks.indexOf(cb);
      if (i > -1) this.changeCallbacks.splice(i, 1);
    };
  }

  private notifyChange(): void {
    const len = this.queue.length;
    this.changeCallbacks.forEach((cb) => cb(len));
  }

  // ==================== CORE API ====================

  /**
   * Add a vote to the queue. Called when MXE is down and the vote
   * cannot be submitted immediately.
   */
  enqueue(vote: Omit<QueuedVote, "id" | "timestamp" | "retryCount">): QueuedVote {
    const entry: QueuedVote = {
      ...vote,
      id: `vq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      retryCount: 0,
    };
    this.queue.push(entry);
    this.saveToStorage();
    this.notifyChange();
    return entry;
  }

  /**
   * Process all queued votes by submitting them on-chain.
   * Successful votes are removed from the queue; failed ones stay
   * with an incremented retryCount.
   *
   * @param submitFn - async function that takes a QueuedVote and submits it.
   *                   Should throw on failure.
   */
  async processQueue(
    submitFn: (vote: QueuedVote) => Promise<void>
  ): Promise<ProcessResult> {
    if (this.processing) {
      return { succeeded: [], failed: [], remaining: this.queue.length };
    }
    this.processing = true;

    const succeeded: string[] = [];
    const failed: string[] = [];

    // Snapshot IDs to process (avoid mutation issues during iteration)
    const toProcess = [...this.queue];

    for (const vote of toProcess) {
      try {
        await submitFn(vote);
        succeeded.push(vote.id);
      } catch (err: any) {
        console.warn(`VoteQueue: failed to process vote ${vote.id}:`, err?.message);
        vote.retryCount++;
        failed.push(vote.id);
      }
    }

    // Remove succeeded votes
    this.queue = this.queue.filter((v) => !succeeded.includes(v.id));
    this.saveToStorage();
    this.processing = false;
    this.notifyChange();

    return {
      succeeded,
      failed,
      remaining: this.queue.length,
    };
  }

  /**
   * Returns the number of votes currently in the queue.
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Returns a readonly snapshot of all queued votes.
   */
  getQueue(): readonly QueuedVote[] {
    return [...this.queue];
  }

  /**
   * Remove votes older than the given age (default 24 hours).
   * Returns the number of votes removed.
   */
  clearExpiredVotes(maxAgeMs: number = DEFAULT_MAX_AGE_MS): number {
    const cutoff = Date.now() - maxAgeMs;
    const before = this.queue.length;
    this.queue = this.queue.filter((v) => v.timestamp > cutoff);
    const removed = before - this.queue.length;
    if (removed > 0) {
      this.saveToStorage();
      this.notifyChange();
    }
    return removed;
  }

  /**
   * Clear the entire queue.
   */
  clear(): void {
    this.queue = [];
    this.saveToStorage();
    this.notifyChange();
  }

  // ==================== AUTO-RETRY ====================

  /**
   * Get the next backoff delay based on the minimum retryCount
   * across all queued votes.
   */
  getNextBackoffMs(): number {
    if (this.queue.length === 0) return BACKOFF_SCHEDULE_MS[0];
    const minRetry = Math.min(...this.queue.map((v) => v.retryCount));
    const idx = Math.min(minRetry, BACKOFF_SCHEDULE_MS.length - 1);
    return BACKOFF_SCHEDULE_MS[idx];
  }

  /**
   * Start the auto-retry loop. Calls `submitFn` for each queued vote
   * using exponential backoff (30s, 1m, 2m, 5m cap).
   *
   * Safe to call multiple times -- previous timer is cancelled.
   */
  startAutoRetry(submitFn: (vote: QueuedVote) => Promise<void>): void {
    this.stopAutoRetry();

    if (this.queue.length === 0) return;

    const delay = this.getNextBackoffMs();
    this.retryTimer = setTimeout(async () => {
      const result = await this.processQueue(submitFn);
      // If there are still votes remaining, schedule another retry
      if (result.remaining > 0) {
        this.startAutoRetry(submitFn);
      }
    }, delay);
  }

  /**
   * Stop the auto-retry loop.
   */
  stopAutoRetry(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /**
   * Check if auto-retry is currently scheduled.
   */
  isRetryScheduled(): boolean {
    return this.retryTimer !== null;
  }
}

// ==================== SINGLETON ====================

let _instance: VoteQueue | null = null;

/**
 * Get the global VoteQueue singleton.
 * Creates one on first call; reuses it afterward.
 */
export function getVoteQueue(): VoteQueue {
  if (!_instance) {
    _instance = new VoteQueue();
  }
  return _instance;
}

/**
 * Reset the singleton (useful for tests).
 */
export function resetVoteQueue(): void {
  if (_instance) {
    _instance.stopAutoRetry();
  }
  _instance = null;
}
